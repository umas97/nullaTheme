# Translations

Nulla is written in English; this folder holds the translations, one
[gettext](https://www.gnu.org/software/gettext/) `.po` file per language. The
extension (preferences and shell labels) and the install scripts follow the system
language automatically and fall back to English when a language or a single
string is not translated.

| File | |
|---|---|
| `nulla.pot` | template with every string (generated, do not edit) |
| `it.po` | Italian |

## Add a language

1. Copy the template, naming it with the language code:
   `cp po/nulla.pot po/de.po` (`fr.po`, `es.po`, `pt_BR.po`, …).
2. In the header set `"Language: de\n"`, then fill in every `msgstr ""` (any `.po`
   editor works, e.g. Poedit or GNOME's Translation Editor). Keep `%s` placeholders
   and the strftime codes of the date formats (`%A`, `%B`, `%e`, …) — the comment
   above each date string explains it.
3. Run `./install.sh` and log out and back in. No gettext tools are needed: the
   `.mo` files are compiled by `tools/i18n.py`.

## After changing strings in the code

```bash
python3 -I tools/i18n.py update
```

It refreshes `nulla.pot` and every `.po` (new strings appear with an empty
`msgstr`, removed ones are dropped) and prints how complete each language is.
Strings are picked up from `_('…')` in the JavaScript files and from
`say` / `warn` / `note "…"` in the shell scripts.
