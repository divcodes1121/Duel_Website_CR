"""test_coach.py — the Coach Assist decision rules.

    python server/test_coach.py

No database. Every function under test is either pure or is handed its inputs,
which is why `coach.py` splits the reading (`_history`) from the deciding — the
rules are what can be got wrong, and they are the part worth pinning.

THE RULE EVERYTHING RESTS ON: a duel loadout is three decks that cannot share a
card. Most of what follows is that rule, checked from a different angle.
"""

from __future__ import annotations

import os
import sys

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


def deck(*cards):
    """An 8-card deck padded with placeholders unique to the given cards."""
    out = list(cards)
    i = 0
    while len(out) < 8:
        f = f"filler-{cards[0] if cards else 'x'}-{i}"
        if f not in out:
            out.append(f)
        i += 1
    return out


def D(cards, **kw):
    """A candidate deck dict the way the clusterer emits one."""
    row = {"cards": list(cards), "count": kw.pop("count", 1), "prob": kw.pop("prob", 0.0),
           "archetype": kw.pop("archetype", "hog"), "deckName": kw.pop("deckName", "Deck"),
           "art": {}}
    row.update(kw)
    return row


# ── LEGALITY ───────────────────────────────────────────────────────────────
#
# The difference between predicting and recommending. `predict_companions`
# tolerates two shared cards because it reads noisy pooled history; a deck we
# tell someone to play NEXT must share zero, because they physically cannot
# play it otherwise. The bot shipped the looser rule into its recommendations
# once and told a player to bring a Golem deck repeating Lightning and Baby
# Dragon.

print("\na recommendation must be playable, not merely likely")

A = deck("hog-rider", "musketeer", "cannon")
B = deck("golem", "night-witch", "lightning")
SHARES_ONE = deck("golem", "night-witch", "cannon")  # 'cannon' is in A

check("a deck sharing no cards is legal",
      len(coach._legal([D(B)], set(A))) == 1)
check("a deck sharing ONE card is not",
      len(coach._legal([D(SHARES_ONE)], set(A))) == 0,
      str(set(SHARES_ONE) & set(A)))
check("nothing played means nothing is excluded",
      len(coach._legal([D(A), D(B)], set())) == 2)
check("the strict cap really is zero, not the predictor's two",
      coach.RECOMMEND_MAX_SHARED == 0)


# ── THE ODDS TABLES ────────────────────────────────────────────────────────
#
# Probability-weighted, not counted: a card in the front-runner has to outrank
# a card in three long shots, or the table describes the candidate list rather
# than the threat.

print("\ncard and archetype odds are weighted by the deck's probability")

FAV = D(deck("hog-rider", "musketeer"), prob=0.7, archetype="hog")
LONG1 = D(deck("golem", "night-witch"), prob=0.1, archetype="golem")
LONG2 = D(deck("x-bow", "tesla"), prob=0.1, archetype="xbow")
LONG3 = D(deck("mortar", "knight"), prob=0.1, archetype="mortar")

odds = {r["card"]: r["prob"] for r in coach._card_odds([FAV, LONG1, LONG2, LONG3], limit=40)}
check("a card in the favourite outranks one in a long shot",
      odds["hog-rider"] > odds["golem"], f"{odds['hog-rider']} vs {odds['golem']}")
check("and it carries the deck's own probability",
      abs(odds["hog-rider"] - 0.7) < 1e-6, str(odds["hog-rider"]))

# A card in two candidate decks accumulates both.
SHARED = D(deck("hog-rider", "fireball"), prob=0.3, archetype="hog")
odds2 = {r["card"]: r["prob"] for r in coach._card_odds([FAV, SHARED], limit=40)}
check("a card in two candidates accumulates",
      abs(odds2["hog-rider"] - 1.0) < 1e-6, str(odds2["hog-rider"]))

arch = {r["archetype"]: r["prob"] for r in coach._archetype_odds([FAV, LONG1, LONG2, LONG3])}
check("archetype odds group the decks", abs(arch["hog"] - 0.7) < 1e-6, str(arch))
check("and are capped to the top few", len(arch) <= coach.TOP_ARCHETYPES)

check("the table is limited", len(coach._card_odds([FAV, LONG1], limit=3)) == 3)
check("ties break on the card key, so identical data renders identically",
      [r["card"] for r in coach._card_odds([D(["b-card", "a-card", "c-card"], prob=1.0)], limit=3)]
      == ["a-card", "b-card", "c-card"])
check("no candidates, no odds", coach._card_odds([]) == [])


# ── THE EXPECTED-VALUE SUM ─────────────────────────────────────────────────

print("\nexpected win rate weighs their decks and drops the unscorable")


class FakeSnap:
    pass


def fake_win_prob(rates):
    """Patch `win_prob` with a lookup from the opponent's first card."""
    def inner(mine, theirs, snap):
        r = rates.get(theirs[0])
        return None if r is None else {"winRate": r, "games": 100,
                                       "source": "deck", "tier": "High"}
    return inner


real = coach.win_prob
try:
    coach.win_prob = fake_win_prob({"golem": 80.0, "x-bow": 40.0})
    opp = [D(deck("golem"), prob=0.5), D(deck("x-bow"), prob=0.5)]
    exp = coach._expected(A, opp, FakeSnap())
    check("an even split averages", abs(exp["winRate"] - 60.0) < 1e-6, str(exp["winRate"]))

    opp = [D(deck("golem"), prob=0.9), D(deck("x-bow"), prob=0.1)]
    exp = coach._expected(A, opp, FakeSnap())
    check("a likelier opponent counts for more", abs(exp["winRate"] - 76.0) < 1e-6,
          str(exp["winRate"]))

    # THE ONE THAT MATTERS. A deck with no evidence must be DROPPED, not scored
    # at 50% — an invented coin flip drags a real edge toward the middle and
    # makes two genuinely different candidates look alike.
    coach.win_prob = fake_win_prob({"golem": 80.0})       # x-bow unknown
    opp = [D(deck("golem"), prob=0.5), D(deck("x-bow"), prob=0.5)]
    exp = coach._expected(A, opp, FakeSnap())
    check("an unscorable opponent deck is dropped, not guessed at 50%",
          abs(exp["winRate"] - 80.0) < 1e-6, str(exp["winRate"]))
    check("and the dropped mass is reported so the reader can discount it",
          abs(exp["weight"] - 0.5) < 1e-6, str(exp["weight"]))
    check("every pairing is itemised", len(exp["per"]) == 2)

    coach.win_prob = fake_win_prob({})
    check("nothing scorable at all returns nothing rather than 50%",
          coach._expected(A, opp, FakeSnap()) is None)
finally:
    coach.win_prob = real


# ── THE OPENING ────────────────────────────────────────────────────────────
#
# "They open with this" and "they play this a lot" are different claims. Only
# ordered series can support the first, so the basis is always stated.

print("\nthe opening is only claimed when ordered series support it")

hog, golem, xbow = deck("hog-rider"), deck("golem"), deck("x-bow")


def hist(firsts, all_decks, series=None):
    return {
        "firsts": firsts, "allDecks": all_decks,
        "series": series if series is not None else [None] * len(firsts),
        "seriesDecks": [], "arch": lambda c: "hog", "marks": lambda c: {},
        "archiveUsed": False,
    }


r = coach.opening_decks("#T", hist([hog, hog, golem, xbow], [hog] * 9))
check("enough ordered series ranks by game 1", r["basis"] == "first-game history", r["basis"])
check("and counts the openings, not the games", r["nObs"] == 4, str(r["nObs"]))

r = coach.opening_decks("#T", hist([hog, golem], [hog] * 30))
check("too few falls back to overall play rate", r["basis"] == "overall play rate", r["basis"])
check("and says so via lowConfidence", r["lowConfidence"] is True)
check("the fallback counts every duel deck", r["nObs"] == 30, str(r["nObs"]))
check("the threshold is the bot's", coach.MIN_FIRST_SERIES == 3)

r = coach.opening_decks("#T", hist([], []))
check("no duel history returns nothing rather than an empty ranking",
      r["decks"] == [] and r["basis"] is None and r["lowConfidence"] is True)

# Four ordered series clears the floor but is still thin, and the flag has two
# independent reasons to fire.
r = coach.opening_decks("#T", hist([hog, hog, golem], [hog] * 5))
check("a thin but ordered read is flagged too", r["lowConfidence"] is True, str(r))


# ── THE DISTRIBUTION TOP-UP ────────────────────────────────────────────────

print("\ntopping up a thin read never makes it look confident")

check("their own history keeps most of the mass", coach.OPP_HISTORY_MASS == 0.7)

pop = [D(deck("golem"), deckName="Golem"), D(deck("x-bow"), deckName="X-Bow")]
real_pop = coach._population_decks
try:
    coach._population_decks = lambda limit=24: [dict(d, fill=True) for d in pop]
    # A variant of something already listed is not a second option.
    near = D(deck("golem") [:8], deckName="Golem variant")
    fills = coach._fills([near], set(), 2)
    check("a fill that is a variant of a listed deck is skipped",
          all(len(set(f["cards"]) & set(near["cards"])) < coach.MIN_OVERLAP for f in fills),
          str([f["deckName"] for f in fills]))
    check("fills are labelled, never silently mixed in",
          all(f.get("fill") for f in fills), str(fills))
    check("asking for none returns none", coach._fills([], set(), 0) == [])
    check("a fill must still be legal",
          coach._fills([], set(deck("golem")), 2)
          and all(not (set(f["cards"]) & set(deck("golem")))
                  for f in coach._fills([], set(deck("golem")), 2)))
finally:
    coach._population_decks = real_pop


# ── THE READ ───────────────────────────────────────────────────────────────
#
# Explanatory, never a second opinion. It must not imply a sharper read than
# the numbers support — which is measured, not stylistic: counter-sniping made
# the bot's top-1 accuracy three times worse when it was tried as a feature.

print("\nthe read states the evidence and grades its own confidence")

best_strong = D(hog, deckName="Hog Cycle", expected={"winRate": 72.0, "weight": 1.0, "per": []})
best_slight = D(hog, deckName="Hog Cycle", expected={"winRate": 57.0, "weight": 1.0, "per": []})
best_flip = D(hog, deckName="Hog Cycle", expected={"winRate": 51.0, "weight": 1.0, "per": []})
best_none = D(hog, deckName="Hog Cycle", expected=None)

opp_one = {"decks": [D(golem, prob=1.0, deckName="Golem")], "source": "opponent-history"}
opp_wide = {"decks": [D(golem, prob=0.2, deckName="Golem"),
                      D(xbow, prob=0.2, deckName="X-Bow"),
                      D(hog, prob=0.2, deckName="Hog")], "source": "opponent-history"}


def text(*a):
    return " ".join(coach._read(*a))


check("a big edge is called an edge",
      "a real edge" in text(1, best_strong, opp_one, [], [golem], None))
check("a small one is not oversold",
      "slight edge" in text(1, best_slight, opp_one, [], [golem], None))
check("a coin flip is called a coin flip",
      "coin flip" in text(1, best_flip, opp_one, [], [golem], None))
check("with no matchup evidence it says what it ranked on instead",
      "no matchup evidence" in text(1, best_none, opp_one, [], [golem], None))

check("one legal deck left is stated as certainty, not a percentage",
      "Only Golem fits" in text(2, best_strong, opp_one, [hog], [golem, xbow], None))
check("a wide field is called a lean",
      "treat this as a lean" in text(1, best_strong, opp_wide, [], [golem], None))

check("burned decks are named, because that is the constraint people forget",
      "cannot repeat" in text(1, best_strong, opp_one, [hog], [golem], None))
check("at the opening it says nothing is burned",
      "Nothing is burned yet" in text(0, best_strong, opp_wide, [], [], None))

obs = {"times": 2, "decks": [D(golem, deckName="Golem"), D(xbow, deckName="X-Bow")]}
said = text(1, best_strong, opp_one, [], [hog], obs)
check("an observed loadout is reported as a fact with its count",
      "2 times" in said and "Golem + X-Bow" in said, said)
check("seen once reads 'once', not '1 times'",
      "once" in text(1, best_strong, opp_one, [], [hog], {"times": 1, "decks": obs["decks"]}))

check("nothing to say is an empty read, not an invented one",
      coach._read(0, None, {"decks": [], "source": "population"}, [], [], None) == [])


# ── CAVEATS ────────────────────────────────────────────────────────────────

print("\nevery reason to distrust the answer is listed separately")

none_hist = hist([], [])
full_hist = hist([hog] * 5, [hog] * 40)

c = coach._caveats(full_hist, none_hist, {"source": "population"}, "expected win rate")
check("no opponent history says so", any("No duel history for the opponent" in x for x in c), str(c))
check("and does NOT also claim the list was topped up",
      not any("topped up" in x for x in c), str(c))

c = coach._caveats(full_hist, full_hist,
                   {"source": "opponent-history+population"}, "expected win rate")
check("a blended list explains the blend and quotes the share",
      any("topped up" in x and "30%" in x for x in c), str(c))

c = coach._caveats(none_hist, full_hist, {"source": "opponent-history"}, "expected win rate")
check("no history of my own is its own caveat",
      any("No duel history for you" in x for x in c), str(c))

c = coach._caveats(full_hist, full_hist, {"source": "opponent-history"}, "how much you play it")
check("ranking without matchup evidence is stated outright",
      any("ranked by how much you play them" in x for x in c), str(c))

check("a full read with evidence carries no caveats",
      coach._caveats(full_hist, full_hist,
                     {"source": "opponent-history"}, "expected win rate") == [])

thin = hist([hog], [hog, hog])
check("a thin opponent history is quantified, not just flagged",
      any("2 duel games" in x for x in
          coach._caveats(full_hist, thin, {"source": "opponent-history"}, "expected win rate")))


# ── THEIR REAL DUEL LOADOUTS ───────────────────────────────────────────────
#
# Not a ranking — a record. Everything else on the screen says what they COULD
# bring; this says which three-deck loadouts they HAVE brought that contain the
# deck just pasted.
#
# The first version anchored on game 1, on the theory that "when they opened
# with this they followed it with that" is the sharper claim. It is, and it is
# also the wrong question: a coach pastes the deck they have just SEEN, which is
# game 2 as often as game 1. Measured over 40 decks these players really ran but
# not necessarily first, the anchor found 62 series and left 20 of the 40
# showing NOTHING — every one of which has a recorded loadout.

print(chr(10) + "their real duel loadouts containing the pasted deck")

hogd, gold, xbowd, mind = deck("hog-rider"), deck("golem"), deck("x-bow"), deck("miner")
hogv = hogd[:7] + ["ice-spirit"]        # one card different: same deck at 6-of-8


def game(cards, result="win"):
    return {"cards": list(cards), "result": result}


def series(games, source="reconstructed", when="2026-08-01T00:00:00Z", won=True):
    return {"games": [game(g) for g in games],
            "source": source, "startTime": when, "opponentName": "Rival",
            "format": "bo3", "caption": "EDGED IT", "won": won}


def H(all_series):
    return {"series": all_series, "seriesDecks": [], "allDecks": [], "firsts": [],
            "arch": lambda c: "hog", "marks": lambda c: {}, "archiveUsed": False}


log = H([
    series([hogd, gold, xbowd]),
    series([gold, hogd, xbowd], when="2026-07-29T00:00:00Z"),   # hog is GAME 2
    series([gold, xbowd, hogv], when="2026-07-28T00:00:00Z"),   # a variant, GAME 3
    series([mind, gold, xbowd], when="2026-07-27T00:00:00Z"),   # no hog at all
])

r = coach.observed_sequences([hogd], log)
check("a deck played in ANY slot is found, not only as the opener",
      r["matched"] == 3, f"{r['matched']} (anchoring here is what showed a blank panel)")
check("a duel that never used it is not counted", r["matched"] == 3)
check("how many duels were examined is reported", r["searched"] == 4, str(r["searched"]))

pos = sorted(L["position"] for L in r["loadouts"])
check("each loadout says WHICH game they brought it in", pos == [1, 2, 3], str(pos))
check("the whole three-deck loadout comes back, not just what followed",
      all(len(L["games"]) == 3 for L in r["loadouts"]),
      str([len(L["games"]) for L in r["loadouts"]]))
check("exactly one deck per loadout is flagged as the one pasted",
      all(sum(1 for g in L["games"] if g["revealed"]) == 1 for L in r["loadouts"]))
check("the decks that travel with it are aggregated", len(r["nextDecks"]) >= 1)

check("both exact matches and variants are found",
      {L["exact"] for L in r["loadouts"]} == {True, False},
      str({L["exact"] for L in r["loadouts"]}))

# NATIVE rows: the loadout is real, the ORDER is not recorded.
nat = H([series([hogd, gold, xbowd], source="native")])
n = coach.observed_sequences([hogd], nat)
check("a native duel still counts — the three decks are a real loadout",
      n["matched"] == 1, str(n["matched"]))
check("but it is flagged as having no usable game order",
      n["loadouts"][0]["ordered"] is False and n["loadouts"][0]["position"] is None)
check("and the ordered count is reported separately", n["ordered"] == 0, str(n["ordered"]))

# Repeats collapse into ONE loadout with a count and a record.
rep = H([series([hogd, gold, xbowd], when="2026-08-0%dT00:00:00Z" % d, won=(d == 2))
         for d in (1, 2, 3)])
g = coach.observed_sequences([hogd], rep)
check("the same loadout run three times is ONE row, counted",
      len(g["loadouts"]) == 1 and g["loadouts"][0]["times"] == 3,
      f"{len(g['loadouts'])} rows")
check("with the record of how those duels went",
      (g["loadouts"][0]["wins"], g["loadouts"][0]["losses"]) == (1, 2),
      str((g["loadouts"][0]["wins"], g["loadouts"][0]["losses"])))
check("and the most recent date", g["loadouts"][0]["lastSeen"].startswith("2026-08-03"))

# Two reveals: BOTH must be in the loadout, consecutively and in order.
two = coach.observed_sequences([gold, hogd], log)
check("two reveals need both decks, consecutively and in order",
      two["matched"] == 1, str(two["matched"]))
check("and both are flagged as pasted",
      sum(1 for x in two["loadouts"][0]["games"] if x["revealed"]) == 2)

# Ranking and limits.
many = H([series([hogd, gold, xbowd]), series([hogd, gold, xbowd]),
          series([hogd, gold, xbowd]), series([hogd, mind, xbowd])])
mm = coach.observed_sequences([hogd], many)
check("the most-run loadout is listed first",
      mm["loadouts"][0]["times"] == 3, str([L["times"] for L in mm["loadouts"]]))
check("the listing is capped",
      len(coach.observed_sequences([hogd], H([
          series([hogd, gold, xbowd], when="2026-07-%02dT00:00:00Z" % d)
          for d in range(1, 12)]), limit=3)["loadouts"]) <= 3)

check("a deck they have never run matches nothing",
      coach.observed_sequences([deck("mortar")], log)["matched"] == 0)
check("no reveals, no answer", coach.observed_sequences([], log)["matched"] == 0)


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
