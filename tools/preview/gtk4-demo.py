"""Demo libadwaita window for the preview: sidebar + content, like Settings."""
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
                        ('preferences-desktop-appearance-symbolic', 'Appearance'),
                        ('preferences-system-notifications-symbolic', 'Notifications'),
                        ('system-search-symbolic', 'Search'),
                        ('folder-symbolic', 'Files')]:
        row = Gtk.Box(spacing=12, margin_start=6, margin_top=6, margin_bottom=6)
        row.append(Gtk.Image(icon_name=icon))
        row.append(Gtk.Label(label=label))
        lst.append(row)
    lst.select_row(lst.get_row_at_index(2))
    view.set_content(Gtk.ScrolledWindow(child=lst, vexpand=True))
    return Adw.NavigationPage(title='Settings', child=view)


def content():
    view = Adw.ToolbarView()
    header = Adw.HeaderBar()
    header.pack_end(Gtk.MenuButton(icon_name='open-menu-symbolic'))
    view.add_top_bar(header)

    page = Adw.PreferencesPage()
    group = Adw.PreferencesGroup(title='Appearance', description='Nulla theme, system accent')
    group.add(Adw.SwitchRow(title='Transparency', subtitle='Adjustable from Quick Settings', active=True))
    group.add(Adw.ActionRow(title='Corner radius', subtitle='12 px'))
    group.add(Adw.EntryRow(title='Theme name', text='Nulla'))
    page.add(group)

    group2 = Adw.PreferencesGroup(title='Actions')
    box = Gtk.Box(spacing=12)
    box.append(Gtk.Button(label='Apply', css_classes=['suggested-action', 'pill']))
    box.append(Gtk.Button(label='Cancel', css_classes=['pill']))
    box.append(Gtk.CheckButton(label='Option', active=True))
    group2.add(box)
    page.add(group2)

    view.set_content(page)
    return Adw.NavigationPage(title='Appearance', child=view)


def on_activate(app):
    split = Adw.NavigationSplitView(sidebar=sidebar(), content=content())
    win = Adw.ApplicationWindow(application=app, title='Nulla GTK4', content=split,
                                default_width=980, default_height=640)
    win.present()


app = Adw.Application(application_id='it.nulla.Gtk4Demo')
app.connect('activate', on_activate)
app.run(None)
