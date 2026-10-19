"""Find a player by NAME: an index of every name the bot has stored.

THIS IS THE SECOND ATTEMPT, AND THE FIRST ONE IS WHY IT LOOKS LIKE THIS.
`/api/analytics/search` existed for one day (28 Aug 2026) and read the bot's
`player_names` with `LIKE '%q%'`. That table held a few thousand names then; on
19 Oct 2026 it held 5,896,446, and the same scan measured 0.6 s warm and 4.6 s
cold on the VPS — a full read of the table for every keystroke of a type-ahead.

SO THE NAMES ARE COPIED INTO AN INDEX OF OUR OWN (`.name_index.db`, gitignored,
the `duo_pairs` / `cluster_index` arrangement): the bot's database is only ever
opened `mode=ro`, and a search never touches it.

  * `names` — one row per player: the bot's own rowid as `id`, tag, name, the
    name case-folded (`lname`, indexed: exact and starts-with lookups, and the
    ONLY way to find a name of one or two characters), the day it was last
    seen, and whether the bot tracks them.
  * `fts` — an FTS5 TRIGRAM index over `names.name` (external content, so the
    text is stored once): a name CONTAINING what was typed. Trigram needs three
    characters, which is why short queries go through `lname` instead — many
    Japanese and Chinese names are two characters long.

Measured on the full 5.9M names (19 Oct 2026): ranked top 100 in 2-45 ms, the
commonest three letters ("the", 84,655 matches) ~200 ms before the scan cap
below, a two-character prefix 0 ms; ~96 s to build from nothing at idle
priority; ~690 MB on disk.

THE FILE IS BOUNDED. The bot never deletes a name and adds 55-75k a day, so
indexing every name it ever saw would grow ~7 MB a day for ever. Only names
seen in the last `RETAIN_DAYS` (the battle retention window, 304) are kept:
a player not seen in ten months has nothing stored here anyway. Steady state is
the number of distinct players seen in that window (~2 GB at today's rate).

KEPT FRESH AFTER EVERY POLL (`after_poll.py`): rows the bot touched since the
last run (`updated_at` > the watermark), a name that changed is re-indexed,
names past the window are dropped, the tracked flag is re-read. ~60k rows a
poll, a second or two. A missing or old-format file is rebuilt whole into a
temporary file and swapped in with `os.replace`, so a reader never sees half.

ORDER. Exact name first, then names that START with it, then names that contain
it; inside each, players we track (we hold their battles) first, then the most
recently seen, then the shorter name. Not by battle count: the loudest account
is not the one you meant.

CLI:  python3 name_index.py --build [--full]    python3 name_index.py --search sub
"""
from __future__ import annotations

import datetime as _dt
import os
import sqlite3
import sys
import threading
import time
import unicodedata
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.environ.get("CLASH_NAME_INDEX") or os.path.join(HERE, ".name_index.db")

#: Bumped when the file's shape changes; an older file is rebuilt whole.
FORMAT = 1

#: Names not seen for this many days are not indexed. Follows the battle
#: retention window so "findable by name" and "has data here" end together.
RETAIN_DAYS = max(30, int(os.environ.get("CLASH_NAME_DAYS")
                          or os.environ.get("CLASH_RETENTION_DAYS") or "304"))

#: Most rows one search returns. RoyaleAPI shows the top 100 too.
MAX_LIMIT = 100
#: A query longer than any Clash Royale name (15 characters) is not a name.
MAX_QUERY = 32
#: Trigram needs three characters; shorter queries match by exact/starts-with.
MIN_CONTAINS = 3
#: Rows of one tier read before ranking it. A very common fragment ("the")
#: matches tens of thousands; ranking all of them costs ~200 ms for a list
#: nobody reads past the hundredth row.
SCAN_CAP = 5000
#: Counts stop here and say "more than".
COUNT_CAP = 100_000

_EPOCH = _dt.date(1970, 1, 1)


def fold(text: str) -> str:
    """The comparable form of a name or a query: NFKC (full-width letters and
    compatibility forms become ordinary ones) then case-folded."""
    return unicodedata.normalize("NFKC", text or "").casefold().strip()


def _day(stamp: str | None) -> int:
    """`2026-10-19T04:55:47.9Z` -> days since 1970. Unreadable -> 0."""
    try:
        return (_dt.date.fromisoformat((stamp or "")[:10]) - _EPOCH).days
    except ValueError:
        return 0


def _iso_day(day: int) -> str:
    return (_EPOCH + _dt.timedelta(days=day)).isoformat()


# ── building ────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS names(
    id INTEGER PRIMARY KEY,         -- the bot's player_names rowid
    tag TEXT NOT NULL,
    name TEXT NOT NULL,
    lname TEXT NOT NULL,            -- fold(name)
    day INTEGER NOT NULL,           -- last seen, days since 1970
    tracked INTEGER NOT NULL DEFAULT 0
);
"""
INDEXES = """
CREATE INDEX IF NOT EXISTS names_lname ON names(lname);
CREATE INDEX IF NOT EXISTS names_day ON names(day);
CREATE INDEX IF NOT EXISTS names_tracked ON names(tracked) WHERE tracked = 1;
"""
FTS = ("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(name, content='names', "
       "content_rowid='id', tokenize='trigram case_sensitive 0 remove_diacritics 1')")


def _bot_path() -> str | None:
    p = os.environ.get("CLASH_DB_PATH")
    if p and os.path.exists(p):
        return p
    try:
        import clash_data as cd
        return cd.resolve_db_path()
    except Exception:  # noqa: BLE001
        return None


def _bot(path: str) -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    con.execute("PRAGMA query_only = 1")
    return con


def _meta(con: sqlite3.Connection, key: str) -> str | None:
    try:
        r = con.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    except sqlite3.Error:
        return None
    return r[0] if r else None


def _set_meta(con: sqlite3.Connection, **kv) -> None:
    con.executemany("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) "
                    "DO UPDATE SET value = excluded.value",
                    [(k, str(v)) for k, v in kv.items()])


def _tracked_ids(bot: sqlite3.Connection) -> list[int]:
    """The `player_names` rowids of the players the bot tracks."""
    try:
        return [r[0] for r in bot.execute(
            "SELECT n.rowid FROM tracked_players t JOIN player_names n ON n.tag = t.tag")]
    except sqlite3.Error:
        return []


def _rows(bot: sqlite3.Connection, since: str):
    """(id, tag, name, updated_at) for names touched after `since`, in chunks."""
    cur = bot.execute("SELECT rowid, tag, name, updated_at FROM player_names "
                      "WHERE updated_at > ?", (since,))
    while True:
        chunk = cur.fetchmany(20_000)
        if not chunk:
            return
        yield chunk


def build_full(bot_path: str, out_path: str = PATH, now: float | None = None) -> dict:
    """Index every name seen inside the window, into a fresh file swapped in
    whole. Returns counts."""
    t0 = time.time()
    today = _day(_dt.datetime.fromtimestamp(now or time.time(), _dt.timezone.utc).isoformat())
    cutoff = _iso_day(today - RETAIN_DAYS)
    tmp = out_path + ".tmp"
    for p in (tmp, tmp + "-journal"):
        if os.path.exists(p):
            os.remove(p)
    bot = _bot(bot_path)
    con = sqlite3.connect(tmp)
    try:
        con.execute("PRAGMA journal_mode = OFF")
        con.execute("PRAGMA synchronous = OFF")
        con.executescript(SCHEMA)
        newest = ""
        n = 0
        for chunk in _rows(bot, cutoff):
            batch = []
            for rid, tag, name, stamp in chunk:
                if not tag or not name:
                    continue
                batch.append((rid, tag, name, fold(name), _day(stamp)))
                if stamp and stamp > newest:
                    newest = stamp
            con.executemany("INSERT INTO names(id, tag, name, lname, day) VALUES (?,?,?,?,?)", batch)
            n += len(batch)
        tracked = _tracked_ids(bot)
        con.executemany("UPDATE names SET tracked = 1 WHERE id = ?", [(i,) for i in tracked])
        con.executescript(INDEXES)
        con.execute(FTS)
        con.execute("INSERT INTO fts(fts) VALUES('rebuild')")
        con.execute("INSERT INTO fts(fts) VALUES('optimize')")
        _set_meta(con, format=FORMAT, watermark=newest or cutoff, builtAt=_now_iso(),
                  fullAt=_now_iso(), names=n, retainDays=RETAIN_DAYS)
        con.commit()
        con.execute("PRAGMA journal_mode = DELETE")
    finally:
        con.close()
        bot.close()
    os.replace(tmp, out_path)
    return {"mode": "full", "names": n, "tracked": len(tracked),
            "seconds": round(time.time() - t0, 1), "bytes": os.path.getsize(out_path)}


def update(bot_path: str, out_path: str = PATH, now: float | None = None) -> dict:
    """Bring an existing index up to date in place. Rebuilds whole when the
    file is missing, unreadable or of another format."""
    t0 = time.time()
    if not os.path.exists(out_path):
        return build_full(bot_path, out_path, now)
    con = sqlite3.connect(out_path, timeout=30)
    try:
        if _meta(con, "format") != str(FORMAT):
            con.close()
            return build_full(bot_path, out_path, now)
        since = _meta(con, "watermark") or ""
        today = _day(_dt.datetime.fromtimestamp(now or time.time(), _dt.timezone.utc).isoformat())
        bot = _bot(bot_path)
        added = renamed = touched = 0
        newest = since
        try:
            con.execute("BEGIN IMMEDIATE")
            for chunk in _rows(bot, since):
                for rid, tag, name, stamp in chunk:
                    if stamp and stamp > newest:
                        newest = stamp
                    if not tag or not name:
                        continue
                    day = _day(stamp)
                    old = con.execute("SELECT name FROM names WHERE id = ?", (rid,)).fetchone()
                    if old is None:
                        con.execute("INSERT INTO names(id, tag, name, lname, day) VALUES (?,?,?,?,?)",
                                    (rid, tag, name, fold(name), day))
                        con.execute("INSERT INTO fts(rowid, name) VALUES (?, ?)", (rid, name))
                        added += 1
                    elif old[0] != name:
                        con.execute("INSERT INTO fts(fts, rowid, name) VALUES('delete', ?, ?)",
                                    (rid, old[0]))
                        con.execute("UPDATE names SET name = ?, lname = ?, day = ? WHERE id = ?",
                                    (name, fold(name), day, rid))
                        con.execute("INSERT INTO fts(rowid, name) VALUES (?, ?)", (rid, name))
                        renamed += 1
                    else:
                        con.execute("UPDATE names SET day = ? WHERE id = ?", (day, rid))
                        touched += 1
            # Out of the window: dropped from the text index and the table.
            gone = con.execute("SELECT id, name FROM names WHERE day < ?",
                               (today - RETAIN_DAYS,)).fetchall()
            for rid, name in gone:
                con.execute("INSERT INTO fts(fts, rowid, name) VALUES('delete', ?, ?)", (rid, name))
            con.execute("DELETE FROM names WHERE day < ?", (today - RETAIN_DAYS,))
            # Who is tracked changes every poll (the recruiter, searches).
            tracked = _tracked_ids(bot)
            con.execute("UPDATE names SET tracked = 0 WHERE tracked = 1")
            con.executemany("UPDATE names SET tracked = 1 WHERE id = ?", [(i,) for i in tracked])
            total = con.execute("SELECT COUNT(*) FROM names").fetchone()[0]
            _set_meta(con, watermark=newest, builtAt=_now_iso(), names=total)
            con.commit()
        except BaseException:
            con.rollback()
            raise
        finally:
            bot.close()
    finally:
        try:
            con.close()
        except sqlite3.Error:
            pass
    return {"mode": "update", "added": added, "renamed": renamed, "touched": touched,
            "dropped": len(gone), "names": total, "tracked": len(tracked),
            "seconds": round(time.time() - t0, 1), "bytes": os.path.getsize(out_path)}


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── reading ─────────────────────────────────────────────────────────────────

_local = threading.local()
_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_cache_lock = threading.Lock()
CACHE_SIZE = 2048


def _reader(path: str) -> tuple[sqlite3.Connection, tuple] | None:
    """One connection per thread, reopened when the file is replaced by a
    full rebuild (a new inode). The epoch also carries `data_version`, which
    moves when the updater commits, so cached answers die with the data."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    ident = (path, st.st_ino, st.st_dev)
    con = getattr(_local, "con", None)
    if con is None or getattr(_local, "ident", None) != ident:
        if con is not None:
            try:
                con.close()
            except sqlite3.Error:
                pass
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
            con.execute("PRAGMA query_only = 1")
        except sqlite3.Error:
            _local.con = None
            return None
        _local.con, _local.ident = con, ident
    try:
        version = con.execute("PRAGMA data_version").fetchone()[0]
    except sqlite3.Error:
        _local.con = None
        return None
    return con, (st.st_ino, st.st_mtime_ns, version)


def _fts_phrase(q: str) -> str:
    """The query as one FTS5 phrase: quoted, inner quotes doubled, so nothing
    typed is read as FTS syntax (AND, *, NEAR, column filters)."""
    return '"' + q.replace('"', '""') + '"'


def _upper(lq: str) -> str:
    """The first string greater than every string starting with `lq`."""
    return lq + "\U0010ffff"


def _count(con, sql: str, args) -> tuple[int, bool]:
    n = con.execute(f"SELECT COUNT(*) FROM ({sql} LIMIT {COUNT_CAP + 1})", args).fetchone()[0]
    return min(n, COUNT_CAP), n > COUNT_CAP


ORDER = "ORDER BY tracked DESC, day DESC, length(name), name"


def _search(con, q: str, limit: int) -> dict:
    lq = fold(q)
    rows: list[tuple] = []
    seen: set[int] = set()

    def take(sql: str, args) -> None:
        for r in con.execute(sql, args):
            if r[0] not in seen and len(rows) < limit:
                seen.add(r[0])
                rows.append(r)

    cols = "id, tag, name, tracked, day"
    more = lambda: limit + len(seen)  # noqa: E731 - rows already taken may match again
    # 1. The exact name.
    take(f"SELECT {cols} FROM names WHERE lname = ? {ORDER} LIMIT ?", (lq, limit))
    # 2. Starts with it. Tracked players first FOR CERTAIN (the partial index
    #    holds ~6k rows), then the rest from a capped scan of the range.
    if len(rows) < limit:
        take(f"SELECT {cols} FROM names WHERE tracked = 1 AND lname > ? AND lname < ? "
             f"{ORDER} LIMIT ?", (lq, _upper(lq), more()))
    if len(rows) < limit:
        take(f"SELECT {cols} FROM (SELECT * FROM names WHERE lname > ? AND lname < ? "
             f"ORDER BY lname LIMIT {SCAN_CAP}) {ORDER} LIMIT ?",
             (lq, _upper(lq), more()))
    # 3. Contains it (three characters and up), the same two passes.
    contains = len(lq) >= MIN_CONTAINS
    if contains and len(rows) < limit:
        take(f"SELECT {cols} FROM names WHERE tracked = 1 AND instr(lname, ?) > 0 "
             f"{ORDER} LIMIT ?", (lq, more()))
    if contains and len(rows) < limit:
        take(f"SELECT {cols} FROM names WHERE id IN "
             f"(SELECT rowid FROM fts WHERE fts MATCH ? LIMIT {SCAN_CAP}) {ORDER} LIMIT ?",
             (_fts_phrase(q), more()))
    if contains:
        total, capped = _count(con, "SELECT 1 FROM fts WHERE fts MATCH ?", (_fts_phrase(q),))
        # Case folding can differ from the trigram index's on a rare letter;
        # never report fewer than are listed.
        total = max(total, len(rows))
    else:
        total, capped = _count(con, "SELECT 1 FROM names WHERE lname >= ? AND lname < ?",
                               (lq, _upper(lq)))
    return {
        "query": q,
        "total": total,
        "capped": capped,
        "match": "contains" if contains else "starts",
        "results": [{"tag": r[1], "name": r[2], "tracked": bool(r[3]),
                     "seen": _iso_day(r[4]) if r[4] else None} for r in rows],
    }


def search(query: str, limit: int = 8, path: str | None = None) -> dict:
    """Players whose stored name matches `query`, best first.

    Never raises: an unavailable index answers `available: false` and an empty
    list, so the field still takes a tag. A query that is empty or longer than
    any name answers an empty list without reading anything."""
    q = (query or "").strip()
    limit = max(1, min(int(limit or 8), MAX_LIMIT))
    empty = {"query": q, "total": 0, "capped": False, "match": "none", "results": []}
    if not q or len(q) > MAX_QUERY or not fold(q):
        return {**empty, "available": True}
    got = _reader(path or PATH)
    if got is None:
        return {**empty, "available": False}
    con, epoch = got
    key = (epoch, fold(q), q, limit)
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    try:
        out = {**_search(con, q, limit), "available": True}
    except sqlite3.Error:
        _local.con = None
        return {**empty, "available": False}
    with _cache_lock:
        _cache[key] = out
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return out


def status(path: str | None = None) -> dict:
    """For `/api/analytics/status`: counts and ages, never a name or a path."""
    p = path or PATH
    if not os.path.exists(p):
        return {"available": False}
    try:
        con = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=2)
        try:
            names = _meta(con, "names")
            built = _meta(con, "builtAt")
            full = _meta(con, "fullAt")
        finally:
            con.close()
    except sqlite3.Error:
        return {"available": False}
    return {"available": True, "names": int(names or 0), "builtAt": built, "fullAt": full,
            "retainDays": RETAIN_DAYS, "bytes": os.path.getsize(p)}


def main(argv: list[str]) -> int:
    if "--search" in argv:
        i = argv.index("--search")
        q = argv[i + 1] if i + 1 < len(argv) else ""
        t = time.time()
        out = search(q, MAX_LIMIT)
        print(f"{out['total']}{'+' if out['capped'] else ''} matches "
              f"({out['match']}) in {(time.time() - t) * 1000:.0f} ms")
        for r in out["results"][:20]:
            print(f"  {r['tag']:<12} {'T' if r['tracked'] else ' '} {r['seen']}  {r['name']}")
        return 0
    if "--build" in argv:
        bot = _bot_path()
        if not bot:
            print("name index: no bot database", file=sys.stderr)
            return 2
        out = build_full(bot) if "--full" in argv else update(bot)
        print("name index:", out)
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
