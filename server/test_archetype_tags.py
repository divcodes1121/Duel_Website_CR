"""test_archetype_tags.py — the names a deck gets inside its family.

    python server/test_archetype_tags.py

Pure: a fixed elixir table, no card data, no database. What is worth testing is
the ORDER of the rules (an MK bait deck that is also cheap is MK Bait), that a
deck no rule names keeps its family's plain name, and that a tag never names a
deck into another family.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import archetype_tags as at

PASS = FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


EL = {
    "mega-knight": 7, "pekka": 7, "giant-skeleton": 6, "battle-ram": 4, "ram-rider": 5,
    "bandit": 3, "royal-ghost": 3, "goblin-barrel": 3, "princess": 3, "rocket": 6,
    "goblin-gang": 3, "inferno-tower": 5, "the-log": 2, "ice-spirit": 1, "knight": 3,
    "valkyrie": 4, "skeleton-barrel": 3, "wall-breakers": 2, "skeletons": 1,
    "hog-rider": 4, "cannon": 3, "musketeer": 4, "ice-golem": 2, "fireball": 4,
    "earthquake": 3, "executioner": 5, "tornado": 3, "mortar": 4, "giant": 5,
    "graveyard": 5, "freeze": 4, "poison": 4, "baby-dragon": 4, "ice-wizard": 3,
    "golem": 8, "night-witch": 4, "elixir-collector": 6, "lava-hound": 7, "balloon": 5,
    "miner": 3, "zap": 2, "arrows": 3, "dart-goblin": 3, "electro-wizard": 4,
    "minion-giant": 4, "royal-hogs": 5, "goblin-hut": 4, "furnace": 4, "barbarian-barrel": 2,
    "x-bow": 6, "tesla": 4, "archers": 3, "spear-goblins": 2,
}
el = lambda k: EL.get(k, 3)  # noqa: E731


def label(cards, family, other=None):
    return at.tag(cards, family, el, other)["label"]


print("\nbridge spam is named by its tank")
check("Mega Knight", label(["battle-ram", "mega-knight", "bandit", "royal-ghost", "zap", "fireball", "electro-wizard", "the-log"], "bridge-spam") == "MK Bridge Spam")
check("P.E.K.K.A", label(["battle-ram", "pekka", "bandit", "royal-ghost", "zap", "fireball", "electro-wizard", "the-log"], "bridge-spam") == "P.E.K.K.A Bridge Spam")
check("Giant Skeleton", label(["ram-rider", "giant-skeleton", "bandit", "royal-ghost", "zap", "fireball", "electro-wizard", "the-log"], "bridge-spam") == "Giant Skeleton Bridge Spam")
check("no tank keeps the family name", label(["battle-ram", "bandit", "royal-ghost", "zap", "fireball", "electro-wizard", "the-log", "skeletons"], "bridge-spam") == "Bridge Spam")

print("\nbait")
classic = ["goblin-barrel", "princess", "rocket", "goblin-gang", "inferno-tower", "the-log", "ice-spirit", "knight"]
check("Knight + classic core = Knight Log Bait", label(classic, "bait") == "Knight Log Bait")
mk = ["goblin-barrel", "princess", "mega-knight", "goblin-gang", "the-log", "ice-spirit", "skeletons", "wall-breakers"]
check("Mega Knight wins over cheap", label(mk, "bait") == "MK Bait")
check("Valkyrie + Goblin Barrel = Hyper Bait", label(["goblin-barrel", "valkyrie", "princess", "goblin-gang", "the-log", "ice-spirit", "rocket", "inferno-tower"], "bait") == "Hyper Bait")
cheap = ["goblin-barrel", "skeleton-barrel", "wall-breakers", "princess", "the-log", "ice-spirit", "skeletons", "spear-goblins"]
check("very cheap with Skeleton Barrel = Hyper Bait", at.avg_elixir(cheap, el) <= 2.9 and label(cheap, "bait") == "Hyper Bait")
check("Mortar with a barrel = Mortar Bait", label(["mortar", "goblin-barrel", "princess", "the-log", "ice-spirit", "skeletons", "archers", "rocket"], "bait") == "Mortar Bait")
check("Hog with a barrel = Hog Bait", label(["hog-rider", "goblin-barrel", "princess", "the-log", "ice-spirit", "inferno-tower", "rocket", "goblin-gang"], "bait") == "Hog Bait")
check("plain classic without Knight = Log Bait", label(["goblin-barrel", "princess", "rocket", "goblin-gang", "inferno-tower", "the-log", "ice-spirit", "dart-goblin"], "bait") == "Log Bait")

print("\nhog, graveyard, golem, miner")
check("Hog 2.6", label(["hog-rider", "cannon", "musketeer", "ice-golem", "fireball", "the-log", "ice-spirit", "skeletons"], "hog") == "Hog 2.6")
check("Hog EQ", label(["hog-rider", "earthquake", "valkyrie", "the-log", "ice-spirit", "skeletons", "musketeer", "tesla"], "hog") == "Hog EQ")
check("Hog Exe Nado", label(["hog-rider", "executioner", "tornado", "the-log", "ice-spirit", "rocket", "valkyrie", "tesla"], "hog") == "Hog Exe Nado")
check("Graveyard Freeze", label(["graveyard", "freeze", "poison", "baby-dragon", "ice-wizard", "knight", "tornado", "barbarian-barrel"], "graveyard") == "Graveyard Freeze")
check("Graveyard Poison", label(["graveyard", "poison", "ice-wizard", "goblin-hut", "furnace", "knight", "skeletons", "barbarian-barrel"], "graveyard") == "Graveyard Poison")
check("Golem Night Witch before pump", label(["golem", "night-witch", "elixir-collector", "baby-dragon", "tornado", "lightning", "barbarian-barrel", "zap"], "golem") == "Golem Night Witch")
check("Golem Pump", label(["golem", "elixir-collector", "baby-dragon", "tornado", "lightning", "barbarian-barrel", "zap", "arrows"], "golem") == "Golem Pump")
check("Miner Loon", label(["miner", "balloon", "zap", "arrows", "electro-wizard", "the-log", "ice-spirit", "skeletons"], "miner") == "Miner Loon")

print("\nfallbacks and keys")
t = at.tag(["minion-giant", "zap"], "other", el, "Minion Giant")
check("an 'other' deck takes the win-condition name", t["label"] == "Minion Giant" and t["key"] == "other:minion-giant" and not t["named"])
t = at.tag(classic, "bait", el)
check("a key is family:slug", t["key"] == "bait:knight-log-bait" and t["family"] == "bait" and t["named"])
check("the same name in two families gets two keys",
      at.tag(["mortar", "goblin-barrel", "princess", "the-log"], "bait", el)["key"] !=
      at.tag(["mortar", "princess", "the-log", "skeletons"], "mortar", el)["key"])
check("an empty deck keeps the family name", at.tag([], "hog", el)["label"] == "Hog Rider")
check("an unknown family keeps its key as the name", at.tag(["x"], "zzz", el)["label"] == "zzz")
check("slug", at.slug("P.E.K.K.A Bridge Spam") == "p-e-k-k-a-bridge-spam")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
