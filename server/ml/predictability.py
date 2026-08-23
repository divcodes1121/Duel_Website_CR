"""Phase 6 — P(this proposed edit is correct). Predictability, not likelihood.

PHASE 5 FOUND THE TWO ARE ANTI-CORRELATED. M2 is most confident precisely when a
2-card edit is coming, and 2-card edits are hardest to get exactly right:
competitive whole-edit accuracy runs 19.2% in M2's lowest confidence quintile
down to 2.9% in its highest. So gating on P(change) selects the hardest cases,
and the chain was gated on the wrong quantity throughout Phases 4 and 5.

    LIKELIHOOD    "will something change?"        -> M2, already strong
    PREDICTABILITY "if it does, can I name it?"   -> this module

These are separate questions and they need separate models. M2 is kept as ONE
FEATURE here rather than as the gate.

THE SUPERVISED FRAMING. For every historical edit, ask the pipeline what it
would have proposed, then label that proposal with whether it was exactly right.
That is an ordinary binary classification problem, and the features that matter
are the ones M2 never had: how CONCENTRATED the evidence is, not how much of it
points at "something will change".

MARGIN IS THE IDEA. A player whose exits are spread over six cards is
unpredictable even when a change is certain; a player who always drops the same
card is predictable even when a change is unlikely. Margins and entropies
capture that; counts do not.
"""
from __future__ import annotations

import collections
import math
from dataclasses import dataclass, field

from . import edit_model as EM

FEATURE_NAMES = (
    "p_change",             # M2 — a feature now, not the gate
    "p_one_card",
    "p_two_card",
    "pred_size",            # 1 or 2 cards proposed
    "exit_margin",          # gap between the top two exit candidates
    "exit_entropy",         # how spread the exit distribution is
    "entry_margin",
    "entry_entropy",
    "entry_pool_size",      # how many cards could plausibly come in
    "exit_support",         # this player's prior edits
    "transition_support",   # prior edits sharing the proposed exit
    "exit_is_top_edited",   # is the proposal the card they usually drop?
    "cluster_size",
    "n_variants",
    "variant_entropy",
    "edit_concentration",   # share of prior edits on the single most-edited card
    "is_duel",
)

N_FEATURES = len(FEATURE_NAMES)
MIN_SUPPORT = 3.0


def _entropy(ps) -> float:
    out = 0.0
    for p in ps:
        if p > 0:
            out -= p * math.log2(p)
    return out


def _margin(sorted_probs) -> float:
    if len(sorted_probs) < 2:
        return 1.0 if sorted_probs else 0.0
    return sorted_probs[0] - sorted_probs[1]


def extract(ev: dict, cand: EM.Candidate, p_n: dict,
            exit_probs: dict, entry_probs: dict) -> list[float]:
    """Features of ONE proposed edit. Never reads the truth."""
    personal: collections.Counter = collections.Counter()
    for out, _inc in ev["prior_edits"]:
        for c in out:
            personal[c] += 1
    support = float(len(ev["prior_edits"]))
    trans = sum(1 for out, _i in ev["prior_edits"]
                if set(out) & set(cand.exits))

    ex_sorted = sorted(exit_probs.values(), reverse=True)
    en_sorted = sorted(entry_probs.values(), reverse=True)

    counts = ev["cluster_card_counts"]
    n = max(1, ev["cluster_size"])
    variants = max(1, len(counts))
    top_edited = personal.most_common(1)[0][0] if personal else None
    concentration = (personal.most_common(1)[0][1] / support) if (personal and support) else 0.0

    return [
        1.0 - p_n.get(0, 0.0),
        p_n.get(1, 0.0),
        p_n.get(2, 0.0),
        float(cand.size),
        _margin(ex_sorted),
        _entropy(ex_sorted),
        _margin(en_sorted),
        _entropy(en_sorted),
        float(len(entry_probs)),
        math.log1p(support),
        math.log1p(trans),
        1.0 if (top_edited and top_edited in cand.exits) else 0.0,
        math.log1p(n),
        math.log1p(variants),
        _entropy([v / sum(counts.values()) for v in counts.values()]),
        concentration,
        1.0 if ev["domain"] == "duel" else 0.0,
    ]


# --------------------------------------------------------------------------
# Binary logistic regression — same discipline as M2
# --------------------------------------------------------------------------

@dataclass
class PredictabilityModel:
    """P(proposed edit is exactly correct).

    Class weighting is OFF, matching M2: Phase 2 measured that weighting hurt
    ranking AND calibration, and this model's whole job is a usable probability.
    """
    epochs: int = 15
    lr: float = 0.1
    l2: float = 1e-4
    seed: int = 20260819
    w: list = field(default_factory=list)
    b: float = 0.0
    mean: list = field(default_factory=list)
    std: list = field(default_factory=list)

    def _scale(self, x):
        return [(v - m) / s for v, m, s in zip(x, self.mean, self.std)]

    def fit(self, rows: list, labels: list) -> "PredictabilityModel":
        import random
        n = len(rows)
        d = N_FEATURES
        self.mean = [0.0] * d
        self.std = [1.0] * d
        if n:
            for j in range(d):
                col = [r[j] for r in rows]
                mu = sum(col) / n
                var = sum((v - mu) ** 2 for v in col) / n
                self.mean[j] = mu
                self.std[j] = math.sqrt(var) if var > 1e-12 else 1.0
        scaled = [self._scale(r) for r in rows]
        self.w = [0.0] * d
        self.b = 0.0
        order = list(range(n))
        rng = random.Random(self.seed)
        for epoch in range(self.epochs):
            rng.shuffle(order)
            lr = self.lr / (1.0 + epoch)
            for i in order:
                z = scaled[i]
                p = self._sig(self.b + sum(wi * zi for wi, zi in zip(self.w, z)))
                err = labels[i] - p
                for j in range(d):
                    self.w[j] += lr * (err * z[j] - self.l2 * self.w[j])
                self.b += lr * err
        return self

    @staticmethod
    def _sig(v: float) -> float:
        if v < -35:
            return 0.0
        if v > 35:
            return 1.0
        return 1.0 / (1.0 + math.exp(-v))

    def predict(self, x: list) -> float:
        if not self.w:
            return 0.0
        z = self._scale(x)
        return self._sig(self.b + sum(wi * zi for wi, zi in zip(self.w, z)))

    def top_weights(self, k: int = 8):
        if not self.w:
            return []
        return sorted(zip(FEATURE_NAMES, self.w),
                      key=lambda kv: -abs(kv[1]))[:k]


# --------------------------------------------------------------------------
# Proposal — what the pipeline WOULD do, so it can be labelled
# --------------------------------------------------------------------------

def propose(ev: dict, p_n: dict, exit_model, entry_model):
    """(candidate, exit_probs, entry_probs) — the pipeline's single best edit.

    Deterministic and truth-free: the size comes from M2, the exit from the
    exit model, the entry from the entry model conditioned on that exit.
    """
    size = 1 if p_n.get(1, 0.0) >= p_n.get(2, 0.0) else 2
    ranked_exit = exit_model.rank(ev)
    pos = {c: len(ranked_exit) - i for i, c in enumerate(ranked_exit)}
    exit_probs = EM.softmax_over(ranked_exit, lambda c: pos[c] / 2.0)
    exits = tuple(ranked_exit[:size])

    ranked_entry = entry_model.rank(dict(ev, outgoing=list(exits)))
    if not ranked_entry:
        return None, exit_probs, {}
    epos = {c: len(ranked_entry) - i for i, c in enumerate(ranked_entry)}
    entry_probs = EM.softmax_over(ranked_entry, lambda c: epos[c] / 2.0)
    entries = tuple(ranked_entry[:size])
    if len(entries) < size:
        return None, exit_probs, entry_probs
    return EM.Candidate(exits, entries), exit_probs, entry_probs


def was_correct(ev: dict, cand: EM.Candidate) -> float:
    truth = (frozenset(ev["prev_deck"]) - frozenset(ev["outgoing"])) \
        | frozenset(ev["incoming"])
    return 1.0 if cand.apply(ev["prev_deck"]) == truth else 0.0
