# Attribution

Card data (`src/data/cards.json`) and card icon images (`public/assets/cards/`, `public/assets/heroes/`,
`public/assets/evolutions/`) are sourced from
[RoyaleAPI/cr-api-data](https://github.com/RoyaleAPI/cr-api-data) and
[RoyaleAPI/cr-api-assets](https://github.com/RoyaleAPI/cr-api-assets), vendored locally rather than
hotlinked, per that project's request not to use its assets as a CDN.

The Coach Duel's Kings (`public/assets/kings/`) are Clash Royale's own King art: the 3D renders and
emotes as the [Clash Royale wiki](https://clashroyale.fandom.com/) hosts them, and the clan-badge
Kings from [RoyaleAPI/cr-api-assets](https://github.com/RoyaleAPI/cr-api-assets). The Red King's
calm, laughing and nervous poses are the Blue King's with only the team colour moved. Built by
`scripts/build-king-art.py`, which downloads the originals (pinned by SHA-256) into the gitignored
`assets/kings/`.

This is unofficial fan content. It is not affiliated with, endorsed, sponsored, or specifically
approved by Supercell, and Supercell is not responsible for it. For more information see Supercell's
Fan Content Policy: https://supercell.com/en/fan-content-policy/
