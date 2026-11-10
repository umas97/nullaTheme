// Nulla — lettura/scrittura file. Usa solo GLib/Gio, quindi funziona sia
// dentro GNOME Shell sia da riga di comando con `gjs -m` (vedi tools/).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {render} from './tokens.js';

const GTK_TARGETS = [['gtk-4.0', 'gtk4.css.in'], ['gtk-3.0', 'gtk3.css.in']];
const GTK_ASSETS = ['close.svg', 'minimize.svg', 'maximize.svg'];

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function readText(file) {
    const [, bytes] = file.load_contents(null);
    return decoder.decode(bytes);
}

export function writeText(file, text) {
    file.replace_contents(encoder.encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

export function ensureDir(dir) {
    try {
        dir.make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
}

/** Simboli dei pulsanti come data: URI, incorporati nel CSS. */
function inlineAssets(themeDir) {
    const map = new Map();
    for (const name of GTK_ASSETS) {
        const [, bytes] = themeDir.get_child('assets').get_child(name).load_contents(null);
        map.set(`nulla-assets/${name}`, `data:image/svg+xml;base64,${GLib.base64_encode(bytes)}`);
    }
    return css => css.replace(/url\("(nulla-assets\/[^"]+)"\)/g,
        (match, path) => (map.has(path) ? `url("${map.get(path)}")` : match));
}

/** GTK3 non disegna i data: URI: per lui i simboli restano file accanto a nulla.css. */
function copyAssets(themeDir, dir) {
    const assets = dir.get_child('nulla-assets');
    ensureDir(assets);
    for (const name of GTK_ASSETS) {
        themeDir.get_child('assets').get_child(name).copy(assets.get_child(name),
            Gio.FileCopyFlags.OVERWRITE, null, null);
    }
}

/** GTK4 li ha incorporati: toglie la cartella delle versioni precedenti. */
function removeAssets(dir) {
    const assets = dir.get_child('nulla-assets');
    for (const name of GTK_ASSETS) {
        try {
            assets.get_child(name).delete(null);
        } catch {}
    }
    try {
        assets.delete(null);
    } catch {}
}

/**
 * Scrive ~/.config/gtk-{3,4}.0/nulla.css, importato da gtk.css (riga aggiunta
 * da install.sh, con percorso assoluto).
 *
 * Le app snap vedono gtk.css tramite un collegamento nella propria home e
 * AppArmor lascia leggere loro solo i *.css di ~/.config/gtk-*: per GTK4 i
 * simboli dei pulsanti sono quindi incorporati nel CSS. GTK3 non disegna i
 * data: URI e usa ancora i file SVG (nelle snap GTK3 manca solo il simbolo).
 *
 * GTK4 riceve entrambe le varianti (la scura dentro @media prefers-color-scheme,
 * così le app seguono il sistema da sole); GTK3 non ha le media query e riceve
 * solo quella attuale.
 *
 * @param {Gio.File} extDir cartella dell'estensione
 * @param {(dark: boolean) => object} tokensFor valori di computeTokens() per variante
 * @param {boolean} dark variante attuale del sistema
 * @param {boolean} apply false = scrive un file vuoto (tema disattivato per le app)
 */
export function writeGtkFiles(extDir, tokensFor, dark, apply) {
    const themeDir = extDir.get_child('theme');
    const inline = inlineAssets(themeDir);

    for (const [version, template] of GTK_TARGETS) {
        const dir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_config_dir(), version]));
        ensureDir(dir);
        const gtk4 = version === 'gtk-4.0';
        if (gtk4)
            removeAssets(dir);
        else
            copyAssets(themeDir, dir);

        const source = readText(themeDir.get_child(template));
        let css = '/* Nulla: tema disattivato per le app (impostazione apply-gtk) */\n';
        if (apply && gtk4) {
            css = `${render(source, tokensFor(false))}\n` +
                `@media (prefers-color-scheme: dark) {\n${render(source, tokensFor(true))}\n}\n`;
        } else if (apply) {
            css = render(source, tokensFor(dark));
        }
        writeText(dir.get_child('nulla.css'), gtk4 ? inline(css) : css);
    }
}

// ───────────── VS Code ─────────────

// Accenti di GNOME (libadwaita), usati fuori dalla shell: dentro la shell si
// legge il colore effettivo da St.ThemeContext (vedi extension.js).
export const GNOME_ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800', orange: '#ed5b00',
    red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
};

const VSCODE_THEME_ID = 'nulla.nulla-theme';

/** Cartella dell'estensione tema dentro ~/.vscode/extensions (null se VS Code non c'è). */
function vscodeThemeDir() {
    const root = Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_home_dir(), '.vscode', 'extensions']));
    if (!root.query_exists(null))
        return null;
    return root.get_child(`${VSCODE_THEME_ID}-1.0.0`);
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
    return m ? m.slice(1).map(v => parseInt(v, 16)) : [53, 132, 228];
}

const rgbToHex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Varianti dell'accento usate dal modello del tema. */
function accentTokens(hex) {
    const rgb = hexToRgb(hex);
    const [r, g, b] = rgb.map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return {
        accent: rgbToHex(rgb),
        // Più chiaro: testo e parole chiave leggibili sullo sfondo scuro
        accent_text: rgbToHex(rgb.map(v => v + (255 - v) * 0.35)),
        // Più scuro: lo stesso sullo sfondo chiaro (tema "Nulla Light")
        accent_strong: rgbToHex(rgb.map(v => v * 0.72)),
        accent_fg: luminance > 0.4 ? '#141416' : '#ffffff',
    };
}

/**
 * Scrive (o aggiorna) il tema "Nulla" per VS Code con l'accento indicato.
 * VS Code applica le modifiche al riavvio o con "Ricarica finestra".
 *
 * @returns {boolean} true se il tema è stato scritto
 */
export function writeVscodeTheme(extDir, accentHex) {
    const target = vscodeThemeDir();
    if (!target)
        return false;

    const source = extDir.get_child('theme').get_child('vscode');
    const themes = target.get_child('themes');
    ensureDir(themes);
    source.get_child('package.json').copy(target.get_child('package.json'),
        Gio.FileCopyFlags.OVERWRITE, null, null);

    for (const name of ['nulla-color-theme', 'nulla-light-color-theme']) {
        const json = render(readText(source.get_child(`${name}.json.in`)), accentTokens(accentHex));
        const file = themes.get_child(`${name}.json`);
        // Riscrive solo se cambia: VS Code non deve vedere modifiche inutili.
        if (!file.query_exists(null) || readText(file) !== json)
            writeText(file, json);
    }
    return true;
}
