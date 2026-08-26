"""test_tracking.py — the tag-request queue, and the way it could freeze.

    python server/test_tracking.py

Plain asserts and a counter, in the same style as the other suites here. No
Clash_Bot database is opened: the queue is this module's own SQLite file, and
it is pointed at a temporary directory for the run.

WHAT IS WORTH TESTING HERE is the interaction with the bot's drain, because the
two halves live in different projects and neither one can see the other's rule.
The bot reads:

    SELECT tag FROM tag_requests ORDER BY requested_at LIMIT 200

skipping tags already in `tracked_players`. Nothing deleted the rows it had
already dealt with. So once 200 lifetime requests had accumulated, every drain
read the same 200 skips and never saw a newer request — enrolment freezing
permanently while the site kept answering "pending".

That is a CUMULATIVE failure, not a concurrent one: a hundred people searching a
hundred tags at once was always inside one batch and always worked. It is the
thousandth request over a month that breaks it, which is the kind that arrives
quietly and looks like something else.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Point the queue at a scratch file BEFORE importing the module: the path is
# read at import time.
_TMP = tempfile.mkdtemp(prefix="tracking-test-")
os.environ["CLASH_TRACKING_DB"] = os.path.join(_TMP, "queue.db")

import tracking  # noqa: E402

PASS = 0
FAIL = 0

#: The bot's own `TAG_DRAIN_BATCH` default. Duplicated deliberately — this
#: suite exists to check the two projects agree, so reading the bot's value
#: would defeat the point.
DRAIN_LIMIT = 200


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def _queue():
    con = sqlite3.connect(os.environ["CLASH_TRACKING_DB"])
    try:
        return [r[0] for r in con.execute(
            "SELECT tag FROM tag_requests ORDER BY requested_at LIMIT ?",
            (DRAIN_LIMIT,))]
    finally:
        con.close()


def _reset():
    con = sqlite3.connect(os.environ["CLASH_TRACKING_DB"])
    try:
        con.execute("DELETE FROM tag_requests")
        con.commit()
    finally:
        con.close()


# --- the queue itself -------------------------------------------------------

tracking.request("#AAA111")
tracking.request("#BBB222")
check("a request is queued", set(_queue()) == {"#AAA111", "#BBB222"})

first = tracking.request("#AAA111", source="search")
again = tracking.request("#AAA111", source="search")
check("a repeat search bumps hits", again["hits"] > first["hits"])
check(
    "...and never moves requested_at",
    again["requestedAt"] == first["requestedAt"],
    "the bot drains oldest-first, so rewriting it would let a popular tag "
    "starve behind its own re-searches",
)

# --- the freeze -------------------------------------------------------------

_reset()
for i in range(DRAIN_LIMIT + 50):
    tracking.request("#T%06d" % i)

enrolled = {"#T%06d" % i for i in range(DRAIN_LIMIT + 40)}
visible = [t for t in _queue() if t not in enrolled]
check(
    "UNPRUNED, a full batch of enrolled rows hides every new request",
    visible == [],
    f"saw {len(visible)}",
)

# `prune_enrolled` reads the bot's tracked_players, which is not available in a
# test, so the deletion it performs is done here directly. What is being pinned
# is the CONSEQUENCE — that removing enrolled rows is what lets the drain reach
# new ones — not the plumbing that finds them.
con = sqlite3.connect(os.environ["CLASH_TRACKING_DB"])
con.executemany("DELETE FROM tag_requests WHERE tag = ?", ((t,) for t in enrolled))
con.commit()
con.close()

after = _queue()
check("pruned, the queue is only what is still waiting", len(after) == 10)
check(
    "...and every new request is now reachable by the drain",
    all(t not in enrolled for t in after) and len(after) == 10,
)

# --- prune_enrolled must never raise ---------------------------------------

check(
    "prune_enrolled survives having no bot database",
    isinstance(tracking.prune_enrolled(), int),
    "it returns 0 rather than raising when the drive is absent",
)

check(
    "the prune threshold is below the bot's drain batch",
    tracking.PRUNE_ABOVE < DRAIN_LIMIT,
    "pruning after the queue already exceeds a batch would be too late",
)


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
