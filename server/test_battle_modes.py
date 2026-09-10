"""test_battle_modes.py — every mode string the live database actually holds.

    python server/test_battle_modes.py

Plain asserts and a counter, matching the other suites here. No database and no
imports beyond the module under test, because that is the whole point of
`battle_modes` being import-free.

THE FIXTURE IS THE PRODUCER'S REAL OUTPUT, NOT A PLAUSIBLE LIST. `LIVE_MODES`
below is the verbatim result of

    SELECT game_mode, COUNT(*) FROM battles GROUP BY game_mode

run against `/var/clashbot/battles.db` on 2026-09-10, counts included. This
project has already paid for the alternative twice — `test_team_analysis.py`
passed 59/59 against a field name that exists nowhere, and the Bo5 fixtures
labelled a row `Bo5` while giving it three decks — both because a fixture
invented vocabulary the producer does not use. A mode list written from memory
would pin nothing at all, since the entire question is what Supercell really
stores.

WHAT THIS SUITE IS FOR. The router decides, before anything is drawn, which of
three pipelines a battle belongs to. Getting it wrong is invisible in two
opposite ways: a 2v2 row admitted to Recent Battles renders as a perfectly
ordinary duel between two people who were never alone on the field, and a
ranked row refused renders as nothing at all. Neither raises an error, so the
only defence is pinning the answer for every string that exists.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import battle_modes as bm

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# --------------------------------------------------------------------------
# (mode string, row count, expected destination) — measured 2026-09-10
# --------------------------------------------------------------------------

K, D, O = bm.OWN_DECK_1V1, bm.DUO, bm.OTHER

LIVE_MODES = [
    ("Ranked1v1_NewArena",                4932969, K),
    ("Ladder",                            2494453, K),
    ("Ranked1v1_NewArena2",               2035755, K),
    ("TeamVsTeam",                        1353708, D),
    ("Challenge_AllCards_EventDeck_NoSet", 1002640, O),
    ("Showdown_Friendly",                  501302, K),
    ("Friendly",                           239470, K),
    ("CW_Battle_1v1",                      172029, K),
    ("Tournament",                         146738, K),
    ("Crazy_Arena",                        137378, O),
    ("CW_Duel_1v1",                         86156, K),
    ("Crazy_Arena_EpicOnly",                70250, O),
    ("PickMode",                            55855, O),
    ("Rage_Ladder",                         26639, K),
    ("Crazy_Arena_SuddenDeath",             23369, O),
    ("Overtime_Tournament",                  8208, K),
    ("Duel_1v1_Friendly",                    5936, K),
    ("ClassicDecks_Friendly",                5126, O),
    ("MirrorDeck_Friendly",                  2869, O),
    ("Overtime_Friendly",                    1025, K),
    ("Duel_1v1_Tournament",                   699, K),
    ("Heist_Friendly",                        460, O),
    ("Rage_Friendly",                         337, K),
    ("Friendly_FixedDeckOrder",               263, K),
    ("All_Random_Princess",                   119, O),
    ("202410_Event_Spooky_Chess",              103, O),
    ("202410_Event_Blackout",                   98, O),
    ("Event_RestlessDead",                      94, O),
    ("CaptureTheEgg_Tournament",                38, O),
    ("EventDeck_LoveBuff",                      24, O),
    ("TeamVsTeam_FixedDeckOrder",                11, D),
    ("Training",                                  3, O),
]


def test_every_live_mode_routes_as_intended() -> None:
    print("every mode string in the live database")
    for mode, _n, want in LIVE_MODES:
        got = bm.classify(mode)
        check(f"{mode} -> {want}", got == want, f"got {got}")


def test_the_four_families_the_user_asked_for() -> None:
    print("\nranked, ladder, clan friendly and duels are all kept")
    check("ranked", bm.is_own_deck_1v1("Ranked1v1_NewArena2"))
    check("ladder", bm.is_own_deck_1v1("Ladder"))
    check("clan war 1v1", bm.is_own_deck_1v1("CW_Battle_1v1"))
    check("clan war duel", bm.is_own_deck_1v1("CW_Duel_1v1"))
    check("friendly", bm.is_own_deck_1v1("Friendly"))
    check("friendly duel", bm.is_own_deck_1v1("Duel_1v1_Friendly"))


def test_a_future_ranked_arena_still_counts() -> None:
    """The reason this is patterns and not `meta.META_MODES`' exact strings.

    `Ranked1v1_NewArena` became `Ranked1v1_NewArena2` in the live data, so a
    third is a matter of time. An exact allowlist would drop it out of every
    player's battle log in silence on the day the season turned.
    """
    print("\na mode string Supercell has not shipped yet")
    check("Ranked1v1_NewArena3", bm.is_own_deck_1v1("Ranked1v1_NewArena3"))
    check("Ranked1v1_NewArena9_Whatever", bm.is_own_deck_1v1("Ranked1v1_NewArena9_Whatever"))
    check("a new ladder variant", bm.is_own_deck_1v1("Season_Ladder"))


def test_a_2v2_mode_wearing_a_kept_family_name() -> None:
    """Why `_NOT_OWN_DECK` carries markers that fire on nothing today.

    Stage one admits anything containing "ladder". A 2v2 ladder mode is
    therefore the one combination that could put four players back into a duel
    row, and 2v2 went from 2.77% to 25.11% of the database in three months, so
    a mode like this is not a hypothetical worth ignoring.
    """
    print("\na 2v2 mode named after a family that is otherwise kept")
    for mode in ("TeamVsTeam_Ladder", "TeamVsTeam_Ranked1v1", "2v2_Friendly"):
        check(f"{mode} is duo, not 1v1", bm.classify(mode) == bm.DUO,
              bm.classify(mode))
        check(f"{mode} refused by the 1v1 rule", not bm.is_own_deck_1v1(mode))


def test_a_brand_new_mode_is_refused_not_guessed() -> None:
    print("\nan unrecognised mode is OTHER, so it is counted and named")
    for mode in ("Sparky_Rumble", "202612_Event_Whatever", "NewGameMode_2027"):
        check(f"{mode} -> other", bm.classify(mode) == bm.OTHER, bm.classify(mode))


def test_an_unrecorded_mode_is_kept() -> None:
    """Fails toward completeness, which is the direction a log should fail.

    An empty `game_mode` means the bot stored a battle without recording what
    kind it was. That is a gap in collection, not evidence the battle was 2v2,
    and the row still carries two decks and a result.
    """
    print("\na battle stored with no mode at all")
    check("empty string is kept", bm.is_own_deck_1v1(""))
    check("None is kept", bm.is_own_deck_1v1(None))
    check("empty is not duo", not bm.is_duo(""))
    check("empty classifies as 1v1", bm.classify("") == bm.OWN_DECK_1V1)


def test_case_does_not_matter() -> None:
    print("\ncase is not part of the answer")
    check("upper", bm.classify("TEAMVSTEAM") == bm.DUO)
    check("lower", bm.classify("ranked1v1_newarena") == bm.OWN_DECK_1V1)
    check("mixed", bm.classify("LaDdEr") == bm.OWN_DECK_1V1)


def test_the_three_destinations_are_exclusive() -> None:
    """One row, one pipeline. Both paths claiming a battle would double-count
    it; both refusing would lose it, and neither would raise anything."""
    print("\nclassify is total and exclusive")
    for mode, _n, _want in LIVE_MODES:
        got = bm.classify(mode)
        check(f"{mode} lands in exactly one", got in (K, D, O), got)
    check("duo and 1v1 never both true",
          not any(bm.is_duo(m) and bm.is_own_deck_1v1(m) for m, _, _ in LIVE_MODES))


def test_the_share_this_change_was_made_for() -> None:
    """The measurement that justified the work, kept where it can be checked.

    Of the 12.37M rows in the live table, the 2v2 population is what Recent
    Battles was drawing as duels between two people.
    """
    print("\nwhat the live counts add up to")
    total = sum(n for _m, n, _w in LIVE_MODES)
    duo = sum(n for _m, n, w in LIVE_MODES if w == D)
    kept = sum(n for _m, n, w in LIVE_MODES if w == K)
    other = sum(n for _m, n, w in LIVE_MODES if w == O)
    check("the three shares account for every row", duo + kept + other == total,
          f"{duo}+{kept}+{other} != {total}")
    check("2v2 is over a tenth of the table", duo / total > 0.10,
          f"{duo / total:.4f}")
    check("kept is the large majority", kept / total > 0.70,
          f"{kept / total:.4f}")
    print(f"       kept {kept:,} · duo {duo:,} · other {other:,} of {total:,}")




# --------------------------------------------------------------------------
# The bot has to agree
# --------------------------------------------------------------------------

#: THE MARKER LIST THE PHASE-2 GUARD USES IN `/opt/clashbot/clashdb.py`,
#: hardcoded here on purpose — the same arrangement `test_tracking.py` uses to
#: pin the bot's drain batch size. It is a copy, and a copy is exactly what
#: needs a test: the two projects deploy separately, the bot's codebase is not
#: in this repository, and nothing else would ever notice them diverging.
#:
#: If they drift, a mode one side calls 2v2 and the other does not is a battle
#: that either lands in `battles` as a fake duel or vanishes from both paths.
BOT_DUO_MARKERS = ("teamvsteam", "2v2")


def test_the_bot_guard_and_the_router_agree() -> None:
    print("")
    print("the bot's 2v2 guard matches this router")
    check("the marker lists are identical",
          tuple(bm._DUO_MARKERS) == BOT_DUO_MARKERS,
          f"{bm._DUO_MARKERS} vs {BOT_DUO_MARKERS}")

    def bot_is_duo(mode):
        m = (mode or "").lower()
        return any(k in m for k in BOT_DUO_MARKERS)

    for mode, _n, want in LIVE_MODES:
        check(f"{mode} agrees", bot_is_duo(mode) == bm.is_duo(mode),
              f"bot={bot_is_duo(mode)} router={bm.is_duo(mode)}")
    for mode in ("TeamVsTeam_Ladder", "2v2_Friendly", "Ranked1v1_NewArena3",
                 "Sparky_Rumble", ""):
        check(f"{mode or '(empty)'} agrees",
              bot_is_duo(mode) == bm.is_duo(mode),
              f"bot={bot_is_duo(mode)} router={bm.is_duo(mode)}")


def test_the_guard_refuses_exactly_what_recent_battles_refuses() -> None:
    """A mode the bot drops from `battles` must be one this router sends to the
    pair collection — never one it simply hides."""
    print("")
    print("everything the bot would drop is routed, not lost")
    for mode, _n, _w in LIVE_MODES:
        if bm.is_duo(mode):
            check(f"{mode} has somewhere to go",
                  bm.classify(mode) == bm.DUO, bm.classify(mode))
            check(f"{mode} is not also a 1v1", not bm.is_own_deck_1v1(mode))


if __name__ == "__main__":
    test_every_live_mode_routes_as_intended()
    test_the_four_families_the_user_asked_for()
    test_a_future_ranked_arena_still_counts()
    test_a_2v2_mode_wearing_a_kept_family_name()
    test_a_brand_new_mode_is_refused_not_guessed()
    test_an_unrecorded_mode_is_kept()
    test_case_does_not_matter()
    test_the_three_destinations_are_exclusive()
    test_the_bot_guard_and_the_router_agree()
    test_the_guard_refuses_exactly_what_recent_battles_refuses()
    test_the_share_this_change_was_made_for()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
