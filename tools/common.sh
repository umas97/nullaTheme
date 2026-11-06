# Nulla — parti comuni agli script (da includere con `source`, non da lanciare).

UUID="nulla@umas97"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

# I terminali dentro app snap (es. VS Code) usano schemi gsettings e dati propri.
[[ "${GSETTINGS_SCHEMA_DIR:-}" == *snap* ]] && unset GSETTINGS_SCHEMA_DIR
[[ "${XDG_DATA_DIRS:-}" == *snap* ]] && export XDG_DATA_DIRS="/usr/share/ubuntu:/usr/share/gnome:/usr/local/share:/usr/share"

say()  { printf '\033[1;36m›\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
