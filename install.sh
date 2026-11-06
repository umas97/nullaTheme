#!/usr/bin/env bash
# Nulla — installazione per l'utente corrente (nessun permesso di root richiesto).
#
#   ./install.sh            installa o aggiorna
#
# Cosa modifica (con backup delle impostazioni originali al primo avvio):
#   • estensione in ~/.local/share/gnome-shell/extensions/nulla@umas97
#   • ~/.config/gtk-{3,4}.0/gtk.css  → aggiunge @import url("nulla.css");
#   • schema scuro, pulsanti a destra (minimizza · massimizza · chiudi)
#   • Blur my Shell: sfocatura senza tinta propria (la tinta la mette Nulla)
#   • Dash to Dock: trasparenza gestita dal tema
#
# VS Code e Chrome li configura l'estensione al primo accesso (interruttori nelle
# preferenze, vedi extension/nulla@umas97/apps.py).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REPO/tools/common.sh"
SRC="$REPO/extension/$UUID"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
BACKUP="$DATA_HOME/nulla/backup-originale"
IMPORT_LINE='@import url("nulla.css");'

for cmd in gsettings dconf glib-compile-schemas gjs python3; do
    command -v "$cmd" >/dev/null || { warn "Comando mancante: $cmd"; exit 1; }
done

# Cartella "schemas" di un'estensione installata (vuota se usa gli schemi di sistema).
ext_schemadir() {
    local base
    for base in "$DATA_HOME/gnome-shell/extensions" /usr/share/gnome-shell/extensions; do
        if [[ -d "$base/$1/schemas" ]]; then echo "$base/$1/schemas"; return; fi
    done
}

# gset <schemadir|""> <schema> <chiave> <valore> — non blocca se lo schema manca.
gset() {
    local dir="$1"; shift
    local args=(); [[ -n "$dir" ]] && args=(--schemadir "$dir")
    gsettings "${args[@]}" set "$@" 2>/dev/null || warn "Saltato: $* (schema o chiave assente)"
}

# ───────────── 1. Backup delle impostazioni originali (solo la prima volta) ─────────────

if [[ ! -d "$BACKUP" ]]; then
    say "Backup delle impostazioni originali in $BACKUP"
    mkdir -p "$BACKUP"
    {
        echo '#!/usr/bin/env bash'
        echo '# Ripristina le impostazioni com'"'"'erano prima di Nulla (generato da install.sh).'
        echo 'set -u'
        for dir in /org/gnome/shell/extensions/blur-my-shell/ /org/gnome/shell/extensions/dash-to-dock/; do
            name="$(basename "$dir").dconf"
            dconf dump "$dir" > "$BACKUP/$name"
            printf 'dconf reset -f %q\n' "$dir"
            printf 'dconf load %q < "$(dirname "$0")/%s"\n' "$dir" "$name"
        done
        for key in /org/gnome/desktop/wm/preferences/button-layout /org/gnome/desktop/interface/color-scheme; do
            value="$(dconf read "$key")"
            if [[ -z "$value" ]]; then
                printf 'dconf reset %q\n' "$key"
            else
                printf 'dconf write %q %q\n' "$key" "$value"
            fi
        done
    } > "$BACKUP/restore.sh"
    chmod +x "$BACKUP/restore.sh"
    for v in gtk-4.0 gtk-3.0; do
        [[ -f "$CONFIG_HOME/$v/gtk.css" ]] && cp "$CONFIG_HOME/$v/gtk.css" "$BACKUP/$v-gtk.css"
    done
else
    say "Backup originale già presente: lo conservo ($BACKUP)"
fi

# ───────────── 2. Estensione ─────────────

say "Copio l'estensione in $DEST"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -r "$SRC" "$DEST"
glib-compile-schemas "$DEST/schemas"

# ───────────── 3. App GTK ─────────────

say "Collego il tema alle app GTK3 e GTK4"
for v in gtk-4.0 gtk-3.0; do
    css="$CONFIG_HOME/$v/gtk.css"
    mkdir -p "$(dirname "$css")"
    touch "$css"
    if ! grep -qF "$IMPORT_LINE" "$css"; then
        # @import deve stare in cima al file
        { echo "$IMPORT_LINE"; cat "$css"; } > "$css.nulla-tmp" && mv "$css.nulla-tmp" "$css"
    fi
done
gjs -m "$REPO/tools/render-gtk.js" "$DEST"

# ───────────── 4. Impostazioni di GNOME e delle estensioni ─────────────

say "Imposto schema scuro e pulsanti stile macOS a destra (− + ×)"
gset "" org.gnome.desktop.interface color-scheme "'prefer-dark'"
gset "" org.gnome.desktop.wm.preferences button-layout "':minimize,maximize,close'"

BLUR_DIR="$(ext_schemadir blur-my-shell@aunetx)"
if [[ -n "$BLUR_DIR" ]]; then
    say "Blur my Shell: sfocatura attiva, tinta gestita da Nulla"
    for part in panel popup dash-to-dock; do
        gset "$BLUR_DIR" "org.gnome.shell.extensions.blur-my-shell.$part" override-background false
    done
    gset "$BLUR_DIR" org.gnome.shell.extensions.blur-my-shell.popup blur true
else
    warn "Blur my Shell non trovata: niente sfocatura (il tema funziona comunque)"
fi

DOCK_DIR="$(ext_schemadir dash-to-dock@micxgx.gmail.com)"
say "Dock: trasparenza gestita dal tema"
gset "$DOCK_DIR" org.gnome.shell.extensions.dash-to-dock transparency-mode "'DEFAULT'"
gset "$DOCK_DIR" org.gnome.shell.extensions.dash-to-dock apply-custom-theme false
gset "$DOCK_DIR" org.gnome.shell.extensions.dash-to-dock custom-background-color false

# ───────────── 5. Attivazione ─────────────

say "Attivo l'estensione e disattivo la dock (le app passano nella barra superiore)"
gsettings set org.gnome.shell disable-user-extensions false
mkdir -p "$DATA_HOME/nulla"
python3 -I - "$UUID" "$DATA_HOME/nulla/riattiva-estensioni" <<'PY'
import ast, os, subprocess, sys
uuid, record = sys.argv[1], sys.argv[2]
DOCKS = ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com']
def get(key):
    out = subprocess.run(['gsettings', 'get', 'org.gnome.shell', key],
                         capture_output=True, text=True, check=True).stdout.strip()
    return [] if out.startswith('@as') else ast.literal_eval(out)
def put(key, items):
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, str(items)], check=True)
enabled, disabled = get('enabled-extensions'), get('disabled-extensions')
if uuid not in enabled:
    enabled.append(uuid)
if uuid in disabled:
    disabled.remove(uuid)
# Dock: disattivata e annotata, così uninstall.sh la riattiva.
removed = [d for d in DOCKS if d in enabled]
enabled = [x for x in enabled if x not in DOCKS]
for d in DOCKS:
    if d not in disabled:
        disabled.append(d)
put('enabled-extensions', enabled)
put('disabled-extensions', disabled)
known = set(open(record).read().split()) if os.path.exists(record) else set()
with open(record, 'w') as f:
    f.write('\n'.join(sorted(known | set(removed))) + '\n')
PY
gnome-extensions disable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
# Su X11 o se la shell conosce già l'estensione, la attiva subito.
gnome-extensions enable "$UUID" 2>/dev/null || true

echo
say "Fatto."
echo "  • Esci e rientra (logout/login) per attivare il tema della shell e lo slider."
echo "  • Le app GTK già aperte vanno riaperte."
echo "  • Accento: Impostazioni → Aspetto.  Trasparenza: impostazioni rapide (in alto a destra)."
echo "  • Disinstallazione: ./uninstall.sh"
