"""Build the fonts the PDF reports embed.

    python scripts/build-report-fonts.py

Masters live in `assets/fonts/` (Inter 4.1 static TTFs under `inter/`, and
Bebas Neue); the served subsets land in `public/assets/fonts/report/`. Never
hand-edit the outputs — re-run this.

WHY SUBSET HERE AND NOT LET jsPDF DO IT. jsPDF does subset what it WRITES into
the PDF, but the browser still has to FETCH and PARSE the whole font at export
time: Inter is 410 kB a weight, 2,852 glyphs, almost all of them Greek and
symbols no report prints. Cutting to Latin + Cyrillic + the punctuation this
app uses takes each weight to a few tens of kB, which is the difference between
the export button feeling instant and feeling like a download.

WHY A GLYPH LIST IS WRITTEN BESIDE THEM. A character the embedded font has no
glyph for prints as an empty box, which reads as corrupt data. The renderer
therefore sanitises every string against the code points each font ACTUALLY
holds after subsetting — read from the output files, not restated by hand, so
the list cannot drift from the fonts.

THE JAPANESE FACES, AND WHY THERE ARE TWO. A Clash Royale name is as likely to
be kana as Latin, and a name the fonts cannot draw used to be replaced by the
player's tag. Noto Sans JP (OFL) fills that in, as two files the renderer
fetches only when a document needs them:

    NotoSansJP-Kana.ttf    hiragana, katakana, CJK punctuation      ~60 kB
    NotoSansJP-Kanji.ttf   JIS X 0208 level 1 + 2, 6,355 kanji      ~2 MB

A roster of kana names costs the small file and never the large one. Kanji are
NOT trimmed to level 1 (937 kB): names are exactly where the rarer forms live.

THE NOTO MASTER IS NOT IN GIT. It is a 9.6 MB variable font, and this
repository is public and already heavy. It is downloaded on first run from a
PINNED commit of google/fonts into `assets/fonts/noto/` (gitignored) and its
SHA-256 is checked, so the build is as reproducible as a committed master.

jsPDF needs a TrueType `glyf` font (it cannot embed CFF/OpenType outlines) with
a `name` table it can read a PostScript name from; pyftsubset's defaults keep
both. Hinting and layout features are dropped: jsPDF applies neither.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "public", "assets", "fonts", "report")
GLYPHS = os.path.join(ROOT, "src", "utils", "report", "glyphs.json")

# Basic Latin, Latin-1, Latin Extended-A (player names: Ł, ő, Ş ... and the
# macron vowels a romanised name uses), Cyrillic, and the punctuation / symbols
# the adapters actually emit.
RANGES = [
    (0x0020, 0x007E),
    (0x00A0, 0x00FF),
    (0x0100, 0x017F),
    (0x0400, 0x045F),  # Cyrillic: Russian, Ukrainian, Bulgarian, Serbian
    (0x0490, 0x0491),  # Ґ ґ
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

NOTO_COMMIT = "66a36c8c94b1a5d992ee4e7f392fccfe4945767c"
NOTO_URL = (
    f"https://github.com/google/fonts/raw/{NOTO_COMMIT}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
)
NOTO_LICENSE_URL = f"https://github.com/google/fonts/raw/{NOTO_COMMIT}/ofl/notosansjp/OFL.txt"
NOTO_SHA256 = "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f"
NOTO_DIR = os.path.join(SRC, "noto")
NOTO_MASTER = os.path.join(NOTO_DIR, "NotoSansJP-wght.ttf")
# One weight for every role. Medium sits between Inter 400 and 600, so the
# same file stands beside body copy and beside a heading without a second
# megabyte of bold kanji.
NOTO_WEIGHT = 500

# CJK symbols and punctuation, hiragana, katakana, katakana phonetic
# extensions. Fullwidth and halfwidth forms are deliberately NOT here: the
# renderer folds them (NFKD) to ASCII and to ordinary kana, which costs nothing.
KANA_RANGES = [(0x3000, 0x30FF), (0x31F0, 0x31FF)]

# The block the kanji bitset in glyphs.json spans (CJK Unified Ideographs).
URO = (0x4E00, 0x9FFF)


def unicodes(ranges: list[tuple[int, int]]) -> list[int]:
    out: list[int] = []
    for a, b in ranges:
        out.extend(range(a, b + 1))
    return out


def jis_kanji() -> list[int]:
    """Every kanji of JIS X 0208: level 1 (rows 16-47) and level 2 (48-84)."""
    out: list[int] = []
    for row in range(16, 85):
        for cell in range(1, 95):
            try:
                ch = bytes([0xA0 + row, 0xA0 + cell]).decode("euc_jp")
            except UnicodeDecodeError:
                continue
            out.append(ord(ch))
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


def bitset(points: list[int]) -> str:
    """One bit per code point of the URO block, base64 — 6,355 kanji as
    [start, end] runs would be ~50 kB of JSON; this is 3.5 kB."""
    a, b = URO
    bits = bytearray((b - a + 8) // 8)
    for p in points:
        if not a <= p <= b:
            raise SystemExit(f"kanji U+{p:04X} is outside the bitset block")
        i = p - a
        bits[i >> 3] |= 1 << (i & 7)
    return base64.b64encode(bytes(bits)).decode("ascii")


def options() -> subset.Options:
    opts = subset.Options()
    opts.layout_features = []
    opts.hinting = False
    opts.drop_tables += [
        "GPOS", "GSUB", "GDEF", "kern", "STAT", "DSIG",
        # Vertical metrics and variation leftovers jsPDF never reads.
        "vhea", "vmtx", "VORG", "BASE", "avar", "HVAR", "MVAR", "gasp", "meta",
    ]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    return opts


def build(font: TTFont, out: str, points: list[int]) -> list[int]:
    sub = subset.Subsetter(options())
    sub.populate(unicodes=points)
    sub.subset(font)
    font.save(out)
    return sorted(TTFont(out).getBestCmap().keys())


def report(name: str, src_bytes: int, dst: str, points: list[int]) -> None:
    print(f"{name:22} {src_bytes / 1024:7.1f} kB -> "
          f"{os.path.getsize(dst) / 1024:6.1f} kB   {len(points)} code points")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def noto_master() -> str:
    """The Noto Sans JP variable master, downloaded once and hash-checked."""
    if not os.path.exists(NOTO_MASTER):
        os.makedirs(NOTO_DIR, exist_ok=True)
        print(f"fetching Noto Sans JP master ({NOTO_COMMIT[:7]}) ...")
        urllib.request.urlretrieve(NOTO_URL, NOTO_MASTER)
        urllib.request.urlretrieve(NOTO_LICENSE_URL, os.path.join(NOTO_DIR, "OFL.txt"))
    got = sha256(NOTO_MASTER)
    if got != NOTO_SHA256:
        raise SystemExit(
            f"{os.path.relpath(NOTO_MASTER, ROOT)} is not the pinned master\n"
            f"  expected {NOTO_SHA256}\n  got      {got}\n"
            "delete it and re-run to download the pinned file again."
        )
    return NOTO_MASTER


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    glyphs: dict[str, object] = {}
    for master, name, key in FONTS:
        src = os.path.join(SRC, master)
        dst = os.path.join(OUT, name)
        if not os.path.exists(src):
            print(f"missing master: {src}", file=sys.stderr)
            return 1
        points = build(TTFont(src), dst, unicodes(RANGES))
        glyphs[key] = ranges_of(points)
        report(name, os.path.getsize(src), dst, points)

    master = noto_master()
    size = os.path.getsize(master)
    for name, key, wanted in (
        ("NotoSansJP-Kana.ttf", "kana", unicodes(KANA_RANGES)),
        ("NotoSansJP-Kanji.ttf", "kanji", jis_kanji()),
    ):
        # Instanced afresh for each file: subsetting mutates the font.
        font = instancer.instantiateVariableFont(TTFont(master), {"wght": NOTO_WEIGHT})
        dst = os.path.join(OUT, name)
        points = build(font, dst, wanted)
        report(name, size, dst, points)
        if key == "kana":
            glyphs["kana"] = ranges_of(points)
        else:
            glyphs["kanji"] = {"from": URO[0], "to": URO[1], "bits": bitset(points)}
    with open(os.path.join(OUT, "NotoSansJP-OFL.txt"), "wb") as fh:
        with open(os.path.join(NOTO_DIR, "OFL.txt"), "rb") as lic:
            fh.write(lic.read())

    with open(GLYPHS, "w", encoding="utf-8") as fh:
        json.dump(glyphs, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {os.path.relpath(GLYPHS, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
