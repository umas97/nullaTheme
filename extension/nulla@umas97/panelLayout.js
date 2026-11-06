// Nulla — disposizione della barra superiore:
//   sinistra: indicatore dei workspace (pulsante Attività di GNOME)
//   centro:   app preferite + app aperte (al posto della dock)
//   destra:   indicatori delle app, campanella (notifiche + calendario), impostazioni rapide
// Data e ora le mostra il widget sul desktop; quando non si vede, la campanella
// diventa l'ora (vedi barClock.js).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import Meta from 'gi://Meta';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {BarClock} from './barClock.js';

const TOOLTIP_DELAY_MS = 350;

class AppButton {
    constructor(app, menuManager) {
        this.app = app;
        this._menuManager = menuManager;
        this._menu = null;
        this._label = null;
        this._tooltipId = 0;

        this.actor = new St.Button({
            style_class: 'nulla-app-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            can_focus: true,
            accessible_name: app.get_name(),
            y_align: Clutter.ActorAlign.CENTER,
        });

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        // Dimensione dal CSS (.nulla-app-icon): segue l'altezza della barra.
        this._icon = new St.Icon({
            gicon: app.get_icon(),
            style_class: 'nulla-app-icon',
            fallback_icon_name: 'application-x-executable',
        });
        box.add_child(this._icon);
        this._dot = new St.Widget({style_class: 'nulla-app-dot', x_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._dot);
        this.actor.set_child(box);

        this.actor.connect('clicked', (_b, button) => this._onClicked(button));
        this.actor.connect('notify::hover', () => this._syncTooltip());
        this.actor.connect('destroy', () => this._onDestroy());

        // Trascinabile come le icone della dock / griglia app.
        this.actor._delegate = this;
        this._dragging = false;
        this._draggable = DND.makeDraggable(this.actor, {timeoutThreshold: 200});
        this._draggable.connect('drag-begin', () => {
            this._dragging = true;
            this._hideTooltip();
            this.actor.fake_release();
            this.actor.opacity = 90;
            Main.overview.beginItemDrag(this);
        });
        this._draggable.connect('drag-cancelled', () => {
            this._dragging = false;
            Main.overview.cancelledItemDrag(this);
        });
        this._draggable.connect('drag-end', () => {
            this._dragging = false;
            this.actor.opacity = 255;
            Main.overview.endItemDrag(this);
        });
    }

    // API richiesta da dnd.js
    getDragActor() {
        // Stessa dimensione dell'icona nella barra (che arriva dal CSS).
        return this.app.create_icon_texture(Math.round(this._icon.get_width()) || 24);
    }

    getDragActorSource() {
        return this._icon;
    }

    sync(focusApp) {
        const running = this.app.state !== Shell.AppState.STOPPED;
        this._dot.opacity = running ? 255 : 0;
        if (focusApp === this.app)
            this.actor.add_style_class_name('focused');
        else
            this.actor.remove_style_class_name('focused');
    }

    _onClicked(button) {
        this._hideTooltip();

        if (button === Clutter.BUTTON_SECONDARY) {
            this._openMenu();
            return;
        }
        if (button === Clutter.BUTTON_MIDDLE) {
            this.app.open_new_window(-1);
            return;
        }

        const windows = this.app.get_windows().filter(w => !w.skip_taskbar);
        if (windows.length === 0) {
            this.app.activate();
            return;
        }

        // App già in primo piano: una finestra → minimizza, più finestre → la prossima.
        const focus = global.display.focus_window;
        if (windows.includes(focus)) {
            if (windows.length === 1)
                focus.minimize();
            else
                Main.activateWindow(windows.at(-1));
        } else {
            Main.activateWindow(windows[0]);
        }
    }

    _openMenu() {
        if (!this._menu) {
            this._menu = new AppMenu(this.actor, St.Side.TOP, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.setApp(this.app);
            this._menuManager.addMenu(this._menu);
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();
        }
        this._menu.open(true);
    }

    _syncTooltip() {
        if (this.actor.hover && !this._menu?.isOpen && !this._dragging) {
            if (!this._tooltipId) {
                this._tooltipId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
                    this._tooltipId = 0;
                    this._showTooltip();
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else {
            this._hideTooltip();
        }
    }

    _showTooltip() {
        if (!this._label) {
            this._label = new St.Label({style_class: 'dash-label nulla-app-label', text: this.app.get_name()});
            Main.uiGroup.add_child(this._label);
        }
        const [x, y] = this.actor.get_transformed_position();
        const [w, h] = this.actor.get_transformed_size();
        const [, labelWidth] = this._label.get_preferred_width(-1);
        this._label.set_position(
            Math.round(x + w / 2 - labelWidth / 2),
            Math.round(y + h + 10));
        this._label.show();
    }

    _hideTooltip() {
        if (this._tooltipId)
            GLib.source_remove(this._tooltipId);
        this._tooltipId = 0;
        this._label?.hide();
    }

    _onDestroy() {
        if (this._dragging)
            Main.overview.endItemDrag(this);
        this._draggable = null;
        this._hideTooltip();
        this._label?.destroy();
        this._menu?.destroy();
        this._label = this._menu = null;
    }
}

export class PanelLayout {
    constructor(extensionDir, settings) {
        this._settings = settings;
        this._iconsDir = extensionDir.get_child('icons');
    }

    enable() {
        this._appSystem = Shell.AppSystem.get_default();
        this._favorites = AppFavorites.getAppFavorites();
        this._tracker = Shell.WindowTracker.get_default();
        this._dateMenu = Main.panel.statusArea.dateMenu;
        this._buttons = new Map();

        this._box = new St.BoxLayout({
            style_class: 'nulla-taskbar',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._menuManager = new PopupMenu.PopupMenuManager(this._box);

        // La barra accetta icone trascinate (proprie o dalla griglia app).
        this._box._delegate = this;
        this._placeholder = null;
        this._placeholderIndex = -1;
        this._dragMonitor = null;
        Main.overview.connectObject(
            'item-drag-end', () => this._endDrag(),
            'item-drag-cancelled', () => this._endDrag(),
            this);

        this._favorites.connectObject('changed', () => this._redisplay(), this);
        this._appSystem.connectObject(
            'app-state-changed', () => this._redisplay(),
            'installed-changed', () => this._redisplay(),
            this);
        this._tracker.connectObject('notify::focus-app', () => this._syncStates(), this);
        // GNOME rimette gli elementi al loro posto a ogni cambio di modalità
        // (es. blocco/sblocco schermo): riapplichiamo la nostra disposizione.
        Main.sessionMode.connectObject('updated', () => this._applyLayout(), this);

        this._patchDateMenu();
        this._applyLayout();
        this._redisplay();
    }

    disable() {
        Main.overview.disconnectObject(this);
        this._endDrag();
        Main.sessionMode.disconnectObject(this);
        this._favorites.disconnectObject(this);
        this._appSystem.disconnectObject(this);
        this._tracker.disconnectObject(this);

        this._unpatchDateMenu();
        this._restoreLayout();

        this._box.destroy();
        this._buttons.clear();
        this._box = this._menuManager = null;
    }

    // ───────────── posizioni nella barra ─────────────

    _applyLayout() {
        const panel = Main.panel;
        const dateContainer = this._dateMenu.container;
        const quickContainer = panel.statusArea.quickSettings.container;

        if (!this._dateOrigin) {
            const parent = dateContainer.get_parent();
            this._dateOrigin = {parent, index: parent?.get_children().indexOf(dateContainer) ?? 0};
        }

        if (this._box.get_parent() !== panel._centerBox) {
            this._box.get_parent()?.remove_child(this._box);
            panel._centerBox.insert_child_at_index(this._box, 0);
        }

        if (dateContainer.get_parent() !== panel._rightBox) {
            dateContainer.get_parent()?.remove_child(dateContainer);
            const index = panel._rightBox.get_children().indexOf(quickContainer);
            panel._rightBox.insert_child_at_index(dateContainer,
                index >= 0 ? index : panel._rightBox.get_n_children());
        }

        this._box.visible = !Main.sessionMode.isLocked;
    }

    _restoreLayout() {
        const dateContainer = this._dateMenu.container;
        const {parent, index} = this._dateOrigin ?? {};
        if (parent && dateContainer.get_parent() !== parent) {
            dateContainer.get_parent()?.remove_child(dateContainer);
            parent.insert_child_at_index(dateContainer, Math.max(index, 0));
        }
        this._dateOrigin = null;
    }

    // ───────────── campanella al posto di data e ora ─────────────

    _patchDateMenu() {
        const dm = this._dateMenu;
        const clock = dm._clockDisplay;
        const box = clock.get_parent();
        const indicator = dm._indicator;
        const pad = box.get_first_child();

        this._datePatch = {box, clock, indicator, pad};

        const gicon = Gio.FileIcon.new(this._iconsDir.get_child('nulla-bell-symbolic.svg'));
        this._bell = new St.BoxLayout({style_class: 'nulla-bell', y_align: Clutter.ActorAlign.CENTER});
        this._barClock = new BarClock(gicon, this._settings);
        this._bell.add_child(this._barClock.actor);
        this._bellDot = new St.Widget({style_class: 'nulla-bell-dot', y_align: Clutter.ActorAlign.START});
        this._bell.add_child(this._bellDot);

        box.remove_child(pad);
        box.remove_child(indicator);
        clock.hide();
        box.add_child(this._bell);
        dm.add_style_class_name('nulla-bell-button');

        // Il puntino segue l'indicatore di GNOME (notifiche non lette).
        const syncDot = () => (this._bellDot.visible = indicator.visible);
        indicator.connectObject('notify::visible', syncDot, this);
        syncDot();

        // Calendario essenziale: niente eventi, orologi mondiali, meteo.
        const displays = dm._displaysSection;
        if (displays) {
            displays.hide();
            displays.connectObject('notify::visible', () => {
                if (displays.visible)
                    displays.hide();
            }, this);
        }
    }

    _unpatchDateMenu() {
        const {box, clock, indicator, pad} = this._datePatch ?? {};
        if (!box)
            return;

        indicator.disconnectObject(this);
        this._bell.destroy();
        this._bell = this._bellDot = this._barClock = null;

        box.insert_child_below(pad, clock);
        box.insert_child_above(indicator, clock);
        clock.show();
        this._dateMenu.remove_style_class_name('nulla-bell-button');

        const displays = this._dateMenu._displaysSection;
        if (displays) {
            displays.disconnectObject(this);
            displays.visible = Main.sessionMode.allowSettings;
        }
        this._datePatch = null;
    }

    // ───────────── trascinamento (riordino dei preferiti, come la dock) ─────────────

    _appFromSource(source) {
        const app = source?.app;
        if (!(app instanceof Shell.App) || app.is_window_backed())
            return null;
        return app;
    }

    handleDragOver(source, _actor, x) {
        const app = this._appFromSource(source);
        if (!app || !global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        // Centri delle icone come se il segnaposto non ci fosse (niente sfarfallio).
        const shift = this._placeholder?.width ?? 0;
        let afterPlaceholder = false;
        let index = 0;
        for (const child of this._box.get_children()) {
            if (child === this._placeholder) {
                afterPlaceholder = true;
                continue;
            }
            const center = child.x - (afterPlaceholder ? shift : 0) + child.width / 2;
            if (x < center)
                break;
            index++;
        }

        if (!this._placeholder) {
            this._placeholder = new St.Widget({style_class: 'nulla-app-placeholder'});
            this._box.insert_child_at_index(this._placeholder, index);
        } else if (index !== this._placeholderIndex) {
            this._box.set_child_at_index(this._placeholder, index);
        }
        this._placeholderIndex = index;

        // Se il puntatore esce dalla barra, il segnaposto sparisce.
        if (!this._dragMonitor) {
            this._dragMonitor = {
                dragMotion: event => {
                    if (this._placeholder && !this._box.contains(event.targetActor))
                        this._removePlaceholder();
                    return DND.DragMotionResult.CONTINUE;
                },
            };
            DND.addDragMonitor(this._dragMonitor);
        }

        const isFavorite = app.get_id() in this._favorites.getFavoriteMap();
        return isFavorite ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source) {
        const app = this._appFromSource(source);
        if (!app || !this._placeholder || !global.settings.is_writable('favorite-apps')) {
            this._removePlaceholder();
            return false;
        }

        const id = app.get_id();
        const favorites = this._favorites.getFavoriteMap();
        const isFavorite = id in favorites;

        // Posizione tra i preferiti = preferiti che precedono il segnaposto.
        let position = 0;
        for (const child of this._box.get_children()) {
            if (child === this._placeholder)
                break;
            const childId = child._delegate?.app?.get_id();
            if (childId && childId !== id && childId in favorites)
                position++;
        }
        this._removePlaceholder();

        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (isFavorite)
                this._favorites.moveFavoriteToPos(id, position);
            else
                this._favorites.addFavoriteAtPos(id, position);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    _removePlaceholder() {
        this._placeholder?.destroy();
        this._placeholder = null;
        this._placeholderIndex = -1;
    }

    _endDrag() {
        this._removePlaceholder();
        if (this._dragMonitor)
            DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
    }

    // ───────────── app ─────────────

    _redisplay() {
        const apps = [...this._favorites.getFavorites()];
        for (const app of this._appSystem.get_running()) {
            if (!apps.includes(app))
                apps.push(app);
        }

        const buttons = new Map();
        apps.forEach((app, index) => {
            const id = app.get_id();
            const button = this._buttons.get(id) ?? new AppButton(app, this._menuManager);
            buttons.set(id, button);
            if (button.actor.get_parent() === this._box)
                this._box.set_child_at_index(button.actor, index);
            else
                this._box.insert_child_at_index(button.actor, index);
        });

        for (const [id, button] of this._buttons) {
            if (!buttons.has(id))
                button.actor.destroy();
        }
        this._buttons = buttons;
        if (this._placeholder)
            this._box.set_child_at_index(this._placeholder, this._placeholderIndex);
        this._syncStates();
    }

    _syncStates() {
        const focusApp = this._tracker.focus_app;
        for (const button of this._buttons.values())
            button.sync(focusApp);
    }
}
