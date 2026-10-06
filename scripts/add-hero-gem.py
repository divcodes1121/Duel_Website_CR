"""Put the hero gem back on a hero render that arrived without one.

    python scripts/add-hero-gem.py <gemless.png> <out.png> [--donor=magic-archer]
    python scripts/add-hero-gem.py ~/Downloads/hero_ewiz.PNG assets/Heroes/electro-wizard.png

WHY THIS EXISTS. Every hero in `public/assets/heroes/` carries the gold gem on
the top edge of its frame — it is what says "hero" at 40px, the way the violet
gem says "evolution". The Hero Electro Wizard render (2026-10-06) arrived as a
clean RGBA cutout WITHOUT it, while the Evolution Electro Giant downloaded in
the same minute had its gem. Shipped as it came, one hero in eighteen would
have been drawn as a different kind of object.

IT IS A RESTORATION, NOT A DRAWING, AND THE MEASUREMENT IS WHAT MAKES IT ONE.

The render is on the SAME TEMPLATE as `assets/Heroes/magic-archer.png`, to the
pixel: 615x781 against 615x782, and with the new file moved down one row the
alpha of the two agrees EXACTLY (mean difference 0.0 over the glow on both
flanks; one row either side of that offset it is 0.59). Same frame, same glow,
same canvas — the only thing absent is the gem layer. So the donor is not "a
similar picture"; outside the painting it is this picture with the gem on.

The script REFUSES to run unless that holds (`TEMPLATE_TOLERANCE`). Aimed at a
render on the other frame — the fifteen rectangular 598x730 heroes — it stops
rather than paste a gem at the wrong place on the wrong edge.

THREE REGIONS, AND ONLY ONE OF THEM IS AN ESTIMATE.

  1. Everything that is not painting — the outer glow, the gem's own halo
     above the frame, and the pale frame band — is TEMPLATE, identical in both
     files apart from the gem. Copied from the donor verbatim. Exact.
  2. The gem's body is opaque, so what is behind it does not matter. Copied
     verbatim. Exact.
  3. The ring where the gem's halo falls across the PAINTING is the one place
     the donor's pixels carry somebody else's picture (halo over the Magic
     Archer's hair). There the donor is feathered out over `FEATHER` pixels.
     Measured on the donor, the halo just outside the rim is at luminance
     219-237 the whole way round, i.e. saturated yellow whatever is under it,
     which is why the inner part of that ring can be taken as it is.

THE BAND'S INNER EDGE IS LOCATED, NOT ASSUMED. Region 1 must stop where the
painting starts, or a sliver of the donor's painting is copied along the frame.
Away from the gem the two files agree on the band and disagree on the painting,
so the first row where they stop agreeing IS the band's inner edge; its depth
below the frame's outer edge is measured there and carried across the gem,
minus `BAND_SAFETY`. Erring thin is the safe direction: a band pixel treated as
painting is merely blended, a painting pixel treated as band is wrong.

THE GEM'S SHAPE WAS MEASURED OFF THE DONOR along 24 rays from its centre: the
dark outer rim sits at 57-58px on the four flats and 69-70px at the four tips,
which is a rounded square on its corner with half-side 57.5 and corner radius
28.5 (57.5 * sqrt(2) - 0.414 * 28.5 = 69.5).

The output is a full-size PNG for `assets/Heroes/` — the archive. The served
WebP is then made the usual way (`build-card-art.py`, which caps the width and
encodes). The untouched download is NOT what is archived; if the gem is ever
unwanted, re-run `build-card-art.py` on the original render instead.

Plain PIL, no numpy: the region that changes is ~220x230 pixels.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "assets" / "Heroes"

# The gem on the hex hero frame, in the donor's pixel coordinates.
GEM_CX, GEM_CY = 308.5, 101.0
GEM_HALF = 57.5     # centre to a flat
GEM_RADIUS = 28.5   # corner rounding

# How far the gem (halo included) reaches. Checked at run time: on the edge of
# this box the two files must already agree, or the box is too small.
REACH = 118

SOLID = 4.0         # px past the rim taken from the donor as it is
FEATHER = 18.0      # px over which the donor fades out across the painting
BAND_SAFETY = 2     # px shaved off the measured band depth

OPAQUE = 250
TEMPLATE_TOLERANCE = 0.25   # mean alpha difference allowed between the files
SAME = 14                   # per-channel difference still called "the same pixel"


def gem_distance(x: float, y: float) -> float:
    """Signed distance to the gem's rim: negative inside, positive outside."""
    dx, dy = x - GEM_CX, y - GEM_CY
    u = abs(dx + dy) / math.sqrt(2)
    v = abs(dx - dy) / math.sqrt(2)
    qx, qy = u - (GEM_HALF - GEM_RADIUS), v - (GEM_HALF - GEM_RADIUS)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - GEM_RADIUS


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def align(donor: Image.Image, bare: Image.Image) -> int:
    """The row offset that lays `bare` on `donor`. Raises if no offset does."""
    if donor.width != bare.width:
        raise SystemExit(f"different widths ({donor.width} vs {bare.width}): not the same template")
    da, ba = donor.getchannel("A").load(), bare.getchannel("A").load()
    # The glow on both flanks, which the gem never reaches.
    cols = list(range(40, 120)) + list(range(donor.width - 120, donor.width - 40))
    best = None
    for dy in range(-3, 4):
        total = count = 0
        for y in range(20, bare.height - 20):
            yy = y + dy
            if 0 <= yy < donor.height:
                for x in cols:
                    total += abs(da[x, yy] - ba[x, y])
                    count += 1
        mean = total / count
        if best is None or mean < best[1]:
            best = (dy, mean)
    dy, mean = best
    if mean > TEMPLATE_TOLERANCE:
        raise SystemExit(
            f"best alignment still differs by {mean:.2f} per pixel: this render is not on the "
            f"donor's frame. Nothing written.")
    print(f"  template match: donor row = render row {dy:+d}, mean alpha difference {mean:.2f}")
    return dy


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    donor_key = "magic-archer"
    for a in sys.argv[1:]:
        if a.startswith("--donor="):
            donor_key = a.split("=", 1)[1]
    if len(args) != 2:
        print(__doc__.strip().splitlines()[2].strip())
        return 2
    src, dest = Path(args[0]).expanduser(), Path(args[1]).expanduser()
    donor_path = MASTERS / f"{donor_key}.png"
    for p in (src, donor_path):
        if not p.exists():
            print(f"no such file: {p}")
            return 2

    donor = Image.open(donor_path).convert("RGBA")
    raw = Image.open(src).convert("RGBA")
    print(f"{src.name} + gem from {donor_path.relative_to(ROOT)}")
    dy = align(donor, raw)

    # The render, laid on the donor's canvas.
    bare = Image.new("RGBA", donor.size, (0, 0, 0, 0))
    bare.paste(raw, (0, dy))
    d, b = donor.load(), bare.load()
    w, h = donor.size

    def differ(x: int, y: int) -> float:
        """How far apart the two files are at this pixel, PREMULTIPLIED.

        A fully transparent pixel still stores a colour, and the two files
        store different ones (255,210,0 here, something else there) — so a raw
        channel comparison reads 255 between two pixels that are both nothing.
        Weighting each colour by its own alpha compares what is actually drawn.
        """
        p, q = d[x, y], b[x, y]
        worst = abs(p[3] - q[3])
        for i in range(3):
            worst = max(worst, abs(p[i] * p[3] - q[i] * q[3]) / 255)
        return worst

    def same(x: int, y: int) -> bool:
        return differ(x, y) <= SAME

    def outer_edge(x: int) -> int | None:
        """First opaque row of the gemless frame in this column."""
        for y in range(h // 2):
            if b[x, y][3] >= OPAQUE:
                return y
        return None

    x0, x1 = int(GEM_CX - REACH), int(GEM_CX + REACH)
    y1 = int(GEM_CY + REACH)

    # BAND DEPTH, measured on both sides just outside the gem's reach: from the
    # frame's outer edge down to the first row where the two files part.
    depths = []
    for x in list(range(x0 - 60, x0 - 6)) + list(range(x1 + 6, x1 + 60)):
        top = outer_edge(x)
        if top is None:
            continue
        y = top
        while y < h and same(x, y):
            y += 1
        depths.append(y - top)
    depths.sort()
    if not depths:
        raise SystemExit("could not find the frame band beside the gem. Nothing written.")
    # The 10th percentile, not the median: where the two paintings happen to
    # match for a few rows under the band, the run reads LONG. Short is safe.
    depth = depths[len(depths) // 10] - BAND_SAFETY
    print(f"  frame band: {depths[len(depths) // 10]}px deep (p10 of {len(depths)} columns, "
          f"median {depths[len(depths) // 2]}), using {depth}")

    # The box must be bigger than the gem's reach: on its rim, outside the
    # painting, the two files should already be the same pixel.
    rim = []
    for y in range(0, y1):
        for x in (x0, x1):
            top = outer_edge(x)
            if top is None or y < top + depth:
                rim.append(differ(x, y))
    for x in range(x0, x1 + 1):
        rim.append(differ(x, 0))
    worst = max(rim)
    print(f"  seam check: worst difference on the box rim {worst:.1f} (of 255)")
    if worst > SAME:
        raise SystemExit("the gem reaches past the box: raise REACH. Nothing written.")

    out = bare.copy()
    o = out.load()
    verbatim = blended = 0
    for x in range(x0, x1 + 1):
        top = outer_edge(x)
        limit = h if top is None else top + depth      # above this row: template
        for y in range(0, y1 + 1):
            if y < limit:
                o[x, y] = d[x, y]
                verbatim += 1
                continue
            sd = gem_distance(x, y)
            if sd <= SOLID:
                o[x, y] = d[x, y]
                verbatim += 1
                continue
            k = 1.0 - smooth((sd - SOLID) / FEATHER)
            if k <= 0.0:
                continue
            p, q = d[x, y], b[x, y]
            o[x, y] = tuple(round(k * p[i] + (1 - k) * q[i]) for i in range(4))
            blended += 1
    print(f"  {verbatim} pixels from the template, {blended} blended across the painting")

    dest.parent.mkdir(parents=True, exist_ok=True)
    # No `icc_profile`: card art is plain sRGB (see build-card-art.py).
    out.save(dest, "PNG", optimize=True)
    print(f"  written: {dest} {out.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
