"""test_deck_harmony.py — the composition veto, and `cardRoles.json`'s integrity.

    python server/test_deck_harmony.py

Plain asserts and a counter, matching the other suites here. No database: this
module has no imports beyond card data, which is the whole reason it was split
out — the rules most worth testing exhaustively must be testable without
constructing a connection.

WHAT IS WORTH TESTING, which is the half that would be quietly wrong:

  * A SPELL THAT HITS AIR IS NOT AN AIR ANSWER. Fireball, Lightning, Poison,
    Rocket, Tornado and the spirits all damage air, so a naive `hitsAir` check
    passes a deck whose only answer to a Lava Hound is a one-shot. This is the
    single most important rule in the module and it is the easiest to lose;
  * `cardRoles.json` MUST BE COMPLETE AND CLOSED. 122 keys, every value in a
    known vocabulary, every card in `cards.json` present. A missing card reads
    as "answers nothing" and silently fails every deck containing it;
  * CARDS WITH A SECOND ATTACK PROFILE must be read whole. `goblin-machine`'s
    rocket targets air while its body does not, and `goblinstein` has two
    bodies. Reading only the first profile calls both of them ground-only;
  * AN UNCLASSIFIABLE CARD IS AN UNKNOWN, NOT A PASS. `spirit-empress`'s
    targeting is decided by the player's Elixir bar at deployment, so a deck
    list cannot say whether she answers air. Passing a deck containing her
    would assert a structural fact nothing verified;
  * THE FLAGS COME FROM `cardMeta.json`, not from a second copy in the manual.
    Two sources of one fact drift, and the drift is invisible;
  * THE VETO IS A REASON, NOT A BOOLEAN. `deck_tuner` drops a swap and the
    reader is owed the sentence.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import deck_harmony as dh

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# A real, balanced Hog cycle list — the shape everything else is measured
# against. Two air answers (musketeer, ice-spirit is a spirit so no — see
# below), splash, a win condition, a small spell, cheap cards.
GOOD = ["hog-rider", "musketeer", "cannon", "ice-golem",
        "skeletons", "the-log", "fireball", "baby-dragon"]


def main() -> int:
    print("cardRoles.json — completeness and closed vocabularies")
    path = os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "src", "data", "cardRoles.json")
    check("cardRoles.json exists", os.path.exists(path), path)
    doc = json.load(open(path, encoding="utf-8"))
    roles = doc["cards"]
    check("it says it is generated, not hand-written",
          "build-card-roles" in doc.get("$comment", ""))
    check("every roster card has an entry",
          set(roles) == set(dh.CARDS), str(set(dh.CARDS) ^ set(roles)))
    check("there are 122 of them", len(roles) == 122, str(len(roles)))

    VOCAB = {
        "targets": {"air", "ground", "buildings", "area-effect",
                    "friendly-effect", "inherits", "variable"},
        "transport": {"ground", "air", "none", "variable", "inherits"},
        "damage": {"single", "area", "multi", "chip", "none", "inherits"},
        "range": {"melee", "ranged", "none", "variable", "inherits"},
        "movement": {"very-slow", "slow", "medium", "fast", "very-fast"},
    }
    bad = []
    for k, v in roles.items():
        for t in v["targets"]:
            if t not in VOCAB["targets"]:
                bad.append(f"{k}.targets={t}")
        for f in ("transport", "damage", "range"):
            if v[f] not in VOCAB[f]:
                bad.append(f"{k}.{f}={v[f]}")
        if "movement" in v and v["movement"] not in VOCAB["movement"]:
            bad.append(f"{k}.movement={v['movement']}")
    check("every value is in a closed vocabulary", not bad, str(bad[:6]))
    check("hitsAir is derived from targets, not stored separately",
          all(v["hitsAir"] == ("air" in v["targets"]) for v in roles.values()))

    print("\nthe vocabulary drift the build script folds")
    # The manual was written in batches and drifted: 29 blocks say `splash`
    # where 12 say `area`, and 35 write `air,ground` where 16 write
    # `air-and-ground`. If the fold ever stops happening these collapse.
    check("splash and area were folded to one value",
          sum(1 for v in roles.values() if v["damage"] == "area") == 41,
          str(sum(1 for v in roles.values() if v["damage"] == "area")))
    check("air+ground pairs were folded",
          sum(1 for v in roles.values() if v["hitsAir"]) == 52,
          str(sum(1 for v in roles.values() if v["hitsAir"])))

    print("\ncards with a second attack profile")
    check("goblin-machine's rocket makes it an air answer",
          "air" in roles["goblin-machine"]["targets"],
          "only the ground BODY was read; the rocket targets air")
    check("goblinstein's two bodies are both read",
          "air" in roles["goblinstein"]["targets"]
          and "buildings" in roles["goblinstein"]["targets"],
          str(roles["goblinstein"]["targets"]))
    check("goblin-machine counts as a real air answer",
          dh.answers_air("goblin-machine"))

    print("\nA SPELL THAT HITS AIR IS NOT AN AIR ANSWER")
    for s in ("fireball", "lightning", "poison", "rocket", "tornado",
              "arrows", "zap", "giant-snowball"):
        check(f"{s} hits air but does not answer it",
              roles[s]["hitsAir"] and not dh.answers_air(s),
              f'hitsAir={roles[s]["hitsAir"]} answers={dh.answers_air(s)}')
    check("a real anti-air troop does answer air", dh.answers_air("musketeer"))
    check("a ground-only troop does not", not dh.answers_air("knight"))
    check("the spell rule is what separates the two counts",
          sum(1 for k in roles if dh.answers_air(k))
          < sum(1 for k, v in roles.items() if v["hitsAir"]),
          "the spell exclusion is not being applied")

    print("\nsplash is a troop or building, not a spell")
    check("fireball is not the deck's splash answer", not dh.has_splash("fireball"))
    check("baby-dragon is", dh.has_splash("baby-dragon"))
    check("bomber is", dh.has_splash("bomber"))

    print("\nflags come from cardMeta.json")
    check("hog-rider is a win condition", dh.is_win_condition("hog-rider"))
    check("musketeer is not", not dh.is_win_condition("musketeer"))
    check("suspicious-bush is, at 2 Elixir",
          dh.is_win_condition("suspicious-bush") and dh.CARDS["suspicious-bush"]["elixir"] == 2)
    check("cardRoles.json does NOT carry the flags",
          not any("isWinCondition" in v or "canEvolve" in v for v in roles.values()),
          "a second copy of cardMeta's facts has appeared and will drift")

    print("\na balanced deck passes")
    r = dh.check(GOOD)
    check("the reference deck passes", r["ok"], str(r["problems"] + r["unknowns"]))
    check("it reports its air answers", r["counts"]["airAnswers"] >= dh.MIN_AIR,
          str(r["counts"]))
    check("it reports its win condition",
          r["counts"]["winConditionCards"] == ["hog-rider"],
          str(r["counts"]["winConditionCards"]))
    check("it is marked fully checked", r["checked"] is True)
    check("veto() allows it", dh.veto(GOOD) is None, str(dh.veto(GOOD)))

    print("\nthe checks fire, one at a time")
    # Strip the air answers: musketeer -> knight, baby-dragon -> valkyrie.
    no_air = ["hog-rider", "knight", "cannon", "ice-golem",
              "skeletons", "the-log", "fireball", "valkyrie"]
    ra = dh.check(no_air)
    check("a deck with no air answer fails", not ra["ok"])
    check("...and the reason names air",
          any("air answer" in p for p in ra["problems"]), str(ra["problems"]))
    check("...and says a spell does not count",
          any("spell that hits air" in p for p in ra["problems"]),
          str(ra["problems"]))

    no_wincon = ["musketeer", "knight", "cannon", "ice-golem",
                 "skeletons", "the-log", "fireball", "baby-dragon"]
    rw = dh.check(no_wincon)
    check("a deck with no win condition fails", not rw["ok"])
    check("...and the reason says so",
          any("win condition" in p for p in rw["problems"]), str(rw["problems"]))

    dup = GOOD[:-1] + ["musketeer"]
    rd = dh.check(dup)
    check("a duplicated card fails", not rd["ok"], str(rd["problems"]))
    check("...and the reason mentions duplicates",
          any("duplicate" in p for p in rd["problems"]), str(rd["problems"]))

    rn = dh.check(GOOD[:-1] + ["not-a-real-card"])
    check("an unknown card fails", not rn["ok"])
    check("...and is named", any("not a card" in p for p in rn["problems"]),
          str(rn["problems"]))
    check("...and no further checks are claimed", rn["checked"] is False)

    heavy = ["golem", "pekka", "mega-knight", "electro-giant",
             "sparky", "three-musketeers", "lightning", "rocket"]
    rh = dh.check(heavy)
    check("an absurdly expensive deck fails the band", not rh["ok"])
    check("...on average Elixir",
          any("average Elixir" in p for p in rh["problems"]), str(rh["problems"]))

    print("\nan unclassifiable card is an UNKNOWN, not a pass")
    se = ["hog-rider", "musketeer", "cannon", "spirit-empress",
          "skeletons", "the-log", "fireball", "baby-dragon"]
    rs = dh.check(se)
    check("a deck with spirit-empress is not passed", not rs["ok"])
    check("...it is reported as an unknown, not a problem",
          rs["unknowns"] and not any("spirit-empress" in p for p in rs["problems"]),
          str(rs))
    check("...and the reason explains why she cannot be classified",
          any("Elixir bar" in u for u in rs["unknowns"]), str(rs["unknowns"]))
    check("...and the deck is marked NOT fully checked", rs["checked"] is False)
    check("mirror is the other special case", "mirror" in dh.SPECIAL)

    print("\nTHE VETO MUST PASS DECKS PEOPLE ACTUALLY PLAY")
    # THE MOST IMPORTANT CHECK IN THIS FILE. Every threshold above is a guess
    # until it is measured against real lists, and two of them were WRONG when
    # this was first run:
    #
    #   Mortar Cycle failed at 2.50 average Elixir against a 2.60 floor. Real
    #   cycle decks go that low; the floor was wrong and is now 2.40.
    #
    #   X-Bow 2.9 failed for having no splash TROOP. It genuinely has none —
    #   Tesla, The Log and Fireball are the whole plan — so requiring one
    #   refused a deck people win with. Anti-swarm now counts spells, and the
    #   missing splash troop is a NOTE instead.
    #
    # A checklist that rejects the meta is not a checklist, it is a bug. If
    # this block ever fails, suspect the thresholds before the decks.
    REAL = {
        "Hog 2.6": ["hog-rider", "musketeer", "cannon", "ice-golem",
                    "skeletons", "the-log", "fireball", "ice-spirit"],
        "LavaLoon": ["lava-hound", "balloon", "mega-minion", "guards",
                     "tombstone", "arrows", "fireball", "skeleton-dragons"],
        "Golem NW": ["golem", "night-witch", "baby-dragon", "mega-minion",
                     "tombstone", "lightning", "barbarian-barrel", "electro-dragon"],
        "XBow 3.0": ["x-bow", "tesla", "archers", "knight",
                     "the-log", "fireball", "ice-spirit", "skeletons"],
        "XBow 2.9": ["x-bow", "tesla", "archers", "knight",
                     "the-log", "fireball", "skeletons", "ice-golem"],
        "Miner Poison": ["miner", "poison", "bats", "skeletons",
                         "the-log", "valkyrie", "musketeer", "inferno-tower"],
        "Graveyard": ["graveyard", "poison", "knight", "bats",
                      "tornado", "baby-dragon", "barbarian-barrel", "tombstone"],
        "PEKKA BS": ["pekka", "battle-ram", "bandit", "electro-wizard",
                     "royal-ghost", "zap", "poison", "magic-archer"],
        "RG Fisher": ["royal-giant", "fisherman", "hunter", "electro-wizard",
                      "barbarian-barrel", "lightning", "mother-witch", "phoenix"],
        "Log Bait": ["goblin-barrel", "princess", "goblin-gang", "knight",
                     "inferno-tower", "the-log", "rocket", "ice-spirit"],
        "Mortar Cycle": ["mortar", "knight", "archers", "skeletons",
                         "ice-spirit", "the-log", "fireball", "bomber"],
        "Splashyard": ["graveyard", "freeze", "ice-wizard", "baby-dragon",
                       "bowler", "tornado", "barbarian-barrel", "knight"],
    }
    for name, deck in REAL.items():
        res = dh.check(deck)
        check("real meta deck passes: %s" % name, res["ok"],
              "; ".join(res["problems"] + res["unknowns"])
              + "  (suspect the threshold, not the deck)")

    check("all twelve are eight distinct cards",
          all(len(set(d)) == 8 for d in REAL.values()))
    check("XBow 2.9 passes but is NOTED for having no splash troop",
          dh.check(REAL["XBow 2.9"])["ok"]
          and any("splash troop" in n for n in dh.check(REAL["XBow 2.9"])["notes"]),
          str(dh.check(REAL["XBow 2.9"])["notes"]))
    check("Mortar Cycle sits below the old 2.60 floor",
          dh.check(REAL["Mortar Cycle"])["counts"]["avgElixir"] < 2.6,
          "the deck that moved the floor no longer tests it")
    check("a note is not a problem",
          all(not dh.check(d)["problems"] for d in REAL.values()))

    print("\nthe veto is a sentence")
    v = dh.veto(no_air)
    check("veto returns a reason string", isinstance(v, str) and len(v) > 10, str(v))
    check("veto returns None for a good deck", dh.veto(GOOD) is None)

    print("\nthresholds are stated, not hidden")
    check("two air answers, not one", dh.MIN_AIR == 2)
    check("the Elixir band is wide enough for siege and beatdown",
          dh.MIN_AVG_ELIXIR <= 2.7 and dh.MAX_AVG_ELIXIR >= 4.5,
          f"{dh.MIN_AVG_ELIXIR}-{dh.MAX_AVG_ELIXIR}")
    check("avg_elixir is arithmetic",
          dh.avg_elixir(["skeletons", "skeletons"]) == 1.0,
          str(dh.avg_elixir(["skeletons", "skeletons"])))
    check("an empty deck does not divide by zero", dh.avg_elixir([]) == 0.0)

    print("\nit plugs into the tuner")
    import deck_tuner as tuner
    check("veto has the signature rank() expects",
          tuner.rank.__defaults__ is not None and callable(dh.veto))

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
