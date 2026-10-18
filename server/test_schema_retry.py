"""test_schema_retry.py — a failed database check is not remembered for ever.

    python server/test_schema_retry.py

Why it exists (2026-10-18): the VPS was powered off from outside and restarted.
royalweb came up in the same second as the bot, while the bot was still opening
a 4.6 GB write-ahead log, so `_has_schema` failed once — and that failure was
cached for the life of the process. Every request then answered "no database"
with the file intact on disk, until somebody restarted the service by hand.

What must hold:
  * a failure is believed for SCHEMA_RETRY_S, then checked again;
  * a database that becomes readable is found WITHOUT a restart;
  * a pass is still cached (this runs on every request);
  * `resolve_db_path` follows, which is what the screens actually read.
Temporary SQLite files only; the clock is moved by hand, nothing sleeps.
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


clock = [1000.0]
RETRY = getattr(cd, "SCHEMA_RETRY_S", 30.0)
real_monotonic = cd.time.monotonic
cd.time.monotonic = lambda: clock[0]

tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "battles.db").replace("\\", "/")

try:
    print("a missing database fails, and the failure is short-lived")
    check("absent file is not a database", cd._has_schema(path) is False)

    # The file appears with the right tables — what the bot finishing its WAL
    # recovery looks like from here.
    w = sqlite3.connect(path)
    for t in cd.REQUIRED_TABLES:
        w.execute(f"CREATE TABLE {t}(x)")
    w.commit()
    w.close()

    clock[0] += RETRY / 2
    check("inside the retry window the failure is still believed",
          cd._has_schema(path) is False)

    clock[0] += RETRY
    check("after the window the database is found without a restart",
          cd._has_schema(path) is True)

    print("a pass is cached")
    opened = []
    real_connect = cd.connect
    cd.connect = lambda p: opened.append(p) or real_connect(p)
    try:
        clock[0] += RETRY * 10
        check("a pass is not re-checked on every call",
              cd._has_schema(path) is True and not opened, str(opened))
    finally:
        cd.connect = real_connect

    print("a file with the wrong tables fails and is retried too")
    other = os.path.join(tmp, "other.db").replace("\\", "/")
    o = sqlite3.connect(other)
    o.execute("CREATE TABLE something_else(x)")
    o.commit()
    check("wrong schema is refused", cd._has_schema(other) is False)
    for t in cd.REQUIRED_TABLES:
        o.execute(f"CREATE TABLE {t}(x)")
    o.commit()
    o.close()
    check("still refused inside the window", cd._has_schema(other) is False)
    clock[0] += RETRY + 1
    check("accepted once the window has passed", cd._has_schema(other) is True)

    print("resolve_db_path follows the retry")
    late = os.path.join(tmp, "late.db").replace("\\", "/")
    saved = (cd.DB_PATH, cd.DB_FALLBACKS, cd.MAINTENANCE_FLAG)
    cd.DB_PATH, cd.DB_FALLBACKS = late, ()
    cd.MAINTENANCE_FLAG = os.path.join(tmp, ".maintenance")
    try:
        check("no file -> None", cd.resolve_db_path() is None)
        lw = sqlite3.connect(late)
        for t in cd.REQUIRED_TABLES:
            lw.execute(f"CREATE TABLE {t}(x)")
        lw.commit()
        lw.close()
        clock[0] += RETRY + 1
        check("file arrives -> the path, no restart", cd.resolve_db_path() == late,
              str(cd.resolve_db_path()))
    finally:
        cd.DB_PATH, cd.DB_FALLBACKS, cd.MAINTENANCE_FLAG = saved
finally:
    cd.time.monotonic = real_monotonic
    for c in list(cd._KEEPERS.values()) if hasattr(cd, "_KEEPERS") else []:
        try:
            c.close()
        except Exception:
            pass

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
