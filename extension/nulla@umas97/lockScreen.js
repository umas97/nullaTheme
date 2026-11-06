// Nulla — schermata di blocco: l'orologio di GNOME viene sostituito da quello
// di Nulla, nello stesso stile (preset) del widget sul desktop.
//
// Lo sfondo resta quello di GNOME: lo sfondo del desktop sfocato e scurito.
// Avatar, password e pulsanti sono stilizzati in theme/auth.css.in.
//
// La finestra di sblocco viene creata a ogni blocco e distrutta allo sblocco:
// ci si aggancia ai segnali dello ScreenShield.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClockFace} from './clockFace.js';

export class LockScreen {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        this._dialog = null;
        this._face = null;
        this._idleId = 0;

        Main.screenShield?.connectObject(
            'active-changed', () => this._queuePatch(),
            'locked-changed', () => this._queuePatch(),
            'lock-screen-shown', () => this._queuePatch(),
            'wake-up-screen', () => this._queuePatch(),
            this);
        this._patch();
    }

    disable() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        Main.screenShield?.disconnectObject(this);
        this._unpatch();
    }

    _queuePatch() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleId = 0;
            this._patch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _patch() {
        const dialog = Main.screenShield?._dialog;
        const clock = dialog?._clock;
        if (!dialog || dialog === this._dialog || !clock?._time || !clock?._date)
            return;

        this._dialog = dialog;
        clock._time.hide();
        clock._date.hide();

        this._face = new ClockFace(this._settings, {styleClass: 'nulla-clock-lock'});
        this._face.setAlign('center');
        clock.insert_child_at_index(this._face.actor, 0);

        // Allo sblocco GNOME distrugge la finestra (e con lei il nostro orologio).
        dialog.connectObject('destroy', () => {
            this._dialog = null;
            this._face = null;
        }, this);
    }

    _unpatch() {
        const dialog = this._dialog;
        if (!dialog)
            return;
        dialog.disconnectObject(this);
        this._face?.destroy();
        dialog._clock?._time?.show();
        dialog._clock?._date?.show();
        this._dialog = this._face = null;
    }
}
