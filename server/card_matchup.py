"""THE CARD MATCHUP MODEL — what the cards in two decks say about a game.

WHY THIS EXISTS (2026-10-11)
============================

Asked for: "enhance the Deck Counter so it suggests counters better — right now
is fine, we need exceptional; check machine learning models, compare, and only
if proof happens do anything."

What the fused rate (`matchup_fusion`) cannot see was measured first. It knows
an opponent's ARCHETYPE from thousands of games, and their actual CARDS only
where list-level evidence exists — a fifth of held-out games. Counting cannot
close that gap: of the 8.0 million deck pairs the ladder has produced, 94% were
played exactly once.

A model with one weight per card and one per card-against-card shares strength
across every pair that holds them. Fitted on the ladder pair table (10.6M
games) and every stored duel game, with who played and at what card levels
taken out, then scored ONCE on 24,307 duel games it had not seen (1-11 October
2026, settings frozen on the week before). Log loss, lower is better:

    the archetype matrix                           0.6400
    the fused rate (production until this)         0.6328
    which cards each side holds, no interactions   0.6342   (no gain)
    card against card, duels only                  0.6181
    card against card, ladder + duels (this)       0.6131
    THE FUSED RATE AND THIS, TOGETHER              0.6123   -0.0205 [-0.0232, -0.0176]

For scale, fusing the ladder with the duels gained 0.0080 when it shipped.

And it picks better, which is the point:

  * INSIDE ONE DUEL the two pilots are the same, so who is playing cannot move
    the number. Of 4,194 pairs of games one pilot won and lost, the won game
    was rated higher 58.4% of the time by the fused rate and 66.2% by the two
    together (+7.8 points [+5.9, +9.6]); friendly duels 59.6% -> 65.2%.
  * Against the same opponent archetype, the quarter of lists each predictor
    rated highest won 5.4 points over the group's average by the fused rate and
    12.4 by the two together.
  * It holds in friendly duels (-0.0206) and for a pilot who had never played
    the list before (-0.0238) — the Deck Counter's reader.

Where it does NOT help: against the 129 most common exact lists the fused rate
is already as good. A gradient-boosted model scored a little better again and
a low-rank one the same as this; this is the one that is a few additions a
pair in plain Python. Evidence: `brain-evidence/counter_ml_20261011/`.

HOW IT IS USED
==============

`team_analysis._FusionContext` asks for it (the Deck Counter's list and Team
Analysis; Coach Assist does not ask and is unmoved). The figure a row carries
becomes

    logit(rate) = STACK_FUSED * logit(fused rate) + STACK_MODEL * model

with both weights fitted on the tuning week (0.188 and 1.009; 0.201 and 0.982
on the first run). The fused rate keeps the part it is good at — list-level
evidence — and the model supplies the cards.

THE ARITHMETIC
==============

    model(my deck, their deck) = sum(main[i] for i in mine)
                               - sum(main[j] for j in theirs)
                               + sum(x(i, j) for i in mine, j in theirs, i != j)

`x(i, j) = pair[i|j]` when `i < j`, and `-pair[j|i]` otherwise, so the model is
antisymmetric by construction: P(A beats B) = 1 - P(B beats A), and a card both
decks hold cancels in the main terms.

It is LINEAR IN THEIR DECK, which is what makes it cheap: one opponent list is
prepared once as `(constant, {card: value})` (`vector`), and every candidate
list after that is eight additions (`score`). The same function takes a SHARE
of lists holding each card instead of a deck, which is the average opponent of
an archetype — what a list's rate against the field needs.

Pure: no database, no numpy. `card_matchup_train.py` builds the artifact.
"""
from __future__ import annotations

import json
import math
import os
import threading

BRAIN = "card-matchup-1.0"

#: Weights of the two logits in the figure. Fitted on the tuning week
#: (24 Sep - 1 Oct 2026, 14,560 games): 0.188 / 1.009. Not refitted by the
#: trainer — that needs the fused rate rebuilt as of a past date for every
#: held-out game, which is the lab's job, not a timer's.
STACK_FUSED = 0.19
STACK_MODEL = 1.0

PATH = os.environ.get("CLASH_CARD_MATCHUP") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".card_matchup.json")

_lock = threading.Lock()
_loaded: tuple | None = None


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def sig(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def prepare(body: dict) -> dict | None:
    """An artifact's body as a model: `main` and the two-way `x` table.
    None when it holds no weights."""
    main = {str(k): float(v) for k, v in (body.get("main") or {}).items()}
    x: dict[str, dict[str, float]] = {}
    for key, v in (body.get("pair") or {}).items():
        a, _, b = str(key).partition("|")
        if not a or not b or a == b:
            continue
        v = float(v)
        x.setdefault(a, {})[b] = v
        x.setdefault(b, {})[a] = -v
    if not main and not x:
        return None
    cards = sorted(set(main) | set(x))
    return {"main": main, "x": x, "cards": cards, "meta": body.get("meta") or {},
            "brain": body.get("brain") or BRAIN}


def load(path: str | None = None) -> dict | None:
    """The trained model, or None when there is none. Re-read when the file
    changes; a file that cannot be read is no model, never an error."""
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
            model = prepare(json.load(f))
    except (OSError, ValueError, TypeError, AttributeError):
        model = None
    with _lock:
        _loaded = ((path, m), model)
    return model


def stamp(path: str | None = None):
    """When the artifact last changed (None without one): a new model is a
    new counter pool, because each list's rate against the field reads it."""
    try:
        return os.path.getmtime(path or PATH)
    except OSError:
        return None


def raw(model: dict, mine, theirs) -> float:
    """The model's logit for `mine` beating `theirs`, term by term. The slow,
    obvious form: `vector` + `score` is what a caller rating a pool uses, and
    a test holds the two equal."""
    main, x = model["main"], model["x"]
    z = sum(main.get(c, 0.0) for c in mine) - sum(main.get(c, 0.0) for c in theirs)
    for i in mine:
        row = x.get(i)
        if row:
            z += sum(row.get(j, 0.0) for j in theirs if j != i)
    return z


def vector(model: dict, theirs) -> tuple[float, dict[str, float]]:
    """One opponent, prepared once: `(constant, {my card: value})`.

    `theirs` is a deck (cards) or `{card: share}` — the fraction of an
    archetype's lists holding each card, for the average opponent of that
    archetype. `score(vector, my cards)` is then the model's logit.
    """
    share = theirs if isinstance(theirs, dict) else {c: 1.0 for c in theirs}
    main, x = model["main"], model["x"]
    const = -sum(q * main.get(j, 0.0) for j, q in share.items())
    vec: dict[str, float] = {}
    for i in model["cards"]:
        v = main.get(i, 0.0)
        row = x.get(i)
        if row:
            v += sum(q * row.get(j, 0.0) for j, q in share.items() if j != i)
        vec[i] = v
    return const, vec


def score(vec: tuple, mine) -> float:
    """The model's logit for `mine` against a prepared opponent."""
    const, values = vec
    return const + sum(values.get(c, 0.0) for c in mine)


def combine(fused_rate: float, model_logit: float) -> float:
    """The figure: the fused rate (0-100) and the model together, 0-100."""
    z = STACK_FUSED * logit(float(fused_rate) / 100.0) + STACK_MODEL * float(model_logit)
    return round(100.0 * sig(z), 1)


def status(path: str | None = None) -> dict:
    """For `/api/analytics/status`: is there a model, and what it measured."""
    model = load(path)
    if model is None:
        return {"available": False}
    meta = model.get("meta") or {}
    return {"available": True, "brain": model.get("brain"), "cards": len(model["cards"]),
            "pairs": sum(len(r) for r in model["x"].values()) // 2,
            "stack": [STACK_FUSED, STACK_MODEL],
            **{k: meta.get(k) for k in ("trainedAt", "ladderGames", "ladderPairs",
                                        "duelGames", "holdout", "seconds")}}
