# Royal Arena

A Clash Royale companion: deck-building tools plus a player analytics suite
driven by a local battle database of ~3.8 million battles.

Vite + React 18 + TypeScript, CSS Modules, zustand, hash routing (no router
library). The analytics half is served by a small Python API reading the Discord
bot's SQLite files read-only.

> **Status: local revamp in progress.** This lives on the `revamp` branch and
> has never been pushed. Production (`royal-duels.vercel.app`) is still on
> `6ab701d`, the last commit before the revamp began. Nothing here is deployed
> and nothing here should be pushed until the revamp is finished.

---

## Table of contents

1. [Running it](#running-it)
2. [What the app is now](#what-the-app-is-now)
3. [Where the data comes from](#where-the-data-comes-from)
4. [The analytics API](#the-analytics-api)
5. [Top Meta Decks — why it is a snapshot](#top-meta-decks--why-it-is-a-snapshot)
6. [Deck rendering: the three special slots](#deck-rendering-the-three-special-slots)
7. [Duel combinations — the logic and why it looks like that](#duel-combinations--the-logic-and-why-it-looks-like-that)
8. [Colour: how it was chosen](#colour-how-it-was-chosen)
9. [The revamp, in order, with the reasoning](#the-revamp-in-order-with-the-reasoning)
10. [Things that went wrong and what fixed them](#things-that-went-wrong-and-what-fixed-them)
11. [Testing and verification](#testing-and-verification)
12. [Project layout](#project-layout)
13. [Deliberately not done](#deliberately-not-done)

---

## Running it

Two processes. The site works without the second one — the analytics screens
show "Analytics service is not running", which is the intended message rather
than a crash — but nothing on those screens will have data.

```bash
npm install
npm run dev              # Vite. Usually :5173; it moves to :5174 if that is taken.
python server/app.py     # the analytics API on :8787. No pip install needed.
```

Vite proxies `/api/analytics/*` to `127.0.0.1:8787` (see `vite.config.ts`), so
the browser only ever talks to its own origin.

```bash
npx tsc -b                        # typecheck
npm run test                      # 95 tests over the deck logic (vitest)
python server/test_duel_combos.py # 34 checks over the duel logic, no DB needed
python server/test_meta.py        # 23 checks over the meta board rules
python server/test_card_art.py    # 39 checks over deck arrangement and card art
npm run lint
npm run build                     # what Vercel would run
npm run update:cards              # refresh src/data/cards.json from RoyaleAPI
```

**Note on the dev server host.** Vite binds IPv6 loopback here, so it answers on
`http://localhost:5174` but *not* on `http://127.0.0.1:5174`. Scripts that hard-code
the IPv4 address get `ERR_CONNECTION_REFUSED` and look like the server is down.

**Note on stale servers.** A dead Vite can leave port 5173 held, so a new one
silently moves to 5174 while your browser keeps loading the old bundle from
5173. If a change "doesn't appear", check which port you are actually on:

```bash
netstat -ano | grep LISTENING | grep -E ":517[0-9]|:8787"
```

---

## What the app is now

Everything lives inside one dashboard shell (top bar, left sidebar, content
panel). The hash drives what is open, so links and refreshes work.

| Route | Screen |
|---|---|
| `#/` | Dashboard home — search, tool panels, analytics areas |
| `#/builder` | Duel deck builder (5 decks × 8 slots, cards unique across the set) |
| `#/decks` | Deck's Home — unlimited auto-saving single decks |
| `#/palette` | Counter Palette — archetype folders of counter decks |
| `#/player/<tag>` | Player analysis — top decks, use/win trends |
| `#/player/<tag>/meta` | **Top Meta Decks** — the global leaderboard (needs no tag) |
| `#/player/<tag>/duels` | **Duel Analysis** — card combinations in duel play |
| `#/player/<tag>/<slug>` | The remaining sidebar sections (shells, no data yet) |

The builder tools were previously separate full pages with their own nav bars;
they now render `embedded` inside the dashboard panel, so the chrome stays put
and only the content scrolls.

Auth is a client-side gate over 20 fixed test accounts (SHA-256 of
`username:password` checked against bundled hashes). It is a test gate, not
security. Credentials live in `TEST_ACCOUNTS.md`, which is gitignored.

---

## Where the data comes from

This is the part worth reading carefully, because the data is not in this repo
and never will be — it is 43 GB of someone else's SQLite.

### The two tiers

Mirrors the storage model the Discord bot (`~/Desktop/Clash_Bot`) already uses,
rather than inventing a second one:

| Tier | Default path | Size | Role |
|---|---|---|---|
| Hot | `C:\ClashBot\data\battles.db` | ~12.9 GB | rolling window, the bot writes here continuously |
| Archive | `H:\ClashArchive\archive.db` | ~30.6 GB | every battle ever, never pruned |
| Fallback | `~/Desktop/Clash_Bot/battles-pre-retention.db` | — | used when the C: install is absent |

At the time of writing that is 3,835,233 battles across 88,067 players in the
hot tier, spanning 2026-05-01 to 2026-08-10 (102 days).

### Three properties that are the whole reason `server/clash_data.py` exists

**1. Every path is an environment variable with a local default.** That is the
migration seam. Moving to a cloud VPS means setting these, not editing code.

| Variable | Default |
|---|---|
| `CLASH_DB_PATH` | `C:\ClashBot\data\battles.db` |
| `CLASH_DB_FALLBACK` | Desktop `Clash_Bot/battles-pre-retention.db` |
| `CLASH_ARCHIVE_DB_PATH` | `H:\ClashArchive\archive.db` |
| `CLASH_API_HOST` / `CLASH_API_PORT` | `127.0.0.1` / `8787` |
| `CLASH_API_URL` | retargets the Vite proxy |
| `VITE_ANALYTICS_BASE` | points a built bundle straight at a remote host |

The browser only ever calls `/api/analytics/*`, so neither the components nor
the client module change when the service moves.

**2. The archive is never assumed present.** `archive_available()` walks up to
the nearest existing ancestor directory and tests it, with a 30-second cache so
an unplug/replug is noticed without a restart. If drive H: is not connected,
every query answers from the hot tier alone, nothing raises, nothing 500s, and
the page footer says which tiers answered. This was an explicit requirement:
*"make sure if the harddisk is not connected then it takes from local desktop
and doesn't break."*

The archive is also only *opened* when the requested window reaches further back
than the hot tier holds — so normally the 30 GB file is not touched at all.

**3. Connections are strictly read-only** (`mode=ro` URI). SQLite itself refuses
writes, so a bug here can never corrupt the bot's data even by mistake. WAL mode
means these reads never block the bot's polling writes either.

### Picking a database file

A candidate must *carry the schema*, not merely exist. The desktop copy ships a
4 KB `battles.db` stub with no tables in it; selecting a file by existence alone
picks that stub and then every query dies on "no such table". `_has_schema()`
checks for `player_stats_agg`, `player_deck_agg` and `battles` before a
candidate counts as usable.

### The live Clash Royale API

`battles.db` stores match history, not profiles, so trophies, best trophies and
arena come from the live CR API. Credentials are read out of the bot's own
`.env` rather than duplicating a 500-character token into this repo. Everything
about it is best-effort: no token, no network, or a rate limit all return `None`
and the screen falls back to stored crowns. Cached five minutes.

---

## The analytics API

Standard library only, on purpose: no pip install, nothing to build, and it
starts on any machine with Python. It serves JSON over HTTP so the browser talks
to it exactly the way it will talk to a hosted API later.

| Route | Returns |
|---|---|
| `GET /api/analytics/status` | which tiers are readable, and their sizes |
| `GET /api/analytics/suggest` | a few real tags with the most stored battles |
| `GET /api/analytics/coverage?tag=` | earliest/latest stored day, globally and per player |
| `GET /api/analytics/player/<tag>` | summary, top decks, per-day trends |
| `GET /api/analytics/duels/<tag>` | card combinations in duel play |

Both report routes take the same window: `?days=N` or `?from=&to=` as
`YYYY-MM-DD`.

**`days` counts back from the last battle stored for that player, not from
today.** A player who stopped playing a month ago would otherwise be handed an
empty screen with no explanation.

Tags are validated against Supercell's 14-symbol alphabet before they reach a
query (the same rule as `clashdb.normalize_tag`), so junk never hits the
database.

### Why the window has to be real

`days=30` was hardcoded at first. The databases hold 102 days, so the screen was
quietly answering a different question from the one on the label. Now:

- coverage is measured per player and the control reads **"30 of 50 days"**, so
  the gap between what you asked for and what exists is visible;
- presets longer than a player's history are still offered but dimmed with a
  tooltip — hiding them just raises *"why can't I pick 60 days?"*;
- the season control maps to a calendar month and actually drives the query;
- "Current Season" is the month of the latest **stored** battle, not today's.

Deck rows are aggregated from `battles` *inside the window* rather than read
from `player_deck_agg`, which is lifetime-only. That is what makes the date
range mean anything: pick a different window and the ranking, the use rates and
the totals all move with it.

---

## Top Meta Decks — why it is a snapshot

The one screen that is about everybody rather than one player: which decks the
whole base runs, over the last 10 days, ranked by use rate.

**It cannot be queried live.** A `GROUP BY player_deck_hash` over a date window
was built and measured first:

| window | via `idx_battles_time` | full table scan |
|---|---|---|
| 7 days | 39.9 s | — |
| 10 days | 48.3 s (49.3 s warm) | 45.1 s |
| 30 days | 76.3 s | — |

The cost is I/O — the index yields rowids in time order and then ~1.4M rows are
fetched from a 12.9 GB table whose rows carry two JSON card-list columns. The
normal fix, a covering index on `(battle_time, player_deck_hash)`, **is not
available**: this process opens the bot's databases `mode=ro` precisely so it
can never modify them. So a background thread recomputes on a timer and requests
read the finished snapshot in ~3 ms. Every response carries `computedAt`, and
the header prints how old the numbers are instead of implying they are live.

Three rules decide what lands on the board, and two of them are corrections to
what the first version actually produced:

- **Competitive 1v1 only** — ladder, ranked, clan-war 1v1, tournaments. 2v2 and
  the event modes that hand you a deck would measure Supercell's choices.
- **A deck needs 25+ distinct players.** Without it the board ranked a deck 50th
  on 1,703 Ladder battles at an **8.5% win rate** — 144 wins from 1,703. The
  stored results are clean, so those battles are real; they are just almost all
  one account grinding one deck badly. A use-rate ranking is exactly the shape a
  single heavy player can inject themselves into.
- **Variants merge at 6-of-8 shared cards** — the bot's own
  `COUNTER_MIN_OVERLAP`. Without merging the board printed "Mortar" twice,
  "Bridge Spam" twice and "Royal Giant" twice, and every use rate looked
  impossibly small because one archetype's play was split across dozens of
  one-card tech variants.
- **Names are qualified by a signature card.** Merging cannot join genuinely
  different decks that share a win condition, so "Hog" still appeared six times.
  `_deck_name` appends the priciest non-win-condition card — "Hog Musketeer",
  "Hog Earthquake" — which is how players name these decks anyway.

Use rate is a share of **every** competitive battle in the window, including
those on decks the floor rejects — a share of all play, not of the board. The
top 50 covers ~27% of it; Clash Royale's meta is a genuinely long tail across
roughly a million distinct deck lists, so a leading deck at ~2% is the real
number rather than a bug.

---

## Deck rendering: the three special slots

Applies to every screen that draws a deck. One function owns it —
`clash_data.arrange_deck` — and it decides both the ORDER of the cards and which
art each draws.

### The rule

A deck's first three positions are special, in the numbering a player sees:

| slot | may hold |
|---|---|
| 1 | evolution only |
| 2 | hero, champion, or an ordinary card — never an evolution |
| 3 | hero, evolution or champion (the "wild" slot) |

which caps a deck at **two** evolutions. A champion has neither an evolution nor
a hero form, so wherever one is legal it simply draws as itself.

`arrange_deck` fills as many special slots as it can. The four cards that own
*both* forms — knight, valkyrie, musketeer, wizard — take an evolution slot when
one is free and the hero slot when the evolutions are already spent, because two
evolutions **and** a hero renders more of the same deck than two evolutions and a
gap.

### Why the stored order is rebuilt rather than trusted

The order is not random, but it is not reliable either:

| source | marks inside slots 1-3 |
|---|---|
| `battles.player_card_keys` (per battle) | **1194 / 1194** |
| `decks.cards` (dimension table) | **774 / 1056** |

The per-battle order is perfect; the decks table — which the meta board reads —
loses the arrangement about a quarter of the time. That is exactly why an X-Bow
and a Goblin Drill deck rendered almost entirely plain on the meta board while
the same decks were fine on a player's screen. And the deck *hash* is useless
for display in either case: it is alphabetical, so it identifies a deck without
describing one.

### Why the rule is stated, not inferred

**The bot never settled this, and its own sources disagree.**

| source | says |
|---|---|
| `Clash_Bot/CLAUDE.md` (measured) | marks cap at three per deck; the data *"cannot distinguish"* two evolution slots plus one from three special slots — *"Do NOT add a derived `player_hero` column until something settles which reading is right"* |
| `Clash_Bot/card_art.py` (the code) | checks `can_be_hero` **first** in slots 0 and 1 |
| `Clash_Bot/CLAUDE.md:720` (the docs for that code) | "slots 1-2 render evolution art; slot 3 champion/hero" |

Measured here over ~8,000 recent marked battles: slot 1 evolution **92%**, slot 2
hero **70%** / evolution 30%, slot 3 evolution **83%**. So the bot's renderer
would draw hero art in a position that is 92% evolution, and its docs describe a
third arrangement again.

Reading the raw majority is not an option either: 14% of single battles carry
three evolution marks, which put three evolution frames on decks that cannot
have three.

So the rule above is asserted, and this table is why.

### Which art a card wears is measured

Never guessed from capability flags. `card_art_profile` reads what each card is
actually brought as across the database — all four both-form cards come back
**100% evolution**. `player_evo` stores `[card_key, level, art]` with `art`
already resolved by the bot from the payload's icon URLs.

Where the payload says nothing — it only covers battles from 2026-08-05, ~29% of
the database — the slots are read positionally and the deck is flagged
`artInferred`, which the tooltip and a footnote say out loud. The Duel Analysis
combos take the same fallback; without it the tab drew art for some players and
not others purely on whether their duels predated the backfill. A combo is a
pair rather than a deck, so there is no slot to reason about there — the only
honest statement is "this card is usually brought as X", which is exactly what
the profile holds. A dashed outline
was tried as the visual marker and removed: it read as a broken image rather than
as a caveat.

An earlier pass here concluded the positional reading was invalid, on a
measurement that checked only the first *two* slots. It was the measurement that
was wrong — all three are special.

---

## Duel combinations — the logic and why it looks like that

`server/duel_combos.py` is a port of the bot's Pair Board
(`clashdb.get_card_pair_stats` + `pdf_pages.pair_board_data`). It is a **port,
not a reimplementation** — if the two ever disagreed, the website would start
describing a different set of battles from `!duels` for the same player,
silently and with no error.

A **combo** is two cards fielded in the same deck, in a duel.

### Pairs come from decks, never a second scan

A battle carries exactly one deck, so grouping by deck first and expanding to
pairs afterwards is *lossless* for any card-set question — a pair's game count
is the sum of the battles of every deck holding both cards, which is precisely
what a per-battle scan would return. Going back to `battles` would cost a second
read of the same rows and create a second source of truth.

### The floors, and why a pair needs them

| Floor | Value | Why |
|---|---|---|
| `PAIR_MIN_GAMES` | 8 | `confidence_tier` refuses to tier anything smaller, so a pair below it would be a percentage with no evidence attached |
| `PAIR_MIN_DECKS` | 2 | a pair confined to one deck is not a pairing — it is that deck, named by two of its cards |

Confidence is a 95% Wilson interval; `None` means *the claim is not made at
all*, not "low confidence". A 6-from-6 record is not reported as "100% ± 0%".

### The budgets, which are the whole reason the table is readable

A pair inherits the record of **whole decks**, so a player's most-played deck
contributes all 28 of its pairs with identical game counts. Without a budget the
table is one deck sliced twenty-four ways. Measured in the bot project on real
players: 24 rows drawn from 7 decks, one deck supplying 12 of them, with a
median 85% of each row's games coming from that single deck.

So: a card may appear at most 2 times (relaxing to 3 only for rows it could not
otherwise reach), and a *deck* may dominate at most 2 rows. Selection runs three
sweeps — pairs whose cards are both unused, then those reusing one, then both —
because a plain greedy pass walks the ranking from the top where the pairs share
cards, and spends the budget on the first cards it meets.

### Ranked by evidence, then reach, then volume

- **By games alone** → the grind deck's 28 pairs take the top of every tab.
- **By reach alone** → fixes that and breaks the evidence rule instead: a pair
  in twenty decks played twice each arrives at 21 games carrying a 95% win rate.

So trustworthiness leads, reach orders within each group, volume only breaks
ties — and ties break on the card keys, never on dict iteration order.

### There is no synergy score, and that is a measured result

The obvious metric — a pair's win rate against what each card does apart — was
specified, built and tested in the bot project *before* any of this was drawn:

```
together = wins/games over decks holding BOTH cards
apart    = wins/games over decks holding EXACTLY ONE of them
lift     = wr(together) - wr(apart)
```

Tested against a permutation null (each deck keeps its card set and game count;
which record belongs to which card set is shuffled) across 14 player shapes, the
real spread came out at a **median 1.00× its own null**, below it as often as
above. The null itself put 8–25% of pairs past |z| ≥ 2 where an honest binomial
would put 5% — because battles inside one deck are not independent draws, so the
textbook standard error is simply wrong here.

A "Synergy 78%" computed that way reports **deck clustering as a property of two
cards**. The page states what it can count instead. Do not reinstate a lift
score without a new hypothesis and a fresh leak-free measurement.

### G1/G2/G3 came free from the storage format

The useful discovery: **a native duel is stored as one row carrying the whole
loadout** — 16 or 24 cards, i.e. two or three decks laid end to end. So a duel
deck's position in the loadout is *read* out of the data, not inferred.

Friendly practice has no such row, so those duels are rebuilt with the bot's own
`duel_split` rules, every one of which is measured rather than guessed:

- a >30 minute gap closes a series;
- card reuse closes a series (a duel loadout cannot repeat cards);
- a 2-0 arms **exactly one** dead rubber, then closes — players routinely play
  the decided third game to show their third deck;
- a 2-1 does **not** close: that is the real-Bo5 case, and closing it reported
  one five-game series as a 1-2 plus a fabricated 1-1 tie.

The G1/G2/G3 columns show the share of decks played in *that slot* which carried
the pair — "how much of my G2 is this combo". Not a share of the pair's own
games: the three slots do not hold equal numbers of decks, because a duel
decided 2-0 never fields its third.

### One deliberate divergence from the bot

The PDF assigns each pair **exactly one** category, because it prints all four
on one board and a pair in two buckets would be one fact printed twice. Tabs are
not one board — each tab is its own question, and an "Evolutions (Combo)" tab
that hides Evo Royal Giant because a win condition outranked it is answering a
different question from the one on its label. So the bot's *predicates* are used
unchanged, applied **independently** per tab. A pair may appear under two tabs.

---

## Colour: how it was chosen

All colour lives in `src/index.css` as tokens — it is the single source of
truth, and no component defines a colour of its own.

### The neutral ground

Dark is black/grey/white, light is white/black, both derived from published
practice (Radix Colors' 12-step semantics, GitHub Primer, Linear, Vercel) rather
than picked by eye. Two rules from that research drive the values:

- **Never a pure black ground and never pure white text** — the halation makes
  body copy vibrate.
- **Light mode elevates by making the page grey and the card white.** The first
  attempt had a `#FFFFFF` page with `#FBFBFB` cards, i.e. cards *darker* than
  the page they sat on, which is why they read as sunken.

The ladder is shallow and evenly spaced so page, sidebar, card and input are all
separable without any of them being pure black or white:

| | page | card | raised | sunken |
|---|---|---|---|---|
| dark | `#111111` | `#1A1A1A` | `#202020` | `#0D0D0D` |
| light | `#FBFBFC` | `#FFFFFF` | `#FFFFFF` | `#F5F5F6` |

### The five hues

The interface is **primarily neutral**; these are accents distributed across it,
not a theme. One hue means one thing, everywhere:

| Hue | Means | Dark | Light |
|---|---|---|---|
| **violet** | you are here / selected | `#A78BFA` | `#6D28D9` |
| **pink** | the primary thing to click | `#F472B6` | `#C81E69` |
| **blue** | neutral information | `#5B8DEF` | `#1D4ED8` |
| **green** | positive outcome | `#34D399` | `#047857` |
| **red** | negative or destructive | `#F87171` | `#C02618` |

All ten clear **4.5:1 against every surface they sit on**, and both CTA hues
carry white text at 4.5:1+, so a filled button needs no per-theme text colour.
The dark column is re-stepped for the dark ground, never a dimmed light value.

**Three intensity levels**, defined once in `index.css` and mixed against the
card surface so both themes derive from the same ladder:

| Level | Strength | Used for |
|---|---|---|
| 1 — wash | ~8% | hover, icon-tile backgrounds |
| 2 — fill | ~14% | the selected state's background |
| 3 — raw hue | 100% | icons, borders, numbers, meters, buttons |

**The raw hue only ever lands on small things.** That single rule is what keeps
a neutral interface neutral while still reading as coloured — a large surface
never goes past level 2.

Components opt into a **role**, never a colour: `--accent-select`,
`--accent-action`, `--accent-info`, `--success`, `--error`. `--accent` stays
neutral, because a hue that sometimes means "selected" and sometimes means "bad"
teaches the reader to ignore it.

Identity is a separate axis from selection: sidebar sections and tool panels
wear a hue on their **icon tile** so an area is recognisable at a glance, while
the *selected* row is always violet regardless of its identity hue.

### Contrast and focus

Every pair was checked numerically. The earlier neutral pass needed
`border-strong` and `rarity-common` nudged after they fell to 2.88:1 and 2.97:1.

There was **no `:focus-visible` rule anywhere** in the codebase and a dozen
`outline: none` declarations removing the browser default, so keyboard users
could not see where they were. `index.css` now carries one global 2px violet
ring at 2px offset. Selected states also carry a leading edge, a border and a
text-colour change, so meaning never rests on hue alone.

### The chart and data colours — a deliberately separate system

**The UI accent system and the data-visualisation palette have different jobs
and must not be merged.** UI colour communicates interface meaning; chart colour
communicates data, and only the latter has to survive being compared without a
label attached. Re-encoding the charts to match the UI hues would trade a real
property for a cosmetic one.

Concretely: the reference dashboard's own blue and violet fail CVD separation —
ΔE **4.5** under deuteranopia and **14.5** even with normal vision, below the 15
floor. Its two middle progress bars are genuinely hard to tell apart. Copying
that would be copying a defect.

Computed with the palette validator, not eyeballed:

| Role | Light | Dark | Kind |
|---|---|---|---|
| Use Rate | `#2a78d6` | `#3987e5` | categorical |
| Win Rate | `#169b6b` | `#199e70` | categorical |
| G1 / G2 / G3 | `#9376d8` `#6a4fbe` `#402f96` | `#cabff8` `#9a8ded` `#6f61d6` | **sequential** |

The two categorical hues pass the lightness band, chroma floor, CVD separation
(ΔE 20.7 protan light / 19.6 deutan dark) and 3:1 contrast in both modes. Their
tritan separation is under the floor, which is legal only with a secondary
encoding — each meter prints its own percentage beside it.

**G1/G2/G3 is a sequential ramp, not three categorical hues.** They are ordered
positions in a loadout, so one hue running light-to-dark says "first, second,
third" where three unrelated colours would only say "three of something".
Lightness is monotonic with even steps (OKLab L 0.636 / 0.514 / 0.392 light,
0.833 / 0.695 / 0.566 dark) and every step clears 3:1.

The dark column is **re-stepped against the dark surface**, never an automatic
flip of the light one.

Two more rules held throughout: categorical hues are assigned in fixed order and
**never cycled** (an early chart put two identical blues on one plot via `i % 8`;
anything past the eighth series now folds into one muted "Other"), and there is
never a dual-axis chart — two measures of different scale get two charts.

---

## The revamp, in order, with the reasoning

### 1. Make it fast

The brief: *"we don't need any responsive large elements slowing it down, and
any animations etc cut them down."*

framer-motion was removed entirely — not disabled. It animates by writing inline
styles from JavaScript, so a global CSS `animation: none !important` cannot
touch it; the first attempt looked like a fix and changed nothing, and probing
the page found a mouse-spotlight element still translating 827px.

Measured on direct entry to `#/builder`, before → after:

| | Before | After |
|---|---|---|
| JS | 434.4 kB | 270.5 kB (−38%) |
| CSS | 91.8 kB | 67.3 kB (−27%) |
| Idle main-thread work | 54.6 ms | 1.1 ms (−98%) |
| Style recalcs while idle | 27 | 0 |

*(That −38% is for direct entry. The first measurement navigated via `/`, which
pulls the landing chunk, and showed −1% — worth knowing before quoting a
number.)*

The screens added since have grown the bundle again; the current build is
330.5 kB JS / 92.1 kB CSS, with jsPDF kept as a dynamic import that is never
fetched on load.

Also removed: the global aurora/particle layers, 29 `backdrop-filter` passes
outside the (now deleted) landing, and multi-layer box-shadows. Motion removal
was verified with `document.getAnimations()` returning empty, not by looking.

### 2. Get the neutral ground right

Three palettes were tried and two were wrong. An indigo set, then a warm
espresso set, were both applied against Noguchi Design references before the
verdict came back: *"you have taken wrong colour patterns."* The reset was to a
researched neutral ramp — the section above.

### 3. Rebuild the post-login page as a dashboard

The cinematic landing was deleted (it was being replaced, so it was never worth
optimising). In its place: a top bar, a sidebar of analytics sections, and a
content panel. The three deck tools open *inside* that panel rather than
navigating away, so the chrome stays put.

Glass panels came back at the user's request, on both themes — which required a
page wash behind them, because a `backdrop-filter` over a flat colour has
nothing to refract and just looks like a flat colour.

### 4. Connect the database

Offline first, with migration to a cloud VPS as an explicit later goal — hence
the environment-variable seam and the HTTP boundary described above. The bot on
the desktop was read for the storage model rather than a new one being invented.

### 5. Player analysis, then Duel Analysis

`#/player/<tag>` first (top decks, use/win trends), then real date windows and
live trophies, then `#/player/<tag>/duels`.

Sidebar sections live in the **URL**, not component state, so an analytics
screen is linkable and survives a refresh. The sidebar is navigation, not a
toggle.

### 6. The five-hue accent system

Target: a premium analytics dashboard with Clash Royale identity — colour
communicating meaning, over a ground that stays neutral.

The root cause of the flatness was narrower than it looked. Every selected state
in the app routed through **one token**, `--accent`, which was `#EDEDED` dark /
`#1A1A1A` light. So a selected sidebar item was literally a solid white slab
with black text, and a selected tab, a selected chip and a primary button were
all the same monochrome block. Fixing it was mostly a token-layer change, not a
thirty-file rewrite.

Worth noting about the reference dashboard this was modelled on: **its selection
states are not coloured either.** Its active sidebar item and active time tab
are subtle grey fills. Its richness comes from colour marking *identity* — one
hue per metric card, per series, per progress bar. Selection here does take a
hue, by choice, but as a level-2 tint rather than the solid slab it replaced.

Then a visual pass, because tokens compiling is not the same as a page looking
right — two things only showed up on screen and are recorded below.

---

## Things that went wrong and what fixed them

Kept because each one cost time and each one can recur.

**The archive double-counted every battle.** The archive holds every battle
*including* the ones still sitting in the hot tier, so querying both over the
same dates counts the overlap twice — 70 days reported 4,406 battles against a
lifetime total of 2,070. The window is now partitioned by date: the hot tier
answers from its own earliest row onward, the archive only for what predates it.
Correct at 2,204.

**A trend query took 16,756 ms.** The date bound was being applied in Python.
Pushing it into SQL lets SQLite use the `(player_tag, player_deck_hash)` index —
and because `battle_time` is `YYYYMMDDThhmmss.sssZ`, a plain string comparison
is a correct date filter. 74 ms cold, under 10 ms warm.

**The CR API returned 403 on every call.** Not the token: the RoyaleAPI proxy
rejects urllib's default User-Agent. A browser UA works.

**A popup rendered but its clicks went nowhere.** Every panel carries a
`backdrop-filter`, which creates a stacking context, so a *later* panel painted
over the popup regardless of its own z-index. Raising the ancestor is what
actually fixes it — this bit twice, once on each analytics screen.

**Legend rows were silently disappearing.** `TrendChart` keyed its lines and
legend on the deck *name*, and two decks routinely share an archetype name
("Mortar", "Piggies"). Identity is the deck hash now; the label is only what the
reader sees.

**The invisible hero title.** A bulk token conversion turned `color: #fff` into
`--accent-contrast`, which in dark mode *equals the ground* — so the headline
rendered in exactly the background colour and vanished.

**Decks rendered in alphabetical order.** The deck *hash* is alphabetical — it
identifies a deck without describing one — so using it for display scattered the
three special slots through the row and nothing could be configured. The decks
dimension table is better but not reliable either: measured, the per-battle
`player_card_keys` puts every mark inside slots 1-3 **1194/1194** times, while
`decks.cards` manages **774/1056**. `arrange_deck` rebuilds the order instead of
trusting either.

**Four separate bugs in the evolution art, in one sitting.** Worth listing
because each looked finished before the next appeared: `card_info` never exposed
`can_be_hero`, so the hero branch could not fire at all; collapsing an empty
hero slot shifted the second evolution into slot 2, the one position it may not
occupy; a both-form card always claimed an evolution slot, leaving slot 2 plain
in decks whose only hero-capable cards also evolve; and pooling a merged
cluster's marks drew a deck with five evolutions. Only the first was visible
from the code — the rest needed looking at the rendered page.

**A measurement that checked the wrong number of slots.** An early pass
concluded the positional reading was invalid because only 63 of 391 decks had
their marks in the first *two* slots. There are *three* special slots; on that
test it is 795 of 795. The conclusion was confidently wrong and went into a
code comment and both READMEs before it was caught.

**Violet meant two things at once.** Remapping the legacy `--accent-purple`
alias to the new violet made the Evolution *role* slot permanently violet — so
it was indistinguishable from the *selected* slot, because violet is what
selection means. Role identity went back to neutral; `--accent-cyan` and
`--accent-orange` reverted for the same reason, with a separate `--drop-valid`
(green) for a legal drop target. Only caught by looking at the builder.

**Level 2 is too strong for a large surface.** The duel-analysis tabs are a
third of the page wide, and a 14% fill on something that size reads as a colour
panel rather than an accent. They dropped to level 1 and lean on the border and
text instead. The rule "large surfaces never go past level 2" needs the corollary
"and the wider the surface, the lower the level".

**Three identical CTAs read as one colour.** The home page's three "Open …"
panel buttons were all `--accent-action`, so the page looked entirely pink and
the buttons said nothing about which tool each opened. Each tool panel now wears
its own identity hue. This deliberately bends "pink alone means primary action"
— on those panels the hue reads as identity, and Analyze stays pink as the one
genuine primary action on the page.

**`better-sqlite3` could not be built** (no prebuild for Node 21, node-gyp
fails) and `node:sqlite` needs Node 22. Hence Python for the data layer, which
also removed the pip-install step entirely.

**The desktop fallback pointed at an empty stub** — see "Picking a database
file" above.

**Two dev-server traps**: Vite binding IPv6-only, and a dead Vite holding 5173
so a new one moves to 5174 while the browser keeps loading the old bundle. Both
are in [Running it](#running-it).

---

## Testing and verification

```bash
npx tsc -b                        # typecheck
npm run test                      # 95 tests — deck logic, deck links, PDF export
python server/test_duel_combos.py # 34 checks — duel logic, no database needed
python server/test_meta.py        # 23 checks — meta board rules, no database
python server/test_card_art.py    # 39 checks — deck arrangement, evolution/hero art
npm run build
```

`test_duel_combos.py` runs entirely on synthetic data: no database is opened, so
it passes on a machine with no Clash_Bot install and cannot be broken by
whatever a real player happened to do last week. It covers the parts that are
easy to get quietly wrong — the series rules, the selection budgets, the
evidence floors, and deterministic tiebreaks.

### Browser verification

The convention for UI changes, because a green typecheck says nothing about
whether a page renders:

```bash
npm i -D playwright
# write a verify*.mjs driving the actual flow, run it, read the output
node verify*.mjs
rm verify*.mjs *.png && npm uninstall playwright   # must NOT become a committed dep
```

Check the `package-lock.json` diff afterwards and revert it. Chromium is
reliable on this machine; WebKit is flaky.

Verify scripts assert on *values*, not just on elements existing — the point is
to catch a bar that renders at the wrong colour or a filter that changes nothing.

### Verifying colour specifically

Reading `getComputedStyle()` is the whole point: "the CSS compiles" says nothing
about whether a selected item is still a white slab. For any colour change,
assert in **both** `data-theme` values:

- the computed `backgroundColor` / `color` / `borderColor` of a selected sidebar
  item, an active tab, a chosen chip and a primary button — each should be the
  intended hue, not white or black;
- that hover **changes colour** while `document.getAnimations()` stays at `0`,
  which is the no-motion guarantee;
- that tabbing produces a visible focus ring;
- then **screenshot both themes and actually look at them**. Both colour bugs
  above compiled cleanly, passed every test, and were only visible on screen.
  If a panel reads as a rainbow, reduce the colour.

---

## Project layout

```
src/
  App.tsx                     hash routing -> one Dashboard shell
  index.css                   ALL colour: neutral ladder, 5 hues, the three
                              intensity levels, semantic roles, focus ring.
                              The single source of truth — no component
                              defines a colour of its own.
  components/
    Dashboard/                top bar, sidebar, content panel
    Analytics/
      PlayerAnalysis.tsx      #/player/<tag>
      MetaDecks.tsx           #/player/<tag>/meta — the global leaderboard
      DuelAnalysis.tsx        #/player/<tag>/duels
      CardArt.tsx             one card icon, evolution/hero art when fielded so
      TrendChart.tsx          inline SVG multi-series chart + crosshair
      playerData.ts           shapes, range presets, useDateWindow hook
    DuelDeckBuilder/          the 5-deck duel builder
    DecksHome/                unlimited single decks
    CounterPalette/           archetype folders
    CardPicker/               the card drawer
  state/
    store.ts                  builder store (zustand + persist, v9)
    deckUtils.ts              pure deck logic
    analyticsClient.ts        the ONLY thing that knows the API's shape
  data/cards.json             122 cards, vendored from RoyaleAPI/cr-api-data
  data/cardMeta.json          can_evolve / can_be_hero / is_champion / is_win_condition

server/
  app.py                      stdlib HTTP API
  clash_data.py               read-only DB access, tier resolution, CR API
  duel_combos.py              the Pair Board port
  meta.py                     global meta rollup, background snapshot
  test_duel_combos.py         34 checks, no DB
  test_meta.py                23 checks, no DB
  test_card_art.py            39 checks, no DB
  README.md                   API and storage detail
```

**`analyticsClient.ts` is the seam.** It only ever calls `/api/analytics/*`, so
moving the service to a VPS is a proxy or base-URL change, not a code change.

`useDateWindow` is shared between both analytics screens on purpose. Two copies
drift — that is exactly how the season selector once shipped bound to state
nobody read.

---

## Deliberately not done

Recorded so they are not re-litigated as oversights:

- **Chart palettes are not merged into the UI accent system.** They are already
  CVD-validated; re-encoding them for visual consistency would trade a real
  property for a cosmetic one. See the colour section.
- **Rarity tokens** (`--rarity-common` … `--rarity-champion`) stay greyscale.
  Clash Royale has canonical rarity colours and adopting them is a reasonable
  follow-up, but that is a call about game fidelity, not UI colour.
- **Versus-mode side colours** (`--player-blue` / `--player-red`) stay neutral
  greys separated by lightness. Making the red side actually red would collide
  with red meaning "negative", which a duel side is not.
- **Motion stays off.** Hover changes colour and nothing else; the global
  `animation/transition: none` switch in `index.css` is intact and
  `document.getAnimations()` is asserted to stay at `0`.
- **`--accent` stays neutral.** It is still correct for high-contrast neutral
  fills. Components opt into `--accent-select` / `--accent-action` / etc. rather
  than every `--accent` being globally swapped for a hue.

---

This is unofficial fan content, not affiliated with or endorsed by Supercell.
Card data is a vendored snapshot of
[RoyaleAPI/cr-api-data](https://github.com/RoyaleAPI/cr-api-data), refreshable
with `npm run update:cards`; card art is self-hosted in `public/assets/`, not
hotlinked.

Card art must be **plain sRGB** — embedded lcms iCCP profiles made colours look
washed out on wide-gamut phones, so the existing PNGs were normalised (profile
stripped, pixels unchanged). Strip the ICC profile from any new art.
