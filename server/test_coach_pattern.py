"""test_coach_pattern.py — the opponent's pattern (`coach._pattern`, 2026-11-14).

    python server/test_coach_pattern.py

No database. The duel read's rows and the window's play are handed in; what is
checked is the arithmetic: the whole read plus his play, grouped by win
condition, each win condition keeping its whole share among the decks rated.
"""

from __future__ import annotations

import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def deck(tag, spell="zap"):
    """A deck whose win condition is `tag`'s first letter, with one spell."""
    return [tag, spell] + [f"{tag}-f{i}" for i in range(6)]


def tagof(cards):
    return cards[0]


ROLE = {"zap": "spell", "log": "spell", "fireball": "spell"}


def read_row(tag, p, spell="zap", label="bot-label"):
    return {"cards": deck(tag, spell), "prob": p, "archetype": label, "deckName": "Deck " + tag,
            "art": {}, "read": True, "count": 3}


def threat(tag, like, spell="zap"):
    return {"cards": deck(tag, spell), "likelihood": like, "archetype": "x", "observedCount": 9,
            "art": {}}


_saved = (coach._ta, coach._archetype, coach._role_of, coach.dz)
coach._ta = SimpleNamespace(_family=lambda arch, cards: ("fam-" + arch, "Family " + arch.upper()))
coach._archetype = lambda cards: tagof(cards)[0]            # the classifier: first letter
coach._role_of = lambda c: ROLE.get(c, "wincon" if "-f" not in c else "support")
coach.dz = SimpleNamespace(deck_label=lambda cards, arch: "Deck " + tagof(cards))
saved_w = coach.PATTERN_PLAY_WEIGHT

print("the pattern: the whole read and his play, by win condition")
try:
    rows = [read_row("a1", 0.30), read_row("a2", 0.20), read_row("b1", 0.10), read_row("c1", 0.05, "log")]
    # 0.35 of the read is "a deck not seen".
    coach.PATTERN_PLAY_WEIGHT = None
    p = coach._pattern(rows, 0.35, None, set())
    fam = {f["family"]: f["share"] for f in p["families"]}
    check("no play: the read alone, renormalised, by win condition",
          abs(fam["fam-a"] - 0.50 / 0.65) < 1e-3 and abs(fam["fam-b"] - 0.10 / 0.65) < 1e-3, str(fam))
    check("the shares sum to one", abs(sum(fam.values()) - 1.0) < 1e-3)
    check("ONE CLASSIFIER: a read row's own archetype label is not its win condition",
          set(fam) == {"fam-a", "fam-b", "fam-c"})
    names = [tagof(d["cards"]) for d in p["decks"]]
    check("room for all: every list, shown best chance first",
          names == ["a1", "a2", "b1", "c1"], str(names))
    saved_n = coach.PATTERN_DECKS
    coach.PATTERN_DECKS = 3
    short = [tagof(d["cards"]) for d in coach._pattern(rows, 0.35, None, set())["decks"]]
    coach.PATTERN_DECKS = saved_n
    check("SHORT OF ROOM, ONE LIST OF EACH WIN CONDITION FIRST: a2 (more likely than b1 and c1) waits",
          sorted(short) == ["a1", "b1", "c1"], str(short))
    a = {tagof(d["cards"]): d for d in p["decks"]}
    check("A WIN CONDITION KEEPS ITS WHOLE SHARE, split over its listed lists by their chance",
          abs(a["a1"]["p"] - fam["fam-a"] * 0.6) < 1e-3 and abs(a["a2"]["p"] - fam["fam-a"] * 0.4) < 1e-3,
          str({k: v["p"] for k, v in a.items()}))
    check("`prob` is the share of the decks listed and sums to one",
          abs(sum(d["prob"] for d in p["decks"]) - 1.0) < 1e-6)
    check("every deck says its win condition", all(d["family"] and d["familyName"] for d in p["decks"]))
    spells = {c["card"]: c["prob"] for c in p["cards"]["spell"]}
    check("THE SPELLS: each one's chance over the whole pattern",
          abs(spells["zap"] - 0.60 / 0.65) < 1e-3 and abs(spells["log"] - 0.05 / 0.65) < 1e-3, str(spells))

    # His play: a win condition the duels never showed.
    play = {"threats": [threat("d1", 0.5), threat("a1", 0.3), threat("a9", 0.2)]}
    coach.PATTERN_PLAY_WEIGHT = 0.5
    p2 = coach._pattern(rows, 0.35, play, set())
    f2 = {f["family"]: f for f in p2["families"]}
    check("HALF THE PATTERN IS HIS PLAY (PATTERN_PLAY_WEIGHT 0.5)",
          abs(p2["fromPlay"] - 0.5) < 1e-3 and abs(p2["seen"] - 0.5) < 1e-3, str(p2["fromPlay"]))
    check("a win condition only his play shows enters the pattern",
          "fam-d" in f2 and abs(f2["fam-d"]["share"] - 0.25) < 1e-3 and f2["fam-d"]["read"] == 0.0)
    check("...and a list both show adds both shares",
          abs(f2["fam-a"]["share"] - (0.5 * 0.50 / 0.65 + 0.5 * 0.5)) < 1e-3, str(f2["fam-a"]))
    d1 = next(d for d in p2["decks"] if tagof(d["cards"]) == "d1")
    check("a deck from his play is drawn like any other, and says where it came from",
          d1["pattern"] == "play" and d1["fromPlay"] == 1.0 and d1["deckName"] == "Deck d1")
    check("the cut is published with the numbers", 0 < p2["covered"] <= 1.0 and p2["lists"] == 6)

    coach.PATTERN_PLAY_WEIGHT = None
    p3 = coach._pattern(rows, 0.35, play, set())
    check("weight None: his play fills exactly the read's not-seen share",
          abs(p3["fromPlay"] - 0.35) < 1e-3, str(p3["fromPlay"]))

    p4 = coach._pattern(None, None, play, set())
    check("no read: his play is the whole pattern", p4["fromPlay"] == 1.0 and p4["seen"] == 0.0)
    check("neither a read nor any play: no pattern", coach._pattern(None, None, None, set()) is None)
    check("a read with nothing in it and no play: no pattern",
          coach._pattern([], 1.0, {"threats": []}, set()) is None)

    p5 = coach._pattern(rows, 0.35, play, set(deck("a1")[:1]))
    check("A LIST HOLDING A CARD ALREADY REVEALED IS OUT, from the read and from his play",
          all(tagof(d["cards"]) != "a1" for d in p5["decks"]) and p5["lists"] == 5)

    coach.PATTERN_PLAY_WEIGHT = 0.5
    many = [read_row(f"{chr(101 + i)}{i}", 0.08) for i in range(12)]
    p6 = coach._pattern(many, 0.04, None, set())
    check("at most PATTERN_DECKS decks, each a different win condition first",
          len(p6["decks"]) == coach.PATTERN_DECKS
          and len({d["family"] for d in p6["decks"]}) == coach.PATTERN_DECKS)
    tiny = [read_row("a1", 0.9), read_row("b1", 0.001)]
    p7 = coach._pattern(tiny, 0.0, None, set())
    check("a win condition under PATTERN_MIN is not rated against (it stays in the numbers)",
          [tagof(d["cards"]) for d in p7["decks"]] == ["a1"] and len(p7["families"]) == 2)
    pub = coach._public_pattern(p2)
    check("the screen gets the numbers, not the decks twice",
          "decks" not in pub and pub["families"] and pub["cards"] and pub["brain"] == "coach-pattern-1.0")
finally:
    coach.PATTERN_PLAY_WEIGHT = saved_w
    coach._ta, coach._archetype, coach._role_of, coach.dz = _saved

print("\nthe tuner reads his likeliest decks only")
h = coach._head([{"cards": ["a"], "prob": 0.5}, {"cards": ["b"], "prob": 0.3}, {"cards": ["c"], "prob": 0.2}], 2)
check("the first n, renormalised, and the list it came from untouched",
      [d["cards"] for d in h] == [["a"], ["b"]] and abs(h[0]["prob"] - 0.625) < 1e-9
      and abs(sum(d["prob"] for d in h) - 1.0) < 1e-9 and coach.TUNER_THEIR == 3)
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach.py"), encoding="utf-8").read()
check("suggest hands the tuner `_head(opp[\"decks\"], TUNER_THEIR)`",
      'tune(best["cards"], _head(opp["decks"], TUNER_THEIR)' in _src)

print("\nthe player's own duel decks stay on the screen")
_saved3 = (coach._own_duel_decks, coach._drop_event_decks, coach._rec, coach._with_brain)
try:
    seen = {}
    coach._own_duel_decks = lambda hist, used: seen.setdefault("used", used) and [
        {"cards": deck(f"y{i}")} for i in range(9)]
    coach._drop_event_decks = lambda decks: ([d for d in decks if d["cards"][0] != "y2"], 1)
    coach._rec = lambda md, opp, chips, snap, rates, extra=None: {**md, **(extra or {}), "expected": {"winRate": 50.0}}
    coach._with_brain = lambda rows, ctx, rates: [r.setdefault("brain", {"winRate": 47.0}) for r in rows]
    yd = coach._your_decks({"h": 1}, {"spent"}, {}, [], None, None, {"model": 1})
    check("YOUR_DECKS of them, event decks out, each rated and marked as theirs",
          len(yd) == coach.YOUR_DECKS == 6 and all(r["yours"] and r["expected"] and r["brain"] for r in yd)
          and "y2" not in [r["cards"][0] for r in yd])
    check("...legal against what they have already played", seen["used"] == {"spent"})
    coach._own_duel_decks = lambda hist, used: (_ for _ in ()).throw(RuntimeError("history broke"))
    check("a failure is an empty block, never an error", coach._your_decks(None, set(), {}, [], None, None, None) == [])
    _src2 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach.py"), encoding="utf-8").read()
    check("the Suggestion sends them", '"yourDecks": your_decks,' in _src2)
finally:
    coach._own_duel_decks, coach._drop_event_decks, coach._rec, coach._with_brain = _saved3

print("\nopponent_next reads the pattern when the window is known")
_saved2 = (coach._history, coach.opening_decks, coach._play_space, coach._pattern, coach._legal)
try:
    calls = {}
    hist = {"allDecks": [["x"]]}
    coach.opening_decks = lambda tag, h, kind=None: {
        "decks": [{"cards": deck("a1"), "prob": 0.3, "read": True}], "engine": "duel-read-1.0",
        "newDeck": 0.4, "left": {"spent": {}, "left": {}}, "_all": ["ROWS"]}
    coach._legal = lambda decks, used: list(decks)
    coach._play_space = lambda tag, since, until: calls.setdefault("play", (tag, since, until)) and {"threats": []}
    coach._pattern = lambda r, nd, play, used: calls.setdefault("pattern", (r, nd)) and {
        "decks": [{"cards": deck("a1"), "prob": 1.0, "p": 0.6}], "lists": 7, "brain": "x",
        "families": [], "cards": {}, "seen": 0.5, "fromPlay": 0.5, "covered": 0.6}
    o = coach.opponent_next("#O", [], hist, None, "2026-10-15", "2026-11-13")
    check("with the window: the pattern's decks, its numbers, the read's extras kept",
          o["decks"][0]["p"] == 0.6 and o["pattern"]["fromPlay"] == 0.5 and o["engine"] == "duel-read-1.0"
          and o["left"] and o["source"] == "opponent-history" and o["nCandidates"] == 7, str(o))
    check("...read off the whole read and that window",
          calls["pattern"] == (["ROWS"], 0.4) and calls["play"] == ("#O", "2026-10-15", "2026-11-13"))
    calls.clear()
    o2 = coach.opponent_next("#O", [], hist, None)
    check("without a window: the read's own list, as before", "pattern" not in o2 and "pattern" not in calls)
finally:
    coach._history, coach.opening_decks, coach._play_space, coach._pattern, coach._legal = _saved2

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
