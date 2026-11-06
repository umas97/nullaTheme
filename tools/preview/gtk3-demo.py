"""Finestra demo GTK3 per l'anteprima dei pulsanti finestra."""
import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk  # noqa: E402

win = Gtk.Window(title='Nulla GTK3', default_width=540, default_height=340)
header = Gtk.HeaderBar(title='Nulla GTK3', subtitle='App GTK3', show_close_button=True)
win.set_titlebar(header)

box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin=24)
box.pack_start(Gtk.Entry(text='Testo di prova'), False, False, 0)
row = Gtk.Box(spacing=12)
row.pack_start(Gtk.Button(label='Pulsante'), False, False, 0)
suggested = Gtk.Button(label='Applica')
suggested.get_style_context().add_class('suggested-action')
row.pack_start(suggested, False, False, 0)
row.pack_start(Gtk.CheckButton(label='Opzione', active=True), False, False, 0)
box.pack_start(row, False, False, 0)
box.pack_start(Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1), False, False, 0)
win.add(box)

win.connect('destroy', Gtk.main_quit)
win.show_all()
Gtk.main()
