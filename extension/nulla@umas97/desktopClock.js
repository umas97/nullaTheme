// Nulla — orologio minimal sul desktop (sopra lo sfondo, sotto le finestre).
// La grafica (preset, ora, quadrante) è in clockFace.js; qui posizione e colore.
//
// Il colore del testo si adatta allo sfondo: si legge la luminosità media
// dell'immagine esattamente nella zona coperta dal widget (tenendo conto di
// come GNOME ritaglia/scala lo sfondo) e si sceglie testo chiaro o scuro.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DESKTOP_CLOCK_NAME} from './barClock.js';
import {ClockFace} from './clockFace.js';

const MARGIN = 48;
const SAMPLE_SIZE = 512;         // lato massimo dell'immagine ridotta usata per il campionamento
const DARK_TEXT_THRESHOLD = 0.6; // sopra questa luminosità media il testo diventa scuro

function parsePosition(value) {
    if (value === 'center')
        return ['center', 'center'];
    const [row, col] = value.split('-');
    return [row, col];
}

export class DesktopClock {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._wallpaper = null;  // {key, pixbuf, width, height}
        this._recolorId = 0;

        this._face = new ClockFace(this._settings, {onRestyle: () => this._place()});
        this._actor = this._face.actor;
        this._actor.name = DESKTOP_CLOCK_NAME; // la barra lo cerca per sapere se è coperto
        Main.layoutManager._backgroundGroup.add_child(this._actor);

        this._settings.connectObject('changed::clock-position', () => this._place(), this);
        this._interface.connectObject('changed::color-scheme', () => this._queueRecolor(true), this);
        this._background.connectObject('changed', () => this._queueRecolor(true), this);
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._place(),
            'startup-complete', () => this._place(),
            this);
        global.display.connectObject('workareas-changed', () => this._place(), this);
        this._actor.connectObject(
            'notify::width', () => this._place(),
            'notify::height', () => this._place(),
            this);

        this._place();
    }

    disable() {
        if (this._recolorId)
            GLib.source_remove(this._recolorId);
        this._recolorId = 0;

        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._background.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);

        this._face.destroy();
        this._face = this._actor = null;
        this._interface = this._background = this._wallpaper = null;
    }

    // ───────────── posizione ─────────────

    _place() {
        const layout = Main.layoutManager;
        const monitor = layout.primaryMonitor;
        if (!monitor || !this._actor)
            return;

        const area = layout.getWorkAreaForMonitor(layout.primaryIndex);
        const [row, col] = parsePosition(this._settings.get_string('clock-position'));

        this._face.setAlign(col);

        const [, width] = this._actor.get_preferred_width(-1);
        const [, height] = this._actor.get_preferred_height(width);

        const x = {
            left: area.x + MARGIN,
            center: area.x + (area.width - width) / 2,
            right: area.x + area.width - width - MARGIN,
        }[col];
        const y = {
            top: area.y + MARGIN,
            center: area.y + (area.height - height) / 2,
            bottom: area.y + area.height - height - MARGIN,
        }[row];

        this._actor.set_position(Math.round(x), Math.round(y));
        this._queueRecolor(false);
    }

    // ───────────── colore adattivo ─────────────

    _queueRecolor(reload) {
        if (reload)
            this._wallpaper = null;
        if (this._recolorId)
            return;
        this._recolorId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._recolorId = 0;
            try {
                this._recolor();
            } catch (e) {
                console.warn(`[Nulla] orologio: ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _recolor() {
        const [x, y] = this._actor.get_position();
        const [, width] = this._actor.get_preferred_width(-1);
        const [, height] = this._actor.get_preferred_height(width);
        const luminance = this._sampleLuminance(x, y, width, height);

        if (luminance !== null && luminance > DARK_TEXT_THRESHOLD)
            this._actor.add_style_class_name('nulla-clock-dark');
        else
            this._actor.remove_style_class_name('nulla-clock-dark');
    }

    _loadWallpaper() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        const uri = this._background.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
        const options = this._background.get_string('picture-options');
        if (!uri || options === 'none')
            return null;

        const file = Gio.File.new_for_uri(uri);
        const path = file.get_path();
        if (!path || path.endsWith('.xml') || !file.query_exists(null))
            return null;

        // Stesso percorso ma contenuto nuovo (es. ~/.config/background): conta la data.
        const mtime = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint64('time::modified');
        const key = `${uri}|${mtime}`;
        if (this._wallpaper?.key === key)
            return this._wallpaper;

        const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(path);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, SAMPLE_SIZE, SAMPLE_SIZE, true);
        this._wallpaper = {key, pixbuf, width, height};
        return this._wallpaper;
    }

    /** Luminosità media 0..1 dello sfondo nel rettangolo (coordinate dello schermo). */
    _sampleLuminance(x, y, w, h) {
        const monitor = Main.layoutManager.primaryMonitor;
        const options = this._background.get_string('picture-options');

        if (options === 'none') {
            const color = this._background.get_string('primary-color');
            const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
            if (!m)
                return null;
            const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }

        const wallpaper = this._loadWallpaper();
        if (!wallpaper)
            return null;

        const {pixbuf} = wallpaper;
        const iw = pixbuf.get_width();
        const ih = pixbuf.get_height();
        const mw = monitor.width;
        const mh = monitor.height;

        // Come GNOME dispone l'immagine sul monitor: scala (sx, sy) e scostamento (ox, oy).
        let sx, sy;
        switch (options) {
        case 'stretched':
            [sx, sy] = [mw / iw, mh / ih];
            break;
        case 'scaled': {
            const s = Math.min(mw / iw, mh / ih);
            [sx, sy] = [s, s];
            break;
        }
        case 'centered':
        case 'wallpaper': {
            const s = wallpaper.width / iw; // dimensione originale
            [sx, sy] = [s, s];
            break;
        }
        default: { // zoom, spanned
            const s = Math.max(mw / iw, mh / ih);
            [sx, sy] = [s, s];
        }
        }
        const ox = (mw - iw * sx) / 2;
        const oy = (mh - ih * sy) / 2;

        const clampX = v => Math.min(iw - 1, Math.max(0, Math.round(v)));
        const clampY = v => Math.min(ih - 1, Math.max(0, Math.round(v)));
        const x0 = clampX((x - monitor.x - ox) / sx);
        const x1 = clampX((x + w - monitor.x - ox) / sx);
        const y0 = clampY((y - monitor.y - oy) / sy);
        const y1 = clampY((y + h - monitor.y - oy) / sy);

        const pixels = pixbuf.get_pixels();
        const stride = pixbuf.get_rowstride();
        const channels = pixbuf.get_n_channels();
        const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 4000)));

        let sum = 0;
        let count = 0;
        for (let py = y0; py <= y1; py += step) {
            for (let px = x0; px <= x1; px += step) {
                const i = py * stride + px * channels;
                sum += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
                count++;
            }
        }
        return count ? sum / count : null;
    }
}
