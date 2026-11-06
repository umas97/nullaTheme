// Estensione di servizio per tools/preview.sh — gira SOLO nella shell headless
// di prova: apre le finestre demo, i menu, scatta screenshot e chiude la shell.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('NULLA_PREVIEW_OUT');
const DEMOS = GLib.getenv('NULLA_PREVIEW_DEMOS');
const NULLA_SCHEMA = 'org.gnome.shell.extensions.nulla';

const wait = ms => new Promise(resolve =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));

function shot(name) {
    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        new Shell.Screenshot().screenshot(false, stream, (shooter, res) => {
            try {
                shooter.screenshot_finish(res);
                stream.close(null);
                console.log(`[preview] screenshot ${name}`);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

function findWindow(title) {
    return global.get_window_actors().map(a => a.meta_window)
        .find(w => w.get_title() === title);
}

export default class PreviewExtension extends Extension {
    enable() {
        this._run()
            .catch(e => console.error(`[preview] ${e}\n${e.stack}`))
            .finally(() => global.context.terminate());
    }

    disable() {}

    async _run() {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const move = (x, y) => this._pointer.notify_absolute_motion(
            GLib.get_monotonic_time(), x, y);

        await wait(3000);
        Main.overview.hide();
        move(800, 500);

        for (const demo of ['gtk4-demo.py', 'gtk3-demo.py'])
            Gio.Subprocess.new(['python3', '-I', `${DEMOS}/${demo}`], Gio.SubprocessFlags.NONE);
        await wait(5000);

        const gtk4 = findWindow('Nulla GTK4');
        const gtk3 = findWindow('Nulla GTK3');
        gtk4?.move_resize_frame(false, 320, 110, 900, 620);  // lascia libero l'orologio in alto a sinistra
        gtk3?.move_resize_frame(false, 1110, 600, 450, 300);
        await wait(1500);

        await this._testDrag(move);

        // Puntatore sul pulsante "chiudi" (ultimo a destra): simboli + colore chiaro
        if (gtk4) {
            const r = gtk4.get_frame_rect();
            move(r.x + r.width - 18, r.y + 24);
        }
        await wait(800);
        await shot('01-desktop-hover-gtk4');

        if (gtk3) {
            const r = gtk3.get_frame_rect();
            move(r.x + r.width - 16, r.y + 23);
        }
        await wait(800);
        await shot('02-desktop-hover-gtk3');
        move(800, 980);

        const qs = Main.panel.statusArea.quickSettings;
        qs.menu.open(false);
        await wait(1500);
        await shot('03-quick-settings');
        qs.menu.close(false);

        const date = Main.panel.statusArea.dateMenu;
        date.menu.open(false);
        await wait(1500);
        await shot('04-calendar');
        date.menu.close(false);

        Main.overview.show();
        await wait(2000);
        await shot('05-overview');
        Main.overview.dash.showAppsButton.checked = true;
        await wait(2000);
        await shot('06-app-grid');
        Main.overview.dash.showAppsButton.checked = false;
        Main.overview.hide();
        await wait(1500);

        // Stesso pannello con trasparenza massima e minima
        const settings = this.getSettingsFor(NULLA_SCHEMA);
        for (const value of [100, 0]) {
            settings?.set_int('transparency', value);
            await wait(1200);
            qs.menu.open(false);
            await wait(1500);
            await shot(`07-quick-settings-t${value}`);
            qs.menu.close(false);
            await wait(500);
        }
        settings?.reset('transparency');
        await wait(800);

        // Orologio sul desktop in due posizioni, con le finestre minimizzate
        gtk4?.minimize();
        gtk3?.minimize();
        // Ogni preset dell'orologio: in centro a sinistra (sfondo scuro) e in alto al
        // centro (neve chiara → testo scuro).
        const styles = ['classic', 'thin', 'bold', 'stacked', 'accent', 'elegant', 'pill', 'analog'];
        for (const position of ['center-left', 'top-center']) {
            settings?.set_string('clock-position', position);
            for (const style of styles) {
                settings?.set_string('clock-style', style);
                await wait(700);
                await shot(`09-orologio-${position}-${style}`);
            }
        }
        settings?.reset('clock-style');
        settings?.reset('clock-position');
        await wait(500);

        await this._testToggleEditor(move);
        await this._testHoverAndClockSize(move);

        // Finestra delle preferenze dell'estensione Nulla
        Gio.Subprocess.new(['gnome-extensions', 'prefs', 'nulla@umas97'], Gio.SubprocessFlags.NONE);
        await wait(5000);
        await shot('08-preferenze');

        await this._testGdmCss();

        // Ultimo: schermata di blocco (non si può sbloccare senza password, la shell poi chiude)
        await this._testLockScreen();
    }

    // Trascina la prima icona della barra oltre la terza e verifica l'ordine dei preferiti.
    async _testDrag(move) {
        const taskbar = Main.panel._centerBox.get_children()
            .find(c => c.has_style_class_name?.('nulla-taskbar'));
        const icons = taskbar?.get_children() ?? [];
        if (icons.length < 3) {
            console.log(`[preview] drag: icone nella barra: ${icons.length}`);
            return;
        }
        const favorites = () => global.settings.get_strv('favorite-apps').join(', ');
        console.log(`[preview] drag: preferiti prima: ${favorites()}`);

        const center = actor => {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return [x + w / 2, y + h / 2];
        };
        const [sx, sy] = center(icons[0]);
        const [tx] = center(icons[2]);
        const button = (state) => this._pointer.notify_button(
            GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, state);

        move(sx, sy);
        await wait(300);
        button(Clutter.ButtonState.PRESSED);
        await wait(100);
        for (let i = 1; i <= 20; i++) {
            move(sx + ((tx + 20 - sx) * i) / 20, sy + 2);
            await wait(30);
        }
        await wait(500);
        await shot('00-trascinamento');
        button(Clutter.ButtonState.RELEASED);
        await wait(1500);
        console.log(`[preview] drag: preferiti dopo:  ${favorites()}`);
        await shot('00-dopo-trascinamento');
    }

    // Modalità modifica dei toggle: matita, tocco per nascondere, trascinamento, ✓.
    async _testToggleEditor(move) {
        const qs = Main.panel.statusArea.quickSettings;
        const grid = qs.menu._grid;
        const settings = this.getSettingsFor(NULLA_SCHEMA);
        const center = actor => {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return [x + w / 2, y + h / 2];
        };
        const button = state => this._pointer.notify_button(
            GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, state);
        const click = async actor => {
            const [x, y] = center(actor);
            move(x, y);
            await wait(250);
            button(Clutter.ButtonState.PRESSED);
            await wait(80);
            button(Clutter.ButtonState.RELEASED);
            await wait(600);
        };
        const toggles = () => grid.get_children().filter(c =>
            c.visible && (c.has_style_class_name?.('nulla-icon-toggle') || c.has_style_class_name?.('quick-toggle')));
        const states = () => toggles().map(t => `${t.constructor.$gtype.name.replace(/^Gjs_ui_status_/, '')}=${t.checked}`).join(' ');
        const log = msg => console.log(`[preview] editor: ${msg}`);

        qs.menu.open(false);
        await wait(1200);
        const edit = grid.get_children().find(c => c.has_style_class_name?.('nulla-qs-edit-row'));
        if (!edit) {
            log('riga della matita non trovata');
            qs.menu.close(false);
            return;
        }
        log(`stati prima: ${states()}`);
        await click(edit.get_last_child());
        await shot('10-modifica-toggle');

        const before = toggles();
        log(`toggle in modifica: ${before.length}`);
        await click(before.at(-1));               // tocco: nasconde l'ultimo
        await shot('11-modifica-nascosto');
        log(`nascosti: ${settings.get_strv('hidden-toggles').join(', ')}`);

        const list = toggles();
        const [sx, sy] = center(list[0]);
        const [tx, ty] = center(list[2]);
        move(sx, sy);
        await wait(250);
        button(Clutter.ButtonState.PRESSED);
        await wait(300);
        for (let i = 1; i <= 20; i++) {
            move(sx + ((tx + 8 - sx) * i) / 20, sy + ((ty - sy) * i) / 20);
            await wait(30);
        }
        await wait(400);
        await shot('12-modifica-trascinamento');
        button(Clutter.ButtonState.RELEASED);
        await wait(1000);
        log(`ordine: ${settings.get_strv('toggle-order').map(id => id.replace(/^Gjs_ui_status_/, '')).join(', ')}`);

        await click(edit.get_last_child());       // ✓ Fine
        await shot('13-dopo-modifica');
        log(`stati dopo: ${states()}`);
        log(`menu ancora aperto: ${qs.menu.isOpen}`);
        qs.menu.close(false);
        settings.reset('hidden-toggles');
        settings.reset('toggle-order');
        await wait(500);
    }

    // Hover sui toggle semplici (devono restare tondi) e dimensione dell'orologio.
    async _testHoverAndClockSize(move) {
        const qs = Main.panel.statusArea.quickSettings;
        const settings = this.getSettingsFor(NULLA_SCHEMA);
        qs.menu.open(false);
        await wait(1200);
        for (const name of ['DarkMode', 'DoNotDisturb']) {
            const toggle = qs.menu._grid.get_children()
                .find(c => c.visible && c.constructor.$gtype.name.includes(name));
            if (!toggle)
                continue;
            const [x, y] = toggle.get_transformed_position();
            const [w, h] = toggle.get_transformed_size();
            move(x + w / 2, y + h / 2);
            await wait(700);
            await shot(`14-hover-${name}`);
        }
        qs.menu.close(false);
        move(800, 980);
        await wait(600);

        settings.set_string('clock-position', 'center-left');
        for (const style of ['classic', 'analog']) {
            settings.set_string('clock-style', style);
            for (const size of [60, 160]) {
                settings.set_int('clock-size', size);
                await wait(900);
                await shot(`15-orologio-${style}-${size}`);
            }
        }
        for (const key of ['clock-size', 'clock-style', 'clock-position'])
            settings.reset(key);
        await wait(500);
    }

    async _testLockScreen() {
        for (const w of global.get_window_actors().map(a => a.meta_window))
            w.minimize?.();
        Main.screenShield.lock(false);
        await wait(2500);
        // Dopo il blocco GNOME oscura lo schermo: "muoviamo il mouse".
        Main.screenShield._wakeUpScreen();
        await wait(1200);
        await shot('16-blocco');
        const dialog = Main.screenShield._dialog;
        console.log(`[preview] blocco: finestra=${!!dialog} orologio Nulla=${!!dialog?._clock?.get_children().find(c => c.has_style_class_name?.('nulla-clock-lock'))}`);
        dialog?._showPrompt?.();
        await wait(1500);
        Main.screenShield._wakeUpScreen();
        await wait(1000);
        await shot('17-blocco-password');
    }

    // Impostazioni rapide con il SOLO CSS della schermata di accesso (come in GDM:
    // niente codice di Nulla, niente classe .nulla).
    async _testGdmCss() {
        const path = GLib.getenv('NULLA_PREVIEW_GDM_CSS');
        const file = path ? Gio.File.new_for_path(path) : null;
        if (!file?.query_exists(null)) {
            console.log('[preview] gdm: CSS non disponibile');
            return;
        }
        const settings = this.getSettingsFor(NULLA_SCHEMA);
        const qs = Main.panel.statusArea.quickSettings;
        settings.set_boolean('icon-toggles', false);
        settings.set_boolean('toggle-editor', false);
        await wait(800);
        Main.uiGroup.remove_style_class_name('nulla');
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        theme.load_stylesheet(file);
        await wait(500);

        qs.menu.open(false);
        await wait(1500);
        await shot('18-gdm-impostazioni-rapide');
        const toggle = qs.menu._grid.get_children().find(c => c.visible && c.constructor.$gtype.name.includes('DarkMode'));
        if (toggle) {
            const [x, y] = toggle.get_transformed_position();
            const [w, h] = toggle.get_transformed_size();
            this._pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + w / 2, y + h / 2);
            await wait(700);
            await shot('19-gdm-hover');
        }
        qs.menu.close(false);
        await wait(500);

        theme.unload_stylesheet(file);
        Main.uiGroup.add_style_class_name('nulla');
        settings.reset('icon-toggles');
        settings.reset('toggle-editor');
        await wait(800);
    }

    getSettingsFor(schemaId) {
        const nulla = Main.extensionManager.lookup('nulla@umas97');
        if (!nulla)
            return null;
        const source = Gio.SettingsSchemaSource.new_from_directory(
            nulla.dir.get_child('schemas').get_path(),
            Gio.SettingsSchemaSource.get_default(), false);
        return new Gio.Settings({settings_schema: source.lookup(schemaId, false)});
    }
}
