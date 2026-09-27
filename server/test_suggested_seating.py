"""test_suggested_seating.py — a deck Deckkies SUGGESTS fields every special
slot its cards can fill.

    python server/test_suggested_seating.py

No database: `card_art_profile` is pinned, and every deck is real card keys
read through the shipped card metadata.

`arrange_deck` draws a deck the way it was FIELDED — with observations, a card
nobody was seen fielding specially stays plain. That is right for a record of
play and wrong for advice. `complete_seating` is the advice: the most special
slots the cards can fill, then the most observed forms kept, then capability
seating's own choices. Measured before it: a teammate's own list suggested back
to them drew Bats as the evolution, Little Prince as the champion and Cannon
PLAIN in the wild slot, because they had never fielded the Cannon evolution.
"""

from __future__ import annotations

import itertools
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clash_data as cd  # noqa: E402

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


# No database read: `arrange_deck` asks for the art profile even where it does
# not use it.
cd._ART_PROFILE = ({}, time.monotonic())

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = json.load(open(os.path.join(ROOT, "tests", "fixtures", "seating.json"),
                       encoding="utf-8"))["cases"]


def drawn(order, art):
    """Special slots actually drawn: slot 1 an evolution, slot 2 a hero or a
    champion, slot 3 any of the three."""
    n = 0
    if art.get(order[0]) == "evolution":
        n += 1
    if art.get(order[1]) == "hero" or cd.slot_kind(order[1]) == "champion":
        n += 1
    if art.get(order[2]) in ("evolution", "hero") or cd.slot_kind(order[2]) == "champion":
        n += 1
    return n


def illegal(order, art):
    if art.get(order[1]) == "evolution":
        return "an evolution in slot 2"
    for i, c in enumerate(order):
        if cd.slot_kind(c) == "champion" and i not in (1, 2):
            return f"a champion at index {i}"
        if i >= cd.SPECIAL_SLOTS and art.get(c):
            return f"art past the special slots at index {i}"
    return None


print("\n-- the card kinds these tests are written against --")
KINDS = {
    "bats": "evolution", "cannon": "evolution", "bomber": "evolution",
    "inferno-dragon": "evolution", "royal-giant": "evolution",
    "valkyrie": "both", "knight": "both", "musketeer": "both",
    "ice-wizard": "hero", "balloon": "hero", "barbarian-barrel": "hero",
    "little-prince": "champion", "archer-queen": "champion",
    "golden-knight": "champion",
    "arrows": "", "fireball": "", "the-log": "", "hog-rider": "",
    "poison": "", "rocket": "", "miner": "", "lightning": "",
}
for card, want in KINDS.items():
    check(f"{card} is {want or 'plain'}", cd.slot_kind(card) == want, cd.slot_kind(card))
PLAIN = [c for c, k in KINDS.items() if k == ""]


def deck(*special, n=8):
    """The named cards, topped up to eight with plain ones."""
    out = list(special)
    for c in PLAIN:
        if len(out) >= n:
            break
        if c not in out:
            out.append(c)
    return out


print("\n-- fillable_slots: the most the cards allow --")
check("two evolutions and a hero: 3",
      cd.fillable_slots(deck("bomber", "inferno-dragon", "ice-wizard")) == 3)
check("two evolutions, no hero, no champion: 2 (slot 2 has nothing to take it)",
      cd.fillable_slots(deck("bomber", "inferno-dragon")) == 2)
check("one both-form card alone: 1 (it can serve one slot, not two)",
      cd.fillable_slots(deck("valkyrie")) == 1)
check("a both-form card and an evolution: 2",
      cd.fillable_slots(deck("valkyrie", "bomber")) == 2)
check("a both-form card and two evolutions: 3 (the both-form card is the hero)",
      cd.fillable_slots(deck("valkyrie", "bomber", "inferno-dragon")) == 3)
check("a champion and two evolutions: 3",
      cd.fillable_slots(deck("little-prince", "bats", "cannon")) == 3)
check("two champions and an evolution: 3",
      cd.fillable_slots(deck("archer-queen", "golden-knight", "bats")) == 3)
check("a champion and a hero, no evolution: 2 (slot 1 takes only an evolution)",
      cd.fillable_slots(deck("little-prince", "ice-wizard")) == 2)
check("nothing capable: 0", cd.fillable_slots(deck()) == 0)
d = deck("valkyrie", "bomber", "inferno-dragon")
check("order cannot change the answer",
      cd.fillable_slots(d) == cd.fillable_slots(list(reversed(d))))


print("\n-- with no observation it IS capability seating --")
same = [c["input"] for c in CASES if cd.complete_seating(c["input"], {})[:2]
        == cd.arrange_deck(c["input"], {})]
check(f"all {len(CASES)} fixture decks seat exactly as arrange_deck(cards, {{}})",
      len(same) == len(CASES), f"{len(same)} of {len(CASES)}")
bare = [c["input"] for c in CASES]
check("and every form drawn is reported as filled (nothing was observed)",
      all(set(cd.complete_seating(c, {})[2]) == set(cd.complete_seating(c, {})[1])
          for c in bare))


print("\n-- the live case: Cannon left plain in the wild slot --")
live = ["bats", "little-prince", "cannon", "arrows", "fireball", "the-log", "hog-rider", "poison"]
order, art = cd.arrange_deck(live, {"bats": "evolution"})
check("as fielded, the wild slot is a plain Cannon",
      order[:3] == ["bats", "little-prince", "cannon"] and "cannon" not in art, (order, art))
o, a, f = cd.complete_seating(order, art, slot_of=cd.seated_positions(order, art))
check("suggested, Cannon is the second evolution in slot 3",
      o[:3] == ["bats", "little-prince", "cannon"] and a.get("cannon") == "evolution", (o, a))
check("the observed Bats evolution is kept", a.get("bats") == "evolution")
check("and only Cannon is reported as filled", f == ["cannon"], f)


print("\n-- a slot outranks an observed form --")
fielded = ["bomber", "arrows", "valkyrie", "inferno-dragon", "fireball", "the-log", "hog-rider", "poison"]
order, art = cd.arrange_deck(fielded, {"bomber": "evolution", "valkyrie": "evolution"})
check("as fielded: evolution / plain / evolution",
      art.get(order[0]) == "evolution" and not art.get(order[1])
      and art.get(order[2]) == "evolution", (order, art))
o, a, f = cd.complete_seating(order, art, slot_of=cd.seated_positions(order, art))
check("suggested: Valkyrie becomes the hero and Inferno Dragon the second evolution",
      o[:3] == ["bomber", "valkyrie", "inferno-dragon"]
      and a == {"bomber": "evolution", "valkyrie": "hero", "inferno-dragon": "evolution"},
      (o, a))
check("both changes are reported as filled", set(f) == {"valkyrie", "inferno-dragon"}, f)


print("\n-- an observed form that costs nothing is kept --")
three = ["bats", "cannon", "royal-giant", "ice-wizard", "arrows", "fireball", "the-log", "hog-rider"]
o, a, f = cd.complete_seating(three, {"royal-giant": "evolution"})
check("the observed Royal Giant evolution stays in slot 1",
      o[0] == "royal-giant" and a.get("royal-giant") == "evolution", (o, a))
check("and the deck still fills all three", drawn(o, a) == 3, (o, a))
check("the Royal Giant is not reported as filled", "royal-giant" not in f, f)


print("\n-- an observed seat is kept --")
hc = ["bats", "little-prince", "ice-wizard", "arrows", "fireball", "the-log", "hog-rider", "poison"]
order, art = cd.arrange_deck(hc, {"bats": "evolution", "ice-wizard": "hero"},
                             slot_of={"bats": 0, "ice-wizard": 2})
check("fielded evolution / champion / hero",
      order[:3] == ["bats", "little-prince", "ice-wizard"], order)
o, a, f = cd.complete_seating(order, art, slot_of=cd.seated_positions(order, art))
check("re-seated exactly where it was seen", o[:3] == order[:3] and a == art, (o, a))
check("nothing filled on a deck that was already full", f == [], f)


print("\n-- every fixture deck, under every observation --")
rng = random.Random(20260927)
bad: dict[str, int] = {}
checks = 0
changed = 0
for case in CASES:
    cards = case["input"]
    most = cd.fillable_slots(cards)
    _, capable = cd.arrange_deck(cards, {})
    views = []
    items = list(capable.items())
    for r in range(len(items) + 1):
        views += [dict(x) for x in itertools.combinations(items, r)]
    able = [c for c in cards if cd.slot_kind(c) in ("evolution", "hero", "both")]
    for _ in range(40):
        seen = {}
        for c in rng.sample(able, k=min(len(able), rng.randint(0, 3))):
            k = cd.slot_kind(c)
            seen[c] = rng.choice(["evolution", "hero"]) if k == "both" else k
        views.append(seen)
    for seen in views:
        o2, a2 = cd.arrange_deck(cards, seen)
        o3, a3, f3 = cd.complete_seating(o2, a2, slot_of=cd.seated_positions(o2, a2))
        checks += 1
        why = []
        if drawn(o3, a3) != most:
            why.append("fewer slots than the cards allow")
        if illegal(o3, a3):
            why.append(illegal(o3, a3))
        if sorted(o3) != sorted(cards):
            why.append("the cards changed")
        if set(f3) != {c for c in a3 if a2.get(c) != a3[c]}:
            why.append("filled is not exactly the unobserved forms")
        for w in why:
            bad[w] = bad.get(w, 0) + 1
        if any(a3.get(c) != v for c, v in a2.items()):
            changed += 1
check(f"{checks} seatings: every one draws the most slots its cards allow, legally",
      not bad, bad)
check("an observed form is changed only when that is what fills a slot, and rarely",
      0 < changed < checks // 50, f"{changed} of {checks}")


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
