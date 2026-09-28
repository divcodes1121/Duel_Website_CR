"""Build the blurred previews that sit behind the sign-up gate.

    python scripts/build-gate-art.py <masters-dir>
    python scripts/build-gate-art.py --check

The gate on Cards, Duel Analysis, Duel Zone, Coach Assist, Deck Analysis, Team
Analysis and 2v2 Decks used to be a lock and two lines of copy, so a visitor
was asked to sign up for a screen they had never seen. `GateCard` now draws a
blurred picture of that screen behind the copy. This writes those pictures:
`public/assets/gate/<slug>-<theme>.webp`, one per area per theme.

THE MASTERS ARE NOT IN THE REPOSITORY, AND THAT IS DELIBERATE. They are
screenshots of the real screens on production data, so they show real
players' names and tags — and the repository is public. Only the blurred
output is committed. The blur is not decoration: at `WIDTH` and `BLUR` a line
of the site's body type is a smear, so no name can be read back out of a
served file. If the masters are reshot, LOOK at the output before committing
it, at full size, and check that nothing reads.

To reshoot: run the site against production data with no Supabase
(`CLASH_API_URL=https://api.deckkies.com VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY= npx vite`, which opens every area), and
screenshot the `<main>` panel of each area at 1440x900 in each theme, named
`<slug>-<dark|light>.png`. Team Analysis wants a roster scouted first, or the
preview is an empty paste box.

NEVER hand-edit the files in `public/` — re-run this.
"""

import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'gate')

# Must match GATE_PREVIEW in src/components/Auth/GateCard.tsx.
SLUGS = ['cards', 'duels', 'duelzone', 'coach', 'deck-analysis', 'teams', 'duo']
THEMES = ['dark', 'light']

# Small, because it is shown blurred and behind a scrim: 560px of source is
# plenty for a picture nobody is meant to read, and it keeps each file a few kB.
WIDTH = 560
# Gaussian radius AT THAT WIDTH. Body type on these screens is ~13px tall at
# 1156px, so ~6px here; a radius of 4 turns it into a grey band.
BLUR = 4
QUALITY = 60

# Master pixels to cut off the top. The four player areas were shot with the
# screen's own tag-and-season row above the panel; left in, the preview drew a
# blurred second search bar directly under the real one, which reads as a
# ghost control rather than as a picture of the screen.
TRIM_TOP = {'cards': 76, 'duels': 76, 'duelzone': 76, 'coach': 76}


def build(masters: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for slug in SLUGS:
        for theme in THEMES:
            src = os.path.join(masters, f'{slug}-{theme}.png')
            if not os.path.exists(src):
                print(f'  missing  {slug}-{theme}.png')
                continue
            im = Image.open(src).convert('RGB')
            top = TRIM_TOP.get(slug, 0)
            if top:
                im = im.crop((0, top, im.width, im.height))
            h = round(im.height * WIDTH / im.width)
            im = im.resize((WIDTH, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(BLUR))
            dst = os.path.join(OUT, f'{slug}-{theme}.webp')
            im.save(dst, 'WEBP', quality=QUALITY, method=6)
            size = os.path.getsize(dst)
            total += size
            print(f'  {slug}-{theme}.webp  {WIDTH}x{h}  {size / 1024:.1f} kB')
    print(f'total {total / 1024:.1f} kB')


def check() -> int:
    missing = [
        f'{s}-{t}.webp'
        for s in SLUGS
        for t in THEMES
        if not os.path.exists(os.path.join(OUT, f'{s}-{t}.webp'))
    ]
    for m in missing:
        print(f'missing {m}')
    print('ok' if not missing else f'{len(missing)} missing')
    return 1 if missing else 0


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--check':
        sys.exit(check())
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    build(sys.argv[1])
