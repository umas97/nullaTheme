#!/usr/bin/env bash
# Nulla — rimuove il tema della schermata di accesso e torna a quello di Ubuntu.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tools/common.sh"
DEST=/usr/share/gnome-shell/theme/Nulla/gnome-shell-theme.gresource
NAME=gdm-theme.gresource

sudo update-alternatives --remove "$NAME" "$DEST" 2>/dev/null || true
sudo update-alternatives --auto "$NAME"
sudo rm -rf /usr/share/gnome-shell/theme/Nulla
update-alternatives --query "$NAME" | grep -E '^Value:'
say "Done: Ubuntu's login screen is back (visible at the next logout)."
