# Team Scout — the coaching brain

**Status: implemented, tested, NOT DEPLOYED.** `server/` is copied to the VPS by
hand and this change touches four server modules, so the analytics half must
land before the frontend or every folder falls back to the pre-brain shape. See
[Deploying](#deploying).

`server/team_scout.py` + `server/test_team_scout.py` (107 checks, no database),
wired through `server/team_analysis.py`. Brain version **`team-scout-2.0`**,
published on every report and frozen into `coach_match_plans.engine`.

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

## 10. Still owed

- **No browser pass.** `/api/analytics` needs the VPS key and 500s under
  `vite dev`, which is the standing reason these screens are checked against
  production. The projection block and the badges have been typechecked and
  unit-tested; they have not been **looked at**.
- **The 30-case review ran against a stand-in seed pool.** Worth re-running
  against the live route after deploy, where `seeds()` is the real 680-deck pool
  — the variant count is the figure that should move.
- **`PER_PLAYER_TOP_N` is 5 and unverified on a wide board.** Ten teammates at
  five rows each is a taller board than the one that shipped; it may want to be
  4, and that is a judgement to make while looking at it.
