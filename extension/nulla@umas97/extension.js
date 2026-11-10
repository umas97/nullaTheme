// Nulla — tema minimal per GNOME Shell e app GTK.
//
// Cosa fa l'estensione:
//  1. genera il foglio di stile della shell da theme/shell.css.in e lo carica
//     sopra il tema di sistema (Yaru), rigenerandolo quando cambiano le impostazioni;
//  2. scrive ~/.config/gtk-{3,4}.0/nulla.css per le app (importato da gtk.css);
//  3. aggiunge lo slider "Trasparenza" nelle impostazioni rapide;
//  4. allinea i raggi della sfocatura di Blur my Shell a quelli del tema;
//  5. applica (o toglie) il tema a VS Code e Chrome, tramite apps.py;
//  6. attiva le funzioni separate (toggle a icone e loro modifica, app nella
//     barra, orologio sul desktop, schermata di blocco), ognuna col suo interruttore.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickSlider} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {blurRadii, computeTokens, render} from './tokens.js';
import {ensureDir, readText, writeGtkFiles, writeText, writeVscodeTheme} from './files.js';
import {IconToggles} from './quickToggles.js';
import {ToggleEditor} from './toggleEditor.js';
import {PanelLayout} from './panelLayout.js';
import {DesktopClock} from './desktopClock.js';
import {LockScreen} from './lockScreen.js';

const STYLE_CLASS = 'nulla';
const BLUR_UUID = 'blur-my-shell@aunetx';
const BLUR_POPUP_SCHEMA = 'org.gnome.shell.extensions.blur-my-shell.popup';
const QS_COLUMNS = 2;

const SHELL_DEBOUNCE_MS = 60;    // ridisegno della shell mentre si trascina lo slider
const SAVE_DEBOUNCE_MS = 200;    // scrittura del valore in gsettings
const FILES_DEBOUNCE_MS = 500;   // file GTK e Blur my Shell (non servono in tempo reale)
const APP_RETRY_MS = 30 * 60000; // Chrome aperto: si riprova quando si chiude (o, al più, ogni 30 min)
const APP_CLOSE_DELAY_MS = 2000; // margine perché i processi dell'app finiscano di uscire
const APPS_BUSY = 3;             // codice di uscita di apps.py: app aperta

const TransparencySlider = GObject.registerClass(
class NullaTransparencySlider extends QuickSlider {
    _init(settings, gicon, onPreview) {
        super._init({gicon, iconLabel: _('Transparency')});

        this._settings = settings;
        this._onPreview = onPreview;
        this._saveId = 0;

        this.slider.accessible_name = _('Transparency');
        this.slider.connectObject('notify::value',
            () => this._onSliderChanged(), this);
        this._settings.connectObject('changed::transparency',
            () => this._syncFromSettings(), this);
        this._syncFromSettings();

        this.connect('destroy', () => {
            if (this._saveId)
                GLib.source_remove(this._saveId);
            this._saveId = 0;
        });
    }

    get percent() {
        return Math.round(this.slider.value * 100);
    }

    _onSliderChanged() {
        if (this._syncing)
            return;

        // Anteprima immediata della shell, salvataggio con calma.
        this._onPreview(this.percent);

        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
            this._saveId = 0;
            this._settings.set_int('transparency', this.percent);
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncFromSettings() {
        if (this._saveId)
            return; // l'utente sta ancora trascinando
        this._syncing = true;
        this.slider.value = this._settings.get_int('transparency') / 100;
        this._syncing = false;
    }
});

export default class NullaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._timeouts = new Map();
        this._stylesheet = null;
        this._generation = 0;
        this._previewTransparency = null;

        this._cacheDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'nulla']));
        ensureDir(this._cacheDir);
        this._cleanCache();

        Main.uiGroup.add_style_class_name(STYLE_CLASS);

        // Chiaro o scuro segue Impostazioni → Aspetto.
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interface.connectObject('changed::color-scheme', () => this._onSettingsChanged(), this);

        this._settings.connectObject(
            'changed::transparency', () => this._onSettingsChanged(),
            'changed::radius', () => this._onSettingsChanged(),
            'changed::panel-height', () => this._onSettingsChanged(),
            'changed::clock-size', () => this._onSettingsChanged(),
            'changed::apply-gtk', () => this._debounce('files', FILES_DEBOUNCE_MS, () => this._writeGtk()),
            'changed::app-transparency', () => this._debounce('files', FILES_DEBOUNCE_MS, () => this._writeGtk()),
            'changed::app-transparency-enabled', () => this._debounce('files', FILES_DEBOUNCE_MS, () => this._writeGtk()),
            'changed::apply-vscode', () => this._debounce('vscode', FILES_DEBOUNCE_MS, () => this._syncVscode()),
            'changed::apply-chrome', () => this._debounce('chrome', FILES_DEBOUNCE_MS, () => this._runApps('chrome')),
            'changed::sync-blur', () => this._debounce('files', FILES_DEBOUNCE_MS, () => this._syncBlur()),
            'changed::show-slider', () => this._syncSlider(),
            'changed::icon-toggles', () => this._syncFeature('icon-toggles'),
            'changed::toggle-editor', () => this._syncFeature('toggle-editor'),
            'changed::panel-apps', () => this._syncFeature('panel-apps'),
            'changed::clock-widget', () => this._syncFeature('clock-widget'),
            'changed::lock-screen', () => this._syncFeature('lock-screen'),
            this);

        this._rebuildShell();
        this._writeGtk();

        // VS Code: tema rigenerato quando cambia l'accento di GNOME.
        // L'accento effettivo lo fornisce St.ThemeContext; il cambio lo notifica St.Settings.
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        St.Settings.get().connectObject('notify::accent-color',
            () => this._debounce('vscode', FILES_DEBOUNCE_MS, () => this._writeVscodeTheme()), this);
        this._appsCancellable = new Gio.Cancellable();
        this._appWatches = new Map();
        this._syncVscode();
        // A ogni accesso, perché Chrome Sync può rimettere il tema dell'account.
        this._runApps('chrome');
        this._syncBlur();
        this._syncSlider();

        // Funzioni attivabili singolarmente dalle preferenze.
        this._featureFactories = {
            'icon-toggles': () => new IconToggles(),
            'toggle-editor': () => new ToggleEditor(this._settings),
            'panel-apps': () => new PanelLayout(this.dir, this._settings),
            'clock-widget': () => new DesktopClock(this._settings),
            'lock-screen': () => new LockScreen(this._settings),
        };
        this._features = new Map();
        for (const key of Object.keys(this._featureFactories))
            this._syncFeature(key);
    }

    disable() {
        this._appsCancellable.cancel();
        this._appsCancellable = null;
        for (const app of [...this._appWatches.keys()])
            this._unwatchApp(app);
        for (const id of this._timeouts.values())
            GLib.source_remove(id);
        this._timeouts.clear();

        for (const feature of this._features.values())
            feature.disable();
        this._features = null;

        this._removeSlider();
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._interface = null;
        St.Settings.get().disconnectObject(this);
        this._themeContext = null;

        if (this._stylesheet) {
            St.ThemeContext.get_for_stage(global.stage).get_theme()
                .unload_stylesheet(this._stylesheet);
            this._stylesheet = null;
        }
        this._cleanCache();

        Main.uiGroup.remove_style_class_name(STYLE_CLASS);

        // I file GTK restano: le app mantengono il tema anche a estensione
        // disattivata. Li rimuove ./uninstall.sh.
        this._settings = null;
        this._timeouts = null;
    }

    // ───────────── impostazioni → tema ─────────────

    get _dark() {
        return this._interface.get_string('color-scheme') === 'prefer-dark';
    }

    _tokens(dark = this._dark) {
        const transparency = this._previewTransparency ??
            this._settings.get_int('transparency');
        const appTransparency = this._settings.get_boolean('app-transparency-enabled')
            ? this._settings.get_int('app-transparency') : 0;
        return computeTokens(transparency, this._settings.get_int('radius'),
            this._settings.get_int('panel-height'), appTransparency,
            this._settings.get_int('clock-size'), dark);
    }

    _onSettingsChanged() {
        this._previewTransparency = null;
        this._debounce('shell', SHELL_DEBOUNCE_MS, () => this._rebuildShell());
        this._debounce('files', FILES_DEBOUNCE_MS, () => {
            this._writeGtk();
            this._syncBlur();
        });
    }

    _preview(transparency) {
        this._previewTransparency = transparency;
        this._debounce('shell', SHELL_DEBOUNCE_MS, () => this._rebuildShell());
    }

    _debounce(key, ms, callback) {
        const old = this._timeouts.get(key);
        if (old)
            GLib.source_remove(old);
        this._timeouts.set(key, GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(key);
            try {
                callback();
            } catch (e) {
                console.error(`[Nulla] ${key}: ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        }));
    }

    // ───────────── GNOME Shell ─────────────

    _rebuildShell() {
        const themeDir = this.dir.get_child('theme');
        const tokens = this._tokens();
        // Shell + stili di blocco/accesso (condivisi con GDM, qui con scope .nulla)
        const css = render(readText(themeDir.get_child('shell.css.in')), tokens) + '\n' +
            render(readText(themeDir.get_child('auth.css.in')), {...tokens, scope: '.nulla'});

        // Un nome nuovo a ogni generazione evita qualsiasi cache di St.
        this._generation++;
        const file = this._cacheDir.get_child(`shell-${this._generation}.css`);
        writeText(file, css);

        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        theme.load_stylesheet(file);

        const previous = this._stylesheet;
        this._stylesheet = file;
        if (previous) {
            theme.unload_stylesheet(previous);
            previous.delete(null);
        }
    }

    _cleanCache() {
        const enumerator = this._cacheDir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
        for (const info of enumerator) {
            const name = info.get_name();
            if (name.startsWith('shell-') && name.endsWith('.css'))
                this._cacheDir.get_child(name).delete(null);
        }
    }

    // ───────────── App GTK ─────────────

    _writeGtk() {
        writeGtkFiles(this.dir, dark => this._tokens(dark), this._dark,
            this._settings.get_boolean('apply-gtk'));
    }

    // ───────────── VS Code ─────────────

    _syncVscode() {
        // Prima i file del tema, poi settings.json che lo seleziona.
        if (this._settings.get_boolean('apply-vscode'))
            this._writeVscodeTheme();
        this._runApps('vscode');
    }

    _writeVscodeTheme() {
        if (!this._settings.get_boolean('apply-vscode'))
            return;
        try {
            // get_accent_color() → [accento, colore del testo sopra l'accento]
            const [accent] = this._themeContext.get_accent_color();
            const hex = `#${[accent.red, accent.green, accent.blue]
                .map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
            writeVscodeTheme(this.dir, hex);
        } catch (e) {
            console.warn(`[Nulla] tema VS Code: ${e.message}`);
        }
    }

    // ───────────── VS Code e Chrome: impostazioni delle app ─────────────

    /** Applica o toglie il tema all'app secondo l'interruttore (vedi apps.py). */
    _runApps(app) {
        const action = this._settings.get_boolean(`apply-${app}`) ? 'apply' : 'restore';
        const proc = Gio.Subprocess.new(
            ['python3', '-I', this.dir.get_child('apps.py').get_path(), app, action],
            Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(null, this._appsCancellable, (_p, res) => {
            try {
                const [, , stderr] = proc.communicate_utf8_finish(res);
                const status = proc.get_exit_status();
                if (status === APPS_BUSY)
                    this._retryWhenClosed(app);
                else if (status !== 0)
                    console.warn(`[Nulla] ${app} ${action}: uscita ${status} ${stderr}`);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`[Nulla] ${app} ${action}: ${e.message}`);
            }
        });
    }

    /**
     * App aperta: invece di rilanciare apps.py a intervalli fissi si aspetta
     * che GNOME la segnali chiusa. Il timer lungo copre Chrome rimasto in
     * background senza finestre (per GNOME è già "chiuso").
     */
    _retryWhenClosed(app) {
        const appSystem = Shell.AppSystem.get_default();
        const retry = () => {
            this._unwatchApp(app);
            this._runApps(app);
        };
        this._unwatchApp(app);
        this._debounce(app, APP_RETRY_MS, retry);
        this._appWatches.set(app, appSystem.connect('app-state-changed', (_s, shellApp) => {
            if (shellApp.state === Shell.AppState.STOPPED && shellApp.get_id().includes(app))
                this._debounce(app, APP_CLOSE_DELAY_MS, retry);
        }));
    }

    _unwatchApp(app) {
        const id = this._appWatches.get(app);
        if (id)
            Shell.AppSystem.get_default().disconnect(id);
        this._appWatches.delete(app);
    }

    // ───────────── Blur my Shell ─────────────

    _syncBlur() {
        if (!this._settings.get_boolean('sync-blur'))
            return;

        const blur = Main.extensionManager.lookup(BLUR_UUID);
        if (!blur)
            return;

        const schemaDir = blur.dir.get_child('schemas');
        const source = schemaDir.query_exists(null)
            ? Gio.SettingsSchemaSource.new_from_directory(schemaDir.get_path(),
                Gio.SettingsSchemaSource.get_default(), false)
            : Gio.SettingsSchemaSource.get_default();
        const schema = source?.lookup(BLUR_POPUP_SCHEMA, true);
        if (!schema)
            return;

        const tokens = this._tokens();
        this._setBlurInts(schema, blurRadii(tokens));

        // La sfocatura del pannello deve avere gli angoli della pillola.
        const panel = source.lookup(schema.get_id().replace(/\.popup$/, '.panel'), true);
        if (panel)
            this._setBlurInts(panel, {'corner-radius': tokens.r_panel});
    }

    _setBlurInts(schema, values) {
        const settings = new Gio.Settings({settings_schema: schema});
        for (const [key, value] of Object.entries(values)) {
            if (!schema.has_key(key))
                continue;
            if (schema.get_key(key).get_value_type().dup_string() !== 'i')
                continue;
            if (settings.get_int(key) !== value)
                settings.set_int(key, value);
        }
    }

    // ───────────── Funzioni opzionali (toggle a icone, barra, orologio) ─────────────

    _syncFeature(key) {
        const wanted = this._settings.get_boolean(key);
        const active = this._features.get(key);

        if (!wanted && active) {
            active.disable();
            this._features.delete(key);
        } else if (wanted && !active) {
            // Le impostazioni rapide si popolano in modo asincrono all'avvio.
            if (['icon-toggles', 'toggle-editor'].includes(key) && !this._quickSettingsReady()) {
                this._debounce(`feature-${key}`, 200, () => this._syncFeature(key));
                return;
            }
            const feature = this._featureFactories[key]();
            try {
                feature.enable();
                this._features.set(key, feature);
            } catch (e) {
                console.error(`[Nulla] ${key}: ${e.message}\n${e.stack}`);
                try {
                    feature.disable();
                } catch {}
            }
        }
    }

    _quickSettingsReady() {
        return Main.panel.statusArea.quickSettings._backgroundApps !== undefined;
    }

    // ───────────── Slider nelle impostazioni rapide ─────────────

    _syncSlider() {
        if (this._settings.get_boolean('show-slider'))
            this._addSlider();
        else
            this._removeSlider();
    }

    _addSlider() {
        if (this._slider)
            return;

        const quickSettings = Main.panel.statusArea.quickSettings;

        // Il menu viene popolato in modo asincrono all'avvio della shell:
        // aspettiamo che gli indicatori di sistema siano al loro posto.
        if (quickSettings._backgroundApps === undefined) {
            this._debounce('slider', 200, () => this._addSlider());
            return;
        }

        const gicon = Gio.FileIcon.new(this.dir.get_child('icons')
            .get_child('nulla-transparency-symbolic.svg'));
        this._slider = new TransparencySlider(this._settings, gicon,
            value => this._preview(value));

        // Subito sotto lo slider della luminosità (o del volume, se manca).
        const anchor = [quickSettings._brightness, quickSettings._volumeInput, quickSettings._volumeOutput]
            .map(indicator => indicator?.quickSettingsItems?.at(-1))
            .find(item => item?.get_parent());
        const sibling = anchor?.get_next_sibling() ?? null;

        if (sibling)
            quickSettings.menu.insertItemBefore(this._slider, sibling, QS_COLUMNS);
        else
            quickSettings.menu.addItem(this._slider, QS_COLUMNS);
    }

    _removeSlider() {
        if (!this._slider)
            return;
        this._slider.menu?.destroy();
        this._slider.destroy();
        this._slider = null;
    }
}
