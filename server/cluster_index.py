"""The cluster index: every deck's record against every archetype, precomputed.

WHY THIS EXISTS (2026-09-21)
============================

Team Analysis took **150-210 s** for a 5v5 and would have taken ~9 minutes at
12v12. Measured on the VPS, phase by phase: `deck_counter._cluster_all` was
**97% of it**, ~5.6 s per distinct deck on the blue side, in two halves:

1. **The sibling scan** walked every stored deck hash in pure Python to find
   the ones sharing 6+ cards. 2.2 s a deck — and growing, because the deck
   vocabulary grew from the 1,054,394 its comment was written against to
   **2,772,680**.
2. **The join** read every matchup row of every sibling out of
   `pair_matchup_agg`: ~100,000 rows a deck, each a RANDOM page read into a
   55 GB file (the covering indexes lack draws and crowns, so every row costs
   a table lookup). ~80 us a row: 3 s warm, 13-20 s cold. Threads only buy
   2.9x — it is I/O, not CPU.

And "warm" was never warm: the cluster cache was 32 entries that CLEARED WHOLE
on overflow, and a 5-player roster is 36 decks = 72 entries. So the second
identical request cost the same as the first.

No cache fixes (2): the per-request work is proportional to the ROWS behind a
deck's siblings, and the table only grows. So the rows are summed ONCE, off
the request path, into this module's own SQLite file:

    deck_arch(deck, arch, w, l, d, cf, ca, tf, ta)    -- WITHOUT ROWID

— each deck's symmetrised record against each opponent ARCHETYPE, which is
exactly the unit `_cluster_all` sums into. A cluster is then the sum of its
siblings' rows here: ~5 rows a sibling instead of ~25, contiguous on disk and
small enough (a few hundred MB) to stay in the page cache.

The sibling scan becomes BIT ARITHMETIC. `card_bits` holds, per card, one big
integer whose bit (id-1) is set when deck `id` contains that card. "Shares at
least 6 of these 8 cards" is the OR, over the 28 six-card subsets, of the AND
of their bitsets — a few hundred C-level operations on 350 kB integers instead
of 22 million Python ones. Standard library only, like the rest of this
service.

WHAT IT MUST NOT DO
===================

* **Change a single figure.** It sums the same rows, symmetrised the same way,
  classified by the same `_archetype_of_hash`, scored by the same `_score`. The
  prototype matched the live path EXACTLY on 12 real decks (sibling counts,
  games and win rate per archetype, zero difference), and
  `test_cluster_index.py` pins that equality on a synthetic database.
* **Write to the bot's database.** It is ATTACHed `mode=ro`; the only file
  written is this module's own (`CLASH_CLUSTER_INDEX`).
* **Serve another database's answers.** `meta.source` records which database
  was summed, and the index is only used while that is the database
  `clash_data` resolves. A test that points the data layer at a temp file, or
  a host whose path moved, falls back to the live path instead of reading a
  stranger's numbers.
* **Be required.** Missing, unreadable or mismatched, `profiles()` returns
  None and `deck_counter` runs the live path exactly as before. Slow, correct.

STALENESS IS BOUNDED BY THE TIMER, AND VISIBLE
==============================================

It is a snapshot as of its last build (`royalweb-cluster.timer`, every 4 h).
A cluster aggregates thousands of games across hundreds of decks, so a few
hours of new battles moves no figure that matters — the same argument the
hourly counter snapshot already rests on. `status()` publishes the build time
and `/api/analytics/status` carries it, so a stopped timer shows as an age,
not as nothing.

DECK IDS ARE STABLE ACROSS BUILDS. The `deck` table is only ever appended to,
so a bitset loaded from an older build still names the right decks after a
newer one lands; the newest decks are simply absent until the next reload.
That is what lets the API swap builds without a window of wrong answers.
"""
from __future__ import annotations

import calendar
import hashlib
import inspect
import json
import os
import re
import sqlite3
import sys
import threading
import time
from itertools import combinations

import clash_data as cd

PATH = os.getenv(
    "CLASH_CLUSTER_INDEX",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cluster_index.db"),
)

#: How often a reader looks for a newer build. Cheap (one meta read), but not
#: per call — a request profiling 90 decks does not need 90 checks.
RELOAD_CHECK_S = 60.0

#: Hashes streamed from the bot's `decks` table per insert batch. Bounds the
#: build's memory: the prototype held all 2.77M at once and peaked at 574 MB.
BATCH = 50_000

#: The file format. Bumped when a table changes shape; a reader refuses a
#: format it does not know rather than misreading it.
FORMAT = "1"


# ── The classifier, and when it changes ─────────────────────────────────────


def _dcx():
    # Imported late: `deck_counter` imports this module lazily too, and the two
    # must not need each other at import time.
    import deck_counter as dcx
    return dcx


def classifier_version() -> str:
    """A fingerprint of `_archetype_of_hash` — its code AND its tables.

    Stored archetypes are only as right as the function that assigned them. If
    a deploy changes the win-condition priority, every stored `deck.arch` is
    stale, and the build re-classifies all of them (~17 s) instead of letting
    an old rule quietly outlive its code.
    """
    dcx = _dcx()
    try:
        src = inspect.getsource(dcx._archetype_of_hash)
    except (OSError, TypeError):
        src = ""
    blob = json.dumps(
        [src, list(dcx.WIN_CONDITION_PRIORITY), dcx.WIN_CONDITION_MAP],
        sort_keys=True, default=str,
    )
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:12]


def _uri(path: str, mode: str) -> str:
    return "file:" + path.replace("\\", "/") + f"?mode={mode}"


def _norm(path: str | None) -> str:
    return os.path.normcase(os.path.abspath(path)) if path else ""


# ── Building ────────────────────────────────────────────────────────────────


def _ensure(con: sqlite3.Connection) -> None:
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS arch(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS deck(
            id   INTEGER PRIMARY KEY,
            hash TEXT NOT NULL UNIQUE,
            arch INTEGER NOT NULL
        );
        """
    )


def _meta(con: sqlite3.Connection) -> dict[str, str]:
    try:
        return {k: v for k, v in con.execute("SELECT k, v FROM meta")}
    except sqlite3.Error:
        return {}


def _arch_ids(con: sqlite3.Connection) -> dict[str, int]:
    return {name: i for i, name in con.execute("SELECT id, name FROM arch")}


def _arch_id(con: sqlite3.Connection, ids: dict[str, int], name: str) -> int:
    i = ids.get(name)
    if i is None:
        con.execute("INSERT INTO arch(name) VALUES (?)", (name,))
        i = ids[name] = con.execute(
            "SELECT id FROM arch WHERE name = ?", (name,)).fetchone()[0]
    return i


def build(path: str | None = None, source: str | None = None) -> dict:
    """(Re)build the index from the bot's database. Returns a summary.

    Four steps, and the order is load-bearing:

    1. APPEND new deck hashes (ids never change meaning), re-classifying every
       stored deck only when the classifier itself changed.
    2. Sum `pair_matchup_agg` into `deck_arch_new`, both directions, in SQL.
    3. Write `card_bits_new` from EVERY deck row.
    4. Swap both tables in and stamp `meta` in ONE transaction, so a reader sees
       the old build or the new one and never half of each.
    """
    path = path or PATH
    source = source or (cd._tier_paths() or [None])[0]
    if not source:
        raise RuntimeError("no_database")
    dcx = _dcx()
    started = time.time()
    t0 = time.perf_counter()

    con = sqlite3.connect(_uri(path, "rwc"), uri=True, timeout=30.0)
    con.isolation_level = None  # explicit transactions only
    try:
        _ensure(con)
        meta = _meta(con)
        version = classifier_version()
        ids = _arch_ids(con)

        # 1a. Re-classify when the rule changed. Rare, and ~17 s when it is.
        reclassified = 0
        if meta.get("classifier") and meta.get("classifier") != version:
            # Streamed through a SECOND connection: under WAL it reads the
            # pre-update snapshot while this one writes, so 2.77M rows never
            # sit in memory at once.
            reader = sqlite3.connect(_uri(path, "ro"), uri=True, timeout=30.0)
            try:
                cur = reader.execute("SELECT id, hash FROM deck")
                while True:
                    rows = cur.fetchmany(BATCH)
                    if not rows:
                        break
                    batch = [(_arch_id(con, ids, dcx._archetype_of_hash(h)), i)
                             for i, h in rows]
                    con.execute("BEGIN")
                    con.executemany("UPDATE deck SET arch = ? WHERE id = ?", batch)
                    con.execute("COMMIT")
                    reclassified += len(batch)
            finally:
                reader.close()

        # 1b. Append decks the index has not seen. `INSERT OR IGNORE` on the
        # UNIQUE hash is what keeps an existing deck's id where it was.
        before = con.execute("SELECT COUNT(*) FROM deck").fetchone()[0]
        src = cd.connect(source)
        try:
            cur = src.execute("SELECT deck_hash FROM decks")
            while True:
                rows = cur.fetchmany(BATCH)
                if not rows:
                    break
                con.execute("BEGIN")
                con.executemany(
                    "INSERT OR IGNORE INTO deck(hash, arch) VALUES (?, ?)",
                    [(r[0], _arch_id(con, ids, dcx._archetype_of_hash(r[0])))
                     for r in rows],
                )
                con.execute("COMMIT")
        finally:
            src.close()
        n_decks = con.execute("SELECT COUNT(*) FROM deck").fetchone()[0]
        t_decks = time.perf_counter() - t0

        # 2. The aggregate. SUMMED IN SQL — 5.8M pair rows through Python
        # dictionaries would hold gigabytes; this is a GROUP BY in C. Both
        # directions of every pair row, the second with every side swapped:
        # exactly the symmetrisation `deck_profile` and `_cluster_all` apply.
        t1 = time.perf_counter()
        con.execute("ATTACH DATABASE ? AS bot", (_uri(source, "ro"),))
        try:
            con.execute("DROP TABLE IF EXISTS deck_arch_new")
            con.execute(
                """
                CREATE TABLE deck_arch_new(
                    deck INTEGER NOT NULL, arch INTEGER NOT NULL,
                    w INTEGER NOT NULL, l INTEGER NOT NULL, d INTEGER NOT NULL,
                    cf INTEGER NOT NULL, ca INTEGER NOT NULL,
                    tf INTEGER NOT NULL, ta INTEGER NOT NULL,
                    PRIMARY KEY (deck, arch)
                ) WITHOUT ROWID
                """
            )
            con.execute(
                """
                INSERT INTO deck_arch_new
                SELECT deck, arch, SUM(w), SUM(l), SUM(d), SUM(cf), SUM(ca),
                       SUM(tf), SUM(ta)
                FROM (
                    SELECT a.id AS deck, b.arch AS arch,
                           IFNULL(p.a_wins, 0) AS w, IFNULL(p.a_losses, 0) AS l,
                           IFNULL(p.a_draws, 0) AS d,
                           IFNULL(p.a_crowns, 0) AS cf, IFNULL(p.b_crowns, 0) AS ca,
                           IFNULL(p.a_three, 0) AS tf, IFNULL(p.b_three, 0) AS ta
                      FROM bot.pair_matchup_agg p
                      JOIN deck a ON a.hash = p.deck_a
                      JOIN deck b ON b.hash = p.deck_b
                    UNION ALL
                    SELECT b.id, a.arch,
                           IFNULL(p.a_losses, 0), IFNULL(p.a_wins, 0),
                           IFNULL(p.a_draws, 0),
                           IFNULL(p.b_crowns, 0), IFNULL(p.a_crowns, 0),
                           IFNULL(p.b_three, 0), IFNULL(p.a_three, 0)
                      FROM bot.pair_matchup_agg p
                      JOIN deck a ON a.hash = p.deck_a
                      JOIN deck b ON b.hash = p.deck_b
                )
                GROUP BY deck, arch
                """
            )
            # WHAT THE JOIN DROPPED, counted rather than assumed. A pair row
            # whose deck is missing from `decks` would count on the live path
            # (which classifies an opponent from its hash) and vanish here.
            # Zero on 2026-09-21 in both directions; published so that the day
            # it is not zero is visible as a number, not as a quiet disagreement.
            orphans = con.execute(
                """
                SELECT COUNT(*) FROM bot.pair_matchup_agg p
                 WHERE NOT EXISTS (SELECT 1 FROM deck WHERE hash = p.deck_a)
                    OR NOT EXISTS (SELECT 1 FROM deck WHERE hash = p.deck_b)
                """
            ).fetchone()[0]
        finally:
            con.execute("DETACH DATABASE bot")
        n_rows = con.execute("SELECT COUNT(*) FROM deck_arch_new").fetchone()[0]
        t_agg = time.perf_counter() - t1

        # 3. Card bitsets over EVERY deck row, old and new: bit (id-1) set when
        # deck `id` holds the card.
        t2 = time.perf_counter()
        nbytes = n_decks // 8 + 1
        bits: dict[str, bytearray] = {}
        for i, h in con.execute("SELECT id, hash FROM deck"):
            j = i - 1
            byte, bit = j >> 3, 1 << (j & 7)
            for c in h.split(","):
                b = bits.get(c)
                if b is None:
                    b = bits[c] = bytearray(nbytes)
                b[byte] |= bit
        con.execute("DROP TABLE IF EXISTS card_bits_new")
        con.execute("CREATE TABLE card_bits_new(card TEXT PRIMARY KEY, bits BLOB NOT NULL)")
        con.execute("BEGIN")
        con.executemany("INSERT INTO card_bits_new VALUES (?, ?)",
                        ((c, bytes(b)) for c, b in bits.items()))
        con.execute("COMMIT")
        t_bits = time.perf_counter() - t2

        # 4. The swap. One transaction: DROP + RENAME + stamp.
        built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        stamp = {
            "format": FORMAT,
            "builtAt": built_at,
            "source": _norm(source),
            "classifier": version,
            "decks": str(n_decks),
            "rows": str(n_rows),
            "orphanRows": str(orphans),
            "buildSeconds": f"{time.time() - started:.1f}",
        }
        con.execute("BEGIN IMMEDIATE")
        con.execute("DROP TABLE IF EXISTS deck_arch")
        con.execute("ALTER TABLE deck_arch_new RENAME TO deck_arch")
        con.execute("DROP TABLE IF EXISTS card_bits")
        con.execute("ALTER TABLE card_bits_new RENAME TO card_bits")
        con.executemany("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", stamp.items())
        con.execute("COMMIT")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()

    return {
        "builtAt": built_at,
        "decks": n_decks,
        "newDecks": n_decks - before,
        "reclassified": reclassified,
        "rows": n_rows,
        "orphanRows": orphans,
        "cards": len(bits),
        "seconds": {
            "decks": round(t_decks, 1), "aggregate": round(t_agg, 1),
            "bitsets": round(t_bits, 1), "total": round(time.time() - started, 1),
        },
    }


# ── Reading ─────────────────────────────────────────────────────────────────


_lock = threading.Lock()
_state: dict = {"builtAt": None, "bits": None, "names": None, "meta": {},
                "checked": 0.0, "generation": 0}


def _ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(_uri(path, "ro"), uri=True, timeout=5.0,
                           check_same_thread=False)


def _usable(meta: dict[str, str]) -> bool:
    """A build this code can read, of the database the site is reading."""
    if meta.get("format") != FORMAT or not meta.get("builtAt"):
        return False
    hot = (cd._tier_paths() or [None])[0]
    return bool(hot) and meta.get("source") == _norm(hot)


def _current() -> tuple[dict[str, int], dict[int, str]] | None:
    """The loaded bitsets and archetype names, (re)loading when due.

    Never raises: any failure is "no index", and the caller takes the live
    path.
    """
    now = time.monotonic()
    with _lock:
        if now - _state["checked"] < RELOAD_CHECK_S:
            if _state["bits"] is not None and _usable(_state["meta"]):
                return _state["bits"], _state["names"]
            if _state["checked"]:
                return None
        _state["checked"] = now
        if not os.path.exists(PATH):
            _state.update(builtAt=None, bits=None, names=None, meta={})
            return None
        try:
            con = _ro(PATH)
            try:
                meta = _meta(con)
                if not _usable(meta):
                    _state.update(builtAt=None, bits=None, names=None, meta=meta)
                    return None
                if meta["builtAt"] != _state["builtAt"] or _state["bits"] is None:
                    bits = {c: int.from_bytes(b, "little")
                            for c, b in con.execute("SELECT card, bits FROM card_bits")}
                    names = {i: n for i, n in con.execute("SELECT id, name FROM arch")}
                    _state.update(builtAt=meta["builtAt"], bits=bits, names=names,
                                  meta=meta, generation=_state["generation"] + 1)
            finally:
                con.close()
        except sqlite3.Error:
            _state.update(builtAt=None, bits=None, names=None, meta={})
            return None
        return _state["bits"], _state["names"]


def generation() -> int:
    """Bumps each time a new build is loaded. Caches key on it."""
    return _state["generation"]


_NONZERO = re.compile(rb"[^\x00]")


def _ids(mask: int) -> list[int]:
    """Deck ids whose bit is set, ascending. Skips the zero bytes in C."""
    if not mask:
        return []
    data = mask.to_bytes((mask.bit_length() + 7) // 8, "little")
    out = []
    for m in _NONZERO.finditer(data):
        at = m.start()
        byte = data[at]
        base = at * 8
        while byte:
            low = byte & -byte
            out.append(base + low.bit_length())  # bit index + 1 == deck id
            byte ^= low
    return out


def _at_least(masks: list[int], k: int) -> int:
    """Decks holding at least `k` of these cards: OR over k-subsets of ANDs."""
    if k > len(masks):
        return 0
    acc = 0
    for combo in combinations(masks, k):
        x = combo[0]
        for y in combo[1:]:
            x &= y
            if not x:
                break
        acc |= x
    return acc


def _sibling_ids(cards: list[str], bits: dict[str, int], lowest: int) -> dict[int, int]:
    """`{deck id: shared card count}` for every deck sharing `lowest`+ cards.

    Counts are resolved per level from the top down, so a deck in the "all 8"
    set is 8, one only in "7+" is 7, and so on — the same numbers the live
    scan counts one card at a time.
    """
    mine = sorted(set(cards))
    masks = [bits.get(c, 0) for c in mine]
    out: dict[int, int] = {}
    for k in range(len(mine), lowest - 1, -1):
        for i in _ids(_at_least(masks, k)):
            if i not in out:
                out[i] = k
    return out


def siblings(cards: list[str], lowest: int) -> dict[str, int] | None:
    """`{deck_hash: shared}` like `deck_counter._siblings`, or None (no index)."""
    cur = _current()
    if cur is None:
        return None
    bits, _names = cur
    sib = _sibling_ids(cards, bits, lowest)
    if not sib:
        return {}
    try:
        con = _ro(PATH)
        try:
            con.execute("CREATE TEMP TABLE s(id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
            con.executemany("INSERT INTO s VALUES (?, ?)", sib.items())
            # CROSS JOIN pins `s` as the outer loop — see `profiles()`.
            return {h: n for h, n in con.execute(
                "SELECT d.hash, s.n FROM s CROSS JOIN deck d ON d.id = s.id")}
        finally:
            con.close()
    except sqlite3.Error:
        return None


_COLS = ("w", "l", "d", "cf", "ca", "tf", "ta")


def _profile_sql(levels: tuple[int, ...]) -> str:
    """The cluster query, separate so a test can read its PLAN."""
    sums = ", ".join(
        f"SUM(CASE WHEN s.n >= {int(lv)} THEN x.{c} ELSE 0 END)"
        for lv in levels for c in _COLS
    )
    return (f"SELECT x.arch, {sums} FROM s CROSS JOIN deck_arch x ON x.deck = s.id "
            "GROUP BY x.arch")


def profiles(cards: list[str], levels: tuple[int, ...]) -> dict[int, dict] | None:
    """Every cluster level for one deck — `_cluster_all`'s answer — or None.

    The same arithmetic, in the same order: siblings by shared-card count, each
    sibling's per-archetype record summed into every level it reaches, then
    `deck_counter._score`. What changed is where the per-archetype records come
    from — precomputed rows here instead of ~100,000 pair rows read per call.
    """
    cur = _current()
    if cur is None:
        return None
    bits, names = cur
    dcx = _dcx()
    empty = {"archetypes": {}, "overall": None, "battles": 0, "decks": 0}
    sib = _sibling_ids(cards, bits, min(levels))
    if not sib:
        return {lv: dict(empty) for lv in levels}

    # One pass, bucketed per level in SQL: a level's sums are the rows whose
    # sibling reaches it.
    #
    # `CROSS JOIN`, NOT `JOIN`, AND IT IS 60x. SQLite has no statistics for a
    # fresh temp table, and with a plain JOIN it chose to SCAN all 5.1M rows
    # of `deck_arch` and probe the siblings: 870 ms a deck, measured on the
    # VPS. CROSS JOIN is SQLite's documented way to fix the loop order — the
    # few thousand siblings outside, a primary-key seek into `deck_arch` for
    # each — and the same query measured 14 ms. `levels` are this module's own integer constants, so
    # formatting them into the statement is not a query built from input.
    cols = _COLS
    try:
        con = _ro(PATH)
        try:
            con.execute("CREATE TEMP TABLE s(id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
            con.executemany("INSERT INTO s VALUES (?, ?)", sib.items())
            rows = con.execute(_profile_sql(levels)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None

    width = len(cols)
    out: dict[int, dict] = {}
    for li, lv in enumerate(levels):
        per: dict[str, list[int]] = {}
        for row in rows:
            vals = list(row[1 + li * width: 1 + (li + 1) * width])
            if any(vals):
                per[names.get(row[0], "other")] = vals
        res = dcx._score(per)
        res["decks"] = sum(1 for n in sib.values() if n >= lv)
        out[lv] = res
    return out


def exact(cards: list[str]) -> dict | None:
    """`deck_counter.deck_profile`'s answer for this exact deck, or None.

    These are the deck's OWN rows in `deck_arch` — the same pair rows, both
    directions, summed per opponent archetype, which is precisely what
    `deck_profile` reads live. None when there is no usable index OR the deck
    is newer than the last build, and the caller then reads it live: a deck
    pasted an hour after it was first played must not come back empty just
    because the index has not seen it yet.
    """
    cur = _current()
    if cur is None:
        return None
    _bits, names = cur
    key = ",".join(sorted(set(cards)))
    try:
        con = _ro(PATH)
        try:
            row = con.execute("SELECT id FROM deck WHERE hash = ?", (key,)).fetchone()
            if row is None:
                return None
            rows = con.execute(
                "SELECT arch, w, l, d, cf, ca, tf, ta FROM deck_arch WHERE deck = ?",
                (row[0],)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None
    per = {names.get(r[0], "other"): list(r[1:]) for r in rows}
    res = _dcx()._score(per)
    res["decks"] = 1
    return res


def deck_count() -> int | None:
    """How many decks the index knows, or None without one."""
    if _current() is None:
        return None
    try:
        return int(_state["meta"].get("decks") or 0)
    except (TypeError, ValueError):
        return None


def status() -> dict:
    """What `/api/analytics/status` publishes. Counts and times only."""
    cur = _current()
    meta = _state["meta"] or {}
    age = None
    if meta.get("builtAt"):
        try:
            age = round(time.time() - calendar.timegm(
                time.strptime(meta["builtAt"], "%Y-%m-%dT%H:%M:%SZ")))
        except (ValueError, OverflowError):
            age = None
    return {
        "available": cur is not None,
        "builtAt": meta.get("builtAt"),
        "ageSeconds": age,
        "decks": int(meta["decks"]) if meta.get("decks", "").isdigit() else None,
        "rows": int(meta["rows"]) if meta.get("rows", "").isdigit() else None,
        "orphanRows": int(meta["orphanRows"]) if meta.get("orphanRows", "").isdigit() else None,
        "buildSeconds": float(meta["buildSeconds"]) if meta.get("buildSeconds") else None,
    }


if __name__ == "__main__":
    if "--build" in sys.argv:
        print(json.dumps(build(), indent=2))
    elif "--status" in sys.argv:
        print(json.dumps(status(), indent=2))
    else:
        print("usage: cluster_index.py --build | --status")
        sys.exit(2)
