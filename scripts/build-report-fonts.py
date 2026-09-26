"""Build the fonts the PDF reports embed.

    python scripts/build-report-fonts.py

Masters live in `assets/fonts/` (Inter 4.1 static TTFs under `inter/`, and
Bebas Neue); the served subsets land in `public/assets/fonts/report/`. Never
hand-edit the outputs — re-run this.

WHY SUBSET HERE AND NOT LET jsPDF DO IT. jsPDF does subset what it WRITES into
the PDF, but the browser still has to FETCH and PARSE the whole font at export
time: Inter is 410 kB a weight, 2,852 glyphs, almost all of them Cyrillic,
Greek and symbols no report prints. Cutting to Latin + the punctuation this app
uses takes each weight to a few tens of kB, which is the difference between
the export button feeling instant and feeling like a download.

WHY A GLYPH LIST IS WRITTEN BESIDE THEM. A character the embedded font has no
glyph for prints as an empty box, which reads as corrupt data. The renderer
therefore sanitises every string against the code points each font ACTUALLY
holds after subsetting — read from the output files, not restated by hand, so
the list cannot drift from the fonts.

jsPDF needs a TrueType `glyf` font (it cannot embed CFF/OpenType outlines) with
a `name` table it can read a PostScript name from; pyftsubset's defaults keep
both. Hinting and layout features are dropped: jsPDF applies neither.
"""

from __future__ import annotations

import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "public", "assets", "fonts", "report")
GLYPHS = os.path.join(ROOT, "src", "utils", "report", "glyphs.json")

# Basic Latin, Latin-1, Latin Extended-A (player names: Ł, ő, Ş ...), and the
# punctuation / symbols the adapters actually emit.
RANGES = [
    (0x0020, 0x007E),
    (0x00A0, 0x00FF),
    (0x0100, 0x017F),
    (0x2010, 0x2027),  # dashes, quotes, bullet, ellipsis
    (0x2030, 0x2030),
    (0x2039, 0x203A),
    (0x20AC, 0x20AC),
    (0x2122, 0x2122),
    (0x2190, 0x2193),  # arrows
    (0x2212, 0x2212),  # minus
    (0x2248, 0x2248),
    (0x2264, 0x2265),
    (0x25B2, 0x25B2),  # movement triangles
    (0x25BC, 0x25BC),
]

FONTS = [
    # (master, output, key in glyphs.json)
    ("inter/Inter-Regular.ttf", "Inter-Regular.ttf", "body"),
    ("inter/Inter-SemiBold.ttf", "Inter-SemiBold.ttf", "bodyBold"),
    ("BebasNeue-Regular.ttf", "BebasNeue.ttf", "display"),
]


def unicodes() -> list[int]:
    out: list[int] = []
    for a, b in RANGES:
        out.extend(range(a, b + 1))
    return out


def ranges_of(points: list[int]) -> list[list[int]]:
    """Collapse sorted code points into [start, end] runs."""
    runs: list[list[int]] = []
    for p in sorted(points):
        if runs and p == runs[-1][1] + 1:
            runs[-1][1] = p
        else:
            runs.append([p, p])
    return runs


def build(master: str, out: str) -> list[int]:
    opts = subset.Options()
    opts.layout_features = []
    opts.hinting = False
    opts.drop_tables += ["GPOS", "GSUB", "GDEF", "kern", "STAT", "DSIG"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = TTFont(master)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes())
    sub.subset(font)
    font.save(out)
    return sorted(TTFont(out).getBestCmap().keys())


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    glyphs: dict[str, list[list[int]]] = {}
    for master, name, key in FONTS:
        src = os.path.join(SRC, master)
        dst = os.path.join(OUT, name)
        if not os.path.exists(src):
            print(f"missing master: {src}", file=sys.stderr)
            return 1
        points = build(src, dst)
        glyphs[key] = ranges_of(points)
        print(f"{name:22} {os.path.getsize(src) / 1024:7.1f} kB -> "
              f"{os.path.getsize(dst) / 1024:6.1f} kB   {len(points)} code points")
    with open(GLYPHS, "w", encoding="utf-8") as fh:
        json.dump(glyphs, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {os.path.relpath(GLYPHS, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
