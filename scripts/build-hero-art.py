"""Turn the hero source art in `assets/background/` into what the app serves.

The masters in `assets/` stay untouched; everything written here goes to
`public/assets/background/` and is regenerable by re-running this script.

Two jobs:

1. THE CHARACTER needs real alpha. `king image.jpg` ships on a uniform
   (247,247,247) field — invisible on the light theme, a glaring white box on
   the dark one. Two things make this more than a colour key:

   * FLOOD FILL FROM THE EDGES, not a global "is this pixel near-white" test.
     The king holds a pale parchment report and there are highlights in the
     crown; a global key punches holes straight through them. Only background
     CONNECTED to the border is removed.
   * DECONTAMINATE the edge. An antialiased boundary pixel is already mixed
     with the white backdrop (C = aF + (1-a)BG), so keying alone leaves a white
     halo that only shows up once the art is over the dark background.
     Recovering F = (C - (1-a)BG) / a is what makes the cutout survive both
     themes.

2. EVERYTHING gets re-encoded to WebP. These are 1.5 MB PNGs of soft gradient
   art — the single heaviest thing on the landing page by an order of
   magnitude. WebP takes the pair from 3.2 MB to 67 kB with no visible
   difference on artwork this smooth, and the character from 1.0 MB to ~100 kB.
   Pixels are otherwise unchanged and no ICC profile is written (wide-gamut
   phones washed out anything carrying an embedded lcms profile).

Run: python scripts/build-hero-art.py
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "background"
OUT = ROOT / "public" / "assets" / "background"

# Rendered at most ~430 CSS px wide, so 860 covers a 2x display and no more.
CHARACTER_WIDTH = 860
QUALITY = 88

# Distance from the backdrop colour at which a pixel counts as fully the king.
# Below FLOOR it is pure backdrop; between the two it is a blended edge pixel
# and gets partial alpha.
FLOOR = 6.0
CEIL = 26.0


def cut_character(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[0, 0]

    def dist(c: tuple[int, int, int]) -> float:
        return max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2]))

    outside = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if not outside[y * w + x] and dist(px[x, y]) <= CEIL:
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
                if dist(px[nx, ny]) <= CEIL:
                    outside[ny * w + nx] = 1
                    q.append((nx, ny))

    out = Image.new("RGBA", (w, h))
    op = out.load()
    span = CEIL - FLOOR
    for y in range(h):
        row = y * w
        for x in range(w):
            c = px[x, y]
            if not outside[row + x]:
                op[x, y] = (c[0], c[1], c[2], 255)
                continue
            d = dist(c)
            if d <= FLOOR:
                op[x, y] = (0, 0, 0, 0)
                continue
            a = min(1.0, (d - FLOOR) / span)
            f = tuple(
                max(0, min(255, round((c[i] - (1 - a) * bg[i]) / a))) for i in range(3)
            )
            op[x, y] = (f[0], f[1], f[2], round(a * 255))

    out = out.crop(out.getbbox())  # trim dead margin so CSS sizing is honest
    if out.width > CHARACTER_WIDTH:
        h2 = round(out.height * CHARACTER_WIDTH / out.width)
        out = out.resize((CHARACTER_WIDTH, h2), Image.LANCZOS)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, int, str]] = []

    king = cut_character(SRC / "king image.jpg")
    p = OUT / "king.webp"
    king.save(p, "WEBP", quality=QUALITY, method=6)
    written.append((p.name, p.stat().st_size, f"{king.width}x{king.height} alpha"))

    for name in ("light_background", "dark_background"):
        im = Image.open(SRC / f"{name}.png").convert("RGB")
        p = OUT / f"{name}.webp"
        im.save(p, "WEBP", quality=QUALITY, method=6)
        written.append((p.name, p.stat().st_size, f"{im.width}x{im.height}"))

    total = sum(s for _, s, _ in written)
    for name, size, note in written:
        print(f"  {name:24} {size / 1024:6.0f} kB   {note}")
    print(f"  {'total':24} {total / 1024:6.0f} kB")


if __name__ == "__main__":
    main()
