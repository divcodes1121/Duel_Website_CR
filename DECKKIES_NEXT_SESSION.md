# NEXT SESSION — Coach Roster

Everything below is live and verified unless it says otherwise. `CLAUDE.md`
carries the full reasoning; this is the short version plus what to do next.

> **Rewritten 2026-09-25.** The previous version's three tasks — run migration
> 007, build the link-account control, build the player dashboard — are all
> **done and live**, and its "obvious next engine change" (wiring meta trends
> into the field plan) is built. Its "needs a nightly
> `coach_player_snapshot`" is **superseded**: progress over time ships by
> RECOMPUTATION and that table was deliberately dropped. See below.
>
> **Updated 2026-09-27** with what shipped since that reaches these screens —
> the dashboard shell, the duel brain, the three-slot rule and the fused
> matchup rate — and the one new decision it leaves.
>
> **Updated 2026-09-28** with the interface pass (four commits, client-side
> except one additive server field). Nothing in it changes a coaching figure;
> the list of what reaches these screens is in the table below.
>
> **Updated 2026-10-02** with the four days since: the daily session, the
> vetted deck pool, the duel win model and the combined brain, the deck
> builders, and Coach Assist's "Build around your cards" (admin-only at first,
> released to Pro the same evening). The trend item is done; four faults found by
> reading Coach Assist end to end are listed and NOT fixed.
>
> **Updated 2026-10-03** with three client-only changes: the scroll rail, PDF
> names in Japanese and Cyrillic, and the eye on duel decks. None of them
> touches the coach engines.

> **Updated 2026-10-10** with the counters rebuild: the decks Team Analysis
> suggests and the Deck Counter's "Bring this against them" are one engine,
> scored against what a player PLAYS, from a pool that holds the duel lists.
> LIVE SINCE 2026-10-10 AS `c1a1a0f`. Server by scp first, 06:49 UTC (the deployed files matched the last commit; backups `*.bak-20261010-064954-precounters`; only `royalweb` restarted), the client 52 s after the push (06:54 UTC, `/api/health` and the build meta). Checked on production: the live API for three players (brain `team-scout-3.0`, pool 2,341, every list ordered, nothing under 50%, every family at 10%+ answered at 55%+, every suggested deck fielding three special slots), six suites green on the VPS, and 42/42 in a real browser SIGNED IN on https://deckkies.com — the Deck Counter's three views in both themes and at 390px, a scouting report and a match plan, the figures on screen equal to the API's. Built and verified on staged code against production data first.

## Where things stand

| | |
|---|---|
| Coach tabs | **6**: Overview · Against the field · Arsenal · Opponent · Battles · Decks played |
| Reached from | **the top bar**, pro-gated like any other paid area; a small back control returns to the roster from a player |
| Migration 006 | **APPLIED and READ.** `linked_user_id` + 4 functions — `#/my` is built on it |
| Migration 007 | **APPLIED.** `is_coach` + `admin_set_coach` + `admin_list_users` v2; coach is a per-account flag, not a role |
| Linked today | CAPTAIN FROZE and the account holder's own admin email |
| Player's own screen | **`#/my`**, visible in the top bar and profile menu only when the account is on somebody's roster |
| Tests | **1,662 vitest** (69 files, full run 2026-10-10), **4,494 Python checks** across 77 suites (one known failure, `test_ml_21a`; full run 2026-10-10), route count **28** |
| Counters to what they play | **LIVE SINCE 2026-10-10 AS `c1a1a0f`. Server by scp first, 06:49 UTC (the deployed files matched the last commit; backups `*.bak-20261010-064954-precounters`; only `royalweb` restarted), the client 52 s after the push (06:54 UTC, `/api/health` and the build meta). Checked on production: the live API for three players (brain `team-scout-3.0`, pool 2,341, every list ordered, nothing under 50%, every family at 10%+ answered at 55%+, every suggested deck fielding three special slots), six suites green on the VPS, and 42/42 in a real browser SIGNED IN on https://deckkies.com — the Deck Counter's three views in both themes and at 390px, a scouting report and a match plan, the figures on screen equal to the API's. Built and verified on staged code against production data first.** `team_scout` 3.0: the projection is a player's own decks (own-deck and duel games — `player_decks.played`), the pool is every vetted ladder list and every duel list (2,341, was 204), the list is the strongest counters in the order of their percentage with an answer held for every archetype they play a tenth of the time, and every deck carries its rate against each archetype (`vs`). The Deck Counter's list is `team_analysis.bring` — the same rows, plus per-archetype and per-counter-card readings (`card_counters.py`: the manual names the cards, the data ranks the decks). The two duel slots of 2026-09-27 are gone; duel lists compete on the one figure. **The Coach Roster's Opponent tab reads Team Analysis, so its list changed with it; the field plan (`coach_daily`) did not.** README "Counters to what they play" |
| Duel recommender rebuild | **STEPS 1-4 OF 5 LIVE 2026-10-07** (`DECKKIES_DUEL_RECOMMENDER.md` is its own record — read that first for anything about Coach Assist's suggestion). The opponent read is a fitted model over the order and recency of a player's duels (`server/duel_read.py`, refitted after each poll): blind on the CRL-list players it names the exact opening deck first 42.8% of the time against the count's 20.3%. The screen shows what they have spent and what they have left by role, a `new deck` figure and a Clan war / Friendly switch. **The same day, after a report from the live screen** ("these decks don't make sense"): `server/deck_packages.py` — what duel players field around each win condition (spell packages, buildings, support), ranked — and a check on every deck Deckkies constructs or changes; 95 of 123 built decks failed it before, 0 of 131 after. **Step 3 the same evening**: the Suggestion picks for the DUEL (`server/duel_plan.py`, a look-ahead over their likely order; one question, "Who won game 1?"; blind 51.4% against 50.8% for the best deck each game and 49.0% for the order players used). **Step 4 that night**: before a duel the Suggestion answers with the SET to load — three or four of the player's own duel decks that share no card (`server/duel_set.py`), unchanged; blind 54.6% against 52.8% for the set really brought, real outcomes too few to confirm. Swaps inside a set were built, measured and left off. **Step 5, the part that needed nobody**: the read's automatic holdout carries a CRL-players line on the status route (`duelRead.holdout.crl`; tags in a server-only file). Left: the look-ahead and set scorecards on the server, decks from outside for players with fewer than three duel decks, the 526 CRL names with no tag |
| Card forms | **SHIPPED 2026-10-06, live as `cb8174c`**, server first (backups `*.bak-20261006-042932-preelectro`). Hero Electro Wizard and Evolution Electro Giant: one flag each in `cardMeta.json` and one art file each — **43 evolutions, 18 heroes, 123 cards**. The hero render arrived without its gem and `scripts/add-hero-gem.py` restored it from the Magic Archer master (same template to the pixel). **Adding the next form:** check whether the render already has alpha (then `build-card-art.py`, NOT `import-card-art.py`), re-run `tests/fixtures/seating.json` through the server's `arrange_deck`, and copy `src/data/cardMeta.json` to the VPS — `cardData` stays 123 and cannot confirm it. README "October 2026: two more forms" |
| All Duels (admin) | **SHIPPED 2026-10-05, live as `7b4eb52`** (`03ecdeb` the page, `c1523a3` friendly three-game duels only, `7b4eb52` Save duel), server first, twice (backups `*.bak-20261005-075221-preallduels`, `*.bak-20261005-082423-prefriendly`): the first build listed every native duel, and the account holder asked for **friendly duels only, and only those played to all three games** (1,169 / 2,431 / 3,046 at 30 / 60 / 90 days). `#/all-duels`, opened from the profile menu by admins only: those duels newest first, both players, the score in games, each game's decks and crowns, a card filter, 30 / 60 / 90 days. Route `/api/analytics/admin/duels` behind the admin gate; new index `games_mode_duel` on the duel index (swapped in by hand at deploy). Each row has **Save duel**: it writes a Versus set to Royal Duels (Blue = the left player, Red = the right), and reads whether it is saved from the library. The signed-in admin view on production is the account holder's check. See the README's "All Duels — friendly duels that went to three games" |
| Decks screen | **SHIPPED 2026-10-04**, server first (backups `*.bak-20261004-163517-predecks`). `#/player/<tag>/decks`: a player's decks, most played first, 7/14/30 days, their record beside the community's; free for everyone (confirmed). Route `/api/analytics/decks/<tag>`. README "Decks — every deck a player is using" |
| Storage jobs | daily timers on the VPS: retention (one battle-day a run, nothing due until 2027-04-02), ladder raw 72 h, 2v2 raw 24 h, verified backup pulled to the owner's PC — the console's Data lifecycle view shows all four |

## What the field plan answers

Three questions off ONE scored pool of ~204 real decks, so they cannot disagree
about a deck (`server/coach_daily.py`, `FieldAnswers.tsx`):

| key | what it claims |
| --- | --- |
| `families` | every win condition the field can be answered with, ordered by its best deck |
| `closest` | of those, the ones built from cards they already run |
| `learn` | one win condition outside their range, chosen by the **biggest single gap it closes** |
| `progress` | this window against the one before it (`compare=1`), recomputed from the rows |

It rests on one fact: **`team_scout.score()` takes the threat space as an
injected parameter** and does not know where it came from, so a projection
built from the meta board gets the same tested arithmetic with no second
scorer. There is no model and a test asserts no `ml` import.

## Shipped 2026-09-25 afternoon (all live)

| commit | what | measured |
|---|---|---|
| `c23abdb` | **Team Scout brain 2.1** — a match plan's teammate lists are chosen as a squad (`team_scout.squad_plan`) + a Coverage strip | 11 real folders: every-#1-distinct 0/11 -> 8/11, distinct decks 117 -> 191 of 378, -0.36 pts |
| `c0a643c` | **Coach Assist "Or bring one of these" is per player** (`deck_tuner.personalise`, `coach._playstyle` from ALL stored battles) | 12 players vs one opponent: 1 -> 7 distinct lists, 10/12 offered their own win condition, -1.0 pt |
| `284e09b` + `1754a7b` | **Five archetype chips under every Suggestion deck**, one line (`coach._chip_archetypes` / `_chips`) | likely -> their other win cons -> meta; warm latency unchanged ~1.1–1.3 s |

Backups on the VPS: `team_*.py.bak-20260925-152203-presquad`,
`{coach,deck_tuner}.py.bak-20260925-155229-prestyle`,
`coach.py.bak-20260925-160905-prechips`, `coach.py.bak-20260925-162209-prefive`.

## Shipped 2026-09-26 and 2026-09-27 (all live) — what reaches these screens

| commit | what | on the coach screens |
|---|---|---|
| `2780326` | the dashboard kit is TailAdmin's, every chart answers hover, tap and keyboard | the roster overview, each player's Overview and `#/my` |
| `61e6a14` + `32961a5` | every PDF rebuilt on one engine; a tab opened before a deploy is told to reload | the roster exports through the same button |
| `fcbc8b1` | every tag asked about anywhere is queued for collection | an opponent scouted from the roster gets collected |
| `ea79f1b` | **one dashboard shell with a sidebar** for the console, the roster and `#/my` (open / mini / closed, remembered; a drawer on phones) | the roster's player list IS the sidebar; `#/my` has URL sections |
| `9a8f2e9` | **the duel brain**: two of each seven held for decks proven in real duels | the **Opponent** tab reads Team Analysis, so its list carries duel picks |
| `f54c864` | **every suggested deck fields all three special slots**; Deckkies picks only from lists that can | the field plan, the Today board, `#/my` and the Opponent tab |
| `fdce37e` | **one matchup rate per threat LIST, ladder and duels together**, weights fitted on a duel holdout (0.6873 -> 0.6793 log loss) | the **Opponent** tab's rates; the field plan does NOT use it yet |
| `c3309c6` | **Coach Assist's tuner fields every special slot and opens to Pro** (`isPaid`, never Members) — a screenshot caught a plain Bandit in slot 2 | none directly |
| `93e45e2` | **Coach Assist reads real duels** (the fused rate on every pairing, one of three options held for a legal duel-proven deck) and **Deck vs Deck on the home Deck Counter** | none directly — Coach Assist is its own screen; the roster's Opponent tab already read Team Analysis |
| `44e8b28` | **the interface pass, part 1**: Player Analysis trends pool by games (server adds `games` per day), tables fit a laptop, recent players, a form strip on Recent Battles, blurred previews behind sign-up gates | none directly |
| `db1767f` | **a command palette (Ctrl K), keyboard shortcuts, undo/redo** in the three deck tools | the palette reaches every screen, including these |
| `1ee2be7` | **save a deck as a picture**, fill a deck legally, an elixir curve per deck, meta movement badges (live from 2026-09-30) | every deck drawn with Copy link here can be saved as an image |
| `68e5b7f` | **one tab component**, the card inspect sheet, route cross-fades, landing depth; the phone pass moved Deck Counter's and Duel Zone's deck buttons under the cards | the chart cards' tabs are the violet slab; a tapped card opens the inspect sheet |

Backups on the VPS for the last three:
`{app,team_analysis}.py.bak-20260927-035602-preduel`,
`{clash_data,team_analysis,coach_daily,coach}.py.bak-20260927-082012-preslots`,
`{duel_index,team_analysis,team_scout,deck_counter}.py.bak-20260927-085838-prefusion`.

## Shipped 2026-09-29 to 2026-10-02 (all live)

| commit | what | on the coach screens |
|---|---|---|
| `be6d8b8` | Coach Assist's loadout never offers a card already played this duel | none directly |
| `8153eae` | a deck the bot files under `other` is named by its win condition, not "Mixed" | every single-deck label here |
| `ae0938a` | **today's session** (`coach_session.py`): the daily practice changes daily; the trend contract bug fixed | the Today card and `#/my` lead with it; roster rows say "Drill X" |
| `80e8b8c` | **offered decks are vetted** (`deck_evidence.py`): 25+ pilots, no pilot over half, played in 30 days, 60%+ own-deck modes — Royale Shuffle and one-pilot lists out | the field plan's pool is the same vetted seeds |
| `c018789` | the tuner's lists are built from the player; forms are what pilots field (`observed_seating`) | deck art on every seeded list |
| `7f8cb64` + `b146bae` | **a duel win model** trained on every stored duel game, and Coach Assist ordered by the **combined brain**; the duel evidence updates after every bot poll (`after_poll.py`) | none directly |
| `f846c74`, `6208918` | "Or bring one of these" is six decks, says which are new to you, and offers only decks whose cards duel players pair (`deck_synergy.py`) | none directly |
| `2247381` | **decks built by human swaps** (`deck_builder.py`, `swap_graph.py`) | none directly |
| `416c026` | Coach Assist 80 s -> ~7 s: one idle connection per database file | every analytics read on the roster is faster cold |
| `db7570d`, `415b8b3`, `9804765` | **Build around your cards** (Pro and admin; admin-only for its first day): name up to four cards, get duel decks, your decks and the meta, and decks BUILT from how duel players build around them (`deck_architect.py`) | none directly |

Backups on the VPS for the last row: `{coach,app}.py.bak-20261002-040707-prechoice`,
`{coach,coach_choice,duel_index}.py.bak-20261002-045206-prearchitect`.

## Shipped 2026-10-03 (all live, client only)

| commit | what | on the coach screens |
| --- | --- | --- |
| `19a4af0` | **the scroll rail**: one scroller on every screen, a rail of ticks that drags, presses and names the page's sections (`ui/scroll-rail.tsx`, mounted once) | the roster, each player's tabs and `#/my` scroll with it |
| `b7e4942` | **PDFs print Japanese and Cyrillic names**, with the Latin form and the tag beside them | the roster exports through the same engine, so a player's name prints as written |
| `f8dfc02` + `870b838` | **the eye on a duel deck** (Royal Duels): a hidden deck stays on the board in grey and frees its cards for the other decks; when two decks in play hold one card, the newer copy is the grey one (`Deck.hidden`, `Deck.newerCopies`) | none |

## Shipped 2026-10-10 (all live)

| What | Where |
|---|---|
| Counters to what they play (brain 3.0), then the wide read the same day (brain 4.0: tempered, duel decks first, twenty lists, a cost for a hole) | README "Counters for what they are likely to bring", `DECKKIES_TEAM_SCOUT.md` §4j-4k |
| The card manual as pushed data: `All_Cards_stats.md` (git-ignored) -> `scripts/push-card-data.py`; balance log applied (`card_balance.py`) | `server/README.md` |
| Coach Assist's read fitted on the CRL group only (`CLASH_DUEL_READ_COHORT=crl`) | `DECKKIES_DUEL_RECOMMENDER.md` log |

Open from it: the exact "top 64 of each monthly qualifier" tag list for the
CRL group (not on this machine); a signed-in browser pass of the 4.0 screens;
war duels in the replay; whether the manual itself should be committed.

## Decisions waiting on the account holder

1. **The R3 prediction sampler STOPPED on 2026-09-19 21:05 UTC** (its own stop
   condition: a royalweb restart during a deploy), ~8 h into 7 days, and was
   not restarted, per protocol. A re-run needs a deploy freeze for its week or
   an amendment to that stop condition. `server/README.md` has the detail.
2. **Coach Assist's main "Play this" pick is still the same for players with no
   duel history** — 7 of 12 got the same meta Hog deck, because `suggest()`
   tops up from population decks, never from their own ladder decks. Fixing it
   changes the headline recommendation, so it was left for a decision.
3. **Coach Assist's displayed percentages are miscalibrated** (Brain Phase 16:
   "Cards to expect" 62% shown vs 46% observed, "clear favourite" 45.5%). The
   product response — reword, withhold, or reserve mass for unlisted decks —
   is still open.
4. **The squad plan's band against the fused rate (2026-09-27).** A match
   plan gives teammates different #1s only among options the evidence cannot
   separate (`PRIMARY_BAND`, 3 points). The fused rate separates a clear
   counter more often, so every-#1-distinct went **8/14 -> 6/14** on real
   folders (e.g. a Bait list at 84.4% over 201 games against that opponent's
   own Miner list, pointed at all five teammates). The band was deliberately
   NOT re-tuned; forcing distinct #1s would hand some teammates a measurably
   worse deck.

5. **DONE 2026-10-02 evening: "Build around your cards" is open to Pro.**
   Asked for: "make it available for pro also as it's shipped".
   `choiceAllowed = isPaid(useAccess())`, `tests/coachChoiceGate.test.ts`
   (13), release note `2026-10-02-build-around-your-cards`. Client only.
   The gate is still in the client only. **Watch the first-request time**:
   20.7 s on one real pair at release, against ~8 s recorded at launch;
   3.7-4.2 s repeated.
6. **The pilots question from 2026-09-27 is answered.** The duel-rating
   adjustment that was measured and held back then shipped on 2026-09-30 as
   the combined brain's strength and level terms, at the account holder's
   request. Nothing left to decide there.

## THE ONE BLOCKING GAP: `is_coach` grants the screen, not the rows

**Measured 2026-09-25.** Migration 007 made coach a per-account flag so an
account on any tier can coach. It deliberately did not touch the roster's RLS —
and `coach_is_admin()` is defined ONCE, in 004, as
`effective_tier(auth.uid()) = 'admin'`. Nothing redefines it.

So a pro account with `is_coach = true` and no admin role **passes the client
gate, opens the screen, and gets nothing back**: RLS on all five `coach_*`
tables still requires admin. An empty roster on a screen it was just told it
may use.

**It is LATENT, not live, and that was counted rather than assumed.** Of 14
accounts, exactly one carries `is_coach = true` and that one is the owner, so
every coach today is also an admin and RLS lets them through. **It bites the
first non-admin who is flagged.**

The fix is a **migration**, not a client change: widen the five policies to
`(coach_is_admin() OR is_coach) AND coach_id = auth.uid()`, or redefine
`coach_is_admin()` to read the flag. Prefer redefining the function — it is one
place, the policies already call it, and `004_coach_roster_verify.sql` exercises
the refusal path. It is a security-sensitive edit to RLS on five tables, so it
is the account holder's call and has NOT been written.

**Until it is: do not flag a non-admin as a coach** and expect a working
roster. The console control will happily set it.

## Genuinely next, in rough order of value

### 0. The fused rate for the field plan (cheap)

**Coach Assist's half is DONE (2026-09-27)** — `coach._Rates`, holdout 0.6853
-> 0.6793. What is left is the field plan.

`matchup_fusion` rates Team Analysis per threat LIST (0.6873 -> 0.6793 log
loss on held-out duels). The field plan still rates by archetype, and its pool
(the scout seeds) and its threats (the meta board) are ALL version hubs, so the
duel index's version cells already hold every pair it would ask about: it is a
`rate_for_threat` away. Measure the board's distinctness before and after — the
field plan fought for per-player difference just as the squad plan did.

### 1. Prove the "notes are hidden" property for real

`my_coach_players()` deliberately does not select `notes` — they are written
about a player expecting they are not reading them. **The check for this has
only ever passed vacuously** (no linked rows existed, so no columns to
inspect). Two accounts are linked now, so it is provable: write a note on a
linked player as the coach, then read `my_coach_players()` as that player and
assert the column is absent. It is not a UI choice a screen may reverse, so it
deserves a real assertion.

### 2. The trend switches on 2026-09-30 — look at it then

**DONE, 2026-09-30.** It switched on that day and its first run on real data
found a bug: the client read `trend.days` while the server sends
`daysApart`, so the screen printed "trend undefinedd". Fixed, and
`tests/fieldTrendContract.test.ts` reads both files so the two cannot drift.
What follows is kept as the record of what was expected.

`meta_history` began banking daily boards on 2026-09-23 and `plan()` asks
`movement(TREND_DAYS)` with `TREND_DAYS = 7`, which needs a snapshot at or
before `latest - 7`. So the screen says `trend off` truthfully until **seven
days are stored**, then starts weighting threats by the board's own direction.

**When it does, check the claim before trusting it.** The weighting is bounded
(`TREND_MAX`), and the day it first fires is the first time that path has run
on real data. `TREND_MIN_DAYS = 3` **cannot fire from the production path** —
`movement()` walks older and never closer, so `daysApart` is always ≥ 7 — and
is defensive depth only.

### 3. Scout for a linked player

Deferred deliberately. A linked player sees their own dashboard; scouting an
arbitrary opponent is a separate grant and `006` was written with that hook in
mind. Decide whether a player gets it at all before building it.

### 4. Web push (13b)

Untouched. Needs a service worker this site deliberately lacks, so it is a
real architectural decision rather than a feature.

### 5. Four faults found reading Coach Assist end to end (2026-10-02) — NOT fixed

None was asked for; each is a real behaviour, read off the code.

- ~~**The opponent's rank and percentage can disagree.**~~ **Fixed 2026-10-07
  on the read's path**: `duel_read` orders its rows by the probability it
  prints. The count (now the fallback) still has it.
- ~~**Native duel game order is unused for prediction.**~~ **Fixed
  2026-10-07.** A native row's blocks are in game order (15,578 of 15,578
  sides against the stored rounds), `coach._history` reads every series'
  opener, and the duel read uses the position, what followed a reveal and
  the per-game results from the duel index.
- **"Switch a card" targets are not vetted.** `deck_tuner.compose` draws
  from the vetted seeds; `rank` draws from every sibling in
  `pair_matchup_agg`, guarded only by the 60-game `thin` flag. A one-pilot
  or event list can be a swap target.
- **The accuracy line on the screen is a constant.** `coach.
  COMBINED_MEASURED` (59.0% vs 39.4% on 2,500 choices) is hardcoded, not
  re-measured when the model retrains, and its own comment says the old
  brain's tables included the test games.

Also noted: the combined brain's pilot-strength term is the same for every
one of a player's options against one opponent, so it moves the printed win
chance and almost never the ORDER; the card-level term is what re-orders.

## Rules this work must not break

- **A built deck is CONSTRUCTED from how duel players build, never a real
  deck with one card swapped in.** `deck_architect` reads every duel list
  holding the card, keeps a shell's core and chooses only the open slots.
  The substitution path shipped once and was rejected the same day.
- **Duel-proven lists lead.** Half the duel lists the combined brain rates
  are simply the most duel-played, and a list under 30 duel games ranks
  after every proven one.
- **No prose in "Build around your cards".** One step line, three bare
  headings, figures. A test bans the removed strings.

- **`my_coach_players()` does not return `notes`.** See task 1.
- **`is_coach` / `linked_user_id` are read as `=== true` / non-null, never
  truthy-checked.** Both are absent on an older database and **nobody may gain
  access by a column failing to arrive.**
- **Never mount `CardLibrary` / `CardGrid` / `useFilteredCards` outside the
  builder** — they write `useBuilderStore` and would mutate the account's real
  saved decks.
- **Every battle figure comes from `coach_intel`.** `/api/analytics/counter/`
  has NO mode filter (872 battles where `coach_intel` reports 710) and
  `/cards/` is only safe at `mode=ranked`.
- The roster screen reads no analytics API except behind a button.
- No score, no readiness, no grade — counts, fractions and measured rates.
- **Every evidence floor is named in one place.** `DECK_RATE_FLOOR` /
  `H2H_FLOOR` in `coachScout`, `FLOORS` in `coachInsights`, `DASH` in
  `coachDashboard`. A screen may not write a floor's value out again; a
  tripwire in `tests/coachScout.test.ts` sweeps for `battles >= <digit>`.
- **`drawnDeck` wherever an ENGINE deck is drawn**, `positionalArt` only where
  the order is trusted. A raw `art?.[c]` lookup fails silently — it draws an
  evolution, a hero or a champion as a plain card.
- **Do not key anything on a deck name.** `deckName` is generated and collides:
  measured on one real player, 20 of 49 names covered more than one distinct
  8-card list.
- **A deck somebody is told to play is drawn by `clash_data.complete_seating`**
  (every special slot its cards can fill); **a deck somebody PLAYED is drawn as
  fielded.** Opponents and threats are records, not advice. Coach Assist's
  tuner rows joined on 2026-09-27; there is no exception left.
- **`team_scout.score`'s `rate_for_threat` stays optional.** Team Analysis
  passes the fused rate; `coach_daily` passes nothing, and that is what keeps
  its 204 checks meaning what they meant.

## There is no snapshot table, and the three reasons will apply again

`coach_player_snapshot` — one row a day off a nightly timer — was the plan and
was **dropped**. `progress()` recomputes instead.

1. **Nothing would have written it.** The analytics service holds the Supabase
   **anon** key. Writing coach-owned rows needs the **service-role** key,
   which bypasses RLS on every table — on the same box as the bot and a 33 GB
   database that had no backup then (a daily one exists since 2026-09-29). A daily figure is not worth that blast
   radius.
2. **A snapshot only holds the days somebody looked.** Recomputation holds
   every day the battles do, and answers for history that **predates the
   feature**.
3. **A stored rate can drift from its own window.** Recomputing from the rows
   IS the window.

What a snapshot really buys is what the engine **recommended** on a given day.
The engines move, so that cannot be recovered later — different table, if ever.

## Traps that cost time in recent sessions

- **A variance census beats reading the code.** Walk every leaf path of a real
  payload across several players and count distinct values: a field that never
  varies is decoration. It found two floors written out as bare literals that
  no test would have caught.
- **Prove a tripwire fails.** Re-introduce the thing it bans and watch it go
  red. A check that cannot fail is worse than a missing one.
- **Assert declared SQL types against the real table, not just the grammar.**
  `pglast` parsed a function clean that Postgres rejected: `cards` is `text[]`
  not jsonb, `comfort` is `smallint` not integer.
- **The Supabase SQL editor runs a whole script in ONE transaction** — a
  failure at statement 9 rolls back statement 1.
- **Write commit messages to a file or a heredoc.** Backticks in a `-m "..."`
  argument are shell-expanded and leave holes in the message.
- **Verify seating from the image URL, not the prop.** `getCardIconUrl`
  resolves to `assets/{cards,evolutions,heroes}/`, so the DIRECTORY in the
  `src` IS the form that rendered. A `variant` that never reaches an `<img>`
  passes a prop check and fails this one.
- **A hash-only `page.goto` is a fragment navigation**: set the hash, then
  `reload()`, or every selector reads zero and reports zeros as passes.
- **The auth screen is `#/signin`, not the root.** Waiting for
  `input[type="email"]` on `/` times out, and the script then reports "already
  signed in" while anonymous.
- **The coach tab's section is `practise`**, though the component is
  `TodayTab.tsx`.
- **`innerText` returns nothing on SVG.** Use `textContent`.
- **`[class*=deckItem]` also matches `deckItemHead`** — counts double.
- **Group element tops with a tolerance.** Children on one line sit at 1480 /
  1481 / 1478; a Set of rounded tops calls that three lines.
- **Chrome serialises `color-mix` as `color(srgb r g b / a)`**, not `rgba(...)`.
- **Set the theme BEFORE navigating**, then assert `data-theme`.
- Verifying signed-in claims a device slot: seed
  `localStorage['dekkies-device-kind'] = 'mobile'` so the desktop session
  survives.
- **A scratchpad file may shadow a stdlib module.** A `types.py` there made
  `import re` re-execute a patch script and double-apply it.
- **A fresh Python process has no meta board**, so `deck_counter.seater()`
  seats by capability and fills every slot — an audit run that way found no
  seating fault that production (board marks) really had. Load
  `meta._load_snapshot()` or audit the live API.
- **A script's own directory leads `sys.path`.** A comparison script kept
  beside staged modules imported them even with `PYTHONPATH` at production, so
  the "before" run was the new code. Keep baselines in a directory holding only
  the script, and print `module.__file__`.
- **A staged `deck_counter.py` looks for `.counter_snapshot.json` beside
  itself** — copy it in, or a staged build silently has no seeds.
- **Source `/etc/royalweb.env` for VPS experiments.** Without it the cluster
  index refuses to answer (it serves only the database it was built from) and a
  cluster-based experiment measures nothing, identically at every setting.
