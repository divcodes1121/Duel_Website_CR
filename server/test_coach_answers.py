"""test_coach_answers.py — Coach Assist's matchup map (`coach.answers`, 2026-11-14).

    python server/test_coach_answers.py

No database. The pool, the rates, the history and the seating are all handed
in, so what is checked is the rule: for EACH deck of theirs, the best list of
every win condition against THAT deck — not one list for the whole read.
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


def deck(tag):
    return [tag] + [f"{tag}-f{i}" for i in range(7)]


def tagof(cards):
    return next(c for c in cards if "-f" not in c)


# Families: the named card's first letter ("a1", "a2" are one win condition).
def fam(cards):
    t = tagof(cards)
    return ("fam-" + t[0], "Family " + t[0].upper())


T1, T2, T3 = deck("t1"), deck("t2"), deck("t3")
KNOWN = set()


def know(*decks):
    for d in decks:
        KNOWN.update(d)


class FakeFx:
    def __init__(self, table):
        self.table, self.cm = table, {"brain": "card-matchup-test"}

    def threat_table(self, threats):
        return [(t["likelihood"], t["family"], tagof(t["cards"])) for t in threats]

    def lean_rates(self, c, table):
        for like, fam_key, theirs in table:
            r = self.table.get((tagof(c.cards), theirs))
            if r is not None:
                yield like, fam_key, r, "deck"


class FakeRates:
    instances: list = []

    def __init__(self, snap, table=None, on=True):
        self.on = on
        self.fx = FakeFx(table or {})
        self.adopted, self.prepared, self.prefetched = [], [], []
        self.duel = SimpleNamespace(on=True, prefetch=lambda decks: self.prefetched.append(len(decks)))
        FakeRates.instances.append(self)

    def prepare(self, mine, theirs):
        self.prepared.append((len(mine), len(theirs)))

    def adopt(self, c):
        self.adopted.append(tagof(c.cards))

    def rate(self, mine, theirs=None, archetype=None):
        r = self.fx.table.get((tagof(mine), tagof(theirs)))
        return None if r is None else {"winRate": r, "games": 40, "source": "deck"}


def pool_list(tag, origin="top", crl=None):
    cards = deck(tag)
    know(cards)
    return SimpleNamespace(cards=cards, key=",".join(sorted(cards)), archetype="x", origin=origin,
                           art={}, inferred=False, crl=crl)


_saved = (coach._ta, coach._Rates, coach.counter, coach._history, coach._own_duel_decks,
          coach.dx, coach.cd, coach.dz, coach._archetype)


def install(table, pool, own=(), on=True):
    FakeRates.instances.clear()
    asked = []
    coach._ta = SimpleNamespace(
        DEFAULT_DAYS=30,
        _family=lambda arch, cards: fam(cards),
        use_bonus=lambda c: 5.0 if getattr(c, "crl", None) else 0.0,
        _competitive_pool=lambda days: (asked.append(days) or pool, {"days": days}),
        _pool_public=lambda w: {"days": w["days"]})
    coach._Rates = lambda snap: FakeRates(snap, table, on)
    coach.counter = SimpleNamespace(_snap=lambda: None)
    coach._history = lambda tag, since, until: {"tag": tag}
    coach._own_duel_decks = lambda hist, used: [
        {"cards": list(d), "art": {}, "archetype": "x", "deckName": "own", "count": 3}
        for d in own if not (set(d) & used)]
    coach.dx = SimpleNamespace(card_keys=lambda: sorted(KNOWN))
    coach.cd = SimpleNamespace(complete_seating=lambda cards, art, slot_of=None: (list(cards), dict(art), []),
                               seated_positions=lambda cards, art: {})
    coach.dz = SimpleNamespace(_arranged=lambda cards, obs: {"cards": list(cards)},
                               deck_label=lambda cards, arch: "Deck " + tagof(cards),
                               _avg_elixir=lambda cards: 3.5)
    coach._archetype = lambda cards: "x"
    return asked


def names(out, i):
    return [tagof(out["decks"][j]["cards"]) for j in out["answers"][i]]


know(T1, T2, T3)
print("coach.answers: the matchup map, per deck of theirs")
try:
    # Family a: a1 is best against T1, a2 against T2. Family b: b1 everywhere.
    table = {("a1", "t1"): 70.0, ("a1", "t2"): 40.0,
             ("a2", "t1"): 50.0, ("a2", "t2"): 75.0,
             ("b1", "t1"): 60.0, ("b1", "t2"): 55.0,
             ("c1", "t1"): 45.0}                       # c1 never rated against T2
    pool = [pool_list(t) for t in ("a1", "a2", "b1", "c1")]
    days = install(table, pool)
    out = coach.answers([T1, T2], [0.6, 0.2], days=15)
    check("one answer list per deck of theirs, in the order sent",
          len(out["answers"]) == 2 and [t["at"] for t in out["their"]] == [0, 1], str(out["their"]))
    check("THE DECKS CHANGE WITH THE DECK OF THEIRS: family a answers T1 with a1, T2 with a2",
          names(out, 0) == ["a1", "b1", "c1"] and names(out, 1) == ["a2", "b1"],
          f"{names(out, 0)} {names(out, 1)}")
    check("one list of each win condition under a deck, best rate first",
          len({out["decks"][j]["family"] for j in out["answers"][0]}) == len(out["answers"][0]))
    check("their chances are normalised over what was sent",
          [t["likelihood"] for t in out["their"]] == [0.75, 0.25], str(out["their"]))
    a1 = next(d for d in out["decks"] if tagof(d["cards"]) == "a1")
    check("every row carries its rate against EVERY deck of theirs, by position",
          a1["vsAt"] == [[70.0, "deck", 40], [40.0, "deck", 40]], str(a1["vsAt"]))
    check("...and the expected figure is the chance-weighted mean of them",
          a1["expectedWinRate"] == round(0.75 * 70 + 0.25 * 40, 1), str(a1["expectedWinRate"]))
    c1 = next(d for d in out["decks"] if tagof(d["cards"]) == "c1")
    check("a deck with no measured rate is null, never 50, and drops out of its expected figure",
          c1["vsAt"][1] is None and c1["expectedWinRate"] == 45.0 and c1["weight"] == 0.75, str(c1))
    check("the pool is the window asked for, read once, duel records fetched for all of it",
          days == [15] and FakeRates.instances[0].prefetched == [4])
    check("every shown pool row is adopted (rated as the pool rates it)",
          sorted(FakeRates.instances[0].adopted) == ["a1", "a2", "b1", "c1"],
          str(FakeRates.instances[0].adopted))
    check("the answer names its brain and the card model",
          out["brain"] == "coach-answers-1.0" and out["pool"]["cardModel"] == "card-matchup-test"
          and out["reason"] is None)

    # A CRL duel list takes the win condition within 5 points; its figure is its own.
    table2 = {("a1", "t1"): 69.0, ("a3", "t1"): 66.0, ("a4", "t1"): 72.0}
    install(table2, [pool_list("a1"), pool_list("a3", "crl", crl=[4, 3, 2])])
    got = coach.answers([T1], [1.0])
    row = got["decks"][got["answers"][0][0]]
    check("a CRL duel list within five points takes its win condition",
          tagof(row["cards"]) == "a3" and row["origin"] == "crl" and row["crlPilots"] == 2, str(row))
    check("...printed at its own rate, not the preference",
          row["vsAt"][0][0] == 66.0)
    install(table2, [pool_list("a4"), pool_list("a3", "crl", crl=[4, 3, 2])])
    got = coach.answers([T1], [1.0])
    check("...but not past five points",
          tagof(got["decks"][got["answers"][0][0]]["cards"]) == "a4")

    # The player's own duel deck, and the cards already spent.
    own = deck("a9")
    know(own)
    table3 = {("a1", "t1"): 68.0, ("a9", "t1"): 64.0, ("b1", "t1"): 60.0, ("b1", "t2"): 61.0}
    pool3 = [pool_list("a1"), pool_list("b1")]
    install(table3, pool3, own=[own])
    got = coach.answers([T1], [1.0], my_tag="#ME")
    first = got["decks"][got["answers"][0][0]]
    check("THE PLAYER'S OWN DUEL DECK competes, preferred like a CRL duel list",
          tagof(first["cards"]) == "a9" and first["origin"] == "yours" and first["count"] == 3, str(first))
    check("...and their decks were prepared against every deck of theirs",
          FakeRates.instances[0].prepared == [(1, 1)])
    check("the pool says how many of the player's own decks it held",
          got["pool"]["own"] == 1)
    install(table3, pool3, own=[own])
    spent = [own[0], pool3[1].cards[2]]
    got = coach.answers([T1], [1.0], my_tag="#ME", my_played=[spent])
    check("A DECK HOLDING A CARD ALREADY PLAYED THIS DUEL IS NEVER OFFERED",
          names(got, 0) == ["a1"], str(names(got, 0)))

    # The screen's own options stay on the map, answer or not.
    opt = deck("b7")
    know(opt)
    install({("a1", "t1"): 70.0, ("b1", "t1"): 66.0, ("b7", "t1"): 52.0}, [pool_list("a1"), pool_list("b1")])
    got = coach.answers([T1], [1.0], keep=[opt])
    kept = [d for d in got["decks"] if d.get("keep")]
    check("an option on screen is kept on the map though it answers nothing",
          len(kept) == 1 and tagof(kept[0]["cards"]) == "b7" and kept[0]["origin"] == "option"
          and "b7" not in names(got, 0), str(got["decks"]))

    # Bad input.
    install(table, pool)
    got = coach.answers([["t1"], T1 + ["x"], deck("zz"), T1, T1], [])
    check("their decks without eight known cards, and repeats, are dropped",
          [t["at"] for t in got["their"]] == [3] and got["their"][0]["likelihood"] == 1.0, str(got["their"]))
    check("no deck of theirs: a reason, not an error",
          coach.answers([], [])["reason"] == "no_decks")
    install(table, pool, on=False)
    check("no rates on this box: a reason, nothing guessed",
          coach.answers([T1], [1.0])["reason"] == "no_rates")
    install({}, pool)
    got = coach.answers([T1], [1.0])
    check("nothing rated against them: no rows, and it says so",
          got["decks"] == [] and got["answers"] == [[]] and got["reason"] == "no_rates")

    # The cap on win conditions listed under one deck.
    many = [pool_list(f"{chr(97 + i % 26)}{i}") for i in range(40)]
    install({(tagof(c.cards), "t1"): 50.0 + i * 0.1 for i, c in enumerate(many)}, many)
    got = coach.answers([T1], [1.0])
    fams = {got["decks"][j]["family"] for j in got["answers"][0]}
    check("one list a win condition, at most ANSWER_PER_DECK of them",
          len(got["answers"][0]) == len(fams) <= coach.ANSWER_PER_DECK, str(len(got["answers"][0])))
finally:
    (coach._ta, coach._Rates, coach.counter, coach._history, coach._own_duel_decks,
     coach.dx, coach.cd, coach.dz, coach._archetype) = _saved

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
