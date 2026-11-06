#!/usr/bin/env bash
# Anteprima di Nulla senza toccare la sessione reale.
#
#   tools/preview.sh [cartella-output]
#
# Avvia una GNOME Shell headless (monitor virtuale 1600x1000) con HOME, D-Bus
# e dconf separati, installa Nulla lì dentro con ./install.sh, apre due
# finestre demo e salva gli screenshot come PNG. Le estensioni Blur my Shell e
# Dash to Dock vengono copiate dalla tua home, lo sfondo è il tuo (salvo
# NULLA_PREVIEW_WALLPAPER).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(realpath -m "${1:-$REPO/preview}")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nulla-preview.XXXXXX")"
# Il percorso del socket Wayland non può superare 108 caratteri: cartella corta.
RUN="$(mktemp -d /tmp/nulla-run.XXXXXX)"
trap 'rm -rf "$RUN"' EXIT
REAL_DATA="${XDG_DATA_HOME:-$HOME/.local/share}"

clean_env() { env -u GSETTINGS_SCHEMA_DIR XDG_DATA_DIRS=/usr/share/ubuntu:/usr/share/gnome:/usr/local/share:/usr/share "$@"; }
# NULLA_PREVIEW_WALLPAPER=<immagine> usa un altro sfondo (es. docs/wallpaper.jpg per gli
# screenshot del README, senza nulla di personale).
if [[ -n "${NULLA_PREVIEW_WALLPAPER:-}" ]]; then
    WALLPAPER="'file://$(realpath "$NULLA_PREVIEW_WALLPAPER")'"
else
    WALLPAPER="$(clean_env gsettings get org.gnome.desktop.background picture-uri-dark)"
fi
GTK_THEME="$(clean_env gsettings get org.gnome.desktop.interface gtk-theme)"
ICON_THEME="$(clean_env gsettings get org.gnome.desktop.interface icon-theme)"
ACCENT="$(clean_env gsettings get org.gnome.desktop.interface accent-color)"

mkdir -p "$OUT" "$WORK/home/.local/share/gnome-shell/extensions" "$WORK/home/.vscode/extensions"  # così si prova anche il tema VS Code
chmod 700 "$RUN"
rm -f "$OUT"/*.png

for ext in blur-my-shell@aunetx dash-to-dock@micxgx.gmail.com; do
    [[ -d "$REAL_DATA/gnome-shell/extensions/$ext" ]] &&
        cp -r "$REAL_DATA/gnome-shell/extensions/$ext" "$WORK/home/.local/share/gnome-shell/extensions/"
done
cp -r "$REPO/tools/preview/nullapreview@local" "$WORK/home/.local/share/gnome-shell/extensions/"

cat > "$WORK/inner.sh" <<EOF
set -e
gsettings set org.gnome.desktop.background picture-uri-dark $(printf %q "$WALLPAPER")
gsettings set org.gnome.desktop.background picture-uri $(printf %q "$WALLPAPER")
gsettings set org.gnome.desktop.interface gtk-theme $(printf %q "$GTK_THEME")
gsettings set org.gnome.desktop.interface icon-theme $(printf %q "$ICON_THEME")
gsettings set org.gnome.desktop.interface accent-color $(printf %q "$ACCENT")
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.shell disabled-extensions "['ubuntu-dock@ubuntu.com', 'ding@rastersoft.com']"
gsettings set org.gnome.shell enabled-extensions "['blur-my-shell@aunetx', 'dash-to-dock@micxgx.gmail.com']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version "'999'"
bash $(printf %q "$REPO/install.sh") > $(printf %q "$WORK/install.log") 2>&1
gsettings set org.gnome.shell enabled-extensions "\$(gsettings get org.gnome.shell enabled-extensions | sed "s/]\$/, 'nullapreview@local']/")"
exec timeout 300 gnome-shell --headless --wayland --no-x11 --virtual-monitor 1600x1000 --mode=ubuntu
EOF

# CSS della schermata di accesso (GDM), per provarlo sulle impostazioni rapide.
"$REPO/tools/gdm/build-gdm-theme.sh" "$WORK/gdm" > "$WORK/gdm-build.log" 2>&1 \
    && cat "$WORK/gdm/auth.css" "$WORK/gdm/gdm-extra.css" > "$WORK/gdm-part.css" || true

echo "Anteprima in corso (circa 2-3 minuti)…"
env -i \
    PATH="$PATH" LANG="${LANG:-C.UTF-8}" USER="$USER" \
    HOME="$WORK/home" XDG_RUNTIME_DIR="$RUN" \
    XDG_CONFIG_HOME="$WORK/home/.config" XDG_DATA_HOME="$WORK/home/.local/share" \
    XDG_CACHE_HOME="$WORK/home/.cache" \
    XDG_DATA_DIRS=/usr/share/ubuntu:/usr/share/gnome:/usr/local/share:/usr/share \
    XDG_CURRENT_DESKTOP=ubuntu:GNOME XDG_SESSION_TYPE=wayland XDG_SESSION_DESKTOP=ubuntu \
    NULLA_PREVIEW_OUT="$OUT" NULLA_PREVIEW_DEMOS="$REPO/tools/preview" \
    NULLA_PREVIEW_GDM_CSS="$WORK/gdm-part.css" \
    dbus-run-session -- bash "$WORK/inner.sh" > "$WORK/shell.log" 2>&1 || true

grep -E "Nulla|nulla|preview|JS ERROR|Gjs-CRITICAL|CSS|stylesheet" "$WORK/shell.log" | grep -v "^$" | tail -40 || true
echo
echo "Log completi: $WORK/shell.log  (installazione: $WORK/install.log)"
echo "Screenshot:"
ls -1 "$OUT"/*.png 2>/dev/null || echo "  nessuno: controlla il log"
