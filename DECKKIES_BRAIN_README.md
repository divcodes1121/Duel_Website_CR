# DECKKIES BRAIN

The permanent engineering memory of the Deckkies Brain project.

This file is written for a Claude session that has **no conversation history**.
Everything in it is either verified against the repository at the commit named
in the handoff, or explicitly marked `Not verified.`

Created 2026-09-12 by the Phase 0 repository audit. Nothing was implemented in
that session; this document is its entire output.

---

```
============================================================
MANDATORY DECKKIES BRAIN CLAUDE PROTOCOL
============================================================

Before doing ANY work:

1. Read this entire README.

2. Understand CURRENT PHASE.

3. Understand CURRENT OBJECTIVE.

4. Read FAILED APPROACHES.

5. Read DEADLOCKS.

6. Read ARCHITECTURAL DECISIONS.

7. Read DATA LIMITATIONS.

8. Read the previous SESSION HANDOFF.

9. Do not repeat failed work without a specific reason.

10. Do not skip phases.

11. Do not modify frozen components without explicit approval.

12. Do not invent unavailable data.

13. Do not confuse observed facts with inferred behavior.

14. Do not introduce future information into historical evaluation.

15. Do not silently modify the baseline.

16. Do not deploy unless explicitly instructed.

17. Do not delete historical findings.

18. Preserve experiments and failures.

19. Update this README after meaningful work.

20. At the end of every session, update SESSION HANDOFF.

============================================================
```

**The single most important prior document is
[`server/ml/evaluation/phase22-final-spec.md`](server/ml/evaluation/phase22-final-spec.md).**
It is a signed contract, not a proposal. Twenty-one research phases closed into
it. Read it before proposing any model change. Section 21 of this file
summarises what it forbids, but the spec is the authority.

---

## 1. PROJECT MISSION

Deckkies Brain is intended to become a persistent behavioural intelligence
system that learns, from hundreds of thousands of real Clash Royale duel
observations, what a specific player is likely to bring next — and improves
every time it is wrong.

The target loop:

```
observe -> predict -> duel happens -> compare -> score -> learn -> persist -> predict again
```

The knowledge must survive new battles, server restarts, model updates and
Claude sessions.

**What it is not.** It is not a replacement for the existing predictor until it
has beaten it offline on the existing benchmark. It is not a psychological
model. It is not an LLM that writes probabilities.

### ⚠ REVISED BY PHASE 1 (2026-09-12) — read this before the subsection below

```
PREVIOUS CONCLUSION (Phase 0)
  The Brain's opening is the native duel substrate in battle_raw, which the
  frozen engine has never read. Raising candidate coverage from that substrate
  is the highest-value unbuilt component (decision A14).

NEW EVIDENCE (Phase 1, measured on 93,541 unique duels / 226,046 games)
  72.47% of duel participants appear in exactly ONE duel. 57.34% of evaluated
  steps involve a subject with no prior duel at all. Duel-derived history moves
  the zero-pool share 76.59% -> 59.94%, i.e. +16.65 points against a 20-point
  gate, and the CEILING for the substrate is 19.25 points. Meanwhile `battles`
  history ALONE — the table the frozen engine already reads — reaches 55.93%,
  which is BETTER than duel history alone.

NEW CONCLUSION
  The duel substrate is NOT the Brain's opening. It is an excellent factual
  record and a poor basis for per-player prediction, because the population is
  transient. The coverage problem is real and is solved by using a player's
  FULL known deck vocabulary, which needs no new substrate.

WHY IT CHANGED
  Phase 0 inferred the opportunity from the substrate's SIZE (49,963 series)
  and from the fact that production ignores it. It never measured how many
  DISTINCT PEOPLE that size represents, or how often they recur. Size is not
  coverage.
```

The subsection below is the Phase 0 reasoning, preserved unedited as the record
of what was believed and why. **Its conclusion is superseded.**

### ⚠ REVISED AGAIN BY PHASE 2 (2026-09-12) — the largest correction so far

```
PREVIOUS CONCLUSION (Phases 0 and 1)
  The Brain must be built. Five of seven loop stages exist; Learn and Persist
  are missing; no persistent player object exists anywhere.

NEW EVIDENCE (Phase 2)
  Phases 0 and 1 audited THIS repository and the bot's DATABASE. Neither
  audited the BOT'S SOURCE (76 modules at ~/Desktop/Clash_Bot). It contains a
  complete, tested learning system - 9 modules, 280 passing tests:
    recommendation_tracking.py   prediction memory + outcome reconciliation
    recommendation_learning.py   calibration + conjunctive promotion gates
    experiment_manager.py        randomised experiments, logged propensities
    artifacts.py                 versioned, checksummed model registry
    knowledge_graph.py           persistent typed relationship store
    knowledge_mining.py          FDR-corrected pattern discovery
    opponent_profile.py          per-player behavioural statistics
    counterfactual_eval.py       counterfactual policy evaluation
    shadow_report.py             promotion decisions from a shadow log
  match_outcomes() RUNS IN PRODUCTION EVERY POLL. It has matched nothing
  because CLASH_W3_MODE defaults to "off" and is absent from the live env,
  so no recommendations are ever recorded.

NEW CONCLUSION
  The Brain is largely ALREADY BUILT and switched off behind ONE FLAG.
  The remaining work is mostly configuration and validation, not construction.
  DO NOT REBUILD any of the nine modules (section 16 of the Phase 2 artifact).

WHY IT CHANGED
  Phase 0 searched this repo and found nothing, and concluded nothing existed.
  The writers were never in this repo. A table with no writer in the codebase
  you are reading means you are reading the wrong codebase.
```

Full artifact: **`DECKKIES_BRAIN_PHASE2_INFRASTRUCTURE_AUDIT.md`**

### ⚠ NARROWED BY PHASE 4 (2026-09-12) — one of Phase 2's nine components does not do what it says

```
PREVIOUS CONCLUSION (Phase 2, carried into Phase 3)
  kg_edges.APPEARS_AFTER is "card->card across consecutive games, 493,696
  observations - genuine card-transition evidence, and the raw material for
  'players replace A with B'." Phase 3 listed it as the answer to card
  switching. It was the largest unexamined substrate left.

NEW EVIDENCE (Phase 4, traced in the bot's source, verified by arithmetic)
  The write is a full 8x8 CARTESIAN PRODUCT - every card of game i against
  every card of game i+1 - and the module never computes a set difference.
  Worse, duel_split.split closes a series the instant a new deck shares ONE
  card with anything already played, so the two decks are CARD-DISJOINT BY
  CONSTRUCTION: a -> a is impossible and a one-card swap ENDS the series and
  is discarded. And 493,696 / 64 = 7,714 exactly, 339,220 / 28 = 12,115
  exactly, so the corpus is 60 players / 4,401 series / 7,714 real events.
  Nothing reads the relation: two source references in the whole tree.

NEW CONCLUSION
  It is ordered LOADOUT-COMPANION co-occurrence at card granularity - the
  card-level shadow of what coach.next_decks already does at DECK level, per
  player, in production. It is not a foundation for card intelligence at any
  sample size, because the defect is in the write, not the volume.
  STOP on APPEARS_AFTER. The real substrate is ml/dataset edit events over
  `battles`, where the OIE's own Phase 3 measured the signal in 2026-08.

WHY IT CHANGED
  Phase 2 read the relation's NAME and its row count and did not open the
  writer. Phase 4 opened the writer. See FAILED APPROACHES #17.
```

Full artifact: **`DECKKIES_BRAIN_PHASE4_CARD_INTELLIGENCE.md`**

### The honest framing of the opportunity (Phase 0 text, superseded above)

The existing engine (the OIE, section 4) was frozen after twenty-one phases
with a deliberately small claim: *the opponent's most recent deck is the
prediction.* That claim is small because the measurements forced it there, and
three of the branches that closed were closed by **ceilings in the data**, not
by model quality. A better model cannot move a ceiling.

The Brain is worth building anyway, for one specific reason that is recorded in
the research itself and has never been exploited:

> **The frozen engine has never seen a duel.**
>
> `ml/production/source._rows_to_plays` drops every row that is not exactly 8
> distinct cards. A native duel row in `battles` carries a flattened 16/24-card
> loadout. Of 1,238 native duel rows in the Phase 20D census, **zero** carry 8
> cards. The exclusion is structural. Phase 20D's conclusion was that the
> engine's `duel` domain is actually *practice* (97.8% Friendly /
> Showdown_Friendly).

Meanwhile `battle_raw.raw_json` **does** hold real duels — ordered per-game
decks and per-game crowns for both sides — and Phase 21A parsed **49,963
series / 119,865 games / 20,702 distinct subjects** out of it. The production
engine does not read that table.

So the Brain's opening is not "a better model on the same data". It is **a
substrate the frozen engine was never allowed to look at.** See section 6.3 and
the roadmap.

---

## 2. CORE PRINCIPLES

These are inherited from the existing research programme, which enforced them
in code and in tests. They are not aspirational.

1. **Evidence over assumptions.** Every number in this file names where it was
   measured. A claim with no measurement says `Not verified.`
2. **The baseline is sacred.** `Recent` (the most recent deck) is the incumbent
   and the benchmark. Nothing replaces it without beating it on a leak-free
   held-out evaluation, reported player-macro as well as pooled.
3. **No temporal leakage.** Section 17. This is enforced by
   `policy.assert_no_future` in production and by time-split construction in
   every evaluation module.
4. **Persistent learning, but never blind.** Evidence + confidence + recency +
   sample size + validation + versioning. Never "observation arrives, weights
   move".
5. **Confidence must be evidence-based, and must rank before it is shown.** The
   project has already shipped band accuracies that were wrong by ~20 points
   and had to withdraw them. `policy.BAND_SUPPORTED` exists because of that.
6. **Separate observed fact / inferred pattern / model estimate / speculation.**
   Every Brain output must carry which of the four it is. This is a permanent
   rule, not a phase-1 nicety.
7. **Reversible experimentation.** Artifacts are versioned and never
   overwritten (`band-calibration-v1.json` is frozen and
   `band-calibration-v2-candidate.json` exists unpromoted, deliberately).
8. **Degrade, never crash.** Every failure path returns the recent deck with
   `degraded: true` and a plain reason. An analytics screen showing the current
   deck is useful; one that 500s is not.
9. **Production never trains.** `policy.forbid_training` replaces `fit` with a
   raise on every loaded model.
10. **Every important decision is documented here, with its alternatives and
    why they were rejected.**
11. **Failed approaches are never deleted.** Section 20. The negative results
    took the most work and are the easiest to accidentally redo.

---

## 3. CURRENT SYSTEM

Deckkies is a Clash Royale duels companion: a Vite + React 18 + TypeScript SPA
on Vercel (`deckkies.com`), plus a stdlib-only Python analytics service
(`server/app.py`) running on a Contabo VPS at `/opt/royalweb/` behind Caddy at
`api.deckkies.com`, reading a SQLite database written by a separate Discord bot
at `/opt/clashbot/`.

**The two halves deploy separately and by different mechanisms.** The frontend
goes out via a git push to Vercel; `server/` is copied to the VPS by hand with
`scp`. A stale sibling module on the VPS is the normal failure mode here, not
an exotic one. Any Brain work that spans both halves must land the server side
first.

### Relevant components

| component | file | what it is |
|---|---|---|
| Opponent Intelligence Engine (OIE) | `server/ml/` | the frozen predictor. **`CLASH_OIE=off`** — not live |
| Coach Assist | `server/coach.py` | the live duel advisor. This IS the shipped prediction product |
| Duel Zone | `server/duel_zone.py` | series reconstruction + companion ranking |
| Duel combinations | `server/duel_combos.py` | the single duel reader; mode taxonomy |
| Deck Counter | `server/deck_counter.py` | the matchup evidence ladder |
| Team Analysis | `server/team_analysis.py` | squad-scale opponent-aware recommendation |
| 2v2 pairs | `server/duo_pairs.py` | the precedent for a separate derived SQLite store |
| Tag tracking | `server/tracking.py` | enrolment queue, own SQLite |

### What is live vs dark

| thing | state | gate |
|---|---|---|
| Coach Assist (prediction + suggestion) | **LIVE**, pro tier | `PRO_ONLY_SECTIONS` |
| OIE opponent read | **DARK** | `CLASH_OIE=off` (default), plus `OIE_ALLOWLIST` on the Vercel proxy |
| OIE shadow logging | **DARK** | `CLASH_OIE=shadow` |
| Team Analysis | **LIVE**, trial and up | — |
| Deck tuner (card swaps) | **LIVE**, admin-only at the route | cost: ~2.6 s full sibling scan |

`CLASH_OIE` defaults to `"off"` — verified at `server/coach.py:1124`. Nothing in
`server/ml/production/` runs against user traffic today.

---

## 4. CURRENT PREDICTION ENGINE (the OIE) — FROZEN

`server/ml/production/`. The Coach imports this package and never the research
modules. Entry point: `predictor.predict_for_tag(tag, domain)`.

### 4.1 The one-sentence contract

> The opponent's most recent deck is the prediction. The model layer may add a
> confidence signal and optional secondary suggestions, and may never replace
> it.

### 4.2 Pipeline, as actually implemented

`server/ml/production/predictor.py:predict()`:

1. `policy.assert_no_future(plays, cutoff_ts)` — filter anything at or after
   the prediction moment.
2. `recent_deck` = sorted cards of the chronologically last play. **This is the
   answer.** Everything after this only decorates it.
3. `adapter.build_context()` → `(view, shell)`.
4. Build a `PredictionExample` over the **SHELL ONLY**, not the whole history.
5. `_change_probability()` → `P(change)` from the M2 artifact, or a counting
   fallback (`len(prior_edits) / (cluster_size - 1)`) with `degraded = True`.
6. `candidates.C1WideOneCard` generates 1-card edits over the player's whole
   card vocabulary; capped at 40.
7. `shortlist.build()` ranks them.
8. `calibration.band(domain, p_change)` → `high` / `medium` / `low`.
9. **Four policy guards run last, in order:** `enforce_primary` →
   `drop_alternatives_matching_primary` → `cap_alternatives` →
   `enforce_degraded_has_no_alternatives`.

### 4.3 Inputs and representations

| axis | representation | where |
|---|---|---|
| Player | a tag string. **No persistent player object exists.** | — |
| History | ordered `DeckPlay(battle_time, mode, cards, result, opponent_win_condition)` | `ml/dataset.py:39` |
| Deck | `tuple` of 8 card keys; identity is the sorted signature | `ml/dataset.py` |
| Shell / cluster | plays grouped at **>= 6 shared cards** (`COUNTER_MIN_OVERLAP`) | `ml/dataset.py:cluster_prefix` |
| Current shell | the cluster containing the most recent play, by **exact membership** | `adapter.current_shell` |
| Card | a string key. No embedding, no learned representation. | — |
| Recency | 5 / 10 / 20-play count windows, streak length per card | `adapter.build_context` |
| Opponent | `opponent_win_condition` only — a single archetype string | `source._read_rows` |

**`adapter.current_shell` is load-bearing and its docstring records why:**
using `cluster_containing` (>=6-card overlap against a cluster's last member)
returned a **different shell 25% of the time** in production, because a player
with 49 clusters has several that overlap each other. Symptom: Rule 1 firing,
and candidates generated from a shell the player is not on.

### 4.4 The change model

| property | value |
|---|---|
| artifact | `server/ml/artifacts/m2-change-v1.json` |
| version | `m2-change-v1` |
| features | `phase2-21` — 21 features, **order is part of the contract** |
| input | the SHELL, not the whole history |
| output | `P(change) ∈ [0,1]` |
| class weighting | **off**, on evidence (it damaged PR-AUC, ROC-AUC, F1 and Brier) |
| ROC-AUC | 0.932 competitive / 0.803 practice (Phase 2) |
| training in production | **forbidden** — `policy.forbid_training` |
| guard | feature-order mismatch against `features.FEATURE_NAMES` refuses the artifact |

The 21 features (`server/ml/features.py:22`), in contract order:

```
cluster_size, n_variants, variant_entropy, consecutive_identical,
stable_card_count, volatile_card_count, modal_is_recent, distinct_cards_seen,
plays_since_change, log_hours_since_change, log_hours_since_last_play,
churn_lifetime, churn_last5, churn_last20,
prev_was_win, win_rate_last5, loss_streak,
log_edit_count, one_card_edit_share, two_card_edit_share,
is_duel
```

**Two of these are dead in production. See KNOWN BUGS #1.**

> **⚠ MEASURED BY BRAIN PHASE 8 (2026-09-13): the ROC-AUC row above describes the
> model at battle-time stamps, NOT the engine production runs.** On Phase 2's
> own held-out split with the frozen artifact, production's `timestamp="9999"`
> gives **0.858 competitive / 0.760 practice** (Brier 0.0707 / 0.3071) against
> 0.932 / 0.803. Also, since the Phase 23 rename **`is_duel` is 0 on every
> practice read** (KNOWN BUGS #11). And the 0.932 depends on
> `log_hours_since_last_play` measured at the moment of the predicted battle,
> which production cannot supply (KNOWN BUGS #12).
> Full artifact: `DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md`.
>
> **⚠ PHASE 8 SESSION 2 (2026-09-14):** the numbers above reproduce exactly.
> "Cannot supply" is **superseded**. The request time is a valid serve-time
> stamp. Scored on the steps each request is about, it beats `9999`:
> competitive Brier −0.1596 [−0.1819, −0.1373] at a 36-hour-late read, and ROC-AUC
> +0.0494 [+0.0330, +0.0702] under a random-clock request model. A read 1 h
> before the battle keeps 94% of the 0.932-level gain. This is harness frame
> only; production frame is unmeasured (artifact §27).
>
> **⚠ PHASE 8b (2026-09-14): PRODUCTION FRAME NOW MEASURED; GATE PASS.** In
> production's own order, with only arrived battles visible, competitive
> random-clock reads score ROC-AUC **0.619** under `9999` and **0.673** under the
> request stamp (+0.0545 [+0.0381, +0.0698]). Brier (macro) goes −0.0963
> [−0.1103, −0.0828]. **Quote 0.619, not 0.858 or 0.932, as the shipped engine in
> production order.** Artifact: `DECKKIES_BRAIN_PHASE8B_PRODUCTION_ORDER_TIMESTAMP_REPLAY.md`.
>
> **⚠ PHASE 10 (2026-09-15): THOSE FIGURES WERE RECOMPUTED EXACTLY** from Phase 8b's
> recorded per-read data with independently written code (AUC, CI bounds, Brier, bands,
> ordering, all 8 gate readings). The fix is **CONDITIONAL — approvable** for a dark
> implementation on explicit acceptance of the alternative regression; the implementation
> contract is fixed. Artifact: `DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md`.
>
> **⚠ PHASE 11 (2026-09-15): IMPLEMENTED LOCALLY — NOT COMMITTED, NOT DEPLOYED.** The account
> holder accepted the regression; `predictor.py:120` now passes `cutoff_ts or _request_stamp()`
> (UTC). The implementation reproduces the recorded condition B on all 357,426 Phase 8b reads
> (`pB` max |Δ| 4.44e-16) and all 128,816 Phase 8c records (band, note, list, count), 0 mismatches.
> **The VPS still runs `"9999"`.** Artifact: `DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md`.
>
> **⚠ PHASE 12 (2026-09-15): COMMITTED LOCALLY — NOT PUSHED, NOT DEPLOYED.** The Phase 11 change,
> its tests, the repository docs and this README went into ONE commit on `main` (parent `c4fc65e`;
> the hash is in `DECKKIES_BRAIN_PHASE12_COMMIT_EVIDENCE.md`, since a file cannot name the commit
> that contains it). The Phase 8b/8c evidence is preserved, byte-identical, in the gitignored
> `brain-evidence/phase8/`; only its `MANIFEST.md` is tracked. **Production is unchanged: the VPS
> still runs `"9999"` and `CLASH_OIE` is `off`.**

### 4.5 The seven safety rules

`server/ml/production/policy.py`. Each is a function with a test.

| # | rule | enforced by |
|---|---|---|
| 1 | Recent cannot be replaced | `enforce_primary`, applied last |
| 2 | ML failure → Recent | `safe_fallback` |
| 3 | Generation failure → Recent | `safe_fallback` |
| 4 | Low confidence never shows more alternatives than High | `ALTERNATIVE_CAPS = {high:2, medium:1, low:0}` |
| 5 | No future information enters a prediction | `assert_no_future` |
| 6 | Production never trains | `forbid_training` |
| 7 | Duel legality where applicable | **not applicable today** — no duel coverage |

Rule 7 is the tell. The duel card-reuse rule is **absolute** (21,432 real deck
pairs, zero overlap — Phase 21A) but production has nothing to apply it to.

### 4.6 Output contract — `opponent-read-v2`

```json
{ "enabled": true,
  "read": {
    "primary":      { "cards": ["..."], "confidence": "high", "basis": "recent" },
    "alternatives": [ { "cards": [], "out": [], "in": [], "confidence": "medium", "evidence": [] } ],
    "note": "", "degraded": false, "bandShown": true } }
```

**The UI never receives:** weights, logits, feature names or values, cluster
internals, model or artifact names, training state, or band accuracy
percentages. `changeProbability` was removed from the body in Phase 23 Fix 1.

`BAND_SUPPORTED = {"competitive": True, "practice": False}` — practice ships
with no band and therefore no alternatives, because its bands **do not rank**
(section 12).

### 4.7 Known weaknesses of the baseline

1. **It has never seen a duel.** Section 1.
2. **Two temporal features are always zero in production.** KNOWN BUGS #1.
3. **The band magnitudes were wrong by ~20 points** and are now qualitative
   only. The *ordering* survives for competitive and does not for practice.
4. **The alternatives address ~2% of real steps.** The 1-card edit is
   1.8% / 2.3% of production steps. The spec says this is the first thing to
   remove if the UI needs simplifying.
5. **It is stateless.** Every call rebuilds everything from a 60-day database
   read. Nothing it learns survives the call. This is the gap the Brain exists
   to close.

---

## 5. CURRENT COACH ASSIST

`server/coach.py` (56 kB) + `src/components/Analytics/CoachAssist.tsx`.
**This, not the OIE, is the live prediction product.** It is materially more
capable than the OIE and any Brain work must beat *it*, not just Recent.

### 5.1 Two windows

| window | inputs | question |
|---|---|---|
| Duel Prediction | one tag | which decks this player opens with; given what they have shown, what is left |
| Suggestion | two tags | the same read, then MY still-legal decks ranked by expected win rate |

### 5.2 The rule the whole file rests on

A duel loadout is three decks that **cannot share a card**. Every deck revealed
removes eight cards from what the player can still bring. By game 3 the field
is usually down to a handful of lists they actually own.

**This constraint, not prediction, is where most of the measurable accuracy
comes from.** Phase 21A section 11 measured it directly: against a
"guess uniformly among the same legal candidates" baseline, the ranker adds
only **+1.7 to +4.9 points** at small pools, and goes **negative (−2.8) at
pool ≥ 5** — exactly where ranking would have to do real work.

### 5.3 Functions that matter

| function | what it produces |
|---|---|
| `opening_decks(tag)` | ranked game-1 decks with `prob`; `basis` says *first-game history* or *overall play rate* |
| `next_decks(tag, revealed)` | companions still legal given what is revealed |
| `observed_sequences(revealed, hist)` | the real series where they opened like this, and what came next |
| `opponent_next(opp_tag, opp_played)` | **a probability distribution over their legal decks** |
| `win_prob(mine, theirs, snap)` | P(win) walked lazily down the evidence ladder, carrying the rung |
| `_expected(mine, opp_decks, snap)` | **probability-weighted expected win rate across the whole opponent distribution** |
| `_spread(opp_decks)` | that distribution collapsed to archetype weights |
| `tune(my_deck, opp_decks)` | card-level swaps (`DECK_TUNER.md`); admin-only, ~2.6 s |
| `suggest(...)` | the recommendation, with `basis` = *expected win rate* or *most played* |

**The thing the Brain prompt asks for as a future feature already exists.**
`_expected` weights each candidate response deck by the opponent's per-deck
probability and **drops decks with no evidence rather than scoring them 50%** —
because an invented coin flip pulls a real edge toward the middle. Multi-deck
coverage reasoning is live today.

### 5.4 `OPP_HISTORY_MASS = 0.7`

When a player's own history is too thin, meta decks top up the candidate list,
but their own history keeps 70% of the probability mass. A thin read never
collapses into one overconfident guess. This is an existing, working answer to
the cold-start problem.

### 5.5 What Coach Assist deliberately does NOT model

**Counter-sniping.** Measured by the upstream bot on **3,569 leak-free
trials**: it made top-1 accuracy **three times worse (8.3% → 2.7%)**. The deck a
player actually brings scores 0.4856 against the opponent's last deck, versus
0.4961 for the average deck they could have brought. *Players do not
counter-pick the previous game.* Recency weighting and per-opponent tendency
were tested the same way and neither beat plain usage.

Source: `server/coach.py` module docstring, lines 55-63. The trial data is in
the bot's repository, not this one — `Not verified here.`

**This is the single most important negative result for the Brain**, because
"A expects B to play X, so A plays Y" is exactly what section 7 of the original
Brain brief asks for. It has been measured and it lost.

---

## 6. CURRENT DATA SOURCES

### 6.1 `battles` — the primary table

```
Source          SQLite, written by the Discord bot at /opt/clashbot/clashdb.py
Location        VPS /var/clashbot/battles.db  (~33 GB). NOT on this machine.
Access          server/clash_data.py:connect(), mode=ro, ALWAYS read-only
Fields          id, player_tag, battle_time, game_mode, opponent_tag,
                opponent_name, result, player_deck_hash, player_card_keys,
                opponent_card_keys, player_win_condition, opponent_win_condition,
                opponent_deck_hash, player_crowns, opponent_crowns,
                player_evo, opponent_evo, player_hero, opponent_hero,
                player_towers, opponent_towers
Historical      retention 304 days (CLASH_RETENTION_DAYS). Oldest row 2026-06-01.
                An older month (2026-05-01 -> 2026-08-25) exists ONLY in
                archive.db on the unplugged H: drive.
Update          the bot polls the CR API every 2 hours
Reliability     high for 1v1. 2v2 rows were misrepresented as duels until the
                2026-09-10 guard; TeamVsTeam no longer enters this table.
Limitations     ONE player_card_keys and ONE opponent_card_keys per row.
                A native duel row flattens 16/24 cards into player_card_keys.
                battle_time format: "YYYYMMDDTHHMMSS.mmmZ"
Brain usage     the chronological substrate for competitive/practice history.
                This is what the frozen engine already reads.
```

> **⚠ "Update: the bot polls every 2 hours" is SUPERSEDED by Phase 8b
> (2026-09-14).** The loop ticks every 2 h, but the skip guard
> (`since_h < POLL_INTERVAL_HOURS × 0.9`) measures from the pass's *finish*. Passes
> now take 20–21 min, so every other tick is skipped ("full pass finished 99 min
> ago"). **Effective cadence is ~4 h** (`bot_health`, all polls since
> 2026-09-12). Measured arrival lag for tracked players: median 1.89 h, p95
> 3.79 h, max 9.0 h. Also: **`battles` has no arrival column** (only an
> autoincrement `id`), and **the battlelog returns at most 30 battles**, which
> 13.2% of tracked player-polls hit (KNOWN BUGS #15–#16).

### 6.2 `battle_raw` — the payload archive

```
Source          same bot. Raw CR API JSON per battle.
Location        VPS, ~44.7 GB
Fields          player_tag, battle_time, game_mode, schema_version, stored_at,
                raw_json
Historical      subject to the raw-cap valve. Coverage of historical 2v2 is
                78.2%; native-duel coverage measured at 99.2% (Phase 21A).
Update          written at battle ingest; stored_at is arrival time
Reliability     schema_version 1 on 100% of native duel rows, 0 NULL
Limitations     game_mode has NO index; SELECT DISTINCT game_mode takes ~4m05s.
                The raw-cap valve purges it; it has destroyed payloads before.
Brain usage     *** THE STRATEGIC ASSET. See 6.3. ***
```

### 6.3 `battle_raw.raw_json` → real duels

**This is the substrate the frozen engine has never read.**

```
team[0].rounds -> [{cards: [8], crowns, elixirLeaked, towerHitPoints}, ...]
```

Present for **both sides**, round counts matching, 8 cards per round, each round
carrying its own crowns. A duel therefore decomposes into **ordered games with
per-game decks and per-game results, for both players.**

Measured by Phase 21A (`server/ml/evaluation/phase21a.py`, report at
`server/ml/results/phase21a-report.txt`):

| quantity | value |
|---|---:|
| native duel modes | `CW_Duel_1v1`, `Duel_1v1_Friendly` |
| series parsed | 49,963 |
| games | 119,865 |
| distinct subjects | 20,702 |
| transitions (train / test) | 97,824 / 41,980 |
| archetypes seen | 23 |
| games by number | game 2: 29,978, game 3: 12,002 |
| deck pairs checked for card overlap | 21,432 — **zero overlap, 100% disjoint** |
| card names resolving against the project vocabulary | 100%, zero unknowns |

Both sides of a duel are subjects, so an opponent's next deck can be predicted
from their own revealed decks.

### 6.4 Card data

```
src/data/cards.json      123 cards (Troop/Building/Spell), official Supercell id
src/data/cardMeta.json   can_evolve / can_be_hero / is_champion / is_win_condition
src/data/cardRoles.json  122 of 123 cards. targets, hitsAir, transport, damage,
                         range, roles[], counters[], counteredBy[]
```

**`cardRoles.json` is hand-authored, not learned.** It is GENERATED by
`scripts/build-card-roles.py` from `Deckkies_Master_Card_Manual.md`, a prose
document. Minion Giant has no `CARD:` block in that manual, so the generated
file legitimately holds 122 of 123 and `test_deck_harmony.py` carries an
`AWAITING_MANUAL` exemption naming it.

**`server/` needs `../src/data/` beside it.** `duel_combos._load_cards()` reads
both JSON files from `<repo>/src/data`. Deploying `server/` alone makes every
card `elixir: 0, is_win_condition: False` — silently. Check `cardData` in
`/api/analytics/status` after any deploy.

### 6.5 Derived / persistent stores that already exist

| store | location | what it holds | gitignored |
|---|---|---|---|
| shadow log | `server/ml/results/shadow-log.jsonl` | 2,620 prediction observations | **yes** |
| cohort tags | `server/ml/results/cohorts/tags*.json` | 5,680 tags across 6 files | **no — tracked** |
| M2 artifact | `server/ml/artifacts/m2-change-v1.json` | frozen model weights | no |
| band calibration | `server/ml/artifacts/band-calibration-v1.json` | frozen cut points | no |
| v2 candidate | `band-calibration-v2-candidate.json` | **deliberately unpromoted** | no |
| 2v2 pairs | `server/.duo_pairs.db` (VPS) | 1.48M teammate partnerships | yes |
| tag queue | `server/.tracking.db` | enrolment requests | yes |
| meta snapshot | `server/.meta_snapshot.json` | background meta board | yes |
| counter snapshot | `server/.counter_snapshot.json` | background matchup matrix | yes |

**`server/ml/results/*` is gitignored** (`.gitignore:68`, with
`!server/ml/results/cohorts/` negating it for the cohorts only). Verified:
`git ls-files server/ml/results/` returns **7 files, all cohorts**. Every
`phase*-report.txt` — the entire measured evidence base of twenty-one research
phases — exists **only on this machine and has no backup.** See DEADLOCKS #3.

### 6.5b Tables Phase 0 never saw (discovered Phase 1, 2026-09-12)

Phase 0 described the bot database from the repository's queries. Listing
`sqlite_master` directly found **seven tables nobody in this project had
mentioned**, three of which matter a great deal to the Brain.

| table | rows | what it is |
|---|---:|---|
| **`duel_timeline`** | **783,949** | the bot's own duel record: `battle_time`, `unix_time`, both tags, mode, result, both card-key lists, both win conditions, both crown counts. PK `(player_tag, battle_time)`, indexed on player+time **and on opponent** |
| **`recommendation_events`** | **4** | prediction memory: `recommendation_id`, `created_at`, both tags, `policy_version`, `model_version`, `recommended_deck`, `expected_wr`, `confidence`, `evidence_tier`, `sample_size`, `prediction_entropy`, **`predicted_distribution`** |
| **`recommendation_outcomes`** | **0** | the other half: `actual_deck`, `used_recommendation`, `modified_recommendation`, `cards_changed`, `won`, `crowns`, `matched_confidence`, `matcher_version` |
| `kg_edges` | 27,904 | a knowledge graph: `src_kind/src/rel/dst_kind/dst`, `count`, `wins`, `trials`, `count_30d`, `count_60d`, `first_seen`, `last_seen` |
| `kg_findings` | 1,460 | derived findings: `finding_type`, `subject`, `object`, `metric`, `value`, `support`, `confidence`, `importance`, **`p_value`**, **`survived_fdr`**, `first_observed`, `last_observed` |
| `suggestion_feedback` | 4 | user-facing feedback loop, with `pred_correct` and `deck_won` |
| `player_decks` | 390 | a small per-tag deck sighting log |

**Three things follow, and they change the Brain's design inputs.**

1. **The prediction-memory schema the Brain needs already exists and is
   EMPTY.** `recommendation_events` has 4 rows and `recommendation_outcomes`
   has **0**. Somebody designed exactly the observe → predict → outcome → score
   loop this project has been specifying, wired the schema, and it was never
   populated. It is a **precedent and a warning**, not a data source: schema is
   the easy half.
2. **A pattern-memory schema exists too, and it is populated.** `kg_findings`
   carries 1,460 findings with p-values and FDR survival — i.e. someone already
   solved "how do you stop a pattern store filling with noise". README section
   15 said no pattern memory existed anywhere. **That was wrong about the bot's
   database**; it remains true of this repository.
3. **`duel_timeline` is a third duel substrate** with 783,949 rows and an
   **opponent index** — the only opponent-keyed index found anywhere. Phase 1
   did not use it (it reused Phase 21A's raw-payload path for comparability),
   so its contents, mode scope and overlap with `battles` are **Not verified.**

**All seven are in the BOT's database, which this project opens `mode=ro` and
must never write to** (decision A8). They are evidence about what has already
been tried, not storage the Brain may use.

### 6.6 Matchup aggregate

`pair_matchup_agg` (deck_a, deck_b, games, ...) in the bot database, read by
`deck_counter.py`. Has **no mode filter at all** — it pools duel, friendly and
ladder. `team_analysis.py` records that picking a deck from one population and
the figure beside it from another is a known fault class.

### 6.7 Player tag population

| population | size | source |
|---|---:|---|
| bot tracked roster | 4,910 | `tracked_players` |
| recruit ceiling | 12,000 | `CLASH_RECRUIT_CEILING` |
| 2v2 participants discovered | 866,226 | `duo_participants` |
| duel subjects in `battle_raw` | 20,702 | Phase 21A |
| research cohorts on disk | 5,680 across 6 files | `cohorts/tags*.json` |

**Only ~2,339 of 866,226 2v2 participants are tracked.** Opponents in a duel are
usually NOT tracked players, so their history exists only inside duel payloads.
This is the dominant data limitation — see section 23.

---

## 7. PLAYER STATE

What the original Brain brief asks for, against what exists. Every row carries
its evidence.

| item | status | evidence |
|---|---|---|
| Player tag | **EXISTS** | `battles.player_tag` |
| Historical deck preferences | **EXISTS** | `coach.opening_decks`, `dz.cluster_player_decks` |
| Recent deck preferences | **EXISTS** | `adapter.build_context` recent_counts 5/10/20 |
| Archetype preferences | **EXISTS** | `coach._archetype_odds`, `deck_counter.archetype_of` |
| Stable cards | **EXISTS** | feature `stable_card_count` (>=90% of shell plays) |
| Volatile cards | **EXISTS** | feature `volatile_card_count` |
| Deck switching behaviour | **PARTIALLY** | `P(change)` per shell only; no cross-shell switch model |
| Card switching behaviour | **PARTIALLY** | `prior_edits` (out/in pairs) within the current shell only |
| Deck transition patterns | **PARTIALLY** | `substitution.S2Transition` + `GlobalStats`; population-level, not per player |
| Card transition patterns | **PARTIALLY** | same |
| Recent trends | **PARTIALLY** | count windows, no trend estimator |
| Long-term trends | **DOES NOT EXIST** | history is capped at `HISTORY_DAYS = 60` and `MAX_ROWS = 1200` |
| Opponent-specific tendencies | **DOES NOT EXIST** | and measured to be **absent** — see FAILED #6 |
| Matchup-specific tendencies | **DOES NOT EXIST** | Phase 3 found opponent archetype indistinguishable from zero |
| Surprise-pick tendency | **DOES NOT EXIST** | — |
| Predictability | **PARTIALLY** | `ml/predictability.py` exists; Phase 6 found its curve carried a selection oracle |
| Behavioural volatility | **PARTIALLY** | `churn_lifetime/last5/last20`, `variant_entropy` |
| Win/loss-related changes | **PARTIALLY** | features `prev_was_win`, `win_rate_last5`, `loss_streak`. **Never validated as causal** |
| Prediction history | **PARTIALLY** | shadow log, 2,620 entries, **hashed and not per-player-readable** |
| Prediction accuracy | **PARTIALLY** | `shadow.reconcile()` exists; run offline, batch, never live |
| Confidence calibration | **EXISTS but withdrawn** | ECE 0.2806 competitive / 0.6097 practice; bands now qualitative only |
| Learned patterns | **DOES NOT EXIST** | — |
| Pattern evidence / strength / recency | **DOES NOT EXIST** | — |

### ⚠ THE TABLE ABOVE IS PHASE 0's AND IS PARTLY WRONG — corrected by Phase 2

```
PREVIOUS CONCLUSION
  Most player-memory items DO NOT EXIST; there is no persistent player object
  anywhere in the system.

NEW EVIDENCE (Phase 2, in the BOT's codebase)
  opponent_profile.build_profile() computes, per player: archetype/deck/spell/
  champion/building TRANSITION MATRICES, switch-after-loss and switch-after-win
  rates, game-1/game-2/DECIDER archetype distributions, deck and archetype
  repeat rates, cards changed per game - each with n, a Wilson interval and a
  confidence band, returning the string "Unknown" below a sample floor.
  kg_edges persists per-player preference with recency: USES (8,065),
  FAVOURS (808), OPENS_WITH (683), DECIDES_WITH (616), each carrying count,
  count_30d, count_60d, first_seen, last_seen.

NEW CONCLUSION
  The player REPRESENTATION exists, is tested (41 checks) and is better than
  anything this repo had planned. PERSISTENCE exists too, but covers only
  60 PLAYERS and is six weeks stale. Neither is connected to anything live:
  build_profile()'s only caller is coach_engine, which is dark, and nothing
  calls knowledge_graph.refresh().

WHY IT CHANGED
  Phase 0 searched the wrong codebase. See FAILED APPROACHES entry 14.
```

Re-read the table above as "not present **in this repository**". The accurate
summary is in the Phase 2 artifact, section 11.

### The structural gap (as stated in Phase 0 — still true of THIS repo)

**There is no persistent player object anywhere in the system.** Verified: no
table, no file, no class holds per-player derived state across requests.
`adapter.build_context()` recomputes everything from a database read on every
call, and the only caching is `source._cache` — a 120-second lease on **raw
rows**, explicitly chosen over caching derived state because the read is 99% of
the latency and caching the derivation "would have bought about two
milliseconds".

That is a correct decision for a stateless predictor and it is precisely what
the Brain must change.

---

## 8. DECK INTELLIGENCE

### Current

- **Identity** is the sorted 8-card signature. `deck_hash` in the bot;
  `",".join(sorted(cards))` in the ML layer.
- **Clustering** at **>= 6 shared cards** (`duel_zone.COUNTER_MIN_OVERLAP`),
  imported by `ml/config.py` rather than redeclared. Algorithm: exact variants
  first, most-frequent first, greedy assignment, representative follows the
  most-frequent variant. `cluster_prefix` returns membership;
  `cluster_player_decks` returns the production view. `test_ml_dataset.py` pins
  the two against each other so they cannot drift.
- **Archetype** = the priciest win condition (`deck_counter.archetype_of`).
  The project has recorded the caveat: *a win condition is a card, not a play
  style.* 23 archetypes observed in the duel population.
- **Representatives**: `deck_counter._representatives()` — the most-observed
  real deck of each archetype.
- **Deck harmony / tuner**: `server/deck_harmony.py`, `server/deck_tuner.py`,
  spec in `DECK_TUNER.md`.

### What the Brain needs

- A **loadout representation** — three decks as one object with the
  disjointness invariant. This does not exist anywhere and is the named
  prerequisite for native duel prediction (spec §5 rule 7, README "Future
  scope").
- Deck identity that survives a 1-card edit *for behavioural purposes* while
  staying exact for matchup purposes. The cluster is that today; whether 6 is
  the right threshold for the Brain has never been measured.
- Per-deck adoption / abandonment / re-adoption timelines. **Not built.**

---

## 9. CARD INTELLIGENCE

### Current

| source | nature |
|---|---|
| `cards.json` | 123 cards, id / elixir / rarity / type. Supercell ground truth |
| `cardMeta.json` | 4 boolean flags, hand-maintained |
| `cardRoles.json` | roles, counters, counteredBy for **122 of 123**. **Hand-authored prose, parsed** |
| `ml/vocabulary.py` | observed card vocabulary from play |
| `ml/substitution.py` | `S2Transition` + `GlobalStats` — population out→in transition counts |
| `ml/exit_model.py` | `E4Combined` + `PopulationExitStats` — which card leaves |

**Nothing about card strategy is learned from battle data.** `cardRoles.json`
is generated from a markdown manual a human wrote. The only learned card-level
objects are the exit and substitution statistics, which are **population-level,
not per-player**.

> **⚠ `kg_edges.APPEARS_AFTER` IS NOT A FIFTH ENTRY IN THAT LIST.** Phases 2
> and 3 treated its 493,696 observations as card-transition evidence. Phase 4
> traced the writer: it is an 8x8 Cartesian product over decks that are
> **card-disjoint by construction**, so it observes no substitution at all, and
> its real corpus is 7,714 events over 60 players. **`ml/substitution.py` is the
> only out→in object this project has.** See FAILED APPROACHES #17.

> **⚠ AND BRAIN PHASE 5 MEASURED THAT SUBSTRATE. IT WORKS.** On 29,503 real
> edit events: **112** global out→in displacement pairs survive FDR with a
> permutation null of **0–2**, and **777** per-player patterns across **255
> players** survive with a null of **0.0**. Rising cards displace role-coherent
> targets (`void`→`fireball`, `goblin-hut`→`tesla`, `berserker`→`knight`)
> **with no hand-authored card metadata in the calculation** — i.e. the thing
> `cardRoles.json` currently supplies by hand is partly learnable. Conditioning
> on archetype, matchup or result adds **0, 6 and 2** cells once the player and
> the outgoing card are known, which is why OIE Phase 3's S3/S4/S5 lost.
> Full artifact: `DECKKIES_BRAIN_PHASE5_CARD_ADOPTION.md`.

> **⚠ PHASE 6 QUALIFIES THIS, AND WITHDRAWS ONE PART OF IT.** Chronologically
> held out, per-player displacement used ALONE does **not** beat player
> frequency (+1.20 [−1.52, +3.94], ns at five cut points) because it abstains
> on 45.09% of events and loses 14 points there. **With backoff it wins
> decisively** — +18.65 [+12.54, +25.29] at support ≥3 — and
> `ml/substitution`, which already implements that backoff, beats the baseline
> by **+10.02 [+7.94, +12.21]**, with ablation showing the **player** layer is
> the necessary one. **The `ronin → mighty-miner` showcase is SUPERSEDED:**
> zero held-out events, and its "1.4% population rate" was a leave-one-out
> denominator the subject dominates (true population rate **15.84%**; that one
> player supplies 50 of 54 occurrences). The 777-finding census stands.
> Full artifact: `DECKKIES_BRAIN_PHASE6_CHRONOLOGICAL_DISPLACEMENT_REPLAY.md`.

> **⚠ PHASE 7 REMOVED THE EXIT ORACLE, AND THE ADVANTAGE DOES NOT SURVIVE.**
> With the outgoing card predicted by `exit_model.E4Combined` (43.20% top-1 on
> these edits), `ml/substitution` scores **32.29%** against player frequency's
> **31.77%**: **−0.06 [−1.67, +1.47]**, ns at five origins — the README §32
> gate **FAILS**. Oracle tax 11.93 pts; **4.2%** of the pooled advantage
> survives. Where the exit is right it wins +4.94; where it is wrong (56.8% of
> events) it loses −6.84, because the player layer pushes the replacement of a
> card that is not leaving. The player layer Phase 6 called necessary is worth
> **+0.21 [−1.15, +1.61]** end-to-end. Replayed on 138,978 real production
> steps, it adds **+0.017 percentage points** of steps. **Displacement is a
> descriptive memory, not a predictive component.**
> Full artifact: `DECKKIES_BRAIN_PHASE7_END_TO_END_EXIT_REPLAY.md`.

### Known consequence of the manual approach

When Minion Giant shipped (2026-09-07) the generated roles file stayed at 122.
`ROLES.get` returns `None`, so `answers_air`, `has_splash` and `is_anti_swarm`
all read `False` and a deck holding it is **under-credited**. The failure is in
the safe direction and is named in the assertion — but it is exactly the
manual-curation cost the Brain is meant to remove.

### What the Brain needs (section 12 of the brief)

```
NEW CARD -> first appearances -> early adopters -> deck associations
         -> card replacements -> archetype associations -> matchup effects
         -> adoption curve -> meta role
```

**None of this is built.** The raw material exists: `battles.battle_time` +
`player_card_keys` gives first appearance and adoption curve directly, and
`substitution.GlobalStats` already counts out→in pairs, which is the
"replacements" edge. This is the most tractable unbuilt Brain component and it
does **not** depend on any of the closed branches.

---

## 10. MATCHUP INTELLIGENCE

### Current — the evidence ladder

`server/deck_counter.py`. Five rungs, walked **lazily**, stopping at the first
rung with evidence, and **every number carries the rung it came from**:

| constant | meaning |
|---|---|
| `SOURCE_EXACT` | these two exact decks have met |
| `SOURCE_DECK` | this exact list, against that archetype |
| `SOURCE_C7` | lists one card different |
| `SOURCE_C6` | lists two cards different |
| `SOURCE_ARCHETYPE` | archetype against archetype — too few battles for this deck |

Two properties worth preserving:

- **It is card-sensitive.** Swap one card and the deck hash changes, so a
  different set of battles is counted. A trained archetype model returns the
  same figure for every Hog list.
- **It is symmetrised.** `deck_counter._symmetric` cancels the 58.6%
  tracked-player bias; every mirror lands at exactly 50.0%. An unsymmetrised
  table makes everything look like a counter.

Lazy evaluation is not a micro-optimisation: building every rung took `suggest`
to **25.7 s**; stopping at the first answer takes it to **1.4 s**, with an
identical answer.

### What the Brain needs

- Matchup knowledge conditioned on **who is piloting**, not just which decks
  met. Does not exist and has never been measured.
- Confidence intervals on matchup rates. `MIN_GAMES` is the only floor today.

---

## 11. OPPONENT INTELLIGENCE

### What the data supports

| question | supported? | evidence |
|---|---|---|
| `Player × Deck choice` | **YES** | `opening_decks`, the whole Coach |
| `Player × Opponent archetype × Deck choice` | **MEASURED AND NULL** | Phase 3: "indistinguishable from zero" |
| `Player A × Player B × Deck choice` | **NO DATA** | requires repeated A-vs-B meetings; not measured, and the tracked roster is 4,910 against 866k participants |
| Second-order (A expects B to expect A) | **NO — measured and negative** | counter-sniping 8.3% → 2.7% |
| Within-duel: their revealed deck → their next deck | **YES, weakly** | Phase 21A; but see below |

### The Phase 21A result in full, because it is the decisive one

Predicting an opponent's **next archetype inside a duel**, with the legality
filter applied:

| arm | n | top-1 | top-3 | MRR | coverage |
|---|---:|---:|---:|---:|---:|
| A full (cards + spells + history) | 41,980 | 13.5% | 19.9% | 0.167 | 20.4% |
| D history only | 41,980 | 13.9% | 19.9% | 0.169 | 20.4% |

Then the two supplements that explain the numbers:

**Supplement 10 — coverage is the problem, not the model.**

| legal-pool size | steps | share |
|---|---:|---:|
| 0 (subject has no usable history) | 30,108 | **71.7%** |
| 1 | 5,351 | 12.7% |
| 2 | 4,232 | 10.1% |
| >= 3 | 2,289 | 5.5% |

Restricted to pool >= 1, top-1 rises from 13.5% to **47.9%**.

**Supplement 11 — the legality filter is doing the work, not the ranker.**

| subset | mean pool | ranker top-1 | random-in-pool | delta |
|---|---:|---:|---:|---:|
| pool >= 1 | 1.89 | 47.9% | 46.2% | **+1.7** |
| pool >= 2 | 2.62 | 37.7% | 34.7% | **+3.0** |
| pool >= 3 | 3.76 | 28.8% | 23.9% | **+4.9** |
| pool >= 5 | 5.84 | 11.7% | 14.5% | **−2.8** |

> Most of the apparent accuracy is the DUEL LEGALITY FILTER, not prediction.

**Read those two tables together before designing anything.** The Brain's
biggest available win is not a better ranker. It is **raising coverage** —
71.7% of duel steps have no usable candidate pool because the subject is an
untracked opponent whose only history is the duel payloads themselves.

### What the Brain could realistically add here

`battle_raw` holds 20,702 duel subjects with 119,865 games. Building a player
history **out of duel payloads** rather than out of `battles` would give
untracked opponents a history for the first time. That directly attacks the
71.7%. It is the highest-value unbuilt component and nothing in the frozen spec
forbids it.

---

## 12. CONFIDENCE MODEL

### Current

`calibration.band(domain, p_change)` → `high` / `medium` / `low`, cut points
from `band-calibration-v1.json`, fallback `(0.15, 0.45)`.

### The published accuracies were wrong and must never be displayed

| band | claimed (`policy.BAND_ACCURACY`) | measured |
|---|---|---|
| competitive high | 90.5% | **69.1%** (19D, n=343) |
| competitive medium | 73.3% | **55.0%** (n=20) |
| practice high | 92.1% | 62.5% (n=8); **65.4% macro** on 11,152 steps |
| practice medium | 75.8% | **69.7% macro** — *above* high |

Two different failures with different consequences:

- **Competitive** — the ordering holds (68.2% > 55.0% > 0.0%); every magnitude
  is ~20 points low. ECE **0.2806**.
- **Practice** — the ordering **does not hold**. macro high 65.4% < medium
  69.7% > low 53.5%. ECE **0.6097**. A band that does not rank cannot carry a
  confidence label at all, so `BAND_SUPPORTED` withholds it, and the
  alternatives go with it.

**Frozen rules.** No percentage is displayed for any band, ever.
`BAND_ACCURACY` and `expected_accuracy()` are internal diagnostics and may not
reach a response body or a screen.

### What the Brain needs

- Confidence derived from **evidence volume and agreement**, not from a single
  logistic score. Sample size, recency, and how many independent signals agree.
- Confidence that is **validated before it is shown**. The ordering test
  (`shadow.band_ordering`) already exists and must gate any new band.
- **Per-source confidence.** An answer from a legality filter with a
  one-deck pool is near-certain; an answer from a ranker at pool >= 5 is worse
  than chance. Today both would say "high".

---

## 13. PREDICTION MEMORY

### What exists — the shadow log

`server/ml/production/shadow.py` → `server/ml/results/shadow-log.jsonl`.
Append-only JSONL, cross-process locked, rotated at 8 MB, gitignored.

**Measured contents (2026-09-12):**

| | |
|---|---:|
| entries | 2,620 |
| distinct player hashes | 1,464 |
| with `anchorTs` (reconcilable) | 2,228 |
| date range | 2026-08-20 → 2026-08-23 |
| domains | duel 1,388 / competitive 1,160 / practice 72 |
| bands | high 1,432 / medium 766 / low 422 |
| degraded | 392 |

Per-entry fields: `ts, anchorTs, versions{model,features,policy,candidates,
calibration}, player, domain, plays, clusterSize, candidates, pChange,
confidence, alternatives, degraded, reason, latencyMs, primaryHash, altHashes,
id`.

### What it deliberately does NOT record

Card lists, deck contents, player tags, opponent identities. The tag is
`sha256(salt + tag)[:16]`; the deck is `sha256(sorted cards)[:16]`.

### Against the Brain's requirement

| required | status |
|---|---|
| WHAT IT PREDICTED | **hash only** — not the deck |
| WHY IT PREDICTED IT | **NO** — no feature values, no evidence trail |
| CONFIDENCE | yes (`confidence`, `pChange`) |
| ALTERNATIVE PREDICTIONS | hashes only |
| WHAT ACTUALLY HAPPENED | **NO** — derived later by `reconcile()`, never stored |
| ERROR | **NO** — computed in a batch report, not persisted |
| CONTEXT | partial (`plays`, `clusterSize`, `domain`) |
| PLAYER STATE | **NO** |
| OPPONENT STATE | **NO** |
| MODEL VERSION | **yes** — five-axis `versions` stamp on every entry |

### The reconciliation machinery that already exists

`shadow.outcomes_from_history()` maps `(player, ts) → actual next deck hash`
with strict temporal discipline: *the first battle STRICTLY LATER than the
anchor, in the same domain, for the same player.* Ties are not "next".

`shadow.reconcile()` then reports per band: predictions, share, correct,
accuracy, **accuracyMacro**, players, plus coverage (primary OR alternatives).

**This is a working, tested, leak-free scoring loop.** It is batch and offline,
it stores nothing back, and it can only run from a tag list the caller already
holds (`reconcile_from_tags`) because the log keeps hashes. That last property
is a deliberate privacy design and **the Brain must decide explicitly whether
to keep it** — see ARCHITECTURAL DECISIONS #7.

### The cohort files are load-bearing

`server/ml/results/cohorts/tags*.json` (5,680 tags) are the **only** thing that
can reconcile the salted log. They are tracked in git — verified. An older note
in `CLAUDE.md` says they are gitignored and unbacked; **that note is wrong**,
`git ls-files` lists all six. The `*-report.txt` files are the ones with no
backup.

---

## 14. LEARNING LOOP

### Intended

```
Observe -> Predict -> Duel -> Compare -> Score -> Learn -> Persist -> Predict Again
```

### What exists today, honestly

```
Observe   YES   source.load_plays, 60-day window, hot tier only
Predict   YES   predictor.predict_for_tag
Duel      YES   the bot ingests it within 2 hours
Compare   YES   shadow.outcomes_from_history + reconcile  (OFFLINE, BATCH)
Score     YES   per-band accuracy, pooled and macro, plus Brier/ECE inputs
Learn     NO    nothing consumes the score
Persist   NO    nothing is written back
Predict   —     the next prediction is identical to the last one
```

**The loop is open.** Five of the seven stages exist and are tested. The two
missing stages — Learn and Persist — are the whole Brain project.

### The hard constraint on closing it

`policy.forbid_training` makes production incapable of fitting a model, by
design, and the spec forbids training in production. **The Brain must therefore
learn in a separate process and publish an artifact**, exactly as
`m2-change-v1.json` is published today. That is not a limitation to work
around; it is the pattern that already works and it is what makes rollback one
file.

---

## 15. PATTERN MEMORY

**Nothing resembling this exists.** Verified: no pattern table, no lifecycle
state machine, no evidence counters keyed to a behavioural claim.

The nearest existing objects:

| object | what it is | why it is not a pattern store |
|---|---|---|
| `view["prior_edits"]` | out/in card pairs inside the current shell | rebuilt per request, never persisted, shell-scoped |
| `substitution.GlobalStats` | population out→in counts | not per player, no lifecycle |
| `duo_pairs` | 1.48M teammate partnerships with occurrence counts, first_seen, last_seen | **the closest structural precedent** — see below |

### `duo_pairs` is the precedent to copy

`server/duo_pairs.py` is a working example of exactly the shape pattern memory
needs, built in this repo and running in production:

- its **own SQLite file** (`server/.duo_pairs.db`), chosen deliberately over a
  table inside `battles.db`, because the collection has to survive
  independently of the raw rows and *a read-write handle to the bot's database
  is the one thing this project has never taken*;
- an **order-free fingerprint** at two levels;
- **occurrence counts, distinct participants, first_seen, last_seen**;
- an **incremental watermark on `stored_at`** (arrival time, **not**
  `battleTime` — a battle that arrives late carrying an old `battleTime` still
  has a current `stored_at`; watermarking on battle time is the fault that left
  `player_stats_agg` 48% short);
- **`reconcile_population()`** — a bounded population with the ranking computed
  from a tier that is maintained for *everyone*, so #1,001 overtaking #1,000 is
  visible and admitted. Rank from the pruned ledger and today's population
  becomes permanent.

A Brain pattern store should be built the same way. Do not invent a new
storage pattern.

### Required structure (design, not built)

```
Pattern: player, context, observation, occurrences, supporting,
         confidence, recent evidence, historical evidence, last observed, status

Lifecycle: OBSERVED ONCE -> EMERGING -> REPEATED -> STRONG -> BROKEN -> STALE -> EXPIRED
```

---

## 16. NEW CARD LEARNING

Current state: **manual**, section 9. `cardRoles.json` is parsed from prose.

Available raw material, all of it already in `battles`:

| Brain stage | available today from |
|---|---|
| first appearances | `MIN(battle_time)` where the key is in `player_card_keys` |
| early adopters | `player_tag` on those rows |
| deck associations | co-occurrence in `player_card_keys` |
| card replacements | `substitution.GlobalStats` already counts out→in pairs |
| archetype associations | `deck_counter.archetype_of` over decks containing it |
| matchup effects | `pair_matchup_agg`, once the deck has games |
| adoption curve | daily counts over `battle_time` |
| meta role | `meta.py` |

**Nothing here requires a closed branch to be reopened.** This is the cleanest
unbuilt Brain component.

Worked precedent, and the cost of not having it: Minion Giant shipped
2026-09-07; the VPS catalog was a commit behind; **81,974 duel sides read as
unresolvable** and the Phase 21A-era reconciliation had to be rerun. After the
123-card catalog was deployed, the rerun refused **zero** sides. A learned card
pipeline would have had first-appearance data for the card before anyone edited
a JSON file.

---

## 17. TEMPORAL / LEAKAGE RULES

**Hard requirement. Violating it invalidates every number produced.**

### Rules

1. A prediction for time `T` may use **only** rows with `battle_time < T`.
   Strictly less. Ties are not "prior".
2. Reconciliation uses the **first battle strictly later than the anchor**, in
   the same domain, for the same player. Anything after it belongs to a later
   prediction.
3. Every conditional table must be fitted on a **training split that ends
   before any evaluated step begins** — a time split, never a random split.
4. Candidate generation may only use history from the training split. The truth
   deck is read **only to score**.
5. Anything conditioned on must be computable without the truth. Phase 21A's
   pool-size conditioning is leak-free *because pool size is computed without
   the truth* and says so.
6. Report **player-macro alongside pooled**. Predictions from one player are
   correlated; a single heavy player must not carry the result.

### Enforcement that exists

| mechanism | where |
|---|---|
| `policy.assert_no_future(plays, cutoff_ts)` | production, filters rather than raises |
| `PredictionExample` receives only `history`, never `truth` | `ml/dataset.py`, `ml/evaluation/splits.py` |
| strictly-later matching | `shadow.outcomes_from_history` |
| time split | every `ml/evaluation/phase*.py` |
| leakage tests | `test_ml_17b.py` and `test_ml_18.py` assert the SQL contains no `INSERT/UPDATE/DELETE/CREATE TABLE/DROP` |

### Known leakage risks to guard in Brain work

- **A learned artifact fitted on data that overlaps the evaluation window.** The
  spec already refuses to promote `band-calibration-v2-candidate.json` for a
  related reason: it "would fit a population whose composition is an artifact
  of when collection ran".
- **Self-reinforcement.** If the Brain's own predictions influence what is
  collected or which players are enrolled, the evaluation population becomes a
  function of the model.
- **`stored_at` vs `battle_time`.** A row that arrives late carries an old
  `battle_time`. For *learning* use `battle_time`; for *incremental watermarks*
  use `stored_at`. Getting this backwards has already cost this project once.
- **Deduplication.** A battle involving two tracked players is stored **twice**
  (four times in 2v2). `duo_pairs` solves this with a `battle_identity` built
  from the battle's own contents — timestamp plus sorted tags — enforced by a
  primary key. Any Brain ingest must do the same or inflate counts up to 4x,
  plausibly.

---

## 18. BASELINE

**The Brain must beat these. They are the benchmark and they must not be
silently modified.**

### Primary baseline — `Recent`

`ml/evaluation/splits.py:recent()` — the most recent exact variant in the
cluster the player is on. Production's `predictor.predict` step 2.

Phase 1, 400 players: Recent beats the previously shipped `modal` by
**+19.0 / +11.1 points exact@1**.

### Secondary baselines

| baseline | where |
|---|---|
| M0 modal — most-frequent exact variant | `splits.modal()` |
| player-history frequency (incoming card) | `splits.py` |
| **random-in-legal-pool** | Phase 21A supplement 11 — **the right baseline for any duel ranker** |

### Ceilings, not model failures

| ceiling | value |
|---|---|
| switched-to deck is one they have played | 49.8% competitive / 38.5% practice |
| perfect historical ranker reaches | ~5% / ~2% of all steps |
| R@1 at 11+ known decks | **24.8%** (falls from 87.4% at 2-3 decks) |
| novel deck buildable from their own card pool | 52.1% / 61.7% |
| candidates needed for usable novel recall | 10⁸ – 10¹⁰ |
| duel steps with any legal candidate pool | **20.4%** |

### Production step distribution — the frame that matters

| cards shared with previous deck | practice | competitive |
|---|---:|---:|
| 8 (no change) | 74.2% | 79.1% |
| 7 (the 1-card edit) | **2.3%** | **1.8%** |
| 0-3 (whole-deck switch) | 22.1% | 15.9% |

**Phases 8-14 optimised the 2% case.** They stepped `next-in-cluster`, which by
construction only scores steps where the player stayed on the shell. Production
asks "what deck comes next", full stop. Both measurements were correct; the
frame was not the product's. The same shortlist measured **+8.4 points** under
the research frame and **+0.5** under production semantics.

> **Re-measured by Brain Phase 7 (2026-09-13), NOT replacing the table above.**
> Production's own `adapter.build_context` replayed over `phase18-plays.pkl`
> (797 players, 138,978 next-play steps, 2026-08-10 … 08-19):
>
> | cards shared with previous play | practice | competitive |
> |---|---:|---:|
> | no established shell | 21.26% | 5.07% |
> | 8 (no change) | **38.69%** | 82.96% |
> | 7 (the 1-card edit) | **1.42%** | **1.47%** |
> | 6 (2-card edit) | 0.52% | 0.64% |
> | 0-5 | 38.11% | 9.87% |
>
> The one-card share agrees in magnitude. **Practice's no-change share does
> not** (38.69% against 74.2%) — a different window (August's measured practice
> churn rise) and population. Not reconciled. On these steps production's
> alternatives contain the exact next deck on **0.54%** of all steps.

**Any Brain evaluation must state its step definition in its report header.**

---

## 19. EXPERIMENT LOG

Phases 1-24B were run before this document existed. They are summarised here
with pointers; the full reports are in `server/ml/results/` (**gitignored —
local only**) and the frozen conclusions are in `phase22-final-spec.md`.

| phase | question | result | artefact |
|---|---|---|---|
| 1 | is `recent` better than `modal`? | **YES** +19.0 / +11.1 pts | `phase1-400players.txt` |
| 2 | can we detect WHEN a deck changes? | **YES** ROC-AUC 0.932 / 0.803 | `m2-change-v1.json` |
| 3 | does the outgoing card help? | YES +6.9 / +5.0 pts top-1 | `phase3-report.txt` |
| 3 | does opponent archetype/deck help? | **NO** — indistinguishable from zero | `phase3-report.txt` |
| 4-7 | can a model overrule Recent? | **NO**, four times | reports 4-7 |
| 8-9 | widen candidate generation | 1-card recall to 85.8% / 88.6% | `phase8/9-report.txt` |
| 10-11 | rank the candidates | pointwise fails, pairwise fails | reports 10-11 |
| 12 | hybrid? | **NO** — rescue cell is 1.4-1.8% | `phase12-report.txt` |
| 13 | attack exit prediction | plateaus ~45% / 53% top-1 | `phase13-report.txt` |
| 14 | what IS shippable? | Recent + band + shortlist | `phase14-report.txt` |
| 15-16 | production integration + shadow | shipped dark; shadow found 2 real bugs | `shadow-log.jsonl` |
| 16C | backtest under production semantics | shortlist **+0.5** not +8.4 | `backtest-16c.json` |
| 17A | recalibrate | `band-calibration-v1.json` | artifact |
| 17B | is a switched-to deck historical? | **NO** — 49.8% / 38.5% | `phase17b-report.txt` |
| 18 | can a novel deck be generated? | **NO** — 10⁸-10¹⁰ candidates | `phase18-report.txt` |
| 19A-B | latency + UI | async, non-blocking | — |
| 19C-D | validate vs REAL outcomes | ordering holds, magnitudes ~20 pts wrong | — |
| 20A | can Y's deck tell X what to bring? | **NO** — oracle 48.9% vs default 58.9% | — |
| 20B | forced-switch mechanism | **WITHDRAWN — tautology** | `phase20b-report.txt` |
| 20C | validate 20B | ex-ante legality agreed 10.6% — worse than chance | `phase20c-report.txt` |
| 20D | what IS the `duel` domain? | **practice.** 97.8% Friendly/Showdown | `phase20d-report.txt` |
| 21A | do revealed spells predict the next deck? | **NO** — paired 0.000 [-0.001, 0.001] | `phase21a-report.txt` |
| 22 | freeze | the contract | `phase22-final-spec.md` |
| 23 | 5 contract fixes | applied (see §21) | `policy.py`, `calibration.py` |
| 24A | soak | 80/80, 0 invariant violations; found a real contract bug | `phase24a-soak.json` |
| 24B | hosting plan | infrastructure, not research | `phase24b-hosting-plan.md` |
| **Brain 0** | repository audit | the master README | `DECKKIES_BRAIN_README.md` |
| **Brain 1** | can native duel history close the zero-pool gap? | **NO — +16.65 pts against a 20-pt gate, ceiling 19.25** | `DECKKIES_BRAIN_PHASE1_DUEL_CENSUS.md` |
| **Brain 2** | has the Brain already been built? | **YES, MOSTLY — 9 modules, 280 tests, off behind one flag** | `DECKKIES_BRAIN_PHASE2_INFRASTRUCTURE_AUDIT.md` |
| **Brain 3** | can the prediction-memory loop ever fill? | **NO — 6.6% match rate, ~3,030 events needed, 1 real user. STOP** | `DECKKIES_BRAIN_PHASE3_SHADOW_REPLAY.md` |
| **Brain 4** | is `kg_edges.APPEARS_AFTER` card-transition evidence? | **NO — it is an 8x8 Cartesian product over card-DISJOINT decks. 7,714 real events x 64, 60 players, 0 readers. STOP** | `DECKKIES_BRAIN_PHASE4_CARD_INTELLIGENCE.md` |
| **Brain 5** | can the Brain learn card displacement and adoption from real edit events? | **YES — 112 global pairs (null 0–2), 777 player patterns across 255 players (null 0.0), role-coherent displacement with NO card metadata. PROCEED WITH CONDITIONS** | `DECKKIES_BRAIN_PHASE5_CARD_ADOPTION.md` |
| **Brain 6** | does the Phase 5 displacement signal survive a chronological holdout? | **CONDITIONAL — isolated per-player displacement does NOT beat player frequency (+1.20 [−1.52, +3.94], ns at 5/5 origins); it abstains on 45.09% and loses 14 pts there. WITH backoff it wins: +18.65 at support ≥3, and `ml/substitution` beats the baseline +10.02 [+7.94, +12.21]** | `DECKKIES_BRAIN_PHASE6_CHRONOLOGICAL_DISPLACEMENT_REPLAY.md` |
| **Brain 7** | does the displacement advantage survive when the exit must be PREDICTED? | **REJECT — no. `ml/substitution` with E4Combined's exit 32.29% vs player frequency 31.77%: −0.06 [−1.67, +1.47], ns at 5/5 origins. Oracle tax 11.93 pts, 4.2% of the advantage survives; player layer +0.21 ns end-to-end; +0.017 pts of real production steps** | `DECKKIES_BRAIN_PHASE7_END_TO_END_EXIT_REPLAY.md` |
| **Brain 8** | how much does `timestamp="9999"` cost, and is a fix worth a controlled change? | **CONDITIONAL — 0.073 competitive ROC-AUC at the battle-time stamp (0.858 → 0.932, +0.0731 [+0.0625, +0.0855]); +0.003 ns at a strictly historical stamp; request-time stamps are out of the model's range (logged median 36 h vs 5 min). Not a one-line fix: bands validated only on buggy outputs, recalibration required** | `DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md` |
| **Brain 8, session 2** | does session 1 reproduce, and what does a REQUEST-TIME stamp do on real outcomes? | **REPRODUCED EXACTLY; verdict CONDITIONAL unchanged. Session 1's request-time claim SUPERSEDED: on the steps each request is about, the request stamp beats `9999` (R(36 h) Brier −0.1596 [−0.1819, −0.1373]; random-clock AUC +0.0494 [+0.0330, +0.0702]; 1 h before the battle keeps 94% of the gain). Pre-registered I4 fires: fix now ELIGIBLE for controlled review, stamp = request time, after a VPS production-frame replay (Phase 8b)** | same artifact, §27 |
| **Brain 8b** | does the request-time stamp still beat `9999` in PRODUCTION ORDER with real ingest lag? | **PASS (8/8 pre-registered readings) — competitive random clock, arrival-visible: Brier macro −0.0963 [−0.1103, −0.0828], ROC-AUC 0.619 → 0.673 (+0.0545 [+0.0381, +0.0698]), ordering on 3 bands, `high` 92.8% @ 63.3% → 65.0% @ 69.3%; primary deck identical 4,500/4,500; alternative hits 1.85% → 1.06% (−0.91 pts). Eligible for controlled fix implementation review** | `DECKKIES_BRAIN_PHASE8B_PRODUCTION_ORDER_TIMESTAMP_REPLAY.md` |
| **Brain 8c** | is the alternative-hit regression from the correct timestamp a loss of useful recommendations, or a consequence of better calibration? | **CONDITIONAL (pre-registered rule) — both: removed alternatives are 98% wrong (43,454 false for 871 hits) but 2.6x as precise as those kept (1.97% vs 0.74%, +1.22 pts [+0.45, +2.21]). Alternative precision by corrected band 0.37 / 2.90 / 3.61% vs caps 2 / 1 / 0: `ALTERNATIVE_CAPS` is ordered against usefulness. Loss 0.78 pts < 3% floor; identity/order identical 128,816/128,816. Timestamp fix NOT blocked; cleared for controlled implementation on explicit acceptance of the regression; caps review separate** | `DECKKIES_BRAIN_PHASE8C_ALTERNATIVE_REGRESSION_AUDIT.md` |
| **Brain 9** | does the player's full observed deck vocabulary improve next-deck prediction as a candidate pool, leak-free and chronological? | **CONDITIONAL (pre-registered mapping) — the README gate PASSES on Phase 1's harness (FULL − duel history top-1 U1 +1.39 [+1.17, +1.60], U2 +0.36 [+0.18, +0.55]; ranker − random at pools ≥ 5 +9.09 / +11.91) but FAILS at arrival visibility (S-ARR U2 −0.48 [−0.59, −0.36]; S-EXACT U2 −1.56 [−1.90, −1.22]). Recall 30.36% → 37.14% but top-1 | in pool 69.7% → 54.9%; step-weighted top-1 21.15% → 20.37%. Duel strangers +8.98, duel-seen −6.03. Beats Coach's current vocabulary +3.85. Request-time recall 14.92%, not 37.14% (duel payloads arrive median 22 h late). Change no pool** | `DECKKIES_BRAIN_PHASE9_CANDIDATE_POOL_REPLAY.md` |
| **Brain 10** | can the Phase 8/8b timestamp fix be approved for implementation despite the Phase 8c alternative regression, and what is the minimal contract? | **CONDITIONAL (Phase 8c mapping, applied unchanged) — approvable. Phase 8b gate PASS 8/8 and Phase 8c rule CONDITIONAL both RECOMPUTED EXACTLY from recorded per-read data with new code (AUC +0.0545 [+0.0381, +0.0698]; Brier −0.0963 [−0.1103, −0.0828]; hits −0.91 pts [−1.41, −0.51]; removed 1.97% vs retained 0.74%; primary and alternative identity 128,816/128,816). Code unchanged since 2026-08-23. Contract: `predictor.py:104` → `cutoff_ts or _request_stamp()` (UTC), features version `phase2-21-reqstamp-utc`, 7 tests + 2 tightened pins + stamp pinning (a committed test fails from 2026-09-27T18:51:45Z otherwise), offline equivalence before deploy. Open condition: explicit acceptance** | `DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md` |
| **Brain 11** | implement the approved timestamp fix locally and validate it completely | **PASS — implemented exactly per Phase 10 (local working tree; NOT committed, NOT deployed, VPS untouched). Offline equivalence 357,426/357,426 reads (`pB` max \|Δ\| 4.44e-16) and 128,816/128,816 condition-B records (band, note, capped list, count, uncapped list + labels), 0 mismatches. 767 unittest + 69 homegrown pass; only failure the pre-existing `test_ml_21a` (123 != 122), byte-identical to baseline. 10 new tests + 1 guard, exact version pins (#25), stamp pinned (#24), calendar-independent to 2030, 6 mutants all caught. Shadow log untouched** | `DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md` |
| **Brain 12** | commit the Phase 11 implementation and preserve the Phase 8b/8c evidence durably | **DONE — ONE local commit (not pushed, not deployed; hash in the Phase 12 artifact) holding the 5 Phase 11 files, `.gitignore`, `README.md`, `server/README.md`, this README, the Phase 11 artifact and `brain-evidence/phase8/MANIFEST.md`. Evidence: 34 files, 132,283,959 bytes, copied byte-identical (SHA-256, MD5, sizes, mtimes) to the gitignored `brain-evidence/phase8/`; `git check-ignore` covers all 34, only the manifest is tracked; no real tag staged. 27 suites re-run: 767 unittest + 69 homegrown, identical to Phase 11; only failure `test_ml_21a` (123 != 122). Shadow log unchanged. VPS untouched, `CLASH_OIE` off** | `DECKKIES_BRAIN_PHASE12_COMMIT_EVIDENCE.md` (local, untracked) |
| **Brain 13A** | retain only the top 50 most-used 2v2 decks per each of six win conditions (≤ 300 records), delete the long tail, keep it updating | **BLOCKED — nothing implemented, nothing deleted.** (1) **There is no six-way win-condition taxonomy in the code**: 23 win-condition CARDS (`cardMeta`), 16 archetypes + `other` = 17 (`deck_counter.WIN_CONDITION_MAP`, the bot's map, stored in `battles`), and 6 editorial play STYLES (`deck_counter.STYLE`) whose own source says the stored taxonomy "is a card, not a play style" and one of whose six (`Mixed`) means *no* single win condition. (2) **No 2v2 data exists locally** — `resolve_db_path()` → None and `.duo_pairs.db` is on the VPS — so the counts, rebuild, verification and before/after measurement all need VPS access this phase forbids. (3) **The store holds PAIRS, not decks**, by the explicit decision that deleted `duo_decks.py`; a pair has two decks and so up to two win conditions. Finding: the target is ~1 GB of the ~78 GB 2v2 occupies. Three decisions owed | `DECKKIES_BRAIN_PHASE13A_2V2_TOP50_STORAGE.md` (local, untracked) |
| **Brain 13A (corrected)** | for EVERY canonical win condition keep the 50 most-used 2v2 pairs **and the actual battles belonging to them**; delete the tail; keep updating | **CONDITIONAL — implemented, measured, tested; cleanup PREPARED and NOT executed.** The "six" reading was wrong: there are **17** canonical win conditions and all 17 fill. Read-only VPS measurement: `battles.db` **77.06 GB** (not the documented 33), `battle_raw` **32.3 GB / 3,046,896 rows** (930,940 are 2v2), `.duo_pairs.db` **5.14 GB / 2,493,481 pairs**, growing **+200k pairs a day** with **86.2% seen exactly once**. Census: 17×50 = 850 slots hold **736 distinct pairs**, carrying **162,274 of 1,968,156 battles (8.24%)**. **THE FINDING: `battle_raw` cannot be credited to this work** — the bot's own cap drops non-duel (= 2v2) raw, runs only at bot startup, has not run in 14 days, and will delete all 930,940 2v2 payloads at the next restart, retained ones included; so "keep their battles" means the `duo_stage` record, not raw JSON. New: `duo_retention.py` + 64 passing checks, ships dark. Projected 5.14 GB → ~1.2 GB | `DECKKIES_BRAIN_PHASE13A_2V2_TOP50_RETENTION.md` (local, untracked) |
| **Brain 13A (executed)** | execute the approved 2v2 retention cleanup on production | **PASS — the tail is deleted and the collection is bounded.** Backup first (hash-verified, re-verified after), then an **exact** rebuild (17/17 buckets at 50, 850 rows = **736 distinct pairs**, 0 overstated, `verify() ok`), then the delete: **duo_pairs 2,544,874 → 736**, **duo_stage 4,025,218 → 176,995**, **166,962 battles retained**, `integrity_check ok`, four orphan checks all 0. The hourly unit now runs `duo_retention.py --maintain --prune` with the gate on the unit (so only that job may delete) — **proven live**: the fold added 24,863 pairs, maintenance pruned exactly those in 5.5 s while retained pairs *gained* 1,648 battles, and systemd ran the unit to `success`. Free pages 1,853 → **1,010,447 (4.14 GB)**; **file size unchanged — VACUUM not run, no physical saving claimed**. `battles.db` never written to (mode=ro; its freelist is already 11.7 GB, and the bot's own cap reclaims 2v2 raw at the next restart) | `DECKKIES_BRAIN_PHASE13A_2V2_TOP50_RETENTION.md` §0 |
| **Brain 14** | a user with 111 saved Duel sets saves one more: UI shows 112, refresh shows 111, the new set is gone | **PASS — root cause proven by measurement and fixed.** A saved versus set is **~2,216 bytes**, so the sync payload crossed `api/decks.ts`'s **250 kB cap at ~110 sets** (111 = 251,762 B → **413**). `pushRemoteDecks` ignored the response, so the failure was silent, and `hydrateFromRemote` — which runs on **every page load** — replaced the correct local 112 with the frozen remote 111, which persist then wrote back over localStorage. Cases **A and D together**. Fix: cap → 1 MB, the push now reports whether it landed, and a durable pending marker makes the load path **keep local and retry** rather than adopt a blob missing changes (new pure `syncPolicy.ts`). 16 regression tests reproduce the bug against the old policy and prove `111→112→113→refresh→113`; suite 500 → 516 | `DECKKIES_BRAIN_PHASE14_SAVED_DUEL_PERSISTENCE.md` (local, untracked) |

### Brain Phase 13A (executed) — full entry

```
Date          2026-09-17
Question      Execute the approved 2v2 retention cleanup on production: for EVERY
              canonical win condition keep the 50 most-used pairs and the actual
              battles belonging to them; delete the tail; keep it updating.

RESULT        PASS. Tail deleted, retained set exact and independently verified, the
              collection is bounded and maintains itself hourly under systemd.
              battles.db was NEVER written to. VACUUM NOT run - 4.14 GB pending.

ORDER         quiesce -> backup -> deploy -> rebuild -> verify -> plan -> delete ->
              verify -> wire -> live-test -> measure. Nothing was deleted until the
              backup was hash-verified and verify() returned ok.

BACKUP        /var/backups/clashbot/20260917T061905Z/duo_pairs.db
              5,244,731,392 B  sha256 27628942fbd76f893883cc773ddc7b195b5a814c72b32e58f4c75922f0f4fb25
              integrity_check ok; holds the pre-cleanup 2,544,874 / 4,025,218 rows.
              Re-verified AFTER the cleanup: identical size and hash.

CENSUS        17/17 buckets filled to exactly 50. 850 rows = 736 DISTINCT pairs
              (114 pairs are top-50 in two buckets). #50 cuts 13 (3-musk) to 399
              (other); #1 up to 10,074. duo_candidates 85,000 (bounded).
              overstated = 0 -> the historical rebuild is EXACT.
              verify() ok=True, 0 mismatches, 0 buckets over depth, 17 checked -
              it re-derives from duo_pairs rather than re-running the builder.

DELETED       duo_pairs  2,544,874 -> 736        (-2,544,138)
              duo_stage  4,025,218 -> 176,995    (-3,848,223)
              distinct battles retained: 166,962. integrity_check ok.
              Four orphan checks all 0; max rows per bucket 50.

CONTINUOUS    royalweb-duo.service gained a second ExecStart:
              Environment=CLASH_DUO_RETENTION=on
              ExecStart=/usr/bin/python3 -u duo_retention.py --maintain --prune
              The gate is on the UNIT, not /etc/royalweb.env, so only this job may
              delete and royalweb never can. Unit backed up as
              .bak-20260917-preretention.
              PROVEN LIVE: the fold added 24,863 pairs / 35,059 staged sides;
              maintenance counted them, reranked and pruned exactly those in 5.5 s;
              retained pairs GAINED 1,648 battles (duo_stage 176,995 -> 178,643);
              0 uncounted, 0 overstated. Then systemd ran the whole unit itself to
              Result=success / ExecMainStatus=0.

STORAGE       .duo_pairs.db file 5,244,731,392 -> 5,254,283,264 B (UNCHANGED, as
              expected). Free pages inside it 1,853 -> 1,010,447 = 4.14 GB.
              Live data ~5.23 GB -> ~1.12 GB. duo_stage+indexes 2,186 -> 111 MB.
              NO physical saving is claimed: VACUUM was not run.

NOT TOUCHED   battles (1,415,839 2v2 rows) and battle_raw (930,940 2v2 payloads) -
              same bot database, opened mode=ro here. Deleting there frees pages
              into a freelist ALREADY 11.7 GB, so the 77 GB file would not shrink
              without a 77 GB VACUUM under an exclusive lock on production; the
              bot's own enforce_raw_cap targets exactly that data and will delete
              it at the next restart anyway; and that file has no backup. Zero
              physical gain, real risk, redundant.
              duo_stage_players (5,351,497 rows, 694 MB with its index) is now the
              largest object and is mostly orphans - an untested delete path, so it
              was left alone and recommended alongside the VACUUM.

TESTS         duo_pairs 425, battle_modes 135, recent_battles 40, duo_retention 76,
              coach 69, tracking 8, duel_combos 55, ml_production 91 OK,
              ml_22_final 67 OK, api_security 73 OK. test_ml_21a keeps its
              unrelated 123 != 122.

STATE         CLASH_OIE off (absent from the env). predictor.py on the VPS still
              reads timestamp="9999" and shadow.py still stamps phase2-21, so the
              timestamp fix remains published-but-inactive. royalweb, clashbot and
              the duo timer all active; duo service not failed.
Artifact      DECKKIES_BRAIN_PHASE13A_2V2_TOP50_RETENTION.md section 0 (tracked)
```

### Brain Phase 14 — full entry

```
Date          2026-09-17
Question      A user with 111 saved Duel sets saves one more: the UI shows 112, a
              refresh shows 111, and the new set is gone. Find and fix it.

RESULT        PASS. Root cause proven by measurement, fixed, 16 regression tests.

ROOT CAUSE    Two defects; only the pair loses data.
  (a) api/decks.ts capped the sync payload at MAX_BODY_BYTES = 250_000 and answered
      413 above it. A saved VERSUS set is ~2,216 bytes of JSON (13 UUIDs, two 5-deck
      collections, 80 card keys), so the payload crosses 250 kB at ~110 saved sets:
          100 sets = 227,309 B  accepted
          111 sets = 251,762 B  413 Payload too large
      The reported failure sits exactly on that boundary.
  (b) pushRemoteDecks was Promise<void> and never read the response, so the 413 was
      silent - and hydrateFromRemote, which runs on EVERY page load, replaced local
      state with the remote blob unconditionally. The persist middleware then wrote
      that loss back over a localStorage copy that was correct.
  So (a) stopped the write and (b) deleted the record of it. Prompt cases A AND D.

WHERE IT WAS  saveCurrent was never at fault (it prepends immutably with a fresh
NOT           UUID). localStorage always held 112. No dedup, no pagination, no
              filter, no quota problem, no stale React state.

FIX           1. MAX_BODY_BYTES 250_000 -> 1_000_000 (~450 sets; inside Upstash's
                 most restrictive documented request limit and Vercel's 4.5 MB body).
              2. pushRemoteDecks returns whether the PUT landed.
              3. A durable `royal-duels-sync-pending` marker, set when a push is
                 SCHEDULED (the refresh can land inside the 1.5 s debounce) and
                 cleared only on success; hydrateFromRemote keeps local state and
                 retries instead of adopting a remote blob that is missing changes.
              4. New src/state/syncPolicy.ts - the decision as a pure, import-free
                 module (the tiers.ts / deviceIdentity.ts pattern), so it is testable
                 without a Supabase client or a store subscription.
              The SECOND HALF is the real fix: raising the cap alone just moves the
              same silent failure to the next limit. Now any failed push costs cloud
              sync until it heals and never costs data the user can see.

TESTS         tests/syncPolicy.test.ts, 16 tests. Reproduces 111 -> 112 -> refresh ->
              111 against the OLD cap and policy, then proves the acceptance
              sequence 111 -> 112 -> 113 -> refresh -> 113 under the new one; six
              consecutive refreshes; a push that fails for ANY reason; the client
              constant is checked against the number api/decks.ts enforces; user
              isolation. Suite 500 -> 516 across 19 files. tsc and build clean.

MISTAKE       The first fixture used short fake ids where the store uses 36-char
              UUIDs. A saved set carries 13 of them, so the model measured 214 kB for
              111 sets against production's 252 kB - putting the library UNDER the old
              cap and making the bug untestable. Fixed; the note is in the file.

DATA          Nothing deleted, reset or migrated. No production data touched. The
              already-lost 112th set is NOT recoverable; re-saving it now persists.
LIMITS        A user whose pushes keep failing stops receiving cross-device updates
              until one succeeds (deliberate). Last-write-wins is unchanged. 1 MB is
              ~450 sets; past that sync stops loudly rather than silently.
STATE         NOT DEPLOYED, uncommitted. Needs one push to main (client and the cap
              ship in the same deploy). No VPS, no migration.
Artifact      DECKKIES_BRAIN_PHASE14_SAVED_DUEL_PERSISTENCE.md (local, untracked)
```

### Brain Phase 13A (corrected) — full entry

```
Date          2026-09-17
Question      For EVERY canonical win condition keep the 50 most-used 2v2 pairs and the
              actual battles belonging to them; delete the tail; keep it updating.

CORRECTION    The first Phase 13A read the requirement as SIX win conditions and was
              BLOCKED. That reading was wrong. The requirement is ALL canonical win
              conditions. There are 17, all 17 occur in the live 2v2 data, and all 17
              are supported. The blocked artifact is kept unchanged as the record.

RESULT        CONDITIONAL. Mechanism implemented, measured and tested locally; the
              destructive cleanup is PREPARED and NOT executed.

VPS (READ-ONLY measurement, 2026-09-16/17 - no write, no delete, no restart):
  battles.db                 77.06 GB (docs said ~33 GB), freelist 11.7 GB
    battle_raw               32.3 GB, 3,046,896 rows, 930,940 of them 2v2 (30.6%)
    battles                  10.4 GB, 6,694,125 rows, 1,415,839 of them 2v2
  .duo_pairs.db              5.14 GB
    duo_pairs                2,493,481 rows / 1,819 MB with indexes
    duo_stage                3,936,312 rows / 2,186 MB with indexes  <- the biggest
  GROWTH                     1,483,672 pairs on 09-11 -> 2,493,481 on 09-16
                             = +200k pairs a day, and 86.2% are seen exactly ONCE

CENSUS        17/17 win conditions fill. 17 x 50 = 850 slots hold 736 DISTINCT pair
              identities (114 pairs are top-50 in both of their win conditions).
              Battles belonging to them: 162,274 of 1,968,156 folded = 8.24%
              (172,001 duo_stage rows of 3,936,312 = 4.37%).
              Cuts range from #50 = 13 uses (3-musk) to #50 = 392 (other).

THE FINDING   battle_raw CANNOT be reduced by this work and must not be touched by it.
              CLASH_RAW_CAP_BYTES is 25 GiB, the DB is 77 GB, and enforce_raw_cap drops
              NON-DUEL raw - which is exactly 2v2. It runs only from
              _run_startup_maintenance_inner (bot.py:5798), i.e. AT BOT STARTUP, and the
              bot has been up since 2026-09-12 with no purge line in 14 days of logs.
              The duo cursor equals MAX(stored_at), so every 2v2 payload is already
              folded and purgeable. At the next restart the bot deletes all 930,940 2v2
              payloads (~11.7 GB) BY ITSELF - including those of retained pairs.
              => no battle_raw saving may be credited to this phase, and "keep their
                 battles" cannot mean keeping raw JSON. It means the duo_stage record.

IMPLEMENTED   server/duo_retention.py (new) + server/test_duo_retention.py (new, 64
              checks, all pass). Reuses deck_counter's taxonomy and duo_pairs' identity
              - no second classifier, no second identity, no second database. Two new
              tables inside .duo_pairs.db: duo_retained (<= 850 rows) and duo_candidates
              (<= 85,000 rows, the counter that outlives an evicted record).
              Ranking: occurrences DESC, pair_fingerprint ASC. Ships DARK: apply_prune
              refuses unless confirm=True AND CLASH_DUO_RETENTION is on.

EXACTNESS     Rebuild is exact (overstated = 0). Incremental is Space-Saving: overstated
              by at most the evicted minimum, never understated, and the error is stored
              per row. Effectively exact today: only 22,058 pairs have ever reached 13
              uses (the lowest top-50 cut) against a 5,000-per-bucket candidate pool.

PROJECTED     .duo_pairs.db 5.14 GB -> ~1.2 GB live data (~3.9 GB, 76%, freed logically).
              Physical shrink needs VACUUM, which was NOT run and is not approved.

NOT DONE      No deletion anywhere. battles 2v2 rows untouched (mode=ro here; the four
              measured blockers stand). The ingestion hook is implemented but NOT wired
              into observe() - that line belongs in the change that deploys it.

NEW BUGS      1. The bot's raw purge is STARTUP-ONLY and the bot rarely restarts, so
                 battle_raw grows unbounded between restarts. That is why the database
                 is 77 GB rather than the documented 33 GB. Bot-side, not fixed here.
              2. sqlite_stat1 is stale by ~7x (estimates battle_raw at 414,053 rows
                 against an actual 3,046,896).
Artifact      DECKKIES_BRAIN_PHASE13A_2V2_TOP50_RETENTION.md (local, untracked)
```

### Brain Phase 13A (blocked, superseded) — full entry

```
Date          2026-09-17
Question      Retain only the top 50 most-used 2v2 decks for each of six win conditions
              (<= 300 records), delete the long tail, and keep the lists updating.

Approved      implementation of the smallest safe mechanism, local only.
NOT approved  deployment, VPS contact, CLASH_OIE, prediction logic, Coach Assist, the
              timestamp fix, frontend changes beyond keeping the 2v2 UI working.

RESULT        BLOCKED. Nothing implemented. Nothing deleted. No source file touched.
              Three of the brief's own stop conditions fired:

  1. THE SIX WIN CONDITIONS DO NOT EXIST. Three taxonomies are in the code and none
     is a set of six win conditions:
       A  23 win-condition CARDS      cardMeta.json is_win_condition
       B  16 archetypes + `other`     deck_counter.WIN_CONDITION_MAP (the bot's map,
          = 17                        and what `battles.player_win_condition` stores)
       C  6 play STYLES               deck_counter.STYLE - Beatdown / Bridge Spam /
                                      Control / Cycle / Mixed / Siege
     C is the only six and it is NOT a win-condition taxonomy: its own source calls it
     "counter types", says the stored taxonomy "is a card, not a play style", and calls
     the mapping editorial opinion - and one of its six, `Mixed`, means the deck has NO
     single win condition. Using C redefines "win condition"; cutting B to six redefines
     the six; grouping A into six invents. All three were forbidden, so none was done.

  2. NO 2v2 DATA EXISTS ON THIS MACHINE. Probed: clash_data.resolve_db_path() -> None
     (H: unplugged), and server/.duo_pairs.db does not exist - the collection is on the
     VPS. So the current counts, the historical rebuild, the independent verification
     and the before/after storage measurement are all impossible locally, and doing them
     needs the VPS, which this phase forbids.

  3. THE 2v2 STORE HOLDS PAIRS, NOT DECKS, BY AN EXPLICIT PAST DECISION. The unit is
     canonical(canonical(deckA), canonical(deckB)); duo_pairs.py contains no reference
     to win conditions or archetypes at all; and the per-deck module that once existed
     (`duo_decks.py`) was DELETED because "364,357 individual decks is not an answer to
     what do people play in 2v2". A pair holds two decks, so it has up to two win
     conditions, and assigning it one is a new rule.

FINDING       The target layer is ~1 GB of the ~78 GB that 2v2 occupies. The bulk is
              `battle_raw` (44.7 GB, the only place a teammate's deck exists) and the
              ~1.38M historical 2v2 rows inside the 33 GB `battles.db` - which this repo
              cannot delete at all (`mode=ro`) and which four measured blockers already
              stop. `duo_stage` (~1.89M rows, unbounded, never pruned) is a larger and
              far safer target inside duo_pairs.db than the census is.

COST OF THE   #/duo is PUBLIC (trial and up) since 2026-09-11, not an admin page. Its
CHANGE        card filter reaches all 123 cards server-side; against <= 300 retained
              records most cards return nothing (hog-rider alone matches 434,265 pairs
              today), and the header total goes 1,483,672 -> <= 300.

BASELINE      test_duo_pairs 425, test_battle_modes 135, test_recent_battles 40, all
              green and untouched.

DECISIONS     1. Which taxonomy are "the six"? Recommended: B (17 buckets, nothing
OWED             invented) with a per-bucket cap - 17 x 20 ~= 340 records lands near the
                 300 target while keeping every archetype.
              2. Retain top-50 PAIRS (existing unit, existing counter) or reverse the
                 earlier decision and build a per-deck 2v2 collection?
              3. Is duo_pairs even the right target, given finding above?
Artifact      DECKKIES_BRAIN_PHASE13A_2V2_TOP50_STORAGE.md (local, untracked)
```

### Brain Phase 12 — full entry

```
Date          2026-09-15
Question      Commit the Phase 11 timestamp-fix implementation, and preserve the Phase 8b/8c
              evidence in a durable, gitignored location.

Approved      (1) committing the Phase 11 implementation; (2) preserving the evidence.
NOT approved  VPS deployment, VPS restart, CLASH_OIE=shadow, CLASH_OIE=on, production
              activation, candidate pools, caps, Brain persistence, retraining,
              recalibration, unrelated bug fixes.

EVIDENCE      brain-evidence/phase8/p8b (25 files) and p8c (9 files), copied with cp -rp
              from the Phase 8b/8c session scratchpad (fcee4081-...). SHA-256, MD5, sizes
              and mtimes compared source vs copy for all 34: identical. Source left intact.
              .gitignore: /brain-evidence/* default-deny, re-including only
              brain-evidence/phase8/MANIFEST.md (the rule was added BEFORE the copy).
              MANIFEST.md: per-file bytes, mtime, SHA-256, MD5, role; source location;
              date; a REAL-PLAYER-TAGS warning; a sha256sum -c block (34/34 OK).
              Placed at the repository root, not in server/ml/results/: server/ is scp'd
              to the VPS, and ml/results/ already carries a tracked-cohorts exception.

COMMIT        ONE commit on main, parent c4fc65e, NOT pushed (a push deploys the frontend
              through Vercel; nothing in this commit needs that). Contents:
                server/ml/production/predictor.py, server/ml/production/shadow.py,
                server/ml/evaluation/phase22-final-spec.md, server/test_ml_production.py,
                server/test_ml_22_final.py  (the Phase 11 diff, numstat unchanged)
                .gitignore, README.md, server/README.md, DECKKIES_BRAIN_README.md,
                DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md,
                brain-evidence/phase8/MANIFEST.md
              CLAUDE.md updated too, but it is gitignored (local notes) and not committed.

EXCLUDED      the 34 evidence files (real tags); Phase 1-10, 8b and 8c Brain artifacts
              (not in the approved commit list; left untracked, nothing deleted);
              every scratchpad script and output.

TESTS         27 suites (23 test_ml_* + test_oie_ui, test_shadow_durability,
              test_api_security, test_coach): 767 unittest + 69 homegrown, identical to
              the Phase 11 after-run suite by suite. Only failure
              test_ml_21a.test_every_card_name_maps "AssertionError: 123 != 122", output
              identical to Phase 11. One skip (no database). Shadow log md5 a02ff6cc...,
              2,620 lines, unchanged.

MISTAKES      1. The first manifest draft printed the source path with a "\f" escape eaten
                 and quoted two unverified counts (a history row count; a "since the
                 purge cursor" gloss). Both checked against the files and corrected
                 before staging.
              2. A first repo-README draft said every offline evaluation had real
                 timestamp values. False: the shipped bands were validated on "9999"
                 outputs (Phase 8 s1 point 3). Corrected before staging.

STATE         Production UNCHANGED: VPS runs "9999", CLASH_OIE=off, royalweb not restarted.
DECISION      DONE. Next: Brain Phase 13, a controlled DARK deployment with CLASH_OIE=off,
              NEEDS ITS OWN APPROVAL. CLASH_OIE=shadow is a separate later approval;
              CLASH_OIE=on is a separate decision.
Artifact      DECKKIES_BRAIN_PHASE12_COMMIT_EVIDENCE.md (written after the commit, untracked)
```

### Brain Phase 11 — full entry

```
Date          2026-09-15
Question      Implement the Phase 8/8b timestamp correction exactly as Phase 10 specified,
              locally, and validate it completely. (Account holder accepted the Phase 8c
              alternative regression and approved implementation only.)

Approved      the Phase 10 s10 implementation surface and s11 tests.
NOT approved  deployment, production restart, CLASH_OIE=shadow, frontend, candidate pools,
              caps, Brain persistence, retraining, recalibration, unrelated bug fixes.

Changes       server/ml/production/predictor.py  +17/-1  import time; _request_stamp()
                  (time.gmtime(), "%Y%m%dT%H%M%S.000Z"); line 120 timestamp=cutoff_ts or
                  _request_stamp(); line 122 (truth "9999", inert) unchanged
              server/ml/production/shadow.py     +1/-1   VERSIONS["features"] =
                  "phase2-21-reqstamp-utc"
              server/ml/evaluation/phase22-final-spec.md  +17/-2  2.2 and 6 rows; 7 note
                  (input/timestamp correction; not retraining; not recalibration)
              server/test_ml_production.py       +222/-3  81 -> 91 tests: module-wide pinned
                  request clock + request_at(); two later-dated fixtures pinned; class
                  TimestampCorrection with T1 (x2), T2 (x2), T3, T4, T5, T6, T7 and a pin guard
              server/test_ml_22_final.py         +57/-14  66 -> 67 tests: pinned clock;
                  version tests parse the spec's 6 table and compare EXACTLY with
                  shadow.VERSIONS and the 2.2 row; pin guard

RESULT        PASS.
  1. OFFLINE EQUIVALENCE (mandatory), evidence at its recorded location, md5 unchanged:
        357,426 / 357,426 reads   P(change) == recorded pB, max |delta| 4.44e-16 (tol 1e-12)
                                  primary deck == recorded; 0 degraded
        128,816 / 128,816 condition-B records: band, note, capped list (cards/out/in/label),
                                  count, uncapped list + labels, degraded, practice payload
        mismatches 0; runtime 1,525 s
  2. SUITES (27): baseline 756 unittest + 69 homegrown, 1 failure; after 767 + 69, 1 failure.
     The failure is test_ml_21a.test_every_card_name_maps "AssertionError: 123 != 122"
     (line 96), text byte-identical before and after. One skip in both
     (FrontierWatch.test_an_advanced_frontier_is_ready, 'no database').
  3. NON-VACUITY: 6 in-process mutants (placeholder "9999", local-time stamp, cutoff ignored,
     caps changed, only feature 10 populated, stale version) each caught by its intended
     test; clean control passes.
  4. DETERMINISM: both predictor suites pass with the system clock faked to 2026-12-31 and
     2030-01-01 (158 / 158 each).
  5. SCOPE: git shows exactly the 5 files above; production shadow log md5 a02ff6cc...,
     2,620 lines, unchanged across every run; no VPS contact.

LEAKAGE       PASS (structural; reproduces Phase 8b's leak-checked information sets exactly;
              clock skew clamps to the anchor value).

MISTAKE       The first mutation harness did not register suites in sys.modules, so unittest
              skipped setUpModule and the clean control failed on the pin guards. Fixed and
              re-run; the guards firing was itself evidence they work.

DECISION      PASS. Implementation complete locally. Next, each separately approved:
              commit (with repo docs), evidence preservation (S0), dark deploy (S2),
              CLASH_OIE=shadow (S3-S7).
Artifact      DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md
```

### Brain Phase 10 — full entry

```
Date          2026-09-15
Question      Can the Phase 8/8b timestamp fix be safely approved for implementation
              despite the Phase 8c alternative regression, and what exact minimal
              implementation contract should be used?

Method        Read-only decision audit. NO database, NO VPS. All 12 Brain artifacts and
              the README read in full. Engine code traced at c4fc65e (predictor, features,
              policy, shortlist, calibration, adapter, shadow, coach.observe, proxy, UI,
              spec, tests). Phase 8b's 357,426 recorded reads and Phase 8c's 128,816
              records STREAMED (pure-Python unpickler; ~270 MB free, no numpy) and every
              gated figure RECOMPUTED with new code: own AUC and player-cluster AUC
              bootstrap (pair matrices, 2,000, seed 20260818); Brier CI via the frozen
              paired_delta. Existing predictor test suites run under "9999", UTC now and a
              2027 stamp, simulated in process (no file edited). No gate created or moved.

RESULT        CONDITIONAL - approvable; the only open term is the pre-registered
              explicit acceptance of the alternative regression.

  1. CODE = THE ANALYSED CODE. Engine last changed 2026-08-23. Only production caller:
     coach.observe -> predict_for_tag -> predict WITHOUT cutoff_ts. The stamp reaches
     features 9/10 only; it can change the band, the alternative COUNT (caps), each
     alternative's label and the note - never the primary deck, alternative identity/
     order, candidate pools, degraded state or the practice payload.
  2. PHASE 8b REPRODUCED EXACTLY (competitive random clock T1, 111,123 / 773):
        ROC-AUC 0.6188 -> 0.6734   +0.0545 [+0.0381, +0.0698]  (0/2,000 reps <= 0)
        Brier macro 0.3710 -> 0.2747  -0.0963 [-0.1103, -0.0828]
        bands 92.79/6.91/0.30 -> 65.04/21.44/13.52; high 63.30% -> 69.28% (macro
        59.89 -> 64.68); ordering 3 bands pooled+macro; transitions identical;
        T2 and practice identical. Gate PASS 8/8. 294,644 leakage assertions, 0 fails.
  3. PHASE 8c REPRODUCED EXACTLY: alternatives/read 1.827 -> 1.429 (-0.435
     [-0.470,-0.401]); hits 1.846% -> 1.062% (-0.91 pts [-1.41,-0.51]); removed
     44,325/871 = 1.97% vs retained 158,712/1,180 = 0.74% (+1.22 [+0.45,+2.21]);
     R1 +21.70 [+17.07,+26.50]; band precision 0.37/2.90/3.61%; HIGH label 649/0;
     identity 128,816/128,816; primary identical on all 128,816 records.
     Rule G0 R1 R2 yes, R3 no, B1 B2 B3 no -> CONDITIONAL (not blocked).
  4. ALTERNATIVES ARE SECONDARY in every contractual sense: "optional secondary
     suggestions", "zero alternatives is a valid, common, correct read", "the first
     thing to remove", count defined by band, UI "not forecasts". The regression is
     the frozen cap rule biting once bands mean something (counterfactual C = A).
  5. NO RETRAINING, NO RECALIBRATION; re-validation required (shadow plan).
  6. NEW IMPLEMENTATION HAZARD, MEASURED: under an unpinned wall clock
     test_change_probability_is_not_pegged_for_a_steady_player fails from
     2026-09-27T18:51:45Z (fixture P 0.0056 under 9999, 0.4305 at today's UTC, 0.8119
     in 2027). All 147 predictor tests pass under 9999 and under today's clock.
  7. UTC IS LIVE-DEMONSTRATED: this host's UTC clock read 20260914T185253 while local
     time was 15 September (+05:30).

LEAKAGE       PASS (recorded 294,644 / 0; implementation leak-free by construction; host
              clock skew clamps to the anchor value).

CONTRACT      predictor.py: import time; _request_stamp() = time.gmtime() as
              "%Y%m%dT%H%M%S.000Z"; line 104 timestamp=cutoff_ts or _request_stamp();
              line 106 untouched. shadow.VERSIONS["features"] = "phase2-21-reqstamp-utc".
              Spec 2.2/6 rows + a 7 note. Tests T1-T7, tightened version pins, stamp
              pinned in existing suites, offline equivalence vs recorded pB / condition B.
              NOT in the change: pools, vocabulary memory, displacement, retraining,
              recalibration, caps/labels, UI copy, Brain persistence, CLASH_OIE.

NEW DEFECTS   KNOWN BUGS #24 wall-clock-dependent steady-player test (latent until the
              fix); #25 version pins hardcoded and checked by substring; #26 shadow drift/
              baseline version-blind and practice drift never evaluated (REFERENCE keyed
              "duel"); #27 stale 92.1%/47.3% comment in the opponent-read panel; #28
              shortlist's _primary_band is computed and discarded. None fixed.

DECISION      CONDITIONAL. Approve the minimal dark implementation on the account holder's
              explicit acceptance of the alternative regression. CLASH_OIE stays off;
              shadow and on are separate approvals; the caps review stays separate.
Artifact      DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md
```

### Brain Phase 9 — full entry

```
Date          2026-09-14
Question      Does expanding the candidate pool from the currently available legal
              candidates to the player's historically observed full deck vocabulary
              materially improve next-deck prediction on a leakage-free chronological
              replay?

Gate          README s32 (Phase 9, proposed as Phase 8 by Phase 7), used VERBATIM:
              clause 1 FULL - duel history, top-1 over ALL test steps, paired, CI > 0;
              clause 2 ranker - random-in-legal-pool at pools >= 5, paired, CI > 0.
              Two readings evaluated, none chosen: U1 archetype (phase21a Tables
              "A full"), U2 exact deck (duel_zone.predict_companions + 0-shared legal).
              PROMOTE additionally required clause 1 point > 0 under S-EXACT and S-ARR
              (Amendment 1.4, written before outcomes).

Method        Read-only VPS extract (mode=ro, query_only, nice/ionice). Phase 1's duel
              steps REPRODUCED EXACTLY via its snapshot stored_at (99,920 raw / 93,541
              series / boundary 20260830T133255 / 79,894 test steps / 39,936 players) +
              14,810 post-cursor steps. Per-step strictly-prior vocabularies: A (duel
              history), C (Coach Assist C0), BAT, FULL = A u BAT (C2), FULL60 (C1).
              Visibility: snap (Phase 1 harness), S-ARR (battles arrival from a
              validated id clock), S-EXACT (raw stored_at). Coach windows W1/W2
              replayed exactly. OIE next-play ceiling on Phase 8b/8c's 128,816 reads.
              Pre-registered; 2 amendments before the figures they govern.

DEFINITION    FULL(P,T) = every complete 8-card deck P revealed in a native duel
              series or played in a battles row with battle_time < T (multiplicity
              kept); legal = 0 cards shared with the cards P already used this series.
              No recombination, no opponent or meta decks.

RESULT        CONDITIONAL.
  1. GATE (event, Phase 1 steps):  U1 +1.39 [+1.17,+1.60]   U2 +0.36 [+0.18,+0.55]
     clause 2 (pools >= 5):         U1 +9.09 [+7.56,+10.63]  U2 +11.91 [+10.64,+13.28]
  2. ARRIVAL: S-ARR U1 -0.06 [-0.18,+0.06] U2 -0.48 [-0.59,-0.36];
              S-EXACT U1 -0.62 [-0.94,-0.28] U2 -1.56 [-1.90,-1.22];
              post-cursor even at event time U2 -1.63 [-2.16,-1.10]
  3. POOLS (event / S-ARR):  zero-pool A 59.94/78.97  C 65.95/87.66  FULL 47.65/76.58
                             exact recall A 30.36/13.37  C 25.40/7.52  FULL 37.14/14.92
                             median/p90 legal decks A 0/3  C 0/3  FULL 1/5
  4. RANKING: U2 top-1 A 21.15  C 17.57  FULL 20.37; top-3 28.79 / 23.60 / 31.30;
     top-1 | truth in pool 69.7 / 69.2 / 54.9; dilution (truth in both) -8.41 to -12.81
  5. vs CURRENT (C0): +3.85 [+3.62,+4.07] event, +3.38 S-ARR, +3.63 S-EXACT
  6. SUPPORT (FULL - A U2): 1 deck +8.72; 2-4 +3.08; 5-9 -5.70; 10-24 -6.94;
     25+ -12.66. Duel strangers with battles +8.98; duel-seen -6.03; tracked -11.37
  7. RECENCY: FULL60 = FULL (+0.03). Added candidates' precision 9.43% (<1 d) ->
     0.37% (>30 d); 59% of additions are stale.
  8. CEILING: 36.3% of steps subject unseen; 24.6% need a card never shown;
     1.97% recombination; 37.14% reachable.
  9. OIE UNIT (ceiling only): competitive served 62.98% -> full vocabulary 80.55%
     (+18.03 [+16.00,+20.10]); changes 4.75% -> 49.96%; 50.0% of switched-to decks
     never observed. Reproduces Phase 8c.
 10. POST-HOC (not gating): duel history with a full-vocabulary fallback when it
     has no legal deck: +2.38 event, +0.36 S-ARR, +0.40 S-EXACT (all CIs > 0).

LEAKAGE       PASS, 0 violations in 22 assertion families. Phase 1's harness admits
              unarrived history: 22.2% of steps reach their truth only through it.

NEW DEFECTS   KNOWN BUGS #21 (non-duel raw stored_at is a re-store time before the
              last purge), #22 (Phase 1 population not reproducible by battle_time),
              #23 (Coach window 1 shows card-illegal decks). None fixed.

DECISION      Change no candidate pool. Do not promote the full vocabulary. Coverage at
              request time is bounded by ingest latency. Brain deck memory not
              justified beyond an arrival time per observation.
Artifact      DECKKIES_BRAIN_PHASE9_CANDIDATE_POOL_REPLAY.md
```

### Brain Phase 8c — full entry

```
Date          2026-09-14
Question      Does the alternative-hit regression caused by the correct timestamp
              (Phase 8b: 1.85% -> 1.06%) represent a meaningful loss of useful
              recommendations, or an appropriate consequence of better calibration?

Method        Read-only, NO database, NO VPS. Phase 8b's exact production-order
              reads (A25). Real predictor.predict under "9999" and the request
              stamp on all 128,816 random-clock T1 reads, cap step bypassed in
              process to recover each read's full ranked list; caps re-applied
              with production's ALTERNATIVE_CAPS. PRE-REGISTERED decision rule
              (R1 discrimination, R2 band ordering, R3 removed alternatives
              low-value; BLOCK on >= MIN_RESCUE 3% lost hits, mechanism harm, or
              needing unvalidated thresholds). Conditions A (9999), B (fix),
              C (fix + today's count), D (no alternatives), E (uncapped ceiling).

DEFINITION    An alternative is a ONE-CARD EDIT of the recent deck (C1WideOneCard
              over unfitted E4/S2, first 3 in generator order), labelled by
              shortlist._band, capped high 2 / medium 1 / low 0. UI: "Plausible
              configurations ... not forecasts". Contract §2.4: secondary,
              "zero alternatives is a valid, common, correct read", "the first
              thing to remove". Only frozen evaluation: coverage.

RESULT        CONDITIONAL.

  1. COMPETITIVE (111,123 reads, 773 players), A -> B:
        alternatives/read 1.827 -> 1.429   -0.435 [-0.470,-0.401]
        hit 1.846% -> 1.062%               -0.91 pts [-1.41,-0.51]
        false alternatives/read 1.809 -> 1.418  -0.426 [-0.460,-0.393]
        coverage (Recent OR alternative) 62.98% -> 62.20%
        identity/order identical 128,816/128,816; primary unchanged
  2. CHANGE/NO-CHANGE. Unchanged reads (61%): false alternatives -0.320/read.
     Changed reads: hit 4.75% -> 2.73% (-2.85 pts); "no alternative shown"
     2.4% -> 24.1%. 80.1% of changes are 3+-card switches no one-card edit can
     match; 13.8% are 1-card edits, 38.6% of those in the uncapped list.
  3. BANDS (corrected): change rate high 30.7% / medium 46.7% / low 65.6%
     (macro 35.3 / 50.8 / 68.9). Alternative precision 0.37% / 2.90% / 3.61%
     against caps 2 / 1 / 0. THE CAP POLICY IS ORDERED AGAINST USEFULNESS.
     813 of the 871 lost hits are on B-low reads.
  4. REMOVED vs RETAINED: removed 44,325 alternatives, 871 hits, precision
     1.97%; retained 158,712, 1,180 hits, 0.74%; +1.22 pts [+0.45,+2.21].
  5. COUNTERFACTUAL: C (fix + today's count) reproduces A's alternatives
     exactly but shows up to 2 alternatives on 14,699 low-band reads (13.2%),
     inverting rule 4, unvalidated. D (none): coverage 61.13%. E (uncapped):
     hit 2.07%.
  6. PRACTICE: shows no alternatives in production under either stamp;
     would-be hit 0.97% -> 0.00%; not relevant to production.

RULE          G0 yes, R1 yes (+21.7 pts [+17.1,+26.5]), R2 yes, R3 NO;
              B1 no (0.78 pts), B2 no, B3 no  -> CONDITIONAL.

NEW DEFECTS   KNOWN BUGS #19 HIGH alternative label unreachable (needs p >= 0.5,
              but p >= 0.45 caps alternatives at 0; 649 generated, 0 shown).
              KNOWN BUGS #20 UI subtitle "seen in this player's own history":
              73.7% of shown alternatives are not in the visible history.

DECISION      Timestamp fix NOT BLOCKED. Cleared for controlled implementation
              on explicit acceptance of the alternative regression (Option A).
              ALTERNATIVE_CAPS review warranted, SEPARATE, with its own gate.
Artifact      DECKKIES_BRAIN_PHASE8C_ALTERNATIVE_REGRESSION_AUDIT.md
```

### Brain Phase 8b — full entry

```
Date          2026-09-14
Hypothesis    The Phase 8 request-time timestamp still beats "9999" in
              PRODUCTION'S OWN ORDER, when each read sees only the battles that
              had actually ARRIVED, under the README §32 pre-registered gate.

Method        Read-only extraction from the VPS (mode=ro, query_only, nice/ionice,
              paused during polls, 405 s): bot_health, tracked_players,
              battle_raw.stored_at since the purge cursor (1,546,570 rows), and a
              seeded 1,200-player sample of tracked players (693,300 history rows).
              PRE-REGISTERED before any model output; one dated amendment before
              results (reading S2 is vacuous).
              Information set per request R: rows with arrival <= R, battle_time
              >= source._days_ago(60) on R's date, newest 1,200 across all modes,
              then production's own _rows_to_plays and adapter.build_context. A =
              "9999", B = R (UTC). Same rows, shell, results, domain string.
              Families: RANDOM CLOCK (gated; 15-min grid over 2026-09-12T03:00Z ->
              2026-09-14T04:30:18Z), ALP (h after the last true play), BB (e before
              the next battle). Targets: T1 first battle after R; T2 first battle
              after the last visible play. The gate was evaluated under all 8
              readings of its ambiguous clauses. Bootstrap: player-cluster AUC,
              paired_delta Brier, 2,000 reps, seed 20260818.
              Real predictor.predict under both stamps on 4,500 reads;
              alternatives on all 111,123 competitive reads.

RESULT        PASS (8/8 readings) -> eligible for controlled fix implementation
              review.

  1. COMPETITIVE, RANDOM CLOCK, T1: 111,123 reads, 773 players, change 38.9%
        ROC-AUC     0.6188 -> 0.6734   +0.0545 [+0.0381, +0.0698]
        Brier macro 0.3710 -> 0.2747   -0.0963 [-0.1103, -0.0828]
        PR-AUC 0.503 -> 0.574; recall@0.5 0.4% -> 20.0%; ECE 0.347 -> 0.218
        high 92.8% @ 63.3% pooled / 59.9% macro -> 65.0% @ 69.3% / 64.7%
        ordering holds on all 3 bands (A: only 2 bands supported); 33.2% move
     T2: AUC +0.0392 [+0.0216,+0.0575], Brier -0.0389 [-0.0563,-0.0216]; passes.

  2. EVERY COMPETITIVE FAMILY AND BUCKET IMPROVES. ALP 5min..36h and BB
     1min..1h: AUC +0.032..+0.046, Brier -0.065..-0.104, all CIs clear of zero.
     Idle > 24h since the last visible play (25.9% of reads): Brier -0.2324.
     Reads with >= 1 battle played but not yet arrived (31.4%): AUC +0.0735,
     Brier -0.1545. < 5 min fresh: 56 reads, ns.

  3. PRACTICE (not gated): Brier -0.2885 [-0.3346,-0.2395]; AUC +0.0288
     [-0.0263,+0.0838] ns; AUC signs negative (ns) in every 5min-24h bucket.

  4. FEATURES: x10 alone +0.0505 AUC / Brier -0.1215 (better calibrated than
     both); x9 alone AUC -0.0051 ns / Brier +0.0166 worse; both +0.0545 / -0.0963.

  5. PRIMARY DECK IDENTICAL 4,500/4,500 real predict calls; alternative
     identity and order identical. ALTERNATIVES: shown -0.435 per read
     [-0.470,-0.401]; a shown alternative is the next deck 1.85% -> 1.06%
     (-0.91 pts [-1.41,-0.51]). The corrected low band caps alternatives at 0
     on the reads likely to change.

  6. TIMING (measured). Tracked ingest lag median 1.89h, p95 3.79h, max 9.0h,
     100% < 6h; untracked (back-fill) median 5.25h, p90 24.6h. Random-clock
     reads: request - last visible median 11.3h; request - arrival median
     5.1h; next battle - request median 5.3h. No production request timestamp
     exists anywhere (api.log untimestamped, client metric in memory).

  7. 36 HOURS. 18.9% of competitive random-clock reads are >= 36h after the
     last visible play (change 57.7%); as steps (ALP 36h) only 93 reads (41.9%).

  8. CENSORING (46% of competitive reads) biases AGAINST the fix. Post-hoc,
     >= 24h lookahead: Brier -0.1089 [-0.1236,-0.0945], AUC +0.064.

LEAKAGE       PASS. 294,644 assertions, 0 failures (arrival <= R, battle_time
              < R, extract(stamp) == replay, A/B identical except 9/10, target
              > R); fast path == real predict (max |d| 2.2e-16).

NEW DEFECTS   KNOWN BUGS #15 bot cadence ~4h, not 2h (skip guard); #16 the
              battlelog caps at 30 (13.2% of tracked polls hit it); #17 the
              stamp fix cuts alternative hits via ALTERNATIVE_CAPS; #18 arrival
              data is destroyed at every bot restart.

DECISION      PASS -> eligible for controlled fix implementation review. Not
              implemented. The review must decide the alternatives regression.
              CLASH_OIE stays off. Phase 9 research is independent.
Artifact      DECKKIES_BRAIN_PHASE8B_PRODUCTION_ORDER_TIMESTAMP_REPLAY.md
```

### Brain Phase 8 — full entry

```
Date          2026-09-13
Hypothesis    predictor.predict's timestamp="9999" materially damages the frozen
              change model, and supplying the correct timestamp would be worth
              a future controlled change.

Method        Read-only. NO database. The frozen model's own harness:
              phase2-features.jsonl.gz, phase2.temporal_split(0.70), test
              99,541 steps (competitive 90,892 / practice 8,649). The frozen
              artifact m2-change-v1 loaded exactly as production loads it, never
              refitted. ONE variable: features 9 and 10.
              PRE-REGISTERED before any Condition B number: conditions,
              metrics, strata, the gate (+0.010 AUC, 5% band movement).
                A   x9=x10=0            = timestamp "9999" (proved by call)
                B1  stamp = predicted battle's time (training definition)
                B2  stamp = the shell's last play (strictly historical)
              Ablations x9-only / x10-only; is_duel domain fault separately.
              ROC-AUC CI: paired player-cluster bootstrap, 2,000 reps, seed
              20260818, identical draws both arms. Brier: paired_delta.
              Leakage: 300 synthetic chronologies, 19,077 checks.
              Frame check over phase18-plays; serve-gap check over the shadow
              log; model-output sweep over request delays.

RESULT        CONDITIONAL (pre-registered).

  1. B1 REPRODUCES PHASE 2 EXACTLY: 0.9315 / Brier 0.0471 / PR 0.7098 /
     F1 0.6142 competitive; 0.8032 / 0.1905 / 0.7698 / 0.6946 practice.
     The artifact IS Phase 2's M2 - and production has never run it.

  2. THE BUG'S COST AT THE TRAINING STAMP.
        competitive ROC-AUC 0.8584 -> 0.9315  +0.0731 [+0.0625, +0.0855]
        Brier -0.0265 [-0.0326, -0.0209]; recall@0.5 5.9% -> 50.1%
        practice 0.7601 -> 0.8032  +0.0431 [+0.0307, +0.0561]

  3. AT A STRICTLY HISTORICAL STAMP IT IS WORTH NOTHING.
        B2 competitive +0.0031 [-0.0014, +0.0076] ns; Brier +0.0013 WORSE

  4. ATTRIBUTION.  x10 alone +0.0721; x9 alone -0.0282 (worse than the bug);
     both +0.0731. A partial fix is harmful.

  5. THE GAIN IS BETWEEN RECENCY BUCKETS, not within: within-bucket AUC gains
     +0.002 to +0.033; the >=24h bucket (5.25% of steps, 66.5% change) moves
     Brier 0.4625 -> 0.1434.

  6. PRODUCTION CANNOT SUPPLY THE TRAINING STAMP.  Shadow-log requests arrive
     a median 36.0h (competitive) / 49.1h (practice) after the last play;
     63% / 89% >= 24h. Training x10 median 5 minutes, 2.7% >= 24h. At a 36h
     request the frozen model puts 34.2% of competitive reads in "low" (was
     1.2%) and 100% of practice.

  7. BANDS.  Frozen cuts: competitive high/medium/low 85.8/13.0/1.2% (A) ->
     82.6/10.5/6.8% (B1); 10.84% of steps change band; ordering holds in both.
     Every production band validation ran on the buggy outputs.

  8. FRAME.  x10 alone: 0.839 in the harness, ~0.63 within "shell is / is not
     the previous battle's" (7.2% / 36.0% not), 0.712 in production's frame.

  9. DOMAIN FAULT (new).  is_duel = 0 on practice reads since Phase 23:
     Brier +0.0020 [+0.0018, +0.0023], negligible.

LEAKAGE       PASS - 19,077 checks, 0 failures; valid only when the stamp is
              the prediction moment.

GATE          B1 significant and >= +0.010: PASS. B2 significant: FAIL.
              B1 Brier: PASS. Leakage: PASS. Risk LOW (<5% band movement):
              FAIL (10.84%).  -> CONDITIONAL.

RISK          code edit LOW; behaviour HIGH; contract HIGH (recalibration and
              likely retraining are forbidden by the spec).

DECISION      Do NOT schedule the one-line fix. The defect is M2's definition
              of its strongest feature, not the string "9999". Correct the
              documentation (production's M2 is 0.858, not 0.932). Any
              rollout decision must choose serve semantics first.
Artifact      DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md
```

### Brain Phase 8, session 2 — re-verification and the request-time outcome test

```
Date          2026-09-14
Hypothesis    (a) Session 1 reproduces independently. (b) A request-time stamp,
              scored against real outcomes on the steps each request is about,
              is better or worse than "9999". Session 1 had declared (b)
              unmeasurable and scored only model OUTPUTS over all rows.

Method        Read-only, NO database. Pre-registered (scratchpad
              p8v/PREREGISTRATION.md) before any R/E/U number, disclosing what
              was already known. Own scripts; model via the production loader
              predictor._load_change_model(); cuts via calibration.thresholds.
              KEY STEP: a read at R = t_p + h predicts the shell's next outing,
              so it is about exactly the steps with gap g > h. Survival
              conditioning is observable at R, so it is not a leak.
                R(h)  stamp = anchor + h on g > h, h in {5min,1h,12h,36h,49h}
                E(e)  stamp = T - e on g > e, e in {1,5,15min,1h}
                      (usage-conditioned: a read e before the battle)
                U     random clock time in the gap, length-biased quadrature
              Paired vs A on identical rows; AUC player-cluster bootstrap
              (2000, seed 20260818) written afresh and equal to brute force on
              60 identical draws; Brier via significance.paired_delta.
              Leakage: 815,524 checks, synthetic + 239 real series.
              Frame check (descriptive): production next-play survival rates.

RESULT        Verdict CONDITIONAL (session-1 gate NOT re-run or moved).
              Pre-registered rule I4 FIRES.

  1. REPLICATION EXACT. Every point metric, CI bound, band share and ablation.
     DUMP PROVED BATTLE-TIME-STAMPED on 114,956 real steps (extract == dump
     on x9, x10, non-result features and label, 100%).

  2. REQUEST-TIME STAMPS, competitive, vs 9999 on the same steps:
        R(5min)  45,631 rows chg 17.0%  AUC +0.0028 ns   Brier +0.0018 [+0.0009,+0.0030] WORSE
        R(1h)    14,435      chg 39.9%  AUC +0.0061      Brier -0.0183
        R(12h)    7,472      chg 55.4%  AUC +0.0060      Brier -0.0944
        R(36h)    3,760      chg 71.2%  AUC +0.0060 [+0.0017,+0.0105]
                                        Brier -0.1596 [-0.1819,-0.1373]
                                        meanP 0.143 -> 0.556, ECE 0.570 -> 0.157
        R(49h)    2,976      chg 74.4%  Brier -0.1887
        E(5min)  AUC +0.0668, retention of the B1 gain 1.00
        E(1h)    AUC +0.0423 [+0.0301,+0.0552], retention 0.94
        U        AUC 0.7870 -> 0.8364, +0.0494 [+0.0330,+0.0702]
                 Brier -0.1706 [-0.1931,-0.1497]
     Practice same direction; R(5min) Brier also worse (+0.0046).

  3. SESSION 1'S SWEEP WAS THE WRONG POPULATION. At h = 36h it scored all
     90,892 competitive rows; only 3,760 (4.1%) are steps a 36h-late read can
     be about. Its "34.2% low" is 63.1% low on those rows - and they change
     71.2% of the time.

  4. BANDS. On R(36h) rows 9999 says "high" 57.8% at 58.8% Recent accuracy;
     request stamp "high" 12.1% at 69.7%. U: 61.0% @ 62.8% -> 15.2% @ 81.7%.
     Ordering holds under both; band movement 81.1% (U) - LOW bar still fails.

  5. PRODUCTION FRAME (descriptive, no model). Competitive next-play steps idle
     > 36h change 59.2% (n=402, 285 players) vs 9.6% overall - same direction,
     but only 0.33% of steps. Harness long gaps are 92.7% "returned to a shell
     after using others". PRACTICE INVERTS at 5min-1h (duel rotation; change
     59.5%, log-gap AUC 0.410).

LEAKAGE       PASS. 170 "every shell play < stamp" failures are all h = 0
              (stamp == anchor play, which has happened) - check-definition
              artifact; 17/17 synthetic classified by replay.

GATE (I-rules) I1 BETTER; I2 tolerance 1 h; I3 holds; I4 fires.

RISK          edit LOW; behaviour MEDIUM (was HIGH); contract MEDIUM (was HIGH):
              no retraining, recalibration not shown necessary, RE-VALIDATION
              required. Overall still not LOW.

DECISION      Recommendation SUPERSEDED: the fix is ELIGIBLE for a controlled
              review, stamp = request time in UTC. Not scheduled. Precondition
              is Phase 8b: a read-only VPS next-play replay with results at
              sampled request times, plus ingest lag and band reconciliation.
              Phase 9 (coverage) remains next and is not blocked.
Artifact      DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md §27
```

### Brain Phase 7 — full entry

```
Date          2026-09-13
Hypothesis    ml/substitution's player-specific displacement advantage (+10.02
              over player frequency with the exit GIVEN) survives when the
              outgoing card must first be predicted by the existing exit ranker.

Method        Read-only. NO live database. Phase 6's exact population
              (phase3-edits, committed 70% split, 4,234 held-out one-card
              edits) with E4Combined's recency inputs joined EXACTLY from
              phase4-edits (29,503/29,503, six identity fields equal).
              PRE-REGISTERED before any test number: systems, compositions,
              metrics, buckets, player floor, BH family, leakage table, and
              the README §32 gate operationalised as
                paired_delta(top-1[S2Transition o E4Combined, HARD], top-1[B1])
                must exclude zero, positive.
              Exit systems: random, global exit freq, player exit freq, E0,
              E4Combined (train-fitted) and E4Combined unfitted (production).
              Entry: B0, B1, B2, B3, B4 = S2Transition, B4-noP. Compositions:
              HARD (= production), PROB-canon (edit_model rank-softmax),
              TOPK3, PROB-cal (temperatures fitted inside train).
              Production-semantics replay: production.adapter.build_context
              over phase18-plays.pkl, 797 players, 138,978 steps >= boundary,
              numerator and denominator counted on the same steps.
              Research frame: phase7-steps test window, 70,659 steps.

RESULT        REJECT.

  1. THE GATE FAILS, EVERYWHERE.
        B1 player frequency (exit-independent, e2e = oracle)   31.77%
        B4 ml/substitution, oracle exit                        44.21%
        B4 o E4Combined, HARD                                  32.29%
        gate  -0.06 [-1.67, +1.47]  p=0.90
     Rolling origin 50/60/70/80/90%: -0.11, -0.21, -0.06, +0.51, +1.02, all ns.
     With E0 instead: -0.33 ns. Production-faithful: +0.61 ns.

  2. ORACLE TAX.  11.93 pts pooled (paired 10.08 [8.34, 12.00]);
     e2e/oracle 73.0%; ADVANTAGE RETENTION 4.2% (0.52 of 12.45 pts).
     Deployable support >=3: tax 18.81 [14.73, 23.24], e2e-B1 -1.07 [-6.01,
     +3.72]. The tax is LARGEST where the memory is strongest.

  3. THE MECHANISM.  E4Combined top-1 43.20% (macro 50.29%).
        exit right (43.2%): B4 69.11% vs B1 60.96%  +4.94 [+2.60, +7.32]
        exit wrong (56.8%): B4  4.28% vs B1  9.56%  -6.84 [-9.12, -4.66]
     On wrong exits the player layer has evidence for the WRONG card 58.0% of
     the time and its top card is the truth in 46 of 1,395.

  4. THE PHASE 6 "NECESSARY" PLAYER LAYER IS WORTH NOTHING END-TO-END.
        oracle +6.95 [+5.21, +8.85]   ->   predicted exit +0.21 [-1.15, +1.61]
        (+3.07 when the exit is right, -4.09 when it is wrong)

  5. PROBABILITY COMPOSITION DOES NOT REDUCE THE TAX.
        PROB-canon - HARD -0.06 ns; TOPK3 -1.59 [-2.45,-0.79];
        PROB-cal -1.54 [-2.83,-0.30]. Marginalising over exits re-derives
        player frequency's answer.
     The canonical rank-softmax gives the top exit a CONSTANT 0.401 on every
     event; its ECE 0.031 is a single bin, not calibration.

  6. NO DEPLOYABLE SPECIALIST.  Every bucket of support-of-the-PREDICTED-exit
     is ns. Only oracle-defined buckets are significant (>=3 +5.08, >=10
     +11.85), and they need the card that has not left yet.

  7. PLAYERS.  150 with >=10 edits: e2e better than B1 for 39, worse for 58,
     tied 53. Under the oracle 97 improve and 16 worsen.

  8. THE EXIT RANKER IS A ROTATION-SLOT DETECTOR.  55.88% top-1 when the true
     exit previously ENTERED the shell by an edit (74.7% of events), 5.70%
     otherwise (0 correct decks in 1,070). 55.5% of exited cards with a later
     event come back. An exit prediction is "the flex slot turns over", never
     rejection.

  9. RE-ADOPTION DEFINITION RECOVERED.  Phase 6's 61.81% = incoming card was
     the outgoing card of an EARLIER ONE-CARD edit by the player, any domain
     (2,617 exactly). End-to-end: re-adopted 47.27%, fresh 8.04% (B1 9.28%).

 10. PRODUCTION, COUNTED ON REAL STEPS.  138,978 steps: one-card edit 1.46%;
     production's top-2 alternatives exact 0.54%; displacement layer over B1
     with the same exit +0.017 pts [+0.008, +0.026] of all steps. Practice
     shows no alternatives; competitive shows 0 on a low band. Multi-card:
     the one-card method sees 8.92% of production changes with a shell.

 11. DISCLOSED SENSITIVITY.  "Baseline also run end-to-end" only has content
     at DECK level. There, B4 o X4 beats B1 o X4 +2.60 [+1.26, +4.00] and the
     gate would pass - still +0.017 pts of production steps, retention 28%.
     Pre-registration governs; conclusion (nothing to build) is the same.

LEAKAGE       PASS. Rankings recomputed with outgoing/incoming/result/opp
              masked: 0 differences across 5 exit and 4 entry systems on
              4,234 events. Structural probes 0 violations. Temperatures and
              stats train-only. Oracle-defined subsets always labelled.

DEFECTS FOUND production/predictor.py builds E4Combined and S2Transition with
              UNFITTED stats (harmless as measured, +0.67 ns); production's
              alternatives never hedge across exits (94.72%); E4's absence term
              is structurally zero; the canonical exit probability is a
              constant; Phase 6 never documented its re-adoption rule.

DECISION      REJECT. Displacement workstream STOPS (README §32). Attention
              returns to coverage (Phase 1 option a). Nothing promoted, built,
              enabled, deployed or committed.
Artifact      DECKKIES_BRAIN_PHASE7_END_TO_END_EXIT_REPLAY.md
```

### Brain Phase 6 — full entry

```
Date          2026-09-12
Hypothesis    The Phase 5 player-specific displacement signal (777 findings,
              255 players, permutation null 0) is PREDICTIVE, not merely
              descriptive: per-player out->in evidence, fitted on train only,
              beats the player-frequency baseline on chronologically
              held-out events.

Method        Read-only. NO live database. Cached dump phase3-edits.jsonl.gz,
              loaded through the harness's OWN loader.
              SPLIT CHOSEN BEFORE RESULTS AND NOT BY THIS SESSION: the
              committed ml.evaluation.phase3.temporal_split(TRAIN_FRAC=0.70),
              the same split OIE Phase 3 used. Boundary 20260810T161008.000Z.
                train 20,652 edits (10,752 one-card)  20260613..20260810
                test   8,851 edits ( 4,234 one-card)  20260810..20260819
              GlobalStats().fit(train) is the ONLY fitted object; all
              per-player evidence is carried per event from that event's own
              prefix. Metrics and paired bootstrap CIs (2,000 replicates,
              RESAMPLING PLAYERS) from the project's own modules.
              Two-card edits EXCLUDED: the out->in pairing is unidentifiable.
              NOTHING in ml/substitution was rebuilt - the two isolated rungs
              are COMPOSED from S._norm, S._blend, S.player_transition_dist,
              S.Ranker.pool and GlobalStats.transition.

RESULT        CONDITIONAL. The primary comparison FAILED as posed; the signal
              is real in a bounded region and the existing module already
              exploits it correctly.

  1. THE PRIMARY COMPARISON FAILS, AND AT EVERY ORIGIN.
        B3 player P(Y|P,X)  37.41%      B1 player frequency  31.77%
        paired delta  +1.20 pts  [-1.52, +3.94]   NOT SIGNIFICANT
     Re-run at 50/60/70/80/90% chronological cut points: +1.58, +0.57, +1.20,
     +1.95, +2.30 - ns at ALL FIVE.

  2. IT FAILS BECAUSE IT ABSTAINS, NOT BECAUSE THE SIGNAL IS ABSENT.
     B3 has no evidence on 45.09% of test events and degrades to an
     alphabetical ordering of the pool.
        player seen, card X never swapped   44.76%  B3 16.78 vs B1 26.86
                                                    -14.00 [-17.26, -10.78]
        player has >=1 prior edit of X      54.75%  B3 54.18 vs B1 35.63
                                                    +12.08 [ +8.40, +15.89]
     The overall wash is those two halves cancelling exactly.

  3. IN THE SUPPORTED REGION IT WINS, MONOTONICALLY IN SUPPORT.
        support 1-2   n=1193  +8.10 [ +3.62, +12.46]
        support 3-4   n= 415 +13.79 [ +5.49, +21.60]
        support 5-9   n= 286 +14.65 [ +5.34, +23.90]
        support 10-24 n= 274 +25.33 [+12.35, +38.58]
        support >=25  n= 150 +10.19 [-15.95, +34.44]  ns - 13 PLAYERS, not
                                                      signal loss (B3 88.00%
                                                      vs B1 47.33%)
        cumulative >=3  1,125 events (26.6%)  +18.65 [+12.54, +25.29]

  4. ml/substitution ALREADY IMPLEMENTS THE FIX AND WINS OUTRIGHT.
        B0 global freq     20.76%      B2 global P(Y|X)   40.43%
        B1 player freq     31.77%      B3 player P(Y|P,X) 37.41%
        B4 ml/substitution 44.21%   (macro 46.21%)
        B4 - B1  +10.02 [ +7.94, +12.21]   significant
        B4 - B3   +8.82 [ +7.07, +10.77]   significant
     CEILING: the true incoming card is in the candidate pool for only
     61.38% of test events. B4 reaches 72.0% of the reachable ceiling.

  5. ABLATION: THE PLAYER LAYER IS THE NECESSARY ONE.
        remove global P(Y|X)   -0.85 [-1.61, +0.09]  REDUNDANT
          (but -1.24 [-2.20, -0.16] in the abstention region - it is the
           fallback, and only the fallback)
        remove player P(Y|P,X) -6.95 [-8.85, -5.21]  NECESSARY
          and -15.19 [-21.06, -9.83] on the supported subset
     Standalone the global table LOOKS better (40.43 vs 37.41); inside the
     ensemble it adds nothing where the player has evidence. REPORT MARGINAL
     AND INCREMENTAL TOGETHER - the Phase 5 section 11.2 lesson, repeating.

  6. WALK-FORWARD BUYS NOTHING.  B4 fixed 44.21% -> walk 44.33%,
     paired -0.09 [-0.38, +0.13]. The global table is saturated after 20,652
     events, and the per-player half was ALREADY walk-forward by construction.

  7. TEMPORAL STABILITY: FLAT. Three chronological slices of the test window:
     B4 44.93 / 43.66 / 44.05; B3 on support>=3 64.00 / 58.93 / 64.27.
     Ten days only - this does not cover a patch or a season turn.

  8. THE MODELS ARE A CARD-ROTATION MEMORY.
        61.81% of held-out one-card edits bring back a card that player had
        previously dropped.
        B4 on re-adoption 59.95%  vs  on a FRESH card 18.74%   (+41.22)
     This gives Phase 5's 73.9% re-adoption warning a predictive meaning, and
     it is why the new-card case is structurally hard (see 10).

  9. THE PHASE 5 SHOWCASE DOES NOT SURVIVE.  ronin -> mighty-miner:
        subject's ronin exits BEFORE the boundary  54  (mighty-miner 50, 92.6%)
        subject's ronin exits AFTER  the boundary   0
     ZERO held-out events - it cannot be validated at all.
     AND THE CONTRAST WAS OVERSTATED: only 4 players ever make the swap and
     this one supplies 50 of the 54 population-wide occurrences. The true
     population rate is 15.84%; the "1.4%" was the leave-one-out denominator,
     correct arithmetic but misleading prose. PHASE 5 SECTION 5.4 IS
     SUPERSEDED ON THIS POINT. The 777-finding census itself stands.

 10. NEW-CARD CAPABILITY IS STRUCTURALLY WRONG-SHAPED, not merely untested.
     On cards the player has not previously cycled the best model scores
     18.74%. A newly released card is that case in the limit. No new-card
     test was run or fabricated; the five pieces of evidence needed to
     validate one later are listed in artifact section 20.2.

LEAKAGE       PASS. Eight empirical probes:
                incoming card is a candidate  61.28%  (NOT 100% - not planted)
                outgoing card in its own pool      0
                prior_edits > cluster_size-1       0
                sum(cluster_card_counts) != size*8 0  (truth not folded in)
                prev_deck subset of history   14,986/14,986
                split boundary strictly increasing  yes
                train/test event overlap           0
              THE ONE DOCUMENTED LEAK IS NOW QUANTIFIED. iter_examples picks
              the cluster using the TRUTH's cards. Reconstructed both step
              modes over 117 shared players from phase18-plays.pkl:
                pool recall  truth-selected 61.16%  leak-free 61.24%
                                                    delta -0.07 pts
              It does NOT inflate the ceiling. What it DOES change is the task
              POPULATION: 48.8% of changes are one-card under next-in-cluster
              against 15.2% under next-play.

FRAMING       These are ONE-CARD EDITS WITHIN A SHELL THE PLAYER STAYED ON,
CAVEAT        which README section 18 records as 1.8% (competitive) / 2.3%
              (practice) of PRODUCTION steps. And the exit is an ORACLE - the
              best exit ranker is 50.0%/49.3% top-1, so end-to-end is
              plausibly ~22%. A +10 point gain here is not a +10 point gain
              to any shipped product.

STATISTICS    No binomial test was used, so the Phase 5 mistake could not
              recur. No threshold was fitted - the floor is the pre-existing
              opponent_profile.MIN_SAMPLE_TRANSITION = 3 and the full bucket
              sweep is reported including both non-significant cells. FDR was
              deliberately NOT applied to the 12 pre-specified model
              comparisons and the reasoning is declared; it would change no
              verdict. A permutation null is NOT applicable to a predictive
              replay; ROLLING ORIGIN is the equivalent guard and was run.

DECISION      CONDITIONAL. NOTHING PROMOTED, NOTHING BUILT.
              Six conditions on any future promotion, artifact section 27.2:
              backoff mandatory; support gating mandatory; quote the ceiling;
              state the step definition and its production share; no
              confidence band until one is measured; re-measure across a
              release and a patch.
Artifact      DECKKIES_BRAIN_PHASE6_CHRONOLOGICAL_DISPLACEMENT_REPLAY.md
```

### Brain Phase 5 — full entry

```
Date          2026-09-12
Hypothesis    The real card-change substrate (ml/dataset edit events over
              `battles`, which Phase 4 pointed at) can support Brain card
              intelligence: displacement, player-specific patterns, adoption,
              and new-card role detection.

Method        Read-only census. NO live database. Measured against the cached
              evaluation dumps already on this machine:
                phase3-edits.jsonl.gz   29,503 edit events, 389 players
                phase4-edits.jsonl.gz   29,573 (a second dump, +streak/last_seen)
                phase7-steps.jsonl.gz  337,651 steps, 400 players
                phase18-plays.pkl      283,122 plays, 797 players, 77 days
              Statistical helpers IMPORTED from the project's own modules:
              opponent_profile.wilson_interval / entropy / MIN_SAMPLE_TRANSITION,
              knowledge_mining.benjamini_hochberg / MIN_SUPPORT / MIN_LIFT /
              MIN_TREND_SUPPORT / MIN_TREND_CHANGE, cards.get_win_condition.
              A permutation null was run on EVERY claim.

RESULT        HYPOTHESIS SUPPORTED. First Brain phase to return a positive.

  1. GLOBAL DISPLACEMENT IS REAL, NOT POPULARITY.
     On the 14,986 one-card (unambiguous) edits, with an eligibility-adjusted
     baseline P(Y enters | Y was not already in the deck):
        observed out->in pairs                    2,249
        clearing support >= 25                      118
        surviving Benjamini-Hochberg q=0.05         114
        AND lift >= 1.5                             112
        pairs with lift < 1.0                         0
     PERMUTATION NULL (resample the incoming card from the global
     distribution, respecting eligibility): 0, 1, 1, 2, 2. Essentially empty.
     Strongest by lift: tombstone->goblin-cage 110.2, skeleton-barrel->
     hog-rider 106.9, electro-dragon->baby-dragon 102.3, poison->rocket 33.9.
     ONLY 4 OF THE TOP 25 BY COUNT APPEAR IN THE TOP 25 BY LIFT.

  2. PLAYERS DIFFER, AND 255 OF THEM CAN BE QUOTED INDIVIDUALLY.
     Exact binomial, leave-one-PLAYER-out baseline, BH q=0.05:
        floor n(player,out)>=3   2,823 cells   777 survive   255 players
        floor >=5                1,580          550          209
        floor >=10                 584          251          128
        floor >=25                 109           53           31
     PERMUTATION NULL (shuffle the player label within each outgoing-card
     stratum): 0.0 at floor 3. One player runs knight->berserker 135/135 where
     the population sits at 44.8%; another runs ronin->mighty-miner at 92.6%
     against a population 1.4% - a 66x difference on 54 observations.

  3. ADOPTION-DRIVEN DISPLACEMENT IS DETECTABLE AND ROLE-COHERENT.
     For rising cards, what they displace, with NO hand-authored metadata:
        void        -> fireball 34.1% (base 4.20%), arrows, lightning  [spells]
        goblin-hut  -> tesla    56.8% (base 2.57%), bomb-tower, tombstone
                                                              [buildings]
        berserker   -> knight   32.0% (base 3.09%), skeletons, goblins
                                                         [cheap ground troops]
        elite-barbs -> royal-ghost 27.3% (base 3.26%), lumberjack, mortar
     THIS IS THE CAPABILITY cardRoles.json CURRENTLY SUPPLIES BY HAND.

  4. THE THREE CONDITIONERS HAVE SIGNAL MARGINALLY AND NOTHING
     INCREMENTALLY - AND THAT EXPLAINS OIE PHASE 3'S S3/S4/S5 FAILURES.
        conditioner            marginal cells surviving   null   incremental
                                                                 given
                                                                 (player,out)
        own-deck archetype           246 of 1,569 (15.7%)    0     0 of 104
        opponent archetype            81 of 1,566 ( 5.2%)    0     6 of  30
        previous result                7 of 2,457 ( 0.3%)    0     2 of  87
     Phase 3 measured S3 at -1.60 pts and S5 at -2.97 pts. The mechanism is
     REDUNDANCY: the information is already carried by the player and the
     outgoing card, so conditioning only splits the support.
     ALWAYS REPORT MARGINAL AND INCREMENTAL TOGETHER.

  5. RESULT PREDICTS *WHETHER*, NEVER *WHICH*.
        P(edit | previous loss) 12.98%  [0.1281, 0.1316]  n=143,459
        P(edit | previous win )  5.77%  [0.0567, 0.0588]  n=190,622
        ratio 2.25 ; player-macro paired +7.12 pts [+6.07, +8.20], 399 players,
        positive for 320 of 399 (80.2%)
     Already exploited: prev_was_win / loss_streak / win_rate_last5 are three
     of M2's 21 contract features, and M2 is ROC-AUC 0.932. Confirms a signal
     production already uses; not a new opportunity.

  6. BEHAVIOURAL CONFIDENCE IS BUILDABLE, FROM FOUR MEASURED COMPONENTS.
        least-used-in-shell predicts WHICH card leaves: top-1 44.0%, top-2
          57.3%, vs 12.5% chance = 3.5x. Player-macro 45.7% [43.2, 48.2].
        shortest-streak 42.9% (3.4x); least-RECENTLY-seen only 15.5% (1.2x).
        HOW MUCH you play a card matters; WHEN you last played it does not.
        73.9% OF DROPPED CARDS ARE LATER RE-ADOPTED (17,227 of 23,314) -
          dropping is rotation, not rejection. A confidence model that reads
          a removal as rejection is wrong three times in four.
        per-player entropy over dropped cards spans 0.46 to 5.78 bits.

STRUCTURAL FINDINGS (both are rules, not behaviour)
  - AN EDIT IS CAPPED AT TWO CARDS BY THE CLUSTERING RULE. cluster_containing
    requires >= 6 shared cards with `previous`, so n_changes <= 2 always.
    Verified on all 337,651 steps: 0/1/2 cards changed, ZERO at 3+.
    "Full deck changes" = 0 BY CONSTRUCTION. A genuine rebuild produces NO
    edit event and is invisible to this substrate.
  - HALF THE DATA IS EXCLUDED FROM EVERY DISPLACEMENT FIGURE. 49.2% of edits
    are 2-card, where the out->in pairing is unidentifiable and GlobalStats
    counts the full cross-product. Section 4 uses 1-card edits only.

FAILED / DISCARDED THIS PHASE
  - NAIVE SHARE-OF-PLAYS TREND. Produced a confident, wholly false table
    (rune-giant +790%, ronin -82%). Cause: the play log is a player-ENROLMENT
    ramp - 3.32% of plays in the first half of the window, 85% in the last 30
    days of 77, 50% in the last 10 days, day 1 has ONE player. Replaced by a
    fixed cohort (178 players, two 15-day blocks, ratio 1.12) with paired
    per-player bootstrap CIs: 37 of 120 cards move, 79 flat.
  - knowledge_mining.binomial_p AT n>=3. Its normal approximation is
    documented valid only above MIN_SUPPORT=25. At k=3,n=3,p0=0.20 it returns
    0.00027 against an exact 0.00800 - a 30x over-rejection. The permutation
    null caught it: 1,312 of ~5,230 NULL cells "survived". Redone with an
    exact binomial the null falls to 0.0 and the observed count drops
    1,649 -> 777. Every bot caller respects the floor; this is a caution for
    new code, not a live bug.

NOT TESTED
  - NEW-CARD DETECTION. No card release falls inside the window: the data ends
    2026-08-19 and Minion Giant shipped 2026-09-07. The METHOD is specified
    (a hard zero across a stable well-populated window, then a step; plus
    simultaneous adoption across unrelated players) but is untested.
  - OUT-OF-SAMPLE ANYTHING. Every figure is in-sample. No chronological
    hold-out was run. These are descriptive statistics with multiple-testing
    control and nulls, NOT predictive evaluations.
  - The 3 FASTEST-rising cards (rune-giant 22, little-prince 19,
    suspicious-bush 12 incoming edits) are all BELOW the support floor. New-
    card displacement intelligence has inherent latency.

PIPELINE DEFECT (verified, NOT fixed, as instructed)
  - knowledge_graph.refresh watermarks on SERIES START = battle time.
    Confirmed. A10 violation, unchanged since Phase 4.
  - NEW: THE DEFECT CLASS ALREADY COST THIS PROJECT 172,414 BATTLES.
    archive.py's own comment: late arrivals land BELOW a battle_time
    watermark because ingest_opponent_snapshots() (bot.py:5520) inserts a
    newly-seen opponent's whole back-catalogue. "Measured 2026-07-29: 172,414
    local battles at/below the watermark had never reached the archive (8% of
    history)". Fixed there by cursoring on battles.id (AUTOINCREMENT) and
    stored_at. knowledge_graph NEVER GOT THAT FIX.
  - IT DOES NOT AFFECT THIS SUBSTRATE. ml/dataset.load_plays has NO time
    predicate and no watermark - a full re-read every run.
  - BUT THE SAME ROOT CAUSE MAKES DUMPS NON-REPRODUCIBLE: history grows
    BACKWARDS, so clustering and therefore which steps are edits can change.
    Observable already - phase3-edits (29,503) and phase7-steps (29,824
    changes) were dumped 87 minutes apart and disagree.

DECISION     PROCEED WITH CONDITIONS.
             Five conditions, in artifact section 24.2: out-of-sample first;
             say what differs from Phases 10/12/13; reopen nothing; report
             marginal AND incremental together; run a permutation null on
             every claim.
Artifact     DECKKIES_BRAIN_PHASE5_CARD_ADOPTION.md
```

### Brain Phase 4 — full entry

```
Date          2026-09-12
Hypothesis    kg_edges.APPEARS_AFTER (493,696 observations / 11,946 edges) is
              genuine card-transition evidence and could be the Brain's
              card-intelligence foundation - "when a player removes X, what do
              they add?"

Method        Read-only, source-first. Traced the relation end to end in the
              bot's source: schema, writer, readers, generation path, source
              table, timestamps and every conditioning axis. Then verified the
              corpus size by exact arithmetic against the write algorithm and
              Phase 2's live totals. No database was opened.

RESULT        HYPOTHESIS FALSE, on four independent grounds.

  1. THE WRITE IS A CARTESIAN PRODUCT, NOT A SUBSTITUTION.
     knowledge_graph.py:201-206 pairs EVERY card of game i with EVERY card
     of game i+1. 8 x 8 = 64 observations per consecutive game pair. There
     is no set difference anywhere in the module: it never computes which
     card left or which arrived.

  2. THE TWO DECKS ARE CARD-DISJOINT BY CONSTRUCTION, SO A SUBSTITUTION
     CANNOT BE OBSERVED AT ALL. duel_split.split closes a series the moment
     a new deck shares ONE card with anything already played in it
     (`used_p` accumulates across the whole series). So a -> a is
     impossible, and a one-card swap between consecutive practice games
     ENDS the series and is discarded. The corpus is exactly the complement
     of the sample a substitution study needs.

  3. THE VOLUME IS 64x INFLATED.
        493,696 / 64 = 7,714 exactly, remainder 0   (transitions)
        339,220 / 28 = 12,115 exactly, remainder 0  (games, APPEARS_WITH)
        games - transitions = 4,401 series, 2.753 games/series
     Both divisions are exact, as the algorithm requires. So the real
     corpus is 60 players / 4,401 series / 12,115 games / 7,714 events.
     The OIE's own Phase 3 substitution study used 29,503 REAL edit events.

  4. NOTHING READS IT. grep over the whole bot tree returns exactly TWO
     lines: the constant (line 54) and the write (line 206). No reader, no
     query, no test, no finding. knowledge_mining mines APPEARS_WITH and
     BEATS only. Stale since 2026-08-02; no scheduler.

SEMANTICS    APPEARS_AFTER(a,b) = "card a was in the deck this player brought
             in game i of a practice series, and card b was in the -
             necessarily completely different - deck they brought in game
             i+1." It is ordered LOADOUT-COMPANION co-occurrence at card
             granularity. coach.next_decks / coach.observed_sequences already
             answer that question at DECK level, per player, in production.

THE TELL     Both codebases already document the exact trap:
               ml/dataset.py PredictionExample.previous - "they are
                 card-disjoint by rule, so comparing against it would SCORE
                 LOADOUT ROTATION AS A SUBSTITUTION"
               opponent_profile.build_profile - "a duel forbids repeating
                 cards, so a deck change is mandatory and MEASURES NOTHING"
             knowledge_graph walks the same loop over the same series and
             does what both warn against.

ALSO FOUND
  - count_30d / count_60d are NOT windowed counts. refresh_windows() sets
    them to `count` if last_seen >= cutoff else 0 - its own comment calls it
    "an upper bound". A trend cannot be computed from them, and nothing
    calls the function anyway. Recency on this relation is impossible.
  - wins/trials are 0 on all 11,946 edges - the write passes won=None - so
    the relation can never be conditioned on a result.
  - knowledge_graph.refresh watermarks on SERIES START TIME, i.e. battle
    time. That violates decision A10 and is the documented fault that left
    player_stats_agg 48% short. An independent defect.
  - Edge-space saturation is 80.9% of the 122x121 directed space from 7,714
    events. A near-full graph is evidence of the write pattern, not of
    structure in the data.

WHAT THE PROMPT ASKED THAT WAS ALREADY MEASURED (OIE Phase 3, 29,503 edits,
paired bootstrap on players):
    S0 global                     top-1 20.8% / 21.0%
    S1 + player                         28.8% / 25.4%   (+8.0 / +4.4)
    S2 + outgoing card                  35.6% / 30.4%   (+6.85 [+5.22,+8.75])
    S3 + opponent archetype   WORSE  -1.60 [-2.63,-0.76] / -0.51 [-0.77,-0.24]
    S4 + opponent deck        NULL   +0.14 [-0.15,+0.68] / -0.01 [-0.04,+0.00]
    S5 + previous result      WORSE  -2.97 [-4.16,-1.79] / -2.21 [-3.44,-0.74]
  So Parts 10 (result), 12 (opponent archetype) and 13 (matchup) of the
  Phase 4 brief are CLOSED BY MEASUREMENT, in the form they were asked.

DECISION     STOP on APPEARS_AFTER.
             PROCEED WITH CONDITIONS on card-transition intelligence, from
             ml/dataset edit events over `battles` - never from kg_edges.
Artifact     DECKKIES_BRAIN_PHASE4_CARD_INTELLIGENCE.md
```

### Brain Phase 3 — full entry

```
Date          2026-09-12
Hypothesis    If CLASH_W3_MODE had been "shadow" for 90 days, enough matched
              outcomes would accumulate to clear MIN_MATCHED_OUTCOMES = 200,
              making the existing loop the Brain's prediction-memory layer.
Method        Read-only. Reconstructed the W3 state machine and the event and
              matching lifecycles from the bot's source. Forensics on all four
              real events. Pair-encounter structure and a match-window sweep
              (30/60/120/180/240/360/720/1440 min) over 785,466 duel_timeline
              rows in the last 90 days, anchored on real encounters only.
              Ambiguity modelled with the matcher's own rule. Git history read
              for the August 3 cluster and the design rationale.
Expected      a match rate that either clears the gate or does not.
Actual        EVENT VOLUME IS IMPOSSIBLE TO RECONSTRUCT - events are written
              per !suggestion COMMAND and command traffic is logged nowhere
              (no table, no counter, no /opt/clashbot/logs directory). The only
              trace of real usage is suggestion_feedback: 4 rows, 1 user.
              MATCH RATE, measured: 20.80% optimistic / 6.60% realistic.
              WINDOW IS IRRELEVANT: 30 min 20.29% -> 1440 min 21.50%, i.e.
              +1.21 points over a 48x widening, because 92.65% of pairs meet
              EXACTLY ONCE. Median gap for pairs that do repeat: 5.6 minutes.
              AMBIGUITY MAKES WIDENING WORSE: 68.26% of claimable battles are
              claimed by 2+ prior encounters and refused by the matcher's own
              rule.
              THE FOUR REAL EVENTS: one opponent never seen again; the other
              three share a pair whose nearest later battle is 185.3 HOURS
              away - 93x the window, not a near miss.
              WHY IT WAS LEFT DARK IS DOCUMENTED, not inferred (commit
              e87b9dc): "do NOT promote CLASH_W3_MODE to primary" because the
              recommender gave 99.7% of users the SAME DECK (miner 301/302),
              caused by W2 distributions carrying 86% of maximum entropy.
              Offline comparison was then proven inapplicable (deterministic
              policy -> propensities 0/1; O1 and O3 agree 0/60).
Conclusion    STOP. The gate needs ~3,030 recommendations at the measured
              match rate; recorded traffic is four, by one person. Closed by
              traffic, by structure, and by a known unfixed product defect -
              any one of which is sufficient.
Decision      Treat the recommendation loop as a finished negative result with
              working code attached, alongside 17B, 18, 20A and 21A. Delete
              nothing (A17). The only part of the history that is inference
              rather than record is the final decision to stop - ask the
              author.
```

### Brain Phase 2 — full entry

```
Date          2026-09-12
Hypothesis    The four undocumented tables found in Phase 1 represent
              disconnected pieces of Brain architecture that could be
              connected rather than rebuilt.
Method        Read-only. Searched THIS repo (0 code references found), then
              audited the BOT's source at ~/Desktop/Clash_Bot (76 modules).
              Traced every writer and reader. Inspected all 4 recommendation
              events, all 1,460 findings, 27,904 graph edges and 785,587
              duel_timeline rows on the live VPS database, mode=ro. Ran the
              bot's 8 Brain-relevant test suites.
Expected      a few orphaned tables and some scaffolding.
Actual        A complete, tested, statistically careful learning system:
              prediction memory, outcome reconciliation (RUNNING IN
              PRODUCTION), calibration, conjunctive promotion gates,
              randomised experiments with logged propensities, a checksummed
              versioned artifact registry, an FDR-corrected pattern miner, a
              persistent typed knowledge graph, and per-player behavioural
              profiling. 280 tests, 0 failures.
              It is dark because CLASH_W3_MODE defaults to "off" and is
              absent from /opt/clashbot/.env. That one gate starves events,
              outcomes, scoring and the coach engine (which is nested inside
              it, so its own "shadow" default never applies).
Conclusion    The Brain is largely already built. The remaining work is
              configuration and validation, not construction. The one element
              that is genuinely absent - a mechanism that changes a model from
              an outcome - is absent DELIBERATELY, because the outcome data is
              self-selected and non-causal.
Decision      DO NOT REBUILD the nine modules. Next step is a read-only dry
              run measuring whether the loop could ever fill (Phase 3).
```

### Brain Phase 1 — full entry

```
Date          2026-09-12
Hypothesis    Opponent/player history derived from native duel payloads
              provides enough information to materially improve candidate-pool
              coverage (target: ~20 percentage points).
Method        Read-only census on the VPS. Reused ml.evaluation.phase21a's own
              parser, vocabulary and legality rule. 70% time split by series,
              both sides of every duel are subjects. Six evidence levels, with
              the cutoff mechanism separated from the evidence source so the
              two could be attributed independently.
Dataset       99,920 native duel raw rows -> 93,541 unique duels / 226,046
              games / 111,516 participants. Test population 79,894 steps.
              Step definition: phase21a's, "k decks shown, what is next".
              Time split boundary 20260830T133255.
Expected      zero-pool 71.7% -> ~50%
Actual        B0 baseline 76.59% | B1 (cutoff only) 61.58% | A (duel history)
              59.94% | B (player x opponent) 98.69% | C (x archetype) 84.43% |
              D (A + battles) 47.65% | battles ALONE 55.93%
              Attribution: cutoff mechanism +15.01, duel evidence +1.64,
              battles evidence +12.29.
              Ceiling: 57.34% of steps have a subject with no prior duel.
Conclusion    FAIL. The substrate's ceiling (19.25 pts) is below the gate, so a
              better implementation cannot pass it. The measured implementation
              is within 2.97 points of that ceiling.
Decision      Close the native-duel-coverage premise. Do not build a Brain
              store on it. Three findings carried forward (section 20, entry
              12; section 24, A14-REVISED).
```

### Template for every future entry

```
Date
Hypothesis
Method
Dataset (n players, n steps, time split boundary, step definition)
Expected result
Actual result (pooled AND player-macro, with CI)
Conclusion
Decision
```

---

## 20. FAILED APPROACHES

**NEVER DELETE THIS SECTION.** Each entry cost days. Three of them closed on
ceilings in the data, which a better model cannot move.

### 1. Model overrules Recent

- **Why attempted.** The obvious product: predict the actual next deck.
- **Implementation.** Phase 4 (chain change→exit→entry), Phase 5 (expected
  utility), Phase 6 (oracle gating), Phase 7 (selective policy).
- **Result.** All four lost to Recent. Phase 5's utility model correctly decides
  *never edit*. Phase 7: the truth was **not in the candidate set 80-88%** of the
  time.
- **What we learned.** Production makes this outcome *unreachable*, not merely
  unlikely — `enforce_primary` runs last and unconditionally.
- **Reconsider?** Only with a fundamentally different candidate source.

### 2. Historical exact-deck retrieval (17B)

- **Result.** A switched-to deck is one they have played only **49.8% / 38.5%**
  of the time. R@1 **falls** with more history: 87.4% at 2-3 known decks →
  **24.8%** at 11+, because vocabulary grows faster than the return rate.
- **What we learned.** More data makes this *worse*. It is a ceiling.
- **Reconsider?** **No.**

### 3. Novel-deck generation (18)

- **Result.** Only 52.1% / 61.7% of novel decks can even be *built* from cards
  the player has fielded. No generator reaches usable recall below **10⁸-10¹⁰**
  candidates.
- **Reconsider?** **No.**

### 4. Matchup-response prediction (20A)

- **Why attempted.** Narrower and apparently easier: given Y, which of X's own
  decks should X play?
- **Result.** The **ORACLE** arm — handed Y's true deck — scored **48.9%**
  against X's own default at **58.9%**.
- **What we learned.** If it fails with the opponent handed to you, adding
  opponent-prediction error cannot rescue it. Also: the design is
  **counterfactual** — we never observe what would have happened had X played
  something else — so any harness claiming to measure "the recommendation is
  better" has smuggled in an assumption.
- **Reconsider?** **No**, not on observational data.

### 5. Spell-conditioned prediction (21A)

- **Result.** Paired A−B over **20,702 players: 0.000 [-0.001, 0.001]**.
  Survives the dilution check at every pool size, with no trend.
- **Reconsider?** **No.**

### 6. Counter-sniping / per-opponent tendency / recency weighting

- **Why attempted.** "They just showed Hog, so they will bring the anti-Hog
  deck next" is the most intuitive feature in the problem.
- **Result.** Measured by the upstream bot on **3,569 leak-free trials**: top-1
  accuracy got **three times worse, 8.3% → 2.7%**. The deck a player actually
  brings scores **0.4856** against the opponent's last deck, versus **0.4961**
  for the average deck they could have brought. Recency weighting and
  per-opponent tendency were tested the same way; **neither beat plain usage**.
- **What we learned.** *Players do not counter-pick the previous game.* This is
  the direct negative result for second-order opponent reasoning.
- **Reconsider?** Only with data this project does not have (rank tier, stakes,
  or a population known to counter-pick). Note the trial data lives in the
  bot's repository — `Not verified here.`

### 7. 20B's forced-switch mechanism — **a measurement that was a tautology**

- **The claim.** Practice `high` failed at ECE 0.6097 because a duel loadout may
  not reuse a card, so "same deck again" is forbidden inside a series. The
  measurement appeared to confirm it spectacularly: the previous deck retained
  **0.00 of its 8 cards**.
- **Why it was wrong.** `used_before()` unions `plays[i-1]` whenever the link
  holds, so the previous deck is **always** fully inside the used-card set. Handed
  two linked battles on the *identical* deck — which the rule forbids — it still
  reported 0.00 of 8. **The function could not observe a violation with one in
  front of it.**
- **What we learned.** The run reconstruction was checked for circularity and
  was clean; the legality step immediately after it was not.
  **Checking one half of a two-step derivation is not checking the derivation.**
- **What survived.** The association is real (78.4% vs 16.5% deck change). The
  stated cause did not. Phase 20D then paired on the 203 players who experience
  both contexts: **0.013 [-0.038, 0.062]** — does not clear zero. *The huge
  pooled gap is BETWEEN players, not within them.*

### 8. The `duel` domain that contained no duels (20D)

- **What happened.** Two individually correct decisions combined into a wrong
  one: `is_duel_like_mode` admits anything containing "friendly" (because the
  bot reconstructs duels out of friendly practice), and `_rows_to_plays` drops
  any row that is not exactly 8 distinct cards (because a native duel row is a
  16/24-card loadout). Together they **admit practice and discard every real
  duel.**
- **Cost.** Twenty phases of results labelled `duel` describe *practice*.
- **What we learned.** Two correct filters can compose into a wrong population,
  and nothing downstream can detect it. **Census the population your evaluation
  actually ran on, by mode, before believing its label.**

### 9. Class weighting on M2

- Damaged PR-AUC, ROC-AUC, F1 **and** Brier. Off, on evidence.

### 10. `cluster_containing` for the current shell

- Returned a **different shell 25% of the time** in production. Replaced by
  exact membership (`adapter.current_shell`).

### 12. Native duel history as the answer to candidate coverage (Brain Phase 1)

- **Why attempted.** Phase 0 found the frozen engine had never read the native
  duel substrate, and that 71.7% of duel steps had no legal candidate pool. The
  inference was that the unread substrate was what would close the gap.
- **Implementation.** Read-only census, 93,541 unique duels, six evidence levels
  with per-step strictly-prior cutoffs, reusing Phase 21A's own parser and
  legality rule.
- **Result.** Zero-pool 76.59% → **59.94%**, +16.65 points against a 20-point
  gate. `battles` history **alone** does better (55.93%).
- **Why it failed.** **72.47% of duel participants appear exactly once.**
  57.34% of evaluated steps involve a subject never seen before, and no history
  can serve them. Ceiling = 19.25 points, below the gate. The implementation
  landed **2.97 points** from that ceiling.
- **What we learned.** Three things, all carried forward:
  1. Substrate **size is not coverage**. 226,046 games sounded like a large
     learning set; it is 111,516 mostly-transient strangers.
  2. The **cutoff mechanism is worth 15.01 points** on its own — more than any
     evidence source tested. An evaluation that compares a new source against
     Phase 21A's numbers without holding the cutoff constant will credit the
     source with up to 15 points it did not earn.
  3. **`battles` is the stronger substrate** for this problem and is already
     read by the frozen engine.
- **Reconsider?** **No**, not for coverage. The ceiling is a property of the
  population, not of the method. The substrate remains the only source of
  per-game duel outcomes and may be reconsidered for a different question.

### 13. Opponent-conditioned candidate pools (Brain Phase 1, levels B and C)

- **Result.** Player × this opponent: **98.69%** zero-pool. Player × opponent
  archetype: **84.43%** — both **worse than the baseline**.
- **Why.** **99.22% of player-opponent pairs meet exactly once** (92,135 pairs,
  723 meeting more than once). There is almost never a prior meeting to draw on,
  and conditioning on archetype discards decks the player is known to own.
- **What we learned.** `Player A × Player B × Deck choice` cannot be estimated
  at population scale. This closes the branch on **data availability**, which is
  a stronger closure than the counter-sniping result (entry 6) that closed it on
  model performance. Two independent closures now.
- **Reconsider?** **No.**

### 14. FAILED ASSUMPTION (Phase 2): "it does not exist because this repo has no code for it"

- **The assumption.** Phase 0 searched this repository for player memory,
  pattern memory, prediction memory and model versioning, found nothing, and
  recorded that none existed.
- **Why it was wrong.** The writers were never in this repository. All four live
  in the bot's codebase at `~/Desktop/Clash_Bot`, a separate project that
  deploys by hand to the same VPS and owns the database this project reads
  `mode=ro`.
- **What it cost.** Two phases of architecture planning for components that were
  already built, tested and in some cases running.
- **The rule that follows.** **A table with no writer in the codebase you are
  reading means you are reading the wrong codebase.** Phase 1 found the tables
  by listing `sqlite_master` directly rather than trusting the repository's
  queries — that instinct was right and should have been carried one step
  further, into the other repository, immediately.
- **Reconsider?** N/A — this is a process lesson, not a technical branch.

### 15. FAILED ASSUMPTION (Phase 2): FDR survival implies a useful finding

- **The assumption.** `kg_findings` holds 1,460 findings that all survived a
  Benjamini-Hochberg correction, so it is a validated knowledge base.
- **Why it is wrong.** **100% of tests surviving is a warning, not a
  endorsement** — it means every effect was so large the correction never bound.
  The top findings are archetype tautologies: *"bait appears with goblin-barrel,
  30.0x lift"* restates the definition of the bait archetype. `bridge_card`
  findings carry `p = 1.0` and are recorded as FDR survivors, which is a
  category error: they are a centrality measure, not a hypothesis test.
- **What we learned.** **STATISTICALLY SIGNIFICANT ≠ PREDICTIVELY USEFUL**, and
  a discovery pipeline that rejects nothing is not discriminating. Also: there
  are **zero player-specific findings** — every subject and object is a card or
  an archetype, so this is not behavioural memory.
- **Reconsider?** The *machinery* is excellent and must not be rebuilt. What
  needs revisiting is what it is pointed at.

### 16. The recommendation loop as the Brain's prediction memory (Brain Phase 3)

- **Why attempted.** Phase 2 found a complete, tested prediction-memory and
  reconciliation system already running. The obvious next step was to fill it.
- **Implementation.** Read-only replay: W3 state machine reconstruction, event
  and matcher lifecycle traces, forensics on all four real events, a
  pair-encounter census and an eight-point match-window sweep over 785,466
  `duel_timeline` rows, ambiguity modelled with the matcher's own rule.
- **Result.** Match rate **6.60% realistic / 20.80% optimistic**. The gate needs
  **~3,030 recommendations**; total recorded traffic is **four, by one user**.
- **Why it failed — three independent causes, each sufficient.**
  1. **Traffic.** Events are written per `!suggestion` command. Command volume
     is logged nowhere and the only trace of real usage is 4 feedback rows from
     1 person.
  2. **Structure.** **92.65% of player-opponent pairs meet exactly once**, so
     most recommendations can never match at any window. Widening 30 min → 24 h
     buys **1.21 points**, and **68.26%** of otherwise-matchable battles are
     refused as ambiguous — so widening makes it *worse*.
  3. **A known unfixed defect.** The recommender gives 99.7% of users the same
     deck.
- **What we learned.**
  - **The window was never the problem.** The instinct to widen it is wrong
    twice over: the gain is ~1 point and the ambiguity cost is larger.
  - **Almost everything the Brain wants to learn about players is already
    obtainable from `battles`.** The loop uniquely provides *calibration* —
    which is exactly what the unreachable gate protects.
  - Event volume depends on **user commands**, not battle data. A pipeline whose
    input is human traffic cannot be back-filled from a database.
- **Reconsider?** Only if `!suggestion` traffic grows by two or three orders of
  magnitude **and** the single-deck defect is fixed first. Delete nothing (A17).

### 17. `kg_edges.APPEARS_AFTER` as card-transition evidence (Brain Phase 4)

- **Why attempted.** Phase 2 recorded it as *"card→card across consecutive
  games, 493,696 observations — genuine card-transition evidence, and the raw
  material for 'players replace A with B'."* Phase 3 carried that forward as
  the answer to card switching. It was the largest unexamined substrate left.
- **Implementation.** Read-only source trace of the relation end to end —
  schema, writer, readers, generation path, source table, timestamps, every
  conditioning axis — plus exact arithmetic on the corpus size against Phase 2's
  live totals.
- **Result. THE RELATION IS NOT A TRANSITION AND CANNOT BE MADE INTO ONE.**
- **Why it failed — four independent causes, each sufficient.**
  1. **The write is a Cartesian product.** `knowledge_graph.py:201-206` pairs
     every card of game *i* with every card of game *i+1*. Sixty-four
     observations per game pair. There is **no set difference anywhere in the
     module** — it never computes which card left or which arrived.
  2. **The two decks are card-disjoint BY CONSTRUCTION.** `duel_split.split`
     closes a series the instant a new deck shares one card with anything
     already played (`used_p` accumulates across the whole series). So `a → a`
     is impossible, and **a one-card swap ENDS the series and is discarded**.
     The corpus is the exact complement of the sample a substitution study
     needs.
  3. **The volume is 64× inflated.** `493,696 / 64 = 7,714` exactly and
     `339,220 / 28 = 12,115` exactly, so the real corpus is **60 players,
     4,401 series, 12,115 games, 7,714 events** — against the 29,503 *real*
     edit events the OIE's own Phase 3 already used.
  4. **Nothing reads it.** Two references in the whole bot tree: the constant
     and the write. No reader, no test, no finding, no scheduler, stale since
     2026-08-02.
- **What we learned.**
  - **DO NOT INFER A RELATION'S MEANING FROM ITS NAME.** Phase 2 named it
    correctly as a *relation* and wrongly as *evidence*, and two phases built on
    that. Trace the writer before quoting the row count.
  - **BOTH CODEBASES ALREADY DOCUMENTED THE TRAP.** `ml/dataset.py`'s
    `PredictionExample.previous` exists *specifically* so the OIE does not
    "score loadout rotation as a substitution", and `opponent_profile` says a
    within-duel deck change "measures nothing". A module that ignores a rule its
    siblings state in prose is the failure mode to sweep for.
  - **A ROW COUNT IS NOT AN EVENT COUNT.** Check what one decision writes before
    believing a headline figure. Here it wrote 64 rows.
  - **NEAR-SATURATION IS A SMELL.** 80.9% of the entire 122×121 directed edge
    space populated from 7,714 events is evidence of the write pattern, not of
    structure in the data.
  - **A CARTESIAN PRODUCT *IS* THE INDEPENDENCE NULL.** Expected count is the
    product of the two marginals, so lift is ~1.0 by construction and the
    strongest edges are just the most popular cards. Mining it would return
    global popularity dressed in p-values.
- **Reconsider?** **No.** Not at any sample size — the defect is in the write,
  not the volume. If the graph is ever revived, drop the relation or rename it
  `LOADOUT_FOLLOWS`, and get loadout sequencing from `coach.next_decks`, which
  already does it at deck level, per player, in production.

### 18. Two methods discarded inside Brain Phase 5 (2026-09-12)

Phase 5's hypothesis **succeeded**, so this is not a closed branch. These are two
methods that were tried, produced confident wrong answers, and were replaced.
Both would be repeated by default.

#### 18a. Share-of-plays as a usage trend, over a growing population

- **Why attempted.** The obvious way to ask "is this card becoming popular" is
  to compare its share of plays in the first half of a window against the
  second.
- **Result.** A confident, wholly false table: `rune-giant +790%`,
  `elite-barbarians +737%`, `ronin −82%`, `fire-spirit −73%`.
- **Why it failed.** The play log's volume is a **player-enrolment ramp**, not a
  meta trend. Measured on `phase18-plays.pkl`: **3.32% of plays fall in the
  first half of the window and 85% in the last 30 days of 77**; 50% of all plays
  are in the last 10 days; **day 1 has one player and one play**. The two halves
  are different populations, so every share comparison across them is
  comparing people, not cards.
- **The fix, and it is not optional.** A **fixed cohort** (players with ≥ 20
  plays in *both* adjacent 15-day blocks — 178 of them, block volumes within
  1.12×) plus a **paired per-player** comparison with a bootstrap CI over
  players. That recovers a defensible answer: 37 of 120 cards move, 79 are flat.
- **The rule.** Adoption measurement needs (a) the population held fixed across
  the comparison, (b) per-player pairing, (c) a support floor. Drop any one and
  the answer becomes a property of the data-collection schedule.
- **Corollary for the other direction.** `card_first_seen` in this data is
  **114 of 122 cards "first appearing" after day 1**, including cards years old.
  That is enrolment, not release. Do not read a first-observation date as an
  arrival date without a stable population behind it.

#### 18b. `knowledge_mining.binomial_p` below its documented support floor

- **Why attempted.** Per decision A17 and the Phase 4 conditions, reuse the
  project's own statistics rather than writing new ones. `binomial_p` is the
  project's binomial test.
- **Result.** At the n ≥ 3 sample sizes a per-player cell census requires, it
  **over-rejects by about 30×**.

  ```
   k   n    p0     normal approx      exact
   3   3   0.20        0.00027      0.00800
   4   5   0.25        0.00225      0.01562
   5  10   0.20        0.00885      0.03279
  25  50   0.20        0.00000      0.00000
  ```

- **Why it failed.** It is a **normal approximation**, and its own docstring
  says so: *"adequate because MIN_SUPPORT keeps n well above the range where it
  misbehaves."* `MIN_SUPPORT` is **25**. Using it at 3 is using it outside its
  stated validity.
- **How it was caught.** A **permutation null**. Under the approximation the
  null returned **1,312 survivors of ~5,230 cells — a 25% false-discovery rate
  where Benjamini-Hochberg promises 5%.** With an exact binomial the null falls
  to **0.0** and the observed finding count drops from 1,649 to **777**.
- **This is not a live bug.** Every caller in the bot filters on support before
  testing (`mine_associations`, `mine_reliable`). It is a caution for new code.
- **The rule, and it is the transferable one.** **Run a permutation null on
  every new statistical claim.** It cost minutes, it changed a conclusion, and
  no amount of reading the code would have revealed the error — the function was
  being used exactly as written, just outside the range it was written for.

### 19. A player displacement memory fed by a PREDICTED exit (Brain Phase 7)

- **Why attempted.** Phase 6 measured `ml/substitution` beating player
  frequency by +10.02 and its player layer as necessary (−6.95 when removed) —
  but with the outgoing card handed to it. Production must predict the exit.
  The README §32 gate asked how much survives.
- **Implementation.** Read-only replay on Phase 6's exact population, pre-registered
  gate, `E4Combined` (the exit ranker production builds) composed with the
  existing ladder; four compositions; a production-semantics replay over
  138,978 real steps.
- **Result.** **−0.06 [−1.67, +1.47]** against player frequency, ns at five
  origins, with every exit ranker and every composition. 4.2% of the advantage
  survives; the player layer is worth +0.21 ns end-to-end; +0.017 points of
  production steps.
- **Why it failed.** The exit ranker is right 43.20% of the time. When it is
  wrong, S2 conditions on a card that is not leaving and its player layer —
  most confident exactly where it has the most evidence — pushes that card's
  past replacement: 4.28% against player frequency's 9.56%, on 56.8% of events.
  Player frequency never reads the exit, so it cannot be misled by it.
- **What we learned.**
  1. **A layer necessary under an oracle can be worthless without it**, and the
     oracle ablation will not tell you. Re-measure the ablation end-to-end.
  2. **An oracle-defined subset is not a specialist.** Support computed from the
     true exit gives +5.08 to +11.85; the same buckets computed from the
     predicted exit are all ns.
  3. **"Accuracy on the edit subset" and "contribution to production" differ by
     three orders of magnitude here** (32.29% vs +0.017 points). Count both on
     the same steps.
  4. **A probability from a rank-position softmax is a constant**, whatever its
     ECE says.
  5. **The incoming-card metric and the deck metric can disagree in sign**
     (−0.06 vs +2.60), because a card can be named inside a wrong deck. Report
     both.
- **Reconsider?** Only with an exit predictor measurably far above 46% top-1 —
  and OIE Phase 13 already failed to build one. **Not as a displacement memory.**

### 20. A model-OUTPUT sweep over request delays, read as a production consequence (Brain Phase 8, session 1)

- **Why attempted.** No outcome seemed to exist at an arbitrary request time,
  so session 1 fed every held-out row the features a read *h* hours after the
  last play would see, and reported mean P(change) and band shares ("at 36 h,
  34.2% of competitive reads go low").
- **Why it failed.** It scored delays on steps **no such request could be
  about**. At 36 h, 95.9% of those rows had their next outing sooner. And an
  outcome *does* exist: a read at R predicts the shell's next outing after R,
  so the right population is the steps with gap > h.
- **Result when done right (session 2).** On the 3,760 rows a 36-hour-late read
  is about, 71.2% change. The request stamp beats `9999` on macro Brier by
  −0.1596 [−0.1819, −0.1373]. The "harmful low band" was the correct answer.
- **What we learned.** **A sensitivity sweep must be restricted to the inputs
  that can co-occur with the scenario.** Moving one input across a population
  where that value is impossible describes the model, not the product.
- **Reconsider?** N/A. It is a method lesson; the measurement now exists.

### 21. The full player deck vocabulary as a union candidate pool (Brain Phase 9)

- **Why attempted.** Phase 1 measured zero-pool 76.59% → **47.65%** with duel history ∪ `battles`
  decks, the largest coverage number in the programme, and never ranked it. README §32 declared a gate.
- **Implementation.** Chronological per-step replay of Phase 1's exact 79,894 steps, the frozen Phase 21A
  and Coach Assist rankers unchanged, event-time and arrival-time visibility, pre-registered.
- **Result.** The README gate **passed** on Phase 1's harness (U2 +0.36 [+0.18, +0.55]) and **failed at
  production visibility** (S-ARR −0.48, S-EXACT −1.56). Recall +6.8 pts, but top-1 given the truth is in
  the pool **69.7% → 54.9%**; step-weighted top-1 **fell**. Duel-seen players −6.03; 25+ known decks −12.66.
- **Why it failed.** Two causes, both measured: (1) **dilution** — the ranker cannot hold its quality when
  a player's `battles` decks (59% of them over a week old) are added to a duel history that already had
  the answer; (2) **arrival** — a duel series reaches the database a median 22 h after it is played
  (Phase 1 window), so the history that matters most is not there at request time (recall 37.1% → 14.9%).
- **What we learned.** A coverage number is not an accuracy number (Phase 7's rule, confirmed again), and
  an event-time coverage number is not a request-time one. The vocabulary helps **duel strangers** (+8.98)
  and harms everyone else.
- **Reconsider?** **Not as a union.** A duel-history-first **backoff** is the only open construction
  (post-hoc +0.36 pts at S-ARR, below the 3% floor); it would need its own arrival-primary gate.

### 11. Inverted alternative caps

- Pre-19B capped `high` at 2 and left `low` at 3 — the inverse of its own
  docstring, so the **least** trustworthy reads showed the **longest** list.

---

## 21. DEADLOCKS / BLOCKERS

### 1. No database on this machine — **VPS ACCESS EXISTS AND WORKS** (updated Phase 1)

`clash_data.resolve_db_path()` returns **`None`** — verified 2026-09-12.
H: is unplugged. `C:\...\Clash_Bot\battles.db` **does** exist but is a
**4,096-byte empty husk with no schema**, correctly rejected by `_has_schema`.

**RESOLVED FOR MEASUREMENT.** The VPS is reachable and Phase 1 ran three
read-only jobs against it:

```
ssh -i ~/.ssh/clashbot root@169.58.237.142
sqlite3.connect("file:/var/clashbot/battles.db?mode=ro", uri=True)
+ PRAGMA query_only=1
```

The key (`~/.ssh/clashbot`) and the `known_hosts` entry are both present.
**Run the script ON the VPS beside the data; never pull the database.** It is
now **77 GB** (was 33 GB in `CLAUDE.md` — that figure is stale).

**Still true:** nothing can be measured *locally*, so every Brain measurement
is gated on VPS availability and on not competing with the bot's poll.

### 2. `CLASH_OIE=off` and there is no rollout gate

The spec's item 7: the original gate was "High > Medium > Low validated against
real outcomes". Competitive meets the *ordering* half and fails the *magnitude*
half; practice fails both. A defensible gate exists (competitive-only, ordering
holds, no percentage displayed) and **has not been decided**.

### 3. The research evidence has no backup

Every `phase*-report.txt` is gitignored and exists only on this machine.
Twenty-one phases of measurement, unbacked. The cohort tag files **are** tracked
(verified), so the log is reconcilable — but the reports are not reproducible
without re-running against the VPS database, at costs of 3-15 minutes per phase.

### 4. Native duel prediction needs a loadout representation

Named in the spec (§5 rule 7) and in the README's future scope. Nothing in the
codebase represents three decks as one object with a disjointness invariant.

### 5. 71.7% of duel steps have no usable candidate pool — **CAUSE NOW MEASURED**

The dominant accuracy blocker, and it is a **coverage** problem, not a model
problem. Phase 1 measured *why*, and the cause is worse than "opponents are
untracked":

| cause of a zero pool | share of test steps |
|---|---:|
| **subject never seen in ANY prior duel** | **57.34%** |
| subject's known decks all card-blocked | 2.97% |
| (has a pool) | 39.69% |

**72.47% of duel participants appear in exactly one duel.** This is a property
of the population, not of the pipeline, and it is the hard ceiling that closed
Brain Phase 1. It is *partially* relieved by `battles` history (51.15% of test
subjects have some), which takes zero-pool to 47.65% combined — but it cannot be
relieved by duel data.

> **⚠ MEASURED END TO END BY PHASE 9 (2026-09-14).** "Takes zero-pool to 47.65%" is an
> **event-time** figure. At **arrival** visibility the same pool is **76.58%** zero-pool with 14.92% exact
> recall, and as a union it does not beat duel history on top-1 (S-ARR −0.48, S-EXACT −1.56). Relief from
> `battles` is real only for duel strangers (+8.98 pts). The blocker at request time is ingest latency as
> much as population. Phase 9 artifact §9.4, §20.

### 6. The two halves deploy separately

`server/` goes by `scp`, the frontend by git push to Vercel. A Brain feature
spanning both must land the server side first or the UI 404s.

### 7. `phase24b-hosting-plan.md` conclusions still stand

Do not move the database (33 GB, no native SQLite replication). An OIE-only
extract measured at **~1.01 GB** (six columns over 60 days = 6,806,514 rows ×
160 bytes). There is still **no backup of the VPS database**;
`deploy/backup_db.py` exists and is unscheduled.

---

## 22. KNOWN BUGS

### 1. Two of the 21 features are always zero in production — **LIVE**

`predictor.predict` constructs `PredictionExample(timestamp="9999", ...)`.
`features._parse("9999")` returns `None`, so `_hours_between` returns `0.0`.

**Verified 2026-09-12 by direct call:**

```
_hours_between("9999", "20260819T165417.000Z")            -> 0.0
_hours_between("20260820T...", "20260819T...")            -> 24.0
```

So `log_hours_since_change` and `log_hours_since_last_play` are **0 on every
production read**. Recorded as a limitation in both `phase20c-report.txt` and
`phase20d-report.txt`, deliberately **reproduced rather than fixed** so 20B/20C
and production stay comparable. **Its effect is unmeasured and needs its own
run.**

This is the single highest-value cheap experiment available: two of twenty-one
features, both temporal, in a model whose whole job is timing.

> **⚠ MEASURED AND PARTLY SUPERSEDED BY BRAIN PHASE 8 (2026-09-13).** The
> statement above is preserved as the record.
>
> ```
> PREVIOUS CONCLUSION  effect unmeasured; "the single highest-value cheap
>                      experiment"; roadmap: "one line plus one evaluation run".
> NEW EVIDENCE         Phase 2 harness, frozen artifact, only x9/x10 varied,
>                      99,541 held-out steps. Competitive ROC-AUC:
>                        9999 (production)          0.8584
>                        stamp = predicted battle   0.9315  +0.0731 [+0.0625,+0.0855]
>                        stamp = shell's last play  0.8615  +0.0031 [-0.0014,+0.0076] ns
>                      Brier -0.0265 [-0.0326,-0.0209] at the battle stamp,
>                      +0.0013 (WORSE) at the anchor. Practice 0.7601 -> 0.8032.
>                      Ablation: x10 alone +0.0721; x9 alone -0.0282 (worse than
>                      the bug). Production's logged requests arrive a median
>                      36h / 49h after the last play (training median 5 min);
>                      at 36h the frozen model puts 34.2% of competitive reads in
>                      "low" and 100% of practice. Every band validation (17A,
>                      19C/D, 20B-D) was run on the buggy outputs; 10.84% of
>                      competitive steps change band even at the ideal stamp.
> NEW CONCLUSION       The effect is LARGE at the stamp production does not have
>                      and ABSENT at the one it always has. The experiment was
>                      cheap; a correct fix is not one line in effect - it needs
>                      a serve-time definition, recalibration and re-validation,
>                      all of which the frozen spec forbids. See KNOWN BUGS #12.
> WHY IT CHANGED       Phase 0 assumed "the correct timestamp" was well defined.
>                      Tracing it showed M2 was trained with the stamp = the
>                      battle being predicted.
> ```
>
> **⚠ AND PARTLY SUPERSEDED AGAIN BY PHASE 8 SESSION 2 (2026-09-14).** Both
> blocks above are preserved.
>
> ```
> PREVIOUS CONCLUSION  (session 1) ABSENT at every stamp production has; a correct
>                      fix needs a serve-time definition, recalibration and likely
>                      retraining.
> NEW EVIDENCE         Request-time stamps scored on the steps each request is
>                      about: R(36h) Brier -0.1596 [-0.1819,-0.1373]; random clock
>                      AUC +0.0494 [+0.0330,+0.0702], Brier -0.1706; 1h before the
>                      battle keeps 94% of the battle-time AUC gain. R(5min) Brier
>                      +0.0018 (slightly worse). Frozen model, frozen cuts,
>                      ordering holds. Harness frame; production frame unscored.
> NEW CONCLUSION       The serve-time definition is the REQUEST TIME (UTC). No
>                      retraining; re-validation (not shown: recalibration) is the
>                      cost. Fix ELIGIBLE for controlled review after Phase 8b.
> WHY IT CHANGED       Session 1 swept delays over steps no such request could be
>                      about (FAILED APPROACHES #20).
> ```

### 2. `test_ml_21a.py` hardcodes 122 cards — **FAILING**

```
File "server/test_ml_21a.py", line 96, in test_every_card_name_maps
    self.assertEqual(len(P.NAME_TO_KEY), 122)
AssertionError: 123 != 122
```

The catalog went to 123 when Minion Giant shipped on 2026-09-07. **1 failure of
32 tests; the other 31 pass.** Same family as the `cardRoles.json` 122-of-123
gap and the "122 cards" copy corrected in the 2026-09-11 doc audit — that sweep
did not reach this test. Not fixed in the audit session (frozen research suite,
audit-only phase).

### 3. Stale claim in `README.md`

The 24B write-up states: *"`main` runs `6ab701d` and contains **zero**
`server/ml` files; `api/` holds only the Upstash deck-sync function; there is no
`/api/analytics` handler"*.

**All three are now false.** Verified: `git ls-files server/ml` returns **65
files**; `api/analytics/opponent-read/[tag].ts` exists; `api/health.ts` exists.
The paragraph is a historical record of 24B and should be marked as such rather
than deleted.

### 4. Stale claim in `CLAUDE.md`

*"`server/ml/results/cohorts/tags*.json` ... is gitignored, and it is currently
unbacked."* **Tracked in git** — `.gitignore:75` negates the directory and
`git ls-files` lists all six. The unbacked files are the `*-report.txt`.

### 5. The shadow log mixes two domain names

1,388 entries say `duel` and 72 say `practice` for the same population (the
Phase 23 Fix 2 rename). Any Brain analysis of this log must map
`duel → practice`, exactly as `calibration.ARTIFACT_DOMAIN` does for the frozen
artifact.

### 6. Production builds the exit and entry rankers UNFITTED — configuration divergence (found Brain Phase 7)

`server/ml/production/predictor.py:113-114` constructs
`E.E4Combined(E.PopulationExitStats())` and `S.S2Transition(S.GlobalStats())`
with **empty** statistics, so E4's population-editability term and S2's global
transition and global incoming layers are zero on every production read. Every
research phase evaluated the fitted configuration. **Measured on the edit task
it is harmless**: production-faithful 32.55% vs fitted 32.29%, +0.67
[−0.40, +1.92] ns; exit top-1 42.04% vs 43.20%. Undocumented. `CLASH_OIE=off`,
so nothing user-visible. **Not fixed** (research-only phase, frozen component).

### 7. `E4Combined`'s absence term is structurally dead (confirmed Brain Phase 7)

`0.5 × min(last_seen, 20) / 20` reads `last_seen`, which is **0 for every card
of the previous deck by definition** (they were all in the last outing) — 0
non-zero values across 29,573 dumped events — and production's view does not
supply `last_seen` at all. OIE Phase 14's `exit_intel` comment already noted the
constant; E4 still carries the term. Harmless, but one of the five weights does
nothing.

### 8. The canonical exit probability is a constant (found Brain Phase 7)

`edit_model.EditDecision._exit_probs` (and `softmax_over` on rank positions)
assigns probability by rank alone, so the top exit receives **0.401 on every
event**. Its ECE of 0.031 is one bin that happens to sit near the 43.20% hit
rate. **It is not a confidence.** OIE Phase 5's never-edit decisions were built
on it; that link is consistent but untested.

### 9. Phase 6 did not document its re-adoption rule (found Brain Phase 7)

The 61.81% figure is reproduced exactly only by: *the incoming card was the
outgoing card of an EARLIER ONE-CARD edit by the same player, in any domain*
(2,617 / 4,234). Natural alternatives give 57.53%–76.26%. Recorded here; the
Phase 6 artifact is left unedited.

### 10. The README §32 gate's wording admits two readings (found Brain Phase 7)

"The player-frequency baseline *also run end-to-end*" has no content for
incoming-card top-1 (player frequency does not read the exit) and only bites at
deck level. Phase 7 pre-registered the incoming-card reading (the quantity the
README asked about) and **FAILS** on it; the deck-level reading would **pass**
(+2.60 [+1.26, +4.00]) with a production effect of +0.017 points. **Future gates
must name the metric, the composition and the unit.**

### 11. `is_duel` is 0 on every practice read since the Phase 23 rename (found Brain Phase 8)

`features.extract` sets `is_duel = 1.0 if example.domain == "duel"`. Phase 23
Fix 2 renamed the domain, and production now calls with `"practice"`
(`coach.py:1168`, `source.py:213`). `calibration.ARTIFACT_DOMAIN` maps the name
for band cuts only; nothing maps it for features. So a model trained with 1.0 for
that population receives 0.0. **Measured** on Phase 2's practice test rows:
Brier **+0.0020 [+0.0018, +0.0023]** worse, ROC-AUC +0.00003 — real and
negligible; practice ships no band. **Not fixed.**

### 12. M2's strongest feature is defined at a moment production never has (found Brain Phase 8)

`log_hours_since_last_play` (weight −0.631 on "no change", the model's largest)
was trained with the stamp = **the battle being predicted**
(`dataset.iter_examples`: `timestamp = truth.battle_time`). A live read is
requested before that battle. No serve-time stamp reproduces the training
value:

| serve stamp | competitive ROC-AUC | consequence |
|---|---:|---|
| `9999` (today) | 0.8584 | both temporal features 0 |
| the shell's last play (always available) | 0.8615, ns vs today | x10 is 0 by definition |
| the predicted battle's time (training) | 0.9315 | not known at request time |
| request time, logged median 36 h | not measurable (no outcome) | 34.2% of competitive reads → "low", practice 100% |

Part of the feature's power in the harness is also the `next-in-cluster`
shell selection: x10 alone scores 0.839 pooled but ~0.63 within "shell is / is
not the previous battle's", and 0.712 in production's frame. **This is a model
definition gap, not a one-line bug.** Recorded; nothing changed.

> **⚠ QUALIFIED BY PHASE 8 SESSION 2.** "No serve-time stamp reproduces that
> definition" holds only in the limit. The request time **converges** on it:
> a read 5 min before the battle keeps 100% of the AUC gain, 1 h before keeps
> 94%. At any delay ≥ 1 h after the last outing, the request time beats `9999`
> on outcomes. The table's last row, "not measurable", is **superseded**:
> R(36 h) gives competitive Brier −0.1596 [−0.1819, −0.1373] vs `9999` on
> those steps, and the 34.2% "low" becomes 63.1% low on reads that change 71.2%
> of the time. Production-frame size is still unmeasured, and **practice ranks
> short gaps backwards** (duel rotation; artifact §27.10).

### 13. Nothing tests that `predictor.predict` passes a parseable timestamp (found Brain Phase 8, session 2)

`test_ml_22_final.py` pins the version strings and `CLASH_OIE`'s default, but no
test asserts that the stamp handed to `features.extract` parses. So
`timestamp="9999"` has shipped since Phase 15 with every suite green. Any future
fix must add that test. It must also pin **UTC**: `battle_time` is UTC,
`_parse` ignores the `Z`, and a local-time "now" would shift every gap by the
host's UTC offset without any error. **Not fixed** (research-only session).

> **⚠ QUALIFIED BY PHASE 10 (2026-09-15).** Two concrete traps now documented:
> (1) `shadow.record`'s `ts` field is `%Y-%m-%dT%H:%M:%SZ` (`shadow.py:86`), which `_parse`
> cannot read — a fix that reused it would silently reproduce `9999`; (2) the audit host's
> UTC clock read `20260914T185253` while local time was already 15 September (+05:30). The
> Phase 10 contract closes this bug with tests T1 (UTC, parseable) and T2 (never `"9999"`,
> `cutoff_ts` precedence).

### 14. A backtest re-validation with `cutoff_ts = T` would be optimistic (found Brain Phase 8, session 2)

`predict(..., cutoff_ts=T)` is how 16C/17A-style backtests run. If the stamp
becomes `cutoff_ts or now`, such a backtest computes **B1, the training
definition** (0.9315), not a serve-time estimate. Re-validating a stamp fix that
way would certify the optimistic number. Re-validation must sample request times
under survival conditioning (Phase 8b).

### 15. The bot's effective poll cadence is ~4 hours, not 2 (found Brain Phase 8b)

`bot.py`'s loop ticks every `POLL_INTERVAL_HOURS` (2), but the repeat guard
skips a tick when `since_h < POLL_INTERVAL_HOURS * 0.9`, measured from the
previous pass's **finish**. Passes now take 20–21 min for 5,319 players, so the
next tick comes 99 min after a finish and is skipped: `bot.log` "[Poll] skipped
— a full pass finished 99 min ago". `bot_health` since 2026-09-01 shows about 70
gaps of ~2.0 h, then about 45 of ~4 h, and every gap since 2026-09-12 is ~4 h.
**Consequence:** tracked players' battles arrive a median 1.89 h late (p95
3.79 h, max 9.0 h) instead of ~1 h, and the 30-battle log cap (#16) is hit twice
as often. **It lives in the bot's repository, not this one. Not fixed.**

### 16. The battlelog returns at most 30 battles, and heavy players hit it (found Brain Phase 8b)

Of 18,622 tracked player-polls since 2026-09-12, **2,454 (13.2%) delivered exactly
30 new battles**; above 30 appears 41 times (enrolment syncs). A player who plays
more than 30 battles between polls loses the excess permanently. So **every "next
battle" truth in this project**, every phase included, can skip real battles for
the heaviest players. Not quantified. Worsened by #15.

### 17. A correct timestamp cuts alternative hits, through `ALTERNATIVE_CAPS` (found Brain Phase 8b)

`cap_alternatives` shows high 2 / medium 1 / low 0. With the stamp corrected, the
band becomes honest and moves likely-to-change reads into `low`, where no
alternative is shown, on exactly the reads an alternative could be right. On
111,123 competitive production-order reads: shown alternatives −0.435 per read,
**"a shown alternative is the next deck" 1.85% → 1.06% (−0.91 pts [−1.41,
−0.51])**. Phase 7 §19.3 predicted the direction; this is the first measurement.
**A policy consequence the fix review must decide on; not a reason to keep the
bug. Not fixed.**

### 18. Arrival timestamps are destroyed at every bot restart (found Brain Phase 8b)

`battles` has no arrival column. `battle_raw.stored_at` is the only one, and the
raw-cap valve purges non-duel raw at restart up to the 2v2 cursor (last
2026-09-12T02:55:53Z). **Ingest timing is therefore reconstructible only back
to the last restart.** Phase 8b's window (49.5 h) cannot be re-extracted after the
next one; the scratchpad extract is the only copy.

> **⚠ KNOWN BUGS #17 CHARACTERISED BY PHASE 8c (2026-09-14).** The regression is
> real and *relatively* costly: the removed alternatives hit 1.97% against 0.74%
> for those kept. It is also below materiality (0.78 pts < 3%) and caused by the
> cap policy, not the stamp. Under corrected bands, alternative precision runs
> 0.37 / 2.90 / 3.61% (high / medium / low) while the caps run 2 / 1 / 0.
> **Decision: not a blocker for the timestamp fix; a separate `ALTERNATIVE_CAPS`
> review is warranted.**

### 19. The HIGH alternative label can never be shown (found Brain Phase 8c)

`shortlist._band` labels an alternative HIGH only when `p_change >= 0.5` (rank 1,
support >= 5). `calibration.band` puts any `p_change >= 0.45` in `low`, and
`ALTERNATIVE_CAPS["low"] = 0`. **A HIGH-labelled alternative is always capped
away.** Invisible under `9999` (p rarely exceeds 0.3). Under the correct stamp,
649 HIGH alternatives are generated on production-order competitive reads and 0
are shown. MEDIUM labels need p >= 0.3, so they can only ever appear as rank 1
in [0.3, 0.45). **A latent contract inconsistency between two frozen modules.
Not fixed.**

### 20. The alternatives' UI subtitle overstates their provenance (found Brain Phase 8c)

`OpponentReadPanel` headlines alternatives as "Plausible configurations — other
shapes seen in this player's own history — not forecasts". Alternatives are
*generated* one-card edits (`C1WideOneCard`), not decks from history. On
production-order competitive reads, **only 26.3% of shown alternatives appear
anywhere in the player's visible (60-day) history**. The "not forecasts" half is
accurate; the "seen in history" half is not, for about three in four. Copy
defect. **Not fixed** (UI untouched; engine dark).

### 21. Non-duel `battle_raw.stored_at` is a re-store time for any battle older than the last purge (found Brain Phase 9)

The restart purge deletes non-duel raw up to the 2v2 cursor; the next poll re-inserts every battle still in
the 30-battle log with a **fresh `stored_at`** (`INSERT OR IGNORE` into an emptied key) while the `battles`
row keeps its original id. 16,508 subject rows showed it at Phase 1's snapshot; on Phase 8b's sample,
15,543 rows had a raw payload with a battle time before the cursor and **14,139** of them had arrived
earlier than that `stored_at`. **Consequence:** `stored_at` is not an arrival time for those rows; Phase 8b's
early-window visibility was conservative (not leaky — 535,100 cursor-assumed rows, 0 contradicted). The
`battles.id` clock (DATA LIMITATIONS #25) recovers arrival. **Not fixed** (bot-side).

### 22. Brain Phase 1's population cannot be reproduced by battle time (found Brain Phase 9)

**4,459 native duel payloads (4,372 series)** with battle times inside Phase 1's range were stored after
Phase 1 ran (2026-09-12..14), so `battle_time <= 20260912T061600` gives 97,913 series and a different
split boundary. **Reproduction needs the snapshot:** raw `stored_at <= 2026-09-12T06:17:16.039184Z`
(99,920 / 93,541 / 20260830T133255 / 79,894, and Phase 1's coverage to the step). Any future phase that
cites a population must record its snapshot `stored_at`, not a battle-time range. Phase 9's own extraction
hit a variant of this (3,745 subjects missing, caught and re-extracted).

### 23. Coach Assist window 1 shows decks the duel rules forbid (found Brain Phase 9)

`coach.next_decks` shows `predict_companions`' first three, which tolerate up to **2 cards shared** with each
revealed deck (`PREDICT_COMPANION_MAX_SHARED`), and applies no 0-shared filter. A shown deck can therefore
share a card with a deck already played this duel — a deck the player cannot bring. Window 2
(`opponent_next`) applies `_legal`. Measured replay cost of the missing filter: **+0.36 pts** top-1 on
Coach's current vocabulary (17.19% → 17.55%) and +3.15 on the full vocabulary. Documented design
(`RECOMMEND_MAX_SHARED` comment), measured cost. **Not fixed** (Coach Assist untouched).

> **⚠ KNOWN BUGS #1, #17, #19 and #20 RE-VERIFIED BY PHASE 10 (2026-09-15)** against the code at
> `c4fc65e` and by exact recomputation from the Phase 8b/8c records. #17's regression is
> unchanged (−0.91 pts [−1.41, −0.51]) and its acceptance is the one open condition on the fix.

### 24. A committed test becomes calendar-dependent once the stamp is the wall clock (found Brain Phase 10)

`ShadowFoundRegressions.test_change_probability_is_not_pegged_for_a_steady_player`
(`test_ml_production.py:97-101`) asserts `P(change) < 0.5` on a fixture dated 2026-08-01…08-14 and
calls `predict` with no cutoff. Latent under `"9999"` (P 0.0056). Measured under the proposed stamp:
0.4305 at the audit's UTC clock, 0.8119 at 2027-06-01; **unpinned, it fails from
2026-09-27T18:51:45Z** and never passes again. The model is behaving as validated (an idle shell is a
likely change); the fixture must pin its stamp. All other 146 predictor tests pass under a 2027
stamp. **Not fixed** (decision audit). The implementation contract requires pinning (Phase 10 §11.3).

### 25. The spec/log version pins are hardcoded and checked by substring (found Brain Phase 10)

`test_ml_22_final.py:327-349` asserts the spec contains hardcoded strings (`"phase2-21"` …) rather
than the live `shadow.VERSIONS`, by `assertIn` substring. A `VERSIONS` bump alone passes, and so does a
new value that merely contains `phase2-21`. The test named "the version stamp matches what the log
records" cannot fail on a mismatch. **Not fixed.** Tightening is in the Phase 10 contract (§11.2).

### 26. Shadow drift is version-blind, and practice drift has not been evaluated since the rename (found Brain Phase 10)

`shadow.drift()` and `capture_baseline()` average every row regardless of its `versions` block (only
`checkpoint()` refuses mixed logs). And `shadow.REFERENCE` is keyed `competitive` / `duel`
(`shadow.py:317-320`); production logs `practice`, so `_reference_for("practice")` finds nothing and
`drift()` silently skips practice. A clean practice drift report means nothing. **Not fixed**
(same rename family as #5 and #11).

### 27. The opponent-read panel's comment cites disproved band accuracies (found Brain Phase 10)

`CoachAssist.tsx:874-875` justifies the panel with "duel high was 92.1% correct against low at 47.3%",
figures Phases 19D/20D disproved (spec §2.3). Not user-visible; the same class spec §7 item 5 cleaned
out of `policy.py`. **Not fixed** (UI untouched).

### 28. `shortlist.build`'s primary band is computed and discarded (found Brain Phase 10)

`shortlist._primary_band` fills `Shortlist.primary_confidence` (`shortlist.py:83-93, 106`), but
`predict` assigns the band from `calibration.band` (`predictor.py:131`). Harmless; misleading to anyone
reading `shortlist` alone into believing its cuts decide the band. **Not fixed.**

> **⚠ STATUS AFTER BRAIN PHASE 11 (2026-09-15) — fixed in the LOCAL WORKING TREE ONLY (not
> committed, not deployed; the VPS still runs `"9999"`):**
> **#1** `timestamp="9999"` → `cutoff_ts or _request_stamp()` (UTC), `predictor.py:120`.
> **#13** tests T1 (UTC, parseable, pinned and real clock) and T2 (never `"9999"`, cutoff precedence).
> **#24** module-wide pinned request clock in both predictor suites, fixture-pinned steady-player and
> two-shell tests, pin guards; both suites pass with the clock at 2026-12-31 and 2030-01-01.
> **#25** version tests now compare `shadow.VERSIONS` exactly with the parsed spec §6 table and §2.2 row.
> **Still open:** #2, #26, #27, #28 (and every other entry). #17's regression is now in the code, accepted.
>
> **⚠ STATUS AFTER BRAIN PHASE 12 (2026-09-15):** those four fixes are **COMMITTED** (one local commit,
> not pushed). Nothing else changed: **production still runs `"9999"`** with `CLASH_OIE=off`, so #1 is
> fixed in the repository and NOT in the running service until an approved dark deploy (Phase 13).

---

## 23. DATA LIMITATIONS

**What the system cannot know today.** Nothing here is a bug.

1. **Within-game card-play order does not exist and never will.** The CR API
   does not expose it. Phase 21A states this explicitly. Any feature implying
   "they played X before Y" inside a game is fabrication.
2. **No causal data on deck choice.** Everything is observational. We see the
   deck played and whether it won; never what would have happened otherwise.
   This is why 20A could not be settled favourably even with an oracle.
3. **Opponents are mostly untracked.** 4,910 tracked against 866,226 known 2v2
   participants and 20,702 duel subjects. An opponent's history is whatever
   appears inside duel payloads.
4. **Repeated A-vs-B meetings are not measured.** `Player A × Player B × Deck`
   has never been counted. Given the roster sizes above, assume it is rare until
   someone measures it.
5. **History is capped.** `HISTORY_DAYS = 60`, `MAX_ROWS = 1200`, **hot tier
   only** — the archive is deliberately not opened (measured: it contributed
   ZERO plays and a second connection on every cold read). Long-term trends are
   not observable through this path.
6. **Retention is 304 days** and 2026-05-01 → 2026-06-01 exists only on the
   unplugged H: drive.
7. **`pair_matchup_agg` has no mode filter.** It pools duel, friendly and
   ladder.
8. **Archetype is the priciest win condition.** A win condition is a card, not a
   play style. Two genuinely different decks can share an archetype label.
9. **A battle is stored once per tracked participant** — twice in 1v1 with two
   tracked players, up to four times in 2v2. Deduplicate on battle identity.
10. **No rank / trophy context on a battle row.** `currentPathOfLegendSeasonResult`
    is fetched live for the player header only and is not stored per battle.
11. **No timing between games of a duel beyond `battle_time`.** No think time,
    no pick order.
12. **Display names are not captured from 2v2 payloads** (the guard skips
    `_upsert_name`).
13. **THE DUEL POPULATION IS TRANSIENT.** (Phase 1) 72.47% of the 111,516 duel
    participants appear in exactly one duel; 2.83% appear 6–20 times; 0.18%
    more than 20. Per-player behavioural learning is impossible for most of the
    people the system meets. **This is the single most important limitation
    found so far.**
14. **Player-opponent pairs essentially never repeat.** (Phase 1) 92,135 pairs,
    of which **99.22% meet exactly once**. `Player × Opponent × Deck` is not
    estimable.
15. **Per-game duel outcomes exist only in `battle_raw`.** (Phase 1)
    `battles.player_crowns` is populated on 100,201 of 100,203 native duel rows
    but is the **series** total. Which individual game was won exists nowhere
    but `rounds[].crowns`.
16. **Duel retention is identical in both tables**, so chunking `battles` buys
    robustness, not depth. (Phase 1) Both run 2026-06-01 → 2026-09-12.
17. **A battle has no server-assigned identifier.** (Phase 1) `battleId` is
    absent from 100% of 99,920 payloads. Identity must be built from contents.
18. **`rounds[].kingTowerHitPoints` is missing on ~9% of rounds.** (Phase 1)
    Outcome-only field, so it blocks nothing, but it is the one field in the
    duel payload that is not at 100%.
19. **The tracked population is not a random sample.** It is search-driven plus
    the top 2,000 of Path of Legends plus qualified 2v2 participants. It is
    skewed toward strong and toward searched players. `deck_counter._symmetric`
    exists to cancel a 58.6% tracked-player bias in matchup rates.
20. **No record of WHEN a read is requested relative to a battle.** (Phase 8
    session 2.) The shadow log's delays (median 36 h) are research sweeps, and
    `suggestion_feedback` has one user. In production's `next-play` frame a
    competitive next battle arrives within 36 h **99.67%** of the time. Any
    serve-time-stamp evaluation must bracket usage (request after the last
    play / before the battle / random clock); it cannot quote one.
21. **Ingest lag is invisible to the local dumps.** The bot polls every 2 h, so
    at request time the newest battles may not be stored yet, and the "last
    play" a serve-time stamp measures from can be stale. Measurable only on the
    VPS (`battle_raw.stored_at − battle_time`).
    **⚠ "polls every 2 h" SUPERSEDED, and the lag is now MEASURED (Phase 8b):**
    effective cadence ~4 h (KNOWN BUGS #15). Tracked lag median 1.89 h, p95
    3.79 h, 100% < 6 h. Untracked (back-fill) median 5.25 h, p90 24.6 h.
    **31.4%** of random-clock competitive reads have a battle that happened but
    had not arrived. Still invisible locally, and only reconstructible back to
    the last bot restart (KNOWN BUGS #18).
22. **The battlelog holds 30 battles.** (Phase 8b.) 13.2% of tracked player-polls
    deliver exactly 30, so heavy players' timelines have gaps (KNOWN BUGS #16).
23. **Production-order ranking is much weaker than harness ranking.** (Phase 8b.)
    The shipped engine (`9999`) scores ROC-AUC 0.619 on competitive random-clock
    reads, against 0.858 on Phase 2's split for the same model and bug. Long
    idle gaps, shell switches, stale visible sets and length-biased request times
    all differ from the harness. Harness numbers are not production numbers.

24. **Duel payloads arrive long after they are played.** (Phase 9.) A native duel series' first
    `stored_at` trails its battle time by a median **22 h** (p90 97 h) in Phase 1's window, which includes
    enrolment back-fill, and **4 h** (p90 27 h) after the 2026-09-12 restart. The most useful history for a
    duel prediction — the same session — is the history least likely to have arrived: **22.2%** of Phase 1
    steps reach their true next deck only through unarrived rows.
25. **`battles` arrival exists only as a reconstruction.** (Phase 9.) `battles.id` is insertion order;
    matched to duel raw (never purged) it gives an arrival upper bound validated on 88,889 rows (2 misses
    > 1 s; slack median 0.17 s). It depends on duel raw retention. There is no arrival column.
26. **A history pool cannot reach a deck with a card the player never showed.** (Phase 9.) **24.6%** of
    duel test steps (38.6% of those with any history) need one; recombining seen cards could add at most
    1.97%. On the OIE unit, 30.5% of competitive changes and 50.0% of switched-to decks are unreachable from
    any history.

---

## 24. ARCHITECTURAL DECISIONS

Decisions inherited from the existing programme that the Brain must respect,
plus the ones this audit is recording for the first time.

### A1. Recent is the primary and cannot be replaced
- **Reason.** Phases 4, 5, 6, 7 each lost to it.
- **Alternatives.** Let a model win when confident (Phase 6 gating) — rejected,
  the curve carried a selection oracle.
- **Date.** Phase 15, frozen Phase 22.

### A2. Production never trains; it loads an artifact
- **Reason.** A `fit` reaching production is caught at load time rather than
  discovered from a latency graph.
- **Alternatives.** Online learning — rejected; unrollbackable and unversionable.
- **Date.** Phase 15.

### A3. The engine owns its own database read (`ml/production/source.py`)
- **Reason.** Blast radius on `clash_data.py`, `coach.py`, `duel_combos.py`
  stays at zero.
- **Date.** Phase 14.

### A4. Cache the READ, not the derivation
- **Reason.** Measured: the read is 109-2317 ms, rebuilding the shell is 0-6 ms,
  scoring is 1-15 ms. Caching derived state would have bought ~2 ms.
- **Note for the Brain.** This reasoning **inverts** once state is persistent:
  the Brain's value is precisely that the derivation survives the call.

### A5. The cache key has no domain in it
- **Reason.** `_read_rows` does not filter by mode in SQL; both domains read the
  same rows. Keying per domain ran the identical query twice. Measured: whichever
  domain went first paid the cold disk (p95 ~1,200 ms) and the second read its
  rows out of the OS page cache (p95 ~100-150 ms).

### A6. Confidence ships as words, never numbers
- **Reason.** Published band accuracies were wrong by ~20 points.
- **Date.** Phase 22 / 23.

### A7. A band that does not rank is not shown at all
- **Reason.** Practice macro runs high 65.4% < medium 69.7%.
- **Consequence.** Alternatives go with it — `ALTERNATIVE_CAPS` is justified by
  the bands meaning something.

### A8. Derived collections get their own SQLite file
- **Reason.** `duo_pairs` chose `server/.duo_pairs.db` over a table inside
  `battles.db`: the collection must survive independently of the raw rows, and
  **a read-write handle to the bot's database is the one thing this project has
  never taken.**
- **Decision for the Brain.** Follow this exactly.

### A9. The shadow log stores salted hashes, never tags or decks
- **Reason.** Privacy. `sha256(salt + tag)[:16]`.
- **Cost.** Reconciliation can only run from a tag list the caller already holds.
- **OPEN FOR THE BRAIN.** A per-player memory keyed by hash cannot be inspected,
  debugged or explained to the user whose player it is. A Brain store may need
  real tags. **This is a deliberate decision that must be taken explicitly, with
  the user, before any store is designed.** See OPEN QUESTIONS.

### A10. Incremental watermarks use `stored_at`, not `battle_time`
- **Reason.** A battle that arrives late carries an old `battle_time` but a
  current `stored_at`. Watermarking on battle time is the fault that left
  `player_stats_agg` 48% short of the live table.

### A11. Bounded populations rank from a tier maintained for everyone
- **Reason.** Rank from the pruned ledger and today's population becomes
  permanent, because nobody outside it could accumulate another countable
  observation.

### A12. `cardRoles.json` is generated from a prose manual, not learned
- **Reason.** Inventing counters and synergies to turn a suite green would put
  unsourced card analysis into a file the deck checker trusts.
- **Status for the Brain.** This is the decision section 16 proposes to
  *supplement* (learned adoption/association) but **not** to replace. Learned
  co-occurrence is not the same claim as "this card counters that one".

### A13. (NEW, this audit) The Brain learns offline and publishes an artifact
- **Reason.** A2 makes in-process training impossible, and the artifact pattern
  already works, is versioned, and makes rollback one file.
- **Alternatives considered.** In-request incremental updates — rejected, it
  violates A2 and makes every read a write against a read-only database.
- **Date.** 2026-09-12.

### A14. (NEW, Phase 0) The Brain's first target is COVERAGE, not ranking
- **Reason.** Phase 21A supplement 11: the ranker adds +1.7 to +4.9 points over
  random-in-pool and goes negative at pool >= 5, while **71.7% of steps have no
  pool at all**.
- **Alternatives considered.** A better ranker — rejected on that measurement.
- **Date.** 2026-09-12.
- **STATUS: HALF CONFIRMED, HALF OVERTURNED by Phase 1 the same day.** See
  A14-REVISED.

### A14-REVISED. (Phase 1) Coverage is the right target; DUEL HISTORY IS NOT THE MEANS
```
PREVIOUS CONCLUSION
  Target coverage, and get it from the native duel substrate.

NEW EVIDENCE
  Duel history: 76.59% -> 59.94% (+16.65), ceiling +19.25.
  battles history alone: 55.93%.  Both: 47.65%.
  Attribution: cutoff mechanism +15.01, duel evidence +1.64, battles +12.29.

NEW CONCLUSION
  Coverage remains the right target — it is confirmed as the dominant
  bottleneck. The MEANS is a player's full known deck vocabulary from
  `battles`, not the duel substrate. The duel-specific contribution is
  1.64 points.

WHY IT CHANGED
  Phase 0 reasoned from substrate size and from production ignoring it.
  Phase 1 measured the population behind that size: 72.47% of participants
  appear once.
```
- **Date.** 2026-09-12 (same session as A14, revised by measurement).

> **⚠ QUALIFIED BY PHASE 9 (2026-09-14).** "The MEANS is a player's full known deck vocabulary from
> `battles`" holds for **coverage in event time** only. Ranked end to end, the union loses to duel history
> at request-time visibility (S-ARR −0.48, S-EXACT −1.56 pts) and helps only duel strangers (+8.98). The
> means is duel history first, `battles` decks where duel history is empty — and at request time both are
> bounded by ingest latency (A26).

### A15. (NEW, Phase 1) Evidence source and cutoff mechanism must be attributed separately
- **Reason.** B0 → B1 (mechanism only) is worth **15.01 points**, larger than
  any evidence source tested. Comparing a new source against Phase 21A's
  published numbers without holding the cutoff constant credits the source with
  up to 15 points it did not earn.
- **Alternatives considered.** Reporting the combined figure — rejected; it is
  exactly the misattribution the gate was written to prevent.
- **Date.** 2026-09-12.

### A19. (NEW, Phase 3) A pipeline fed by human commands cannot be back-filled
- **Reason.** `recommendation_events` are written per `!suggestion` invocation.
  Command traffic is logged nowhere, so no amount of battle data reconstructs
  how many events would have existed. Phase 3 refused to estimate it.
- **Consequence.** Before proposing any loop whose input is user action, find
  the usage log FIRST. If there is none, the feasibility question is about
  product adoption, not about data.
- **Date.** 2026-09-12.

### A20. (NEW, Phase 3) Widening the match window is the wrong instinct
- **Reason.** Measured: 30 min 20.29% -> 1440 min 21.50%, **+1.21 points over a
  48x widening**, because 92.65% of pairs meet exactly once. Meanwhile 68.26%
  of claimable battles are already claimed by two or more prior encounters and
  refused by the matcher's ambiguity rule - and widening increases ambiguity
  faster than coverage.
- **Alternatives considered.** Raising `MATCH_WINDOW_MINUTES` - rejected on the
  above; it would make matching worse, not better.
- **Date.** 2026-09-12.

### A17. (NEW, Phase 2) DO NOT REBUILD what the bot already implements
- **Reason.** Nine modules, 280 passing tests, encoding decisions that cost
  measurements: the Wilson lower bound, the FDR correction, `causal: False` on
  every grouped statistic, the `"Unknown"` string below a sample floor, the
  refusal to match a battle claimed by two recommendations, and per-player
  randomisation. A second implementation in this repo would eventually disagree
  with the first.
- **Alternatives considered.** Building a clean Brain store here — rejected; it
  duplicates working code and splits the truth across two deploys.
- **Date.** 2026-09-12. Full list: Phase 2 artifact section 16.

### A18. (NEW, Phase 2) The learning step stays human, until proven otherwise
- **Reason.** `recommendation_learning.py` refuses to retrain, and states why:
  players *choose* whether to follow advice, so "win rate when followed" versus
  "win rate when ignored" compares two self-selected groups differing in every
  unmeasured way. *"A player who follows advice only when unsure will show a
  LOWER win rate when following, and that would say nothing about the advice."*
- **Alternatives considered.** Closing the loop automatically — rejected on the
  above, which is the same confound that closed Phase 20A.
- **Consequence.** The Brain's "Learn" stage is a **promotion decision with
  conjunctive gates**, not a weight update. `experiment_manager.py` is how it
  would be made valid.
- **Date.** 2026-09-12.

### A21. (NEW, Phase 6) A per-player memory is a LAYER, never a MODEL

**Decision.** Any per-player evidence store the Brain builds — displacement or
otherwise — may only ever be consulted as one layer inside a model that already
contains the baseline it is trying to beat, and must contribute **nothing** below
its support floor.

**Why.** Phase 6 measured both halves on held-out data. Per-player displacement
used ALONE does not beat player frequency (+1.20 [−1.52, +3.94], ns at five
chronological origins) because it abstains on **45.09%** of events and loses
**14.00 points** [−17.26, −10.78] there. The identical evidence, inside
`ml/substitution`'s shrinkage-and-backoff blend, beats that baseline by
**+10.02 points** [+7.94, +12.21], and ablating the player layer out of that
blend costs **−6.95** overall and **−15.19** on the supported subset.

**The corollary that is easy to miss:** a layer can be *necessary* to an
ensemble and *worse than nothing* on its own, and the marginal number will not
tell you which. Report marginal and incremental together — the same rule Phase 5
§11.2 arrived at from the opposite direction.

**Alternatives rejected.** Shipping the standalone per-player ranker (fails
out-of-sample). Lowering the support floor to reduce abstention (the floor is
where it stops being worse than the baseline). Replacing the player layer with
the global table (redundant wherever the player has evidence: −0.85
[−1.61, +0.09]).

> **⚠ QUALIFIED BY PHASE 7 (2026-09-13) — the decision stands, one of its
> reasons is narrowed.**
>
> ```
> PREVIOUS CONCLUSION  the player layer is the NECESSARY one (-6.95 when ablated).
> NEW EVIDENCE         with the exit predicted by E4Combined, ablating it costs
>                      +0.21 [-1.15, +1.61] - nothing. It gains +3.07 when the
>                      exit is right and loses -4.09 when it is wrong.
> NEW CONCLUSION       "necessary" holds UNDER THE EXIT ORACLE ONLY. The rule
>                      "a layer, never a model" still stands and is strengthened:
>                      a layer keyed on a PREDICTED input must also be measured
>                      against a backoff that does not read that input.
> WHY IT CHANGED       Phase 6 measured the ablation with the exit handed to it,
>                      as its brief defined the task. Phase 7 removed the oracle.
> ```

### A24. (NEW, Phase 8) A feature's value is defined by its timestamp, and the timestamp must be the one production will have

**Decision.** Any feature computed relative to a time must state which time —
the predicted event's, the last observation's, or the request's — and a model
may not be evaluated, promoted or "fixed" on one definition and served on
another. Numbers quoted for such a model carry the stamp they were measured at.

**Why.** Phase 8: `m2-change-v1` scores 0.932 at the predicted battle's time,
0.858 as production runs it (`9999`), 0.862 at the last observation, and an
unmeasurable, far out-of-range output at the request times production actually
logs (median 36 h vs a 5-minute training median). The same two features, four
answers.

**Alternatives rejected.** "Fix the string to `now`" (pushes the strongest
feature 3+ standard deviations out of range). "Fix only
`log_hours_since_change`" (−0.028, worse than the bug). "Quote 0.932 as the
engine" (production has never computed it).

> **⚠ QUALIFIED BY PHASE 8 SESSION 2 (2026-09-14). The decision stands and gains
> two rules; one rejected alternative is withdrawn.**
>
> ```
> WITHDRAWN   "Fix the string to now" rejected as out of range. Scored on the
>             steps each request is about, "now" (UTC) BEATS 9999: R(36h)
>             Brier -0.1596, random clock AUC +0.0494. "Out of range" was an
>             output sweep over impossible rows (FAILED APPROACHES #20).
> ADDED (1)   A serve-time stamp is evaluated on the population a request at
>             that stamp is ABOUT (survival conditioning), never by moving the
>             input across all rows.
> ADDED (2)   A stamp fix is re-validated at SAMPLED REQUEST TIMES, never with
>             cutoff_ts = the predicted battle (KNOWN BUGS #14).
> ```
>
> **⚠ CONFIRMED IN PRODUCTION ORDER BY PHASE 8b (2026-09-14):** evaluated as A24
> requires, with sampled request times, arrival-constrained visibility and
> survival conditioning, the request stamp passes the pre-registered gate 8/8.

### A25. (NEW, Phase 8b) Production-order evaluation applies ARRIVAL visibility, not battle time

**Decision.** Any evaluation that claims production semantics must build each
read's information set from the rows that had **arrived** by the request
(`battle_raw.stored_at`, or a bound proven from the purge rule), not from
`battle_time < R`. It must report the share of reads with a played-but-unarrived
battle.

**Why.** Phase 8b: **31.4%** of competitive random-clock reads have at least one
battle that has happened and not arrived (tracked lag median 1.89 h, p95 3.79 h).
Those reads behave differently: the fix gains +0.0735 AUC there, against +0.0445
where everything has arrived. A replay using battle time silently gives the
model information production does not have. It also moves "one minute before the
battle": production BB(1 min) +0.044 vs the harness's +0.073.

**Alternatives rejected.** Battle-time visibility (overstates freshness). A
fitted lag model (not needed: `stored_at` is measured). Extending the window with
id-order brackets before the purge cursor (an inference layer; not needed for
the gate).

> **⚠ EXTENDED BY PHASE 9 (2026-09-14).** "Id-order brackets before the purge cursor" were built and
> **validated** (88,889 rows, 2 misses > 1 s) — the `battles.id` clock now gives arrival visibility for
> every `battles` row, not only those after the last restart (DATA LIMITATIONS #25). It also showed
> non-duel `stored_at` before the cursor is a re-store time (KNOWN BUGS #21).

### A26. (NEW, Phase 9) A candidate pool is judged at request-time visibility, and expanded only where the narrower source is empty

**Decision.** Any candidate-pool change is evaluated (a) end to end, top-1 over all steps, ranked by the
production ranker; (b) with **arrival** visibility as a mandatory reading (A25), because coverage measured
in event time overstates what a request can see; and (c) by **source**: a wider vocabulary is added only
for subjects whose narrower, better-ranked source has nothing — never unioned into a pool that already has
the answer.

**Why.** Phase 9: the union of duel history and `battles` decks raised recall +6.8 pts and passed the
event-time gate, yet lost −0.48 / −1.56 pts at arrival visibility, cost duel-seen players −6.03 and
dropped conditional top-1 69.7% → 54.9%. Its only gain was for duel strangers (+8.98).

**Alternatives rejected.** Union pools (dilution). Event-time coverage as the gate (22.2% of truths
reachable only through unarrived rows). A new recency cut from an in-sample staleness table.

### A27. (NEW, Phase 10) An input correction to a frozen model ships as a dark engineering change, re-verified from recorded data, with an injectable UTC clock

**Decision.** Supplying a frozen model with an input it was trained on (here, the prediction
timestamp) is an engineering change, not a model change: no retraining, no recalibration. It is
approved only after (1) a production-order gate on real outcomes, (2) exact recomputation of that gate
from the recorded per-read data before the implementation contract is written, and (3) a regression in
a *secondary* output caused by an unchanged frozen policy is accepted explicitly and reviewed
separately, never folded into the fix. Any clock the change introduces is **UTC, produced in one
injectable function, and pinned in every test that exercises it**.

**Why.** Phase 10 recomputed Phase 8b/8c exactly and found the fix touches only band, count, labels and
note. It also found that an unpinned wall clock turns a committed test into a time bomb (KNOWN BUGS #24,
fails from 2026-09-27T18:51:45Z), that the version pins could not catch a mismatch (#25), and that the
audit host's local clock was 5.5 h off UTC.

**Alternatives rejected.** Recalibrating "to complete" the fix (not needed; ordering holds on frozen
cuts). Keeping today's alternative count (rule 4 inversion, unvalidated). Bundling the caps review.
Reading the wall clock inline in `predict` (untestable, calendar-dependent suites). Validating with
`cutoff_ts` = the predicted battle (KNOWN BUGS #14).

### A23. (NEW, Phase 7) An oracle-conditioned gain is not attributed to a component until it is re-measured with the oracle removed

**Decision.** Any result whose task hands the model an input production must
predict (the exit, the edit size, the shell, the fact that an edit happens) is
labelled **oracle-conditioned** and may not justify promotion, a Brain memory or
a "necessary" label until the same comparison — including every ablation and
every support gate — has been re-run with that input predicted, and its
**deployable** subsets defined without the truth.

**Why.** Phase 6's +10.02, its −6.95 ablation and its +18.65 supported subset were
all correct and all oracle-conditioned. With the exit predicted they became
−0.06, +0.21 and −1.07. The supported subset flipped sign because support was
computed from the true exit; computed from the predicted exit, no bucket clears
zero. Phase 6's own "~22%" estimate of the tax was wrong in level (32.29%
measured) because entry accuracy concentrates exactly where the exit is right —
**the tax cannot be estimated by multiplying two marginal rates**.

**Alternatives rejected.** Estimating end-to-end from marginal hit rates
(wrong by 10 points here). Quoting oracle-defined buckets as a specialist (needs
the card that has not left). Switching the gate to deck level after seeing the
result (disclosed instead; README KNOWN BUGS #10).

### A22. (NEW, Phase 6) A descriptive finding is not a predictive one, and the gap must be measured before anything is persisted

**Decision.** No Brain memory may be built from a descriptive census. A
chronological, leak-free replay against the incumbent baseline is a
precondition, not a follow-up.

**Why.** Phase 5 produced 777 per-player displacement findings with FDR control
and a permutation null of zero. Every one of those statements is true. Phase 6
then showed the same evidence, used as a predictor, does not beat the baseline
without backoff — and that Phase 5's own headline example (`ronin →
mighty-miner`) has **zero held-out events** and a population contrast inflated
by a leave-one-out denominator its single subject dominates (1.4% quoted, 15.84%
true).

**Both phases were right.** A pattern can be real, correctly tested, and still
not be the best thing to predict with. The cost of finding that out was one
afternoon; the cost of not finding out would have been a persisted store.

### A16. (NEW, Phase 1) A duel's identity is `battleTime` + the sorted tag pair
- **Reason.** The payload has **no `battleId`** (measured: 0% of 99,920 rows).
  A duel is stored once per tracked participant; 6,379 of 99,920 rows were
  duplicate perspectives. This identity folded them with **zero disagreements**.
- **Alternatives considered.** Trusting `battle_raw`'s `(player_tag,
  battle_time)` primary key — rejected, it is per-perspective and double-counts.
- **Date.** 2026-09-12.

---

## 25. FILE MAP

### The frozen engine — `server/ml/`

| file | what it does |
|---|---|
| `production/predictor.py` | `predict()`, `predict_for_tag()`, `status()`. **The only entry point.** |
| `production/policy.py` | the seven safety rules, `PredictionResult`, `as_dict()`, `BAND_SUPPORTED` |
| `production/calibration.py` | band cut points, `ARTIFACT_DOMAIN` rename map |
| `production/adapter.py` | plays → the research `view`; `current_shell` |
| `production/source.py` | the database read, two-step cache lease, domain partitioning |
| `production/shadow.py` | observation log, `reconcile()`, `checkpoint()`, `drift()`, `verify_log()` |
| `production/frontier.py` | — |
| `production/recalibrate.py` | offline band re-cutting |
| `dataset.py` | `DeckPlay`, `PredictionExample`, `cluster_prefix`, `iter_examples` |
| `features.py` | `FEATURE_NAMES` (21, contract order), `extract()` |
| `change_detector.py` | `M2ChangeModel` |
| `candidates.py` | `C1WideOneCard` generator |
| `shortlist.py` | `build()` — ranks candidates into alternatives |
| `substitution.py` | `S2Transition`, `GlobalStats` — out→in transitions |
| `exit_model.py` | `E4Combined`, `PopulationExitStats` — which card leaves |
| `vocabulary.py`, `ranker.py`, `pairwise.py`, `hybrid.py`, `edit_model.py`, `exit_intel.py`, `predictability.py` | research modules; several closed |
| `config.py` | tunables; **imports** the clustering rule rather than redeclaring it |
| `evaluation/harness.py` | the Phase 1 runner |
| `evaluation/splits.py` | the baselines — `modal`, `recent`, ranked variants |
| `evaluation/metrics.py`, `significance.py`, `reports.py` | scoring, bootstrap CIs |
| `evaluation/phase*.py` | 20 phase modules, each self-contained |
| `evaluation/phase22-final-spec.md` | **THE CONTRACT** |
| `artifacts/m2-change-v1.json` | frozen model |
| `artifacts/band-calibration-v1.json` | frozen cut points |
| `artifacts/band-calibration-v2-candidate.json` | **deliberately unpromoted** |
| `results/*.txt`, `*.json`, `*.jsonl` | measured evidence. **gitignored** |
| `results/cohorts/tags*.json` | 5,680 tags. **tracked** |

### The live product

| file | what it does |
|---|---|
| `server/coach.py` | Coach Assist. `opening_decks`, `next_decks`, `opponent_next`, `win_prob`, `_expected`, `tune`, `suggest`, `predict`, `observe`, `opponent_read` |
| `server/duel_zone.py` | `cluster_player_decks`, `predict_companions`, `build_series`, `pick_duel_legal_sequence` |
| `server/duel_combos.py` | `read_duel_rows`, `is_duel_like_mode`, `is_native_duel`, card catalog loading |
| `server/deck_counter.py` | the 5-rung evidence ladder, `_symmetric`, `archetype_of`, `_representatives` |
| `server/team_analysis.py` | squad vs squad; the coverage-reasoning precedent |
| `server/clash_data.py` | `resolve_db_path`, `connect` (mode=ro), `tier_windows` |
| `server/battle_modes.py` | mode routing; the 2v2 allowlist |
| `server/duo_pairs.py` | **the storage pattern to copy** |
| `server/tracking.py`, `recruit.py` | tag enrolment |
| `server/app.py` | the HTTP service; 22 routes; auth, CORS, rate limit |
| `api/analytics/opponent-read/[tag].ts` | the Vercel same-origin proxy |
| `src/state/analyticsClient.ts` | `OpponentRead` type, `fetchOpponentRead` |
| `src/components/Analytics/CoachAssist.tsx` | the UI, `OpponentReadPanel` |

### Data

| file | what |
|---|---|
| `src/data/cards.json` | 123 cards |
| `src/data/cardMeta.json` | 4 flags |
| `src/data/cardRoles.json` | roles/counters, 122 of 123, hand-authored |

---

## 26. DATABASE / STORAGE

### Read-only guarantee

`clash_data.connect()` opens the bot's database **`mode=ro`**, stated in both
READMEs. `tracking.py` exists specifically to preserve it — the website writes
to its own `.tracking.db`, never to the bot's. **The Brain must not break this.**

### Existing stores

| store | engine | writer | notes |
|---|---|---|---|
| `battles.db` | SQLite ~33 GB | the bot only | mode=ro from here |
| `battle_raw` | in the same file, ~44.7 GB | the bot only | `game_mode` has **no index** |
| `archive.db` | SQLite, H: (unplugged) | the bot | 2026-05-01 → 2026-08-25, the only copy of that month |
| `.duo_pairs.db` | SQLite | `duo_pairs.py` | the pattern to copy |
| `.tracking.db` | SQLite | `tracking.py` | enrolment queue |
| `shadow-log.jsonl` | JSONL, locked, rotated | `shadow.py` | 2,620 entries |
| `brain-evidence/phase8/` | 34 files, 132 MB, gitignored | Brain Phase 12 (copied, never written to) | the Phase 8b/8c extract — **real player tags**, the only copy, hashes in its tracked `MANIFEST.md` |

**No file size has ever been recorded for `.duo_pairs.db`** (found Brain Phase 13A): the
documented figures are 1,483,672 pairs and ~75 MB per index × 3, and nothing anywhere
states the file's size. Inside it, `duo_stage` (~1.89M rows, one per battle per side) is
**unbounded and never pruned** — the largest unmanaged structure in the collection, and
a safer storage target than the census itself.

### Rules the Brain store must follow

1. Its **own file**, gitignored, never a table inside `battles.db` (A8).
2. Survives independently of the raw rows.
3. `_ensure()` **migrates columns** — `CREATE TABLE IF NOT EXISTS` does nothing
   to an existing table, so a column added later is missing on every collection
   built before it.
4. Incremental watermark on `stored_at`, failing closed (empty cursor = protect
   everything).
5. Dedupe on a **battle identity built from the battle's own contents**,
   enforced by a primary key, not by hoping.
6. Deploys by hand with `scp`, like the rest of `server/`.
7. **No backup exists for anything on the VPS.** Anything the Brain cannot
   recompute must be treated as at risk.

---

## 27. TESTS

### Python — the ML suites, all run 2026-09-12

| suite | tests | result |
|---|---:|---|
| `test_ml_22_final.py` | 66 | **OK** — enforces the frozen spec |
| `test_ml_production.py` | 81 | OK |
| `test_ml_dataset.py` | 32 | OK |
| `test_ml_21a.py` | 32 | **1 FAILURE** — see KNOWN BUGS #2 |
| `test_ml_17b.py` | 31 | OK |
| `test_ml_20b.py` | 38 | OK |
| `test_ml_20c.py` | 30 | OK |
| `test_ml_20d.py` | 27 | OK |
| `test_ml_18.py` | 27 | OK |
| `test_ml_metrics.py` | 28 | OK |
| `test_ml_policy.py` | 27 | OK |
| `test_shadow_durability.py` | 24 | OK |
| `test_oie_ui.py` | 23 | OK |
| `test_ml_20a.py` | 22 | OK |
| `test_ml_recalibrate.py` | 22 | OK |
| `test_ml_change.py` | 21 | OK |
| `test_ml_pairwise.py`, `test_ml_substitution.py` | 20 each | OK |
| `test_ml_candidates.py` | 19 | OK |
| `test_ml_vocabulary.py` | 17 | OK |
| `test_ml_exit.py`, `test_ml_hybrid.py`, `test_ml_shortlist.py` | 16 each | OK |
| `test_ml_exit_intel.py` | 15 | OK |
| `test_ml_contract.py` | 13 | OK |

**Total: 683 ML tests across 25 suites, 682 passing, 1 failing.**

> **⚠ RE-RUN BY BRAIN PHASE 11 (2026-09-15), working tree with the timestamp fix:** 27 suites
> (23 `test_ml_*` + `test_oie_ui`, `test_shadow_durability`, `test_api_security`, `test_coach`) —
> **767 unittest tests + 69 homegrown checks**, baseline 756 + 69. `test_ml_production.py` **81 → 91**,
> `test_ml_22_final.py` **66 → 67**. Only failure: `test_ml_21a` (123 != 122), unchanged. One skip
> (`FrontierWatch.test_an_advanced_frontier_is_ready`, 'no database').
>
> **⚠ RE-RUN AGAIN BY BRAIN PHASE 12 (2026-09-15) before committing:** the same 27 suites, **767 + 69**,
> identical suite by suite to the Phase 11 after-run; only `test_ml_21a` failing, its output identical;
> shadow log md5 unchanged.

### Tests that matter most to the Brain

- **`test_ml_22_final.py`** — enforces the freeze. It asserts the spec file
  exists and declares the freeze, that the version stamp matches what the log
  records, and that `os.getenv("CLASH_OIE", "off")` is literally in the source.
  **Any Brain change that touches the frozen engine will fail this suite, and
  that is the point.**
- **`test_ml_dataset.py`** — pins `cluster_prefix`'s representative against
  `duel_zone.cluster_player_decks` so the research and production clusterers
  cannot drift into measuring different systems.
- **`test_shadow_durability.py`** — the append path. A test once called
  `os.remove()` on the production log path and **destroyed 1,277 observations**;
  `CLASH_OIE_LOG` is overridable specifically so that cannot recur.
- **`test_ml_17b.py` / `test_ml_18.py`** — assert the evaluation SQL contains no
  `INSERT / UPDATE / DELETE / CREATE TABLE / DROP`.

### Project-wide tripwires that fire when things are added

| tripwire | file | current value |
|---|---|---|
| API route count | `server/test_api_security.py` | **22** |
| free sections matrix | `tests/entitlement.test.ts` | — |
| release-note routes allowlist | `tests/releases.test.ts` | — |

Bump them in the same commit as the change.

### Other suites

**Python overall:** 2,194 checks across 43 suites (as of 2026-09-11).
**Totalling them requires reading two different lines** — most print
`N passed, M failed` from a homegrown `check()`, while the `test_ml_*` ones and
`test_api_security` are stdlib `unittest` and print `Ran N tests`. A script
that greps only the first scores fourteen suites as zero.

**Frontend:** 500 vitest across 18 files. Use
`npx vitest run --pool=forks --poolOptions.forks.singleFork` — the default pool
OOM-crashes on this machine.

---

## 28. EVALUATION METHODOLOGY

**Any Brain evaluation must follow this. It is not negotiable and it is already
implemented.**

### Report both pooled and player-macro

Predictions from one player are correlated. A single heavy player must not
carry the result. Every phase report since Phase 1 carries both, and
`shadow.reconcile()` computes `accuracy` and `accuracyMacro` side by side.

### State the step definition in the report header

`next-in-cluster` and `next-play` are different questions and the same
shortlist measured **+8.4** under one and **+0.5** under the other. `STEP_MODES`
in `ml/dataset.py:217` names both.

### Bootstrap confidence intervals, paired where possible

`ml/evaluation/significance.py`. `BOOTSTRAP_ITERS = 2000`,
`BOOTSTRAP_SEED = 20260818`, `CI_PERCENT = 95`. **Paired on players** is the
decisive form — Phase 21A's headline is `0.000 [-0.001, 0.001]` paired over
20,702 players, and Phase 20D overturned a large pooled gap by pairing on the
203 players who experienced both contexts.

### Choose the right baseline

For a legality-filtered duel ranker the baseline is **random-in-legal-pool**,
not "guess an archetype". Phase 21A supplement 11 exists because the first
framing flattered the ranker by ~34 points.

### Report coverage alongside accuracy

A band that is 95% accurate on 3% of reads is a different product from one that
fires on 80%. `reconcile()` reports `share` per band for this reason.

### Report calibration, not just accuracy

Brier and ECE. The dominant competitive bin claimed 96.8% and delivered 68.5%.

### Census the population before believing its label

Phase 20D exists because twenty phases of results were labelled `duel` and
described practice. Print the mode distribution of whatever your evaluation
actually read.

### Eligibility floors

`MIN_CLUSTER_HISTORY = 5`, `MIN_PLAYER_BATTLES = 20`, `DEFAULT_PLAYERS = 400`,
`MIN_PLAYERS_FOR_CONCLUSION = 100`. A band under 30 players is marked and **must
not be read as an estimate** — that was 19D duel `high`'s mistake (n=8).

---

## 29. FUTURE BRAIN ARCHITECTURE

**Conceptual only. Nothing below is approved for implementation.**

```
                      ┌──────────────────────────────────────┐
                      │   BOT (separate repo, /opt/clashbot) │
                      │   writes battles + battle_raw        │
                      └───────────────┬──────────────────────┘
                                      │ read-only, mode=ro
        ┌─────────────────────────────┴──────────────────────────────┐
        │                                                            │
┌───────▼────────────┐                                    ┌──────────▼─────────┐
│  INGEST (offline)  │                                    │  SERVE (in-request)│
│  watermark on      │                                    │  read-only against │
│  stored_at         │                                    │  the Brain store   │
│  dedupe on battle  │                                    │  NEVER trains (A2) │
│  identity          │                                    └──────────┬─────────┘
└───────┬────────────┘                                               │
        │                                                            │
┌───────▼────────────────────────────────────────────────┐           │
│              BRAIN STORE   (own SQLite, A8)            │◄──────────┘
│                                                        │
│  player_state    tag, decks, archetypes, stability,    │
│                  volatility, last_seen, n_obs          │
│  duel_history    series, per-game decks, per-game      │
│                  crowns, BOTH sides (from battle_raw)  │
│  patterns        context, observation, occurrences,    │
│                  confidence, lifecycle status          │
│  card_timeline   first_seen, adoption curve,           │
│                  replacements, associations            │
│  predictions     what/why/confidence/alternatives      │
│  outcomes        actual, error, reconciled_at          │
└───────┬────────────────────────────────────────────────┘
        │
┌───────▼──────────────┐        ┌──────────────────────────┐
│  LEARNER (offline)   │───────►│  ARTIFACT (versioned)    │
│  scores, calibrates, │        │  never overwritten (A13) │
│  fits, validates     │        └──────────────────────────┘
└──────────────────────┘
```

### The three-layer separation the brief asks about (section 15)

| layer | owns | may NOT |
|---|---|---|
| **Deterministic** | duel legality, card constraints, deck identity, clustering | be overridden by anything |
| **Statistical / ML** | probabilities, tendencies, transitions, confidence, calibration | be written by an LLM |
| **Reasoning (LLM)** | explanations, hypotheses to test, human-readable findings, Coach Assist copy | produce or alter a number |

**The LLM never writes a probability.** It may propose a hypothesis, which then
goes through section 28's methodology like any other. This is the same boundary
`ml/production/__init__.py` already draws between the research package and the
Coach.

### Four defences against self-poisoning (brief section 14)

1. **Evidence floors before a pattern may move a ranking.** `MIN_CELL = 5` and
   `MIN_SUPPORT = 30` are the existing precedents.
2. **Validation gate before promotion.** An artifact is promoted only after a
   leak-free held-out evaluation beats the baseline. `band-calibration-v2` sits
   unpromoted today precisely because it would fit a population whose
   composition is an artifact of when collection ran.
3. **Versioning and rollback.** Five-axis stamp on every observation
   (`shadow.VERSIONS`), so a mid-experiment change cannot silently mix two
   systems in one log.
4. **The Brain must not influence what is collected.** If it feeds enrolment or
   sampling, the evaluation population becomes a function of the model.

---

## 30. IMPLEMENTATION ROADMAP

**Phases are ordered so that each one is independently valuable and
independently abandonable. Do not skip.**

### Phase 0 — Repository audit ✅ COMPLETE (2026-09-12)
This document.

### Phase 1 — Duel substrate extraction *(next)*
Read `battle_raw.raw_json` for native duel modes and build a **read-only,
offline** duel history: series, per-game decks, per-game crowns, both sides.
Reuse `phase21a.py`'s parser rather than writing a second one. **No store, no
model, no production change.** Deliverable: a census report answering *how many
players have how many duels, and how much of the 71.7% no-pool gap closes when
opponent history comes from duel payloads instead of `battles`.*

### Phase 2 — Brain store schema + ingest
Own SQLite file, `stored_at` watermark, battle-identity dedupe, `_ensure()`
column migration. Populate `duel_history` and `player_state` only. Idempotent.
Still no prediction.

### Phase 3 — Coverage experiment
The decisive measurement. Re-run Phase 21A's evaluation with the Brain's
duel-derived opponent history in place of `battles`-derived history. **Gate: does
coverage rise materially above 20.4%?** If not, the Brain's central premise is
wrong and we stop and say so.

> **⚠ Phase 9 (2026-09-14) is the coverage experiment this roadmap anticipated, run on Phase 1's steps with
> the frozen rankers.** Result CONDITIONAL: the event-time gate passed, the request-time readings failed.
> See §19 and the Phase 9 artifact.

### Phase 4 — Prediction memory
Extend the shadow log's schema into the store: what, **why**, confidence,
alternatives, and — new — the actual outcome and the error, written back.
Reuse `outcomes_from_history`'s temporal discipline exactly.

### Phase 5 — Card intelligence
Section 16. First appearance, adoption curve, associations, replacements. Fully
independent of Phases 1-4 and could run in parallel if resourced.

### Phase 6 — Pattern memory
Only after Phase 4 has a real error stream. Lifecycle, evidence counts,
confidence. Patterns are **reported**, not yet used.

### Phase 7 — Evidence-based confidence
Replace the single logistic score with per-source confidence. Must pass the
ordering gate (`shadow.band_ordering`) before anything is displayed.

### Phase 8 — Offline benchmark vs the baseline
The Brain predicts; `Recent` and Coach Assist predict; all three are scored by
section 28's methodology on the same held-out split. **Gate: the Brain beats
both, player-macro, with a paired CI clear of zero.**

### Phase 9 — Shadow deployment
Behind a flag, logging only, no user-visible change. Reuse the existing shadow
machinery.

### Phase 10 — Integration
Only after Phase 9 shows the offline result holds on live traffic.

### Cheap experiments available at any time

- **Fix `timestamp="9999"` and measure it** (KNOWN BUGS #1). Two of twenty-one
  features, both temporal, currently dead. Cost: one line plus one evaluation
  run. This may be the highest value-per-hour item in the whole project.
  **→ MEASURED by Brain Phase 8; this item is SUPERSEDED.** The measurement was
  cheap; the fix is not one line in effect (KNOWN BUGS #12, decision A24).
  **→ Session 2 (2026-09-14):** with stamp = request time (UTC) the fix beats
  `9999` on outcomes (harness frame). It is eligible for a controlled review
  once Phase 8b re-validates in production's frame (§32).
  **→ Phase 8b (2026-09-14): PASS in production order (8/8 readings).** Eligible
  for controlled fix implementation review; the review must decide the
  alternatives regression (KNOWN BUGS #17).
  **→ Phase 10 (2026-09-15): the implementation review.** CONDITIONAL — approvable;
  8b and 8c recomputed exactly; minimal dark contract fixed
  (`DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md` §10–§13). Open condition:
  explicit acceptance of the alternative regression.
  **→ Phase 11 (2026-09-15): regression accepted; IMPLEMENTED LOCALLY, PASS.** Offline
  equivalence 357,426 / 128,816, 0 mismatches. Not committed, not deployed.
  **→ Phase 12 (2026-09-15): COMMITTED (one local commit, not pushed) and the Phase 8b/8c
  evidence preserved to the gitignored `brain-evidence/phase8/`. Still NOT deployed.**
- Fix `test_ml_21a.py`'s 122 → 123.

---

## 31. CURRENT PHASE

```
PHASE:      13A (corrected) - 2v2 retention: top 50 most-used pairs per canonical win
            condition, plus the battles belonging to them
STATUS:     COMPLETE (2026-09-17)  -  CONDITIONAL. Implemented + tested locally;
            destructive cleanup PREPARED and NOT executed; nothing deployed.

CORRECTION: the earlier "six win conditions" reading was WRONG. It is ALL canonical win
            conditions - 17 - and all 17 fill on the live data.

MEASURED    (read-only VPS, 2026-09-16/17; no write, no delete, no restart)
  battles.db      77.06 GB   battle_raw 32.3 GB / 3,046,896 rows (930,940 are 2v2)
                             battles    10.4 GB / 6,694,125 rows (1,415,839 are 2v2)
  .duo_pairs.db    5.14 GB   duo_pairs 2,493,481 rows; duo_stage 3,936,312 rows
  growth          +200,000 pairs/day; 86.2% of all pairs seen exactly ONCE
  census          17/17 win conditions; 850 slots -> 736 distinct pairs;
                  162,274 of 1,968,156 battles retained (8.24%)

THE FINDING battle_raw cannot be reduced by this work. The bot's own cap targets
            non-duel (= 2v2) raw, runs ONLY at bot startup, has not run in 14 days, and
            at the next restart deletes all 930,940 2v2 payloads - retained ones too.
            So "keep their battles" = the duo_stage record, never raw JSON.

BUILT       server/duo_retention.py + test_duo_retention.py (64 checks, all pass).
            Reuses deck_counter's 17 win conditions and duo_pairs' pair identity.
            Two bounded tables inside the existing .duo_pairs.db. Ships DARK.
PROJECTED   5.14 GB -> ~1.2 GB live (~76% freed logically; VACUUM not run, not approved)
NEXT        approval for the destructive cleanup (backup -> rebuild -> verify -> plan ->
            prune), wiring the one-line hook, and the #/duo copy decision.
```

### Phase 13A (blocked, superseded), preserved

```
PHASE:      13A - 2v2 top-50-per-win-condition storage compaction (READ-ONLY outcome)
STATUS:     COMPLETE (2026-09-17)  -  BLOCKED, nothing implemented, nothing deleted

BLOCKED ON: 1. the six win conditions do not exist in this codebase (23 cards / 17
               archetypes / 6 editorial play styles - see the Phase 13A entry in 19)
            2. no 2v2 data on this machine (resolve_db_path() -> None; .duo_pairs.db
               is on the VPS), so counts, rebuild, verification and before/after
               measurement all need VPS access this phase forbids
            3. the 2v2 store holds PAIRS, not decks, by the decision that deleted
               duo_decks.py; a pair has two decks and so up to two win conditions

DECISIONS   1. which taxonomy are "the six"? (recommended: the canonical 17 with a
OWED           per-bucket cap; 17 x 20 ~= 340 records, nothing invented)
            2. retain top-50 PAIRS, or reverse the decision and build per-deck 2v2?
            3. is duo_pairs the right target at all - it is ~1 GB of the ~78 GB that
               2v2 occupies (battle_raw 44.7 GB; ~1.38M rows in battles, mode=ro here)

CHANGED:    nothing in source. Artifact + this README only.
BASELINE:   test_duo_pairs 425, test_battle_modes 135, test_recent_battles 40, green.
STATE:      Production UNCHANGED. VPS untouched. CLASH_OIE=off. The Phase 12 timestamp
            commit (a9cdbb7) is untouched and still not deployed.
NEXT:       the three decisions above; and, separately and still pending, Phase 13 -
            the dark deployment of the timestamp fix.
```

### Phase 12, preserved

```
PHASE:      12 - Commit the timestamp fix + preserve the Phase 8b/8c evidence
                 (COMMITTED LOCALLY; NOT PUSHED; NOT DEPLOYED)
STATUS:     COMPLETE (2026-09-15)  -  DONE
APPROVAL:   account holder approved (1) committing the Phase 11 implementation and (2) preserving
            the evidence durably. NOT approved: VPS deployment, VPS restart, CLASH_OIE=shadow,
            CLASH_OIE=on, production activation, pools, caps, persistence, retraining,
            recalibration, unrelated fixes.

COMMIT:     ONE commit on main, parent c4fc65e, NOT pushed (a push triggers a Vercel deploy).
            Contents: the 5 Phase 11 files (numstat unchanged: 17/1, 1/1, 17/2, 57/14, 222/3),
            .gitignore, README.md, server/README.md, DECKKIES_BRAIN_README.md,
            DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md,
            brain-evidence/phase8/MANIFEST.md. CLAUDE.md was updated but is gitignored.
            Hash: see DECKKIES_BRAIN_PHASE12_COMMIT_EVIDENCE.md (a file cannot name its own commit).

EVIDENCE:   brain-evidence/phase8/{p8b,p8c} - 34 files, 132,283,959 bytes, cp -rp from the Phase
            8b/8c scratchpad; SHA-256, MD5, sizes and mtimes identical source vs copy; source
            left intact. .gitignore denies /brain-evidence/* and re-includes ONLY
            brain-evidence/phase8/MANIFEST.md (rule written BEFORE the copy). git check-ignore
            covers all 34; git status shows only the manifest; sha256sum -c 34/34 OK.
            REAL PLAYER TAGS - never commit, never push, never copy into server/.

TESTS:      27 suites re-run before committing: 767 unittest + 69 homegrown, identical suite by
            suite to Phase 11. Only failure test_ml_21a 123 != 122 (pre-existing, accepted, output
            identical). One skip (no database). Shadow log md5 a02ff6cc..., 2,620 lines, unchanged.

STATE:      Production UNCHANGED. VPS runs "9999". CLASH_OIE=off. royalweb not restarted.
NEXT:       Phase 13 - a controlled DARK deployment with CLASH_OIE=off. NEEDS ITS OWN APPROVAL.
            Then, separately: CLASH_OIE=shadow. CLASH_OIE=on is a separate decision (deadlock 2).
            Research: none.
```

### Phase 11, preserved

```
PHASE:      11 - Timestamp fix implementation (LOCAL; NOT COMMITTED; NOT DEPLOYED)
STATUS:     COMPLETE (2026-09-15)  -  PASS
APPROVAL:   account holder accepted the Phase 8c alternative regression and approved the
            Phase 10 implementation only. Deploy, restart, CLASH_OIE=shadow, frontend, pools,
            caps, persistence, retraining, recalibration, unrelated fixes NOT approved.

CHANGES:    predictor.py   import time; _request_stamp() (UTC, time.gmtime(),
                           "%Y%m%dT%H%M%S.000Z"); line 120 timestamp=cutoff_ts or _request_stamp()
            shadow.py      VERSIONS["features"] = "phase2-21-reqstamp-utc"
            spec           2.2 and 6 feature-version rows; 7 input-correction note
            tests          test_ml_production 81 -> 91 (T1-T7, pin guard, pinned clock);
                           test_ml_22_final 66 -> 67 (exact version pins, pinned clock)

RESULT:     OFFLINE EQUIVALENCE PASS: 357,426/357,426 reads (pB max |d| 4.44e-16) and
            128,816/128,816 condition-B records (band, note, list, count, uncapped list +
            labels), 0 mismatches; evidence md5 unchanged.
            SUITES: 767 unittest + 69 homegrown pass (baseline 756 + 69); only failure
            test_ml_21a 123 != 122, byte-identical to baseline.
            6 mutants caught; clean control passes; calendar-independent to 2030.
            Shadow log unchanged (2,620 lines). VPS untouched. HEAD c4fc65e.
            Full artifact: DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md

NEXT:       each needs its own approval, in order: commit (with repo docs); preserve the
            Phase 8b/8c evidence (S0); dark deploy (S2); CLASH_OIE=shadow (S3-S7).
            Research: none.
```

### Phase 10, preserved

```
PHASE:      10 - Timestamp fix engineering decision audit (READ ONLY)
STATUS:     COMPLETE (2026-09-15)  -  CONDITIONAL (Phase 8c mapping, applied unchanged)
QUESTION:   Can the Phase 8/8b timestamp fix be safely approved for implementation despite
            the Phase 8c alternative regression, and what exact minimal contract applies?

METHOD:     All 12 artifacts + README read in full; engine code traced at c4fc65e; Phase 8b
            (357,426 reads) and 8c (128,816 records) per-read data STREAMED and every gated
            figure RECOMPUTED with new code; existing predictor suites run under simulated
            stamps in process. No gate created or moved. No DB, no VPS, no file edited.

RESULT:     Phase 8b gate PASS 8/8 - reproduced exactly:
              AUC 0.6188 -> 0.6734 (+0.0545 [+0.0381,+0.0698]); Brier macro 0.3710 -> 0.2747
              (-0.0963 [-0.1103,-0.0828]); high 92.8% @ 63.3% -> 65.0% @ 69.3%; 3 bands ordered
            Phase 8c rule CONDITIONAL - reproduced exactly:
              hits 1.846% -> 1.062% (-0.91 pts [-1.41,-0.51]); removed 1.97% vs retained 0.74%
              (+1.22 [+0.45,+2.21]); R1 +21.70; B1 0.78 pts < 3%; identity 128,816/128,816
            primary deck identical on all 128,816 records; alternatives secondary by contract
            leakage PASS; no retraining; no recalibration; re-validation via shadow plan
            test hazard: an existing test fails from 2026-09-27T18:51:45Z if the stamp is unpinned
            NEW DEFECTS: KNOWN BUGS #24-#28. New decision A27.

CONTRACT:   predictor.py:104 -> timestamp=cutoff_ts or _request_stamp() (UTC helper);
            shadow VERSIONS["features"] -> phase2-21-reqstamp-utc; spec 2.2/6 + 7 note;
            tests T1-T7, tightened pins, stamp pinning; offline equivalence vs recorded pB
            and condition B before any deploy; CLASH_OIE stays off.

DECISION:   CONDITIONAL - approve the minimal dark implementation on the account holder's
            explicit acceptance of the alternative regression. Caps review separate.
            Full artifact: DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md

NEXT PHASE: engineering - Phase 11, controlled dark implementation (artifact 10 s20), only
            after explicit acceptance. NEEDS APPROVAL.
            research - none required.
```

### Phase 9, preserved

```
PHASE:      9 - Full player deck-vocabulary candidate-pool replay (READ ONLY)
STATUS:     COMPLETE (2026-09-14)  -  CONDITIONAL (pre-registered mapping)
QUESTION:   Does expanding the candidate pool to the player's historically observed
            full deck vocabulary materially improve next-deck prediction on a
            leakage-free chronological replay?

POOL:       FULL(P,T) = every complete 8-card deck P revealed in a native duel or
            played in a battles row, battle_time < T; legal = 0 cards shared with
            the series' used cards. Compared with A (duel history, the gate's
            comparator), C (Coach Assist C0), BAT, FULL60 (C1, frozen 60 d / 1,200).

METHOD:     Phase 1's 79,894 duel test steps reproduced exactly (snapshot stored_at),
            per-step strictly-prior vocabularies, frozen rankers (phase21a Tables U1;
            predict_companions U2; Coach windows W1/W2), visibility snap / S-ARR (id
            clock) / S-EXACT (post-cursor, 14,810 steps), player-paired bootstrap.

RESULT:     GATE (README s32) PASSES on Phase 1's harness:
              FULL - A top-1  U1 +1.39 [+1.17,+1.60]  U2 +0.36 [+0.18,+0.55]
              ranker - random at pools >= 5  +9.09 / +11.91
            ARRIVAL FAILS: S-ARR U2 -0.48 [-0.59,-0.36]; S-EXACT U2 -1.56 [-1.90,-1.22]
            recall A 30.36 -> FULL 37.14 (S-ARR 13.37 -> 14.92); zero-pool 59.94 -> 47.65
            top-1 | truth in pool 69.7 -> 54.9; step-weighted top-1 21.15 -> 20.37
            duel strangers +8.98; duel-seen -6.03; vs Coach C0 +3.85
            OIE unit ceiling: served 62.98% -> full vocabulary 80.55% (changes 4.75 -> 49.96)
            NEW DEFECTS: KNOWN BUGS #21, #22, #23.

DECISION:   CONDITIONAL. Change no candidate pool. Do not promote the union. Brain
            deck memory not justified beyond an arrival time per observation.
            Full artifact: DECKKIES_BRAIN_PHASE9_CANDIDATE_POOL_REPLAY.md

NEXT PHASE: research - none required. If coverage is reopened: an arrival-primary,
            pre-registered duel-history -> full-vocabulary BACKOFF with a materiality
            floor (post-hoc +0.36 pts at S-ARR). PROPOSED, NOT APPROVED.
            engineering - timestamp fix, unchanged, on acceptance of the regression.
```

### Phase 8c, preserved

```
PHASE:      8c - Alternative regression decision audit (READ ONLY)
STATUS:     COMPLETE (2026-09-14)  -  CONDITIONAL (pre-registered rule)
QUESTION:   Is the alternative-hit regression from the correct timestamp a
            meaningful loss of useful recommendations, or an appropriate
            consequence of improved confidence calibration?

DEFINITION: an alternative is a one-card edit of the recent deck, labelled by
            shortlist._band and capped high 2 / medium 1 / low 0. The UI calls
            them "not forecasts"; spec §2.4 calls them secondary and "the first
            thing to remove". Their only frozen metric is coverage.

METHOD:     Phase 8b's production-order reads (A25), real predictor.predict
            under both stamps on 128,816 reads, full lists recovered, caps
            re-applied; conditions A (9999), B (fix), C (fix + today's count),
            D (none), E (uncapped); decision rule pre-registered.

RESULT:     competitive (111,123 reads, 773 players), A -> B:
              alternatives/read 1.827 -> 1.429; hit 1.85% -> 1.06% (-0.91 pts);
              false alternatives/read 1.809 -> 1.418; coverage 62.98 -> 62.20%
              changed reads: hit 4.75% -> 2.73%; unchanged: -0.32 false/read
              removed alternatives precision 1.97% vs retained 0.74%
              band precision 0.37 / 2.90 / 3.61% vs caps 2 / 1 / 0
              80.1% of changes are 3+-card switches no alternative can match
              identity/order identical 128,816/128,816
            RULE: R1 yes, R2 yes, R3 NO, B1/B2/B3 no -> CONDITIONAL.
            NEW DEFECTS: KNOWN BUGS #19 (HIGH alternative label unreachable),
            #20 (UI subtitle overstates history: 73.7% not in history).

DECISION:   Timestamp fix NOT BLOCKED. Cleared for controlled implementation
            on explicit acceptance of the alternative regression; the
            ALTERNATIVE_CAPS review is separate and needs its own gate.
            Full artifact: DECKKIES_BRAIN_PHASE8C_ALTERNATIVE_REGRESSION_AUDIT.md

NEXT PHASE: research - Phase 9 (coverage), PROPOSED, NOT APPROVED.
            engineering - timestamp fix implementation, on the account
            holder's acceptance of the regression.
```

### Phase 8b, preserved

```
PHASE:      8b - Production-order timestamp replay (READ ONLY)
STATUS:     COMPLETE (2026-09-14)  -  GATE: PASS (8/8 pre-registered readings)
OBJECTIVE:  Does the request-time timestamp still beat "9999" in production's
            own order, with real ingest lag, under the README §32 gate?

GATE        competitive macro Brier CI < 0 vs 9999 under the random-clock
(verbatim)  model AND band ordering holds AND high-band Recent accuracy at the
            request stamp >= 9999's on the same reads. Practice reported.
            Ambiguities (target under lag; pooled/macro; "same reads") were
            evaluated under every reading; one vacuous reading (S2) excluded
            before results.

DATA:       VPS read-only; seeded 1,200 of 5,319 tracked players; arrival =
            battle_raw.stored_at since the purge cursor 2026-09-12T02:55:53Z;
            requests every 15 min over 2026-09-12T03:00Z -> 2026-09-14T04:30Z.
            357,426 reads with a model output; competitive random clock
            111,123 scoreable (773 players), practice 17,693 (163).

TIMING:     production request timestamps: NONE EXIST (api.log untimestamped).
            Ingest lag, tracked: median 1.89h, p95 3.79h, max 9.0h, 100% < 6h.
            31.4% of competitive reads have a played-but-unarrived battle.
            Bot cadence effectively ~4h, not 2h.

RESULT:     competitive, random clock, T1:
              ROC-AUC 0.6188 -> 0.6734  +0.0545 [+0.0381, +0.0698]
              Brier macro 0.3710 -> 0.2747  -0.0963 [-0.1103, -0.0828]
              high 92.8% @ 63.3% -> 65.0% @ 69.3%; ordering on 3 bands
            every competitive family and delay bucket improves; biggest where
            idle > 24h (Brier -0.2324) or battles unarrived (-0.1545).
            practice: Brier -0.2885; AUC +0.029 ns.
            features: x10 alone +0.0505 AUC; x9 alone -0.0051 ns, Brier worse.
            primary deck identical 4,500/4,500.
            ALTERNATIVE HITS 1.85% -> 1.06% (-0.91 pts [-1.41,-0.51]).
            LEAKAGE PASS (294,644 assertions).
DECISION:   Eligible for controlled fix implementation review. Not implemented.
            CLASH_OIE stays off.
            Full artifact: DECKKIES_BRAIN_PHASE8B_PRODUCTION_ORDER_TIMESTAMP_REPLAY.md

NEXT PHASE: Phase 9 - Coverage (research; PROPOSED, NOT APPROVED).
            The timestamp fix moves from research to an IMPLEMENTATION REVIEW
            decision (needs approval). See section 32.
```

### Phase 8 session 2, preserved

```
PHASE:      8 - Production timestamp bug impact audit (READ ONLY)
STATUS:     COMPLETE, RE-VERIFIED AND EXTENDED - session 2 (2026-09-14)
OBJECTIVE:  Reproduce session 1 independently; then score a REQUEST-TIME stamp
            against real outcomes, which session 1 declared unmeasurable.

TIMESTAMP:  current  "9999" -> x9 = x10 = 0
            training the predicted battle's time T
            SERVE    THE REQUEST TIME, UTC ("%Y%m%dT%H%M%S.000Z"), or cutoff_ts
                     when supplied. R <= cutoff: in production the cutoff IS R,
                     and every stored play is <= R. R -> T as the read nears
                     the battle.
AFFECTED:   log_hours_since_change (9), log_hours_since_last_play (10);
            is_duel (20) separately (KNOWN BUGS #11).

METHOD:     Pre-registered. Own scripts; production loader; frozen cuts.
            A read at anchor + h is about exactly the steps with gap > h
            (survival conditioning, observable at R). R(h), E(e) = T - e,
            U = random clock. Paired vs 9999 on identical rows; player-cluster
            AUC bootstrap (== brute force); paired_delta Brier.

RESULT:     REPLICATION EXACT (all numbers, CI bounds). Dump proved battle-
            time-stamped on 114,956 real steps. LEAKAGE PASS (815,524 checks).
            competitive vs 9999, same steps:
              R(36h)  Brier -0.1596 [-0.1819,-0.1373]  AUC +0.0060 [+0.0017,+0.0105]
              U       Brier -0.1706 [-0.1931,-0.1497]  AUC +0.0494 [+0.0330,+0.0702]
              E(1h)   AUC +0.0423, 94% of the battle-time gain
              R(5min) Brier +0.0018 [+0.0009,+0.0030]  slightly WORSE
            Late reads under 9999: "high" at ~59-63% Recent accuracy; request
            stamp "high" at 70-82%; ordering holds; band movement 81% (U).
            Production frame (no model): idle >36h competitive changes 59.2%;
            practice ranks short gaps backwards.
            Verdict CONDITIONAL (session-1 gate unchanged). I4 FIRES.
            RISK: edit LOW; behaviour MEDIUM; contract MEDIUM (no retraining;
            re-validation required). Still not LOW.
            DECISION: fix ELIGIBLE for controlled review, stamp = request time;
            precondition Phase 8b (VPS). Nothing scheduled.
            Full artifact: DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md §27

NEXT PHASE: 9 - Coverage (unchanged, PROPOSED NOT APPROVED). Phase 8b is the
            precondition for any stamp fix or CLASH_OIE rollout (PROPOSED NOT
            APPROVED). See section 32.
```

### Phase 8 session 1, preserved

```
PHASE:      8 - Production timestamp bug impact audit (READ ONLY)
STATUS:     COMPLETE (2026-09-13)
OBJECTIVE:  How much predictive value does predictor.predict's
            timestamp="9999" cost, and is a fix worth a controlled change?

TIMESTAMP:  current  "9999" -> _parse fails -> both features log1p(0) = 0
            correct  the prediction cutoff: in the harness M2 was trained in,
                     the predicted battle's time; in production, cutoff_ts or
                     the request time. timestamp_correct = cutoff, and both
                     features read only shell plays < cutoff.
AFFECTED:   log_hours_since_change (idx 9), log_hours_since_last_play
            (idx 10). Phase 0's count of two is correct. A THIRD production
            input fault exists for another reason: is_duel = 0 on practice
            reads since the Phase 23 rename.

METHOD:     Phase 2 harness (99,541 held-out steps), frozen m2-change-v1,
            ONE variable. A = 9999; B1 = predicted battle's time; B2 = shell's
            last play. Ablations; paired player-cluster AUC bootstrap and
            paired_delta Brier. Pre-registered gate (+0.010 AUC; <5% band
            movement for LOW risk).

RESULT:     CONDITIONAL.
            competitive ROC-AUC  A 0.8584 | B1 0.9315 | B2 0.8615
              B1-A +0.0731 [+0.0625, +0.0855]   Brier -0.0265 [-0.0326,-0.0209]
              B2-A +0.0031 [-0.0014, +0.0076] ns Brier +0.0013 (worse)
            practice  A 0.7601 | B1 0.8032 (+0.0431) | B2 0.7684
            ablation: x10 alone +0.0721; x9 alone -0.0282 (worse than bug)
            B1 reproduces Phase 2 exactly - production has never run 0.932.
            Production's logged requests: median 36h/49h after last play vs
            a 5-minute training median; at 36h, 34.2% of competitive reads go
            "low" (was 1.2%), practice 100%.
            Bands: 10.84% of competitive steps change band even at B1; every
            band validation ran on buggy outputs.
            LEAKAGE PASS (19,077 checks).
            RISK: edit LOW, behaviour HIGH, contract HIGH.
            DECISION: do NOT schedule the one-line fix; the defect is M2's
            serve-time definition (KNOWN BUGS #12, A24).
            Full artifact: DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md

NEXT PHASE: 9 - Coverage (Phase 1 option a) - the proposal formerly numbered
            8, unchanged in substance. PROPOSED, NOT APPROVED. See section 32.
```

### The previous phase, preserved (Phase 7)

```
PHASE:      7 - End-to-end card exit replay (READ ONLY)
STATUS:     COMPLETE (2026-09-13)
OBJECTIVE:  Does ml/substitution's player-specific displacement advantage
            survive when the outgoing card must be PREDICTED?

METHOD:     Phase 6's exact population (4,234 held-out one-card edits, 337
            players, committed 70% split, boundary 20260810T161008.000Z), with
            E4Combined's recency inputs joined exactly from phase4-edits.
            Gate, systems, compositions, buckets and player floor
            PRE-REGISTERED before any test number. Exit predicted by the
            existing E4Combined (train-fitted; production's unfitted variant
            also run). HARD composition (= production) for the gate; PROB,
            TOPK3 and train-calibrated PROB as secondaries. Production-semantics
            replay over 138,978 real steps with production's own adapter.

RESULT:     REJECT.

            THE README §32 GATE FAILS:
              B1 player frequency (exit-independent)      31.77%
              B4 ml/substitution, oracle exit             44.21%
              B4 o E4Combined, predicted exit (HARD)      32.29%
              B4 o E4 - B1   -0.06 [-1.67, +1.47]  ns at 5/5 origins,
              with E0 (-0.33), production-faithful (+0.61), PROB (-0.12).

            ORACLE TAX 11.93 pts (paired 10.08 [8.34, 12.00]); e2e/oracle
            73.0%; 4.2% OF THE ADVANTAGE SURVIVES.

            MECHANISM: exit top-1 43.20%. Exit right: +4.94 over B1.
            Exit wrong (56.8%): 4.28% vs 9.56%, -6.84. The player layer
            (Phase 6 "necessary", -6.95) is worth +0.21 [-1.15, +1.61]
            end-to-end.

            NO DEPLOYABLE SPECIALIST: every bucket of support-of-the-PREDICTED
            exit is ns (>=3: -1.07 [-6.01, +3.72]). Only oracle-defined
            buckets win, and they need the card that has not left yet.

            PROBABILITY COMPOSITION does not reduce the tax: PROB -0.06 ns,
            TOPK3 -1.59, PROB-cal -1.54. The canonical exit probability is a
            CONSTANT 0.401.

            EXIT RANKER = ROTATION-SLOT DETECTOR: 55.88% top-1 when the true
            exit had entered the shell by an edit, 5.70% otherwise; 55.5% of
            exited cards come back. Never read an exit as rejection.

            PRODUCTION (138,978 real steps): one-card edits 1.46%; production's
            alternatives exact 0.54% of steps; the displacement layer adds
            +0.017 pts [+0.008, +0.026]. Materiality floor (MIN_RESCUE) 3%.

            DISCLOSED: at DECK level the gate would pass (+2.60 [+1.26, +4.00])
            - still +0.017 pts of steps. Pre-registration governs.

            LEAKAGE PASS: truth-masked re-ranking, 0 differences.
            Full artifact: DECKKIES_BRAIN_PHASE7_END_TO_END_EXIT_REPLAY.md

NEXT PHASE: 8 - Coverage (Phase 1 option a), per the README §32 gate.
            PROPOSED, NOT APPROVED. See section 32.
```

### The previous phase, preserved (Phase 6)

> **One line of the block below is SUPERSEDED by Phase 7:** *"end-to-end is
> plausibly ~22%"* — measured **32.29%**. The estimate multiplied marginal
> rates; entry accuracy concentrates where the exit is right (69.11%). Its
> conclusion (no end-to-end win) was right. Also, *"the PLAYER layer
> NECESSARY"* holds under the exit oracle only (A21 qualification).

```
PHASE:      6 - Chronological out-of-sample displacement replay
            (READ ONLY)
STATUS:     COMPLETE (2026-09-12)
OBJECTIVE:  Does the Phase 5 player-specific displacement signal survive a
            genuinely chronological, leakage-free holdout?

RESULT:     CONDITIONAL.

            PRIMARY COMPARISON FAILED AS POSED. Isolated per-player
            displacement B3 37.41% vs player-frequency B1 31.77%:
            +1.20 pts [-1.52, +3.94], NOT SIGNIFICANT - and ns at all five
            chronological cut points (50/60/70/80/90%).

            IT FAILS BY ABSTENTION, NOT BY ABSENCE OF SIGNAL. B3 has no
            evidence on 45.09% of test events and loses 14.00 pts there
            [-17.26, -10.78]. Where it HAS evidence it wins:
              >=1 prior obs (54.75% of events)  +12.08 [ +8.40, +15.89]
              >=3 prior obs (26.57%)            +18.65 [+12.54, +25.29]
              >=10 prior obs (10.01%)           +24.86 [+12.11, +37.58]
            Monotone in support - what a real relationship looks like.

            ml/substitution ALREADY IMPLEMENTS THE BACKOFF AND WINS:
              B4 44.21% (macro 46.21%)  vs B1 +10.02 [+7.94, +12.21]
              ablation: remove the PLAYER layer -6.95 [-8.85, -5.21] NECESSARY
                        remove the GLOBAL layer -0.85 [-1.61, +0.09] redundant
            CEILING 61.38% (truth in the candidate pool at all); B4 reaches
            72.0% of it.

            THE MODELS ARE A CARD-ROTATION MEMORY: 61.81% of held-out edits
            bring back a previously dropped card; B4 scores 59.95% on those
            against 18.74% on a fresh card.

            THE PHASE 5 SHOWCASE DOES NOT SURVIVE: ronin -> mighty-miner has
            ZERO held-out events, and its 1.4% population figure was a
            leave-one-out denominator the subject dominates (true rate
            15.84%; that player supplies 50 of 54 occurrences).

            WALK-FORWARD buys nothing (-0.09 [-0.38, +0.13]).
            TEMPORAL STABILITY flat across three slices - but only 10 days.
            LEAKAGE PASS on eight probes; the documented cluster-selection
            effect moves pool recall by -0.07 pts.

            FRAMING: this task is 1.8-2.3% of production steps and the exit
            is an ORACLE (best exit ranker 50.0%/49.3%), so end-to-end is
            plausibly ~22%.
            Full artifact:
            DECKKIES_BRAIN_PHASE6_CHRONOLOGICAL_DISPLACEMENT_REPLAY.md

NEXT PHASE: 7 - End-to-end cost of the exit oracle.
            PROPOSED, NOT APPROVED.
```

### The previous phase, preserved (Phase 5)

```
PHASE:      5 - Card adoption & displacement intelligence census
            (READ ONLY)
STATUS:     COMPLETE (2026-09-12)
OBJECTIVE:  Measure whether the real edit-event substrate (ml/dataset over
            `battles`) can support Brain card intelligence.

RESULT:     PROCEED WITH CONDITIONS.
            THE FIRST BRAIN PHASE WHOSE HYPOTHESIS SURVIVED.

            29,503 edit events confirmed exactly, 389 players, 50.8% of them
            single-card and therefore unambiguous.
            112 global out->in displacement pairs survive FDR + lift>=1.5;
              permutation null 0-2. No pair below lift 1.0.
            777 per-player patterns across 255 of 292 players; null 0.0.
            Rising cards displace ROLE-COHERENT targets with NO hand-authored
              card metadata: void->fireball, goblin-hut->tesla,
              berserker->knight.
            Conditioning adds 246/81/7 cells marginally and 0/6/2
              incrementally given (player, card-out) - which is the mechanism
              behind OIE Phase 3's S3/S4/S5 failures.
            P(edit|loss) 12.98% vs P(edit|win) 5.77%, ratio 2.25, player-macro
              +7.12 pts [+6.07,+8.20] - real, and ALREADY used by M2.
            Stability predicts which card leaves at 3.5x chance (44.0% top-1).
            73.9% of dropped cards are later RE-ADOPTED.

            STRUCTURAL: an edit is capped at TWO cards by the 6-card
            clustering rule. "Full deck change" = 0 BY CONSTRUCTION, verified
            on all 337,651 steps. Genuine rebuilds are invisible here.

            NOT TESTED: anything out-of-sample, and new-card detection (no
            release falls inside the window; data ends 2026-08-19, Minion
            Giant shipped 2026-09-07).
            Full artifact: DECKKIES_BRAIN_PHASE5_CARD_ADOPTION.md

NEXT PHASE: 6 - Chronological replay of displacement intelligence.
            PROPOSED, NOT APPROVED.
```

### The previous phase, preserved (Phase 4)

```
PHASE:      4 - kg_edges.APPEARS_AFTER full audit / card intelligence
            (READ ONLY)
STATUS:     COMPLETE (2026-09-12)
OBJECTIVE:  Determine whether the 493,696 APPEARS_AFTER observations are a
            valid foundation for Brain card intelligence.

RESULT:     STOP on APPEARS_AFTER.
            PROCEED WITH CONDITIONS on card-transition intelligence, from
            ml/dataset edit events over `battles`.

            It is not a transition relation. The write is a full 8x8
            Cartesian product (knowledge_graph.py:201-206) and the two decks
            are CARD-DISJOINT BY CONSTRUCTION, because duel_split.split
            closes a series on any shared card. So a -> a is impossible and
            a one-card swap ENDS the series and is discarded - the corpus is
            the exact complement of a substitution sample.
            493,696 / 64 = 7,714 exactly; 339,220 / 28 = 12,115 exactly.
            Real corpus: 60 players / 4,401 series / 12,115 games / 7,714
            events. Nothing reads it: 2 source refs in the whole bot tree.
            wins/trials are 0 on every edge, so it can never be conditioned
            on a result; count_30d/60d are count-or-zero, so it has no trend
            axis; refresh watermarks on BATTLE TIME, violating A10.
            Full artifact: DECKKIES_BRAIN_PHASE4_CARD_INTELLIGENCE.md

NEXT PHASE: 5 - Card adoption and displacement intelligence, from `battles`.
            PROPOSED, NOT APPROVED. Do not begin without explicit approval.
```

### The phase before that, preserved (Phase 3)

```
PHASE:      3 - 90-day shadow replay and outcome-matching feasibility
            (READ ONLY)
STATUS:     COMPLETE (2026-09-12)
OBJECTIVE:  Determine whether the existing prediction-memory loop could ever
            fill, and why the infrastructure was built but never activated.

RESULT:     STOP.
            Match rate 6.60% realistic / 20.80% optimistic. The gate
            (MIN_MATCHED_OUTCOMES = 200) needs ~3,030 recommendations.
            Total recorded !suggestion traffic: 4 events, 1 user.
            Event volume is IMPOSSIBLE to reconstruct - command traffic is
            logged nowhere.
            The match window is irrelevant: +1.21 points from 30 min to 24 h,
            because 92.65% of pairs meet exactly once. Ambiguity refuses
            68.26% of otherwise-matchable battles, so widening makes it worse.
            WHY IT WAS LEFT DARK IS DOCUMENTED (commit e87b9dc): the
            recommender gave 99.7% of users the same deck.
            Full artifact: DECKKIES_BRAIN_PHASE3_SHADOW_REPLAY.md

NEXT PHASE: NONE. The programme is at a decision point that is not technical.
```

### The seven outcomes, cumulative (heading was "six" until Phase 7)

| phase | question | verdict |
|---|---|---|
| 7 | does the displacement advantage survive a PREDICTED exit? | **NO (REJECT)** - −0.06 [−1.67, +1.47] vs player frequency; 4.2% of the advantage survives; +0.017 pts of real production steps. Displacement workstream STOPS |
| 8 | what does `timestamp="9999"` cost? | **CONDITIONAL** - 0.073 competitive ROC-AUC at the battle-time stamp (0.858 → 0.932); nothing at a strictly historical stamp; out of range at request time. Not a one-line fix. **Session 2: reproduced exactly; "out of range at request time" SUPERSEDED - on the steps each request is about the request stamp beats 9999 (Brier −0.160 at 36 h, AUC +0.049 random clock). Fix eligible for review after Phase 8b** |
| 8b | does the request stamp still win in PRODUCTION ORDER with real ingest lag? | **PASS (8/8)** - arrival-visible random clock: Brier −0.0963 [−0.1103, −0.0828], AUC 0.619 → 0.673; ordering on 3 bands; primary deck unchanged; alternative hits 1.85% → 1.06%. Eligible for controlled fix implementation review |
| 8c | is the alternative regression a real loss or a calibration consequence? | **CONDITIONAL** - both: removed alternatives are 98% wrong yet 2.6x as precise as those kept; the cap policy (2/1/0) runs against alternative precision (0.37/2.90/3.61%); 0.78 pts < 3% floor. Timestamp fix not blocked; caps review separate |
| 10 | can the timestamp fix be approved for implementation, and on what contract? | **CONDITIONAL - approvable** - 8b and 8c recomputed exactly from recorded per-read data; code unchanged; stamp touches only band, count, labels, note; minimal dark contract fixed (UTC helper, version bump, tests incl. stamp pinning, offline equivalence). Open: explicit acceptance of the regression |
| 11 | implement it locally and validate completely | **PASS** - regression accepted; implemented per Phase 10; offline equivalence 357,426 reads / 128,816 condition-B records, 0 mismatches; 767 + 69 tests pass, only the pre-existing `test_ml_21a` failure. Not committed, not deployed |
| 1 | can native duel history close the coverage gap? | **NO** - ceiling 19.25 pts vs a 20-pt gate |
| 2 | has the Brain already been built? | **YES** - 9 modules, 280 tests, dark behind one flag |
| 3 | can that loop ever fill? | **NO** - 6.6% match rate, ~3,030 events needed, 1 user |
| 4 | is `APPEARS_AFTER` card-transition evidence? | **NO** - a Cartesian product over card-disjoint decks; 7,714 real events x 64; 0 readers |
| 5 | can the Brain learn card displacement from real edit events? | **YES** - 112 global pairs and 777 player patterns, both against an empty null. First surviving hypothesis |
| 6 | does that signal PREDICT out-of-sample? | **CONDITIONAL** - not alone (ns at 5/5 origins), decisively with backoff (+18.65 at support >=3). `ml/substitution` +10.02 over baseline |

### What remains open after three phases

| item | state |
|---|---|
| Pool construction on the frozen engine (Phase 1 option a) | **OPEN, unapproved** - the largest measured effect in the programme |
| Card intelligence (Phase 1 option b) | **OPEN, unapproved** - no population dependency |
| `kg_edges.APPEARS_AFTER` (493,696 card transitions) | **CLOSED by Brain Phase 4** — not transitions. An 8x8 Cartesian product over card-DISJOINT decks: 7,714 real events x 64, 60 players, 0 readers |
| Calibration as a concept | **OPEN** - only this route to it is closed |
| The `timestamp="9999"` bug | ~~**OPEN** since Phase 0, still cheap~~ **MEASURED by Brain Phase 8** — CONDITIONAL; do not fix in isolation (KNOWN BUGS #1, #12; A24). **Session 2: fix with stamp = request time (UTC) is ELIGIBLE for controlled review; gated on Phase 8b** (KNOWN BUGS #13, #14). **Phase 8b: gate PASS → eligible for controlled fix IMPLEMENTATION review; decision owed on the alternatives regression (#17)**. **Phase 10: the review ran — CONDITIONAL, approvable; contract fixed; open only on explicit acceptance of the regression**. **Phase 11: accepted and IMPLEMENTED LOCALLY, PASS**. **Phase 12: COMMITTED locally (not pushed) and the evidence preserved; still NOT deployed — the next approval is Phase 13, a dark deploy with `CLASH_OIE=off`** |
| Bot poll cadence ~4 h, battlelog cap 30, arrival data lost at restart (KNOWN BUGS #15, #16, #18) | **OPEN**, bot repository, found Phase 8b |
| `ALTERNATIVE_CAPS` ordered against alternative usefulness; HIGH label unreachable; UI subtitle overstates history (KNOWN BUGS #17, #19, #20) | **OPEN**, a separate caps/product review is warranted (Phase 8c) |
| Calendar-dependent steady-player test under a wall-clock stamp; version pins that cannot fail; version-blind shadow drift with practice unevaluated; stale 92.1%/47.3% panel comment; discarded `_primary_band` (KNOWN BUGS #24–#28) | **OPEN**, found Phase 10. #24 and #25 are obligations of the timestamp-fix implementation; #26–#28 are separate |
| `is_duel` = 0 on practice reads (KNOWN BUGS #11) | **OPEN, negligible as measured**, engine dark |
| Card displacement as a PREDICTIVE Brain component | **CLOSED by Brain Phase 7** — fails the README §32 gate end-to-end; the Phase 5 census survives only as a descriptive record |
| Production's unfitted exit/entry stats (KNOWN BUGS #6) | **OPEN, harmless as measured**, engine dark |

---

## 32. NEXT EXACT TASK

> ### ⚠ UPDATED BY PHASE 13A (2026-09-17) — read this first
>
> **A 2v2 storage phase ran and is BLOCKED. Nothing was implemented and nothing was
> deleted.** The request was: keep the top 50 most-used 2v2 decks for each of six win
> conditions, ≤ 300 records, delete the rest, keep it updating.
>
> **Three preconditions are false**, each verified in source rather than assumed:
> there is no six-way win-condition taxonomy (23 cards / 17 archetypes / 6 editorial
> play styles); there is no 2v2 data on this machine (it is all on the VPS); and the
> 2v2 store holds teammate PAIRS, not decks, by the decision that deleted
> `duo_decks.py`. Full reasoning: `DECKKIES_BRAIN_PHASE13A_2V2_TOP50_STORAGE.md`.
>
> **Exact next task — a decision, not engineering.** Nothing can be built until the
> account holder answers: (1) which taxonomy the "six" means — recommended is the
> canonical 17 archetypes with a per-bucket cap, since 17 × 20 ≈ 340 records lands near
> 300 without inventing or redefining anything; (2) whether the retained unit is the
> existing PAIR or a new per-deck record; (3) whether `duo_pairs` is the right target,
> given it is ~1 GB of the ~78 GB 2v2 occupies — `battle_raw` (44.7 GB) and `duo_stage`
> (~1.89M rows, unbounded, never pruned) are both larger and safer.
>
> **Once decided**, the implementation is small: a bounded heavy-hitters counter hooked
> into `observe()`/`_fold()`, a new bounded table inside `.duo_pairs.db`, the ten
> behavioural tests plus the 6 × 50 boundary, and a rebuild-verify-then-delete sequence
> that must run **on the VPS**, which is its own approval.
>
> **The timestamp fix is untouched by all of this.** Phase 13 — its dark deployment —
> is still the pending engineering approval, described immediately below.

> ### ⚠ UPDATED BY PHASE 12 (2026-09-15) — read this first
>
> **The timestamp fix is COMMITTED (one local commit on `main`, parent `c4fc65e`, NOT pushed) and the
> Phase 8b/8c evidence is preserved in the gitignored `brain-evidence/phase8/`.** The repository and
> the running service now disagree on purpose: **the VPS still executes `timestamp="9999"`, and
> `CLASH_OIE` is still `off`.** Nothing about production changed in Phase 12.
>
> **Exact next task — engineering, NEEDS ITS OWN APPROVAL: Phase 13, a controlled DARK deployment**
> (Phase 10 S2), `CLASH_OIE` staying `off` throughout:
>
> 1. Back up what is overwritten on the VPS (`*.bak-<date>-prestamp`).
> 2. Compare the deployed copies against `git show HEAD:` **after normalising CRLF** — the VPS files
>    were `scp`'d from this Windows tree and a raw md5 reports drift on identical files.
> 3. `scp` `predictor.py` and `shadow.py` only; clear `__pycache__`; `systemctl restart royalweb`.
> 4. Confirm `/api/analytics/status` still reports `artifactLoaded: true` and `CLASH_OIE=off`.
>
> **Dark means dark**: with the flag `off` the engine is not called, so the deploy changes no user-
> visible behaviour and writes nothing to the shadow log. **`CLASH_OIE=shadow` (Phase 10 S3–S7, fresh
> log, the S4 parse-failure signature, ≥ 100 players before any checkpoint conclusion) is a SEPARATE
> later approval, and `CLASH_OIE=on` is a separate decision again** (deadlock 2).
>
> **Not part of Phase 13:** candidate pools, caps, labels, UI copy, recalibration, retraining, Brain
> persistence, the shadow tooling defects (#26), `test_ml_21a` (#2). **Research: none.** The caps
> review and the Phase 9 backoff remain PROPOSED, NOT APPROVED.

> ### ⚠ UPDATED BY PHASE 11 (2026-09-15) — read this first
>
> **The timestamp fix is implemented in the local working tree and validated: PASS.** It is **not
> committed and not deployed**; the VPS still runs `timestamp="9999"`. Five files differ from
> `c4fc65e`: `predictor.py`, `shadow.py`, `phase22-final-spec.md`, `test_ml_production.py`,
> `test_ml_22_final.py`. See `DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md`.
>
> **Exact next tasks — engineering, EACH NEEDS ITS OWN APPROVAL, in this order:**
>
> 1. **Commit** the five changes, updating the repository docs (`README.md`, `server/README.md`,
>    `CLAUDE.md`) in the same commit. Re-run the 27 suites first; expect 767 + 69 passing and only
>    `test_ml_21a` failing.
> 2. **Preserve the Phase 8b/8c evidence** (Phase 10 S0) to a durable gitignored location. It is the
>    only copy, holds real tags, and the offline equivalence cannot be re-run without it.
> 3. **Dark deploy** (Phase 10 S2): VPS backups `*.bak-<date>-prestamp`, CRLF-normalised compare
>    with `git show HEAD:`, `scp` predictor.py + shadow.py, clear `__pycache__`, restart `royalweb`,
>    `/api/analytics/status` `artifactLoaded: true`, `CLASH_OIE` stays `off`.
> 4. **`CLASH_OIE=shadow`** on a fresh log (Phase 10 S3–S7), with the S4 parse-failure signature and
>    ≥ 100 players before any checkpoint conclusion.
>
> `CLASH_OIE=on` is not on this list (deadlock 2). **Research: none.** The caps review and the
> Phase 9 backoff remain PROPOSED, NOT APPROVED.

> ### ⚠ UPDATED BY PHASE 10 (2026-09-15) — read this first
>
> **The timestamp fix implementation review has run: CONDITIONAL — approvable.** Phase 8b's gate
> (PASS 8/8) and Phase 8c's rule (CONDITIONAL) were recomputed exactly from their recorded per-read
> data; the engine code is unchanged since 2026-08-23; the stamp can change only the band, the
> alternative count, the alternative labels and the note.
>
> **Exact next task — engineering, NEEDS APPROVAL: Phase 11, a controlled dark implementation**,
> following `DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md` §10–§13 and §20, in order:
>
> 1. **The account holder explicitly accepts the alternative regression** (hits 1.85% → 1.06%,
>    −0.91 pts [−1.41, −0.51]; coverage 62.98% → 62.20%). Nothing proceeds without it.
> 2. Preserve the Phase 8b/8c scratch evidence to a durable **gitignored** location (real tags;
>    public repo; the only copy).
> 3. `predictor.py`: a UTC `_request_stamp()` helper; line 104 `timestamp=cutoff_ts or
>    _request_stamp()`; line 106 untouched. `shadow.VERSIONS["features"] =
>    "phase2-21-reqstamp-utc"`. Spec §2.2/§6 rows and a §7 note.
> 4. Tests T1–T7; tighten `test_ml_22_final.py` version pins (KNOWN BUGS #25); **pin the stamp in
>    every predictor test** — `test_change_probability_is_not_pegged_for_a_steady_player` fails from
>    2026-09-27T18:51:45Z otherwise (#24). Run all ML suites (`test_ml_21a` keeps its pre-existing
>    failure).
> 5. Offline equivalence: the implemented predictor must reproduce recorded `pB` on 357,426 reads and
>    condition B's band/note/list/count on 128,816.
> 6. Commit, deploy dark and `CLASH_OIE=shadow` are each **separate** instructions. `CLASH_OIE=on` is
>    not part of Phase 11.
>
> **Not part of it:** candidate pools, vocabulary memory, displacement, retraining, recalibration,
> `ALTERNATIVE_CAPS` / labels, UI copy, Brain persistence, the shadow tooling defects (#26).
>
> **Research: none required.** The caps review and the Phase 9 backoff remain PROPOSED, NOT APPROVED;
> if the caps review runs, run it after the stamp fix lands.

> ### ⚠ UPDATED BY PHASE 9 (2026-09-14) — read this first
>
> **Phase 9 (coverage) ran, on explicit request, and is CONDITIONAL.** The gate declared below passed on
> Phase 1's harness under both readings (U1 +1.39, U2 +0.36; ranker beats random at pools ≥ 5) and failed
> the arrival-visibility conditions added before the run (S-ARR U2 −0.48, S-EXACT U2 −1.56). **No
> candidate pool is to be changed.** The proposal below is preserved as the record of what was run.
>
> **No research task is required by the result.** Coverage at request time is bounded by ingest latency
> (a duel series arrives a median 22 h late in Phase 1's window), and the union of vocabularies dilutes the
> frozen rankers. If coverage is reopened, the only open construction is **duel history first, the full
> vocabulary only where duel history has no legal deck** — pre-registered, arrival-primary, with a
> materiality floor, and stating up front that its post-hoc estimate is +0.36 pts at S-ARR (A26).
>
> **Unchanged:** the timestamp fix remains an engineering decision on the account holder's acceptance of
> the alternative regression (Phase 8c). The `ALTERNATIVE_CAPS` review remains separate.

> ### ⚠ UPDATED BY PHASE 8c (2026-09-14) — read this first
>
> **The alternatives question is answered: CONDITIONAL, not blocking.** The
> timestamp fix is **cleared for controlled implementation**, on one explicit
> decision by the account holder: **accept the alternative regression** (hits
> 1.85% → 1.06%, coverage 62.98% → 62.20%, 0.78 pts below the 3% materiality
> floor). The specification is unchanged from the Phase 8b artifact §25; Phase 8c
> §21 adds an alternative identity/order invariance test.
>
> **Not part of that change, and warranted separately:** a product/threshold
> review of `ALTERNATIVE_CAPS`. The caps (2/1/0) run against alternative
> usefulness (0.37/2.90/3.61% precision by corrected band). The HIGH alternative
> label is unreachable (KNOWN BUGS #19), and the UI subtitle overstates history
> (#20). Any such review needs its own pre-registered gate. Preserving today's
> count with the fix (Option B) violates rule 4 on 13.2% of reads and is
> unvalidated.
>
> **Exact next research task: Phase 9 (coverage)**, unchanged below. **PROPOSED,
> NOT APPROVED**, and independent of both.

> ### ⚠ UPDATED BY PHASE 8b (2026-09-14) — read this first
>
> **Phase 8b ran and PASSED its gate** (below, preserved as proposed). The timestamp
> fix is no longer a research question. It is an **implementation-review decision
> for the account holder**, specified in the Phase 8b artifact §25:
>
> * `predictor.py:104` → `cutoff_ts or <request wall clock, UTC>`; a new
>   `shadow.VERSIONS["features"]`; a test that the stamp parses and is UTC; a
>   primary-invariance test; spec §7 amended (this is neither retraining nor
>   recalibration); `CLASH_OIE` stays `off`; shadow first; a 19D-style
>   reconciliation on corrected outputs.
> * **Decision owed:** accept the alternatives regression (1.85% → 1.06% hits,
>   KNOWN BUGS #17), or revisit `ALTERNATIVE_CAPS` as a separate policy change.
>
> **Exact next research task: Phase 9 (coverage)**, unchanged below and still
> **PROPOSED, NOT APPROVED**. It is independent of the timestamp fix. If both are
> ever *implemented*, land the stamp fix first, so Phase 9's production translation
> is measured under the cap regime that will ship.

**CARRIED FORWARD BY PHASE 8, UNCHANGED IN SUBSTANCE, AWAITING EXPLICIT APPROVAL.**
Phase 8 was spent on the `timestamp="9999"` audit instead (the "cheap
alternative" named at the foot of this proposal), so the coverage phase is
renumbered **9**. Nothing Phase 8 found changes it: coverage does not consume
P(change). One rule to add from Phase 8: if the evaluation ever uses M2's
output, state the timestamp it was computed with (A24).

**Also available, not recommended:** a VPS-backed production-semantics
(`next-play`) replay of M2 under `9999` vs the battle-time stamp, which would
replace §13.2's feature-only frame check with a model score. It cannot answer
the question that matters — what a request-time stamp does — because no outcome
is defined at an arbitrary request time. Worth running only if a `CLASH_OIE`
rollout decision is being made.

> **⚠ SUPERSEDED BY PHASE 8 SESSION 2 (2026-09-14).** It *can* answer that
> question: an outcome exists at a request time on the steps that request is
> about. It is now the named precondition for any stamp fix:
>
> ### Phase 8b (proposed) — production-frame re-validation of a request-time stamp
>
> Read-only, on the VPS, `mode=ro`, outside the bot's poll. **One question:** in
> production's own frame (`next-play`, shell = the most recent play's cluster,
> per-play results from `battles`), does M2 with stamp = the request time beat
> `9999`?
>
> **Method.** Replay the production stack with `cutoff_ts` = a sampled request
> time R, **never the predicted battle's time** (KNOWN BUGS #14). R is sampled
> under survival conditioning, with the same three families as session 2:
> after the last play, before the battle, random clock. Plays count as visible
> only if `stored_at ≤ R`, which measures ingest lag rather than assuming it.
> Score bands with the frozen cuts.
>
> **GATE, DECLARED NOW:** competitive macro Brier CI < 0 vs `9999` under the
> random-clock model **and** band ordering holds **and** `high`-band Recent
> accuracy at the request stamp is ≥ `9999`'s on the same reads. Practice is
> reported, not gated (no band shown; its short gaps rank backwards).
>
> **Does not block Phase 9.** Run it before any fix or `CLASH_OIE` rollout.

> ### Phase 9 (proposed as Phase 8 by Phase 7) — Coverage: the full-vocabulary candidate pool, end-to-end
>
> Read-only. **The README §32 gate fired, so attention returns to coverage
> (Phase 1 option a)** — the largest measured effect in the programme, and the
> one Phase 7's lesson applies to most directly: Phase 1 measured a **coverage**
> number (zero-pool 76.59% → 47.65% with the player's full `battles` deck
> vocabulary), and a coverage number is not an accuracy number.
>
> **One question, gate declared first, metric, composition and unit named
> (README KNOWN BUGS #10):** on Phase 1's duel test steps, with the per-step
> cutoff mechanism held constant (A15), does building the legal candidate pool
> from the player's full known deck vocabulary raise **top-1 next-deck
> accuracy over ALL test steps** (zero-pool steps scored as misses) above the
> duel-history pool, paired on players — **and** does the existing ranker beat
> **random-in-legal-pool** on the larger pools, where Phase 21A measured it going
> negative at pool ≥ 5?
>
> **GATE, DECLARED NOW:** both paired CIs must exclude zero in the positive
> direction. A coverage gain whose ranker loses to random-in-pool is a FAIL,
> because it would hand the ranker exactly the pools it cannot rank.
>
> **Why this and not another displacement variant.** Phase 7 closed the
> displacement memory as a predictor (FAILED APPROACHES #19). Coverage is the
> branch the README gate names; it touches the frozen engine's candidate
> generation, so even the read-only evaluation needs **explicit approval**, and
> it needs **read-only VPS access** (`battle_raw` duel payloads + `battles`),
> which was available in Phase 1 and blocked in Phase 4.
>
> **Carry Phase 7's rules:** label anything that hands the model an input
> production must infer as oracle-conditioned (A23); count any production
> contribution on the same steps, never by multiplying rates; report the
> subset definitions production could actually use.
>
> **Cheap alternative, still open since Phase 0:** fix-and-measure the
> `timestamp="9999"` bug (KNOWN BUGS #1) — no VPS needed.

**Superseded, kept as the record of what Phase 6 proposed (Phase 7 ran it):**

> ### Phase 7 — End-to-end cost of the exit oracle
>
> Read-only. **One question, gate declared first:**
>
> **When the outgoing card must be PREDICTED rather than given, how much of
> `ml/substitution`'s +10.02-point advantage survives?**
>
> Every Phase 6 figure assumes the exit is known, because the brief defined the
> task that way. `ml/substitution`'s own docstring calls that rung *"an oracle
> on the exit"*; Phase 3 measured the best exit ranker at **50.0% / 49.3%**
> top-1 and Phase 13 failed to beat it. So the honest end-to-end figure is
> plausibly near **22%** — and nobody has measured it.
>
> **Why this next.** It is the difference between "this layer is worth
> promoting" and "this layer is worth promoting into a pipeline that cannot
> feed it". It needs no new data, no live database and no new code: the exit
> ranker (`S.ExitRanker`, `ml/exit_model.py`) and the substitution ladder both
> exist and both were evaluated in Phase 6. Cheapest remaining question that
> can change the recommendation.
>
> **GATE, DECLARED NOW:** if end-to-end top-1 with a predicted exit does not
> beat the player-frequency baseline *also* run end-to-end, the displacement
> workstream STOPS and the Brain's attention returns to coverage (Phase 1
> option a), which remains the largest measured effect in the programme.
>
> **Six conditions carry over from Phase 6 §27.2** for any eventual
> promotion: backoff mandatory; support gating mandatory; quote the reachable
> ceiling; state the step definition and its production share; no confidence
> band until one is measured; re-measure across a release and a patch.

**Superseded, kept as the record of what Phase 5 proposed:**

> ### Phase 6 — Chronological replay of displacement intelligence
>
> Read-only. **One question, with the stop-gate declared before the run:**
>
> **Does per-player out→in displacement evidence, fitted on TRAIN ONLY, beat
> rung S1 (player card frequency) at predicting the incoming card on a
> chronologically held-out test set?**
>
> Everything Phase 5 measured is **in-sample**. 112 global pairs and 777
> player-specific patterns are descriptive statistics with multiple-testing
> control and empty permutation nulls — they are not evidence of predictive
> usefulness, and nobody has tested whether they hold forward in time.
>
> **Method.** The OIE's own split shape (train 2026-06-13…2026-08-10, test
> 2026-08-10…2026-08-19), `ml/substitution`'s existing ladder, backoff and
> candidate pool, paired bootstrap over players, player-macro reported
> alongside pooled. It reuses the harness that produced OIE Phase 3 and builds
> nothing new. The cached dumps needed are already on this machine.
>
> **Why this and not the adoption half.** Adoption needs a live database and a
> window straddling the Minion Giant release (2026-09-07), which the cached
> data does not have. The replay needs nothing new, answers the question that
> gates everything else, and can be run in an afternoon. **If it fails, the
> adoption work is not worth commissioning.**
>
> **Five conditions carry over from Phase 5 §24.2** and must be answered in
> writing first: out-of-sample before anything else; say what differs from
> Phases 10/12/13; reopen nothing; report marginal AND incremental together;
> run a permutation null on every claim.

**Superseded, kept as the record of what Phase 4 proposed:**

> ### Phase 5 — Card adoption and displacement intelligence, from `battles`
>
> A read-only census, in two halves, neither of which touches a closed branch.
>
> **(a) Adoption.** First appearance, daily adoption curve, early adopters,
> deck and archetype associations for every card — with **Minion Giant as the
> live worked case**, since it shipped 2026-09-07 and reached 114,623 rows in
> `battles.player_card_keys` within days while `cardRoles.json` is still one
> card behind. Nothing anywhere in either codebase tracks a card's arrival.
>
> **(b) Displacement.** Per-player and global out→in transition counts from
> `ml/dataset` edit events, support floor 3 (justified by Phase 13's
> 18.4% → 36.6% cliff between 2 and 3 edits), Wilson intervals, chronological
> split. **The first deliverable is a COUNT, not a model:** how many players
> support a per-player out→in statement at all. If that number is small, the
> phase ends there.
>
> **Five conditions, all of which must be answered in writing first** — say
> what differs from Phases 10/12/13, reopen no closed branch (S3, S4, S5,
> counter-sniping, 20A), census before model, reuse the existing statistical
> floors, and split chronologically with player-macro reported. Section 23.3 of
> the Phase 4 artifact states them in full.
>
> It is the only **HIGH POTENTIAL** row in the Phase 4 prediction table, and it
> has a dated, documented failure proving what not having it costs.

**And the non-technical action from Phase 3 still stands, unanswered:**

> ### Ask the author why the work stopped on 2026-08-03.
>
> The repository documents every step up to *"randomised assignment is the only
> valid path left"* (commit `10a0121`) and then goes silent. Forty-five commits
> in five days, four of them negative findings announced in the subject line,
> and then nothing for six weeks.
>
> **That final decision is the only part of this history that is inference
> rather than record.** Phase 3 established what was known at the time: the
> recommender had a diagnosed single-deck defect, offline evaluation was proven
> inapplicable, and the only valid path required exposing real users to a
> known-defective arm. What is NOT recorded is whether the decision was
> "not worth it", "not yet", or simply attention moving to PDF reports on
> 2026-08-05.
>
> **Why this matters more than any measurement.** If the answer is "we ran out
> of time", three phases of closure may be premature. If it is "we decided the
> product does not have the traffic to support it", the Brain programme has its
> answer and should redirect. No script can distinguish those.

### The other live options

Both predate Phase 3, are unaffected by it, and remain unapproved:

- **(a) Pool construction on the frozen engine.** Phase 1 measured zero-pool
  76.59% -> 47.65% by building the candidate pool from a player's full known
  deck vocabulary. Largest measured effect in the programme. Touches a frozen
  component, so it needs explicit approval.
  > **⚠ RUN AS PHASE 9 (2026-09-14): CONDITIONAL.** Ranked end to end it passed the event-time gate by
  > +0.36 pts (U2) and lost at arrival visibility (−0.48 / −1.56). "Largest measured effect" was a
  > coverage effect; it is not an accuracy effect at request time.
- **(b) Card intelligence.** No population dependency, no closed branch behind
  it. **Brain Phase 4 removed the head start Phase 2 thought it had:**
  `kg_edges.APPEARS_AFTER` is NOT card transitions (failed approach 17), so
  this option starts from `ml/dataset` edit events over `battles` — which is
  where the OIE's own Phase 3 measured the signal in the first place.

### Explicitly NOT the next step

- **Turning on `CLASH_W3_MODE`.** The single-deck defect is diagnosed and
  unfixed; switching it on would expose users to it.
- **Widening `MATCH_WINDOW_MINUTES`.** Measured to make matching worse (A20).
- **Lowering `MIN_MATCHED_OUTCOMES`.** It is the floor of the easier of two
  gates; the experiment framework needs 100 matched outcomes *per arm*.
- **Building any Brain table.** A17 stands.
- **Consuming, refreshing or mining `kg_edges.APPEARS_AFTER`.** Closed by Phase
  4; the defect is in the write, not the volume (failed approach 17).
- **Scheduling `knowledge_graph.refresh()` as it stands.** It watermarks on
  battle time, violating A10, so it would silently skip late-arriving series. **Phase 5 found the precedent: the same defect class already
  cost this project 172,414 battles (8% of history), measured 2026-07-29 and
  recorded in `archive.py`'s own comments. The mechanism is
  `ingest_opponent_snapshots()` back-filling an opponent's whole log below the
  watermark. `archive.py` was fixed by cursoring on `battles.id`;
  `knowledge_graph` never was.**
- **Conditioning card substitution on archetype, matchup or previous result.**
  Closed twice: OIE Phase 3 rungs S3/S4/S5 measured it as harmful, and Brain
  Phase 5 measured why — 0, 6 and 2 incremental cells once the player and the
  outgoing card are known.
- **Reading a usage trend off share-of-plays over a growing population.**
  Produces a confident, wholly false table (failed approach 18a). Needs a fixed
  cohort and per-player pairing.
- **Using `knowledge_mining.binomial_p` below n = 25.** Over-rejects ~30x at
  n = 3 (failed approach 18b).
- **Using a per-player displacement layer WITHOUT a backoff.** Phase 6: it
  abstains on 45.09% of events and loses 14.00 pts [-17.26, -10.78] there.
- **Consulting a displacement memory below 3 prior observations of that card.**
  Measurably worse than the player-frequency baseline.
- **Quoting the `ronin -> mighty-miner` example.** Zero held-out events, and the
  population contrast was a leave-one-out artefact (Phase 6 §16).
- **Quoting any Phase 6 number as product accuracy.** The task is 1.8-2.3% of
  production steps and the exit is an oracle.
- **Adding a confidence band, a lifecycle status, or a recency decay to a
  displacement memory.** None was measured (Phase 6 §26.2).
- **Promoting, persisting or building ANY displacement memory as a predictor.**
  Phase 7: −0.06 [−1.67, +1.47] end-to-end; +0.017 points of production steps
  (FAILED APPROACHES #19).
- **Quoting an oracle-defined support bucket as a specialist.** Support computed
  from the true exit (+5.08 to +11.85) is not available at prediction time; the
  deployable buckets are all ns (A23).
- **Estimating an end-to-end figure by multiplying marginal rates.** Phase 6's
  "~22%" was 10 points off the measured 32.29%.
- **Treating the canonical rank-softmax as a confidence.** It gives the top exit
  0.401 on every event (KNOWN BUGS #8).
- **Probability-weighted exit composition as a rescue.** PROB ns; TOPK3 and
  calibrated PROB significantly worse than hard top-1.
- **Building a better exit model or a two-card pairing algorithm to revive this
  branch.** OIE Phase 13 already failed the first; the one-card case the second
  would extend is already null.
- **Reading an exit prediction as card rejection.** 55.5% of exited cards come
  back; the ranker detects rotation slots.
- **Quoting the research-frame one-card share (6.22%) as a product number.**
  Production semantics gives 1.46%.
- **Changing `timestamp="9999"` to "now" (or anything else) in isolation.**
  At the logged request delay it pushes M2's strongest feature 3+ standard
  deviations out of range and puts 34.2% of competitive reads in "low"
  (Phase 8, A24).
- **Correcting `log_hours_since_change` alone.** −0.0282 ROC-AUC, worse than
  the bug.
- **Quoting 0.932 / 0.803 as the shipped engine's quality.** Production computes
  0.858 / 0.760 on the same rows.
- **Recalibrating bands or retraining M2 to "complete" a timestamp fix** without
  an explicit decision to reopen the freeze (spec §7).
- **(Session 2 qualification of the "now" bullet above.)** The reason given,
  "out of range", is withdrawn: on outcomes, "now" beats `9999`. The bullet
  still stands. Do not change the stamp **before Phase 8b** re-validates it in
  production's frame, and not without the account holder's approval.
- **Using local time for a request-time stamp.** `battle_time` is UTC and
  `_parse` ignores the `Z` (KNOWN BUGS #13).
- **Re-validating a stamp fix with `cutoff_ts` = the predicted battle.** That
  reproduces the optimistic training stamp (KNOWN BUGS #14).
- **Evaluating a serve-time input by sweeping it across every row.** Restrict to
  the rows that input can co-occur with (FAILED APPROACHES #20).
- **Retraining M2 for a stamp fix.** Not needed: the frozen model improves when
  the features it was trained with are populated.
- **(Phase 8b)** Implementing the stamp fix without an explicit implementation
  review. The gate passed; that makes the fix *eligible*, not *approved*.
- **Removing `log_hours_since_change` (feature 9)** because it hurts calibration
  in production order (x10 alone Brier −0.1215 vs both −0.0963). That is a model
  change and a separate experiment.
- **Quoting 0.858 or 0.932 as the shipped engine's quality in production order.**
  It is 0.619 (`9999`) / 0.673 (request stamp) on competitive random-clock reads.
- **A production-order replay that uses battle time for visibility** (A25).
- **Restarting the bot before any follow-up that needs arrival times.** The
  restart purge destroys `stored_at` history (KNOWN BUGS #18).
- **(Phase 8c)** Bundling an `ALTERNATIVE_CAPS`, `_band` or UI-copy change into
  the timestamp fix. Those need their own review and gate.
- **Keeping today's alternative count while fixing the stamp** (Option B). It
  shows alternatives on low-confidence reads (13.2%), inverting rule 4, with no
  validation.
- **Reading "alternative hit rate" as the alternatives' purpose.** They are
  labelled "not forecasts". 80.1% of changes are whole-deck switches no one-card
  edit can match.
- **Letting the alternatives analysis turn into candidate-pool redesign.** That
  is Phase 9's question, which is not approved.
- **(Phase 10)** Implementing the stamp fix before the account holder explicitly accepts the
  alternative regression. Phase 10 made it *approvable*, not approved.
- **Reading the wall clock inline in `predict`.** One UTC `_request_stamp()` helper, pinned in tests;
  an unpinned clock makes a committed test fail from 2026-09-27T18:51:45Z (KNOWN BUGS #24).
- **Reusing `shadow.record`'s `ts` as the stamp.** Its format is unparseable by `features._parse` and
  silently reproduces `9999`.
- **Changing `features.FEATURE_NAMES` as part of the version bump.** The artifact guard compares names;
  only `shadow.VERSIONS["features"]` changes.
- **Trusting the version pins as they stand** (they hardcode values and check by substring, #25), or
  **running `shadow.drift()` / `capture_baseline()` over a mixed-version log** (#26).
- **Recalibrating practice because shadow shows 89.9% `low`.** Practice shows no band; its cuts were fitted
  on `9999` outputs and are not in scope.
- **Deploying the fix, or switching `CLASH_OIE` to `shadow`, as part of the implementation commit.**
  Each is a separate instruction; `on` is a separate decision (deadlock 2).
- **Deleting or moving the Phase 8b/8c scratch evidence without first preserving it** to a durable
  gitignored location. It is the only copy and it holds real tags.
- **(Phase 11)** Treating the local implementation as shipped. It is uncommitted and undeployed; the
  VPS runs `"9999"` until a separately approved dark deploy.
- **Committing, deploying, restarting `royalweb` or enabling `CLASH_OIE=shadow` on the strength of
  Phase 11's PASS.** Each is its own approval.
- **Removing the module-wide pinned request clock from the predictor suites**, or adding a test that
  calls `predict` on a dated fixture without a pinned stamp (KNOWN BUGS #24).
- **Loosening the version tests back to substring checks** (KNOWN BUGS #25).
- **"Fixing" `test_ml_21a` as part of the timestamp change.** It is KNOWN BUGS #2, separate.
- **(Phase 12) Reading the commit as a deployment.** The commit is local and unpushed; the VPS runs
  `"9999"` until Phase 13 is approved and performed. Any sentence saying production uses the request
  stamp is false today.
- **Pushing the Phase 12 commit** to satisfy "ship it". A push to `main` triggers a Vercel FRONTEND
  deploy, which is not this change and was not approved; the VPS half is `scp`, not git, either way.
- **Committing, moving or deleting anything under `brain-evidence/`.** It holds real player tags, the
  repository is public, and it is the only copy. Only `brain-evidence/phase8/MANIFEST.md` is tracked;
  verify with `git check-ignore -v` before any `git add`, and never use `git add -A` here.
- **(Phase 13A) Inventing or re-labelling a six-way win-condition taxonomy** to unblock
  the 2v2 top-50 work. There are 23 win-condition cards, 17 archetypes and 6 editorial
  play styles, and none of those is "the six win conditions". It needs a decision.
- **Deleting the 2v2 census before a compact replacement is built AND independently
  verified.** It cannot be rebuilt: 21.8% of the historical battles already have no
  surviving payload, and the share shrinks at every bot restart.
- **Deleting 2v2 rows from `battles`.** This repo opens it `mode=ro`, and the four
  measured blockers on that deletion (unreconstructable rows, aggregates that count 2v2
  and cannot be unfolded, the bot being the writer, no backup) all still stand.
- **Regenerating a substitute for that evidence if it is ever lost.** Record the loss instead: the
  arrival data it came from is destroyed at every bot restart (#18), so a rebuild would be a
  DIFFERENT dataset wearing the same name.

---

## 33. GLOSSARY

| term | meaning |
|---|---|
| **OIE** | Opponent Intelligence Engine — `server/ml/`, frozen, dark |
| **Recent** | the baseline: the player's most recent deck |
| **shell / cluster** | plays grouped at >= 6 shared cards; the deck a player is "on" |
| **domain** | `competitive` (META_MODES) or `practice` (formerly, wrongly, `duel`) |
| **native duel** | `CW_Duel_1v1` / `Duel_1v1_Friendly` — 16/24-card loadout rows |
| **step** | one prediction opportunity; `next-in-cluster` vs `next-play` |
| **degraded** | a read that fell back; returns Recent, zero alternatives, a reason |
| **band** | `high` / `medium` / `low`, qualitative only |
| **macro** | player-macro averaging — mean of per-player means |
| **ECE** | expected calibration error |
| **rung** | which level of the Deck Counter evidence ladder a figure came from |
| **shadow** | observation logging with no user-visible effect |

---

```
============================================================
LATEST SESSION HANDOFF
============================================================

SESSION DATE: 2026-09-17

SESSION OBJECTIVE:
  Phase 13A: retain only the top 50 most-used 2v2 decks for each of six win
  conditions (max 300 records), delete the long tail, and keep the lists
  updating as new 2v2 battles arrive. Implementation was authorised, narrowly
  scoped, local only. Deployment, VPS, CLASH_OIE, prediction logic, Coach
  Assist and the timestamp fix were all out of scope.

CURRENT PHASE:
  13A - 2v2 top-50 storage compaction. COMPLETE. STATUS: BLOCKED.
  Nothing implemented. Nothing deleted. No source file changed.

WORK COMPLETED:
  - Read this README, README.md, server/README.md, CLAUDE.md, and the 2v2
    code: duo_pairs.py (1,877 lines), battle_modes.py, the app.py route, the
    #/duo screen, and both 2v2 test suites.
  - Traced the pipeline: bot -> battle_raw/battles -> battle_modes.classify ->
    duo_pairs._stage/observe -> duo_stage -> _fold -> duo_pairs table ->
    report() -> /api/analytics/duo-pairs -> #/duo. The table `duo_pairs` in
    server/.duo_pairs.db is the sole store behind the UI.
  - Searched every module, the frontend, cardMeta.json and all 14 Brain
    artifacts for a six-way win-condition taxonomy. THERE IS NONE.
  - Probed for local data: resolve_db_path() -> None; .duo_pairs.db absent.
  - Ran the 2v2 suites as a baseline: 425 / 135 / 40, all green.
  - Wrote the 32-section artifact; updated this README.

BLOCKED ON (each verified in source, not assumed):
  1. The six win conditions do not exist. 23 win-condition CARDS
     (cardMeta.is_win_condition); 16 archetypes + `other` = 17
     (deck_counter.WIN_CONDITION_MAP - the bot's map, stored in
     battles.player_win_condition); 6 editorial play STYLES
     (deck_counter.STYLE), whose own source says the stored taxonomy "is a
     card, not a play style" and one of whose six (`Mixed`) means NO single
     win condition. Using the styles redefines "win condition"; cutting the 17
     to six redefines the six; grouping the 23 cards invents. All forbidden.
  2. No 2v2 data on this machine - it is on the VPS, which this phase forbids
     contacting. So current counts, historical rebuild, independent
     verification and before/after storage measurement are all impossible.
  3. The store holds PAIRS, not decks. canonical(canonical(A), canonical(B));
     duo_pairs.py has no win-condition concept at all; the per-deck module
     duo_decks.py was deleted because "364,357 individual decks is not an
     answer to what do people play in 2v2". A pair has two decks, so up to two
     win conditions, and assigning it one is a new rule.

FINDINGS WORTH KEEPING:
  - The target layer is ~1 GB of the ~78 GB 2v2 occupies. battle_raw is
    44.7 GB and is the ONLY place a teammate's deck exists; the ~1.38M
    historical 2v2 rows live in battles, which this repo opens mode=ro and
    cannot delete from, and which four measured blockers already stop.
  - duo_stage (~1.89M rows) is unbounded and never pruned - a larger and far
    safer target inside duo_pairs.db than the census.
  - #/duo is PUBLIC (trial and up) since 2026-09-11. Its card filter reaches
    all 123 cards server-side; at <= 300 retained records most cards would
    return nothing (hog-rider alone matches 434,265 pairs today).
  - The eviction/re-entry problem is solvable with a bounded heavy-hitters
    (Space-Saving) counter, designed in the artifact 9, NOT implemented.

FILES CHANGED:
  DECKKIES_BRAIN_PHASE13A_2V2_TOP50_STORAGE.md   (new, untracked)
  DECKKIES_BRAIN_README.md                       (this entry)
  Nothing else. No source, no schema, no database, no commit.

DECISIONS OWED (nothing can be built until these are answered):
  1. Which taxonomy are "the six"? Recommended: the canonical 17 with a
     per-bucket cap - 17 x 20 ~= 340 records, nothing invented or redefined.
  2. Retain top-50 PAIRS (existing unit and counter), or reverse the earlier
     decision and build a per-deck 2v2 collection?
  3. Is duo_pairs the right target at all, given the finding above?

CURRENT SYSTEM STATE:
  Production UNCHANGED. VPS untouched. CLASH_OIE=off. The Phase 12 timestamp
  commit a9cdbb7 is untouched, uncommitted work is nil, and it is still not
  deployed.

NEXT EXACT TASK:
  The three decisions above (product, not engineering). Separately and still
  pending: Phase 13, the dark deployment of the timestamp fix.

DO NOT DO:
  - Do not invent a six-way win-condition taxonomy to unblock this.
  - Do not delete the 2v2 census before a compact state is built AND verified;
    the inputs for older battles no longer exist (coverage is already 78.2%).
  - Do not delete 2v2 rows from `battles` - mode=ro here, and four measured
    blockers stand.
  - Everything in the Phase 0-12 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 12 - archived, never delete)
============================================================

SESSION DATE: 2026-09-15

SESSION OBJECTIVE:
  Phase 12: commit the Phase 11 timestamp-fix implementation, and preserve the
  Phase 8b/8c evidence in a durable gitignored location. Deployment, VPS
  restart, CLASH_OIE=shadow, CLASH_OIE=on, production activation, pools, caps,
  persistence, retraining, recalibration and unrelated fixes NOT approved.

CURRENT PHASE:
  12 - Commit + evidence preservation. COMPLETE. STATUS: DONE.
  Committed locally. NOT pushed. NOT deployed. VPS untouched. CLASH_OIE=off.

WORK COMPLETED:
  - Verified the working tree held ONLY the Phase 11 change: git status/diff/
    numstat identical to the recorded surface (17/1, 1/1, 17/2, 57/14, 222/3),
    HEAD c4fc65e, git diff --check clean.
  - Wrote the .gitignore block FIRST (default-deny /brain-evidence/*, negating
    only brain-evidence/phase8/MANIFEST.md), THEN copied the evidence in with
    cp -rp: 34 files, 132,283,959 bytes; SHA-256, MD5, sizes and mtimes
    compared source vs copy, all identical; the scratchpad source left intact.
  - Wrote brain-evidence/phase8/MANIFEST.md (tracked): per-file bytes, mtime,
    SHA-256, MD5 and role, the source location, the date, a REAL-PLAYER-TAGS
    warning, and a sha256sum -c block. Ran it: 34/34 OK.
  - Verified the ignore: git check-ignore -v covers all 34 evidence files
    (rule /brain-evidence/phase8/*), the manifest is NOT ignored, and
    git status --short lists no evidence file.
  - Updated README.md (status row, the OIE section, 66 -> 67 in two places,
    a layout entry), server/README.md (a Modes note), CLAUDE.md (local only,
    gitignored) and this README.
  - Re-ran the 27 suites before staging: 767 + 69, identical to Phase 11.
  - Staged explicit paths only (never git add -A), audited the staged diff and
    git diff --cached --check, scanned the staged content for player tags and
    for the evidence paths, then made ONE commit. No push.

FILES COMMITTED (one commit, parent c4fc65e):
  server/ml/production/predictor.py           +17 -1
  server/ml/production/shadow.py              +1  -1
  server/ml/evaluation/phase22-final-spec.md  +17 -2
  server/test_ml_production.py                +222 -3
  server/test_ml_22_final.py                  +57 -14
  .gitignore                                  +11
  README.md, server/README.md                 doc updates
  DECKKIES_BRAIN_README.md                    this file (now tracked)
  DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md
  brain-evidence/phase8/MANIFEST.md           hashes only

DELIBERATELY NOT COMMITTED:
  the 34 evidence files (real tags, gitignored); the Phase 1-10 / 8b / 8c Brain
  artifacts (outside the approved commit list - left untracked, nothing
  deleted); CLAUDE.md (gitignored); every scratchpad script and output.

RESULTS:
  evidence      34/34 files byte-identical to source; 34/34 sha256sum -c OK;
                0 evidence files visible to git; manifest tracked
  suites        767 unittest + 69 homegrown across 27 suites, identical to the
                Phase 11 after-run suite by suite
  pre-existing  test_ml_21a.test_every_card_name_maps "123 != 122", output
                identical to Phase 11 (KNOWN BUGS #2, deliberately not fixed)
  shadow log    md5 a02ff6cc0a103dc394b479d3c4fdcfb9, 2,620 lines, unchanged

MISTAKES:
  1. The generated manifest lost a character of the source path to a "\f"
     escape and quoted two unverified counts; both corrected against the files
     before staging.
  2. A first README draft claimed every offline evaluation had real timestamps.
     The band validations deliberately reproduced "9999" (Phase 8 s1 point 3).
     Corrected before staging.

ROLLBACK: git reset --soft HEAD^ (nothing is pushed, nothing is deployed).

OPEN QUESTIONS / NEXT APPROVALS (each separate, in order):
  1. Phase 13 - the controlled DARK deploy (CLASH_OIE stays off)?
  2. CLASH_OIE=shadow on a fresh log (S3-S7)?
  3. Commission the separate ALTERNATIVE_CAPS / label / copy review?
  4. Fix the shadow tooling defects (#26) before any shadow checkpoint?
  5. Should the Phase 1-10 Brain artifacts be committed too, or stay local?
  6. Phase 3's question is STILL UNANSWERED: why did the work stop on
     2026-08-03?

CURRENT SYSTEM STATE:
  Production UNCHANGED (VPS runs "9999"; CLASH_OIE=off; royalweb not
  restarted; shadow log untouched). The repository now carries the fix.

NEXT EXACT TASK:
  Phase 13 dark deployment approval (engineering). Research: none.

DO NOT DO:
  - Do not treat the commit as a deployment, and do not push it.
  - Do not deploy, restart royalweb or enable CLASH_OIE without its own
    approval.
  - Do not commit, move or delete anything under brain-evidence/.
  - Everything in the Phase 0-11 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 11 - archived, never delete)
============================================================

SESSION DATE: 2026-09-15

SESSION OBJECTIVE:
  Phase 11: implement the approved Phase 8/8b timestamp correction exactly as
  Phase 10 specified, locally, and validate it completely. The account holder
  explicitly accepted the Phase 8c alternative regression. Deployment,
  restart, CLASH_OIE=shadow, frontend, pools, caps, persistence, retraining,
  recalibration and unrelated fixes were NOT approved.

CURRENT PHASE:
  11 - Timestamp fix implementation. COMPLETE. STATUS: PASS.
  Local working tree only. NOT committed. NOT deployed. VPS untouched.

WORK COMPLETED:
  - Confirmed the README and all Brain artifacts unchanged since Phase 10
    (read in full earlier in this session), HEAD c4fc65e, and the Phase 8b/8c
    evidence present at its recorded location (md5 recorded).
  - Confirmed "phase2-21" appears only in the approved surface and nothing
    reads the features version by value.
  - Baseline run of 27 suites BEFORE any change (756 unittest + 69 homegrown;
    1 failure test_ml_21a).
  - Implemented predictor.py (UTC _request_stamp helper; line 120), shadow.py
    (features version), spec (2.2, 6, 7 note).
  - Tests: test_ml_production.py +10 (T1 x2, T2 x2, T3-T7, pin guard) with a
    module-wide pinned request clock and two fixture pins; test_ml_22_final.py
    exact version pins (#25), pinned clock, pin guard.
  - After run of 27 suites; mutation check (6 mutants + control); calendar
    check (clock faked to 2026-12-31 and 2030-01-01); offline equivalence on
    357,426 recorded reads and 128,816 condition-B records.
  - Wrote the 15-section Phase 11 artifact; updated this README.

FILES CHANGED (tracked, uncommitted):
  server/ml/production/predictor.py           +17 -1
  server/ml/production/shadow.py              +1  -1
  server/ml/evaluation/phase22-final-spec.md  +17 -2
  server/test_ml_production.py                +222 -3
  server/test_ml_22_final.py                  +57 -14
FILES CREATED:
  DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md
  scratchpad p11/ only: run_suites.py, p11_mutations.py, p11_equivalence.py
  and their outputs (not in the repository)
FILES MODIFIED (untracked): DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else. Candidate pools, Coach Assist, substitution/exit models,
  policy.py (ALTERNATIVE_CAPS), shortlist.py (_band, labels), calibration and
  artifacts, API, frontend, bot, Brain stores. Production shadow log md5
  a02ff6cc0a103dc394b479d3c4fdcfb9, 2,620 lines, unchanged. Evidence md5
  unchanged.

RESULTS:
  offline equivalence  357,426/357,426 reads, pB max |d| 4.44e-16 (tol 1e-12),
                       primary identical, 0 degraded;
                       128,816/128,816 condition-B records: band, note, capped
                       list, count, uncapped list + labels, degraded, practice
                       payload; 0 mismatches; PASS
  suites               after 767 unittest + 69 homegrown pass;
                       test_ml_production 81 -> 91; test_ml_22_final 66 -> 67
  pre-existing failure test_ml_21a.test_every_card_name_maps,
                       "AssertionError: 123 != 122" (line 96), identical text
  skip                 FrontierWatch.test_an_advanced_frontier_is_ready
                       ('no database'), in both runs
  mutants              placeholder, localtime, cutoff-ignored, caps-changed,
                       x10-only, version-stale: each caught; control clean
  calendar             158/158 predictor tests at 2026-12-31 and 2030-01-01

LEAKAGE: PASS.

MISTAKES:
  1. The first mutation harness omitted sys.modules registration, so
     setUpModule never ran and the clean control failed on the pin guards.
     Fixed and re-run.
  2. The artifact's first draft quoted two line ranges and two diff counts a
     line off; corrected against the file before this handoff.

ROLLBACK (uncommitted): git restore of the five files listed above.

OPEN QUESTIONS / NEXT APPROVALS (each separate, in order):
  1. Commit the five changes, with README.md / server/README.md / CLAUDE.md
     updated in the same commit?
  2. Preserve the Phase 8b/8c evidence (S0)?
  3. Dark deploy (S2)?
  4. CLASH_OIE=shadow (S3-S7)?
  5. Phase 3's question is STILL UNANSWERED: why did the work stop on
     2026-08-03?

CURRENT SYSTEM STATE:
  Production UNCHANGED (VPS runs "9999"; CLASH_OIE=off). Local working tree
  carries the implemented fix.

NEXT EXACT TASK:
  Commit approval (engineering). Research: none.

DO NOT DO:
  - Do not commit, deploy, restart royalweb or enable shadow without its own
    approval.
  - Do not remove the pinned request clock or loosen the version pins.
  - Do not touch caps, labels, pools, calibration or the UI with this change.
  - Everything in the Phase 0-10 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 10 - archived, never delete)
============================================================

SESSION DATE: 2026-09-15

SESSION OBJECTIVE:
  Phase 10: a read-only engineering decision audit - can the Phase 8/8b
  timestamp fix be safely approved for implementation despite the Phase 8c
  alternative regression, and what exact minimal implementation contract
  applies? No implementation.

CURRENT PHASE:
  10 - Timestamp fix engineering decision audit. COMPLETE.
  STATUS: CONDITIONAL (Phase 8c pre-registered mapping, applied unchanged) -
  approvable; the only open term is explicit acceptance of the regression.

WORK COMPLETED:
  - Read the README and all 12 Brain artifacts (Phases 1-9, incl. 8, 8b, 8c)
    in full.
  - Traced the engine at c4fc65e: predictor, features, policy, shortlist,
    calibration (+ both artifacts), adapter, shadow (VERSIONS, record, drift,
    checkpoint), coach.observe / opponent_read, the Vercel proxy, the
    OpponentReadPanel, the phase22 spec, and the tests that pin versions.
    Engine unchanged since 2026-08-23; only production caller passes no cutoff.
  - Located the Phase 8b/8c session scratchpad data (the only copies) and
    STREAMED it (pure-Python unpickler; ~270 MB free, no numpy).
  - Recomputed the Phase 8b gate with new code (own AUC, pair-matrix player
    bootstrap, Brier, bands, ordering, transitions; Brier CI via paired_delta):
    every figure and CI bound identical; 8/8 readings PASS.
  - Recomputed the Phase 8c rule from the 128,816 real-predict records with
    caps re-applied from policy: every figure identical; CONDITIONAL.
  - Ran test_ml_production.py (81) and test_ml_22_final.py (66) under "9999",
    stamp = UTC now, and a 2027 stamp, simulated in process; bisected the
    steady-player fixture's failure date.
  - Wrote the 20-section artifact; updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE10_TIMESTAMP_FIX_DECISION.md
  - scratchpad p10/ only: p10_verify_8b.py, p10_verify_8c.py,
    p10_test_impact.py and their JSON/out files (not in the repository)

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else. predictor.py, features.py, policy.py, shortlist.py,
  calibration and artifacts, shadow.py, coach.py, tests, spec, proxy, UI,
  candidate pools, ALTERNATIVE_CAPS, CLASH_OIE. The Phase 8b/8c scratch data
  was READ only. No database, no VPS, no deploy, no commit, no Brain memory.

RESULTS (competitive, production order, random clock, T1, 111,123 / 773):
  primary deck accuracy 61.13% -> 61.13%; identical on 128,816/128,816
  ROC-AUC 0.6188 -> 0.6734  +0.0545 [+0.0381,+0.0698]   (recomputed exactly)
  Brier macro 0.3710 -> 0.2747  -0.0963 [-0.1103,-0.0828]
  high 92.8% @ 63.3% -> 65.0% @ 69.3%; ordering 2 -> 3 bands; 33.2% move
  alternatives/read 1.827 -> 1.429 (-0.435 [-0.470,-0.401])
  alternative hits 1.846% -> 1.062% (-0.91 pts [-1.41,-0.51]); coverage -0.78
  removed 44,325 @ 1.97% vs retained 158,712 @ 0.74% (+1.22 [+0.45,+2.21])
  alternative identity/order 128,816/128,816; HIGH label 649 generated, 0 shown
  leakage 294,644 recorded assertions, 0 failures

DECISION RULES (registered, not moved):
  8b gate PASS 8/8; 8c G0 R1 R2 yes, R3 no, B1 B2 B3 no -> CONDITIONAL.

IMPLEMENTATION CONTRACT (artifact s10-s13):
  predictor.py: import time; _request_stamp() (UTC, "%Y%m%dT%H%M%S.000Z");
  line 104 timestamp=cutoff_ts or _request_stamp(); line 106 untouched.
  shadow.VERSIONS["features"] = "phase2-21-reqstamp-utc". Spec 2.2/6 + 7 note.
  Tests T1-T7; tightened version pins; stamp pinned in all predictor tests;
  offline equivalence vs recorded pB (357,426) and condition B (128,816).
  Shadow S0-S7 (preserve evidence, fresh log, parse-failure signature,
  >= 100 players before any conclusion). Rollback: revert + VPS backups +
  CLASH_OIE off.

NEW DEFECTS (none fixed):
  KNOWN BUGS #24 steady-player test fails from 2026-09-27T18:51:45Z under an
                 unpinned wall-clock stamp
  KNOWN BUGS #25 version pins hardcoded and checked by substring
  KNOWN BUGS #26 shadow drift/baseline version-blind; practice drift never
                 evaluated (REFERENCE keyed "duel")
  KNOWN BUGS #27 stale 92.1%/47.3% comment in the opponent-read panel
  KNOWN BUGS #28 shortlist._primary_band computed and discarded
  Qualified: #13 (shadow ts format trap; host +05:30 offset).

NEW DECISIONS:
  A27 - an input correction to a frozen model ships as a dark engineering
        change, re-verified from recorded data, with an injectable UTC clock.

MISTAKES:
  1. The first recomputation run read significance.Interval's fields as
     lo/hi (they are low/high); it crashed before any number was produced,
     was fixed and re-run.
  2. A Bash `cd` into server/ moved the session's working directory; every
     later path was made absolute.

OPEN QUESTIONS:
  1. Does the account holder explicitly accept the alternative regression
     (the one open condition on the fix)?
  2. Approve S0 - preserving the Phase 8b/8c evidence to a durable gitignored
     location - before the temporary directory is lost?
  3. Commission the separate ALTERNATIVE_CAPS / label / copy review (after the
     fix lands)?
  4. Fix the shadow tooling defects (#26) before any shadow checkpoint?
  5. Phase 3's question is STILL UNANSWERED: why did the work stop on
     2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED. CLASH_OIE=off. Coach Assist live on the pro tier. Nothing
  implemented, deployed or committed.

NEXT EXACT TASK:
  Engineering: Phase 11 - controlled dark implementation of the timestamp fix
  per artifact 10 s10-s13 and s20, ONLY after explicit acceptance of the
  regression. NEEDS APPROVAL.
  Research: none required.

DO NOT DO:
  - Do not implement before explicit acceptance; do not deploy or switch
    CLASH_OIE as part of the implementation commit.
  - Do not read the wall clock inline, use local time, or reuse shadow's ts.
  - Do not change FEATURE_NAMES, caps, labels, cuts, pools or UI copy with it.
  - Do not validate with cutoff_ts = the predicted battle.
  - Do not run drift/baseline over a mixed-version log.
  - Everything in the Phase 0-9 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 9 - archived, never delete)
============================================================

SESSION DATE: 2026-09-14

SESSION OBJECTIVE:
  Phase 9: does expanding the candidate pool to the player's historically
  observed full deck vocabulary materially improve next-deck prediction on a
  leakage-free chronological replay? Research only.

CURRENT PHASE:
  9 - Full player deck-vocabulary candidate-pool replay. COMPLETE.
  STATUS: CONDITIONAL (pre-registered mapping). README gate PASSED on Phase 1's
  harness; arrival-visibility conditions FAILED.

WORK COMPLETED:
  - Recovered the README s32 Phase 9 gate verbatim; pre-registered two readings
    (U1 archetype, U2 exact deck), pools, rankers and the outcome mapping.
  - Read Coach Assist's candidate construction in full (coach._history,
    next_decks, opponent_next, _legal, _fills; duel_zone.predict_companions).
  - Read-only VPS extract (duel payloads, subject battles rows, raw arrivals);
    top-up for 3,745 subjects the first extract missed. /tmp/p9, /tmp/p9b deleted.
  - Reproduced Phase 1 exactly via its snapshot stored_at; built and validated
    the battles.id arrival clock (88,889 rows).
  - Chronological replay of 79,894 + 14,810 steps x 9 pools x 4 rankings x 3
    visibility rules; analysis with frozen paired bootstrap; OIE next-play ceiling
    on Phase 8c's 128,816 records; new-card reading; post-hoc backoff reading.
  - Wrote the 33-section artifact; updated this README; banner on the Phase 1
    artifact.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE9_CANDIDATE_POOL_REPLAY.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md
  - DECKKIES_BRAIN_PHASE1_DUEL_CENSUS.md (Phase 9 banner only)

FILES NOT MODIFIED:
  Everything else. server/ (incl. ml/production, predictor.py), src/, api/,
  Coach Assist, candidate pools, timestamp handling, caps, tests, schemas.
  No deploy, no commit, no migration, no Brain memory. VPS read-only.

RESULTS (Phase 1 steps, event / S-ARR):
  gate clause 1 FULL - A   U1 +1.39 [+1.17,+1.60]   U2 +0.36 [+0.18,+0.55]
  gate clause 2 >= 5       U1 +9.09 [+7.56,+10.63]  U2 +11.91 [+10.64,+13.28]
  S-ARR clause 1           U1 -0.06 [-0.18,+0.06]   U2 -0.48 [-0.59,-0.36]
  S-EXACT clause 1         U1 -0.62 [-0.94,-0.28]   U2 -1.56 [-1.90,-1.22]
  zero-pool  A 59.94/78.97  C 65.95/87.66  FULL 47.65/76.58
  recall     A 30.36/13.37  C 25.40/7.52   FULL 37.14/14.92
  U2 top-1   A 21.15/8.46   C 17.57/4.07   FULL 20.37/7.35
  top-1 | truth in pool  A 69.7  C 69.2  FULL 54.9
  FULL - C0 U2 +3.85 [+3.62,+4.07]; duel strangers +8.98; duel-seen -6.03
  OIE ceiling (competitive): 62.98% served -> 80.55% full vocabulary

DECISION RULE: gate passes U1 and U2; S-EXACT and S-ARR point estimates
  negative under both -> PROMOTE fails -> CONDITIONAL.

NEW DEFECTS (none fixed):
  KNOWN BUGS #21 non-duel raw stored_at is a re-store time before the last purge
  KNOWN BUGS #22 Phase 1 population not reproducible by battle_time
  KNOWN BUGS #23 Coach Assist window 1 shows card-illegal decks

MISTAKES:
  1. The first extract's subject list used the battle-time population's split;
     5,635 steps lacked history. Caught by the step count, re-extracted, and the
     replay now refuses to finish with a missing line.
  2. A pre-registration figure (4,192 late payloads) was mis-transcribed; the
     measured 4,459 was recorded in place.
  3. The first id-order test suggested battles ids were not arrival order; the
     cause was the purge re-store, found before any pool was computed.

OPEN QUESTIONS:
  1. Does the account holder accept the alternative regression (timestamp fix)?
  2. Commission a separate ALTERNATIVE_CAPS / label / copy review?
  3. Reopen coverage as an arrival-primary backoff phase, knowing its post-hoc
     estimate is below the materiality floor?
  4. Record arrival time per battle bot-side (outside this repo)?
  5. Phase 3's question is STILL UNANSWERED: why did the work stop on 2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED. CLASH_OIE=off. Nothing implemented, deployed or committed.

NEXT EXACT TASK:
  Engineering: timestamp fix implementation (Phase 8b s25 + Phase 8c s21), on
  acceptance of the regression. NEEDS APPROVAL.
  Research: none required by Phase 9. Optional: arrival-primary backoff replay.
  PROPOSED, NOT APPROVED.

DO NOT DO:
  - Do not change any candidate pool on Phase 9's evidence.
  - Do not quote Phase 1's 47.65% zero-pool as a request-time figure.
  - Do not union duel history and battles decks for players with duel history.
  - Do not add a recency cut from Phase 9 s16's in-sample table.
  - Everything in the Phase 0-8c DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 8c - archived, never delete)
============================================================

SESSION DATE: 2026-09-14

SESSION OBJECTIVE:
  Phase 8c: decide whether the alternative-hit regression caused by
  the correct timestamp is a meaningful loss of useful recommendations
  or an appropriate consequence of better calibration, and whether it
  blocks controlled implementation. Research only.

CURRENT PHASE:
  8c - Alternative regression decision audit. COMPLETE.
  STATUS: CONDITIONAL (pre-registered rule).
  Timestamp fix: NOT BLOCKED; cleared for controlled implementation on
  explicit acceptance of the alternative regression.

WORK COMPLETED:
  - Confirmed README and artifacts unchanged since Phase 8b; recovered
    A25 and the Phase 8b gate (not reopened).
  - Traced the alternative definition end to end: C1WideOneCard,
    shortlist.build/_band/_primary_band, policy caps and dedupe, as_dict,
    OpponentReadPanel copy, spec §2.4, shadow.reconcile coverage.
  - Pre-registered the decision rule (R1/R2/R3, B1/B2/B3) before any
    decomposition, disclosing the Phase 8b totals already known.
  - Real predictor.predict under both stamps on 128,816 Phase 8b reads
    with the cap bypassed in process; conditions A-E; change/no-change,
    band, removed/retained/added, usefulness, label and history analyses
    with player-paired CIs.
  - Wrote the 28-section artifact; updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE8C_ALTERNATIVE_REGRESSION_AUDIT.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else. predictor.py, features, thresholds, caps, candidate
  generation, Coach Assist, tests. No database, no VPS, no deploy, no
  commit.

RESULTS (competitive, 111,123 reads, A 9999 -> B request stamp):
  alternatives/read 1.827 -> 1.429 (-0.435 [-0.470,-0.401])
  hit 1.846% -> 1.062% (-0.91 pts [-1.41,-0.51]); top-1 -0.82 pts
  false alternatives/read 1.809 -> 1.418 (-0.426)
  coverage 62.98% -> 62.20%; with no alternatives 61.13%
  changed reads: hit 4.75% -> 2.73%; none shown 2.4% -> 24.1%
  unchanged reads: false alternatives -0.320/read
  removed precision 1.97% vs retained 0.74% (+1.22 [+0.45,+2.21])
  corrected bands: change 30.7/46.7/65.6%; alt precision
  0.37/2.90/3.61% vs caps 2/1/0
  changes: 80.1% 3+-card, 13.8% 1-card (38.6% of those in the list)
  identity/order identical 128,816/128,816
  practice: none shown in production either way

DECISION RULE: R1 yes, R2 yes, R3 NO; B1 no (0.78 pts < 3%), B2 no,
  B3 no -> CONDITIONAL.

NEW DEFECTS (none fixed):
  KNOWN BUGS #19 HIGH alternative label unreachable (649 generated, 0 shown)
  KNOWN BUGS #20 UI subtitle "seen in this player's own history" false for
  73.7% of shown alternatives
  KNOWN BUGS #17 characterised: caps ordered against alternative usefulness

MISTAKES:
  1. A heredoc README edit failed on quoting; redone via a script file.
  2. Two derived figures corrected before publishing (65.5%, 0.91).

PHASE 9: independent, not started, still PROPOSED NOT APPROVED.

OPEN QUESTIONS:
  1. Does the account holder accept the alternative regression, which
     clears the timestamp fix for controlled implementation?
  2. Commission a separate ALTERNATIVE_CAPS / label / copy review?
  3. Approve Phase 9 (coverage)?
  4. Phase 3's question is STILL UNANSWERED: why did the work stop on
     2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED. CLASH_OIE=off. Nothing implemented, deployed or committed.

NEXT EXACT TASK:
  Engineering: timestamp fix implementation (Phase 8b §25 + Phase 8c §21),
  on acceptance of the regression. NEEDS APPROVAL.
  Research: Phase 9 - Coverage. PROPOSED, NOT APPROVED.

DO NOT DO:
  - Do not bundle caps, label or UI-copy changes into the timestamp fix.
  - Do not keep today's alternative count with the fix (rule 4 inversion).
  - Do not treat alternative hit rate as the alternatives' purpose.
  - Everything in the Phase 0-8b DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 8b - archived, never delete)
============================================================

SESSION DATE: 2026-09-14

SESSION OBJECTIVE:
  Phase 8b: decide whether the Phase 8 request-time timestamp still
  beats "9999" in production's own order, with real ingest lag, under
  the README §32 pre-registered gate. Research only; no fix.

CURRENT PHASE:
  8b - Production-order timestamp replay. COMPLETE.
  STATUS: PASS (8/8 pre-registered readings).
  -> Eligible for controlled fix implementation review.

WORK COMPLETED:
  - Recovered the gate verbatim (README §32, artifact 8 §27.15) and
    A24; listed its four ambiguities BEFORE any result; evaluated every
    reading (the vacuous S2 excluded by a pre-results amendment).
  - Read production's read path (source.py, adapter, predictor,
    shortlist, policy caps), the deployed bot's ingestion (save_battles,
    battle_raw.stored_at, purge_non_duel_raw, poll loop), bot.log,
    api.log, the Caddyfile and the client metric sink.
  - VPS read-only: schema, bot_health (287 polls), raw arrivals since
    the purge cursor (1,546,570), seeded 1,200-player extract (693,300
    rows). One exploratory query was stopped for load; nothing written.
  - Measured ingest lag, raw coverage, poll cadence and the battlelog cap.
  - Wrote the pre-registration; built 357,426 production-order reads
    with arrival-constrained visibility through production's own code.
  - Gate, metrics, families, buckets, band reconciliation, features,
    36-hour and coverage analyses; real predictor.predict under both
    stamps (4,500 reads); alternatives on all 111,123 competitive reads;
    post-hoc censoring sensitivity.
  - Wrote the 32-section Phase 8b artifact; marked superseded Phase 8
    statements in place; updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE8B_PRODUCTION_ORDER_TIMESTAMP_REPLAY.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md
  - DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md (banner + one in-place mark)

FILES NOT MODIFIED:
  Everything else in both codebases. predictor.py, shadow.VERSIONS,
  tests, Coach Assist, candidate pools, Brain components, schemas,
  flags. VPS: read-only, /tmp/p8b only. No deploy, no commit.

DATA:
  production request timestamps: NONE (api.log untimestamped; client
  metric in memory; OIE off). Shadow log = research sweeps only.
  ingest: battle_raw.stored_at since 2026-09-12T02:55:53Z; 0 window
  battles without it.
  reads: competitive random clock 206,361 with output, 111,123 scoreable
  (773 players, 46.2% censored); practice 89,205 / 17,693 (163).

TIMING:
  ingest lag tracked median 1.89h p95 3.79h max 9.0h, 100% < 6h;
  untracked median 5.25h p90 24.6h. Random-clock reads: request - last
  visible median 11.3h; request - arrival median 5.1h; next battle -
  request median 5.3h; 31.4% have unarrived battles.

RESULTS (competitive random clock, T1):
  ROC-AUC 0.6188 -> 0.6734  +0.0545 [+0.0381,+0.0698]
  Brier macro 0.3710 -> 0.2747  -0.0963 [-0.1103,-0.0828]
  PR-AUC 0.503 -> 0.574; recall@0.5 0.4% -> 20.0%
  bands high/med/low 92.8/6.9/0.3% -> 65.0/21.4/13.5%; high acc
  63.3% -> 69.3% pooled; ordering on 3 bands; 33.2% move
  T2 +0.0392 AUC / -0.0389 Brier; practice Brier -0.2885, AUC ns
  x10 alone +0.0505 / Brier -0.1215; x9 alone -0.0051 ns / +0.0166
  primary deck identical 4,500/4,500; alternative hits 1.85% -> 1.06%

LEAKAGE: PASS (294,644 assertions, 0 failures).

DECISION:
  PASS -> eligible for controlled fix implementation review (artifact
  §25). Decision owed on the alternatives regression. CLASH_OIE off.

NEW DEFECTS (none fixed):
  KNOWN BUGS #15 bot cadence ~4h (skip guard measured from pass finish)
  KNOWN BUGS #16 battlelog cap 30; 13.2% of tracked polls hit it
  KNOWN BUGS #17 corrected stamp cuts alternative hits (ALTERNATIVE_CAPS)
  KNOWN BUGS #18 arrival timestamps destroyed at every bot restart
  DATA LIMITATIONS #22-#23; decision A25 (arrival visibility)

SUPERSEDED (preserved in place):
  README §6.1 and DATA LIMITATIONS #21 "polls every 2 hours"; artifact 8
  §27.11 ingest-lag row; harness magnitudes as production figures (0.858
  baseline, -0.1706 Brier, 81% band movement, 71.2% at 36h).

MISTAKES:
  1. A first VPS count query passed a string where a tuple was needed.
  2. A wider raw query (since 09-01) was stopped mid-run to protect the
     bot's disk; the stray remote process was killed and verified gone.
  3. An interim progress note quoted "0 of 60,040 checks"; the correct
     total is 294,644 assertions, 0 failures. Not in any artifact.

PHASE 9 RELATIONSHIP:
  Research independent. If both are implemented, land the stamp fix
  first (it changes how many alternatives are shown on ~1/3 of reads).

OPEN QUESTIONS:
  1. Approve the timestamp fix implementation review, and decide the
     alternatives regression?
  2. Approve Phase 9 (coverage)?
  3. Log request timestamps (hashed tag + wall clock) so real request
     timing can ever be measured?
  4. Fix the bot's skip guard (#15)? It lives in the bot's repository.
  5. Phase 3's question is STILL UNANSWERED: why did the work stop on
     2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED. CLASH_OIE=off. Coach Assist live on the pro tier.
  Nothing fixed, deployed or committed.

NEXT EXACT TASK:
  Research: Phase 9 - Coverage. PROPOSED, NOT APPROVED.
  Engineering: timestamp fix implementation review. NEEDS APPROVAL.

DO NOT DO:
  - Do not implement the stamp fix without the review; do not remove
    feature 9 as part of it; do not retrain; keep CLASH_OIE off.
  - Do not quote 0.858/0.932 as production-order quality (0.619/0.673).
  - Do not use battle time for visibility in a production-order replay.
  - Do not restart the bot before a follow-up needing arrival times.
  - Everything in the Phase 0-8 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 8 session 2 - archived, never delete)
============================================================

SESSION DATE: 2026-09-14

SESSION OBJECTIVE:
  The Phase 8 brief was issued again to a fresh session. Phase 8 was
  already complete (2026-09-13), so it was NOT redone or overwritten:
  it was independently re-verified, and the one question session 1
  declared unmeasurable (a request-time stamp against real outcomes)
  was measured.

CURRENT PHASE:
  8 - Production timestamp bug impact audit. COMPLETE, RE-VERIFIED.
  VERDICT: CONDITIONAL (session-1 gate unchanged, not re-run).
  SESSION-2 RULE I4: FIRES -> fix eligible for controlled review.

WORK COMPLETED:
  - Read the README fully (older handoffs skimmed), the Phase 8 artifact,
    session 1's scratchpad (pre-registration, scripts, logs), the phase22
    spec, predictor/features/dataset/change_detector/phase2/adapter/
    calibration/significance/metrics, the shadow record(), Coach's
    observe/opponent_read, OpponentReadPanel; the summaries of artifacts
    1-7 plus targeted greps.
  - Verified the artifact's code citations (all correct to within a line).
  - Wrote a PRE-REGISTRATION before any new number, disclosing what was
    already known.
  - Reconstruction/leakage validation: 815,524 checks, synthetic + 239 real
    series; dump proved battle-time-stamped on 114,956 real steps.
  - Independent replication of every session-1 headline (exact).
  - Request-time outcome test R(h), E(e), U, competitive and practice,
    paired vs 9999 with player-cluster bootstrap and paired_delta Brier;
    bands under frozen cuts.
  - Descriptive production-frame survival check over phase18-plays.
  - Amended the artifact (banner, in-place supersession marks, new §27);
    updated this README.

FILES CREATED:
  - none in either repository (scratchpad p8v/ only)

FILES MODIFIED:
  - DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md (additions only; every
    session-1 statement preserved, superseded ones marked)
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else. predictor.py, features.py, every artifact and test,
  Coach Assist, schemas, flags. No database opened. No deploy, no commit.

TIMESTAMP:
  current "9999" -> x9 = x10 = 0.
  training = the predicted battle's time T.
  SERVE = the request wall clock in UTC (or cutoff_ts when supplied).
  R <= cutoff (in production the cutoff is R). R -> T as the read nears
  the battle.

RESULTS (competitive; vs 9999 on identical steps):
  replication  A 0.8584 | B1 0.9315 | B2 0.8615; B1-A +0.0731 [+0.0625,
               +0.0855]; x10 +0.0721; x9 -0.0282 - all exact
  R(36h)  3,760 steps, chg 71.2%  Brier -0.1596 [-0.1819,-0.1373]
          AUC +0.0060 [+0.0017,+0.0105]  meanP 0.143->0.556 ECE 0.570->0.157
  U       Brier -0.1706 [-0.1931,-0.1497]  AUC +0.0494 [+0.0330,+0.0702]
  E(5min) AUC +0.0668 retention 1.00;  E(1h) AUC +0.0423 retention 0.94
  R(5min) Brier +0.0018 [+0.0009,+0.0030]  (slightly worse)
  bands   late reads: 9999 "high" ~59-63% accurate -> request 70-82%;
          ordering holds; movement 81% (U)
  practice same direction; R(5min) Brier +0.0046 worse
  frame   production next-play: idle >36h changes 59.2% (0.33% of steps);
          practice ranks 5min-1h gaps backwards

LEAKAGE: PASS. 170 check failures = h=0 (stamp == anchor play), classified.

RISK: edit LOW; behaviour MEDIUM (was HIGH); contract MEDIUM (was HIGH).
  Retraining not needed; re-validation required. Overall still not LOW.

DECISION:
  Session 1's "do not schedule the fix" SUPERSEDED by pre-registered I4:
  ELIGIBLE for a controlled fix review, stamp = request time (UTC).
  Nothing scheduled. Precondition: Phase 8b.

NEW DEFECTS / FINDINGS (none fixed):
  KNOWN BUGS #13 no test asserts predict passes a parseable (UTC) stamp
  KNOWN BUGS #14 cutoff_ts = T backtests would certify the optimistic stamp
  FAILED APPROACHES #20 session 1's output sweep over request delays
  DATA LIMITATIONS #20 no record of request timing; #21 ingest lag

SUPERSEDED (preserved in place):
  artifact §1.1 last sentence, §1.4 points 1-2, §15.2 conclusion, §15.3
  row 4, §17 rows 4-5, §18.3, §20.2, §21 bullet 1, §22 recommendation,
  §24.4; README §4.4 "cannot supply", KNOWN BUGS #1 (session-1 block) and
  #12 last row, A24's "fix to now" rejection, §32 "cannot answer".

MISTAKES:
  1. A format-string bug crashed the first validation run; fixed and
     rerun before any number was read.
  2. The "every shell play < stamp" check was written strictly and fails
     by design at h = 0; classified and reported rather than hidden.

NEW DECISIONS:
  A24 qualified: evaluate a serve-time stamp on the population it is
  about; re-validate at sampled request times, never cutoff_ts = T.

OPEN QUESTIONS:
  1. Approve Phase 8b (VPS production-frame re-validation)? Needed only
     before a stamp fix or a CLASH_OIE rollout.
  2. Approve Phase 9 (coverage)?
  3. When would real users request a read relative to the opponent's
     battle? No log exists (DATA LIMITATIONS #20).
  4. Phase 3's question is STILL UNANSWERED: why did the work stop on
     2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED. CLASH_OIE=off. Coach Assist live on the pro tier.
  Nothing fixed, deployed or committed.

NEXT EXACT TASK:
  Phase 9 - Coverage. PROPOSED, NOT APPROVED.
  Phase 8b is the precondition for any timestamp fix. PROPOSED, NOT
  APPROVED. DO NOT BEGIN EITHER WITHOUT EXPLICIT APPROVAL.

DO NOT DO:
  - Do not change the stamp before Phase 8b, or without approval.
  - Do not use local time for a stamp; do not re-validate with
    cutoff_ts = T; do not retrain M2 for a stamp fix.
  - Do not correct log_hours_since_change alone.
  - Do not quote 0.932/0.803 as production's quality.
  - Do not quote any R/E/U number as production-frame accuracy.
  - Everything in the Phase 0-8 (session 1) DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 8 session 1 - archived, never delete)
============================================================

SESSION DATE: 2026-09-13

SESSION OBJECTIVE:
  Fresh-session recovery, then Phase 8: measure how much predictive
  value predictor.predict's timestamp="9999" costs, and whether a
  fix is worth a future controlled change. Impact only; no fix.

CURRENT PHASE:
  8 - Production timestamp bug impact audit. COMPLETE.
  VERDICT: CONDITIONAL (pre-registered gate).

NOTE ON NUMBERING:
  The Phase 8 brief labelled prior phases differently ("Phase 1
  frozen-engine audit, Phase 2 native-duel census, ..."). This
  README's numbering is authoritative: Phase 0 audit, 1 duel
  census, 2 infrastructure audit, 3 shadow replay, 4 card
  intelligence, 5 adoption census, 6 displacement replay, 7 exit
  replay. The coverage proposal formerly "Phase 8" is now Phase 9.

WORK COMPLETED:
  - Confirmed every Brain artifact unchanged since Phase 7.
  - Read phase22-final-spec.md, features.py, change_detector.py,
    predictor.py, adapter.py, policy.py, calibration.py,
    recalibrate.py, phase2.py (+ report), phase20b/20d harness notes.
  - Traced every read of example.timestamp (3 reads, 2 features)
    and found a third input fault: is_duel vs the "practice" rename.
  - Inspected the artifact: trained on Phase 2's exact train split;
    log_hours_since_last_play carries its largest weight.
  - Found that every production band validation reproduced 9999.
  - Pre-registered conditions, metrics, strata and gate.
  - Leakage test: 300 synthetic chronologies, 19,077 checks.
  - One-variable A/B/B2 on 99,541 held-out steps, ablations,
    player-cluster AUC bootstrap, paired Brier, bands, strata.
  - Frame check over phase18-plays; serve-gap check over the shadow
    log; model-output sweep across request delays.
  - Wrote the 26-section artifact; updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE8_TIMESTAMP_BUG_AUDIT.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else. predictor.py, features.py, every artifact, every
  test, Coach Assist, schemas, flags. No database opened. No deploy,
  no commit. Scripts live in the session scratchpad (p8/) only.

FROZEN CONTRACT:
  No numerical gate for feature inputs; §7 forbids retraining,
  recalibration and new features. Model metrics are Phase 2's
  (ROC-AUC 0.932/0.803; Brier with a paired player bootstrap).
  Primary deck = Recent, untouchable by the timestamp.

TIMESTAMP:
  current "9999" -> both features 0.
  correct = the prediction cutoff (training: the predicted battle's
  time; production: cutoff_ts or request time). Proven
  timestamp <= cutoff; features read only shell plays < cutoff.

RESULTS (competitive; practice in brackets):
  ROC-AUC  A 0.8584 (0.7601) | B1 0.9315 (0.8032) | B2 0.8615 (0.7684)
  B1-A +0.0731 [+0.0625,+0.0855]  (+0.0431 [+0.0307,+0.0561])
  B2-A +0.0031 [-0.0014,+0.0076] ns (+0.0083 [+0.0049,+0.0116])
  Brier B1-A -0.0265 [-0.0326,-0.0209]; B2-A +0.0013 (worse)
  x10 only +0.0721; x9 only -0.0282; both +0.0731
  B1 reproduces Phase 2 exactly.
  Bands (frozen cuts): 10.84% of competitive steps move at B1.
  Shadow-log request delay median 36h / 49h; at 36h, 34.2% of
  competitive reads -> "low"; practice 100%.
  is_duel fault: Brier +0.0020 [+0.0018,+0.0023], negligible.

LEAKAGE: PASS - valid only when the stamp is the prediction moment.

RISK: code edit LOW; behaviour HIGH; contract HIGH.

DECISION:
  CONDITIONAL. Do NOT schedule the one-line fix. The defect is
  that M2's strongest feature is defined at the battle being
  predicted, which production never has (KNOWN BUGS #12, A24).
  Documentation corrected: the shipped engine is 0.858, not 0.932.

NEW DEFECTS (none fixed):
  KNOWN BUGS #11 is_duel = 0 on practice reads since Phase 23
  KNOWN BUGS #12 M2's temporal features have no serve-time definition
  Also: every band validation ran on buggy outputs; correcting
  log_hours_since_change alone is worse than the bug.

SUPERSEDED (preserved in place):
  KNOWN BUGS #1 "effect unmeasured / highest-value cheap experiment"
  §30 "one line plus one evaluation run"
  §4.4's 0.932/0.803 as a description of production

MISTAKES:
  One arithmetic slip caught before publishing: a relative Brier
  change mixed a player-macro delta with a pooled base (-37.5%);
  the pooled figure is -33.4%. Corrected in the artifact.

NEW DECISIONS:
  A24 - a feature's value is defined by its timestamp; evaluate and
        serve on the same definition, and quote the stamp.

OPEN QUESTIONS:
  1. If CLASH_OIE is ever rolled out: which serve semantics - leave
     the validated 9999 engine, restrict reads to battle time, or
     retrain with serve-consistent features (reopens the freeze)?
  2. Approve Phase 9 (coverage)?
  3. Phase 3's question is STILL UNANSWERED: why did the work stop
     on 2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED. CLASH_OIE=off. Coach Assist live on the pro tier.
  Nothing fixed, deployed or committed.

NEXT EXACT TASK:
  Phase 9 - Coverage (the proposal formerly numbered 8).
  PROPOSED, NOT APPROVED. DO NOT BEGIN WITHOUT EXPLICIT APPROVAL.

DO NOT DO:
  - Do not change timestamp="9999" in isolation, to "now" or anything.
  - Do not correct log_hours_since_change alone.
  - Do not quote 0.932/0.803 as production's quality.
  - Do not recalibrate or retrain to "complete" a fix without an
    explicit decision to reopen the freeze.
  - Everything in the Phase 0-7 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 7 - archived, never delete)
============================================================

SESSION DATE: 2026-09-13

SESSION OBJECTIVE:
  Fresh-session recovery, then Phase 7: remove the exit oracle
  and measure whether ml/substitution's player-specific
  displacement advantage survives end-to-end.

CURRENT PHASE:
  7 - End-to-end card exit replay. COMPLETE.
  VERDICT: REJECT (README §32 gate, pre-registered).

WORK COMPLETED:
  - Read the README and all six prior Brain artifacts.
  - Audited ml/substitution, exit_model, exit_intel, edit_model,
    candidates, shortlist, dataset, evaluation/phase3/4/12/13,
    production/predictor, adapter, policy, calibration; read the
    OIE phase 3/4/5/6/12/13/14 reports and the 16C files.
  - Found production builds E4Combined + S2Transition UNFITTED.
  - Verified an exact join of phase4-edits recency fields onto
    Phase 6's population (29,503/29,503, six identity fields).
  - WROTE A PRE-REGISTRATION before any test number: systems,
    compositions, metrics, gate, buckets, player floor, BH
    family, leakage table.
  - Reproduced every Phase 6 oracle figure exactly.
  - Scored 7 exit systems and a 4x5 end-to-end matrix, 4
    compositions, cold start and support buckets under BOTH
    oracle-defined and deployable definitions, player-level
    distribution, failure categories and strata, calibration,
    two-card exits, 5 rolling origins, 3 temporal slices.
  - Truth-masked leakage probe over every ranker.
  - Recovered Phase 6's undocumented re-adoption definition.
  - Production-semantics replay over 138,978 real steps with
    production's own adapter, with per-player paired CIs.
  - Research-frame step shares over phase7-steps.
  - Wrote the 32-section artifact; updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE7_END_TO_END_EXIT_REPLAY.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else, in BOTH codebases. No production code, no
  ml/substitution, no exit_model, no ml/dataset, no Coach
  Assist, no schema, no migration, no flag, no model, no
  artifact, no test, no Brain memory. No database opened or
  written. No deploy, no commit, no push. The bot repository was
  only IMPORTED from (knowledge_mining, cards). Scripts and
  outputs live in the session scratchpad (p7/) only.

DATASETS ANALYZED (local, gitignored; NO live database):
  phase3-edits.jsonl.gz   29,503 edits, 389 players (population)
  phase4-edits.jsonl.gz   recency fields, joined exactly
  phase7-steps.jsonl.gz   337,651 next-in-cluster steps
  phase18-plays.pkl       797 players, production replay
  stepdef-16c.json, backtest-16c.json (committed 16C sample)

DATA:
  edits 29,503 (one-card 14,986 / two-card 14,517), 389 players
  range 20260613T154358 .. 20260819T042035
  train 20,652 (10,752 one-card)   test 8,851 (4,234 one-card,
  4,617 two-card)   boundary 20260810T161008.000Z   337 test
  players
  production steps (replay) 138,978; research steps 337,651

OUTGOING CARD (top-1, 4,234 one-card edits):
  random 12.50 | global exit freq 17.74 | global editability
  23.31 | player exit freq 28.29 (abstains 20.76%) | E0 39.91 |
  E4Combined 43.20 (top-2 57.77, top-3 76.57, MRR 0.6148, macro
  50.29) | E4 production-faithful 42.04
  E4 - global +34.19 [+29.96,+38.51]; E4 - player +20.36;
  E4 - E0 +2.09 [-0.14,+4.44] ns

ORACLE REPLACEMENT (reproduced exactly):
  B0 20.76 | B1 31.77 | B2 40.43 | B3 37.41 | B4 44.21 (macro
  46.21) | ceiling 61.38 | player-layer ablation +6.95

END-TO-END (HARD, E4Combined exit):
  B4 32.29 (macro 36.13) | top-3 48.02 (B1 50.28) | MRR 0.4169
  (B1 0.4177) | coverage 100%, ceiling 61.38 | joint exact 29.85
  GATE B4oE4 - B1  -0.06 [-1.67, +1.47]  p=0.90  FAIL
  top-3 -1.03 [-1.83,-0.14]; MRR -0.33 ns
  origins 50/60/70/80/90: -0.11 -0.21 -0.06 +0.51 +1.02, all ns

ORACLE TAX:
  11.93 pts pooled (paired 10.08 [8.34, 12.00]); e2e/oracle
  73.0%; ADVANTAGE RETENTION 4.2%
  deployable support>=3: tax 18.81, e2e-B1 -1.07 [-6.01,+3.72]

MECHANISM:
  exit right 43.2%: B4 69.11 vs B1 60.96  +4.94 [+2.60,+7.32]
  exit wrong 56.8%: B4  4.28 vs B1  9.56  -6.84 [-9.12,-4.66]
  player layer end-to-end +0.21 [-1.15,+1.61] (oracle +6.95)

COMPOSITION:
  PROB-canon -0.06 ns vs HARD; TOPK3 -1.59; PROB-cal -1.54
  canonical exit probability is a CONSTANT 0.401

COLD START (deployable):
  unseen player 0.50% untestable | known, no history for
  predicted exit 38.90%: -0.70 ns | >=1 60.60%: -0.06 ns |
  >=3 28.79%: -1.08 ns
  oracle-defined >=3: +5.11 [+0.77,+9.66] - NOT deployable

PLAYERS (>=10 edits, 150):
  e2e median 31.25 vs B1 30.77; better 39 / worse 58 / tied 53
  (oracle: 97 better / 16 worse)

RE-ADOPTION:
  61.81% = incoming card was the outgoing card of an EARLIER
  ONE-CARD edit, any domain (definition recovered). e2e 47.27%
  re-adopted vs 8.04% fresh. Exit ranker = rotation-slot
  detector: 55.88% when X had entered via an edit, 5.70%
  otherwise; 55.5% of exited cards come back.

PRODUCTION COVERAGE (138,978 real steps):
  one-card edit 1.46% (comp 1.47 / practice 1.42)
  two-card 0.62%   3+ cards 14.27%   no shell 7.60%
  production alternatives exact @2: 0.54% of all steps
  supported memory (>=3) on one-card steps: 0.40% of steps
  displacement layer over B1, same exit, deck@2:
    +0.017 pts [+0.008, +0.026] of all steps
  one-card method sees 8.92% of production changes with a shell

LEAKAGE: PASS - truth-masked re-ranking 0 differences across 5
  exit and 4 entry systems; structural probes 0; stats and
  temperatures train-only; oracle-defined subsets labelled.

WHAT SURVIVED:
  - Phase 6's oracle results (exactly reproduced).
  - E4Combined is a real rotation-slot detector.
  - At deck level with an exit committed, S2 beats player
    frequency +2.60 [+1.26,+4.00] (disclosed sensitivity).
  - The rotation-memory reading.

WHAT FAILED:
  - The README §32 gate, everywhere.
  - Probability composition as a rescue.
  - Any deployable support-gated specialist.
  - The player layer end-to-end.
  - Production materiality (+0.017 pts vs a 3% floor).

BRAIN ROLE:
  REJECT as prediction engine, specialist, or feature. The only
  honest use - describing a swap already observed - already ships
  as the shortlist's evidence string. No memory justified (A22).

NEW DECISIONS:
  - A23: an oracle-conditioned gain is not attributed to a
    component until re-measured with the oracle removed.
  - A21 QUALIFIED: "player layer necessary" holds under the
    exit oracle only.
  - Displacement workstream STOPS (README §32 gate).

NEWLY DISCOVERED DEFECTS (none fixed):
  KNOWN BUGS #6  production builds E4/S2 with UNFITTED stats
  KNOWN BUGS #7  E4's absence term is structurally zero
  KNOWN BUGS #8  canonical exit probability is a constant
  KNOWN BUGS #9  Phase 6's re-adoption rule was undocumented
  KNOWN BUGS #10 README §32 gate wording has two readings
  Also: production alternatives use one exit on 94.72% of
  one-card steps; practice no-change share 38.69% in the replay
  vs 74.2% in 16C (not reconciled).

MISTAKES:
  1. Bot helpers failed to import (cards.json is opened relative
     to cwd); fixed by importing with cwd = bot directory.
  2. The first strata used a same-domain re-adoption flag
     (72.34%) that is NOT Phase 6's; the reproducing definition
     was recovered before writing and is what the artifact
     quotes; the one table still carrying the other flag is
     labelled.
  3. Nearly quoted the canonical exit ECE 0.031 as calibration;
     it is a constant probability.
  4. The gate-wording ambiguity was noticed only after results;
     disclosed as a sensitivity, not used to change the verdict.

FAILED APPROACHES:
  #19 - a player displacement memory fed by a predicted exit.

DEADLOCKS:
  No VPS used or needed. Deadlocks 2-7 unchanged. NEW: coverage
  (the gate's named next branch) needs read-only VPS access and
  explicit approval because it touches frozen candidate
  generation.

OPEN QUESTIONS:
  1. Approve Phase 8 (coverage, section 32)? Or the cheap
     timestamp="9999" experiment instead?
  2. Does the account holder prefer the deck-level reading of the
     §32 gate? (Conclusion - nothing worth building - unchanged.)
  3. Why is practice no-change 38.69% here vs 74.2% in 16C?
  4. Phase 3's question is STILL UNANSWERED: why did the work
     stop on 2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED IN EVERY RESPECT. CLASH_OIE=off, CLASH_W3_MODE=off,
  CLASH_DUO_PROMOTE unset. Coach Assist live on the pro tier.
  ml/substitution NOT promoted. Nothing deployed or committed.

NEXT EXACT TASK:
  Phase 8 - Coverage: the full-vocabulary candidate pool,
  end-to-end, gate declared with metric/composition/unit named.
  PROPOSED, NOT APPROVED. DO NOT BEGIN WITHOUT EXPLICIT APPROVAL.

DO NOT DO:
  - Do not promote, persist or build any displacement memory as a
    predictor; do not quote any Phase 6 or Phase 7 edit-task
    number as product accuracy.
  - Do not quote oracle-defined support buckets as a specialist.
  - Do not estimate end-to-end numbers by multiplying rates.
  - Do not treat rank-softmax probabilities as confidence.
  - Do not read an exit prediction as card rejection.
  - Do not "fix" production's unfitted stats without a measured
    reason and approval - the fitted version is not better.
  - Everything in the Phase 0-6 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 6 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  Fresh-session recovery, then a chronological, leakage-free
  out-of-sample replay to test whether the Phase 5
  player-specific displacement signal is PREDICTIVE rather than
  merely descriptive.

CURRENT PHASE:
  6 - Chronological displacement replay. COMPLETE.
  VERDICT: CONDITIONAL.

WORK COMPLETED:
  - Read the README and all five prior Brain artifacts.
  - Audited ml/dataset, ml/substitution, ml/config,
    ml/evaluation/{phase3,metrics,significance}.
  - FOUND that the harness ALREADY performs a chronological
    split - temporal_split(TRAIN_FRAC=0.70) with
    GlobalStats().fit(train) - so OIE Phase 3's S0-S5 numbers
    were already out-of-sample. Adopted that committed split
    rather than inventing one, so the boundary could not be
    tuned against an outcome.
  - Inspected the chronological range and weekly volume BEFORE
    choosing anything.
  - Ran an 8-probe empirical leakage audit.
  - QUANTIFIED the one documented leak by reconstructing
    examples from phase18-plays.pkl under BOTH step modes.
  - Composed two isolated rungs (global P(Y|X), player P(Y|P,X))
    from ml/substitution's existing functions. REBUILT NOTHING.
  - Scored 5 rankers on 4,234 held-out one-card edits with
    paired bootstrap CIs resampling PLAYERS.
  - Cold-start decomposition, 4 regions, reported separately.
  - Support buckets: 0, 1-2, 3-4, 5-9, 10-24, >=25 plus four
    cumulative floors. Nothing hidden.
  - Layer ablation on ml/substitution.
  - Fixed-train vs walk-forward.
  - Rolling origin at 50/60/70/80/90%.
  - Temporal stability across three slices.
  - Chronological investigation of the ronin -> mighty-miner
    showcase.
  - Re-adoption / reversal analysis.
  - Recency and replacement-diversity analysis.
  - Wrote the 32-section artifact; updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE6_CHRONOLOGICAL_DISPLACEMENT_REPLAY.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else, in BOTH codebases. No production code, no
  ml/substitution, no ml/dataset, no Coach Assist, no schema,
  no migration, no flag, no model, no artifact, no test, no
  Brain memory. No row inserted, updated or deleted anywhere.
  No deploy, no commit, no push. No dark feature enabled.
  Analysis scripts live in the session scratchpad only.

DATASETS ANALYZED:
  LOCAL, gitignored. NO live database was opened.
    ml/results/phase3-edits.jsonl.gz   29,503 edits, 389 players
    ml/results/phase18-plays.pkl       used ONLY for the
                                       leak-control reconstruction

DATA:
  events 29,503 (one-card 14,986)   players 389
  cards out 121 / in 122
  range   20260613T154358 .. 20260819T042035
  train   20,652 (10,752 one-card)  20260613..20260810  49 days
  test     8,851 ( 4,234 one-card)  20260810..20260819  10 days
  boundary 20260810T161008.000Z     test players 337

PRIMARY RESULT (pooled top-1, held-out one-card edits):
  B0 global frequency        20.76%   (macro 24.31%)
  B1 player frequency        31.77%   (macro 36.19%)
  B2 global P(Y|X)           40.43%   (macro 42.14%)
  B3 player P(Y|P,X)         37.41%   (macro 37.39%)
  B4 ml/substitution         44.21%   (macro 46.21%)
  CEILING (truth in pool)    61.38%   B4 = 72.0% of it

DELTAS (paired on players, 2,000 replicates):
  B3 - B1   +1.20 [-1.52, +3.94]   NOT SIGNIFICANT  <- PRIMARY
  B3 - B0  +13.07 [+10.24, +16.03] significant
  B4 - B1  +10.02 [ +7.94, +12.21] significant
  B4 - B3   +8.82 [ +7.07, +10.77] significant
  B2 - B0  +17.83 [+15.24, +20.51] significant
  ROLLING ORIGIN: B3-B1 ns at 50/60/70/80/90%
                  (+1.58 / +0.57 / +1.20 / +1.95 / +2.30)

COLD START:
  player unseen            21 (0.50%)  ns, 5 players
  player seen, X unseen 1,895 (44.76%) B3 -14.00 [-17.26,-10.78]
  player + X seen       2,318 (54.75%) B3 +12.08 [ +8.40,+15.89]
  B3 ABSTENTION RATE 45.09%

SUPPORT BUCKETS (B3 - B1 top-1):
  1-2    n=1193  +8.10 [ +3.62, +12.46]
  3-4    n= 415 +13.79 [ +5.49, +21.60]
  5-9    n= 286 +14.65 [ +5.34, +23.90]
  10-24  n= 274 +25.33 [+12.35, +38.58]
  >=25   n= 150 +10.19 [-15.95, +34.44] ns - 13 PLAYERS ONLY,
                 not signal loss (B3 88.00% vs B1 47.33%)
  cumulative >=3  1,125 events (26.57%)  +18.65 [+12.54,+25.29]

ABLATION OF ml/substitution:
  remove global P(Y|X)   -0.85 [-1.61, +0.09]  REDUNDANT
                         (-1.24 in the abstention region only)
  remove player P(Y|P,X) -6.95 [-8.85, -5.21]  NECESSARY
                         -15.19 on the supported subset

WALK-FORWARD:
  B4 fixed 44.21% -> walk 44.33%, paired -0.09 [-0.38, +0.13].
  No benefit. The global table saturates; the per-player half
  was already walk-forward by construction.

TEMPORAL STABILITY:
  three slices of the test window: B4 44.93 / 43.66 / 44.05;
  B3 on support>=3  64.00 / 58.93 / 64.27.  FLAT.
  Caveat: 10 days only - no patch, no season turn.

RONIN -> MIGHTY-MINER:
  train evidence  54 ronin exits, mighty-miner 50 = 92.6%
  test evidence   0
  held-out result CANNOT BE VALIDATED - zero held-out events.
  AND the contrast was overstated: 4 players ever make the swap,
  this one supplies 50 of 54 population-wide. True population
  rate 15.84%; the "1.4%" was the leave-one-out denominator.
  PHASE 5 SECTION 5.4 IS SUPERSEDED ON THIS POINT.

RE-ADOPTION:
  61.81% of held-out one-card edits bring back a card that
  player previously dropped. B4 scores 59.95% on those against
  18.74% on a fresh card (+41.22).
  INTERPRETATION: the models are a CARD-ROTATION MEMORY. They
  predict which card from a known repertoire returns. They are
  close to useless on a card the player has not cycled - which
  is the new-card case in the limit.

RECENCY:
  B3-B1 gain by staleness: +18.18 (2-3 edits ago),
  +21.33 (4-10), +9.71 (11+). Decays only at long staleness.

LEAKAGE:  PASS
  incoming card is a candidate       61.28% (NOT 100%)
  outgoing card in its own pool           0
  prior_edits > cluster_size-1            0
  sum(cluster_card_counts) != size*8      0
  prev_deck subset of history    14,986/14,986
  boundary strictly increasing          yes
  train/test overlap                      0
  THE DOCUMENTED CLUSTER-SELECTION LEAK IS NOW QUANTIFIED:
  pool recall truth-selected 61.16% vs leak-free 61.24%,
  delta -0.07 pts. It does NOT inflate the ceiling. It DOES
  define the task population: 48.8% of changes are one-card
  under next-in-cluster vs 15.2% under next-play.

WHAT SURVIVED:
  - Player-specific displacement IS predictive where evidence
    exists, monotone in support.
  - ml/substitution beats every baseline out-of-sample, stably.
  - The PLAYER layer is the necessary one.
  - Shrinkage and backoff are what make it work.
  - The design is chronologically clean.
  - Phase 5's 777-finding census is not contradicted.

WHAT FAILED:
  - Per-player displacement as a STANDALONE predictor, at all
    five origins.
  - The ronin -> mighty-miner showcase.
  - The global transition table as a major contributor.
  - Any case for a live global table (-0.09).
  - The new-card case: 18.74% on non-rotated cards.

BRAIN MEMORY JUSTIFIED:
  MINIMUM: player_id, outgoing_card, replacement distribution,
  evidence_count, shell identity, last_validated / held-out hit
  rate, model_version.
  REFUSED BY THE EVIDENCE: confidence_band (not measured),
  lifecycle status (61.81% re-adoption contradicts it), recency
  decay (observed but untested), archetype/matchup/result
  context (closed twice), a global table as the primary object.
  HARD CONSTRAINT: it is a LAYER, never a MODEL (decision A21).

STATISTICAL FINDINGS:
  No binomial test used, so the Phase 5 mistake could not recur.
  No threshold fitted - the floor is the pre-existing
  MIN_SAMPLE_TRANSITION=3 and the full bucket sweep is reported
  including both non-significant cells. FDR deliberately NOT
  applied to 12 pre-specified model comparisons, with the
  reasoning declared; it would change no verdict. A permutation
  null is NOT applicable to a predictive replay - ROLLING ORIGIN
  is the equivalent guard and was run.

FRAMING CAVEAT THAT MUST TRAVEL WITH EVERY NUMBER:
  One-card edits within a shell the player stayed on = 1.8-2.3%
  of PRODUCTION steps (README section 18). And the exit is an
  ORACLE; the best exit ranker is 50.0%/49.3%, so end-to-end is
  plausibly ~22%. A +10 point gain here is NOT a +10 point gain
  to any shipped product.

PIPELINE DEFECTS:
  NONE NEW. knowledge_graph.refresh's battle-time watermark
  (Phase 4, Phase 5) is unchanged and unfixed, by instruction.
  It does not touch this substrate - ml/dataset.load_plays has
  no time predicate.

MISTAKES:
  None material this session. One README edit needed its
  anchor checked before insertion; verified by re-reading the
  region and a fence-parity check afterwards.

FAILED APPROACHES:
  No new entry. Phase 6 did not close a hypothesis outright -
  it BOUNDED one. The bounding is recorded as decisions A21 and
  A22 rather than as a failure, because the signal survives in
  a defined region.

DEADLOCKS:
  No VPS access needed or used. Deadlocks 2-7 unchanged. New
  practical limit: the cached window contains no card release
  and no known patch boundary, so nothing longer than 10 days
  of stability can be tested from it.

NEW DECISIONS:
  - A21: a per-player memory is a LAYER, never a MODEL.
  - A22: a descriptive finding is not a predictive one; the gap
    must be measured before anything is persisted.
  - Six conditions on any future promotion (artifact 27.2).
  - NOTHING PROMOTED. ml/substitution stays unpromoted.

OPEN QUESTIONS:
  1. How much survives when the EXIT must be predicted? This is
     Phase 7 and it gates the recommendation.
  2. Does any of this hold beyond 10 days, across a patch?
  3. Does it hold outside the heavy tail? (389 of 4,910; player
     cold start is 0.50% here and 57.34% in Phase 1's duels.)
  4. Do two-card edits carry the same signal? 49.2% excluded.
  5. Would a decay term help? Decay observed, never tested.
  6. Why is B3's advantage non-monotonic in replacement
     diversity?
  7. Phase 3's non-technical question is STILL UNANSWERED: why
     did the work stop on 2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED IN EVERY RESPECT. CLASH_OIE=off, CLASH_W3_MODE=off,
  CLASH_DUO_PROMOTE unset, kg graph stale at 2026-08-02,
  recommendation_events 4 / outcomes 0. Coach Assist live on the
  pro tier. Nothing deployed. ml/substitution NOT promoted.

NEXT EXACT TASK:
  Phase 7 - End-to-end cost of the exit oracle. Read-only. One
  question with the gate declared first: when the outgoing card
  must be PREDICTED rather than given, how much of the +10.02
  advantage survives? Needs no new data and no new code.
  GATE: if end-to-end top-1 does not beat the player-frequency
  baseline also run end-to-end, the displacement workstream
  STOPS and attention returns to coverage (Phase 1 option a).
  PROPOSED, NOT APPROVED. DO NOT BEGIN WITHOUT EXPLICIT
  APPROVAL.

DO NOT DO:
  - Do not promote ml/substitution. The gain is real and sits on
    1.8-2.3% of production steps behind a coin-flip exit
    predictor.
  - Do not build a Brain memory table.
  - Do not use a per-player displacement layer without a
    backoff (A21) or below 3 prior observations.
  - Do not quote any Phase 6 number as product accuracy.
  - Do not quote the ronin -> mighty-miner example.
  - Do not add a confidence band, lifecycle status or recency
    decay to a displacement memory - none was measured.
  - Do not condition substitution on archetype, matchup or
    previous result (closed twice: Phase 3 S3/S4/S5, Phase 5).
  - Do not read a trend off share-of-plays without a fixed
    cohort (#18a); do not use binomial_p below n=25 (#18b).
  - Do not consume, refresh or mine kg_edges.APPEARS_AFTER
    (Phase 4); do not schedule knowledge_graph.refresh() unfixed.
  - Do not revive CLASH_W3_MODE (Phase 3).
  - Do not build the Brain around native-duel opponent history
    (Phase 1).
  - Do not rebuild any of the nine bot modules (Phase 2, A17).
  - Do not random-split, and do not choose a split after seeing
    results.
  - Everything in the Phase 0-5 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 5 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  Fresh-session recovery, then a read-only census of card
  adoption and displacement intelligence on the substrate
  Phase 4 pointed at: ml/dataset edit events over `battles`.

CURRENT PHASE:
  5 - Card adoption & displacement. COMPLETE.
  DECISION: PROCEED WITH CONDITIONS.
  THE FIRST BRAIN PHASE WHOSE HYPOTHESIS SURVIVED.

WORK COMPLETED:
  - Read the README and all four prior Brain artifacts.
  - Traced the real edit-event definition end to end through
    ml/dataset.py, ml/substitution.py, ml/config.py and the
    phase3.py dump that produced the cached file.
  - Discovered the cached evaluation dumps in
    server/ml/results/ are a usable local dataset, and ran the
    whole census against them. NO live database was needed.
  - Re-counted the 29,503 figure from the file that produced it.
  - Measured global displacement with an eligibility-adjusted
    baseline, FDR correction and a permutation null.
  - Measured per-player displacement with a leave-one-player-out
    baseline at four support floors, each with its own null.
  - Caught and corrected a statistical error of my own (18b).
  - Measured usage trends twice: naively (artefact) and with a
    fixed cohort plus paired per-player bootstrap CIs.
  - Measured what rising cards displace.
  - Measured three conditioners both marginally AND
    incrementally, which explained a standing OIE result.
  - Measured the result-to-edit association pooled and
    player-macro over all 337,651 steps.
  - Measured four behavioural-confidence proxies.
  - Re-verified the knowledge_graph watermark defect and found
    its measured precedent in archive.py.
  - Wrote DECKKIES_BRAIN_PHASE5_CARD_ADOPTION.md, 24 sections.
  - Updated this README: section 9, experiment-log row, full
    Phase 5 entry, FAILED APPROACHES #18a and #18b, sections 31
    and 32, the DO NOT list, and this handoff.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE5_CARD_ADOPTION.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else, in BOTH codebases. No production code, no
  server module, no ml/ module, no schema, no migration, no
  flag, no model, no artifact, no API, no test. No row
  inserted, updated or deleted anywhere. No deploy, no commit,
  no push. Analysis scripts live in the session scratchpad;
  none was added to either repository. The cached dumps were
  READ only and were not copied or moved.

DATASETS ANALYZED:
  All LOCAL and gitignored, under server/ml/results/.
  NO live database was opened this session.
    phase3-edits.jsonl.gz     29,503 edit events, 389 players
    phase4-edits.jsonl.gz     29,573 events (+streak/last_seen)
    phase7-steps.jsonl.gz    337,651 steps,  400 players
    phase18-plays.pkl        283,122 plays,  797 players, 77 days
  Cohort: the 400 most active tracked players of a 4,910
  roster, over 2026-06-13..2026-08-19. NOT a sample of the
  game, or even of the roster - the heavy tail.

EVENT COUNTS:
  edit events                 29,503  (REPORTED FIGURE CONFIRMED)
  unique players                 389
  unique previous decks        5,984
  unique new decks             7,303
  unique cards out / in      121 / 122
  single-card (unambiguous)   14,986  (50.8%)
  two-card                    14,517  (49.2%)
  three-or-more-card               0  (BY CONSTRUCTION)
  full deck changes                0  (BY CONSTRUCTION)
  players with >1 event      384/389  (98.7%)
  edits per player      median 54, mean 75.8, max 440
  competitive / duel      21,672 / 7,831
  result split      loss 18,418 | win 10,893 | draw 192
  steps (separate dump)      337,651, change rate 8.83%

CARD ADOPTION FINDINGS:
  Detectable, but ONLY with a fixed cohort and per-player
  pairing. Fixed cohort of 178 players, two adjacent 15-day
  blocks (volumes within 1.12x): of 120 cards tested, 41 have a
  paired 95% CI excluding zero and 37 also clear the project's
  own 25% MIN_TREND_CHANGE. 79 are flat.
  THE NAIVE VERSION IS AN ARTEFACT. Share-of-plays across the
  window gives rune-giant +790%, ronin -82% - all false. The
  play log is a player-ENROLMENT ramp: 3.32% of plays in the
  first half, 85% in the last 30 days of 77, 50% in the last
  10 days, day 1 has ONE player.
  "First seen" is unusable: 114 of 122 cards first appear after
  day 1, including cards years old. That is enrolment, not
  release.
  NEW-CARD DETECTION IS UNTESTED - no release falls inside the
  window (data ends 2026-08-19; Minion Giant shipped
  2026-09-07). The method is specified in artifact section 9.2:
  a hard zero across a stable well-populated window then a
  step, plus SIMULTANEOUS adoption across unrelated players,
  which is what separates a release from a meta shift.

DISPLACEMENT FINDINGS:
  GLOBAL, on the 14,986 one-card edits, eligibility-adjusted
  baseline P(Y enters | Y was not already in the deck):
    observed pairs                            2,249
    support >= 25                               118
    surviving BH q=0.05                         114
    AND lift >= 1.5                             112
    pairs with lift < 1.0                         0
    PERMUTATION NULL                       0,1,1,2,2
  Strongest by lift: tombstone->goblin-cage 110.2,
  skeleton-barrel->hog-rider 106.9, electro-dragon->baby-dragon
  102.3, poison->rocket 33.9, monk->royal-ghost 28.6.
  ONLY 4 OF THE TOP 25 BY COUNT ARE IN THE TOP 25 BY LIFT.
  The survivors are overwhelmingly SAME-ROLE swaps - building
  for building, spell for spell - recovered with NO card
  metadata in the calculation.
  ADOPTION-DRIVEN: void->fireball 34.1% (base 4.20%),
  goblin-hut->tesla 56.8% (base 2.57%), berserker->knight 32.0%
  (base 3.09%), elite-barbarians->royal-ghost 27.3%.
  BUT the 3 FASTEST-rising cards are all below the support
  floor (rune-giant 22 incoming edits, little-prince 19,
  suspicious-bush 12). New-card displacement has inherent
  latency: the answer arrives weeks after it is most useful.

PLAYER FINDINGS:
  THE SUBSTRATE RETAINS THE PLAYER TAG - the decisive
  difference from kg_edges.APPEARS_AFTER.
  Exact binomial, leave-one-PLAYER-out baseline, BH q=0.05:
    floor >=3    2,823 cells   777 survive   255 players  null 0.0
    floor >=5    1,580          550          209          null 0.4
    floor >=10     584          251          128          null 0.2
    floor >=25     109           53           31          null 1.0
  One player runs knight->berserker 135/135 against a
  population 44.8%; another ronin->mighty-miner 92.6% against
  1.4% - a 66x difference on 54 observations.
  Concentration is itself the signature: entropy over dropped
  cards spans 0.46 to 5.78 bits across 287 players, with the
  extremes both around 130 edits.
  Corroborates the OIE's S1-vs-S0 gain of +8.0 / +4.4 points.

ARCHETYPE FINDINGS:
  Marginally real, incrementally worthless.
    marginal   246 of 1,569 cells (15.68%), null 0
    incremental given (player, card-out): 0 of 104  (0.00%)
  A player's own archetype is 62.6% concentrated in their modal
  one, so once you know who they are and what left, the win
  condition adds nothing. THIS IS THE MECHANISM BEHIND OIE
  PHASE 3's S3 LOSS (-1.60 pts) AND IT HAD STOOD UNEXPLAINED
  FOR ELEVEN PHASES.

MATCHUP FINDINGS:
  Marginal 81 of 1,566 cells (5.17%), null 0 - three times
  weaker than own archetype. Incremental: 6 cells in the whole
  dataset, from 30 that reach the floor at all.
  THE CEILING IS ARITHMETIC: 14,986 edits / (121 cards x 17
  archetypes) = ~7 events per cell, against a floor of 25.
  Expanding the cohort multiplies cells as fast as events.
  NOTE opp_wc is the PREVIOUS game's opponent, so this answers
  "after facing A, what changed", not "what do they bring
  against A". That is the only leak-free form available.

CONFIDENCE FINDINGS:
  A defensible BEHAVIOURAL score is buildable from four
  measured components, and must never be called psychological.
    least-used-in-shell predicts WHICH card leaves:
      top-1 44.0%, top-2 57.3% vs 12.5% chance = 3.5x
      player-macro 45.7%, 95% CI [43.2%, 48.2%], 237 players
    shortest-streak 42.9% (3.4x)
    least-RECENTLY-seen only 15.5% (1.2x)
      -> HOW MUCH you play a card matters; WHEN you last played
         it does not.
    73.9% OF DROPPED CARDS ARE LATER RE-ADOPTED (17,227 of
      23,314). Dropping is ROTATION, NOT REJECTION. A model
      that reads a removal as loss of confidence is wrong
      three times in four.
  NOT ESTABLISHED: that any of it predicts out-of-sample.

COACH ASSIST IMPLICATIONS:
  Nothing was modified and no change is proposed.
    A deck-change prediction   LOW    - M2 is already 0.932 and
                                        already uses the result
    B card-change prediction   MEDIUM - real, but bounded by a
                                        44% exit ceiling and
                                        three failed gates
    C opponent deck prediction LOW    - coverage is a population
                                        ceiling (Phase 1)
    D response selection       NONE   - counter-sniping 3x worse
    E counter-deck coverage    LOW    - pool problem, not ranking
    F new-card recommendations MEDIUM-HIGH - the only genuinely
                                        new capability
  Displacement is worth most where Coach is silent and least
  where it is already strong.

STATISTICAL FINDINGS:
  Every helper was IMPORTED from the project's own modules and
  executed, not reimplemented: opponent_profile.wilson_interval
  / entropy / MIN_SAMPLE_TRANSITION, knowledge_mining.
  benjamini_hochberg / MIN_SUPPORT / MIN_LIFT /
  MIN_TREND_SUPPORT / MIN_TREND_CHANGE, cards.get_win_condition.
  HIGH FREQUENCY != HIGH LIFT: demonstrated, 4 of 25 overlap.
  SIGNIFICANT != USEFUL: demonstrated twice - archetype gives
    246 findings and 0 incremental value; result conditioning
    gives 7 cells and cost the OIE -2.97 points.
  OBSERVATIONAL != CAUSAL: nothing here is causal. The result
    association is confounded by deck quality, matchup and
    opponent skill.
  A PERMUTATION NULL WAS RUN ON EVERY CLAIM AND IT CHANGED A
  CONCLUSION. Make it standard.

LEAKAGE FINDINGS:
  The substrate is leak-aware by construction: clustering is
  recomputed FROM THE PREFIX at every step, assert_leak_free()
  raises on any history row at or after T, GlobalStats is
  documented "fitted on TRAIN change events only. Never on
  test.", and result/opp_wc/opp_hash all come from the PREVIOUS
  play.
  THE ADMITTED LEAK: next-in-cluster uses the truth's cards to
  select WHICH cluster the step belongs to. Selection, not a
  feature - the module says so and states the cost. So every
  displacement figure is CONDITIONAL ON KNOWING WHICH SHELL IS
  BEING EDITED and is not end-to-end accuracy.
  NOTHING IN THIS PHASE IS OUT-OF-SAMPLE. No chronological
  hold-out was run. These are descriptive statistics.
  ONE NEW RISK: the fixed-cohort trend selects players using
  block B to measure block A. Harmless descriptively, FATAL
  predictively.

PIPELINE DEFECTS:
  1. knowledge_graph.refresh watermarks on SERIES START =
     battle time. Re-verified. A10 violation. NOT FIXED, as
     instructed.
  2. NEW AND IMPORTANT: THE DEFECT CLASS ALREADY COST THIS
     PROJECT 172,414 BATTLES. archive.py's own comment records
     it: late arrivals land BELOW a battle_time watermark
     because ingest_opponent_snapshots() (bot.py:5520) inserts
     a newly-seen opponent's whole back-catalogue. "Measured
     2026-07-29: 172,414 local battles at/below the watermark
     had never reached the archive (8% of history)", and their
     raw was then eligible for deletion. Fixed THERE by
     cursoring on battles.id (AUTOINCREMENT) and stored_at.
     knowledge_graph NEVER GOT THAT FIX.
  3. IT DOES NOT AFFECT THIS SUBSTRATE. ml/dataset.load_plays
     has NO time predicate and no watermark - full re-read.
  4. BUT THE SAME ROOT CAUSE MAKES DUMPS NON-REPRODUCIBLE.
     History grows BACKWARDS, so clustering and therefore which
     steps are edits can change. Observable already: phase3-
     edits (29,503) and phase7-steps (29,824 changes) were
     dumped 87 minutes apart and disagree.
  5. clashdb.advance_aggregation_watermark uses a battle-time
     window of the same shape. NOT MEASURED this phase.

MISTAKES:
  ONE, self-inflicted, caught by a null, and worth keeping.
  The first pass at the player-specific census used
  knowledge_mining.binomial_p at n>=3. Its normal approximation
  is documented valid only above MIN_SUPPORT=25; at k=3,n=3,
  p0=0.20 it returns 0.00027 against an exact 0.00800 - a 30x
  over-rejection. The permutation null exposed it: 1,312 of
  ~5,230 NULL cells "survived", a 25% false-discovery rate
  where BH promises 5%. Redone with an exact binomial the null
  falls to 0.0 and the observed count drops 1,649 -> 777.
  No bot caller misuses the function; this is a caution for new
  code. Recorded as FAILED APPROACHES #18b.
  Also: one README edit landed a block inside a code fence in
  section 1; caught by re-reading the region and by a fence
  parity check, and moved to section 9.

FAILED APPROACHES:
  #18a naive share-of-plays trend over a growing population.
  #18b knowledge_mining.binomial_p below n=25.
  Neither closes the phase's hypothesis; both are methods that
  produced confident wrong answers and were replaced.

DEADLOCKS:
  No VPS access again this session (not required - the cached
  dumps were sufficient, which is itself worth remembering).
  Adoption/new-card work DOES need it, plus a window straddling
  2026-09-07. Deadlocks 2-7 unchanged.

NEW DECISIONS:
  - Card-transition intelligence PROCEEDS WITH CONDITIONS, from
    ml/dataset edit events. Five conditions, artifact 24.2.
  - Out-of-sample validation comes BEFORE anything is persisted.
  - Report MARGINAL and INCREMENTAL together, always.
  - Run a permutation null on every new statistical claim.
  - Do not condition card substitution on archetype, matchup or
    result. Closed twice now.
  - Do not read a usage trend off a growing population.

OPEN QUESTIONS:
  1. Do the 777 player patterns hold OUT-OF-SAMPLE? This gates
     everything and is Phase 6.
  2. Are they a stable disposition or a phase? No within-player
     temporal split was run.
  3. What caused the fortnight-scale moves in 37 cards? No
     patch dates are recorded anywhere in either codebase.
     Recording them is cheap and would make attribution
     possible.
  4. How frequent are genuine 3+-card rebuilds? Invisible to
     this substrate by construction.
  5. Can new-card detection work? Untested; needs a live
     database and the Minion Giant window.
  6. Phase 3's non-technical question is STILL UNANSWERED: why
     did the work stop on 2026-08-03?

CURRENT SYSTEM STATE:
  UNCHANGED IN EVERY RESPECT. CLASH_OIE=off, CLASH_W3_MODE=off,
  CLASH_DUO_PROMOTE unset, kg graph stale at 2026-08-02 with no
  scheduler, recommendation_events 4 / outcomes 0. Coach Assist
  live on the pro tier. Nothing deployed.

NEXT EXACT TASK:
  Phase 6 - Chronological replay of displacement intelligence.
  Read-only. ONE question with the gate declared first: does
  per-player out->in evidence, fitted on TRAIN ONLY, beat rung
  S1 at predicting the incoming card on a chronologically
  held-out test set? Uses the existing harness, the existing
  ladder and the cached dumps already on this machine.
  PROPOSED, NOT APPROVED. DO NOT BEGIN WITHOUT EXPLICIT
  APPROVAL.

DO NOT DO:
  - Do not persist or productionise anything from Phase 5 until
    the out-of-sample replay has run. Every figure is in-sample.
  - Do not quote any Phase 5 number as predictive accuracy.
  - Do not condition substitution on archetype, matchup or
    previous result (0, 6 and 2 incremental cells; S3/S4/S5
    already measured as harmful).
  - Do not read a trend off share-of-plays without a fixed
    cohort and per-player pairing (#18a).
  - Do not use knowledge_mining.binomial_p below n=25 (#18b).
  - Do not treat a card removal as loss of confidence - 73.9%
    come back.
  - Do not report "full deck changes = 0" as behaviour; it is
    the clustering rule.
  - Do not consume, refresh or mine kg_edges.APPEARS_AFTER
    (Phase 4), and do not schedule knowledge_graph.refresh()
    unfixed (A10; 172,414-battle precedent).
  - Do not revive CLASH_W3_MODE (Phase 3).
  - Do not build the Brain around native-duel opponent history
    (Phase 1).
  - Do not rebuild any of the nine bot modules (Phase 2, A17).
  - Do not lower a support floor to produce more findings.
  - Everything in the Phase 0-4 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 4 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  Fresh-session recovery, then a full read-only audit of
  kg_edges.APPEARS_AFTER - the 493,696-observation relation
  Phases 2 and 3 recorded as the Brain's card-transition
  substrate - plus the card-intelligence questions around it.

CURRENT PHASE:
  4 - Card intelligence. COMPLETE.
  DECISION: STOP on APPEARS_AFTER.
            PROCEED WITH CONDITIONS on card transitions from
            ml/dataset edit events over `battles`.

WORK COMPLETED:
  - Read the README and all three prior Brain artifacts.
  - Traced kg_edges.APPEARS_AFTER end to end in the bot's
    source: schema, writer, every reader, generation path,
    source table, timestamps, and all six conditioning axes.
  - Swept the entire bot tree for consumers. Found TWO source
    references in total: the constant and the write.
  - Read duel_split.split and proved card disjointness is
    ENFORCED, not merely observed.
  - Read knowledge_mining to establish which relations are
    mined (APPEARS_WITH and BEATS; never APPEARS_AFTER).
  - Read opponent_profile.build_profile in full - the per-player
    behavioural representation - and cards.get_win_condition,
    the archetype classifier.
  - Verified the corpus size by exact arithmetic against the
    write algorithm and Phase 2's live totals.
  - Recovered the OIE's own substitution study (Phase 3 report,
    29,503 edit events) and mapped its six rungs onto the Phase
    4 brief's questions.
  - Wrote DECKKIES_BRAIN_PHASE4_CARD_INTELLIGENCE.md, 23
    sections as specified.
  - Updated this README: Phase 4 banner in section 1, the
    section 9 warning, experiment-log row, full experiment
    entry, FAILED APPROACHES #17, section 31, section 32, and
    four stale APPEARS_AFTER claims corrected or annotated.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE4_CARD_INTELLIGENCE.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else, in BOTH codebases. No production code, no
  server module, no schema, no migration, no flag, no model, no
  artifact, no API, no test. No row inserted, updated or
  deleted anywhere. No deploy, no commit, no push. No database
  was opened at all this session - see DATASETS below.
  Working notes live in the session scratchpad; none was added
  to either repository.

DATASETS ANALYZED:
  NONE DIRECTLY. SSH to the VPS was blocked by the environment's
  permission classifier ("Production Reads"), so no live query
  ran. Every row count in the Phase 4 artifact is REUSED from
  Phase 2's live read and is labelled as such; everything else
  is derived from source or from committed phase reports.

  Sources actually read this session:
    ~/Desktop/Clash_Bot        knowledge_graph.py, knowledge_
                               mining.py, opponent_profile.py,
                               duel_rows.py, duel_split.py,
                               cards.py, card_swap.py, clashdb.py
    server/ml/                 dataset.py, substitution.py
    server/ml/results/         phase3, phase10, phase12, phase13,
                               phase14 reports
    server/                    meta.py, deck_counter.py

KEY NUMBERS:
  APPEARS_AFTER observations                      493,696
    / 64 (the 8x8 write)          = 7,714 EXACTLY, remainder 0
  APPEARS_WITH observations (control)             339,220
    / 28 (C(8,2) per game)       = 12,115 EXACTLY, remainder 0
  => real corpus: 60 players / 4,401 series /
                  12,115 games / 7,714 transitions
  mean games per series                             2.753
  edges                                            11,946
  edge-space saturation (122 x 121 directed)        80.9%
  mean observations per edge                         41.3
  source references to APPEARS_AFTER in the bot tree     2
  readers / tests / findings / schedulers                0
  wins and trials on every one of the 11,946 edges       0
  graph freshness      watermark 20260802T013549.000Z
                       refreshed_at 2026-08-03 (40 days stale)

CARD TRANSITION FINDINGS:
  1. THE WRITE IS A CARTESIAN PRODUCT. knowledge_graph.py:
     201-206 pairs every card of game i with every card of game
     i+1. 64 observations per game pair. No set difference
     exists anywhere in the module.
  2. THE DECKS ARE CARD-DISJOINT BY CONSTRUCTION. duel_split.
     split closes a series the instant a new deck shares ONE
     card with anything already played (used_p accumulates
     across the whole series). So a -> a is impossible and a
     ONE-CARD SWAP ENDS THE SERIES AND IS DISCARDED. The corpus
     is the exact complement of a substitution sample.
  3. IT IS LOADOUT-COMPANION CO-OCCURRENCE at card granularity
     - the card-level shadow of coach.next_decks, which does
     the same job at DECK level, per player, in production.
  4. BOTH CODEBASES ALREADY DOCUMENT THE TRAP. ml/dataset.py's
     PredictionExample.previous exists specifically so the OIE
     does not "score loadout rotation as a substitution", and
     opponent_profile says a within-duel deck change "measures
     nothing". knowledge_graph walks the same loop and ignores
     both.
  5. THE REAL SUBSTRATE IS ml/substitution.py + ml/dataset.py's
     incoming/outgoing, measured in OIE Phase 3 on 29,503 real
     edit events - 3.8x more ACTUAL events than APPEARS_AFTER's
     7,714.

NEW CARD FINDINGS:
  No first-appearance date, no adoption curve and no
  displacement record exists ANYWHERE in either codebase.
  `decks` and `player_card_agg` have no timestamp column at all.
  APPEARS_AFTER cannot help: the graph is stale, so Minion
  Giant - the only live test case - has no edges in it.
  The raw material is one query away (MIN(battle_time) over
  battles.player_card_keys, daily counts for the curve).
  THE HONEST BOUNDARY: battle data can learn a card's ROLE IN
  THE META (adoption, archetypes, displacement, win rate) and
  can never learn its MECHANICS (answers air, splash, counters).
  cardRoles.json stays hand-authored, correctly.
  WORKED CASE: Minion Giant shipped 2026-09-07, reached 114,623
  rows in days, and cardRoles.json is STILL one card behind.

PLAYER FINDINGS:
  Per-player transitions from APPEARS_AFTER: IMPOSSIBLE. The tag
  is a parameter of _ingest_series and is discarded before the
  write; there is no src_kind under which one could be stored.
  0 of 60 players have usable history in that substrate.
  Player conditioning IS worth a lot, and it is measured:
  S1 (+player) beats S0 (global) by +8.0 pts competitive and
  +4.4 pts practice, top-1.
  opponent_profile.build_profile computes archetype/deck/spell/
  champion/building transitions, switch-after-loss and
  switch-after-win, all with Wilson intervals and an "Unknown"
  below MIN_SAMPLE_PROPORTION=5. It has NO individual-card
  out->in matrix, and it is persisted nowhere.
  Phase 13's history table gives the support floor: exit top-1
  goes 18.4% (0-2 edits) -> 36.6% (3-5) -> 44.7% (21+). The
  cliff is between 2 and 3, so the floor is 3.

MATCHUP FINDINGS:
  Closed by measurement, not by sparsity, in the exact form the
  Phase 4 brief asked:
    S3 +opponent ARCHETYPE  -1.60 [-2.63,-0.76] competitive
                            -0.51 [-0.77,-0.24] practice  WORSE
    S4 +opponent DECK       +0.14 [-0.15,+0.68] / -0.01  NULL
  Corroborated by counter-sniping (3,569 leak-free trials, top-1
  8.3% -> 2.7%) and by Phase 20A. Four independent negatives.
  Card-transition x opponent-archetype is a FINER grain than S3
  and would put ~2 events in the mean cell before any floor.

PREDICTION FINDINGS:
  From APPEARS_AFTER: NOT SUPPORTED on all six targets (deck,
  card, deck-change, Coach Assist, counter-deck, new-card).
  From the real substrate: card prediction MEDIUM, deck and
  deck-change and Coach Assist LOW, counter-deck NOT SUPPORTED,
  and NEW-CARD INTELLIGENCE is the only HIGH.
  The out->in signal is real (+6.85 [+5.22,+8.75]) but it is an
  EXIT ORACLE scaled by a ~50% exit hit rate, and three separate
  attempts to convert it into a better ranker failed their
  gates: Phase 10 (L1 vs L0 MRR -0.2537), Phase 12 (rescue 1.8%
  < 3% floor), Phase 13 (X5 vs X0 -9.0 pts).

STATISTICAL FINDINGS:
  Four coherent frameworks already exist and must not be
  duplicated: knowledge_mining (support 25, lift 1.5, Wilson
  lower bound, Benjamini-Hochberg q=0.05), opponent_profile
  (sample 5, transition 3, Wilson, "Unknown"), ml/substitution
  (support 3.0 with backoff), and the phase reports' paired
  bootstrap on players with an explicit stop-gate.
  APPEARS_AFTER fails every one of them. Its worst failure is
  INDEPENDENCE: 64 observations per decision means any interval
  over `count` is ~8x too narrow, and MIN_CONFIDENT_SAMPLE=10 is
  satisfied by a SINGLE game pair.
  A CARTESIAN PRODUCT *IS* THE INDEPENDENCE NULL - expected
  count is the product of the two marginals, so lift is ~1.0 by
  construction and mining it would return global card popularity
  dressed in p-values.

LEAKAGE FINDINGS:
  1. Every edge from a series carries the SERIES START time, so
     all 64x(g-1) observations - including those describing the
     last game - are stamped as if known at the first. A replay
     filtering on first_seen/last_seen admits its own future.
  2. The aggregate carries NO PLAYER, so policy.assert_no_future
     has nothing to filter. A subject in the table leaks their
     own future into their own prediction, and no schema change
     short of a rebuild can prevent it.
  3. NEW DEFECT FOUND: knowledge_graph.refresh watermarks on
     SERIES START TIME, i.e. battle time. That violates decision
     A10 and is the documented fault that left player_stats_agg
     48% short. A late-arriving series is skipped PERMANENTLY.

MISTAKES:
  One, mechanical. A bash heredoc carrying the whole artifact
  exceeded the shell's command-length limit (ENAMETOOLONG), and
  a second attempt failed to parse. Recovered by writing the
  sections to the scratchpad and concatenating. No content was
  lost and nothing in the repository was touched by the failed
  attempts.

FAILED APPROACHES:
  Added as FAILED APPROACHES #17: "kg_edges.APPEARS_AFTER as
  card-transition evidence". The transferable lessons are
  recorded there: do not infer a relation's meaning from its
  name; a row count is not an event count; near-saturation of an
  edge space is a smell; and a module that ignores a rule its
  siblings state in prose is a failure class worth sweeping for.

DEADLOCKS:
  NEW: no VPS access this session. SSH was blocked by the
  environment's permission classifier. It did not block the
  phase - the decisive conclusions are source-derived and the
  arithmetic is exact - but it means four confirmatory queries
  remain unrun. They are written out verbatim in section 23.4
  of the artifact and none of them can change the decision.
  Existing deadlocks 2-7 are unchanged.

NEW DECISIONS:
  - STOP on kg_edges.APPEARS_AFTER. Do not consume it, do not
    schedule a refresh for it, do not mine it. If the graph is
    ever revived, drop the relation or rename it
    LOADOUT_FOLLOWS.
  - Do not schedule knowledge_graph.refresh() as it stands; it
    violates A10.
  - Card-transition intelligence PROCEEDS WITH CONDITIONS, from
    ml/dataset edit events over `battles`, never from kg_edges.
    Five conditions, stated in artifact section 23.3.
  - Census before model: the first Phase 5 deliverable is a
    COUNT of players who support a per-player out->in statement,
    not a predictor.

OPEN QUESTIONS:
  1. How many players support a per-player out->in transition
     statement at a floor of 3 edits? THE single most valuable
     number Phase 4 could not produce. Bounded, not answered.
  2. Was refresh(full=True) ever run twice? If so the corpus is
     3,857 events, not 7,714. One query settles it; no
     conclusion changes.
  3. Phase 3's non-technical question is STILL UNANSWERED: why
     did the work stop on 2026-08-03?
  4. Showdown_Friendly is 66% of duel_timeline and is not a duel
     format; duel_split imposes a duel structure on it. Whether
     that imposition is sound was out of scope here.

CURRENT SYSTEM STATE:
  UNCHANGED IN EVERY RESPECT. CLASH_OIE=off, CLASH_W3_MODE=off,
  CLASH_DUO_PROMOTE unset, kg graph stale at 2026-08-02 with no
  scheduler, recommendation_events 4 / outcomes 0. Coach Assist
  live on the pro tier, as before. Nothing was deployed.

NEXT EXACT TASK:
  Phase 5 - Card adoption and displacement intelligence, from
  `battles`. Read-only, two halves: (a) first appearance,
  adoption curve, early adopters, deck and archetype
  associations, with Minion Giant as the worked case;
  (b) per-player and global out->in transition counts from
  ml/dataset edit events, floor 3, Wilson intervals,
  chronological split, delivering the PLAYER COUNT first.
  PROPOSED, NOT APPROVED. DO NOT BEGIN WITHOUT EXPLICIT
  APPROVAL.

DO NOT DO:
  - Do not consume, refresh or mine kg_edges.APPEARS_AFTER.
  - Do not quote "493,696 card transitions" again. It is 7,714
    events multiplied by 64, and they are not transitions.
  - Do not schedule knowledge_graph.refresh() unmodified (A10).
  - Do not reopen S3 (opponent archetype), S4 (opponent deck),
    S5 (previous result), counter-sniping or Phase 20A. All
    measured, all lost, intervals recorded.
  - Do not revive CLASH_W3_MODE (Phase 3).
  - Do not build the Brain around native-duel opponent history
    (Phase 1).
  - Do not rebuild any of the nine bot modules (Phase 2, A17).
  - Do not create a second statistical framework; four already
    exist.
  - Do not lower a support floor to produce more results.
  - Everything in the Phase 0, 1, 2 and 3 DO NOT lists applies.
```

```
============================================================
PREVIOUS SESSION HANDOFF  (Phase 3 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  90-day shadow replay and outcome-matching feasibility.
  Read-only. Determine whether the existing prediction-memory
  loop could ever fill, and why it was built but never
  activated.

CURRENT PHASE:
  3 - Shadow replay. COMPLETE. DECISION: STOP.

WORK COMPLETED:
  - Read the README and the Phase 1 and Phase 2 artifacts.
  - Reconstructed the CLASH_W3_MODE state machine from source.
  - Traced the recommendation event lifecycle field by field.
  - Traced match_outcomes() completely and drew its logic.
  - Forensics on all four real events, in both tables.
  - Pair-encounter census over 785,466 duel_timeline rows in the
    last 90 days.
  - Eight-point match-window sweep, anchored on real encounters
    only, leak-free.
  - Modelled ambiguity with the matcher's own rule.
  - Read the bot's git history for the August 3 cluster and the
    original design rationale.
  - Wrote DECKKIES_BRAIN_PHASE3_SHADOW_REPLAY.md.
  - Updated this README.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE3_SHADOW_REPLAY.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else, in BOTH codebases. Production code 0,
  database writes 0, schema changes 0, deployments 0, git pushes
  0, flags changed 0. The bot database was opened mode=ro with
  PRAGMA query_only=1. Git history was READ, never modified.
  The bot repo's one dirty file (docs/CLOUD_MIGRATION.md)
  predates this session by 17 days - verified by mtime.
  The replay script lives in the scratchpad and /tmp on the VPS;
  it was not added to either repository.

DATASETS ANALYZED:
  /var/clashbot/battles.db (77 GB, VPS, read-only)
    duel_timeline      785,466 rows in the last 90 days
    recommendation_events    4 rows (forensics on all four)
    suggestion_feedback      4 rows, 1 distinct user
    bot_health             275 rows (no command counter)
  ~/Desktop/Clash_Bot git history, 45 commits 2026-08-01..08-06.

TESTS / QUERIES RUN:
  p3_replay.py on the VPS (~40 s): event forensics, pair
  structure, window sweep, ambiguity model, event-volume source
  check. No repository test suite was run; nothing changed that
  could affect one.

KEY NUMBERS:
  90-day hypothetical events        IMPOSSIBLE TO RECONSTRUCT
  match rate, optimistic                         20.80%
  match rate, realistic (ambiguity)               6.60%
  events needed for 200 matched            962 - 3,030
  recorded !suggestion traffic, all time   4 events, 1 user
  events/day, measured                    ~1 over 4 days (dev)
  days to 200 matched at 1 event/day        3,030 (8.3 years)

  WINDOW SWEEP (anchors 785,466):
     30 min  20.29%  |  60 min  20.62%  | 120 min  20.80%
    180 min  20.89%  | 240 min  20.96%  | 360 min  21.04%
    720 min  21.15%  | 1440 min 21.50%
    30 min -> 24 h   = +1.21 points over a 48x widening

  pairs meeting EXACTLY ONCE                     92.65%
  anchors that are a pair's last battle         603,944
  median gap for pairs that DO repeat          5.6 min
  of repeating pairs, within 120 min              90.02%
  claimable battles claimed by 2+ (ambiguous)     68.26%

  FOUR REAL EVENTS: no_candidate 4, ambiguous 0, matched 0.
  Nearest candidate for the three matchable ones: 185.3 HOURS
  (11,120.9 min) = 93x the window. One opponent never seen again.

KEY DISCOVERIES:
  1. THE WINDOW WAS NEVER THE PROBLEM. +1.21 points over a 48x
     widening. The cause is that 92.65% of pairs meet once.
  2. WIDENING THE WINDOW MAKES IT WORSE. 68.26% of claimable
     battles are claimed by 2+ prior encounters and refused by
     the matcher's ambiguity rule; widening raises ambiguity
     faster than coverage. (A20)
  3. EVENT VOLUME CANNOT BE RECONSTRUCTED. Events are written
     per !suggestion COMMAND; command traffic is logged nowhere
     - no table, no counter, no /opt/clashbot/logs directory.
     Phase 3 refused to estimate it. (A19)
  4. THE GAP DISTRIBUTION IS BIMODAL. Median 5.6 minutes for
     pairs that repeat, then nothing. An opponent is met again
     within minutes or never. The 120-minute window sits at
     roughly the p90 and is already generous.
  5. WHY IT WAS LEFT DARK IS DOCUMENTED, not inferred. Commit
     e87b9dc: "RECOMMENDATION: do NOT promote CLASH_W3_MODE to
     primary. It is already off." Because a 302-recommendation
     dry run found the recommender giving 99.7% of users the
     SAME DECK (miner 301, bridge-spam 1; diversity 0.032 bits).
  6. THE ROOT CAUSE IS DIAGNOSED. Commit 1c2fc52: W2's
     distributions carry 86% of maximum entropy (3.52 of 4.09
     bits), so ExpectedWR collapses to each deck's unweighted
     mean win rate - a per-deck constant - and the argmax of a
     constant is the same deck for everyone.
  7. OFFLINE COMPARISON IS MATHEMATICALLY INAPPLICABLE. Commit
     7f15976: W3 is deterministic, so every propensity is 0 or
     1 and IPS/DR are undefined, not merely noisy. O1 and O3
     agree 0/60, so the agreement method can never compare them
     however much data accumulates.
  8. ALMOST EVERYTHING THE BRAIN WANTS ABOUT PLAYERS IS ALREADY
     IN `battles`. The loop uniquely provides CALIBRATION - the
     one causally safe thing it could deliver - and that is
     exactly what the unreachable gate protects.
  9. EVERY MODULE WAS ADDED 2026-08-02/03 AND NEVER TOUCHED
     AGAIN. 45 commits in five days, four negative findings in
     subject lines, then six weeks of silence.

IDENTITY FINDINGS:
  Unchanged. All four events belong to one player. Tags were
  hashed in every output; none printed. No new exposure.

COVERAGE FINDINGS:
  Not re-measured; Phase 1 stands. Phase 3 adds the pair-
  encounter structure of the PRACTICE population: 603,944 pairs,
  92.65% meeting once - the same transience Phase 1 found in
  native duels (99.22%), slightly less extreme.

TEMPORAL-LEAKAGE FINDINGS:
  The replay is anchored on real encounters and uses only battle
  times; no outcome is consulted. The matcher itself is sound:
  events are written BEFORE the outcome is knowable, matching is
  strictly forward in time, and replay reads the distribution
  STORED on the event rather than re-running W2, so a replay
  months later reproduces the same decision even after a
  retrain.

DATA QUALITY FINDINGS:
  model_version and artifact_version are NULL on all four real
  events, so rows cannot be attributed to a model.
  No duplicate protection on event creation - three of four rows
  share a timestamp and a pair. This is the origin of the
  ambiguity problem.
  The 16 MB JSONL cap stops logging silently (log.full).
  /opt/clashbot/logs/ does not exist, confirming _observe() has
  never run in production.

STOP-GATE:
  DECISION: STOP. Three independent closures, each sufficient:
  traffic (4 events by 1 user vs ~3,030 needed), structure
  (6.6% match rate, window irrelevant, ambiguity refusing
  68.26%), and a known unfixed product defect.

MISTAKES:
  None this session. One process note carried from Phase 2: an
  Edit that inserts a banner above a heading a previous phase
  already wrapped can duplicate that heading - grep the heading
  structure after every such edit. Done here; clean.

FAILED APPROACHES:
  One added to section 20 as entry 16: the recommendation loop
  as the Brain's prediction-memory layer. Closed by traffic, by
  structure, and by a known defect.

DEADLOCKS:
  #1 VPS access works. #2-#7 unchanged.
  NEW: the programme's blocking question is not technical. The
  repository documents every step up to "randomised assignment
  is the only valid path left" and then stops. Whether that was
  "not worth it", "not yet", or attention moving elsewhere is
  NOT recorded, and no script can determine it.

NEW DECISIONS:
  A19  A pipeline fed by human commands cannot be back-filled.
       Find the usage log FIRST; if there is none, the question
       is about product adoption, not data.
  A20  Widening the match window is the wrong instinct. +1.21
       points for a 48x widening, and ambiguity rises faster
       than coverage.

DECISIONS REVERSED:
  None. Phases 0, 1 and 2 stand unchanged. Phase 3 adds a third
  closure rather than overturning anything.

NEW RISKS:
  - Turning on CLASH_W3_MODE today would still recommend the
    same deck to nearly everyone; nothing has changed since the
    RCA.
  - expected_wr ~79.6% is a population-bias artifact and would
    be a false claim if shown to users.
  - The matcher reads only duel_timeline, which contains no
    CW_Duel_1v1, so a recommendation followed by a real war duel
    is structurally unmatchable.
  - Silent event loss: record_recommendation returns None on any
    sqlite3.Error with only a telemetry counter as evidence.

OPEN QUESTIONS:
  1. WHY DID THE WORK STOP ON 2026-08-03? The blocking question,
     and it is for the author, not for a script.
  2. Phase 1 option (a) pool construction - open, unapproved.
  3. Phase 1 option (b) card intelligence - open, unapproved.
     kg_edges.APPEARS_AFTER holds 493,696 card transitions,
     [CORRECTED BY PHASE 4: they are not transitions]
     stale and unconsumed.
  4. Identity policy - unchanged, still unanswered.
  5. timestamp="9999" bug - open since Phase 0, still cheap.
  6. Should this project edit the bot's repository at all?

CURRENT PHASE:
  3 COMPLETE. No phase 4 proposed.

NEXT EXACT TASK:
  NONE technical. Ask the author why the work stopped on
  2026-08-03. If a technical task is wanted instead, the only
  two live options are Phase 1's (a) and (b), both unapproved.
  See section 32.

DO NOT:
  - Do not turn on CLASH_W3_MODE. The single-deck defect is
    diagnosed and unfixed.
  - Do not widen MATCH_WINDOW_MINUTES. Measured to make matching
    worse (A20).
  - Do not lower MIN_MATCHED_OUTCOMES. It is the floor of the
    easier of two gates; the experiment framework needs 100
    matched outcomes PER ARM.
  - Do not try to back-fill recommendation events (A19).
  - Do not delete any of the nine bot modules (A17).
  - Do not automate the learning step (A18).
  - Do not write to the bot database, ever. mode=ro.
  - Do not modify git history.
  - Everything in the Phase 0, 1 and 2 DO NOT lists applies.

============================================================
PREVIOUS SESSION HANDOFF  (Phase 2 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  Existing intelligence infrastructure audit. Read-only.
  Investigate the four undocumented tables Phase 1 found and
  determine what of the Brain already exists.

CURRENT PHASE:
  2 - Infrastructure audit. COMPLETE.

WORK COMPLETED:
  - Re-read the README and the Phase 1 census.
  - Searched THIS repo for the four tables: ZERO code references.
  - Audited the BOT's source at ~/Desktop/Clash_Bot, 76 modules,
    which no prior Brain phase had opened.
  - Traced the full recommendation pipeline end to end and marked
    every stage.
  - Inspected all 4 recommendation events, all 1,460 kg_findings,
    27,904 kg_edges and 785,587 duel_timeline rows on the live
    VPS database, mode=ro.
  - Proved duel_timeline is a byte-identical subset of battles.
  - Found the exact cause of 0 outcomes by re-implementing the
    matcher's window rule read-only.
  - Ran the bot's 8 Brain-relevant test suites.
  - Wrote DECKKIES_BRAIN_PHASE2_INFRASTRUCTURE_AUDIT.md.
  - Updated this README, recording two failed assumptions and
    correcting the Phase 0 player-memory table in place.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE2_INFRASTRUCTURE_AUDIT.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else, in BOTH codebases. No production code, no
  schema, no migration, no row inserted/updated/deleted, no flag
  changed, no model, no API, no deploy, no commit, no push.
  The bot database was opened mode=ro and never written.
  Probe scripts live in the session scratchpad and /tmp on the
  VPS; none was added to either repository.

DATASETS ANALYZED:
  /var/clashbot/battles.db (77 GB, VPS, read-only)
    recommendation_events        4 rows
    recommendation_outcomes      0 rows
    kg_edges                27,904 rows / 60 distinct players
    kg_findings              1,460 rows
    duel_timeline          785,587 rows
    suggestion_feedback          4 rows
    models/v0001, models/v0002 on disk
  Source: ~/Desktop/Clash_Bot, 76 Python modules.

TESTS / QUERIES RUN:
  Bot test suites (all green, homegrown check() pattern):
    test_artifacts 45 | test_experiment_manager 42 |
    test_opponent_profile 41 | test_knowledge_mining 34 |
    test_counterfactual_eval 32 | test_recommendation_learning 31 |
    test_knowledge_graph 30 | test_recommendation_tracking 25
    TOTAL 280 passed, 0 failed.
  Read-only VPS probes: schema dump, mode distributions, kg edge
  and finding breakdowns, duel_timeline/battles overlap on a
  5,000-row sample, and a re-implementation of the matcher's
  120-minute window rule.
  No suite in THIS repo was run; nothing here changed that could
  affect one.

KEY NUMBERS:
  code references to the 4 tables in THIS repo          0
  bot modules implementing Brain components             9
  bot tests covering them              280 passed, 0 failed
  recommendation_events                                 4
  recommendation_outcomes                               0
  kg_findings                     1,460 (100% survived FDR)
    strong_association 1,415 | rare_but_reliable 25 |
    bridge_card 20 (p=1.0, not a hypothesis test)
  kg_findings that are player-specific                  0
  kg_edges                                         27,904
  distinct PLAYERS in kg_edges                         60
  APPEARS_AFTER card transitions      11,946 edges / 493,696 obs
    [CORRECTED BY PHASE 4: an 8x8 Cartesian product over
     card-disjoint decks. 7,714 real events x 64.]
  duel_timeline rows                              785,587
  duel_timeline pairs meeting >1 battle    44,410 (7.35%)
  duel_timeline rows absent from battles                0
  model bundles on disk    2, both n_train=0, val_acc=0.0

KEY DISCOVERIES:
  1. THE BRAIN IS LARGELY ALREADY BUILT AND SWITCHED OFF.
     Nine tested modules in the bot's codebase implement
     prediction memory, outcome reconciliation, calibration,
     promotion gates, randomised experiments, versioned
     artifacts, FDR-corrected mining, a knowledge graph and
     per-player behavioural profiling.
  2. ONE FLAG DARKENS ALL OF IT. bot.py:2327
     `if deck_recommender.mode() != "off"` - CLASH_W3_MODE
     defaults to "off" and is absent from /opt/clashbot/.env.
     coach_engine is nested INSIDE that branch, so its own
     "shadow" default never applies.
  3. match_outcomes() RUNS IN PRODUCTION every poll, ungated
     (bot.py:5216). It is a correctly functioning matcher with
     nothing to match - not missing infrastructure, which is what
     Phase 1 recorded.
  4. WHY 0 OUTCOMES, measured: all 4 events have ZERO candidate
     battles inside the 120-minute window. Not ambiguity (0
     contested battles). The window is unvalidated at scale.
  5. duel_timeline is a BYTE-IDENTICAL SUBSET of battles -
     5,000/5,000 identical, 0 absent. It holds NO new
     information. Its value is one access path: the only
     (player_tag, opponent_tag) index in the database. battles
     has five indexes and none covers the opponent tag.
  6. duel_timeline contains NO native duels - CW_Duel_1v1
     (93,035 rows) is entirely absent. It is 66% Showdown_Friendly
     and 32% Friendly, i.e. the practice population.
  7. It does have 44,410 repeated player-opponent pairs against
     the native substrate's 723 - 61x better - but on the
     practice domain, whose bands were measured not to rank.
  8. kg_findings is card/archetype tautologies. 100% FDR
     survival is a warning, not an endorsement.
  9. EVERYTHING CONVERGES ON 2026-08-03: the events, the kg
     watermark, both model bundles, the feedback rows. One burst
     of development, exercised by hand, never switched on.

IDENTITY FINDINGS:
  Unchanged from Phase 1. The recommendation and duel_timeline
  tables hold real player tags, as does the rest of the bot
  database. No new exposure; nothing containing tags was written
  to either repository. The Phase 0/1 identity question is still
  open and still the account holder's.

COVERAGE FINDINGS:
  Not re-measured. Phase 1's numbers stand. Phase 2 adds that
  duel_timeline cannot improve them, being a subset of battles.

TEMPORAL-LEAKAGE FINDINGS:
  None introduced - nothing was measured predictively this
  phase. Worth recording that the bot's own modules enforce the
  same discipline: opponent_profile computes only from COMPLETED
  series and reads game i -> i+1 within one series; knowledge_graph
  is watermarked on duel_timeline.battle_time; recommendation
  events are written BEFORE the outcome is knowable, which is
  what makes them evidence rather than hindsight.

DATA QUALITY FINDINGS:
  bridge_card findings carry p_value = 1.0 and are recorded as
  survived_fdr = 1. They are a centrality measure, not a
  hypothesis test; counting them as FDR survivors is a reporting
  category error.
  Both model bundles carry all-zero metrics - scaffolding, not
  trained models.
  kg_edges AVOIDS relation is defined and has zero edges.
  duel_timeline holds 304 16-card and 192 24-card lists per 40k
  sampled, from Duel_1v1_Friendly loadouts leaking in.

STOP-GATE:
  N/A - Phase 2 had no gate. A gate is PROPOSED for Phase 3:
  MIN_MATCHED_OUTCOMES = 200, which is the bot's own existing
  promotion threshold, not a new invention.

MISTAKES:
  One, self-inflicted and repaired. An Edit into section 1
  duplicated the Phase 1 banner heading and deleted the original
  "The honest framing of the opportunity" heading. Caught by
  grepping the heading structure immediately after the edit and
  restored. When inserting a banner above a heading that a
  previous phase already wrapped, check for the duplicate.

FAILED APPROACHES:
  Two ASSUMPTIONS added to section 20 as entries 14 and 15:
   14. "It does not exist because this repo has no code for it."
       The writers were in the other codebase all along.
   15. "FDR survival implies a useful finding." 100% survival
       means the correction never bound.

DEADLOCKS:
  #1 VPS access works (unchanged from Phase 1).
  #2-#7 unchanged.
  NEW: the loop may be structurally unable to fill. All four
  existing events fell outside the 120-minute match window, and
  the gate needs 200 matched outcomes. Phase 3 exists to
  measure this.
  NEW: two codebases, two deploy mechanisms. Any Brain work now
  spans the bot's repo, which this project has never edited.

NEW DECISIONS:
  A17  DO NOT REBUILD what the bot already implements. Nine
       modules, 280 tests, encoding decisions that cost
       measurements.
  A18  The learning step stays HUMAN until proven otherwise.
       recommendation_learning refuses to retrain because the
       outcome data is self-selected and non-causal - the same
       confound that closed Phase 20A.

DECISIONS REVERSED:
  None reversed. Two Phase 0 CLAIMS corrected in place with
  PREVIOUS/NEW EVIDENCE/NEW CONCLUSION/WHY blocks: the section 1
  framing, and the section 7 player-memory table. Phase 0 and
  Phase 1 text is preserved beneath its own correction.

OPEN QUESTIONS:
  1. Would the loop ever fill? THE BLOCKING QUESTION. Phase 3.
  2. Why was all of this built and never switched on? Nobody has
     asked the person who wrote it. That answer may be worth
     more than any measurement here.
  3. Is the 120-minute match window right? All 4 events missed it.
  4. Identity policy - unchanged and still unanswered.
  5. Should this project be editing the BOT's repository at all?
     It never has. Everything Phase 2 found lives there.
  6. Phase 1 options (a) pool construction and (b) card
     intelligence remain open and unapproved.
  7. timestamp="9999" bug - still open from Phase 0, still cheap.

CURRENT PHASE:
  2 COMPLETE. Phase 3 PROPOSED, NOT APPROVED.

NEXT EXACT TASK:
  Phase 3 - a read-only dry run: if CLASH_W3_MODE had been
  "shadow" for 90 days, how many events would exist, how many
  would match, and would that clear MIN_MATCHED_OUTCOMES = 200?
  Sweep the match window. Write nothing. See section 32.
  AWAIT APPROVAL.

DO NOT:
  - Do not rebuild any of the nine bot modules (A17).
  - Do not turn on CLASH_W3_MODE. It is the one flag with a
    user-visible output path and was defaulted off deliberately.
  - Do not schedule a knowledge-graph refresh. 60 players and
    archetype tautologies; refreshing faster fixes neither.
  - Do not present kg_findings' 1,460 as validated discoveries.
  - Do not treat duel_timeline as a new substrate. It is a
    byte-identical subset of battles.
  - Do not automate the learning step (A18).
  - Do not write to the bot database, ever. mode=ro.
  - Do not edit the bot's repository without explicit approval.
  - Everything in the Phase 0 and Phase 1 DO NOT lists applies.

============================================================
PREVIOUS SESSION HANDOFF  (Phase 1 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  Native duel substrate census. Read-only. Test the Brain's
  central candidate-coverage premise against a hard stop-gate
  BEFORE any schema is designed.

CURRENT PHASE:
  1 - Native duel substrate census. COMPLETE. STOP-GATE: FAIL.

WORK COMPLETED:
  - Re-read DECKKIES_BRAIN_README.md.
  - Established VPS access (Phase 0 deadlock #1 partially lifted).
  - Listed sqlite_master directly; found SEVEN tables no prior
    session had recorded.
  - Wrote and ran three read-only jobs on the VPS, reusing
    ml.evaluation.phase21a's own parser/vocabulary/legality rule.
  - Reproduced the Phase 21A baseline as a control.
  - Measured six evidence levels with per-step strictly-prior
    cutoffs, separating mechanism from evidence source.
  - Decomposed the zero-pool by CAUSE and derived the ceiling.
  - Wrote DECKKIES_BRAIN_PHASE1_DUEL_CENSUS.md.
  - Updated this README (sections 1, 6.5b, 19, 20, 21, 23, 24,
    31, 32) recording one overturned conclusion in full.

FILES CREATED:
  - DECKKIES_BRAIN_PHASE1_DUEL_CENSUS.md

FILES MODIFIED:
  - DECKKIES_BRAIN_README.md

FILES NOT MODIFIED:
  Everything else. No production code, no prediction engine, no
  Coach Assist, no schema, no migration, no Brain table, no
  model, no API, no test, no artifact. Nothing committed,
  pushed or deployed. The bot database was opened mode=ro with
  PRAGMA query_only=1 and NEVER written.
  Census scripts live in the session scratchpad and were
  deliberately NOT added to the repo (they read real tags; the
  GitHub repo is public).

DATASETS ANALYZED:
  /var/clashbot/battles.db (77 GB, VPS, read-only)
    battle_raw  705,440 rows total; 99,920 native duel rows
    battles     ~6.69M rows; 100,203 native duel rows
    plus tracked_players, duel_timeline, kg_*, recommendation_*

TESTS / QUERIES RUN:
  brain_census.py  (163s) - main census
  brain_control.py (136s) - Phase 21A-exact control + ceiling
  brain_supp.py    (368s) - Level D attribution, crowns, retention
  plus a 300-row join verifying battles preserves round order.
  No repository test suite was run; nothing in the repo changed
  that could affect one.

KEY NUMBERS:
  native duel raw rows                        99,920
  parse rejects                                    0  (100% clean)
  unique duels after dedupe                   93,541
  duel games                                 226,046
  unique participants                        111,516
  participants in tracked_players        1,473 (1.3%)
  participants appearing in exactly 1 duel      72.47%
  player-opponent pairs                       92,135
  pairs meeting exactly once                    99.22%
  test steps (evaluation population)           79,894

  ZERO-POOL:
    B0 Phase 21A baseline                       76.59%
    B1 cutoff mechanism only                    61.58%   +15.01
    A  native duel history                      59.94%   +16.65
    B  player x this opponent                   98.69%   -22.10
    C  player x opponent archetype              84.43%    -7.85
    D  A + battles history                      47.65%   +28.93
    battles history ALONE                       55.93%   +20.66
    CEILING for duel history                    57.34%

  ATTRIBUTION: cutoff +15.01 | duel evidence +1.64 | battles +12.29

KEY DISCOVERIES:
  1. The duel population is TRANSIENT. 72.47% of participants
     appear once; 57.34% of steps have a subject never seen
     before. This is the ceiling that failed the gate.
  2. `battles` history ALONE (55.93%) beats duel history alone
     (59.94%). The frozen engine already reads `battles`.
  3. The cutoff mechanism is worth 15.01 points - more than any
     evidence source tested. Attribute it separately or a future
     evaluation will credit a source with 15 points it did not
     earn. (Decision A15.)
  4. recommendation_events / recommendation_outcomes EXIST in the
     bot DB with exactly the Brain's prediction-memory shape, and
     hold 4 and 0 rows. Schema is the easy half.
  5. kg_findings holds 1,460 findings with p_value and
     survived_fdr - a populated pattern store with a noise gate.
  6. duel_timeline (783,949 rows) is a third duel substrate with
     the only opponent-keyed index in the database. NOT USED,
     contents Not verified.
  7. A third native duel mode exists (Duel_1v1_Tournament, 717
     rows) that phase21a.NATIVE_MODES omits.
  8. battles.player_card_keys IS the raw rounds concatenated in
     order - verified 300/300 - so duel decks are recoverable by
     chunking. But retention is identical in both tables, so this
     is robustness, not depth.

IDENTITY FINDINGS:
  Real tags present on BOTH sides of 100% of 99,920 payloads.
  0 malformed, 0 self-duels, 0 missing. battle_raw.player_tag ==
  team[0].tag on 100%. NO battleId field exists (0%), so identity
  must be battleTime + sorted tag pair (decision A16); that
  folded 6,379 duplicate perspectives with ZERO disagreements.
  Shadow-log hashes ARE joinable in the direction that matters:
  the ingest side always holds the real tag and can hash forward
  with the same salt, which reconcile_from_tags already does. No
  relaxation of the privacy model is required.
  STILL OPEN: whether a Brain store keys on real tags. Note
  server/ml/results/cohorts/tags*.json already holds 5,680 real
  tags in a PUBLIC repo - a pre-existing condition.

COVERAGE FINDINGS:
  See KEY NUMBERS. The premise fails by 3.35 points against the
  gate, and its ceiling (~19.25) is itself below 20, so no
  implementation can pass. Level A landed within 2.97 points of
  the ceiling.
  PRECISION: baseline and Level A are from the 3-mode census;
  the ceiling is from the 2-mode control. The populations differ
  by ~0.5% (the 717 Duel_1v1_Tournament rows), so the ceiling
  subtraction is good to within half a point and is quoted as
  ~19 rather than 19.25. Artifact section 7.5 states this.
  Anyone reopening this should recompute both on one population.

TEMPORAL-LEAKAGE FINDINGS:
  Levels A-D used a per-step strictly-prior cutoff, stronger than
  Phase 21A's global split: series walked in battle_time order,
  a test series evaluated BEFORE being absorbed, strict < on
  every battles row in level D. Truth never consulted during pool
  construction. Full audit in the artifact, section 9.
  One trap recorded: B0->B1 is a mechanism change worth 15.01
  points and must be held constant in any future comparison.

DATA QUALITY FINDINGS:
  The cleanest substrate this project has measured.
  0 malformed payloads, 0 missing tags, 0 missing/malformed
  decks, 0 unresolvable card names, 0 impossible crowns, 0 draws,
  0 inconsistent side assignments, 0 duplicate-perspective
  disagreements, and 0 card-reuse violations across 93,541
  series - confirming the duel disjointness rule at 4x the scale
  Phase 21A verified it.
  One caveat: rounds[].kingTowerHitPoints absent on ~9% of
  rounds (outcome-only field, blocks nothing).

STOP-GATE:
  FAIL. 16.65 points against ~20. Ceiling 19.25 points.

MISTAKES:
  One, caught before it reached a conclusion. The first framing
  would have credited the whole B0->A movement (+16.65) to the
  duel substrate. Splitting B1 out showed 15.01 of it is the
  cutoff mechanism and only 1.64 is duel evidence. Had B1 not
  been measured, this session would have reported a near-pass
  for the wrong reason.
  Also: an initial hypothesis that chunking `battles` would
  reach further back than battle_raw was wrong - retention is
  identical. Corrected in the artifact rather than dropped.

FAILED APPROACHES:
  Two added to section 20 as entries 12 and 13:
   12. Native duel history as the answer to candidate coverage.
   13. Opponent-conditioned candidate pools (levels B and C).
  Entry 13 closes Player x Opponent on DATA AVAILABILITY, which
  is stronger than the counter-sniping closure on model quality.

DEADLOCKS:
  #1 UPDATED - VPS access works; measurement is possible, just
     not locally. The C: battles.db is a 4,096-byte empty husk.
  #5 UPDATED - the 71.7% zero-pool now has a measured cause.
  Unchanged: #2 rollout gate, #3 unbacked research evidence,
  #4 loadout representation, #6 split deploys, #7 no DB backup.
  NEW: the programme has no approved next phase. That is a
  decision blocker, not a technical one.

NEW DECISIONS:
  A14-REVISED  coverage is the right target; duel history is not
               the means. (A14 half confirmed, half overturned.)
  A15          evidence source and cutoff mechanism must be
               attributed separately.
  A16          a duel's identity is battleTime + sorted tag pair.

DECISIONS REVERSED:
  A14, in part. Recorded in full with PREVIOUS CONCLUSION / NEW
  EVIDENCE / NEW CONCLUSION / WHY IT CHANGED, in both section 1
  and section 24. Phase 0's section 1 subsection is preserved
  unedited beneath its own correction.

OPEN QUESTIONS:
  1. Which of the three options in section 32: (a) re-aim at
     pool construction on the frozen engine, (b) re-aim at card
     intelligence, (c) stop. THIS IS THE BLOCKING QUESTION.
  2. Identity policy: does a Brain store key on real tags?
     Unchanged from Phase 0 and still unanswered.
  3. What is in duel_timeline (783,949 rows, opponent-indexed)?
     Not verified.
  4. Why were recommendation_events / kg_findings built and
     abandoned? Understanding that failure is worth more than
     rebuilding the same schema.
  5. Should the timestamp="9999" bug be fixed and measured?
     Still open from Phase 0; still cheap.

CURRENT PHASE:
  1 COMPLETE. No phase 2 proposed or approved.

NEXT EXACT TASK:
  NONE. Await the account holder's decision between options
  (a), (b) and (c) in section 32. Do not begin a Phase 2.

DO NOT:
  - Do not build a Brain store on the duel-coverage premise.
    It is closed on a measured ceiling.
  - Do not re-test player x opponent conditioning. 99.22% of
    pairs meet once.
  - Do not quote Level D's +28.93 as a duel-substrate result.
    It is 12.29 battles + 1.64 duel + 15.01 mechanism.
  - Do not compare a new evidence source against Phase 21A's
    published numbers without holding the cutoff constant (A15).
  - Do not write to the bot database, ever. mode=ro.
  - Do not commit anything containing real player tags.
  - Do not modify server/ml/production/ without approval.
  - Everything in the Phase 0 DO NOT list still applies.

============================================================
PREVIOUS SESSION HANDOFF  (Phase 0 - archived, never delete)
============================================================

SESSION DATE: 2026-09-12

SESSION OBJECTIVE:
  Phase 0. Complete repository discovery and audit of the existing
  prediction system. Create DECKKIES_BRAIN_README.md. Implement
  nothing.

CURRENT PHASE:
  0 — Repository audit. COMPLETE.

WORK COMPLETED:
  - Read the frozen contract (phase22-final-spec.md) in full.
  - Audited server/ml/ : production package (9 files), research
    package (17 modules), 20 evaluation phases, 3 artifacts.
  - Audited server/coach.py, duel_zone.py, duel_combos.py,
    deck_counter.py, team_analysis.py, clash_data.py.
  - Read phase reports 17b, 18, 20b, 20c, 20d, 21a.
  - Analysed the shadow log: 2,620 entries, 1,464 player hashes.
  - Verified the API surface (22 routes) and the frontend
    OpponentRead client contract.
  - Ran all 25 ML Python test suites.
  - Wrote DECKKIES_BRAIN_README.md.

FILES CHANGED:
  - DECKKIES_BRAIN_README.md  (CREATED — the only file written)

FILES NOT CHANGED:
  Everything else. No source file, no test, no artifact, no
  schema, no config, no deployment. Nothing pushed. Nothing
  deployed. No production behaviour altered.

TESTS RUN:
  All 25 server/test_ml_*.py + test_oie_ui.py +
  test_shadow_durability.py suites.
  Plus a direct call to ml.features._hours_between to prove
  KNOWN BUGS #1.
  Plus git ls-files checks on server/ml, api/, and
  server/ml/results.

TEST RESULTS:
  683 ML tests across 25 suites. 682 pass. 1 FAILS:
    test_ml_21a.py::test_every_card_name_maps
    AssertionError: 123 != 122
  Cause: the card catalog went to 123 on 2026-09-07 (Minion
  Giant); the test hardcodes 122. NOT FIXED — audit-only phase,
  frozen research suite.

DISCOVERIES:
  1. The frozen engine HAS NEVER SEEN A DUEL. Its `duel` domain
     is practice (97.8% Friendly/Showdown). Structural: zero of
     1,238 native duel rows carry 8 cards.
  2. battle_raw.raw_json DOES hold real duels — team[].rounds,
     ordered per-game decks and crowns, BOTH sides. Phase 21A
     parsed 49,963 series / 119,865 games / 20,702 subjects out
     of it. Production does not read it.
  3. THE BOTTLENECK IS COVERAGE, NOT RANKING. 71.7% of duel
     steps have NO legal candidate pool. The ranker adds only
     +1.7 to +4.9 points over random-in-pool and goes NEGATIVE
     (-2.8) at pool >= 5.
  4. Coach Assist is materially more capable than the OIE and is
     the real baseline. `_expected` already does probability-
     weighted coverage across the opponent's distribution and
     drops no-evidence decks rather than scoring them 50%.
  5. Five of the seven learning-loop stages already exist and are
     tested. Only Learn and Persist are missing.
  6. `duo_pairs.py` is a working, production precedent for the
     exact storage shape pattern memory needs.
  7. There is no persistent player object anywhere in the system.

NEW FINDINGS:
  - Shadow log measured: 2,620 entries / 1,464 player hashes /
    2,228 reconcilable / 2026-08-20 to 2026-08-23 / domains
    duel 1,388, competitive 1,160, practice 72.
  - Every phase*-report.txt is gitignored and unbacked. The
    cohort tag files ARE tracked (6 files, 5,680 tags).
  - cardRoles.json is hand-authored from a prose manual, 122 of
    123 cards. Nothing about card strategy is learned.

MISTAKES:
  None that affected output. One process note: `git ls-files` was
  used to settle gitignore questions rather than reading the
  patterns, after CLAUDE.md's warning that `git check-ignore`
  returns non-zero for absent paths.

FAILED APPROACHES:
  None attempted this session. Eleven prior ones are recorded in
  section 20 and must not be repeated.

DEADLOCKS:
  1. No database on this machine. resolve_db_path() -> None.
     No Brain component can be measured locally.
  2. CLASH_OIE=off with no decided rollout gate.
  3. The research evidence base has no backup.
  4. Native duel prediction needs a loadout representation that
     does not exist.
  5. 71.7% zero-pool coverage.

BUGS DISCOVERED:
  1. LIVE: predictor.predict passes timestamp="9999", so
     log_hours_since_change and log_hours_since_last_play are 0
     on EVERY production read. 2 of 21 features dead. Proven by
     direct call. Known to 20C/20D, deliberately unfixed for
     comparability, effect never measured.
  2. test_ml_21a.py hardcodes 122 cards; catalog is 123.
  3. README.md's 24B section claims main has zero server/ml
     files and no /api/analytics handler. Both now false
     (65 files; the proxy exists). Historical record, not a
     code fault.
  4. CLAUDE.md claims the cohort tag files are gitignored and
     unbacked. They are tracked.
  5. The shadow log mixes `duel` and `practice` for one
     population.

NEW DECISIONS:
  A13. The Brain learns offline and publishes a versioned
       artifact. In-request training is impossible by design
       (policy.forbid_training) and the artifact pattern already
       works with one-file rollback.
  A14. The Brain's first target is COVERAGE, not ranking, on the
       Phase 21A supplement-11 measurement.

DECISIONS REVERSED:
  None. Every frozen decision in phase22-final-spec.md stands.

OPEN QUESTIONS:
  1. PRIVACY (A9). The shadow log stores salted hashes, never
     tags. A per-player Brain memory keyed by a hash cannot be
     inspected, debugged or explained. Does the Brain store real
     tags? This needs an explicit decision from the account
     holder BEFORE any schema is designed. Note the GitHub repo
     is PUBLIC.
  2. VPS access for Phase 1. The census cannot run here.
  3. Is Coach Assist or Recent the baseline the Brain must beat?
     Recommend BOTH be scored; Coach Assist is what users see.
  4. Should the `timestamp="9999"` bug be fixed and measured
     before Phase 1? It is cheap and may move the frozen model's
     numbers.

DATA LIMITATIONS DISCOVERED:
  Thirteen, enumerated in section 23. The three that most
  constrain the Brain: within-game card-play order does not exist
  and never will; all deck-choice data is observational, never
  causal; opponents are overwhelmingly untracked (4,910 tracked
  against 866,226 known participants).

CURRENT SYSTEM STATE:
  Unchanged. Coach Assist live (pro tier). OIE dark
  (CLASH_OIE=off). Working tree carries exactly one new
  untracked file, DECKKIES_BRAIN_README.md. Nothing committed,
  nothing pushed, nothing deployed.

NEXT EXACT TASK:
  Write server/ml/evaluation/brain_phase1_census.py — a
  read-only offline census of the native duel substrate in
  battle_raw.raw_json, producing
  server/ml/results/brain-phase1-census.txt. Five numbered
  questions and a stop-gate, specified in section 32.
  REQUIRES APPROVAL AND VPS ACCESS.

DO NOT:
  - Do not modify anything under server/ml/production/ without
    explicit approval. It is frozen and test_ml_22_final.py
    enforces the freeze.
  - Do not reopen: model-overrules-Recent, historical exact
    retrieval, novel-deck generation, matchup-response
    prediction, spell-conditioning, counter-sniping. All six are
    closed on measurements, three of them on ceilings.
  - Do not display a band percentage. Ever.
  - Do not let changeProbability or any model internal cross the
    API boundary.
  - Do not open a read-write handle to the bot's database.
  - Do not train in production.
  - Do not turn CLASH_OIE on.
  - Do not build a ranker before measuring coverage (A14).
  - Do not delete section 20.

============================================================
```
