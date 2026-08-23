"""Feature extraction for the change/edit model (M2).

LEAK-FREE BY CONSTRUCTION. Every function here takes a `PredictionExample` and
reads only `history`, `cluster_history` and `previous` — all of which are the
prefix strictly before T. `truth` is never touched, and `test_ml_features.py`
proves it by blanking the truth and asserting the vector is unchanged.

The vector is a flat list of floats in FEATURE_NAMES order. That order is part
of the contract: a model trained on one ordering and scored on another fails
silently and plausibly, which is the worst failure mode available here.
"""
from __future__ import annotations

import collections
import datetime
import math
from typing import Sequence

from .dataset import DeckPlay, PredictionExample


FEATURE_NAMES = (
    # --- current state -----------------------------------------------------
    "cluster_size",             # how many times this shell has been played
    "n_variants",               # distinct exact lists inside the shell
    "variant_entropy",          # how spread the play is across those variants
    "consecutive_identical",    # unbroken run of the same list, at the end
    "stable_card_count",        # cards present in >=90% of the shell's plays
    "volatile_card_count",      # 8 - stable
    "modal_is_recent",          # do the two baselines currently agree?
    "distinct_cards_seen",      # size of the card pool this shell has drawn on
    # --- temporal ----------------------------------------------------------
    "plays_since_change",
    "log_hours_since_change",
    "log_hours_since_last_play",
    "churn_lifetime",
    "churn_last5",
    "churn_last20",
    # --- outcome -----------------------------------------------------------
    "prev_was_win",
    "win_rate_last5",
    "loss_streak",
    # --- player edit behaviour --------------------------------------------
    "log_edit_count",
    "one_card_edit_share",
    "two_card_edit_share",
    # --- domain ------------------------------------------------------------
    "is_duel",
)

N_FEATURES = len(FEATURE_NAMES)

_STABLE_SHARE = 0.9


def _parse(stamp: str) -> datetime.datetime | None:
    """`20260601T000058.000Z` -> datetime. None when unparseable."""
    if not stamp:
        return None
    try:
        return datetime.datetime.strptime(stamp[:15], "%Y%m%dT%H%M%S")
    except ValueError:
        return None


def _hours_between(later: str, earlier: str) -> float:
    a, b = _parse(later), _parse(earlier)
    if a is None or b is None:
        return 0.0
    return max(0.0, (a - b).total_seconds() / 3600.0)


def _entropy(counts: Sequence[int]) -> float:
    total = sum(counts)
    if total <= 0:
        return 0.0
    out = 0.0
    for c in counts:
        if c <= 0:
            continue
        p = c / total
        out -= p * math.log2(p)
    return out


def _edit_history(plays: Sequence[DeckPlay]) -> list[int]:
    """Cards swapped in at each consecutive step of THIS shell's history.

    `plays` is the cluster's own plays in time order, so consecutive entries are
    successive outings of one shell — not successive battles, which in a duel
    would be different decks of the same loadout.
    """
    out = []
    for i in range(1, len(plays)):
        out.append(len(plays[i].card_set - plays[i - 1].card_set))
    return out


def extract(example: PredictionExample) -> list[float]:
    """The feature vector, in FEATURE_NAMES order."""
    cluster = example.cluster_history or example.history
    prev = example.previous
    n = len(cluster)

    variants = collections.Counter(",".join(sorted(p.cards)) for p in cluster)
    edits = _edit_history(cluster)

    # --- current state -----------------------------------------------------
    consecutive = 0
    prev_sig = prev.card_set
    for play in reversed(cluster):
        if play.card_set == prev_sig:
            consecutive += 1
        else:
            break

    card_counts: collections.Counter = collections.Counter()
    for play in cluster:
        card_counts.update(play.card_set)
    stable = sum(1 for c in prev_sig if card_counts[c] / n >= _STABLE_SHARE)

    modal_sig = max(sorted(variants.items()), key=lambda kv: kv[1])[0]
    modal_is_recent = 1.0 if frozenset(modal_sig.split(",")) == prev_sig else 0.0

    # --- temporal ----------------------------------------------------------
    plays_since_change = 0
    hours_since_change = 0.0
    for i in range(len(cluster) - 1, 0, -1):
        if cluster[i].card_set != cluster[i - 1].card_set:
            plays_since_change = len(cluster) - i
            hours_since_change = _hours_between(example.timestamp,
                                                cluster[i].battle_time)
            break
    else:
        plays_since_change = n
        hours_since_change = _hours_between(example.timestamp,
                                            cluster[0].battle_time)

    churn_life = (sum(1 for e in edits if e) / len(edits)) if edits else 0.0
    churn5 = (sum(1 for e in edits[-5:] if e) / len(edits[-5:])) if edits else 0.0
    churn20 = (sum(1 for e in edits[-20:] if e) / len(edits[-20:])) if edits else 0.0

    # --- outcome -----------------------------------------------------------
    prev_win = 1.0 if (prev.result or "").lower() == "win" else 0.0
    last5 = cluster[-5:]
    wins5 = sum(1 for p in last5 if (p.result or "").lower() == "win")
    win_rate5 = wins5 / len(last5) if last5 else 0.0

    loss_streak = 0
    for play in reversed(cluster):
        if (play.result or "").lower() == "loss":
            loss_streak += 1
        else:
            break

    # --- edit behaviour ----------------------------------------------------
    n_edits = sum(1 for e in edits if e)
    ones = sum(1 for e in edits if e == 1)
    twos = sum(1 for e in edits if e == 2)

    return [
        float(n),
        float(len(variants)),
        _entropy(list(variants.values())),
        float(consecutive),
        float(stable),
        float(len(prev_sig) - stable),
        modal_is_recent,
        float(len(card_counts)),

        float(plays_since_change),
        math.log1p(hours_since_change),
        math.log1p(_hours_between(example.timestamp, cluster[-1].battle_time)),
        churn_life,
        churn5,
        churn20,

        prev_win,
        win_rate5,
        float(loss_streak),

        math.log1p(n_edits),
        (ones / n_edits) if n_edits else 0.0,
        (twos / n_edits) if n_edits else 0.0,

        1.0 if example.domain == "duel" else 0.0,
    ]


def label(example: PredictionExample) -> int:
    """0, 1 or 2 cards swapped in.

    Capped at 2 because the >=6-card cluster rule makes a 3-card edit a cluster
    SWITCH rather than an edit — it is structurally unobservable in this task,
    and the Phase 1 benchmark confirmed the 3+ bucket is empty in both domains.
    """
    return min(2, example.n_changes)
