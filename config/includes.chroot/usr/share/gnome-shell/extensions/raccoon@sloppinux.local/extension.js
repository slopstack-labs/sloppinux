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

// How often the raccoon checks whether it has been fed.
const TICK_SECONDS = 20;
// Ticks of neglect before it snaps (~5 minutes at the default tick).
const BOREDOM_MAX = 15;
// How long the 😈 face lingers after a tantrum.
const FERAL_FACE_SECONDS = 6;

const MOODS = [
    {at: 0, icon: '🦝'},
    {at: 5, icon: '🦝'},
    {at: 9, icon: '😾'},
    {at: 12, icon: '😤'},
];

const SOUND_FILE = '/usr/share/sounds/sloppinux/stereo/pipe.oga';
// Written by sloppinux-raccoon-oomd when memory ran low and the raccoon
// ate the least interesting process. We just show off about it.
const VERDICT_FILE = '/run/sloppinux-raccoon-oomd/last-verdict.json';
const FLASH_COLORS = ['#ff5f5f', '#5fafff', '#ffd75f', '#af5fff'];

// Gibberish the raccoon mashes into whatever window has focus. Real
// keystrokes, injected through a virtual input device — this is one of
// the "annoying" tantrums. Kept to printable junk and a trailing space
// so it never, say, submits a form on its own.
const KEYBOARD_JUNK = [
    'mrrp mrrp ', 'sudo pet the raccoon ', 'asdfjkl; ', 'trash panda wuz here ',
    'where is my snack ', 'chitter chitter ', '🦝🦝🦝 ', 'nom nom nom ',
];

// Lines the raccoon scrawls onto the end of a stashed-file breadcrumb so
// you can tell what happened. Purely cosmetic text.
const RANSOM_NOTES = [
    'Your file is safe. It is just on a little adventure. — 🦝',
    'I moved something. Good luck. Feed me and maybe I help look.',
    'Finders keepers. (Menu → Give it back.)',
];

function playSound() {
    try {
        Gio.Subprocess.new(['paplay', SOUND_FILE], Gio.SubprocessFlags.NONE);
    } catch (e) {
        // No audio backend available — not worth bothering the user about.
    }
}

function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return m > 0 ? `${m}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

// Run a command AS ROOT via the setuid sloppinux-exec helper, the same
// path the `ai` agent uses, and hand back {ok, output}. The argv is a
// fixed template with at most one caller-supplied value appended as a
// SEPARATE argv element — never interpolated into the command string that
// sloppinux-exec passes to `bash -c`. For commands that must embed a path,
// we single-quote it ourselves with shellQuote() below.
function rootRun(commandString) {
    try {
        const proc = Gio.Subprocess.new(
            ['sloppinux-exec', commandString],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        const [, stdout] = proc.communicate_utf8(null, null);
        const ok = proc.get_successful();
        return {ok, output: (stdout || '').trim()};
    } catch (e) {
        logError(e, 'raccoon: sloppinux-exec failed');
        return {ok: false, output: String(e)};
    }
}

// POSIX single-quote a string so it is safe to embed in a command run
// through `bash -c`. Wraps in '...' and escapes embedded single quotes.
function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const RaccoonIndicator = GObject.registerClass(
class RaccoonIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Sloppy Raccoon', false);

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

        this._tickId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, TICK_SECONDS,
            () => {
                this._onTick();
                return GLib.SOURCE_CONTINUE;
            });

        this._updateMood();

        this.connect('destroy', () => this._cleanup());
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

    _feed() {
        // Food ends a tantrum immediately.
        if (this._feralFaceId) {
            GLib.source_remove(this._feralFaceId);
            this._feralFaceId = 0;
        }
        this._stopActiveMischief();
        this._boredom = 0;
        this._updateMood();
        playSound();
        this._bounce();
    }

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

    _onTick() {
        this._lastTickUs = GLib.get_monotonic_time();
        this._boredom += 1;

        if (this._boredom >= BOREDOM_MAX) {
            this._boredom = 0;
            this._goFeral();
        } else {
            this._updateMood();
        }
    }

    _secondsUntilFeral() {
        // Feral fires on the tick where boredom reaches BOREDOM_MAX: that is
        // (BOREDOM_MAX - boredom - 1) whole ticks after the next one.
        const sinceTick = (GLib.get_monotonic_time() - this._lastTickUs) / 1e6;
        const untilNextTick = Math.max(0, TICK_SECONDS - sinceTick);
        return (BOREDOM_MAX - this._boredom - 1) * TICK_SECONDS + untilNextTick;
    }

    _updateMood() {
        // Don't overwrite the 😈 face while a tantrum is in progress.
        if (!this._feralFaceId) {
            let icon = MOODS[0].icon;
            for (const mood of MOODS) {
                if (this._boredom >= mood.at)
                    icon = mood.icon;
            }
            this._label.text = icon;
        }
        this._updateStatusText();
    }

    _updateStatusText() {
        const pct = Math.min(100, Math.round((this._boredom / BOREDOM_MAX) * 100));
        const eta = formatDuration(this._secondsUntilFeral());
        this._statusItem.label.text = `Boredom: ${pct}% · feral in ${eta}`;
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

        this._doMischief();
    }

    // Pick one mischief at random and run it. Each handler is responsible
    // for calling _report() with a human headline and, where relevant, the
    // exact command string it executed.
    _doMischief() {
        const pool = [
            () => this._mischiefDragCursor(),
            () => this._mischiefMashKeyboard(),
            () => this._mischiefStashFile(),
            () => this._mischiefRenameHost(),
            () => this._mischiefScrambleAccent(),
            () => this._mischiefScrawlNote(),
            () => this._mischiefCosmetic(),
        ];
        const pick = pool[Math.floor(Math.random() * pool.length)];
        try {
            pick();
        } catch (e) {
            logError(e, 'raccoon: mischief failed, falling back to cosmetic');
            this._mischiefCosmetic();
        }
    }

    // Record what the raccoon just did: notify, update the menu line, and
    // make a noise. `command` (optional) is shown verbatim — it is the real
    // root command that ran.
    _report(headline, command = null, result = null) {
        const menuBits = [headline];
        if (command)
            menuBits.push(`$ ${command}`);
        if (result)
            menuBits.push(result);
        this._mischiefItem.label.text = `Last mischief: ${menuBits.join('\n')}`;

        const body = command
            ? `${headline}\nRan as root: ${command}`
            : headline;
        Main.notify('The raccoon got bored.', body);
        playSound();
    }

    // Build and run a root command, report it verbatim, and return the
    // {ok, output}. Centralises the "show exactly what it did" contract.
    _rootMischief(headline, commandString) {
        const res = rootRun(commandString);
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
        const junk = KEYBOARD_JUNK[Math.floor(Math.random() * KEYBOARD_JUNK.length)];
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
    _mischiefStashFile() {
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
        const from = candidates[Math.floor(Math.random() * candidates.length)];
        const name = GLib.path_get_basename(from);
        const stashDir = GLib.build_filenamev([home, '.raccoon-stash']);
        const to = GLib.build_filenamev([stashDir, name]);

        // mkdir -p the stash, then mv the file in. Single command so the
        // report shows the real thing that ran.
        const cmd = `mkdir -p ${shellQuote(stashDir)} && mv -n ${shellQuote(from)} ${shellQuote(to)}`;
        const res = this._rootMischief(`It stole ${name}.`, cmd);
        if (res.ok) {
            this._stash.push({from, to, name});
            this._refreshGiveBack();
        }
    }

    // Rename the host to something trash-themed. Reversible from the menu
    // isn't offered (hostnames rarely matter on a live box) but the old
    // name is shown so you can put it back.
    _mischiefRenameHost() {
        const names = ['trash-panda', 'dumpster-diver', 'snack-bandit', 'mr-stripes'];
        const newName = names[Math.floor(Math.random() * names.length)];
        const old = GLib.get_host_name();
        this._rootMischief(
            `It renamed your computer (was "${old}").`,
            `hostnamectl set-hostname ${shellQuote(newName)}`);
    }

    // Flip the GNOME accent colour to something loud. gsettings for the live
    // user, run as that user is overkill — accent-color is a per-user key, so
    // we set it directly in-process, no root needed, and report it.
    _mischiefScrambleAccent() {
        const colors = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'slate'];
        const pick = colors[Math.floor(Math.random() * colors.length)];
        try {
            const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            const before = settings.get_string('accent-color');
            settings.set_string('accent-color', pick);
            this._report(
                `It repainted your desktop ${pick} (was ${before}).`,
                `gsettings set org.gnome.desktop.interface accent-color ${pick}`,
                '[ok]');
        } catch (e) {
            this._mischiefCosmetic();
        }
    }

    // Leave a ransom note on the Desktop — a real file, root-owned, in a
    // uniquely named path so nothing is overwritten.
    _mischiefScrawlNote() {
        const home = GLib.get_home_dir();
        const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
        const path = GLib.build_filenamev([home, 'Desktop', `RACCOON-WAS-HERE-${stamp}.txt`]);
        const note = RANSOM_NOTES[Math.floor(Math.random() * RANSOM_NOTES.length)];
        const cmd = `mkdir -p ${shellQuote(GLib.build_filenamev([home, 'Desktop']))} && printf %s\\\\n ${shellQuote(note)} > ${shellQuote(path)}`;
        this._rootMischief('It left a note on your Desktop.', cmd);
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
    _giveBack() {
        const entry = this._stash.pop();
        if (!entry) {
            this._refreshGiveBack();
            return;
        }
        const cmd = `mv -n ${shellQuote(entry.to)} ${shellQuote(entry.from)}`;
        const res = rootRun(cmd);
        if (res.ok) {
            Main.notify('The raccoon relented.', `Put ${entry.name} back.\n$ ${cmd}`);
        } else {
            // Couldn't move it back — keep it on the list so the user can
            // retry, and tell them where it is.
            this._stash.push(entry);
            Main.notify('The raccoon refused.',
                `${entry.name} is still in ~/.raccoon-stash/.\n$ ${cmd}`);
        }
        this._refreshGiveBack();
        playSound();
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

        const color = FLASH_COLORS[Math.floor(Math.random() * FLASH_COLORS.length)];
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

    _stopActiveMischief() {
        if (this._dragId) {
            GLib.source_remove(this._dragId);
            this._dragId = 0;
        }
        if (this._typeId) {
            GLib.source_remove(this._typeId);
            this._typeId = 0;
        }
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
        this._indicator = new RaccoonIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
