"""Turn the field-book plate art in `assets/guide/` into what the app serves.

Same split as `build-hero-art.py`, and for the same reason: the masters in
`assets/` stay untouched and everything under `public/assets/guide/` is
regenerable by re-running this script. **Never hand-edit the outputs.**

WHY THIS EXISTS AT ALL. The four supplied plates are 3.2-3.9 MB PNGs — 13.5 MB
for four pictures, on a page that shows one at a time and clones the open one
into twelve strips during a turn. That is an order of magnitude more than the
whole rest of the site's art put together, and it would be the single heaviest
thing the project serves by a wide margin.

Two jobs:

1. **RE-ENCODE TO WEBP.** These are splashed watercolour: broad washes, soft
   blooms, and paper texture. That is exactly the content lossy WebP is good at
   and PNG is worst at — PNG is paying full price to store the paper grain
   losslessly, and nobody is going to audit a fibre. Quality 82 with `method=6`
   takes the set from 13.5 MB to well under a megabyte with no visible
   difference at the size these are drawn, including under the 2.25x magnifier.

2. **CAP THE LONG EDGE AT 2000px.** The book is at most ~1320 CSS px wide and a
   split plate gets half of that, so even a 3x screen under the glass never
   asks for more. Anything past the cap is bytes nobody can see.

NO ICC PROFILE IS WRITTEN. Same rule the card art already follows: an embedded
lcms profile made colours wash out on wide-gamut phones, so the outputs are
plain sRGB. The supplied masters happen to carry no profile either, which was
checked rather than assumed.

THE ALPHA IS DELIBERATELY DROPPED. The slot composites with `mix-blend-mode:
multiply` so the sheet's own tone comes up through the white of the paper and
the spatter edges melt into the page. Multiply over transparency does nothing,
so a plate must arrive as opaque paper — an RGBA master is flattened onto white
here rather than being allowed to float over the page later.

Run: python scripts/build-guide-art.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "guide"
OUT = ROOT / "public" / "assets" / "guide"

MAX_EDGE = 2000
QUALITY = 78


def build(path: Path) -> tuple[str, int, int, str]:
    im = Image.open(path)
    before = path.stat().st_size

    # Flatten onto white rather than keeping alpha — see the note above.
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, (255, 255, 255))
        flat.paste(im, mask=im.split()[-1])
        im = flat
    else:
        im = im.convert("RGB")

    w, h = im.size
    scale = min(1.0, MAX_EDGE / max(w, h))
    if scale < 1.0:
        im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

    dest = OUT / f"{path.stem}.webp"
    dest.parent.mkdir(parents=True, exist_ok=True)
    # icc_profile is simply not passed, so none is written.
    im.save(dest, "WEBP", quality=QUALITY, method=6)
    after = dest.stat().st_size
    return path.stem, before, after, f"{im.size[0]}x{im.size[1]}"


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"no masters at {SRC} — put the source PNGs there first")

    masters = sorted(p for p in SRC.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
    if not masters:
        raise SystemExit(f"no images in {SRC}")

    total_before = total_after = 0
    for path in masters:
        name, before, after, size = build(path)
        total_before += before
        total_after += after
        print(f"  {name:16s} {size:>10s}  {before / 1048576:6.2f} MB -> {after / 1024:6.1f} kB")

    print(f"\n  {len(masters)} plates: {total_before / 1048576:.1f} MB -> {total_after / 1024:.0f} kB")


if __name__ == "__main__":
    main()
