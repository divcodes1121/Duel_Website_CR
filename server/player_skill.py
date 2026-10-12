"""A PLAYER'S SKILL WITH EACH WIN CONDITION (`player-skill-1.0`).

WHY THIS EXISTS (2026-10-12)
============================

Asked for: "suggest decks on the player's usage and how they play — rate
players according to the decks they play, how much they play, the win rate they
have across all win conditions ... a tag for all players ... a dedicated
recommendation for each unique player".

Two readings of "how a player does with a win condition" were measured on duel
games the model had not seen (from 1 October 2026, card model fitted before
it; `brain-evidence/coach_counter_20261012/c1_skill.py`, `c1_skill2.py`):

  * HOW MUCH THEY PLAY IT says almost nothing. Players with 30+ earlier duel
    games won +2.1 points over expectation with a win condition they had NEVER
    brought to a duel, +0.6 with one under a tenth of their games, +2.8 with a
    main one (30%+) — all inside each other's noise.
  * THEIR RECORD WITH IT AGAINST THEIR OWN AVERAGE does not help either, and
    for two known players it hurts (CRL games 0.5924 -> 0.5929-0.5969 log
    loss): it mostly restates how strong the player is.
  * THEIR RECORD WITH IT AGAINST WHAT EACH GAME SHOULD HAVE GONE does. For
    every earlier duel game: who was playing (both running records), the card
    levels, and the cards of both decks give an expected result; the gap
    between wins and that expectation, shrunk, is the skill:

        skill = (wins - expected) / (games + K)

    With 10+ games on the win condition, the fifth of player/win-condition
    pairs with the lowest skill then won 4.9 points UNDER expectation
    [-7.3, -2.4] and the highest fifth 8.1 OVER [+6.1, +10.2], in order all the
    way up (1,399 sides each). As a term in the win chance,
    `weight x (skill of mine - skill of theirs)`, fitted on 1-6 October and
    scored after: every duel game 0.6276 -> 0.6266 log loss; games with a
    CRL-group player 0.5924 -> 0.5875; two players with 20+ games each
    0.6205 -> 0.6174; friendly duels 0.6467 -> 0.6452. Small on average,
    because most pairs are near zero; it is what separates a player's strong
    win conditions from their weak ones.

So this is a table for EVERY player with duel games stored — the "tag for all
players" — rebuilt after each poll from the duel games the win model is
trained on, and Coach Assist adds the term to every figure for a pairing.

HOW IT IS BUILT
===============

`build` walks every stored duel game in time order. Before each game it knows
each player's running record; the expectation of the game is the card matchup
model's own nuisance (who is playing, levels) plus its card term. It adds the
game to both players' `[games, wins, expected]` for the win condition each
brought. The newest `HOLDOUT_SHARE` of games is also SCORED, each with only
what came before it, with and without the term: when the term does not improve
that, the artifact says `on: false` and nothing is adjusted.

A deck's win condition is its priciest win-condition card — read off the
cards, so one player's lists of one win condition are one family whatever the
lists are.

Pure reader (`load`, `records`, `skills`, `shift`, `status`); `--build` needs
the duel-game cache and the card matchup artifact. The artifact holds player
tags and is gitignored.
"""
from __future__ import annotations

import json
import math
import os
import sys
import threading
import time

BRAIN = "player-skill-1.0"

#: Games of "no skill either way" a record is shrunk by, and the weight of the
#: skill gap in log-odds. Set from the lab's fit days (K 20: best weight 2.5
#: over every game, 1.5 in friendly duels and between two known players, 3.5
#: with a CRL-group player), one value for all. Not refitted by the builder.
K = 20.0
WEIGHT = 2.0

#: Duel games a player needs to be kept in the table, and the fewest on one
#: win condition before a tag is printed for it.
MIN_GAMES = 10
TAG_MIN_GAMES = 8
#: Skill (points of win chance a game) from which a win condition is tagged.
#: The lab's fifths: the lowest ended at -0.9 points, the highest began at +6.0
#: (K 40); at K 20 the same pairs sit at about -2 and +5.
STRONG = 0.04
WEAK = -0.02

#: The newest share of games scored for the on/off gate, and how many it needs.
HOLDOUT_SHARE = 0.15
HOLDOUT_MIN = 5000
PILOT_PRIOR = 20.0

PATH = os.environ.get("CLASH_PLAYER_SKILL") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".player_skill.json")

_lock = threading.Lock()
_loaded: tuple | None = None


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _sig(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def family_of(cards, is_win_condition, elixir_of) -> str | None:
    """A deck's win condition: its priciest win-condition card, the
    alphabetically first on a tie. None for a deck with none."""
    best = None
    for c in cards or ():
        if is_win_condition(c):
            cand = (-float(elixir_of(c) or 0), c)
            if best is None or cand < best:
                best = cand
    return best[1] if best else None


def skill(rec, k: float = K) -> float:
    """`[games, wins, expected]` -> wins over expectation a game, shrunk."""
    if not rec:
        return 0.0
    n, wins, expected = float(rec[0]), float(rec[1]), float(rec[2])
    return (wins - expected) / (n + k) if n > 0 else 0.0


def tag(rec, k: float = K) -> str | None:
    """`strong` / `weak` / `even` for a record with enough games, else None."""
    if not rec or float(rec[0]) < TAG_MIN_GAMES:
        return None
    s = skill(rec, k)
    return "strong" if s >= STRONG else "weak" if s <= WEAK else "even"


def shift(mine, theirs, weight: float = WEIGHT, k: float = K) -> float:
    """What the two records move a game by, in log-odds: `mine` is my record
    with the win condition I bring, `theirs` theirs with the one they bring."""
    return weight * (skill(mine, k) - skill(theirs, k))


# ── The table ────────────────────────────────────────────────────────────────


def build(games, expect, family, *, holdout_share: float = HOLDOUT_SHARE,
          k: float = K, weight: float = WEIGHT) -> dict:
    """`{"players": {tag: {family: [games, wins, expected]}}, "holdout": {...}}`.

    `games`   `(time, tag a, tag b, deck a, deck b, a won)` oldest first
    `expect`  expect(game index, pilot gap in log-odds) -> the log-odds that A
              wins from everything but skill. The pilot gap is this module's:
              each player's running record before the game, shrunk by
              `PILOT_PRIOR`.
    `family`  family(deck) -> the win condition, or None

    The last `holdout_share` of games are scored on the way, each with only
    what came before it.
    """
    games = list(games)
    cut = int(len(games) * (1.0 - holdout_share))
    rec: dict[str, list] = {}
    players: dict[str, dict] = {}
    base = with_ = 0.0
    scored = moved = 0

    def strength(t):
        r = rec.get(t)
        return ((r[1] + PILOT_PRIOR / 2) / (r[0] + PILOT_PRIOR)) if r else 0.5

    for i, (_t, ta, tb, da, db_, y) in enumerate(games):
        fa, fb = family(da), family(db_)
        z = float(expect(i, _logit(strength(ta)) - _logit(strength(tb))))
        p = _sig(z)
        ra = (players.get(ta) or {}).get(fa) if fa else None
        rb = (players.get(tb) or {}).get(fb) if fb else None
        if i >= cut:
            d = shift(ra, rb, weight, k)
            q = _sig(z + d)
            p0, q0 = min(max(p, 1e-4), 1 - 1e-4), min(max(q, 1e-4), 1 - 1e-4)
            base -= math.log(p0) if y else math.log(1 - p0)
            with_ -= math.log(q0) if y else math.log(1 - q0)
            scored += 1
            moved += 1 if d else 0
        for t, f, won, exp in ((ta, fa, y, p), (tb, fb, 1 - y, 1 - p)):
            r = rec.setdefault(t, [0, 0.0])
            r[0] += 1
            r[1] += won
            if f:
                s = players.setdefault(t, {}).setdefault(f, [0, 0.0, 0.0])
                s[0] += 1
                s[1] += won
                s[2] += exp
    hold = None
    if scored:
        hold = {"n": scored, "moved": moved, "base": round(base / scored, 4),
                "withSkill": round(with_ / scored, 4),
                "gain": round((base - with_) / scored, 4)}
    return {"players": players, "holdout": hold, "games": len(games)}


def trim(players: dict, min_games: int = MIN_GAMES) -> dict:
    """Only players with `min_games` duel games, records rounded for the file."""
    out = {}
    for t, fams in players.items():
        if sum(r[0] for r in fams.values()) < min_games:
            continue
        out[t] = {f: [int(r[0]), int(round(r[1])), round(float(r[2]), 3)] for f, r in fams.items()}
    return out


def save(body: dict, path: str | None = None) -> None:
    path = path or PATH
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    os.replace(tmp, path)


# ── Reading ──────────────────────────────────────────────────────────────────


def load(path: str | None = None) -> dict | None:
    """The table, or None when there is none. Re-read when the file changes; a
    file that cannot be read is no table, never an error."""
    global _loaded
    path = path or PATH
    try:
        m = os.path.getmtime(path)
    except OSError:
        return None
    with _lock:
        if _loaded is not None and _loaded[0] == (path, m):
            return _loaded[1]
    try:
        with open(path, encoding="utf-8") as f:
            body = json.load(f)
        if not isinstance(body.get("players"), dict):
            body = None
    except (OSError, ValueError, AttributeError):
        body = None
    with _lock:
        _loaded = ((path, m), body)
    return body


def on(path: str | None = None) -> bool:
    """Whether the term is applied: a table exists and its own holdout gained."""
    body = load(path)
    return bool(body and (body.get("meta") or {}).get("on"))


def records(tag_: str, path: str | None = None) -> dict:
    """`{win condition: [games, wins, expected]}` for one player, `{}` when
    they are not in the table."""
    body = load(path)
    if not body or not tag_:
        return {}
    return body["players"].get(str(tag_).strip().upper()) or {}


def weights(path: str | None = None) -> tuple[float, float]:
    """`(K, weight)` the table was built for."""
    meta = (load(path) or {}).get("meta") or {}
    return float(meta.get("k") or K), float(meta.get("weight") or WEIGHT)


def status(path: str | None = None) -> dict:
    """For `/api/analytics/status`: is there a table, and what it measured.
    No tag in it."""
    body = load(path)
    if body is None:
        return {"available": False}
    meta = body.get("meta") or {}
    return {"available": True, "brain": body.get("brain"),
            **{k: meta.get(k) for k in ("on", "builtAt", "games", "players", "k", "weight",
                                        "holdout", "seconds")}}


# ── The builder's command ────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    if "--build" not in argv:
        print(json.dumps(status(), indent=1))
        return 0
    import pickle
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    import card_matchup as cm
    import duel_combos as dx
    t0 = time.time()
    model = cm.load()
    if model is None:
        print("no card matchup model: the skill table needs its expectation - NOT built")
        return 2
    nu = ((model.get("meta") or {}).get("holdout") or {}).get("nuisance") or [1.36, 0.72]
    cache = os.environ.get("CLASH_DUEL_GAMES") or os.path.join(here, ".duel_games.pkl")
    with open(cache, "rb") as f:
        raw = pickle.load(f)["games"]
    raw = sorted(raw, key=lambda g: (g[0], g[1]))
    games, extra = [], []
    for bt, _rnd, ta, tb, da, db_, fa, fb, y in raw:
        da, db_ = tuple(sorted(da)), tuple(sorted(db_))
        if len(set(da)) != 8 or len(set(db_)) != 8:
            continue
        games.append((bt, ta, tb, da, db_, int(y)))
        extra.append(float(fb or 0.0) - float(fa or 0.0))
    fam: dict = {}

    def family(deck):
        f = fam.get(deck)
        if f is None:
            f = fam[deck] = family_of(deck, lambda c: dx.card_info(c).get("is_win_condition"),
                                      lambda c: dx.card_info(c).get("elixir")) or ""
        return f or None

    def expect(i, pilot_gap):
        g = games[i]
        return float(nu[0]) * pilot_gap + float(nu[1]) * extra[i] + cm.raw(model, g[3], g[4])

    out = build(games, expect, family)
    players = trim(out["players"])
    hold = out["holdout"]
    ok = bool(hold and hold["n"] >= HOLDOUT_MIN and hold["gain"] > 0)
    meta = {"on": ok, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "games": out["games"], "players": len(players), "k": K, "weight": WEIGHT,
            "holdout": hold, "seconds": round(time.time() - t0),
            "cardModel": (model.get("meta") or {}).get("trainedAt")}
    out_path = next((a.split("=", 1)[1] for a in argv if a.startswith("--out=")), None)
    save({"brain": BRAIN, "meta": meta, "players": players}, out_path)
    print(json.dumps({"saved": out_path or PATH, **meta}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
