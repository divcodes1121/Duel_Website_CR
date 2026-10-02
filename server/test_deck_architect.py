"""test_deck_architect.py — building a deck around a card the way duel players do.

    python server/test_deck_architect.py

No database. The corpus is literal lists shaped like `duel_index.decks_holding`
returns them, modelled on what the real one holds for Graveyard: two ways of
playing the card, each a core its pilots agree on plus slots they vary.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deck_architect as arch  # noqa: E402

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


def L(cards, games, wins=None, players=None, **kw):
    cards = cards.split() if isinstance(cards, str) else list(cards)
    row = {"cards": cards, "games": games, "wins": games // 2 if wins is None else wins,
           "players": games if players is None else players}
    row.update(kw)
    return row


# Splashyard: core graveyard poison baby-dragon ice-wizard knight barrel tornado;
# the eighth card is what its pilots vary.
SPLASH = "graveyard poison baby-dragon ice-wizard knight barbarian-barrel tornado"
# Giant Graveyard: core graveyard giant bowler giant-snowball arrows; three open.
GIANT = "graveyard giant bowler giant-snowball arrows"
CORPUS = [
    L(SPLASH + " tombstone", 600, 320),
    L(SPLASH + " goblin-cage", 200, 110),
    L(SPLASH + " valkyrie", 100, 50),
    L(SPLASH + " bats", 12, 6),
    L(GIANT + " witch minions mini-pekka", 300, 180),
    L(GIANT + " witch minions guards", 80, 44),
    L(GIANT + " witch guards musketeer", 150, 90),
    L(GIANT + " night-witch guards musketeer", 60, 30),
    L(GIANT + " witch mini-pekka zappies", 40, 22),
    # One player's pet list, fielded 400 times by nobody else.
    L("graveyard royal-giant fisherman hunter lightning skeletons electro-spirit monk", 400, 300, players=1),
    L("graveyard royal-giant fisherman hunter lightning skeletons electro-spirit ronin", 3, 1, players=1),
]

# ── What a list weighs ──────────────────────────────────────────────────────
print("\nwhat a list weighs")
check("its duel games", arch.weight(L(SPLASH + " tombstone", 40)) == 40)
check("capped per pilot: one player's 400 games count ten",
      arch.weight(L("a b c d e f g h", 400, players=1)) == arch.PILOT_CAP == 10)
check("…and thirty pilots' 400 games count three hundred",
      arch.weight(L("a b c d e f g h", 400, players=30)) == 300)
check("a list with no duel record weighs what the caller says", arch.weight({"cards": [], "w": 10.0}) == 10.0)
check("never negative", arch.weight({"cards": [], "w": -3}) == 0.0 and arch.weight({"cards": []}) == 0.0)

# ── The ways people play the card ───────────────────────────────────────────
print("\nshells")
sh = arch.shells(CORPUS, ["graveyard"])
check("two ways of playing Graveyard are found", len(sh) == 2, str([s["rep"] for s in sh]))
check("the heaviest comes first, led by its most-played list",
      set(sh[0]["rep"]) == set((SPLASH + " tombstone").split()), str(sh[0]["rep"]))
check("tech variants join the shell they vary", sh[0]["n"] == 4 and sh[1]["n"] == 5, str([s["n"] for s in sh]))
check("a shell's real duel record is summed", sh[0]["games"] == 912 and sh[0]["wins"] == 486,
      str((sh[0]["games"], sh[0]["wins"])))
check("the named card is in every game of every shell", all(s["freq"]["graveyard"] == 1.0 for s in sh))
check("a core card is run in nearly every game; a flex card in a share of them",
      sh[0]["freq"]["poison"] == 1.0 and 0.6 < sh[0]["freq"]["tombstone"] < 0.7
      and abs(sh[0]["freq"]["goblin-cage"] - 200 / 912) < 1e-9, str(sh[0]["freq"]))
check("one player's pet list is not a way people play the card (weight capped, too few lists)",
      all("royal-giant" not in s["rep"] for s in sh))
check("too few lists is not a shell, whatever they weigh",
      arch.shells([L(SPLASH + " tombstone", 500), L(SPLASH + " valkyrie", 300)], ["graveyard"]) == [])
check("too little play is not a shell, however many lists",
      arch.shells([L(SPLASH + f" x{i}", 2) for i in range(6)], ["graveyard"]) == [])
check("nothing in, nothing out", arch.shells([], ["graveyard"]) == [] and arch.shells(None) == [])
check("with more cards named, lists must share more to be one shell",
      arch.shell_overlap(["a"]) == 5 and arch.shell_overlap(["a", "b", "c"]) == 6
      and arch.shell_overlap(["a", "b", "c", "d"]) == 7)
own = arch.shells(CORPUS + [{"cards": (GIANT + " witch minions mini-pekka").split(), "w": 30.0}], ["graveyard"])
check("a ladder or own list adds weight but no duel record",
      own[1]["weight"] == sh[1]["weight"] + 30.0 and own[1]["games"] == sh[1]["games"])
check("…and the same list handed in twice is still ONE list",
      own[1]["n"] == sh[1]["n"])
twice = [L(SPLASH + " tombstone", 500), L(SPLASH + " valkyrie", 300),
         {"cards": (SPLASH + " tombstone").split(), "w": 30.0}]
check("so a duplicate cannot make two lists look like the three a shell needs",
      arch.shells(twice, ["graveyard"]) == [])

# ── The core and the open slots ─────────────────────────────────────────────
print("\ncore and flex")
splash, giant = sh
core = arch.core_of(splash, ["graveyard"])
check("the named card leads the core", core[0] == "graveyard")
check("the core is the cards 70%+ of the shell runs, at most seven",
      set(core) == set(SPLASH.split()) and len(core) == arch.CORE_MAX == 7, str(core))
gcore = arch.core_of(giant, ["graveyard"])
check("Giant Graveyard's core is its five agreed cards plus Witch (90%); Minions (60%) is not",
      set(gcore) == set(GIANT.split()) | {"witch"}, str(gcore))
check("a card under the core share is never core", "minions" not in gcore and "guards" not in gcore)
check("a card already spent this duel is never core",
      "poison" not in arch.core_of(splash, ["graveyard"], used={"poison"}))
check("named cards are core even when the shell rarely runs them",
      arch.core_of(splash, ["graveyard", "bats"])[:2] == ["graveyard", "bats"])
pool = arch.flex_pool(giant, gcore)
check("the flex pool is what the shell's pilots rotate through, most-run first",
      pool[:3] == ["minions", "mini-pekka", "guards"] and "zappies" in pool, str(pool))
check("no core card and no spent card is flex",
      not (set(pool) & set(gcore)) and "guards" not in arch.flex_pool(giant, gcore, used={"guards"}))
rare = arch.shells(CORPUS + [L(GIANT + " witch minions rage", 1, players=1)], ["graveyard"])[1]
check("a card under the flex share is not offered",
      "rage" not in arch.flex_pool(rare, arch.core_of(rare, ["graveyard"])))

# ── Filling the open slots ──────────────────────────────────────────────────
print("\nfilling the open slots")
plain = arch.assemble(giant, ["graveyard"])
check("with no model, the shell's own consensus fills them",
      plain and set(plain[0]["flex"]) == {"minions", "mini-pekka"} and plain[0]["tuned"] == []
      and plain[0]["fast"] is None, str(plain[:1]))
check("a built deck is eight distinct cards holding the named one",
      all(len(set(b["cards"])) == 8 and "graveyard" in b["cards"] for b in plain))
check("every card of it is one the shell's pilots run",
      all(set(b["cards"]) <= set(giant["freq"]) for b in plain))
check("at most PER_SHELL fills, and they are different decks",
      len(plain) <= arch.PER_SHELL and all(
          len(set(a["cards"]) & set(b["cards"])) < arch.SAME_BUILD
          for i, a in enumerate(plain) for b in plain[i + 1:]))

# The opponent makes Zappies worth 12 points and Minions worth nothing.
vs = {"zappies": 12.0}
score = lambda cards: 45.0 + sum(vs.get(c, 0.0) for c in cards)
tuned = arch.assemble(giant, ["graveyard"], score=score)
check("a card worth it against THIS opponent takes a slot from a staple",
      "zappies" in tuned[0]["flex"] and tuned[0]["tuned"] == ["zappies"], str(tuned[0]))
check("the core is not touched by the opponent", tuned[0]["core"] == gcore)
check("the model's figure and what it was chosen on are both reported",
      tuned[0]["fast"] == 57.0 and tuned[0]["value"] > 57.0)
weak = arch.assemble(giant, ["graveyard"], score=lambda c: 45.0 + (1.0 if "zappies" in c else 0.0))
check("a rare card worth one point does NOT displace a staple (the prior)",
      "zappies" not in weak[0]["flex"], str(weak[0]["flex"]))
check("the prior is PRIOR_POINTS for a card every game runs", arch.PRIOR_POINTS == 10.0)

no_guards = arch.assemble(giant, ["graveyard"], allow=lambda cards: "guards" not in cards)
check("a fill the structural gate refuses is not offered",
      no_guards and all("guards" not in b["cards"] for b in no_guards))
check("if the gate refuses every fill, nothing is built",
      arch.assemble(giant, ["graveyard"], allow=lambda cards: False) == [])
spent = arch.assemble(giant, ["graveyard"], used={"minions", "bowler"})
check("no built deck holds a card already spent this duel",
      spent and all(not ({"minions", "bowler"} & set(b["cards"])) for b in spent), str(spent[:1]))
near = plain[0]["nearest"]
check("a fill that IS a real list says so: all eight shared, and that list's own duel record",
      near["shared"] == 8 and near["games"] == 300 and near["wins"] == 180, str(near))
check("among equally close real lists, the most-played is the one named",
      tuned[0]["nearest"]["shared"] == 7 and tuned[0]["nearest"]["games"] == 300, str(tuned[0]["nearest"]))
novel = arch.assemble(giant, ["graveyard"], score=lambda c: 45.0 + 20.0 * ("zappies" in c) + 20.0 * ("musketeer" in c))
check("a fill nobody has fielded as listed reports the nearest real list, not a made-up record",
      novel[0]["nearest"]["shared"] == 7 and set(novel[0]["flex"]) == {"zappies", "musketeer"}, str(novel[0]))
check("identical evidence builds identical decks",
      arch.assemble(giant, ["graveyard"], score=score) == arch.assemble(giant, ["graveyard"], score=score))

# ── The whole build ─────────────────────────────────────────────────────────
print("\nthe whole build")
built = arch.build(CORPUS, ["graveyard"], score=score)
check("each way of playing the card gets its best fill before any gets a second",
      [b["shell"]["rank"] for b in built[:2]] in ([0, 1], [1, 0]), str([b["shell"]["rank"] for b in built]))
check("every build carries what its shell rests on",
      all(b["shell"]["decks"] >= arch.SHELL_MIN_DECKS and b["shell"]["games"] > 0 for b in built))
check("no two builds are one deck",
      all(len(set(a["cards"]) & set(b["cards"])) < arch.SAME_BUILD
          for i, a in enumerate(built) for b in built[i + 1:]))
check("never more than LIMIT", len(arch.build(CORPUS, ["graveyard"], limit=1)) == 1)
check("a card nobody builds around builds nothing", arch.build([], ["graveyard"]) == [])
check("two named cards nobody plays together build nothing",
      arch.build([d for d in CORPUS if {"graveyard", "x-bow"} <= set(d["cards"])], ["graveyard", "x-bow"]) == [])
both = arch.build([d for d in CORPUS if {"graveyard", "giant"} <= set(d["cards"])], ["graveyard", "giant"])
check("two named cards people DO play together build from those lists",
      both and all({"graveyard", "giant"} <= set(b["cards"]) for b in both))

print("\nnothing here reads a database or the network")
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
