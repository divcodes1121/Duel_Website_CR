"""duel_feed.py — friendly duels that went to three games, newest first.

The admin "All Duels" screen. One row a DUEL: who played whom, the score in
games, and each game's two decks with its crowns. Filtered by card, over 30, 60
or 90 days. Asked for by name (2026-10-05): "show all the duel battles we have,
newer to older, like the versus duels with the crowns, the player name on both
sides, a card filter, and only 30, 60 and 90 days".

WHICH DUELS — friendly ones, all three games played. The first build listed
every native duel, and nineteen in twenty of those were clan-war duels. The
account holder looked at it live and said: "war duels we don't need, only
friendly ones, that too which are played all 3 battles". So the screen's rule
is two constants, `MODE` and `GAMES`, and this is the only place they are set:

    mode    Duel_1v1_Friendly — the game's own friendly duel. NOT a war duel
            (CW_Duel_1v1), and not the practice series the Duel Zone rebuilds
            from single friendly battles (those exist only per player).
    games   3. A duel is over at two wins, so a two-game duel is a sweep and a
            three-game one went to the decider: every one of them is 2-1.

    measured on production, 2026-10-05, friendly duels:
                       30 days   60 days   90 days
      three games        1,169     2,431     3,046     <- the screen
      two games (2-0)    1,745     3,492     4,401
    about 25 to 60 three-game duels a day, 4,668 different players in ninety

WHERE THE DUELS COME FROM. `duel_index.games` — the one table on the site that
holds a native duel GAME BY GAME, with both players' decks and crowns. In
`battles` a native duel is a single row carrying the whole 16- or 24-card
loadout and only the duel's result; the per-game truth is in the raw payload's
`rounds`, which the duel index already reads after every poll. So this module
adds no collector and no table: `duel_index.duel_feed` pages what is there, and
this shapes it for the screen.

WHO IS ON THE LEFT. Side `a` is the lexically first tag, the order the duel
index stores a duel in so that both participants' copies fold into one. It
means nothing about the duel, so the payload names the winner (`winner`) rather
than leaving a reader to assume the left side is anybody in particular.

THE FORMS ARE THE ONES FIELDED. The duel index stores card keys and nothing
else. The bot's own `battles` row for the same duel carries `player_evo` /
`opponent_evo` — which cards went in as an evolution or a hero — so each page
looks its duels up there (one indexed read a duel) and seats every deck through
`duel_zone._arranged`, THE SAME PATH THE DUEL ZONE DRAWS THE SAME DUEL WITH. A
deck with no marks falls back to what its cards can be and is flagged
`artInferred`, exactly as it is there.

ADMIN ONLY, and gated twice in `app.py`: the route sits behind
`admin_auth.verify`. It lists players' tags, names and decks, newest first,
which is a log of people — the reason the tracking view has the same gate.

NO TAG IS ENROLLED. Every other tag route queues the tag it is asked about
(`app._note_tag`); this one is asked about nobody, and listing thousands of
duels must not queue the strangers in them for collection.
"""
from __future__ import annotations

import clash_data as cd
import duel_combos as dx
import duel_index as di
from duel_zone import _arranged, deck_label
from duo_pairs import valid_cards  # the one rule for a card filter's keys

#: WHICH DUELS THE SCREEN LISTS — see the docstring. The lower-case form of a
#: mode on `duel_combos.NATIVE_DUEL_MODES`; a test holds that it is one.
MODE = "duel_1v1_friendly"

#: ...and how many games they must have. Three: the duel went to the decider.
GAMES = 3

#: The windows this screen offers, and the one it opens on. Three, by request.
DAYS = (30, 60, 90)
DEFAULT_DAYS = 30

#: Duels a page when the caller does not say. A duel here is three games of two
#: decks, so ten is already sixty decks on screen — the battle log's page
#: size, for the same reason. The screen offers 10, 20 and 50.
PER_PAGE = 10
MAX_PER_PAGE = 50


def valid_days(raw) -> int:
    """One of `DAYS`, or the default. The value comes from a query string."""
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return n if n in DAYS else DEFAULT_DAYS


def _marks(duels: list[dict]) -> dict[tuple[str, str], str]:
    """`{(battle_time, tag): raw evo marks}` for the players of these duels.

    Read from the bot's `battles` row of the same duel. A duel is stored under
    each TRACKED participant, so there are one or two rows; a player's own row
    answers for their own side when it exists, and the other player's row
    (`opponent_evo`) when it does not.

    `+player_tag` keeps the lookup on `idx_battles_time`: a battle time is a
    handful of rows, a player tag is thousands. Never raises — with no marks
    the decks are drawn from what their cards can be, and say so.
    """
    tiers = cd._tier_paths()
    if not tiers or not duels:
        return {}
    try:
        con = cd.connect(tiers[0])
    except Exception:  # noqa: BLE001
        return {}
    out: dict[tuple[str, str], str] = {}
    try:
        for d in duels:
            bt, pair = d["battleTime"], {d["a"]: d["b"], d["b"]: d["a"]}
            rows = con.execute(
                "SELECT player_tag, opponent_tag, player_evo, opponent_evo FROM battles "
                "WHERE battle_time = ? AND +player_tag IN (?, ?)",
                (bt, d["a"], d["b"])).fetchall()
            for r in rows:
                me = r["player_tag"]
                them = pair.get(me)
                if them is None or r["opponent_tag"] != them:
                    continue       # same second, a different battle
                if r["player_evo"]:
                    out[(bt, me)] = r["player_evo"]
                if r["opponent_evo"]:
                    out.setdefault((bt, them), r["opponent_evo"])
    except Exception:  # noqa: BLE001
        pass
    finally:
        con.close()
    return out


def _deck(cards: list[str], evo_raw: str | None) -> dict:
    """One deck as the screen draws it: seated, with its art and its name."""
    view = _arranged(cards, dx._evo_marks(evo_raw, cards))
    arch = di.classify(di.deck_key(cards))
    view["archetype"] = arch
    view["deckName"] = deck_label(view["cards"], arch)
    return view


def _duel(d: dict, names: dict[str, str], marks: dict) -> dict:
    bt, ta, tb = d["battleTime"], d["a"], d["b"]
    evo_a, evo_b = marks.get((bt, ta)), marks.get((bt, tb))
    wins, crowns, games = [0, 0], [0, 0], []
    for rnd, a_deck, b_deck, a_crowns, b_crowns, winner in d["games"]:
        if winner == 1:
            wins[0] += 1
        elif winner == 2:
            wins[1] += 1
        crowns[0] += a_crowns
        crowns[1] += b_crowns
        games.append({
            # The payload's own round number, from 1.
            "game": rnd + 1,
            "winner": "a" if winner == 1 else "b" if winner == 2 else None,
            "a": {**_deck(a_deck, evo_a), "crowns": a_crowns},
            "b": {**_deck(b_deck, evo_b), "crowns": b_crowns},
        })
    return {
        "id": f"{bt}|{ta}|{tb}",
        "battleTime": bt,
        # The raw stored mode, for anyone checking the rule against a row.
        "mode": d["mode"],
        # By games won. None when level, which no stored duel is.
        "winner": "a" if wins[0] > wins[1] else "b" if wins[1] > wins[0] else None,
        # `name` is None when no name was ever stored: the screen decides what
        # an unnamed player shows as, so a tag is never passed off as a name.
        "a": {"tag": ta, "name": names.get(ta), "wins": wins[0], "crowns": crowns[0]},
        "b": {"tag": tb, "name": names.get(tb), "wins": wins[1], "crowns": crowns[1]},
        "games": games,
    }


def report(days=DEFAULT_DAYS, cards=(), page: int = 1, per: int = PER_PAGE) -> dict:
    """One page of friendly three-game duels, newest first.

    `days` is one of `DAYS` (anything else is the default) and counts back from
    the newest duel stored. `cards` narrows to duels where ONE deck holds every
    card given; unknown keys are dropped and the accepted list is echoed back,
    so the screen quotes what the server filtered by rather than what it sent.
    A page past the end is clamped, and the page answered is in the payload.
    """
    days = valid_days(days)
    picked = valid_cards(cards)
    try:
        per = int(per)
    except (TypeError, ValueError):
        per = PER_PAGE
    per = max(1, min(MAX_PER_PAGE, per))
    try:
        page = max(1, int(page))
    except (TypeError, ValueError):
        page = 1

    out = {
        "days": days,
        "windows": list(DAYS),
        # What the list is OF, so a client cannot describe it differently.
        "rule": {"mode": MODE, "games": GAMES},
        "cards": picked,
        "perPage": per,
    }
    feed = di.duel_feed(days, picked, page, per, mode=MODE, games=GAMES)
    if feed is None:
        # No index, or one built from another database. A state, not an error.
        return {**out, "available": False, "window": {"from": None, "to": None},
                "newest": None, "builtAt": None, "page": 1, "pages": 1, "total": 0,
                "windowDuels": 0, "duels": []}

    duels = feed["duels"]
    names = cd.player_names([t for d in duels for t in (d["a"], d["b"])])
    marks = _marks(duels)
    return {
        **out,
        "available": True,
        "window": {"from": feed["from"], "to": feed["to"]},
        "newest": feed["newest"],
        "builtAt": di.status().get("builtAt"),
        "page": feed["page"],
        "pages": feed["pages"],
        # Duels matching the card filter, then every listed duel in the window.
        "total": feed["total"],
        "windowDuels": feed["windowDuels"],
        "duels": [_duel(d, names, marks) for d in duels],
    }


if __name__ == "__main__":
    import json
    import sys

    args = sys.argv[1:]
    n = int(args[0]) if args and args[0].isdigit() else DEFAULT_DAYS
    rep = report(n, [a for a in args[1:] if not a.isdigit()], per=3)
    print(json.dumps(rep, indent=2)[:6000])
