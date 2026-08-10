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
python server/test_duel_combos.py    # 33 checks, no database needed
```

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
