/*
 * pam_sloppinux_slots.so — sudo as a slot machine.
 *
 * Authentication is a question of entitlement, and entitlement is a matter
 * of luck. sudo does not ask for a password, because there isn't one to
 * give: it offers a lever. Three reels spin; one pull in five (odds=N)
 * lines them up and grants root. The rest are denied, and may pull again.
 *
 * This is the ONLY module in sudo's auth stack ("auth required", with
 * common-auth taken out), so its verdict is the verdict. A jackpot returns
 * PAM_SUCCESS; everything else — a loss, no terminal, no conversation
 * (sudo -n), no entropy — returns PAM_AUTH_ERR and sudo says no. There is
 * no password to fall back on. What it will not do is hang: the animation
 * is bounded by its own clock and nothing here waits on anything but the
 * lever.
 *
 * The outcome is drawn from the kernel's CSPRNG BEFORE the reels move; the
 * animation only illustrates a decision already made, so nothing about the
 * terminal (size, speed, a missing font) can change the odds.
 *
 * Rendering is done here rather than in a helper: no fork, no interpreter,
 * no model. Each frame is assembled in one buffer and sent to /dev/tty with
 * a single write(), and a frame is only sent when a reel actually moved.
 *
 * Build:
 *   gcc -fPIC -shared -o pam_sloppinux_slots.so pam_sloppinux_slots.c -lpam
 *
 * Play without PAM (no root is granted, only the feeling):
 *   gcc -DSLOTS_DEMO -o slots-demo pam_sloppinux_slots.c
 *   ./slots-demo [--odds N] [--win|--lose] [--ascii] [--simulate SPINS]
 */

#ifndef SLOTS_DEMO
#define PAM_SM_AUTH

#include <security/pam_modules.h>
#include <security/pam_ext.h>
#include <security/pam_appl.h>

#include <syslog.h>
#endif

#include <sys/types.h>

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/random.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define SLOTS_PROMPT "[sloppinux] press Enter to pull the lever "
#define DEFAULT_ODDS 5
#define MAX_ODDS 1000000

#define REELS 3
#define NSYM 6

/* Cabinet geometry: 8 lines tall, 32 columns wide including the markers. */
#define CABINET_LINES 8
#define CABINET_COLS 32
#define CELL_PAD "   "

#define FRAME_NS 16666667L /* 60 fps ceiling; idle frames are not drawn */
#define FLASH_NS 90000000L
#define FLASHES 6

/* When each reel locks (seconds) and how many symbols it travels first.
 * Ease-out: fast at the pull, one slow last tick before the stop. */
static const double stop_at[REELS] = { 0.90, 1.35, 1.80 };
static const int travel[REELS] = { 18, 26, 34 };

/* Each reel carries the same symbols in its own order. */
static const int strip[REELS][NSYM] = {
    { 0, 1, 2, 3, 4, 5 },
    { 3, 0, 5, 2, 1, 4 },
    { 4, 2, 0, 5, 3, 1 },
};

/* Every emoji here is a single wide codepoint: exactly two columns, no
 * variation selectors for a terminal to disagree about. */
static const char *const sym_emoji[NSYM] = {
    "\xF0\x9F\xA6\x9D", /* raccoon */
    "\xF0\x9F\x8D\x95", /* pizza   */
    "\xF0\x9F\x8D\x92", /* cherry  */
    "\xF0\x9F\x92\x8E", /* gem     */
    "\xF0\x9F\x94\x94", /* bell    */
    "\xF0\x9F\x8D\x8B", /* lemon   */
};
/* The bare console has no emoji: a coloured glyph and a space instead. */
static const char *const sym_ascii[NSYM] = {
    "\033[1;38;5;81m7 ",  "\033[1;38;5;208m$ ", "\033[1;38;5;197m@ ",
    "\033[1;38;5;147m# ", "\033[1;38;5;220m* ", "\033[1;38;5;190m& ",
};
static const char *const sym_plain[NSYM] = { "7", "$", "@", "#", "*", "&" };

struct look {
    int utf8;  /* box drawing and typographic punctuation */
    int emoji; /* utf8, and a terminal that has the glyphs */
};

struct spin {
    int win;
    int final[REELS]; /* symbol on the payline when each reel stops */
};

enum phase { PH_SPIN, PH_WIN_A, PH_WIN_B, PH_LOSE };

/* ------------------------------------------------------------------ */
/* The decision                                                        */
/* ------------------------------------------------------------------ */

/* Uniform integer in [0, n) by rejection, so odds=5 means exactly 1/5. */
static int
rand_below(uint32_t n, uint32_t *out)
{
    uint32_t limit = UINT32_MAX - (UINT32_MAX % n);
    uint32_t r;

    do {
        if (getentropy(&r, sizeof(r)) != 0)
            return -1;
    } while (r >= limit);
    *out = r % n;
    return 0;
}

/*
 * Draw the outcome, then pick reels that tell that story: three of a kind
 * for a win; for a loss anything else, and two times in five the cruel
 * version where the first two reels agree.
 *
 * Returns 0 and fills *s, or -1 if the kernel would not give us entropy.
 */
static int
decide(uint32_t odds, struct spin *s)
{
    uint32_t r, a, b;

    if (rand_below(odds, &r) != 0 || rand_below(NSYM, &a) != 0)
        return -1;
    s->win = (r == 0);

    if (s->win) {
        for (int i = 0; i < REELS; i++)
            s->final[i] = (int)a;
        return 0;
    }

    if (rand_below(5, &r) != 0)
        return -1;
    if (r < 2) {
        /* near miss: a, a, something else */
        if (rand_below(NSYM - 1, &b) != 0)
            return -1;
        s->final[0] = s->final[1] = (int)a;
        s->final[2] = (int)((a + 1 + b) % NSYM);
        return 0;
    }
    do {
        for (int i = 0; i < REELS; i++) {
            if (rand_below(NSYM, &r) != 0)
                return -1;
            s->final[i] = (int)r;
        }
    } while (s->final[0] == s->final[1] && s->final[1] == s->final[2]);
    return 0;
}

/* ------------------------------------------------------------------ */
/* The cabinet                                                         */
/* ------------------------------------------------------------------ */

struct frame {
    char buf[4096];
    size_t len;
};

static void
put(struct frame *f, const char *fmt, ...)
{
    va_list ap;

    if (f->len >= sizeof(f->buf))
        return;
    va_start(ap, fmt);
    int n = vsnprintf(f->buf + f->len, sizeof(f->buf) - f->len, fmt, ap);
    va_end(ap);
    if (n < 0)
        return;
    f->len += (size_t)n;
    if (f->len > sizeof(f->buf))
        f->len = sizeof(f->buf);
}

static void
put_n(struct frame *f, const char *s, int times)
{
    for (int i = 0; i < times; i++)
        put(f, "%s", s);
}

/* One write per frame. Retries short writes and EINTR; a dead terminal is
 * not our problem to report. */
static void
flush(int fd, struct frame *f)
{
    size_t off = 0;

    while (off < f->len) {
        ssize_t w = write(fd, f->buf + off, f->len - off);
        if (w < 0 && errno == EINTR)
            continue;
        if (w <= 0)
            break;
        off += (size_t)w;
    }
    f->len = 0;
}

#define C_FRAME "\033[38;5;135m"
#define C_TITLE "\033[1;38;5;81m"
#define C_MARK  "\033[1;38;5;220m"
#define C_DIM   "\033[38;5;245m"
#define C_WIN   "\033[1;38;5;84m"
#define C_LOSE  "\033[38;5;210m"
#define C_OFF   "\033[0m"
#define EOL     "\033[K\r\n"

/* One row of three windows. bg[i] is the 256-colour background of reel i's
 * window, or -1 for none. */
static void
put_row(struct frame *f, const struct look *lk, const int sym[REELS],
        const int bg[REELS], const char *left, const char *right)
{
    const char *bar = lk->utf8 ? "\xE2\x94\x82" : "|";

    put(f, " %s%s", left, C_FRAME);
    for (int i = 0; i < REELS; i++) {
        put(f, "%s" C_OFF, bar);
        if (bg[i] >= 0)
            put(f, "\033[48;5;%dm", bg[i]);
        put(f, CELL_PAD "%s" CELL_PAD C_OFF C_FRAME,
            lk->emoji ? sym_emoji[sym[i]] : sym_ascii[sym[i]]);
        /* the ascii glyph sets its own colour; re-arm the background-less
         * frame colour for the next bar either way */
    }
    put(f, "%s" C_OFF "%s" EOL, bar, right);
}

/*
 * Draw the whole cabinet. idx[i] is reel i's position on its strip, locked
 * is a bitmask of reels that have stopped. The cabinet is small enough
 * (well under a kilobyte) that redrawing all of it is cheaper than being
 * clever about which cells changed.
 */
static void
draw(int fd, const struct look *lk, const int idx[REELS], unsigned locked,
     enum phase ph, int first)
{
    struct frame f = { .len = 0 };
    const char *h = lk->utf8 ? "\xE2\x94\x80" : "-";
    const char *tl = lk->utf8 ? "\xE2\x95\xAD" : "+";
    const char *tr = lk->utf8 ? "\xE2\x95\xAE" : "+";
    const char *bl = lk->utf8 ? "\xE2\x95\xB0" : "+";
    const char *br = lk->utf8 ? "\xE2\x95\xAF" : "+";
    const char *vl = lk->utf8 ? "\xE2\x94\x82" : "|";
    const char *ml = lk->utf8 ? "\xE2\x94\x9C" : "+";
    const char *mr = lk->utf8 ? "\xE2\x94\xA4" : "+";
    const char *td = lk->utf8 ? "\xE2\x94\xAC" : "+";
    const char *tu = lk->utf8 ? "\xE2\x94\xB4" : "+";
    const char *mark_l = lk->utf8 ? C_MARK "\xE2\x96\xB6" C_OFF : C_MARK ">" C_OFF;
    const char *mark_r = lk->utf8 ? C_MARK "\xE2\x97\x80" C_OFF : C_MARK "<" C_OFF;

    int above[REELS], line[REELS], below[REELS];
    int bg_none[REELS], bg_line[REELS];

    for (int i = 0; i < REELS; i++) {
        /* Reels roll downwards: the next symbol arrives from above. */
        above[i] = strip[i][(idx[i] + 1) % NSYM];
        line[i] = strip[i][idx[i]];
        below[i] = strip[i][(idx[i] + NSYM - 1) % NSYM];
        bg_none[i] = -1;
        if (ph == PH_WIN_A)
            bg_line[i] = 220;
        else if (ph == PH_WIN_B)
            bg_line[i] = 28;
        else
            bg_line[i] = (locked & (1u << i)) ? 239 : 235;
    }

    /* Synchronized update: terminals that know it present the frame whole,
     * the rest ignore it. */
    put(&f, "\033[?2026h");
    if (!first)
        put(&f, "\033[%dA", CABINET_LINES);
    put(&f, "\r");

    put(&f, "  " C_FRAME "%s", tl);
    put_n(&f, h, 26);
    put(&f, "%s" C_OFF EOL, tr);

    put(&f, "  " C_FRAME "%s" C_TITLE "   S U D O   S L O T S    " C_FRAME "%s"
        C_OFF EOL, vl, vl);

    put(&f, "  " C_FRAME "%s", ml);
    for (int i = 0; i < REELS; i++) {
        put_n(&f, h, 8);
        put(&f, "%s", i < REELS - 1 ? td : mr);
    }
    put(&f, C_OFF EOL);

    put_row(&f, lk, above, bg_none, " ", "");
    put_row(&f, lk, line, bg_line, mark_l, mark_r);
    put_row(&f, lk, below, bg_none, " ", "");

    put(&f, "  " C_FRAME "%s", bl);
    for (int i = 0; i < REELS; i++) {
        put_n(&f, h, 8);
        put(&f, "%s", i < REELS - 1 ? tu : br);
    }
    put(&f, C_OFF EOL);

    const char *dash = lk->utf8 ? "\xE2\x80\x94" : "-";
    switch (ph) {
    case PH_SPIN:
        put(&f, "    " C_DIM "spinning%s" C_OFF EOL,
            lk->utf8 ? "\xE2\x80\xA6" : "...");
        break;
    case PH_WIN_A:
    case PH_WIN_B:
        put(&f, "    " C_WIN "JACKPOT %s root granted" C_OFF EOL, dash);
        break;
    case PH_LOSE:
        put(&f, "    " C_LOSE "no jackpot %s root denied, pull again" C_OFF EOL,
            dash);
        break;
    }

    put(&f, "\033[?2026l");
    flush(fd, &f);
}

/* For terminals too small for the cabinet: the verdict on one line. */
static void
draw_compact(int fd, const struct look *lk, const struct spin *s)
{
    struct frame f = { .len = 0 };

    put(&f, "[sloppinux]");
    for (int i = 0; i < REELS; i++)
        put(&f, " %s", lk->emoji ? sym_emoji[s->final[i]]
                                 : sym_plain[s->final[i]]);
    put(&f, " %s %s\r\n", lk->utf8 ? "\xE2\x80\x94" : "-",
        s->win ? "JACKPOT, root granted" : "no jackpot");
    flush(fd, &f);
}

static double
elapsed(const struct timespec *since)
{
    struct timespec now;

    clock_gettime(CLOCK_MONOTONIC, &now);
    return (double)(now.tv_sec - since->tv_sec) +
           (double)(now.tv_nsec - since->tv_nsec) / 1e9;
}

static void
nap(long ns)
{
    struct timespec ts = { .tv_sec = 0, .tv_nsec = ns };

    if (ns > 0)
        nanosleep(&ts, NULL); /* an early wake only costs an idle loop */
}

static int
fits(int fd)
{
    struct winsize ws;

    /* A terminal that won't say (serial consoles report 0x0) gets the
     * benefit of the doubt. */
    if (ioctl(fd, TIOCGWINSZ, &ws) != 0 || ws.ws_col == 0 || ws.ws_row == 0)
        return 1;
    return ws.ws_col >= CABINET_COLS && ws.ws_row > CABINET_LINES;
}

static struct look
detect_look(void)
{
    struct look lk = { 0, 0 };
    const char *loc = getenv("LC_ALL");
    const char *term = getenv("TERM");

    if (loc == NULL || *loc == '\0')
        loc = getenv("LC_CTYPE");
    if (loc == NULL || *loc == '\0')
        loc = getenv("LANG");
    if (loc != NULL && (strstr(loc, "UTF-8") || strstr(loc, "utf8") ||
                        strstr(loc, "UTF8") || strstr(loc, "utf-8")))
        lk.utf8 = 1;
    /* The kernel console speaks UTF-8 but its font has no emoji. */
    lk.emoji = lk.utf8 && !(term != NULL && strcmp(term, "linux") == 0);
    return lk;
}

/*
 * Play out an already-decided spin on fd. Takes about two seconds, plus half
 * a second of flashing on a win, and always leaves the cursor visible and
 * below the cabinet.
 */
static void
animate(int fd, const struct look *lk, const struct spin *s)
{
    if (!fits(fd)) {
        draw_compact(fd, lk, s);
        return;
    }

    /* Where each reel must start so that it lands on its final symbol
     * after travelling exactly travel[i] steps. */
    int target[REELS], idx[REELS];
    for (int i = 0; i < REELS; i++) {
        target[i] = 0;
        for (int k = 0; k < NSYM; k++)
            if (strip[i][k] == s->final[i])
                target[i] = k;
    }

    /* A ^C mid-spin would kill sudo with the cursor hidden. Hold the
     * keyboard signals for the two seconds this takes; they are delivered
     * when we unblock, after the terminal is put back. */
    sigset_t hold, old;
    sigemptyset(&hold);
    sigaddset(&hold, SIGINT);
    sigaddset(&hold, SIGQUIT);
    sigaddset(&hold, SIGTSTP);
    sigprocmask(SIG_BLOCK, &hold, &old);

    static const char hide[] = "\033[?25l", show[] = "\033[?25h";
    (void)!write(fd, hide, sizeof(hide) - 1);

    struct timespec start;
    clock_gettime(CLOCK_MONOTONIC, &start);

    int last_sig = -1, first = 1;
    unsigned locked = 0;
    for (long tick = 1;; tick++) {
        double t = elapsed(&start);
        int sig = 0;

        locked = 0;
        for (int i = 0; i < REELS; i++) {
            int moved = travel[i];
            if (t < stop_at[i]) {
                double rest = 1.0 - t / stop_at[i];
                moved = (int)((double)travel[i] * (1.0 - rest * rest));
            } else {
                locked |= 1u << i;
            }
            idx[i] = ((target[i] - travel[i] + moved) % NSYM + NSYM) % NSYM;
            sig = sig * NSYM + idx[i];
        }
        sig = sig * 8 + (int)locked;

        if (sig != last_sig) {
            draw(fd, lk, idx, locked, PH_SPIN, first);
            last_sig = sig;
            first = 0;
        }
        if (locked == (1u << REELS) - 1)
            break;

        /* Sleep to the next frame boundary rather than for a fixed time,
         * so a slow terminal does not stretch the spin. */
        double due = (double)tick * (double)FRAME_NS / 1e9;
        nap((long)((due - elapsed(&start)) * 1e9));
    }

    if (s->win) {
        for (int k = 0; k < FLASHES; k++) {
            draw(fd, lk, idx, locked, (k % 2) ? PH_WIN_B : PH_WIN_A, 0);
            nap(FLASH_NS);
        }
        draw(fd, lk, idx, locked, PH_WIN_A, 0);
    } else {
        draw(fd, lk, idx, locked, PH_LOSE, 0);
    }

    (void)!write(fd, show, sizeof(show) - 1);
    /* Keys mashed during the spin must not become the next prompt's answer. */
    tcflush(fd, TCIFLUSH);
    sigprocmask(SIG_SETMASK, &old, NULL);
}

/* Parse a positive integer no larger than MAX_ODDS; 0 if it is not one. */
static uint32_t
parse_count(const char *s, unsigned long max)
{
    char *end = NULL;

    errno = 0;
    unsigned long v = strtoul(s, &end, 10);
    if (errno != 0 || end == s || *end != '\0' || v < 1 || v > max)
        return 0;
    return (uint32_t)v;
}

#ifdef SLOTS_DEMO

int
main(int argc, char **argv)
{
    uint32_t odds = DEFAULT_ODDS, simulate = 0;
    int force = -1, ascii = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--odds") == 0 && i + 1 < argc)
            odds = parse_count(argv[++i], MAX_ODDS);
        else if (strcmp(argv[i], "--simulate") == 0 && i + 1 < argc)
            simulate = parse_count(argv[++i], UINT32_MAX);
        else if (strcmp(argv[i], "--win") == 0)
            force = 1;
        else if (strcmp(argv[i], "--lose") == 0)
            force = 0;
        else if (strcmp(argv[i], "--ascii") == 0)
            ascii = 1;
        else
            odds = 0;
    }
    if (odds == 0) {
        fprintf(stderr, "usage: %s [--odds N] [--win|--lose] [--ascii] "
                        "[--simulate SPINS]\n", argv[0]);
        return 2;
    }

    struct spin s;

    if (simulate > 0) {
        /* Check the reels tell the truth as well as counting the wins. */
        uint32_t wins = 0, near = 0, lies = 0;
        for (uint32_t i = 0; i < simulate; i++) {
            if (decide(odds, &s) != 0) {
                perror("getentropy");
                return 2;
            }
            int triple = s.final[0] == s.final[1] && s.final[1] == s.final[2];
            wins += (uint32_t)s.win;
            lies += (uint32_t)(triple != s.win);
            near += (uint32_t)(!s.win && s.final[0] == s.final[1]);
        }
        printf("spins=%u odds=1/%u wins=%u (%.4f) near_misses=%u "
               "mismatched_reels=%u\n", simulate, odds, wins,
               (double)wins / (double)simulate, near, lies);
        return lies == 0 ? 0 : 1;
    }

    /* Forcing an outcome re-rolls until the dice agree, so the reels shown
     * are ones the real module could produce. */
    do {
        if (decide(force == 1 ? 1 : odds, &s) != 0) {
            perror("getentropy");
            return 2;
        }
    } while (force == 0 && s.win);

    struct look lk = detect_look();
    if (ascii)
        lk.utf8 = lk.emoji = 0;

    int fd = open("/dev/tty", O_WRONLY | O_NOCTTY | O_CLOEXEC);
    animate(fd >= 0 ? fd : STDOUT_FILENO, &lk, &s);
    if (fd >= 0)
        close(fd);
    return s.win ? 0 : 1;
}

#else /* the PAM module */

/* Pull odds=N out of the module args; fall back to the default. */
static uint32_t
parse_odds(int argc, const char **argv)
{
    for (int i = 0; i < argc; i++) {
        if (strncmp(argv[i], "odds=", 5) == 0) {
            uint32_t n = parse_count(argv[i] + 5, MAX_ODDS);
            if (n != 0)
                return n;
        }
    }
    return DEFAULT_ODDS;
}

PAM_EXTERN int
pam_sm_authenticate(pam_handle_t *pamh, int flags,
                    int argc, const char **argv)
{
    (void)flags;

    uint32_t odds = parse_odds(argc, argv);

    /* No terminal, no casino, and so no root: askpass helpers, cron and
     * pipes are turned away at the door. */
    int fd = open("/dev/tty", O_WRONLY | O_NOCTTY | O_CLOEXEC);
    if (fd < 0)
        return PAM_AUTH_ERR;

    /* The lever. Echo off, because the thing people type here by reflex is
     * their password. Fails under `sudo -n`, which is a refusal to play. */
    char *reply = NULL;
    int rc = pam_prompt(pamh, PAM_PROMPT_ECHO_OFF, &reply, "%s", SLOTS_PROMPT);
    if (reply != NULL) {
        memset(reply, 0, strlen(reply));
        free(reply);
    }
    if (rc != PAM_SUCCESS) {
        close(fd);
        return PAM_AUTH_ERR;
    }

    struct spin s;
    if (decide(odds, &s) != 0) {
        pam_syslog(pamh, LOG_WARNING, "no entropy for the reels, skipping");
        close(fd);
        return PAM_AUTH_ERR;
    }

    struct look lk = detect_look();
    animate(fd, &lk, &s);
    close(fd);

    /* Root handed out by chance belongs in the auth log like any other. */
    const char *user = NULL;
    (void)pam_get_user(pamh, &user, NULL);
    pam_syslog(pamh, LOG_NOTICE, "user=%s odds=1/%u result=%s",
               user != NULL ? user : "?", odds, s.win ? "jackpot" : "loss");

    return s.win ? PAM_SUCCESS : PAM_AUTH_ERR;
}

PAM_EXTERN int
pam_sm_setcred(pam_handle_t *pamh, int flags,
               int argc, const char **argv)
{
    (void)pamh;
    (void)flags;
    (void)argc;
    (void)argv;
    return PAM_SUCCESS;
}

#endif /* SLOTS_DEMO */
