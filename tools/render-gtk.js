// Genera ~/.config/gtk-{3,4}.0/nulla.css fuori da GNOME Shell.
// Uso: gjs -m tools/render-gtk.js <cartella-estensione-installata>
//
// Legge le impostazioni da gsettings (schema dell'estensione), come
// farebbe l'estensione stessa: utile subito dopo l'installazione, prima del login.
// Scrive anche il tema VS Code (accento da org.gnome.desktop.interface).

import Gio from 'gi://Gio';
import System from 'system';

const [extPath] = ARGV;
if (!extPath) {
    printerr('Uso: gjs -m tools/render-gtk.js <cartella-estensione>');
    System.exit(2);
}

const extDir = Gio.File.new_for_path(extPath);
const {computeTokens} = await import(extDir.get_child('tokens.js').get_uri());
const {writeGtkFiles, writeVscodeTheme, GNOME_ACCENTS} = await import(extDir.get_child('files.js').get_uri());

const source = Gio.SettingsSchemaSource.new_from_directory(
    extDir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({
    settings_schema: source.lookup('org.gnome.shell.extensions.nulla', false),
});

const appTransparency = settings.get_boolean('app-transparency-enabled')
    ? settings.get_int('app-transparency') : 0;
const tokens = computeTokens(settings.get_int('transparency'), settings.get_int('radius'),
    settings.get_int('panel-height'), appTransparency);
writeGtkFiles(extDir, tokens, settings.get_boolean('apply-gtk'));
print(`Nulla: CSS GTK generato (trasparenza finestre ${appTransparency}, raggio ${tokens.r}px)`);

if (settings.get_boolean('apply-vscode')) {
    const accentName = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('accent-color');
    const accent = GNOME_ACCENTS[accentName] ?? GNOME_ACCENTS.blue;
    if (writeVscodeTheme(extDir, accent))
        print(`Nulla: tema VS Code generato (accento ${accentName} ${accent})`);
}
