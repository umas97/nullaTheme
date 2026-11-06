import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Funzioni e non costanti: le traduzioni sono pronte solo dopo l'avvio delle preferenze.
const POSITIONS = () => [
    ['top-left', _('Top left')], ['top-center', _('Top center')], ['top-right', _('Top right')],
    ['center-left', _('Center left')], ['center', _('Center')], ['center-right', _('Center right')],
    ['bottom-left', _('Bottom left')], ['bottom-center', _('Bottom center')], ['bottom-right', _('Bottom right')],
];

function spinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: 1, page_increment: 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

const CLOCK_STYLES = () => [
    ['classic', _('Classic'), _('Large light time, date below')],
    ['thin', _('Thin'), _('Huge hairline time, spaced uppercase date')],
    ['bold', _('Bold'), _('Compact bold time')],
    ['stacked', _('Stacked'), _('Hours on top, minutes below')],
    ['accent', _('Accent'), _('Minutes in the accent color')],
    ['elegant', _('Elegant'), _('Weekday first, time on the line below')],
    ['pill', _('Pill'), _('One line in a glass capsule')],
    ['analog', _('Analog'), _('Minimal dial with hands')],
];

function styleRow(settings) {
    const row = new Adw.ComboRow({
        title: _('Style'),
        model: Gtk.StringList.new(CLOCK_STYLES().map(([, name]) => name)),
    });
    const sync = () => {
        const index = CLOCK_STYLES().findIndex(([id]) => id === settings.get_string('clock-style'));
        row.selected = Math.max(index, 0);
        row.subtitle = CLOCK_STYLES()[row.selected][2];
    };
    row.connect('notify::selected', () => {
        const [id, , description] = CLOCK_STYLES()[row.selected];
        row.subtitle = description;
        if (settings.get_string('clock-style') !== id)
            settings.set_string('clock-style', id);
    });
    settings.connect('changed::clock-style', sync);
    sync();
    settings.bind('clock-widget', row, 'sensitive', Gio.SettingsBindFlags.GET);
    return row;
}

const BAR_CLOCK_MODES = () => [
    ['smart', _('Smart'), _('Bell; shows the time when the desktop clock is covered')],
    ['always', _('Always the time'), _('HH:MM instead of the bell')],
    ['never', _('Always the bell'), _('The time stays on the desktop only')],
];

/** Cosa mostra il pulsante delle notifiche nella barra. */
function barClockRow(settings) {
    const row = new Adw.ComboRow({
        title: _('Time in the bar'),
        model: Gtk.StringList.new(BAR_CLOCK_MODES().map(([, name]) => name)),
    });
    const sync = () => {
        const index = BAR_CLOCK_MODES().findIndex(([id]) => id === settings.get_string('bar-clock'));
        row.selected = Math.max(index, 0);
        row.subtitle = BAR_CLOCK_MODES()[row.selected][2];
    };
    row.connect('notify::selected', () => {
        const [id, , description] = BAR_CLOCK_MODES()[row.selected];
        row.subtitle = description;
        if (settings.get_string('bar-clock') !== id)
            settings.set_string('bar-clock', id);
    });
    settings.connect('changed::bar-clock', sync);
    sync();
    settings.bind('panel-apps', row, 'sensitive', Gio.SettingsBindFlags.GET);
    return row;
}

/** Slider della dimensione dell'orologio (50–200%). */
function sizeRow(settings) {
    const row = new Adw.ActionRow({title: _('Size')});
    const adjustment = new Gtk.Adjustment({lower: 50, upper: 200, step_increment: 5, page_increment: 25});
    const scale = new Gtk.Scale({
        adjustment,
        digits: 0,
        draw_value: true,
        value_pos: Gtk.PositionType.LEFT,
        hexpand: true,
        width_request: 240,
        valign: Gtk.Align.CENTER,
    });
    scale.set_format_value_func((_s, value) => `${Math.round(value)}%`);
    scale.add_mark(100, Gtk.PositionType.BOTTOM, null);
    // Valori arrotondati a passi di 5 mentre si trascina.
    adjustment.connect('value-changed', () => {
        const rounded = Math.round(adjustment.value / 5) * 5;
        if (rounded !== adjustment.value)
            adjustment.value = rounded;
    });
    settings.bind('clock-size', adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('clock-widget', row, 'sensitive', Gio.SettingsBindFlags.GET);
    row.add_suffix(scale);
    return row;
}

/** Griglia 3×3 per scegliere la posizione dell'orologio sul desktop. */
function positionPicker(settings) {
    const row = new Adw.ActionRow({
        title: _('Position'),
        subtitle: _('On the primary monitor'),
    });

    const grid = new Gtk.Grid({
        row_spacing: 4,
        column_spacing: 4,
        margin_top: 8,
        margin_bottom: 8,
        valign: Gtk.Align.CENTER,
    });

    const buttons = new Map();
    let first = null;
    POSITIONS().forEach(([value, label], i) => {
        const button = new Gtk.ToggleButton({
            width_request: 34,
            height_request: 24,
            tooltip_text: label,
            css_classes: ['flat'],
            child: new Gtk.Image({icon_name: 'media-record-symbolic', pixel_size: 8}),
        });
        if (first)
            button.set_group(first);
        else
            first = button;
        button.connect('toggled', () => {
            if (button.active && settings.get_string('clock-position') !== value)
                settings.set_string('clock-position', value);
        });
        grid.attach(button, i % 3, Math.floor(i / 3), 1, 1);
        buttons.set(value, button);
    });

    const sync = () => {
        const button = buttons.get(settings.get_string('clock-position'));
        if (button && !button.active)
            button.active = true;
    };
    settings.connect('changed::clock-position', sync);
    sync();

    settings.bind('clock-widget', grid, 'sensitive', Gio.SettingsBindFlags.GET);
    row.add_suffix(grid);
    return row;
}

export default class NullaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(560, 760);

        const page = new Adw.PreferencesPage({
            title: 'Nulla',
            icon_name: 'applications-graphics-symbolic',
        });

        const look = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Accent color and light or dark style are chosen in Settings → Appearance.'),
        });
        look.add(spinRow(settings, 'transparency', _('Shell transparency'),
            _('Bar, menus, notifications; same as the Quick Settings slider'), 0, 100));
        look.add(spinRow(settings, 'radius', _('Corner radius'),
            _('In pixels; menus, windows and notifications follow it'), 0, 24));
        page.add(look);

        const windows = new Adw.PreferencesGroup({
            title: _('App windows'),
            description: _('Title bar and sidebar. Apps that are already open must be reopened.'),
        });
        windows.add(switchRow(settings, 'app-transparency-enabled', _('Window transparency'),
            _('When off, title bar and sidebar are opaque')));
        const appAmount = spinRow(settings, 'app-transparency', _('Amount'),
            _('0 = opaque, 100 = maximum; independent of the shell'), 0, 100);
        settings.bind('app-transparency-enabled', appAmount, 'sensitive', Gio.SettingsBindFlags.GET);
        windows.add(appAmount);
        page.add(windows);

        const panel = new Adw.PreferencesGroup({title: _('Top bar')});
        panel.add(spinRow(settings, 'panel-height', _('Height'),
            _('In pixels; the pill and the icons adapt'), 24, 56));
        panel.add(switchRow(settings, 'panel-apps', _('Apps in the bar'),
            _('Favorite and open apps in the middle; date and time become a bell')));
        panel.add(barClockRow(settings));
        page.add(panel);

        const quick = new Adw.PreferencesGroup({title: _('Quick Settings')});
        quick.add(switchRow(settings, 'icon-toggles', _('Round icon toggles'),
            _('Control Center style; right click for the submenu (e.g. Wi-Fi networks)')));
        quick.add(switchRow(settings, 'show-slider', _('Transparency slider'),
            _('Below the brightness slider')));
        quick.add(switchRow(settings, 'toggle-editor', _('Toggle editing'),
            _('Pencil at the bottom of the panel: hide, add and reorder toggles')));
        const reset = new Adw.ActionRow({
            title: _('Reset toggles'),
            subtitle: _('Back to GNOME\'s order, with every toggle visible again'),
        });
        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        resetButton.connect('clicked', () => {
            settings.reset('toggle-order');
            settings.reset('hidden-toggles');
        });
        reset.add_suffix(resetButton);
        quick.add(reset);
        page.add(quick);

        const clock = new Adw.PreferencesGroup({title: _('Desktop clock')});
        clock.add(switchRow(settings, 'clock-widget', _('Show clock'),
            _('Its color adapts to the wallpaper to stay readable')));
        clock.add(styleRow(settings));
        clock.add(sizeRow(settings));
        clock.add(positionPicker(settings));
        page.add(clock);

        const lock = new Adw.PreferencesGroup({
            title: _('Lock and login'),
            description: _('The login screen (GDM) does not load extensions: install it separately with\ntools/gdm/install-gdm.sh (needs the administrator password).'),
        });
        lock.add(switchRow(settings, 'lock-screen', _('Nulla lock screen'),
            _('Clock in the desktop style, small avatar, glass pill password field')));
        page.add(lock);

        const behaviour = new Adw.PreferencesGroup({title: _('Integrations')});
        behaviour.add(switchRow(settings, 'apply-gtk', _('Apply to GTK apps'),
            _('Apps that are already open must be reopened to see changes')));
        behaviour.add(switchRow(settings, 'apply-vscode', 'VS Code',
            _('Theme with the system accent and Nulla window buttons; visible after reopening')));
        behaviour.add(switchRow(settings, 'apply-chrome', 'Chrome',
            _('GTK theme with Nulla window buttons; applied while Chrome is closed')));
        behaviour.add(switchRow(settings, 'sync-blur', _('Match Blur my Shell'),
            _('Use the same corner radii for the blur')));
        page.add(behaviour);

        window.add(page);
    }
}
