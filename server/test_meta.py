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
check("the qualifier is the priciest support card", a == "Hog Rider Musketeer", f"got {a!r}")
check(
    "a second win condition is never the qualifier",
    "Mortar" not in meta._deck_name("hog", ["hog-rider", "mortar", "skeletons"], META),
    "the qualifier distinguishes the SUPPORT, it does not name two win conditions",
)
check(
    "a deck with nothing to qualify on still gets a name",
    meta._deck_name("hog", ["hog-rider"], META) == "Hog Rider",
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


print("\nthe global card board")

# `player_deck_hash` IS the sorted card list, so the board's own grouped result
# is also a complete per-card tally. Two decks, sharing one card.
A = "arrows,cannon,fireball,goblins,hog-rider,ice-spirit,musketeer,skeletons"
B = "arrows,barbarians,giant,knight,minions,prince,wizard,zap"
ROWS = [
    {"h": A, "n": 100, "w": 60},
    {"h": B, "n": 50, "w": 20},
    # A duel loadout, not a deck — 16 cards. Must never be counted.
    {"h": ",".join(f"c{i}" for i in range(16)), "n": 999, "w": 999},
]
cards = meta.card_totals(ROWS, total=200)
by_key = {c["key"]: c for c in cards}

check(
    "a card's battles are its decks' battles",
    by_key["hog-rider"]["battles"] == 100 and by_key["giant"]["battles"] == 50,
)
check(
    "a card shared by two decks sums both",
    by_key["arrows"]["battles"] == 150 and by_key["arrows"]["wins"] == 80,
    "the pooling IS the point — a card's record is every deck holding it",
)
check("decks holding the card are counted", by_key["arrows"]["decks"] == 2)
check(
    "win rate is wins over that card's own battles",
    by_key["arrows"]["winRate"] == round(80 / 150 * 100, 1),
)
check(
    "use rate is a share of ALL battles in the window, not of the board",
    by_key["hog-rider"]["useRate"] == 50.0,
    "100 of the 200 competitive battles held Hog Rider",
)
check(
    "a 16-card duel loadout is never read as a deck",
    "c0" not in by_key,
    "those rows hold a whole 16- or 24-card loadout; splitting one would "
    "invent sixteen card records out of one battle. deck_counter._build_reps "
    "rejects the same shape for the same reason",
)
check(
    "ranking is deterministic — battles, then the key",
    [c["key"] for c in cards][:2] == sorted(
        [c["key"] for c in cards if c["battles"] == 150]
    )[:1] + [k for k in [c["key"] for c in cards] if k != "arrows"][:1],
    "ties must not depend on dict iteration order",
)

# Per-form: an evolved card is a different card and is scored as one.
FORMS = {
    "skeletons": {
        "base": {"battles": 40, "wins": 20},
        "evolution": {"battles": 10, "wins": 8},
    },
    # Never seen in a marked battle at all.
    "giant": {},
}
meta.merge_forms(cards, FORMS)
check(
    "an evolved card is scored apart from the plain one",
    by_key["skeletons"]["forms"]["evolution"]["winRate"] == 80.0
    and by_key["skeletons"]["forms"]["base"]["winRate"] == 50.0,
    "'the normal Skeletons will have a different use rate and win rate than "
    "evo Skeletons' — one counter for both was reporting eleven cards as "
    "evolved that cannot evolve at all",
)
check(
    "a form's share is of the MARKED battles, not of every battle",
    by_key["skeletons"]["forms"]["evolution"]["share"] == 20.0,
    "10 of the 50 battles that recorded a form; a share of all 100 would "
    "understate it by the coverage gap",
)
check(
    "a card with no marked battle gets no forms key at all",
    "forms" not in by_key["giant"] and "forms" not in by_key["arrows"],
    "'never observed in either form' and 'observed, zero' are different "
    "claims and the client has to be able to tell them apart",
)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
