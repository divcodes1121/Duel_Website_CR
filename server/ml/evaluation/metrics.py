"""Every metric the Phase 1 benchmark reports. PURE — no I/O, no database.

Two tasks live here and they are kept mathematically separate on purpose:

  NEXT DECK      predict the 8-card set the player brings next.
  INCOMING CARD  given that a change happened, rank the cards that came IN.

A next-deck predictor has no incoming-card score and vice versa. Merging them
is how "36.7% / 58.0%" gets misread as a property of the modal deck predictor,
which produces no card ranking at all.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

# --------------------------------------------------------------------------
# Next-deck metrics — all operate on SETS of card keys
# --------------------------------------------------------------------------


def exact(pred: Iterable[str], truth: Iterable[str]) -> float:
    """1.0 when the predicted deck is exactly the deck played."""
    return 1.0 if set(pred) == set(truth) else 0.0


def exact_at_k(preds: Sequence[Iterable[str]], truth: Iterable[str],
               k: int = 3) -> float:
    """1.0 when any of the top-k predicted decks is exactly right."""
    t = set(truth)
    return 1.0 if any(set(p) == t for p in list(preds)[:k]) else 0.0


def jaccard(pred: Iterable[str], truth: Iterable[str]) -> float:
    p, t = set(pred), set(truth)
    union = p | t
    if not union:
        return 1.0
    return len(p & t) / len(union)


def hamming(pred: Iterable[str], truth: Iterable[str]) -> float:
    """Cards that differ — |symmetric difference|.

    For two 8-card decks this is 2x the number of swaps, which is why a
    one-card substitution scores 2.0 and not 1.0.
    """
    p, t = set(pred), set(truth)
    return float(len(p ^ t))


def card_precision(pred: Iterable[str], truth: Iterable[str]) -> float:
    p, t = set(pred), set(truth)
    if not p:
        return 0.0
    return len(p & t) / len(p)


def card_recall(pred: Iterable[str], truth: Iterable[str]) -> float:
    p, t = set(pred), set(truth)
    if not t:
        return 0.0
    return len(p & t) / len(t)


# --------------------------------------------------------------------------
# Ranking metrics — incoming-card task
# --------------------------------------------------------------------------


def top_k(ranked: Sequence[str], relevant: Iterable[str], k: int) -> float:
    """1.0 when any relevant item appears in the first k ranked candidates."""
    rel = set(relevant)
    return 1.0 if any(c in rel for c in ranked[:k]) else 0.0


def reciprocal_rank(ranked: Sequence[str], relevant: Iterable[str]) -> float:
    """1/rank of the FIRST relevant hit, 0.0 when none is ranked."""
    rel = set(relevant)
    for i, c in enumerate(ranked):
        if c in rel:
            return 1.0 / (i + 1)
    return 0.0


def ndcg(ranked: Sequence[str], relevant: Iterable[str], k: int = 10) -> float:
    """Binary-relevance NDCG@k.

    DCG = sum rel_i / log2(i + 2); IDCG puts every relevant item at the top.
    Returns 0.0 when nothing is relevant, which is the only sane value — the
    ideal ranking is empty and the ratio is undefined.
    """
    rel = set(relevant)
    if not rel:
        return 0.0
    dcg = 0.0
    for i, c in enumerate(ranked[:k]):
        if c in rel:
            dcg += 1.0 / math.log2(i + 2)
    ideal_n = min(len(rel), k)
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_n))
    return dcg / idcg if idcg else 0.0


# --------------------------------------------------------------------------
# Binary classification — the no-change control
# --------------------------------------------------------------------------


def prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    """(precision, recall, F1). A zero denominator yields 0.0, not a crash."""
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)
          if (precision + recall) else 0.0)
    return precision, recall, f1


def mean(values: Sequence[float]) -> float:
    vals = list(values)
    return sum(vals) / len(vals) if vals else 0.0


def median(values: Sequence[float]) -> float:
    vals = sorted(values)
    n = len(vals)
    if not n:
        return 0.0
    mid = n // 2
    return vals[mid] if n % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def decile(values: Sequence[float], q: float) -> float:
    """Nearest-rank quantile. q=0.1 -> worst decile, q=0.9 -> best decile."""
    vals = sorted(values)
    if not vals:
        return 0.0
    idx = max(0, min(len(vals) - 1, int(round(q * (len(vals) - 1)))))
    return vals[idx]


# --------------------------------------------------------------------------
# Probabilistic / imbalanced-classification metrics — added for Phase 2
# --------------------------------------------------------------------------
#
# Change-vs-no-change is imbalanced (6.9% competitive, 34.5% duel), so accuracy
# is uninformative and threshold-free ranking metrics carry the verdict.


def brier(probs: Sequence[float], labels: Sequence[int]) -> float:
    """Mean squared error of a probability against a 0/1 outcome.

    Lower is better. The all-zero predictor scores the positive rate, which is
    the number any probabilistic model has to beat.
    """
    if not probs:
        return 0.0
    return sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(probs)


def roc_auc(probs: Sequence[float], labels: Sequence[int]) -> float:
    """Rank-based AUC (Mann-Whitney U), ties given half credit.

    0.5 is chance. Returns 0.5 when one class is absent — undefined, and 0.5 is
    the only value that does not overstate.
    """
    pos = [p for p, y in zip(probs, labels) if y]
    neg = [p for p, y in zip(probs, labels) if not y]
    if not pos or not neg:
        return 0.5
    order = sorted(range(len(probs)), key=lambda i: probs[i])
    ranks = [0.0] * len(probs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and probs[order[j + 1]] == probs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    rank_sum = sum(r for r, y in zip(ranks, labels) if y)
    n_pos, n_neg = len(pos), len(neg)
    return (rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def pr_auc(probs: Sequence[float], labels: Sequence[int]) -> float:
    """Average precision — the area under precision-recall, computed as the
    precision at each positive, averaged.

    Preferred over ROC-AUC on imbalanced data: ROC-AUC is optimistic when
    negatives dominate, because a large true-negative mass flatters it.
    The no-skill baseline is the positive RATE, not 0.5.
    """
    n_pos = sum(1 for y in labels if y)
    if not n_pos or not probs:
        return 0.0
    order = sorted(range(len(probs)), key=lambda i: -probs[i])
    hits = 0
    total = 0.0
    for seen, idx in enumerate(order, start=1):
        if labels[idx]:
            hits += 1
            total += hits / seen
    return total / n_pos


def prf_at(probs: Sequence[float], labels: Sequence[int],
           threshold: float = 0.5) -> tuple[float, float, float]:
    """Precision / recall / F1 for the POSITIVE class at a threshold."""
    tp = fp = fn = 0
    for p, y in zip(probs, labels):
        pred = 1 if p >= threshold else 0
        if pred and y:
            tp += 1
        elif pred and not y:
            fp += 1
        elif not pred and y:
            fn += 1
    return prf(tp, fp, fn)
