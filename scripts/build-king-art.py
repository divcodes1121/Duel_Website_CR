"""Build the Coach Duel's King art: public/assets/kings/*.webp.

    python scripts/build-king-art.py            fetch what is missing, build
    python scripts/build-king-art.py --check    every output exists

THE KINGS ARE SUPERCELL'S. The 3D renders and the emotes are Clash Royale's
own art as the Clash Royale wiki hosts it; the two portraits are the clan-badge
Kings RoyaleAPI publishes (github.com/RoyaleAPI/cr-api-assets). Used under
Supercell's Fan Content Policy, the same footing as every card image on the
site: https://supercell.com/en/fan-content-policy/

THE MASTERS ARE NOT IN THE REPOSITORY (~25 MB). They are downloaded into the
gitignored `assets/kings/` and each is checked against the SHA-256 pinned
below, so a changed file upstream fails loudly instead of quietly changing the
art. Never hand-edit the outputs; re-run this.

WHAT IS MADE, AND WHY TWO OF THE KINGS ARE RECOLOURED. The wiki has the Blue
King in three poses (calm, laughing, nervous) and the Red King in one (fists
up). The two Kings are the same character in team colours, so the missing
poses are made by moving ONLY the team colour: pixels in the blue band of hue
(the cloth, the crown band) are rotated to the Red King's crimson. Skin, beard,
gold and grey sit in other hue bands or have too little saturation to be
touched. Pure PIL (there is no numpy on the machine this was written on).

THE OTHER DIRECTION WAS TRIED AND DROPPED: a blue version of the fists-up Red
King. The pink highlights of the skin (nose tip, ears, fingertips, inside the
mouth) share the crimson's hue AND saturation, measured, so every mask that
took the cloth also turned the face blue in patches. The Blue King celebrates
with his laughing pose instead. `recolour(..., "blue")` is kept, unused.
"""
from __future__ import annotations

import hashlib
import os
import sys
import urllib.request

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTERS = os.path.join(ROOT, "assets", "kings")
OUT = os.path.join(ROOT, "public", "assets", "kings")

WIKI = "https://static.wikia.nocookie.net/clashroyale/images/"
SOURCES = {
    "Blue_King": (WIKI + "4/47/Blue_King.png/revision/latest?cb=20160122232537",
                  "8a2c49cbea2a01bd0d6e01ae4260bb0656cd4ed6017d80831dcbfe876503e8ba"),
    "Blue_King_Laughing": (WIKI + "3/33/Blue_King_Laughing.png/revision/latest?cb=20160108013214",
                           "aee3ea25e29fa018cbe004c9dd1eceebe218416c26ff127ee3507636ebb7c3c8"),
    "Blue_King_Scared": (WIKI + "2/2c/Blue_King_Scared.png/revision/latest?cb=20251224024454",
                         "d1bd276d2d0e3d1a96187f22fdf1cbe00da0aff16ddc59107d2ad23091efb70c"),
    "Red_King_Angry": (WIKI + "b/ba/Red_King_Angry.png/revision/latest?cb=20160108013214",
                       "656f0a35bec8b63415a77e2b0b7a05cd126b9ecbe9cbf91a8a8f0fa033030f73"),
    "Crying_King": (WIKI + "a/af/Crying_King.png/revision/latest?cb=20230915211808",
                    "4ee03e8cea7eb06262d1c04cff32dd30582a9164c40e18bc90cb62f0afeefd54"),
    "King_Classic_Icon_Duel": (WIKI + "b/b7/King_Classic_Icon_Duel.png/revision/latest?cb=20251023110936",
                               "0b3e7c05a63efc16ec5fd642bc17a8f98fe5b6943c87c8437b0e9a5d29bbfd49"),
    "King_Hi_hi_hi_Ha": (WIKI + "e/ed/King_Hi_hi_hi_Ha.png/revision/latest?cb=20241111203953",
                         "3690f8c7141fd7a99e3333c93dd7d7c974cb913b403a436fb1e37755621668b9"),
    "King_Grrr": (WIKI + "5/5a/King_Grrr.png/revision/latest?cb=20241111204031",
                  "5a04c85d496d07884e416b4a1993a282bb4fd03418cddc93493cacfa65464232"),
    "King_Chess_Think": (WIKI + "b/be/King_Chess_Think.png/revision/latest?cb=20230903120244",
                         "364b00f39ed3e352965e89ead52a03e9f17d8bdd5642ea20f77c8e23fe51a069"),
    "King_Sweating": (WIKI + "7/73/King_Sweating.png/revision/latest?cb=20240508140445",
                      "1ff5a3214905e5133f30f06298c799aa758fa0a378a2f72a160dd22398a42431"),
    "King_GG": (WIKI + "c/cf/King_GG.png/revision/latest?cb=20241214185128",
                "25bfbebca25580fdadb10ee72a9409f759368bbda98547924b919660ff9cb19d"),
    "King_Yeah": (WIKI + "2/2a/King_Yeah.png/revision/latest?cb=20251023114249",
                  "515a8f1783304b6c9256f8d7dcd92ed6fac82a931835756f9a08368c8981d7c3"),
    "King_Thumbs_Down": (WIKI + "d/d4/King_Thumbs_Down.png/revision/latest?cb=20260118152149",
                         "46ae8a8d4dce3aaaed3b5e04c9200722dc8283b504dfe40a68e141dcaae3edee"),
    "A_Char_King_03": ("https://raw.githubusercontent.com/RoyaleAPI/cr-api-assets/master/badges/A_Char_King_03.png",
                       "2472c4e14c91509828715fd036734d8fcfb947a945953f130854330698d939f5"),
    "A_Char_King_04": ("https://raw.githubusercontent.com/RoyaleAPI/cr-api-assets/master/badges/A_Char_King_04.png",
                       "3059e945e719ff9e3ce5d0efd9411d47dd4bf182b2a77c8f913a0c75170d842d"),
}

#: Renders are drawn at most ~300 px tall; 2x for a dense screen.
KING_HEIGHT = 640
EMOTE_HEIGHT = 200
QUALITY = 84

#: Hue bands on PIL's 0..255 scale. Blue cloth and crown band sit near 155
#: (218 deg); the Red King's crimson near 250 (352 deg). Saturation floors keep
#: the grey sleeves, the skin and the white highlights out of the mask.
BLUE_BAND = (128, 182)
BLUE_MIN_SAT = 55
RED_BANDS = ((236, 255), (0, 6))
RED_MIN_SAT = 120
#: The Red King's paler crimson (crown band, cloak shading) sits at hue
#: 228-247 with saturation 60-120 — a band skin never reaches (skin is 4-24),
#: so it is taken at a lower floor.
RED_DEEP_BAND = (228, 255)
RED_DEEP_MIN_SAT = 100
#: The pale cloth under the belt (hue 0-8, saturation 60-120) overlaps the
#: skin exactly, measured, so no colour rule can separate them. It is taken
#: only below this share of the figure's height, where there is no skin: the
#: legs are white and grey, the hands are above it.
RED_LOW_BAND = (0, 9)
RED_LOW_MIN_SAT = 60
RED_LOW_FROM = 0.52
TO_RED = 96          # 155 -> ~251
TO_BLUE = -96

#: name -> (master, recolour or None, kind)
OUTPUTS = {
    "blue-idle": ("Blue_King", None, "king"),
    "blue-laugh": ("Blue_King_Laughing", None, "king"),
    "blue-nervous": ("Blue_King_Scared", None, "king"),
    "red-idle": ("Blue_King", "red", "king"),
    "red-laugh": ("Blue_King_Laughing", "red", "king"),
    "red-nervous": ("Blue_King_Scared", "red", "king"),
    "red-cheer": ("Red_King_Angry", None, "king"),
    "duel": ("King_Classic_Icon_Duel", None, "emblem"),
    "badge-blue": ("A_Char_King_03", None, "badge"),
    "badge-red": ("A_Char_King_04", None, "badge"),
    "emote-laugh": ("King_Hi_hi_hi_Ha", None, "emote"),
    "emote-cry": ("Crying_King", None, "emote"),
    "emote-grrr": ("King_Grrr", None, "emote"),
    "emote-think": ("King_Chess_Think", None, "emote"),
    "emote-sweat": ("King_Sweating", None, "emote"),
    "emote-gg": ("King_GG", None, "emote"),
    "emote-yeah": ("King_Yeah", None, "emote"),
    "emote-thumbsdown": ("King_Thumbs_Down", None, "emote"),
}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name: str) -> str:
    url, pin = SOURCES[name]
    path = os.path.join(MASTERS, name + ".png")
    if not os.path.exists(path):
        os.makedirs(MASTERS, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Deckkies art build)"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
            f.write(r.read())
        os.replace(path + ".part", path)
    got = sha256(path)
    if got != pin:
        raise SystemExit(f"{name}: SHA-256 {got} is not the pinned {pin}. The upstream file changed; "
                         "look at it before pinning the new one.")
    return path


def band_mask(h: Image.Image, s: Image.Image, a: Image.Image, bands, min_sat: int) -> Image.Image:
    lut = [0] * 256
    for lo, hi in bands:
        for v in range(lo, hi + 1):
            lut[v] = 255
    m = h.point(lut)
    m = ImageChops.multiply(m, s.point(lambda v: 255 if v >= min_sat else 0))
    return ImageChops.multiply(m, a.point(lambda v: 255 if v > 8 else 0))


def recolour(im: Image.Image, to: str) -> Image.Image:
    im = im.convert("RGBA")
    alpha = im.getchannel("A")
    h, s, v = im.convert("RGB").convert("HSV").split()
    if to == "red":
        mask = band_mask(h, s, alpha, (BLUE_BAND,), BLUE_MIN_SAT)
        h2 = h.point(lambda x: (x + TO_RED) % 256)
        s2 = s.point(lambda x: min(255, int(x * 1.12)))
    else:
        mask = band_mask(h, s, alpha, RED_BANDS, RED_MIN_SAT)
        mask = ImageChops.lighter(mask, band_mask(h, s, alpha, (RED_DEEP_BAND,), RED_DEEP_MIN_SAT))
        low = band_mask(h, s, alpha, (RED_LOW_BAND,), RED_LOW_MIN_SAT)
        below = Image.new("L", im.size, 0)
        top = int(im.height * RED_LOW_FROM)
        below.paste(255, (0, top, im.width, im.height))
        mask = ImageChops.lighter(mask, ImageChops.multiply(low, below))
        h2 = h.point(lambda x: (x + TO_BLUE) % 256)
        s2 = s
    shifted = Image.merge("HSV", (h2, s2, v)).convert("RGB")
    out = Image.composite(shifted, im.convert("RGB"), mask).convert("RGBA")
    out.putalpha(alpha)
    return out


def trimmed(im: Image.Image) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    return im.crop(box) if box else im


def build() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, (src, colour, kind) in OUTPUTS.items():
        im = Image.open(fetch(src)).convert("RGBA")
        if colour:
            im = recolour(im, colour)
        im = trimmed(im)
        target = {"king": KING_HEIGHT, "emote": EMOTE_HEIGHT, "emblem": 360, "badge": im.height}[kind]
        if im.height > target:
            im = im.resize((round(im.width * target / im.height), target), Image.LANCZOS)
        path = os.path.join(OUT, name + ".webp")
        im.save(path, "WEBP", quality=QUALITY, method=6)
        print(f"{name:18} {im.width:4}x{im.height:<4} {os.path.getsize(path) // 1024:4} kB  <- {src}"
              + (f" (recoloured {colour})" if colour else ""))


def check() -> int:
    missing = [n for n in OUTPUTS if not os.path.exists(os.path.join(OUT, n + ".webp"))]
    for n in missing:
        print("missing", n)
    print(f"{len(OUTPUTS) - len(missing)} of {len(OUTPUTS)} present")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv else (build() or 0))
