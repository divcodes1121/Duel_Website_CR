"""THE DUEL WIN MODEL — who wins a duel GAME, from what is known before it.

Asked for on 2026-09-30: "research across all the duels stored — thousands of
players, what they played in game one and how the decks changed in games two
and three — a concrete brain, not something mid, aiming at high accuracy".

── WHAT THE RESEARCH MEASURED (temporal split, fitted before 12 Sep 2026,
   scored once on 107,762 later duel games, `duel_model_train.py`) ─────────

    model                                   log loss   accuracy
    coin                                      0.693      50.0%
    win-condition matchup (Deckkies before)   0.693      no signal
    player strength                           0.675      55.1%
    + card levels                             0.656      59.0%
    + which cards each side has               0.648      61.4%
    + card-vs-card interactions (this)        0.637      63.2%

  Calibrated: predicted 84.3% -> 83.0% actual, 64.8% -> 65.3%.

  AND ITS CHOICES WIN. At game 2 of every held-out three-game series a player
  had two decks left. When they happened to pick the one this model prefers,
  they won game 2 55.8% (20,738 choices); when they did not, 43.0% (17,056).
  With a 15+ point gap between the two: 63.4% against 36.8%. The
  win-condition matchup Deckkies used before split the same choices 51.4 /
  48.5.

── WHY IT IS BUILT THIS WAY ──────────────────────────────────────────────────

  * ANTISYMMETRIC, NO INTERCEPT. P(A beats B) = 1 - P(B beats A) by
    construction, so ranking two of a player's decks against one opponent can
    never depend on which side of the payload the player was stored on.
  * PLAYER STRENGTH IS ONLY WHAT WAS KNOWN BEFORE THE GAME. The first fit
    computed it from training games that included the game itself: it scored
    66.7% accuracy with a log loss WORSE than a coin — confident and wrong. A
    running record, the same at training and serving time, fixed it.
  * CARD LEVELS ARE A FEATURE because clan-war duels are not level-capped:
    one full level ahead won 81.2% of 4,657 held-out games.
  * CARD-VS-CARD WEIGHTS ARE WHAT IT LEARNED, not rules written in: Goblin
    Curse over Skeleton Army, Electro Dragon over Sparky, Inferno Dragon over
    Mega Knight and P.E.K.K.A, Lightning over Three Musketeers, Ronin over
    P.E.K.K.A — out of duel results alone. Regularised (`L2`) because 123 x 123
    pairs over ~250k games would otherwise memorise noise; the value was chosen
    on a validation slice, never on the test set.

Pure: no database, no network. `duel_model_train.py` builds the artifact;
`coach.py` reads it through `load()`.
"""

from __future__ import annotations

import json
import math
import os
import random
import threading

BRAIN = "duel-model-1.0"

#: Games of prior pulling a player's record toward 50% — `duel_brain`'s
#: `PILOT_PRIOR`, so one player's strength means the same in both brains.
PRIOR = 20.0

#: Chosen on the validation slice (see the module note).
L2 = 0.03
LR = 0.005
EPOCHS = 3

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".duel_model.json")

_lock = threading.Lock()
_loaded: tuple[float, dict] | None = None


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def sig(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def strength(games: int, wins: int) -> float:
    """A player's duel strength: their record, shrunk toward 50% by `PRIOR`."""
    return (wins + PRIOR / 2.0) / (max(0, games) + PRIOR)


def features(my, opp, my_def: float = 0.0, opp_def: float = 0.0,
             my_str: float = 0.5, opp_str: float = 0.5) -> dict[str, float]:
    """The feature vector for "my deck beats theirs", antisymmetric.

    `my_def` / `opp_def` are mean level DEFICITS over the eight cards
    (`maxLevel - level`, 0 = maxed), so a positive `opp_def - my_def` is an
    advantage. `my_str` / `opp_str` are `strength()` values.
    """
    x = {"pilot": logit(my_str) - logit(opp_str), "level": float(opp_def) - float(my_def)}
    for c in my:
        x["p:" + c] = x.get("p:" + c, 0.0) + 1.0
    for c in opp:
        x["p:" + c] = x.get("p:" + c, 0.0) - 1.0
    for i in my:
        for j in opp:
            if i != j:
                k, s = (f"x:{i}|{j}", 1.0) if i < j else (f"x:{j}|{i}", -1.0)
                x[k] = x.get(k, 0.0) + s
    return x


def score(weights: dict, x: dict) -> float:
    return sig(sum(weights.get(k, 0.0) * v for k, v in x.items()))


def train(rows, l2: float = L2, lr: float = LR, epochs: int = EPOCHS, seed: int = 7) -> dict:
    """Logistic regression by SGD over `rows` = [(features, won)].

    `pilot` and `level` are not regularised: they are two dense, well-measured
    signals, and shrinking them would hand their effect to the card weights.
    """
    w: dict[str, float] = {}
    data = list(rows)
    rnd = random.Random(seed)
    for ep in range(epochs):
        rnd.shuffle(data)
        eta = lr / (1 + ep)
        for x, y in data:
            g = score(w, x) - y
            for k, v in x.items():
                cur = w.get(k, 0.0)
                reg = 0.0 if k in ("pilot", "level") else l2 * cur
                w[k] = cur - eta * (g * v + reg)
    return w


def evaluate(weights: dict, rows) -> dict:
    ll = acc = 0.0
    n = 0
    for x, y in rows:
        p = score(weights, x)
        ll += -(y * math.log(p) + (1 - y) * math.log(1 - p))
        acc += 1.0 if (p > 0.5) == (y == 1) else 0.0
        n += 1
    return {"n": n, "logLoss": round(ll / n, 4) if n else None,
            "accuracy": round(100.0 * acc / n, 1) if n else None}


# ── The artifact ─────────────────────────────────────────────────────────────


def save(weights: dict, meta: dict, path: str = PATH) -> None:
    body = {"brain": BRAIN, "meta": meta,
            "weights": {k: round(v, 5) for k, v in weights.items() if abs(v) >= 1e-4}}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    os.replace(tmp, path)


def load(path: str = PATH) -> dict | None:
    """`{"weights", "meta"}` or None when no model has been trained yet.
    Re-read only when the file changes."""
    global _loaded
    try:
        m = os.path.getmtime(path)
    except OSError:
        return None
    with _lock:
        if _loaded is not None and _loaded[0] == m and _loaded[1].get("_path") == path:
            return _loaded[1]
    try:
        with open(path, encoding="utf-8") as f:
            body = json.load(f)
    except (OSError, ValueError):
        return None
    body["_path"] = path
    with _lock:
        _loaded = (m, body)
    return body


# ── Using it ─────────────────────────────────────────────────────────────────


def deck_deficit(deck, deficits: dict | None) -> float:
    """Mean level deficit of a deck's cards from a player's collection.

    A card missing from the map takes the mean of those present; no map at all
    is 0 for everyone, which cancels in `features` rather than inventing a gap.
    """
    if not deficits:
        return 0.0
    known = [float(deficits[c]) for c in deck if c in deficits]
    if not known:
        return 0.0
    mean = sum(known) / len(known)
    return sum(float(deficits.get(c, mean)) for c in deck) / len(deck)


def expected(model: dict, deck, opponents, *, my_def=None, opp_def=None,
             my_str: float = 0.5, opp_str: float = 0.5) -> dict | None:
    """Win chance of `deck` against the opponent's likely decks.

    `opponents` is `[(cards, likelihood)]`. Returns `{"winRate", "vs": [...]}`
    in percent, or None with nothing to score against.
    """
    w = (model or {}).get("weights")
    opps = [(list(c), float(p)) for c, p in (opponents or []) if c and float(p) > 0]
    if not w or not opps:
        return None
    total = sum(p for _c, p in opps)
    md = deck_deficit(deck, my_def)
    vs, acc = [], 0.0
    for c, p in opps:
        pw = score(w, features(deck, c, md, deck_deficit(c, opp_def), my_str, opp_str))
        acc += p / total * pw
        vs.append({"cards": c, "likelihood": round(p / total, 4), "winRate": round(100 * pw, 1)})
    return {"winRate": round(100 * acc, 1), "vs": vs, "brain": BRAIN}


def swaps(model: dict, deck, variants, opponents, *, used=(), limit: int = 3,
          min_gain: float = 0.5, my_def=None, opp_def=None,
          my_str: float = 0.5, opp_str: float = 0.5) -> list[dict]:
    """One-card changes REAL DUEL PLAYERS MADE to this list, that help here.

    `variants` are real duel decks one card away from `deck` (`duel_index.
    near_variants`), each `{"cards", "games", "players"}`. Each is scored
    against the same likely opponents; kept when it gains at least `min_gain`
    points and brings no card already `used` this duel. Best gain first.
    """
    base = expected(model, deck, opponents, my_def=my_def, opp_def=opp_def,
                    my_str=my_str, opp_str=opp_str)
    if base is None:
        return []
    have, spent = set(deck), set(used or ())
    out = []
    for v in variants or []:
        cards = list(v.get("cards") or [])
        s = set(cards)
        if len(s) != 8 or len(s & have) != 7:
            continue
        new = next(iter(s - have))
        if new in spent:
            continue
        e = expected(model, cards, opponents, my_def=my_def, opp_def=opp_def,
                     my_str=my_str, opp_str=opp_str)
        gain = e["winRate"] - base["winRate"]
        if gain < min_gain:
            continue
        out.append({"out": next(iter(have - s)), "in": new, "cards": cards,
                    "winRate": e["winRate"], "gain": round(gain, 1),
                    "games": int(v.get("games") or 0), "players": int(v.get("players") or 0)})
    out.sort(key=lambda r: (-r["gain"], -r["games"], r["in"]))
    return out[:limit]
