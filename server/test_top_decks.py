"""Tests for `top_decks` (what the top 1,000 ranked players play). No DB, no API."""
from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import top_decks as td  # noqa: E402

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print("  ok  ", name)
    else:
        FAIL += 1
        print("  FAIL", name, detail)


def deck(p):
    return [f"{p}{i}" for i in range(8)]


A, B, C = deck("a"), deck("b"), deck("c")


def row(cards, day, mode="Ranked1v1_NewArena2", won=True, arch="hog"):
    return {"battle_time": f"{day}T120000.000Z", "mode": mode, "cards": cards,
            "archetype": arch, "won": won}


print("modes")
check("ranked and trophy road count", td.is_ranked("Ranked1v1_NewArena2")
      and td.is_ranked("Ladder") and td.is_ranked("ranked1v1_newarena"))
check("friendlies, duels, events and 2v2 do not",
      not any(td.is_ranked(m) for m in ("Friendly", "CW_Duel_1v1", "Duel_1v1_Friendly",
                                         "TeamVsTeam", "Tournament", "", None)))

print("aggregate")
body = td.aggregate([
    (0, [row(A, "20261020"), row(A, "20261020", won=False), row(A, "20261001"),
         row(B, "20261019"), row(B, "20261019", mode="Friendly"),
         row(deck("x")[:7], "20261019"), row(deck("y")[:7] + ["y0"], "20261019")]),
    (1, [row(A, "20261018"), row(C, "20260801")]),
    (2, []),
])
check("only ranked eight-card lists of eight different cards are kept",
      set(body["decks"]) == {td.deck_key(A), td.deck_key(B), td.deck_key(C)}, str(sorted(body["decks"])))
check("the newest day any of them played", body["newest"] == "20261020")
check("a player with no ranked game is not counted as having games", body["withGames"] == 2)
pa = dict((i, rows) for i, rows in body["decks"][td.deck_key(A)]["p"])
check("per player, per day, games and wins, ages from the newest day",
      sorted(pa[0]) == [[0, 2, 1], [19, 1, 1]] and pa[1] == [[2, 1, 1]], str(pa))
check("no tag is stored anywhere — a player is their place in the board",
      "#" not in json.dumps(body))
check("the archetype rides on the list", body["decks"][td.deck_key(A)]["a"] == "hog")

print("window")
data = dict(body, brain=td.BRAIN)
w7 = td.window(data, 7)
check("a window counts players who used a list in it, and their games and wins",
      w7[td.deck_key(A)][:3] == [2, 3, 2], str(w7.get(td.deck_key(A))))
check("...and leaves out what was played before it",
      td.deck_key(C) not in w7 and w7[td.deck_key(B)][:3] == [1, 1, 1], str(w7))
w30 = td.window(data, 30)
check("a longer window reaches further back", w30[td.deck_key(A)][:3] == [2, 4, 3])
past = td.window(data, 7, datetime.date(2026, 10, 7))
check("a window anchored in the past reads only its own days",
      past.get(td.deck_key(A), [0, 0])[:2] == [1, 1] and td.deck_key(B) not in past, str(past))
check("no file is an empty window", td.window(None, 30) == {} and td.window({}, 30) == {})

print("live board")
pages = {None: {"items": [{"tag": "#AAA"}, {"tag": "BBB"}], "paging": {"cursors": {"after": "x"}}},
         "x": {"items": [{"tag": "#AAA"}, {"tag": "#CCC"}], "paging": {"cursors": {}}}}
calls = []
def fake_get(path, **params):
    calls.append((path, params))
    return 200, pages[params.get("after")]
check("the live board is read page by page, in rank order, tags normalised and unique",
      td.live_board(fake_get, 10) == ["#AAA", "#BBB", "#CCC"] and calls[0][0] == td.LIVE_BOARD)
check("...and stops at the limit", td.live_board(fake_get, 2) == ["#AAA", "#BBB"])
check("an unreadable board is empty, not an error",
      td.live_board(lambda p, **k: (503, None), pause=0) == [])
flaky = iter([(500, None), (500, None), (200, {"items": [{"tag": "#DDD"}], "paging": {}})])
check("a page that answers 500 is asked again", td.live_board(lambda p, **k: next(flaky), pause=0) == ["#DDD"])

print("load / status")
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "t.json")
    check("an absent file loads as None", td.load(p) is None and td.status(p) == {"available": False})
    with open(p, "w", encoding="utf-8") as f:
        json.dump(dict(data, builtAt="x", season="2026-09", players=1000), f)
    st = td.status(p)
    check("status is counts only", st["available"] and st["decks"] == 3 and st["players"] == 1000
          and st["season"] == "2026-09", str(st))
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"brain": "other"}, f)
    check("a file of another format is not read", td.load(p) is None)

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
