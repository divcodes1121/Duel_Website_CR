"""card_counters.py — which card answers which, and what an opponent's CARDS say.

Asked for directly (2026-10-10): "there is a readme where it says what the
card is good against — like, the opponent plays a lot of P.E.K.K.A, Mega
Knight, high-dps decks, we can suggest decks with Ronin; if he uses fewer
Tornado decks we can go Balloon, Hog, hyper bait. We need a structure like
that for every card." And then how to use it: "figure 'this card counters
most of their archetypes', search decks for that card, use ranking to find the
top decks of that card, then compare each deck by matchup percentage against
the opponent's decks".

That is this file plus `team_analysis._by_card`:

    1. the opponent's CARDS, by how much of their play each is in   (`usage`)
    2. for every card, what it answers of those and what of theirs
       answers it — read off the card manual                        (`read`)
    3. the cards worth SEARCHING: one that answers something they
       really play, or a win condition they carry little against    (`worth`)
    4. the decks holding each such card, ranked by MEASURED matchup
       rate against the decks they play                (`team_analysis`)

THE MANUAL NAMES THE CARDS. THE DATABASE RANKS THE DECKS.
=========================================================

`src/data/cardRoles.json` is generated from the hand-written card manual
(`All_Cards_stats.md`, by `scripts/build-card-roles.py`): for every card, the
cards it counters and the cards that counter it. `DECK_TUNER.md` §5 already ruled that the
manual decides which cards are worth considering and never produces a number,
and that rule was checked against the future before this file used it:

    236,036 own-deck 1v1 games of 700 players, held out by time. Past a
    baseline of the player's own strength and the archetype matchup, the
    manual's relations between the two decks improved log loss by 0.0003;
    one net counter relation was worth 0.23 points of win rate, and the
    realised win rate ran 57.5% to 59.4% across the whole range of -6 to +6.

So a count of counter relations cannot rank a deck — a deck with six more
"counters" than its opponent wins two points more often, and a real matchup
record moves ten. Here the relations only (a) pick which cards are searched and
(b) say, in card art, why a card is on the screen. Every percentage beside
them is a measured rate.

NO DATABASE. The roles file is read softly: without it every function
answers empty and the caller simply has no card view.

THE MANUAL IS LIVING DATA (2026-10-10). The account holder edits it and pushes
the generated file to the server (`scripts/push-card-data.py`), so the file is
re-read when it changes on disk — `refresh()`, called by the one caller that
starts a card view, looks at its modification time at most every
`CHECK_EVERY_S`. No restart, and a request already running keeps the table it
started with.
"""

from __future__ import annotations

import json
import os
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROLES_PATH = os.path.join(_HERE, "..", "src", "data", "cardRoles.json")

#: A card of theirs is one they PLAY when it is in at least this share of
#: their games. One game in five: under it the card belongs to a side deck,
#: and "this answers their Sparky" would be advice against a deck they bring
#: once a week.
CORE_USE = 0.20

#: Cards of theirs listed on the screen, most used first.
SHOWN_CARDS = 10

#: A WIN CONDITION is worth searching when the cards of theirs that answer it
#: are, between them, in at most this many of their games' worth of slots —
#: "he uses fewer Tornado decks, we can go Balloon". 0.6: on average fewer
#: than two of their games in three hold even one answer to it.
OPEN_EXPOSURE = 0.6

#: Counter cards returned, at most.
COUNTER_CARDS = 8


def _load() -> dict:
    try:
        with open(_ROLES_PATH, encoding="utf-8") as fh:
            return json.load(fh).get("cards") or {}
    except Exception:  # noqa: BLE001 - a deployment without the file has no card view
        return {}


ROLES: dict = _load()

#: Seconds between looks at the roles file's modification time.
CHECK_EVERY_S = 30.0


def _mtime() -> float | None:
    try:
        return os.path.getmtime(_ROLES_PATH)
    except OSError:
        return None


_seen = {"mtime": _mtime(), "checked": time.monotonic()}


def _relations(roles: dict) -> dict[str, frozenset]:
    """`{card: the cards it answers}`, from BOTH directions of the manual.

    The manual writes a relation where it comes up: under the card that
    counters (`counters`) or under the card that is countered (`counteredBy`).
    Measured on the shipped file, 371 relations are written both ways and 621
    only one way, so reading one field alone loses most of them. Tokens that
    are not card keys ("any-splash", "large-troops") are prose and are dropped.
    """
    out: dict[str, set] = {}
    for a, v in roles.items():
        for b in v.get("counters") or []:
            if b in roles and b != a:
                out.setdefault(a, set()).add(b)
    for b, v in roles.items():
        for a in v.get("counteredBy") or []:
            if a in roles and a != b:
                out.setdefault(a, set()).add(b)
    return {a: frozenset(s) for a, s in out.items()}


BEATS: dict[str, frozenset] = _relations(ROLES)


def refresh(force: bool = False) -> bool:
    """Re-read the roles file when it has changed on disk. True when it did.

    Both tables are built before either name is rebound, and a table that
    fails to load or comes back empty leaves the last good one in place — a
    half-written file must not blank the card view.
    """
    global ROLES, BEATS
    now = time.monotonic()
    if not force and now - _seen["checked"] < CHECK_EVERY_S:
        return False
    _seen["checked"] = now
    mtime = _mtime()
    if mtime is None or (mtime == _seen["mtime"] and not force):
        return False
    roles = _load()
    _seen["mtime"] = mtime
    if not roles:
        return False
    beats_ = _relations(roles)
    ROLES, BEATS = roles, beats_
    return True


def available() -> bool:
    return bool(BEATS)


def beats(a: str, b: str) -> bool:
    """Whether the manual says card `a` answers card `b`."""
    return b in BEATS.get(a, ())


def usage(decks) -> dict[str, float]:
    """`{card: share of their games it is in}`, from a projection.

    `decks` are rows with `cards` and `likelihood` (a projection's threats) —
    so a card in every list of an archetype they play 77% of the time reads
    0.77, however many variants that archetype is spread over.
    """
    out: dict[str, float] = {}
    total = 0.0
    for d in decks or []:
        w = float(d.get("likelihood") or 0.0)
        if w <= 0:
            continue
        total += w
        for c in set(d.get("cards") or []):
            out[c] = out.get(c, 0.0) + w
    if total <= 0:
        return {}
    return {c: round(v / total, 4) for c, v in out.items()}


def their_cards(use: dict[str, float], limit: int = SHOWN_CARDS) -> list[dict]:
    """The cards they play, most used first: `[{card, share}]`."""
    rows = sorted(use.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"card": c, "share": s} for c, s in rows[:limit]]


def read(card: str, use: dict[str, float]) -> dict:
    """What the manual says about ONE card against what they play.

      answers   their core cards this card answers, most used first
      answered  the share of their games' card slots those are — a size, for
                ordering only; never printed as a rate
      open      their cards that answer THIS card, most used first
      exposure  how many of their games' worth of slots hold an answer to it
    """
    mine = BEATS.get(card, frozenset())
    hits = sorted(((b, s) for b, s in use.items() if b in mine and s >= CORE_USE),
                  key=lambda kv: (-kv[1], kv[0]))
    foes = sorted(((b, s) for b, s in use.items() if card in BEATS.get(b, ())),
                  key=lambda kv: (-kv[1], kv[0]))
    return {
        "answers": [{"card": b, "share": s} for b, s in hits],
        "answered": round(sum(s for _, s in hits), 4),
        "open": [{"card": b, "share": s} for b, s in foes],
        "exposure": round(sum(s for _, s in foes), 4),
    }


def worth(card: str, use: dict[str, float], *, win_condition: bool = False) -> dict | None:
    """The card's read when it is worth SEARCHING decks for, else None.

    Two ways in, the two the request named:

      * it ANSWERS something they really play (a core card of theirs), or
      * it is a WIN CONDITION they carry little against (`OPEN_EXPOSURE`) —
        and the manual must know the card's answers at all, or "nothing of
        theirs answers it" would only mean nobody wrote any down.
    """
    if card not in ROLES:
        return None
    r = read(card, use)
    if r["answers"]:
        r["why"] = "answers"
        return r
    known = bool(ROLES[card].get("counteredBy")) or any(
        card in s for s in BEATS.values())
    if win_condition and known and r["exposure"] <= OPEN_EXPOSURE:
        r["why"] = "open"
        return r
    return None
