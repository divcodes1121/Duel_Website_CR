# DECKKIES BRAIN — PHASE 13A (corrected)

## 2v2 retention: top 50 most-used pairs per canonical win condition, and their battles

```
Date        2026-09-17
Mode        Read-only VPS forensics + LOCAL implementation. Nothing deployed.
            Nothing deleted, on the VPS or anywhere else.
Repository  main @ a9cdbb7 (the timestamp commit, untouched) + 2 new local files
Status      CONDITIONAL — mechanism implemented, measured and tested; the
            destructive cleanup is prepared and NOT executed, and one finding
            changes what "keep their battles" can mean.
```

> **CORRECTION TO THE PREVIOUS PHASE 13A.** The earlier artifact
> (`DECKKIES_BRAIN_PHASE13A_2V2_TOP50_STORAGE.md`, BLOCKED) read the requirement
> as *six* win conditions and stopped because no six-way taxonomy exists. That
> reading was wrong. The requirement is **ALL** canonical win conditions — there
> are **17**, they all occur in the live 2v2 data, and all 17 are now supported.
> The earlier artifact is kept unchanged as the record of the blocked attempt.

---

# 0. EXECUTION RECORD — the cleanup was performed on 2026-09-17

> Everything below section 1 is the plan as written before execution, kept
> unchanged. This section is what actually happened on the production VPS.
> **Status: PASS.** The tail is deleted, the retained set is exact and verified,
> the collection is bounded and maintains itself hourly, and `battles.db` was
> never written to. **`VACUUM` was not run — 4.14 GB is reclaimable and needs its
> own approval.**

## 0.1 Pre-cleanup snapshot (measured 06:16–06:19 UTC)

| | |
|---|---:|
| disk | 387 GB total, 159 GB used, **229 GB free** |
| `.duo_pairs.db` | **5,244,731,392 B**, 1,280,452 pages × 4096, freelist 1,853 |
| `duo_pairs` | **2,544,874** rows |
| `duo_stage` | **4,025,218** rows |
| `duo_stage_players` | 5,306,079 rows |
| `duo_battle_players` | 239,260 rows |
| `duo_participants` | 1,406,416 rows |
| retention tables | **absent** (`duo_retained` / `duo_candidates` did not exist) |
| `battles.db` | 77,057,064,960 B |
| `battle_raw` | 3,046,896 rows |
| `battles` 2v2 | 1,415,839 (system-recorded) |
| fold watermark | 2026-09-17T02:53:34Z, `battles_folded` 2,012,609 |
| bot uptime | since 2026-09-12 — **still no restart, so the raw purge still has not run** |

The collection had grown **+51,393 pairs in nine hours** (~137,000/day) since the
Phase 13A audit, against 86.2% of pairs having been seen exactly once.

## 0.2 Quiesce and backup

`royalweb-duo.timer` was **stopped** first so nothing wrote during the work
(restarted at the end). `royalweb` and `clashbot` were left running.

```
sqlite3 .backup  ->  /var/backups/clashbot/20260917T061905Z/duo_pairs.db
size      5,244,731,392 bytes          (49 s)
sha256    27628942fbd76f893883cc773ddc7b195b5a814c72b32e58f4c75922f0f4fb25
integrity_check  ok        quick_check  ok
rows in the backup  duo_pairs 2,544,874   duo_stage 4,025,218
free space after    224 GB
```

**Re-verified after the cleanup**: identical size, identical SHA-256, still
holding the pre-cleanup rows. The rollback is real.

## 0.3 Deployment

`server/duo_retention.py` only — copied to `/opt/royalweb/server/`. Nothing else
was deployed; `duo_pairs.py`, `predictor.py`, `shadow.py` and every other file on
the VPS are untouched. No service restart was needed for the rebuild, because
nothing imports the module yet.

## 0.4 The exact census (rebuild 75 s, verify 72 s)

All **17/17** canonical buckets filled to exactly 50.

| win condition | retained | #1 | #50 | occurrences of the 50 |
|---|---:|---:|---:|---:|
| other | 50 | 10,074 | 399 | 85,034 |
| lava | 50 | 10,074 | 105 | 26,122 |
| graveyard | 50 | 1,674 | 137 | 15,656 |
| bait | 50 | 2,723 | 87 | 15,562 |
| bridge-spam | 50 | 1,692 | 129 | 14,448 |
| golem | 50 | 2,273 | 81 | 12,304 |
| hog | 50 | 1,582 | 95 | 10,417 |
| piggies | 50 | 374 | 67 | 7,078 |
| balloon | 50 | 286 | 68 | 6,658 |
| miner | 50 | 1,070 | 53 | 5,409 |
| drill | 50 | 229 | 61 | 4,619 |
| e-giant | 50 | 393 | 45 | 4,205 |
| mortar | 50 | 364 | 44 | 3,738 |
| royal-giant | 50 | 225 | 37 | 3,221 |
| giant | 50 | 228 | 32 | 2,930 |
| xbow | 50 | 334 | 21 | 2,770 |
| 3-musk | 50 | 46 | 13 | 1,010 |

```
duo_retained      850 rows  =  736 DISTINCT pair identities
                             (114 pairs are top-50 in both of their win conditions)
duo_candidates    85,000 rows  (17 × 5,000 — bounded)
overstated > 0    0            -> the historical rebuild is EXACT
verify()          ok = True, 0 mismatches, 0 buckets over depth, 17 checked
```

`verify()` re-derives every bucket straight from `duo_pairs` rather than
re-running the builder, so this is an independent check, not a restatement.

## 0.5 Pre-delete plan, then the delete

```
pairsNow 2,544,874   pairsRetained 736     pairsRemovable 2,544,138
stageRowsNow 4,025,218  stageRowsRetained 176,995  stageRowsRemovable 3,848,223
battlesRetained 166,962 distinct battles
```

Executed with `CLASH_DUO_RETENTION=on` and `confirm=True` (both required; the
first attempt in testing was correctly refused without them). It ran ~35 minutes,
peaking at a 3.76 GB WAL, which checkpointed cleanly.

| | before | after |
|---|---:|---:|
| `duo_pairs` | 2,544,874 | **736** |
| `duo_stage` | 4,025,218 | **176,995** |
| distinct battles kept | — | **166,962** |
| `integrity_check` | — | **ok** |

## 0.6 Post-delete verification

Four orphan checks, all **0**, plus the bound:

```
retained pairs with no record        0
retained pairs with no battles       0
records that are not retained        0
stage rows whose pair is not retained 0
max rows in any bucket               50
```

The live board (`/api/analytics/duo-pairs`) answered **736 total**, rendered
8-card decks on both sides, and kept its occurrence counts (top row 10,074).

**Deduplication still holds**: re-inserting an existing `(battle_id, side)` left
`duo_stage` at 176,995 and produced no uncounted row.

## 0.7 Continuous operation — proven live, not asserted

The hourly unit gained a second step, gated on the unit itself rather than on
`/etc/royalweb.env`, so **only this job may delete** and `royalweb` never can:

```
Environment=CLASH_DUO_RETENTION=on
ExecStart=/usr/bin/python3 -u duo_retention.py --maintain --prune
```

(`/etc/systemd/system/royalweb-duo.service`, backed up as
`.bak-20260917-preretention`.)

Run end to end on real new data:

```
fold (duo_pairs.py --update --reconcile)   2m35s  -> +24,863 new pairs, +35,059 staged sides
maintain + prune (duo_retention.py)          5.5s -> counted them, reranked, deleted exactly those
result                                              duo_pairs back to 736
retained pairs GAINED 1,648 new battles             duo_stage 176,995 -> 178,643
uncounted rows afterwards                    0
candidates                                   85,000 (bounded)
overstated                                   0      (still exact)
```

Then the timer was restarted, `Persistent=true` caught up the run it had missed,
and **systemd ran the whole unit itself to `Result=success`, `ExecMainStatus=0`**,
with the census in `/var/log/clashbot/duo.log`. Next run 08:06 UTC.

That is the requirement met in both directions: a retained pair keeps
accumulating its real battles, and the tail is removed the same hour it arrives.

## 0.8 Storage: logical vs physical

| | before | after |
|---|---:|---:|
| `.duo_pairs.db` file | 5,244,731,392 B | **5,254,283,264 B (unchanged)** |
| free pages inside it | 1,853 (7.6 MB) | **1,010,447 (4.14 GB)** |
| live data | ~5.23 GB | **~1.12 GB** |
| `duo_stage` + indexes | 2,186 MB | **111 MB** |
| `duo_pairs` + indexes | 1,819 MB | under 1 MB |
| `battles.db` | 77,057,064,960 B | **77,057,064,960 B (never written)** |

**No physical space has been reclaimed yet, and none is claimed.** 4.14 GB of
the file is now free pages; SQLite will reuse them before growing, so the file
should stay flat for months. Turning them back into disk needs `VACUUM`, which
was deliberately **not run** — it needs its own approval (§0.10).

## 0.9 What was NOT touched, and why

- **`battles` (1,415,839 2v2 rows) and `battle_raw` (930,940 2v2 payloads).**
  Both live in `/var/clashbot/battles.db`, the bot's live database, which this
  repository opens `mode=ro`. Three independent reasons not to write to it:
  deleting rows there frees pages to a freelist that is **already 11.7 GB**, so
  the 77 GB file would not shrink by a byte without a 77 GB `VACUUM` holding an
  exclusive lock on production; the bot's own `enforce_raw_cap` targets exactly
  this data (non-duel raw) and will delete all 930,940 payloads at its next
  restart without us; and there is no backup of that file. **Zero physical gain,
  real risk, redundant work.**
- **`duo_stage_players`** — 5,351,497 rows, and now the largest object in the
  collection at **694 MB with its index**. Most of it is orphaned: participant
  rows for pairs that no longer exist. Pruning it is a straightforward
  `DELETE ... WHERE pair_fp NOT IN (retained)` and would free roughly another
  690 MB, but it is a code path this phase never tested, so it was not run.
  Recommended alongside the `VACUUM`.
- **`duo_participants` / `duo_battle_players`** — the population tier, untouched
  by design; they are keyed by player, not by pair.

## 0.10 Rollback, and what still needs approval

Rollback is one command with `royalweb` stopped:
`cp /var/backups/clashbot/20260917T061905Z/duo_pairs.db /opt/royalweb/server/.duo_pairs.db`
— verified present, hashed, and integrity-checked after the fact. Cheaper still,
`duo_pairs` is derived: `duo_pairs.py --migrate` rebuilds it from whatever raw
payloads survive.

**Needing separate approval:** `VACUUM` on `.duo_pairs.db` (reclaims ~4.14 GB;
needs ~1.2 GB of temp space against 224 GB free, and a brief exclusive lock), and
the `duo_stage_players` prune (~690 MB more). Doing both together is the sensible
single operation.

---

# 1. Exact user requirement

For **every** canonical win condition already supported by Deckkies, keep the
**50 most-used** 2v2 deck/pair combinations, and retain the **actual historical
2v2 battles** belonging to those retained pairs. Delete the rest of the long
tail. Keep the retained set updating as new battles arrive, without letting
storage grow without bound.

The 50 is a cap on **retained identities per win condition**, not on battle
rows: the battle count that follows from it is measured, not assumed (§6, §7).

# 2. Canonical win conditions

**17**, taken from `deck_counter.WIN_CONDITION_MAP` / `WIN_CONDITION_PRIORITY`
— the bot's own map, reproduced in this repo unchanged, and the same rule that
wrote every `battles.player_win_condition`. Nothing was invented, reduced or
re-grouped.

| id | display | id | display | id | display |
|---|---|---|---|---|---|
| `hog` | Hog Rider | `lava` | Lava Hound | `mortar` | Mortar |
| `drill` | Goblin Drill | `giant` | Giant | `xbow` | X-Bow |
| `graveyard` | Graveyard | `balloon` | Balloon | `bait` | Log Bait |
| `miner` | Miner | `e-giant` | Electro Giant | `other` | Mixed |
| `bridge-spam` | Bridge Spam | `golem` | Golem | | |
| `piggies` | Royal Hogs | `3-musk` | Three Musketeers | | |
| `royal-giant` | Royal Giant | | | | |

Source: `server/deck_counter.py:135–149` (map and priority),
`server/clash_data.py:242–260` (`ARCHETYPE_DISPLAY`, 17 entries).

**Assignment** — `deck_counter._archetype_of_hash`, the bot's derivation, no
database read: `miner` pre-empts everything; then `goblin-barrel` or
`wall-breakers` → `bait`; then `WIN_CONDITION_PRIORITY` in order, first match
wins; otherwise `other`. **Exactly one per deck, always defined** — a deck with
no win-condition card is `other`, which is a real bucket and the largest one.

**Per battle/pair: one or two.** A pair is two decks, so it carries one win
condition when both decks share it and two when they differ. Unknown or
unclassifiable decks cannot occur: the classifier is total.

`duo_pairs.py` itself had **no** win-condition concept before this phase; the
classifier is applied to 2v2 decks here for the first time, reusing the existing
canonical function rather than adding a second one.

# 3. Canonical deck/pair unit

**The PAIR, unchanged** (`duo_pairs.py:280–312`):

```
deck_fingerprint(cards) = "2v2d:" + sha1("2v2|" + ",".join(sorted(set(8 keys))))
pair_fingerprint(a, b)  = "2v2:"  + sha1("2v2|" + lo + "|" + hi), (lo,hi)=sorted
```

Order-free at both levels; exactly eight distinct cards or the side is refused
with a named reason; `supportCards` (the tower troop) excluded; mirror pairs
legal; teammate order irrelevant. **Decision: keep the pair.** The unit is the
production canonical one, the module that once stored individual 2v2 decks
(`duo_decks.py`) was deleted deliberately, and the brief says to retain the
existing unit absent a source-backed reason to change it. There is none, and a
second identity format is explicitly what must not be created.

# 4. Current 2v2 architecture

```
bot → battle_raw (raw JSON: the ONLY place a teammate's deck exists)
      battles    (2v2 no longer written since the 2026-09-10 guard)
        │
   battle_modes.classify() → is_duo → duo_pairs._stage() / .observe()
        │
   duo_stage (battle_id, side) ─ dedup by PRIMARY KEY; the fold's source
        │
   duo_pairs._fold()  ─ RECOMPUTES each touched pair (never increments)
        │
   duo_pairs table  →  report()  →  /api/analytics/duo-pairs  →  #/duo (public)
```

# 5. Current VPS storage measurements

**Measured read-only on the production VPS, 2026-09-16/17.** No write, no
delete, no service restart. Figures labelled `measured`, `system-recorded`
(computed by the service itself) or `estimate`.

**Host** — 387 GB volume, 159 GB used, **229 GB free** (measured).

**`/var/clashbot/battles.db` — 77,057,064,960 B = 77.06 GB** (measured; page
32 KB × 2,351,595; freelist 358,169 pages ≈ **11.7 GB already free**)

| object | size | rows |
|---|---:|---:|
| `battle_raw` | **32.3 GB** (+272 MB indexes) | **3,046,896** (measured) |
| — of which 2v2 | ≈ 11.7 GB content (estimate) | **930,940** (measured, 30.6%) |
| — other modes | ≈ 14.5 GB content (estimate) | 2,115,956 (measured) |
| `battles` | **10.4 GB** | 6,694,125 (ANALYZE) |
| — of which 2v2 | ≈ 2.2 GB (estimate, 21.2% of rows) | **1,415,839** (system-recorded 2026-09-16T21:06Z) |
| `decks` | 580 MB | 1,375,209 |
| `player_stats_agg` | 17 MB | 134,755 |

Payload sizes sampled over 80,150 rows in three rowid windows: 2v2 **12,606 B**
average against 6,864 B for other modes — 2v2 payloads are ~1.8× larger, which
is why 30.6% of rows is ~44% of raw bytes.

**`/opt/royalweb/server/.duo_pairs.db` — 5,135,400,960 B = 5.14 GB** (measured;
freelist 2,289 pages ≈ 9 MB)

| object | size | rows |
|---|---:|---:|
| `duo_stage` + its 2 indexes | **2,186 MB** | **3,936,312** |
| `duo_pairs` + its 4 indexes | **1,819 MB** | **2,493,481** |
| `duo_stage_players` + index | 674 MB | 5,197,126 |
| `duo_participants` + 2 indexes | 145 MB | 1,388,585 |
| `duo_battle_players` + 2 indexes | 55 MB | 231,333 |

`duo_meta` (system-recorded): watermark `2026-09-16T18:47:21` — **equal to
`MAX(battle_raw.stored_at)`, so the fold is fully caught up**; `rows_2v2`
1,415,839; reconstructable 1,114,351; unreconstructable 301,488;
`battles_folded` **1,968,156**.

**GROWTH, and it is the reason this phase exists:** the collection was 1,483,672
pairs on 2026-09-11 and is **2,493,481** now — **+1,009,809 pairs in five days,
~200,000 a day**, against **86.2% of all pairs having been seen exactly once**.

**Usage distribution** (measured over all 2,493,481 pairs):

| occurrences | pairs | share |
|---|---:|---:|
| 1 | 2,149,408 | 86.2% |
| 2 | 160,649 | 6.4% |
| 3–5 | 115,034 | 4.6% |
| 6–10 | 39,981 | 1.6% |
| 11–50 | 26,947 | 1.1% |
| 51–200 | 1,292 | 0.05% |
| 200+ | 170 | 0.007% |

Only **22,058** pairs have ever reached 13 uses — the lowest top-50 cut of any
win condition. That single number is what makes a bounded mechanism exact in
practice (§9).

# 6. Top-50 census for every win condition

Computed read-only on the VPS over all 2,493,481 pairs (118 s), classifying both
decks of every pair with the canonical rules.

| win condition | unique pairs | all occurrences | retained | #1 | #50 | occ. of top 50 |
|---|---:|---:|---:|---:|---:|---:|
| other | 1,215,515 | 1,939,621 | 50 | 10,005 | 392 | 81,769 |
| hog | 625,600 | 870,586 | 50 | 1,572 | 93 | 10,278 |
| bait | 627,025 | 866,841 | 50 | 2,678 | 86 | 15,170 |
| bridge-spam | 276,888 | 447,426 | 50 | 1,689 | 125 | 13,939 |
| balloon | 267,944 | 394,328 | 50 | 286 | 66 | 6,566 |
| piggies | 240,692 | 350,203 | 50 | 368 | 67 | 7,032 |
| drill | 208,131 | 325,183 | 50 | 227 | 61 | 4,561 |
| graveyard | 176,750 | 312,318 | 50 | 1,641 | 137 | 15,475 |
| golem | 193,036 | 310,437 | 50 | 2,252 | 80 | 11,730 |
| miner | 209,707 | 298,147 | 50 | 1,058 | 52 | 5,249 |
| lava | 91,715 | 199,266 | 50 | 10,005 | 104 | 25,835 |
| e-giant | 112,746 | 169,200 | 50 | 392 | 44 | 4,150 |
| mortar | 86,977 | 129,634 | 50 | 364 | 43 | 3,697 |
| royal-giant | 88,364 | 122,994 | 50 | 222 | 37 | 3,191 |
| giant | 63,581 | 88,481 | 50 | 218 | 32 | 2,841 |
| xbow | 20,557 | 27,818 | 50 | 292 | 21 | 2,641 |
| 3-musk | 12,756 | 16,774 | 50 | 46 | 13 | 990 |

**All 17 buckets fill.** 17 × 50 = 850 slots hold **736 distinct pair
identities**, because 114 slots are pairs that are top-50 in both of their win
conditions.

**Battles represented** (measured from `duo_stage`):

```
distinct 2v2 battles folded, all time   1,968,156
battles belonging to the 736 pairs        162,274    = 8.24%
duo_stage rows for those pairs             172,001   of 3,936,312 = 4.37%
```

So the answer to "how many battle rows does this keep" is **162,274 battles /
172,001 staging rows**, not 850 — exactly as the brief anticipated.

# 7. Battle-retention semantics

The rule implemented, stated once:

> A battle is retained **iff** its canonical pair is in the top 50 of **at least
> one** of that pair's win conditions.

Consequences, all deliberate:

- a pair top-50 in either of its two win conditions is kept whole — a Hog+Golem
  partnership is evidence about Hog *and* about Golem, and dropping it from one
  list because the other is more crowded answers a different question;
- a battle is kept once, not once per win condition — `duo_stage` is keyed
  `(battle_id, side)` and membership is a set;
- "retained battle" means **the staging record of that battle** (its identity,
  side, pair, decks, time and mode), which is what `duo_stage` holds and what
  `_fold` can recompute a pair from. It does **not** mean the raw JSON payload,
  for the reason in §11.

# 8. Future update mechanism

Implemented in `server/duo_retention.py`:

```
new 2v2 battle
  → duo_pairs.observe()            [unchanged: dedup by (battle_id, side)]
  → _fold() recomputes touched pairs
  → duo_retention.observe_pairs(con, [(pair_fp, deck_a, deck_b, count)])
        → win_conditions(deck_a, deck_b)        1 or 2 canonical buckets
        → note(): Space-Saving per bucket
              already a candidate → += count
              room in the bucket  → insert, exact count, overstated = 0
              bucket full         → replace the WEAKEST, inherit its count,
                                    record the inherited part as `overstated`
        → rerank() the touched buckets only
  → commit (same transaction as the fold)
```

- **Weakest = `occurrences ASC, pair_fp DESC`**, the exact inverse of the
  retention order, so the row evicted is always the one ranking puts last.
- **Duplicates/retries**: inherited, not re-implemented. `observe()` only reaches
  a fold for a `(battle_id, side)` its primary key accepted, so a replayed
  battle never reaches this module.
- **Concurrency**: the rerank runs in the fold's transaction on the same WAL
  database with a 30 s busy timeout, so a reader never sees a bucket of 51 or a
  bucket mid-rewrite.
- **#51 → #50 and #50 → #51** are the same code path and are both tested.

**Not wired into `observe()` in this phase, deliberately.** The hook is a single
call at `duo_pairs.py:1506` (after `_fold(con, set(fresh))`). Adding it changes
the behaviour of the hourly ingestion that runs in production, and this phase is
not authorised to deploy; the line belongs in the same change that turns the
retention on. Everything it needs is implemented and tested.

# 9. Exactness analysis

**Exact today; bounded-approximate by construction, with the error stored.**

- A **rebuild** is exact: counts come from `duo_pairs.occurrences`, which was
  folded from the staging ledger, so every row it writes has `overstated = 0`.
- **Incremental** updates are Space-Saving: a pair entering a full bucket
  inherits the evicted minimum, so a count can be **overstated by at most that
  minimum and never understated**, and the inherited part is written to
  `overstated` rather than left to be discovered.
- **How close that is to exact, measured**: the default bucket is
  `CANDIDATES_PER_WC = 5,000` (85,000 rows across 17 buckets), while only
  **22,058 pairs in the entire live collection have ever reached 13 uses**, the
  lowest top-50 cut. The candidate pool is therefore several times larger than
  the whole population that has ever been in contention, and on today's
  distribution the incremental result is exact. `verify()` re-derives the
  buckets from `duo_pairs` independently and would report any drift;
  `retainedWithOverstatedCount` is the tripwire that says exactness has ended.

Claiming unconditional exactness forever would require keeping a counter for
every pair ever seen — 2.49M rows growing at 200k/day, which is the unbounded
store this phase exists to remove. The trade is stated rather than hidden.

# 10. Historical cleanup design — PREPARED, NOT EXECUTED

Order (never delete first):

1. `duo_retention.rebuild()` — exact census into `duo_candidates` +
   `duo_retained` (~2 min on the live file).
2. `duo_retention.verify()` — independent re-derivation; must report `ok: true`,
   no bucket over depth, and `retainedWithOverstatedCount == 0`.
3. `duo_retention.prune_plan()` — the counts below, re-measured at run time.
4. **Backup** (§15), verified by hash.
5. `apply_prune(confirm=True)` with `CLASH_DUO_RETENTION=on` — deletes
   non-retained rows from `duo_pairs` only.
6. `duo_stage` pruning is a **separate switch** (`stage=True`), off by default —
   see §13.
7. `VACUUM` **not run**; it needs its own approval.

Projected effect on `.duo_pairs.db`, from the measured object sizes:

| object | now | after | freed (logical) |
|---|---:|---:|---:|
| `duo_pairs` + indexes | 1,819 MB / 2,493,481 rows | ~1 MB / **736 rows** | ~1.8 GB |
| `duo_stage` + indexes (step 6, optional) | 2,186 MB / 3,936,312 rows | ~95 MB / **172,001 rows** | ~2.1 GB |
| total | **5.14 GB file** | ~1.2 GB of live data | **~3.9 GB (76%)** |

Physical file size does not change until `VACUUM`; freed pages go to the
freelist. Logical and physical reduction are reported separately.

# 11. `battle_raw` analysis — the finding that matters most

**This retention cannot reduce `battle_raw`, and it must not try. The bot
already deletes every 2v2 payload on its own schedule — including the payloads
of retained battles.**

Evidence, all measured:

- `CLASH_RAW_CAP_BYTES = 26843545600` (25 GiB) in `/opt/clashbot/.env`;
  `battles.db` is **77.06 GB**, far over the cap.
- `enforce_raw_cap` (`clashdb.py:3519`) drops **non-duel** raw when the database
  exceeds the cap. 2v2 is non-duel, so 2v2 raw is exactly what it targets.
- It runs from `archive.run_two_tier_maintenance`, called only by
  `_run_startup_maintenance_inner` (`bot.py:5798`) — **startup-only**, gated on
  `maintenance_due`.
- The bot has been up since **2026-09-12** and `journalctl -u clashbot` has **no
  RAW CAP or purge line in 14 days**. That is why `battle_raw` has grown to
  32.3 GB holding 930,940 2v2 payloads.
- The duo fold cursor equals `MAX(stored_at)`, so **every** 2v2 payload is
  already folded and therefore purgeable by the interlock's own rule.

**So at the next bot restart, all 930,940 2v2 payloads (≈ 11.7 GB) are deleted
by the bot** — retained pairs' payloads included. Two consequences:

1. **No `battle_raw` saving may be attributed to this phase.** That space is the
   bot's to reclaim and it will reclaim it without us.
2. **"Keep their actual battles" cannot mean keeping raw JSON.** Raw is
   transient by design here. It has to mean the staging record in our own
   store — which is what §7 defines and what the implementation retains.

**Nothing in this phase deletes, or proposes deleting, anything in
`battle_raw`.** Separately worth the account holder's attention: raw growth is
unbounded between bot restarts, which is a pre-existing operational bug (§25).

# 12. `battles` analysis

`battles` holds **1,415,839** historical 2v2 rows (~2.2 GB estimated), frozen
since the 2026-09-10 guard. **Not touched, and not touchable from here:**

- this repository opens the bot's database `mode=ro` (`clash_data.connect`), a
  guarantee both READMEs state and `tracking.py` exists to preserve;
- the four measured blockers on that deletion all still stand — 21.8% of the
  rows are unreconstructable, `player_stats_agg` demonstrably counts 2v2 and
  `rebuild_aggregates` has no live caller, the bot is the writer, and there is
  no backup;
- `CLASH_RETENTION_DAYS = 304` will age them out from ~2027-04 anyway.

# 13. `duo_stage` analysis

It is the **deduplication ledger** (`PRIMARY KEY (battle_id, side)`) and the
**source `_fold` recomputes from**. Both roles are why its pruning is a separate,
default-off switch:

- deleting a pair's staging rows means that pair can no longer be recomputed,
  and a replayed battle for it would be counted again from zero;
- for a **non-retained** pair that is acceptable — the record is gone either way,
  and its count survives in `duo_candidates`, so a comeback resumes rather than
  restarts;
- for a **retained** pair it would be destructive, so the prune keeps every
  staging row whose pair is retained (172,001 rows).

It is also the largest object in the collection (2,186 MB with indexes), so it
is where most of the reclaimable space is. Recommendation: prune it in the same
approved step, after the pair prune verifies.

# 14. `duo_pairs.db` analysis

**Yes — it becomes the bounded store, and no second database is created.** The
two new tables (`duo_retained`, `duo_candidates`) live in the existing file,
created idempotently, so a rerank and the fold it follows share one transaction.
`duo_retained` is ≤ 850 rows; `duo_candidates` is ≤ 85,000 rows (~10 MB). The
census tables keep their schema; only their row count changes.

# 15. Backup plan

Required before step 5 of §10, and **not yet performed** (nothing is being
deleted yet):

```
target   /opt/royalweb/server/.duo_pairs.db        5,135,400,960 B
method   sqlite3 .backup  (consistent under WAL; a cp of a live WAL file is not)
to       /var/backups/clashbot/<UTC stamp>/duo_pairs.db
verify   sha256sum both, compare; then
         sqlite3 <copy> "PRAGMA integrity_check;" -> ok
         sqlite3 <copy> "SELECT COUNT(*) FROM duo_pairs;" -> 2,493,481
space    229 GB free; the backup needs 5.14 GB. There is room.
```

A precedent exists: `/var/backups/clashbot/20260910T2005/` already holds a
75 GB backup set including a `duo_pairs.db`. `battles.db` needs **no** backup for
this phase because this phase does not modify it.

# 16. Rollback plan

- Before the prune: restore the verified backup over `.duo_pairs.db` with
  `royalweb` stopped, restart. Complete.
- After a pair-only prune (`stage=False`): **no backup is strictly needed** —
  `duo_pairs` is derived, and `duo_pairs.migrate()` rebuilds it from `duo_stage`.
  That is the reason the two switches are separate.
- After a staging prune: the backup is the only route back, because the ledger
  those rows came from (`battle_raw`) is purged by the bot.
- Code rollback: delete the two new files; nothing existing was modified.

# 17. Implementation

**Two new files. No existing source file was changed.**

| file | lines | what |
|---|---:|---|
| `server/duo_retention.py` | 398 | the bounded retained set: canonical classification, Space-Saving counters, rerank, rebuild, independent verify, prune plan, gated prune |
| `server/test_duo_retention.py` | 331 | 64 checks (§18) |

Design points worth keeping:

- reuses `deck_counter`'s taxonomy and `duo_pairs`' identity — **no second
  classifier, no second identity format, no second database**;
- `RETAIN_PER_WC = 50`, `CANDIDATES_PER_WC = 5000`, both env-overridable;
- **ships dark**: `apply_prune` refuses unless `confirm=True` **and**
  `CLASH_DUO_RETENTION` is enabled, the convention `CLASH_OIE=off` and
  `PROMOTION_ENABLED` already follow. `prune_plan()` always works, because
  reporting what would be removed must work where removing it is not authorised;
- `verify()` re-derives the answer from `duo_pairs` rather than re-running the
  builder — a check that shares its arithmetic with the thing it checks is not a
  check.

# 18. Tests

`python server/test_duo_retention.py` → **64 passed, 0 failed**, covering all 16
required behaviours:

| # | behaviour | covered by |
|---|---|---|
| 1 | every canonical win condition gets its own top 50 | `test_each_win_condition_keeps_its_own_fifty` |
| 2 | exactly the top 50 retained | same + `test_the_hard_bound` |
| 3 | ranking is usage-count based | `test_ranking_is_usage_and_ties_are_deterministic` |
| 4 | ties deterministic (and stable across reruns) | same |
| 5 | a new pair can enter | `test_a_new_pair_can_enter_…` |
| 6 | #50 displaced by #51 | same |
| 7 | usage counts update correctly | `test_a_count_outlives_the_record` |
| 8 | duplicates not double-counted | `test_staging_dedup_and_1v1_are_untouched` |
| 9 | multiple win conditions handled | `test_multiple_win_conditions` |
| 10 | retained battles correspond exactly to retained pairs | `test_retained_battles_match_retained_pairs` |
| 11 | non-retained battles eligible for cleanup | same (`prune_plan`) |
| 12 | 1v1 untouched | `test_staging_dedup_and_1v1_are_untouched` |
| 13 | duel data untouched | same (asserts the source never names `battles`, `battle_raw`, `duel_timeline`) |
| 14 | `duo_stage` dedup still works | same |
| 15 | ≤ 50 identities per win condition | `test_the_hard_bound` |
| 16 | discarded candidates cannot grow storage | `test_discarded_candidates_do_not_accumulate` (400 one-off pairs → table stays at its cap) |

**A fixture bug was found and fixed while writing these**, and it is the kind
this project keeps paying for: the deck generator rotated a 20-card filler list,
so asking for 70 distinct decks silently produced 20 and every bucket-depth
assertion passed against a bucket that could never fill. It uses
`itertools.combinations` now, and the note is in the source.

# 19. Before/after storage

**Before (measured):** `.duo_pairs.db` **5.14 GB**, 2,493,481 pairs, 3,936,312
staging rows.

**After: not measured, because nothing has been deleted.** Projected from the
measured object sizes: ~1.2 GB of live data, **~3.9 GB freed logically (76%)**,
physical size unchanged until an approved `VACUUM`. No saving is claimed as
achieved.

`battles.db` (77.06 GB) is **unchanged and out of scope** (§11, §12).

# 20. Data deleted

**None.** No row was deleted on the VPS or locally. Every VPS command in this
phase was a read: `ls`, `df`, `systemctl is-active`, `journalctl`, `sqlite3
-readonly`, and Python opening both databases with `mode=ro`. One scratch file
(`/tmp/p13a_retained.json`, the 736 fingerprints) was written to `/tmp` and holds
no player tag.

# 21. Data retained

Everything. Additionally *identified* for retention when the cleanup is
approved: **736 pair identities** and **162,274 distinct battles** (172,001
staging rows).

# 22. Existing feature impact

Nothing changed, so nothing is affected today. When the prune is approved:

- `/api/analytics/duo-pairs` keeps its signature, sorts, paging and card filter;
  route-count tripwire stays **22**;
- `#/duo` (public, trial and up) would show a collection total of 736 instead of
  2,493,481, and its **123-card server-side filter would return nothing for most
  cards** — today `hog-rider` alone matches hundreds of thousands of pairs. That
  is the visible cost of the requirement and it should be a conscious choice;
  the artifact recommends surfacing the retained-set semantics in the header
  copy at the same time;
- `summary.pairs` / `summary.occurrences` change meaning from "the census" to
  "the retained head" and should be relabelled in the same change.

Regression run this phase: `test_duo_pairs` **425**, `test_battle_modes` **135**,
`test_recent_battles` **40**, `test_duo_retention` **64**, `test_coach` **69**,
`test_tracking` **8**, `test_duel_combos` **55**, `test_ml_production` **91 OK**,
`test_ml_22_final` **67 OK**, `test_api_security` **73 OK** — all green.
`test_ml_21a` keeps its unrelated pre-existing failure (`123 != 122`), untouched.

# 23. Brain impact

A storage optimisation, nothing more. **No claim is made that it improves
prediction accuracy** — it cannot; the OIE does not read 2v2.

What becomes impossible once the tail is deleted, recorded honestly:

- **adoption and novelty research over 2v2** — 86.2% of pairs are single sightings,
  and that tail is exactly where a new partnership first appears. Brain Phases
  4–7 were about displacement and adoption signals of that kind;
- **re-deriving any 2v2 statistic over the full population** (distributions,
  coverage, per-player 2v2 history beyond the retained head);
- **rebuilding the census**, because the raw payloads it was folded from are
  purged by the bot at every restart and 21.8% of the historical battles are
  already unreconstructable.

What remains sufficient: the top-50-per-win-condition product surface, exact
usage counts for the retained head, and the full participant/population tier
(`duo_participants`, untouched).

# 24. Known risks

1. **Irreversible.** The census cannot be rebuilt once raw is purged; only the
   backup protects it.
2. **A public screen gets much smaller answers**, especially under the card
   filter (§22).
3. **The `other` bucket is the largest** (1.2M unique pairs) and keeps 50 decks
   that share no win condition, while the 51st-most-played Hog pair is dropped.
   That follows from the requirement as stated; worth a look before approving.
4. **Space-Saving overstatement** if the tail ever thickens past the candidate
   pool — bounded, recorded per row, and visible via `verify()`.
5. **The hook is not wired**, so until it is, a rebuild is needed to refresh the
   retained set (§8).
6. **`battle_raw` keeps growing between bot restarts** regardless of this work
   (§25).

# 25. Known bugs

- **NEW: the bot's raw purge is startup-only and the bot rarely restarts.**
  `maintenance_due` is checked only in `_run_startup_maintenance_inner`, so with
  the bot up since 2026-09-12 no purge has run in 14 days of logs and
  `battle_raw` has grown to 32.3 GB against a 25 GiB cap. The database is
  77.06 GB against ~33 GB in the documentation. **Bot-side, outside this
  repository, not fixed here.**
- **NEW: `sqlite_stat1` is badly stale** — it estimates `battle_raw` at 414,053
  rows against an actual 3,046,896. Any planner decision or capacity estimate
  taken from ANALYZE data on this database is wrong by ~7×.
- Pre-existing, unchanged: `test_ml_21a` `123 != 122` (Brain KNOWN BUGS #2).

# 26. What changed

- `server/duo_retention.py` (new)
- `server/test_duo_retention.py` (new)
- `DECKKIES_BRAIN_PHASE13A_2V2_TOP50_RETENTION.md` (this artifact)
- `DECKKIES_BRAIN_README.md` (Phase 13A corrected entry)

# 27. What did NOT change

`duo_pairs.py`, `battle_modes.py`, `app.py` and its route count, every frontend
file, the `#/duo` screen, `deck_counter.py`, the Phase 12 timestamp commit
(`predictor.py`, `shadow.py`, the spec, both ML test suites), `CLASH_OIE`, Coach
Assist, the prediction engine, candidate pools, alternatives, model artifacts,
calibration, 1v1, duel data, and every production database on the VPS.

# 28. Deployment status

**NOT DEPLOYED.** Local code only. VPS access was **read-only measurement**, as
authorised: no write, no delete, no restart, no configuration change, no
production database modification. The two new files are not on the VPS.

# 29. Next approval

1. **The destructive cleanup**, which needs explicit approval and must run on
   the VPS because that is where the data is. Exact sequence in §10, with the
   backup of §15 first. Recommended as one approved run: backup → rebuild →
   verify → plan → prune pairs → prune staging → re-measure. `VACUUM` separately.
2. **Wiring the hook** (one line at `duo_pairs.py:1506`) plus deploying
   `duo_retention.py` — the same change, since a bounded set that is not
   maintained goes stale immediately.
3. **A decision on the `#/duo` copy** (§22), since the screen's meaning changes
   from census to retained head.
4. **Bot-side: the startup-only maintenance bug** (§25) — the actual reason the
   database is 77 GB.

Unrelated and still pending: **Brain Phase 13 — the dark deployment of the
timestamp fix** (`a9cdbb7`), untouched by this phase.
