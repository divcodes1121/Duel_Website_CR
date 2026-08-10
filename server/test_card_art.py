"""test_card_art.py — how a deck is arranged into its slots, and what art each draws.

    python server/test_card_art.py

No database: `card_art_profile` is pinned, so these test the DECISION rules
rather than whatever the live sample happens to contain.

THE RULE, in the numbering a player sees:

    slot 1  (index 0)   EVOLUTION only
    slot 2  (index 1)   hero or champion or an ordinary card — never an evolution
    slot 3  (index 2)   hero, evolution or champion — the "wild" slot

which caps a deck at two evolutions.

It is STATED, not inferred, because the payload does not cleanly report it: over
~8,000 recent marked battles slot 2 reads hero 70% but evolution 30%, and 14% of
single battles carry three evolution marks. Rendering that majority put three
evolution frames on decks that cannot have three. The bot's own
`evolution_marks` docstring records the same ambiguity as unresolvable from the
stored columns.

`arrange_deck` therefore decides POSITIONS as well as art — the stored card
order is usually right but not always, and one X-Bow deck arrived with its
evolutions outside the special slots and rendered almost entirely plain.
"""

from __future__ import annotations

import os
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


# What the database observes these cards being brought as. Pinned so the suite
# does not depend on the live sample.
cd._ART_PROFILE = (
    {
        "knight": "evolution",
        "valkyrie": "evolution",
        "musketeer": "evolution",
        "wizard": "evolution",
        "bowler": "hero",
        "goblins": "hero",
        "skeletons": "evolution",
        "mortar": "evolution",
    },
    time.monotonic(),
)


def pad(cards):
    """Fill a deck out to eight with cards that have no special form."""
    filler = ["hog-rider", "fireball", "the-log", "rocket", "arrows", "minions",
              "elixir-collector", "giant-skeleton"]
    out = list(cards)
    for f in filler:
        if len(out) >= 8:
            break
        if f not in out:
            out.append(f)
    return out


def arranged(cards, marks=None):
    return cd.arrange_deck(pad(cards), marks or {})


print("\nthe slot rule holds for every arrangement")

CASES = {
    "two evolutions, no hero": ["skeletons", "mortar", "archers"],
    "evolutions + a hero": ["skeletons", "mortar", "bowler"],
    "a hero only": ["bowler"],
    "a champion only": ["archer-queen"],
    "hero and champion": ["bowler", "archer-queen"],
    "nothing special": [],
    "three evolution-capable": ["skeletons", "mortar", "knight"],
}

for label, cards in CASES.items():
    order, art = arranged(cards)
    evos = [c for c, v in art.items() if v == "evolution"]
    slot2 = order[1] if len(order) > 1 else None
    ok = (
        len(evos) <= 2
        and art.get(slot2) != "evolution"
        and all(c in order[:3] for c in art)
    )
    check(
        f"{label}: at most 2 evos, none in slot 2, art only in slots 1-3",
        ok,
        f"order={order[:3]} art={art}",
    )


print("\nevolutions and heroes land where they belong")

order, art = arranged(["skeletons", "mortar", "bowler"])
check("slot 1 is an evolution", art.get(order[0]) == "evolution", f"{order[:3]} {art}")
check("slot 2 is the hero", art.get(order[1]) == "hero", f"{order[:3]} {art}")
check("slot 3 is the second evolution", art.get(order[2]) == "evolution", f"{order[:3]} {art}")


print("\nan empty hero slot is filled, never collapsed")

# Collapsing shifted the second evolution up into slot 2 — the one position it
# may not occupy. This is the X-Bow deck that rendered wrong on the meta board.
xbow = ["archers", "tesla", "the-log", "skeletons", "fireball", "x-bow", "knight", "goblins"]
order, art = cd.arrange_deck(xbow, {})
check(
    "slot 2 holds an ordinary card rather than an evolution",
    art.get(order[1]) != "evolution",
    f"order={order[:3]} art={art}",
)
check(
    "both evolutions still render, in slots 1 and 3",
    art.get(order[0]) == "evolution" and art.get(order[2]) == "evolution",
    f"order={order[:3]} art={art}",
)


print("\nas many special slots filled as possible")

# A both-form card always claiming an evolution slot left slot 2 plain in decks
# whose only hero-capable cards also evolve. Two evolutions AND a hero is a
# better rendering of the same deck than two evolutions and a gap.
order, art = cd.arrange_deck(
    ["archers", "the-log", "wizard", "skeletons", "tesla", "fireball", "x-bow", "ice-spirit"],
    {},
)
check(
    "a spare both-form card fills the hero slot",
    art.get(order[1]) == "hero",
    f"order={order[:3]} art={art} — Wizard can serve either slot, and with "
    f"Archers/Skeletons/Tesla left over it is worth more as the hero",
)
check(
    "and two evolutions still render",
    sum(1 for v in art.values() if v == "evolution") == 2,
    f"order={order[:3]} art={art}",
)

# But not at the cost of an evolution: with only two evolution-capable cards,
# both belong in the evolution slots.
order, art = cd.arrange_deck(pad(["knight", "skeletons"]), {})
check(
    "a both-form card is NOT spent on the hero slot when evolutions are scarce",
    sum(1 for v in art.values() if v == "evolution") == 2,
    f"order={order[:3]} art={art}",
)


print("\nthe deck survives arrangement")

for label, cards in CASES.items():
    src = pad(cards)
    order, _ = cd.arrange_deck(src, {})
    check(f"{label}: no card lost or duplicated", sorted(order) == sorted(src))

src = pad(["skeletons", "mortar", "bowler"])
check(
    "arrangement is stable under input order",
    cd.arrange_deck(src, {})[1] == cd.arrange_deck(list(reversed(src)), {})[1],
    "two decks with the same cards must render identically",
)


print("\ncards that own BOTH forms")

# knight / valkyrie / musketeer / wizard have an evolution AND a hero form, so a
# capability flag cannot choose between them. Measured over ~6,000 recent marked
# battles, all four are fielded as evolutions 100% of the time — so they take an
# evolution slot when one is free.
for c in ("knight", "valkyrie", "musketeer", "wizard"):
    order, art = arranged([c, "bowler"])
    check(f"{c} takes the evolution slot when one is free", art.get(c) == "evolution",
          f"order={order[:3]} art={art}")
    # With both evolution slots taken it falls back to its hero form.
    order, art = arranged(["skeletons", "mortar", c])
    check(f"{c} falls back to hero art when the evolution slots are full",
          art.get(c) in (None, "hero"), f"order={order[:3]} art={art}")


print("\nchampions draw as themselves")

for c in ("archer-queen", "golden-knight", "skeleton-king", "monk", "mighty-miner"):
    order, art = arranged([c, "skeletons", "mortar"])
    check(f"{c} is never given evolution or hero art", c not in art, f"art={art}")

order, art = arranged(["archer-queen", "skeletons", "mortar"])
check("a champion does not stop the evolutions rendering",
      sum(1 for v in art.values() if v == "evolution") == 2, f"art={art}")


print("\nnothing to draw")

check("a deck with no special forms gets no art", arranged([])[1] == {})
check("an empty deck does not raise", cd.arrange_deck([], {}) == ([], {}))


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
