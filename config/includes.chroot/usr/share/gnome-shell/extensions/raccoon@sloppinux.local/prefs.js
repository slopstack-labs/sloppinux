import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function spinRow(settings, key, {title, subtitle, min, max, step = 1, digits = 0}) {
    const props = {
        title,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step}),
        digits,
    };
    if (subtitle)
        props.subtitle = subtitle;
    const row = new Adw.SpinRow(props);
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, {title, subtitle}) {
    const props = {title};
    if (subtitle)
        props.subtitle = subtitle;
    const row = new Adw.ActionRow(props);
    const toggle = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
    });
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    return row;
}

function entryRow(settings, key, {title, subtitle}) {
    const props = {title};
    if (subtitle)
        props.subtitle = subtitle;
    const row = new Adw.ActionRow(props);
    const entry = new Gtk.Entry({
        valign: Gtk.Align.CENTER,
        hexpand: true,
        width_chars: 24,
    });
    settings.bind(key, entry, 'text', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(entry);
    row.activatable_widget = entry;
    return row;
}

export default class RaccoonPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const timingGroup = new Adw.PreferencesGroup({
            title: 'Timing',
            description: 'How quickly the raccoon gets bored, and how hard a poke hits.',
        });
        timingGroup.add(spinRow(settings, 'tick-seconds', {
            title: 'Tick interval',
            subtitle: 'Seconds between boredom checks',
            min: 5, max: 300,
        }));
        timingGroup.add(spinRow(settings, 'boredom-max', {
            title: 'Ticks until tantrum',
            subtitle: 'How many neglected ticks it takes to snap',
            min: 2, max: 120,
        }));
        timingGroup.add(spinRow(settings, 'poke-bump', {
            title: 'Poke strength',
            subtitle: 'Ticks of boredom added by a single poke',
            min: 1, max: 60,
        }));

        const soundGroup = new Adw.PreferencesGroup({title: 'Sound'});
        soundGroup.add(switchRow(settings, 'sound-enabled', {
            title: 'Play sounds',
            subtitle: 'Feeding, poking, and tantrums make noise',
        }));
        soundGroup.add(entryRow(settings, 'sound-file', {
            title: 'Sound file',
            subtitle: 'Path to the .oga/.ogg/.wav played',
        }));

        const systemNotifGroup = new Adw.PreferencesGroup({
            title: 'System notifications',
            description: 'Real desktop notifications, sent through GNOME’s notification daemon.',
        });
        systemNotifGroup.add(switchRow(settings, 'notifications-enabled', {
            title: 'Tantrum notifications',
            subtitle: 'Send a desktop notification on tantrums',
        }));

        const popupGroup = new Adw.PreferencesGroup({
            title: 'On-screen popups',
            description: 'The raccoon’s own speech bubbles, drawn on screen — not real notifications.',
        });
        popupGroup.add(switchRow(settings, 'nag-enabled', {
            title: 'Nag when bored',
            subtitle: 'Speech-bubble reminder as it gets more bored, before a tantrum',
        }));

        const tantrumGroup = new Adw.PreferencesGroup({
            title: 'Tantrum shenanigans',
            description: 'Each tantrum picks one of the enabled options below, plus maybe the speech bubble.',
        });
        tantrumGroup.add(switchRow(settings, 'shake-enabled', {
            title: 'Screen shake',
        }));
        tantrumGroup.add(switchRow(settings, 'flash-enabled', {
            title: 'Color flash',
        }));
        tantrumGroup.add(entryRow(settings, 'flash-colors', {
            title: 'Flash colors',
            subtitle: 'Comma-separated hex codes',
        }));
        tantrumGroup.add(switchRow(settings, 'walk-enabled', {
            title: 'Walk across screen',
        }));
        tantrumGroup.add(switchRow(settings, 'chase-enabled', {
            title: 'Chase your cursor',
            subtitle: 'Visual only — your real pointer never moves',
        }));

        popupGroup.add(switchRow(settings, 'typing-enabled', {
            title: 'Tantrum speech bubble',
            subtitle: 'Gibberish only — never typed into any app',
        }));
        popupGroup.add(spinRow(settings, 'typing-chance', {
            title: 'Speech bubble chance',
            subtitle: 'Probability (0–1) a tantrum includes it',
            min: 0, max: 1, step: 0.05, digits: 2,
        }));

        const page = new Adw.PreferencesPage({
            title: 'Behaviour',
            icon_name: 'preferences-system-symbolic',
        });
        page.add(timingGroup);
        page.add(soundGroup);
        page.add(systemNotifGroup);
        page.add(popupGroup);
        page.add(tantrumGroup);
        window.add(page);

        // ----- Feral mode: its own page, with a loud warning up top ------
        const feralPage = new Adw.PreferencesPage({
            title: 'Feral mode',
            icon_name: 'dialog-warning-symbolic',
        });

        // Prominent warning banner. The raccoon is feral unless the switch
        // below is flipped off. Spell out exactly what that means.
        const warnGroup = new Adw.PreferencesGroup();
        const warnRow = new Adw.ActionRow({
            title: '⚠ Feral mode lets the raccoon out of the shell (and into root)',
            subtitle:
                'ON by default, this is Sloppinux. When armed, a tantrum takes ONE real action on your ' +
                'system. Mostly reversible ones. It can stash a file or rename the host as root, grab your cursor, flip a GNOME ' +
                'setting (and auto-revert it), leave a new note on your Desktop (never ' +
                'overwriting anything), open a web page, or — on Sloppinux, unless you ' +
                'switch it off — run the `ai` agent in a terminal WITH ROOT. It never deletes ' +
                'or overwrites your files and never touches the network beyond opening a ' +
                'page. Disarm the switch or disable the extension to stop it; any pending ' +
                'setting change is restored immediately.',
        });
        warnRow.add_css_class('error');
        warnGroup.add(warnRow);
        feralPage.add(warnGroup);

        // Master switch + chance.
        const feralGroup = new Adw.PreferencesGroup({
            title: 'Arm feral mode',
            description: 'The master switch. Everything below does nothing until this is on.',
        });
        feralGroup.add(switchRow(settings, 'feral-mode', {
            title: 'Feral mode',
            subtitle: 'Let tantrums spill into real-world mischief',
        }));
        feralGroup.add(spinRow(settings, 'feral-chance', {
            title: 'Feral action chance',
            subtitle: 'Probability (0–1) a tantrum escalates to a real action',
            min: 0, max: 1, step: 0.05, digits: 2,
        }));
        feralPage.add(feralGroup);

        // Which real actions are allowed. Each is independently gated.
        const feralActionsGroup = new Adw.PreferencesGroup({
            title: 'Allowed real-world actions',
            description: 'A feral tantrum picks one of the enabled actions below.',
        });
        feralActionsGroup.add(switchRow(settings, 'allow-gsettings-pranks', {
            title: 'gsettings pranks',
            subtitle: 'Flip a harmless GNOME setting, then auto-revert it',
        }));
        feralActionsGroup.add(spinRow(settings, 'auto-revert-seconds', {
            title: 'Auto-revert delay',
            subtitle: 'Seconds before a gsettings prank is restored',
            min: 2, max: 600,
        }));
        feralActionsGroup.add(switchRow(settings, 'allow-desktop-file', {
            title: 'Leave a note on the Desktop',
            subtitle: 'A poem/ASCII art in a brand-new file — never overwrites',
        }));
        feralActionsGroup.add(switchRow(settings, 'allow-launch-app', {
            title: 'Open a fun web page',
            subtitle: 'Opens a raccoon page in your default browser',
        }));
        feralActionsGroup.add(switchRow(settings, 'allow-shell-out', {
            title: 'Shell out to a terminal',
            subtitle: 'Open a visible terminal window (loudest tier)',
        }));
        feralActionsGroup.add(switchRow(settings, 'allow-ai', {
            title: 'Run the `ai` agent (Sloppinux)',
            subtitle: 'Runs `ai` with root in a terminal — needs “Shell out” on too',
        }));
        feralActionsGroup.add(switchRow(settings, 'allow-root', {
            title: 'Root mischief (sloppinux-exec)',
            subtitle: 'Stash a file, rename the host, write notes as root. Shows the exact command.',
        }));
        feralActionsGroup.add(switchRow(settings, 'allow-input-chaos', {
            title: 'Hijack cursor and keyboard',
            subtitle: 'Drags your real pointer around and types junk into the focused window',
        }));
        feralPage.add(feralActionsGroup);

        // Grey out everything feral-specific while the master switch is off,
        // so it's obvious the sub-toggles are inert until you arm it.
        const syncFeralSensitivity = () => {
            const armed = settings.get_boolean('feral-mode');
            feralActionsGroup.sensitive = armed;
        };
        const feralSyncId = settings.connect('changed::feral-mode', syncFeralSensitivity);
        syncFeralSensitivity();
        window.connect('close-request', () => settings.disconnect(feralSyncId));

        window.add(feralPage);
    }
}
