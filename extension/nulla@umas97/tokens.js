// Nulla — calcolo dei valori del tema a partire dalle impostazioni.
//
// Ogni superficie ha un "peso" k: con trasparenza t (0..1) la sua opacità
// diventa 1 - k·t. Così un solo slider muove tutto in modo proporzionato.
// Shell e app hanno quantità separate: lo slider delle impostazioni rapide
// muove la shell, le finestre delle app hanno una loro impostazione.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const DEFAULT_PANEL_HEIGHT = 34;

// Colori delle due varianti. Nei modelli: {{nome}} → "r, g, b" (da usare in
// rgba({{nome}}, alfa)) e {{nome:alfa}} → rgba(r, g, b, alfa·k), dove k è il
// fattore della variante: nel tema chiaro velature e bordi scuri servono meno
// opachi di quelli chiari sul tema scuro.
const PALETTES = {
    dark: {
        text: ['255, 255, 255', 1],      // testo e icone
        ink: ['255, 255, 255', 1],       // velature, hover, bordi sottili
        shade: ['0, 0, 0', 1],           // ombre e separatori scuri
        panel_bg: ['18, 18, 21'],        // barra superiore
        surface: ['30, 30, 34'],         // menu, impostazioni rapide, notifiche, OSD
        window: ['22, 22, 25'],          // GTK: finestra e barre del titolo
        view: ['18, 18, 21'],            // GTK: contenuto
        card: ['34, 34, 38'],
        dialog: ['28, 28, 31'],
        popover: ['30, 30, 34'],
        overview: ['18, 18, 21'],
        slider_handle: ['242, 242, 242'],
        button_idle: ['255, 255, 255', 1],  // pulsanti finestra con la finestra non attiva
    },
    light: {
        text: ['20, 20, 24', 1],
        ink: ['0, 0, 0', 0.6],
        shade: ['0, 0, 0', 0.45],
        panel_bg: ['250, 250, 252'],
        surface: ['246, 246, 248'],
        window: ['242, 242, 245'],
        view: ['255, 255, 255'],
        card: ['255, 255, 255'],
        dialog: ['250, 250, 251'],
        popover: ['255, 255, 255'],
        overview: ['236, 236, 240'],
        slider_handle: ['255, 255, 255'],
        button_idle: ['0, 0, 0', 0.9],
    },
};

// GNOME Shell (sopra la sfocatura di Blur my Shell)
const SHELL_WEIGHTS = {
    panel: 0.95,
    popup: 0.70,
    dock: 0.85,
    osd: 0.55,
    dialog: 0.45,
    notification: 0.45,
    folder: 0.55,
};

// App GTK4 / libadwaita: lo sfondo finestra si vede solo sotto barre
// del titolo e sidebar (contenuto e card restano opachi: vedi gtk4.css.in)
const APP_WEIGHTS = {
    gtkWindow: 0.70,
    gtkPopover: 0.08,
};

/**
 * @param {number} transparency 0..100
 * @param {number} radius raggio base in px
 * @param {number} [panelHeight] altezza della barra superiore in px
 * @param {number} [appTransparency] 0..100 per le finestre delle app (0 = opache)
 * @param {number} [clockSize] dimensione dell'orologio in % (100 = predefinita)
 * @param {boolean} [dark] variante scura (false = chiara)
 * @returns {Record<string, string|number>}
 */
export function computeTokens(transparency, radius, panelHeight = DEFAULT_PANEL_HEIGHT,
    appTransparency = transparency, clockSize = 100, dark = true) {
    const t = clamp(transparency / 100, 0, 1);
    const ta = clamp(appTransparency / 100, 0, 1);
    const r = Math.round(clamp(radius, 0, 24));
    const panel = Math.round(clamp(panelHeight, 24, 56));

    const tokens = {
        r,
        r_sm: Math.max(r - 4, 0),
        r_lg: r + 6,
        r_xl: r + 12,
        r_dock: r + 6,
        // Barra superiore flottante a pillola
        panel_h: panel,
        r_panel: Math.floor(panel / 2),
        // Icone delle app nella barra proporzionate all'altezza
        panel_icon: Math.round(clamp(panel * 0.6, 16, 32)),
        // Orologio: dimensione base del carattere, le misure del widget sono in em
        clock_font: (16 * clamp(clockSize, 50, 200) / 100).toFixed(2),
        // Sulla schermata di blocco l'orologio è più grande (×1.6)
        clock_lock_font: (16 * 1.6 * clamp(clockSize, 50, 200) / 100).toFixed(2),
    };

    for (const [name, k] of Object.entries(SHELL_WEIGHTS))
        tokens[`a_${name}`] = (1 - k * t).toFixed(3);
    for (const [name, k] of Object.entries(APP_WEIGHTS))
        tokens[`a_${name}`] = (1 - k * ta).toFixed(3);
    for (const [name, [rgb, k = 1]] of Object.entries(PALETTES[dark ? 'dark' : 'light'])) {
        tokens[name] = rgb;
        tokens[`${name}_k`] = k;
    }
    tokens.slider_border = dark ? 0 : 1;

    return tokens;
}

/**
 * Sostituisce i segnaposto del modello con i valori: {{nome}} e, per i colori,
 * {{nome:alfa}} (vedi PALETTES). Un segnaposto sconosciuto resta invariato (e si
 * nota subito nel CSS).
 *
 * @param {string} template
 * @param {Record<string, string|number>} tokens
 */
export function render(template, tokens) {
    return template.replace(/\{\{(\w+)(?::([\d.]+))?\}\}/g, (match, key, alpha) => {
        if (!(key in tokens))
            return match;
        if (alpha === undefined)
            return String(tokens[key]);
        const a = Math.min(1, Number(alpha) * (tokens[`${key}_k`] ?? 1));
        return `rgba(${tokens[key]}, ${Number(a.toFixed(3))})`;
    });
}

/** Raggi della sfocatura di Blur my Shell allineati al tema. */
export function blurRadii(tokens) {
    return {
        'menu-corner-radius': tokens.r,
        'submenu-corner-radius': tokens.r_sm,
        'quick-settings-corner-radius': tokens.r_xl,
        'calendar-corner-radius': tokens.r_xl,
        'notification-corner-radius': tokens.r_lg,
        'dialog-corner-radius': tokens.r_lg,
        'osd-corner-radius': tokens.r_lg,
        'osd-window-corner-radius': tokens.r_lg,
        'resize-popup-corner-radius': tokens.r,
        'candidate-corner-radius': tokens.r_sm,
        'corner-radius': tokens.r,
    };
}
