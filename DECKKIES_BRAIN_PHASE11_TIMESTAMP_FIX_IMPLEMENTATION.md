# DECKKIES BRAIN — PHASE 11

## Timestamp Fix Implementation (local, undeployed)

> **⚠ COMMITTED BY BRAIN PHASE 12 (2026-09-15), STILL NOT DEPLOYED.** Everything below describes the
> working tree as it stood during Phase 11, when the change was uncommitted; the five files, this
> artifact and the repository documentation went into one local commit in Phase 12 (parent `c4fc65e`,
> **not pushed**), and the Phase 8b/8c evidence was preserved to the gitignored
> `brain-evidence/phase8/`. **The VPS still runs `timestamp="9999"` and `CLASH_OIE` is still `off`.**
> A dark deployment is Brain Phase 13 and needs its own approval. See
> `DECKKIES_BRAIN_PHASE12_COMMIT_EVIDENCE.md`.

```
Date        2026-09-15
Mode        IMPLEMENTATION of the approved Phase 8/8b timestamp correction, exactly as
            specified by Phase 10. Local working tree only. NOT committed. NOT deployed.
            VPS untouched. royalweb not restarted. CLASH_OIE not changed. Production
            shadow log not modified.
Approval    The account holder explicitly accepted the Phase 8c alternative regression
            and approved implementation of the Phase 10 contract. Deployment, restart,
            CLASH_OIE=shadow, frontend, pools, caps, persistence, retraining,
            recalibration and unrelated fixes were NOT approved and were not done.
Repository  main @ c4fc65e + 5 modified files (below)
Status      PASS
```

---

# 1. Implementation status

**PASS.** The fix is implemented exactly as Phase 10 §10 specified, and every validation
Phase 10 §11 required passed:

| check | result |
|---|---|
| production surface limited to the three approved files | ✔ `predictor.py`, `shadow.py`, `phase22-final-spec.md` |
| new tests T1–T7 | ✔ 10 new tests in `test_ml_production.py`, all pass |
| version pins exact (KNOWN BUGS #25) | ✔ parsed-table equality in `test_ml_22_final.py` |
| stamp pinned in predictor tests (KNOWN BUGS #24) | ✔ both suites; passes with the system clock faked to 2026-12-31 and 2030-01-01 |
| the new tests catch the defects they exist for | ✔ 6 in-process mutants, each caught; clean control passes |
| **offline equivalence vs recorded Phase 8b / 8c** | ✔ **357,426 / 357,426 reads and 128,816 / 128,816 condition-B records, 0 mismatches** |
| full required suites | ✔ 767 unittest tests + 69 homegrown checks; the only failure is the pre-existing `test_ml_21a` one, byte-identical to baseline |
| production shadow log | ✔ unchanged (2,620 lines, md5 `a02ff6cc…`) |
| scope | ✔ nothing outside the approved surface changed |

---

# 2. Exact code changes

## 2.1 `server/ml/production/predictor.py` (+17 / −1)

1. **Import** — `import time` added after `import threading` (line 23).
2. **Helper** — added above `predict` (lines 83-93):

   ```python
   def _request_stamp() -> str:
       """The prediction moment for a live read: the request wall clock, in UTC,
       in battle_time's own format.
       ... (docstring: UTC is load-bearing; "9999" zeroed features 9 and 10;
       tests pin this function rather than reading the calendar) ...
       """
       return time.strftime("%Y%m%dT%H%M%S", time.gmtime()) + ".000Z"
   ```

3. **The call** — in `predict`, the example construction (lines 117-123):

   ```python
   # THE PREDICTION MOMENT: the caller's cutoff when it supplies one,
   # otherwise the request itself. Never a placeholder.
   example = PredictionExample(
       player_tag=tag, timestamp=cutoff_ts or _request_stamp(), domain=domain,   # line 120
       history=cluster_plays,
       truth=DeckPlay(battle_time="9999", mode="", cards=()),                   # line 122, UNCHANGED
       cluster_history=cluster_plays)
   ```

Nothing else in the file changed: `_load_change_model`, `_change_probability`, the
candidate generator construction, `shortlist.build`, `calibration.band`, the four policy
guards, `predict_for_tag` and `status` are byte-identical.

**Resulting contract** (each point is a test in §3):

| requirement | how it holds |
|---|---|
| an explicit `cutoff_ts` wins | `cutoff_ts or …` short-circuits; the clock is not read (T2) |
| otherwise the current UTC request time | `time.gmtime()` (T1, pinned and real clock) |
| never `"9999"` | T2 spies on the scored example |
| parseable by the feature pipeline | `features._parse` returns a datetime (T1, T2) |
| does not alter the primary deck | T4; offline equivalence on 357,426 reads |

## 2.2 `server/ml/production/shadow.py` (+1 / −1)

```diff
-    "features": "phase2-21",
+    "features": "phase2-21-reqstamp-utc",
```

No other line. Recording, rotation, reconciliation, drift and checkpoint behaviour are
unchanged.

## 2.3 `server/ml/evaluation/phase22-final-spec.md` (+17 / −2)

* §2.2 row: `feature version | phase2-21-reqstamp-utc (21 features, order is part of the
  contract; formerly phase2-21, which fed features 9 and 10 the unparseable stamp "9999" — see §7)`.
* §6 row: `features | phase2-21-reqstamp-utc`.
* §7: a dated paragraph, *"Timestamp input correction"*, stating that it is an
  **input/timestamp correction**, **not model retraining** (`m2-change-v1` unchanged), **not
  recalibration** (`band-calibration-v1` unchanged), no feature added/removed/reordered,
  `ALTERNATIVE_CAPS` and the candidate generator unchanged, primary deck unaffected;
  validated by the Phase 8b gate and the regression accepted per Phase 8c.

Prediction semantics described elsewhere in the spec are untouched.

---

# 3. Exact test changes

## 3.1 `server/test_ml_production.py` (+222 / −3) — 81 → 91 tests

**Infrastructure (KNOWN BUGS #24):**

* imports: `calendar`, `datetime`, `math`, `time`, `unittest.mock`, `ml.features as F`,
  `ml.production.calibration`.
* `PINNED_REQUEST_STAMP = "20260812T120500.000Z"` (five minutes after `history()`'s last
  play), `_REAL_REQUEST_STAMP` saved, `setUpModule` / `tearDownModule` pin and restore
  `P._request_stamp`, and `request_at(stamp)` (a `mock.patch.object` context).
* `test_primary_never_needs_resetting_on_a_multi_shell_player` and
  `test_change_probability_is_not_pegged_for_a_steady_player` pin their own stamp to their
  fixture (`20260814T120500.000Z`, last play + 5 min). The steady-player test carries a comment
  recording that, unpinned, it fails from 2026-09-27T18:51:45Z.

**New class `TimestampCorrection` (10 tests):**

| # | test | asserts |
|---|---|---|
| T1 | `test_request_stamp_is_utc_in_battle_time_format` | `time.gmtime` pinned to 2026-09-14T18:52:53Z (with `time.localtime` moved +5.5 h): stamp == `20260914T185253.000Z`; `_parse` gives that datetime |
| T1 | `test_request_stamp_reads_the_real_clock_in_utc` | the real `_request_stamp()` parses and lies within 120 s of UTC derived from `time.time()` |
| T2 | `test_predict_never_passes_the_placeholder_stamp` | a spy on `F.extract` sees the pinned stamp, and with the real clock restored a parseable stamp; never `"9999"` |
| T2 | `test_explicit_cutoff_wins_over_the_request_clock` | with `cutoff_ts` supplied the scored stamp == `cutoff_ts` and the request clock is read 0 times |
| T3 | `test_temporal_features_are_populated_together` | shell edited day 6, played to day 12: at +6 h x10 = log1p(6), x9 = log1p(150), x9 ≥ x10 > 0; at the anchor x10 = 0, x9 = log1p(144); all 19 other features identical |
| T4 | `test_primary_deck_is_identical_under_every_stamp` | 5 stamps (anchor, +5 min, +4 h, +36 h, +40 d), competitive and practice: primary == last play, never degraded, one distinct deck |
| T5 | `test_generated_alternatives_are_identical_under_every_stamp` | cap bypassed in-test: identical (cards, out, in) lists under all 5 stamps, non-empty; shown lists are prefixes of that list |
| T6 | `test_count_moves_only_with_the_corrected_band` | `ALTERNATIVE_CAPS == {"high": 2, "medium": 1, "low": 0}` exactly; band == `calibration.band(P)`; shown count == min(cap, generated); the stamps reach high → 2, medium → 1, low → 0 |
| T7 | `test_payload_degradation_and_practice_are_unchanged` | payload keys exactly `{primary, alternatives, note, degraded, bandShown}`, no `changeProbability`; not degraded; practice payload has no band and no alternatives; empty / single-play / broken inputs degrade identically under every stamp |
| #24 | `test_this_module_runs_on_a_pinned_request_clock` | the module-wide pin is active |

## 3.2 `server/test_ml_22_final.py` (+57 / −14) — 66 → 67 tests

* imports `re` and `shadow`; `FROZEN_VERSIONS` (exact five-axis dict with
  `features: phase2-21-reqstamp-utc`) and `FROZEN_API_CONTRACT = "opponent-read-v1"`.
* `PINNED_REQUEST_STAMP = "20260609T000500.000Z"` with `setUpModule` / `tearDownModule`.
* `spec_version_table(spec)` parses §6's table row by row into `{axis: value}`.
* **`test_every_version_axis_is_named`** — was an `assertIn` substring loop; now
  `assertEqual(spec_version_table(spec), FROZEN_VERSIONS + API contract)`.
* **`test_the_version_stamp_matches_what_the_log_records`** — was hardcoded strings checked
  by substring, never reading the log's stamp; now asserts `shadow.VERSIONS ==
  FROZEN_VERSIONS`, the §6 table equals `shadow.VERSIONS` axis by axis, the §2.2 feature-version
  row equals `shadow.VERSIONS["features"]`, and the value is not `phase2-21`.
* **`test_this_module_runs_on_a_pinned_request_clock`** — new (KNOWN BUGS #24).

## 3.3 The tests catch what they were written for — mutation check

Each mutant is an in-process monkeypatch applied before the suite loads; no file edited
(`p11/p11_mutations.py`):

| mutant | tests that fail |
|---|---|
| clean (control) | **none** (91 / 91, 67 / 67) |
| placeholder — the scored example carries `"9999"` (the old behaviour) | T2 (placeholder), T2 (cutoff), T3, T6 |
| localtime — stamp built from a local clock | both T1 tests |
| cutoff-ignored — request clock replaces a supplied cutoff | T2 (cutoff) |
| caps-changed — medium 2 / low 1 | T6, plus the existing rule-4 tests in both suites |
| x10-only — feature 9 still fed `"9999"` | T3 |
| version-stale — `shadow.VERSIONS["features"] = "phase2-21"` | the exact spec/log version test |

A first run of this harness loaded the suites without registering them in `sys.modules`, so
unittest skipped `setUpModule` and even the clean control failed — on exactly the pin guards
and the pinned-stamp assertion. The harness was corrected; that failure was the #24 guards
doing their job.

---

# 4. Version changes

| axis | before | after |
|---|---|---|
| model | `m2-change-v1` | unchanged |
| **features** | `phase2-21` | **`phase2-21-reqstamp-utc`** |
| policy | `phase17a-calibrated` | unchanged |
| calibration | `band-calibration-v1` | unchanged |
| candidates | `c1-wide-playerpool` | unchanged |
| API contract | `opponent-read-v1` | unchanged |
| `features.FEATURE_NAMES` (21, ordered) | — | **unchanged**; the artifact guard still loads `m2-change-v1` |

Nothing in the repository reads the features version by value; `shadow.checkpoint()` and
`verify_log()` use it only to separate stamps.

---

# 5. Offline equivalence

## 5.1 Evidence used, at its recorded location, unmodified

`…/fcee4081-d0df-4310-840a-a320a9e6248b/scratchpad/` (the Phase 8b/8c session scratchpad, per
Phase 10 Appendix A). md5 before and after the run, identical:

| file | md5 |
|---|---|
| `p8b/reads.pkl` | `9c811181fa5b46c7ec20d3f880a4a4b0` |
| `p8c/alts.pkl` | `3314d0495d3e0bc1c9cb29da00e6297b` |
| `p8b/histories.jsonl.gz` | `2112d741a34ed31974e1383bd443dd18` |
| `p8b/raw_arrivals.jsonl.gz` | `33b65e5f726bd0f8bcdfbf542677553d` |

No substitute reference was generated.

## 5.2 Method (`p11/p11_equivalence.py`)

For every recorded read: rebuild the arrival-visible information set exactly as the Phase 8b
replay and the Phase 8c harness did (arrival ≤ R, 60-day floor on R's date, newest 1,200 rows,
`source._rows_to_plays`), call the **implemented** `predictor.predict(tag, domain, plays)` —
unmodified, no cutoff — with only `predictor._request_stamp` pinned to that read's R, and
compare against the recorded values. For condition-B records, a second call bypasses only
`policy.cap_alternatives` in process to read the uncapped list (the Phase 8c technique).

## 5.3 Result

```
reads replayed                 357,426 / 357,426   (competitive 264,806, practice 92,620)
  change_probability == pB     357,426   max |delta| 4.44e-16   (tolerance 1e-12)
  primary deck == recorded     357,426
  degraded                     0
condition-B records            128,816 / 128,816   (0 unmatched keys)
  confidence band == bandB     128,816
  note == noteB                128,816
  alternative list (capped)    128,816   cards, out, in, label
  alternative count            128,816
  uncapped list + labels       128,816   identity, order, labels
  degraded == degB             128,816
  practice payload empty       all practice records
  8b pB == 8c pB               128,816
MISMATCHES                     0
runtime                        1,525 s
PASS                           true
```

The implementation reproduces the validated condition B on every recorded read.

---

# 6. Full test results

Runner `p11/run_suites.py`, one subprocess per suite, on the unmodified code (**baseline**) and
on the implementation (**after**):

| suite | baseline | after |
|---|---|---|
| `test_ml_17b.py` | 31 OK | 31 OK |
| `test_ml_18.py` | 27 OK | 27 OK |
| `test_ml_20a.py` | 22 OK | 22 OK |
| `test_ml_20b.py` | 38 OK | 38 OK |
| `test_ml_20c.py` | 30 OK | 30 OK |
| `test_ml_20d.py` | 27 OK | 27 OK |
| `test_ml_21a.py` | 32, **FAILED (failures=1)** | 32, **FAILED (failures=1)** — identical |
| `test_ml_22_final.py` | 66 OK | **67 OK** |
| `test_ml_candidates.py` | 19 OK | 19 OK |
| `test_ml_change.py` | 21 OK | 21 OK |
| `test_ml_contract.py` | 13 OK | 13 OK |
| `test_ml_dataset.py` | 32 OK | 32 OK |
| `test_ml_exit.py` | 16 OK | 16 OK |
| `test_ml_exit_intel.py` | 15 OK | 15 OK |
| `test_ml_hybrid.py` | 16 OK | 16 OK |
| `test_ml_metrics.py` | 28 OK | 28 OK |
| `test_ml_pairwise.py` | 20 OK | 20 OK |
| `test_ml_policy.py` | 27 OK | 27 OK |
| `test_ml_production.py` | 81 OK | **91 OK** |
| `test_ml_recalibrate.py` | 22 OK | 22 OK |
| `test_ml_shortlist.py` | 16 OK | 16 OK |
| `test_ml_substitution.py` | 20 OK | 20 OK |
| `test_ml_vocabulary.py` | 17 OK | 17 OK |
| `test_oie_ui.py` | 23 OK | 23 OK |
| `test_shadow_durability.py` | 24 OK (skipped=1) | 24 OK (skipped=1) |
| `test_api_security.py` | 73 OK | 73 OK |
| `test_coach.py` | 69 passed, 0 failed | 69 passed, 0 failed |
| **total** | **756 unittest + 69 homegrown; 1 failure** | **767 unittest + 69 homegrown; 1 failure** |

The skip is `FrontierWatch.test_an_advanced_frontier_is_ready` (`'no database'`), present in
both runs. `test_api_security` keeps its route-count tripwire (22) green.

**Calendar independence** (`p11/p11_calendar.json`): `test_ml_production.py` (91) and
`test_ml_22_final.py` (67) with the system clock faked to 2026-12-31T23:59Z and to
2030-01-01T00:00Z — **all 158 pass** in both.

---

# 7. Pre-existing failures

**One, unchanged.** `test_ml_21a.py` (KNOWN BUGS #2), in both runs, text byte-identical:

```
FAIL: test_every_card_name_maps (__main__.TestVocabulary.test_every_card_name_maps)
Traceback (most recent call last):
  File "...\server\test_ml_21a.py", line 96, in test_every_card_name_maps
    self.assertEqual(len(P.NAME_TO_KEY), 122)
AssertionError: 123 != 122
Ran 32 tests   FAILED (failures=1)
```

Not fixed, as instructed.

---

# 8. Scope audit

| protected item | touched? |
|---|---|
| candidate pools / full player vocabulary | no |
| Coach Assist ranking (`coach.py`) | no |
| displacement / substitution models (`ml/substitution.py`, `exit_model.py`) | no |
| `ALTERNATIVE_CAPS`, `_band`, alternative labels (`policy.py`, `shortlist.py`) | no (T6 asserts the caps unchanged) |
| UI copy / frontend (`src/`) | no |
| API schemas (`api/`, `as_dict`) | no (T7 asserts payload keys) |
| model weights / calibration artifacts (`ml/artifacts/`) | no |
| training datasets | no |
| Brain persistence / knowledge graph / prediction memory | no |
| shadow logging semantics | no — one version string only |
| `CLASH_OIE` behaviour (`coach.py:1124`) | no |
| bot code | no |
| production shadow log | no — md5 `a02ff6cc0a103dc394b479d3c4fdcfb9`, 2,620 lines, before and after every run |

`git status` for `server/`, `src/`, `api/` shows exactly the five files in §10. `git diff
--check` reports no whitespace errors.

---

# 9. Leakage and determinism checks

**Leakage: PASS.**

1. **Structural.** `features.extract` reads only shell plays and the stamp; `truth` is never
   read. With no cutoff, `predict` scores stored plays against the request time; with a cutoff,
   plays are filtered to `battle_time < cutoff_ts` and the stamp *is* the cutoff.
2. **On the recorded evidence.** Every replayed information set admits only rows with arrival ≤
   R; Phase 8b asserted arrival ≥ battle time on 53,792 rows (0 failures) and purged-raw rows
   predate the cursor, so every visible play has battle time ≤ R. Phase 8b's 294,644 leakage
   assertions (0 failures) cover the same information sets, and the implementation reproduces
   their `pB` to 4.44e-16.
3. **Clock skew** (a play stamped after the host clock) cannot leak: `_hours_between` clamps to
   zero, giving the anchor value.

**Determinism:**

* the live stamp is produced in one function, `_request_stamp()`, which uses `time.gmtime()`
  only (T1 moves `localtime` 5.5 h and the stamp does not move);
* both predictor suites pin it module-wide, and the two later-dated fixtures pin their own;
* guards assert the pin is active (and fired when a harness failed to apply it, §3.3);
* both suites pass with the system clock at 2026-12-31 and 2030-01-01 (§6).

---

# 10. Files changed

**Tracked, modified (uncommitted):**

```
 server/ml/evaluation/phase22-final-spec.md |  19 ++-
 server/ml/production/predictor.py          |  18 ++-
 server/ml/production/shadow.py             |   2 +-
 server/test_ml_22_final.py                 |  71 +++++++--
 server/test_ml_production.py               | 225 ++++++++++++++++++++++++++++-
 5 files changed, 314 insertions(+), 21 deletions(-)
```

**Untracked, created:** `DECKKIES_BRAIN_PHASE11_TIMESTAMP_FIX_IMPLEMENTATION.md` (this file).
**Untracked, modified:** `DECKKIES_BRAIN_README.md`.
**Pre-existing untracked:** the Phase 1–10 Brain artifacts (unchanged).

**Scratchpad only (not in the repository):** `p11/run_suites.py`, `p11_mutations.py`,
`p11_equivalence.py`, and `baseline.json`, `after.json`, per-suite `.out` files,
`p11_mutations.json`, `p11_calendar.json`, `p11_equivalence.json`, `equivalence.out`.

---

# 11. Deployment status

**NOT DEPLOYED.** No `scp`, no SSH, no VPS contact, no `royalweb` restart, `CLASH_OIE`
unchanged (`off` by default). The VPS still runs `timestamp="9999"`. No frontend build or push.

# 12. Commit status

**NOT COMMITTED.** HEAD is still `c4fc65e`; the five changes exist only in the working tree.

---

# 13. Rollback readiness

**Ready, file-level, nothing external to undo.**

| situation | exact rollback |
|---|---|
| now (uncommitted) | `git restore server/ml/production/predictor.py server/ml/production/shadow.py server/ml/evaluation/phase22-final-spec.md server/test_ml_production.py server/test_ml_22_final.py` |
| after a future commit | `git revert <commit>` |
| after a future dark deploy | restore `predictor.py` and `shadow.py` from `*.bak-<date>-prestamp` on the VPS, `rm -rf server/__pycache__`, `systemctl restart royalweb`, check `/api/analytics/status` |
| after a future shadow enablement | `CLASH_OIE=off`; keep shadow entries (separable by the new version stamp) |

No migration, artifact, threshold or data change exists to reverse.

---

# 14. Unresolved issues

1. **The Phase 8b/8c evidence is still the only copy, in a temporary directory** (Phase 10 S0 not
   approved). It holds real player tags; the repository is public.
2. **Repository docs** (`README.md`, `server/README.md`, `CLAUDE.md`) do not yet describe the fix.
   Updating them was outside the approved Phase 11 working-tree scope; they belong with the commit.
3. **KNOWN BUGS #26** (version-blind `drift()` / `capture_baseline()`, practice drift never
   evaluated), **#27** (stale 92.1% / 47.3% panel comment) and **#28** (discarded
   `_primary_band`) remain open, unrelated, not fixed.
4. **KNOWN BUGS #2** (`test_ml_21a` 122 vs 123) remains open, not fixed.
5. **Shadow re-validation** (Phase 10 S3–S7) has not run; real request timing is still unmeasured.
6. **The alternatives regression is now in the code**, accepted: under production-order
   random-clock reads, alternatives shown per read 1.827 → 1.429 and hits 1.846% → 1.062%.
   The separate `ALTERNATIVE_CAPS` review remains proposed, not approved.

---

# 15. Next required approval

In order, each separate:

1. **Commit** the five changes (with the repository docs updated in the same commit). Not approved.
2. **Preserve the evidence** (Phase 10 S0) to a durable gitignored location. Not approved.
3. **Dark deploy** to the VPS (Phase 10 S2: backups, `scp`, clear `__pycache__`, restart
   `royalweb`, `CLASH_OIE` stays `off`). Not approved.
4. **`CLASH_OIE=shadow`** on a fresh log (Phase 10 S3–S7). Not approved.

`CLASH_OIE=on` is a separate decision (README deadlock 2) and is not on this list.

---

*End of Phase 11 artifact. Local implementation only. No commit, no deploy, no VPS contact, no
`CLASH_OIE` change, no Brain memory.*
