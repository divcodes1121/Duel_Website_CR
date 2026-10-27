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

**Three additions on 2026-09-27, all LIVE:** the duel brain holds two of each
seven for decks proven in real duels (§4g, `9a8f2e9`); every suggestion fields
all three special slots and Deckkies picks come only from lists that can
(§4h, `f54c864`); and every matchup is ONE rate per threat LIST, from the
ladder and the duels together, with every weight fitted on a temporal duel
holdout (§4i, `fdce37e`).

`server/team_scout.py` + `server/test_team_scout.py` (**160** checks, no
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

> **AND TEAM ANALYSIS'S DUEL AND FUSION CONTEXTS HAVE ONE TOO (2026-09-27).**
> `coach._Rates` builds a `team_analysis._DuelContext` and `_FusionContext` for
> every Coach Assist suggestion, and `coach._duel_merge` reads the duel
> context's `catalogue`, `records`, `figures`, `seat`, `status` and
> `slot_gaps`. Renaming or reshaping any of those changes Coach Assist, and
> `test_team_analysis.py` cannot see it — `test_coach.py` pins Coach Assist's
> side. `_FusionContext.prepare(hubs_too=...)` exists for it; Team Analysis
> never passes `True`.
>
> **A THIRD READER SINCE 2026-10-02: `coach.chosen`** (Coach Assist's "Build
> around your cards"). It builds the same `_Rates`, reads the duel context's
> `on`, `catalogue` and `figures`, calls `duel_brain.duel_projection` through
> `coach._duel_projection`, and rates every row with `_Rates.rate` after
> `prepare`. It also reads `duel_index.decks_holding` (new that day) and
> `player_decks`. `test_coach_choice.py` pins its side against fakes; like
> `test_coach.py`, it cannot see a rename made here. The catalogue's row
> shape (`key`, `cards`, `games`, `wins`, `players`) is what it depends on.

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
- **`rate_for_threat` is optional and keyword-only (2026-09-27), and must stay
  that way.** Team Analysis passes it (the fused per-list rate, §4i);
  `coach_daily` passes nothing, which is what keeps the field plan's arithmetic
  exactly what it was. Making it required, or changing what `rate_for` answers,
  is the signature change this section warns about.

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

## 4g. The duel brain — two of the seven held for decks proven in duels (2026-09-27)

Asked for: search the duels for decks that beat the win conditions the opponent
brings (and notice a teammate's own decks that do), keep only the strong ones,
put them in the seven, and make it change for every player.

**It is a second brain, not a term in `score()`.** Nothing in this module moved:
`score`, `squad_plan` and `diversify` produce exactly the lists they did, and
`coach_daily` (the second consumer, see §7) is untouched. `team_analysis._folder`
hands each finished list to `duel_brain.merge`, which:

- puts the DUEL figure on every row (`duel`, or `null` under 10 effective duel
  games — withheld, never 50);
- counts rows already duel-strong toward `DUEL_SLOTS` (2) and marks them
  `duelProven`;
- fills any open slot with the teammate's own duel decks proven against this
  opponent, then the population's (`duel_index` catalogue), personalised by
  known cards (`KNOWN_LEAN` 3) and spread across the folder (`SPREAD_PENALTY`
  5 — at 3 one dominant deck went to all five teammates);
- inserts picks directly under the #1, which never moves (the squad plan's
  decision), and drops the lowest unproven rows to stay at seven.

A pick is scored by `score()` too (via `_score`), so it carries `expectedWinRate`,
`vs`, `known` and `personalScore` like its neighbours, plus `duelPick`
(`own`|`duel`). A population pick is a `fill`. The folder gains `duel`
(projection, their duel games, weight, answers, picks); the report gains
`duelBrain`.

**The evidence, and why it can be trusted**, is in the README ("A second brain
that reads real duels") and `duel_brain.py`'s docstring: exact and one-card-off
records per win condition, pilots' own strength taken out (the top-rate decks'
pilots won 70–94% with their other decks), shrunk toward 50/50 by 30 games —
fitted on a temporal holdout where the decks it calls strong went on to win
60.6% and it printed 60.6%.

**Measured** on 15 real staged folders: picks in 15/15, 97 picks (9 own), 62
distinct of 88 population picks, 390/525 rows with a duel figure, shared decks
per pair down in most folders, +0.3–0.6 s. The projection blends in the
opponent's own duels at `g/(g+20)`, capped 0.75: 0.63–0.75 on real duellists.

## 4h. Every suggestion fields all three special slots (2026-09-27)

Every row `_score` returns is drawn by `clash_data.complete_seating`: the most
special slots its cards can fill, keeping the observed forms that cost no slot
(see the README section "A suggestion fields every slot its cards can fill").
Fills and scouting rows come only from seeds that CAN fill all three —
`_scout_candidates` skips a short seed and takes that archetype's next one, so
each archetype still offers twelve — and the duel catalogue is filtered the
same way in `_DuelContext`. A teammate's own deck is never dropped. The report
carries `slots: {poolSkipped, duelSkipped}`. Threats and `theirDecks` are drawn
as fielded. This changes no score: seating is presentation, and the filter
only removes candidates.

## 4i. One fused rate per threat LIST, from the ladder and the duels (2026-09-27)

`score()` gained an optional keyword `rate_for_threat(threat)`, asked instead
of `rate_for(archetype)` with the whole threat row — what lets two lists of
one archetype score differently. Team Analysis passes
`_FusionContext.rater(card)` (`matchup_fusion.fused` over the matrix, the
list's variants, its archetype record plus pilot-adjusted duels, and the two
version levels from the duel index's version cells); `coach_daily` passes
nothing and is unchanged (204/204). `SOURCE_STRENGTH` gained `version` (0.9).
Every weight is fitted on a temporal duel holdout (0.6873 -> 0.6793 log
loss). `PRIMARY_BAND` was NOT re-tuned, and the consequence is measured: every
teammate's #1 distinct in 8/14 real folders before, 6/14 after, because the
fused rate separates a clear counter more often — the case the band was
written to share. See the README section "One matchup rate from the ladder and
the duels, at the version".

## 4j. Counters to what they play (2026-10-10, brain 3.0)

**LIVE SINCE 2026-10-10 AS `c1a1a0f`. Server by scp first, 06:49 UTC (the deployed files matched the last commit; backups `*.bak-20261010-064954-precounters`; only `royalweb` restarted), the client 52 s after the push (06:54 UTC, `/api/health` and the build meta). Checked on production: the live API for three players (brain `team-scout-3.0`, pool 2,341, every list ordered, nothing under 50%, every family at 10%+ answered at 55%+, every suggested deck fielding three special slots), six suites green on the VPS, and 42/42 in a real browser SIGNED IN on https://deckkies.com — the Deck Counter's three views in both themes and at 390px, a scouting report and a match plan, the figures on screen equal to the API's. Built and verified on staged code against production data first.**

The account holder: "the decks given for counter are very generic and rely on
the meta — we need decks which counter their archetypes, whatever they play, at
least at a good percentage"; then "refer to the Decks option, prioritising the
frequency, then variations; don't omit the duel battles"; then the card
structure and the card-first search. The README's "Counters to what they play"
has the measurements; this is what changed in the brain.

| was | is |
|---|---|
| `threat_space`: observed decks, seed variants, inferred archetypes; up to 45% of the mass off what they play | `played_space`: their decks only; a family keeps its whole share |
| what they play = `player_report` (every mode, 25 lists) | `player_decks.played` (own-deck 1v1 + native duel games, every list) |
| pool = 12 most played seeds an archetype (204) | every vetted seed + every duel-catalogue list (2,341) |
| `diversify`: a portfolio, archetype-repeat penalty | `counters`: strongest first, floor 50, two of one win condition, an answer for every family at 10%+ |
| two slots held under the #1 for duel picks | duel lists are candidates; ranked on the one figure |
| per-archetype rates on a match plan's rows only | `vs` on every row of both modes, keyed by family |
| — | `answers` (per family), `_by_card` (per counter card), `bring` (the Deck Counter) |

**`SWITCH_MAX`, `VARIANT_SHARE` and the seed-variant rules still exist** —
`threat_space` is unchanged — but no board is scored against it. That is the
account holder's call ("we need decks which counter what they play"), and it is
in the direction the research already pointed: observed keeps all the mass.

**`score()` is unchanged and so is its second consumer.** `coach_daily` calls
`score` and `diversify` and passes no family; its 204 checks pass untouched.
What `score` gained is optional: `lean=True` (the same figures without the
per-threat table) and a `family` on a matchup row when the threat carries one.
`score_rates` is the same arithmetic for a caller that already holds the rates
(`_row` is the one place a recommendation's worth is computed).

**The squad plan keeps its #1 rule** (`PRIMARY_BAND`, coverage, known cards).
Below the #1 a teammate's list is `counters` with the shared-deck cost as
`adjust`. On a real 12v12, rows under 50% below the #1 went 55 of 1,008 → 0.

**Not built, measured:** the opponent's own record against an archetype (top-1
lift 5.5 points against 3.8 without it, on 437 held-out players) and
list-level evidence against a list of theirs that no hub covers.

## 4k. The wide read — what they are likely to bring (2026-10-10, brain 4.0)

Measured read-only on the server the same day, before anything was built. 700
friendly duels of the last 30 days (952 player-sides, 2,300 decks brought), each
replayed with only what was stored BEFORE the duel:

| What was measured | Result |
|---|---|
| The deck brought was one of the 12 lists the engine scored against | 33% (one of ALL their 30-day lists: 54%) |
| Its archetype was their most played / one of their top three | 21% / 50% |
| The share of their games that archetype had | 18% |
| Their deck's rate against the OTHER player's history, minus their typical deck's | **+0.03 points [-0.31, +0.37]** (871 choices) |
| A counter-pick term fitted over their own lists | 0.0 to 0.2 — nothing |
| Log loss of "which archetype": shares as played / square root of them / duel games weighted x30 | 2.83 / 2.53 / **2.43** |
| Log loss of "which exact list" (same three) | 3.43 / 2.98 / **2.62** |

So opponents in friendly duels are not, on average, picking counters out of
their own lists — they are simply far less predictable than their history, and
what they bring to a duel is above all what they have brought to duels before.
From the receiving end that is the same experience ("I prepared for their main
deck and met another"), and the remedy is the same.

What changed (`server/team_scout.py`, brain `team-scout-4.0`):

- **`TEMPER` 0.5** — a family's chance, and a list's inside it, is its evidence
  to the power one half.
- **`DUEL_WEIGHT` 30 / `DUEL_OLDER_WEIGHT` 10** — a duel game in the window
  counts as 30 other games; a duel deck from the 60 days before the window
  (`team_analysis._older_duel_decks`) is still in the projection, at 10.
  `player_decks.played` now says which of a deck's games were duel games.
- **`MAX_PLAYED` 20** lists scored against (was 12; `MAX_THREATS` stays 12
  because `coach_daily` reads it).
- **`HOLE_COST` 3** — a deck under 45% against any family they are 5% likely to
  bring is chosen as though it were three points weaker (`worst` on every row).
- `plays[].share` is now THE CHANCE; `plays[].played` is the share of their
  games. The screen's strip reads "Likely to bring" and the history is each
  chip's tooltip.

Tried and not built, with the figure: a share of the weight on the friendly
duel field (+0.03), a blend with the worst case (same top three, and the
printed figure would stop being a rate), a counter-pick term (worse at every
strength), 30 or 40 lists (no gain over 20).

**Old engine against new through the production code path**, a fresh sample of
600 duels / 840 player-sides (`stage_judge.py`, staged modules, the same fused
rate judging both lists against the decks really brought):

| | 3.0 | 4.0 | difference |
|---|---|---|---|
| #1 | 59.07 | 60.56 | **+1.48** [+1.09, +1.87] |
| Top three | 58.17 | 59.73 | **+1.55** [+1.30, +1.80] |
| All seven | 57.48 | 58.79 | +1.31 [+1.13, +1.49] |
| Rows under 50% against what came | 10.6% | **4.7%** | |
| Printed figure minus what happened (the #1) | 7.6 (9.0) points | **2.1 (2.5)** | |
| The deck brought: its archetype was one the screen named | 57% | 80% | |
| The deck brought: its exact list was scored against | 35% | 48% | |
| Seconds for one opponent's projection and rating | 0.19 | 0.25 | |

Opponents with duel games behind the read (724 of 840): top three +1.71
[+1.44, +1.99]; without (116): +0.56 [+0.12, +1.01]. For scale: the average
deck in the pool rates 49.9% against what came and the best deck in hindsight
67.3% — most of what is left cannot be known before the duel, and nothing here
makes a list unbeatable.

The balance log (`card_balance.py`) moves a rate on both sides for a card
nerfed in the last 60 days; see `server/README.md`. **Second consumer
warning, unchanged:** `coach_daily` calls `score` and `diversify`, neither of
which was touched, and `MAX_THREATS` is still 12 for it (204/204).

## 4l. Ten decks, specific to the opponent (2026-10-10, brain 4.1)

Reported hours after 4.0: *"I can still see the same decks ... Hog Earthquake with
Musketeer and Giant Skeleton I saw against many opponents, I don't think it can be
the same"*, *"whatever duel deck you suggest, make sure it's from the top CRL
player and not from some random players"*, *"we can suggest 10 decks max"*.

**Measured first, and it was worse than reported.** Over 952 opponents one list
was on 56% of the lists of seven; on 30 live answers three lists were on 16 each,
and the Hog / Earthquake / Giant Skeleton duel list had **no game by a CRL
player**. A list that rates well against nearly everything is the answer to no
opponent in particular, and part of what makes it rate well is who pilots it:
the ladder record behind a rate is not adjusted for its pilots.

What changed (brain `team-scout-4.1`):

- **Duel lists come from the named group only.** `team_analysis.duel_catalogue()`
  narrows the duel catalogue to lists the `crl` group (`CLASH_DUEL_POOL_COHORT`,
  the server's `.duel_cohorts.json`) fielded in at least 3 duel games: 1,706
  lists -> **130**. One function for the counter pool and for the duel context
  Coach Assist reads. No group = the whole catalogue, and the pool's stats say
  `duelFrom`.
- **A counter is specific to the opponent.** Each pool list carries `fieldRate`,
  its rate against the average opponent (every archetype duel players field,
  weighted by players, at the archetype level). Per opponent, `scout.pool_lift`
  stamps `lift` (how much MORE the list gains against them than the typical
  list does) and `edge` (its general strength). `scout.counters` allows **one**
  all-round row (lift under 5), chooses every row as though weaker by half its
  edge, and fills with all-round decks only when too few counters exist. None
  of it changes the figure printed or the order shown.
- **Ten rows** on every Team Analysis list and the Deck Counter (`TOP_N`,
  `PER_PLAYER_TOP_N`, `SCOUT_TOP_N`); `team_scout`'s own default stays seven for
  `coach_daily`.

Staged on 30 real opponents four times before it held: a field of popular
friendly-duel LISTS, then of every family's top lists (both are rated from the
version cells — a different evidence level from an opponent's own lists — and
the same two ladder lists stayed on 19-21 of 30 answers), the raw difference
without the pool's median (a weak opponent made every strong list "a counter"),
and lower lift thresholds (more repetition, not less).

| Old rules against new, production path, 300 friendly duels / 426 sides, ten rows | Before | After |
|---|---|---|
| Distinct decks suggested (of 4,260 rows) | 316 | **490** |
| The most repeated list is on | 38% of lists | **25%** |
| The next two | 29%, 29% | 15%, 13% |
| Top three against what was really brought | 59.17 | 58.69 (**-0.49** [-0.67, -0.31]) |
| All ten | 58.19 | 57.47 (-0.73) |
| Rows under 50% against what came | 6.7% | 10.9% |

**The cost is real and was accepted for what was asked:** half a point on the
top three by the same fused rate (which itself carries the pilot effect, so the
true cost is smaller), and a weaker tail — a specific counter is a specialist,
and on the live check one opponent's list held two rows at 32% and 36% against
an archetype they are 5%+ likely to bring (the chips under the deck show it).

Live 12:38 UTC (backups `*.bak-20261010-123855-prespecific`): three real players
got three different lists of ten, pool 781 (651 ladder + 130 duel), one
all-round row each; a scouting report and a 1v2 plan answer in 4-6 s cold.
Staged: 12 players' lists held 86 distinct decks in 120 rows (4.0: 60 in 112),
one opponent 0.27 s, 12v12 2.3 s warm. `test_counters` 96 -> 116,
`test_team_analysis` 228 -> 241, `test_duel_index` 71 -> 76; **19 planted
faults caught** (one test too weak first). 4,647 Python checks / 78 suites
(only `test_ml_21a`), 1,673 vitest / 69.

**"The scouting report is still stale":** the server answers a scouting report
with the same engine as a match plan (checked: brain 4.1, ten rows). What made
it look unchanged was the content — the same few all-round decks under every
opponent — which is what this change removes. A report opened from **Saved** is
a snapshot of the day it was saved; run it again for today's lists.

**Not done:** no browser pass after 4.1 (the markup did not change; the API was
probed); Coach Assist's own-deck suggestions are untouched, only its population
duel picks narrowed to the group; the win model still learns from every duel.

## 4m. The figure reads the cards (2026-10-11, brain still 4.1)

`team_scout` did not change. What changed is the RATE it is handed: on the Deck
Counter's list and Team Analysis every `winRate` is now
`0.19 * logit(fused rate) + card model` (`card_matchup`, wired in
`team_analysis._FusionContext.use_cards()`), and each pool list's `fieldRate`
is read the same way, so `lift` still compares like with like.

On 24,307 held-out duel games the pair scored 0.6123 log loss against the fused
rate's 0.6328, and inside one duel rated the game a pilot won above the one they
lost 66.2% of the time against 58.4%. Replayed through the production path on
392 player-sides with a neutral judge, the #1 deck is worth 58.7 against 52.2
and rows under 50% against what really came fall from 40.7% to 22.8%.

**What a reader of this file needs to know:**

- `FLOOR_RATE`, `GOOD_RATE`, `WORST_FLOOR`, `MIN_LIFT`, `GENERIC_WEIGHT` and
  `HOLE_COST` were NOT re-tuned. The figure is more spread out than the fused
  rate (it calls 65%+ four times as often, and those calls hold), so more rows
  clear `MIN_LIFT` (all-round rows 856 -> 330 of 3,920) and more rows show a
  hole (13.0% -> 23.3%). `GENERIC_WEIGHT` 0.75 and 1.0 were replayed: more
  repetition and less value both times. `HOLE_COST` 6 cut the holes to 17.9%
  for 0.6 points of the #1 — measured, not taken.
- The most repeated list is on 27.6% of opponents' lists (20.9% before).
- `coach_daily` and Coach Assist are unmoved: neither context asks for the model.
- The report says which model rated it: `fusion.cardModel`, `bring.cardModel`.
- **`squad_plan` keeps the rates a row already carries** (fixed the same day,
  found by the signed-in check). It recomputed `vs` from `matchups`, and a pool
  row rated in the tight loop has none, so inside the planner every pool row's
  rates were empty: the Coverage strip read "0/7, every archetype a gap", and
  the family-answer and hole rules did not apply to pool rows in a match plan.
  Present since 3.0's tight loop, with or without the card model. Now
  `if "vs" not in c`, as `counters` and `answers` ask. `test_team_scout`
  160 -> 164 (three of the new checks fail on the old code).

## 4n. The day window picks the pool (2026-10-11, brain still 4.1)

`team_scout` did not change, and neither did any rate. What changed is the POOL
it is handed. The History chip (7D, 15D ...) used to decide which of the
opponent's games `played_space` read; the 787 lists `counters` and `squad_plan`
choose from were the same at 7 days and at 90. Asked for by name: the
recommended decks of a scouting report and of a match plan should come from the
days picked, because a deck that has left the meta is not one to suggest.

- **In the pool for a window:** 5+ games in it, and a share of the pool's play at
  least half of the share it held in the 60 days before
  (`team_analysis.window_state`). At 7 days that keeps 543 of 787.
- **Measured before:** a quarter of the rows suggested today were lists the
  window leaves out (25.9% at 7 days, on 185 of 200 opponents' lists). Lists
  whose share had halved won 52.5% the following week against 55.4% for steady
  ones.
- **A match plan:** the Deckkies picks come from the windowed pool; a teammate's
  own decks are never filtered. Staged on 8 plans of 3 v 3 at 7 days: 123 of 647
  picks were lists the window leaves out, then none, and the teammates' own decks
  on the lists went 73 -> 85.
- **The cost:** about half a point on the printed figure of a list, and the most
  repeated list on 29.0% of opponents at 7 days (26.0% before). Told to the
  account holder.
- **Second consumer:** `coach_daily` does not pass a window and is unchanged
  (204/204).

The record, with the tables: README "The day window picks the suggested decks",
server/README "The day window on the suggestions".

## 4o. What the best duel players bring, and a list per teammate (2026-10-14, brain 5.0)

**LIVE since 2026-10-14 as `b25d12e`** (server first, backups `*.bak-<stamp>-prets5`). The README chapter "What the best duel
players bring, and a list per teammate" has every table; this is what changed in
the brain and why.

Reported against 4.1: *"the recommendation decks are so trash ... random decks,
decks repetitive for more players ... get battles from CRL duel rows, meta decks
going on in the time frame"*, then *"versatility, different win conditions,
ranked and matched against the opponent's decks, keep >50% decks"*.

| was (4.1) | is (5.0) |
|---|---|
| pool: every vetted ladder list + the CRL group's catalogue lists (786, windowed to ~557) | `team_analysis._competitive_pool(days, until)`: the CRL group's duel lists IN THE WINDOW (2+ games) + the window's 40 most played vetted lists — 7 d ~220, 30 d ~500 |
| two lists of one BOT ARCHETYPE on a list | one list of one WIN CONDITION (the card) on a scouting list, three on a teammate's (`counters(by_wincon=True, per_family=...)`) |
| one row under 50% when nothing clears the floor | none (`counters(floor_only=True)`) |
| scouting lists of a roster chosen independently | a deck already on earlier opponents' lists costs 1 point a listing, at most 2.5, in the CHOOSING (`SCOUT_SPREAD_*`) |
| `squad_plan`: different #1s inside a 3-point band, the same population ranking below | `personal_plan`: decks of the teammate's own win conditions (5%+ of their games), rated with their `player_skill` record, at most `NEW_SLOTS` (3) of other win conditions, a pool deck to ONE teammate per opponent by claims (figure + 10 x the win condition's share of their play), short lists topped up keeping what they had |
| — | `lineup`: the pairing of teammates and opponents with the highest total (exact search, at most 12 x 2^12 states); `report.lineup`, `folder.assigned` |

`counters(specific=...)` keeps 4.1's specificity rules on a SCOUTING list
(without them the most repeated list went from 25% to 42% of opponents) and
drops them on a teammate's, where the player is what makes lists differ.

**Measured blind** (300 opponents of 1-6 October, 150 CRL players; rated by the
card model fitted before 1 October, judged by one fitted from 7 October):
rows the CRL group brought 36.7% -> 96.7%, win conditions a list 7.1 -> 10.0,
the #1 +0.10 [-0.53, +0.74], top three -0.53, all ten -0.60, rows printed under
50% 0 -> 0, most repeated deck in a roster of six 2.89 -> 2.78 lists; match plans:
distinct rows 53% -> 97.5%, decks two teammates share 5.0 -> 0.15, a different #1
per teammate 124 -> 151 of 152, the best teammate's #1 63.88 -> 64.43, every row
58.17 -> 56.28 (the cost: the strongest rows are no longer everybody's).

**5.1 the same day** (README "5.1 the same day: one super-strong deck of each
win condition"): one deck of each FAMILY (`winFamily`) on a list, the strongest
— no specificity rule, no roster spread — and the same on a teammate's list, ten
rows, `FAMILIAR_FIRST` 3 points toward their own win conditions in the choosing;
"vs the field" is the rated `field`. Blind: #1 60.89, all ten 57.69, judged rows
under 50% 11.7% (4.1 13.2%), best teammate's #1 64.39; the cost, one deck on 5-6
lists in 11 of 45 rosters of six. A staple rule for CRL lists was measured and
made every figure worse.

**Second consumers, unchanged:** Coach Assist's counters read `_window_pool`
(the 4.1 pool) and were measured on it; `coach_daily` calls `score`, `diversify`
and `threat_space`, none of which changed. `squad_plan` is kept (its tests
still pin it) and no longer called by Team Analysis.

**Two bugs the replay and the browser found before anything shipped**: a
helper `fam` inside `counters` shadowed by the repair loop's own `fam` (match
plans fell back to shared lists), and a function `spread` in `_folder` that
overwrote the folder's archetype bars (a scouting report would not serialise).
Both have tests that fail on the old code.

## 4u. A brain for every win condition, and its top five (2026-10-27, brain 7.2)

Asked after 7.1 went live: *"still so many archetypes missing ... in duels
there are so many decks as well as in the top 1k which counter so many
things"*, *"duel decks have so many varieties ... different cards with
different archetypes"*, *"make multiple brains, like 17 win cons 17 brains ...
rate the decks, give it to the main brain"*, and *"a click dropdown for all win
cons showing the top 5 decks rated against the player"*.

**Measured first** (deployed 7.1, the four Players.txt opponents): of 26
families in the pool each opponent got 7-15. The rest were missing because
their best list's worst matchup was 40-44% (most of them), because it was
under 50% overall, or because the family had no list at all — Executioner,
Furnace, Inferno Tower, Mega Knight, Musketeer and Suspicious Bush are played
in duels only by small groups and missed the 10-games / 3-players bar. Pool
options on 20 opponents:

| pool | lists | families | 20 opponents | win cons listed | beating everything |
|---|---|---|---|---|---|
| 7.1 (duel 10 g / 3 players, line 45) | 1,410 | 26 | 12.7 s | 13 | 5 |
| 7.1 pool, line 40 | 1,410 | 26 | 9.7 s | 20 | 5 |
| duel 5 g / 2 players, top 2 players | 2,223 | 29 | 14.5 s | 21 | 5 |
| duel 3 g / 2 players, top 2 players | 2,857 | 29 | 18.7 s | 21 | 6 |

**Built:**

- **The pool**: `DUEL_LIST_MIN_GAMES` 3, `DUEL_LIST_MIN_PILOTS` 2,
  `TOP_MIN_PLAYERS` 2 — 2,857 lists, 29 win-condition families.
- **A brain per win condition** (`team_scout.win_condition_brains`): every
  list of its family rated against the opponent; the report says how many
  lists, how many beat every family, its best worst matchup, how many the main
  list shows, and its top `BRAIN_TOP` (5) lists — beating everything first,
  one-card variants folded (`BRAIN_SAME` 7). On every folder as `brains`,
  dressed by `team_analysis._brain_view` (seated, no second rating).
- **The main brain** (`counters`): every family's answer — up to
  `EACH_PER_FAMILY` (3) different builds that beat everything (the near-copy
  rule keeps them six cards apart), else its closest list down to
  `EACH_NEAR_ALL` (35%; was 45). Same for each teammate's list.
- **Two bugs the saved boards found, fixed with tests**: (1) a family at
  4.996% of an opponent's play was published as 5.00% and required, but
  `played_space` compared the unrounded share and kept no list for it — every
  deck "failed" it and the folder was empty (now the rounded share, and
  `judged_plays` never requires a family no deck could be rated against);
  (2) a player with no ranked or 1v1 friendly games in the window (clan-war
  only) had no projection — now every own-deck game is read, and
  `played.modes` says `all`.
- **Screen**: under every suggested deck, a "Top 5 <win condition> decks ·
  n/m beat all" dropdown (`BrainDrop`) with each deck's figure, origin pill,
  Closest mark and archetype chips; the deck shown above is marked. A line
  "29 win conditions · 2,857 decks rated" under the heading. Both modes.
  Payload ~175 kB per opponent raw, ~23 kB gzipped (Caddy compresses).

**Staged, the account holder's 9 saved boards (88 opponents):** decks per
opponent median 26 (7.1: 12, 7.0: 3), of which 12.5 beat every family they
play (7.1: 6); teammate lists 27 (12 beating everything); 0 of 11,575 rows
mislabelled, 0 with a worst matchup under 35%; #1 figure 64.3%. The one empty
folder left is a player the bot has stored a single 2v2 battle for. Time: 9
boards 161 s including a cold pool build (59 s for the first); a 10v10 plan
14-20 s, a 9-14 player scouting report 9-13 s. Brain `team-scout-7.2`. Tests:
`test_team_scout` 252, `test_team_analysis` 373, vitest 1,844
(`teamBrains.test.ts` new). Browser 25/25 on staged payloads (dark and light
1440, dark 390; the dropdown opens to five decks with art, one marked as the
deck above; a teammate's deck has one too).


## 4t. Every win condition, from thousands of decks (2026-10-27, brain 7.1)

Asked the same day 7.0 went live: *"now it's even bad, shows only 4-5 decks — I
need multiple win cons like last time; there are literally hundreds and
thousands of decks in duels and the top 1k ladder, check and integrate"*, then
*"have multiple brains analysing the matchups for thousands of decks and then
consolidate the report into one super brain that arranges the decks; check
what models can be used"*.

**Measured first.** 7.0's pool was 242 lists (10 top-1,000 lists a win
condition + CRL staples). The sources hold far more: on a 30-day window 1,262
lists were played in native duels by 3+ players for 10+ games (25 families) and
763 lists clear the top-1,000 bars. But widening the pool alone moved 7.0's
lists from a median 3.5 to 5 decks: the RULE was the limit. Against 20
opponents with the wide pool, a median 5 win conditions have a list beating
every family at 5%+, 13 have one whose worst matchup is 45%+, 22.5 have one
over 50% overall.

**The brains, and the super brain:**

- **Nominating brains (the pool, `_build_competitive_pool`)**: the top-1,000
  ranked players (every list 3+ of them used for 30+ games —
  `TOP_PER_FAMILY` 1000), the window's duels (`duel_index.window_lists`: every
  native duel list, clan-war and friendly, anybody's, `DUEL_LIST_MIN_GAMES` 10,
  `DUEL_LIST_MIN_PILOTS` 3, no pilot over half — origin `duel`, row
  `duelList`), the CRL group's staples. All must pass the card-pairing gate and
  fill three special slots. ~1,500 lists.
- **Rating brains, unchanged**: the counts brain (`matchup_fusion`: ladder and
  duel records at archetype, family and version level) and the card-vs-card
  model, stacked by the weights fitted on the 11 Oct holdout. **Models
  checked**: the duel win model (`duel_model`) is a duel-only card model plus
  pilot strength and card levels — the duel-only card model measured WORSE
  than the ladder+duel one already in the stack (0.6679 vs 0.6621 log loss on
  24,307 held-out duels) and the other two terms do not exist for a deck
  nobody has piloted; LightGBM was the one model that beat the stack (0.6561 vs
  0.6613) but it needs a native library and cannot score thousands of lists
  per request in pure Python. Neither was added.
- **Super brain (`team_scout.counters`)**: decks that win every family lead,
  by their figure; then EVERY other win condition's closest list (highest
  worst matchup), down to `EACH_NEAR` = `WORST_FLOOR` 45 and no further,
  marked `allArchetypes: false` ("Closest"), the closest first. One list a win
  condition. Same for each teammate's list (`personal_plan(each_near=)`).

**Speed.** The profile of a warm 10-opponent request on the wide pool was
dominated by matching each list's ladder history against the opponent's decks
(`prepare`: 1.1M 7-card slicings), redone per opponent. `_history_index`
indexes a history by its 7-card subsets once per hour (a threat's family is
eight lookups, less seven times its exact games); `prepare_reference` keeps the
old loop and a randomized test holds the two equal. 10 opponents 10.4 s ->
5.1 s. `HISTORY_CACHE` 1024 -> 4096. In a match plan, a deck that cannot reach
the 45% line for a teammate (after their record shifts every matchup alike) is
no longer copied for them. Separate worker PROCESSES were not built: the box
was OOM-killed once this month and each worker would hold its own copy of the
pool and the models.

**Staged on the server, the account holder's 9 saved boards (88 opponents), 7.0
live vs 7.1:**

| | 7.0 | 7.1 |
|---|---|---|
| decks per opponent (median) | 3 | 12 |
| ...beating every archetype (median) | 4 | 6 |
| decks per teammate list (median) | 4 | 14 |
| listed rows with a worst matchup under 45% | 18 | 0 |
| rows losing an archetype without the Closest mark | 0 | 0 |
| folder #1 figure (median) | 62.7% | 63.8% |
| time, all 9 boards (incl. one cold pool build) | 40 s | 107 s |

The cost is time: a 10v10 match plan 7-8 s -> 12-16 s, a ten-player scouting
report ~2 s -> ~5 s warm, the first request of a window ~30 s while the
1,400-list pool is built (then cached). Pool on a 30-day window: 1,410 lists
(583 top-1,000, 1,135 from the window's duels; they overlap). Brain
`team-scout-7.1`. Tests: `test_team_scout` 240, `test_team_analysis` 368,
`test_duel_index` 103. Browser 10/10 on staged payloads (dark 1440, light 390).


## 4s. Decks that win every archetype they play (2026-10-27, brain 7.0)

Asked 2026-10-27, about the scouting report and the match plan: *"the decks it
shows are poor and not reliable ... need decks > 50% at least in all opp
archetypes, and read ranked + 1v1 friendly battles of the opponent to suggest
decks against him ... top decks, good synergy, high usage, counter".*

**Measured first** (30 real opponents, 6.1 as deployed): **82% of the decks
shown lost (under 50%) to at least one archetype the opponent plays**, and the
median shown deck's worst matchup was 42.6%. The 50% floor was on the WEIGHTED
figure only, so a deck that crushed their main list and lost 40-60 to the one
they bring a fifth of the time passed it. And the opponent read counted every
own-deck mode, clan-war duels most of all: 186,535 clan-war duel games against
9,265 friendly-duel games stored since 1 October, each duel game counted 30
times.

What changed:

- **A deck is listed only if it wins every archetype they play.**
  `team_scout.counters(each_floor=EACH_FLOOR)`: its rate against EACH family at
  `EACH_SHARE` (5%, the families the screen names) must be 50%+, and a family it
  has no rate against fails it. Rows that pass are `allArchetypes: true`; when
  fewer than `EACH_MIN` (3) pass, the decks whose worst matchup is highest fill
  the list, `allArchetypes: false`, after the ones that pass. Every row carries
  `eachWorst {family, rate}`. The answer-swap path takes only passing decks.
  Same rule for each teammate's list in a match plan
  (`personal_plan(each_floor=, plays=)`, their record with the win condition
  applied, the folder's own shares), for the folder face, the roster-wide read
  and the Deck Counter's bring list. A match plan's shortlist keeps every deck
  that beats every family whatever its overall figure.
- **The opponent is read from ranked and 1v1 friendly games only**:
  `player_decks.played(modes="ranked_friendly")` =
  `battle_modes.is_ranked_or_friendly` (`Ranked1v1_*`, `Ladder`, `Friendly`,
  `Duel_1v1_Friendly`); `duel_index.player_decks(modes=)` keeps friendly duels
  only, for the window and for the older-duel read. Clan-war duels,
  tournaments, Showdown / Overtime / Rage friendlies and events are counted in
  `hidden`. The Decks screen still reads every mode.
- **Good synergy**: a pool list must pass the card-pairing gate
  (`deck_synergy.passes`, the one Coach Assist's built decks pass) — 29 of the
  271 lists in the 30-day pool were left out (`pool.window.synergySkipped`).
  The duel-based spell-package check (`deck_packages`) was measured too and NOT
  applied: it fails about half of the top-1,000 lists, mostly for newer cards
  duel players have barely fielded.
- **Pool size measured, not changed**: 10 / 20 / 40 top-1,000 lists per win
  condition = pool 271 / 402 / 582, 8.0 / 9.3 / 18.6 s for 20 opponents, a
  median 4 / 4 / 5 decks beating every archetype. Twice the wait for one deck.
- **Screen**: every archetype chip is drawn under a deck (`MAX_CHIPS` 6 -> 10;
  opponents play up to nine at 5%+), and a "closest" row carries an outlined
  **Closest** pill whose tooltip names the matchup it loses. Rows that win every
  matchup carry nothing extra — their chips are all green.

**Staged on the server, same inputs, 6.1 vs 7.0:**

| | 6.1 | 7.0 |
|---|---|---|
| 30 opponents: shown decks losing to an archetype they play | 82% | 4% (marked fills only) |
| 30 opponents: median shown deck's worst matchup | 42.6% | 53.5% |
| the account holder's 9 saved boards (88 opponents): folder decks losing one | 1,430 / 1,806 | 59 / 463 (all marked Closest) |
| ...each teammate's #1 losing an archetype | 176 / 340 | 40 / 340 (marked) |
| ...teammate #1 figure / worst matchup (median) | 61.9% / 50.8% | 62.9% / 52.5% |
| ...folder #1 figure (median) | 64.0% | 62.7% |
| ...most repeated deck in folders' top three | 18 | 19 |
| ...time, all 9 boards | 52.6 s | 40.4 s |

The cost: lists are shorter (a folder face 1,806 -> 463 rows over 88
opponents; a teammate's list median 4), because on most opponents only a
handful of decks beat everything they play; 10 of 88 opponents have no deck
that does, and get the three closest, marked. Brain `team-scout-7.0`.
Tests: `test_team_scout` 236, `test_team_analysis` 366, `test_player_decks`
60, `test_duel_index` 99, `test_battle_modes` 188, vitest 1,837. Browser
28/28 on the staged payloads (both themes, 1440 and 390).


## 4r. What the top 1,000 players use, re-read every poll (2026-10-24, brain 6.1)

Asked hours after 6.0: *"still the decks suggested are very bad and those decks
are not used by top players — target the top 1k players as a deck suggestion,
and the CRL duel list, and set the frequency like that"*, then *"the top 1000
changes every time the bot polls ... so that we get fresh decks every time"*.
6.0's meta half was the most played vetted lists of the WHOLE ladder, which is
mostly not the top of it.

- **`server/top_decks.py`** (`top-decks-1.0`) reads the top 1,000 of the LIVE
  ranked board (`/locations/global/pathoflegend/players` — the season being
  played; the season-numbered board the recruiter reads is last month's and does
  not move) and counts every ranked game (Path of Legends + trophy road) each
  of them played in 90 days, by exact list and day. `.top_decks.json`
  (gitignored, mode 600) holds NO TAGS — a player is their place in the board.
  A step of `after_poll.py`, so it is rebuilt after every poll (~100-200 s);
  untracked climbers are queued (`recruit.enqueue`, source `top-live`) so their
  games are collected from the next poll on. The live board answers 500 now and
  then: a page is tried four times, and if it still fails the LAST FILE IS KEPT
  (the first deploy's build fell back to a finished season and read June's
  board). Measured 2026-10-24: 1,000 players,
  936 with stored ranked games, 30,154 lists. `topDecks` on `/status`.
- **The pool's meta half is now those lists**: `TOP_MIN_PLAYERS` (3) of the top
  1,000 used it with `TOP_MIN_GAMES` (30) games between them in the window, the
  `TOP_PER_FAMILY` (10) most used of each win condition (`_top_keys`). 6.0's
  ladder meta is read only when the file is missing. CRL staples need two of the
  group or one of them `CRL_SOLO_GAMES` (now 20) times.
- **Frequency in the choosing** (`use_bonus`, `useBonus` on a row):
  `TOP_USE_WEIGHT` 0.5 points per doubling of the players who use a list, at
  most 3 — a list three of them use must rate about two points better than one
  eighty use. Never in the printed figure.
- Screen: pill `Top 1k list` (blue) with the tooltip `Used by 32 of the top 1,000
  players · 1,222 ranked games · 52% won` (plus the CRL line when both); the
  pool line `206 top 1k lists + 132 CRL duel lists · last 30 days`.

Staged first with "two of them, or one of them 20 times": whole win conditions
were one person's deck (an Elite Barbarians list two top players used for three
games; a Mega Knight list one of them played 1,047 times) — hence three players
and thirty games, and no one-player route.

Same four opponents, 30 days:

| | 5.1 (morning) | 6.0 | **6.1** |
|---|---|---|---|
| Pool | 513 (506 CRL) | 253 | **271**: 206 top-1000 + 132 CRL (some both) |
| Rows that are lists the top 1,000 use | — | — | **82%** (rest CRL staples) |
| Median top-1000 players behind a row | — | — | **13** (3 before the frequency rule) |
| Top ten, mean figure | 58.5 | 59.4 | **59.2** |
| #1, mean figure | 63.0 | 63.7 | **64.8** |
| Rows under 50% | 0 | 0 | 0 |

Undo without a deploy: `mv .top_decks.json{,.off}` on the VPS (6.0's ladder
meta returns at the next pool build); or restore
`*.bak-<stamp>-prets61` and restart royalweb.

## 4q. Today's meta, for every win condition (2026-10-23, brain 6.0)

Reported on the live scouting report and match plan: *"the decks suggestion are
very old and not according to the meta and the decks which I can see ... very
similar for all players, just up, down and one difference ... if possible we can
show for all win cons"*. Measured on the live answer for a real four-player
roster (30 days) before anything changed:

- **473 of the pool's 513 lists were CRL duel lists, and 378 of those were
  brought by ONE player** — 145 of them twice. The deck each win condition was
  answered with was the luckiest of them: the Hog pick was a list one player used
  twice, Giant four games, Three Musketeers one player's 9-1 run. A short run
  inflates a list's rate, and the best of hundreds of short runs is what "the
  strongest of each win condition" finds. Only **5 of the 40 suggested rows had
  been played at all in the window** outside that one player's games.
- **The meta half was the 40 most played lists overall**, so 15 of 22 win
  conditions had no meta list in the pool — while the duel index held 500 vetted
  lists played in the window, 25-35 per win condition, most with thousands of
  games. The meta board's top lists (Hog Musketeer Cannon, Log Bait Rocket
  Inferno, X-Bow Tesla, E-Giant Lightning ...) were never offered.
- **Ten win conditions a list**: against CRL-level opponents, who all play the
  CRL meta, the ten strongest are nearly the same ten for everyone, so four
  folders shared 2-5 of ten decks and only the order moved.

What 6.0 does (`team_analysis.py`, `team_scout.py`):

- **The meta of every win condition**: the window's `META_PER_FAMILY` (8) most
  played vetted lists of EACH win condition with `META_MIN_GAMES` (50)+ games in
  the window (`_meta_keys`), not the 40 most played overall.
- **CRL lists that are staples**: brought by `CRL_MIN_PILOTS` (2)+ of the group,
  or `CRL_SOLO_GAMES` (10)+ times by one (`_crl_proven`). The 30-day pool went
  from 513 lists (506 CRL) to 253 (171 CRL, 147 meta; some are both).
- **Every win condition**: `ALL_WINCONS` (40) rows on a scouting list, a match
  plan's folder and each teammate's list — one deck of each win condition that
  clears 50%. The Deck Counter keeps ten (`BRING_TOP_N`).
- **The opponent decides between near-equals** (`counters(band=SCOUT_BAND)`,
  1.0 point): inside one win condition, the lists within a point of the best are
  ranked by `lift` (how much more they gain against THIS opponent than the typical
  list). The card model's per-card terms are the same against everyone, so
  without it one list answered a win condition for every opponent.

Same four opponents, old live answer vs 6.0 (staged, then live):

| | 5.1 | **6.0** |
|---|---|---|
| Rows per opponent | 10 | **17-19** (every win condition over 50%) |
| Suggested rows played in the window | 12% | **68%** |
| Rows that are meta lists | 0% | **38%** |
| Top ten, mean figure | 58.5 | **59.4** |
| #1, mean figure | 63.0 | **63.7** |
| Win conditions answered with a different list for different opponents | 8 of 11 | **14 of 20** |
| Rows under 50% | 0 | 0 |
| Scouting report, 4 players | 10-11 s | 4.6-14 s |

**A trade, said**: 5.1 measured a staple rule (two of the group, or one of them
five times) blind and found every figure 0.5 points worse. 6.0 accepts that risk
for lists people actually play now; its own figures did not drop on this roster
because real meta lists are now in the pool. Not re-replayed blind.

Undo without a deploy: restore `team_{analysis,scout}.py.bak-20261023-181706-prets6`
on the VPS and restart royalweb.

## 4p. Twenty a side (2026-10-17)

**`MAX_SQUAD` is 20 on both halves** (`src/utils/squadParse.ts`,
`server/team_analysis.py`), raised from 12 on request. Two things had to
change before the number could:

- **Who takes whom was exponential in the roster.** `team_scout.lineup` paired
  the sides with an exact search over the smaller side's subsets: 12 x 2^12
  states at twelve, 20 x 2^20 (~420M steps) at twenty, which would have hung the
  request. Up to `SUBSET_MAX` (12) it still runs that search, so every board
  that existed before is unchanged; above it, `_assign` (the Hungarian method,
  O(n^3), exact) answers. Checked equal to the subset search on 400 random
  rosters (150 in `test_team_scout.py`), and planting a fault in `_assign`
  turns that check red. A 20v20 answers in under a millisecond.
- **A 20v20 board did not fit the browser.** Measured on production: a real
  12v12 report was 1.85 MB raw, 1.51M chars compacted, 183 kB gzipped and 26 s
  cold. Scaled by folder x teammate cells (400 vs 144), a 20v20 save would be
  about 4.7M chars, which is over `teamSaves.ts`'s 3M cap, so Save would have
  failed. The browser copy now keeps each report as `reportPacked`
  (`deckCodec.packText`, the saved library's deflate + 15-bit form, ~8x
  smaller). Saves written before this still load, and they are rewritten
  packed the next time anything is written. The account copy was already
  gzipped (about 570 kB at 20v20, under the 1 MB request cap).
  `tests/teamSavesStore.test.ts` drives the real store.

Everything else in the engine works in `blue x red` loops, so it does 400 pairs
where it did 144. **Measured live after the deploy: a cold 20v20 took 44 s
and returned 4.8 MB** (20 folders, 20 pairings). A cold 12v12 took 26 s. The
screen has no client timeout. Deploy order is the usual one: scp `team_analysis.py` and
`team_scout.py` to the VPS, restart royalweb, and push only after that. If the
client goes first, it allows 20 while the server cuts the roster at 12. The
screen's `limits.maxSquad` check tells the reader when that happens.

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
  jsonb. Route count stayed **23** (it is 25 today — the field plan and the
  admin tracking view took the 24th and 25th).

- **The fused rate (§4i) trains nothing either.** Its five weights (the duel
  weight and four shrinkage strengths) were FITTED by grid search on a temporal
  duel holdout — not a model — and nothing is learned at request time or on a
  timer. The version
  cells it reads are counts.

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
| `server/duel_index.py` | **new (§4g).** Native duel games out of `battle_raw`, per-deck records vs win conditions with the players' expected result; own gitignored file, `royalweb-duel.timer` |
| `server/duel_brain.py` | **new (§4g).** The duel brain. No imports beyond the standard library |
| `server/test_duel_brain.py`, `server/test_duel_index.py` | **new.** 83 and 41 checks |
| `src/utils/duelFigures.ts` | **new.** How a duel figure prints, on the screen and in the PDF |
| `server/clash_data.py` | **§4h.** `complete_seating`, `complete_marks`, `fillable_slots`, `slot_kind`, `seated_positions` |
| `server/test_suggested_seating.py` | **new (§4h).** 49 checks on real card keys, every observation subset of the 95 fixture decks |
| `server/matchup_fusion.py` | **new (§4i).** The fused rate. No imports; keyword-only `fused()` |
| `server/test_matchup_fusion.py` | **new (§4i).** 34 checks against literals, the fitted constants pinned |
| `server/duel_index.py` | **§4i.** The version-cell stage (`_build_vcells`, `vhub` / `vcell`), `is_version_hub`, `version_cells`, status fields |
| `server/test_duel_index.py` | 41 → 60. Hand-computed cells on a synthetic ladder, both storage directions, a failed stage not costing the build |
| `server/team_scout.py` | **§4i.** Optional `rate_for_threat`; `SOURCE_STRENGTH["version"]` 0.9 |
| `server/test_team_scout.py` | 155 → 160 |
| `server/team_analysis.py` | **§4h / §4i.** Rows drawn by `complete_seating`, the scout pool and catalogue filtered to full loadouts, `_FusionContext`, `fusion` and `slots` on the report |
| `server/team_analysis.py` | **`93e45e2`.** `_FusionContext.prepare(hubs_too=...)`, an opt-in family level for hub lists; Team Analysis never passes it |
| `server/coach.py` | **`93e45e2`.** Coach Assist's `_Rates` and `_duel_merge` build and read `_FusionContext` / `_DuelContext` — the consumer the second-consumer note warns about |
| `server/test_coach.py` | 84 → 99. Coach Assist's side of that contract, against fakes |
| `server/test_team_analysis.py` | 142 → 150 → 163 |
| `src/utils/deckSeating.ts` | **§4h.** `drawnDeck(..., filled)` + `formInferred`: a filled form says so per card |
| `src/utils/teamReport.ts` | **§4i.** The per-archetype evidence table prints the weighted mean of that archetype's lists |
| `src/components/Analytics/TeamAnalysis/TeamAnalysis.tsx` | `run` lists `days` among its dependencies — a new window was sending the old one |
| `tests/teamAnalysisRun.test.ts` | **new.** Pins that fix; proven by reinstating the bug |

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
- ~~**A 5v5 or larger board is 150+ s warm**~~ — **resolved 2026-09-21 (§4e).**
  The cluster index took a 5v5 to 6.6 s cold / 3.0 s warm; live on 2026-09-27
  a warm 5v3 answers in about a second, the fused rate included.
- **The squad plan's band against the fused rate (§4i) — the account holder's
  call.** Every-#1-distinct went 8/14 -> 6/14 on real folders, because a clear
  counter is now separated from the rest and the band shares it. Forcing
  distinct #1s would mean handing some teammates a measurably worse deck; the
  band was left as it is.
- ~~**Coach Assist and the field plan still rate by archetype.**~~ **Coach
  Assist moved on 2026-09-27** (`coach._Rates`, holdout 0.6853 -> 0.6793, see
  the README's "Coach Assist reads real duels"). The field plan still rates by
  archetype; its pool and its threats are all version hubs, so giving it the
  fused rate is cheap.
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
