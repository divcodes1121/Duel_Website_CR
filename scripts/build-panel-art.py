"""Build the landing screen's banner panels.

    python scripts/build-panel-art.py

Masters live in `assets/panels/<name>.png`; this writes the served WebP to
`public/assets/panels/<name>.webp`. NEVER hand-edit the files in `public/` —
re-run this, the same rule the hero art and the field book plates follow.

It is a straight convert: strip the ICC profile, cap the width, encode. The art
is used exactly as drawn.

WHAT THIS SCRIPT USED TO DO, AND WHY IT DOESN'T
-----------------------------------------------
The panel is ~352px tall at any width and runs to 1568 wide, so a banner has to
fill a box of about 4.45:1. The first art was 2.42:1, and there were three ways
to reconcile that:

  1. Let `cover` crop it — which threw away 56% of the picture's height.
  2. Give the panel the art's ratio — which made it 581px tall against the
     351px the two plain panels stand at, so the row stopped reading as a set.
  3. Widen the CANVAS: keep the art whole on one side and fill the rest with
     the art's own ground, mirrored, blurred and darkened with distance.

(3) was built and REJECTED ON SIGHT. It is a plausible trick and it reads as
one: a mirrored crowd is a crowd with a seam down it, and on art whose subject
fills the frame — roses edge to edge — the mirror produces more subject rather
than more ground, so a second skeleton hand turned up under the body copy. No
amount of blur fixes that; blurring it only makes it a smear instead of a
duplicate. Both attempts are in the history if the reasoning is ever needed.

The answer was to draw the art wider instead. That is a request to whoever makes
the art, not a problem code can solve — and the arithmetic to hand them is: at
the panel's widest the box is 4.45:1, and anything narrower than that gets
cropped from the side `object-position` does not pin.
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The box the widest panel asks for: 1568px of panel at the fixed 352px height.
PANEL_RATIO = 1568 / 352
PANELS = ['royal-duels', 'decks-home', 'counter-palette', 'team-analysis']

# Wide enough that the art is never upscaled on a 1568px panel at 2x DPR, and
# small enough that the file stays a served asset rather than a download.
MAX_W = 2400

# A band is "black" if nothing in it rises above this. Generous, because a
# letterbox bar is not always a perfect zero.
BLACK = 26


def trim_letterbox(im: Image.Image) -> Image.Image:
    """Cut solid black bands off the edges.

    GENERATED ART ARRIVES LETTERBOXED, and the bars are not cosmetic here —
    they are counted in the ratio, and the ratio is what decides how much of
    the picture survives. One master came in at 1774x887 (2.00:1) with 132px of
    black top and bottom; the real artwork inside it is 2.84:1. Trusting the
    file's own dimensions would have reported 55% of the height cut when the
    truth was 36%, and framed the panel to a picture a fifth taller than the
    one actually in it.

    Sampling every 7th pixel: a bar is uniform, so a coarse sweep finds the
    edge as exactly as a dense one and does it in a fraction of the time.
    """
    w, h = im.size
    px = im.load()
    row = lambda y: max(max(px[x, y]) for x in range(0, w, 7))
    col = lambda x: max(max(px[x, y]) for y in range(0, h, 7))

    top = 0
    while top < h and row(top) <= BLACK:
        top += 1
    bot = h - 1
    while bot > top and row(bot) <= BLACK:
        bot -= 1
    left = 0
    while left < w and col(left) <= BLACK:
        left += 1
    right = w - 1
    while right > left and col(right) <= BLACK:
        right -= 1

    if (left, top, right, bot) == (0, 0, w - 1, h - 1):
        return im
    print(f'  trimmed letterbox: {left}/{top}/{w - 1 - right}/{h - 1 - bot} px '
          f'(l/t/r/b), {w}x{h} -> {right - left + 1}x{bot - top + 1}')
    return im.crop((left, top, right + 1, bot + 1))


def build(name: str) -> None:
    src = f'{ROOT}/assets/panels/{name}.png'
    im = Image.open(src).convert('RGB')  # convert drops any embedded ICC
    im = trim_letterbox(im)
    w, h = im.size
    if w > MAX_W:
        im = im.resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)

    dest = f'{ROOT}/public/assets/panels/{name}.webp'
    im.save(dest, 'WEBP', quality=88, method=6)

    # THE BOX IS FLATTER THAN THE ART, so `cover` fills the width and the
    # HEIGHT is what gets cut. Nothing is lost off the sides. Reported that way
    # round because the obvious reading of "the panel is wider than the art" is
    # the opposite of what happens, and it cost a round of wrong framing.
    #
    # Keep every banner near the same ratio as the others. They sit in one
    # column and crop by the same rule, so a banner that is a different shape is
    # a banner that loses a different amount of itself than its neighbours.
    crop = max(0.0, 1 - (w / h) / PANEL_RATIO)
    note = 'fills it' if crop < 0.01 else f'{crop * 100:.0f}% of its HEIGHT cut at 1568 wide'
    print(f'{name}: {w}x{h} ({w / h:.2f}:1) vs panel {PANEL_RATIO:.2f}:1 — {note}'
          f' — {os.path.getsize(dest) / 1024:.0f} kB')


if __name__ == '__main__':
    for n in PANELS:
        build(n)
