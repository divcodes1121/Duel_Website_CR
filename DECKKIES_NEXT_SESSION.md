# NEXT SESSION — Coach Roster

Everything below is live and verified unless it says otherwise. `CLAUDE.md`
carries the full reasoning; this is the short version plus what to do next.

> **Rewritten 2026-09-25.** The previous version's three tasks — run migration
> 007, build the link-account control, build the player dashboard — are all
> **done and live**, and its "obvious next engine change" (wiring meta trends
> into the field plan) is built. Its "needs a nightly
> `coach_player_snapshot`" is **superseded**: progress over time ships by
> RECOMPUTATION and that table was deliberately dropped. See below.

## Where things stand

| | |
|---|---|
| Coach tabs | **6**: Overview · Against the field · Arsenal · Opponent · Battles · Decks played |
| Reached from | **the top bar**, pro-gated like any other paid area; a small back control returns to the roster from a player |
| Migration 006 | **APPLIED and READ.** `linked_user_id` + 4 functions — `#/my` is built on it |
| Migration 007 | **APPLIED.** `is_coach` + `admin_set_coach` + `admin_list_users` v2; coach is a per-account flag, not a role |
| Linked today | CAPTAIN FROZE and the account holder's own admin email |
| Player's own screen | **`#/my`**, visible in the top bar and profile menu only when the account is on somebody's roster |
| Tests | **951 vitest** (32 files), **3,015 Python checks** across 53 suites (one known failure, `test_ml_21a`), route count **24** — counted 2026-09-25 evening |

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

### 1. Prove the "notes are hidden" property for real

`my_coach_players()` deliberately does not select `notes` — they are written
about a player expecting they are not reading them. **The check for this has
only ever passed vacuously** (no linked rows existed, so no columns to
inspect). Two accounts are linked now, so it is provable: write a note on a
linked player as the coach, then read `my_coach_players()` as that player and
assert the column is absent. It is not a UI choice a screen may reverse, so it
deserves a real assertion.

### 2. The trend switches on 2026-09-30 — look at it then

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

## Rules this work must not break

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

## There is no snapshot table, and the three reasons will apply again

`coach_player_snapshot` — one row a day off a nightly timer — was the plan and
was **dropped**. `progress()` recomputes instead.

1. **Nothing would have written it.** The analytics service holds the Supabase
   **anon** key. Writing coach-owned rows needs the **service-role** key,
   which bypasses RLS on every table — on the same box as the bot and a 33 GB
   database that still has no backup. A daily figure is not worth that blast
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
