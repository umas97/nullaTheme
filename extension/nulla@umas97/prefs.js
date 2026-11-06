import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [
    ['top-left', 'In alto a sinistra'], ['top-center', 'In alto al centro'], ['top-right', 'In alto a destra'],
    ['center-left', 'Al centro a sinistra'], ['center', 'Al centro'], ['center-right', 'Al centro a destra'],
    ['bottom-left', 'In basso a sinistra'], ['bottom-center', 'In basso al centro'], ['bottom-right', 'In basso a destra'],
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

const CLOCK_STYLES = [
    ['classic', 'Classico', 'Ora grande e leggera, data sotto'],
    ['thin', 'Sottile', 'Ora enorme e sottilissima, data maiuscola spaziata'],
    ['bold', 'Deciso', 'Ora compatta in grassetto'],
    ['stacked', 'Impilato', 'Ore sopra, minuti sotto'],
    ['accent', 'Accento', 'Minuti nel colore d\'accento'],
    ['elegant', 'Elegante', 'Giorno in evidenza, ora nella riga sotto'],
    ['pill', 'Pillola', 'Una riga in una capsula di vetro'],
    ['analog', 'Analogico', 'Quadrante minimal con lancette'],
];

function styleRow(settings) {
    const row = new Adw.ComboRow({
        title: 'Stile',
        model: Gtk.StringList.new(CLOCK_STYLES.map(([, name]) => name)),
    });
    const sync = () => {
        const index = CLOCK_STYLES.findIndex(([id]) => id === settings.get_string('clock-style'));
        row.selected = Math.max(index, 0);
        row.subtitle = CLOCK_STYLES[row.selected][2];
    };
    row.connect('notify::selected', () => {
        const [id, , description] = CLOCK_STYLES[row.selected];
        row.subtitle = description;
        if (settings.get_string('clock-style') !== id)
            settings.set_string('clock-style', id);
    });
    settings.connect('changed::clock-style', sync);
    sync();
    settings.bind('clock-widget', row, 'sensitive', Gio.SettingsBindFlags.GET);
    return row;
}

const BAR_CLOCK_MODES = [
    ['smart', 'Intelligente', 'Campanella; diventa l\'ora quando l\'orologio sul desktop è coperto'],
    ['always', 'Sempre l\'ora', 'HH:MM al posto della campanella'],
    ['never', 'Sempre la campanella', 'L\'ora resta solo sul desktop'],
];

/** Cosa mostra il pulsante delle notifiche nella barra. */
function barClockRow(settings) {
    const row = new Adw.ComboRow({
        title: 'Ora nella barra',
        model: Gtk.StringList.new(BAR_CLOCK_MODES.map(([, name]) => name)),
    });
    const sync = () => {
        const index = BAR_CLOCK_MODES.findIndex(([id]) => id === settings.get_string('bar-clock'));
        row.selected = Math.max(index, 0);
        row.subtitle = BAR_CLOCK_MODES[row.selected][2];
    };
    row.connect('notify::selected', () => {
        const [id, , description] = BAR_CLOCK_MODES[row.selected];
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
    const row = new Adw.ActionRow({title: 'Dimensione'});
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
        title: 'Posizione',
        subtitle: 'Sul monitor principale',
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
    POSITIONS.forEach(([value, label], i) => {
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
            title: 'Aspetto',
            description: "L'accento si sceglie in Impostazioni → Aspetto.",
        });
        look.add(spinRow(settings, 'transparency', 'Trasparenza della shell',
            'Barra, menu, notifiche; è lo slider delle impostazioni rapide', 0, 100));
        look.add(spinRow(settings, 'radius', 'Raggio degli angoli',
            'In pixel; menu, finestre e notifiche ne derivano', 0, 24));
        page.add(look);

        const windows = new Adw.PreferencesGroup({
            title: 'Finestre delle app',
            description: 'Barra del titolo e sidebar. Le app già aperte vanno riaperte.',
        });
        windows.add(switchRow(settings, 'app-transparency-enabled', 'Trasparenza delle finestre',
            'Se disattivata, barra del titolo e sidebar sono opache'));
        const appAmount = spinRow(settings, 'app-transparency', 'Quantità',
            '0 = opaco, 100 = massima; indipendente dalla shell', 0, 100);
        settings.bind('app-transparency-enabled', appAmount, 'sensitive', Gio.SettingsBindFlags.GET);
        windows.add(appAmount);
        page.add(windows);

        const panel = new Adw.PreferencesGroup({title: 'Barra superiore'});
        panel.add(spinRow(settings, 'panel-height', 'Altezza',
            'In pixel; la pillola e le icone si adattano', 24, 56));
        panel.add(switchRow(settings, 'panel-apps', 'App nella barra',
            'Preferite e app aperte al centro; data e ora diventano una campanella'));
        panel.add(barClockRow(settings));
        page.add(panel);

        const quick = new Adw.PreferencesGroup({title: 'Impostazioni rapide'});
        quick.add(switchRow(settings, 'icon-toggles', 'Toggle a icone tonde',
            'Stile Control Center; clic destro per il sottomenu (es. reti Wi-Fi)'));
        quick.add(switchRow(settings, 'show-slider', 'Slider della trasparenza',
            'Sotto lo slider della luminosità'));
        quick.add(switchRow(settings, 'toggle-editor', 'Modifica dei toggle',
            'Matita in fondo al pannello: nascondi, aggiungi e riordina i toggle'));
        const reset = new Adw.ActionRow({
            title: 'Ripristina i toggle',
            subtitle: 'Torna all\'ordine di GNOME e mostra di nuovo tutti i toggle',
        });
        const resetButton = new Gtk.Button({
            label: 'Ripristina',
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

        const clock = new Adw.PreferencesGroup({title: 'Orologio sul desktop'});
        clock.add(switchRow(settings, 'clock-widget', 'Mostra orologio',
            'Il colore si adatta allo sfondo per restare leggibile'));
        clock.add(styleRow(settings));
        clock.add(sizeRow(settings));
        clock.add(positionPicker(settings));
        page.add(clock);

        const lock = new Adw.PreferencesGroup({
            title: 'Blocco e accesso',
            description: 'La schermata di accesso (GDM) non carica le estensioni: si installa a parte con\n'
                + 'tools/gdm/install-gdm.sh (richiede la password di amministratore).',
        });
        lock.add(switchRow(settings, 'lock-screen', 'Schermata di blocco Nulla',
            'Orologio nello stile del desktop, avatar piccolo, password a pillola di vetro'));
        page.add(lock);

        const behaviour = new Adw.PreferencesGroup({title: 'Integrazioni'});
        behaviour.add(switchRow(settings, 'apply-gtk', 'Applica alle app GTK',
            'Le app già aperte vanno riaperte per vedere le modifiche'));
        behaviour.add(switchRow(settings, 'apply-vscode', 'VS Code',
            'Tema con l\'accento di sistema e pulsanti finestra di Nulla; visibile alla riapertura'));
        behaviour.add(switchRow(settings, 'apply-chrome', 'Chrome',
            'Tema GTK con i pulsanti finestra di Nulla; si applica quando Chrome è chiuso'));
        behaviour.add(switchRow(settings, 'sync-blur', 'Allinea Blur my Shell',
            'Usa gli stessi raggi degli angoli per la sfocatura'));
        page.add(behaviour);

        window.add(page);
    }
}
