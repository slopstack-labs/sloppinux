// The desktop raccoon: a Desktop-Goose-style pet that wanders the primary
// monitor's work area, can be picked up, thrown, petted and fed, and on a
// bad day runs off with your cursor. Driven by RaccoonIndicator in
// extension.js, which owns boredom, hunger, speech bubbles and the virtual
// pointer; this module only owns the pet's body.
//
// One GLib timer (TICK_MS) drives movement and frame changes for the pet
// and its fx. Fx float-aways are Clutter eases on a small reused pool of
// actors, not timers of their own.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FRAME = 96;           // px per frame in sprites/raccoon.png (8 x 4 grid)
const COLUMNS = 8;
const ROWS = 4;
const SCRUFF_Y = 20 / 96;   // where the scruff is, as a fraction of the frame
const TICK_MS = 30;
const WALK_SPEED = 90;      // logical px/s
const HUNGRY_SPEED = 55;
const RUN_SPEED = 240;      // hunting your cursor
const CARRY_SPEED = 170;
const DRAG_THRESHOLD = 8;   // px of movement before a press becomes a pick-up
const PET_HOLD_MS = 500;
const THROW_SPEED = 650;    // px/s at release to count as a throw
const FRICTION = 2.2;       // 1/s, exponential decay of a thrown raccoon
const BOUNCE = 0.6;
const FX_POOL = 4;
const SHAKE_OFF_PX = 700;   // accumulated tug-of-war before it lets go

// name -> {frames, fps, loop, next}. `next` is played when a non-looping
// animation ends.
export const ANIMATIONS = {
    idle: {frames: [0, 1], fps: 2, loop: true},
    blink: {frames: [2], fps: 6, loop: false, next: 'idle'},
    walk: {frames: [3, 4, 5, 6], fps: 8, loop: true},
    run: {frames: [3, 4, 5, 6], fps: 14, loop: true},
    sleep: {frames: [7, 8], fps: 1.5, loop: true},
    dangle: {frames: [9, 10], fps: 4, loop: true},
    ball: {frames: [11], fps: 1, loop: true},
    sulk: {frames: [12, 13], fps: 2, loop: true},
    happy: {frames: [14, 15], fps: 4, loop: true},
    eat: {frames: [16, 17], fps: 4, loop: true},
    droop: {frames: [18, 19, 20, 21], fps: 6, loop: true},
    carry: {frames: [22, 23], fps: 8, loop: true},
    feral: {frames: [24, 25], fps: 6, loop: true},
};
const FX = ['heart', 'zzz', 'anger', 'food'];   // sprites/fx-<name>.png
const FX_SIZE = 48;        // px, 16x16 pixel art pre-scaled 3x
const FX_SECONDS = 1.1;    // how long an effect floats before it is gone

const THROWN_QUIPS = ['Rude!', 'I am filing a complaint.', 'Wheee— no. Rude.', 'Do that again and see what happens.'];
const SHAKEN_QUIPS = ['Fine, keep it.', 'Ugh. Sore loser.', 'It was ugly anyway.', 'You win this round.'];
const HUNGRY_QUIPS = ['Snack?', 'Food. Please.', 'I can see my ribs.', 'Feed me a file.', '*stomach noises*'];
const PET_QUIPS = ['...okay, that is nice.', 'Purr? (raccoons do not purr)', 'Acceptable.'];
const THEFT_QUIPS = ['Mine now.', 'Yoink!', 'Finders keepers.', 'Nice cursor. Shame if someone took it.'];

function rand(a, b) {
    return a + Math.random() * (b - a);
}

function pickOne(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function nowUs() {
    return GLib.get_monotonic_time();
}

// One frame of sprites/raccoon.png at a time: a frame-sized window that
// clips its only child, the whole sheet, which is slid around behind it.
// (ui/animation.js used St.TextureCache.load_sliced_image() for this; that
// call is gone in GNOME 48.)
class SpriteSheet {
    constructor(file) {
        this.onFailed = null;
        this._shown = -1;
        this._cell = FRAME * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.actor = new St.Widget({
            width: this._cell, height: this._cell,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._sheet = new St.Widget({
            width: COLUMNS * this._cell, height: ROWS * this._cell,
            style: `background-image: url("${file.get_uri()}"); ` +
                   `background-size: ${COLUMNS * FRAME}px ${ROWS * FRAME}px;`,
        });
        this.actor.add_child(this._sheet);
        // St draws nothing, silently, for a missing background image, so
        // ask the file itself. Async: onFailed is assigned after we return.
        file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, null, (f, res) => {
                try {
                    f.query_info_finish(res);
                } catch (_e) {
                    this.onFailed?.();
                }
            });
        this.show(0);
    }

    show(index) {
        if (index === this._shown)
            return;
        this._shown = index;
        this._sheet.set_position(
            -(index % COLUMNS) * this._cell,
            -Math.floor(index / COLUMNS) * this._cell);
    }
}

export class RaccoonPet {
    // host: the RaccoonIndicator. See the "Desktop pet host" section there
    // for everything we call on it.
    constructor(host, extensionPath) {
        this._host = host;
        this._destroyed = false;
        this._tickId = 0;
        this._grab = null;
        this._press = null;
        this._samples = [];
        this._suspended = false;
        this._away = false;
        this._theft = null;
        this._vx = this._vy = 0;
        this._spin = 0;
        this._dir = 1;
        this._target = null;
        this._fxAccum = 0;
        this._petAccum = 0;
        this._meterUntil = 0;
        this._hungerNagAt = 0;

        const file = Gio.File.new_for_path(`${extensionPath}/sprites/raccoon.png`);
        this._scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._size = FRAME * this._scale;

        this.actor = new St.Widget({
            style_class: 'raccoon-pet', reactive: true, track_hover: true,
            width: this._size, height: this._size,
        });
        this._sheet = new SpriteSheet(file);
        this._sheet.actor.set_pivot_point(0.5, 0.5);
        this.actor.add_child(this._sheet.actor);
        // No sprite sheet (yet)? Fall back to the emoji so it still exists.
        this._sheet.onFailed = () => {
            log(`raccoon-pet: could not load ${file.get_path()}, using the emoji fallback`);
            if (this._fallback || this._destroyed)
                return;
            this._fallback = new St.Label({text: '🦝', style_class: 'raccoon-pet-fallback'});
            this._fallback.set_position(Math.round(this._size * 0.25), Math.round(this._size * 0.4));
            this.actor.add_child(this._fallback);
        };

        // Fullness meter, shown briefly after a meal and while hungry.
        this._meter = new St.Widget({style_class: 'raccoon-pet-meter', visible: false});
        this._meterFill = new St.Widget({style_class: 'raccoon-pet-meter-fill'});
        this._meter.add_child(this._meterFill);
        this._meter.set_position(Math.round(this._size * 0.25), Math.round(this._size * 0.04));
        this._meter.set_size(Math.round(this._size * 0.5), 6 * this._scale);
        this.actor.add_child(this._meter);

        this.actor.connect('button-press-event', (_a, ev) => this._onPress(ev));
        this.actor.connect('motion-event', (_a, ev) => this._onMotion(ev));
        this.actor.connect('button-release-event', (_a, ev) => this._onRelease(ev));
        this.actor.connect('destroy', () => this._teardown());
        host._addOverlay(this.actor);

        // Floating effects: a small pool of icons, reused round-robin.
        this._fxIcons = {};
        for (const name of FX) {
            this._fxIcons[name] = new Gio.FileIcon({
                file: Gio.File.new_for_path(`${extensionPath}/sprites/fx-${name}.png`),
            });
        }
        this._fx = [];
        for (let i = 0; i < FX_POOL; i++) {
            const actor = new St.Icon({icon_size: FX_SIZE, reactive: false, opacity: 0});
            host._addOverlay(actor);
            this._fx.push({actor, bornUs: 0, y: 0, rise: 0});
        }
        this._fxNext = 0;

        // Start next to the panel icon.
        const [ix] = this._iconPos();
        const wa = this._workArea();
        this._x = ix - this._size / 2;
        this._y = wa.y;
        this._clamp();
        this._setState('idle', rand(1, 3) * 1e6);
        this._sync();
        this._startTimer();
    }

    // ── public, called by the indicator ────────────────────────────────

    get isOut() {
        return !this._destroyed && !this._away && !this._suspended && this.actor.visible;
    }

    bubbleAnchor() {
        if (!this.isOut)
            return null;
        const wa = this._workArea();
        return [
            Math.round(Math.min(this._x + this._size * 0.2, wa.x + wa.width - 160)),
            Math.round(Math.max(wa.y, this._y - 30 * this._scale)),
        ];
    }

    feed() {
        if (!this.isOut || this._busy())
            return;
        this._setState('eat', 1.8e6);
        this._fxAt('food', this._x + this._size * (this._dir > 0 ? 0.75 : 0.25), this._y + this._size * 0.55);
        this._meterUntil = nowUs() + 4e6;
    }

    // Tantrum hook: walk over, grab the real pointer, run off with it.
    // Returns false if it cannot (caller falls back to cosmetics).
    startCursorTheft(seconds) {
        if (!this.isOut || this._busy() || this._host._petStandDown())
            return false;
        const pointer = this._host._getVirtualPointer();
        if (!pointer)
            return false;
        this._theft = {pointer, deadline: nowUs() + (8 + seconds) * 1e6, seconds, put: null, tug: 0};
        this._setState('hunt', 8e6);
        return true;
    }

    stopCursorTheft() {
        if (this._theft) {
            this._theft = null;
            this._setState('idle', 2e6);
        }
    }

    // "Go to your room": walk to the panel icon and vanish.
    goHome() {
        this._dropGrab();
        this._theft = null;
        if (!this.isOut) {
            this._away = true;
            this.actor.hide();
            return;
        }
        this._setState('home', 20e6);
    }

    letOut() {
        if (!this._away)
            return;
        this._away = false;
        const [ix] = this._iconPos();
        this._x = ix - this._size / 2;
        this._y = this._workArea().y;
        this._clamp();
        this.actor.remove_all_transitions();
        this.actor.set({opacity: 255, scale_x: 1, scale_y: 1, visible: !this._suspended});
        this._setState('idle', 2e6);
        this._sync();
        if (!this._suspended)
            this._startTimer();
    }

    // Fullscreen app on the primary monitor: hide, stop ticking.
    setSuspended(on) {
        if (on === this._suspended)
            return;
        this._suspended = on;
        if (on) {
            this._dropGrab();
            this._theft = null;
            this.actor.hide();
            this._clearFx();
            this._stopTimer();
        } else if (!this._away) {
            this.actor.show();
            this._setState('idle', 2e6);
            this._startTimer();
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this.actor.destroy();   // -> _teardown()
    }

    // ── internals ──────────────────────────────────────────────────────

    _teardown() {
        this._destroyed = true;
        this._dropGrab();
        this._stopTimer();
        this._theft = null;
        for (const fx of this._fx)
            fx.actor.destroy();
        this._fx = [];
    }

    _startTimer() {
        if (this._tickId || this._destroyed)
            return;
        this._last = nowUs();
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            try {
                this._tick();
            } catch (e) {
                // Log the first failure only; this runs ~33 times a second.
                if (!this._tickFailed)
                    logError(e, 'raccoon-pet: tick failed');
                this._tickFailed = true;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _dropGrab() {
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
        this._press = null;
    }

    _workArea() {
        const lm = Main.layoutManager;
        return lm.getWorkAreaForMonitor(lm.primaryIndex);
    }

    // Where the panel icon is. Before the panel's first allocation (which
    // is when we are usually created) Clutter answers NaN, and one NaN in
    // our coordinates makes the raccoon permanently invisible: fall back
    // to the top right corner of the work area, where the icon will be.
    _iconPos() {
        const [bx, by] = this._host.get_transformed_position();
        const x = bx + this._host.width / 2, y = by + this._host.height;
        if (Number.isFinite(x) && Number.isFinite(y))
            return [x, y];
        const wa = this._workArea();
        return [wa.x + wa.width - this._size, wa.y];
    }

    _clamp() {
        const wa = this._workArea();
        const s = this._size;
        let hitX = false, hitY = false;
        // Belt and braces for the same NaN: comparisons below would all be
        // false and let it through.
        if (!Number.isFinite(this._x) || !Number.isFinite(this._y)) {
            this._x = wa.x + (wa.width - s) / 2;
            this._y = wa.y + (wa.height - s) / 2;
            this._vx = this._vy = 0;
        }
        if (this._x < wa.x) {
            this._x = wa.x;
            hitX = true;
        } else if (this._x > wa.x + wa.width - s) {
            this._x = wa.x + wa.width - s;
            hitX = true;
        }
        if (this._y < wa.y) {
            this._y = wa.y;
            hitY = true;
        } else if (this._y > wa.y + wa.height - s) {
            this._y = wa.y + wa.height - s;
            hitY = true;
        }
        return [hitX, hitY];
    }

    _busy() {
        return ['pressed', 'held', 'petting', 'thrown', 'hunt', 'carry', 'home'].includes(this._state);
    }

    _setState(state, durationUs = 0) {
        this._state = state;
        this._stateUntil = nowUs() + durationUs;
        this._fxAccum = 0;
        const hungry = this._host._fullnessPct() < 30;
        const anim = {
            idle: 'idle', walk: hungry ? 'droop' : 'walk', sleep: 'sleep',
            pressed: null, held: 'dangle', petting: 'happy', happy: 'happy',
            thrown: 'ball', sulk: 'sulk', eat: 'eat', poked: 'feral',
            hunt: 'run', carry: 'carry', home: hungry ? 'droop' : 'walk',
        }[state];
        if (anim)
            this._play(anim);
        if (state !== 'thrown')
            this._sheet.actor.rotation_angle_z = 0;
    }

    _play(name) {
        if (this._animName === name)
            return;
        this._animName = name;
        this._anim = ANIMATIONS[name];
        this._animIdx = 0;
        this._animAccum = 0;
        this._sheet.show(this._anim.frames[0]);
    }

    _stepAnim(dt) {
        const a = this._anim;
        this._animAccum += dt;
        const step = 1 / a.fps;
        while (this._animAccum >= step) {
            this._animAccum -= step;
            if (this._animIdx + 1 < a.frames.length) {
                this._animIdx++;
            } else if (a.next) {
                this._play(a.next);
                return;
            } else if (a.loop) {
                this._animIdx = 0;
                // Occasional blink while sitting around.
                if (this._animName === 'idle' && Math.random() < 0.25) {
                    this._play('blink');
                    return;
                }
            }
        }
        this._sheet.show(a.frames[this._animIdx]);
    }

    _sync() {
        this.actor.set_position(Math.round(this._x), Math.round(this._y));
        this._sheet.actor.scale_x = this._dir;
    }

    _fxAt(kind, cx, cy) {
        const fx = this._fx[this._fxNext];
        if (!fx)
            return;
        this._fxNext = (this._fxNext + 1) % this._fx.length;
        const wa = this._workArea();
        const size = FX_SIZE * this._scale, rise = 34 * this._scale;
        // Keep the whole float-away inside the work area.
        const x = Math.max(wa.x, Math.min(cx - size / 2, wa.x + wa.width - size));
        const y = Math.max(wa.y + rise, Math.min(cy - size / 2, wa.y + wa.height - size));
        fx.actor.gicon = this._fxIcons[kind];
        fx.actor.set({x: Math.round(x), y: Math.round(y), opacity: 255});
        fx.bornUs = nowUs();
        fx.y = y;
        fx.rise = rise;
    }

    // Float the live effects up and fade them out. Done here, on our own
    // tick, and not with actor.ease(): GNOME switches animations off under
    // software rendering and in remote sessions, where an ease jumps
    // straight to its end and the heart is gone before it was ever drawn.
    _stepFx(t) {
        for (const fx of this._fx) {
            if (!fx.bornUs)
                continue;
            const p = (t - fx.bornUs) / (FX_SECONDS * 1e6);
            if (p >= 1) {
                fx.bornUs = 0;
                fx.actor.opacity = 0;
                continue;
            }
            fx.actor.y = Math.round(fx.y - fx.rise * p);
            fx.actor.opacity = Math.round(255 * (1 - p * p));
        }
    }

    _clearFx() {
        for (const fx of this._fx) {
            fx.bornUs = 0;
            fx.actor.opacity = 0;
        }
    }

    _fxOverHead(kind) {
        this._fxAt(kind, this._x + this._size * rand(0.3, 0.7), this._y - 4 * this._scale);
    }

    _say(text, ms = 1600) {
        this._host._say(text, ms);
    }

    // ── input ──────────────────────────────────────────────────────────

    _onPress(event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_MIDDLE) {
            this._poked();
            return Clutter.EVENT_STOP;
        }
        if (button !== Clutter.BUTTON_PRIMARY || this._grab ||
            ['hunt', 'carry', 'home'].includes(this._state))
            return Clutter.EVENT_STOP;
        const [px, py] = event.get_coords();
        this._grab = global.stage.grab(this.actor);
        this._press = {t: nowUs(), x: px, y: py, moved: false, from: this._state};
        this._samples = [{t: nowUs(), x: px, y: py}];
        this._setState('pressed');
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!this._press)
            return Clutter.EVENT_PROPAGATE;
        const [px, py] = event.get_coords();
        this._pointerTo(px, py);
        return Clutter.EVENT_STOP;
    }

    _pointerTo(px, py) {
        const t = nowUs();
        this._samples.push({t, x: px, y: py});
        while (this._samples.length > 2 && t - this._samples[0].t > 100e3)
            this._samples.shift();
        if (!this._press.moved &&
            Math.hypot(px - this._press.x, py - this._press.y) > DRAG_THRESHOLD * this._scale) {
            this._press.moved = true;
            this._setState('held');
        }
        if (this._state === 'held') {
            this._x = px - this._size / 2;
            this._y = py - this._size * SCRUFF_Y;
            this._clamp();
            this._sync();
        }
    }

    _onRelease(event) {
        if (!this._press || event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._release();
        return Clutter.EVENT_STOP;
    }

    _release() {
        const press = this._press;
        this._dropGrab();
        if (!press)
            return;
        if (this._state === 'held') {
            const first = this._samples[0], last = this._samples[this._samples.length - 1];
            const dt = Math.max(1e-3, (last.t - first.t) / 1e6);
            const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
            if (Math.hypot(vx, vy) > THROW_SPEED * this._scale && this._host._petThrowEnabled()) {
                this._vx = vx;
                this._vy = vy;
                this._spin = Math.sign(vx || 1) * Math.min(1440, Math.hypot(vx, vy));
                this._setState('thrown', 10e6);
            } else {
                this._setState('idle', rand(1, 3) * 1e6);
            }
        } else if (this._state === 'petting') {
            this._setState('happy', 1.2e6);
        } else {
            // A quick click is a poke. Leave 'pressed' first, or _poked()
            // would see a busy raccoon and keep it there.
            this._setState('poked', 0.8e6);
            this._host._poke();
        }
    }

    _poked() {
        this._host._poke();
        if (!this._busy())
            this._setState('poked', 0.8e6);
    }

    // ── the tick ───────────────────────────────────────────────────────

    _tick() {
        const t = nowUs();
        const dt = Math.min(0.1, Math.max(0, (t - this._last) / 1e6));
        this._last = t;
        if (this._destroyed || this._suspended || this._away)
            return;

        // A grab can end without us seeing the release (another grab, VT
        // switch, ...). If the button is up, treat it as released.
        // The pointer is also followed from here, so a drag keeps tracking
        // even if motion events stop reaching us. The button state is only
        // trusted once it has been seen down during this press: right after
        // the press event it can still read as up.
        if (this._press) {
            const [px, py, mods] = global.get_pointer();
            if (mods & Clutter.ModifierType.BUTTON1_MASK) {
                this._press.sawButton = true;
                this._pointerTo(px, py);
            } else if (this._press.sawButton) {
                this._release();
            }
        }

        const until = this._stateUntil;
        switch (this._state) {
        case 'pressed':
            if (this._press && t - this._press.t > PET_HOLD_MS * 1000 &&
                this._host._settings.get_boolean('petting-enabled'))
                this._setState('petting');
            break;
        case 'petting':
            this._everyFx(dt, 0.4, () => this._fxOverHead('heart'));
            this._petAccum += dt;
            if (this._petAccum >= 1) {
                this._petAccum -= 1;
                this._host._petted();
                if (Math.random() < 0.08)
                    this._say(pickOne(PET_QUIPS));
            }
            break;
        case 'held':
            // Stays held until the button comes up, however long that takes.
            break;
        case 'thrown':
            this._tickThrown(dt, t > until);
            break;
        case 'sleep':
            this._everyFx(dt, 1.6, () => this._fxOverHead('zzz'));
            if (t > until)
                this._setState('idle', rand(1, 3) * 1e6);
            break;
        case 'walk':
            // Calamares appeared mid-stroll: sit down, do not wander over it.
            this._everyFx(dt, 1, () => {
                if (this._host._petStandDown())
                    this._stateUntil = 0;
            });
            if (this._moveToward(this._target, this._speed(WALK_SPEED, HUNGRY_SPEED), dt) || t > until)
                this._setState('idle', rand(1.5, 5) * 1e6);
            break;
        case 'home':
            if (this._moveToward(this._homeTarget(), this._speed(WALK_SPEED, HUNGRY_SPEED) * 1.5, dt) || t > until)
                this._vanish();
            break;
        case 'hunt':
        case 'carry':
            this._tickTheft(t, dt);
            break;
        case 'idle':
            if (t > until)
                this._decide();
            break;
        default:   // eat, happy, sulk, poked: timed poses
            if (this._state === 'sulk' && t < until)
                break;
            if (t > until)
                this._setState('idle', rand(1, 3) * 1e6);
        }

        this._stepAnim(dt);
        this._stepFx(t);
        this._syncMeter(t);
        if (this._state !== 'held')
            this._clamp();   // the work area can change under us
        this._sync();
    }

    _everyFx(dt, every, fn) {
        this._fxAccum += dt;
        if (this._fxAccum >= every) {
            this._fxAccum = 0;
            fn();
        }
    }

    _speed(normal, hungry) {
        return (this._host._fullnessPct() < 30 ? hungry : normal) * this._scale;
    }

    // Step toward target {x, y} (top-left coords). True on arrival.
    _moveToward(target, speed, dt) {
        if (!target)
            return true;
        // Never aim outside the work area (the pointer may be on the panel
        // or another monitor), or it would never arrive.
        const wa = this._workArea();
        target = {
            x: Math.max(wa.x, Math.min(target.x, wa.x + wa.width - this._size)),
            y: Math.max(wa.y, Math.min(target.y, wa.y + wa.height - this._size)),
        };
        const dx = target.x - this._x, dy = target.y - this._y;
        const dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > 2)
            this._dir = dx > 0 ? 1 : -1;
        const step = speed * dt;
        if (dist <= step) {
            this._x = target.x;
            this._y = target.y;
            this._clamp();
            return true;
        }
        this._x += dx / dist * step;
        this._y += dy / dist * step;
        this._clamp();
        return false;
    }

    _decide() {
        const standDown = this._host._petStandDown();
        const hungry = this._host._fullnessPct() < 30;
        if (hungry && nowUs() > this._hungerNagAt) {
            this._hungerNagAt = nowUs() + 45e6;
            this._say(pickOne(HUNGRY_QUIPS), 1800);
        }
        const r = Math.random();
        if (r < 0.15) {
            this._setState('sleep', rand(8, 20) * 1e6);
        } else if (r < 0.75 && !standDown) {
            const wa = this._workArea();
            this._target = {
                x: wa.x + Math.random() * Math.max(0, wa.width - this._size),
                y: wa.y + Math.random() * Math.max(0, wa.height - this._size),
            };
            this._setState('walk', 30e6);
        } else {
            this._setState('idle', rand(2, 6) * 1e6);
        }
    }

    _tickThrown(dt, expired) {
        const decay = Math.exp(-FRICTION * dt);
        this._vx *= decay;
        this._vy *= decay;
        this._spin *= decay;
        this._x += this._vx * dt;
        this._y += this._vy * dt;
        const [hitX, hitY] = this._clamp();
        if (hitX)
            this._vx = -this._vx * BOUNCE;
        if (hitY)
            this._vy = -this._vy * BOUNCE;
        this._sheet.actor.rotation_angle_z = (this._sheet.actor.rotation_angle_z + this._spin * dt) % 360;
        if (Math.hypot(this._vx, this._vy) < 40 * this._scale || expired)
            this._landed();
    }

    _landed() {
        this._vx = this._vy = 0;
        this._sheet.actor.rotation_angle_z = 0;
        if (this._host._petStandDown()) {
            this._setState('idle', 2e6);
            return;
        }
        this._setState('sulk', rand(3, 5) * 1e6);
        this._fxOverHead('anger');
        this._say(pickOne(THROWN_QUIPS));
        this._host._bumpBoredom(2);
    }

    _homeTarget() {
        const [ix] = this._iconPos();
        return {x: ix - this._size / 2, y: this._workArea().y};
    }

    _vanish() {
        this._away = true;
        this._clearFx();
        this._stopTimer();
        this.actor.ease({
            opacity: 0, scale_x: 0.3, scale_y: 0.3, duration: 350,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => this.actor.hide(),
        });
    }

    // Cursor theft. 'hunt': run to the pointer. 'carry': hold it in front
    // and walk off, warping the real pointer with the virtual device. The
    // human fights back by moving the mouse: deviation between where we
    // put the pointer and where it actually is accumulates into `tug`.
    _tickTheft(t, dt) {
        const th = this._theft;
        if (!th || this._host._petStandDown()) {
            this.stopCursorTheft();
            return;
        }
        const [px, py] = global.get_pointer();
        const s = this._size;
        if (this._state === 'hunt') {
            const target = {x: px - s / 2 - this._dir * s * 0.3, y: py - s * 0.6};
            if (this._moveToward(target, RUN_SPEED * this._scale, dt)) {
                th.deadline = t + th.seconds * 1e6;
                this._setState('carry', th.seconds * 1e6);
                this._pickCarryTarget();
                this._say(pickOne(THEFT_QUIPS), 1400);
            } else if (t > this._stateUntil) {
                this.stopCursorTheft();
            }
            return;
        }

        if (th.put) {
            const dev = Math.hypot(px - th.put[0], py - th.put[1]);
            if (dev > 3 * this._scale)
                th.tug += dev;
            else
                th.tug = Math.max(0, th.tug - 2);
            if (th.tug > SHAKE_OFF_PX * this._scale) {
                this._shakenOff();
                return;
            }
        }
        if (t > th.deadline) {
            this._theft = null;
            this._setState('idle', 2e6);
            this._say('Okay, you can have it back.', 1400);
            return;
        }
        if (this._moveToward(this._carryTarget, CARRY_SPEED * this._scale, dt))
            this._pickCarryTarget();
        const wa = this._workArea();
        const hx = Math.max(wa.x, Math.min(this._x + s / 2 + this._dir * s * 0.35, wa.x + wa.width - 1));
        const hy = Math.max(wa.y, Math.min(this._y + s * 0.6, wa.y + wa.height - 1));
        try {
            th.pointer.notify_absolute_motion(GLib.get_monotonic_time(), hx, hy);
            th.put = [hx, hy];
        } catch (e) {
            logError(e, 'raccoon-pet: virtual pointer went away');
            this.stopCursorTheft();
        }
    }

    _pickCarryTarget() {
        const wa = this._workArea();
        this._carryTarget = {
            x: wa.x + Math.random() * Math.max(0, wa.width - this._size),
            y: wa.y + Math.random() * Math.max(0, wa.height - this._size),
        };
    }

    _shakenOff() {
        this._theft = null;
        this._vx = -this._dir * rand(500, 800) * this._scale;
        this._vy = rand(-300, 300) * this._scale;
        this._spin = -this._dir * 900;
        this._setState('thrown', 4e6);
        this._say(pickOne(SHAKEN_QUIPS), 1600);
    }

    _syncMeter(t) {
        const pct = this._host._fullnessPct();
        const show = t < this._meterUntil || pct < 30;
        this._meter.visible = show;
        if (!show)
            return;
        this._meterFill.width = Math.round(this._meter.width * Math.max(0, Math.min(100, pct)) / 100);
        if (pct < 30)
            this._meterFill.add_style_class_name('hungry');
        else
            this._meterFill.remove_style_class_name('hungry');
    }
}
