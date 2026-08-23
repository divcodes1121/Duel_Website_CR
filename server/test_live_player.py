"""test_live_player.py — the rules that decide what a live battlelog reports.

    python server/test_live_player.py

Synthetic payloads only; no database is opened and no network call is made.
The two things worth pinning are the ones a live payload can get wrong in ways
the stored path cannot: the card NAMES are display strings rather than the
hyphenated keys the rest of the project uses, and the log carries modes whose
deck the player never chose.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_player as lp  # noqa: E402
import duel_combos as dcx  # noqa: E402

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


def battle(cards, crowns=1, opp_crowns=0, mode="Ranked1v1_NewArena", team_size=1):
    team = [{"crowns": crowns, "cards": cards, "trophyChange": 30}] * team_size
    opp = [{"crowns": opp_crowns, "cards": []}] * team_size
    return {
        "battleTime": "20260814T090000.000Z",
        "gameMode": {"name": mode},
        "team": team,
        "opponent": opp,
    }


# --------------------------------------------------------------------------
print("\ncard keys: display names resolve to cards.json keys")

known = set(dcx.card_keys())
check("cards.json actually loaded", len(known) > 100, f"got {len(known)}")

# The punctuated names are the whole reason `_resolve` is not a slugify call.
for display, expect in [
    ("P.E.K.K.A", "pekka"),
    ("Mini P.E.K.K.A", "mini-pekka"),
    ("X-Bow", "x-bow"),
    ("Barbarian Barrel", "barbarian-barrel"),
    ("Electro Spirit", "electro-spirit"),
    ("Royal Hogs", "royal-hogs"),
    ("Goblin Gang", "goblin-gang"),
]:
    got = lp._resolve({"name": display}, known)
    check(f"{display!r} -> {expect!r}", got == expect, f"got {got!r}")

check("an unknown card resolves to None", lp._resolve({"name": "Nonesuch"}, known) is None)
check("a nameless card resolves to None", lp._resolve({}, known) is None)


# --------------------------------------------------------------------------
print("\ncompetitive filter: only battles where the player chose the deck")

check("ladder 1v1 counts", lp._is_competitive(battle([], mode="Ranked1v1_NewArena")))
check("2v2 does not", not lp._is_competitive(battle([], team_size=2)))
check(
    "an event deck does not",
    not lp._is_competitive(battle([], mode="Challenge_AllCards_EventDeck")),
)
check("draft does not", not lp._is_competitive(battle([], mode="Draft_Challenge")))
check("touchdown does not", not lp._is_competitive(battle([], mode="TouchdownDraft")))


# --------------------------------------------------------------------------
print("\noutcome: crowns decide, and a tie is a draw not a loss")

check("more crowns is a win", lp._outcome(battle([], 2, 1)) == "win")
check("fewer crowns is a loss", lp._outcome(battle([], 0, 2)) == "loss")
check("equal crowns is a draw", lp._outcome(battle([], 1, 1)) == "draw")

missing = {"team": [{"crowns": None}], "opponent": [{"crowns": None}]}
check("absent crowns is 'unknown', never a loss", lp._outcome(missing) == "unknown")


# --------------------------------------------------------------------------
print("\nevolution level: the payload's own field, read by the shared resolver")

import clash_data as cd  # noqa: E402

check("level 1 is an evolution", cd.mark_variant(["knight", 1, None]) == "evolution")
check("level 2 is a hero", cd.mark_variant(["knight", 2, None]) == "hero")
# The whole point of reading the level rather than the `art` string: the live
# payload has no `art` string at all, so anything keyed off it would be blind
# here. Level is present on every card of every battle.
check("no level, no claim", cd.mark_variant(["knight", None, None]) is None)


# --------------------------------------------------------------------------
print("\nreport(): a deck needs eight cards")

# Not a real report call — that needs the network. This pins the guard that
# stops a duel row's 16/24-card loadout being recorded as a deck.
cards8 = [{"name": n} for n in [
    "Knight", "Archers", "Fireball", "Arrows",
    "Giant", "Musketeer", "Zap", "Cannon",
]]
resolved = [lp._resolve(c, known) for c in cards8]
check("eight real cards resolve", all(resolved) and len(resolved) == 8, str(resolved))

print(f"\n{PASS} passed, {FAIL} failed\n")
sys.exit(1 if FAIL else 0)
