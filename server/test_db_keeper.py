"""test_db_keeper.py — the one idle connection `clash_data.connect` keeps open.

    python server/test_db_keeper.py

Why it exists (measured 2026-09-30): with the bot's WAL at 2.9 GB, a fresh
read-only connection's first query cost 0.7-0.9 s whenever no other connection
to the file was open in the process, and Coach Assist opens hundreds a request
(76 s cold). One connection kept open, having read the schema once, took that
to ~1 ms (7.5 s cold, same answer).

What would be quietly wrong rather than broken:
  * the keeper must hold NO read transaction — otherwise it pins a WAL snapshot
    and the bot's checkpoint can never reset the log (the very thing that made
    the WAL huge would get worse);
  * a fresh connection must still see rows written after the keeper opened;
  * one keeper per file, not one per call;
  * a missing file still fails the way it always did, at `connect`.
A temporary WAL database is written here; nothing real is opened.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clash_data as cd  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok  ", name)
    else:
        failed += 1
        print("  FAIL", name, detail)


tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "b.db").replace("\\", "/")
w = sqlite3.connect(path)
w.execute("PRAGMA journal_mode=WAL")
w.execute("CREATE TABLE decks(deck_hash TEXT PRIMARY KEY, win_condition TEXT)")
w.execute("INSERT INTO decks VALUES ('a', 'hog')")
w.commit()

print("one keeper per file")
before = len(cd._KEEPERS)
c1 = cd.connect(path)
c2 = cd.connect(path)
uri = "file:" + path + "?mode=ro"
check("a keeper exists for the file after connect", uri in cd._KEEPERS)
check("two connects make ONE keeper", len(cd._KEEPERS) == before + 1, str(len(cd._KEEPERS) - before))
check("connect still returns a fresh, working connection each call",
      c1 is not c2 and c1.execute("SELECT win_condition FROM decks WHERE deck_hash='a'").fetchone()[0] == "hog")
check("rows come back as sqlite3.Row, as before", isinstance(c1.execute("SELECT 1 AS x").fetchone(), sqlite3.Row))
c1.close(); c2.close()

print("\nthe keeper holds nothing")
k = cd._KEEPERS[uri]
check("the keeper is not in a transaction", k.in_transaction is False)
w.execute("INSERT INTO decks VALUES ('b', 'golem')")
w.commit()
busy, log, done = w.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
check("A WRITER CAN CHECKPOINT AND TRUNCATE THE WAL while the keeper is open",
      busy == 0 and log == 0, f"busy={busy} log={log} done={done}")
c3 = cd.connect(path)
check("a fresh connection sees a row written after the keeper opened",
      c3.execute("SELECT win_condition FROM decks WHERE deck_hash='b'").fetchone()[0] == "golem")
c3.close()
w.execute("INSERT INTO decks VALUES ('c', 'xbow')")
w.commit()
c4 = cd.connect(path)
check("...and one written after a checkpoint too",
      c4.execute("SELECT count(*) FROM decks").fetchone()[0] == 3)
c4.close()

print("\nread-only is still read-only")
c5 = cd.connect(path)
try:
    c5.execute("INSERT INTO decks VALUES ('z', 'x')")
    ro = False
except sqlite3.OperationalError:
    ro = True
check("a write through connect() is refused", ro)
c5.close()

print("\na missing file fails the way it always did")
missing = os.path.join(tmp, "nope.db").replace("\\", "/")
try:
    cd.connect(missing).execute("SELECT 1 FROM decks").fetchone()
    err = False
except sqlite3.OperationalError:
    err = True
check("connecting to a missing file raises OperationalError", err)
check("and leaves no keeper behind", ("file:" + missing + "?mode=ro") not in cd._KEEPERS)

w.close()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
