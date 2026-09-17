# DECKKIES BRAIN — PHASE 13A

## 2v2 top-50-per-win-condition storage compaction — BLOCKED (nothing implemented, nothing deleted)

```
Date        2026-09-17
Mode        READ-ONLY investigation. Implementation was authorised but is BLOCKED on
            two facts that cannot be decided here, and a third that changes the shape
            of the request. No code changed. No data deleted. No deployment.
Repository  main @ a9cdbb7 (the Phase 12 timestamp commit), working tree otherwise clean
Status      BLOCKED
```

> **Nothing was implemented and nothing was deleted, deliberately.** Three of the
> brief's own stop conditions fired: the six win conditions it instructs me to use do
> not exist in this codebase, the 2v2 data it instructs me to measure and compact is
> not on this machine, and the store it names does not hold decks. Each is recorded
> below with the source evidence, and each has a decision waiting for the account
> holder rather than a guess made on their behalf.

---

# 1. Objective

Reduce 2v2 storage by retaining only the top 50 most-used 2v2 decks for each of six
win conditions — at most 300 deck records — deleting the long tail, and keeping the
top-50 lists updating as new 2v2 battles arrive.

# 2. Exact user requirement

> For EACH of those six win conditions: keep only the TOP 50 MOST-USED 2v2 DECKS.
> 6 win conditions × 50 decks = maximum 300 retained deck entries. Everything outside
> those top-50 lists should be deleted. The list must continue updating as new 2v2
> battles arrive.

Explicitly **not**: top 50 battles, players, teammate pairs, globally, by win rate, by
wins, or by archetype. Explicitly forbidden: inventing a seventh win condition,
redefining the six, replacing "most-used" with "highest win rate".

This artifact does not dispute the requirement. It reports that three preconditions it
assumes are not true of this repository.

# 3. Six win conditions

**THERE IS NO SIX-WAY WIN-CONDITION TAXONOMY IN THIS CODEBASE.** I searched every
Python module in `server/`, every TypeScript source in `src/`, `cardMeta.json`, and all
14 Brain artifacts. Three taxonomies exist. None has six members, and the only thing
that does have six members is not a win-condition taxonomy.

| # | what | cardinality | source | used by |
|---|---|---:|---|---|
| A | win-condition **cards** | **23** | `src/data/cardMeta.json`, `is_win_condition` | `WinConFilter.tsx` (`WIN_CONDITIONS`), `deck_harmony.is_win_condition`, `clash_data.deck_name`, the card picker's "Win Cons" tab |
| B | win-condition **archetypes** | **16 + `other` = 17** | `deck_counter.WIN_CONDITION_MAP` + `WIN_CONDITION_PRIORITY`, reproduced unchanged from the bot's `cards.py` | `battles.player_win_condition` / `opponent_win_condition` (stored by the bot), `deck_counter.win_condition_of`, `_archetype_of_hash`, `clash_data.ARCHETYPE_DISPLAY` (17 entries) |
| C | play **styles** | **6** | `deck_counter.STYLE` | the Deck Counter's "counter types" breakdown only |

**A (23 cards)** — `balloon, battle-ram, electro-giant, elixir-golem, giant,
goblin-barrel, goblin-drill, goblin-giant, golem, graveyard, hog-rider, lava-hound,
miner, minion-giant, mortar, ram-rider, royal-giant, royal-hogs, skeleton-barrel,
suspicious-bush, three-musketeers, wall-breakers, x-bow`.

**B (17 archetypes)** — `3-musk, bait, balloon, bridge-spam, drill, e-giant, giant,
golem, graveyard, hog, lava, miner, mortar, piggies, royal-giant, xbow`, plus `other`.
This is **the canonical taxonomy of this project**: it is the bot's own map, it is what
is physically stored in the `battles` table, and `deck_counter.py` states why it must
not be re-derived differently here ("a second classifier here would eventually
disagree"). Assignment is a **priority list, first match wins**, with two hard-coded
pre-empts — `miner` always takes priority, then `goblin-barrel`/`wall-breakers` →
`bait` — then `WIN_CONDITION_PRIORITY` in order, else `other`. Exactly one archetype is
assigned to any deck, and a deck with no win-condition card gets `other`.

**C (6 styles)** — `Beatdown, Bridge Spam, Control, Cycle, Mixed, Siege`. This is the
only six in the codebase, and it is **not a win-condition taxonomy**:

- its own source comment calls it "counter types … Beatdown / Control / Siege / Bridge
  Spam" and says **"NOTHING IN THE DATABASE CARRIES THAT: the stored taxonomy is
  `win_condition`, which is a card, not a play style"**;
- it says the mapping "is opinion … and the UI says the grouping is editorial";
- it is derived *from* taxonomy B, so it is a grouping of win conditions, not a set of
  them;
- one of its six, `Mixed`, is precisely the bucket for decks that have **no single win
  condition** — so "the six win conditions" would include a category meaning "no win
  condition".

Using C would be **redefining "win condition" as "play style"**, which the brief
forbids. Cutting B down to six would be **redefining the six**, also forbidden.
Grouping A's 23 cards into six would be **inventing**, forbidden three times over.

**This is stop condition 1.** The phase cannot proceed until the account holder says
which taxonomy they meant. §32 carries the decision.

# 4. Canonical deck definition

The 2v2 subsystem has a canonical deck identity, and it is not the unit the brief asks
to retain.

```
deck_fingerprint(cards)  = "2v2d:" + sha1("2v2|" + ",".join(sorted(set(8 card keys))))
pair_fingerprint(a, b)   = "2v2:"  + sha1("2v2|" + lo + "|" + hi)   where (lo,hi)=sorted
```

- **Order-free at both levels.** The eight card keys sort before hashing; the two deck
  fingerprints sort before hashing. `Deck A + Deck B` and `Deck B + Deck A` are one
  record (`duo_pairs.py:280–312`).
- **Exactly eight distinct cards**, or the side is refused with a named reason
  (`not_eight_cards:n`, `unknown_card:<id>`, `duplicate_cards:n`). `supportCards` (the
  tower troop) is deliberately excluded.
- **Teammate normalisation**: a side is skipped entirely unless both participants
  resolve — "half a pair is not a pair". Mirror pairs are legal and keep their own
  identity.
- **Battle identity** (`sha1(battleTime + sorted four tags)`) folds the 2–4 stored
  copies of one battle into one observation.

**THE STORED UNIT IS A PAIR OF DECKS, NOT A DECK — BY AN EXPLICIT PAST DECISION.**
`duo_pairs.py`'s opening lines: *"THE UNIT IS A PAIR OF TEAMMATE DECKS, NOT A DECK … An
earlier version of this module collected individual decks and was wrong for exactly
that reason — 364,357 individual decks is not an answer to 'what do people play in
2v2', because the thing a 2v2 player chooses is a partnership."* That earlier module,
`duo_decks.py`, was **deleted** (recorded in `CLAUDE.md`).

Consequences for this phase:

1. There is **no deck-level 2v2 record anywhere** to rank or retain. `duo_pairs` stores
   `deck_a_fingerprint`/`deck_b_fingerprint` inside a pair row; no table is keyed by a
   single 2v2 deck, and no usage count exists per 2v2 deck.
2. A pair contains **two** decks, so it has **up to two** win conditions. "The win
   condition of a 2v2 record" is undefined under the current model, and defining it
   (pick deck A's? the higher-priority one? store the pair twice, once per bucket?) is
   a new rule — i.e. inventing.
3. Building a per-deck 2v2 store would **re-create the approach this project already
   tried, measured and deleted**. That may still be what the account holder wants, but
   it must be a deliberate reversal, not a side effect of a storage ticket.

**This is stop condition 3.** §32 carries the decision.

# 5. Most-used definition

Understood exactly as stated: **usage frequency**, never win rate, wins, EV, recency,
player count or any weighted score.

The existing system already has the right counter and the right tie-breaker, and they
should be reused verbatim rather than re-invented:

- `duo_pairs.occurrences` — how many distinct real battles the record was seen in.
  Deduplicated by `battle_identity`, so the 51,671 rows with a tracked opponent cannot
  inflate it up to 4×.
- `SORTS["played"] = "occurrences DESC, pair_fingerprint"` (`duo_pairs.py:151–156`).

So the established deterministic rule, which the brief's own fallback matches, is:

```
1. occurrences DESC
2. fingerprint ASC        (the existing canonical deterministic key)
```

If the retained unit becomes a deck rather than a pair, the equivalent is
`usage_count DESC, deck_fingerprint ASC`, and the counter does not exist yet — it would
be the "smallest required counter" the brief anticipates.

# 6. Current architecture

Traced end to end in source:

```
bot (separate codebase, /opt/clashbot/clashdb.py) writes battle_raw + battles
        │
        ├── battles          2v2 rows NO LONGER WRITTEN since the 2026-09-10 guard;
        │                    ~1.38M historical 2v2 rows remain. Opened mode=ro here.
        └── battle_raw       the full JSON payload — the ONLY place a teammate's deck
                             exists (a `battles` row has one deck + one opponent deck)
        │
   battle_modes.classify(game_mode)      ← routing decided FIRST, on the mode string
        │  is_duo → _DUO_MARKERS ("teamvsteam", "2v2")
        ▼
   duo_pairs._stage()  /  duo_pairs.observe()      ← the two ingestion paths
        │  pairs_from_payload → 2 pair records per battle (team's + opponents')
        ▼
   duo_stage         PRIMARY KEY (battle_id, side)   ← dedup by CONSTRAINT
   duo_stage_players PRIMARY KEY (pair_fp, tag)
   duo_battle_players PRIMARY KEY (battle_id, tag)   ← pruned to the top-1,000 players
        │
   duo_pairs._fold()   ← RECOMPUTES each touched pair from duo_stage (never increments)
        ▼
   duo_pairs table (in server/.duo_pairs.db)         ← the authoritative pair census
        │
   duo_pairs.report(page, per, query, sort, cards)
        ▼
   GET /api/analytics/duo-pairs  (app.py:515, route-count tripwire 22)
        ▼
   src/components/Analytics/DuoDecks/  →  #/duo   (a public screen, not admin)
```

**Which store is responsible for what the UI shows: `duo_pairs.db`, table `duo_pairs`,
exclusively.** `report()` reads only that table (plus `duo_participants` for two summary
counts). `battles` and `battle_raw` are upstream inputs, read during migration only.

Two notes that bear on any deletion plan:

- **The 2v2 screen is `#/duo`, and it is not an admin page any more.** It moved off the
  admin console on 2026-09-11; the console's copy and `#/admin/duo` were deleted. It is
  gated like Team Analysis: everyone sees it, trial and above open it. So a compaction
  that empties it is user-visible, not operator-visible.
- **`battles` is opened `mode=ro` by this repository** (`clash_data.connect`), a
  guarantee stated in both READMEs and the reason `tracking.py` exists. **This repo
  cannot delete a `battles` row even if asked to.**

# 7. Current storage measurements

**NOT MEASURABLE ON THIS MACHINE — this is stop condition 2, and it is decisive for
steps 6, 11, 12 and 14 of the brief.**

Probed directly:

```
clash_data.resolve_db_path()        -> None          (H: unplugged; battles.db is on the VPS)
duo_pairs.DB_PATH                   -> server/.duo_pairs.db
os.path.exists(duo_pairs.DB_PATH)   -> False         (the collection lives on the VPS)
```

There is **no 2v2 data on this machine at all**: no `battles.db`, no `battle_raw`, no
`.duo_pairs.db`. Every figure the brief asks me to produce — current 2v2 row count,
unique canonical decks, count per win condition, decks that would remain, rows that
would be removed, file size before and after — requires reading the VPS, and this phase
forbids VPS contact. The brief anticipates exactly this: *"If implementation requires
deployment to validate storage behavior, stop and report that deployment requires
separate approval."*

**Documented figures only** (from the repository's own records, NOT measured in this
phase, and all now days-to-weeks stale):

| quantity | figure | source | date |
|---|---:|---|---|
| unique teammate pairs, live | 1,483,672 | `README.md`, CLAUDE.md | 2026-09-11 |
| battles folded into them | 1,114,663 | same | 2026-09-11 |
| 2v2 rows in `battles` (historical) | 1,381,535 | `duo_pairs.py` docstring | 2026-09-10 |
| …with a surviving raw payload | 1,080,047 (78.2%) | same | 2026-09-10 |
| …unreconstructable, permanently | 301,488 (21.8%) | same | 2026-09-10 |
| `duo_participants` rows | 866,226 | Brain README §7 | 2026-09-10 |
| `duo_battle_players` after prune | 141,710 (from 3,779,880) | CLAUDE.md | 2026-09-10 |
| each of the 3 `duo_pairs` indexes | ~75 MB | `duo_pairs.py:424–434` | 2026-09-10 |
| `battle_raw` | 44.7 GB | Brain README, CLAUDE.md | 2026-09-10 |
| `battles.db` | ~33 GB | Brain README, CLAUDE.md | 2026-08 |

**No `.duo_pairs.db` file size has ever been recorded anywhere in this repository.** An
arithmetic estimate from the row shapes puts the `duo_pairs` table in the region of
0.5–1 GB plus ~225 MB of indexes, but that is an estimate and this artifact will not
present it as a measurement.

**Which produces the finding that most deserves the account holder's attention:** the
store this phase would compact is, on the documented numbers, **on the order of 1 GB out
of ~78 GB of 2v2-bearing storage**. The 2v2 bulk is `battle_raw` (44.7 GB, holding the
JSON payloads) and the ~1.38M historical 2v2 rows inside the 33 GB `battles.db`.
Compacting `duo_pairs` to ≤300 records would delete the 2v2 census — the answer to
"what do people play in 2v2" — while leaving essentially all of the 2v2 storage cost in
place. See §16 and §18.

# 8. Target storage model

If the phase were unblocked, the target is well defined and modest:

```
duo_pairs_top (or duo_pairs, compacted)
    bucket          TEXT     -- the win condition / category, per the §3 decision
    fingerprint     TEXT     -- the existing canonical key, unchanged
    cards           TEXT     -- JSON, exactly as stored now
    usage_count     INTEGER  -- battle-deduplicated occurrences
    distinct_players INTEGER
    first_seen      TEXT
    last_seen       TEXT
    source_modes    TEXT
    PRIMARY KEY (bucket, fingerprint)
```

≤ 6 × 50 = **300** rows, plus a bounded candidate sketch (§9).

Fields are not negotiable downward: `report()`/`_pair_row()` currently requires
`pair_fingerprint, mode, deck_a_fingerprint, deck_b_fingerprint, deck_a_cards,
deck_b_cards, occurrences, distinct_players, player_tags, first_seen, last_seen,
source_modes`, and the UI renders card art, average elixir, both fingerprints, the
mirror flag, occurrence count, player count, first/last seen and the source modes. A
retained row must carry all of it or the existing screen changes.

No battle-level data is needed in the retained store.

# 9. Update algorithm (designed, NOT implemented)

The eviction/re-entry problem the brief identifies is real and is a solved problem in
the literature; the smallest correct mechanism is a **bounded heavy-hitters counter
(Space-Saving / Misra–Gries)**, per bucket:

```
on each new deduplicated 2v2 observation (hook: duo_pairs.observe, after _fold):
    bucket  = classify(record)                      # per the §3 decision
    key     = existing canonical fingerprint
    if key in top[bucket]:            top[bucket][key].count += 1
    elif len(top[bucket]) < 50 + K:   top[bucket][key] = {count: min_count + 1, ...}
    else:                             # replace the weakest candidate, keeping its count
        evicted = argmin(count, fingerprint)
        top[bucket][evicted → key] = {count: evicted.count + 1, overstated: evicted.count}
    prune bucket to 50 + K rows
```

`K` is a small candidate margin (K≈50 → ≤600 rows total, still tiny) that is what lets a
newly popular deck climb back in without retaining the tail: a re-entering deck inherits
the evicted minimum rather than restarting at 1, which is the standard Space-Saving
guarantee — counts may be **overstated by at most the current bucket minimum, never
understated**. That error bound must be stored (`overstated`) and surfaced, because this
project does not ship figures whose error is invisible.

Without `K`, a deck evicted at #51 restarts from zero on every re-entry and can never
climb back — the exact failure the brief names.

**Idempotency comes free from the existing design** and must not be re-implemented:
`duo_stage`'s `PRIMARY KEY (battle_id, side)` makes a replayed battle a no-op, and
`_fold()` **recomputes** a touched record from staging rather than incrementing it. Any
top-50 counter must be derived from that fold, not incremented alongside it, or the two
implementations of "what a record's count is" will eventually disagree — a failure mode
this module's comments already record.

Transactions: one `BEGIN IMMEDIATE` around (fold → rerank → evict) per observation, on a
WAL database with a 30 s busy timeout, matching what `observe()` already does.

**Not implemented in this phase**, because every line of it depends on `classify()`,
which depends on the undecided §3 taxonomy, and on the undecided §4 unit.

# 10. Historical rebuild

**NOT PERFORMED.** Impossible here: the historical data is on the VPS (§7). The correct
sequence is the brief's own and is not in dispute — compute usage per (bucket, deck)
from the existing collection, select the top 50 per bucket, write the compact state,
verify it independently, and only then delete. Never delete first.

Note the rebuild input would be `duo_pairs` itself (1.48M rows with counts already
folded), not `battle_raw` — so the rebuild is a single ranked scan of a local SQLite
file, not a twenty-minute re-read of a 44.7 GB table.

# 11. Cleanup performed

**NONE. Nothing was deleted, compacted, moved or rewritten.** No file in `server/` was
modified. No database was opened for writing. No `VACUUM`.

# 12. Duplicate / idempotency handling

Existing and sufficient; reuse it, do not rebuild it:

- `battle_identity()` = `sha1(battleTime + sorted four tags)` — one value per real
  battle however many rows carry it (a battle reaches the collection up to 4× because
  `battle_raw` is keyed `(player_tag, battle_time)`).
- `duo_stage PRIMARY KEY (battle_id, side)` — a replay is a constraint no-op.
- `observe()` checks **per side**, not per battle, so a battle whose team side failed on
  an unknown card can still be completed later — a fix already made once and worth not
  regressing.
- `_fold()` recomputes rather than increments, so completing a half-staged battle cannot
  double-count.

# 13. Transaction / concurrency handling

Existing: WAL, `timeout=30.0`, `check_same_thread=False`, a module `_lock` around
schema creation, and a single commit per `observe()`. The hourly `royalweb-duo.timer`
(`duo_pairs.py --update --reconcile`) and a live `observe()` can overlap; WAL plus the
30 s busy timeout is what handles that today. A rerank-and-evict step must live inside
the same transaction as the fold it follows, or a reader can observe a bucket with 51
rows or with a hole. Designed, not implemented.

# 14. Exact retained counts

**Not applicable — nothing was retained or removed.** The target, once unblocked, is
≤ 6 × 50 = **300** records (plus ≤300 bounded candidate rows if `K`=50 is accepted).

# 15. Storage before / after

**Not measured, and deliberately not estimated as a result.** No before figure can be
taken on this machine (§7) and there is no after state. Per the brief: no storage saving
is claimed.

Recorded for whoever runs it: SQLite deletes free pages to the freelist, so the file
will not shrink without `VACUUM`. **`VACUUM` is not approved and was not run.** The
distinction between logical row reduction and physical file reduction must be reported
separately when the time comes — this project has been caught by exactly that before
(the raw purge freed 8.52 GiB and the file size did not move).

# 16. Data removed

**None.**

For the record, had it proceeded, the deletion target would have been ~1.48M `duo_pairs`
rows minus ≤300 — i.e. **>99.98% of the 2v2 census**, including every pair below rank 50
in its bucket. On the documented figures that recovers on the order of 1 GB while
leaving ~78 GB of 2v2-bearing storage (`battle_raw` 44.7 GB + the ~1.38M historical 2v2
rows in the 33 GB `battles.db`) untouched.

# 17. Data preserved

Everything. `battles`, `battle_raw`, `duo_pairs.db` (on the VPS), `duo_stage`,
`duo_battle_players`, `duo_participants`, all 1v1 data, all duel data, all non-2v2
analytics, the Phase 12 timestamp commit and the Brain evidence.

# 18. Raw JSON decision

**NO CHANGE, and no change should be made without a separate decision.** Evidence:

- `battle_raw.raw_json` is **the only place a 2v2 teammate's deck exists**. A `battles`
  row holds one `player_card_keys`, one `opponent_card_keys` and one `opponent_tag`, so
  a partnership cannot be reconstructed from it. Deleting raw 2v2 JSON permanently ends
  the ability to rebuild or correct the collection.
- It is **already being destroyed faster than anyone intends**: the bot's raw cap purged
  1,881,526 rows on 2026-09-01 and 4,763,318 rows (including all 1,136,571 2v2 payloads)
  on the restart that deployed the 2v2 guard. Historical coverage is already down to
  78.2%, and June/July/August are 0%/0.7%/6.7%.
- The **raw-cap interlock** (deployed 2026-09-11) exists specifically to stop the valve
  deleting 2v2 payloads the fold has not consumed yet, and it reads
  `duo_pairs.processed_through()`. Changing raw retention policy from this side risks
  that interlock.
- Brain research reads it: the Phase 8b extract came from `battle_raw.stored_at` arrival
  data, and `battle_raw.rounds` holds the only real duel records (~50k payloads).

If the account holder's true goal is 2v2 storage reduction, **this is where the 44.7 GB
is**, and it is a bot-side retention decision, not a `duo_pairs` decision.

# 19. `duo_stage` decision

**NO CHANGE.** Source inspection confirms it is not the right place to enforce a
retention rule: it is the dedup ledger keyed `(battle_id, side)` whose whole function is
making a repeated battle a no-op and letting `_fold()` recompute. Enforcing top-50 there
would either break idempotency or make a fold unable to recompute a record it still
needs. The brief's preference — leave `duo_stage` alone, let the retained store be
bounded — is the correct one.

Worth flagging: `duo_stage` is itself unbounded (one row per battle per side, ~1.89M
rows at last count) and is never pruned. If storage is the objective, `duo_stage`
retention is a more promising and far less destructive target than the census.

# 20. `duo_pairs.db` decision

**It is the right home, and no second database should be created.** It already is a
dedicated, gitignored, independently-surviving SQLite file with the exact fields a
retained record needs, the right counter, a deterministic tie-breaker, and the readers
pointed at it. If the account holder resolves §3 and §4, the compact store belongs in
this file — as a new bounded table beside `duo_pairs` during the transition, so the
rebuild can be verified against the full census before anything is dropped.

# 21. Admin UI impact

**No change was made, so no impact today.** The impact of the change *as specified*
should be understood before approving it:

- The screen is `#/duo`, **public to trial and above** since 2026-09-11, not an admin
  page.
- Its header reports the collection total (currently 1,483,672). At ≤300 records it
  reports ≤300.
- Its **card filter reaches all 123 cards** and is server-side (`cards=`). Against 300
  retained decks, the overwhelming majority of the 123 cards would return **no results** —
  a screen that answers "nothing plays Giant in 2v2" when the truth is that the row was
  evicted. Measured precedent for how much falls off: `hog-rider` alone matches 434,265
  pairs today.
- Pagination (25/50/100, `MAX_PER_PAGE` 200) becomes a single page.
- The three sorts still work, but `recent`/`first` over 300 head-of-distribution records
  answer a different question than they do over the census.

This is the brief's "existing 2v2 UI would otherwise break" case, so it is surfaced
rather than silently absorbed.

# 22. API impact

`GET /api/analytics/duo-pairs` needs **no signature change**: the fields, sorts, paging
and card filter all still apply to a smaller table. Route-count tripwire stays at **22**.
`summary.pairs` / `summary.occurrences` would change meaning from "the 2v2 census" to
"the retained head", and should be renamed or annotated if the change proceeds, or every
consumer silently inherits the narrower claim.

# 23. Brain impact

**None — nothing was implemented.** No player memory, prediction memory, Brain model,
knowledge graph or learning artifact was added, and none should be here.

For the record the Brain README now carries: a compacted 2v2 store would be **less**
usable for future research, not more. `duo_pairs` is named in the Brain README as "the
closest structural precedent" and "the storage pattern to copy" for pattern memory; a
census truncated to its top 300 loses the long tail, which is where novelty, adoption
and displacement signals live — the questions Brain Phases 4–7 were about. No claim is
made that this change would improve prediction accuracy; it would not, and the OIE does
not read 2v2 at all.

# 24. Tests

**No tests were written**, because there is no implementation to pin and the behaviour
they would assert depends on the undecided §3/§4 answers. The brief's ten-point test
list plus the 6 × 50 = 300 boundary is the right list and is carried into §32 as part of
the work that follows the decision.

Baseline recorded for the regression comparison, run this phase:

| suite | result |
|---|---|
| `test_duo_pairs.py` | **425 passed, 0 failed** |
| `test_battle_modes.py` | **135 passed, 0 failed** |
| `test_recent_battles.py` | **40 passed, 0 failed** |

# 25. Regression results

**Nothing changed, so nothing regressed.** The three 2v2 suites above are green; the
working tree is identical to commit `a9cdbb7` apart from this artifact and the Brain
README entry. 1v1, Coach Assist and the Brain predictor were not touched.
`test_ml_21a`'s pre-existing `123 != 122` failure is unrelated and untouched.

# 26. Rollback

**Not required — nothing to roll back.** No schema change, no data change, no code
change, no commit. Files added: this artifact (untracked) and a Brain README entry.

For the implementation when it comes: the rollback plan must include a copy of
`.duo_pairs.db` taken on the VPS **before** any deletion, with its hash recorded, and
the note that **there is still no backup of anything on that box** — which is precisely
why the full census must not be deleted until a compact state has been built and
independently verified.

# 27. Known risks

1. **Irreversibility.** The 1.48M-pair census took a 20-minute migration to build and
   depends on raw payloads that are already 21.8% gone and shrinking at every bot
   restart. Deleting the tail is not undoable by re-running the migration — the inputs
   for the older battles no longer exist.
2. **Wrong layer.** ~1 GB is recovered while ~78 GB of 2v2-bearing storage remains
   (§16, §18).
3. **A public screen becomes mostly empty answers**, especially under the card filter
   (§21).
4. **Counter error.** Any bounded sketch overstates evicted-and-returned counts by at
   most the bucket minimum. Acceptable, but it must be stored and shown.
5. **Bucket skew.** With taxonomy B (17) or C (6), buckets are wildly uneven; a flat 50
   per bucket keeps 50 `other`/`Mixed` decks — a bucket that means "no single win
   condition" — while discarding the 51st-most-played Hog pair.
6. **Two sources of truth** if a `usage_count` is incremented alongside the existing
   fold instead of being derived from it (§9).
7. **`battles` cannot be compacted from this repository at all** (`mode=ro`), and the
   historical 2v2 deletion was already blocked by four measured blockers, including that
   `player_stats_agg` counts 2v2 today and `rebuild_aggregates` has no live caller.

# 28. Known bugs

No new defects found in the 2v2 path this phase; the three suites are green and the code
matches its documentation. Two pre-existing items are relevant and unchanged:

- **`duo_stage` is unbounded and never pruned** (~1.89M rows). Not a bug, but it is the
  largest unmanaged 2v2 structure inside `duo_pairs.db` (§19).
- **`test_ml_21a` `123 != 122`** — pre-existing, unrelated, deliberately not fixed
  (Brain KNOWN BUGS #2).

# 29. What changed

- `DECKKIES_BRAIN_PHASE13A_2V2_TOP50_STORAGE.md` — this artifact (new, untracked).
- `DECKKIES_BRAIN_README.md` — a Phase 13A entry recording the blocked result.

**No source file, no database, no schema, no test and no configuration changed.**

# 30. What did NOT change

`duo_pairs.py`, `battle_modes.py`, `duo_stage`, `duo_pairs.db`, `battles`, `battle_raw`,
`app.py` and its route count, the `#/duo` screen and every other frontend file, the
Phase 12 timestamp commit (`predictor.py`, `shadow.py`, the spec and both test suites),
`CLASH_OIE`, Coach Assist, the OIE predictor, candidate pools, alternative caps,
calibration, the shadow log, the Brain evidence, and all 1v1, duel and non-2v2
analytics.

# 31. Deployment status

**NOT DEPLOYED. VPS UNTOUCHED.** No `ssh`, no `scp`, no `systemctl`, no read or write of
any production database, no `CLASH_OIE` change, no commit, no push. This phase ran
entirely against the local checkout, which contains no 2v2 data.

# 32. Next approval

Three decisions are needed before any implementation, and the first two cannot be made
here without doing something the brief explicitly forbids.

**DECISION 1 — which taxonomy are "the six win conditions"?** (§3.) There is no set of
six win conditions in the code. The real options:

| option | buckets | what it is | cost |
|---|---:|---|---|
| **B, the canonical taxonomy** | **17** (16 + `other`) | the bot's own `WIN_CONDITION_MAP`, already stored in `battles` | 17 × 50 = **850** records, not 300. Nothing is invented or redefined |
| **B, capped to the six most-used** | 6 | the six biggest archetypes by 2v2 usage, everything else discarded | exactly 300 records, but it **redefines "the six"**, and which six is data-dependent and would move |
| **C, `deck_counter.STYLE`** | **6** | editorial *play styles* (Beatdown / Bridge Spam / Control / Cycle / Mixed / Siege) | exactly 300 records, but these are **not win conditions**, one of them means "no win condition", and the source calls the mapping opinion |
| **A, win-condition cards** | **23** | `cardMeta.is_win_condition` | 23 × 50 = 1,150 records |

My recommendation, if the goal is bounded storage with nothing invented: **taxonomy B
(17 buckets) with a per-bucket cap**, and choose the cap to hit the size you want —
17 × 20 ≈ 340 records is within a rounding error of 300 and preserves every archetype,
whereas six buckets cannot be produced without redefining something.

**DECISION 2 — deck or pair?** (§4.) The 2v2 store holds partnerships, deliberately;
there is no 2v2 deck record and the module that held one was deleted for cause. Either
(a) retain the **top 50 pairs per bucket** using the existing unit and counter — small,
safe, no new identity format; or (b) reverse the earlier decision and build a per-deck
2v2 collection, which needs a new counter, a new table and a new answer to "which of a
pair's two decks owns the observation". (a) is the smaller and safer change.

**DECISION 3 — is `duo_pairs` even the right target?** (§7, §16, §18, §19.) It is ~1 GB
of the ~78 GB that 2v2 occupies. If the objective is bytes, the candidates in order of
size are `battle_raw` 2v2 retention (bot-side, ~44.7 GB), the historical 2v2 rows in
`battles` (~1.38M rows, and already blocked by four measured blockers), and `duo_stage`
(~1.89M rows, unbounded, safely prunable). I would want this answered before deleting a
census that cannot be rebuilt.

**Then, and only then**, the implementation is small and well understood: the bounded
counter of §9 hooked into `observe()`/`_fold()`, a new bounded table in `duo_pairs.db`,
the brief's ten tests plus the 6 × 50 boundary, a rebuild-verify-then-delete sequence
run **on the VPS** (which needs its own approval, because the data is only there), and
`VACUUM` deferred to an explicit decision.

**Unrelated and still pending: Brain Phase 13 — the dark deployment of the timestamp
fix.** It is untouched by this phase and still needs its own approval.
