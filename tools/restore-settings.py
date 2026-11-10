#!/usr/bin/env python3
"""Nulla — ripristino delle impostazioni salvate da install.sh.

Uso: python3 -I tools/restore-settings.py <cartella-backup>

Si rimettono solo le chiavi che Nulla cambia, e solo se hanno ancora il valore
messo da Nulla: le modifiche fatte dall'utente dopo l'installazione (sfocatura,
dock, pulsanti, chiaro/scuro) restano com'erano. Legge anche i backup delle
versioni precedenti (restore.sh con reset completo e color-scheme).
"""
import configparser
import os
import shlex
import subprocess
import sys

BLUR = '/org/gnome/shell/extensions/blur-my-shell/'
DOCK = '/org/gnome/shell/extensions/dash-to-dock/'
BUTTONS = '/org/gnome/desktop/wm/preferences/button-layout'
USER_EXT = '/org/gnome/shell/disable-user-extensions'

# chiave → valore messo da Nulla (None = valore variabile, si ripristina sempre)
MANAGED = {
    BLUR: {
        'panel/override-background': 'false',
        'popup/override-background': 'false',
        'dash-to-dock/override-background': 'false',
        'popup/blur': 'true',
        # raggi allineati da "sync-blur" (vedi blurRadii() in tokens.js)
        'panel/corner-radius': None,
        **{f'popup/{k}': None for k in (
            'menu-corner-radius', 'submenu-corner-radius', 'quick-settings-corner-radius',
            'calendar-corner-radius', 'notification-corner-radius', 'dialog-corner-radius',
            'osd-corner-radius', 'osd-window-corner-radius', 'resize-popup-corner-radius',
            'candidate-corner-radius', 'corner-radius')},
    },
    DOCK: {
        'transparency-mode': "'DEFAULT'",
        'apply-custom-theme': 'false',
        'custom-background-color': 'false',
    },
}
NULLA_BUTTONS = "':minimize,maximize,close'"


def dconf(*args):
    return subprocess.run(['dconf', *args], capture_output=True, text=True,
                          check=True).stdout.strip()


def read_dump(path):
    """Dump di `dconf dump` → {'sezione/chiave': valore} (sezione '/' = radice)."""
    parser = configparser.ConfigParser(interpolation=None, delimiters=('=',))
    parser.optionxform = str
    if os.path.exists(path):
        parser.read(path)
    values = {}
    for section in parser.sections():
        prefix = '' if section == '/' else section.strip('/') + '/'
        for key, value in parser.items(section):
            values[prefix + key] = value
    return values


def restore_key(path, saved, nulla_value):
    current = dconf('read', path)
    if nulla_value is not None and current != nulla_value:
        return  # cambiato dall'utente dopo l'installazione: resta così
    if saved is None:
        dconf('reset', path)
    else:
        dconf('write', path, saved)


def saved_buttons(backup):
    """Valore originale di button-layout, dal restore.sh generato da install.sh."""
    script = os.path.join(backup, 'restore.sh')
    if not os.path.exists(script):
        return False, None
    for line in open(script):
        words = shlex.split(line, comments=True)
        if len(words) >= 3 and words[0] == 'dconf' and words[2] == BUTTONS:
            return True, (words[3] if words[1] == 'write' else None)
    return False, None


def main(backup):
    for base, keys in MANAGED.items():
        dump = read_dump(os.path.join(backup, os.path.basename(base.rstrip('/')) + '.dconf'))
        for key, nulla_value in keys.items():
            restore_key(base + key, dump.get(key), nulla_value)

    found, value = saved_buttons(backup)
    if found:
        restore_key(BUTTONS, value, NULLA_BUTTONS)

    # Lo schema chiaro/scuro non lo tocca più Nulla: non si ripristina.

    saved = os.path.join(backup, 'disable-user-extensions')
    if os.path.exists(saved):
        value = open(saved).read().strip()
        if value:
            dconf('write', USER_EXT, value)


if __name__ == '__main__':
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    main(sys.argv[1])
