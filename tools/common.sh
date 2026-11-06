# Nulla — parti comuni agli script (da includere con `source` dopo aver definito
# REPO, non da lanciare).

UUID="nulla@umas97"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

# I terminali dentro app snap (es. VS Code) usano schemi gsettings e dati propri.
[[ "${GSETTINGS_SCHEMA_DIR:-}" == *snap* ]] && unset GSETTINGS_SCHEMA_DIR
[[ "${XDG_DATA_DIRS:-}" == *snap* ]] && export XDG_DATA_DIRS="/usr/share/ubuntu:/usr/share/gnome:/usr/local/share:/usr/share"

# Messaggi tradotti con gettext (po/*.po, vedi tools/i18n.py): il primo argomento è
# il testo inglese in formato printf, gli altri i valori dei %s. Senza traduzione
# per la lingua del sistema, o senza il comando gettext, resta l'inglese.
export TEXTDOMAIN=nulla
export TEXTDOMAINDIR="$REPO/build/locale"
python3 -I "$REPO/tools/i18n.py" compile "$TEXTDOMAINDIR" 2>/dev/null || true
_t() { if command -v gettext >/dev/null; then gettext "$1"; else printf '%s' "$1"; fi; }

say()  { local f; f="$(_t "$1")"; shift; printf "\033[1;36m›\033[0m $f\n" "$@"; }
warn() { local f; f="$(_t "$1")"; shift; printf "\033[1;33m!\033[0m $f\n" "$@" >&2; }
note() { local f; f="$(_t "$1")"; shift; printf "  $f\n" "$@"; }
