"""Bring the Coach's duel evidence up to date AS SOON AS A BOT POLL FINISHES.

    python3 after_poll.py          # what the timer runs every 10 minutes
    python3 after_poll.py --force  # run the updates now, new data or not

Asked for (2026-09-30): "as soon as the bot runs its polls the coach should
update with it — 24 hours is very long". The bot polls every four hours on a
schedule set by when it last started, so a clock time would drift out of step
with it after any restart. This triggers on DATA instead:

  1. read the newest `battle_raw.stored_at` (one indexed MAX, instant);
  2. if it moved since the last run, and nothing has been stored for
     `QUIET_S` (the poll has finished — never update from half a poll),
  3. update the duel index (new duel payloads, records, player strength),
     retrain the duel model incrementally (only games stored since its own
     watermark), refit the duel read (which deck a player brings next, on
     every stored duel), rebuild the card-pairing table (`deck_synergy`, the gate on
     "Or bring one of these"), rebuild the swap graph (the deck builder's move
     set), and remember the stored_at it acted on.

A split duel across two polls needs nothing special: native duels are only in
the API once finished, the duel index and the model both read by STORED time
(a late game is picked up by the next run), and reconstructed friendly series
are rebuilt from all stored battles on every read, by battle time.

Opens the bot's database read-only. Writes only its own state file.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, ".after_poll.json")

#: Seconds with nothing stored before a poll counts as finished. A poll writes
#: continuously for ~15 minutes; five quiet minutes is well past its gaps.
QUIET_S = 300


def newest_stored(db_path: str) -> str | None:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return con.execute("SELECT MAX(stored_at) FROM battle_raw").fetchone()[0]
    finally:
        con.close()


def _age_s(stored_at: str, now: float) -> float:
    t = _dt.datetime.fromisoformat(stored_at.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=_dt.timezone.utc)
    return now - t.timestamp()


def decide(newest: str | None, seen: str | None, now: float) -> str:
    """`run`, `quiet` (nothing new), or `polling` (new data still arriving)."""
    if not newest or (seen and newest <= seen):
        return "quiet"
    return "run" if _age_s(newest, now) >= QUIET_S else "polling"


def load_state() -> dict:
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(s: dict) -> None:
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f)
    os.replace(tmp, STATE)


def main(argv: list[str]) -> int:
    db = os.environ.get("CLASH_DB_PATH") or "/var/clashbot/battles.db"
    state = load_state()
    newest = newest_stored(db)
    verdict = "run" if "--force" in argv else decide(newest, state.get("seen"), time.time())
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if verdict != "run":
        print(f"{stamp} {verdict}: newest stored {newest}, last acted on {state.get('seen')}")
        return 0
    print(f"{stamp} poll finished (newest stored {newest}); updating the duel evidence")
    t0 = time.time()
    steps = [
        ("duel index", [sys.executable, "-u", os.path.join(HERE, "duel_index.py"), "--build"]),
        ("duel model", [sys.executable, "-u", os.path.join(HERE, "duel_model_train.py")]),
        # Which deck a player brings next (`duel_read`): refitted on every
        # stored duel, so each poll's duels shape the next read.
        ("duel read", [sys.executable, "-u", os.path.join(HERE, "duel_read_train.py")]),
        # Which cards duel players put together: the gate on "Or bring one of
        # these" (a deck whose cards they do not pair is skipped).
        ("deck synergy", [sys.executable, "-u", os.path.join(HERE, "deck_synergy.py"), "--build"]),
        # The deck builder's move set: which cards humans interchange.
        ("swap graph", [sys.executable, "-u", os.path.join(HERE, "swap_graph.py"), "--build"]),
    ]
    failed = []
    for name, cmd in steps:
        t1 = time.time()
        rc = subprocess.call(cmd, cwd=HERE)
        print(f"  {name}: exit {rc} in {time.time() - t1:.0f}s")
        if rc != 0:
            failed.append(name)
    # The watermark moves even if one step failed: that step's own watermark
    # still covers what it missed, so the next poll's run catches it up.
    save_state({"seen": newest, "at": stamp, "seconds": round(time.time() - t0),
                "failed": failed})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
