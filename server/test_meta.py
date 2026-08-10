"""test_meta.py — invariants of the meta leaderboard's selection rules.

    python server/test_meta.py

Synthetic rows only; no database is opened. Covers the two rules that decide
what the board actually claims, one of which exists because the first version
got it wrong on real data (see MIN_PLAYERS in meta.py).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meta  # noqa: E402

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


def row(h, n, players, w=None):
    return {"h": h, "n": n, "players": players, "w": n // 2 if w is None else w, "d": 0}


print("\nthe distinct-player floor")

# The real case this exists for: a deck with plenty of battles but almost all
# from one account. 1,703 battles / 8.5% win rate / one grinder.
rows = [
    row("popular", 500, 300),
    row("grinder", 1703, 2, w=144),
    row("also-real", 400, 120),
]
board, total, excluded = meta.select_board(rows, min_players=25)
hashes = [r["h"] for r in board]
check(
    "a deck played by 2 people is not the meta",
    "grinder" not in hashes,
    f"board={hashes}",
)
check("real decks survive", hashes == ["popular", "also-real"], f"got {hashes}")
check("the excluded count is reported", excluded == 1, f"got {excluded}")

check(
    "use rate counts ALL play, not just the board",
    total == 500 + 1703 + 400,
    f"got {total} — excluding the grinder's battles from the denominator would "
    f"inflate every surviving deck's use rate",
)

# Without the floor the grinder would top the board on volume alone, which is
# exactly what shipped first.
board_nofloor, _, _ = meta.select_board(rows, min_players=1)
check(
    "without the floor the grinder ranks first",
    board_nofloor[0]["h"] == "grinder",
    "this is the behaviour the floor exists to prevent",
)


print("\nranking")

rows = [row("a", 10, 50), row("b", 90, 50), row("c", 50, 50)]
board, _, _ = meta.select_board(rows, min_players=1)
check("ranked by battles descending", [r["h"] for r in board] == ["b", "c", "a"])

check(
    "board size is capped",
    len(meta.select_board([row(f"d{i}", 100 - i, 50) for i in range(80)], min_players=1, size=50)[0])
    == 50,
)

# Ties on battle count are constant at the tail; falling through to row order
# would reshuffle the board on identical data.
tied = [row("zzz", 100, 50), row("aaa", 100, 50), row("mmm", 100, 50)]
check(
    "ties break deterministically on the hash",
    [r["h"] for r in meta.select_board(tied, min_players=1)[0]] == ["aaa", "mmm", "zzz"],
)


print("\nedge cases")

check("an empty window does not raise", meta.select_board([], min_players=25) == ([], 0, 0))
check(
    "a board where nothing clears the floor is empty, not wrong",
    meta.select_board([row("x", 9999, 1)], min_players=25)[0] == [],
)
check(
    "null counts are treated as zero rather than raising",
    meta.select_board([{"h": "x", "n": None, "players": None, "w": 0, "d": 0}], min_players=0)[1]
    == 0,
)


print("\ndeck naming")

# The archetype alone is not unique: clustering merges tech variants but cannot
# merge genuinely different decks that share a win condition. A board of fifty
# printed "Hog" six times before the qualifier was added.
META = {
    "hog-rider": {"name": "Hog Rider", "elixir": 4, "is_win_condition": True},
    "musketeer": {"name": "Musketeer", "elixir": 4, "is_win_condition": False},
    "skeletons": {"name": "Skeletons", "elixir": 1, "is_win_condition": False},
    "earthquake": {"name": "Earthquake", "elixir": 3, "is_win_condition": False},
    "mortar": {"name": "Mortar", "elixir": 4, "is_win_condition": True},
}

a = meta._deck_name("hog", ["hog-rider", "musketeer", "skeletons"], META)
b = meta._deck_name("hog", ["hog-rider", "earthquake", "skeletons"], META)
check("two decks of one archetype get different names", a != b, f"{a!r} vs {b!r}")
check("the qualifier is the priciest support card", a == "Hog Musketeer", f"got {a!r}")
check(
    "a second win condition is never the qualifier",
    "Mortar" not in meta._deck_name("hog", ["hog-rider", "mortar", "skeletons"], META),
    "the qualifier distinguishes the SUPPORT, it does not name two win conditions",
)
check(
    "a deck with nothing to qualify on still gets a name",
    meta._deck_name("hog", ["hog-rider"], META) == "Hog",
)
check("an unknown archetype does not crash", meta._deck_name(None, [], META) == "Unknown Deck")


_DD_META = {
    "golem": {"name": "Golem", "elixir": 8},
    "elixir-collector": {"name": "Elixir Collector", "elixir": 6},
    "lightning": {"name": "Lightning", "elixir": 6},
    "tornado": {"name": "Tornado", "elixir": 3},
    "zap": {"name": "Zap", "elixir": 2},
}
_dd = [
    {"name": "Golem Elixir Collector", "cards": ["golem", "elixir-collector", "lightning", "zap"], "avgElixir": 4.1},
    {"name": "Golem Elixir Collector", "cards": ["golem", "elixir-collector", "tornado", "zap"], "avgElixir": 4.3},
]
meta.dedupe_names(_dd, _DD_META)
check(
    "a still-colliding name gets a second qualifier",
    [d["name"] for d in _dd] == ["Golem Elixir Collector Lightning",
                                 "Golem Elixir Collector Tornado"],
    f"got {[d['name'] for d in _dd]}",
)


print("\nevolution art limits")

check(
    "art is confined to the three special slots",
    meta.SPECIAL_SLOTS == 3,
    "a cluster spans many players' evo choices; tallying all of them drew a deck "
    "with FIVE evolved cards. The cap is the game's own slot rule, not a "
    "magic number: 795 of 795 measured decks had every mark inside slots 0-2",
)
check("art needs a real share of the deck's battles", 0 < meta.ART_MIN_SHARE < 1)


print("\nmode scope")

check(
    "2v2 is not the meta",
    "teamvsteam" not in meta.META_MODES,
    "TeamVsTeam is 2v2 — deck choice is shared",
)
check(
    "event modes that hand you a deck are excluded",
    not any("event" in m or "crazy" in m or "random" in m for m in meta.META_MODES),
)
check(
    "friendlies and duels are excluded (they have their own screen)",
    not any("friendly" in m or "duel" in m for m in meta.META_MODES),
)
check("ladder and ranked 1v1 are included", "ladder" in meta.META_MODES
      and any(m.startswith("ranked1v1") for m in meta.META_MODES))


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
