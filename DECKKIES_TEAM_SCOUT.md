# Team Scout — the coaching brain

**Status: LIVE (2026-09-21).** Server scp'd first (backups
`team_analysis.py.bak-20260921-prescout` and `-prelabel`), frontend deployed as
`a370e30`. Verified after: `/api/analytics/status` reports `cardData` 123, the
live `/teams` route answers `brain: team-scout-2.0` with a 12-entry projection
in **1.84 s mean / 2.7 s max** across 30 opponents, and the served
`TeamAnalysis` chunk carries every new string.

**Brain 2.1 LIVE since 2026-09-25 (`c23abdb`):** a match plan's per-teammate
lists are chosen as a squad — different #1s inside a 3-point band, covering the
opponent's archetypes, leaning on each teammate's own cards. See §4f.

`server/team_scout.py` + `server/test_team_scout.py` (**155** checks, no
database), wired through `server/team_analysis.py`. Brain version
**`team-scout-2.1`** (was 2.0 until 2026-09-25), published on every report.

---

## 1. What was wrong

The screen behind `#/teams` and the Coach Roster's *What to play* tab ranked
decks against `team_analysis._spread()` — the opponent's archetype shares, by
raw game count, over their top six decks, with anything under two games dropped.

That is a *history*, not a *projection*, and three things followed from it:

1. **No recency.** `lastSeen` was carried on every deck row and read by nothing.
   A deck abandoned in week one weighed exactly as much as the one they played
   yesterday.

2. **Truncation inverted the confidence.** Dropping the tail and renormalising
   hands the dropped mass **back to the decks they play most**. The less
   evidence there was, the more concentrated the model became — backwards, and
   the opposite of what a coach does with a thin scouting report.

3. **The projection *was* the history.** There was no term for a deck they had
   not already played, so every recommendation was optimised against exactly the
   decks in the log. The scorer was not wrong; it was answering the question it
   was given.

And the scouting pool was **one deck per archetype** (`_representatives()`,
seventeen in total), so "top 5" was five archetypes wearing deck art. With one
candidate per archetype there is no such thing as a variant, a second opinion
inside an archetype, or a portfolio.

## 2. What it is now

Two coupled outputs from one brain, and **they are two lists on purpose**:

```
folders[].threats[]          THEIR projected pool. likelihoods sum to 1.0.
folders[].recommended[]      OUR decks. 5–7, diversified, each typed.
```

A recommendation cannot carry `opponent_likelihood`, because a recommendation is
our deck and the opponent is not going to play it. Collapsing the two would mean
a `COUNTER` row publishing a probability that the opponent plays our own deck,
which is not a quantity.

```
opponent decks (+ lastSeen)
        │
        ├─ churn()          concentration of their play  ->  switch
        │
        ▼
   threat_space()
   ├ OBSERVED   recency-weighted, WHOLE TAIL KEPT, share of (1 - switch)
   ├ VARIANT    seeds of the same archetype sharing 6–7 of 8 cards
   └ INFERRED   seeds of archetypes they play, then the population's own
        = a distribution summing to 1.0, every entry labelled
        │
        ▼
   score()  per candidate, against the WHOLE distribution
        matchupValue · threatCovered · evidenceStrength · playerFit
        │
        ▼
   diversify()  redundancy penalty + archetype occupancy cost
        │
        ▼
   5–7 recommendations, typed COUNTER / ROBUST / CONTINGENCY
```

### The mass split

| | |
|---|---|
| `observed_mass` | `1 - switch` |
| `variant_mass` | `switch × VARIANT_SHARE` (0.65) |
| `inferred_mass` | `switch × (1 - VARIANT_SHARE)` |

`SWITCH_MAX` is **0.45**, so observed always holds the majority. That ceiling is
not taste: thirteen phases of this project's own research found *"Recent is
undefeated as THE prediction"* at 0.9678 / 0.8710 Jaccard, and every attempt to
let a model overrule the player's current deck lost (Phases 4, 5, 6, 7). A brain
free to move most of the mass off what they actually play would be reopening a
question that was closed with evidence.

`VARIANT_SHARE` is 0.65 for the matching reason from the other side:
`ml/candidates.py` measured one-card variants containing the true next deck
**89–94%** of the time, with two-card generation as the structural gap. When
somebody deviates, a tweak is likelier than a new archetype.

`SWITCH_MIN` is **0.15** and not zero. At zero this degrades exactly into the
old `_spread` — every recommendation optimised against the log and nothing else.

### Thin evidence widens, it does not sharpen

`churn()` measures `1 - Σ share²` (the complement of the Herfindahl index) over
their decks, then **shrinks it toward a deliberately HIGH prior** by how much
evidence there is. Measured on a real opponent's deck, one list, varying games:

| games on one deck | switch | observed mass | evidence |
|---:|---:|---:|---|
| 2 | 0.450 | 0.777 | thin |
| 6 | 0.450 | 0.777 | thin |
| 20 | 0.330 | 0.853 | thin |
| 60 | 0.183 | 0.927 | measured |
| 400 | 0.150 | 0.942 | measured |

This is the direct inversion of fault #2 above, and `test_team_scout.py` pins
the direction by name. **If that test ever passes the other way the redesign has
been undone.**

## 3. Variants come from the seed pool, not from a sibling scan

`deck_tuner.neighbours()` is the better variant finder in every way but one: it
is a full sibling scan, estimated ~2.6 s, and this screen resolves up to ten
opponents. Expanding two decks each is twenty scans — about a minute added to a
route that answers in 1.5 s warm. **Not shippable on the request path**, and the
cap is the reason this module exists in a form that can run in production.

`deck_counter.seeds()` is already in the snapshot: forty real decks per
archetype, each with ≥60 games and its own per-archetype matchup record, at
**zero database cost per request**. A seed of the same archetype sharing six or
seven of eight cards with an observed deck *is* a real variant of it, held by
real players, with a real record.

What is given up: a rare variant nobody else plays will not be found. That is
the right thing to give up — this module must never invent a deck, and a
configuration forty popular lists do not contain is not one a coach should be
told to prepare for over the ones they do.

`neighbours()` remains available for an opt-in deep path. It is deliberately not
called from here.

The same reasoning widened the scouting pool: `_scout_candidates()` now draws
`SCOUT_SEEDS_PER_ARCHETYPE` (12) per archetype — ~200 real lists instead of 17 —
through `_SeedProfile`, which reads the snapshot's own records rather than
`_DeckProfile`'s three queries. Six hundred reads would have thrashed a cluster
cache that holds 32 entries and clears itself whole on overflow. The
representatives are still first in the list (`_build_seeds` sorts by games), and
the old path survives as a fallback for a snapshot that predates the seed pool.

## 4. The score is a decomposition, and every term is published

```python
recommendation_score = matchupValue
                     - COVERAGE_WEIGHT * (1 - threatCovered)     # 4.0
                     + FIT_WEIGHT      * playerFit               # 1.5
                     - EVIDENCE_WEIGHT * (1 - evidenceStrength)  # 2.0
```

`test_team_analysis.py` rebuilds this identity from the published fields and
checks it to the floating-point bit. **No term may enter the ranking without
appearing in the payload beside it.**

`FIT_WEIGHT` is `team_analysis.COMFORT_WEIGHT` unchanged — the quantity has not
changed and neither has the claim it makes, so it must not quietly gain weight
in a commit about something else.

`evidenceStrength` maps the ladder rung: exact 1.0, deck 0.85, cluster7 0.60,
cluster6 0.45, archetype 0.25. An unrecognised source scores as the weakest, so
a new rung added upstream makes this cautious rather than breaking the request.

### `score()` HAS A SECOND CONSUMER NOW, AND A SIGNATURE CHANGE WOULD BREAK IT SILENTLY

**`server/coach_daily.py` — the Coach Roster's "Against the field" tab and the
linked player's own `#/my` — calls `team_scout.score()` directly.** It was
added on 2026-09-23 and is the only other caller.

It works *because* `score(rate_for, threats, *, cards, archetype, fit_games)`
takes **the threat space as an injected parameter** and does not know where it
came from. Team Analysis builds `threats` from one opponent's real decks;
`coach_daily` builds the same shape from the **meta board**, reweighted by
where a player measurably loses. So a field projection gets this exact
arithmetic — the four separated signals, the coverage penalty, the evidence
weighting — with **no second scorer**, which is what stops a roster screen and
the public board disagreeing about the same deck.

What that costs whoever edits this file:

- **Changing the signature or the meaning of a term changes two products.**
  `test_team_analysis.py` rebuilds the identity above, but it does not know
  `coach_daily` exists; `test_coach_daily.py` (204 checks, no database) is the
  other half and must be run too.
- **`fit_games=None` is a legitimate call.** The coach's pool is *ownerless* —
  204 real meta decks belonging to nobody — so `playerFit` is null and
  `redundancy` zero on that path. They are not dead fields; they carry real
  values here, where decks have owners. Do not "clean them up" on the evidence
  of the coach payload alone.
- **`diversify()` is NOT used by the coach**, deliberately. Its
  `ARCHETYPE_REPEAT_PENALTY` is a *portfolio* rule — right for choosing five
  decks to cover a match, wrong for one player's plan, where it collapsed 204
  decks to "the best deck of each of seven" and produced the same list for
  everybody. The coach groups by win condition instead, so the spread is
  structural rather than enforced by a penalty.
- **No `ml` import, on either path.** A test asserts it.

## 4b. A short per-teammate board is topped up, the way Coach Assist does

`coach._fills` has answered this since Coach Assist was written: when a
player's own history cannot fill the candidate list, top up from the
population, **mark what was added**, and never displace one of their own.
`opponent_next` does the same on the other side, keeping `OPP_HISTORY_MASS`
(0.7) of the probability on what they have actually shown.

Team Scout's per-teammate board had no equivalent. A teammate with two
qualifying decks got a two-row board; one with none got a bare `reason`. That
reads as the tool having nothing to say about that person, rather than as that
person having nothing stored.

**This reopens something this module's own docstring argued**, and the
resolution is worth stating rather than burying. The docstring says the pool is
"exactly the decks the blue squad has ALREADY PLAYED", because a recommendation
nobody can pilot is worth nothing on the day. That is still right about
**ranking** and wrong about an **empty board**. So:

- fills are **appended, never ranked in** — an owned deck always comes first,
  even when the fill scores higher (measured live: a teammate's own best was
  67.7% and the two fills behind it were 71.7% and 71.3%);
- every fill carries `fill: true`, and the screen says "Nobody on your squad
  plays this yet" rather than the scouting report's "Most-played list of this
  archetype" — *nobody plays this* and *nobody on YOUR SQUAD plays this* are
  different claims;
- the `reason` still ships, because "why none of these are theirs" is a
  different fact from "there are no rows";
- the skip is **hard, not a penalty**: `SAME_DECK_OVERLAP = 6`, mirroring
  `duel_zone.COUNTER_MIN_OVERLAP`, which `!counter`, the clusterer, the duel
  matcher and `coach._fills` all already use. `diversify` grades similarity
  because it is choosing among options that all deserve to be there; this is
  choosing filler, and filler that is a near-copy of a real recommendation
  shows the same deck twice with one of them labelled a guess.

The fill pool is scored **once per folder and only when somebody is short** — a
fill is not owner-specific, so one ranked list serves every teammate who needs
one, and on a healthy roster it is never built at all.

**A bug the test caught before deploy:** the pool was gated on `seeds`, which
is the *threat projection's* source. The fill *candidates* come from
`_scout_candidates()`, which falls back to the archetype representatives when
the snapshot predates the seed pool — so the gate silently switched fills off
on exactly the deployment that needs them most.

## 4c. What Deckkies Suggests To Play — ranked together, seven, everywhere (2026-09-21)

**§4b above described Coach Assist wrongly, and this section corrects it.** It
said `coach._fills` keeps population decks *below* every owned one. It does not:
`coach.suggest` builds the list from the player's own legal decks, tops it up
from the population, and then **sorts the combined list by expected win rate**.
The appended-below rule was mine. On a live squad it held a player's own 60.0%
deck above two 71.7% / 71.3% answers, and the account holder asked for the
stronger decks to lead.

`team_scout.suggest(own, pool)` is that sort. **Their own decks keep a real
edge**, and it is the one already in the scorer: `FIT_WEIGHT × playerFit`, up to
1.5 points, is added to a deck they pilot. So a population deck has to be
*genuinely* better to pass one of theirs, not merely level. Near-copies of their
own decks (six shared cards) are still refused, keeping the version they play.

Measured live, same squad against the same opponent, before and after:

| | top of the list before | after |
|---|---:|---:|
| Xethol | 67.7% (own) | **71.7%** (Deckkies pick) — own 67.7% at #3 |
| Doralalala | 56.8% (own) | **71.7%** (Deckkies pick) — own decks all outranked |

**Outranked is not absent.** Doralalala's five decks were scored and all lost.
The first copy for "none of these are theirs" said "nothing could be ranked",
which was false. `reason` is null in that case, and the screen now says "their
own 5 decks all score below these".

**Seven everywhere.** `MIN_RECOMMENDATIONS = MAX_RECOMMENDATIONS = 7` and
`PER_PLAYER_TOP_N = 7`. The Coach Roster's What-to-play reads `perPlayer[0]`, so
this is the number a coach sees there. `PORTFOLIO_DROP` keeps its meaning for a
caller that passes a lower `minimum`, and no production caller does now.

**"What Deckkies Suggest To Play"** is one highlighted heading
(`SuggestHeading.tsx`: a violet bar over a 12% tint, with the text left at full
ink) on both Team Analysis and the Coach Roster.

**The Coach Roster got Coach Assist's other half.** Coach Assist shows what the
opponent will bring beside what to play; the roster tab showed only the second
half. `Threats.tsx` moved into its own component and CSS module so both screens
draw the same projection.

**A frozen match plan records a pick as a pick** (`PlanCandidate.fill`,
`candidateLabel`). Phase 7 reads results against the snapshot, and a win on a
deck the player had never played is different evidence from a win on one of
theirs. It rides in the existing jsonb, so there is no migration.

### Two faults found on the way, one of them mine from earlier the same day

- **A literal backspace in a test regex.** `tests/coachAssist.test.ts`' "never
  claims an unmeasured tendency" had its two `\b` escapes turned into two literal `0x08` characters
  by a heredoc edit in `a370e30`. So it could match nothing and had passed
  vacuously since. Repaired, and `src/`, `tests/` and `server/` were swept for
  other control characters (none).
- **`diversify` wrote onto its callers' rows.** A teammate's list and the
  squad-wide list share scored dicts, so whichever portfolio was built last
  overwrote the other's published `redundancy`. It works on shallow copies now.

### Browser pass: 25 of 25

Against the live API, at 1440, in dark mode:

- the six day chips, the run sending `days=45`, the heading's bar and tint;
- seven on every list, with every row saying whose it is;
- a pick leading the collapsed row;
- the roster's 7-chip window, projection and marked picks;
- Recent Battles' presets.

Screenshots caught three things the checks did not, all fixed:

- the roster-wide suggestions had wrapped into the narrow left column under a
  tall gap;
- "1 of these are";
- a sub-1% share printing as "0%" beside an observed deck.

## 4d. Less on screen, saves that fit, saves on every device (2026-09-21, `556d007`)

Three requests arrived in one message:

1. Remove the "Robust / known / Holds up against Royal Hogs … measured against
   100% of their projected pool" line.
2. Fix "This board is too large to store in the browser".
3. Make saved analyses visible on a phone.

The same message asked for no other explanatory text anywhere.

**The prose is gone from both screens.** Team Analysis and the Coach Roster's
What-to-play tab no longer print any of these:

- a recommendation's type, confidence, explanation or coverage sentence;
- the roster lede;
- the "Ranked from N real decks" and "Tap a player" paragraphs;
- the threat reason lines, the confidence words and the churn note;
- the heading subtitles;
- the fill banner or the window sub-line.

A fill now says just **Deckkies pick**. Empty states and warnings are one short
sentence each. A threat row is share, name and kind. The kind badge stays,
because it is what keeps a generated deck from reading as an observed one.

The fields are still on the payload. The PDF still prints coverage, and the
frozen match plan still records the type. `tests/coachAssist.test.ts` pins that
neither screen prints them. This settles the old §11 question — type and
confidence were near-constant anyway.

**"Too large" was the per-threat `matchups` table.** It was repeated on every
recommendation: ~4 kB each, 80% of a match plan. Only the PDF reads it, and only
on each folder's top pick. Two changes follow from that:

- **The server** now sends the table on the top pick only
  (`_evidence_on_top`). Measured live, a 5v5 plan went from **1.08 MB to
  257 kB**, with the table still on all 5 top picks and on none of the other
  175 decks.
- **`compactReport`** applies the same rule at save time. It also drops the
  per-row `explanation` and `brain`. So a board from an older server saves just
  as small, and a 10v10 board stores in ~0.7 MB where it was ~4.6 MB.

**The phone list was fine — it was empty.** Saves never left the browser that
made them. They now sync through `/api/decks?doc=team-saves`:

- One Upstash record per save, plus a hash index. Twelve boards do not fit the
  deck blob's 1 MB cap, and `HSET`/`HDEL` touch one field each, so two devices
  cannot overwrite each other's index entry.
- Local storage is a cache. A save made elsewhere arrives as a stub (name, date,
  counts) and its report is fetched on open.
- `synced` tells "deleted on another device" from "never uploaded". Deletes made
  offline are kept in `royal-team-saves-deleted` and retried.
- The section is shown even when empty ("None yet.").

The rules are in `teamSaveRules.ts` (no imports). The route is
`teamSaveRoute()` over a six-method KV interface, so the whole contract is
tested in memory: `tests/teamSaves.test.ts`, 31 checks. Those include user
isolation, the 12 cap, the id pattern, 413, and "stores only a save's own
fields".

**Checked:** vitest 727 across 30 files. Browser 35/35 at 1440 and 390, both
themes, replaying real captures; the What-to-play tab was mounted through the
harness. Live, both `/api/decks?doc=team-saves` requests are refused 401 — with
no token, and with a forged one — so the function loads. **The signed-in path is
not checkable from this machine** (no session here). Saving on the desktop and
opening it on the phone is the account holder's smoke test.

**Seen while measuring, NOT caused by this change and NOT fixed here.** A 5v5
where the same five players are on both sides took **150+ s warm**. 1v1 warm is
**1.25 s**, which matches the old baseline. Ten players' deck profiles overflow
`_CLUSTER_CACHE` (32 entries, cleared whole on overflow), so a board that size
reads cold every time. One of three such requests dropped the connection at
~129 s.

## 4f. The squad plan — a different #1 for every teammate (2026-09-25, brain 2.1)

Reported: "the match plan has very similar decks suggested for all the home
players against a single away player … suggest for different players
differently, and cover all or almost all of the opponent's archetypes".

**Measured before touching anything**, live 5v1: one #1 for all five, two
identical lists of seven, 12 distinct decks in 35 slots. Every teammate's list
was `suggest(own, pool)` over the SAME scored population pool, and `FIT_WEIGHT`
(1.5) is all an owned deck gets against it.

`squad_plan(players, pool, threats)` replaces the per-teammate call in
`_folder` (the old call is the exception fallback):

- **`PRIMARY_BAND` = 3.0.** A #1 is chosen only from decks within three points
  of that teammate's best. Inside it the matchup figures (likelihood-weighted
  means of records whose own intervals run several points) cannot rank the
  options, so something else may decide. Well inside `PORTFOLIO_DROP` (8).
- **Greedy assignment.** value = personal score + `cover_gain` over the #1s
  already assigned (per ARCHETYPE, likelihood-weighted, from `ANSWERED` = 50,
  only where better — `coach_daily.coverage_gain`'s rule). Fresh decks first;
  a duplicate #1 only when the band holds nothing else.
- **No coverage term for the first #1.** With nothing held, the gain is the
  deck's whole edge over 50% — the matchup counted twice. A test caught it
  outvoting an owned deck.
- **`KNOWN_WEIGHT` = `FIT_WEIGHT`, floor `KNOWN_MIN` = 5**, restated from
  `coach_daily` (no imports here). Card pool = decks with `MIN_COMFORT_GAMES`.
- **Tails:** `diversify(score_key="personalScore", bonus=…, first=#1)`. Bonus =
  coverage the list lacks − `TAKEN_PENALTY` (2.5, someone else's #1) −
  `SHARED_PENALTY` (1 per earlier teammate listing it, capped at 2.5). Read
  back sorted by personal score under the #1.

**The #1s alone were not enough**, and the second measurement is why the spread
rule exists: with them, lists still shared 4.70 of 7 per pair. With it, 3.32.

| 11 real folders, 54 lists | before | #1s only | shipped |
|---|---|---|---|
| every #1 distinct | 0/11 | 8/11 | 8/11 |
| distinct decks / 378 | 117 | 148 | 191 |
| in every list | 53 | 36 | 21 |
| shared per pair (of 7) | 5.69 | 4.70 | 3.32 |
| archetypes answered by #1s | 56/57 | 57/57 | 57/57 |
| mean #1 rate | 68.43 | 67.72 | 67.72 |
| mean slot rate | 64.14 | — | 63.78 |

**The first measurement run was stopped** — picking busy squads with a
`GROUP BY` over 30 days of `battles` is a full scan of the 33 GB file on the
spinning volume; two copies ran 16 minutes against the bot's own writes. The
harness reads `player_stats_agg` (one row a player, 0.19 s) instead.

Tests: `property_squad_plan` (24 checks, including a spread check that went red
with `SHARED_PENALTY = 0`, and a first draft of it that passed vacuously — the
filter matched no teammate). Browser 52/52.

## 4e. Twelve a side, and the timing fixed at the root (2026-09-21)

Asked for: rosters of 10–12 (the cap was 10), and "fix the timing issue, it
takes too long … for future scope emerging problems also".

**MEASURED FIRST, phase by phase, on the VPS against the real database.** A 5v5
took **208 s** cold, and **168 s "warm"** in the same process.
`deck_counter._cluster_all` was **97%** of it: ~5.6 s for each of the 36
distinct blue decks, one after another. It had two halves:

1. **The sibling scan.** A pure-Python walk over every stored deck hash, 2.2 s a
   deck. The vocabulary is **2,772,680** hashes; the comment beside the scan
   said 1,054,394.
2. **The join.** ~100,000 `pair_matchup_agg` rows a deck, each a random page read
   into a 55 GB file (the covering indexes lack draws and crowns). ~80 µs a row:
   3 s warm, 13–20 s cold.

"Warm" was cold because the cluster cache held 32 entries and **cleared whole**
on overflow, and 36 decks need 72. Threads only bought **2.9×** on the join,
because it is I/O, not CPU. 12v12 projected at ~9 minutes.

**The fix is structural, not a cache** (`server/cluster_index.py`). Each deck's
record per opponent archetype is summed ONCE, off the request path, into the
service's own SQLite file:

- `deck_arch`, ~5.1M rows, built by `royalweb-cluster.timer` every 4 h (~6 min,
  80 MB peak);
- plus card bitsets, so "shares 6 of 8 cards" is an OR of ANDs on big integers:
  22 ms instead of 2.2 s.

The bot's database is ATTACHed `mode=ro`.

- **It is exact, not approximate.** On 12 real decks it matched the live path
  with zero difference in sibling counts, games or win rates.
  `test_cluster_index.py` (64 checks) pins that on a synthetic database with a
  negative control, and checks the query plan. A plain `JOIN` there scanned
  5.1M rows (870 ms a deck); `CROSS JOIN` seeks by key (14 ms). No equality
  check can see that difference.
- **It is never required.** Missing, unreadable, or built from another database
  (`meta.source`), and every consumer falls back to the live path. A deck newer
  than the build reads live too.
- **Its age is published** as `clusterIndex` on `/api/analytics/status`.

**Then the parts that were hiding behind it:**

- **Player resolution in parallel.** 24 cold players took 180 s serially and
  4.7 s on 8 threads. One process-wide pool (`CLASH_TEAM_THREADS`, 8), so two
  big rosters at once do not take 16 threads from the other screens.
- **Deck profiles in parallel**, and exact profiles from the index.
- **The ranking.** `diversify` carries each candidate's closest similarity
  forward instead of recomputing it against the whole list every round, and
  `fills` spots near-copies by shared six-card subset. That is 310,000
  similarity calls and 1.4M intersections a 12v12, gone. The original bodies
  are oracles in `test_team_scout.py`: identical on 1,500 random pools each.
- **Caches are LRUs with a lifetime**, not dicts that clear themselves.

| through the staged engine, real database | before | fresh process | repeat |
|---|---:|---:|---:|
| 5v5 | 208 s | **4.6 s** | **0.5 s** |
| 12v12, 24 real tracked players | ~9 min | **3.0 s** | **1.7 s** |

A 12v12 of players whose history is not in the page cache adds ~5 s of
per-player reads.

**LIVE as `080540f`.** The server was scp'd first (backups
`*.bak-20260921-161306-preindex`). The first index build ran through the real
unit: `Result=success`, 387 s, 0 orphan rows. Measured in production after:

| request | before | after |
|---|---:|---:|
| 5v5 through `api.deckkies.com`, first / repeat | 166 s / 152 s | **6.6 s / 3.0 s** |
| 12v12 of players nobody had read today, first / repeat | — | **4.0 s / 1.3 s** |
| 12-player scouting report | — | **1.1 s** |
| 1v1 (the Coach Roster's What-to-play) | 1.25 s | **0.1 s** |

**Before deploying**, the same 5v5 was run through the staged engine with the
index and then with it hidden: **30/30 lists in identical order, 210 rows,
zero win-rate difference**, in 10.9 s against 297 s.

**A 12v12 report is ~1 MB, so the Team Analysis save sync now gzips it.**
Compacted it is 858 kB, 14% under the endpoint's 1 MB request cap, and any
added field would have tipped it over — at which point a save stays on the
device that made it. Gzipped it is ~56 kB. `src/utils/gzipText.ts` uses the
browser's `CompressionStream`; `api/decks.ts` inflates with `node:zlib`
(capped at 16 MB of output, so a zip bomb is refused) and stores it
compressed. Plain saves, including the ones synced this morning, still work.

**`MAX_SQUAD = 12`** on both halves. Each side's test now reads the OTHER side's
constant out of its source file instead of pinning a literal, so the two cannot
drift apart again. The vitest fixture that built tags from a 12-character slice
of the alphabet (so "13 players" was 12) was fixed on the way.

## 5. Diversity — and the defect the case review found

Greedy MMR with a superlinear card-overlap similarity, **plus an archetype
occupancy cost**. The second half was not in the design; it came out of
reviewing thirty real opponents.

Pairwise similarity alone does not catch same-archetype repetition. Two Royal
Hogs lists sharing three of eight cards score 0.34 on `similarity` — a 2.0-point
penalty — so when the pool was thin, **three of them took three of seven slots.**
Every pair was genuinely dissimilar in cards and the list was still three
answers to one plan, which is the exact failure §14 of the brief names.

`ARCHETYPE_REPEAT_PENALTY` is 2.5 points for each deck of that archetype already
chosen. It is an **occupancy cost, not a cap**: a defensive Hog list and a cycle
Hog list really are different preparations, and there are opponents where the
two best answers honestly share an archetype. A genuine matchup edge can still
buy the slot; nothing else can.

Measured on the thirty cases, before and after:

| | before the fix | after |
|---|---:|---:|
| distinct archetypes per list | 4.47 | **6.50** |
| pairwise diversity | 0.937 | **0.983** |

## 6. Evaluation — 30 real production opponents

Captured live from `api.deckkies.com`: thirty real opponents with real deck
histories, plus the **old brain's own live answer** for each, so the comparison
is against what production actually returns rather than a reimplementation.

| metric | OLD | NEW |
|---|---:|---:|
| recommendations per opponent | 5.00 | **7.00** |
| distinct archetypes in the list | 5.00 | **6.50** |
| pairwise diversity of the list | 0.973 | **0.983** |
| opponent decks modelled | 8.43 | **11.07** |
| mass on observed | 1.000 | 0.714 |
| mass on variants | 0.000 | 0.109 |
| mass on inferred | 0.000 | 0.177 |

**The old system's diversity was high for a reason that is not a virtue**: its
pool was one deck per archetype, so five recommendations were five archetypes by
construction and diversity could not be lost. The new pool has multiple decks
per archetype and therefore *can* repeat itself — which is why the occupancy
cost above had to exist, and why beating 0.973 with a richer pool is the
meaningful result rather than the raw number.

The §29 behavioural review, counted over the same thirty:

```
 0/30  every rec is a deck the opponent already used
11/30  meaningful variants present in the projection
30/30  plausible archetypes represented
22/30  a contingency candidate in the list
 0/30  list is excessively similar (diversity < 0.35)
 0/30  all mass on the most-played deck (frequency = preparation)
30/30  inferred rows distinguishable from observed
30/30  portfolio in the 5–7 band
30/30  projection sums to 1.0
30/30  confidence words all from the vocabulary
```

**Two caveats, both understatements rather than overstatements.**

The seed pool was **a stand-in**: `deck_counter.seeds()` lives in the server's
snapshot and no route exposes it, so the harness used the 50-deck production
meta board grouped by archetype. Every deck in it is real, but it is one
fourteenth the size of the live pool, which is why variants appear in only 11 of
30 cases. With the real 680-deck pool that number can only go up.

The matchup rate was **a deterministic surrogate**, because the archetype matrix
is not reachable offline. Nothing above quotes a win rate: every metric reported
is structural — composition, diversity, coverage, mass — which is exactly what a
surrogate can support and a fabricated rate cannot.

## 7. What is NOT done, and why

- **No model was trained.** §19 of the brief asks the question and the research
  already answers it: exact next-deck prediction never beat Recent (17B, 18);
  ranking archetypes inside a legal pool goes **negative at pool ≥5** (20B, 20C);
  spell-conditioning measured 0.000 [-0.001, 0.001] on 20,702 players (21A).
  The candidate-generation half is where the evidence *is* positive, and that is
  the half this implements.

- **The OIE is not called.** `ml/production/predictor.predict` is gated behind
  `CLASH_OIE` (off by default, `shadow` on the VPS), enforces the recent deck as
  primary, and withholds bands and alternatives on the `practice` domain. Team
  Scout imports none of it. The switch signal is counted from the opponent's own
  play instead — transparent, testable with no database, and with no dependency
  on a frozen research contract.

- **`recommendation_events` / `recommendation_outcomes` are not written.** They
  are the **bot's** tables (4 rows / 0 rows), and nothing in this repository
  reads or writes them. The memory that matters is already here:
  `coach_match_plans.recommendations` freezes every candidate and
  `coach_match_plans.engine` now carries `brain`, so phase 7's results can be
  read back against the brain that produced them rather than pooled across two
  different systems.

- **No migration and no index.** `brain` rides inside the existing `engine`
  jsonb. Route count stays **23**.

## 8. Deploying

**Server first, or every folder loses its projection.** The frontend tolerates a
server without the brain — `threats`, `type`, `confidence` and `brain` are all
optional and the screen falls back to drawing `spread` alone — but the reverse
gap is the visible one.

```bash
# 1. Has the VPS copy drifted?
ssh -i ~/.ssh/clashbot root@<host> 'md5sum /opt/royalweb/server/team_analysis.py'
git show HEAD:server/team_analysis.py | md5sum      # must match before overwriting

# 2. Back up what is being replaced.
ssh -i ~/.ssh/clashbot root@<host> \
  'cp -p /opt/royalweb/server/team_analysis.py /opt/royalweb/server/team_analysis.py.bak-$(date +%Y%m%d)-prescout'

# 3. Copy BOTH files, clear bytecode, restart.
scp -i ~/.ssh/clashbot server/team_scout.py server/team_analysis.py root@<host>:/opt/royalweb/server/
ssh -i ~/.ssh/clashbot root@<host> \
  'rm -rf /opt/royalweb/server/__pycache__ && systemctl restart royalweb'

# 4. Prove it came back AND that it can still read the card files.
curl -s https://api.deckkies.com/api/analytics/status | grep cardData
curl -s 'https://api.deckkies.com/api/analytics/teams?red=%23L8GVPJ900&days=90' \
  | python -c "import sys,json; d=json.load(sys.stdin); f=d['folders'][0]; \
print('brain', d.get('brain'), '| threats', len(f.get('threats') or []), \
'| recs', len(f['recommended']), '| mass', f.get('mass'))"
```

Step 4's second line is the one that says the brain is live: a server still on
the old code answers with no `brain`, no `threats`, and five recommendations.

`deck_harmony` is imported softly, so a deployment missing `cardRoles.json`
loses the variant veto and nothing else.

## 9. Files

| file | what |
|---|---|
| `server/team_scout.py` | **new.** The brain. No imports beyond the standard library |
| `server/test_team_scout.py` | **new.** 107 checks: the brief's 8 cases + 8 property sections |
| `server/team_analysis.py` | `_threats()`, `_SeedProfile`, `_score` delegates, `_folder`/`_combined`/`analyze` wired, `TOP_N` 3→7, `PER_PLAYER_TOP_N` 5, scout pool widened |
| `server/test_team_analysis.py` | 92 → 96. Three checks pinned the old scoring identity; they pin the new decomposition instead |
| `src/state/analyticsClient.ts` | `TeamThreat`, `TeamChurn`, `ThreatEvidence`, `ScoutConfidence`, `RecommendationType`; the separated signals on `TeamRecommendation`; `threats`/`churn`/`mass`/`brain` on `TeamFolder` |
| `src/components/Analytics/TeamAnalysis/TeamFolders.tsx` | the `Threats` block, type/confidence badges, the explanation line, **and a duplicate-React-key fix** |
| `src/components/Analytics/TeamAnalysis/TeamAnalysis.module.css` | the projection's styles |
| `src/state/coachAssist.ts` | `coverNote` follows what the figure is measured over; `REC_TYPE_NOTE` |
| `src/components/Admin/CoachRoster/AssistTab.tsx` | type + confidence on a suggestion; `brain` onto the frozen plan |
| `src/state/coachPlans.ts` | `PlanEngine.brain` |
| `tests/coachAssist.test.ts` | 14 → 17 |
| `src/utils/teamReport.ts` | the PDF said "top three" |

### The duplicate-key fix, because it is a real bug and not a cosmetic one

`TeamFolders.tsx` keyed each matchup row on `m.archetype`. The projection holds
several decks of one archetype — an observed Hog list and two real variants of
it are three rows that all say `hog` — so that key is no longer unique and React
would reuse the wrong row. It keys on `m.threat` now, falling back to the index
for a payload from a server that predates the brain.

## 10. The production review, and what the browser pass caught

Re-run against the **live route and the real 680-deck seed pool**. The figure
that moved is the one the stand-in was predicted to understate:

| | stand-in (50 decks) | LIVE (680 decks) |
|---|---:|---:|
| variants present in the projection | 11/30 | **23/30** |
| mass on variants | 0.109 | **0.238** |
| mass on observed | 0.714 | 0.594 |
| distinct archetypes per list | 6.50 | 6.03 |
| pairwise diversity | 0.983 | 0.976 |
| response time | — | **1.84 s mean, 2.7 s max** |

Portfolio sizes: 5 for 13 opponents, 6 for 2, 7 for 15 — 30/30 inside the band.
Projection sums to 1.0 on 30/30, inference distinguishable from observation on
30/30, confidence vocabulary closed on 30/30. **0/30 lists were entirely decks
the opponent already used**, and 0/30 put all the mass on their most-played
deck.

### Two things the screenshot caught that nothing else did

**Generated rows printed the raw archetype key.** `team_scout` has no imports
by design and so cannot reach `deck_counter._label`; it leaves `name` empty on
anything it generates, the client fell back to the archetype, and the
projection printed `xbow`, `bridge-spam` and `drill` in a column whose observed
rows said "X-Bow", "Royal Hogs" and "Hog Rider". Two naming conventions in one
list, with the raw one landing on exactly the rows a reader is least sure
about. `_threats()` labels them now and `test_team_analysis.py` pins it.
**107 unit checks and a clean typecheck all passed on this** — it was only ever
visible in a picture.

**The roster-wide scout block had no projection at all.** `Threats` was mounted
inside the opened folder and not in `Overall`, which in a scouting report is the
first thing on screen — so the most prominent block showed a portfolio with no
statement of what it had been chosen against.

### Browser pass: 23 of 25

Both themes, 1440 and 390, against the live API. The two failures are
`eb-canvas-container` over by 20px and 28px — the vendored ElectricBorder
canvas, whose `BORDER_OFFSET = 40` makes it deliberately wider than its box, on
a component this change never touched.

Verified: every threat row carries a kind, a confidence and a likelihood; every
generated row is drawn dashed and no observed row is; a variant names its parent
and says it was never seen; the portfolio is 5–7 with a reason on each row; the
new labels clear 4.5:1 in **both** themes; the projection restacks to two
columns at 390px.

### Three probe bugs, all from families this repo already records

- A `/analys|scout/` regex matched the **sidebar's "Deck Analysis"** before the
  tool's own button, navigated away, and then reported the projection missing.
- `x === nRows` is true of **zero rows**: the first run reported three checks
  green against an empty screen.
- The theme control is `role="switch"` whose accessible name is **"Dark mode"**
  from its `aria-label`, not the visible "DARK"; and the theme persists in
  `localStorage` under `royal-duels-theme`, so the run pins it to dark first and
  then measures both.

## 11. Still owed

- **`PER_PLAYER_TOP_N` is 7 now (§4c)**, at the account holder's request. The
  rows are collapsed per teammate, so the height only shows when one is opened;
  verified on a 5v5 Match Plan in §4d's browser pass.
- **A 5v5 or larger board is 150+ s warm** — see §4d. `_CLUSTER_CACHE` is
  too small for ten players' deck profiles and clears whole on overflow.
- **SETTLED 2026-09-21 (§4d): the badges are gone from the screen, and so is
  the sentence.** What follows is the record of why that was reasonable.
  **`type` and `confidence` are near-constant in production.** 140 ROBUST + 42
  COUNTER across 182 recommendations, **never more than one type inside a single
  portfolio**, `CONTINGENCY` never fired at all, and all 182 came back `known`.
  Both fields are *truthful* — at the top of a 204-deck pool everything beats
  everything in the projection, so coverage sits at ~1.00 and the evidence is
  the deck rung — but a field that never varies is decoration. Either
  `classify` should discriminate on something with variance, or the badges
  should go and the sentence should stay. **Deliberately not changed here**: it
  is a judgement about what a label ought to mean, not a defect, and it wants
  the account holder's call.
