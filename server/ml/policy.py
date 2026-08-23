"""Phase 7 — the deployable selective edit policy.

RECENT IS THE SAFETY BASELINE AND ABSTENTION IS A VALID PREDICTION. The policy
replaces Recent only when a specific candidate edit has enough evidence to beat
standing still. Every earlier phase either always edited (Phase 4), never edited
(Phase 5), or needed an oracle telling it which steps were edits (Phase 6). This
one decides on every step from information available before the truth.

THREE PARTS:

  CandidateGenerator  what edits are even considered — and `recall()` measures
                      whether the right answer is ever in the set, which
                      separates a generation failure from a ranking failure.
  Calibrator          turns a score into P(correct). Fitted on a slice used for
                      NOTHING else, because calibrating on training rows
                      measures memorisation.
  SelectivePolicy     expected utility: edit only when E[J|edit] > E[J|stay].

A NOTE ON WHAT "CORRECT" MEANS. A candidate is correct only if the deck it
produces equals the next deck exactly. Partial credit is handled by Jaccard in
the scorer, never by relaxing the target here.
"""
from __future__ import annotations

import collections
import math
from dataclasses import dataclass, field

from . import edit_model as EM
from . import predictability as PR


# --------------------------------------------------------------------------
# Candidate generation
# --------------------------------------------------------------------------

@dataclass
class CandidateGenerator:
    """Edits constructible from the prefix alone.

    STAY is always first. Beyond it, the beam is the top `width` exits crossed
    with the top `width` entries for each — deliberately narrow, because Phase 4
    measured the exit ranking at ~50% top-1 and a wider beam mostly adds
    candidates that cannot win while multiplying the scoring cost.
    """
    exit_model: object
    entry_model: object
    width: int = 3
    allow_two: bool = True

    def generate(self, view: dict) -> list[EM.Candidate]:
        exits = self.exit_model.rank(view)
        out = [EM.STAY]
        for a in exits[:self.width]:
            for x in self.entry_model.rank(dict(view, outgoing=[a]))[:self.width]:
                out.append(EM.Candidate((a,), (x,)))
        if self.allow_two:
            for i, a in enumerate(exits[:self.width]):
                for b in exits[i + 1:self.width]:
                    pair = tuple(sorted((a, b)))
                    ent = self.entry_model.rank(dict(view, outgoing=list(pair)))[:self.width]
                    for j, x in enumerate(ent):
                        for y in ent[j + 1:]:
                            out.append(EM.Candidate(pair, tuple(sorted((x, y)))))
        return out

    def recall(self, view: dict, next_deck) -> dict:
        """Is the true next deck reachable at all, and at what rank?

        THE CRITICAL DIAGNOSTIC. If the answer never enters the candidate set,
        no ranking model can recover it, and effort spent on ranking is wasted.
        """
        truth = frozenset(next_deck)
        prev = frozenset(view["prev_deck"])
        n_diff = len(truth - prev)
        cands = self.generate(view)
        rank = None
        for i, c in enumerate(cands):
            if c.apply(prev) == truth:
                rank = i
                break
        return {"found": rank is not None, "rank": rank,
                "n_candidates": len(cands), "n_diff": n_diff}


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

@dataclass
class Calibrator:
    """Platt scaling: a 1-D logistic fitted on held-out (score, outcome) pairs.

    Chosen over isotonic deliberately. Isotonic needs a lot of data per bin and
    happily reproduces noise as a step function; with a few thousand calibration
    rows a two-parameter fit is the safer estimator, and Phase 7 reports the
    before/after so the choice is checkable rather than asserted.
    """
    a: float = 1.0
    b: float = 0.0
    fitted: bool = False

    def fit(self, scores, labels, epochs: int = 200, lr: float = 0.5) -> "Calibrator":
        if not scores:
            return self
        for epoch in range(epochs):
            step = lr / (1.0 + epoch * 0.05)
            ga = gb = 0.0
            for s, y in zip(scores, labels):
                p = self._sig(self.a * s + self.b)
                ga += (p - y) * s
                gb += (p - y)
            n = len(scores)
            self.a -= step * ga / n
            self.b -= step * gb / n
        self.fitted = True
        return self

    @staticmethod
    def _sig(v: float) -> float:
        if v < -35:
            return 0.0
        if v > 35:
            return 1.0
        return 1.0 / (1.0 + math.exp(-v))

    def apply(self, score: float) -> float:
        if not self.fitted:
            return score
        return self._sig(self.a * score + self.b)


def reliability(probs, labels, bins: int = 10) -> list[dict]:
    """Equal-width bins with predicted vs observed frequency."""
    out = []
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        sel = [(p, y) for p, y in zip(probs, labels)
               if (p >= lo and p < hi) or (i == bins - 1 and p == 1.0)]
        if not sel:
            continue
        out.append({"lo": lo, "hi": hi, "n": len(sel),
                    "predicted": sum(p for p, _ in sel) / len(sel),
                    "observed": sum(y for _, y in sel) / len(sel)})
    return out


def ece(probs, labels, bins: int = 10) -> float:
    """Expected calibration error — mean |predicted - observed|, size-weighted."""
    rows = reliability(probs, labels, bins)
    n = len(probs)
    if not n or not rows:
        return 0.0
    return sum(r["n"] * abs(r["predicted"] - r["observed"]) for r in rows) / n


# --------------------------------------------------------------------------
# The policy
# --------------------------------------------------------------------------

@dataclass
class SelectivePolicy:
    """Edit only when expected Jaccard beats standing still."""
    generator: CandidateGenerator
    scorer: PR.PredictabilityModel
    calibrator: Calibrator
    j_wrong: float = 0.57
    #: Extra evidence a 2-card edit must clear. 1.0 means "no extra"; the
    #: harness sweeps it rather than assuming 1-card edits are always better.
    two_card_penalty: float = 1.0
    margin: float = 0.0
    stats: dict = field(default_factory=dict)

    def score_candidate(self, view: dict, cand: EM.Candidate, p_n: dict,
                        exit_probs: dict, entry_probs: dict) -> float:
        raw = self.scorer.predict(
            PR.extract(view, cand, p_n, exit_probs, entry_probs))
        p = self.calibrator.apply(raw)
        if cand.size == 2:
            p *= self.two_card_penalty
        return p

    def decide(self, view: dict, p_n: dict):
        """(best candidate or None, p_correct, E[J|edit], E[J|stay], should_edit).

        The candidate is returned even when it loses to staying — a coverage
        curve needs a score on every step, and `should_edit` carries the actual
        decision so the two can never be confused.
        """
        u_stay = sum(p_n.get(n, 0.0) * EM.jaccard_for_diff(n) for n in (0, 1, 2))
        cands = self.generator.generate(view)
        if len(cands) <= 1:
            return None, 0.0, u_stay, u_stay, False

        exits = self.generator.exit_model.rank(view)
        pos = {c: len(exits) - i for i, c in enumerate(exits)}
        exit_probs = EM.softmax_over(exits, lambda c: pos[c] / 2.0)

        # Track the best candidate REGARDLESS of whether it beats staying, so
        # a coverage/risk curve can be swept over confidences. `should_edit`
        # carries the actual decision; the candidate is diagnostic.
        best, best_p, best_u = None, 0.0, -1.0
        entry_cache: dict = {}
        for cand in cands:
            if cand.size == 0:
                continue
            key = cand.exits
            if key not in entry_cache:
                ranked = self.generator.entry_model.rank(
                    dict(view, outgoing=list(key)))
                epos = {c: len(ranked) - i for i, c in enumerate(ranked)}
                entry_cache[key] = EM.softmax_over(ranked, lambda c: epos[c] / 2.0)
            p = self.score_candidate(view, cand, p_n, exit_probs, entry_cache[key])
            u = p * 1.0 + (1.0 - p) * self.j_wrong
            if u > best_u:
                best, best_p, best_u = cand, p, u
        should_edit = best is not None and best_u > u_stay + self.margin
        return best, best_p, best_u, u_stay, should_edit


# --------------------------------------------------------------------------
# Error taxonomy
# --------------------------------------------------------------------------

def classify_abstention(view: dict, p_n: dict, best_p: float,
                        recall_info: dict) -> str:
    """Why the policy declined to act. One reason, most specific first."""
    if not recall_info.get("found"):
        return "candidate not generated"
    if p_n.get(0, 0.0) > 0.9:
        return "low change probability"
    if len(view.get("prior_edits", [])) < 3:
        return "insufficient player history"
    if view.get("cluster_size", 0) < 8:
        return "thin cluster"
    if best_p < 0.1:
        return "low candidate confidence"
    return "expected utility below staying"


def classify_error(view: dict, cand: EM.Candidate, next_deck) -> str:
    """Why a made edit was wrong."""
    prev = frozenset(view["prev_deck"])
    truth = frozenset(next_deck)
    true_out = prev - truth
    true_in = truth - prev
    got_out, got_in = frozenset(cand.exits), frozenset(cand.entries)
    if len(true_out) != cand.size:
        return "wrong edit count"
    if got_out == true_out and got_in != true_in:
        return "right exit, wrong entry"
    if got_out != true_out and got_in == true_in:
        return "right entry, wrong exit"
    if got_out & true_out or got_in & true_in:
        return "partially right"
    return "wrong exit and entry"
