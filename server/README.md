# Analytics API (offline)

Serves the website's analytics screens from the Clash_Bot SQLite databases,
read-only. Standard library only — nothing to `pip install`.

```bash
python server/app.py      # http://127.0.0.1:8787
npm run dev               # Vite proxies /api/analytics/* to it
```

Both need to be running. Vite alone will show "Analytics service is not
running" on the analysis screen, which is the intended message rather than a
crash.

## Storage tiers

Mirrors the bot's own model (`Clash_Bot/clashdb.py`, `Clash_Bot/archive.py`):

| Tier | Default path | Role |
|------|--------------|------|
| Hot | `C:\ClashBot\data\battles.db` | rolling window, ~12 GB |
| Archive | `H:\ClashArchive\archive.db` | every battle ever, ~29 GB |

The archive is **never assumed present**. If drive H: is not connected, every
query answers from the hot tier alone and the page footer says so. The archive
is only opened when the requested window reaches further back than the hot
tier holds, so normally the 29 GB file is not touched at all.

A candidate database must also *carry the schema*, not merely exist — the
desktop copy ships a 4 KB `battles.db` stub with no tables in it, and picking a
file by existence alone selects that stub and then fails on every query.

## Configuration

Every path is an environment variable with a local default. This is the
migration seam — moving to a VPS means setting these, not editing code.

| Variable | Default |
|----------|---------|
| `CLASH_DB_PATH` | `C:\ClashBot\data\battles.db` |
| `CLASH_DB_FALLBACK` | Desktop `Clash_Bot/battles-pre-retention.db` |
| `CLASH_ARCHIVE_DB_PATH` | `H:\ClashArchive\archive.db` |
| `CLASH_API_HOST` / `CLASH_API_PORT` | `127.0.0.1` / `8787` |

Client side: `CLASH_API_URL` retargets the Vite proxy, and
`VITE_ANALYTICS_BASE` points a built bundle straight at a remote host. The
browser only ever calls `/api/analytics/*`, so neither the components nor the
client module change when the service moves.

## Endpoints

| Route | Returns |
|-------|---------|
| `GET /api/analytics/status` | which tiers are readable, and their sizes |
| `GET /api/analytics/suggest` | a few real tags with the most stored battles |
| `GET /api/analytics/coverage?tag=` | earliest/latest stored day, globally and per player |
| `GET /api/analytics/player/<tag>` | summary, top decks, per-day trends |
| `GET /api/analytics/duels/<tag>` | card combinations in duel play, three tabs |
| `GET /api/analytics/meta` | the global meta leaderboard (snapshot) |

Both `player` and `duels` take the same window: `?days=N`, or `?from=&to=` as
`YYYY-MM-DD`. `days` counts back from the **last battle stored for that player**
rather than from today, so someone who stopped playing a month ago still gets a
populated screen.

Tags are validated against Supercell's 14-symbol alphabet before they reach a
query (same rule as `clashdb.normalize_tag`), so junk never hits the database.

## Duel combinations (`duel_combos.py`)

A port of the bot's Pair Board (`clashdb.get_card_pair_stats` +
`pdf_pages.pair_board_data`), including its evidence floors (8 decks, 2 shells),
its Wilson confidence tiers, and its card/deck budgets — without those a table
is one heavily-played deck sliced twenty-four ways, because a pair inherits the
record of whole decks.

Two things to know before changing it:

* **There is no synergy score, and its absence is a measured result.** The
  obvious observed-versus-expected lift was built and tested against a
  permutation null across 14 player shapes in the bot project and came out
  indistinguishable from chance. Don't reinstate one without a fresh, leak-free
  measurement.
* **A native duel is stored as one row carrying the whole loadout** — 16 or 24
  cards, i.e. two or three decks end to end. So the G1/G2/G3 split is read out
  of the data. Friendly practice has no such row, so those duels are rebuilt
  with the bot's `duel_split` rules (>30 min gap closes, card reuse closes, a
  2-0 arms exactly one dead rubber).

The one deliberate divergence: the PDF gives each pair exactly one category,
since it prints all four on one board. Here the same predicates are applied
independently per tab, because an "Evolutions" tab that hides a pairing when a
win condition outranked it is answering a different question from its label.

```bash
python server/test_duel_combos.py    # 34 checks, no database needed
python server/test_meta.py           # 23 checks, no database needed
python server/test_card_art.py       # 32 checks, no database needed
```

## The meta leaderboard (`meta.py`)

`/api/analytics/meta` answers in ~4 ms because it never queries live. It cannot:
a `GROUP BY player_deck_hash` over a date window was built and measured first,
and it is not viable at this data size.

| window | via `idx_battles_time` | full table scan |
|---|---|---|
| 7 days | 39.9 s | — |
| 10 days | 48.3 s (49.3 s warm) | 45.1 s |
| 30 days | 76.3 s | — |

The cost is I/O. The index yields rowids in time order and then ~1.4M rows have
to be fetched from a 12.9 GB table whose rows carry two JSON card-list columns.
Warm re-runs do not help, and forcing a sequential scan saves only ~8%.

The normal fix — a covering index on `(battle_time, player_deck_hash)` — **is
not available**, because this process opens the bot's databases `mode=ro`
precisely so it can never modify them. So the rollup runs on a background
thread every `CLASH_META_REFRESH` seconds (default 1800) and requests are served
from the finished snapshot, persisted to `server/.meta_snapshot.json` so a
restart serves the previous numbers immediately. Every response carries
`computedAt` / `ageSeconds`, and the UI prints how old the numbers are rather
than implying they are live.

Four rules decide what lands on the board, and three of them are corrections to
what the first version actually produced:

* **Only competitive 1v1 where the player chose the deck** — ladder, ranked
  1v1, clan-war 1v1, tournaments. 2v2 and the event modes that hand you a deck
  would measure Supercell's choices rather than the player base's.
* **A deck needs `CLASH_META_MIN_PLAYERS` (25) distinct players.** Without it
  the board ranked a deck 50th on 1,703 Ladder battles at an **8.5% win rate**
  — 144 wins from 1,703. The stored results are clean (only win/loss/draw), so
  those battles are real; they are just almost all one account grinding one deck
  badly. A use-rate ranking is exactly the shape a single heavy player can
  inject themselves into.

* **Variants merge at 6-of-8 shared cards** (`MERGE_MIN_OVERLAP`, the bot's own
  `COUNTER_MIN_OVERLAP`). Without merging the board printed "Mortar" twice,
  "Bridge Spam" twice and "Royal Giant" twice, and every use rate looked
  impossibly small because one archetype's play was split across dozens of
  one-card tech variants. Only the top `CLASH_META_CANDIDATES` decks are
  clustered — the comparison is quadratic and nothing below the head can reach
  the board anyway.
* **Deck names are qualified by a signature card.** Clustering cannot merge
  genuinely different decks that share a win condition, so "Hog" still appeared
  six times on a fifty-row board. `_deck_name` appends the priciest
  non-win-condition card ("Hog Musketeer", "Hog Earthquake") — which is how
  players name these decks anyway.

Use rate is a share of **every** competitive battle in the window, including
those on decks the floor rejects — it is a share of all play, not of the board.

### Evolution and hero art

Cards are drawn with their evolution or hero art where the deck is actually
fielded that way, and decks are rendered in **payload order**.

Both follow from one measured fact: a deck's first **three** positions are the
special slots (evolution / hero / champion). Of 795 decks whose payload carried
evolution marks, **all 795** had every mark inside slots 0-2 — slot 0 in 791,
slot 1 in 569, slot 2 in 775.

So:

* Art is only ever applied to slots 0-2. That is the game's own rule, and it is
  a better cap than a magic number — it is what stopped a cluster's pooled marks
  drawing a deck with **five** evolved cards.
* **The three slots are not interchangeable**, and `clash_data.SLOT_ALLOWED`
  states the game's rule (player numbering):

  | slot | may hold |
  |---|---|
  | 1 (index 0) | evolution only |
  | 2 (index 1) | hero or champion — never an evolution |
  | 3 (index 2) | hero, evolution or champion (the "wild" slot) |

  which caps a deck at **two** evolutions. A champion has neither form, so it
  simply draws as itself wherever it is legal.

  **This is stated, not inferred, because the payload does not cleanly report
  it.** Over ~8,000 recent marked battles: slot 1 evolution 92%, slot 2 hero 70%
  / *evolution 30%*, slot 3 evolution 83% / hero 11% — and 14% of single battles
  carry three evolution marks. The bot's own `evolution_marks` docstring says
  the same, recording explicitly that "2 evolution slots + 1 other special slot"
  versus "3 special slots" cannot be settled from the stored columns. Rendering
  the raw majority put three evolution frames on decks that cannot have three.

  So the marks say which cards are special and what art each can wear;
  `apply_slot_rules` decides what may actually be drawn, and both the player
  screen and the meta board go through it.
* `decks.cards` is used for display, never `deck_hash`. The hash is alphabetical
  and identifies a deck; splitting it for display scatters the three special
  slots through the row.
* The variant itself is never inferred. `player_evo` stores
  `[card_key, level, art]` with `art` already resolved by the bot from the
  payload's icon URLs.

Within those slots a card must still be marked in at least `ART_MIN_SHARE` (25%)
of a deck's sampled battles, because a cluster pools many players' choices. The
art pass reads only the last `CLASH_META_ART_DAYS` (3) days, since it only has
to establish how a deck is currently brought.

| Variable | Default |
|----------|---------|
| `CLASH_META_DAYS` | `10` |
| `CLASH_META_REFRESH` | `1800` (seconds) |
| `CLASH_META_SIZE` | `50` |
| `CLASH_META_MIN_PLAYERS` | `25` |
| `CLASH_META_CANDIDATES` | `600` |
| `CLASH_META_ART_DAYS` | `3` |

### Where the payload says nothing

`player_evo` was only backfilled from 2026-08-05 and covers ~29% of stored
battles, so a deck last played before that has no marks at all — the screen
would show a plain deck for what was obviously an evolution deck. Player reports
therefore fall back to `_inferred_art`, which reads each of the three slots for
its prescribed role. Observed marks always win; inferred decks are flagged
`artInferred` so the UI can say so in the tooltip and a footnote.

A dashed outline was tried as the visual marker and removed: it read as a broken
image rather than as a caveat, on cards that are very likely right.

## Safety

Connections open with `mode=ro`, so SQLite itself refuses writes — this process
cannot corrupt the bot's data even by mistake. WAL means these reads never
block the bot's polling writes either.

## Performance note

The trend query pushes its date bound into SQL (`battle_time >= ?`). Because
`battle_time` is `YYYYMMDDThhmmss.sssZ`, a plain string comparison is a correct
date filter and lets SQLite use the `(player_tag, player_deck_hash)` index.
Without that bound the pair of queries took ~17 s; with it, 74 ms cold and
under 10 ms warm.
