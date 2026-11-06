// Nulla — impostazioni rapide stile Control Center: toggle a cerchio con la
// sola icona, griglia a 4 colonne. Il clic destro apre il sottomenu (es. reti
// Wi-Fi), visto che la freccia laterale sparisce.
//
// Tutto ciò che viene toccato è registrato e ripristinato in disable().

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickMenuToggle, QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {isBackgroundApps} from './toggleEditor.js';

const COLUMNS = 4;
const STYLE_CLASS = 'nulla-icon-toggle';

export class IconToggles {
    enable() {
        this._menu = Main.panel.statusArea.quickSettings.menu;
        this._grid = this._menu._grid;
        this._layout = this._grid.layout_manager;
        this._oldColumns = this._layout.nColumns;
        this._spans = new Map();     // elemento → column-span originale
        this._restore = new Map();   // elemento → funzione di ripristino
        this._idleId = 0;

        this._layout.nColumns = COLUMNS;
        for (const child of this._grid)
            this._adopt(child);

        // Elementi aggiunti dopo (altre estensioni, il nostro slider…):
        // column-span viene impostato subito dopo l'inserimento, quindi aspettiamo.
        this._grid.connectObject('child-added', () => this._queueAdoptAll(), this);
    }

    disable() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._grid.disconnectObject(this);

        for (const restore of this._restore.values())
            restore();
        for (const [child, span] of this._spans) {
            child.disconnectObject(this);
            this._layout.get_child_meta(this._grid, child).column_span = span;
        }
        this._layout.nColumns = this._oldColumns;

        this._restore.clear();
        this._spans.clear();
        this._menu = this._grid = this._layout = null;
    }

    _queueAdoptAll() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleId = 0;
            for (const child of this._grid)
                this._adopt(child);
            return GLib.SOURCE_REMOVE;
        });
    }

    _adopt(child) {
        if (child === this._menu._overlay || this._spans.has(child))
            return;

        const meta = this._layout.get_child_meta(this._grid, child);
        this._spans.set(child, meta.column_span);
        // Ciò che occupava tutta la riga (slider, riga di sistema) continua a farlo.
        if (meta.column_span >= this._oldColumns)
            meta.column_span = COLUMNS;

        child.connectObject('destroy', () => {
            this._spans.delete(child);
            this._restore.delete(child);
        }, this);

        if (isBackgroundApps(child))
            return; // riga intera con l'elenco delle app: resta com'è
        if (child instanceof QuickMenuToggle)
            this._restore.set(child, this._patchMenuToggle(child));
        else if (child instanceof QuickToggle)
            this._restore.set(child, this._patchToggle(child));
    }

    /** Nasconde titolo e sottotitolo, centra l'icona. */
    _iconOnly(toggle) {
        const titleBox = toggle._title?.get_parent();
        const box = toggle._box;
        if (!titleBox || !box)
            return () => {};

        const oldAlign = box.x_align;
        titleBox.hide();
        box.x_align = Clutter.ActorAlign.CENTER;
        return () => {
            titleBox.show();
            box.x_align = oldAlign;
        };
    }

    _patchToggle(toggle) {
        const undo = this._iconOnly(toggle);
        toggle.add_style_class_name(STYLE_CLASS);
        return () => {
            undo();
            toggle.remove_style_class_name(STYLE_CLASS);
        };
    }

    _patchMenuToggle(item) {
        const contents = item._box?.get_first_child();
        const separator = contents?.get_next_sibling();
        const menuButton = item._menuButton;
        if (!contents || !separator || !menuButton)
            return () => {};

        const undo = this._iconOnly(contents);
        item.add_style_class_name(STYLE_CLASS);

        // Via la freccia: il sottomenu si apre con il clic destro.
        item._box.remove_child(separator);
        item._box.remove_child(menuButton);
        contents.connectObject('button-press-event', (actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY || !item.menuEnabled)
                return Clutter.EVENT_PROPAGATE;
            item.menu.open();
            return Clutter.EVENT_STOP;
        }, this);

        return () => {
            contents.disconnectObject(this);
            item._box.add_child(separator);
            item._box.add_child(menuButton);
            item.remove_style_class_name(STYLE_CLASS);
            undo();
        };
    }
}
