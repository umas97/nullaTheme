// Compila un modello CSS di Nulla fuori dalla shell, con le impostazioni attuali.
// Uso: gjs -m tools/render-template.js <cartella-estensione> <modello> <uscita> [chiave=valore …]
//
// Le coppie chiave=valore si aggiungono ai valori del tema (es. scope=).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const [extPath, templatePath, outPath, ...extra] = ARGV;
if (!extPath || !templatePath || !outPath) {
    printerr('Uso: gjs -m tools/render-template.js <estensione> <modello> <uscita> [chiave=valore …]');
    System.exit(2);
}

const extDir = Gio.File.new_for_path(extPath);
const {computeTokens, render} = await import(extDir.get_child('tokens.js').get_uri());
const {readText, writeText} = await import(extDir.get_child('files.js').get_uri());

// Schema compilato: quello indicato da NULLA_SCHEMA_DIR o quello dell'estensione.
const schemaDir = GLib.getenv('NULLA_SCHEMA_DIR') ?? extDir.get_child('schemas').get_path();
const source = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir, Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({
    settings_schema: source.lookup('org.gnome.shell.extensions.nulla', false),
});

const tokens = computeTokens(settings.get_int('transparency'), settings.get_int('radius'),
    settings.get_int('panel-height'), settings.get_int('app-transparency'),
    settings.get_int('clock-size'));
for (const pair of extra) {
    const i = pair.indexOf('=');
    if (i > 0)
        tokens[pair.slice(0, i)] = pair.slice(i + 1);
}

const css = render(readText(Gio.File.new_for_path(templatePath)), tokens);
writeText(Gio.File.new_for_path(GLib.canonicalize_filename(outPath, null)), css);
