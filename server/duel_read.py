"""THE DUEL READ — which deck a player brings next, from their own duels.

Asked for on 2026-10-07: rebuild Coach Assist's duel suggestion so it reads what
the opponent has spent and what they bring next, and test it BLIND — only what
was known before each game — over every stored duel. This module is the read;
`DECKKIES_DUEL_RECOMMENDER.md` is the record of the whole rebuild.

── WHAT WAS WRONG WITH THE READ IT REPLACES ─────────────────────────────────

`coach.opening_decks` / `next_decks` rank a player's duel decks by how often
they were played in the window. Replayed blind over 119,992 player-duels (fitted
before 10 Sep 2026, scored from 15 Sep), on the players of the CRL list:

    the exact deck they brought    first pick      in the top three
    game 1   counts (live)            20.3%            40.8%
             this module              42.8%            60.6%
    game 2   counts                   28.8%            50.3%
             this module              41.1%            66.9%
    game 3   counts                   40.5%            54.0%
             this module              52.1%            66.6%

Three things the counts could not see:

  * GAME ORDER. A native duel's 8-card blocks are in the order the games were
    played (15,578 of 15,578 sides checked against the stored rounds), so "what
    do they OPEN with" and "what follows this opener" are readable for every
    duel, not only for reconstructed friendly series.
  * RECENCY. A count over 30 days weighs a deck dropped three weeks ago like the
    one played this morning; the live read got WORSE with a longer window
    (first pick 24.5% at 7 days, 20.3% at 30). Here a duel `HALF_LIFE_DAYS` old
    counts half, and the days since a deck was last played is the strongest
    single signal the fit found.
  * LEGALITY. A duel cannot repeat a card, so a deck sharing even one card with
    a revealed deck cannot be the next deck. The live read keeps decks sharing
    up to two and then drops them from its top three, leaving fewer than three.

── WHAT IT IS ───────────────────────────────────────────────────────────────

THREE SMALL FITTED PARTS, one set of each per stage (before game 1 / after one
reveal / after two), all fitted by `duel_read_train.py` on every stored duel
and refitted after each bot poll:

  1. RANKING. A conditional logit over the decks the player has been seen
     bringing: every legal deck gets twelve features counted from their earlier
     duels, and a weighted sum is its score.
  2. SHARPNESS. How far to trust that score for THIS player. A clan-war player
     repeats a set for weeks; a player who scrims in friendly duels rotates.
     One scale on the scores, from the player's own new-deck rate and the share
     of their duels that are friendly.
  3. NEW DECK. The chance the next deck is one not seen in the window at all.
     Every row's probability is scaled by what is left, so the rows sum to
     less than one and the first pick's figure means what it says.

`DEFAULT_*` are the 2026-10-07 fit, used when no artifact is on disk.

It ranks decks they HAVE played. Nothing here invents one.

Pure: no database, no network, no clock (the caller passes `now`).
"""

from __future__ import annotations

import json
import math
import os
import threading

BRAIN = "duel-read-1.0"

#: A duel this many days old counts half in the recency-weighted features.
HALF_LIFE_DAYS = 6.0

#: Two lists sharing this many cards are one deck (`duel_zone.COUNTER_MIN_OVERLAP`,
#: the project's identity rule).
SAME_DECK = 6

#: THE ORDER IS PART OF THE CONTRACT, for all three lists. An artifact whose
#: ranking features differ is refused whole; one whose sharpness or new-deck
#: features differ falls back to the defaults for that part. A reordered list
#: silently invalidates every weight.
FEATURES = (
    "presence",        # recency-weighted duels the deck was brought to
    "position",        # ...and brought at THIS stage of the duel
    "in_last",         # it was in their most recent duel
    "pos_last",        # ...at this stage
    "share",           # its share of every deck they played in the window
    "winrate",         # their record with it, shrunk, minus one half
    "staleness",       # log(1 + days since they last played it)
    "with_revealed",   # recency-weighted duels holding it AND a revealed deck
    "follows",         # ...where it came right after the same reveal(s)
    "lost_x_winrate",  # winrate, only when they lost the previous game
    "lost_x_share",    # share, only when they lost the previous game
    "n_variants",      # log(1 + other seen lists within two cards of it)
)

SHARPNESS_FEATURES = (
    "bias",
    "own_new_rate",    # how often THEY brought a list not seen earlier in the window
    "friendly_share",  # share of their duels in the window that are friendly duels
    "friendly_now",    # THIS duel is a friendly duel (their friendly share when not told)
)

NOVELTY_FEATURES = (
    "bias",
    "log_duels",       # log(1 + duels in the window)
    "variety",         # distinct lists / decks played: 1.0 = never repeats
    "log_gap",         # log(1 + days since their last duel)
    "log_candidates",  # log(1 + legal decks seen)
    "own_new_rate",
    "friendly_share",
    "friendly_now",
)

#: Fitted 2026-10-07 on all 170,792 stored duels by `duel_read_train.py`.
#: Its own report (fitted before 2026-09-24, scored from then on): the exact deck is
#: the first pick 67.9% / 60.0% / 52.7% of the time by stage for everyone
#: (a count of plays: 37.4% / 52.9% / 49.5%), and 26.3% / 29.9% /
#: 41.9% in friendly duels (14.9% / 23.9% / 31.4%).
DEFAULT_WEIGHTS = {
    0: (-0.31948, 0.74222, -0.54392, 1.38553, 2.83684, 0.58457, -1.16533, 0.0, 0.0, 0.0, 0.0, 0.04919),
    1: (0.0211, -0.16191, -0.25701, 0.4533, 1.46268, 0.54075, -0.84961, -0.08844, 0.87642, 0.46203, 0.79048, 0.08043),
    2: (-0.0431, 0.11722, 0.05017, -0.08863, -0.96288, 1.41514, -0.75538, 0.5911, 0.8262, 0.08206, 1.30396, -0.00297),
}
DEFAULT_SHARPNESS = {
    0: (-0.06436, 0.32111, -0.17234, -0.48886),
    1: (-0.16695, 0.58015, 0.19407, -0.21149),
    2: (-0.19753, 0.37702, 0.23161, 0.12175),
}
DEFAULT_NOVELTY = {
    0: (-2.15997, -0.50546, -0.43731, 0.61, 0.03207, 1.03599, 0.95939, 1.61395),
    1: (-1.49239, 0.04321, 0.05361, 0.4732, -1.13735, 1.4105, 0.81744, 1.24536),
    2: (-0.22624, 0.62463, 0.72091, 0.33323, -3.85688, 1.45234, 0.75383, 1.10113),
}

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".duel_read.json")

_DAY = 86400.0
_lock = threading.Lock()
_loaded: tuple[float, dict] | None = None


def _near(a: frozenset, b: frozenset) -> bool:
    return len(a & b) >= SAME_DECK


def _sig(deck: frozenset) -> str:
    return ",".join(sorted(deck))


def stage_of(revealed) -> int:
    """Which weights to use: 0, 1 or 2 reveals. A fourth or fifth game of a
    best-of-5 reads with the two-reveal weights — there is no stored best-of-5
    to fit its own."""
    return min(len(revealed), 2)


def candidates(history, revealed, now: float, lost_prev: bool = False) -> dict:
    """`{deck: feature list}` for every deck the player could legally bring.

    `history` is their earlier duels, OLDEST FIRST: `{"t": epoch seconds,
    "decks": [cards in the order played], "won": [True | False | None],
    "friendly": bool}` (`won` and `friendly` optional). `revealed` is what they
    have shown in the current duel, in order.

    Only decks sharing NO card with a revealed deck are candidates. That is the
    rule of the game, not a tolerance to tune.
    """
    revealed = [frozenset(r) for r in revealed if r]
    n_rev = len(revealed)
    used = frozenset().union(*revealed) if revealed else frozenset()
    duels = [(float(h["t"]), [frozenset(d) for d in h.get("decks") or [] if d], list(h.get("won") or []))
             for h in history or []]
    duels = [d for d in duels if d[1]]
    if not duels:
        return {}

    plays: dict[frozenset, int] = {}
    wins: dict[frozenset, float] = {}
    last_t: dict[frozenset, float] = {}
    total = 0
    for t, decks, won in duels:
        for i, d in enumerate(decks):
            plays[d] = plays.get(d, 0) + 1
            w = won[i] if i < len(won) else None
            # An unknown result is half a win: it must not read as a loss.
            wins[d] = wins.get(d, 0.0) + (0.5 if w is None else (1.0 if w else 0.0))
            last_t[d] = t
            total += 1

    feats = {d: [0.0] * len(FEATURES) for d in plays if not (d & used)}
    if not feats:
        return {}

    for t, decks, _won in duels:
        w = 0.5 ** (max(0.0, now - t) / _DAY / HALF_LIFE_DAYS)
        hit = [any(_near(x, r) for x in decks) for r in revealed]
        n_hit = sum(hit)
        for pos, d in enumerate(decks):
            f = feats.get(d)
            if f is None:
                continue
            f[0] += w
            if pos == n_rev:
                f[1] += w
            if n_rev and n_hit:
                f[7] += w * n_hit / n_rev
            # "It came right after the same reveal(s)": the duel opened with
            # the revealed deck(s), in order, and this deck was the next game.
            if n_rev and pos == n_rev and all(_near(decks[k], revealed[k]) for k in range(n_rev)):
                f[8] += w

    _t, last_decks, _w = duels[-1]
    for d, f in feats.items():
        f[2] = 1.0 if d in last_decks else 0.0
        f[3] = 1.0 if (len(last_decks) > n_rev and last_decks[n_rev] == d) else 0.0
        f[4] = plays[d] / total
        f[5] = (wins[d] + 1.0) / (plays[d] + 2.0) - 0.5
        f[6] = math.log1p(max(0.0, now - last_t[d]) / _DAY)
        if lost_prev:
            f[9] = f[5]
            f[10] = f[4]
        f[11] = math.log1p(sum(1 for o in plays if o != d and len(o & d) >= SAME_DECK))
    return feats


def profile(history) -> tuple[float, float]:
    """`(own new-deck rate, friendly share)` — how much THIS player rotates.

    THE RATE IS WALKED FORWARD through the window: of the decks they brought
    after their first duel in it, how many were lists not seen until then.
    Shrunk by one new and one repeat, so a single duel reads as a half.
    """
    duels = [h for h in history or [] if h.get("decks")]
    seen: set = set()
    new = later = 0
    for i, h in enumerate(duels):
        for d in h["decks"]:
            if i:
                later += 1
                new += frozenset(d) not in seen
        seen.update(frozenset(d) for d in h["decks"])
    friendly = (sum(1 for h in duels if h.get("friendly")) / len(duels)) if duels else 0.0
    return (new + 1.0) / (later + 2.0), friendly


def _friendly_now(friendly_now, share: float) -> float:
    """1 / 0 when the caller knows what kind of duel this is, their friendly
    share when it does not — the expected value, so an unknown is never read
    as "clan war"."""
    return share if friendly_now is None else (1.0 if friendly_now else 0.0)


def sharpness_features(history, friendly_now=None) -> list[float]:
    rate, friendly = profile(history)
    return [1.0, rate, friendly, _friendly_now(friendly_now, friendly)]


def novelty_features(history, revealed, now: float, n_candidates: int,
                     friendly_now=None) -> list[float]:
    """The inputs of the "new deck" model, in `NOVELTY_FEATURES` order."""
    duels = [h for h in history or [] if h.get("decks")]
    plays = sum(len(h["decks"]) for h in duels)
    distinct = len({frozenset(d) for h in duels for d in h["decks"]})
    gap = (max(0.0, now - max(float(h["t"]) for h in duels)) / _DAY) if duels else 0.0
    rate, friendly = profile(duels)
    return [1.0, math.log1p(len(duels)), (distinct / plays) if plays else 1.0,
            math.log1p(gap), math.log1p(max(0, n_candidates)), rate, friendly,
            _friendly_now(friendly_now, friendly)]


def novelty(history, revealed, now: float, *, weights=None, n_candidates: int | None = None,
            friendly_now=None) -> float:
    """The chance their next deck is one NOT seen in `history`. 1.0 when there
    is nothing legal to name."""
    if n_candidates is None:
        n_candidates = len(candidates(history, revealed, now))
    if not n_candidates:
        return 1.0
    w = tuple(weights) if weights is not None else novelty_weights_for(stage_of(revealed))
    z = sum(a * b for a, b in zip(w, novelty_features(history, revealed, now, n_candidates,
                                                      friendly_now)))
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def sharpness(history, revealed, *, weights=None, friendly_now=None) -> float:
    """The scale on the ranking scores for this player: 1 = as fitted on
    everyone, below 1 = flatter (a player who rotates is harder to call)."""
    w = tuple(weights) if weights is not None else sharpness_weights_for(stage_of(revealed))
    z = sum(a * b for a, b in zip(w, sharpness_features(history, friendly_now)))
    return math.exp(max(-3.0, min(3.0, z)))


def read(history, revealed, now: float, *, lost_prev: bool = False, friendly_now=None,
         weights=None, novelty_weights=None, sharpness_weights=None) -> list[dict]:
    """The player's likely next decks, most likely first.

    Each row: `cards` (the list as they last played it), `p` (probability),
    `plays`, `lastPlayed` (epoch), `variants` (other seen lists within two
    cards, folded into this row). THE ROWS SUM TO LESS THAN ONE: what is
    missing is the chance of a deck not seen in the window (`novelty`).

    `friendly_now` says what kind of duel THIS is — True for a friendly duel
    (a scrim, a tournament match), False for a clan-war duel, None when the
    caller does not know. It matters: in a friendly duel even a player with a
    settled war set brings something else more often.

    ONE ROW A DECK. Lists within two cards of each other are the same deck with
    a tech swap; the best-scored variant stands for them and carries their
    probability, so two near-copies cannot take two of the three places a
    caller shows. The rows are ordered by that summed probability, so the order
    and the figure printed beside it can never disagree.
    """
    feats = candidates(history, revealed, now, lost_prev)
    if not feats:
        return []
    w = tuple(weights) if weights is not None else weights_for(stage_of(revealed))
    scored = sorted(((sum(a * b for a, b in zip(w, f)), d) for d, f in feats.items()),
                    key=lambda e: (-e[0], _sig(e[1])))
    kappa = sharpness(history, revealed, weights=sharpness_weights, friendly_now=friendly_now)
    top = scored[0][0]
    ex = [(math.exp(kappa * (s - top)), d) for s, d in scored]
    seen = 1.0 - novelty(history, revealed, now, weights=novelty_weights,
                         n_candidates=len(feats), friendly_now=friendly_now)
    z = sum(e for e, _ in ex) / seen

    order: dict[frozenset, list] = {}
    plays: dict[frozenset, int] = {}
    last: dict[frozenset, float] = {}
    for h in history or []:
        for cards in h.get("decks") or []:
            k = frozenset(cards)
            order[k] = list(cards)
            plays[k] = plays.get(k, 0) + 1
            last[k] = float(h["t"])

    rows: list[dict] = []
    for e, d in ex:
        home = next((r for r in rows if len(r["_set"] & d) >= SAME_DECK), None)
        if home is None:
            rows.append({"cards": order[d], "p": e / z, "plays": plays[d],
                         "lastPlayed": last[d], "variants": 0, "_set": d})
        else:
            home["p"] += e / z
            home["plays"] += plays[d]
            home["variants"] += 1
    rows.sort(key=lambda r: (-r["p"], _sig(r["_set"])))
    for r in rows:
        del r["_set"]
    return rows


#: Roles a card is filed under in `left`, and how many of each are listed.
ROLE_LIMITS = (("wincon", 4), ("spell", 6), ("building", 4), ("support", 8))

#: A card under this probability is not listed as "left": at 5% it is one deck
#: in twenty of what they might bring.
LEFT_MIN_P = 0.05


def left(rows, revealed, role_of) -> dict:
    """What they have SPENT, and what they may still bring, by role.

    `rows` is `read()`'s answer for the current stage; `role_of(card)` returns
    `wincon`, `spell`, `building` or `support`. A card's figure is the
    probability that their next deck holds it: the sum of the rows it is in.

    The spent half is a fact — the cards of the decks already revealed, which
    the rules say cannot come back. The other half is the read.
    """
    spent: dict[str, list[str]] = {r: [] for r, _ in ROLE_LIMITS}
    for deck in revealed or []:
        for c in deck:
            role = role_of(c)
            if role in spent and c not in spent[role]:
                spent[role].append(c)
    odds: dict[str, float] = {}
    for r in rows or []:
        for c in r["cards"]:
            odds[c] = odds.get(c, 0.0) + r["p"]
    out: dict[str, list[dict]] = {}
    for role, limit in ROLE_LIMITS:
        cards = [(p, c) for c, p in odds.items() if role_of(c) == role and p >= LEFT_MIN_P]
        cards.sort(key=lambda e: (-e[0], e[1]))
        out[role] = [{"card": c, "prob": round(min(1.0, p), 4)} for p, c in cards[:limit]]
    for role in spent:
        spent[role].sort()
    return {"spent": spent, "left": out}


# ── The artifact ─────────────────────────────────────────────────────────────


def save(weights: dict, meta: dict, path: str = PATH, novelty: dict | None = None,
         sharpness: dict | None = None) -> None:
    def table(t):
        return {str(s): [round(float(x), 6) for x in w] for s, w in t.items()}

    body = {"brain": BRAIN, "meta": meta,
            "features": list(FEATURES), "weights": table(weights),
            "sharpnessFeatures": list(SHARPNESS_FEATURES),
            "sharpness": table(sharpness or DEFAULT_SHARPNESS),
            "noveltyFeatures": list(NOVELTY_FEATURES),
            "novelty": table(novelty or DEFAULT_NOVELTY)}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    os.replace(tmp, path)


def _table(body: dict, names_key: str, key: str, names: tuple) -> dict | None:
    """One fitted table out of an artifact, or None when it is not usable."""
    try:
        if list(body.get(names_key) or []) != list(names):
            return None
        got = {int(s): tuple(float(x) for x in v) for s, v in (body.get(key) or {}).items()}
    except (TypeError, ValueError):
        return None
    if not all(s in got and len(got[s]) == len(names) for s in (0, 1, 2)):
        return None
    return got


def load(path: str = PATH) -> dict | None:
    """The fitted artifact, or None. Re-read only when the file changes.

    REFUSED WHOLE when its ranking features are not this module's. The other
    two tables travel with the ranking they were fitted beside; a file without
    a usable one falls back to the defaults for that part only.
    """
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
    if not isinstance(body, dict):
        return None
    w = _table(body, "features", "weights", FEATURES)
    if w is None:
        return None
    body["_weights"] = w
    body["_sharpness"] = _table(body, "sharpnessFeatures", "sharpness", SHARPNESS_FEATURES) \
        or dict(DEFAULT_SHARPNESS)
    body["_novelty"] = _table(body, "noveltyFeatures", "novelty", NOVELTY_FEATURES) \
        or dict(DEFAULT_NOVELTY)
    body["_path"] = path
    with _lock:
        _loaded = (m, body)
    return body


def _pick(stage: int, key: str, default: dict, path: str) -> tuple:
    art = load(path)
    table = art[key] if art else default
    return table[min(max(int(stage), 0), 2)]


def weights_for(stage: int, path: str = PATH) -> tuple:
    return _pick(stage, "_weights", DEFAULT_WEIGHTS, path)


def sharpness_weights_for(stage: int, path: str = PATH) -> tuple:
    return _pick(stage, "_sharpness", DEFAULT_SHARPNESS, path)


def novelty_weights_for(stage: int, path: str = PATH) -> tuple:
    return _pick(stage, "_novelty", DEFAULT_NOVELTY, path)


def status(path: str = PATH) -> dict:
    """What `/api/analytics/status` reports: which weights are in use."""
    art = load(path)
    if not art:
        return {"brain": BRAIN, "fitted": False}
    meta = art.get("meta") or {}
    return {"brain": art.get("brain") or BRAIN, "fitted": True,
            "trainedAt": meta.get("trainedAt"), "duels": meta.get("duels"),
            "holdout": meta.get("holdout")}
