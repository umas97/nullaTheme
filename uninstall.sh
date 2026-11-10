#!/usr/bin/env bash
# Nulla — disinstallazione: rimuove estensione e file GTK, ripristina le
# impostazioni salvate da install.sh al primo avvio.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REPO/tools/common.sh"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
BACKUP="$DATA_HOME/nulla/backup-originale"
# Percorso assoluto: le app snap vedono gtk.css come collegamento nella propria
# home, dove un percorso relativo non porterebbe a nulla.css.
import_line() { printf '@import url("file://%s/%s/nulla.css");' "$CONFIG_HOME" "$1"; }
OLD_IMPORT_LINE='@import url("nulla.css");'  # versioni precedenti

say "Disabling the extension and turning the dock back on"
gnome-extensions disable "$UUID" 2>/dev/null || true
python3 -I - "$UUID" "$DATA_HOME/nulla/riattiva-estensioni" "$DATA_HOME/nulla/disattivate-da-nulla" <<'PY'
import ast, os, subprocess, sys
uuid, record, added_record = sys.argv[1], sys.argv[2], sys.argv[3]
DOCKS = ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com']
def get(key):
    out = subprocess.run(['gsettings', 'get', 'org.gnome.shell', key],
                         capture_output=True, text=True, check=True).stdout.strip()
    return [] if out.startswith('@as') else ast.literal_eval(out)
def put(key, items):
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, str(items)], check=True)
restore = open(record).read().split() if os.path.exists(record) else []
# Dock aggiunte da Nulla a disabled-extensions. Le installazioni precedenti non
# le annotavano, ma le aggiungevano sempre tutte.
if os.path.exists(added_record):
    added = open(added_record).read().split()
else:
    added = DOCKS if os.path.exists(record) else []
enabled = [x for x in get('enabled-extensions') if x != uuid]
enabled += [x for x in restore if x not in enabled]
put('enabled-extensions', enabled)
put('disabled-extensions', [x for x in get('disabled-extensions') if x not in restore + added])
for path in (record, added_record):
    if os.path.exists(path):
        os.remove(path)
PY

say "Removing files"
rm -rf "$DEST" "${XDG_CACHE_HOME:-$HOME/.cache}/nulla"
for v in gtk-4.0 gtk-3.0; do
    dir="$CONFIG_HOME/$v"
    rm -rf "$dir/nulla.css" "$dir/nulla-assets"
    if [[ -f "$dir/gtk.css" ]]; then
        grep -vxF -e "$(import_line "$v")" -e "$OLD_IMPORT_LINE" "$dir/gtk.css" > "$dir/gtk.css.nulla-tmp" || true
        mv "$dir/gtk.css.nulla-tmp" "$dir/gtk.css"
        # se gtk.css esisteva solo per Nulla, lo togliamo
        [[ -s "$dir/gtk.css" ]] || rm -f "$dir/gtk.css"
    fi
done
dconf reset -f /org/gnome/shell/extensions/nulla/

say "VS Code and Chrome: restoring the previous settings"
for app in vscode chrome; do
    status=0
    python3 -I "$REPO/extension/$UUID/apps.py" "$app" restore || status=$?
    case $status in
        0) ;;
        3) if [[ $app == chrome ]]; then
               warn "Chrome is open: close it and run ./uninstall.sh again to restore its previous theme"
           else
               warn "VS Code was saving its settings: run ./uninstall.sh again"
           fi ;;
        *) warn "%s: settings left unchanged (unreadable file), fix them by hand" "$app" ;;
    esac
done

if [[ -f "$BACKUP/button-layout" || -f "$BACKUP/restore.sh" ]]; then
    say "Restoring the settings Nulla changed (dock, Blur my Shell, buttons)"
    python3 -I "$REPO/tools/restore-settings.py" "$BACKUP"
    rm -rf "$BACKUP"
    rmdir "$DATA_HOME/nulla" 2>/dev/null || true
else
    say "No backup found: dock and Blur my Shell settings left as they are"
fi

say "Done. Log out and back in to fully return to the previous theme."
