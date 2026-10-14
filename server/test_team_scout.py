"""test_team_scout.py — the coaching brain: projection, scoring, diversity.

    python server/test_team_scout.py

Plain asserts and a counter, matching the other suites here. NO DATABASE and no
snapshot: `team_scout` has no imports beyond the standard library, which is the
whole reason it was split out of `team_analysis`. Every case below runs against
literals in microseconds.

THE EIGHT CASES THE BRIEF NAMES are each a section below, by name. Four more
sections cover properties this codebase has already been bitten by:

  * THE MASS MUST SUM TO ONE. A distribution that does not is not a
    distribution, and every figure computed from it is scaled by an unknown
    constant;
  * AN INFERRED DECK MUST NEVER REPORT ITSELF AS OBSERVED. The single
    dishonesty this module exists to prevent — a generated deck presenting as
    something the opponent was seen playing;
  * THIN EVIDENCE MUST WIDEN THE PROJECTION, NOT SHARPEN IT. This is the exact
    inversion of the bug being replaced, where dropping the tail and
    renormalising made a five-battle read more confident than a hundred-battle
    one. If this test ever passes in the wrong direction the redesign has been
    undone;
  * THE FIXTURES MUST SPEAK THE PRODUCER'S VOCABULARY. `test_team_analysis.py`
    passed 59/59 against a field name that existed nowhere in the payload, and
    this file's fixtures are therefore built from the shapes
    `clash_data.player_report` and `deck_counter.seeds` actually emit —
    `matches` / `winCondition` / `lastSeen`, and `{archetype: [{cards, games,
    archetypes}]}` — not from what reads plausibly.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import team_scout as ts

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# ── Fixtures ────────────────────────────────────────────────────────────────
#
# Card names are real keys from `cards.json` so a veto passed in from
# `deck_harmony` would have something to read, but nothing here depends on the
# catalogue — the module never looks a card up.

HOG = ["hog-rider", "musketeer", "cannon", "ice-golem",
       "skeletons", "the-log", "fireball", "ice-spirit"]
#: One card different from HOG. This is what a VARIANT is.
HOG_V1 = ["hog-rider", "musketeer", "cannon", "ice-golem",
          "skeletons", "the-log", "fireball", "electro-spirit"]
#: Two cards different from HOG.
HOG_V2 = ["hog-rider", "musketeer", "tesla", "ice-golem",
          "skeletons", "the-log", "fireball", "electro-spirit"]
GIANT = ["giant", "mini-pekka", "musketeer", "zap",
         "arrows", "minions", "knight", "elixir-collector"]
LAVA = ["lava-hound", "balloon", "mega-minion", "tombstone",
        "zap", "arrows", "skeleton-dragons", "guards"]
GRAVE = ["graveyard", "poison", "knight", "baby-dragon",
         "bowler", "tornado", "barbarian-barrel", "archers"]


def deck(cards, matches, *, wc="hog", last="20260920T120000.000Z",
         wins=None, name=""):
    """An opponent deck row, in `player_report`'s own vocabulary."""
    return {"cards": list(cards), "matches": matches,
            "wins": matches // 2 if wins is None else wins,
            "winCondition": wc, "lastSeen": last, "name": name,
            "winRate": 50.0}


def seed(cards, games, arch):
    return {"hash": ts.deck_key(cards), "cards": list(cards),
            "games": games, "archetypes": {arch: {"winRate": 50.0, "games": games}}}


SEEDS = {
    "hog": [seed(HOG, 9000, "hog"), seed(HOG_V1, 4000, "hog"),
            seed(HOG_V2, 2500, "hog")],
    "giant": [seed(GIANT, 7000, "giant")],
    "lava-hound": [seed(LAVA, 6000, "lava-hound")],
    "graveyard": [seed(GRAVE, 5000, "graveyard")],
}

NOW = "20260920T120000.000Z"


def rate_all(value, source="deck", games=400):
    """A ladder stub that answers every archetype the same."""
    return lambda arch: {"winRate": value, "source": source, "games": games,
                         "tier": "high"}


def rate_map(mapping, default=None, source="deck"):
    """A ladder stub with a per-archetype answer. `default=None` = no evidence."""
    def f(arch):
        v = mapping.get(arch, default)
        if v is None:
            return None
        return {"winRate": v, "source": source, "games": 400, "tier": "high"}
    return f


def mass_of(space, kind):
    return sum(t["likelihood"] for t in space["threats"] if t["evidence"] == kind)


# ── The eight cases ─────────────────────────────────────────────────────────


def case_1_many_known_decks():
    print("\ncase 1 — opponent has many known decks")
    decks = [deck(HOG, 40, wc="hog"), deck(GIANT, 30, wc="giant"),
             deck(LAVA, 20, wc="lava-hound"), deck(GRAVE, 10, wc="graveyard")]
    sp = ts.threat_space(decks, SEEDS, now=NOW)
    kinds = {t["evidence"] for t in sp["threats"]}

    check("their four decks are all projected",
          all(any(t["key"] == ts.deck_key(d) for t in sp["threats"])
              for d in (HOG, GIANT, LAVA, GRAVE)))
    check("it is not just the history — variants or inference are present",
          kinds & {ts.VARIANT, ts.INFERRED} != set(), str(kinds))
    check("observed still holds the majority of the mass",
          mass_of(sp, ts.OBSERVED) > 0.5, f"{mass_of(sp, ts.OBSERVED):.3f}")
    check("the most-played deck leads the projection",
          sp["threats"][0]["key"] == ts.deck_key(HOG),
          sp["threats"][0]["key"])


def case_2_thin_history():
    print("\ncase 2 — opponent has very little history")
    thin = ts.threat_space([deck(HOG, 2, wc="hog")], SEEDS, now=NOW)
    rich = ts.threat_space([deck(HOG, 200, wc="hog")], SEEDS, now=NOW)

    check("a thin read allocates MORE mass away from the observed deck",
          thin["churn"]["switch"] > rich["churn"]["switch"],
          f"thin {thin['churn']['switch']} vs rich {rich['churn']['switch']}")
    check("the thin read says its evidence is thin",
          thin["churn"]["evidence"] == "thin", thin["churn"]["evidence"])
    check("the thin read still names the deck they played",
          any(t["key"] == ts.deck_key(HOG) and t["evidence"] == ts.OBSERVED
              for t in thin["threats"]))
    check("nothing in a thin projection claims to be well-known beyond what was seen",
          all(t["confidence"] != ts.KNOWN
              for t in thin["threats"] if t["evidence"] != ts.OBSERVED))


def case_3_one_deck_dominates():
    print("\ncase 3 — one deck dominates the history")
    sp = ts.threat_space([deck(HOG, 120, wc="hog")], SEEDS, now=NOW)
    keys = [t["key"] for t in sp["threats"]]

    check("the dominant deck is first", keys[0] == ts.deck_key(HOG), keys[0])
    check("related variants appear beside it",
          any(t["evidence"] == ts.VARIANT for t in sp["threats"]))
    check("coverage reaches beyond that one archetype",
          len({t["archetype"] for t in sp["threats"]}) > 1,
          str({t["archetype"] for t in sp["threats"]}))
    check("it is not seven near-identical copies",
          len(set(keys)) == len(keys))

    # And the recommendations over it are not seven versions of one answer.
    pool = [
        {"cards": GIANT, "archetype": "giant"},
        {"cards": LAVA, "archetype": "lava-hound"},
        {"cards": GRAVE, "archetype": "graveyard"},
        {"cards": HOG_V1, "archetype": "hog"},
        {"cards": HOG_V2, "archetype": "hog"},
        {"cards": HOG, "archetype": "hog"},
    ]
    rows = [r for r in (ts.score(rate_all(60.0), sp["threats"], **c) for c in pool) if r]
    picked = ts.diversify(rows)
    archs = [p["archetype"] for p in picked]
    check("the portfolio is not one archetype repeated",
          len(set(archs)) > 1, str(archs))


def case_4_likely_but_bad_matchup():
    print("\ncase 4 — a likely deck we match up badly into")
    decks = [deck(HOG, 60, wc="hog"), deck(GIANT, 40, wc="giant")]
    sp = ts.threat_space(decks, SEEDS, now=NOW)

    # Strong against what they play LESS, weak against what they play most.
    row = ts.score(rate_map({"hog": 35.0, "giant": 70.0,
                             "lava-hound": 60.0, "graveyard": 60.0}),
                   sp["threats"], cards=LAVA, archetype="lava-hound")

    hog_rows = [m for m in row["matchups"] if m["archetype"] == "hog"]
    check("the hog threat is still carried with a real likelihood",
          hog_rows and hog_rows[0]["likelihood"] > 0.2,
          str(hog_rows[0]["likelihood"] if hog_rows else None))
    check("likelihood and matchup are separate fields",
          "matchupValue" in row and "threatCovered" in row
          and row["matchupValue"] != row["threatCovered"])
    check("the bad matchup pulls the headline down",
          row["matchupValue"] < 70.0, str(row["matchupValue"]))

    # The deck that beats their MAIN deck should outrank one that does not,
    # even though both beat something.
    good = ts.score(rate_map({"hog": 70.0, "giant": 35.0,
                              "lava-hound": 50.0, "graveyard": 50.0}),
                    sp["threats"], cards=GRAVE, archetype="graveyard")
    check("answering what they actually play ranks higher",
          good["recommendationScore"] > row["recommendationScore"],
          f"{good['recommendationScore']} vs {row['recommendationScore']}")


def case_5_unseen_but_related():
    print("\ncase 5 — an unseen but strongly related deck can appear")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)
    variants = [t for t in sp["threats"] if t["evidence"] == ts.VARIANT]

    check("a never-observed variant is projected", bool(variants))
    check("it names the observed deck it came from",
          all(v["basis"] == ts.deck_key(HOG) for v in variants),
          str([v["basis"] for v in variants]))
    check("it reports zero observations",
          all(v["observedCount"] == 0 for v in variants))
    check("its similarity to the observed deck is published and below 1",
          all(0 < v["similarityToObserved"] < 1 for v in variants),
          str([v["similarityToObserved"] for v in variants]))
    check("a one-card variant outranks a two-card one",
          next((v["likelihood"] for v in variants if v["key"] == ts.deck_key(HOG_V1)), 0)
          > next((v["likelihood"] for v in variants if v["key"] == ts.deck_key(HOG_V2)), 0))


def case_6_no_evidence():
    print("\ncase 6 — no meaningful evidence")
    empty = ts.threat_space([], SEEDS, now=NOW)
    check("an empty history is a named state, not an empty ranking",
          empty["reason"] == "no_history" and empty["threats"] == [],
          str(empty["reason"]))
    check("churn falls back to the WIDE prior, not to zero",
          empty["churn"]["switch"] >= ts.SWITCH_MIN
          and empty["churn"]["evidence"] == "none",
          str(empty["churn"]))

    # And a candidate that can be scored against nothing returns nothing,
    # rather than the 50% an average over an empty set produces.
    sp = ts.threat_space([deck(HOG, 20, wc="hog")], SEEDS, now=NOW)
    none_row = ts.score(rate_map({}, default=None), sp["threats"],
                        cards=GIANT, archetype="giant")
    check("a candidate with no evidence scores None, never 50%",
          none_row is None, str(none_row))

    # Partial evidence must be reported as partial, and must cost something.
    part = ts.score(rate_map({"hog": 60.0}), sp["threats"],
                    cards=GIANT, archetype="giant")
    full = ts.score(rate_all(60.0), sp["threats"], cards=LAVA,
                    archetype="lava-hound")
    check("partial coverage is published", part["threatCovered"] < 1.0)
    check("partial coverage scores below full coverage at the same win rate",
          part["recommendationScore"] < full["recommendationScore"],
          f"{part['recommendationScore']} vs {full['recommendationScore']}")

    # BOTH DIRECTIONS, because the first fixture written here only tested one
    # and tested it wrongly. Answering `hog` covers the observed deck AND the
    # two variants of it — 88% of the projection — and at that coverage, off
    # exact-deck records, `known` is the honest word. The property being
    # asserted is that coverage MOVES the confidence, so it needs a candidate
    # measurable against a corner of the projection, not against most of it.
    corner = ts.score(rate_map({"graveyard": 60.0}), sp["threats"],
                      cards=GIANT, archetype="giant")
    check("broad coverage on strong evidence is stated as known",
          part["confidence"] == ts.KNOWN,
          f"{part['confidence']} at {part['threatCovered']}")
    check("coverage of one corner of the projection is speculative",
          corner["confidence"] == ts.SPECULATIVE,
          f"{corner['confidence']} at {corner['threatCovered']}")
    check("the two differ only by coverage, not by evidence quality",
          corner["evidenceStrength"] == part["evidenceStrength"],
          f"{corner['evidenceStrength']} vs {part['evidenceStrength']}")


def case_7_duplicates():
    print("\ncase 7 — near-identical recommendations are penalised")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    # Three near-copies scoring highest, one genuinely different deck below.
    rows = []
    for cards, arch, rate in ((HOG, "hog", 62.0), (HOG_V1, "hog", 61.5),
                              (HOG_V2, "hog", 61.0), (LAVA, "lava-hound", 58.0)):
        r = ts.score(rate_all(rate), sp["threats"], cards=cards, archetype=arch)
        rows.append(r)

    picked = ts.diversify(rows, limit=3, minimum=1)
    keys = [p["key"] for p in picked]
    check("the different deck is promoted over a third near-copy",
          ts.deck_key(LAVA) in keys, str(keys))
    check("redundancy is published on every pick after the first",
          all("redundancy" in p for p in picked)
          and picked[0]["redundancy"] == 0.0)
    check("an adjusted score is published beside the raw one",
          all("adjustedScore" in p for p in picked))
    check("similarity is superlinear — four shared cards is nearly free",
          ts.similarity(["a", "b", "c", "d", "e", "f", "g", "h"],
                        ["a", "b", "c", "d", "1", "2", "3", "4"]) < 0.3)
    check("seven shared cards is decisive",
          ts.similarity(HOG, HOG_V1, "hog", "hog") > 0.85,
          str(ts.similarity(HOG, HOG_V1, "hog", "hog")))

    # SAME ARCHETYPE, DIFFERENT CARDS — the case pairwise similarity misses,
    # found by reviewing thirty real opponents rather than by reading. Two
    # Royal Hogs lists sharing three cards score 0.34 on `similarity`, so the
    # 2.0-point penalty let three of them take three of seven slots. Every
    # pair was genuinely dissimilar and the list was still three answers to
    # one plan.
    hog_a = ["hog-rider", "musketeer", "cannon", "ice-golem",
             "skeletons", "the-log", "fireball", "ice-spirit"]
    hog_b = ["hog-rider", "valkyrie", "tesla", "bomber",
             "goblins", "zap", "arrows", "electro-spirit"]
    hog_c = ["hog-rider", "knight", "tombstone", "archers",
             "guards", "barbarian-barrel", "poison", "bats"]
    check("two same-archetype lists CAN be dissimilar in cards",
          ts.similarity(hog_a, hog_b, "hog", "hog") < 0.35,
          str(ts.similarity(hog_a, hog_b, "hog", "hog")))

    sp2 = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)
    flat = []
    for cards, arch in ((hog_a, "hog"), (hog_b, "hog"), (hog_c, "hog"),
                        (LAVA, "lava-hound"), (GRAVE, "graveyard")):
        flat.append(ts.score(rate_all(60.0), sp2["threats"], cards=cards,
                             archetype=arch))
    chosen = ts.diversify(flat, limit=4, minimum=1)
    hogs = sum(1 for c in chosen if c["archetype"] == "hog")
    check("an archetype cannot take the whole portfolio on equal scores",
          hogs <= 2, f"{hogs} of {len(chosen)} are hog")
    check("the other archetypes are promoted into the freed slots",
          len({c["archetype"] for c in chosen}) >= 3,
          str([c["archetype"] for c in chosen]))

    # AND IT IS A COST, NOT A CAP. A genuine matchup edge must still be able
    # to buy the slot, or the portfolio starts refusing the right answer for
    # being the same shape as another right answer.
    strong = []
    for cards, arch, rate in ((hog_a, "hog", 72.0), (hog_b, "hog", 71.0),
                              (LAVA, "lava-hound", 52.0),
                              (GRAVE, "graveyard", 51.0)):
        strong.append(ts.score(rate_all(rate), sp2["threats"], cards=cards,
                               archetype=arch))
    picked2 = ts.diversify(strong, limit=3, minimum=1)
    check("a large edge still buys a second deck of one archetype",
          sum(1 for c in picked2 if c["archetype"] == "hog") == 2,
          str([(c["archetype"], c["recommendationScore"]) for c in picked2]))


def case_8_player_compatibility():
    print("\ncase 8 — our player's own pool matters")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    practised = ts.score(rate_all(58.0), sp["threats"], cards=GIANT,
                         archetype="giant", fit_games=40)
    fresh = ts.score(rate_all(58.0), sp["threats"], cards=LAVA,
                     archetype="lava-hound", fit_games=0)
    ownerless = ts.score(rate_all(58.0), sp["threats"], cards=GRAVE,
                         archetype="graveyard")

    check("a deck they already pilot outranks an identical one they do not",
          practised["recommendationScore"] > fresh["recommendationScore"])
    check("player fit is its own field, not folded into the win rate",
          practised["matchupValue"] == fresh["matchupValue"]
          and practised["playerFit"] != fresh["playerFit"])
    check("the tiebreak cannot overturn a real matchup difference",
          ts.FIT_WEIGHT <= 1.5)
    check("an ownerless row publishes NO fit rather than zero",
          ownerless["playerFit"] is None, str(ownerless["playerFit"]))


# ── Four properties this codebase has been bitten by ────────────────────────


def property_mass_sums_to_one():
    print("\nproperty — the projection is a distribution")
    for label, decks in (
        ("one deck", [deck(HOG, 40, wc="hog")]),
        ("four decks", [deck(HOG, 40, wc="hog"), deck(GIANT, 20, wc="giant"),
                        deck(LAVA, 8, wc="lava-hound"), deck(GRAVE, 1, wc="graveyard")]),
        ("one battle", [deck(HOG, 1, wc="hog")]),
    ):
        sp = ts.threat_space(decks, SEEDS, now=NOW)
        total = sum(t["likelihood"] for t in sp["threats"])
        check(f"{label}: likelihoods sum to 1.0", abs(total - 1.0) < 1e-3,
              f"{total:.6f}")
        check(f"{label}: no negative or >1 likelihood",
              all(0.0 <= t["likelihood"] <= 1.0 for t in sp["threats"]))
        check(f"{label}: the published mass split matches the entries",
              abs(sum(sp["mass"].values()) - 1.0) < 1e-3, str(sp["mass"]))

    check("with no seed pool the projection degrades to the observed decks",
          all(t["evidence"] == ts.OBSERVED
              for t in ts.threat_space([deck(HOG, 40)], None, now=NOW)["threats"]))
    check("and that degraded projection still sums to one",
          abs(sum(t["likelihood"] for t in
                  ts.threat_space([deck(HOG, 40), deck(GIANT, 10, wc="giant")],
                                  None, now=NOW)["threats"]) - 1.0) < 1e-3)


def property_inference_is_never_disguised():
    print("\nproperty — inference never presents itself as observation")
    sp = ts.threat_space([deck(HOG, 30, wc="hog")], SEEDS, now=NOW)
    generated = [t for t in sp["threats"] if t["evidence"] != ts.OBSERVED]

    check("there is something generated to check", bool(generated))
    check("nothing generated reports an observation count",
          all(t["observedCount"] == 0 for t in generated))
    check("nothing generated carries a lastSeen",
          all(t["lastSeen"] is None for t in generated))
    check("nothing generated is called 'known'",
          all(t["confidence"] != ts.KNOWN for t in generated),
          str([t["confidence"] for t in generated]))
    check("observed rows DO carry their count",
          all(t["observedCount"] > 0
              for t in sp["threats"] if t["evidence"] == ts.OBSERVED))
    check("the four confidence words are the only ones used",
          all(t["confidence"] in (ts.KNOWN, ts.LIKELY, ts.POSSIBLE, ts.SPECULATIVE)
              for t in sp["threats"]))


def property_thin_evidence_widens():
    print("\nproperty — thin evidence widens, it does not sharpen")
    # THE INVERSION OF THE BUG BEING REPLACED. `_spread` dropped everything
    # under two games and renormalised, handing that mass back to the decks
    # they played most — so a thin read came out MORE concentrated. If this
    # ever reverses, the redesign has been undone.
    thin = ts.threat_space([deck(HOG, 3, wc="hog"), deck(GIANT, 1, wc="giant")],
                           SEEDS, now=NOW)
    rich = ts.threat_space([deck(HOG, 150, wc="hog"), deck(GIANT, 50, wc="giant")],
                           SEEDS, now=NOW)

    check("the thin read puts less mass on observed decks",
          mass_of(thin, ts.OBSERVED) < mass_of(rich, ts.OBSERVED),
          f"thin {mass_of(thin, ts.OBSERVED):.3f} vs rich {mass_of(rich, ts.OBSERVED):.3f}")
    check("a one-game deck is KEPT, not dropped and redistributed",
          any(t["key"] == ts.deck_key(GIANT) and t["evidence"] == ts.OBSERVED
              for t in thin["threats"]))
    check("observed mass never exceeds the ceiling on switch",
          mass_of(rich, ts.OBSERVED) >= 1.0 - ts.SWITCH_MAX - 1e-6,
          f"{mass_of(rich, ts.OBSERVED):.3f}")


def property_recency_is_read():
    print("\nproperty — lastSeen is actually read")
    # It was carried and ignored by the module this replaces.
    fresh = deck(HOG, 40, wc="hog", last="20260920T120000.000Z")
    stale = deck(GIANT, 40, wc="giant", last="20260701T120000.000Z")
    sp = ts.threat_space([fresh, stale], SEEDS, now=NOW)
    a = next(t for t in sp["threats"] if t["key"] == ts.deck_key(HOG))
    b = next(t for t in sp["threats"] if t["key"] == ts.deck_key(GIANT))

    check("equal games, recent deck outweighs the stale one",
          a["likelihood"] > b["likelihood"],
          f"{a['likelihood']} vs {b['likelihood']}")
    check("the stale deck does not vanish", b["likelihood"] > 0)
    check("Supercell's battle-time format parses",
          ts._stamp("20260907T161011.000Z") is not None)
    check("ISO parses too", ts._stamp("2026-09-07T16:10:11Z") is not None)
    check("an unreadable stamp is full weight, not the floor",
          ts._recency("not-a-date", NOW) == 1.0,
          str(ts._recency("not-a-date", NOW)))
    check("a missing stamp is full weight", ts._recency(None, NOW) == 1.0)
    check("the decay floor holds for an ancient deck",
          ts._recency("20200101T120000.000Z", NOW) == ts.RECENCY_FLOOR)


def property_contract():
    print("\nproperty — the contract and its constants")
    check("the brain is versioned", ts.BRAIN_VERSION.startswith("team-scout-"))
    check("observed always keeps the majority", ts.SWITCH_MAX < 0.5)
    check("the switch floor is above zero — otherwise this is the old model",
          ts.SWITCH_MIN > 0)
    check("an unknown player is assumed WIDE",
          ts.PRIOR_SWITCH > (ts.SWITCH_MIN + ts.SWITCH_MAX) / 2)
    check("a deviation is likelier to be a tweak than a new archetype",
          ts.VARIANT_SHARE > 0.5)
    check("the variant overlap floor matches deck_tuner's MAX_SWAP of 2",
          8 - ts.MIN_VARIANT_OVERLAP == 2)
    check("the portfolio is seven (the account holder's call, 2026-09-21)",
          ts.MIN_RECOMMENDATIONS == 7 and ts.MAX_RECOMMENDATIONS == 7)
    check("the fit tiebreak is unchanged from team_analysis.COMFORT_WEIGHT",
          ts.FIT_WEIGHT == 1.5)
    check("every ladder source has a strength and the weakest is the default",
          set(ts.SOURCE_STRENGTH) == {"exact", "version", "deck", "cluster7",
                                      "cluster6", "archetype"}
          and ts.SOURCE_STRENGTH["exact"] > ts.SOURCE_STRENGTH["archetype"])
    # `matchup_fusion`'s version level: about the threat's own list, so above
    # the archetype-level "deck", and below two lists that met exactly.
    check("a version-level rate ranks between an exact pairing and a deck rate",
          ts.SOURCE_STRENGTH["exact"] > ts.SOURCE_STRENGTH["version"]
          > ts.SOURCE_STRENGTH["deck"])

    # rate_for_threat: asked INSTEAD of rate_for, with the whole threat row.
    _seen = []

    def _by_threat(t):
        _seen.append(t["key"])
        return {"winRate": 70.0 if t["key"] == "bait-a" else 40.0,
                "games": 50, "source": "version"}

    _two = [{"key": "bait-a", "archetype": "bait", "evidence": ts.OBSERVED,
             "likelihood": 0.5},
            {"key": "bait-b", "archetype": "bait", "evidence": ts.OBSERVED,
             "likelihood": 0.5}]
    _r = ts.score(lambda a: {"winRate": 55.0, "games": 50, "source": "deck"}, _two,
                  cards=list("abcdefgh"), archetype="x", rate_for_threat=_by_threat)
    check("two lists of ONE archetype can now score differently",
          _r and [m["winRate"] for m in _r["matchups"]] == [70.0, 40.0],
          str(_r and [m["winRate"] for m in _r["matchups"]]))
    check("and the per-threat rate replaced the archetype rate entirely",
          _r and _r["matchupValue"] == 55.0 and _seen == ["bait-a", "bait-b"],
          str(_r and _r["matchupValue"]))
    check("a version-level source earns the version strength",
          _r and abs(_r["evidenceStrength"] - ts.SOURCE_STRENGTH["version"]) < 1e-9)
    _old = ts.score(lambda a: {"winRate": 55.0, "games": 50, "source": "deck"}, _two,
                    cards=list("abcdefgh"), archetype="x")
    check("without rate_for_threat the archetype path is unchanged (coach_daily)",
          _old and [m["winRate"] for m in _old["matchups"]] == [55.0, 55.0]
          and _old["evidenceStrength"] == ts.SOURCE_STRENGTH["deck"])
    check("threats are capped so the scoring loop is bounded",
          ts.MAX_THREATS <= 12)

    sp = ts.threat_space([deck(HOG, 40, wc="hog")], SEEDS, now=NOW)
    check("the projection is capped", len(sp["threats"]) <= ts.MAX_THREATS)
    row = ts.score(rate_all(60.0), sp["threats"], cards=GIANT,
                   archetype="giant", fit_games=10)
    for field in ("matchupValue", "threatCovered", "evidenceStrength",
                  "playerFit", "recommendationScore", "confidence",
                  "matchups", "brain"):
        check(f"a recommendation publishes `{field}`", field in row)
    check("expectedWinRate survives under its old name for existing readers",
          row["expectedWinRate"] == row["matchupValue"])
    check("evidence strength tracks the rung it came off",
          ts.score(rate_all(60.0, source="exact"), sp["threats"], cards=GIANT,
                   archetype="giant")["evidenceStrength"]
          > ts.score(rate_all(60.0, source="archetype"), sp["threats"],
                     cards=GIANT, archetype="giant")["evidenceStrength"])


def property_types_and_explanations():
    print("\nproperty — every recommendation knows why it exists")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    counter = ts.score(rate_map({"hog": 65.0}, default=40.0),
                       sp["threats"], cards=GIANT, archetype="giant")
    conting = ts.score(rate_map({"hog": 40.0}, default=65.0),
                       sp["threats"], cards=LAVA, archetype="lava-hound")

    check("a deck beating their observed core is a COUNTER or ROBUST",
          ts.classify(counter, sp["threats"]) in (ts.REC_COUNTER, ts.REC_ROBUST),
          ts.classify(counter, sp["threats"]))
    check("a deck that only answers what they have not shown is a CONTINGENCY",
          ts.classify(conting, sp["threats"]) == ts.REC_CONTINGENCY,
          ts.classify(conting, sp["threats"]))

    text = ts.explain(counter, sp["threats"])
    check("the explanation is one concise sentence",
          text.endswith(".") and 20 < len(text) < 220, text)
    check("it names the measured coverage",
          "%" in text, text)
    check("it never claims an unmeasured tendency",
          not any(w in text.lower() for w in
                  ("always", "never", "prefers", "tends to", "likes")), text)

    fitted = ts.score(rate_all(60.0), sp["threats"], cards=GIANT,
                      archetype="giant", fit_games=30)
    check("a practised deck says so in its explanation",
          "already pilot" in ts.explain(fitted, sp["threats"]),
          ts.explain(fitted, sp["threats"]))


def property_degradation():
    print("\nproperty — it never raises on a malformed payload")
    bad = [
        {"cards": None, "matches": 5},
        {"cards": ["a", "b"], "matches": 3},                 # not 8 cards
        {"cards": HOG, "matches": 0},                        # no games
        {"cards": HOG, "matches": 4, "lastSeen": "garbage"},
        {"cards": GIANT, "matches": 2, "winCondition": None},
    ]
    try:
        sp = ts.threat_space(bad, SEEDS, now=NOW)
        ok = True
    except Exception as exc:  # noqa: BLE001
        sp, ok = None, False
        print(f"       raised {exc!r}")
    check("a malformed payload does not raise", ok)
    if sp:
        check("only real eight-card decks are projected as observed",
              all(len(set(t["cards"])) == 8
                  for t in sp["threats"] if t["evidence"] == ts.OBSERVED))
        check("it still sums to one",
              abs(sum(t["likelihood"] for t in sp["threats"]) - 1.0) < 1e-3)

    check("diversify on an empty pool returns empty", ts.diversify([]) == [])
    check("score against an empty projection returns None",
          ts.score(rate_all(60.0), [], cards=HOG, archetype="hog") is None)
    check("a veto that rejects everything leaves the observed decks alone",
          all(t["evidence"] == ts.OBSERVED for t in ts.threat_space(
              [deck(HOG, 40, wc="hog")], SEEDS, now=NOW,
              veto=lambda c: "no")["threats"]))


def property_portfolio_is_not_padded():
    print("\nproperty — the list is a standard, not a length")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)
    # One strong deck and three far below the drop floor.
    rows = [ts.score(rate_all(70.0), sp["threats"], cards=GIANT, archetype="giant")]
    for cards, arch in ((LAVA, "lava-hound"), (GRAVE, "graveyard"), (HOG_V2, "hog")):
        rows.append(ts.score(rate_all(45.0), sp["threats"], cards=cards,
                             archetype=arch))
    # THE FLOOR, TESTED WITH THE FLOOR ASKED FOR. This check used to call
    # `diversify(rows)` and assert `len < MIN_RECOMMENDATIONS`. When the
    # portfolio went to seven-and-seven it KEPT PASSING — four candidates is
    # fewer than seven whether the floor fired or not — so it had quietly
    # stopped testing anything. The mechanism is still real for a caller that
    # passes a lower `minimum`; this pins it where it is actually exercised.
    floored = ts.diversify(rows, limit=ts.MAX_RECOMMENDATIONS, minimum=1)
    check("with a low minimum, candidates far below the best are dropped",
          len(floored) == 1, str(len(floored)))
    check("the strong one is kept", floored[0]["key"] == ts.deck_key(GIANT))

    # AND THE DEFAULT PORTFOLIO — seven, on the account holder's call — keeps
    # every real candidate up to seven, ranked, and invents nothing.
    picked = ts.diversify(rows)
    check("the default portfolio keeps every candidate the pool has",
          len(picked) == len(rows), f"{len(picked)} of {len(rows)}")
    check("but it never invents a row to reach seven",
          len(picked) < ts.MAX_RECOMMENDATIONS)
    check("the weaker ones are ranked below the strong one, not hidden",
          picked[0]["key"] == ts.deck_key(GIANT)
          and all(p["recommendationScore"] <= picked[0]["recommendationScore"]
                  for p in picked))

    # And with enough real candidates it does reach the portfolio size.
    many = []
    for i, (cards, arch) in enumerate((
            (GIANT, "giant"), (LAVA, "lava-hound"), (GRAVE, "graveyard"),
            (HOG, "hog"), (HOG_V2, "hog"),
            (["giant", "witch", "musketeer", "zap", "arrows", "minions",
              "knight", "tesla"], "giant"),
            (["balloon", "lumberjack", "barbarian-barrel", "musketeer",
              "tombstone", "arrows", "minions", "knight"], "balloon"))):
        many.append(ts.score(rate_all(62.0 - i * 0.4), sp["threats"],
                             cards=cards, archetype=arch))
    picked = ts.diversify(many)
    check("a real pool of seven fills the portfolio to exactly seven",
          len(picked) == 7, str(len(picked)))
    check("and never exceeds the ceiling", len(picked) <= ts.MAX_RECOMMENDATIONS)


def property_fills_follow_coach_assist():
    print("")
    print("property — topping up a short list, the way Coach Assist does")
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    own = [ts.score(rate_all(60.0), sp["threats"], cards=GIANT,
                    archetype="giant", fit_games=20)]
    pool = [ts.score(rate_all(58.0), sp["threats"], cards=c, archetype=a)
            for c, a in ((LAVA, "lava-hound"), (GRAVE, "graveyard"),
                         (HOG, "hog"))]

    got = ts.fills(own, pool, 2)
    check("it returns exactly what was asked for", len(got) == 2, str(len(got)))
    check("every filled row is marked", all(r["fill"] for r in got))
    check("nothing already chosen is returned again",
          all(r["key"] != own[0]["key"] for r in got))
    check("asking for none returns none", ts.fills(own, pool, 0) == [])
    check("an empty pool is not an error", ts.fills(own, [], 3) == [])

    # THE HARD SKIP, which is what separates this from `diversify`.
    near = ts.score(rate_all(99.0), sp["threats"], cards=HOG_V1, archetype="hog")
    base = ts.score(rate_all(50.0), sp["threats"], cards=HOG, archetype="hog")
    only_near = ts.fills([base], [near], 1)
    check("a near-copy of an existing row is SKIPPED, not merely penalised",
          only_near == [],
          "six shared cards is the same deck — filler that repeats a real "
          "recommendation shows one deck twice, one of them labelled a guess")
    check("and a genuinely different deck from the same pool is taken",
          len(ts.fills([base], [near, pool[0]], 1)) == 1)

    # IT MAY ONLY APPEND. The whole reason team_analysis's argument survives.
    check("the caller's own rows are never reordered or dropped",
          (own + got)[0]["key"] == own[0]["key"])
    check("a fill never carries an owner's practice figure",
          all(r.get("playerFit") in (None, 0.0) for r in got),
          str([r.get("playerFit") for r in got]))

    # AND IT IS NOT THE SAME THING AS BEING OWNERLESS.
    scoutish = ts.score(rate_all(58.0), sp["threats"], cards=LAVA,
                        archetype="lava-hound")
    check("an ownerless SCOUT row is not a fill",
          "fill" not in scoutish,
          "a scouting report's rows are ownerless too; conflating the two "
          "makes 'nobody plays this' and 'nobody on YOUR squad plays this' "
          "one sentence")

    check("the same-deck threshold matches duel_zone.COUNTER_MIN_OVERLAP",
          ts.SAME_DECK_OVERLAP == 6)


def property_suggest_ranks_together():
    print("")
    print("property — What Deckkies Suggests: own and population ranked together")
    # `coach.suggest`'s real sort: the combined list by expected win rate. An
    # earlier build appended population decks BELOW every owned one and called
    # that Coach Assist's rule; on a live squad that left an owned 60.0% deck
    # above 71.7% and 71.3% answers.
    sp = ts.threat_space([deck(HOG, 50, wc="hog")], SEEDS, now=NOW)

    weak_own = ts.score(rate_all(55.0), sp["threats"], cards=GIANT,
                        archetype="giant", fit_games=40)
    strong_pool = ts.score(rate_all(70.0), sp["threats"], cards=LAVA,
                           archetype="lava-hound")
    got = ts.suggest([weak_own], [strong_pool])
    check("a genuinely stronger population deck ranks ABOVE a weaker owned one",
          got[0]["key"] == ts.deck_key(LAVA),
          str([(g["archetype"], g["recommendationScore"]) for g in got]))
    check("and it is marked as a Deckkies pick", got[0].get("fill") is True)
    check("the owned deck is still on the list, unmarked",
          any(g["key"] == ts.deck_key(GIANT) and not g.get("fill") for g in got))

    # THE OWNED DECK KEEPS ITS EDGE AT PARITY: `FIT_WEIGHT` is added to a deck
    # they pilot, so a population deck must be genuinely better, not level.
    even_own = ts.score(rate_all(60.0), sp["threats"], cards=GIANT,
                        archetype="giant", fit_games=40)
    even_pool = ts.score(rate_all(60.0), sp["threats"], cards=GRAVE,
                         archetype="graveyard")
    tie = ts.suggest([even_own], [even_pool])
    check("at an equal matchup the deck they pilot leads",
          tie[0]["key"] == ts.deck_key(GIANT),
          str([(g["archetype"], g["recommendationScore"]) for g in tie]))

    # NEAR-COPIES OF THEIR OWN DECK ARE REFUSED — the version they play is kept.
    own_hog = ts.score(rate_all(55.0), sp["threats"], cards=HOG,
                       archetype="hog", fit_games=40)
    pool_hog = ts.score(rate_all(80.0), sp["threats"], cards=HOG_V1,
                        archetype="hog")
    dup = ts.suggest([own_hog], [pool_hog])
    check("a one-card variant of their own deck is not suggested beside it",
          [g["key"] for g in dup] == [ts.deck_key(HOG)],
          str([g["key"][:30] for g in dup]))

    # SEVEN WHEN THE POOL HAS THEM, ranked, and the caller's rows unmutated.
    many = []
    for i, (cards, arch) in enumerate((
            (GIANT, "giant"), (LAVA, "lava-hound"), (GRAVE, "graveyard"),
            (["giant", "witch", "musketeer", "zap", "arrows", "minions",
              "knight", "tesla"], "giant2"),
            (["balloon", "lumberjack", "barbarian-barrel", "musketeer",
              "tombstone", "arrows", "minions", "knight"], "balloon"),
            (["golem", "night-witch", "baby-dragon", "lumberjack",
              "tornado", "lightning", "mega-minion", "barbarian-barrel"], "golem"),
            (["x-bow", "tesla", "archers", "knight", "skeletons",
              "ice-spirit", "fireball", "the-log"], "xbow"))):
        many.append(ts.score(rate_all(66.0 - i), sp["threats"], cards=cards,
                             archetype=arch))
    seven = ts.suggest([own_hog], many)
    check("the suggestion list is seven when the pool can fill it",
          len(seven) == ts.MAX_RECOMMENDATIONS, str(len(seven)))
    check("suggest() does not write onto the caller's rows",
          "redundancy" not in many[0] and "fill" not in many[0])


# ── The squad plan (2026-09-25) ─────────────────────────────────────────────
#
# Reported as "very similar decks for all the home players against one away
# player". Measured live: five teammates, ONE #1, two identical lists. Each
# rule `squad_plan` adds is pinned here against literals.

#: A hand-built projection: three archetypes, likelihoods summing to one.
SQ_THREATS = [
    {"key": "t-hog", "archetype": "hog", "likelihood": 0.40,
     "evidence": "OBSERVED", "name": "Hog"},
    {"key": "t-giant", "archetype": "giant", "likelihood": 0.35,
     "evidence": "OBSERVED", "name": "Giant"},
    {"key": "t-grave", "archetype": "graveyard", "likelihood": 0.25,
     "evidence": "OBSERVED", "name": "Graveyard"},
]

#: Eight real-looking decks that share few enough cards that neither `fills`
#: nor the redundancy penalty treats any two as the same deck.
SQ_DECKS = {
    "A": ["balloon", "lumberjack", "barbarian-barrel", "musketeer",
          "tombstone", "arrows", "minions", "freeze"],
    "B": ["pekka", "battle-ram", "bandit", "royal-ghost",
          "magic-archer", "electro-wizard", "poison", "zap"],
    "C": ["x-bow", "tesla", "archers", "knight", "skeletons",
          "ice-spirit", "fireball", "the-log"],
    "D": ["golem", "night-witch", "baby-dragon", "lightning",
          "mega-minion", "tornado", "dark-prince", "elixir-collector"],
    "E": ["royal-giant", "hunter", "fisherman", "electro-spirit",
          "mother-witch", "earthquake", "goblin-cage", "rage"],
    "F": ["mortar", "miner", "dart-goblin", "spear-goblins",
          "bats", "bomber", "rocket", "giant-snowball"],
    "G": ["goblin-drill", "wall-breakers", "valkyrie", "firecracker",
          "cannon", "royal-delivery", "goblin-gang", "phoenix"],
    "H": ["sparky", "goblin-giant", "rascals", "electro-dragon",
          "inferno-dragon", "clone", "heal-spirit", "barbarians"],
}


def sq_row(name, rates, *, owner=None, games=None):
    """A real `score()` row, owner attached the way `team_analysis` does."""
    r = ts.score(rate_map(rates), SQ_THREATS, cards=SQ_DECKS[name],
                 archetype=name.lower(), fit_games=games)
    r["name"] = name
    r["owner"] = owner
    return r


def property_squad_plan():
    print("")
    print("property — the squad plan: different #1s, chosen to cover the field")

    # A is the single strongest deck and LOSES to Graveyard. C is next and
    # also loses to it. B is a point lower than C and ANSWERS it.
    a = sq_row("A", {"hog": 66, "giant": 66, "graveyard": 44})   # 60.5
    c = sq_row("C", {"hog": 64, "giant": 64, "graveyard": 48})   # 60.0
    b = sq_row("B", {"hog": 58, "giant": 58, "graveyard": 62})   # 59.0
    d = sq_row("D", {"hog": 50, "giant": 50, "graveyard": 50})   # 50.0
    pool = [a, c, b, d]
    snapshot = [dict(r) for r in pool]

    three = [{"tag": t, "own": [], "cards": set()} for t in ("#P1", "#P2", "#P3")]
    lists, cover = ts.squad_plan(three, pool, SQ_THREATS)
    firsts = [lists[t][0]["name"] for t in ("#P1", "#P2", "#P3")]
    check("three teammates, three different #1s", len(set(firsts)) == 3, str(firsts))
    check("the strongest deck is somebody's #1", "A" in firsts, str(firsts))
    check("the #1 after it is the one that ANSWERS what it loses to (B), not "
          "the one a point stronger that does not (C)",
          firsts[1] == "B", str(firsts))
    check("no #1 sits outside the band", "D" not in firsts, str(firsts))
    check("every #1 is marked as the squad's pick",
          all(lists[t][0].get("squadPick") for t in ("#P1", "#P2", "#P3")))
    check("the caller's rows are not written onto",
          [dict(r) for r in pool] == snapshot)

    grave = next(c_ for c_ in cover if c_["archetype"] == "graveyard")
    check("the cover row names who answers Graveyard, and at what",
          grave["tag"] == "#P2" and grave["winRate"] == 62.0 and grave["answered"],
          str(grave))
    check("cover rows run most likely first and carry the projection's weight",
          [c_["archetype"] for c_ in cover] == ["hog", "giant", "graveyard"]
          and abs(sum(c_["likelihood"] for c_ in cover) - 1.0) < 1e-6,
          str(cover))
    check("the #1 that answers an archetype best lists it in `covers`",
          "graveyard" in (lists["#P2"][0].get("covers") or []),
          str(lists["#P2"][0].get("covers")))
    check("every row carries its per-archetype rates",
          lists["#P1"][0]["vs"] == {"hog": 66.0, "giant": 66.0, "graveyard": 44.0},
          str(lists["#P1"][0].get("vs")))

    again, _ = ts.squad_plan(three, pool, SQ_THREATS)
    check("the plan is deterministic",
          [[r["key"] for r in again[t]] for t in again]
          == [[r["key"] for r in lists[t]] for t in lists])

    # ONE DECK IN THE BAND: sharing it is the honest answer, not a worse deck.
    alone, _ = ts.squad_plan(three[:2], [a, d], SQ_THREATS)
    check("with one deck in the band both teammates are given it",
          alone["#P1"][0]["name"] == alone["#P2"][0]["name"] == "A",
          str([alone[t][0]["name"] for t in alone]))

    # A POOL ROW RATED IN THE TIGHT LOOP carries `vs` and no per-threat table.
    # Its rates must survive the plan: recomputed from an absent table they
    # were empty, and no pool row could cover anything (Coverage 0 of 7 on the
    # live match plan, 2026-10-11).
    def lean_row(name, rates):
        r = ts.score(rate_map(rates), SQ_THREATS, cards=SQ_DECKS[name],
                     archetype=name.lower(), lean=True)
        r["name"], r["owner"] = name, None
        return r

    lean_pool = [lean_row("G", {"hog": 70, "giant": 64, "graveyard": 58}),
                 lean_row("H", {"hog": 55, "giant": 52, "graveyard": 66})]
    check("the fixture's pool rows are lean: rates, no per-threat table",
          all("matchups" not in r and r.get("vs") for r in lean_pool))
    lean_lists, lean_cover = ts.squad_plan(
        [{"tag": "#L1", "own": [], "cards": set()}, {"tag": "#L2", "own": [], "cards": set()}],
        lean_pool, SQ_THREATS)
    check("a lean pool row keeps its per-archetype rates through the plan",
          lean_lists["#L1"][0]["vs"] == {"hog": 70.0, "giant": 64.0, "graveyard": 58.0},
          str(lean_lists["#L1"][0].get("vs")))
    check("...so the cover rows name who answers each archetype, and all are answered",
          all(c_["tag"] and c_["answered"] for c_ in lean_cover)
          and next(c_ for c_ in lean_cover if c_["archetype"] == "graveyard")["winRate"] == 58.0,
          str(lean_cover))
    check("...and the #1s list what they cover",
          sorted(a_ for t_ in lean_lists for a_ in (lean_lists[t_][0].get("covers") or []))
          == ["giant", "graveyard", "hog"], str([lean_lists[t_][0].get("covers") for t_ in lean_lists]))

    # THEIR OWN CARDS DECIDE BETWEEN EQUALS.
    e = sq_row("E", {"hog": 60, "giant": 60, "graveyard": 60})
    f = sq_row("F", {"hog": 60, "giant": 60, "graveyard": 60})
    pair = [{"tag": "#E", "own": [], "cards": set(SQ_DECKS["F"][:6])},
            {"tag": "#F", "own": [], "cards": set(SQ_DECKS["E"][:7])}]
    by_cards, _ = ts.squad_plan(pair, [e, f], SQ_THREATS)
    check("between equal decks each teammate is given the one built from their cards",
          by_cards["#E"][0]["name"] == "F" and by_cards["#F"][0]["name"] == "E",
          str([by_cards[t][0]["name"] for t in by_cards]))
    check("`known` counts the cards they play",
          by_cards["#F"][0]["known"] == 7 and by_cards["#E"][0]["known"] == 6,
          str([by_cards[t][0].get("known") for t in by_cards]))
    check("five known cards is the floor: four earn nothing",
          ts._known_bonus(4) == 0.0 and ts._known_bonus(8) == ts.KNOWN_WEIGHT)

    # A DECK THEY PILOT, INSIDE THE BAND, LEADS THEIR LIST.
    mine = sq_row("G", {"hog": 59, "giant": 59, "graveyard": 59},
                  owner={"tag": "#G", "name": "G"}, games=30)
    solo, _ = ts.squad_plan([{"tag": "#G", "own": [mine], "cards": set(SQ_DECKS["G"])}],
                            [a, c], SQ_THREATS)
    check("an owned deck in the band is that teammate's #1",
          solo["#G"][0]["name"] == "G", str([r["name"] for r in solo["#G"]]))

    # NOBODY WITH NOTHING GETS AN INVENTED LIST.
    empty, cov0 = ts.squad_plan([{"tag": "#Z", "own": [], "cards": set()}],
                                [], SQ_THREATS)
    check("a teammate with nothing scored gets an empty list", empty["#Z"] == [])
    check("and every archetype is reported unanswered rather than dropped",
          len(cov0) == 3 and not any(c_["answered"] for c_ in cov0), str(cov0))

    # SEVEN WHEN THERE ARE SEVEN, #1 FIRST, THE REST BY STRENGTH.
    big = [sq_row(k, {"hog": 62 - i, "giant": 61 - i, "graveyard": 55 - i})
           for i, k in enumerate(SQ_DECKS)]
    full, _ = ts.squad_plan(three, big, SQ_THREATS)
    check("each list is seven when the pool can fill it",
          all(len(full[t]) == ts.MAX_RECOMMENDATIONS for t in full),
          str([len(full[t]) for t in full]))
    tails_sorted = all(
        [r["personalScore"] for r in full[t][1:]]
        == sorted((r["personalScore"] for r in full[t][1:]), reverse=True)
        for t in full)
    check("below the #1 each list reads strongest first", tails_sorted)
    check("no two teammates share a #1 when the band holds alternatives",
          len({full[t][0]["key"] for t in full}) == 3,
          str([full[t][0]["name"] for t in full]))

    # THE SPREAD RULE IS CAPPED: a deck listed by every earlier teammate costs
    # at most `TAKEN_PENALTY`, so a clearly better backup is never hidden.
    check("the shared-backup cost is capped at the taken cost",
          min(ts.TAKEN_PENALTY, ts.SHARED_PENALTY * 99) == ts.TAKEN_PENALTY)
    five = [{"tag": "#Q%d" % i, "own": [], "cards": set()} for i in range(5)]
    # One deck in the band, so every #1 is A and only the BACKUP is in play.
    far = [sq_row("A", {"hog": 70, "giant": 70, "graveyard": 70}),
           sq_row("C", {"hog": 66, "giant": 66, "graveyard": 66}),
           sq_row("D", {"hog": 60, "giant": 60, "graveyard": 60})]
    kept, _ = ts.squad_plan(five, far, SQ_THREATS, limit=2)
    backups = [kept[t][1]["name"] for t in kept]
    check("a backup six points better survives however many teammates list it",
          len(backups) == 5 and set(backups) == {"C"}, str(backups))
    near = [sq_row("A", {"hog": 70, "giant": 70, "graveyard": 70}),
            sq_row("C", {"hog": 60, "giant": 60, "graveyard": 60}),
            sq_row("D", {"hog": 59, "giant": 59, "graveyard": 59})]
    moved, _ = ts.squad_plan(five, near, SQ_THREATS, limit=2)
    backups = [moved[t][1]["name"] for t in moved]
    check("a backup one point better gives way once teammates already list it",
          backups[0] == "C" and "D" in backups[1:], str(backups))


# ── The speed-ups change nothing (2026-09-21) ───────────────────────────────
#
# `diversify` now carries each candidate's closest resemblance forward instead
# of recomputing it against the whole list every round, and `fills` detects a
# near-copy by shared six-card subset instead of intersecting every accepted
# deck. Both were rewritten for a 12v12 board, which made 310,000 similarity
# calls and 1.4M set intersections a request. These are the ORIGINAL bodies,
# verbatim, kept as oracles: the new code must return the same rows, in the
# same order, with the same published figures, on inputs built to hit the
# awkward cases — duplicate keys, shared archetypes, empty decks, ties.

def _ref_similarity(a, b, arch_a=None, arch_b=None):
    sa, sb = set(a or []), set(b or [])
    if not sa or not sb:
        return 0.0
    overlap = len(sa & sb) / max(len(sa), len(sb))
    sim = overlap * overlap
    if arch_a and arch_b and arch_a == arch_b:
        sim += ts.ARCHETYPE_SIMILARITY
    return min(1.0, sim)


def _ref_diversify(rows, *, limit=ts.MAX_RECOMMENDATIONS, minimum=ts.MIN_RECOMMENDATIONS):
    pool = sorted((dict(r) for r in rows), key=lambda r: -r["recommendationScore"])
    if not pool:
        return []
    best = pool[0]["recommendationScore"]
    floor = best - ts.PORTFOLIO_DROP
    chosen = [pool[0]]
    pool[0]["redundancy"] = 0.0
    pool[0]["adjustedScore"] = round(pool[0]["recommendationScore"], 3)
    rest = pool[1:]
    while rest and len(chosen) < limit:
        taken = {}
        for c in chosen:
            a = c.get("archetype") or ""
            taken[a] = taken.get(a, 0) + 1
        scored = []
        for cand in rest:
            sim = max(_ref_similarity(cand["cards"], c["cards"],
                                      cand.get("archetype"), c.get("archetype"))
                      for c in chosen)
            repeat = taken.get(cand.get("archetype") or "", 0)
            penalty = ts.REDUNDANCY_WEIGHT * sim + ts.ARCHETYPE_REPEAT_PENALTY * repeat
            scored.append((cand["recommendationScore"] - penalty, sim, cand))
        scored.sort(key=lambda s: (-s[0], s[2]["key"]))
        adjusted, sim, pick = scored[0]
        if pick["recommendationScore"] < floor and len(chosen) >= minimum:
            break
        pick["redundancy"] = round(sim, 3)
        pick["adjustedScore"] = round(adjusted, 3)
        chosen.append(pick)
        rest = [r for r in rest if r["key"] != pick["key"]]
    return chosen


def _ref_fills(existing, pool, need, *, min_overlap=ts.SAME_DECK_OVERLAP):
    if need <= 0:
        return []
    seen = [set(r.get("cards") or []) for r in existing]
    out = []
    for cand in pool:
        cards = set(cand.get("cards") or [])
        if not cards:
            continue
        if any(len(cards & s) >= min_overlap for s in seen):
            continue
        row = dict(cand)
        row["fill"] = True
        out.append(row)
        seen.append(cards)
        if len(out) >= need:
            break
    return out


def property_speedups_are_exact():
    import random
    print("\nThe speed-ups return exactly what the originals did")
    r = random.Random(20260921)
    cards = [f"c{i}" for i in range(20)]
    archs = ["hog", "golem", "xbow", "bait", ""]

    def row(i):
        base = r.sample(cards, 8)
        if r.random() < 0.05:
            base = []                                  # an empty deck
        return {
            "key": f"k{r.randint(0, 40)}",            # duplicate keys on purpose
            "cards": base,
            "archetype": r.choice(archs),
            # coarse scores so ties are common
            "recommendationScore": round(r.uniform(40, 75) * 2) / 2,
        }

    div_same = fill_same = 0
    trials = 1500
    for _ in range(trials):
        rows = [row(i) for i in range(r.randint(0, 40))]
        limit = r.randint(1, 9)
        minimum = r.randint(0, limit)
        a = ts.diversify(rows, limit=limit, minimum=minimum)
        b = _ref_diversify(rows, limit=limit, minimum=minimum)
        div_same += a == b

        existing = [row(i) for i in range(r.randint(0, 6))]
        pool = [row(i) for i in range(r.randint(0, 40))]
        need = r.randint(-1, 12)
        overlap = r.choice([0, 1, 5, 6, 6, 6, 7, 8, 9])
        fill_same += (ts.fills(existing, pool, need, min_overlap=overlap)
                      == _ref_fills(existing, pool, need, min_overlap=overlap))

    check(f"diversify == the original on {trials} random pools", div_same == trials,
          f"{trials - div_same} differed")
    check(f"fills == the original on {trials} random pools", fill_same == trials,
          f"{trials - fill_same} differed")
    check("similarity == the original",
          all(ts.similarity(a, b, x, y) == _ref_similarity(a, b, x, y)
              for a, b, x, y in [(["a", "b"], ["b", "c"], "hog", "hog"), ([], ["a"], None, None),
                                 (["a"] * 3, ["a"], "", ""), (list("abcdefgh"), list("abcdefgz"), "x", "y")]))


# ── 5.0: each teammate's own list, and who takes whom (2026-10-14) ──────────
#
# Reported against 4.1: "decks repetitive for more players". Measured on a live
# 4v4: all four teammates offered the same four decks against one opponent.
# Each rule `personal_plan` adds is pinned here against literals.


def p_row(name, rates, wincon, *, owner=None, games=None):
    """A lean pool row (or an owned one), carrying its win condition."""
    r = sq_row(name, rates, owner=owner, games=games)
    r["winCon"] = wincon
    return r


def property_personal_plan():
    print("")
    print("property — 5.0: each teammate's list is built out of that teammate")

    # Two Hog players and a Golem player; a pool with two Hog lists, two Golem
    # lists and a strong Graveyard list nobody plays.
    hog1 = p_row("A", {"hog": 64, "giant": 62, "graveyard": 60}, "hog-rider")
    hog2 = p_row("B", {"hog": 61, "giant": 60, "graveyard": 58}, "hog-rider")
    gol1 = p_row("C", {"hog": 60, "giant": 59, "graveyard": 57}, "golem")
    gol2 = p_row("D", {"hog": 57, "giant": 56, "graveyard": 55}, "golem")
    yard = p_row("E", {"hog": 70, "giant": 68, "graveyard": 66}, "graveyard")
    pool = [hog1, hog2, gol1, gol2, yard]
    snapshot = [dict(r) for r in pool]
    players = [
        {"tag": "#H1", "own": [], "cards": set(), "wincons": {"hog-rider": 0.8}, "shift": {}},
        {"tag": "#H2", "own": [], "cards": set(), "wincons": {"hog-rider": 0.6, "golem": 0.3}, "shift": {}},
        {"tag": "#G1", "own": [], "cards": set(), "wincons": {"golem": 0.9}, "shift": {}},
    ]
    # Five decks cannot fill three lists of three without sharing, so the
    # top-up is off here (`min_list=0`); sharing is pinned on its own below.
    lists, cover = ts.personal_plan(players, pool, SQ_THREATS, limit=3, new_slots=1, min_list=0)
    keys = {t: [r["name"] for r in lists[t]] for t in lists}
    check("the caller's rows are not written onto", [dict(r) for r in pool] == snapshot)
    check("lists come back in roster order", list(lists) == ["#H1", "#H2", "#G1"], str(list(lists)))
    shared = set(keys["#H1"]) & set(keys["#H2"]) & set(keys["#G1"])
    check("no pool deck is on two teammates' lists (`SHARE_MAX` 1)",
          len(sum(keys.values(), [])) == len(set(sum(keys.values(), []))), str(keys))
    check("...so nothing is on all three", not shared, str(keys))
    check("a Golem player's list holds Golem decks", "C" in keys["#G1"], str(keys))
    check("a contested deck goes to the teammate whose win condition it is more of: "
          "the Golem lists to the 90% Golem player, not the 30% one",
          {"C", "D"} <= set(keys["#G1"]) and not ({"C", "D"} & set(keys["#H2"])), str(keys))
    check("at most `new_slots` rows of a win condition the teammate does not play",
          all(sum(1 for r in lists[t] if not r["familiar"]) <= 1 for t in lists),
          str({t: [(r["name"], r["familiar"]) for r in lists[t]] for t in lists}))
    check("the strongest deck nobody plays still reaches a list (as its new row)",
          any("E" in keys[t] for t in keys), str(keys))
    check("each list's head is marked as that teammate's pick",
          all(lists[t][0].get("squadPick") for t in lists if lists[t]))
    check("every row says how much of the teammate's play its win condition is",
          lists["#G1"][0]["winConShare"] in (0.0, 0.9), str(lists["#G1"][0].get("winConShare")))
    check("each list reads strongest first",
          all([r["expectedWinRate"] for r in lists[t]]
              == sorted((r["expectedWinRate"] for r in lists[t]), reverse=True) for t in lists))
    again, _ = ts.personal_plan(players, pool, SQ_THREATS, limit=3, new_slots=1, min_list=0)
    check("the plan is deterministic",
          [[r["key"] for r in again[t]] for t in again] == [[r["key"] for r in lists[t]] for t in lists])
    check("cover rows run most likely first, one per archetype",
          [c["archetype"] for c in cover] == ["hog", "giant", "graveyard"], str(cover))

    # A TEAMMATE'S RECORD WITH A WIN CONDITION MOVES THEIR FIGURE, and only theirs.
    skilled = [{"tag": "#S", "own": [], "cards": set(), "wincons": {"golem": 1.0},
                "shift": {"golem": 0.4}}]
    sl, _ = ts.personal_plan(skilled, [gol1], SQ_THREATS, limit=1)
    row = sl["#S"][0]
    check("a skill shift raises the figure in log-odds, and says by how much",
          row["baseRate"] == gol1["expectedWinRate"]
          and row["expectedWinRate"] == ts.personal_rate(gol1["expectedWinRate"], 0.4)
          and row["skillShift"] == round(row["expectedWinRate"] - row["baseRate"], 1)
          and row["expectedWinRate"] > row["baseRate"], str(row))
    check("...and the per-archetype rates with it",
          all(row["vs"][a] == ts.personal_rate(v, 0.4) for a, v in ts.vs_archetypes(gol1).items()),
          str(row["vs"]))
    check("no shift, no change: the pool's own figure",
          ts.personal_rate(57.3, 0.0) == 57.3 and "skillShift" not in lists["#H1"][0])
    check("a negative record lowers it", ts.personal_rate(60.0, -0.3) < 60.0)

    # A DECK TWO PLAYERS WANT GOES TO THE ONE IT IS WORTH MORE TO.
    weak = {"tag": "#W", "own": [], "cards": set(), "wincons": {"hog-rider": 1.0}, "shift": {}}
    strong = {"tag": "#X", "own": [], "cards": set(), "wincons": {"hog-rider": 1.0},
              "shift": {"hog-rider": 0.3}}
    two, _ = ts.personal_plan([weak, strong], [hog1, hog2], SQ_THREATS, limit=1, new_slots=0)
    check("the better Hog list goes to the teammate rated higher with Hog",
          two["#X"][0]["name"] == "A" and two["#W"][0]["name"] == "B",
          str({t: [r["name"] for r in two[t]] for t in two}))

    # A SHORT LIST IS FILLED rather than left short: first past the new-slot
    # cap, then with a deck a teammate already holds.
    empty_hand = {"tag": "#N", "own": [], "cards": set(), "wincons": {}, "shift": {}}
    filled, _ = ts.personal_plan([empty_hand], pool, SQ_THREATS, limit=5, new_slots=1)
    check("a teammate with no history still gets a full list from the pool",
          len(filled["#N"]) == 5, str([r["name"] for r in filled["#N"]]))
    crowd = [dict(empty_hand, tag="#N%d" % i) for i in range(3)]
    crowded, _ = ts.personal_plan(crowd, [hog1, yard], SQ_THREATS, limit=5, new_slots=1)
    check("when the pool runs out, a teammate shares a deck rather than going short",
          all(len(crowded[t]) == 2 for t in crowded), str({t: len(crowded[t]) for t in crowded}))

    # THE NEW-WIN-CONDITION ROWS ARE CAPPED even when they are the strongest.
    many_new = [p_row(k, {"hog": 70 - i, "giant": 70 - i, "graveyard": 70 - i}, "wc-" + k)
                for i, k in enumerate(("A", "B", "C", "D", "E"))]
    fam_row = p_row("F", {"hog": 55, "giant": 55, "graveyard": 55}, "mortar")
    solo_new, _ = ts.personal_plan(
        [{"tag": "#M", "own": [], "cards": set(), "wincons": {"mortar": 1.0}, "shift": {}}],
        many_new + [fam_row], SQ_THREATS, limit=6, new_slots=2, min_list=0)
    check("five stronger decks of other win conditions: two are offered, beside their own",
          sum(1 for r in solo_new["#M"] if not r["familiar"]) == 2
          and "F" in [r["name"] for r in solo_new["#M"]],
          str([(r["name"], r["familiar"]) for r in solo_new["#M"]]))

    # A TOP-UP KEEPS WHAT THE LIST HAD: their own weaker deck is not pushed off
    # by the shared decks that fill it.
    weak_own = p_row("H", {"hog": 52, "giant": 52, "graveyard": 52}, "sparky",
                     owner={"tag": "#P1", "name": "P1"}, games=20)
    hogs = [p_row(k, {"hog": 70 - i, "giant": 70 - i, "graveyard": 70 - i}, "wc-" + k)
            for i, k in enumerate(("A", "B", "C"))]
    kept, _ = ts.personal_plan(
        [{"tag": "#P0", "own": [], "cards": set(), "shift": {},
          "wincons": {"wc-A": 0.34, "wc-B": 0.33, "wc-C": 0.33}},
         {"tag": "#P1", "own": [weak_own], "cards": set(), "wincons": {"sparky": 1.0}, "shift": {}}],
        hogs, SQ_THREATS, limit=3, new_slots=0, min_list=3)
    check("a list topped up with shared decks keeps the teammate's own deck",
          "H" in [r["name"] for r in kept["#P1"]] and len(kept["#P1"]) == 3,
          str([r["name"] for r in kept["#P1"]]))

    # THEIR OWN DECK is always theirs: familiar, eight known cards, never taken.
    mine = p_row("G", {"hog": 58, "giant": 58, "graveyard": 58}, "goblin-drill",
                 owner={"tag": "#O", "name": "O"}, games=30)
    own_lists, _ = ts.personal_plan(
        [{"tag": "#O", "own": [mine], "cards": set(SQ_DECKS["G"]), "wincons": {"goblin-drill": 1.0},
          "shift": {}}], [hog1], SQ_THREATS, limit=2, new_slots=1)
    own_row = next(r for r in own_lists["#O"] if r.get("owner"))
    check("an owned deck is familiar with eight known cards",
          own_row["familiar"] and own_row["known"] == 8, str(own_row))

    # NOTHING SCORED IS NOTHING SHOWN.
    none, cov0 = ts.personal_plan([dict(empty_hand)], [], SQ_THREATS)
    check("a teammate with nothing scored gets an empty list", none["#N"] == [])
    check("and every archetype is reported unanswered", not any(c["answered"] for c in cov0))


def property_lineup():
    print("")
    print("property — 5.0: who takes whom")
    v = {("#a", "#X"): 60.0, ("#a", "#Y"): 55.0, ("#b", "#X"): 59.0, ("#b", "#Y"): 50.0}
    got = ts.lineup(v, ["#a", "#b"], ["#X", "#Y"])
    check("the pairing with the highest total, not each opponent's best teammate",
          [(x["blue"], x["red"]) for x in got] == [("#b", "#X"), ("#a", "#Y")], str(got))
    check("each row carries the figure it was chosen on",
          [x["winRate"] for x in got] == [59.0, 55.0], str(got))
    more_red = ts.lineup({("#a", "#X"): 60.0, ("#a", "#Y"): 70.0, ("#a", "#Z"): 50.0},
                         ["#a"], ["#X", "#Y", "#Z"])
    check("more opponents than teammates: every teammate is paired, once",
          [(x["blue"], x["red"]) for x in more_red] == [("#a", "#Y")], str(more_red))
    more_blue = ts.lineup({("#a", "#X"): 50.0, ("#b", "#X"): 65.0, ("#c", "#X"): 60.0},
                          ["#a", "#b", "#c"], ["#X"])
    check("more teammates than opponents: the best one is chosen",
          [(x["blue"], x["red"]) for x in more_blue] == [("#b", "#X")], str(more_blue))
    gap = ts.lineup({("#a", "#X"): 60.0}, ["#a", "#b"], ["#X", "#Y"])
    check("a teammate with nothing against an opponent is still paired, figure None",
          len(gap) == 2 and {x["red"] for x in gap} == {"#X", "#Y"}
          and next(x for x in gap if x["red"] == "#Y")["winRate"] is None, str(gap))
    check("nobody on a side is no lineup", ts.lineup({}, [], ["#X"]) == [])
    import itertools as _it
    import random as _rnd
    r = _rnd.Random(3)
    blues = ["#b%d" % i for i in range(5)]
    reds = ["#r%d" % i for i in range(5)]
    vals = {(b, x): round(r.uniform(40, 70), 1) for b in blues for x in reds}
    best = max(sum(vals[(b, x)] for b, x in zip(perm, reds)) for perm in _it.permutations(blues))
    got5 = ts.lineup(vals, blues, reds)
    check("it is exact: on 5 v 5 it matches every permutation tried",
          abs(sum(x["winRate"] for x in got5) - best) < 1e-9,
          "%s vs %s" % (sum(x["winRate"] for x in got5), best))


def property_counters_not_specific():
    print("")
    print("property — 5.0: a teammate's list does not use 4.1's specificity rules")
    plays = [{"family": "hog", "share": 0.4}, {"family": "giant", "share": 0.35},
             {"family": "graveyard", "share": 0.25}]
    rows = []
    for i, k in enumerate(("A", "B", "C")):
        r = sq_row(k, {"hog": 66 - i, "giant": 66 - i, "graveyard": 66 - i})
        r["fieldRate"] = 65.0 - i      # each one as good against everybody: all-round
        rows.append(r)
    spec = ts.counters(rows, plays, limit=3)
    plain = ts.counters(rows, plays, limit=3, specific=False)
    check("with the rules one all-round row is held and the rest are fill",
          sum(1 for r in spec if r.get("allRound")) == 3 and len(spec) == 3, str(spec))
    check("without them no row is marked all-round",
          not any(r.get("allRound") for r in plain) and len(plain) == 3)
    check("and the order is the figure printed",
          [r["name"] for r in plain] == ["A", "B", "C"], str([r["name"] for r in plain]))


def property_wincon_variety_and_floor():
    print("")
    print("property — 5.0: one list per win condition, and nothing under 50%")
    plays = [{"family": "hog", "share": 0.45}, {"family": "giant", "share": 0.30},
             {"family": "graveyard", "share": 0.25}]
    # Two Hog Rider lists at the top, a Golem list under them, and a weaker
    # list that is the only real answer to Graveyard.
    a = p_row("A", {"hog": 70, "giant": 68, "graveyard": 40}, "hog-rider")
    b = p_row("B", {"hog": 69, "giant": 67, "graveyard": 41}, "hog-rider")
    c = p_row("C", {"hog": 60, "giant": 58, "graveyard": 46}, "golem")
    d = p_row("D", {"hog": 50, "giant": 50, "graveyard": 70}, "graveyard")
    e = p_row("E", {"hog": 44, "giant": 45, "graveyard": 46}, "lava-hound")
    # Two rows: A and C are chosen first (D is weaker than C overall), then
    # the repair path must swap C for D, the only answer to Graveyard.
    one = ts.counters([a, b, c, d, e], plays, limit=2, by_wincon=True, per_family=1,
                      floor_only=True, specific=False)
    names = [r["name"] for r in one]
    check("one list of a win condition: the second Hog Rider list gives way",
          "A" in names and "B" not in names, str(names))
    check("the answer to a family they really play is swapped in (the repair path runs "
          "with the win-condition cap on)", names == ["A", "D"] and "graveyard" in one[[r["name"] for r in one].index("D")]["answers"],
          str([(r["name"], r.get("answers")) for r in one]))
    check("no row under 50% is listed", all(r["expectedWinRate"] >= ts.FLOOR_RATE for r in one))
    two = ts.counters([a, b, c, d, e], plays, limit=3, by_wincon=True, per_family=2,
                      floor_only=True, specific=False)
    check("two allowed: both Hog Rider lists may stand",
          {"A", "B"} <= {r["name"] for r in two}, str([r["name"] for r in two]))
    low = ts.counters([e], plays, limit=3, floor_only=True)
    check("when nothing clears 50%, floor_only lists nothing", low == [], str(low))
    check("...and without it one row still says so", len(ts.counters([e], plays, limit=3)) == 1)


def property_family_cap_and_familiar_first():
    print("")
    print("property — 5.1: one deck of a family on a list, a teammate's families first")
    plays = [{"family": "hog", "share": 0.5}, {"family": "giant", "share": 0.3},
             {"family": "graveyard", "share": 0.2}]
    # Battle Ram and Ram Rider lists: two win-condition CARDS, one family.
    ram = p_row("A", {"hog": 66, "giant": 66, "graveyard": 66}, "battle-ram")
    ram["winFamily"] = "bridge-spam"
    rider = p_row("B", {"hog": 65, "giant": 65, "graveyard": 65}, "ram-rider")
    rider["winFamily"] = "bridge-spam"
    gol = p_row("C", {"hog": 58, "giant": 58, "graveyard": 58}, "golem")
    gol["winFamily"] = "golem"
    got = ts.counters([ram, rider, gol], plays, limit=3, by_wincon=True, per_family=1,
                      floor_only=True, specific=False)
    check("two lists of one FAMILY (Bridge Spam) are one row, the stronger",
          [r["name"] for r in got] == ["A", "C"], str([r["name"] for r in got]))
    rows = []
    for i, k in enumerate(("A", "B", "C", "D", "E")):
        r = p_row(k, {"hog": 68 - i / 2, "giant": 68 - i / 2, "graveyard": 68 - i / 2}, "wc-" + k)
        r["winFamily"] = "f-" + k
        rows.append(r)
    mine = p_row("F", {"hog": 65.5, "giant": 65.5, "graveyard": 65.5}, "mortar")
    mine["winFamily"] = "mortar"
    one = [{"tag": "#M", "own": [], "cards": set(), "wincons": {"mortar": 0.9}, "shift": {}}]
    lists, _ = ts.personal_plan(one, rows + [mine], SQ_THREATS, limit=3, new_slots=3,
                                min_list=0, per_wincon=1)
    names = [r["name"] for r in lists["#M"]]
    check("within FAMILIAR_FIRST points, a deck of the teammate's own win condition takes "
          "the place of a stranger's", "F" in names and len(names) == 3 and ts.FAMILIAR_FIRST == 3.0,
          str(names))
    check("...and the list still reads strongest first", names == ["A", "B", "F"], str(names))
    far = dict(mine, expectedWinRate=55.0, matchupValue=55.0, recommendationScore=55.0)
    far_lists, _ = ts.personal_plan(one, rows + [far], SQ_THREATS, limit=3, new_slots=3,
                                    min_list=0, per_wincon=1)
    check("...but a stranger's deck clearly stronger keeps it",
          "F" not in [r["name"] for r in far_lists["#M"]], str([r["name"] for r in far_lists["#M"]]))
    # Two Mortar players, two Mortar lists: one each, not both to the first.
    m1 = p_row("A", {"hog": 66, "giant": 66, "graveyard": 66}, "mortar")
    m2 = p_row("B", {"hog": 62, "giant": 62, "graveyard": 62}, "mortar")
    for r in (m1, m2):
        r["winFamily"] = "mortar"
    two, _ = ts.personal_plan(
        [{"tag": "#P", "own": [], "cards": set(), "wincons": {"mortar": 1.0}, "shift": {}},
         {"tag": "#Q", "own": [], "cards": set(), "wincons": {"mortar": 0.8}, "shift": {}}],
        [m1, m2], SQ_THREATS, limit=3, new_slots=0, min_list=0, per_wincon=1)
    check("two players of one family each get one of its lists, the stronger to the bigger share",
          [r["name"] for r in two["#P"]] == ["A"] and [r["name"] for r in two["#Q"]] == ["B"],
          str({t: [r["name"] for r in two[t]] for t in two}))


def main() -> int:
    print("team_scout — the coaching brain")
    case_1_many_known_decks()
    case_2_thin_history()
    case_3_one_deck_dominates()
    case_4_likely_but_bad_matchup()
    case_5_unseen_but_related()
    case_6_no_evidence()
    case_7_duplicates()
    case_8_player_compatibility()
    property_mass_sums_to_one()
    property_inference_is_never_disguised()
    property_thin_evidence_widens()
    property_recency_is_read()
    property_contract()
    property_types_and_explanations()
    property_degradation()
    property_portfolio_is_not_padded()
    property_fills_follow_coach_assist()
    property_suggest_ranks_together()
    property_squad_plan()
    property_personal_plan()
    property_lineup()
    property_counters_not_specific()
    property_wincon_variety_and_floor()
    property_family_cap_and_familiar_first()
    property_speedups_are_exact()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
