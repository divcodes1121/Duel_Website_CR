# Phase 22 — Final model freeze / production specification

**Status: research CLOSED. This document is the contract, not a proposal.**

Twenty-one phases reduce to one sentence:

> The opponent's most recent deck is the prediction. The model layer may add a
> confidence signal and optional secondary suggestions, and may never replace it.

Everything below is either measured or is a rule that exists because a
measurement demanded it. Where a number was published and later disproved, the
disproof is recorded next to it rather than the number being quietly dropped.

---

## 1. Closed branches, and what closed them

| branch | verdict | evidence |
|---|---|---|
| model overrules Recent | closed | Phases 4, 5, 6, 7 each lost to Recent |
| historical exact-deck retrieval | closed | 17B — a switched-to deck is one they have played 49.8% / 38.5% of the time; R@1 falls to 24.8% at 11+ known decks |
| novel-deck generation | closed | 18 — usable recall needs 10⁸–10¹⁰ candidates |
| matchup-response prediction | closed | 20A — the **oracle** arm scored 48.9% against X's own default at 58.9% |
| spell-conditioned prediction | closed | 21A — paired A−B `0.000 [-0.001, 0.001]` over 20,702 players |
| practice/"duel" as a duel target | closed | 20D — the domain contains no duels |

None of these should be reopened without new data of a kind that does not
currently exist. Three of them were closed by *ceilings*, not by model quality,
and a better model cannot move a ceiling.

---

## 2. What is frozen

### 2.1 Primary — Recent, structurally

`policy.enforce_primary()` runs **last and unconditionally**. If any path
produces a primary that is not the player's most recent deck, it is reset and
the result is marked `degraded`. This is not a tuning choice; it is the one
invariant the entire programme supports.

### 2.2 Change model — `m2-change-v1`, unchanged

| property | value |
|---|---|
| artifact | `ml/artifacts/m2-change-v1.json` |
| model version | `m2-change-v1` |
| feature version | `phase2-21` (21 features, order is part of the contract) |
| inputs | the player's SHELL (cluster containing the most recent play), not the whole history |
| output | `P(change)` ∈ [0, 1] |
| class weighting | **off**, on evidence — it damaged PR-AUC, ROC-AUC, F1 and Brier |
| training in production | **forbidden** — `policy.forbid_training()` replaces `fit` with a raise |
| feature-order guard | a mismatch against `features.FEATURE_NAMES` refuses the artifact and falls back |

Fallback when the artifact is missing or malformed: a counting estimate of
churn (`len(prior_edits) / (cluster_size - 1)`), and `degraded = True`.

### 2.3 Confidence — qualitative only

**The published band accuracies are wrong and must never be displayed.**

| band | claim in `policy.BAND_ACCURACY` | measured against real outcomes |
|---|---|---|
| competitive high | 90.5% | **69.1%** (19D, n=343) |
| competitive medium | 73.3% | **55.0%** (n=20) |
| practice high | 92.1% | 62.5% on n=8 reconciled (19D); 76.7% pooled / **65.4% macro** on 11,152 historical steps (20D) |
| practice medium | 75.8% | **83.7% pooled / 69.7% macro** — *above* high on the macro measure |

Two separate failures are recorded here and they have different consequences:

* **Competitive** — the ordering holds (68.2% > 55.0% > 0.0%) and every
  magnitude is ~20 points below its claim. Score calibration ECE **0.2806**,
  with the dominant bin claiming 96.8% and delivering 68.5%.
* **Practice** — the ordering does **not** hold. On 11,152 steps with full
  support in all three bands, macro accuracy runs high 65.4% < medium 69.7% >
  low 53.5%. A band that does not rank cannot carry a confidence label at all.

**Frozen decision.** Bands ship as qualitative wording and nothing else:

| band | production meaning |
|---|---|
| High | strongest evidence that the recent deck will remain useful |
| Medium | moderate evidence |
| Low | weak evidence |

- No percentage is displayed for any band, ever.
- `policy.BAND_ACCURACY` and `calibration.expected_accuracy()` are **internal
  diagnostics only**. Neither may reach a response body or a screen.
- The practice domain must not display a band at all until its ordering is
  re-established (see §6).

### 2.4 Alternatives — secondary, capped, monotonic

`ALTERNATIVE_CAPS = {high: 2, medium: 1, low: 0}`. Less confidence must never
surface more options; the pre-19B code had this inverted.

- Recent is always first and is never one of the alternatives
  (`drop_alternatives_matching_primary`).
- An alternative carries plain-language evidence, never a score.
- Zero alternatives is a valid, common, correct read.

**Recommendation: keep alternatives, but only in `competitive`.** Phase 16C
measured the shortlist adding **+0.5 points** under production semantics
(against +8.4 under the research step definition), and the 1-card edit it
addresses is **1.8% / 2.3%** of real steps. That is thin. It is retained
because the cost is a capped, clearly-secondary list rather than a claim — but
if the UI needs simplifying, this is the first thing to remove, not the last.

### 2.5 Degradation — one answer, always

Every failure path returns the same thing: **the recent deck, zero
alternatives, `degraded = true`, and a plain reason.**

| condition | reason string |
|---|---|
| no plays | `no plays` |
| no established shell | `no established shell` |
| artifact missing / feature mismatch | `change model artifact unavailable` |
| candidate generation failure | falls through the generic handler |
| any unexpected exception | `engine error: <ExceptionType>` |
| primary was not Recent | `primary was not Recent and has been reset` |

`safe_fallback()` never raises. An analytics screen showing the current deck is
useful; one that 500s is not.

---

## 3. API contract — `opponent-read-v1`

`GET /api/analytics/coach/opponent-read/<tag>`

```json
{
  "enabled": true,
  "read": {
    "primary":       { "cards": ["..."], "confidence": "high", "basis": "recent" },
    "alternatives":  [ { "cards": ["..."], "out": ["..."], "in": ["..."],
                         "confidence": "medium", "evidence": ["..."] } ],
    "note":          "",
    "degraded":      false
  }
}
```

`enabled` is `false` in every mode except `CLASH_OIE=on`, so the client renders
nothing without needing to know what a feature flag is.

**The UI never receives, and must never be given:** weights, logits, feature
names or values, cluster internals, model or artifact names, training state,
band accuracy percentages.

### 3.1 One required change before ship

`PredictionResult.as_dict()` currently emits **`changeProbability`**, a rounded
logistic score. That is a model internal crossing the UI boundary, and it is the
*same* score measured at ECE 0.2806 (competitive) and 0.6097 (practice) — a
number that is both internal and wrong.

**It must be removed from the payload.** It is retained inside the process for
band assignment and for the shadow log, both of which are internal. This is
listed as engineering work in §6 rather than applied here, because Phase 22 does
not modify production.

### 3.2 Client behaviour, already correct

- 6000 ms timeout, then `{kind: 'timeout'}` — a hung request never leaves a
  skeleton on screen.
- `enabled === false` or `read === null` → `{kind: 'disabled'}` → render nothing.
- The read is fetched **separately** from the Coach's own render path.

---

## 4. Performance — where the latency actually is

Measured across 1,084 real requests (19D):

| | p50 | p95 | p99 |
|---|---:|---:|---:|
| `/coach/predict` (whole request) | 2,737 ms | 7,095 ms | 15,182 ms |
| **OIE inference inside those requests** | **7–26 ms** | | |

Also measured, on the historical population: competitive p50/p95 **1/15 ms**,
practice **24/122 ms**.

**The engine is not responsible for the Coach's latency.** That cost is the
Coach's own database read on a spinning volume. Two claims are therefore
withdrawn and must not be repeated: that the OIE makes the Coach slow, and 19B's
single-sample "9.6s vs 2.4s" figure (paired over 40 tags: −219 ms,
CI [−1297, +859] — no effect).

Architecturally this is already right: the opponent read is its own request and
never blocks Recent from rendering. **Keep it that way.**

---

## 5. Safety rules — frozen and tested

| # | rule | enforced by |
|---|---|---|
| 1 | Recent cannot be replaced | `enforce_primary`, applied last |
| 2 | ML failure → Recent | `safe_fallback` |
| 3 | Generation failure → Recent | `safe_fallback` |
| 4 | Low confidence never shows more alternatives than High | `ALTERNATIVE_CAPS` monotonic |
| 5 | No future information enters a prediction | `assert_no_future` |
| 6 | Production never trains | `forbid_training` |
| 7 | Duel legality enforced where applicable | see §6 — **not applicable today** |
| 8 | No spell-based prediction | 21A; nothing to remove, none was built |
| 9 | No matchup oracle | 20A; nothing to remove, none was built |
| 10 | No unsupported accuracy claims | §2.3 |

Rule 7 needs stating precisely: the duel card-reuse rule is **absolute** — 21,432
real deck pairs, zero overlap — but production's `source._rows_to_plays` drops
every 16/24-card native duel row, so **the engine currently has no duel coverage
and the rule has nothing to apply to.** It is frozen as a requirement for any
future duel support, not as live behaviour.

---

## 6. Versioning

Every production observation is attributable to this stamp, which is already
what the shadow log records:

| axis | frozen value |
|---|---|
| model | `m2-change-v1` |
| features | `phase2-21` |
| policy | `phase17a-calibrated` |
| calibration | `band-calibration-v1` |
| candidates | `c1-wide-playerpool` |
| API contract | `opponent-read-v1` |

Historical artifacts are never overwritten. `band-calibration-v2-candidate.json`
exists and is **not** active; it must not be promoted on the current evidence,
because a map fitted to the reconciled sample would fit a population whose
composition is an artifact of when collection ran.

---

## 7. Remaining production engineering work

Ordered by what blocks a rollout.

1. **Remove `changeProbability` from the response body** (§3.1). Keep it
   internal. One-line change in `as_dict()`, plus the client type.
2. **Rename the `duel` domain to `practice`** across the engine, the log and the
   API. 20D established the label is wrong; leaving it invites the same
   misreading that survived twenty phases.
3. **Suppress the band for `practice`** until its ordering is re-established.
   Competitive keeps its band (qualitative wording only).
4. **Strip percentages from any surface that reads `BAND_ACCURACY` or
   `expected_accuracy()`.** Both stay as diagnostics.
5. **Correct the stale justification comments** in `ALTERNATIVE_CAPS` and
   `BAND_ACCURACY`, which cite the disproved 92.1% / 47.3% figures. The rules
   they justify are still right; the reasons printed beside them are not.
6. **Browser verification of the Coach read path** — never done. Per project
   convention: `npm i -D playwright`, drive the real flow, delete the script and
   uninstall afterwards.
7. **Decide the rollout gate.** `CLASH_OIE` stays `off`. The original gate was
   "High > Medium > Low validated against real outcomes". Competitive now meets
   the *ordering* half and fails the *magnitude* half; practice fails both. A
   defensible gate for a qualitative-only label is competitive-only, ordering
   holds, no percentage displayed — which is satisfiable today.

**Not on this list, deliberately:** any retraining, any recalibration, any new
feature, any new model. The research phase is closed.

---

## FINAL MODEL DIRECTION: FROZEN
