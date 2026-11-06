#!/usr/bin/env python3
"""Builds docs/screenshots/ for the README from two tools/preview.sh runs.

    S=/tmp/nulla-shots
    for scheme in prefer-dark default; do
        LANG=C.UTF-8 NULLA_PREVIEW_SCHEME=$scheme NULLA_PREVIEW_WALLPAPER=docs/wallpaper.jpg \\
            tools/preview.sh $S/$scheme
    done
    python3 -I tools/preview/readme-screenshots.py $S/prefer-dark $S/default

The lock screen shows the real name of the user running the preview: it is
replaced with "Nulla" (coordinates for the 1600x1000 virtual monitor).
Requires Pillow.
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'docs', 'screenshots')
FONT = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf'


def anonymize_lock(image):
    """Paints over the user name under the avatar and writes "Nulla"."""
    px = image.load()
    x0, x1, y0, y1 = 630, 970, 421, 459
    for x in range(x0, x1):
        top, bottom = px[x, y0], px[x, y1]
        for y in range(y0 + 1, y1):
            t = (y - y0) / (y1 - y0)
            px[x, y] = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, 19)
    width = draw.textlength('Nulla', font=font)
    draw.text((800 - width / 2, 429), 'Nulla', font=font, fill=(232, 232, 234))
    return image


def main(dark_dir, light_dir):
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        (dark_dir, '01-desktop-hover-gtk4', 'desktop', None),
        (light_dir, '01-desktop-hover-gtk4', 'desktop-light', None),
        (dark_dir, '03-quick-settings', 'quick-settings', (980, 0, 1600, 300)),
        (light_dir, '04-calendar', 'calendar-light', (800, 0, 1600, 480)),
        (dark_dir, '05-overview', 'overview', None),
        (dark_dir, '08-preferenze', 'preferences', None),
        (dark_dir, '17-blocco-password', 'lock-screen', None),
    ]
    for folder, source, name, crop in jobs:
        image = Image.open(os.path.join(folder, f'{source}.png')).convert('RGB')
        if crop:
            image = image.crop(crop)
        if name == 'lock-screen':
            image = anonymize_lock(image)
        image.save(os.path.join(OUT, f'{name}.png'), optimize=True)
        print(f'docs/screenshots/{name}.png')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
