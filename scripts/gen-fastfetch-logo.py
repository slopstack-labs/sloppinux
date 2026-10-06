#!/usr/bin/env python3
"""Renders the Sloppinux logo as block art for fastfetch.

The three slabs are taken from sloppinux-logo.svg (same polygons, same
offsets and tilts), rasterised at two samples per character cell, and
written with fastfetch colour markers: $1-$3 are the top faces, $4-$9 the
left and right flanks. The colours themselves live in
/etc/fastfetch/config.jsonc.

    scripts/gen-fastfetch-logo.py [--columns N] [--preview out.png]
"""
import math
import sys
from pathlib import Path

OUT = (Path(__file__).resolve().parent.parent /
       'config/includes.chroot/etc/fastfetch/sloppinux.txt')

TOP = [(0, -120), (260, 0), (0, 120), (-260, 0)]
RIGHT = [(0, 120), (260, 0), (260, 64), (0, 184)]
LEFT = [(-260, 0), (0, 120), (0, 184), (-260, 64)]
# (translate x, translate y, rotation in degrees), bottom slab first, with
# the colour slot of its top / left / right face.
SLABS = [
    ((556, 638, 6), (3, 8, 9)),
    ((484, 488, -5), (2, 6, 7)),
    ((528, 338, 3), (1, 4, 5)),
]
# Mirrors config.jsonc; only used for --preview.
COLOURS = {1: (82, 190, 222), 2: (139, 108, 236), 3: (92, 86, 204),
           4: (0, 150, 199), 5: (0, 112, 160), 6: (98, 40, 180),
           7: (62, 22, 140), 8: (58, 34, 150), 9: (38, 20, 118)}


def placed(poly, tx, ty, deg):
    a = math.radians(deg)
    return [(tx + x * math.cos(a) - y * math.sin(a),
             ty + x * math.sin(a) + y * math.cos(a)) for x, y in poly]


def inside(poly, px, py):
    hit = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > py) != (y1 > py) and px < x0 + (py - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def main():
    columns = 34
    if '--columns' in sys.argv:
        columns = int(sys.argv[sys.argv.index('--columns') + 1])
    faces = []                      # painted in order, later wins
    for (tx, ty, deg), (top, left, right) in SLABS:
        faces.append((placed(LEFT, tx, ty, deg), left))
        faces.append((placed(RIGHT, tx, ty, deg), right))
        faces.append((placed(TOP, tx, ty, deg), top))
    xs = [x for poly, _ in faces for x, _ in poly]
    ys = [y for poly, _ in faces for _, y in poly]
    x0, y0 = min(xs), min(ys)
    cell = (max(xs) - x0) / columns          # one character is cell x 2*cell
    rows = math.ceil((max(ys) - y0) / (2 * cell))

    def sample(col, half_row):
        px = x0 + (col + 0.5) * cell
        py = y0 + (half_row + 0.5) * cell
        colour = 0
        for poly, slot in faces:
            if inside(poly, px, py):
                colour = slot
        return colour

    grid = [[(sample(c, 2 * r), sample(c, 2 * r + 1)) for c in range(columns)]
            for r in range(rows)]

    lines = []
    for row in grid:
        line, current = '', None
        for upper, lower in row:
            if not upper and not lower:
                line += ' '
                continue
            slot = lower or upper
            if slot != current:
                line += f'${slot}'
                current = slot
            line += '█' if upper and lower else ('▀' if upper else '▄')
        lines.append(line.rstrip())
    while lines and not lines[-1]:
        lines.pop()

    if '--preview' in sys.argv:
        from PIL import Image
        img = Image.new('RGB', (columns * 8, rows * 16), (30, 30, 30))
        for r, row in enumerate(grid):
            for c, (upper, lower) in enumerate(row):
                slot = lower or upper
                for half, on in ((0, upper), (1, lower)):
                    if on:
                        for y in range(8):
                            for x in range(8):
                                img.putpixel((c * 8 + x, r * 16 + half * 8 + y),
                                             COLOURS[slot])
        img = img.resize((img.width * 3, img.height * 3), Image.NEAREST)
        img.save(sys.argv[sys.argv.index('--preview') + 1])
    else:
        OUT.write_text('\n'.join(lines) + '\n')
        print(f'{OUT}: {columns} columns x {len(lines)} rows')


if __name__ == '__main__':
    main()
