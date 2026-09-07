"""Turn a downloaded card render into the served art for one card.

    python scripts/import-card-art.py <source> <dir> <key> [--dry-run]
    python scripts/import-card-art.py ~/Downloads/minion-giant.jpeg cards minion-giant

`<dir>` is `cards`, `evolutions` or `heroes` — the three directories
`src/data/cards.ts` builds URLs into. The output is
`public/assets/<dir>/<key>.webp`, which is what the app requests.

WHY THIS IS NOT `build-card-art.py`. That script re-encodes art that is ALREADY
a cutout — it changes the container and the width and nothing else. Card renders
as they arrive are a picture ON A BACKGROUND, usually black, and dropping one
into the app in that state puts a black rectangle in every deck strip. The two
scripts do different jobs and this one runs first.

THE BACKGROUND IS FLOOD-FILLED FROM THE EDGES, NOT COLOUR-KEYED.

`build-hero-art.py` already had to learn this and the reasoning transfers
exactly: a global "is this pixel near the background colour" test punches holes
through the artwork wherever it happens to contain that colour. On a black
field that is far worse than it was on the king's white one — card art is full
of black outlines, pupils, shadows under a chin — so a global key does not
merely nick an edge, it perforates the subject. Only background CONNECTED to
the border is removed.

THE EDGE IS DECONTAMINATED, and on these images that is most of the picture.

An antialiased boundary pixel is already mixed with the backdrop
(C = aF + (1-a)BG), so keying alone leaves a dark halo which is invisible on
the dark theme and obvious on the light one. Recovering F = (C - (1-a)BG) / a
is what makes one file work on both grounds.

Against BLACK that recovery is unusually load-bearing, because a hero card is
mostly GLOW: a wide gold corona that fades to nothing. Every pixel of it is a
partial-alpha pixel, and the existing hero art shows what the right answer
looks like — `mega-minion.webp` is only 4.4% fully transparent against a plain
card's 21-27%, which is that corona holding partial alpha rather than being
cut off at some threshold. FLOOR/CEIL is deliberately wide here for the same
reason: a tight ramp would clip the glow into a hard-edged blob.

WIDTH IS CAPPED AT 302 AND ASPECT IS KEPT. Same rule, and the same reasons, as
`build-card-art.py` — see that file's header. Nothing is upscaled.

VERIFY BY LOOKING AT IT ON BOTH GROUNDS. `--dry-run` writes nothing and instead
reports the alpha profile next to the existing art in that directory, which is
the comparison that says whether the cutout is the same KIND of object as its
neighbours. A number that sits outside the neighbours' range is the tell.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SERVED = ROOT / "public" / "assets"
DIRS = ("cards", "evolutions", "heroes")

# The card frame's width — `build-card-art.py` explains why this number.
MAX_W = 302
QUALITY = 88

# THE FLOOR IS MEASURED FROM THE IMAGE, NOT DECLARED.
#
# `build-hero-art.py` could hardcode 6/26 because it cuts one known master off
# one known flat field. Card renders arrive from wherever they were downloaded
# and their margins are not comparable: measured on the two imported so far,
# the Hero Ice Wizard sits on essentially pure black (outer ring 0-3) while the
# Minion Giant sits in a soft dark halo that reads 25-36. One floor cannot
# serve both — at 8 the halo survives as a grey box around the card, and at 40
# the hero's glow is clipped into a hard-edged blob.
#
# So the floor is whatever that image's own border actually measures, plus a
# little. The ramp above it keeps the width that makes a glow fade smoothly.
RING = 3          # how deep the border sample goes
FLOOR_PAD = 5.0   # above the border's own level
FLOOR_MIN = 8.0   # JPEG ringing is never cleaner than this

# THE RAMP WIDTH IS THE KIND OF EDGE, AND THE TWO KINDS ARE NOT INTERCHANGEABLE.
#
# Measured going in from the left edge of each source, as distance from the
# backdrop:
#
#   Minion Giant   28 28 28 28 28 28 28 31 57 218 241 233 ...
#   Hero Ice Wiz    3  6 11 16 24 33 40 53  67  81  95 115 131 153 175 ...
#
# The card is a HARD-EDGED object sitting in a flat drop shadow: eighteen
# pixels of unchanging halo and then a step. The hero is a GLOW, rising
# smoothly over about eighty levels, and that corona is part of what the card
# IS — the existing hero art keeps it, which is why `wizard.webp` is only 4.4%
# fully transparent against a plain card's 21-38%.
#
# One ramp cannot serve both. A wide ramp on the card spreads partial alpha
# across its frame, and that shipped a visibly WASHED-OUT card: on the light
# theme the ground came through the border and the whole thing read as faded
# next to the Knight, while on dark it looked perfectly fine. A narrow ramp on
# the hero would clip the corona into a hard-edged blob.
#
# Both numbers come off the profiles above: 20 puts the card's halo (28) under
# the floor and its frame (57+) over the ceiling, and 62 spans the glow.
SPAN_HARD = 20.0  # cards: frame plus drop shadow
SPAN_GLOW = 62.0  # heroes and evolutions: the corona is the mark
SPANS = {"cards": SPAN_HARD, "evolutions": SPAN_GLOW, "heroes": SPAN_GLOW}


def cut(im: Image.Image, span: float) -> tuple[Image.Image, float, float]:
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[0, 0]

    def dist(c) -> float:
        return max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2]))

    # What this particular image's margin actually is. Taking the worst pixel
    # rather than a mean: a mean is dragged down by the clean corners and would
    # leave the halo's own body above the floor, which is the failure being
    # avoided.
    ring = [dist(px[x, y]) for y in range(RING) for x in range(w)]
    ring += [dist(px[x, h - 1 - y]) for y in range(RING) for x in range(w)]
    ring += [dist(px[x, y]) for x in range(RING) for y in range(h)]
    ring += [dist(px[w - 1 - x, y]) for x in range(RING) for y in range(h)]
    ring.sort()
    # THE MEDIAN, NOT THE MAXIMUM, AND THAT IS NOT A DETAIL. The first version
    # took the worst pixel and produced a floor of 124 on the Minion Giant,
    # which left the card 38.9% opaque against a neighbour's 70% — a card you
    # could see through. The cause: its frame reaches into row 2, so the
    # brightest "border" pixels are the artwork's own top corners. Measured on
    # that ring, p50 is 25 (the halo) and p90 is 110 (the card). Any statistic
    # near the top of that distribution is reading the subject.
    floor = max(FLOOR_MIN, ring[len(ring) // 2] + FLOOR_PAD)
    ceil = floor + span

    outside = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if not outside[y * w + x] and dist(px[x, y]) <= ceil:
            outside[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not outside[ny * w + nx]:
                if dist(px[nx, ny]) <= ceil:
                    outside[ny * w + nx] = 1
                    q.append((nx, ny))

    out = Image.new("RGBA", (w, h))
    op = out.load()
    span = ceil - floor
    for y in range(h):
        row = y * w
        for x in range(w):
            c = px[x, y]
            if not outside[row + x]:
                op[x, y] = (c[0], c[1], c[2], 255)
                continue
            d = dist(c)
            if d <= floor:
                op[x, y] = (0, 0, 0, 0)
                continue
            a = min(1.0, (d - floor) / span)
            f = tuple(max(0, min(255, round((c[i] - (1 - a) * bg[i]) / a))) for i in range(3))
            op[x, y] = (f[0], f[1], f[2], round(a * 255))

    # NO BBOX CROP, and `build-hero-art.py` does one for a reason that does not
    # apply here. That script cuts a character out of a large field, where the
    # dead margin is arbitrary and trimming it is what makes CSS sizing honest.
    # These are card renders that are already framed, and the transparent
    # margin is not the same on all four sides — so cropping to the bbox
    # CHANGES THE ASPECT. Measured: it took the hero from the 302x384 its own
    # 615x782 source implies to 302x398, which is taller than any hero already
    # in the directory, and put the new card visibly larger than the Knight
    # beside it. Scaling alone reproduces the framing the existing art has.
    if out.width > MAX_W:
        out = out.resize((MAX_W, round(out.height * MAX_W / out.width)), Image.LANCZOS)
    return out, floor, ceil


def alpha_profile(im: Image.Image) -> tuple[float, float]:
    """(% fully transparent, % fully opaque), sampled. The shape of the cutout."""
    px = im.convert("RGBA").load()
    w, h = im.size
    vals = [px[x, y][3] for y in range(0, h, 3) for x in range(0, w, 3)]
    n = len(vals) or 1
    return 100 * sum(v == 0 for v in vals) / n, 100 * sum(v == 255 for v in vals) / n


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if len(args) != 3:
        print(__doc__.strip().splitlines()[2].strip())
        return 2
    src, folder, key = Path(args[0]).expanduser(), args[1], args[2]
    if folder not in DIRS:
        print(f"second argument must be one of {DIRS}, not {folder!r}")
        return 2
    if not src.exists():
        print(f"no such file: {src}")
        return 2

    dest_dir = SERVED / folder
    dest = dest_dir / f"{key}.webp"
    span = SPANS[folder]
    for a in sys.argv:
        if a.startswith('--span='):
            span = float(a.split('=', 1)[1])
    art, floor, ceil = cut(Image.open(src), span)
    t, o = alpha_profile(art)

    print(f"{src.name} -> {dest.relative_to(ROOT)}")
    print(f"  {Image.open(src).size} -> {art.size}")
    print(f"  floor {floor:.0f} (measured) / ceil {ceil:.0f} (span {span:.0f}, {folder})")
    print(f"  alpha: {t:.1f}% transparent, {o:.1f}% opaque")

    # THE COMPARISON THAT MATTERS: is this the same kind of object as the art
    # already in that directory? A cutout whose alpha profile sits outside the
    # neighbours' range is either uncut or over-cut, and neither is visible in
    # a file size or a pixel count.
    others = [p for p in sorted(dest_dir.glob("*.webp")) if p != dest][:8]
    if others:
        prof = [alpha_profile(Image.open(p)) for p in others]
        lo, hi = min(p[0] for p in prof), max(p[0] for p in prof)
        print(f"  neighbours in {folder}/: {lo:.1f}-{hi:.1f}% transparent "
              f"(n={len(prof)}) {'— IN RANGE' if lo - 5 <= t <= hi + 5 else '— OUT OF RANGE, look at it'}")

    if dry:
        print("  --dry-run: nothing written")
        return 0
    dest_dir.mkdir(parents=True, exist_ok=True)
    art.save(dest, "WEBP", quality=QUALITY, method=6)
    print(f"  written: {dest.stat().st_size / 1024:.0f} kB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
