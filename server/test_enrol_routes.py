"""EVERY TAG THE API IS ASKED ABOUT IS QUEUED FOR COLLECTION.

Run it directly:  python server/test_enrol_routes.py

Before 2026-09-26 only the player search, `/track`, `/live` and Team Analysis
queued an untracked tag; Duel Analysis, Duel Zone, Recent Battles, Cards, Deck
Counter, the three Coach Assist reads and the Coach Roster's intel and field
plan read a tag and forgot it. The account holder asked for the rule by name:
a tag searched or added anywhere goes into the database and is polled from
the next poll.

Two halves:

  * a SOURCE CHECK over `app.py`: every route block that normalises a tag must
    queue it (`_note_tag` or `_enrol`). This is what catches the NEXT route —
    the failure mode was never a bug in the queue, it was a route that did not
    call it;
  * a FUNCTIONAL check of `_note_tag` against a stubbed queue: it queues an
    untracked tag with its source, never re-queues a tracked or pending one,
    and does not re-check a tag it confirmed minutes ago.

No database is opened; the queue is stubbed.
"""

from __future__ import annotations

import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

passed = failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}  {detail}")


# --------------------------------------------------------------- source check

src = open(os.path.join(HERE, "app.py"), encoding="utf-8").read()

# Split the route table into blocks, one per `if path...` test.
starts = [m.start() for m in re.finditer(r'\n\s+if path(?:\.startswith\(|\s*==\s*)"/api/analytics/', src)]
blocks = []
for i, a in enumerate(starts):
    b = starts[i + 1] if i + 1 < len(starts) else len(src)
    block = src[a:b]
    m = re.search(r'"(/api/analytics/[^"]*)"', block)
    blocks.append((m.group(1) if m else "?", block))

check("the route table was found", len(blocks) >= 20, f"{len(blocks)} blocks")

# Team Analysis queues inside its own module, per player it resolves.
EXEMPT = {"/api/analytics/teams"}
tagged = [(route, block) for route, block in blocks if "cd.normalize_tag(" in block]
check("routes that take a tag were found", len(tagged) >= 12, f"{len(tagged)}")
for route, block in tagged:
    if route in EXEMPT:
        continue
    check(f"{route} queues the tag it reads",
          "_note_tag(" in block or "_enrol(" in block)

ta = open(os.path.join(HERE, "team_analysis.py"), encoding="utf-8").read()
check("Team Analysis queues each player it resolves", "tracking.request(" in ta)

# The suggestion route reads TWO tags; both are players somebody asked about.
suggest = next(block for route, block in blocks if route == "/api/analytics/coach/suggest")
check("Coach Assist's suggestion queues the player", "_note_tag(me" in suggest)
check("Coach Assist's suggestion queues the opponent", "_note_tag(opp" in suggest)

# The admin intel route checks the admin gate BEFORE it queues anything, so an
# unauthenticated request cannot write to the queue through it.
intel = next(block for route, block in blocks if route == "/api/analytics/admin/coach/intel/")
check("the roster intel route queues only after its admin check",
      intel.index("admin_auth.verify") < intel.index("_note_tag("))


# ------------------------------------------------------------ functional check

import app  # noqa: E402

calls: list[tuple[str, str]] = []
state: dict[str, dict] = {}


def fake_status(tag):
    s = state.get(tag, {"tracked": False, "requested": False})
    return {"tag": tag, "state": "x", **s}


def fake_request(tag, source="search"):
    calls.append((tag, source))
    state[tag] = {"tracked": False, "requested": True}
    return {"requestedAt": "now", "hits": 1}


orig_status, orig_request = app.tracking.status, app.tracking.request
app.tracking.status, app.tracking.request = fake_status, fake_request
try:
    app._ENROLLED.clear()
    app._note_tag("#PQ2LLLLL", "duels")
    check("an untracked tag is queued, with the route as its source",
          calls == [("#PQ2LLLLL", "duels")], str(calls))

    app._note_tag("#PQ2LLLLL", "cards")
    check("a tag already queued is not queued again", len(calls) == 1, str(calls))

    state["#PQ8LLLLL"] = {"tracked": True, "requested": False}
    app._note_tag("#PQ8LLLLL", "battles")
    check("a tag the bot already collects is never queued", len(calls) == 1, str(calls))

    # Memoised: a tag confirmed a moment ago does not touch the queue at all.
    before = dict(app._ENROLLED)
    app.tracking.status = lambda t: (_ for _ in ()).throw(AssertionError("status called"))
    try:
        app._note_tag("#PQ8LLLLL", "battles")
        check("a tag confirmed minutes ago is not re-checked", True)
    except AssertionError:
        check("a tag confirmed minutes ago is not re-checked", False)
    app.tracking.status = fake_status

    # Past the TTL it is checked again (the bot may have dropped it).
    app._ENROLLED["#PQ8LLLLL"] = time.monotonic() - app._ENROLLED_TTL_S - 1
    seen = {"n": 0}

    def counting_status(t):
        seen["n"] += 1
        return fake_status(t)

    app.tracking.status = counting_status
    app._note_tag("#PQ8LLLLL", "battles")
    check("past the TTL a tag is checked again", seen["n"] >= 1)
    check("the memo holds only confirmed tags", set(before) <= set(app._ENROLLED))

    # Never raises: a broken queue must not take a screen down.
    def broken(t):
        raise RuntimeError("queue unavailable")

    app.tracking.status = broken
    app._ENROLLED.clear()
    try:
        app._note_tag("#PQ9LLLLL", "coach")
        check("a failing queue never raises into the route", True)
    except Exception as exc:  # noqa: BLE001
        check("a failing queue never raises into the route", False, repr(exc))
    check("a failed check is not memoised as confirmed", "#PQ9LLLLL" not in app._ENROLLED)
finally:
    app.tracking.status, app.tracking.request = orig_status, orig_request

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
