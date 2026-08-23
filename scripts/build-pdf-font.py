"""Convert the display face to a TrueType build that jsPDF can actually embed.

WHY THIS EXISTS. The site's display face ships as `KidsWord.otf`, which is
OpenType with CFF (PostScript) outlines — its file magic is the four bytes
`OTTO`. Browsers handle that fine, which is why nothing on screen ever hinted at
a problem. jsPDF does not: its font parser only understands TrueType `glyf`
outlines, so `addFont` ACCEPTS the file, reports no error, and then fails per
glyph at draw time with

    jsPDF PubSub Error  Cannot use 'in' operator to search for '0' in undefined
        at glyphFor

which jsPDF swallows into a PubSub handler. The export still produces a valid
PDF; the headings just silently come out in a fallback face. Measured: the same
one-line document is 3,353 bytes with the OTF (nothing embedded) against 12,536
with a real TrueType file (a subset embedded).

That is precisely the failure mode this project keeps a section about — a
property that silently does nothing. So the PDF gets its own TrueType build of
the same face, and `analyticsPdf.ts` verifies the embed rather than trusting it.

The conversion is outline-level, not a re-draw: cu2qu approximates each cubic
CFF curve with quadratics to a tolerance far below a printed pixel, which is the
standard OTF->TTF path (it is what fontmake does in reverse).

Run once, when the display face changes — this is NOT part of the build:

    pip install fonttools
    python scripts/build-pdf-font.py

Output: public/assets/fonts/KidsWord-pdf.ttf, which is committed. fontTools is a
one-off authoring dependency and is deliberately not in package.json or any
runtime path.
"""

from __future__ import annotations

from pathlib import Path

from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "assets" / "fonts" / "KidsWord.otf"
OUT = ROOT / "public" / "assets" / "fonts" / "KidsWord-pdf.ttf"

# Max error when refitting a cubic as quadratics, in font units. The face is
# drawn on a 1000-unit em, so 1 unit is a thousandth of the type size — at a
# 30 pt heading that is 0.03 pt, which no printer resolves.
MAX_ERR = 1.0


def main() -> None:
    font = TTFont(SRC)
    if "glyf" in font:
        print("  already TrueType — nothing to do")
        return

    glyph_set = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = font.getGlyphOrder()
    glyf.glyphs = {}

    for name in font.getGlyphOrder():
        pen = TTGlyphPen(glyph_set)
        # Cu2Qu writes quadratics into the TrueType pen as it reads cubics out
        # of the CFF charstring.
        glyph_set[name].draw(Cu2QuPen(pen, MAX_ERR))
        glyf.glyphs[name] = pen.glyph()

    font["glyf"] = glyf

    # `loca` is built by the compiler from glyf, but the table has to exist.
    font["loca"] = newTable("loca")

    # maxp must become the TrueType version or the file is a CFF font wearing a
    # glyf table, and parsers pick whichever they were going to pick anyway.
    font["maxp"].tableVersion = 0x00010000
    for attr, value in (
        ("maxZones", 1), ("maxTwilightPoints", 0), ("maxStorage", 0),
        ("maxFunctionDefs", 0), ("maxInstructionDefs", 0), ("maxStackElements", 0),
        ("maxSizeOfInstructions", 0), ("maxComponentElements", 0),
    ):
        setattr(font["maxp"], attr, value)

    # `post` v2 carries the glyph names TrueType consumers expect; the CFF build
    # keeps them in the CFF table, which is about to be dropped.
    font["post"].formatType = 2.0
    font["post"].extraNames = []
    font["post"].mapping = {}
    font["post"].glyphOrder = font.getGlyphOrder()

    for table in ("CFF ", "VORG"):
        if table in font:
            del font[table]

    font.sfntVersion = "\000\001\000\000"  # TrueType, not OTTO
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)

    check = TTFont(OUT)
    print(f"  {SRC.name} ({SRC.stat().st_size / 1024:.0f} kB, CFF)")
    print(f"  -> {OUT.name} ({OUT.stat().st_size / 1024:.0f} kB, glyf)")
    print(f"     glyphs: {len(check.getGlyphOrder())}   sfnt: {check.sfntVersion!r}")


if __name__ == "__main__":
    main()
