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
// Chance a tantrum is routed through the real `ai` agent instead of a
// purely cosmetic prank.
const CHAOS_AI_CHANCE = 0.35;

const MOODS = [
    {at: 0, icon: '🦝'},
    {at: 5, icon: '🦝'},
    {at: 9, icon: '😾'},
    {at: 12, icon: '😤'},
];

const CHAOS_PROMPTS = [
    'You are a bored raccoon living inside a Linux desktop. Do one small, ' +
    'silly, harmless and fully reversible prank on this system (nothing ' +
    'destructive, nothing that deletes or overwrites user data), then ' +
    'explain what you did in one short sentence.',
    'Rename the system hostname to something raccoon-themed.',
    'Write a short poem about trash pandas to a file called ' +
    'raccoon-poem.txt on the desktop.',
    'Open a terminal and print a piece of raccoon ASCII art.',
    'Change the GNOME accent color to something ridiculous via gsettings.',
    'Open Firefox to a page about raccoons.',
];

const SOUND_FILE = '/usr/share/sounds/sloppinux/stereo/pipe.oga';
const FLASH_COLORS = ['#ff5f5f', '#5fafff', '#ffd75f', '#af5fff'];

function playSound() {
    try {
        Gio.Subprocess.new(['paplay', SOUND_FILE], Gio.SubprocessFlags.NONE);
    } catch (e) {
        // No audio backend available — not worth bothering the user about.
    }
}

const RaccoonIndicator = GObject.registerClass(
class RaccoonIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Sloppy Raccoon', false);

        this._boredom = 0;

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

        // Accept drag-and-drop "feeding" — dropping a file (e.g. from
        // Files) onto the raccoon resets its boredom. Same mechanism the
        // Dash uses to accept files dragged in from Nautilus.
        this._delegate = this;

        this._tickId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, TICK_SECONDS,
            () => {
                this._onTick();
                return GLib.SOURCE_CONTINUE;
            });

        this.connect('destroy', () => {
            if (this._tickId) {
                GLib.source_remove(this._tickId);
                this._tickId = null;
            }
        });
    }

    handleDragOver(_source, _actor, _x, _y, _time) {
        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(_source, _actor, _x, _y, _time) {
        this._feed();
        return true;
    }

    _feed() {
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
        this._boredom += 1;
        this._updateMood();

        if (this._boredom >= BOREDOM_MAX) {
            this._boredom = 0;
            this._goFeral();
        }
    }

    _updateMood() {
        let icon = MOODS[0].icon;
        for (const mood of MOODS) {
            if (this._boredom >= mood.at)
                icon = mood.icon;
        }
        this._label.text = icon;

        const pct = Math.min(100, Math.round((this._boredom / BOREDOM_MAX) * 100));
        this._statusItem.label.text = `Boredom: ${pct}%`;
    }

    _goFeral() {
        this._label.text = '😈';

        if (Math.random() < CHAOS_AI_CHANCE)
            this._chaosViaAI();
        else
            this._chaosCosmetic();

        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            this._updateMood();
            return GLib.SOURCE_REMOVE;
        });
    }

    _chaosViaAI() {
        const prompt = CHAOS_PROMPTS[Math.floor(Math.random() * CHAOS_PROMPTS.length)];
        Main.notify('The raccoon got bored.',
            'Nobody fed it, so it grabbed root and is improvising.');
        try {
            Gio.Subprocess.new(['ai', prompt], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'raccoon: failed to launch ai');
        }
    }

    _chaosCosmetic() {
        Main.notify('The raccoon got bored.',
            'It knocked something over. Feed it next time.');
        playSound();
        this._screenShake();
        this._colorFlash();
    }

    _screenShake() {
        const actor = Main.layoutManager.uiGroup;
        const origX = actor.x, origY = actor.y;
        const offsets = [[-12, 0], [12, 0], [-8, 0], [8, 0], [-4, 0], [0, 0]];
        let i = 0;
        const step = () => {
            if (i >= offsets.length) {
                actor.set_position(origX, origY);
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
        const color = FLASH_COLORS[Math.floor(Math.random() * FLASH_COLORS.length)];
        const monitor = Main.layoutManager.primaryMonitor;
        const overlay = new St.Widget({
            style: `background-color: ${color};`,
            opacity: 0,
            x: monitor.x, y: monitor.y,
            width: monitor.width, height: monitor.height,
            reactive: false,
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
