"""test_player_trends.py — the daily series behind the player screen's charts.

    python server/test_player_trends.py

Plain asserts and a counter, matching the other suites here. A real SQLite file
IS opened, but it is a temporary one this module writes; nothing touches the
real database.

The series carries a win rate per day, and on a day a deck had no games that
rate is a placeholder 0.0, not a result. `games` (2026-09-28) is what tells the
two apart, and what lets the client weight a day by how much was played on it.
These checks pin that `games` is present, aligned with the days, equal to the
real per-day counts, and consistent with the rate beside it.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile

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


TAG = "#TEST123"
CARDS_A = ["hog-rider", "musketeer", "cannon", "ice-spirit", "skeletons", "fireball", "the-log", "ice-golem"]
CARDS_B = ["giant", "sparky", "zap", "mini-pekka", "musketeer", "fireball", "the-log", "electro-wizard"]


def _make_db(path, battles):
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE battles (player_tag TEXT, battle_time TEXT, result TEXT,"
        " player_crowns INT, opponent_crowns INT, player_deck_hash TEXT)"
    )
    con.execute(
        "CREATE TABLE decks (deck_hash TEXT, archetype TEXT, avg_elixir REAL,"
        " win_condition TEXT, cards TEXT)"
    )
    con.execute("CREATE TABLE player_names (tag TEXT, name TEXT)")
    con.execute("CREATE TABLE tracked_players (tag TEXT)")
    con.executemany("INSERT INTO battles VALUES (?,?,?,?,?,?)", battles)
    con.executemany(
        "INSERT INTO decks VALUES (?,?,?,?,?)",
        [
            ("A", "hog_rider", 2.6, "hog-rider", json.dumps(CARDS_A)),
            ("B", "giant", 3.9, "giant", json.dumps(CARDS_B)),
        ],
    )
    con.execute("INSERT INTO player_names VALUES (?, ?)", (TAG, "Tester"))
    con.commit()
    con.close()


def b(day, deck, result):
    return (TAG, "202609%02dT120000.000Z" % day, result, 1, 0, deck)


# Deck A: day 1 three games (2 won), day 3 one game (lost).
# Deck B: day 2 two games (both won). Nobody plays on a day that is not listed.
ROWS = [
    b(1, "A", "win"), b(1, "A", "win"), b(1, "A", "loss"),
    b(2, "B", "win"), b(2, "B", "win"),
    b(3, "A", "loss"),
]

TMP = tempfile.mkdtemp(prefix="player-trends-test-")
DB = os.path.join(TMP, "battles.db")
_make_db(DB, ROWS)

# The report walks the real storage tiers and looks up observed art; point the
# first at the scratch file and stub the second, which is not under test.
cd._tier_paths = lambda: [DB]
cd.deck_art = lambda tag, hashes, until=None: ({}, {})

r = cd.player_report(TAG)
check("a report comes back", r is not None)
trends = (r or {}).get("trends", {})
days = trends.get("days", [])
series = {s["deckHash"]: s for s in trends.get("series", [])}

check("the days are the days anyone played", days == ["2026-09-01", "2026-09-02", "2026-09-03"], str(days))
check("every series carries `games`", all("games" in s for s in series.values()), str(list(series.values())[:1]))
check(
    "`games` is aligned with the days",
    all(len(s["games"]) == len(days) == len(s["win"]) == len(s["use"]) for s in series.values()),
)
check("deck A's games per day are the real counts", series.get("A", {}).get("games") == [3, 0, 1], str(series.get("A")))
check("deck B's games per day are the real counts", series.get("B", {}).get("games") == [0, 2, 0], str(series.get("B")))

a = series.get("A", {})
check(
    "a day with no games is the only day with a 0 game count",
    a.get("win", [None])[1] == 0.0 and a.get("games", [None])[1] == 0,
    str(a),
)
check(
    "a day played and lost keeps its games, so it is not mistaken for a gap",
    a.get("win", [None, None, None])[2] == 0.0 and a.get("games", [0, 0, 0])[2] == 1,
    str(a),
)
check(
    "the rate and the count agree: wins recovered from them match the rows",
    round(a["win"][0] * a["games"][0] / 100) == 2 if a else False,
    str(a),
)
check(
    "`games` sums to the deck's matches",
    all(sum(s["games"]) == d["matches"] for d in r["decks"] for s in [series.get(d["deckHash"])] if s),
)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
