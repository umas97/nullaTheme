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
# Da rilanciare se cambi sfondo/accento o dopo un aggiornamento di Yaru.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tools/common.sh"
BUILD="$REPO/build/gdm"
DEST=/usr/share/gnome-shell/theme/Nulla/gnome-shell-theme.gresource
LINK=/usr/share/gnome-shell/gdm-theme.gresource
NAME=gdm-theme.gresource

if [[ $EUID -eq 0 ]]; then
    echo "Lancialo come utente normale (senza sudo): serve leggere sfondo e accento." >&2
    exit 1
fi

"$REPO/tools/gdm/build-gdm-theme.sh" "$BUILD"

say "Installo il tema (richiede la password di amministratore)"
sudo install -D -m 644 "$BUILD/gnome-shell-theme.gresource" "$DEST"
sudo update-alternatives --install "$LINK" "$NAME" "$DEST" 50
sudo update-alternatives --set "$NAME" "$DEST"

echo
say "Fatto. La nuova schermata di accesso si vede al prossimo logout o riavvio."
echo "  • Per tornare a quella di Ubuntu: tools/gdm/uninstall-gdm.sh"
echo "  • Se qualcosa andasse storto e non riuscissi ad accedere: Ctrl+Alt+F3,"
echo "    accedi dal terminale e lancia: sudo update-alternatives --auto $NAME"
