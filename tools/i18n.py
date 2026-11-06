#!/usr/bin/env python3
"""Nulla — traduzioni (gettext) senza bisogno degli strumenti gettext.

    python3 -I tools/i18n.py update            po/nulla.pot + ogni po/<lingua>.po
    python3 -I tools/i18n.py compile <dir>     po/<lingua>.po → <dir>/<lingua>/LC_MESSAGES/nulla.mo

Le stringhe vengono cercate in:
  • JavaScript: _('…') o _("…"), con un eventuale commento `// Translators:` sopra;
  • script shell: say / warn / note "…" (vedi tools/common.sh).

Il testo sorgente è in inglese, che fa da ripiego per le stringhe non tradotte.
Nuova lingua: vedi po/README.md.
"""

import ast
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PO_DIR = os.path.join(ROOT, 'po')
DOMAIN = 'nulla'
SOURCES = ('extension', 'tools', 'install.sh', 'uninstall.sh')
SKIP = ('tools/preview',)  # strumenti di sviluppo: solo inglese

JS_CALL_RE = re.compile(r"""\b_\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)""")
SH_RE = re.compile(r"""\b(?:say|warn|note)\s+"((?:\\.|[^"\\])*)\"""")


def sources():
    for entry in SOURCES:
        path = os.path.join(ROOT, entry)
        if os.path.isfile(path):
            yield path
            continue
        for base, _dirs, files in os.walk(path):
            if any(os.path.relpath(base, ROOT).startswith(s) for s in SKIP):
                continue
            for name in sorted(files):
                if name.endswith(('.js', '.sh')):
                    yield os.path.join(base, name)


def unescape_js(s):
    return ast.literal_eval('"' + s.replace('"', '\\"').replace("\\'", "'") + '"')


def extract():
    """→ {msgid: (riferimenti, nota per i traduttori)} nell'ordine dei sorgenti."""
    found = {}
    for path in sorted(set(sources())):
        rel = os.path.relpath(path, ROOT)
        with open(path, encoding='utf-8') as f:
            lines = f.read().split('\n')
        note = None
        for number, line in enumerate(lines, 1):
            stripped = line.strip()
            m = re.match(r'//\s*Translators:\s*(.*)', stripped)
            if m:
                note = m.group(1)
                continue
            if path.endswith('.js'):
                strings = [unescape_js(m.group(2)) for m in JS_CALL_RE.finditer(line)]
            else:
                strings = [m.group(1).replace('\\"', '"') for m in SH_RE.finditer(line)
                           if not stripped.startswith('#')]
            for s in strings:
                refs, old_note = found.get(s, ([], None))
                refs.append(f'{rel}:{number}')
                found[s] = (refs, old_note or note)
            if strings or (stripped and not stripped.startswith('//')):
                note = None
    return found


def quote(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t') + '"'


def parse_po(path):
    """→ {msgid: msgstr} (le voci fuzzy sono ignorate)."""
    entries, msgid, msgstr, field, fuzzy = {}, None, None, None, False

    def flush():
        if msgid is not None and not fuzzy:
            entries[msgid] = msgstr or ''

    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('#,'):
                fuzzy = 'fuzzy' in line
            elif line.startswith('msgid '):
                flush()
                msgid, msgstr, field = ast.literal_eval(line[6:]), None, 'id'
            elif line.startswith('msgstr '):
                msgstr, field = ast.literal_eval(line[7:]), 'str'
            elif line.startswith('"'):
                if field == 'id':
                    msgid += ast.literal_eval(line)
                else:
                    msgstr += ast.literal_eval(line)
            elif not line:
                flush()
                msgid, msgstr, field, fuzzy = None, None, None, False
    flush()
    return entries


def write_po(path, strings, translations, header):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(header)
        for msgid, (refs, note) in strings.items():
            f.write('\n')
            if note:
                f.write(f'#. Translators: {note}\n')
            f.write('#: ' + ' '.join(refs) + '\n')
            if '%s' in msgid:  # formato di printf negli script
                f.write('#, c-format\n')
            f.write(f'msgid {quote(msgid)}\nmsgstr {quote(translations.get(msgid, ""))}\n')


def header(lang):
    return (f'# Nulla — {"template" if not lang else lang} translation.\n'
            '# This file is distributed under the same license as Nulla (GPL-3.0).\n'
            'msgid ""\nmsgstr ""\n'
            '"Project-Id-Version: nulla\\n"\n'
            f'"Language: {lang}\\n"\n'
            '"MIME-Version: 1.0\\n"\n'
            '"Content-Type: text/plain; charset=UTF-8\\n"\n'
            '"Content-Transfer-Encoding: 8bit\\n"\n')


def update():
    strings = extract()
    os.makedirs(PO_DIR, exist_ok=True)
    write_po(os.path.join(PO_DIR, f'{DOMAIN}.pot'), strings, {}, header(''))
    for name in sorted(os.listdir(PO_DIR)):
        if not name.endswith('.po'):
            continue
        lang = name[:-3]
        path = os.path.join(PO_DIR, name)
        old = parse_po(path)
        old.pop('', None)
        write_po(path, strings, old, header(lang))
        done = sum(1 for s in strings if old.get(s))
        dropped = [s for s in old if s not in strings and old[s]]
        print(f'{lang}: {done}/{len(strings)} translated'
              + (f', {len(dropped)} obsolete removed' if dropped else ''))
    print(f'{len(strings)} strings → po/{DOMAIN}.pot')


def write_mo(path, catalog):
    """Scrittore minimo di file .mo GNU (come Tools/i18n/msgfmt.py di Python)."""
    ids = sorted(catalog)
    keys = b''.join(k.encode() + b'\0' for k in ids)
    values = b''.join(catalog[k].encode() + b'\0' for k in ids)
    count = len(ids)
    key_start = 7 * 4 + 16 * count
    value_start = key_start + len(keys)
    offsets, k_off, v_off = [], 0, 0
    for k in ids:
        kb, vb = k.encode(), catalog[k].encode()
        offsets.append((len(kb), key_start + k_off, len(vb), value_start + v_off))
        k_off += len(kb) + 1
        v_off += len(vb) + 1
    out = struct.pack('Iiiiiii', 0x950412de, 0, count, 7 * 4, 7 * 4 + count * 8, 0, 0)
    out += b''.join(struct.pack('ii', o[0], o[1]) for o in offsets)
    out += b''.join(struct.pack('ii', o[2], o[3]) for o in offsets)
    with open(path, 'wb') as f:
        f.write(out + keys + values)


def compile_all(out_dir):
    if not os.path.isdir(PO_DIR):
        return
    for name in sorted(os.listdir(PO_DIR)):
        if not name.endswith('.po'):
            continue
        catalog = {k: v for k, v in parse_po(os.path.join(PO_DIR, name)).items() if v}
        catalog[''] = 'Content-Type: text/plain; charset=UTF-8\n'
        target = os.path.join(out_dir, name[:-3], 'LC_MESSAGES')
        os.makedirs(target, exist_ok=True)
        write_mo(os.path.join(target, f'{DOMAIN}.mo'), catalog)


if __name__ == '__main__':
    if sys.argv[1:] == ['update']:
        update()
    elif len(sys.argv) == 3 and sys.argv[1] == 'compile':
        compile_all(sys.argv[2])
    else:
        sys.exit(__doc__)
