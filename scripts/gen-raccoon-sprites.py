#!/usr/bin/env python3
"""Draws the desktop raccoon's sprite sheet.

The raccoon is assembled from a handful of shapes on a 32x32 canvas, one
pose per frame, then outlined and scaled 3x without smoothing. Edit a pose
below and rerun:

    scripts/gen-raccoon-sprites.py            # writes the sheet
    scripts/gen-raccoon-sprites.py --preview out.png   # 8x contact sheet

The frame order is a contract with pet.js (ANIMATIONS): do not reorder,
append instead.
"""
import math
import sys
from pathlib import Path

from PIL import Image

SIZE = 32          # logical pixels per frame
SCALE = 3          # shipped frames are SIZE*SCALE px
COLUMNS = 8
ROWS = 4
OUT = (Path(__file__).resolve().parent.parent /
       'config/includes.chroot/usr/share/gnome-shell/extensions'
       '/raccoon@sloppinux.local/sprites/raccoon.png')

OUTLINE = (38, 30, 46, 255)
FUR = (140, 137, 152, 255)
LIGHT = (190, 187, 200, 255)
DARK = (92, 88, 104, 255)
WHITE = (244, 241, 235, 255)
MASK = (50, 41, 60, 255)
NOSE = (24, 18, 30, 255)
PINK = (232, 140, 164, 255)
RING = (62, 56, 72, 255)
PUPIL = (16, 12, 20, 255)
RED = (226, 72, 86, 255)
CYAN = (62, 207, 207, 255)
CRUMB = (214, 164, 96, 255)
CHIP = (110, 72, 44, 255)
ARROW = (250, 250, 250, 255)


class Canvas:
    def __init__(self):
        self.px = {}

    def put(self, x, y, color):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < SIZE and 0 <= y < SIZE:
            if color is None:
                self.px.pop((x, y), None)
            else:
                self.px[(x, y)] = color

    def ellipse(self, cx, cy, rx, ry, color, clip=None):
        for y in range(SIZE):
            for x in range(SIZE):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    if clip is None or (x, y) in clip:
                        self.put(x, y, color)

    def rect(self, x0, y0, x1, y1, color):
        for y in range(int(round(y0)), int(round(y1)) + 1):
            for x in range(int(round(x0)), int(round(x1)) + 1):
                self.put(x, y, color)

    def line(self, x0, y0, x1, y1, color):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) or 1
        for i in range(steps + 1):
            t = i / steps
            self.put(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color)

    def region(self, cx, cy, rx, ry):
        return {(x, y) for y in range(SIZE) for x in range(SIZE)
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0}

    def outline(self):
        edge = set()
        for (x, y) in self.px:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                p = (x + dx, y + dy)
                if p not in self.px and 0 <= p[0] < SIZE and 0 <= p[1] < SIZE:
                    edge.add(p)
        for p in edge:
            self.px[p] = OUTLINE

    def image(self):
        img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        for (x, y), color in self.px.items():
            img.putpixel((x, y), color)
        return img


def tail(c, base, angle, curl, length=5, radius=2.6):
    """Striped tail: overlapping blobs marching away from `base`."""
    x, y = base
    a = math.radians(angle)
    for i in range(length):
        r = radius - 0.25 * i if i < length - 1 else radius - 0.9
        c.ellipse(x, y, max(r, 1.3), max(r, 1.3), RING if i % 2 else LIGHT)
        x += math.cos(a) * 2.6
        y -= math.sin(a) * 2.6
        a += math.radians(curl)
    c.ellipse(x - math.cos(a) * 1.2, y + math.sin(a) * 1.2, 1.3, 1.3, RING)


def head(c, hx, hy, eyes='open', mouth='shut', tilt=0):
    """Chibi head in three-quarter view, snout to the right."""
    # ears first, so the skull overlaps their bases
    for ex in (hx - 4.5, hx + 3):
        c.ellipse(ex, hy - 5.5, 2.2, 2.6, DARK)
        c.ellipse(ex + 0.2, hy - 5.2, 1.0, 1.4, PINK)
    skull = c.region(hx, hy, 6.6, 5.6)
    c.ellipse(hx, hy, 6.6, 5.6, FUR)
    c.ellipse(hx - 4.6, hy + 2.6, 2.6, 2.2, LIGHT)             # cheek fluff
    c.ellipse(hx + 1.2, hy - 2.6, 5.2, 1.5, LIGHT, clip=skull)  # brow
    c.ellipse(hx + 1.0, hy + 0.2 + tilt, 5.8, 2.1, MASK, clip=skull)
    c.ellipse(hx + 3.6, hy + 3.2, 3.6, 2.3, WHITE)              # muzzle
    c.rect(hx + 6, hy + 2, hx + 7, hy + 2, NOSE)
    c.put(hx + 6, hy + 3, NOSE)
    if mouth == 'open':
        c.rect(hx + 3, hy + 4, hx + 4, hy + 5, NOSE)
        c.put(hx + 3, hy + 5, PINK)
    elif mouth == 'smile':
        c.put(hx + 3, hy + 4, NOSE)
        c.put(hx + 4, hy + 5, NOSE)
        c.put(hx + 5, hy + 4, NOSE)
    else:
        c.put(hx + 4, hy + 4, NOSE)
    for ex in (hx - 2, hx + 3):
        ey = hy + tilt
        if eyes == 'open':
            c.rect(ex, ey - 1, ex + 1, ey, WHITE)
            c.put(ex + 1, ey, PUPIL)
        elif eyes == 'half':
            c.rect(ex, ey, ex + 1, ey, WHITE)
            c.put(ex + 1, ey, PUPIL)
        elif eyes == 'shut':
            c.rect(ex, ey, ex + 1, ey, LIGHT)
        elif eyes == 'happy':          # ^ ^
            c.put(ex, ey, WHITE)
            c.put(ex + 1, ey - 1, WHITE)
            c.put(ex + 2, ey, WHITE)
        elif eyes == 'angry':
            c.rect(ex, ey - 1, ex + 1, ey, RED)
            c.put(ex + 1, ey, PUPIL)
            c.line(ex - 1, ey - 3, ex + 2, ey - 2, NOSE)
        elif eyes == 'sad':
            c.rect(ex, ey, ex + 1, ey + 1, WHITE)
            c.put(ex, ey + 1, PUPIL)
        elif eyes == 'dizzy':          # x x
            c.put(ex, ey - 1, WHITE)
            c.put(ex + 2, ey - 1, WHITE)
            c.put(ex + 1, ey, WHITE)
            c.put(ex, ey + 1, WHITE)
            c.put(ex + 2, ey + 1, WHITE)


def leg(c, x, top, bottom, far=False):
    c.rect(x, top, x + 1, bottom, RING if far else DARK)
    c.put(x + 2, bottom, RING if far else DARK)       # toe


def walker(step, droop=False, carry=False, eyes='open'):
    """Side view on all fours. `step` 0..3 cycles the legs."""
    c = Canvas()
    bob = (0, 1, 0, 1)[step]
    by = 21 + bob
    # leg x offsets per step: (far hind, near hind, far front, near front)
    gait = ((1, -1, -1, 1), (0, 0, 0, 0), (-1, 1, 1, -1), (0, 0, 0, 0))[step]
    lift = ((0, 1, 1, 0), (0, 0, 0, 0), (1, 0, 0, 1), (0, 0, 0, 0))[step]
    if droop:
        tail(c, (6, by + 1), 200, -8, length=4)
    else:
        tail(c, (6, by - 1), 125 + 8 * (step % 2), -14)
    leg(c, 9 + gait[0], by + 2, 29 - lift[0], far=True)
    leg(c, 19 + gait[2], by + 2, 29 - lift[2], far=True)
    c.ellipse(13.5, by, 8.2, 4.6, FUR)
    c.ellipse(13.5, by + 2.6, 6.5, 1.8, LIGHT)
    leg(c, 7 + gait[1], by + 2, 29 - lift[1])
    leg(c, 17 + gait[3], by + 2, 29 - lift[3])
    hy = by - (2 if droop else 6)
    hx = 22 if not droop else 23
    head(c, hx, hy, eyes='sad' if droop else eyes,
         mouth='open' if carry else 'shut')
    if carry:                       # a pointer arrow clamped in its teeth
        ax, ay = hx + 5, hy + 5
        for i in range(5):
            c.rect(ax, ay + i, ax + min(i, 3), ay + i, ARROW)
        c.put(ax + 1, ay + 5, ARROW)
    c.outline()
    return c


def sitter(breath=0, eyes='open', mouth='shut', back=False, bounce=0,
           tail_flick=0, food=False):
    """Sitting upright, facing right."""
    c = Canvas()
    by = 23 - bounce
    tail(c, (9, 27 - bounce), 170 - tail_flick, -28, length=4)
    c.ellipse(15, by, 5.6, 6.2 + breath * 0.5, FUR)
    c.ellipse(16.5, by + 1.2, 3.4, 4.2, LIGHT)             # belly
    c.rect(11, 28, 13, 29, DARK)                           # hind foot
    c.rect(17, 28, 20, 29, DARK)
    if food:
        c.rect(18, by - 1, 19, by + 1, DARK)               # paws up
        c.ellipse(21, by - 1.5, 2.2, 2.2, CRUMB)
        c.put(20, by - 2, CHIP)
        c.put(22, by - 1, CHIP)
    else:
        c.rect(17, by + 1, 18, 27, DARK)                   # front paw down
    hy = 13 - breath - bounce
    if back:
        hy += 2
    head(c, 17, hy, eyes=eyes, mouth=mouth)
    c.outline()
    return c


def sleeper(breath=0):
    c = Canvas()
    c.ellipse(15, 24 - breath * 0.5, 9.5, 4.8 + breath * 0.5, FUR)
    c.ellipse(15, 26.5, 7.5, 1.8, LIGHT)
    tail(c, (7, 26), 12, 22, length=5, radius=2.4)
    for ex in (15.5, 21.5):                                # ears
        c.ellipse(ex, 19, 1.9, 2.1, DARK)
    skull = c.region(20, 24, 5.6, 4.4)
    c.ellipse(20, 24, 5.6, 4.4, FUR)
    c.ellipse(20.5, 24.2, 5.0, 1.8, MASK, clip=skull)
    c.ellipse(23, 26.6, 2.8, 1.7, WHITE)
    c.rect(25, 26, 26, 26, NOSE)
    for ex in (18, 22):
        c.rect(ex, 24, ex + 1, 24, LIGHT)
    c.outline()
    return c


def dangler(swing=0):
    """Held by the scruff (at 15-16, 5-7): body hangs, limbs and tail swing."""
    c = Canvas()
    s = swing
    tail(c, (12 - s, 24), 198 + 16 * s, 4, length=4)
    c.ellipse(15, 20, 4.8, 7.0, FUR)
    c.ellipse(16.4, 21.5, 2.8, 4.8, LIGHT)
    for x, far in ((12 + s, True), (17 - s, False)):       # hind legs
        c.rect(x, 26, x + 1, 29, RING if far else DARK)
    for x in (19, 20):                                     # front paws out
        c.rect(x, 17 + s, x + 2, 18 + s, DARK)
    head(c, 18, 11, eyes='sad', mouth='open')
    c.rect(15, 5, 16, 7, LIGHT)                            # pinched scruff
    c.outline()
    return c


def ball():
    c = Canvas()
    c.ellipse(16, 17, 9.5, 9.5, FUR)
    c.ellipse(16, 17, 6.0, 6.0, LIGHT)
    for i, a in enumerate(range(20, 380, 45)):             # tail wrapped round
        x = 16 + math.cos(math.radians(a)) * 8.2
        y = 17 - math.sin(math.radians(a)) * 8.2
        c.ellipse(x, y, 2.0, 2.0, RING if i % 2 else LIGHT)
    skull = c.region(17, 16, 5.0, 4.2)
    c.ellipse(17, 16, 5.0, 4.2, FUR)
    c.ellipse(17.5, 16.2, 4.6, 1.8, MASK, clip=skull)
    for ex in (15, 19):                                    # x x
        c.put(ex, 15, WHITE)
        c.put(ex + 1, 16, WHITE)
        c.put(ex, 17, WHITE)
    c.ellipse(19.5, 19, 2.2, 1.4, WHITE)
    c.put(21, 19, NOSE)
    c.outline()
    return c


# The floating effects are separate 16x16 icons (fx-<name>.png), drawn from
# character maps: they are shown through St.Icon, not sliced from the sheet.
FX_KEY = {'r': RED, 'w': WHITE, 'c': CRUMB, 'k': CHIP, 'l': (232, 190, 124, 255)}
FX_ART = {
    'heart': """
        ................
        ................
        ...rrr....rrr...
        ..rwwrr..rrrrr..
        ..rwrrrrrrrrrr..
        ..rrrrrrrrrrrr..
        ..rrrrrrrrrrrr..
        ...rrrrrrrrrr...
        ....rrrrrrrr....
        .....rrrrrr.....
        ......rrrr......
        .......rr.......
        ................
        ................
        ................
        ................""",
    'zzz': """
        ................
        .........wwwww..
        ............w...
        ...........w....
        ..........w.....
        .........wwwww..
        ................
        ...wwww.........
        .....w..........
        ....w...........
        ...wwww.........
        ................
        ................
        ................
        ................
        ................""",
    'anger': """
        ................
        ................
        ......r..r......
        ......r..r......
        ......r..r......
        ..rrrrr..rrrrr..
        ................
        ................
        ..rrrrr..rrrrr..
        ......r..r......
        ......r..r......
        ......r..r......
        ................
        ................
        ................
        ................""",
    'food': """
        ................
        ................
        .....cccc.......
        ...cccccc.......
        ..cllcckc.......
        ..clcccccc.cc...
        .cccckcccccccc..
        .ccccccccckccc..
        .cckccccccccc...
        .cccccckccccc...
        ..cccccccckc....
        ..ccckcccccc....
        ...cccccccc.....
        .....cccc.......
        ................
        ................""",
}


def fx_canvas(name):
    c = Canvas()
    rows = [r.strip() for r in FX_ART[name].strip().splitlines()]
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.':
                c.put(x, y, FX_KEY[ch])
    c.outline()
    return c


def frames():
    f = []
    f += [sitter(0), sitter(1)]                                    # 0-1 idle
    f += [sitter(0, eyes='shut')]                                  # 2 blink
    f += [walker(i) for i in range(4)]                             # 3-6 walk
    f += [sleeper(0), sleeper(1)]                                  # 7-8 sleep
    f += [dangler(0), dangler(1)]                                  # 9-10 dangle
    f += [ball()]                                                  # 11 ball
    f += [sitter(0, eyes='half', back=True),                       # 12-13 sulk
          sitter(0, eyes='half', back=True, tail_flick=22)]
    f += [sitter(0, eyes='happy', mouth='smile'),                  # 14-15 happy
          sitter(1, eyes='happy', mouth='smile', bounce=1)]
    f += [sitter(0, eyes='happy', food=True),                      # 16-17 eat
          sitter(0, eyes='happy', mouth='open', food=True)]
    f += [walker(i, droop=True) for i in range(4)]                 # 18-21 droop
    f += [walker(0, carry=True), walker(2, carry=True)]            # 22-23 carry
    f += [sitter(0, eyes='angry', mouth='open'),                   # 24-25 feral
          sitter(1, eyes='angry', mouth='open', tail_flick=22)]
    return f


def main():
    fr = frames()
    assert len(fr) <= COLUMNS * ROWS
    scale = 8 if '--preview' in sys.argv else SCALE
    cell = SIZE * scale
    sheet = Image.new('RGBA', (COLUMNS * cell, ROWS * cell),
                      (40, 30, 90, 255) if scale == 8 else (0, 0, 0, 0))
    for i, c in enumerate(fr):
        img = c.image().resize((cell, cell), Image.NEAREST)
        sheet.alpha_composite(img, ((i % COLUMNS) * cell, (i // COLUMNS) * cell))
    if '--preview' in sys.argv:
        out = Path(sys.argv[sys.argv.index('--preview') + 1])
    else:
        out = OUT
        out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f'{out}: {len(fr)} frames, {cell}px each')
    if '--preview' not in sys.argv:
        for name in FX_ART:
            icon = fx_canvas(name).image().crop((0, 0, 16, 16))
            icon = icon.resize((16 * SCALE, 16 * SCALE), Image.NEAREST)
            icon.save(OUT.parent / f'fx-{name}.png')
        print(f'{OUT.parent}: fx icons {", ".join(FX_ART)}')


if __name__ == '__main__':
    main()
