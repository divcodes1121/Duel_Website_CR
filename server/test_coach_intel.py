"""Checks for `coach_intel` — one player's intelligence, counted.

A scratch SQLite in the bot's `battles` shape, with ladder, friendly, 2v2 and
draft rows mixed together, so the mode router is exercised rather than
assumed. Nothing touches the real database.

Run: python server/test_coach_intel.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import coach_intel as ci  # noqa: E402

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


TAG = "#TEST123"
DECK = json.dumps([f"card{i}" for i in range(8)])


def row(day, hour=12, mode="Ranked1v1_NewArena2", result="win", opp="#RIVAL",
        name="Rival", arch="hog_rider", opp_arch="golem"):
    crowns, oc = {"win": (3, 0), "loss": (0, 1), "draw": (1, 1)}[result]
    return (TAG, "202608%02dT%02d0000.000Z" % (day, hour), mode, opp, name, result,
            DECK, DECK, arch, opp_arch, crowns, oc, None, None)


ROWS = [
    # Aug 1: two ladder wins against #RIVAL, one loss to #OTHER
    row(1, 10), row(1, 11), row(1, 12, result="loss", opp="#OTHER", name="Other", opp_arch="x_bow"),
    # Aug 2: nothing — a gap the timeline must keep as a zero day
    # Aug 3: a friendly draw against #RIVAL, a ladder win with another archetype
    row(3, 9, mode="Friendly", result="draw"),
    row(3, 18, arch="lava_hound", opp="#THIRD", name="Third"),
    # Out of scope for a 1v1 log: 2v2, a draft — counted as hidden, never scored
    row(3, 19, mode="TeamVsTeam"), row(3, 20, mode="TeamVsTeam"), row(3, 21, mode="PickMode"),
]

TMP = tempfile.mkdtemp(prefix="coach-intel-test-")
DB = os.path.join(TMP, "battles.db")
con = sqlite3.connect(DB)
con.execute(
    "CREATE TABLE battles (player_tag TEXT, battle_time TEXT, game_mode TEXT,"
    " opponent_tag TEXT, opponent_name TEXT, result TEXT, player_card_keys TEXT,"
    " opponent_card_keys TEXT, player_win_condition TEXT, opponent_win_condition TEXT,"
    " player_crowns INT, opponent_crowns INT, player_evo TEXT, opponent_evo TEXT)"
)
con.executemany("INSERT INTO battles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ROWS)
con.commit()
con.close()

# The scratch file stands in for the storage tiers. The bounds are built the
# way the REAL `tier_windows` builds them — `_compact` the dates, pad the upper
# one with U+FFFF so the whole last day is inside — or a window check would be
# testing a comparison the production path never makes.
cd.tier_windows = lambda tag, since, until: [
    (DB, cd._compact(since) or "00000000", (cd._compact(until) or "99999999") + "￿")
]
cd.player_name = lambda tag: "Tester"

r = ci.report(TAG)

# --- the mode router runs first --------------------------------------------
s = r["summary"]
check("only own-deck 1v1 battles are counted", s["battles"] == 5, str(s))
check("W / L / D", (s["wins"], s["losses"], s["draws"]) == (3, 1, 1), str(s))
check("2v2 and drafts are hidden, by raw mode", r["hiddenByMode"] == {"TeamVsTeam": 2, "PickMode": 1}, str(r["hiddenByMode"]))
check("...and their total", r["hidden"] == 3)

# --- the timeline -----------------------------------------------------------
days = [d["day"] for d in r["timeline"]]
check("one entry per day, first to last", days == ["2026-08-01", "2026-08-02", "2026-08-03"], str(days))
gap = r["timeline"][1]
check("a day with no battles is a ZERO day, not a missing one", gap["battles"] == 0 and gap["wins"] == 0)
check("each day carries its own record", (r["timeline"][0]["wins"], r["timeline"][0]["losses"]) == (2, 1))

# --- modes, archetypes ------------------------------------------------------
modes = {m["name"]: m["battles"] for m in r["modes"]}
check("modes are labelled the way the battle log labels them", modes == {"Ladder": 4, "Friendly": 1}, str(modes))
arch = [(a["key"], a["battles"]) for a in r["archetypes"]]
check("the player's archetypes, most-played first", arch == [("hog_rider", 4), ("lava_hound", 1)], str(arch))
check("archetypes carry display names", r["archetypes"][0]["name"] == cd._archetype_title("hog_rider"))
theirs = {a["key"]: a["battles"] for a in r["opponentArchetypes"]}
check("what they face is counted separately", theirs == {"golem": 4, "x_bow": 1}, str(theirs))

# --- opponents --------------------------------------------------------------
opp = [(o["tag"], o["battles"]) for o in r["opponents"]]
check("most-met opponent first", opp[0] == ("#RIVAL", 3), str(opp))
check("equal counts: the most recently met first", [t for t, _ in opp[1:]] == ["#THIRD", "#OTHER"], str(opp))
rival = r["opponents"][0]
check("an opponent carries their record against this player",
      (rival["wins"], rival["losses"], rival["draws"]) == (2, 0, 1), str(rival))
check("...their name", rival["name"] == "Rival")
check("...and the last time they met", rival["last"] == "20260803T090000.000Z", rival["last"])
check("distinct opponents and repeat opponents", (r["opponentsTotal"], r["opponentsRepeat"]) == (3, 1))

# --- decks ------------------------------------------------------------------
dk = r["decks"]
check("one deck (the fixture uses one list throughout)", r["decksTotal"] == 1 and len(dk) == 1, str(r["decksTotal"]))
check("counted over 1v1 only, like everything else", dk and (dk[0]["battles"], dk[0]["wins"]) == (5, 3), str(dk[0] if dk else None))
check("drawn by the battle log's helper: eight cards and a name", dk and len(dk[0]["cards"]) == 8 and dk[0]["deckName"])
check("with the newest sighting's time", dk and dk[0]["last"] == "20260803T180000.000Z", dk[0]["last"] if dk else "")

# --- form -------------------------------------------------------------------
check("current form is newest first", r["form"] == ["win", "draw", "loss", "win", "win"], str(r["form"]))

# --- the window -------------------------------------------------------------
w = ci.report(TAG, "2026-08-03", "2026-08-03")
check("a window narrows every figure together", w["summary"]["battles"] == 2 and len(w["timeline"]) == 1,
      f"{w['summary']} {len(w['timeline'])}")

empty = ci.report("#NOBODY")
check("a player with nothing stored gets empty lists, not errors",
      empty["summary"]["battles"] == 0 and empty["timeline"] == [] and empty["opponents"] == [])

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
