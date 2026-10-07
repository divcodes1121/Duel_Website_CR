"""Pick for the duel, not the game (`duel-plan-1.0`). Pure: `math` only.

A duel is the first to two games of three (three of five), and no card is
played twice in it. So the deck to bring NOW is not simply the one with the
best matchup now: bringing it spends its cards, and what is left has to win the
games that follow against what THEY have left. This module values every deck a
player could bring by the chance of winning the DUEL, looking ahead over what
the opponent is likely to bring in each later game.

It knows nothing about cards, history or models. The caller hands it

    mine    the decks the player could bring this duel (8 card keys each)
    read    read(revealed, lost_prev) -> [(deck, probability), ...]
            what the opponent brings next, given the decks they have shown so
            far (a tuple, oldest first; an entry is None for a game whose deck
            is not known) and whether they lost the game before (True / False /
            None for not known or no game yet). The probabilities may sum to
            less than one: what is missing is a deck they have not shown.
    win     win(my deck or None, their deck or None) -> chance I win that game
            None on my side is "no deck of mine is left to name", on theirs "a
            deck they have not shown".

and gets back, for every deck that is legal now, the chance of winning this
game, the chance of winning the duel, and what to bring next if this game is
won and if it is lost.

MEASURED BLIND BEFORE IT WAS WIRED (2026-10-07; 10,168 three-game duels of
15-25 September, every part fitted on duels before 10 September, rated by a
win model fitted from 26 September with the in-duel shift below): the order
players really used wins the duel 49.0% of the time, the best deck for each
next game 50.8%, this look-ahead told each result 51.4%, the perfect pairing
58.8%. On real outcomes, players who followed it in both games 1 and 2 won
52.9% against 49.3% who followed it in neither. It shows no gain in friendly
duels (630), and best-of-five is arithmetic only — no stored duel has more
than three games. `coach._duel_plan` is the caller; the record is
`DECKKIES_DUEL_RECOMMENDER.md`.
"""
from __future__ import annotations

import itertools
import math

BRAIN = "duel-plan-1.0"

#: A duel is the best of this many games.
GAMES = 3

#: How many of their likely decks are followed at each game looked ahead: the
#: game being picked for, the one after it, the one after that. Whatever they
#: are given beyond these goes to "a deck they have not shown".
KEEP = (5, 3, 2)

#: THE RESULT OF A GAME SAYS SOMETHING THE RATES DO NOT. After winning a game a
#: player wins the next one more often than any matchup rate says (the two
#: players' real gap on the day is only partly in their records). One number a
#: game: the chance of the game after a win is moved up by it, after a loss
#: down by it, in log-odds.
#:
#: Fitted 2026-10-07 on duels before 10 Sep against the win model's own rate
#: with the players' strengths frozen at the duel's start (91,633 game 2s,
#: 38,222 game 3s), scored from 15 Sep: game 2 log loss 0.6417 -> 0.6337, and
#: after winning game 1 the model said 54.1%, the shift 61.0%, it happened
#: 62.0%. Game 3 at 1-1 barely moves (0.6482 -> 0.6479).
SHIFT = {2: 0.3288, 3: 0.0406}

_EPS = 1e-6


def _logit(p: float) -> float:
    p = min(max(p, _EPS), 1.0 - _EPS)
    return math.log(p / (1.0 - p))


def _sig(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def shifted(p: float, last: str | None, game: int, shift: dict | None = None) -> float:
    """The chance of winning game number `game`, given how the last one went."""
    d = (SHIFT if shift is None else shift).get(game, 0.0)
    if not d or last not in ("w", "l"):
        return p
    return _sig(_logit(p) + (d if last == "w" else -d))


def completions(results: str, finished: int, games: int = GAMES) -> list[str]:
    """Every way the games already finished can have gone, given what is known.

    `results` is 'w' / 'l' from my side for the first games; `finished` is how
    many games have been played. A duel that is still being played is not
    decided, so two finished games of three are 1-1 whatever was told.
    """
    need = games // 2 + 1
    known = "".join(c for c in str(results or "").lower() if c in "wl")[:finished]
    out = []
    for tail in itertools.product("wl", repeat=finished - len(known)):
        s = known + "".join(tail)
        if s.count("w") < need and s.count("l") < need:
            out.append(s)
    return out


def plan(mine, read, win, *, my_played=(), opp_played=(), results: str = "",
         games: int = GAMES, keep=KEEP, shift: dict | None = None,
         unseen: bool = True) -> dict:
    """What to bring now so the DUEL is won. See the module docstring.

    -> `{"brain", "games", "finished", "over", "score", "options", "pick",
    "gamePick"}`. `options` is one row for every deck of `mine` legal now,
    best first: `{"deck": index into mine, "game": chance of winning this
    game, "duel": chance of winning the duel, "then": {"won": index | None,
    "lost": index | None}}`. `pick` is the first row's deck, `gamePick` the
    deck with the best chance in this game alone. `score` is `[mine, theirs]`
    when the results told are complete, else None.

    `unseen=False` spreads the chance of a deck they have not shown over the
    decks listed instead of valuing it through `win(deck, None)`.
    """
    need = games // 2 + 1
    decks, origin = [], []
    for idx, d in enumerate(mine or []):
        fs = frozenset(d or ())
        if fs and fs not in decks:
            decks.append(fs)
            origin.append(idx)
    spent = frozenset().union(*[frozenset(d) for d in my_played if d]) if my_played else frozenset()
    finished = max(len(my_played or ()), len(opp_played or ()))
    shown = tuple(frozenset(d) if d else None for d in (opp_played or ()))
    shown = shown + (None,) * (finished - len(shown))
    cases = completions(results, finished, games)
    base = {"brain": BRAIN, "games": games, "finished": finished, "over": False,
            "score": None, "options": [], "pick": None, "gamePick": None}
    if not cases or finished >= games:
        return {**base, "over": True}
    if len(cases) == 1:
        base["score"] = [cases[0].count("w"), cases[0].count("l")]

    raw: dict = {}
    dists: dict = {}
    wins: dict = {}
    memo: dict = {}

    def dist(revealed: tuple, lost, ply: int) -> list:
        key = (revealed, lost, ply)
        got = dists.get(key)
        if got is not None:
            return got
        rows = raw.get((revealed, lost))
        if rows is None:
            rows = []
            for d, p in (read(revealed, lost) or []):
                fs, p = frozenset(d or ()), float(p or 0.0)
                if fs and p > 0:
                    rows.append((fs, p))
            rows.sort(key=lambda r: (-r[1], ",".join(sorted(r[0]))))
            raw[(revealed, lost)] = rows
        k = keep[min(ply, len(keep) - 1)]
        rows = rows[:k]
        tot = sum(p for _d, p in rows)
        if tot <= 0:
            got = [(None, 1.0)]
        elif not unseen or tot >= 1.0:
            got = [(d, p / tot) for d, p in rows]
        else:
            got = rows + ([(None, 1.0 - tot)] if 1.0 - tot > 1e-9 else [])
        dists[key] = got
        return got

    def pw(i, o, game: int, last) -> float:
        p = wins.get((i, o))
        if p is None:
            p = float(win(decks[i] if i is not None else None, o))
            p = wins[(i, o)] = min(max(p, _EPS), 1.0 - _EPS)
        return shifted(p, last, game, shift)

    def options(cards: frozenset, revealed: tuple, mw: int, ow: int, last) -> dict:
        """`{deck index or None: (game, duel)}` for the decks legal in this state."""
        key = (cards, revealed, mw, ow, last)
        got = memo.get(key)
        if got is not None:
            return got
        game_no = mw + ow + 1
        legal = [i for i, d in enumerate(decks) if not (d & cards)] or [None]
        q = dist(revealed, (last == "w") if last else None, mw + ow - finished)
        out = {}
        for i in legal:
            cards2 = cards | decks[i] if i is not None else cards
            g = v = 0.0
            for o, w in q:
                p = pw(i, o, game_no, last)
                rev2 = revealed + (o,)
                won = 1.0 if mw + 1 >= need else best(cards2, rev2, mw + 1, ow, "w")
                lost = 0.0 if ow + 1 >= need else best(cards2, rev2, mw, ow + 1, "l")
                g += w * p
                v += w * (p * won + (1.0 - p) * lost)
            out[i] = (g, v)
        memo[key] = out
        return out

    def best(cards, revealed, mw, ow, last) -> float:
        return max(v for _g, v in options(cards, revealed, mw, ow, last).values())

    weight = 1.0 / len(cases)
    game_v: dict = {}
    duel_v: dict = {}
    nxt: dict = {}
    for case in cases:
        mw, ow = case.count("w"), case.count("l")
        last = case[-1] if case else None
        opts = options(spent, shown, mw, ow, last)
        q = dist(shown, (last == "w") if last else None, 0)
        for i, (g, v) in opts.items():
            if i is None:
                continue
            game_v[i] = game_v.get(i, 0.0) + weight * g
            duel_v[i] = duel_v.get(i, 0.0) + weight * v
            cards2 = spent | decks[i]
            for branch, live in (("won", mw + 1 < need), ("lost", ow + 1 < need)):
                if not live:
                    continue
                votes = nxt.setdefault((i, branch), {})
                for o, w in q:
                    p = pw(i, o, mw + ow + 1, last)
                    share = weight * w * (p if branch == "won" else 1.0 - p)
                    after = options(cards2, shown + (o,),
                                    mw + (branch == "won"), ow + (branch == "lost"),
                                    "w" if branch == "won" else "l")
                    for j, (_g, v2) in after.items():
                        if j is not None:
                            votes[j] = votes.get(j, 0.0) + share * v2

    rows = []
    for i in duel_v:
        then = {}
        for branch in ("won", "lost"):
            votes = nxt.get((i, branch)) or {}
            then[branch] = origin[max(votes, key=lambda j: (votes[j], -j))] if votes else None
        rows.append({"deck": origin[i], "game": game_v[i], "duel": duel_v[i], "then": then})
    if not rows:
        return base
    rows.sort(key=lambda r: (-r["duel"], -r["game"], r["deck"]))
    game_pick = max(rows, key=lambda r: (r["game"], r["duel"], -r["deck"]))["deck"]
    return {**base, "options": rows, "pick": rows[0]["deck"], "gamePick": game_pick}
