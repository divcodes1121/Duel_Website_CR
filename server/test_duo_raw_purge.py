"""test_duo_raw_purge.py — the rolling 2v2 raw window.

    python server/test_duo_raw_purge.py

This module deletes from the BOT's database, which nothing else here is allowed
to write to at all, so the tests are about what it must never touch:

  * a DUEL payload must survive, always. `battle_raw.rounds` holds the only
    real duel records in the project and `NativeDuelParser` re-reads them;
  * a 1v1 payload must survive;
  * a 2v2 payload the fold has NOT consumed must survive — since the 2026-09-10
    guard, 2v2 never enters `battles`, so an unfolded payload is the ONLY copy
    of that battle;
  * a 2v2 payload inside the window must survive;
  * with no cursor, NOTHING may be deleted.

The SQL predicate is a second copy of `battle_modes._DUO_MARKERS`, so there is a
test that the two agree on real mode strings rather than trusting the copy.
"""

from __future__ import annotations

import datetime
import json
import os
import shutil
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import duo_pairs as dp            # noqa: E402
import duo_raw_purge as rp        # noqa: E402

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


def stamp(hours_ago: float) -> str:
    return (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")


class Fixture:
    """A battles.db holding raw payloads of every mode, at known ages."""

    def __init__(self, cursor_hours_ago: float = 1.0):
        self.dir = tempfile.mkdtemp(prefix="duo-raw-purge-")
        self.db = os.path.join(self.dir, "battles.db")
        con = sqlite3.connect(self.db)
        con.execute("""CREATE TABLE battle_raw (
                         player_tag TEXT, battle_time TEXT, game_mode TEXT,
                         schema_version INTEGER, stored_at TEXT, raw_json TEXT NOT NULL,
                         PRIMARY KEY (player_tag, battle_time))""")
        self.rows = [
            # (tag, mode, hours ago, label)
            ("#A", "TeamVsTeam", 100, "2v2 old"),
            ("#B", "TeamVsTeam_FixedDeckOrder", 72, "2v2 old variant"),
            ("#C", "TeamVsTeam", 2, "2v2 recent (inside the window)"),
            ("#D", "CW_Duel_1v1", 100, "DUEL old"),
            ("#E", "Duel_1v1_Friendly", 200, "DUEL older"),
            ("#F", "Ranked1v1_NewArena2", 100, "1v1 old"),
            ("#G", "Ladder", 500, "1v1 ancient"),
            ("#H", "Challenge_AllCards_EventDeck_NoSet", 300, "other mode old"),
        ]
        for tag, mode, ago, _ in self.rows:
            con.execute("INSERT INTO battle_raw (player_tag, battle_time, game_mode, "
                        "stored_at, raw_json) VALUES (?,?,?,?,?)",
                        (tag, stamp(ago), mode, stamp(ago), '{"x":1}'))
        con.commit()
        con.close()
        self._old_path = rp._db_path
        self._old_cursor = dp.processed_through
        rp._db_path = lambda: self.db
        dp.processed_through = lambda: stamp(cursor_hours_ago)

    def count(self, where="1=1"):
        con = sqlite3.connect(self.db)
        n = con.execute("SELECT COUNT(*) FROM battle_raw WHERE " + where).fetchone()[0]
        con.close()
        return n

    def modes(self):
        con = sqlite3.connect(self.db)
        out = {r[0] for r in con.execute("SELECT game_mode FROM battle_raw")}
        con.close()
        return out

    def close(self):
        rp._db_path = self._old_path
        dp.processed_through = self._old_cursor
        shutil.rmtree(self.dir, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def test_the_predicate_agrees_with_the_router() -> None:
    print("\nthe SQL 2v2 predicate and battle_modes.is_duo name the same modes")
    rp.verify_markers()
    check("verify_markers passes on the real mode strings", True)
    for mode in ("TeamVsTeam", "TeamVsTeam_FixedDeckOrder"):
        check(f"`{mode}` is 2v2 to both", ("teamvsteam" in mode.lower()) and dp.bm.is_duo(mode))
    for mode in ("CW_Duel_1v1", "Duel_1v1_Friendly", "Ranked1v1_NewArena2", "Ladder"):
        sql = ("teamvsteam" in mode.lower()) or ("2v2" in mode.lower())
        check(f"`{mode}` is NOT 2v2 to either", not sql and not dp.bm.is_duo(mode))


def test_it_deletes_only_consumed_old_2v2() -> None:
    print("\nonly 2v2 that is both folded and outside the window is deleted")
    with Fixture(cursor_hours_ago=1.0) as fx:
        rp.ENABLED, old = True, rp.ENABLED
        try:
            before = fx.count()
            plan = rp.plan()
            check("plan finds the two old 2v2 rows", plan["deletable"] == 2,
                  json.dumps(plan))
            check("plan keeps the recent 2v2 row", plan["keeping2v2"] == 1,
                  str(plan["keeping2v2"]))
            out = rp.purge(confirm=True, log=lambda *a: None)
            check("deleted exactly two", out["deleted"] == 2, json.dumps(out))
            check("nothing older than the boundary remains",
                  out["remainingOlderThanBoundary"] == 0)
            check("total dropped by two", fx.count() == before - 2)
            left = fx.modes()
            check("DUEL payloads survived",
                  {"CW_Duel_1v1", "Duel_1v1_Friendly"} <= left, str(left))
            check("1v1 payloads survived",
                  {"Ranked1v1_NewArena2", "Ladder"} <= left, str(left))
            check("the unrelated event mode survived",
                  "Challenge_AllCards_EventDeck_NoSet" in left, str(left))
            check("the recent 2v2 payload survived", "TeamVsTeam" in left, str(left))
            check("the old 2v2 variant is gone",
                  "TeamVsTeam_FixedDeckOrder" not in left, str(left))
            check("the module reports duel raw unchanged", out["duelRawUnchanged"])
        finally:
            rp.ENABLED = old


def test_an_unconsumed_payload_is_never_deleted() -> None:
    print("\na 2v2 payload the fold has not reached is never deleted, however old")
    # The cursor is 300 hours back, so the 100h and 72h payloads are NEWER than
    # it — not yet consumed — even though they are outside the 24h window.
    with Fixture(cursor_hours_ago=300) as fx:
        rp.ENABLED, old = True, rp.ENABLED
        try:
            plan = rp.plan()
            check("nothing is deletable", plan["deletable"] == 0, json.dumps(plan))
            out = rp.purge(confirm=True, log=lambda *a: None)
            check("purge deletes nothing", out["deleted"] == 0)
            check("every row survives", fx.count() == 8, str(fx.count()))
        finally:
            rp.ENABLED = old


def test_it_fails_closed() -> None:
    print("\nno cursor means delete nothing")
    with Fixture() as fx:
        rp.ENABLED, old = True, rp.ENABLED
        dp.processed_through = lambda: ""
        try:
            check("boundary is empty", rp.boundary() == "")
            check("plan reports nothing deletable", rp.plan()["deletable"] == 0)
            out = rp.purge(confirm=True, log=lambda *a: None)
            check("purge refuses", out["refused"] and out["deleted"] == 0, json.dumps(out))
            check("every row survives", fx.count() == 8)
        finally:
            rp.ENABLED = old
        dp.processed_through = lambda: ""

    with Fixture() as fx:
        rp.ENABLED, old = True, rp.ENABLED
        dp.processed_through = lambda: (_ for _ in ()).throw(RuntimeError("no db"))
        try:
            check("a raising cursor also yields an empty boundary", rp.boundary() == "")
            check("and deletes nothing", rp.purge(confirm=True, log=lambda *a: None)["deleted"] == 0)
            check("every row survives", fx.count() == 8)
        finally:
            rp.ENABLED = old


def test_deletion_is_gated() -> None:
    print("\ndeletion needs both the confirmation and the environment gate")
    with Fixture() as fx:
        rp.ENABLED, old = False, rp.ENABLED
        try:
            out = rp.purge(confirm=True, log=lambda *a: None)
            check("refused while the flag is off", out["refused"], json.dumps(out))
            check("and it says why", "CLASH_DUO_RAW_PURGE" in out["why"])
            rp.ENABLED = True
            out2 = rp.purge(confirm=False, log=lambda *a: None)
            check("refused without confirm", out2["refused"])
            check("nothing was deleted either way", fx.count() == 8)
            check("the refusal still reports the plan", "plan" in out)
        finally:
            rp.ENABLED = old


def test_the_window_is_the_earlier_bound() -> None:
    print("\nthe boundary is the EARLIER of the cursor and the window floor")
    with Fixture(cursor_hours_ago=1.0) as fx:
        # cursor 1h ago, window floor 24h ago -> the floor is earlier, so it wins
        b = rp.boundary()
        floor = (datetime.datetime.utcnow()
                 - datetime.timedelta(hours=rp.WINDOW_HOURS)).strftime("%Y-%m-%dT%H:%M:%S")
        check("the 24h floor bounds it when the fold is current",
              b[:13] == floor[:13], f"{b} vs {floor}")
    with Fixture(cursor_hours_ago=200) as fx:
        # cursor 200h ago is earlier than the 24h floor -> the cursor wins
        b = rp.boundary()
        check("the cursor bounds it when the fold is behind",
              b < (datetime.datetime.utcnow()
                   - datetime.timedelta(hours=100)).strftime("%Y-%m-%dT%H:%M:%S"), b)


def main() -> int:
    for fn in (test_the_predicate_agrees_with_the_router,
               test_it_deletes_only_consumed_old_2v2,
               test_an_unconsumed_payload_is_never_deleted,
               test_it_fails_closed,
               test_deletion_is_gated,
               test_the_window_is_the_earlier_bound):
        fn()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
