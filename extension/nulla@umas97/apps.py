#!/usr/bin/env python3
"""Nulla — applica (o toglie) il tema a Chrome e VS Code.

    python3 -I apps.py vscode|chrome apply|restore

Usato dall'estensione (interruttori nelle preferenze) e da install.sh / uninstall.sh.
I valori che Nulla sovrascrive vengono salvati la prima volta in
$XDG_DATA_HOME/nulla/<app>.json e rimessi da `restore`, a meno che nel frattempo
l'utente non li abbia cambiati.

Codici di uscita: 0 fatto (o niente da fare), 3 app aperta (riprovare più tardi),
4 file illeggibile (es. settings.json con commenti: non viene toccato).
"""

import json
import os
import shutil
import sys
import tempfile

HOME = os.path.expanduser('~')
CONFIG = os.environ.get('XDG_CONFIG_HOME') or os.path.join(HOME, '.config')
DATA = os.environ.get('XDG_DATA_HOME') or os.path.join(HOME, '.local', 'share')
RECORDS = os.path.join(DATA, 'nulla')

BUSY, UNREADABLE = 3, 4
MISSING = None  # nel record: la chiave non esisteva


def load(path):
    with open(path) as f:
        text = f.read()
    return json.loads(text) if text.strip() else {}


def save(path, data, **dump_args):
    # Si scrive sul file vero (un symlink di dotfiles resta un symlink), con un
    # temporaneo unico nella stessa cartella e gli stessi permessi (Preferences
    # di Chrome è 0600).
    path = os.path.realpath(path)
    fd, tmp = tempfile.mkstemp(prefix='.nulla-', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, **dump_args)
        if os.path.exists(path):
            shutil.copymode(path, tmp)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def record_path(app):
    return os.path.join(RECORDS, f'{app}.json')


def running(name):
    """True se esiste un processo chiamato `name` (come `pgrep -x`)."""
    for pid in filter(str.isdigit, os.listdir('/proc')):
        try:
            with open(f'/proc/{pid}/comm') as f:
                if f.read().strip() == name:
                    return True
        except OSError:
            pass
    return False


# ───────────── VS Code ─────────────
# Temi colori generati dall'estensione (scuro e chiaro, scelto in automatico come
# il sistema), barra del titolo di GNOME (i pulsanti disegnati da VS Code non si
# possono restilizzare) e menu di VS Code, così menu e ricerca stanno nella
# stessa barra.

VSCODE_SETTINGS = os.path.join(CONFIG, 'Code', 'User', 'settings.json')
VSCODE_THEME_DIR = os.path.join(HOME, '.vscode', 'extensions', 'nulla.nulla-theme-1.0.0')
VSCODE_VALUES = {
    'workbench.colorTheme': 'Nulla',
    'window.autoDetectColorScheme': True,
    'workbench.preferredDarkColorTheme': 'Nulla',
    'workbench.preferredLightColorTheme': 'Nulla Light',
    'window.titleBarStyle': 'native',
    'window.menuStyle': 'custom',
}


def mtime(path):
    return os.stat(path).st_mtime_ns if os.path.exists(path) else None


def vscode(action, attempts=3):
    if not os.path.isdir(os.path.dirname(VSCODE_THEME_DIR)):
        return 0  # VS Code non installato
    if action == 'restore' and os.path.isdir(VSCODE_THEME_DIR):
        # I file del tema li scrive l'estensione: si tolgono anche se
        # settings.json non si legge (es. commenti JSONC).
        shutil.rmtree(VSCODE_THEME_DIR)
    exists = os.path.exists(VSCODE_SETTINGS)
    before = mtime(VSCODE_SETTINGS)
    record = record_path('vscode')
    try:
        data = load(VSCODE_SETTINGS) if exists else {}
        old_record = load(record) if os.path.exists(record) else None
    except ValueError:
        return UNREADABLE

    if action == 'apply':
        # Si annota il valore di ogni chiave prima che Nulla la tocchi la prima
        # volta (anche le chiavi aggiunte in versioni successive).
        old = old_record or {}
        new = {k: data.get(k, MISSING) for k in VSCODE_VALUES if k not in old}
        if new:
            os.makedirs(RECORDS, exist_ok=True)
            save(record, {**old, **new})
        if any(data.get(k) != v for k, v in VSCODE_VALUES.items()):
            # Copia intera del file prima della prima modifica di Nulla.
            backup = os.path.join(RECORDS, 'vscode-settings.json')
            if exists and not os.path.exists(backup):
                os.makedirs(RECORDS, exist_ok=True)
                shutil.copy2(VSCODE_SETTINGS, backup)
            data.update(VSCODE_VALUES)
            os.makedirs(os.path.dirname(VSCODE_SETTINGS), exist_ok=True)
            # VS Code ha salvato nel frattempo: si rilegge, per non perdere la sua modifica.
            if mtime(VSCODE_SETTINGS) != before:
                return vscode(action, attempts - 1) if attempts > 1 else BUSY
            save(VSCODE_SETTINGS, data, indent=4, ensure_ascii=False)
        return 0

    if old_record is not None:
        if exists:  # settings.json cancellato nel frattempo: non lo si ricrea
            for key, value in VSCODE_VALUES.items():
                if data.get(key) != value:
                    continue  # cambiato dall'utente: resta così
                if old_record.get(key) is MISSING:
                    data.pop(key, None)
                else:
                    data[key] = old_record[key]
            if mtime(VSCODE_SETTINGS) != before:
                return vscode(action, attempts - 1) if attempts > 1 else BUSY
            save(VSCODE_SETTINGS, data, indent=4, ensure_ascii=False)
        os.remove(record)
        backup = os.path.join(RECORDS, 'vscode-settings.json')
        if os.path.exists(backup):
            os.remove(backup)  # ripristino riuscito: la copia di sicurezza non serve più
    return 0


# ───────────── Chrome ─────────────
# Tema "GTK": pulsanti finestra e colori vengono dal tema GTK. Chrome riscrive le
# Preferences quando si chiude, quindi si possono cambiare solo a Chrome chiuso.

CHROME_PREFS = os.path.join(CONFIG, 'google-chrome', 'Default', 'Preferences')
CHROME_COLOR_KEYS = ('user_color', 'user_color2', 'color_variant', 'color_variant2')


def chrome(action):
    if not os.path.exists(CHROME_PREFS):
        return 0  # Chrome non installato o mai avviato
    try:
        prefs = load(CHROME_PREFS)
    except ValueError:
        return UNREADABLE
    theme = prefs.setdefault('extensions', {}).setdefault('theme', {})
    browser_theme = prefs.setdefault('browser', {}).setdefault('theme', {})
    record = record_path('chrome')
    gtk = theme.get('system_theme') == 1 and theme.get('id') == ''

    if action == 'apply':
        if gtk:
            return 0
        if running('chrome'):
            return BUSY
        if not os.path.exists(record):
            os.makedirs(RECORDS, exist_ok=True)
            save(record, {'extensions.theme': dict(theme), 'browser.theme': dict(browser_theme)})
        theme.update(system_theme=1, id='')  # 0 = classico, 1 = GTK, 2 = Qt
        for key in CHROME_COLOR_KEYS:
            browser_theme.pop(key, None)
    else:
        if not os.path.exists(record):
            return 0
        if gtk:  # altrimenti l'utente ha già scelto un altro tema: resta quello
            if running('chrome'):
                return BUSY
            try:
                old = load(record)
            except ValueError:
                return UNREADABLE
            prefs['extensions']['theme'] = old['extensions.theme']
            prefs['browser']['theme'] = old['browser.theme']
            save(CHROME_PREFS, prefs, separators=(',', ':'))
        os.remove(record)
        return 0
    save(CHROME_PREFS, prefs, separators=(',', ':'))
    return 0

if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('vscode', 'chrome') \
            or sys.argv[2] not in ('apply', 'restore'):
        sys.exit(__doc__)
    sys.exit(globals()[sys.argv[1]](sys.argv[2]))
