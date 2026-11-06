// Nulla — quadrante dell'orologio (solo la parte grafica), condiviso da
// orologio sul desktop e schermata di blocco.
//
// Struttura sempre uguale:
//   [giorno]  [ore][:][minuti]  [quadrante analogico]  [data]
// ogni preset sceglie cosa mostrare, i formati e la classe CSS
// `.nulla-clock-<preset>` (vedi theme/shell.css.in).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/**
 * time:     mostra ore:minuti in grande
 * stacked:  ore sopra, minuti sotto
 * weekday:  giorno della settimana in evidenza (prima riga)
 * date:     formato strftime della riga della data
 * withTime: 'before' | 'after' — l'ora va nella riga della data
 * upper:    data in maiuscolo; tracking: lettere spaziate (spazi sottili Unicode)
 * analog:   quadrante disegnato
 */
const CLOCK_PRESETS = {
    classic: {time: true, date: '%A %e %B'},
    thin: {time: true, date: '%A %e %B', upper: true, tracking: true},
    bold: {time: true, date: '%a %e %b'},
    stacked: {time: true, stacked: true, date: '%A %e %B'},
    accent: {time: true, date: '%A %e %B'},
    elegant: {weekday: true, date: '%e %B', withTime: 'after'},
    pill: {date: '%a %e %b', withTime: 'before'},
    analog: {analog: true, date: '%a %e %b'},
};

const ALIGN = {
    left: Clutter.ActorAlign.START,
    center: Clutter.ActorAlign.CENTER,
    right: Clutter.ActorAlign.END,
};

function capitalize(text) {
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export class ClockFace {
    /**
     * @param {Gio.Settings} settings impostazioni di Nulla (clock-style)
     * @param {object} params
     * @param {string} [params.styleClass] classe CSS aggiuntiva (es. 'nulla-clock-lock')
     * @param {Function} [params.onRestyle] chiamata quando cambia lo stile (per riposizionare)
     */
    constructor(settings, {styleClass = '', onRestyle = () => {}} = {}) {
        this._settings = settings;
        this._onRestyle = onRestyle;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._tickId = 0;
        this._now = GLib.DateTime.new_now_local();

        this.actor = new St.BoxLayout({
            style_class: `nulla-clock ${styleClass}`.trim(),
            orientation: Clutter.Orientation.VERTICAL,
            reactive: false,
        });

        this._weekday = new St.Label({style_class: 'nulla-clock-weekday'});
        this._timeBox = new St.BoxLayout({style_class: 'nulla-clock-timebox'});
        this._hours = new St.Label({style_class: 'nulla-clock-time nulla-clock-hours'});
        this._separator = new St.Label({style_class: 'nulla-clock-time nulla-clock-separator', text: ':'});
        this._minutes = new St.Label({style_class: 'nulla-clock-time nulla-clock-minutes'});
        this._timeBox.add_child(this._hours);
        this._timeBox.add_child(this._separator);
        this._timeBox.add_child(this._minutes);
        this._analog = new St.DrawingArea({style_class: 'nulla-clock-dial'});
        this._analog.connect('repaint', area => this._drawAnalog(area));
        this._analog.connect('style-changed', area => area.queue_repaint());
        this._date = new St.Label({style_class: 'nulla-clock-date'});

        for (const child of [this._weekday, this._timeBox, this._analog, this._date])
            this.actor.add_child(child);

        this._settings.connectObject('changed::clock-style', () => this._applyStyle(), this);
        this._interface.connectObject('changed::clock-format', () => this._tick(), this);
        this.actor.connect('destroy', () => this._onDestroy());

        this._applyStyle();
    }

    destroy() {
        this.actor?.destroy();
    }

    /** Allineamento orizzontale delle righe: 'left' | 'center' | 'right'. */
    setAlign(column) {
        const align = ALIGN[column] ?? ALIGN.center;
        for (const child of [this._weekday, this._timeBox, this._analog, this._date, this._hours, this._minutes])
            child.x_align = align;
    }

    _onDestroy() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this.actor = null;
    }

    // ───────────── preset ─────────────

    get _preset() {
        return CLOCK_PRESETS[this._settings.get_string('clock-style')] ?? CLOCK_PRESETS.classic;
    }

    _applyStyle() {
        const style = this._settings.get_string('clock-style');
        for (const name of Object.keys(CLOCK_PRESETS))
            this.actor.remove_style_class_name(`nulla-clock-${name}`);
        this.actor.add_style_class_name(`nulla-clock-${style in CLOCK_PRESETS ? style : 'classic'}`);

        const preset = this._preset;
        this._weekday.visible = !!preset.weekday;
        this._timeBox.visible = !!preset.time;
        this._timeBox.orientation = preset.stacked
            ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        this._separator.visible = !preset.stacked;
        this._analog.visible = !!preset.analog;

        this._tick();
        this._onRestyle();
    }

    // ───────────── ora ─────────────

    _tick() {
        if (this._tickId)
            GLib.source_remove(this._tickId);

        const now = this._now = GLib.DateTime.new_now_local();
        const preset = this._preset;
        const twelve = this._interface.get_string('clock-format') === '12h';
        const hours = now.format(twelve ? '%l' : '%H').trim();
        const minutes = now.format('%M');
        const time = `${hours}:${minutes}`;

        this._hours.text = hours;
        this._minutes.text = minutes;
        this._weekday.text = capitalize(now.format('%A'));

        let date = now.format(preset.date).replace(/\s+/g, ' ').trim();
        if (preset.upper)
            date = date.toLocaleUpperCase();
        if (preset.withTime === 'before')
            date = `${time}  ·  ${date}`;
        else if (preset.withTime === 'after')
            date = `${date}  ·  ${time}`;

        // Spaziatura con spazi sottili: a differenza del markup Pango viene
        // conteggiata nella larghezza dell'etichetta (niente testo tagliato).
        if (preset.tracking)
            date = [...date].map(c => (c === ' ' ? ' ' : c)).join(' ');
        this._date.text = date;

        this._analog.queue_repaint();

        // Prossimo aggiornamento allo scoccare del minuto.
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            Math.max(1, 60 - now.get_second()), () => {
                this._tickId = 0;
                this._tick();
                return GLib.SOURCE_REMOVE;
            });
    }

    _drawAnalog(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const node = area.get_theme_node();
        const fg = node.get_foreground_color();
        const [hasAccent, accent] = node.lookup_color('-nulla-hand-accent', false);
        const rgba = (c, alpha = 1) => cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255,
            (c.alpha / 255) * alpha);

        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2 - 2;
        const k = r / 64; // spessori proporzionati alla dimensione (64 = 100%)
        const minutes = this._now.get_minute();
        const hours = (this._now.get_hour() % 12) + minutes / 60;

        // Cerchio sottile e quattro punti (12, 3, 6, 9)
        rgba(fg, 0.35);
        cr.setLineWidth(1.5 * k);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.stroke();
        rgba(fg, 0.7);
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            cr.arc(cx + Math.cos(a) * (r - 9 * k), cy + Math.sin(a) * (r - 9 * k), 1.6 * k, 0, 2 * Math.PI);
            cr.fill();
        }

        // Lancette
        cr.setLineCap(1); // ROUND
        const hand = (angle, length, width) => {
            cr.setLineWidth(width);
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
            cr.stroke();
        };
        rgba(fg);
        hand((hours / 12) * 2 * Math.PI - Math.PI / 2, r * 0.5, 3.5 * k);
        hand((minutes / 60) * 2 * Math.PI - Math.PI / 2, r * 0.78, 2.2 * k);

        // Perno nel colore d'accento
        rgba(hasAccent ? accent : fg);
        cr.arc(cx, cy, 4 * k, 0, 2 * Math.PI);
        cr.fill();

        cr.$dispose();
    }
}
