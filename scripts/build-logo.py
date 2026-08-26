"""Turn `assets/background/logo.png` into everything the app serves.

The master stays untouched. Everything written here goes to `public/` and is
regenerable by re-running this script — never hand-edit the outputs.

The master is a 1254px RGB square: a gold crown over a black D on a near-white
field, with NO alpha channel. Four problems follow from that, and each output
below exists to solve one of them.

1. THE BACKGROUND IS BAKED IN. Keying it out is a flood fill from the border,
   not a global "is this pixel near-white" test — the D has a white counter
   (the hole in its bowl) and the crown has pale highlights, and a global key
   punches straight through both. Only background CONNECTED to the edge goes.
   Same rule, and the same reason, as `build-hero-art.py`.

2. AN ANTIALIASED EDGE IS ALREADY MIXED with the white it sat on
   (C = aF + (1-a)BG). Keying alone leaves a white halo that is invisible on
   the light theme and obvious on the dark one, so the edge is decontaminated
   by recovering F = (C - (1-a)BG) / a.

3. THE D IS BLACK, so on a dark surface it disappears. Two variants ship, the
   way the hero backdrops already do: `logo-light` keeps the black D, and
   `logo-dark` lifts it to near-white while leaving the gold crown alone. The
   crown is what carries the identity; the letter is what has to stay legible.

4. A FAVICON HAS NO THEME. The browser draws the tab strip in the OS theme and
   the page cannot influence it, so a transparent favicon is a coin flip. It
   ships on a dark rounded tile with the white-D variant — gold and white on
   near-black reads on any tab strip either theme can produce.

It briefly emitted a `logo-mask.png` silhouette too, as the input to the
lightning effect's signed-distance field. The VS between two decks is the WORD
now rather than the logo, and that field is rasterised from text at runtime —
so the mask has no reader and is not written. `silhouette()` stays because it
is the part that would be hard to rediscover if the mark ever needs a field.

Run: python scripts/build-logo.py     (needs Pillow)
"""

from __future__ import annotations

import os
from collections import deque

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "background", "logo.png")
OUT_ASSETS = os.path.join(ROOT, "public", "assets", "brand")
OUT_ROOT = os.path.join(ROOT, "public")

#: A border pixel within this distance of the master's corner colour is
#: background. Generous, because the field is a flat scan white.
KEY_TOLERANCE = 26

#: Below this the pixel is the letter rather than the crown. The crown's
#: darkest gold sits far above it; the D's lightest antialiased edge far below.
DARK_CUTOFF = 96

#: What the letter becomes on the dark variant. Not pure white — the crown is
#: not pure anything, and a #fff letter beside it reads as a different asset.
DARK_LETTER = (238, 240, 246)

#: The favicon tile. Near-black with a blue cast, close to the app's own
#: `theme-color`, so the tab icon and the browser chrome agree.
TILE = (12, 18, 34, 255)

FAVICON_SIZES = (16, 32, 48, 64, 128, 180, 192, 512)


def flood_key(im: Image.Image, tolerance: int = KEY_TOLERANCE) -> Image.Image:
    """Alpha from a border flood fill. Enclosed light areas are kept."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = px[0, 0][:3]

    def near(c) -> bool:
        return all(abs(c[i] - bg[i]) <= tolerance for i in range(3))

    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near(px[x, y]):
                q.append((x, y))
                seen[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if near(px[x, y]) and not seen[y * w + x]:
                q.append((x, y))
                seen[y * w + x] = 1

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and near(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))

    # Soft alpha across the antialiased boundary: a border pixel that is
    # PART of the way to the background gets a partial alpha rather than a
    # binary in/out, which is what keeps the curve of the D smooth.
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b, _ = px[x, y]
            if seen[row + x]:
                px[x, y] = (r, g, b, 0)
                continue
            d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if d >= 60:
                continue
            a = int(255 * (d / 60.0))
            if a >= 250:
                continue
            # Decontaminate: undo the blend with the white field.
            af = a / 255.0
            if af > 0.02:
                r = min(255, max(0, int((r - (1 - af) * bg[0]) / af)))
                g = min(255, max(0, int((g - (1 - af) * bg[1]) / af)))
                b = min(255, max(0, int((b - (1 - af) * bg[2]) / af)))
            px[x, y] = (r, g, b, a)
    return im


def trim(im: Image.Image, pad_ratio: float = 0.03) -> Image.Image:
    """Crop to the artwork, then re-pad to a square with a little breathing room."""
    box = im.getbbox()
    if not box:
        return im
    im = im.crop(box)
    w, h = im.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(im, ((side - w) // 2, (side - h) // 2))
    return out


def lighten_letter(im: Image.Image) -> Image.Image:
    """The dark variant: the black D becomes near-white, the crown is untouched."""
    im = im.copy()
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or max(r, g, b) >= DARK_CUTOFF:
                continue
            # Keep the pixel's own luminance ordering so the letter's
            # antialiased edge stays an edge rather than flattening to a step.
            k = max(r, g, b) / DARK_CUTOFF
            px[x, y] = (
                int(DARK_LETTER[0] * (1 - k) + 255 * k),
                int(DARK_LETTER[1] * (1 - k) + 255 * k),
                int(DARK_LETTER[2] * (1 - k) + 255 * k),
                a,
            )
    return im


def silhouette(im: Image.Image, size: int = 512) -> Image.Image:
    """Flat white on transparent — the shape only, for the SDF."""
    im = im.resize((size, size), Image.LANCZOS)
    a = im.split()[3]
    out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    out.putalpha(a)
    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    white.putalpha(a)
    return white


def rounded_tile(size: int, radius_ratio: float = 0.22) -> Image.Image:
    tile = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle(
        (0, 0, size * 4 - 1, size * 4 - 1),
        radius=int(size * 4 * radius_ratio),
        fill=TILE,
    )
    return tile.resize((size, size), Image.LANCZOS)


def favicon(logo_dark: Image.Image, size: int) -> Image.Image:
    tile = rounded_tile(size)
    inner = int(size * 0.74)
    art = logo_dark.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    tile.alpha_composite(art, (off, off))
    return tile


def main() -> None:
    os.makedirs(OUT_ASSETS, exist_ok=True)
    master = Image.open(SRC).convert("RGBA")
    print(f"master  {master.size[0]}x{master.size[1]}")

    keyed = trim(flood_key(master))
    print(f"keyed   {keyed.size[0]}x{keyed.size[1]}")

    light = keyed.resize((512, 512), Image.LANCZOS)
    dark = lighten_letter(light)

    light.save(os.path.join(OUT_ASSETS, "logo-light.png"), optimize=True)
    dark.save(os.path.join(OUT_ASSETS, "logo-dark.png"), optimize=True)

    for s in FAVICON_SIZES:
        favicon(dark, s).save(os.path.join(OUT_ROOT, f"favicon-{s}.png"), optimize=True)
    # One .ico carrying the small sizes, for the browsers that still ask for
    # /favicon.ico before reading the document.
    favicon(dark, 64).save(
        os.path.join(OUT_ROOT, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )

    for name in ("logo-light.png", "logo-dark.png"):
        p = os.path.join(OUT_ASSETS, name)
        print(f"  {name:<16} {os.path.getsize(p) / 1024:6.1f} kB")
    for s in (32, 180, 512):
        p = os.path.join(OUT_ROOT, f"favicon-{s}.png")
        print(f"  favicon-{s:<8} {os.path.getsize(p) / 1024:6.1f} kB")
    print(f"  favicon.ico      {os.path.getsize(os.path.join(OUT_ROOT, 'favicon.ico')) / 1024:6.1f} kB")


if __name__ == "__main__":
    main()
