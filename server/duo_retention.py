"""duo_retention.py — a BOUNDED 2v2 collection: the 50 most-used pairs per
canonical win condition, and the battles that belong to them.

WHY THIS EXISTS. `duo_pairs` is a census: it keeps every partnership it has ever
seen. Measured on the live collection on 2026-09-16 that is **2,493,481 pairs in
a 5.14 GB file**, up from 1,483,672 five days earlier — roughly 200,000 new pair
records a day, and **86.2% of them have been seen exactly once**. A census that
grows by a fifth of a million rows a day is not a product surface; it is a tail.

So the retained set is bounded by the thing a reader actually asks for:

    for every canonical win condition, the 50 most-used pairs

    ranked by  occurrences DESC, pair_fingerprint ASC

**NOTHING HERE INVENTS A TAXONOMY OR AN IDENTITY.** Both already exist and both
are reused verbatim:

  * the win conditions are `deck_counter`'s — the bot's own `WIN_CONDITION_MAP`
    and `WIN_CONDITION_PRIORITY`, the same rule that wrote every
    `battles.player_win_condition`. There are **17** of them (16 win conditions
    plus `other`), and all 17 occur in the live 2v2 data;
  * the unit is `duo_pairs`' pair fingerprint, order-free at both levels;
  * the count is `duo_pairs.occurrences`, which is battle-deduplicated by
    `battle_identity`, and the tie-break is the one `SORTS["played"]` already
    uses.

A PAIR IS TWO DECKS, SO IT HAS ONE OR TWO WIN CONDITIONS, and it is filed under
each. It is retained if it is top-50 in **at least one** of them — a Hog + Golem
partnership is evidence about Hog and about Golem, and dropping it from one
list because the other list is more crowded would answer a different question.
On the live data that overlap is why 17 x 50 = 850 slots hold **736 distinct
pairs** rather than 850.

THE EVICTION PROBLEM, AND WHY A COUNTER SURVIVES THE RECORD. If a pair is
dropped at #51 and its count goes with it, the pair can never climb back: every
later appearance restarts it at 1 while the incumbents keep accumulating. So the
count outlives the record, in `duo_candidates`, which is itself bounded at
`CANDIDATES_PER_WC` per win condition. That is Space-Saving: a pair entering a
full bucket inherits the evicted minimum, so a count can be **overstated by at
most that minimum and can never be understated**, and the overstatement is
stored on the row rather than left to be discovered.

HOW CLOSE TO EXACT THAT IS, measured rather than asserted: only **22,058** of
the 2,493,481 live pairs have ever reached 13 occurrences, which is the lowest
top-50 cut of any win condition (`3-musk`). The default 5,000 candidates per win
condition is 85,000 rows — several times the whole population that has ever been
in contention — so on today's distribution the result is exact. It stops being
exact only if the tail thickens enormously, and `overstated` is what says so.

**IT SHIPS DARK.** `apply_prune` refuses unless it is both explicitly confirmed
and enabled by `CLASH_DUO_RETENTION`, the same convention `CLASH_OIE=off` and
`PROMOTION_ENABLED` already follow here. Nothing in this module deletes anything
on import, on read, or as a side effect of ingestion.
"""

from __future__ import annotations

import json
import os

import deck_counter as dc
import duo_pairs as dp

#: The retained depth per win condition. The user's requirement is 50.
RETAIN_PER_WC = int(os.getenv("CLASH_DUO_RETAIN", "50"))

#: How many usage counters to keep per win condition. This is the ONLY thing
#: standing between "a deck can climb back" and unbounded growth. 5,000 x 17 is
#: 85,000 rows, against the 22,058 pairs that have ever reached the lowest
#: top-50 cut — so the head is covered several times over.
CANDIDATES_PER_WC = int(os.getenv("CLASH_DUO_CANDIDATES", "5000"))

#: Deletion is gated, computation is not. Reporting what WOULD be removed has to
#: work on a box where removing it is not authorised.
ENABLED = os.getenv("CLASH_DUO_RETENTION", "off").strip().lower() in (
    "1", "on", "true", "yes")


# --------------------------------------------------------------------------
# The canonical win conditions
# --------------------------------------------------------------------------

def win_conditions(deck_a, deck_b) -> tuple[str, ...]:
    """The canonical win condition(s) of a pair — one per deck, deduplicated.

    `deck_counter._archetype_of_hash` is the bot's own derivation with no
    database read: `miner` pre-empts, then `goblin-barrel`/`wall-breakers` ->
    `bait`, then `WIN_CONDITION_PRIORITY` in order, else `other`. The public
    `archetype_of` is the same rule wrapped in a `decks` lookup, which would be
    one query per deck across millions of decks and would answer identically.

    Returned sorted, so a caller iterating them is deterministic.
    """
    out = set()
    for deck in (deck_a, deck_b):
        keys = deck if isinstance(deck, (list, tuple)) else json.loads(deck or "[]")
        if not keys:
            continue
        out.add(dc._archetype_of_hash(",".join(sorted(str(k) for k in keys))))
    return tuple(sorted(out))


def all_win_conditions() -> tuple[str, ...]:
    """Every win condition the canonical map can produce, `other` included.

    Derived from the map rather than typed out again: a card added to the bot's
    map appears here without an edit, and cannot silently gain a bucket nobody
    retains.
    """
    return tuple(sorted(set(dc.WIN_CONDITION_MAP.values()) | {"other"}))


# --------------------------------------------------------------------------
# Schema
# --------------------------------------------------------------------------

def _ensure(con) -> None:
    """Both tables live in the EXISTING collection, not a second database.

    `_ensure` in `duo_pairs` owns the census tables; this owns the two bounded
    ones. Same file, same transaction domain, so a rerank and the fold it
    follows can commit together.
    """
    con.executescript(
        """
        -- THE ANSWER: at most RETAIN_PER_WC rows per win condition.
        CREATE TABLE IF NOT EXISTS duo_retained (
            win_condition TEXT    NOT NULL,
            pair_fp       TEXT    NOT NULL,
            occurrences   INTEGER NOT NULL,
            rank          INTEGER NOT NULL,
            PRIMARY KEY (win_condition, pair_fp)
        );
        CREATE INDEX IF NOT EXISTS idx_retained_rank
            ON duo_retained(win_condition, rank);

        -- THE MEMORY THAT OUTLIVES THE RECORD, bounded per win condition. A
        -- pair evicted from `duo_pairs` keeps its count here, so climbing back
        -- does not mean starting from one.
        CREATE TABLE IF NOT EXISTS duo_candidates (
            win_condition TEXT    NOT NULL,
            pair_fp       TEXT    NOT NULL,
            occurrences   INTEGER NOT NULL,
            -- Space-Saving's error bound: how much of `occurrences` was
            -- inherited from an evicted row rather than counted. 0 means the
            -- count is exact.
            overstated    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (win_condition, pair_fp)
        );
        CREATE INDEX IF NOT EXISTS idx_candidates_rank
            ON duo_candidates(win_condition, occurrences DESC, pair_fp);
        """
    )
    # ONE FLAG ON THE STAGING LEDGER, and it is what makes counting survive a
    # prune. `duo_candidates` becomes the authoritative cumulative count once
    # the tail is deleted — a pruned pair that returns has only its NEW staging
    # rows, so `duo_pairs.occurrences` is no longer its lifetime total. Marking
    # each staged side as counted is how a later maintenance run adds only what
    # is new instead of re-adding what it already has.
    #
    # DEFAULT 1, NOT 0, for the same reason `duo_battle_players.counted` does
    # it: every row present when this column is added is already reflected in
    # `duo_pairs.occurrences`, which `rebuild()` consumes. Defaulting to 0 would
    # double every existing count on the first maintenance run.
    have = {r["name"] for r in con.execute("PRAGMA table_info(duo_stage)")}
    if "counted" not in have:
        con.execute("ALTER TABLE duo_stage ADD COLUMN counted "
                    "INTEGER NOT NULL DEFAULT 1")
    # Partial, so it indexes only the work outstanding — a handful of rows in
    # steady state rather than the whole ledger.
    con.execute("CREATE INDEX IF NOT EXISTS idx_stage_uncounted "
                "ON duo_stage(counted) WHERE counted = 0")


def _connect():
    dp._ensure()
    con = dp._connect()
    _ensure(con)
    return con


# --------------------------------------------------------------------------
# Counting
# --------------------------------------------------------------------------

def note(con, pair_fp: str, wcs, count: int = 1) -> None:
    """Record `count` more uses of `pair_fp` under each of `wcs`.

    Space-Saving, per win condition:

      * already a candidate -> add to it;
      * room in the bucket  -> insert with an exact count;
      * bucket full         -> replace the WEAKEST candidate and inherit its
                               count, recording the inherited part as
                               `overstated`.

    The weakest is `occurrences ASC, pair_fp DESC` — the exact inverse of the
    retention order, so the row evicted is always the one the retention order
    ranks last. Getting that inverse wrong evicts the wrong row on every tie.
    """
    for wc in wcs:
        row = con.execute(
            "SELECT occurrences FROM duo_candidates WHERE win_condition = ? "
            "AND pair_fp = ?", (wc, pair_fp)).fetchone()
        if row:
            con.execute(
                "UPDATE duo_candidates SET occurrences = occurrences + ? "
                "WHERE win_condition = ? AND pair_fp = ?", (count, wc, pair_fp))
            continue
        n = con.execute(
            "SELECT COUNT(*) c FROM duo_candidates WHERE win_condition = ?",
            (wc,)).fetchone()["c"]
        if n < CANDIDATES_PER_WC:
            con.execute(
                "INSERT INTO duo_candidates (win_condition, pair_fp, "
                "occurrences, overstated) VALUES (?,?,?,0)", (wc, pair_fp, count))
            continue
        weakest = con.execute(
            "SELECT pair_fp, occurrences FROM duo_candidates "
            "WHERE win_condition = ? ORDER BY occurrences ASC, pair_fp DESC "
            "LIMIT 1", (wc,)).fetchone()
        if not weakest or weakest["occurrences"] > count:
            # Not strong enough to displace anything yet. Dropping it is the
            # bound doing its job; the pair is still in `duo_pairs` and will be
            # picked up by the next rebuild if it keeps appearing.
            continue
        con.execute("DELETE FROM duo_candidates WHERE win_condition = ? AND "
                    "pair_fp = ?", (wc, weakest["pair_fp"]))
        con.execute(
            "INSERT INTO duo_candidates (win_condition, pair_fp, occurrences, "
            "overstated) VALUES (?,?,?,?)",
            (wc, pair_fp, weakest["occurrences"] + count, weakest["occurrences"]))


def rerank(con, wcs=None) -> int:
    """Rewrite `duo_retained` for `wcs` (all of them when None) from the
    candidate counts. Returns how many rows the retained set now holds.

    ONE ORDER, WRITTEN ONCE: `occurrences DESC, pair_fp ASC`, the rule
    `SORTS["played"]` already uses for the board.
    """
    targets = tuple(wcs) if wcs else tuple(
        r["win_condition"] for r in
        con.execute("SELECT DISTINCT win_condition FROM duo_candidates"))
    for wc in targets:
        con.execute("DELETE FROM duo_retained WHERE win_condition = ?", (wc,))
        rows = con.execute(
            "SELECT pair_fp, occurrences FROM duo_candidates "
            "WHERE win_condition = ? ORDER BY occurrences DESC, pair_fp ASC "
            "LIMIT ?", (wc, RETAIN_PER_WC)).fetchall()
        con.executemany(
            "INSERT INTO duo_retained (win_condition, pair_fp, occurrences, "
            "rank) VALUES (?,?,?,?)",
            [(wc, r["pair_fp"], r["occurrences"], i + 1)
             for i, r in enumerate(rows)])
    return con.execute("SELECT COUNT(*) c FROM duo_retained").fetchone()["c"]


def observe_pairs(con, pairs, commit: bool = True) -> int:
    """The ingestion hook: `pairs` is `[(pair_fp, deck_a, deck_b, count), ...]`.

    Called with what a fold actually touched, INSIDE the same transaction, so a
    reader never sees a bucket reranked against counts that have not landed.

    Idempotency is inherited, not re-implemented: `duo_pairs.observe` only
    reaches a fold for a `(battle_id, side)` its primary key accepted, so a
    replayed battle produces no call here at all.
    """
    touched = set()
    for pair_fp, deck_a, deck_b, count in pairs:
        wcs = win_conditions(deck_a, deck_b)
        if not wcs:
            continue
        note(con, pair_fp, wcs, count)
        touched.update(wcs)
    if touched:
        rerank(con, touched)
    if commit:
        con.commit()
    return len(touched)


# --------------------------------------------------------------------------
# Rebuild from the existing census
# --------------------------------------------------------------------------

def rebuild(con=None, batch: int = 20000) -> dict:
    """Recompute candidates and the retained set from `duo_pairs`.

    THE ONE-OFF THAT MAKES THE BOUNDED STORE TRUE BEFORE ANYTHING IS DELETED.
    It streams the census — 2.49M rows on the live collection, ~2 minutes — and
    keeps only the head of each bucket, so its own memory is bounded by
    `CANDIDATES_PER_WC` rather than by the table.

    Counts written here are EXACT: they come from `duo_pairs.occurrences`, which
    was folded from the staging ledger, so `overstated` is 0 for every row a
    rebuild produces.
    """
    own = con is None
    con = con or _connect()
    try:
        con.execute("DELETE FROM duo_candidates")
        con.execute("DELETE FROM duo_retained")
        heads: dict[str, dict[str, int]] = {}
        scanned = 0
        for r in con.execute(
                "SELECT pair_fingerprint fp, deck_a_cards a, deck_b_cards b, "
                "occurrences o FROM duo_pairs"):
            scanned += 1
            for wc in win_conditions(r["a"], r["b"]):
                bucket = heads.setdefault(wc, {})
                bucket[r["fp"]] = r["o"]
                if len(bucket) > CANDIDATES_PER_WC * 2:
                    # Trim back to the cap. Doing it in bulk rather than per row
                    # keeps the scan linear instead of paying a sort per insert.
                    keep = sorted(bucket.items(), key=lambda kv: (-kv[1], kv[0]))
                    heads[wc] = dict(keep[:CANDIDATES_PER_WC])
        rows = []
        for wc, bucket in heads.items():
            keep = sorted(bucket.items(), key=lambda kv: (-kv[1], kv[0]))
            rows.extend((wc, fp, occ, 0) for fp, occ in keep[:CANDIDATES_PER_WC])
        for i in range(0, len(rows), batch):
            con.executemany(
                "INSERT INTO duo_candidates (win_condition, pair_fp, "
                "occurrences, overstated) VALUES (?,?,?,?)", rows[i:i + batch])
        retained = rerank(con)
        con.commit()
        return {"pairsScanned": scanned, "winConditions": len(heads),
                "candidates": len(rows), "retainedRows": retained,
                "retainedPairs": len(retained_pairs(con))}
    finally:
        if own:
            con.close()


def maintain(con=None, prune_tail: bool = False, batch: int = 5000) -> dict:
    """The hourly step: count what is new, rerank, and optionally drop the tail.

    THE STEADY-STATE PATH, and the reason the collection stays bounded. The
    hourly fold adds new pairs to `duo_pairs`; this adds their staged sides to
    the candidate counts, reranks only the buckets that moved, and — when the
    tail is being dropped — deletes everything that is not retained.

    Incremental by the `counted` flag rather than by re-reading `duo_pairs`,
    because after a prune `duo_pairs.occurrences` is no longer a pair's lifetime
    total: a pair that was dropped and came back carries only its new staging
    rows. `duo_candidates` is the authority; this is what feeds it.
    """
    own = con is None
    con = con or _connect()
    try:
        counted = 0
        while True:
            rows = con.execute(
                "SELECT rowid AS rid, pair_fp, deck_a, deck_b FROM duo_stage "
                "WHERE counted = 0 LIMIT ?", (batch,)).fetchall()
            if not rows:
                break
            touched = set()
            for r in rows:
                wcs = win_conditions(r["deck_a"], r["deck_b"])
                if wcs:
                    note(con, r["pair_fp"], wcs, 1)
                    touched.update(wcs)
                con.execute("UPDATE duo_stage SET counted = 1 WHERE rowid = ?",
                            (r["rid"],))
            if touched:
                rerank(con, touched)
            con.commit()
            counted += len(rows)
        out = {"staged_counted": counted, "retainedPairs": len(retained_pairs(con))}
        if prune_tail:
            out["prune"] = apply_prune(con, confirm=True, stage=True)
        return out
    finally:
        if own:
            con.close()


# --------------------------------------------------------------------------
# Reading it
# --------------------------------------------------------------------------

def retained_pairs(con=None) -> set:
    """The DISTINCT pair identities retained across every win condition.

    Fewer than `17 x RETAIN_PER_WC` whenever a pair is top-50 in both of its
    win conditions, which is why this is a set and not arithmetic.
    """
    own = con is None
    con = con or _connect()
    try:
        return {r["pair_fp"] for r in
                con.execute("SELECT DISTINCT pair_fp FROM duo_retained")}
    finally:
        if own:
            con.close()


def census(con=None) -> dict:
    """Per win condition: retained depth, the #1 and #50 counts, and the total.

    The independent check on a rebuild is `verify()`; this is the report.
    """
    own = con is None
    con = con or _connect()
    try:
        out = {}
        for r in con.execute(
                "SELECT win_condition wc, COUNT(*) n, MAX(occurrences) top, "
                "MIN(occurrences) cut, SUM(occurrences) total "
                "FROM duo_retained GROUP BY win_condition"):
            out[r["wc"]] = {"retained": r["n"], "top": r["top"],
                            "cut": r["cut"], "occurrences": r["total"]}
        return {"winConditions": out, "distinctPairs": len(retained_pairs(con)),
                "perWinCondition": RETAIN_PER_WC}
    finally:
        if own:
            con.close()


def retained_battles(con=None) -> set:
    """Every battle id that belongs to a retained pair.

    THIS IS WHAT "KEEP THEIR BATTLES" MEANS, and it is read from `duo_stage`,
    which is the only store that maps a battle to a pair. On the live
    collection the 736 retained pairs carry 162,274 distinct battles.
    """
    own = con is None
    con = con or _connect()
    try:
        fps = sorted(retained_pairs(con))
        if not fps:
            return set()
        out = set()
        for i in range(0, len(fps), 500):
            chunk = fps[i:i + 500]
            q = ("SELECT DISTINCT battle_id FROM duo_stage WHERE pair_fp IN (%s)"
                 % ",".join("?" * len(chunk)))
            out.update(r["battle_id"] for r in con.execute(q, chunk))
        return out
    finally:
        if own:
            con.close()


def verify(con=None) -> dict:
    """An INDEPENDENT check of the retained set, not a re-run of the builder.

    It re-derives each bucket straight from `duo_pairs` — the census the rebuild
    read — and asserts the retained rows are exactly the ones that ranking
    produces. A check that shares its arithmetic with the thing it checks is not
    a check; this one shares only the source data.
    """
    own = con is None
    con = con or _connect()
    try:
        truth: dict[str, list] = {}
        for r in con.execute(
                "SELECT pair_fingerprint fp, deck_a_cards a, deck_b_cards b, "
                "occurrences o FROM duo_pairs"):
            for wc in win_conditions(r["a"], r["b"]):
                truth.setdefault(wc, []).append((r["o"], r["fp"]))
        problems = []
        for wc, items in truth.items():
            want = [fp for _, fp in
                    sorted(items, key=lambda t: (-t[0], t[1]))[:RETAIN_PER_WC]]
            got = [r["pair_fp"] for r in con.execute(
                "SELECT pair_fp FROM duo_retained WHERE win_condition = ? "
                "ORDER BY rank", (wc,))]
            if want != got:
                problems.append({"winCondition": wc, "expected": want[:3],
                                 "got": got[:3]})
        over = con.execute(
            "SELECT COUNT(*) c FROM duo_retained r JOIN duo_candidates c2 "
            "ON c2.win_condition = r.win_condition AND c2.pair_fp = r.pair_fp "
            "WHERE c2.overstated > 0").fetchone()["c"]
        oversized = [r["win_condition"] for r in con.execute(
            "SELECT win_condition FROM duo_retained GROUP BY win_condition "
            "HAVING COUNT(*) > ?", (RETAIN_PER_WC,))]
        return {"ok": not problems and not oversized, "mismatches": problems,
                "bucketsOverDepth": oversized, "retainedWithOverstatedCount": over,
                "winConditionsChecked": len(truth)}
    finally:
        if own:
            con.close()


# --------------------------------------------------------------------------
# Deleting the tail
# --------------------------------------------------------------------------

def prune_plan(con=None) -> dict:
    """What `apply_prune` WOULD delete. Reads only; deletes nothing, ever."""
    own = con is None
    con = con or _connect()
    try:
        keep = retained_pairs(con)
        pairs = con.execute("SELECT COUNT(*) c FROM duo_pairs").fetchone()["c"]
        stage = con.execute("SELECT COUNT(*) c FROM duo_stage").fetchone()["c"]
        battles = len(retained_battles(con))
        stage_keep = 0
        fps = sorted(keep)
        for i in range(0, len(fps), 500):
            chunk = fps[i:i + 500]
            q = ("SELECT COUNT(*) c FROM duo_stage WHERE pair_fp IN (%s)"
                 % ",".join("?" * len(chunk)))
            stage_keep += con.execute(q, chunk).fetchone()["c"]
        return {"pairsNow": pairs, "pairsRetained": len(keep),
                "pairsRemovable": pairs - len(keep),
                "stageRowsNow": stage, "stageRowsRetained": stage_keep,
                "stageRowsRemovable": stage - stage_keep,
                "battlesRetained": battles, "enabled": ENABLED}
    finally:
        if own:
            con.close()


def apply_prune(con=None, confirm: bool = False, stage: bool = False) -> dict:
    """Delete the tail. **Refuses unless explicitly confirmed AND enabled.**

    `stage=False` by default, and that default is the important half: removing a
    pair's `duo_stage` rows removes the ledger `_fold` recomputes that pair
    from, and the ledger is also what makes a replayed battle a no-op. Dropping
    census rows is reversible by a rebuild from staging; dropping staging is
    not. So the two are separate switches and the destructive one is off.
    """
    if not confirm or not ENABLED:
        return {"deleted": 0, "refused": True,
                "why": "needs confirm=True and CLASH_DUO_RETENTION enabled",
                "plan": prune_plan(con)}
    own = con is None
    con = con or _connect()
    try:
        keep = sorted(retained_pairs(con))
        con.execute("CREATE TEMP TABLE IF NOT EXISTS _keep (fp TEXT PRIMARY KEY)")
        con.execute("DELETE FROM _keep")
        con.executemany("INSERT OR IGNORE INTO _keep (fp) VALUES (?)",
                        [(fp,) for fp in keep])
        removed = con.execute(
            "DELETE FROM duo_pairs WHERE pair_fingerprint NOT IN "
            "(SELECT fp FROM _keep)").rowcount
        staged = 0
        if stage:
            staged = con.execute(
                "DELETE FROM duo_stage WHERE pair_fp NOT IN "
                "(SELECT fp FROM _keep)").rowcount
        con.commit()
        return {"deleted": removed, "stageDeleted": staged, "refused": False,
                "retained": len(keep)}
    finally:
        if own:
            con.close()


if __name__ == "__main__":  # pragma: no cover - operational entry point
    import sys
    if "--rebuild" in sys.argv:
        print(json.dumps(rebuild(), indent=1))
    if "--maintain" in sys.argv:
        print(json.dumps(maintain(prune_tail="--prune" in sys.argv), indent=1))
    if "--verify" in sys.argv:
        print(json.dumps(verify(), indent=1))
    if "--plan" in sys.argv:
        print(json.dumps(prune_plan(), indent=1))
    print(json.dumps(census(), indent=1))
