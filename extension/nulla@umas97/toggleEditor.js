// Nulla — modifica dei toggle delle impostazioni rapide, stile Android.
//
// In fondo al pannello c'è una matita. In modalità modifica:
//   • in alto i toggle visibili, sotto la sezione "Nascosti" (attenuati);
//   • tocco su un toggle = passa dall'una all'altra sezione;
//   • trascinamento = riordina (anche tra le sezioni);
//   • ✓ o chiusura del menu = salva ed esce.
// Ordine e nascosti sono salvati in gsettings (toggle-order, hidden-toggles).
//
// Come si evita che il tocco accenda/spenga il toggle: durante la modifica i
// gestori "clicked" originali vengono bloccati (e la toggle-mode disattivata),
// poi ripristinati all'uscita.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickMenuToggle, QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export function isBackgroundApps(child) {
    return child.constructor.$gtype.name.includes('BackgroundApps');
}

export class ToggleEditor {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        this._menu = Main.panel.statusArea.quickSettings.menu;
        this._grid = this._menu._grid;
        this._items = new Map();   // item → {id, sysVisible}
        this._editing = false;
        this._ownChange = false;
        this._idleId = 0;
        this._originalOrder = [];

        this._buildEditRow();
        this._scan();
        this._originalOrder = this._toggles();
        this._applyOrder();

        this._grid.connectObject('child-added', () => this._queueScan(), this);
        this._menu.connectObject('open-state-changed', (_m, open) => {
            if (!open && this._editing)
                this._setEditing(false);
        }, this);
        // Cambi esterni (es. "Ripristina" nelle preferenze) si applicano subito.
        this._settings.connectObject(
            'changed::toggle-order', () => this._applyOrder(),
            'changed::hidden-toggles', () => this._applyOrder(),
            this);
    }

    disable() {
        if (this._editing)
            this._setEditing(false);
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;

        this._grid.disconnectObject(this);
        this._menu.disconnectObject(this);
        this._settings.disconnectObject(this);

        // Ripristino: tutto visibile come vuole il sistema, ordine originale.
        for (const [item, info] of this._items) {
            item.disconnectObject(this);
            this._setVisible(item, info.sysVisible);
        }
        this._placeSequence(this._originalOrder.filter(item => item.get_parent() === this._grid));

        this._editRow.destroy();
        this._items.clear();
        this._menu = this._grid = this._editRow = null;
    }

    // ───────────── elenco dei toggle ─────────────

    _isToggle(child) {
        // "App in background" è una riga intera con un elenco: non è un toggle da gestire.
        return (child instanceof QuickToggle || child instanceof QuickMenuToggle) &&
            !isBackgroundApps(child);
    }

    /** Toggle gestiti, nell'ordine attuale della griglia. */
    _toggles() {
        return this._grid.get_children().filter(c => this._items.has(c));
    }

    _queueScan() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleId = 0;
            if (this._scan())
                this._applyOrder();
            // La riga della matita resta sempre in fondo.
            this._grid.set_child_above_sibling(this._editRow, null);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Registra i toggle nuovi. Restituisce true se ce n'erano. */
    _scan() {
        const counts = new Map();
        let added = false;
        for (const child of this._grid.get_children()) {
            if (!this._isToggle(child))
                continue;
            // Identificativo stabile: tipo GObject (+ numero se ce ne sono più dello stesso tipo).
            const type = child.constructor.$gtype.name;
            const n = (counts.get(type) ?? 0) + 1;
            counts.set(type, n);
            if (this._items.has(child))
                continue;

            const id = n > 1 ? `${type}#${n}` : type;
            this._items.set(child, {id, sysVisible: child.visible});
            child.connectObject(
                'notify::visible', () => this._onSystemVisibility(child),
                'destroy', () => this._items.delete(child),
                this);
            added = true;
        }
        return added;
    }

    _hiddenIds() {
        return new Set(this._settings.get_strv('hidden-toggles'));
    }

    _isHidden(item) {
        return this._hiddenIds().has(this._items.get(item).id);
    }

    // ───────────── visibilità ─────────────

    _setVisible(item, visible) {
        if (item.visible === visible)
            return;
        this._ownChange = true;
        item.visible = visible;
        this._ownChange = false;
    }

    _onSystemVisibility(item) {
        if (this._ownChange)
            return;
        // Il sistema mostra/nasconde il toggle (es. Bluetooth assente): lo
        // ricordiamo, poi riapplichiamo la scelta dell'utente.
        this._items.get(item).sysVisible = item.visible;
        this._syncVisibility(item);
    }

    _syncVisibility(item) {
        const {sysVisible} = this._items.get(item);
        const hidden = this._isHidden(item);
        this._setVisible(item, sysVisible && (this._editing || !hidden));

        item.opacity = this._editing && hidden ? 110 : 255;
    }

    // ───────────── ordine ─────────────

    /** Visibili nell'ordine salvato, poi i nascosti (dietro l'intestazione in modifica). */
    _applyOrder() {
        const order = this._settings.get_strv('toggle-order');
        const rank = item => {
            const i = order.indexOf(this._items.get(item).id);
            return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        };
        const current = this._toggles();
        const sorted = [...current].sort((a, b) => rank(a) - rank(b) ||
            current.indexOf(a) - current.indexOf(b));
        const visible = sorted.filter(item => !this._isHidden(item));
        const hidden = sorted.filter(item => this._isHidden(item));

        const sequence = this._editing ? [...visible, this._header, ...hidden] : [...visible, ...hidden];
        this._placeSequence(sequence.filter(Boolean));
        for (const item of current)
            this._syncVisibility(item);
    }

    /** Mette gli elementi uno dopo l'altro dove iniziava il primo toggle. */
    _placeSequence(sequence) {
        if (!sequence.length)
            return;
        // Il primo elemento della sequenza nella griglia: chi lo precede fa da àncora.
        const members = new Set(sequence);
        const children = this._grid.get_children();
        const first = children.findIndex(child => members.has(child));
        let anchor = first > 0 ? children[first - 1] : null;

        for (const item of sequence) {
            if (anchor)
                this._grid.set_child_above_sibling(item, anchor);
            else
                this._grid.set_child_below_sibling(item, null); // in testa
            anchor = item;
        }
    }

    _save() {
        const toggles = this._toggles();
        this._settings.set_strv('toggle-order', toggles.map(item => this._items.get(item).id));
    }

    _setHidden(item, hidden) {
        const ids = this._hiddenIds();
        const {id} = this._items.get(item);
        if (hidden)
            ids.add(id);
        else
            ids.delete(id);
        this._settings.set_strv('hidden-toggles', [...ids]);
    }

    // ───────────── riga con la matita ─────────────

    _buildEditRow() {
        this._editRow = new St.BoxLayout({
            style_class: 'nulla-qs-edit-row',
            x_expand: true,
        });
        this._hint = new St.Label({
            style_class: 'nulla-qs-edit-hint',
            text: _('Tap to hide · drag to reorder'),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._editIcon = new St.Icon({icon_name: 'document-edit-symbolic'});
        this._editButton = new St.Button({
            style_class: 'icon-button nulla-qs-edit-button',
            child: this._editIcon,
            can_focus: true,
            accessible_name: _('Edit toggles'),
            x_expand: true,                 // prende lo spazio libero…
            x_align: Clutter.ActorAlign.END, // …e si allinea a destra
        });
        this._editButton.connect('clicked', () => this._setEditing(!this._editing));
        this._editRow.add_child(this._hint);
        this._editRow.add_child(this._editButton);

        this._menu.addItem(this._editRow, this._grid.layout_manager.nColumns);
    }

    // ───────────── modalità modifica ─────────────

    _setEditing(editing) {
        if (this._editing === editing)
            return;
        this._editing = editing;

        this._hint.visible = editing;
        this._editIcon.icon_name = editing ? 'object-select-symbolic' : 'document-edit-symbolic';
        this._editButton.accessible_name = editing ? _('Done') : _('Edit toggles');

        if (editing) {
            this._grid.add_style_class_name('nulla-qs-editing');
            this._header = new St.Label({
                style_class: 'nulla-qs-hidden-header',
                text: _('Hidden · tap to add'),
                x_expand: true,
            });
            this._menu.addItem(this._header, this._grid.layout_manager.nColumns);
            this._grid._delegate = this;
            for (const item of this._items.keys())
                this._enterItem(item);
        } else {
            for (const item of this._items.keys())
                this._leaveItem(item);
            delete this._grid._delegate;
            this._clearDropTarget();
            this._header?.destroy();
            this._header = null;
            this._grid.remove_style_class_name('nulla-qs-editing');
            this._save();
        }
        this._applyOrder();
        this._grid.set_child_above_sibling(this._editRow, null);
    }

    /** L'attore che emette "clicked" quando si tocca il toggle. */
    _clickTarget(item) {
        return item instanceof QuickMenuToggle ? item._box.get_first_child() : item;
    }

    _enterItem(item) {
        const info = this._items.get(item);
        const target = this._clickTarget(item);

        // Blocca i gestori originali: il tocco non deve attivare il toggle.
        GObject.signal_handlers_block_matched(target, {signalId: 'clicked'});
        info.toggleMode = item.toggleMode;
        item.toggleMode = false;
        info.clickId = target.connect('clicked', () => this._onTap(item));

        // Trascinabile (solo in modifica), con una copia come immagine trascinata.
        info.oldDelegate = item._delegate;
        item._delegate = {
            nullaToggle: item,
            getDragActor: () => new Clutter.Clone({source: item, width: item.width, height: item.height}),
            getDragActorSource: () => item,
        };
        info.draggable = DND.makeDraggable(item, {timeoutThreshold: 150});
        info.draggable.connect('drag-begin', () => (item.opacity = 60));
        info.draggable.connect('drag-end', () => this._syncVisibility(item));
    }

    _leaveItem(item) {
        const info = this._items.get(item);
        if (!info?.draggable)
            return;
        const target = this._clickTarget(item);

        target.disconnect(info.clickId);
        GObject.signal_handlers_unblock_matched(target, {signalId: 'clicked'});
        item.toggleMode = info.toggleMode;

        item.remove_action(info.draggable._dndGesture);
        item._delegate = info.oldDelegate;
        info.draggable = info.clickId = info.oldDelegate = null;
    }

    _onTap(item) {
        const hidden = !this._isHidden(item);
        this._setHidden(item, hidden);

        // Nascosto → in fondo ai nascosti; mostrato → in fondo ai visibili.
        const order = this._toggles().filter(t => t !== item);
        const visible = order.filter(t => !this._isHidden(t));
        const rest = order.filter(t => this._isHidden(t));
        const sequence = hidden ? [...visible, ...rest, item] : [...visible, item, ...rest];
        this._settings.set_strv('toggle-order', sequence.map(t => this._items.get(t).id));
        this._applyOrder();
    }

    // ───────────── trascinamento (la griglia è il bersaglio) ─────────────

    _itemAt(x, y) {
        return this._toggles().find(item => {
            if (!item.visible)
                return false;
            const box = item.get_allocation_box();
            return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
        });
    }

    _clearDropTarget() {
        this._dropTarget?.remove_style_class_name('nulla-qs-drop-target');
        this._dropTarget = null;
    }

    handleDragOver(source, _actor, x, y) {
        const dragged = source?.nullaToggle;
        if (!dragged)
            return DND.DragMotionResult.NO_DROP;

        const target = this._itemAt(x, y);
        if (target !== this._dropTarget) {
            this._clearDropTarget();
            if (target && target !== dragged) {
                this._dropTarget = target;
                target.add_style_class_name('nulla-qs-drop-target');
            }
        }
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x, y) {
        const dragged = source?.nullaToggle;
        const target = this._itemAt(x, y);
        this._clearDropTarget();
        if (!dragged || !target || target === dragged)
            return false;

        // Prende la sezione del bersaglio (visibili o nascosti) e si mette prima o dopo.
        this._setHidden(dragged, this._isHidden(target));
        const box = target.get_allocation_box();
        const after = x > (box.x1 + box.x2) / 2;
        const order = this._toggles().filter(t => t !== dragged);
        order.splice(order.indexOf(target) + (after ? 1 : 0), 0, dragged);
        this._settings.set_strv('toggle-order', order.map(t => this._items.get(t).id));

        // Dopo il rilascio: il DND rimette l'attore a posto, poi riordiniamo.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._grid)
                this._applyOrder();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }
}
