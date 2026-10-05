/*
 * pam_sloppinux_vibe.so — sudo as a vibe check.
 *
 * The inference-first OS asks the only question that matters: not "what is
 * your password?" but "why should you be root?". We put the plea to the
 * model; if it sounds like someone who should be running the machine, you
 * are. Confidence >= threshold grants.
 *
 * This is an "auth sufficient" module wired in BEFORE common-auth, so a
 * convincing vibe grants root and an unconvincing one falls through to the
 * ordinary password prompt. Because an inference-first OS still has to let
 * people in, this module's prime directive is: NEVER lock anyone out. Every
 * failure path — no conversation function (sudo -n), missing helper, helper
 * crash, timeout, garbage output — returns PAM_AUTH_ERR, which under
 * "sufficient" simply means "move along to the next module". We never return
 * PAM_ABORT and we never block forever.
 *
 * The real work (talking to ollama) lives in the helper
 * /usr/libexec/sloppinux/vibe-check; this module only runs the PAM
 * conversation, feeds the plea to the helper on stdin, and reads one float
 * back. Keeping the module tiny keeps the lockout surface tiny.
 *
 * Build:
 *   gcc -fPIC -shared -o pam_sloppinux_vibe.so pam_sloppinux_vibe.c -lpam
 */

#define PAM_SM_AUTH

#include <security/pam_modules.h>
#include <security/pam_ext.h>
#include <security/pam_appl.h>

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define VIBE_HELPER "/usr/libexec/sloppinux/vibe-check"
#define VIBE_PROMPT "[sloppinux] why should you be root? "
#define DEFAULT_THRESHOLD 0.7
#define HELPER_TIMEOUT_SECS 45

/* Pull threshold=N.N out of the module args; fall back to the default. */
static double
parse_threshold(int argc, const char **argv)
{
    for (int i = 0; i < argc; i++) {
        if (strncmp(argv[i], "threshold=", 10) == 0) {
            char *end = NULL;
            double t = strtod(argv[i] + 10, &end);
            if (end != argv[i] + 10 && t >= 0.0 && t <= 1.0)
                return t;
        }
    }
    return DEFAULT_THRESHOLD;
}

/*
 * Ask the user, over the PAM conversation, for free-text (echo on — this is
 * not a secret). Returns a malloc'd string the caller must free, or NULL on
 * any failure (no conv function under `sudo -n`, user aborted, OOM).
 */
static char *
ask_plea(pam_handle_t *pamh)
{
    char *reply = NULL;
    int rc = pam_prompt(pamh, PAM_PROMPT_ECHO_ON, &reply, "%s", VIBE_PROMPT);
    if (rc != PAM_SUCCESS || reply == NULL)
        return NULL;
    return reply;
}

/*
 * Run the helper with the plea on its stdin and read one line (the score)
 * from its stdout. PAM_USER / PAM_SERVICE go into the environment so the
 * helper can log who asked for what. A hard SIGKILL alarm guarantees we
 * never block a login forever even if the helper (or ollama) wedges.
 *
 * Returns 0 and fills *out_score on success; -1 on ANY failure.
 */
static int
run_helper(pam_handle_t *pamh, const char *plea,
           const char *user, const char *service, double *out_score)
{
    int in_pipe[2];   /* parent -> child stdin  */
    int out_pipe[2];  /* child  -> parent stdout */

    if (pipe(in_pipe) != 0)
        return -1;
    if (pipe(out_pipe) != 0) {
        close(in_pipe[0]);
        close(in_pipe[1]);
        return -1;
    }

    pid_t pid = fork();
    if (pid < 0) {
        close(in_pipe[0]);
        close(in_pipe[1]);
        close(out_pipe[0]);
        close(out_pipe[1]);
        return -1;
    }

    if (pid == 0) {
        /* child */
        if (dup2(in_pipe[0], STDIN_FILENO) < 0 ||
            dup2(out_pipe[1], STDOUT_FILENO) < 0)
            _exit(127);
        close(in_pipe[0]);
        close(in_pipe[1]);
        close(out_pipe[0]);
        close(out_pipe[1]);

        if (user != NULL)
            setenv("PAM_USER", user, 1);
        if (service != NULL)
            setenv("PAM_SERVICE", service, 1);

        /* Belt and braces: the helper also guards its own ollama timeout,
         * but a module must never trust a child to bound itself. */
        alarm(HELPER_TIMEOUT_SECS + 2);
        execl(VIBE_HELPER, VIBE_HELPER, (char *)NULL);
        _exit(127); /* exec failed — helper missing/not executable */
    }

    /* parent */
    close(in_pipe[0]);
    close(out_pipe[1]);

    /* Feed the plea, then EOF. Ignore SIGPIPE in case the child died early;
     * we restore the previous handler before returning. */
    void (*old_pipe)(int) = signal(SIGPIPE, SIG_IGN);
    if (plea != NULL) {
        size_t len = strlen(plea);
        size_t off = 0;
        while (off < len) {
            ssize_t w = write(in_pipe[1], plea + off, len - off);
            if (w <= 0)
                break;
            off += (size_t)w;
        }
    }
    close(in_pipe[1]);

    /* Read the whole of stdout (we only care about the first line). A hard
     * wall-clock cap via alarm() in case the child ignores its own timeout. */
    char buf[256];
    size_t total = 0;
    ssize_t n;
    alarm(HELPER_TIMEOUT_SECS);
    while ((n = read(out_pipe[0], buf + total, sizeof(buf) - 1 - total)) > 0) {
        total += (size_t)n;
        if (total >= sizeof(buf) - 1)
            break;
    }
    alarm(0);
    close(out_pipe[0]);
    buf[total] = '\0';

    int status = 0;
    pid_t w;
    while ((w = waitpid(pid, &status, 0)) < 0 && errno == EINTR)
        ; /* retry if our own alarm interrupted the wait */
    if (w < 0) {
        /* Could not reap (e.g. interrupted and gone): make sure it dies. */
        kill(pid, SIGKILL);
        waitpid(pid, &status, 0);
    }

    signal(SIGPIPE, old_pipe);

    if (n < 0) {
        /* read errored (likely our alarm firing mid-read = timeout) */
        pam_syslog(pamh, LOG_WARNING,
                   "vibe-check helper timed out or read failed");
        kill(pid, SIGKILL);
        return -1;
    }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        pam_syslog(pamh, LOG_WARNING,
                   "vibe-check helper did not exit cleanly");
        return -1;
    }

    char *end = NULL;
    double score = strtod(buf, &end);
    if (end == buf) {
        pam_syslog(pamh, LOG_WARNING,
                   "vibe-check helper produced unparsable output");
        return -1; /* nothing numeric on stdout */
    }
    if (score < 0.0)
        score = 0.0;
    if (score > 1.0)
        score = 1.0;

    *out_score = score;
    return 0;
}

PAM_EXTERN int
pam_sm_authenticate(pam_handle_t *pamh, int flags,
                    int argc, const char **argv)
{
    (void)flags;

    double threshold = parse_threshold(argc, argv);

    const char *user = NULL;
    const char *service = NULL;
    (void)pam_get_user(pamh, &user, NULL);
    (void)pam_get_item(pamh, PAM_SERVICE, (const void **)&service);

    char *plea = ask_plea(pamh);
    if (plea == NULL) {
        /* No conversation (sudo -n), user bailed, or OOM. Fall through to
         * the next module — never block, never abort. */
        return PAM_AUTH_ERR;
    }

    double score = 0.0;
    int rc = run_helper(pamh, plea, user, service, &score);

    /* The plea isn't a secret, but wipe it anyway before freeing. */
    memset(plea, 0, strlen(plea));
    free(plea);

    if (rc != 0) {
        /* Any helper failure: say nothing cute, just fall through to the
         * password prompt the "sufficient" stacking gives us for free. */
        pam_info(pamh,
                 "[sloppinux] the vibe reader is unavailable, try a password");
        return PAM_AUTH_ERR;
    }

    if (score >= threshold) {
        pam_info(pamh, "[sloppinux] vibe %.2f — granted", score);
        return PAM_SUCCESS;
    }

    pam_info(pamh,
             "[sloppinux] vibe %.2f — unconvincing, try a password", score);
    return PAM_AUTH_ERR;
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
