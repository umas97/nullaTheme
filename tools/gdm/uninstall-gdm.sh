#!/usr/bin/env bash
# Nulla — rimuove il tema della schermata di accesso e torna a quello di Ubuntu.
set -euo pipefail

DEST=/usr/share/gnome-shell/theme/Nulla/gnome-shell-theme.gresource
NAME=gdm-theme.gresource

sudo update-alternatives --remove "$NAME" "$DEST" 2>/dev/null || true
sudo update-alternatives --auto "$NAME"
sudo rm -rf /usr/share/gnome-shell/theme/Nulla
update-alternatives --query "$NAME" | grep -E '^Value:'
printf '\033[1;36m›\033[0m %s\n' "Fatto: schermata di accesso di Ubuntu ripristinata (visibile al prossimo logout)."
