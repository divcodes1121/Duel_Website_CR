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


# --- the history: what the prune removes is kept, not lost (2026-09-26) -----
#
# The prune used to DELETE an enrolled row, and its source and request time
# went with it; the console's Tracking view needs both. The bot's table is not
# available in a test, so its two reads are stubbed — what is pinned is what
# this module does with them.

import time as _time  # noqa: E402

_reset()
con = sqlite3.connect(os.environ["CLASH_TRACKING_DB"])
con.execute("DELETE FROM tag_history")
now = _time.time()
stamp = tracking._stamp
rows = [
    ("#HISTA", stamp(now - 3600), "duels"),           # enrolled 10 min later
    ("#HISTB", stamp(now - 7200), "team"),            # enrolled 1 h later
    ("#WAITC", stamp(now - 600), "search"),           # still waiting
    ("#OLDD", stamp(now - 40 * 86400), "cards"),      # outside a 30-day window
]
con.executemany(
    "INSERT INTO tag_requests (tag, requested_at, last_seen_at, hits, source) VALUES (?, ?, ?, 1, ?)",
    ((t, at, at, src) for t, at, src in rows),
)
# One ancient history row the prune must age out.
con.execute(
    "INSERT INTO tag_history (tag, requested_at, last_seen_at, hits, source, pruned_at) VALUES (?, ?, ?, 1, ?, ?)",
    ("#ANCIENT", stamp(now - (tracking.HISTORY_DAYS + 5) * 86400),
     stamp(now - (tracking.HISTORY_DAYS + 5) * 86400), "search", stamp(now - 86400 * 100)),
)
con.commit()
con.close()


def _iso(epoch):
    return _time.strftime("%Y-%m-%dT%H:%M:%S", _time.gmtime(epoch)) + ".123456+00:00"


bot = {
    "#HISTA": _iso(now - 3600 + 600),
    "#HISTB": _iso(now - 7200 + 3600),
    "#OLDD": _iso(now - 39 * 86400),
    "#DIRECT1": _iso(now - 2 * 86400),                # enrolled with no queue row
}
_orig_set, _orig_rows, _orig_names = tracking.bot_tracked_set, tracking._bot_rows, tracking._names
tracking.bot_tracked_set = lambda: set(bot)
tracking._bot_rows = lambda: (dict(bot), True)
tracking._names = lambda tags: {"#HISTA": "Ravi"}
try:
    moved = tracking.prune_enrolled()
    check("the prune removes the three enrolled rows from the queue", moved == 3, f"moved {moved}")
    con = sqlite3.connect(os.environ["CLASH_TRACKING_DB"])
    hist = {r[0]: r[1] for r in con.execute("SELECT tag, source FROM tag_history")}
    left = [r[0] for r in con.execute("SELECT tag FROM tag_requests")]
    con.close()
    check("...and keeps each one, source and all, in the history",
          hist.get("#HISTA") == "duels" and hist.get("#HISTB") == "team" and hist.get("#OLDD") == "cards",
          str(hist))
    check("...leaving only the tag still waiting in the queue", left == ["#WAITC"], str(left))
    check("a history row older than HISTORY_DAYS is aged out", "#ANCIENT" not in hist)

    a = tracking.activity(days=30)
    by_tag = {r["tag"]: r for r in a["requests"]}
    check("a request the bot has is 'collecting'", by_tag["#HISTA"]["state"] == "collecting")
    check("a request the bot does not have is 'waiting'", by_tag["#WAITC"]["state"] == "waiting")
    check("the wait is measured from request to enrolment",
          by_tag["#HISTA"]["waitSeconds"] == 600 and by_tag["#HISTB"]["waitSeconds"] == 3600,
          str((by_tag["#HISTA"]["waitSeconds"], by_tag["#HISTB"]["waitSeconds"])))
    check("the median wait is the middle of the measured waits", a["summary"]["medianWaitSeconds"] == 2100,
          str(a["summary"]["medianWaitSeconds"]))
    check("a request older than the window is not listed", "#OLDD" not in by_tag)
    check("rows come newest first", [r["tag"] for r in a["requests"]] == ["#WAITC", "#HISTA", "#HISTB"])
    check("names are attached where the bot has one",
          by_tag["#HISTA"]["name"] == "Ravi" and by_tag["#WAITC"]["name"] is None)
    check("counts by source", a["bySource"]["duels"] == {"requested": 1, "collecting": 1, "waiting": 0}
          and a["bySource"]["search"]["waiting"] == 1, str(a["bySource"]))
    daily = {d["day"]: d["bySource"] for d in a["daily"]}
    flat = {}
    for src in daily.values():
        for k, v in src.items():
            flat[k] = flat.get(k, 0) + v
    check("bot additions carry the source that queued them",
          flat.get("duels") == 1 and flat.get("team") == 1, str(flat))
    check("an enrolment with no queue row is 'direct'", flat.get("direct") == 1, str(flat))
    check("an enrolment before the window is not counted", flat.get("cards") is None, str(flat))
    check("the queue reports what is still waiting", a["queue"] == {"rows": 1, "waiting": 1}, str(a["queue"]))
    check("the bot's roster size is reported", a["tracked"] == 4)

    one = tracking.activity(days=1)
    check("the window is whole UTC days: one day starts at today's midnight",
          all(r["requestedAt"][:10] == _time.strftime("%Y-%m-%d", _time.gmtime(now)) for r in one["requests"])
          and all(d["day"] == _time.strftime("%Y-%m-%d", _time.gmtime(now)) for d in one["daily"]),
          str([r["requestedAt"] for r in one["requests"]]))

    small = tracking.activity(days=30, limit=2)
    check("the list is capped, and says so", len(small["requests"]) == 2 and small["truncated"] is True)
    check("...while the counts still cover the whole window", small["summary"]["requested"] == 3)

    tracking._bot_rows = lambda: ({}, False)
    blind = tracking.activity(days=30)
    check("an unreadable bot table is flagged, not presented as fact", blind["botRead"] is False)
    check("...and nothing is claimed as collecting", blind["summary"]["collecting"] == 0)
finally:
    tracking.bot_tracked_set, tracking._bot_rows, tracking._names = _orig_set, _orig_rows, _orig_names


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
