#!/usr/bin/env bash
# Nulla — costruisce il tema della schermata di accesso (GDM). Nessun permesso richiesto.
#
#   tools/gdm/build-gdm-theme.sh [cartella-output]      (default: build/gdm)
#
# Parte dal tema GDM di Yaru, aggiunge in fondo a gdm.css gli stili di Nulla
# (auth.css.in + gdm.css.in), incorpora il tuo sfondo sfocato e compila
# <output>/gnome-shell-theme.gresource. Lo installa install-gdm.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tools/common.sh"
EXT="$REPO/extension/$UUID"
OUT="$(realpath -m "${1:-$REPO/build/gdm}")"
YARU=/usr/share/gnome-shell/theme/Yaru/gnome-shell-theme.gresource
PREFIX=/org/gnome/shell/theme

for cmd in gresource glib-compile-resources gjs magick python3 gsettings; do
    command -v "$cmd" >/dev/null || { warn "Missing command: %s" "$cmd"; exit 1; }
done
[[ -f "$YARU" ]] || { warn "Yaru theme not found: %s" "$YARU"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/src"

# 1. Copia del tema Yaru
say "Extracting Yaru's GDM theme"
while read -r res; do
    rel="${res#"$PREFIX"/}"
    mkdir -p "$OUT/src/$(dirname "$rel")"
    gresource extract "$YARU" "$res" > "$OUT/src/$rel"
done < <(gresource list "$YARU")
[[ -s "$OUT/src/gdm.css" ]] || { warn "gdm.css missing from the Yaru theme"; exit 1; }

# 2. Accento: in GDM non c'è il tuo accento di sistema, lo scriviamo come colore.
#    Ubuntu associa gli accenti di GNOME alle varianti Yaru di libadwaita.
accent="$(gsettings get org.gnome.desktop.interface accent-color | tr -d "'")"
case "$accent" in
    blue) variant=blue ;; teal) variant=prussiangreen ;; green) variant=olive ;;
    yellow) variant=yellow ;; red) variant=red ;; pink) variant=magenta ;;
    purple) variant=purple ;; slate) variant=sage ;; brown) variant=wartybrown ;;
    *) variant=default ;;
esac
hex=""
for lib in /usr/lib/*/libadwaita-1.so.0; do
    hex="$(gresource extract "$lib" "/org/gnome/Adwaita/styles/default-dark-yaru-$variant.css" 2>/dev/null \
        | grep -o 'accent-bg-color: #[0-9A-Fa-f]\{6\}' | head -n1 | grep -o '#.*' || true)"
    [[ -n "$hex" ]] && break
done
hex="${hex:-#3584e4}"
say "Accent: %s → %s" "$accent" "$hex"

# 3. Stili di Nulla in fondo a gdm.css
say "Adding Nulla's styles"
mkdir -p "$OUT/schemas"
glib-compile-schemas --targetdir="$OUT/schemas" "$EXT/schemas"
export NULLA_SCHEMA_DIR="$OUT/schemas"
gjs -m "$REPO/tools/render-template.js" "$EXT" "$EXT/theme/auth.css.in" "$OUT/auth.css" "scope="
gjs -m "$REPO/tools/render-template.js" "$EXT" "$EXT/theme/gdm.css.in" "$OUT/gdm-extra.css"
for f in "$OUT/auth.css" "$OUT/gdm-extra.css"; do
    [[ -s "$f" ]] || { warn "Generation failed: %s" "$f"; exit 1; }
done
{
    echo
    echo "/* ═══════════ Nulla (generato da tools/gdm/build-gdm-theme.sh) ═══════════ */"
    cat "$OUT/auth.css" "$OUT/gdm-extra.css"
} | sed -e "s/-st-accent-fg-color/#ffffff/g" -e "s/-st-accent-color/$hex/g" >> "$OUT/src/gdm.css"

# 4. Sfondo sfocato (GDM non può leggere la tua home: l'immagine va nel tema)
uri="$(gsettings get org.gnome.desktop.background picture-uri-dark | tr -d "'")"
wall="$(python3 -I -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(u.unquote(p.path) if p.scheme=="file" else "")' "$uri")"
if [[ -f "$wall" && "$wall" != *.xml ]]; then
    say "Blurring the wallpaper: %s" "$wall"
    magick "$wall" -resize '1920x1080^' -gravity center -extent 1920x1080 \
        -blur 0x28 -modulate 62,95 -quality 88 "$OUT/src/nulla-login.jpg"
else
    say "Wallpaper not usable (%s): using a dark tint" "$uri"
    magick -size 64x64 xc:'#101012' "$OUT/src/nulla-login.jpg"
fi

# 5. Compilazione
say "Compiling the theme"
{
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<gresources>'
    echo "  <gresource prefix=\"$PREFIX\">"
    (cd "$OUT/src" && find . -type f | sed 's|^\./||' | sort) | while read -r f; do
        echo "    <file>$f</file>"
    done
    echo '  </gresource>'
    echo '</gresources>'
} > "$OUT/gnome-shell-theme.gresource.xml"
glib-compile-resources --sourcedir="$OUT/src" \
    --target="$OUT/gnome-shell-theme.gresource" "$OUT/gnome-shell-theme.gresource.xml"

# Controllo: le risorse che GDM cerca devono esserci
for res in "$PREFIX/gdm.css" "$PREFIX/nulla-login.jpg"; do
    gresource list "$OUT/gnome-shell-theme.gresource" | grep -qx "$res" \
        || { warn "Resource missing from the compiled theme: %s" "$res"; exit 1; }
done
say "Ready: %s" "$OUT/gnome-shell-theme.gresource"
