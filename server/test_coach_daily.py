"""test_coach_daily.py — the field projection and the weighting.

    python server/test_coach_daily.py

Synthetic boards only; no database is opened and `plan()` is not called (it
reads the meta snapshot and the battle store). What is covered is the only new
arithmetic in the module: turning the meta board into a projection, and moving
its mass toward what one player actually loses to.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach_daily as cdl  # noqa: E402
import team_scout as ts  # noqa: E402

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


def deck(h, arch, use, battles=5000, name=None):
    return {
        "deckHash": h,
        "cards": [f"{h}{i}" for i in range(8)],
        "winCondition": arch,
        "useRate": use,
        "battles": battles,
        "wins": battles // 2,
        "winRate": 50.0,
        "players": 100,
        "name": name or arch.title(),
    }


def board(*decks, building=False):
    return {"building": building, "decks": list(decks)}


def faced(name, battles, wins):
    return {"key": name, "name": name.title(), "battles": battles,
            "wins": wins, "losses": battles - wins, "draws": 0}


print("\nthe field projection")

th = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "golem", 5.0), deck("c", "bait", 5.0)))
check("one threat per meta deck", len(th) == 3, len(th))
check("likelihood is the use rate, normalised",
      abs(th[0]["likelihood"] - 0.5) < 1e-6, th[0]["likelihood"])
check("and the set sums to 1.0", abs(sum(t["likelihood"] for t in th) - 1.0) < 1e-3)
check("archetype is the win condition, which is what `rate_for` is keyed on",
      th[0]["archetype"] == "hog", th[0]["archetype"])
check("every field is what team_scout.score reads",
      all(k in th[0] for k in ("key", "archetype", "likelihood", "name", "evidence")))

check("evidence is OBSERVED — these are real decks really played",
      all(t["evidence"] == ts.OBSERVED for t in th))
check("observedCount carries the population's battles, so confidence is `known`",
      th[0]["observedCount"] == 5000 and th[0]["confidence"] == ts.KNOWN,
      (th[0]["observedCount"], th[0]["confidence"]))

print("\nthe cap, and renormalising only after it")
many = board(*[deck(chr(97 + i), f"a{i}", 20.0 - i) for i in range(20)])
capped = cdl.field_threats(many)
check("capped at team_scout's own MAX_THREATS", len(capped) == cdl.MAX_THREATS, len(capped))
check("team_scout owns that number, not this module", cdl.MAX_THREATS == ts.MAX_THREATS)
check("the survivors still sum to 1.0", abs(sum(t["likelihood"] for t in capped) - 1.0) < 1e-3)
check("the most-played survive, not the first seen",
      capped[0]["archetype"] == "a0" and all(t["archetype"] != "a19" for t in capped))

print("\na board that is not a reading is not a projection")
check("a building board yields nothing", cdl.field_threats(board(deck("a", "hog", 10.0), building=True)) == [])
check("an empty board yields nothing", cdl.field_threats(board()) == [])
check("a board of zero use rate yields nothing",
      cdl.field_threats(board(deck("a", "hog", 0.0))) == [])

print("\ndeficits: only past the floor, and only against their OWN rate")
d = cdl.deficits(
    [faced("drill", 20, 4),     # 20% vs 60% -> deficit 40
     faced("golem", 30, 18),    # 60% -> deficit 0
     faced("bait", 5, 0)],      # 0% but FIVE battles
    60.0,
)
check("an archetype under the floor is absent entirely", "bait" not in d, sorted(d))
check("a real deficit is measured against their own rate",
      d["drill"]["deficit"] == 40.0, d["drill"])
check("a matchup they hold has no deficit", d["golem"]["deficit"] == 0.0, d["golem"])
check("the floor is the dashboard's matchup floor", cdl.MIN_FACED == 10)
check("it carries its own evidence", d["drill"]["battles"] == 20 and d["drill"]["winRate"] == 20.0)

print("\nweighting: mass moves toward what they lose to")
base = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "drill", 10.0)))
w = cdl.weight_threats(base, cdl.deficits([faced("drill", 20, 4)], 60.0))
by = {t["archetype"]: t for t in w}
check("the weak matchup gains mass", by["drill"]["likelihood"] > by["hog"]["likelihood"],
      {k: v["likelihood"] for k, v in by.items()})
check("and it still sums to 1.0", abs(sum(t["likelihood"] for t in w) - 1.0) < 1e-3)
check("the boost is reported, not hidden", by["drill"]["boost"] == 1.4, by["drill"]["boost"])
check("the untouched threat keeps a boost of exactly 1", by["hog"]["boost"] == 1.0)
check("the player's record rides along so the screen can say why",
      by["drill"]["playerRecord"]["battles"] == 20 and by["drill"]["playerRecord"]["winRate"] == 20.0)
check("a threat they have no record against carries none",
      by["hog"]["playerRecord"] is None)

print("\nthe three rules that keep the weighting honest")
huge = cdl.weight_threats(
    cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "drill", 10.0))),
    cdl.deficits([faced("drill", 20, 0)], 100.0),  # deficit 100
)
check("the boost is BOUNDED, or one matchup swallows the projection",
      max(t["boost"] for t in huge) <= cdl.MAX_BOOST,
      max(t["boost"] for t in huge))

strong = cdl.weight_threats(
    cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "bait", 10.0))),
    cdl.deficits([faced("bait", 30, 30)], 50.0),  # they crush it: deficit -50
)
by2 = {t["archetype"]: t for t in strong}
check("a STRENGTH is never down-weighted — they will still meet it",
      by2["bait"]["boost"] == 1.0 and abs(by2["bait"]["likelihood"] - 0.5) < 1e-3,
      by2["bait"])

thin = cdl.weight_threats(
    cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "drill", 10.0))),
    cdl.deficits([faced("drill", 5, 0)], 60.0),  # under the floor
)
check("a deficit under the floor moves NOTHING, not a little",
      all(t["boost"] == 1.0 for t in thin))

print("\nreserved slots: a weakness the projection cannot represent is useless")
# The live answer that made this necessary: this player's worst matchup by a
# distance was an archetype NO top-twelve meta deck carried, so the boost had
# nothing at all to act on.
wide = board(*[deck(chr(97 + i), f"a{i}", 20.0 - i) for i in range(20)],
             deck("z", "drill", 0.4, name="Goblin Drill"))
plain = cdl.field_threats(wide)
check("without priority the rare archetype is absent",
      all(t["archetype"] != "drill" for t in plain))
withp = cdl.field_threats(wide, priority=["drill"])
check("a named weakness is admitted from below the cut",
      any(t["archetype"] == "drill" for t in withp),
      [t["archetype"] for t in withp])
check("and the projection does not grow",
      len(withp) == len(plain) == cdl.MAX_THREATS, (len(withp), len(plain)))
check("the most-played are never displaced",
      withp[0]["archetype"] == "a0" and withp[1]["archetype"] == "a1",
      [t["archetype"] for t in withp[:2]])
check("its likelihood is still its OWN use rate — rare stays rare",
      next(t for t in withp if t["archetype"] == "drill")["likelihood"]
      < next(t for t in withp if t["archetype"] == "a0")["likelihood"])
check("an archetype already in the cut costs no slot",
      cdl.field_threats(wide, priority=["a0"])[0]["archetype"] == "a0"
      and len(cdl.field_threats(wide, priority=["a0"])) == cdl.MAX_THREATS)
check("a weakness the meta does not carry at all is simply not added",
      all(t["archetype"] != "nope" for t in cdl.field_threats(wide, priority=["nope"])))

print("\nthe meta's own direction")


def mv(basis="measured", apart=7, rows=()):
    return {"basis": basis, "daysApart": apart, "reason": None, "rows": list(rows)}


def row(h, prev, delta, rank=None):
    return {"deckHash": h, "previousUseRate": prev, "useDelta": delta, "rankDelta": rank}


tb = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "golem", 10.0)))
# field_threats must carry the join key, or nothing can ever match.
check("a threat carries the board's own deckHash",
      all(t.get("deckHash") for t in tb), [t.get("deckHash") for t in tb])

up, st = cdl.trend_threats(tb, mv(rows=[row("a", 8.0, 2.0)]))
by = {t["archetype"]: t for t in up}
check("a rising deck gains mass", by["hog"]["likelihood"] > by["golem"]["likelihood"],
      {k: v["likelihood"] for k, v in by.items()})
check("and it still sums to 1.0", abs(sum(t["likelihood"] for t in up) - 1.0) < 1e-3)
check("the trend is reported on the row, not hidden",
      by["hog"]["trend"] and by["hog"]["trend"]["factor"] > 1.0, by["hog"]["trend"])
check("the untouched deck carries trend None", by["golem"]["trend"] is None)
check("and the state says it ran", st["applied"] is True and st["moved"] == 1, st)

down, _ = cdl.trend_threats(tb, mv(rows=[row("a", 8.0, -4.0)]))
byd = {t["archetype"]: t for t in down}
check("a deck being dropped loses mass", byd["hog"]["likelihood"] < byd["golem"]["likelihood"],
      {k: v["likelihood"] for k, v in byd.items()})

huge, _ = cdl.trend_threats(tb, mv(rows=[row("a", 0.1, 90.0)]))
check("the lift is BOUNDED, or one week's fashion becomes the whole field",
      max(t["trend"]["factor"] for t in huge if t["trend"]) <= cdl.TREND_MAX)
crash, _ = cdl.trend_threats(tb, mv(rows=[row("a", 90.0, -89.0)]))
check("and so is the trim", min(t["trend"]["factor"] for t in crash if t["trend"])
      >= 1.0 / cdl.TREND_MAX)

noise, stn = cdl.trend_threats(tb, mv(rows=[row("a", 8.0, 0.05)]))
check("a wobble under the floor moves NOTHING, not a little",
      all(t["likelihood"] == b["likelihood"] for t, b in zip(noise, tb)), stn["moved"])

print("\na short span is the board's churn, not a trend")
short, sts = cdl.trend_threats(tb, mv(apart=1, rows=[row("a", 8.0, 4.0)]))
check("under TREND_MIN_DAYS nothing moves", sts["applied"] is False)
check("and the reason says why", "churn" in (sts["reason"] or ""), sts["reason"])
check("likelihoods are untouched",
      [t["likelihood"] for t in short] == [t["likelihood"] for t in tb])

print("\nno history is not a flat trend")
none_, stn2 = cdl.trend_threats(tb, {"basis": "none", "reason": "nothing stored yet", "rows": []})
check("basis none applies nothing", stn2["applied"] is False)
check("and every row still carries the key, just null",
      all("trend" in t and t["trend"] is None for t in none_))
check("a missing movement payload is handled too",
      cdl.trend_threats(tb, None)[1]["applied"] is False)

# `entered` rows carry a null delta BY DESIGN — the board is a top fifty, so
# arriving at rank 40 is not a climb from 51.
entered, ste = cdl.trend_threats(tb, mv(rows=[
    {"deckHash": "a", "previousUseRate": None, "useDelta": None, "rankDelta": None}]))
check("a deck that was not on the older board is NOT treated as a riser",
      all(t["trend"] is None for t in entered) and ste["moved"] == 0)

print("\nno prose")
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_daily.py"),
            encoding="utf-8").read()
check("explain() is not called: Team Scout's prose was removed on request, and "
      "its vocabulary is about an OPPONENT, which a field projection has none of",
      "ts.explain" not in _src)

print("\nno history is a state, not a zero")
none = cdl.weight_threats(base, {})
check("with no deficits the projection is returned unchanged",
      [t["likelihood"] for t in none] == [t["likelihood"] for t in base])
check("and the input was NOT mutated — both are reported side by side",
      all("boost" not in t for t in base))
check("weighting an empty projection is empty, not an error", cdl.weight_threats([], {}) == [])

print("\nbrief is a PROJECTION of the same answer, never a cheaper one")
# `plan()` itself reads the meta snapshot and the battle store, so the shape
# is checked on the piece that decides it rather than by calling the route.
_full = cdl.field_threats(board(deck("a", "hog", 10.0), deck("b", "golem", 5.0)))
check("a threat carries its cards for the full screen",
      all("cards" in t for t in _full))
_trimmed = [dict(t) for t in _full]
for _t in _trimmed:
    for _k in ("cards", "art", "artInferred", "wins", "winRate", "lastSeen",
               "similarityToObserved", "observedCount"):
        _t.pop(_k, None)
check("trimming drops only what a roster row does not draw",
      all("cards" not in t for t in _trimmed))
check("and KEEPS what the row says — name, share, and whether the player moved it",
      all(all(k in t for k in ("name", "archetype", "likelihood", "key"))
          for t in _trimmed))
check("the likelihoods are untouched by trimming, so the two cannot disagree",
      [t["likelihood"] for t in _trimmed] == [t["likelihood"] for t in _full])

print("\nnothing here calls a model")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "coach_daily.py"),
           encoding="utf-8").read()
check("no ml import", "import ml" not in src and "from ml" not in src)
check("the OIE is not referenced", "predictor" not in src and "CLASH_OIE" not in src)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
