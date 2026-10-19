"""test_name_index.py — the name search index.

    python server/test_name_index.py

Real SQLite files in a temp directory: the bot's `player_names` and
`tracked_players` shaped as the bot creates them (clashdb.py, read 2026-10-19:
`tag TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL, source
TEXT NOT NULL`, upserted with ON CONFLICT DO UPDATE so a rowid never moves).
Ranking, trigram matching and the incremental update are SQL, and a stub would
only test my idea of what SQLite does.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import name_index as ni

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
    else:
        FAIL += 1
        print("FAIL", name, detail)


TMP = tempfile.mkdtemp(prefix="nameidx-")
BOT = os.path.join(TMP, "battles.db")
IDX = os.path.join(TMP, "names.db")
NOW = time.time()
TODAY = time.strftime("%Y-%m-%d", time.gmtime(NOW))


def stamp(days_ago: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000000Z", time.gmtime(NOW - days_ago * 86400))


def bot():
    con = sqlite3.connect(BOT)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS player_names (
            tag TEXT PRIMARY KEY, name TEXT NOT NULL,
            updated_at TEXT NOT NULL, source TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tracked_players (tag TEXT PRIMARY KEY, added_at TEXT);
    """)
    return con


def upsert(con, tag, name, days_ago=1.0):
    con.execute("INSERT INTO player_names(tag, name, updated_at, source) VALUES (?,?,?,'api') "
                "ON CONFLICT(tag) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
                (tag, name, stamp(days_ago)))


def tags(out):
    return [r["tag"] for r in out["results"]]


def search(q, limit=100):
    return ni.search(q, limit, path=IDX)


# ── fixture ────────────────────────────────────────────────────────────────
b = bot()
upsert(b, "#SUB1", "Sub", 3)
upsert(b, "#SUB2", "SUB", 1)              # exact too, seen more recently
upsert(b, "#SUB3", "Sub™ Kun", 1)         # starts with
upsert(b, "#SUB4", "CAL Sub ✨ Kun", 1)    # contains
upsert(b, "#SUB5", "musubi", 1)           # contains, untracked
upsert(b, "#SUB6", "Sublime", 50)         # starts with, tracked, seen long ago
upsert(b, "#MUGI", "ムギ", 2)               # two characters, Japanese
upsert(b, "#MUG2", "ムギチャ", 2)
upsert(b, "#OLD1", "Sub Ancient", 400)    # outside the 304-day window
upsert(b, "#QUOT", 'Say "hi" OR *', 1)    # FTS syntax inside a name
upsert(b, "#FULL", "ＳＵＢＺＥＲＯ", 1)       # full-width letters (NFKC)
upsert(b, "#ACCT", "Süb", 1)              # diacritics
for i in range(40):
    upsert(b, f"#FILL{i}", f"filler{i}", 1)
b.execute("INSERT INTO tracked_players VALUES ('#SUB6', '')")
b.execute("INSERT INTO tracked_players VALUES ('#SUB4', '')")
b.commit()

out = ni.build_full(BOT, IDX, now=NOW)
check("full build counts the window only", out["names"] == 51, out)
check("full build marks the tracked", out["tracked"] == 2, out)
check("no temp file left", not os.path.exists(IDX + ".tmp"))

# ── ranking ────────────────────────────────────────────────────────────────
r = search("sub")
t = tags(r)
check("tracked first: a tracked starts-with, however old", t[0] == "#SUB6", t)
check("then a tracked contains, above untracked exact names", t[1] == "#SUB4", t)
check("then the exact names", t[2:4] == ["#SUB2", "#SUB1"], t)  # both exact, newer first
check("then starts-with (full-width SUBZERO folds into it)", set(t[4:6]) == {"#SUB3", "#FULL"}, t)
check("then contains", "#SUB5" in t[6:], t)
check("a short list still holds the tracked", tags(search("sub", 2)) == ["#SUB6", "#SUB4"])
check("full-width letters fold to ordinary ones", "#FULL" in t, t)
check("a diacritic does not hide a name", "#ACCT" in t, t)
check("out-of-window names are not indexed", "#OLD1" not in t, t)
check("total counts every match", r["total"] == len(t), (r["total"], t))
check("match kind is contains", r["match"] == "contains", r["match"])
check("tracked flag reaches the row",
      [x["tracked"] for x in r["results"] if x["tag"] == "#SUB6"] == [True])
check("seen is a date", all(len(x["seen"]) == 10 for x in r["results"]))
check("case does not matter", tags(search("SUB")) == t)
check("limit is honoured", tags(search("sub", 3)) == t[:3])
check("limit is capped", len(search("filler", 999)["results"]) <= ni.MAX_LIMIT)

r = search("ムギ")
check("a two-character name is found", tags(r) == ["#MUGI", "#MUG2"], tags(r))
check("short queries match by starts-with", r["match"] == "starts", r["match"])
check("short total counts the prefix range", r["total"] == 2, r["total"])
check("one character works", "#MUGI" in tags(search("ム")))

r = search('"hi" OR *')
check("FTS syntax is literal text", tags(r) == ["#QUOT"], tags(r))
check("a lone quote does not raise", search('"')["available"] is True)
check("NEAR/AND are words", search("AND NEAR")["results"] == [])

check("empty query reads nothing", search("   ")["results"] == [] and search("")["total"] == 0)
check("an over-long query is refused", search("x" * 40)["results"] == [])
check("nothing matches nothing", search("zzzzqqq")["total"] == 0)

# ── capped counts ─────────────────────────────────────────────────────────
saved = ni.COUNT_CAP
ni.COUNT_CAP = 10
ni._cache.clear()
r = search("filler", 5)
check("count stops at the cap and says so", r["total"] == 10 and r["capped"], (r["total"], r["capped"]))
ni.COUNT_CAP = saved
ni._cache.clear()

# ── incremental update ─────────────────────────────────────────────────────
before = search("sub")
upsert(b, "#SUB5", "Zebra", 0.1)          # renamed: no longer a sub
upsert(b, "#NEW1", "Subzero", 0.1)        # new
upsert(b, "#FILL0", "filler0", 0.1)       # touched, same name
b.execute("DELETE FROM tracked_players")
b.execute("INSERT INTO tracked_players VALUES ('#SUB3', '')")
b.commit()
out = ni.update(BOT, IDX, now=NOW)
check("update adds", out["added"] == 1, out)
check("update renames", out["renamed"] == 1, out)
check("update touches", out["touched"] == 1, out)
r = search("sub")
t = tags(r)
check("a renamed name leaves the old match", "#SUB5" not in t, t)
check("the new name is found", "#NEW1" in t and "#SUB5" in tags(search("zebra")), t)
check("cache does not serve the old answer", t != tags(before))
check("tracked is re-read", t[0] == "#SUB3", t)
check("untracked loses its place", t.index("#SUB6") > t.index("#SUB3"), t)
out = ni.update(BOT, IDX, now=NOW)
check("a second update finds nothing new", out["added"] == 0 and out["renamed"] == 0
      and out["touched"] == 0, out)

# Out of the window: drops without a rebuild.
out = ni.update(BOT, IDX, now=NOW + 300 * 86400)
check("names past the window are dropped", "#SUB6" not in tags(ni.search("sub", path=IDX)) and out["dropped"] >= 1, out)
check("and leave the text index", ni.search("sublime", path=IDX)["total"] == 0)

# ── a full rebuild is swapped under an open reader ─────────────────────────
ni._cache.clear()
search("sub")                              # opens this thread's connection
if os.name == "nt":
    # Windows will not replace a file another handle has open; Linux (the VPS)
    # does, and the reader follows the new inode. Drop the handle here so the
    # rest of the suite runs on this machine too.
    ni._local.con.close()
    ni._local.con = None
ni.build_full(BOT, IDX, now=NOW)
check("a reader follows the replaced file", "#SUB6" in tags(search("sub")))

# An older format is rebuilt whole by update().
con = sqlite3.connect(IDX)
con.execute("UPDATE meta SET value = '0' WHERE key = 'format'")
con.commit()
con.close()
if os.name == "nt" and getattr(ni._local, "con", None):
    ni._local.con.close()
    ni._local.con = None
check("an old format is rebuilt", ni.update(BOT, IDX, now=NOW)["mode"] == "full")
os.remove(IDX)
check("a missing file is built", ni.update(BOT, IDX, now=NOW)["mode"] == "full")

# A file built before the covering index (the one deployed first) gets it on
# its next update, and loses the old one.
con = sqlite3.connect(IDX)
con.execute("DROP INDEX names_tracked_c")
con.execute("CREATE INDEX names_tracked ON names(tracked) WHERE tracked = 1")
con.commit()
con.close()
ni.update(BOT, IDX, now=NOW)
con = sqlite3.connect(IDX)
idx = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
con.close()
check("update adds the covering index", "names_tracked_c" in idx and "names_tracked" not in idx, idx)
ni._cache.clear()
check("and the tracked one still leads", tags(search("sub"))[0] == "#SUB3", tags(search("sub")))  # tracked set is #SUB3 alone by now

# ── unavailable and status ─────────────────────────────────────────────────
r = ni.search("sub", path=os.path.join(TMP, "nope.db"))
check("no index answers available false", r["available"] is False and r["results"] == [])
s = ni.status(IDX)
check("status has counts", s["available"] and s["names"] == 52 and s["bytes"] > 0, s)
check("status carries no tag or name", "#" not in str(s) and "Sub" not in str(s), s)
check("status of nothing", ni.status(os.path.join(TMP, "nope.db")) == {"available": False})

# ── fold ───────────────────────────────────────────────────────────────────
check("fold casefolds", ni.fold("STRASSE") == ni.fold("Straße"))
check("fold NFKC", ni.fold("ＡＢＣ") == "abc")

b.close()
if getattr(ni._local, "con", None):
    ni._local.con.close()
    ni._local.con = None
import shutil  # noqa: E402
shutil.rmtree(TMP, ignore_errors=True)
print(f"{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
