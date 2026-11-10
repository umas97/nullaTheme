// Nulla — controllo del tema della schermata di accesso (GDM).
//
// Il tema GDM è una copia di quello di Yaru con gli stili di Nulla in fondo
// (tools/gdm/build-gdm-theme.sh). Se Ubuntu aggiorna Yaru o GNOME Shell, GDM
// continua a usare la copia vecchia, che può non andare più d'accordo con la
// nuova shell. All'accesso si confronta build-info (scritto alla costruzione)
// col sistema e, se non coincide, si avvisa con una notifica.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUILD_INFO = '/usr/share/gnome-shell/theme/Nulla/build-info';
const YARU = '/usr/share/gnome-shell/theme/Yaru/gnome-shell-theme.gresource';

/** Righe chiave=valore → oggetto. */
function parse(text) {
    return Object.fromEntries(text.split('\n')
        .map(line => line.split('='))
        .filter(parts => parts.length === 2)
        .map(([k, v]) => [k.trim(), v.trim()]));
}

/**
 * Avvisa se il tema GDM di Nulla è stato costruito per un'altra versione di
 * Yaru o di GNOME Shell. Senza tema GDM installato non fa nulla.
 *
 * @param {Gio.Cancellable} cancellable annullato quando l'estensione si disattiva
 */
export function checkGdmTheme(cancellable) {
    const info = Gio.File.new_for_path(BUILD_INFO);
    info.load_contents_async(cancellable, (_f, res) => {
        let built;
        try {
            const [, bytes] = info.load_contents_finish(res);
            built = parse(new TextDecoder().decode(bytes));
        } catch {
            return; // tema GDM di Nulla non installato (o costruito prima di build-info)
        }

        const yaru = Gio.File.new_for_path(YARU);
        yaru.query_info_async('standard::size,time::modified', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW, cancellable, (_y, yres) => {
                let current;
                try {
                    const fileInfo = yaru.query_info_finish(yres);
                    current = `${fileInfo.get_size()}:${fileInfo.get_attribute_uint64('time::modified')}`;
                } catch {
                    return;
                }
                if (built.yaru === current && built.shell === Config.PACKAGE_VERSION)
                    return;

                Main.notify(_('Login screen theme out of date'),
                    // eslint-disable-next-line max-len
                    _("Ubuntu updated GNOME Shell or its theme. To keep the login screen working, run tools/gdm/install-gdm.sh again from the Nulla folder (or tools/gdm/uninstall-gdm.sh to go back to Ubuntu's)."));
            });
    });
}
