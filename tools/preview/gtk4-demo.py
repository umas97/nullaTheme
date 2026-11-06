"""Finestra demo libadwaita per l'anteprima: sidebar + contenuto, come Impostazioni."""
import gi

gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Adw, Gtk  # noqa: E402


def sidebar():
    view = Adw.ToolbarView()
    view.add_top_bar(Adw.HeaderBar())
    lst = Gtk.ListBox(css_classes=['navigation-sidebar'])
    for icon, label in [('network-wireless-symbolic', 'Wi-Fi'),
                        ('bluetooth-symbolic', 'Bluetooth'),
                        ('preferences-desktop-appearance-symbolic', 'Aspetto'),
                        ('preferences-system-notifications-symbolic', 'Notifiche'),
                        ('system-search-symbolic', 'Ricerca'),
                        ('folder-symbolic', 'File')]:
        row = Gtk.Box(spacing=12, margin_start=6, margin_top=6, margin_bottom=6)
        row.append(Gtk.Image(icon_name=icon))
        row.append(Gtk.Label(label=label))
        lst.append(row)
    lst.select_row(lst.get_row_at_index(2))
    view.set_content(Gtk.ScrolledWindow(child=lst, vexpand=True))
    return Adw.NavigationPage(title='Impostazioni', child=view)


def content():
    view = Adw.ToolbarView()
    header = Adw.HeaderBar()
    header.pack_end(Gtk.MenuButton(icon_name='open-menu-symbolic'))
    view.add_top_bar(header)

    page = Adw.PreferencesPage()
    group = Adw.PreferencesGroup(title='Aspetto', description='Tema Nulla, accento di sistema')
    group.add(Adw.SwitchRow(title='Trasparenze', subtitle='Regolabili dalle impostazioni rapide', active=True))
    group.add(Adw.ActionRow(title='Raggio degli angoli', subtitle='12 px'))
    group.add(Adw.EntryRow(title='Nome del tema', text='Nulla'))
    page.add(group)

    group2 = Adw.PreferencesGroup(title='Azioni')
    box = Gtk.Box(spacing=12)
    box.append(Gtk.Button(label='Applica', css_classes=['suggested-action', 'pill']))
    box.append(Gtk.Button(label='Annulla', css_classes=['pill']))
    box.append(Gtk.CheckButton(label='Opzione', active=True))
    group2.add(box)
    page.add(group2)

    view.set_content(page)
    return Adw.NavigationPage(title='Aspetto', child=view)


def on_activate(app):
    split = Adw.NavigationSplitView(sidebar=sidebar(), content=content())
    win = Adw.ApplicationWindow(application=app, title='Nulla GTK4', content=split,
                                default_width=980, default_height=640)
    win.present()


app = Adw.Application(application_id='it.nulla.Gtk4Demo')
app.connect('activate', on_activate)
app.run(None)
