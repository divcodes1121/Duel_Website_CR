"""Build the served card, evolution and hero art as WebP.

    python scripts/build-card-art.py            # convert
    python scripts/build-card-art.py --check    # verify only, write nothing

WHY THIS EXISTS: 50 MB OF PNG WAS 94% OF EVERY DEPLOYMENT.

A Vercel deployment stores its build output, and this project's was 53 MB — of
which the entire JS and CSS bundle, the thing CLAUDE.md tracks to the gzip
kilobyte, was 3 MB. The other 50 MB was card art in PNG. At ~190 retained
deployments that is the whole 10 GB free-tier allowance, so the storage warning
was never about code and no amount of bundle work would have touched it.

Measured on a 10-file sample per directory, quality 85: cards 132.5 -> 14.2 KB,
evolutions 487.9 -> 47.1 KB, heroes 483.3 -> 46.1 KB. Roughly -90% before any
resizing at all. WebP is not a new dependency here — `guide/`, `panels/`,
`background/` and `brand/` have shipped it for months; the card art simply never
got the same treatment.

THE INPUT IS `public/`, NOT `assets/`, AND THAT IS DELIBERATE.

Every other art script in this directory reads a master from `assets/` and
writes the served file, with a standing rule that the served copy is never
hand-edited. This one inverts that, because for card art the masters have
DRIFTED and the served set is the corrected one. Two proven differences:

  · `assets/Evolutions/furnance.png` is a typo; the served file, and the card
    key the app actually asks for, is `furnace`.
  · `assets/cards/ronin.png` is 850x850 — square. The served file is 302x363,
    i.e. somebody cropped it to the card frame and only the served copy has it.

Converting from the masters would therefore have shipped a square Ronin and no
Furnace at all. The served PNGs are also already normalised to plain sRGB (the
iCCP profiles were stripped after wide-gamut phones washed the colours out —
verified again here: zero ICC profiles on either side), so nothing is lost by
starting from them. The masters stay where they are as the archive.

WIDTH IS CAPPED AT THE CARD FRAME, AND ASPECT IS NEVER FORCED.

302x363 is the canonical card size: 119 of the 122 cards are exactly that, and
`src/utils/report/geometry.ts` hardcodes `CARD_RATIO = 302 / 363` as the ratio
the PDF lays cards out on. Evolutions and heroes are 598x730 — four times the
pixels — and they render in THE SAME SLOTS as ordinary cards. The largest card
box anywhere in the CSS is 6rem (96px), so 302 wide is already about 3x the
biggest thing it has to fill; 598 was paying for a display size that does not
exist.

But the cap is on WIDTH ALONE and each file keeps its own aspect. Evolution art
is 598x730 (0.819) against a card's 302x363 (0.832), and that difference is
real: CLAUDE.md records a browser probe that counted a 4x2 card grid as three
rows because evolution art sits at a different height. Forcing everything to one
box would change layout, which is not what a storage fix is allowed to do.

NOTHING IS EVER UPSCALED. One evolution is 287x384 and stays 287x384.
"""

import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVED = os.path.join(ROOT, 'public', 'assets')

# The three directories the app builds URLs into. `src/data/cards.ts` has one
# template string per entry here and nothing else in `src/` hardcodes a path.
DIRS = ['cards', 'evolutions', 'heroes']

# The card frame's width. See the note above: this is a CAP, not a target.
MAX_W = 302

# Matching the other art scripts in this directory rather than picking a new
# number — `build-panel-art.py` and `build-guide-art.py` both encode at these.
QUALITY = 88
METHOD = 6


def convert(src: str, dest: str) -> tuple[int, int, tuple[int, int], tuple[int, int]]:
    """Encode one PNG as WebP. Returns (old bytes, new bytes, old size, new size)."""
    old = os.path.getsize(src)
    im = Image.open(src)
    # RGBA throughout: card art is cut out against transparency, and WebP
    # carries an alpha channel so nothing has to be flattened onto a guess
    # about what colour sits behind it.
    im = im.convert('RGBA')
    before = im.size
    if im.width > MAX_W:
        # Height derived from the file's own ratio, never from MAX_W's.
        h = round(im.height * MAX_W / im.width)
        im = im.resize((MAX_W, h), Image.LANCZOS)
    # No `icc_profile` argument, so the output carries none — which is the
    # state the served PNGs were normalised into and must stay in.
    im.save(dest, 'WEBP', quality=QUALITY, method=METHOD)
    return old, os.path.getsize(dest), before, im.size


def main() -> int:
    check_only = '--check' in sys.argv
    grand_old = grand_new = 0
    problems = []

    for d in DIRS:
        path = os.path.join(SERVED, d)
        if not os.path.isdir(path):
            problems.append(f'{d}: directory missing')
            continue
        pngs = sorted(f for f in os.listdir(path) if f.endswith('.png'))
        webps = sorted(f for f in os.listdir(path) if f.endswith('.webp'))

        if check_only:
            # THE CHECK THAT MATTERS: every card the app can ask for must have
            # a file. A missing one is a broken image on a live screen, and it
            # would not fail a build, a typecheck or a test.
            have = {os.path.splitext(f)[0] for f in webps}
            want = {os.path.splitext(f)[0] for f in pngs} or have
            missing = sorted(want - have)
            if missing:
                problems.append(f'{d}: no webp for {missing}')
            print(f'{d:<11} png={len(pngs):>3}  webp={len(webps):>3}  '
                  f'{"MISSING " + str(len(missing)) if missing else "complete"}')
            continue

        old_t = new_t = 0
        resized = 0
        for f in pngs:
            dest = os.path.join(path, os.path.splitext(f)[0] + '.webp')
            o, n, before, after = convert(os.path.join(path, f), dest)
            old_t += o
            new_t += n
            if before != after:
                resized += 1
        grand_old += old_t
        grand_new += new_t
        if pngs:
            print(f'{d:<11} {len(pngs):>3} files  {old_t/1e6:6.1f} MB -> '
                  f'{new_t/1e6:5.2f} MB  ({100 * (1 - new_t / old_t):.0f}% off, '
                  f'{resized} resized)')

    if not check_only and grand_old:
        print(f'{"total":<11}          {grand_old/1e6:6.1f} MB -> '
              f'{grand_new/1e6:5.2f} MB  ({100 * (1 - grand_new / grand_old):.0f}% off)')

    for p in problems:
        print('PROBLEM:', p)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
