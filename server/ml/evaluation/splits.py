"""Phase 1 baselines, and the event taxonomy every metric is split by.

THREE BASELINES, TWO TASKS, AND THEY DO NOT MIX.

  next deck        M0 modal, M1 recent
  incoming card    player-history frequency  (change events only)

A next-deck predictor produces no card ranking, and the frequency ranker
produces no deck. Reporting an incoming-card score against "modal" is how
36.7% / 58.0% gets misread as a property of the deck predictor it is not.
"""
from __future__ import annotations

import collections
from typing import Sequence

from ..dataset import DeckPlay, PredictionExample


# --------------------------------------------------------------------------
# Next-deck baselines. Each receives ONLY history; never `truth`.
# --------------------------------------------------------------------------

def modal(example: PredictionExample) -> frozenset[str]:
    """M0 — the most-frequent exact variant. PRODUCTION BEHAVIOUR.

    Ties break on the sorted signature so identical data always predicts
    identically, matching `cluster_player_decks`'s deterministic ordering.
    """
    return _modal_of(example.cluster_history or example.history)


def recent(example: PredictionExample) -> frozenset[str]:
    """M1 — the most recent exact variant in the cluster the player is on."""
    source = example.cluster_history or example.history
    return source[-1].card_set


def modal_ranked(example: PredictionExample, k: int = 3) -> list[frozenset[str]]:
    """Top-k distinct variants by frequency, for exact@3."""
    return _ranked_of(example.cluster_history or example.history, k)


def recent_ranked(example: PredictionExample, k: int = 3) -> list[frozenset[str]]:
    """Most recent k DISTINCT variants, newest first."""
    source = example.cluster_history or example.history
    seen: list[frozenset[str]] = []
    for play in reversed(source):
        cs = play.card_set
        if cs not in seen:
            seen.append(cs)
        if len(seen) >= k:
            break
    return seen


def _modal_of(plays: Sequence[DeckPlay]) -> frozenset[str]:
    counts = collections.Counter(",".join(sorted(p.cards)) for p in plays)
    best = max(sorted(counts.items()), key=lambda kv: kv[1])[0]
    return frozenset(best.split(","))


def _ranked_of(plays: Sequence[DeckPlay], k: int) -> list[frozenset[str]]:
    counts = collections.Counter(",".join(sorted(p.cards)) for p in plays)
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [frozenset(sig.split(",")) for sig, _ in ordered[:k]]


NEXT_DECK_MODELS = {
    "M0 modal": (modal, modal_ranked),
    "M1 recent": (recent, recent_ranked),
}


# --------------------------------------------------------------------------
# Incoming-card baseline — change events only
# --------------------------------------------------------------------------

def incoming_candidates(example: PredictionExample) -> list[str]:
    """Cards ranked by how often this player has used them, in this cluster.

    CANDIDATES EXCLUDE EVERY CARD ALREADY IN THE PREVIOUS DECK. A card that is
    already fielded cannot be "swapped in", and leaving them in the pool would
    let the ranker score points on cards that were never at issue.

    History only — the truth is not consulted, so a card the player has never
    brought is unrankable here. That is a real ceiling on this baseline
    (measured: 61.8% of duel incoming cards had been seen before) and it is the
    number a transition or meta-prior model would have to beat.
    """
    source = example.cluster_history or example.history
    prev = example.previous.card_set
    freq: collections.Counter = collections.Counter()
    for play in source:
        freq.update(play.card_set - prev)
    return [card for card, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))]


# --------------------------------------------------------------------------
# Event taxonomy
# --------------------------------------------------------------------------

EVENT_BUCKETS = ("overall", "no-change", "change",
                 "1-card", "2-card", "3+-card")


def buckets_for(example: PredictionExample) -> tuple[str, ...]:
    """Which report rows this example contributes to."""
    if not example.changed:
        return ("overall", "no-change")
    n = example.n_changes
    size = "1-card" if n == 1 else "2-card" if n == 2 else "3+-card"
    return ("overall", "change", size)
