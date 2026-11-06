#!/usr/bin/env bash
# Nulla — disinstallazione: rimuove estensione e file GTK, ripristina le
# impostazioni salvate da install.sh al primo avvio.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REPO/tools/common.sh"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
BACKUP="$DATA_HOME/nulla/backup-originale"
IMPORT_LINE='@import url("nulla.css");'

say "Disattivo l'estensione e riattivo la dock"
gnome-extensions disable "$UUID" 2>/dev/null || true
python3 -I - "$UUID" "$DATA_HOME/nulla/riattiva-estensioni" <<'PY'
import ast, os, subprocess, sys
uuid, record = sys.argv[1], sys.argv[2]
def get(key):
    out = subprocess.run(['gsettings', 'get', 'org.gnome.shell', key],
                         capture_output=True, text=True, check=True).stdout.strip()
    return [] if out.startswith('@as') else ast.literal_eval(out)
def put(key, items):
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, str(items)], check=True)
restore = open(record).read().split() if os.path.exists(record) else []
enabled = [x for x in get('enabled-extensions') if x != uuid]
enabled += [x for x in restore if x not in enabled]
put('enabled-extensions', enabled)
put('disabled-extensions', [x for x in get('disabled-extensions') if x not in restore])
if os.path.exists(record):
    os.remove(record)
PY

say "Rimuovo i file"
rm -rf "$DEST" "${XDG_CACHE_HOME:-$HOME/.cache}/nulla"
for v in gtk-4.0 gtk-3.0; do
    dir="$CONFIG_HOME/$v"
    rm -rf "$dir/nulla.css" "$dir/nulla-assets"
    if [[ -f "$dir/gtk.css" ]]; then
        grep -vxF "$IMPORT_LINE" "$dir/gtk.css" > "$dir/gtk.css.nulla-tmp" || true
        mv "$dir/gtk.css.nulla-tmp" "$dir/gtk.css"
        # se gtk.css esisteva solo per Nulla, lo togliamo
        [[ -s "$dir/gtk.css" ]] || rm -f "$dir/gtk.css"
    fi
done
dconf reset -f /org/gnome/shell/extensions/nulla/

say "VS Code e Chrome: rimetto le impostazioni di prima"
for app in vscode chrome; do
    status=0
    python3 -I "$REPO/extension/$UUID/apps.py" "$app" restore || status=$?
    case $status in
        0) ;;
        3) say "Chrome è aperto: chiudilo e rilancia ./uninstall.sh per rimettere il tema di prima" ;;
        *) say "$app: impostazioni non modificate (file illeggibile), da sistemare a mano" ;;
    esac
done

if [[ -x "$BACKUP/restore.sh" ]]; then
    say "Ripristino le impostazioni originali (dock, Blur my Shell, pulsanti, schema colori)"
    "$BACKUP/restore.sh"
    rm -rf "$BACKUP"
    rmdir "$DATA_HOME/nulla" 2>/dev/null || true
else
    say "Nessun backup trovato: impostazioni di dock e Blur my Shell lasciate come sono"
fi

say "Fatto. Esci e rientra per tornare completamente al tema di prima."
