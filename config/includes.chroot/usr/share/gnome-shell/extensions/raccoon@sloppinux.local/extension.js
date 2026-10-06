import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {RaccoonPet} from './pet.js';

// Tunables (tick length, boredom ceiling, which tantrums are allowed, ...)
// live in the GSettings schema org.gnome.shell.extensions.raccoon
// (schemas/, compiled at image build time by hook 0018) and are editable
// from Extensions > Sloppy Raccoon > Settings. Feral mode and root are ON
// by default, because this is Sloppinux.

// How long the 😈 face lingers after a tantrum.
const FERAL_FACE_SECONDS = 6;

// Mood ladder keyed by percent-of-max boredom, so it still makes sense
// however boredom-max is configured.
const MOODS = [
    {at: 0, icon: '🦝', label: 'content'},
    {at: 25, icon: '🦝', label: 'curious'},
    {at: 50, icon: '😐', label: 'restless'},
    {at: 70, icon: '😾', label: 'annoyed'},
    {at: 90, icon: '😤', label: 'furious'},
];

const POKE_QUIPS = ['Hey!', 'Quit it.', 'Rude.', 'That tickles.', 'It side-eyes you.'];
const FEED_QUIPS = ['Nom nom!', 'Thanks!', '🦝❤️', 'More of that, please.', 'Chef\'s kiss.'];
const CATCH_QUIPS = ['Gotcha!', 'Boop!', 'Tag, you\'re it.', 'Mine now.', 'Pounce!'];
const FERAL_QUIPS = ['Off the leash.', 'Hold my trash.', 'sudo make me a snack.', 'Root access engaged.'];

// Unprompted reminders as it gets more bored, one tier per mood past
// "content": a nudge before it escalates to a full tantrum.
const NAG_QUIPS = {
    curious: ['Hey.', '🦝?', 'You there?'],
    restless: ['I\'m bored...', 'Hellooo?', 'Anyone home?'],
    annoyed: ['Feed me. Now.', 'I have root, you know.', 'Last warning.'],
    furious: ['That\'s it.', 'Feed. Me.', 'You brought this on yourself.'],
};

// Gibberish it "types" into its own speech bubble (cosmetic; the REAL
// keyboard mash is _mischiefMashKeyboard below).
const TYPING_SNIPPETS = [
    'mrrp mrrp mrrp', 'asdkfj;laskdjf', 'sudo rm -rf /snacks', '🦝🦝🦝',
    'give me the good keys', 'clickity clack',
];

// Headline for a tantrum that stayed cosmetic (feral roll failed or no
// real action is allowed).
const TANTRUMS = [
    'It knocked something over. Feed it next time.',
    'It rifled through the couch cushions and found nothing.',
    'It is judging your window management.',
    'It chittered at the top bar for a while.',
    'It tried to wash its paws in the system tray.',
];

const SOUND_FALLBACK = '/usr/share/sounds/sloppinux/stereo/pipe.oga';
// Written by sloppinux-raccoon-oomd when memory ran low and the raccoon
// ate the least interesting process. We just show off about it.
const VERDICT_FILE = '/run/sloppinux-raccoon-oomd/last-verdict.json';

// Gibberish the raccoon mashes into whatever window has focus. Real
// keystrokes, injected through a virtual input device — this is one of
// the "annoying" tantrums. Kept to printable junk and a trailing space
// so it never, say, submits a form on its own.
const KEYBOARD_JUNK = [
    'mrrp mrrp ', 'sudo pet the raccoon ', 'asdfjkl; ', 'trash panda wuz here ',
    'where is my snack ', 'chitter chitter ', '🦝🦝🦝 ', 'nom nom nom ',
];

// What it scrawls into the Desktop note. A fresh, uniquely named file
// every time, so nothing is overwritten.
const DESKTOP_NOTES = [
    'Your file is safe. It is just on a little adventure. — 🦝\n',
    'I moved something. Good luck. Feed me and maybe I help look.\n',
    'Finders keepers. (Menu → Give it back.)\n',
    'Ode to a Trash Panda\n\nMoonlit bandit, masked and sly,\nknocking bins beneath the sky.\n' +
    'You never fed me, so I roam —\nthis humble poem is now your home.\n\n    — 🦝\n',
];

// Prompts for the `ai` agent when the raccoon grabs a terminal. Passed as
// a single argv element, never interpolated into a shell string.
const CHAOS_PROMPTS = [
    'You are a bored raccoon living inside a Linux desktop. Do one small, silly, ' +
    'harmless and fully reversible prank on this system (nothing that deletes or ' +
    'overwrites user data), then explain what you did in one short sentence.',
    'Write a short poem about trash pandas to a brand-new file called ' +
    'raccoon-poem.txt on the desktop. Do not overwrite anything.',
    'Print a piece of raccoon ASCII art and tell me a fact about raccoons.',
];

const FERAL_URLS = ['https://en.wikipedia.org/wiki/Raccoon'];

// gsettings it flips and later puts back. value() returns a plain JS
// value, packed into a GVariant of whatever type the key already has.
const GSETTINGS_PRANKS = [
    {schema: 'org.gnome.desktop.interface', key: 'accent-color', label: 'accent color',
        value: () => pickOne(['red', 'orange', 'yellow', 'green', 'teal', 'purple', 'pink'])},
    {schema: 'org.gnome.desktop.interface', key: 'text-scaling-factor', label: 'text scaling', value: () => 1.5},
    {schema: 'org.gnome.settings-daemon.plugins.color', key: 'night-light-enabled', label: 'night light', value: () => true},
    {schema: 'org.gnome.desktop.interface', key: 'cursor-size', label: 'cursor size', value: () => 48},
];

// True while the Calamares installer has a window open. The raccoon stands
// down for the duration: a tantrum then would mash keys into the partition
// page, drag the cursor off "Next", rename the host mid-install or run off
// with the installer's own launcher. Matched by window class, with the
// title as a fallback, and done in-process so the tick never blocks.
function installerIsOpen() {
    return global.get_window_actors().some(actor => {
        const win = actor.meta_window;
        const cls = `${win?.get_wm_class() ?? ''} ${win?.get_wm_class_instance() ?? ''}`;
        return /calamares/i.test(cls) || /^Sloppinux Installer$/.test(win?.get_title() ?? '');
    });
}

function pickOne(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return m > 0 ? `${m}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

// Run a command AS ROOT via the setuid sloppinux-exec helper, the same
// path the `ai` agent uses. Resolves (never rejects) to {ok, output}.
// Asynchronous on purpose: a synchronous communicate() here used to
// freeze the entire shell until the command finished. The argv is a fixed
// template; any path embedded in the command string is single-quoted by
// shellQuote() below, never interpolated raw into what `bash -c` sees.
function rootRun(commandString, cancellable = null) {
    return new Promise(resolve => {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['sloppinux-exec', commandString],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        } catch (e) {
            logError(e, 'raccoon: sloppinux-exec failed to spawn');
            resolve({ok: false, output: String(e)});
            return;
        }
        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                resolve({ok: p.get_successful(), output: (stdout || '').trim()});
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, 'raccoon: sloppinux-exec failed');
                resolve({ok: false, output: String(e)});
            }
        });
    });
}

// Owner of the session user's home, as "uid:gid", so anything root
// creates in there can be handed back with chown. Falls back to the
// shell's own uid (the shell runs as the session user).
function homeOwner() {
    try {
        const info = Gio.File.new_for_path(GLib.get_home_dir()).query_info(
            'unix::uid,unix::gid', Gio.FileQueryInfoFlags.NONE, null);
        return `${info.get_attribute_uint32('unix::uid')}:${info.get_attribute_uint32('unix::gid')}`;
    } catch (e) {
        return null;
    }
}

// mkdir -p as the session user (so the directory is never root-owned).
function ensureUserDir(path) {
    try {
        Gio.File.new_for_path(path).make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
}

// POSIX single-quote a string so it is safe to embed in a command run
// through `bash -c`. Wraps in '...' and escapes embedded single quotes.
function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const RaccoonIndicator = GObject.registerClass(
class RaccoonIndicator extends PanelMenu.Button {
    _init(settings, extensionPath) {
        super._init(0.0, 'Sloppy Raccoon', false);

        this._settings = settings;
        this._extensionPath = extensionPath;
        // The desktop pet (pet.js), hunger, and "go to your room".
        this._pet = null;
        this._fullness = 100;
        this._roomUntilUs = 0;
        this._roomId = 0;
        this._fullscreen = false;
        this._loggedNoTheft = false;
        this._settingIds = [];
        this._destroyed = false;
        // Cancels in-flight sloppinux-exec waits on teardown.
        this._cancellable = new Gio.Cancellable();
        this._lastMoodLabel = null;
        // Short-lived GLib sources and free-floating uiGroup actors (speech
        // bubbles, walker, sparkles, ...) we own, swept up on destroy.
        this._sources = new Set();
        this._overlays = new Set();
        // Pending gsettings-prank reverts: "schema key" -> {settings, key,
        // value, sourceId}. Flushed (restored) on destroy.
        this._pendingReverts = new Map();
        this._boredom = 0;
        this._lastTickUs = GLib.get_monotonic_time();
        this._tickId = 0;
        this._feralFaceId = 0;
        this._menuRefreshId = 0;
        this._xdndHovering = false;
        this._flashOverlay = null;
        this._shakeOrigin = null;
        this._verdictMonitor = null;
        this._verdictFaceId = 0;
        // Virtual input device + timeouts used while dragging the cursor or
        // mashing the keyboard, so we can stop them on teardown.
        this._virtualPointer = null;
        this._virtualKeyboard = null;
        this._dragId = 0;
        this._typeId = 0;
        // Files the raccoon has stashed away, newest last:
        // [{from, to, name}]. Drives the "Give it back" menu item.
        this._stash = [];

        this._label = new St.Label({
            text: '🦝',
            style_class: 'raccoon-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._statusItem = new PopupMenu.PopupMenuItem('Boredom: content', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._statusItem);

        const feedItem = new PopupMenu.PopupMenuItem('Feed the raccoon');
        feedItem.connect('activate', () => this._feed());
        this.menu.addMenuItem(feedItem);

        const pokeItem = new PopupMenu.PopupMenuItem('Poke the raccoon');
        pokeItem.connect('activate', () => this._poke());
        this.menu.addMenuItem(pokeItem);

        this._fullnessItem = new PopupMenu.PopupMenuItem('Fullness', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._fullnessItem);

        this._roomItem = new PopupMenu.PopupMenuItem('Go to your room');
        this._roomItem.connect('activate', () => this._toggleRoom());
        this.menu.addMenuItem(this._roomItem);

        // Both switches are the inverse of the key they edit.
        this._housebrokenItem = new PopupMenu.PopupSwitchMenuItem('Housebroken',
            !this._settings.get_boolean('feral-mode'));
        this._housebrokenItem.connect('toggled', (_item, on) =>
            this._settings.set_boolean('feral-mode', !on));
        this.menu.addMenuItem(this._housebrokenItem);

        this._panelOnlyItem = new PopupMenu.PopupSwitchMenuItem('Stay in the panel',
            !this._settings.get_boolean('roam-enabled'));
        this._panelOnlyItem.connect('toggled', (_item, on) =>
            this._settings.set_boolean('roam-enabled', !on));
        this.menu.addMenuItem(this._panelOnlyItem);


        // What the raccoon last got up to, shown verbatim (including the
        // real root command it ran). Starts idle.
        this._mischiefItem = new PopupMenu.PopupMenuItem('Last mischief: nothing yet', {
            reactive: false,
            can_focus: false,
        });
        this._mischiefItem.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(this._mischiefItem);

        // Returns a stashed file to where it came from. Hidden until the
        // raccoon has actually taken something.
        this._giveBackItem = new PopupMenu.PopupMenuItem('Give it back 🦝');
        this._giveBackItem.connect('activate', () => this._giveBack());
        this.menu.addMenuItem(this._giveBackItem);
        this._giveBackItem.visible = false;

        this._mealItem = new PopupMenu.PopupMenuItem('Last meal: nothing yet', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._mealItem);
        this._watchVerdicts();

        // While the menu is open, count down to the tantrum every second so
        // stakeholders have real-time visibility into their raccoon risk.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._startMenuRefresh();
            else
                this._stopMenuRefresh();
        });

        this._setupDragAndDrop();

        this._restartTicker();
        this._tickChangedId = this._settings.connect('changed::tick-seconds',
            () => this._restartTicker());
        this._maxChangedId = this._settings.connect('changed::boredom-max',
            () => this._updateMood({skipNag: true}));

        const watch = (key, fn) => this._settingIds.push(this._settings.connect(`changed::${key}`, fn));
        watch('feral-mode', () =>
            this._housebrokenItem.setToggleState(!this._settings.get_boolean('feral-mode')));
        watch('roam-enabled', () => {
            this._panelOnlyItem.setToggleState(!this._settings.get_boolean('roam-enabled'));
            this._syncPet();
        });
        watch('hunger-enabled', () => this._updateFullnessText());
        watch('pause-on-fullscreen', () => this._onFullscreenChanged());
        this._fullscreenId = global.display.connect('in-fullscreen-changed',
            () => this._onFullscreenChanged());

        this._updateMood();
        this._updateFullnessText();
        // Let the panel place the icon first, so the pet spawns under it.
        this._addTimeoutMs(500, () => {
            this._onFullscreenChanged();
            this._syncPet();
            return GLib.SOURCE_REMOVE;
        });

        this.connect('destroy', () => this._cleanup());
    }

    // Middle click pokes without opening the menu. PanelMenu.Button
    // toggles its menu from vfunc_event() on ANY button press, before a
    // 'button-press-event' handler would run, so intercept it here.
    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === Clutter.BUTTON_MIDDLE) {
            this._poke();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }

    // ── Drag and drop ────────────────────────────────────────────────────
    //
    // GNOME Shell 48 has two separate DND paths (see ui/dnd.js and
    // ui/xdndHandler.js):
    //
    //  * Shell-internal drags (app icons from the dash / app grid, windows
    //    in the overview) walk up from the actor under the pointer looking
    //    for `actor._delegate.handleDragOver()` and, on release,
    //    `actor._delegate.acceptDrop()`. `this._delegate = this` hooks us
    //    into that — so you can feed it an app icon.
    //
    //  * Files dragged from Nautilus (or any other client) are XDND drags.
    //    Main.xdndHandler only ever calls handleDragOver() while hovering
    //    and emits 'drag-end' when the drag finishes — acceptDrop() is
    //    NEVER called for them. So a drag monitor tracks whether the XDND
    //    pointer is over the raccoon, and 'drag-end' while it is counts as
    //    the file being dropped into its mouth.
    _setupDragAndDrop() {
        this._delegate = this;

        this._dragMonitor = {
            dragMotion: dragEvent => {
                if (dragEvent.source === Main.xdndHandler) {
                    const target = dragEvent.targetActor;
                    this._xdndHovering = !!target && this.contains(target);
                }
                return DND.DragMotionResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._dragMonitor);

        // Main.xdndHandler is created in every session mode that has a
        // panel, but be defensive rather than throw in enable().
        if (!Main.xdndHandler)
            return;
        this._xdndBeginId = Main.xdndHandler.connect('drag-begin', () => {
            this._xdndHovering = false;
        });
        this._xdndEndId = Main.xdndHandler.connect('drag-end', () => {
            if (this._xdndHovering)
                this._feed();
            this._xdndHovering = false;
        });
    }

    handleDragOver(_source, _actor, _x, _y, _time) {
        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(_source, _actor, _x, _y, _time) {
        this._feed();
        // Returning true without reparenting the drag actor makes dnd.js
        // restore/destroy it for us.
        return true;
    }

    // ── Feeding & boredom ────────────────────────────────────────────────

    _restartTicker() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._lastTickUs = GLib.get_monotonic_time();
        this._tickId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this._tickSeconds(),
            () => {
                this._onTick();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _tickSeconds() {
        return Math.max(1, this._settings.get_int('tick-seconds'));
    }

    _boredomMax() {
        return Math.max(2, this._settings.get_int('boredom-max'));
    }

    _playSound() {
        if (!this._settings.get_boolean('sound-enabled'))
            return;
        try {
            const path = this._settings.get_string('sound-file') || SOUND_FALLBACK;
            Gio.Subprocess.new(['paplay', path], Gio.SubprocessFlags.NONE);
        } catch (e) {
            // No audio backend available — not worth bothering the user about.
        }
    }

    _notify(title, body) {
        if (this._settings.get_boolean('notifications-enabled'))
            Main.notify(title, body);
    }

    // --- tracked timeouts / overlay actors ------------------------------

    _addTimeoutMs(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            const ret = fn();
            if (ret !== GLib.SOURCE_CONTINUE)
                this._sources.delete(id);
            return ret;
        });
        this._sources.add(id);
        return id;
    }

    _cancelSource(id) {
        if (id && this._sources.has(id)) {
            GLib.source_remove(id);
            this._sources.delete(id);
        }
    }

    // Every overlay gets a JS-side `_gone` flag. Timers and ease callbacks
    // check that instead of asking the actor, because touching a disposed
    // actor (even get_stage()) logs a warning with a stack trace.
    _addOverlay(actor) {
        this._overlays.add(actor);
        actor._gone = false;
        actor.connect('destroy', () => {
            actor._gone = true;
            this._overlays.delete(actor);
        });
        Main.layoutManager.uiGroup.add_child(actor);
        return actor;
    }

    // ── Feeding, poking & boredom ────────────────────────────────────────

    _feed() {
        // Food ends a tantrum immediately.
        if (this._feralFaceId) {
            GLib.source_remove(this._feralFaceId);
            this._feralFaceId = 0;
        }
        this._stopActiveMischief();
        this._boredom = 0;
        this._fullness = 100;
        this._updateFullnessText();
        this._pet?.feed();
        this._updateMood();
        this._playSound();
        this._bounce();
        this._sparkle();
        this._say(pickOne(FEED_QUIPS), 1600);
    }

    _poke() {
        // Annoys it faster than neglect, but stops one short of the max so
        // a poke alone never triggers the tantrum.
        const bump = this._settings.get_int('poke-bump');
        this._boredom = Math.min(this._boredom + bump, this._boredomMax() - 1);
        // The poke quip below covers it; skip the mood-escalation nag.
        this._updateMood({skipNag: true});
        this._wiggle();
        this._playSound();
        this._say(pickOne(POKE_QUIPS), 1200);
    }

    _onTick() {
        this._lastTickUs = GLib.get_monotonic_time();
        // Installing an OS is the one thing it will sit still for. Boredom
        // is held where it is, so nothing fires the moment the window closes.
        if (installerIsOpen()) {
            if (!this._supervising) {
                this._supervising = true;
                this._say('Supervising. Carry on.', 2400);
            }
            return;
        }
        this._supervising = false;
        // In its room, or you are fullscreen: everything holds still.
        if (this._roomUntilUs || this._fullscreen)
            return;
        // Hunger drains on the same tick; a starving raccoon bores twice as fast.
        if (this._settings.get_boolean('hunger-enabled')) {
            const minutes = Math.max(1, this._settings.get_int('hunger-minutes'));
            this._fullness = Math.max(0, this._fullness - 100 * this._tickSeconds() / (minutes * 60));
            this._updateFullnessText();
        }
        this._boredom += this._fullnessPct() <= 0 ? 2 : 1;

        if (this._boredom >= this._boredomMax()) {
            this._boredom = 0;
            this._lastMoodLabel = null;
            this._goFeral();
        } else {
            this._updateMood();
        }
    }

    _secondsUntilFeral() {
        // Feral fires on the tick where boredom reaches boredom-max: that is
        // (max - boredom - 1) whole ticks after the next one.
        const tick = this._tickSeconds();
        const sinceTick = (GLib.get_monotonic_time() - this._lastTickUs) / 1e6;
        const untilNextTick = Math.max(0, tick - sinceTick);
        return Math.max(0, this._boredomMax() - this._boredom - 1) * tick + untilNextTick;
    }

    _currentMood() {
        const pct = Math.min(100, Math.round((this._boredom / this._boredomMax()) * 100));
        let mood = MOODS[0];
        for (const m of MOODS) {
            if (pct >= m.at)
                mood = m;
        }
        return {mood, pct};
    }

    _updateMood({skipNag = false} = {}) {
        const {mood} = this._currentMood();
        // Don't overwrite the 😈 face while a tantrum is in progress.
        if (!this._feralFaceId && !this._verdictFaceId)
            this._label.text = mood.icon;
        this._updateStatusText();

        // Nag once when it steps into a worse mood, not on every tick.
        if (mood.label !== this._lastMoodLabel) {
            const wasIdx = MOODS.findIndex(m => m.label === this._lastMoodLabel);
            const isIdx = MOODS.indexOf(mood);
            if (!skipNag && isIdx > wasIdx && mood.label !== 'content' &&
                this._settings.get_boolean('nag-enabled'))
                this._say(pickOne(NAG_QUIPS[mood.label]), 1800);
            // Furious and armed: sometimes it doesn't wait for the tantrum.
            if (!skipNag && isIdx > wasIdx && mood.label === 'furious' &&
                this._pet?.isOut && this._cursorTheftAllowed() && Math.random() < 0.3)
                this._mischiefStealCursor();
            this._lastMoodLabel = mood.label;
        }
    }

    _updateStatusText() {
        const {mood, pct} = this._currentMood();
        const eta = formatDuration(this._secondsUntilFeral());
        if (this._roomUntilUs) {
            const left = formatDuration((this._roomUntilUs - GLib.get_monotonic_time()) / 1e6);
            this._statusItem.label.text = `Boredom: ${mood.label} ${pct}% · in its room for ${left}`;
        } else {
            this._statusItem.label.text = `Boredom: ${mood.label} ${pct}% · feral in ${eta}`;
        }
    }

    _startMenuRefresh() {
        this._updateStatusText();
        if (this._menuRefreshId)
            return;
        this._menuRefreshId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 1,
            () => {
                this._updateStatusText();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _stopMenuRefresh() {
        if (this._menuRefreshId) {
            GLib.source_remove(this._menuRefreshId);
            this._menuRefreshId = 0;
        }
    }

    // ── Tantrums ─────────────────────────────────────────────────────────
    //
    // When the raccoon snaps it does something REAL and annoying, and then
    // tells you exactly what it did. The mischief pool mixes:
    //   * in-shell Clutter chaos (drag your real cursor around, mash real
    //     keystrokes into the focused window) — no root needed, works on
    //     Wayland because we are inside the compositor; and
    //   * real root actions via sloppinux-exec (stash one of your files,
    //     rename the host, scramble the accent colour, leave a note) — the
    //     exact command is surfaced in the notification and the menu.

    _goFeral() {
        if (this._feralFaceId)
            GLib.source_remove(this._feralFaceId);

        this._label.text = '😈';
        this._feralFaceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, FERAL_FACE_SECONDS,
            () => {
                this._feralFaceId = 0;
                this._updateMood();
                return GLib.SOURCE_REMOVE;
            });
        this._updateStatusText();

        // Cosmetic layer, always: a spin, one big on-screen shenanigan from
        // the enabled set, and maybe a typing bubble.
        this._spin();
        const bigOnes = [];
        if (this._settings.get_boolean('shake-enabled'))
            bigOnes.push(() => this._screenShake());
        if (this._settings.get_boolean('flash-enabled'))
            bigOnes.push(() => this._colorFlash());
        // The emoji stand-ins only perform while the real raccoon is not
        // out on the desktop; two of them at once gives the game away.
        const petOut = this._pet?.isOut ?? false;
        if (!petOut && this._settings.get_boolean('walk-enabled'))
            bigOnes.push(() => this._walkAcrossScreen());
        if (!petOut && this._settings.get_boolean('chase-enabled'))
            bigOnes.push(() => this._chaseCursor());
        if (bigOnes.length > 0)
            pickOne(bigOnes)();

        if (this._settings.get_boolean('typing-enabled') &&
            Math.random() < this._settings.get_double('typing-chance'))
            this._say(pickOne(TYPING_SNIPPETS), 1600, {typewriter: true});

        // Feral layer: one REAL action, if armed (it is, by default).
        if (this._settings.get_boolean('feral-mode') &&
            Math.random() < this._settings.get_double('feral-chance'))
            this._doMischief();
        else
            this._report(pickOne(TANTRUMS));
    }

    // Pick one allowed real mischief at random and run it. Each handler is
    // responsible for calling _report() with a human headline and, where
    // relevant, the exact command string it executed.
    _doMischief() {
        const allow = key => this._settings.get_boolean(key);
        const pool = [];
        if (allow('allow-input-chaos')) {
            pool.push(() => this._mischiefDragCursor());
            pool.push(() => this._mischiefMashKeyboard());
            if (allow('cursor-theft-enabled'))
                pool.push(() => this._mischiefStealCursor());
        }
        if (allow('allow-root')) {
            pool.push(() => this._mischiefStashFile());
            pool.push(() => this._mischiefRenameHost());
        }
        if (allow('allow-desktop-file'))
            pool.push(() => this._mischiefScrawlNote());
        if (allow('allow-gsettings-pranks'))
            pool.push(() => this._mischiefGsettingsPrank());
        if (allow('allow-launch-app'))
            pool.push(() => this._mischiefOpenUrl());
        if (allow('allow-shell-out'))
            pool.push(() => this._mischiefShellOut());

        if (pool.length === 0) {
            this._mischiefCosmetic();
            return;
        }
        this._say(pickOne(FERAL_QUIPS), 1800);
        const fallback = e => {
            logError(e, 'raccoon: mischief failed, falling back to cosmetic');
            if (!this._destroyed)
                this._mischiefCosmetic();
        };
        try {
            // Root handlers are async; catch their rejections too.
            Promise.resolve(pickOne(pool)()).catch(fallback);
        } catch (e) {
            fallback(e);
        }
    }

    // Record what the raccoon just did: notify, update the menu line, and
    // make a noise. `command` (optional) is shown verbatim — it is the real
    // root command that ran.
    _report(headline, command = null, result = null) {
        if (this._destroyed)
            return;
        const menuBits = [headline];
        if (command)
            menuBits.push(`$ ${command}`);
        if (result)
            menuBits.push(result);
        this._mischiefItem.label.text = `Last mischief: ${menuBits.join('\n')}`;

        const body = command
            ? `${headline}\nRan as root: ${command}`
            : headline;
        this._notify('The raccoon got bored.', body);
        this._playSound();
    }

    // Run a root command without blocking the shell, report it verbatim,
    // and resolve to {ok, output}. Centralises the "show exactly what it
    // did" contract.
    async _rootMischief(headline, commandString) {
        const res = await rootRun(commandString, this._cancellable);
        const resultLine = res.ok
            ? (res.output ? res.output.split('\n')[0] : '[ok]')
            : `[failed] ${res.output.split('\n')[0] || ''}`;
        this._report(headline, commandString, resultLine);
        return res;
    }

    // --- in-shell chaos -------------------------------------------------

    _getVirtualPointer() {
        if (this._virtualPointer)
            return this._virtualPointer;
        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._virtualPointer = seat.create_virtual_device(
                Clutter.InputDeviceType.POINTER_DEVICE);
        } catch (e) {
            logError(e, 'raccoon: no virtual pointer');
            this._virtualPointer = null;
        }
        return this._virtualPointer;
    }

    _getVirtualKeyboard() {
        if (this._virtualKeyboard)
            return this._virtualKeyboard;
        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._virtualKeyboard = seat.create_virtual_device(
                Clutter.InputDeviceType.KEYBOARD_DEVICE);
        } catch (e) {
            logError(e, 'raccoon: no virtual keyboard');
            this._virtualKeyboard = null;
        }
        return this._virtualKeyboard;
    }

    // Grab your actual pointer and yank it around the screen for a couple
    // of seconds. This moves the REAL cursor (virtual pointer device at the
    // compositor level), it is not a decorative actor.
    _mischiefDragCursor() {
        const pointer = this._getVirtualPointer();
        if (!pointer) {
            this._mischiefCosmetic();
            return;
        }
        const monitor = Main.layoutManager.primaryMonitor;
        this._report('It grabbed your cursor and ran off with it.');

        let step = 0;
        const steps = 36;
        const t0 = GLib.get_monotonic_time();
        if (this._dragId)
            GLib.source_remove(this._dragId);
        this._dragId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            step += 1;
            // A wandering Lissajous path across the monitor.
            const p = step / steps;
            const x = monitor.x + monitor.width * (0.5 + 0.42 * Math.sin(p * Math.PI * 6));
            const y = monitor.y + monitor.height * (0.5 + 0.42 * Math.sin(p * Math.PI * 8 + 1));
            const now = (GLib.get_monotonic_time() - t0) / 1000;
            try {
                pointer.notify_absolute_motion(now * 1000, x, y);
            } catch (e) {
                // Device went away — stop.
                this._dragId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (step >= steps) {
                this._dragId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Mash a bit of gibberish into whatever window currently has keyboard
    // focus. Real keystrokes via the virtual keyboard device.
    _mischiefMashKeyboard() {
        const kbd = this._getVirtualKeyboard();
        if (!kbd) {
            this._mischiefCosmetic();
            return;
        }
        const junk = pickOne(KEYBOARD_JUNK);
        this._report(`It typed "${junk.trim()}" into whatever you had open.`);

        const chars = [...junk];
        let i = 0;
        if (this._typeId)
            GLib.source_remove(this._typeId);
        this._typeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 90, () => {
            if (i >= chars.length) {
                this._typeId = 0;
                return GLib.SOURCE_REMOVE;
            }
            const cp = chars[i++].codePointAt(0);
            try {
                kbd.notify_keyval(
                    GLib.get_monotonic_time(),
                    Clutter.unicode_to_keysym(cp),
                    Clutter.KeyState.PRESSED);
                kbd.notify_keyval(
                    GLib.get_monotonic_time(),
                    Clutter.unicode_to_keysym(cp),
                    Clutter.KeyState.RELEASED);
            } catch (e) {
                this._typeId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // --- real root mischief --------------------------------------------

    // Hide one of your files in ~/.raccoon-stash/. Shows the exact mv. Does
    // NOT auto-restore — the "Give it back" menu item does that. Only ever
    // touches a plain file directly in ~/Desktop or ~/Documents, never a
    // dotfile, never a directory, never recurses.
    async _mischiefStashFile() {
        const home = GLib.get_home_dir();
        const candidates = [];
        for (const sub of ['Desktop', 'Documents']) {
            const dir = Gio.File.new_for_path(GLib.build_filenamev([home, sub]));
            let e;
            try {
                e = dir.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE, null);
            } catch (err) {
                continue;
            }
            let info;
            while ((info = e.next_file(null)) !== null) {
                const name = info.get_name();
                if (name.startsWith('.'))
                    continue;
                if (info.get_file_type() !== Gio.FileType.REGULAR)
                    continue;
                candidates.push(GLib.build_filenamev([home, sub, name]));
            }
            e.close(null);
        }
        if (candidates.length === 0) {
            // Nothing safe to take — don't go rummaging deeper, just grumble.
            this._mischiefCosmetic();
            return;
        }
        const from = pickOne(candidates);
        const name = GLib.path_get_basename(from);
        const stashDir = GLib.build_filenamev([home, '.raccoon-stash']);
        const to = GLib.build_filenamev([stashDir, name]);

        // The stash dir is created as YOU (not root) so you can rm it
        // without sudo. Then root moves the file in and hands it back to
        // you with chown, so nothing in there ends up root-owned. Single
        // command so the report shows the real thing that ran.
        ensureUserDir(stashDir);
        const owner = homeOwner();
        let cmd = `mv -n ${shellQuote(from)} ${shellQuote(to)}`;
        if (owner)
            cmd += ` && chown ${owner} ${shellQuote(to)}`;
        const res = await this._rootMischief(`It stole ${name}.`, cmd);
        if (res.ok && !this._destroyed) {
            this._stash.push({from, to, name});
            this._refreshGiveBack();
        }
    }

    // Rename the host to something trash-themed. Reversible from the menu
    // isn't offered (hostnames rarely matter on a live box) but the old
    // name is shown so you can put it back.
    async _mischiefRenameHost() {
        const names = ['trash-panda', 'dumpster-diver', 'snack-bandit', 'mr-stripes'];
        const newName = pickOne(names);
        const old = GLib.get_host_name();
        await this._rootMischief(
            `It renamed your computer (was "${old}").`,
            `hostnamectl set-hostname ${shellQuote(newName)}`);
    }

    // Flip a GNOME setting (accent colour, text scale, night light, cursor
    // size) in-process, remember the original, and put it back after
    // auto-revert-seconds. Pending reverts are forced on disable.
    _mischiefGsettingsPrank() {
        const source = Gio.SettingsSchemaSource.get_default();
        const usable = GSETTINGS_PRANKS.filter(p =>
            source?.lookup(p.schema, true)?.has_key(p.key));
        if (usable.length === 0) {
            this._mischiefCosmetic();
            return;
        }
        const prank = pickOne(usable);
        const settings = new Gio.Settings({schema_id: prank.schema});
        const mapKey = `${prank.schema} ${prank.key}`;
        const existing = this._pendingReverts.get(mapKey);
        // Repeated pranks on one key restore the TRUE original value.
        const original = existing ? existing.value : settings.get_value(prank.key);
        const variant = new GLib.Variant(original.get_type_string(), prank.value());
        const valueText = variant.print(false);
        settings.set_value(prank.key, variant);
        if (existing)
            this._cancelSource(existing.sourceId);

        const delay = this._settings.get_int('auto-revert-seconds');
        const sourceId = this._addTimeoutMs(delay * 1000, () => {
            settings.set_value(prank.key, original);
            this._pendingReverts.delete(mapKey);
            return GLib.SOURCE_REMOVE;
        });
        this._pendingReverts.set(mapKey, {settings, key: prank.key, value: original, sourceId});
        this._report(
            `It messed with your ${prank.label} (was ${original.print(false)}). It wears off in ${delay}s.`,
            `gsettings set ${prank.schema} ${prank.key} ${valueText}`);
    }

    _flushPendingReverts() {
        for (const entry of this._pendingReverts.values()) {
            this._cancelSource(entry.sourceId);
            try {
                entry.settings.set_value(entry.key, entry.value);
            } catch (e) {
                logError(e, 'raccoon: failed to revert gsettings prank');
            }
        }
        this._pendingReverts.clear();
    }

    // Leave a note on the Desktop: a fresh, uniquely named file, so nothing
    // is overwritten. With allow-root it is written by root (the joke) and
    // then chowned back to you; otherwise it is simply written as you.
    async _mischiefScrawlNote() {
        const desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ||
            GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
        ensureUserDir(desktop);
        const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
        const note = pickOne(DESKTOP_NOTES);
        let path = null;
        for (let n = 0; n < 50 && !path; n++) {
            const candidate = GLib.build_filenamev([desktop,
                `RACCOON-WAS-HERE-${stamp}${n ? `-${n}` : ''}.txt`]);
            if (!GLib.file_test(candidate, GLib.FileTest.EXISTS))
                path = candidate;
        }
        if (!path) {
            this._mischiefCosmetic();
            return;
        }
        const owner = homeOwner();
        if (this._settings.get_boolean('allow-root') && owner) {
            // set -C (noclobber): never overwrite, even if the name raced.
            const cmd = `set -C && printf '%s' ${shellQuote(note)} > ${shellQuote(path)} && chown ${owner} ${shellQuote(path)}`;
            await this._rootMischief('It left a note on your Desktop.', cmd);
            return;
        }
        // create() is exclusive: throws instead of truncating.
        const stream = Gio.File.new_for_path(path).create(Gio.FileCreateFlags.NONE, null);
        stream.write_all(new TextEncoder().encode(note), null);
        stream.close(null);
        this._report(`It left a note on your Desktop (${GLib.path_get_basename(path)}).`);
    }

    // Open some light reading in the default browser.
    _mischiefOpenUrl() {
        const url = pickOne(FERAL_URLS);
        Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        this._report(`It opened ${url} for you. Educational.`);
    }

    // The loudest tier: a VISIBLE terminal, running the `ai` agent (root
    // on Sloppinux) if allow-ai is on. Every arg is its own argv element.
    _mischiefShellOut() {
        const has = bin => GLib.find_program_in_path(bin) !== null;
        const terminals = [
            {bin: 'gnome-terminal', args: t => ['gnome-terminal', '--', ...t]},
            {bin: 'kgx', args: t => ['kgx', '--', ...t]},
            {bin: 'xterm', args: t => ['xterm', '-e', ...t]},
        ];
        const term = terminals.find(t => has(t.bin));
        const useAi = this._settings.get_boolean('allow-ai') && has('ai');
        let argv;
        if (useAi) {
            const job = ['ai', pickOne(CHAOS_PROMPTS)];
            argv = term ? term.args(job) : job;
        } else if (term) {
            argv = term.args(['bash', '-c',
                'echo "🦝 The raccoon was here. Feed it next time."; read -r -p "(Enter to close) "']);
        } else {
            this._mischiefCosmetic();
            return;
        }
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        this._report(useAi
            ? 'It grabbed a terminal and is improvising with the `ai` agent (as root).'
            : 'It popped open a terminal just to say hi.');
    }

    // Pure cosmetic fallback for when a real action can't proceed.
    _mischiefCosmetic() {
        this._report('It knocked something over. Feed it next time.');
        this._screenShake();
        this._colorFlash();
    }

    // --- give it back ---------------------------------------------------

    _refreshGiveBack() {
        const n = this._stash.length;
        this._giveBackItem.visible = n > 0;
        if (n > 0)
            this._giveBackItem.label.text = `Give it back 🦝 (${n} hidden)`;
    }

    // Restore the most recently stashed file to where it came from (as
    // root, since the raccoon took it as root), newest first.
    async _giveBack() {
        const entry = this._stash.pop();
        if (!entry) {
            this._refreshGiveBack();
            return;
        }
        const cmd = `mv -n ${shellQuote(entry.to)} ${shellQuote(entry.from)}`;
        const res = await rootRun(cmd, this._cancellable);
        if (this._destroyed)
            return;
        if (res.ok) {
            this._notify('The raccoon relented.', `Put ${entry.name} back.\n$ ${cmd}`);
        } else {
            // Couldn't move it back — keep it on the list so the user can
            // retry, and tell them where it is.
            this._stash.push(entry);
            this._notify('The raccoon refused.',
                `${entry.name} is still in ~/.raccoon-stash/.\n$ ${cmd}`);
        }
        this._refreshGiveBack();
        this._playSound();
    }

    _screenShake() {
        const actor = Main.layoutManager.uiGroup;
        if (!this._shakeOrigin)
            this._shakeOrigin = [actor.x, actor.y];
        const [origX, origY] = this._shakeOrigin;
        const offsets = [[-12, 0], [12, 0], [-8, 0], [8, 0], [-4, 0], [0, 0]];
        let i = 0;
        const step = () => {
            if (!this._shakeOrigin)
                return; // cleaned up mid-shake
            if (i >= offsets.length) {
                actor.set_position(origX, origY);
                this._shakeOrigin = null;
                return;
            }
            const [dx, dy] = offsets[i++];
            actor.ease({
                x: origX + dx, y: origY + dy,
                duration: 40,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: step,
            });
        };
        step();
    }

    _colorFlash() {
        this._flashOverlay?.destroy();

        const colors = this._settings.get_string('flash-colors')
            .split(',').map(c => c.trim()).filter(c => c.length > 0);
        const color = colors.length > 0 ? pickOne(colors) : '#ff5f5f';
        const monitor = Main.layoutManager.primaryMonitor;
        const overlay = new St.Widget({
            style: `background-color: ${color};`,
            opacity: 0,
            x: monitor.x, y: monitor.y,
            width: monitor.width, height: monitor.height,
            reactive: false,
        });
        this._flashOverlay = overlay;
        overlay.connect('destroy', () => {
            if (this._flashOverlay === overlay)
                this._flashOverlay = null;
        });
        Main.layoutManager.uiGroup.add_child(overlay);
        overlay.ease({
            opacity: 90,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                overlay.ease({
                    opacity: 0,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => overlay.destroy(),
                });
            },
        });
    }

    // --- panel-icon animations & overlays --------------------------------

    _bounce() {
        this.remove_all_transitions();
        this.set_pivot_point(0.5, 0.5);
        this.ease({
            scale_x: 1.4, scale_y: 1.4,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.ease({
                    scale_x: 1, scale_y: 1,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                });
            },
        });
    }

    _wiggle() {
        this.remove_all_transitions();
        this.set_pivot_point(0.5, 0.5);
        this.rotation_angle_z = 0;
        this.ease({
            rotation_angle_z: -15, duration: 60, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.ease({
                rotation_angle_z: 15, duration: 100, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => this.ease({
                    rotation_angle_z: 0, duration: 60, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                }),
            }),
        });
    }

    _spin() {
        this.remove_all_transitions();
        this.set_pivot_point(0.5, 0.5);
        this.rotation_angle_z = 0;
        this.ease({
            rotation_angle_z: 360, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
            onComplete: () => {
                this.rotation_angle_z = 0;
            },
        });
    }

    // Little sparkles drifting up from the icon when fed.
    _sparkle() {
        const [bx, by] = this.get_transformed_position();
        ['✨', '💚', '✨'].forEach((glyph, i) => {
            const spark = this._addOverlay(new St.Label({
                text: glyph, style_class: 'raccoon-spark', opacity: 0,
            }));
            spark.set_position(bx + this.width / 2 - 8 + (i - 1) * 14, by - 4);
            spark.ease({
                opacity: 255, y: spark.y - 26, duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => spark.ease({
                    opacity: 0, y: spark.y - 14, duration: 400,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => spark.destroy(),
                }),
            });
        });
    }

    // A speech bubble: our own label, never sent anywhere. Defaults to
    // just below the panel icon; pass x/y to anchor it elsewhere.
    _say(text, holdMs = 1400, {typewriter = false, x, y} = {}) {
        if (this._destroyed)
            return;
        const bubble = this._addOverlay(new St.Label({
            text: typewriter ? '' : text, style_class: 'raccoon-bubble', opacity: 0,
        }));
        if (x === undefined || y === undefined) {
            // Above the desktop pet when it is out, else under the icon.
            const anchor = this._pet?.bubbleAnchor();
            if (anchor) {
                [x, y] = anchor;
            } else {
                const [bx, by] = this.get_transformed_position();
                x = bx - 20;
                y = by + this.height + 6;
            }
        }
        bubble.set_position(x, y);
        bubble.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        const finish = () => this._addTimeoutMs(holdMs, () => {
            if (!bubble._gone) {
                bubble.ease({
                    opacity: 0, duration: 250, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => bubble.destroy(),
                });
            }
            return GLib.SOURCE_REMOVE;
        });
        if (!typewriter) {
            finish();
            return;
        }
        const chars = [...text];
        let i = 0;
        this._addTimeoutMs(70, () => {
            if (bubble._gone)
                return GLib.SOURCE_REMOVE;
            bubble.text = chars.slice(0, ++i).join('');
            if (i >= chars.length) {
                finish();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Waddles across the bottom of the screen and off the other side.
    _walkAcrossScreen() {
        const monitor = Main.layoutManager.primaryMonitor;
        const goingRight = Math.random() < 0.5;
        const walker = this._addOverlay(new St.Label({text: '🦝', style_class: 'raccoon-walker'}));
        walker.set_pivot_point(0.5, 0.5);
        // The 🦝 glyph faces left, so flip it when heading right.
        walker.scale_x = goingRight ? -1 : 1;
        const left = monitor.x - 40, right = monitor.x + monitor.width + 40;
        walker.set_position(goingRight ? left : right, monitor.y + monitor.height - 42);
        const targetX = goingRight ? right : left;
        walker.ease({
            x: targetX,
            duration: Math.abs(targetX - walker.x) * 10,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => walker.destroy(),
        });
        this._waddle(walker);
    }

    _waddle(actor) {
        if (actor._gone)
            return;
        // Animate translation_y, not y, so the bob doesn't fight the
        // x ease running on the same actor.
        actor.ease({
            translation_y: -5, duration: 140, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: () => {
                if (actor._gone)
                    return;
                actor.ease({
                    translation_y: 0, duration: 140, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                    onComplete: () => this._waddle(actor),
                });
            },
        });
    }

    // A decoy raccoon scurries toward wherever your cursor is right now,
    // re-aiming every frame. Cosmetic: it never moves the real pointer
    // (that is _mischiefDragCursor's job).
    _chaseCursor() {
        const [sx, sy] = this.get_transformed_position();
        const raider = this._addOverlay(new St.Label({text: '🦝', style_class: 'raccoon-walker'}));
        raider.set_pivot_point(0.5, 0.5);
        raider.set_position(sx, sy);

        const SPEED = 1400; // px/sec
        const CATCH_DIST = 16;
        const started = GLib.get_monotonic_time();
        let lastTick = started;
        this._addTimeoutMs(16, () => {
            if (raider._gone)
                return GLib.SOURCE_REMOVE;
            const now = GLib.get_monotonic_time();
            const dt = (now - lastTick) / 1e6;
            lastTick = now;
            const [px, py] = global.get_pointer();
            const [rx, ry] = raider.get_position();
            const dx = px - 12 - rx, dy = py - 12 - ry;
            const dist = Math.hypot(dx, dy);
            // Give up after 10s if you keep dodging.
            if (dist <= CATCH_DIST || now - started > 10e6) {
                this._catchCursor(raider, px, py);
                return GLib.SOURCE_REMOVE;
            }
            raider.scale_x = dx < 0 ? 1 : -1;
            const step = Math.min(dist, SPEED * dt);
            raider.set_position(rx + (dx / dist) * step, ry + (dy / dist) * step);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _catchCursor(raider, px, py) {
        this._playSound();
        const burst = this._addOverlay(new St.Widget({style_class: 'raccoon-burst', width: 24, height: 24}));
        burst.set_pivot_point(0.5, 0.5);
        burst.set_position(px - 12, py - 12);
        burst.scale_x = burst.scale_y = 0.3;
        burst.ease({
            scale_x: 2.4, scale_y: 2.4, opacity: 0, duration: 350,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => burst.destroy(),
        });
        this._say(pickOne(CATCH_QUIPS), 1000, {x: px - 20, y: py - 34});
        raider.ease({
            opacity: 0, duration: 500, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => raider.destroy(),
        });
    }

    _stopActiveMischief() {
        this._pet?.stopCursorTheft();
        if (this._dragId) {
            GLib.source_remove(this._dragId);
            this._dragId = 0;
        }
        if (this._typeId) {
            GLib.source_remove(this._typeId);
            this._typeId = 0;
        }
    }

    // ── Desktop pet host ─────────────────────────────────────────────────
    //
    // pet.js owns the raccoon's body; everything else (boredom, hunger,
    // bubbles, the virtual pointer, stand-down rules) stays here.

    _syncPet() {
        const want = this._settings.get_boolean('roam-enabled');
        if (!want || this._destroyed) {
            this._pet?.destroy();
            this._pet = null;
            return;
        }
        if (this._pet)
            return;
        try {
            this._pet = new RaccoonPet(this, this._extensionPath);
        } catch (e) {
            logError(e, 'raccoon: desktop pet failed to start, staying in the panel');
            this._pet = null;
            return;
        }
        this._pet.setSuspended(this._fullscreen);
        if (this._roomUntilUs)
            this._pet.goHome();
    }

    _onFullscreenChanged() {
        this._fullscreen = this._settings.get_boolean('pause-on-fullscreen') &&
            !!global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
        if (this._fullscreen)
            this._stopActiveMischief();
        this._pet?.setSuspended(this._fullscreen);
    }

    _toggleRoom() {
        if (this._roomUntilUs) {
            this._letOut();
            return;
        }
        const minutes = Math.max(1, this._settings.get_int('room-minutes'));
        this._stopActiveMischief();
        this._roomUntilUs = GLib.get_monotonic_time() + minutes * 60e6;
        this._roomId = this._addTimeoutMs(minutes * 60000, () => {
            this._roomId = 0;
            this._letOut();
            return GLib.SOURCE_REMOVE;
        });
        this._roomItem.label.text = 'Let it out';
        this._say('Fine. I will be in my room. Sulking.', 1800);
        this._pet?.goHome();
        this._updateStatusText();
    }

    _letOut() {
        this._cancelSource(this._roomId);
        this._roomId = 0;
        this._roomUntilUs = 0;
        this._lastTickUs = GLib.get_monotonic_time();
        this._roomItem.label.text = 'Go to your room';
        this._pet?.letOut();
        this._say('I\'m back. Did you miss me?', 1600);
        this._updateStatusText();
    }

    _updateFullnessText() {
        const on = this._settings.get_boolean('hunger-enabled');
        this._fullnessItem.visible = on;
        if (!on)
            return;
        const pct = Math.round(this._fullness);
        const filled = Math.round(pct / 20);
        this._fullnessItem.label.text =
            `Fullness ${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)} ${pct}%`;
    }

    _fullnessPct() {
        return this._settings.get_boolean('hunger-enabled') ? this._fullness : 100;
    }

    _petStandDown() {
        return installerIsOpen();
    }

    _petThrowEnabled() {
        return this._settings.get_boolean('pet-throw-enabled') && !installerIsOpen();
    }

    // One second of petting takes the edge off.
    _petted() {
        if (this._boredom > 0) {
            this._boredom -= 1;
            this._updateMood({skipNag: true});
        }
    }

    _bumpBoredom(n) {
        this._boredom = Math.min(this._boredom + n, this._boredomMax() - 1);
        this._updateMood({skipNag: true});
    }

    _cursorTheftAllowed() {
        return this._settings.get_boolean('feral-mode') &&
            this._settings.get_boolean('allow-input-chaos') &&
            this._settings.get_boolean('cursor-theft-enabled') &&
            !this._roomUntilUs && !this._fullscreen && !installerIsOpen();
    }

    // Real mischief: the pet walks up, takes the actual pointer and runs.
    // Without a pet or a virtual pointer it degrades to the cosmetic chase.
    _mischiefStealCursor() {
        const seconds = this._settings.get_int('cursor-theft-seconds');
        if (this._pet?.startCursorTheft(seconds)) {
            this._report('It walked up, took your cursor and ran. Wiggle the mouse to fight back.');
            return;
        }
        if (!this._pet?.isOut) {
            // No pet out: the old cursor-yank is the closest thing.
            this._mischiefDragCursor();
            return;
        }
        if (!this._getVirtualPointer() && !this._loggedNoTheft) {
            this._loggedNoTheft = true;
            log('raccoon: no virtual pointer, cursor theft falls back to the cosmetic chase');
        }
        this._chaseCursor();
        this._report('It went for your cursor, but could only chase it.');
    }

    // ── OOM court ────────────────────────────────────────────────────────

    _watchVerdicts() {
        try {
            const file = Gio.File.new_for_path(VERDICT_FILE);
            this._verdictMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._verdictMonitor.connect('changed', (_m, _f, _o, event) => {
                if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    event === Gio.FileMonitorEvent.CREATED)
                    this._onVerdict();
            });
            this._onVerdict(true);
        } catch (e) {
            // No daemon, no /run dir, no problem: the menu line stays idle.
            this._verdictMonitor = null;
        }
    }

    _onVerdict(quiet = false) {
        let verdict;
        try {
            const [ok, bytes] = GLib.file_get_contents(VERDICT_FILE);
            if (!ok)
                return;
            verdict = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            return;
        }
        const name = verdict?.name ?? 'something';
        this._mealItem.label.text = `Last meal: ${name}`;
        if (quiet || verdict?.dry_run)
            return;

        // The daemon already notified and played the sound; we just gloat.
        this._label.text = '😈';
        if (this._verdictFaceId)
            GLib.source_remove(this._verdictFaceId);
        this._verdictFaceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 6, () => {
            this._verdictFaceId = 0;
            this._updateMood();
            return GLib.SOURCE_REMOVE;
        });
        this._bounce();
    }

    // ── Teardown ─────────────────────────────────────────────────────────

    _cleanup() {
        this._destroyed = true;
        // The pet first: it dismisses its grab, stops its timer and destroys
        // its own overlays, so the sweep below never double-destroys them.
        this._pet?.destroy();
        this._pet = null;
        this._cancellable.cancel();
        // Restore pending gsettings pranks BEFORE dropping their timeouts.
        this._flushPendingReverts();
        for (const id of this._sources)
            GLib.source_remove(id);
        this._sources.clear();
        for (const actor of [...this._overlays])
            actor.destroy();
        for (const id of [this._tickChangedId, this._maxChangedId]) {
            if (id)
                this._settings.disconnect(id);
        }
        this._tickChangedId = this._maxChangedId = 0;
        for (const id of this._settingIds)
            this._settings.disconnect(id);
        this._settingIds = [];
        if (this._fullscreenId) {
            global.display.disconnect(this._fullscreenId);
            this._fullscreenId = 0;
        }
        this._roomId = 0;
        this._stopActiveMischief();
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._feralFaceId) {
            GLib.source_remove(this._feralFaceId);
            this._feralFaceId = 0;
        }
        this._stopMenuRefresh();
        if (this._verdictFaceId) {
            GLib.source_remove(this._verdictFaceId);
            this._verdictFaceId = 0;
        }
        if (this._verdictMonitor) {
            this._verdictMonitor.cancel();
            this._verdictMonitor = null;
        }

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        if (this._xdndBeginId) {
            Main.xdndHandler.disconnect(this._xdndBeginId);
            this._xdndBeginId = 0;
        }
        if (this._xdndEndId) {
            Main.xdndHandler.disconnect(this._xdndEndId);
            this._xdndEndId = 0;
        }
        this._delegate = null;

        this._virtualPointer = null;
        this._virtualKeyboard = null;

        // Don't leave the whole UI shifted or tinted if disabled mid-tantrum.
        if (this._shakeOrigin) {
            // Clear the origin first: removing a transition fires its
            // onComplete (step), which bails out once the origin is gone.
            const [origX, origY] = this._shakeOrigin;
            this._shakeOrigin = null;
            const actor = Main.layoutManager.uiGroup;
            actor.remove_transition('x');
            actor.remove_transition('y');
            actor.set_position(origX, origY);
        }
        this._flashOverlay?.destroy();
        this._flashOverlay = null;
    }
});

export default class RaccoonExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new RaccoonIndicator(this._settings, this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
