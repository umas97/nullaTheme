// Nulla — ora "intelligente" nella barra.
//
// Il pulsante delle notifiche mostra la campanella finché l'orologio sul
// desktop si vede; quando non si vede più (coperto da finestre, panoramica
// aperta, orologio disattivato) la campanella si dissolve in "HH:MM".
// Così l'ora è sempre visibile, ma mai due volte.
// Chiave "bar-clock": smart (questo comportamento) | always (sempre l'ora) |
// never (sempre la campanella).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Nome dato all'attore dell'orologio sul desktop (vedi desktopClock.js). */
export const DESKTOP_CLOCK_NAME = 'nulla-desktop-clock';

const FADE_MS = 160;
// Quota dell'orologio coperta dalle finestre oltre la quale lo si considera nascosto.
const COVERED_RATIO = 0.3;

const COVERING_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
];

export class BarClock {
    /**
     * @param {Gio.Icon} bellGicon icona della campanella
     * @param {Gio.Settings} settings impostazioni di Nulla (bar-clock)
     */
    constructor(bellGicon, settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        // Segue l'ora reale anche dopo una sospensione (vedi clockFace.js).
        this._wallClock = new GnomeDesktop.WallClock({time_only: true});
        this._laterId = 0;
        this._showTime = null;
        this._clockActor = null;

        // Campanella e ora una sopra l'altra: si vede solo una delle due.
        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._bell = new St.Icon({gicon: bellGicon, style_class: 'system-status-icon'});
        this._time = new St.Label({
            style_class: 'nulla-bar-clock',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.actor.add_child(this._bell);
        this.actor.add_child(this._time);
        this.actor.connect('destroy', () => this._onDestroy());

        this._interface.connectObject('changed::clock-format', () => this._tick(), this);
        this._wallClock.connectObject('notify::clock', () => this._tick(), this);
        this._settings.connectObject('changed::bar-clock', () => {
            this._mode = this._settings.get_string('bar-clock');
            this._update();
        }, this);
        this._mode = this._settings.get_string('bar-clock');

        // Tutto ciò che può scoprire o coprire l'orologio sul desktop.
        Main.overview.connectObject(
            'showing', () => this._queueUpdate(),
            'hidden', () => this._queueUpdate(),
            this);
        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._queueUpdate(), this);
        // Durante uno spostamento/ridimensionamento le finestre cambiano
        // allocazione a ogni frame: si ricalcola una volta sola alla fine.
        this._grabbing = false;
        global.display.connectObject(
            'restacked', () => this._queueUpdate(),
            'grab-op-begin', () => {
                this._grabbing = true;
            },
            'grab-op-end', () => {
                this._grabbing = false;
                this._queueUpdate();
            },
            this);
        global.window_manager.connectObject(
            'minimize', () => this._queueUpdate(),
            'unminimize', () => this._queueUpdate(),
            this);
        global.window_group.connectObject(
            'child-added', (_g, actor) => this._watchWindow(actor),
            'child-removed', () => this._queueUpdate(),
            this);
        for (const actor of global.get_window_actors())
            this._watchWindow(actor);
        Main.layoutManager._backgroundGroup.connectObject(
            'child-added', () => this._queueUpdate(),
            'child-removed', () => this._queueUpdate(),
            this);

        this._tick();
        this._update();
    }

    destroy() {
        this.actor?.destroy();
    }

    _onDestroy() {
        this._wallClock.disconnectObject(this);
        this._wallClock.run_dispose();
        this._wallClock = null;
        if (this._laterId)
            global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;

        this._interface.disconnectObject(this);
        this._settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.window_group.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.disconnectObject(this);
        Main.layoutManager._backgroundGroup.disconnectObject(this);
        this._clockActor?.disconnectObject(this);
        this._clockActor = null;
        this.actor = null;
    }

    // ───────────── ora ─────────────

    _tick() {
        const now = GLib.DateTime.new_now_local();
        const twelve = this._interface.get_string('clock-format') === '12h';
        this._time.text = now.format(twelve ? '%l:%M' : '%H:%M').trim();
    }

    // ───────────── visibilità dell'orologio sul desktop ─────────────

    _watchWindow(actor) {
        if (!(actor instanceof Meta.WindowActor))
            return;
        actor.connectObject(
            'notify::allocation', () => this._queueUpdate(),
            'notify::visible', () => this._queueUpdate(),
            this);
        this._queueUpdate();
    }

    _queueUpdate() {
        if (this._laterId)
            return;
        // Fuori dalla modalità "intelligente" la copertura non conta.
        if (this._grabbing || (this._mode !== 'smart' && this._showTime !== null))
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _findDesktopClock() {
        const clock = Main.layoutManager._backgroundGroup.get_children()
            .find(child => child.name === DESKTOP_CLOCK_NAME) ?? null;
        if (clock !== this._clockActor) {
            this._clockActor?.disconnectObject(this);
            clock?.connectObject('notify::allocation', () => this._queueUpdate(), this);
            this._clockActor = clock;
        }
        return clock;
    }

    _desktopClockHidden() {
        const clock = this._findDesktopClock();
        if (!clock || !clock.visible || Main.overview.visible)
            return true;

        const [cx, cy] = clock.get_transformed_position();
        const [cw, ch] = clock.get_transformed_size();
        if (cw <= 0 || ch <= 0)
            return true;

        const workspace = global.workspace_manager.get_active_workspace();
        let covered = 0;
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || !actor.visible || win.minimized || win.is_hidden())
                continue;
            if (!COVERING_TYPES.includes(win.get_window_type()))
                continue;
            if (!win.is_on_all_workspaces() && win.get_workspace() !== workspace)
                continue;

            const r = win.get_frame_rect();
            const w = Math.min(r.x + r.width, cx + cw) - Math.max(r.x, cx);
            const h = Math.min(r.y + r.height, cy + ch) - Math.max(r.y, cy);
            if (w > 0 && h > 0)
                covered += w * h;
        }
        return covered / (cw * ch) >= COVERED_RATIO;
    }

    _update() {
        if (!this.actor)
            return;
        const mode = this._mode;
        const showTime = mode === 'always' || (mode === 'smart' && this._desktopClockHidden());
        if (showTime === this._showTime)
            return;

        const first = this._showTime === null;
        this._showTime = showTime;
        const [from, to] = showTime ? [this._bell, this._time] : [this._time, this._bell];

        if (first || !this.actor.mapped) {
            from.hide();
            to.show();
            to.opacity = 255;
            return;
        }

        // Dissolvenza: esce uno, entra l'altro.
        from.remove_all_transitions();
        to.remove_all_transitions();
        from.ease({
            opacity: 0,
            duration: FADE_MS / 2,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._showTime !== showTime)
                    return;
                from.hide();
                from.opacity = 255;
                to.opacity = 0;
                to.show();
                to.ease({
                    opacity: 255,
                    duration: FADE_MS / 2,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                });
            },
        });
    }
}
