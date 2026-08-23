"""test_duel_combos.py — invariants of the duel-combination logic.

    python server/test_duel_combos.py

Plain asserts and a counter, in the same style as Clash_Bot's own test files —
no pytest, nothing to install. Everything here runs on synthetic data: no
database is opened, so the suite passes on a machine with no Clash_Bot install
and cannot be broken by whatever a real player happened to do last week.

What is worth testing here is the logic that is easy to get quietly wrong: the
series rules (which decide what a duel even is), the selection budgets (which
decide whether a table is 24 facts or one deck sliced 24 ways), and the
evidence floors (which decide whether a percentage is printed at all).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_combos as dx  # noqa: E402

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


def rec(minute, cards, result="win", opp="#OPP"):
    """A synthetic battle. `minute` is minutes past an arbitrary epoch."""
    h, m = divmod(minute, 60)
    d, h = divmod(h, 24)
    return {
        "battle_time": "202608%02dT%02d%02d00.000Z" % (1 + d, h, m),
        "mode": "Friendly",
        "opponent_tag": opp,
        "result": result,
        "cards": cards,
        "evo": None,
    }


def deck(n):
    """Eight distinct card keys, disjoint between different n."""
    return [f"c{n}-{i}" for i in range(8)]


# ── mode classification ─────────────────────────────────────────────────────

print("\nmode classification")
check("native allowlist", dx.is_native_duel("CW_Duel_1v1") and dx.is_native_duel("Duel_1v1_Friendly"))
check(
    "unknown duel mode is NOT native (fails safe)",
    not dx.is_native_duel("Duel_1v1_Tournament"),
    "an unverified serialization must not be sliced into decks on an assumption",
)
check("ladder is not duel-like", not dx.is_duel_like_mode("Ranked1v1_NewArena2"))
check("friendly is duel-like", dx.is_duel_like_mode("Showdown_Friendly"))
check("clanmate is duel-like", dx.is_duel_like_mode("Clanmate_Battle"))
check("empty mode is safe", not dx.is_duel_like_mode("") and not dx.is_native_duel(""))


# ── series reconstruction ───────────────────────────────────────────────────

print("\nseries reconstruction")

s = dx._split_series([rec(0, deck(1)), rec(5, deck(2), "loss"), rec(10, deck(3))])
check("three card-disjoint games are one series", len(s) == 1 and len(s[0]) == 3)

s = dx._split_series([rec(0, deck(1)), rec(5, deck(2), "loss"), rec(200, deck(3))])
check(
    "a >30 min gap closes the series",
    len(s) == 1 and len(s[0]) == 2,
    f"got {[len(x) for x in s]}",
)

# Card reuse cannot happen inside one duel loadout, so it means a new duel.
s = dx._split_series([rec(0, deck(1)), rec(5, deck(2), "loss"), rec(10, deck(1)), rec(15, deck(3))])
check(
    "card reuse starts a new series",
    len(s) == 2 and [len(x) for x in s] == [2, 2],
    f"got {[len(x) for x in s]}",
)

# A 2-0 decides a Bo3 but arms exactly ONE dead rubber: players routinely play
# the decided third game to show their third deck.
s = dx._split_series([rec(0, deck(1)), rec(5, deck(2)), rec(10, deck(3), "loss")])
check("a 2-0 allows one more game, then closes", len(s) == 1 and len(s[0]) == 3)

# ...but a 2-1 is the real-Bo5 case and must NOT close, or a five-game series
# gets reported as two, one of them a fabricated tie.
s = dx._split_series(
    [
        rec(0, deck(1), "loss"),
        rec(5, deck(2), "loss"),
        rec(10, deck(3)),
        rec(15, deck(4)),
        rec(20, deck(5), "loss"),
    ]
)
check(
    "a 2-1 keeps a Bo5 alive",
    len(s) == 1 and len(s[0]) == 5,
    f"got {[len(x) for x in s]}",
)

check("a lone game is not a series", dx._split_series([rec(0, deck(1))]) == [])


# ── evolution slots ─────────────────────────────────────────────────────────

print("\nevolution slots")

d = deck(1)
raw = f'[["{d[0]}", 1, "evolution"], ["{d[3]}", 2, "hero"]]'
got = dx._evo_marks(raw, d)
check("player_evo is used when present", got.get(d[0]) == "evolution", f"got {got}")
check(
    "hero art is kept as HERO, not folded into evolution",
    got.get(d[3]) == "hero",
    "level-2 marks are served hero art; calling them evolutions draws the wrong card",
)
check(
    "cards from another deck are ignored",
    dx._evo_marks('[["not-in-this-deck", 1, "evolution"]]', d) == {},
)
check("malformed player_evo does not raise", dx._evo_marks("{{{", d) == {})
check(
    "nothing is claimed when player_evo is absent",
    dx._evo_marks(None, d) == {},
    "absence of marks means 'not told', which must stay distinct from 'ran none'",
)


# ── evidence ────────────────────────────────────────────────────────────────

print("\nevidence")

check(
    "no tier under the minimum sample",
    dx.confidence_tier(4, dx.CONF_MIN_GAMES - 1) == (None, None),
    "None means the claim is not made at all, not 'low confidence'",
)
tier, interval = dx.confidence_tier(300, 500)
check("a large sample earns high confidence", tier == "high" and interval, f"got {tier}")
check(
    "a 6-from-6 record is not reported as 100% +/- 0%",
    dx.confidence_tier(6, 6) == (None, None),
)
check("lockstep bands", (
    dx.classify_lockstep(80) == "locked"
    and dx.classify_lockstep(50) == "frequent"
    and dx.classify_lockstep(10) == "shared"
    and dx.classify_lockstep(None) == "unknown"
))
check("trustworthy gates ranking", dx.is_trustworthy("high") and not dx.is_trustworthy("low"))


# ── tab membership ──────────────────────────────────────────────────────────

print("\ntab membership")

evo = {"skeletons": 4, "tesla": 3, "hog-rider": 0}
check("win conditions needs only ONE", dx._in_tab("win-conditions", "hog-rider", "skeletons", evo))
check("spells needs BOTH", dx._in_tab("spells", "fireball", "the-log", evo))
check("one spell is not a spell combo", not dx._in_tab("spells", "fireball", "knight", evo))
check(
    "evolutions means BROUGHT in an evo slot, not merely can_evolve",
    dx._in_tab("evolutions", "skeletons", "tesla", evo)
    and not dx._in_tab("evolutions", "skeletons", "hog-rider", evo),
)
check(
    "tabs are independent — a pair may appear in two",
    dx._in_tab("win-conditions", "hog-rider", "skeletons", evo)
    and dx._in_tab("evolutions", "skeletons", "tesla", evo),
)


# ── selection budgets ───────────────────────────────────────────────────────
#
# The budgets are the whole reason a table is worth reading: a pair inherits the
# record of WHOLE DECKS, so without them one heavily-played deck contributes all
# 28 of its pairs and takes the top of every tab.

print("\nselection budgets")


def row(a, b, decks=5, games=50, top="deckA", tier="high"):
    return {
        "a": a, "b": b, "games": games, "wins": games // 2, "decks": decks,
        "slots": [games, 0, 0], "lock": 50.0, "tier": tier, "interval": "+/-5%",
        "top_deck": top, "top_share": 50.0,
    }


# Twenty-eight pairs all naming one deck — the failure mode being guarded.
one_deck = [row(f"x{i}", f"x{j}", top="theDeck") for i in range(8) for j in range(i + 1, 8)]
got = dx._select(one_deck, 24)
check(
    "one deck cannot dominate the table",
    len(got) <= dx.PAIR_DECK_CAP,
    f"took {len(got)} rows from a single deck (cap {dx.PAIR_DECK_CAP})",
)

# Same pairs spread over many decks: now the card cap is what limits things.
spread = [
    row(f"x{i}", f"x{j}", top=f"deck{i}{j}")
    for i in range(10)
    for j in range(i + 1, 10)
]
got = dx._select(spread, 24)
counts: dict[str, int] = {}
for r in got:
    counts[r["a"]] = counts.get(r["a"], 0) + 1
    counts[r["b"]] = counts.get(r["b"], 0) + 1
worst = max(counts.values()) if counts else 0
check(
    "no card exceeds the relaxed cap",
    worst <= dx.PAIR_CARD_CAP_RELAX,
    f"a card appeared {worst} times (cap {dx.PAIR_CARD_CAP_RELAX})",
)
check(
    "no pairing is taken twice",
    len({(r["a"], r["b"]) for r in got}) == len(got),
    "the three sweeps walk the same pool; `seen` is what stops a re-take",
)
check("selection fills when the pool allows", len(got) > 8, f"only {len(got)} rows")

# Evidence leads the ranking: an untrustworthy row loses to a trustworthy one
# even with more reach.
ranked = sorted(
    [row("a", "b", decks=30, tier=None), row("c", "d", decks=3, tier="high")],
    key=dx._pair_rank,
)
check(
    "a claim the page can stand behind outranks one it cannot",
    ranked[0]["a"] == "c",
    "reach must not promote a pairing with no usable sample",
)

# Reach beats volume within the trustworthy group — otherwise the grind deck's
# 28 pairs take every slot.
ranked = sorted(
    [row("a", "b", decks=2, games=900), row("c", "d", decks=20, games=60)],
    key=dx._pair_rank,
)
check("reach outranks raw volume", ranked[0]["a"] == "c")

# Ties must not fall through to iteration order — this project has shipped that
# bug twice.
tied = [row("z", "y"), row("a", "b"), row("m", "n")]
check(
    "ties break deterministically",
    [r["a"] for r in sorted(tied, key=dx._pair_rank)] == ["a", "m", "z"],
)


# --- the duel span -------------------------------------------------------
# An empty Evolutions tab is nearly always a DATE story: the payload only began
# carrying evolution slots part-way through the stored history, so a player whose
# duels all predate that shows 0 while their ladder history is full of evolutions.
# The tab quotes the span to say so, which means the span has to be right.
check("iso day from a battle stamp", dx._iso_day("20260726T131502.000Z") == "2026-07-26")
check("iso day tolerates a bare day", dx._iso_day("20260726") == "2026-07-26")
check("iso day of nothing is empty", dx._iso_day("") == "")
check("iso day rejects non-digits", dx._iso_day("not-a-time") == "")
check("iso day of None is empty", dx._iso_day(None) == "")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
