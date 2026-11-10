#!/usr/bin/env bash
# Nulla — installa il tema della schermata di accesso (GDM).
#
#   tools/gdm/install-gdm.sh
#
# Da lanciare come utente normale: costruisce il tema con le TUE impostazioni
# (sfondo, accento, raggio) e usa sudo solo per copiarlo e attivarlo.
# Il tema di Ubuntu non viene toccato: Nulla si aggiunge come alternativa
# (update-alternatives) con priorità più alta. Rimozione: uninstall-gdm.sh.
#
# Da rilanciare se cambi sfondo/accento o dopo un aggiornamento di Yaru o di
# GNOME Shell (l'estensione lo segnala con una notifica).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tools/common.sh"
BUILD="$REPO/build/gdm"
DEST=/usr/share/gnome-shell/theme/Nulla/gnome-shell-theme.gresource
LINK=/usr/share/gnome-shell/gdm-theme.gresource
NAME=gdm-theme.gresource

if [[ $EUID -eq 0 ]]; then
    warn "Run it as your normal user (without sudo): it needs to read your wallpaper and accent."
    exit 1
fi

"$REPO/tools/gdm/build-gdm-theme.sh" "$BUILD"

say "Installing the theme (needs the administrator password)"
sudo install -D -m 644 "$BUILD/gnome-shell-theme.gresource" "$DEST"
sudo install -m 644 "$BUILD/build-info" "$(dirname "$DEST")/build-info"
sudo update-alternatives --install "$LINK" "$NAME" "$DEST" 50
sudo update-alternatives --set "$NAME" "$DEST"

echo
say "Done. The new login screen appears at the next logout or reboot."
note "• To go back to Ubuntu's: tools/gdm/uninstall-gdm.sh"
note "• If something goes wrong and you can't log in: Ctrl+Alt+F3,"
note "  log in from the console and run: sudo update-alternatives --auto %s" "$NAME"
