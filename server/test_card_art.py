"""test_card_art.py — how a deck is arranged into its slots, and what art each draws.

    python server/test_card_art.py

No database: `card_art_profile` is pinned, so these test the DECISION rules
rather than whatever the live sample happens to contain.

THE RULE, in the numbering a player sees:

    slot 1  (index 0)   EVOLUTION only
    slot 2  (index 1)   hero or champion or an ordinary card — never an evolution
    slot 3  (index 2)   hero, evolution or champion — the "wild" slot

so a deck wears at most two evolutions, at most two heroes, and at most three
marks in total — one per slot.

The payload reports it cleanly ONCE THE LEVEL IS READ. The figures that once
made it look ambiguous — slot 2 "hero 70% / evolution 30%", 14% of battles
carrying three evolution marks — came from reading the mark's `art` string,
which mislabels 9.2% of heroes as evolutions. By level: level 1 never lands in
slot 2, level 2 never lands in slot 1, and no battle carries three evolutions.
See `cd.mark_variant`.

`arrange_deck` therefore decides POSITIONS as well as art — the stored card
order is usually right but not always, and one X-Bow deck arrived with its
evolutions outside the special slots and rendered almost entirely plain.
"""

from __future__ import annotations

import hashlib
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


# ── observed marks beat inference ───────────────────────────────────────────
#
# The section below this one describes what to do with NO evidence. This one is
# what to do WITH it, and it takes priority — a deck that was watched being
# played is not a deck that needs guessing about.
#
# The bug this pins: `marks` was accepted and ignored, so every deck was
# rendered at the maximum loadout its cards permitted. Measured on the live meta
# board, 43 of 50 decks drew two evolutions and a hero against 28 actually
# played that way, and 19 of 50 renderings contradicted the evidence. Because
# Barbarian Barrel can be a hero and sits in eight of the seventeen archetype
# decks, it was promoted to the hero slot in all eight — which is why every
# archetype row on the Deck Counter opened with the same gold card and the
# decks "all looked similar".

print("\nobserved marks decide, and inference does not get a vote")

MORTAR = ["skeleton-barrel", "barbarian-barrel", "mortar", "cannon-cart",
          "fireball", "minions", "rascals", "berserker"]

order, art = cd.arrange_deck(MORTAR, {})
check("with no evidence, a hero-capable staple is promoted",
      art.get("barbarian-barrel") == "hero", f"art={art}")

# What the payload actually says about this deck: two evolutions, no hero.
order, art = cd.arrange_deck(MORTAR, {"skeleton-barrel": "evolution", "mortar": "evolution"})
check("with evidence, an unobserved card stays PLAIN however capable it is",
      "barbarian-barrel" not in art, f"art={art}")
check("and the observed evolutions are the ones that render",
      art == {"skeleton-barrel": "evolution", "mortar": "evolution"}, f"art={art}")
check("a deck with no observed hero renders no hero",
      "hero" not in art.values(), f"art={art}")

# A card that can be BOTH, observed as the one the inference would not pick.
XBOW = ["archers", "knight", "tesla", "the-log", "skeletons", "electro-spirit",
        "fireball", "x-bow"]
_, guessed = cd.arrange_deck(XBOW, {})
check("inference makes Knight the hero here", guessed.get("knight") == "hero", str(guessed))
_, seen = cd.arrange_deck(XBOW, {"knight": "evolution", "archers": "evolution"})
check("but the payload says evolution, and the payload wins",
      seen.get("knight") == "evolution", str(seen))

# The game's own cap still applies on top of the evidence: a deck cannot field
# three evolutions, however many the pooled sample reports.
_, capped = cd.arrange_deck(
    XBOW, {"archers": "evolution", "knight": "evolution", "tesla": "evolution"})
check("no more than two evolutions render, even if three were marked",
      sum(1 for v in capped.values() if v == "evolution") == 2, str(capped))
check("and no hero is invented to fill the gap", "hero" not in capped.values(), str(capped))

# TWO heroes, because slot 3 takes either form — evolution / hero / hero is
# 9.25% of real battles. This check asserted "at most one hero" for a revision
# and that is what made a Lava Hound deck's slot 3 hero render plain.
order, two_heroes = cd.arrange_deck(
    MORTAR, {"barbarian-barrel": "hero", "berserker": "hero", "mortar": "evolution"})
check("both heroes render when the marks name two",
      sum(1 for v in two_heroes.values() if v == "hero") == 2, str(two_heroes))
check("the evolution still owns slot 1, and the heroes take slots 2 and 3",
      two_heroes.get(order[0]) == "evolution"
      and two_heroes.get(order[1]) == "hero"
      and two_heroes.get(order[2]) == "hero", f"{order[:3]} {two_heroes}")
check("and never a fourth mark",
      len(cd.arrange_deck(MORTAR, {"barbarian-barrel": "hero", "berserker": "hero",
                                   "mortar": "evolution",
                                   "skeleton-barrel": "evolution"})[1]) <= cd.MAX_SPECIAL)

# Idempotence has to survive the new path too — the same failure that made the
# sequence board and the series log disagree.
obs = {"skeleton-barrel": "evolution", "mortar": "evolution"}
o1, a1 = cd.arrange_deck(MORTAR, obs)
o2, a2 = cd.arrange_deck(o1, obs)
check("arranging an already-arranged deck changes nothing", (o1, a1) == (o2, a2),
      f"{o1[:3]}/{a1} then {o2[:3]}/{a2}")
check("and it does not depend on the order the cards arrived",
      cd.arrange_deck(list(reversed(MORTAR)), obs)[1] == a1)

check("a mark for a card the deck does not hold is ignored",
      cd.arrange_deck(MORTAR, {"golem": "evolution", "mortar": "evolution"})[1]
      == {"mortar": "evolution"})
check("empty marks fall back to inference rather than rendering nothing",
      cd.arrange_deck(MORTAR, {})[1] != {})


print("\nas many special slots filled as possible")

# A both-form card always claiming an evolution slot left slot 2 plain in decks
# whose only hero-capable cards also evolve. Two evolutions AND a hero is a
# better rendering of the same deck than two evolutions and a gap.
# NOTE: this whole section is the NO-EVIDENCE path. See above for what happens
# when the deck was actually observed.
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

# The case the rule above missed, and it shipped a real bug: a deck with TWO
# both-form cards picked its hero as "the last one in the list", so the answer
# depended on arrival order. Arranging an already-arranged deck then swapped the
# hero and the second evolution back, and the same deck rendered one way in the
# duel series log and the other on the deck-sequence board.
TWO_BOTH = ["skeletons", "knight", "musketeer", "hog-rider",
            "fireball", "the-log", "cannon", "ice-spirit"]
once_o, once_a = cd.arrange_deck(TWO_BOTH, {})
twice_o, twice_a = cd.arrange_deck(once_o, {})
check("arranging an arranged deck changes nothing (order)", once_o == twice_o,
      f"{once_o} -> {twice_o}")
check("arranging an arranged deck changes nothing (art)", once_a == twice_a,
      f"{once_a} -> {twice_a}")
# NOT full order-independence, deliberately: with more evolution-capable cards
# than slots, WHICH two get the art is read positionally out of payload order,
# and that is the documented heuristic rather than an accident. Idempotence is
# the property the screens actually need — arranged output must be a fixed
# point, so passing a deck through twice cannot change it.
check("the hero choice itself ignores arrival order",
      cd.arrange_deck(list(reversed(TWO_BOTH)), {})[1].get("musketeer") == "hero")
check("the pricier both-form card takes the hero slot",
      once_a.get("musketeer") == "hero" and once_a.get("knight") == "evolution",
      f"got {once_a}")


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


# ── the art files themselves ────────────────────────────────────────────────
#
# Deciding a card should draw its evolution is worthless if the file behind it
# is a copy of the base card. That is not a hypothetical: the Cards screen spent
# its whole life drawing base art for the evolution list, and the report that
# came back was "the evolution and the normal card look the same" — which was
# true, and was a wiring bug rather than an art one. These checks pin the other
# half, so a future asset drop that copies the wrong PNG in fails here.
#
# Byte comparison, deliberately. Measuring perceptual difference needs Pillow
# and this suite is stdlib-only by design; a duplicated file is what actually
# happens, and identical bytes catch it. (Measured once with Pillow at 32x32:
# the closest form pair differs by 45.5 of 255 mean channel difference, so
# nothing here is near-identical either.)

print("\nthe art on disk")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ART = os.path.join(_ROOT, "public", "assets")


def _digests(kind):
    d = os.path.join(_ART, kind)
    if not os.path.isdir(d):
        return {}
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".png"):
            with open(os.path.join(d, f), "rb") as fh:
                out[f[:-4]] = hashlib.sha256(fh.read()).hexdigest()
    return out


cards = _digests("cards")
evos = _digests("evolutions")
heroes = _digests("heroes")

check("the base card art is all present", len(cards) >= 122, f"{len(cards)} files")
check("every evolution has a card behind it",
      set(evos) <= set(cards), str(sorted(set(evos) - set(cards))))
check("every hero has a card behind it",
      set(heroes) <= set(cards), str(sorted(set(heroes) - set(cards))))

same_evo = [k for k, h in evos.items() if cards.get(k) == h]
check("no evolution file is a copy of its base card", not same_evo, str(same_evo))

same_hero = [k for k, h in heroes.items() if cards.get(k) == h]
check("no hero file is a copy of its base card", not same_hero, str(same_hero))

# The four that have both. This is the pair most likely to be mixed up, because
# a card with two special forms is the only place one wrong copy is invisible.
dual = sorted(set(evos) & set(heroes))
check("exactly the four dual-form cards carry both",
      dual == ["knight", "musketeer", "valkyrie", "wizard"], str(dual))
check("and none of them uses one file for both forms",
      all(evos[k] != heroes[k] for k in dual),
      str([k for k in dual if evos[k] == heroes[k]]))


# -- a copyDeck link's order IS the answer -----------------------------------
#
# The bug, reported from a real paste: a Goblin Barrel / Valkyrie / Princess
# list came back with GOBLINS in the hero slot and Valkyrie drawn as an
# evolution. Nothing was missing and no card was wrong -- the deck simply
# rendered as a different deck, because `arrange_deck` rebuilt the special
# slots from what each card is CAPABLE of and Goblins can be a hero.
#
# A copyDeck link writes the three special slots first, in slot order, so for
# that one source the order is not incidental. `trust_order=True` reads the art
# off the positions instead of re-deriving them.

print(chr(10) + "a pasted link's slot order")

LINK = ["goblin-barrel", "valkyrie", "princess", "rocket",
        "goblins", "goblin-hut", "ice-spirit", "the-log"]

order, art = cd.arrange_deck(LINK, {}, trust_order=True)
check("the cards stay exactly where the link put them", order == LINK, str(order[:3]))
check("slot 1 draws its evolution", art.get("goblin-barrel") == "evolution", str(art))
check("slot 2 draws the HERO the player chose, not a card that merely could be",
      art.get("valkyrie") == "hero", str(art))
check("slot 3 draws its evolution", art.get("princess") == "evolution", str(art))
check("and nothing else is given art", len(art) == 3, str(art))
check("Goblins is left plain even though it can be a hero", "goblins" not in art)

# What the rebuild does with the same list, i.e. the bug.
_, rebuilt = cd.arrange_deck(LINK, {})
check("the capability rebuild really does disagree", rebuilt != art, str(rebuilt))
check("it is the one that put Goblins in the hero slot",
      rebuilt.get("goblins") == "hero", str(rebuilt))

# Slot 3 is the one a link cannot settle.
BOTH = ["cannon", "skeletons", "valkyrie", "hog-rider",
        "fireball", "the-log", "ice-spirit", "musketeer"]
check("slot 3 defaults to evolution when the card has both forms",
      cd.arrange_deck(BOTH, {}, trust_order=True)[1].get("valkyrie") == "evolution")
check("and the caller can say hero instead",
      cd.arrange_deck(BOTH, {}, trust_order=True, wild="hero")[1].get("valkyrie") == "hero")
check("the override cannot invent a form the card does not have",
      cd.arrange_deck(LINK, {}, trust_order=True, wild="hero")[1].get("princess") == "evolution",
      "Princess has no hero form, so asking for one changes nothing")
# THE LINK OUTRANKS POOLED MARKS. `marks` is aggregated over everyone who has
# played these eight cards; the link is the deck the person in front of you
# built. When they disagree the link is the better authority about THIS copy.
#
# The case that forced it: a Battle Ram / Wizard / Elite Barbarians link came
# back with Elite Barbarians in the MIDDLE and Wizard third, because the pooled
# marks called Wizard an evolution rather than the hero this player had put in
# slot 2 — two evolutions and no hero leaves slot 2 to be filled from the rest.
BR = ["battle-ram", "wizard", "elite-barbarians", "giant-skeleton",
      "mother-witch", "vines", "zappies", "barbarian-barrel"]
POOLED = {"battle-ram": "evolution", "wizard": "evolution"}

o, a = cd.arrange_deck(BR, POOLED, trust_order=True)
check("a pasted link keeps its own slot order, marks or no marks",
      o[:3] == ["battle-ram", "wizard", "elite-barbarians"], str(o[:3]))
check("so the card the player put in slot 2 is the hero",
      a.get("wizard") == "hero", str(a))
check("and slot 3 is not displaced into the middle",
      o[1] != "elite-barbarians", str(o[:3]))

# Without trust_order — the meta board, the player screens — marks still win.
o2, a2 = cd.arrange_deck(BR, POOLED)
check("a STORED deck still defers to what was observed",
      a2 == POOLED and o2[:3] != o[:3], f"{o2[:3]} {a2}")

stored = cd.arrange_deck(LINK, {"goblins": "hero", "princess": "evolution"})[1]
check("a STORED deck (no trust_order) is scored on what was seen",
      stored.get("goblins") == "hero" and "valkyrie" not in stored, str(stored))


# The slot-3 override applies on EVERY path, not just the trust-order one.
# It first shipped inside that branch alone, so it worked on a deck nobody had
# played and did nothing on a deck the meta board had marks for -- which is most
# of what people paste. From the outside that is simply a button that does not
# work.

print(chr(10) + "the slot 3 override")

# A link whose slot 3 really is ambiguous: Valkyrie has both forms.
WILD3 = ["cannon", "skeletons", "valkyrie", "hog-rider",
         "fireball", "the-log", "ice-spirit", "musketeer"]
POOLED3 = {"cannon": "evolution", "valkyrie": "evolution"}

o, a = cd.arrange_deck(WILD3, POOLED3, trust_order=True)
check("slot 3 defaults to evolution", o[2] == "valkyrie" and a.get("valkyrie") == "evolution",
      f"{o[:3]} {a}")
o, a = cd.arrange_deck(WILD3, POOLED3, trust_order=True, wild="hero")
check("the player's choice overrides it EVEN WITH pooled marks present",
      a.get("valkyrie") == "hero", f"{o[:3]} {a}")
o, a = cd.arrange_deck(WILD3, POOLED3, trust_order=True, wild="evolution")
check("and switches back", a.get("valkyrie") == "evolution", str(a))

# Also on the stored-deck paths, where marks or capability decide the order.
o, a = cd.arrange_deck(WILD3, POOLED3, wild="hero")
check("the marks path honours it too", a.get(o[2]) == "hero" or o[2] != "valkyrie",
      f"{o[:3]} {a}")
check("it never invents a form the card lacks",
      cd.arrange_deck(["mortar", "skeletons", "hog-rider", "fireball",
                       "the-log", "arrows", "minions", "rocket"],
                      {}, trust_order=True, wild="hero")[1].get("hog-rider") is None)


# ── READING A MARK: THE LEVEL, NOT THE ART STRING ──────────────────────────
#
# `player_evo` stores [card_key, level, art]. Four readers used `art`; measured
# over 60,000 battles it mislabels 9.2% of heroes as evolutions and writes
# 'unknown' over 6.9% of evolutions — 16.1% of all marks wrong or discarded.
# `level` is exact: 1 covers precisely the 42 cards that can evolve, 2 precisely
# the 16 that can be a hero, over 162,919 marks with no exceptions.

print(chr(10) + "reading one player_evo mark")

check("level 1 is an evolution",
      cd.mark_variant(["battle-ram", 1, "evolution"]) == "evolution")
check("level 2 is a hero",
      cd.mark_variant(["wizard", 2, "hero"]) == "hero")

# The two cases that were being got wrong, and they are the whole bug.
check("LEVEL 2 IS A HERO EVEN WHEN art SAYS 'evolution' (9.2% of marks)",
      cd.mark_variant(["wizard", 2, "evolution"]) == "hero",
      str(cd.mark_variant(["wizard", 2, "evolution"])))
check("LEVEL 1 IS AN EVOLUTION EVEN WHEN art SAYS 'unknown' (6.9%)",
      cd.mark_variant(["elite-barbarians", 1, "unknown"]) == "evolution",
      str(cd.mark_variant(["elite-barbarians", 1, "unknown"])))

# Degrade to the old reading rather than to nothing if a level ever stops
# being usable.
check("an unusable level falls back to the art string",
      cd.mark_variant(["knight", None, "hero"]) == "hero")
check("and to nothing when neither says anything",
      cd.mark_variant(["knight", 0, "unknown"]) is None)
check("a malformed mark is not a crash",
      cd.mark_variant([]) is None and cd.mark_variant(None) is None
      and cd.mark_variant(["knight"]) is None)

# The X-Bow Tesla row that surfaced it: three cards marked at ~100%, which is
# one more than the game allows, because the hero was being counted as an
# evolution. Read by level it is two evolutions and a hero.
XBOW = [["tesla", 1, "evolution"], ["knight", 2, "evolution"], ["archers", 1, "evolution"]]
read = {m[0]: cd.mark_variant(m) for m in XBOW}
check("so a deck stops reporting three evolutions",
      sorted(read.values()) == ["evolution", "evolution", "hero"], str(read))
check("and the hero is the card the game puts in slot 2",
      read["knight"] == "hero", str(read))


# ── HOW MANY MARKS SURVIVE, AND WHICH ──────────────────────────────────────
#
# Both art lookups used to cap by POSITION: a mark was dropped unless the card
# sat in the first three entries of the deck's stored order. The cap is right —
# one mark per slot — but the stored order is one player's
# arrangement while the marks are pooled over everyone running those eight
# cards, so it deleted 23 real marks across 21 of the 50 meta decks.
#
# `cap_special_marks` keeps the same cap and decides it on the evidence instead.

print(chr(10) + "capping observed marks to the slots that exist")

check("two evolutions and one hero all survive",
      cd.cap_special_marks([(40, "cannon", "evolution"), (30, "wizard", "hero"),
                            (20, "valkyrie", "evolution")])
      == {"cannon": "evolution", "valkyrie": "evolution", "wizard": "hero"})

# The cap itself, which is the thing the positional filter was there to enforce.
three_evos = cd.cap_special_marks([(10, "a-card", "evolution"), (30, "b-card", "evolution"),
                                   (20, "c-card", "evolution")])
check("a third evolution is dropped", len(three_evos) == cd.MAX_EVOLUTIONS, str(three_evos))
check("and it is the LEAST observed one that goes",
      "a-card" not in three_evos and three_evos.keys() >= {"b-card", "c-card"},
      str(three_evos))

# TWO HEROES ARE LEGAL — slot 2 and slot 3. This cap was MAX_HEROES = 1 for one
# revision and it made evolution / hero / hero undrawable, which is 9.25% of all
# battles: reported as a Lava Hound deck whose slot 3 hero Valkyrie went plain.
two_heroes = cd.cap_special_marks([(5, "x-card", "hero"), (9, "y-card", "hero")])
check("two heroes both survive", two_heroes == {"x-card": "hero", "y-card": "hero"},
      str(two_heroes))
check("a third hero does not",
      len(cd.cap_special_marks([(9, "x-card", "hero"), (8, "y-card", "hero"),
                                (7, "z-card", "hero")])) == cd.MAX_HEROES)

# One evolution and two heroes is the real evolution/hero/hero loadout.
ehh = cd.cap_special_marks([(90, "e-card", "evolution"), (80, "h-card", "hero"),
                            (70, "i-card", "hero")])
check("evolution + hero + hero is kept whole", len(ehh) == 3, str(ehh))
o, a = cd.arrange_deck(["e-card"] * 0 + ["zap", "berserker", "valkyrie", "lava-hound",
                                         "fireball", "tombstone", "skeleton-dragons", "balloon"],
                       {"zap": "evolution", "berserker": "hero", "valkyrie": "hero"})
check("and arrange_deck puts the second hero in SLOT 3",
      o[:3] == ["zap", "berserker", "valkyrie"] and a.get("valkyrie") == "hero", f"{o[:3]} {a}")

# Both forms full is four marks for three slots, so slot 3 is contested.
full = cd.cap_special_marks([(90, "e1", "evolution"), (80, "h1", "hero"),
                             (70, "h2", "hero"), (60, "e2", "evolution")])
check("never more than three marks in total", len(full) == cd.MAX_SPECIAL, str(full))
check("and slot 3 goes to the better-observed contender",
      "h2" in full and "e2" not in full, str(full))
check("the outright owners of slots 1 and 2 are never displaced",
      full.get("e1") == "evolution" and full.get("h1") == "hero", str(full))

check("ties break on the key, so identical evidence renders identically",
      cd.cap_special_marks([(7, "b-card", "evolution"), (7, "a-card", "evolution"),
                            (7, "c-card", "evolution")])
      == {"a-card": "evolution", "b-card": "evolution"})

check("nothing observed, nothing drawn", cd.cap_special_marks([]) == {})

# The regression itself: a card marked far down the stored order is still the
# deck's hero. Berserker at stored position 7 was dropped five separate times.
late = cd.cap_special_marks([(60, "skeleton-barrel", "evolution"), (25, "berserker", "hero")])
check("a mark is kept however late the stored order puts the card",
      late.get("berserker") == "hero", str(late))
# ...and arrange_deck is what actually moves it into the hero slot.
o, a = cd.arrange_deck(["skeleton-barrel", "mortar", "cannon-cart", "fireball",
                        "minions", "rascals", "barbarian-barrel", "berserker"], late)
check("and arrange_deck lifts it into slot 2", o[1] == "berserker" and a.get("berserker") == "hero",
      f"{o[:3]} {a}")
check("the evolution still takes slot 1", o[0] == "skeleton-barrel", str(o[:3]))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
