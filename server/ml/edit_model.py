"""Phase 5 — the complete EDIT DECISION: stay, or make this specific change.

PHASE 4 SETTLED WHAT THIS MODULE IS FOR. The chain could already say "a change
is coming" but not "this change", and because the current deck is a very strong
prior, a wrong edit costs more than standing still: Jaccard 0.54-0.59 when wrong
against 0.68 for doing nothing. So the objective here is NOT a better ranking.
It is a decision:

    edit only when  E[Jaccard | edit]  >  E[Jaccard | stay]

Break-even accuracy for a predicted edit, solved from Phase 4's measurements:
competitive 30.3% (currently 9.8%), duel 23.3% (currently 14.4%).

TWO RULES CARRIED FROM THE SPARSE-DATA BUGS IN PHASES 3 AND 4:

  1. Shrink the ESTIMATE — `count / (support + K)`, never `count / support`.
  2. Shrink the SOURCE'S INFLUENCE too. Phase 4 proved these are different: a
     shrunk probability still won outright because the layer weights were not
     commensurate. Every Evidence here carries its support, and `combine()`
     scales the whole source by it.

INDEPENDENCE IS TESTED, NOT ASSUMED. ~52% of edits move two cards. Whether
P(A,B) factorises into P(A)P(B) is an empirical question, so the joint models
compute both and the harness reports the difference.
"""
from __future__ import annotations

import collections
import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from . import exit_model as E
from . import substitution as S

#: Shrinkage constant, shared with Phases 3-4 so one number governs all of it.
MIN_SUPPORT = 3.0

#: Jaccard of a deck that differs by n cards, both being 8 cards:
#: |intersection| = 8-n, |union| = 8+n.
STAY_J = {0: 1.0, 1: 7.0 / 9.0, 2: 6.0 / 10.0}


def jaccard_for_diff(n: int) -> float:
    return STAY_J.get(n, (8.0 - n) / (8.0 + n) if n < 8 else 0.0)


def confidence(support: float) -> float:
    """Shrunk influence for a whole evidence source, in [0, 1)."""
    return support / (support + MIN_SUPPORT)


@dataclass
class Evidence:
    """A distribution plus how much data stands behind it.

    Keeping support attached is the whole point — a caller cannot accidentally
    use the distribution without also seeing how thin it is.
    """
    dist: dict = field(default_factory=dict)
    support: float = 0.0

    def weighted(self) -> dict:
        w = confidence(self.support)
        return {k: v * w for k, v in self.dist.items()}


def combine(sources: Sequence[tuple[Evidence, float]], keys: Iterable) -> dict:
    """Blend evidence sources into a normalised distribution over `keys`.

    Each source is scaled by BOTH its own shrunk probabilities and its support,
    which is the Phase 4 lesson made structural.
    """
    score: dict = collections.defaultdict(float)
    for ev, prior in sources:
        if not ev.dist:
            continue
        for k, p in ev.weighted().items():
            score[k] += prior * p
    keys = list(keys)
    total = sum(max(0.0, score.get(k, 0.0)) for k in keys)
    if total <= 0:
        return {k: 1.0 / len(keys) for k in keys} if keys else {}
    return {k: max(0.0, score.get(k, 0.0)) / total for k in keys}


def softmax_over(items: Sequence, score, temperature: float = 1.0) -> dict:
    """Turn arbitrary real scores into a distribution.

    Ranking models emit scores on no particular scale; expected utility needs
    probabilities. Temperature is fitted on validation, never guessed.
    """
    if not items:
        return {}
    vals = [score(i) / max(1e-6, temperature) for i in items]
    top = max(vals)
    exps = [math.exp(v - top) for v in vals]
    total = sum(exps)
    return {i: e / total for i, e in zip(items, exps)}


# --------------------------------------------------------------------------
# Population statistics, fitted on TRAIN edits only
# --------------------------------------------------------------------------

class JointStats:
    """Pair-level counts, so independence can be tested rather than assumed."""

    def __init__(self):
        self.exit_pair: collections.Counter = collections.Counter()
        self.exit_single: collections.Counter = collections.Counter()
        self.entry_given_exit: dict = collections.defaultdict(collections.Counter)
        self.entry_pair_given_exit: dict = collections.defaultdict(collections.Counter)
        self.n_edits = 0

    def fit(self, events: Iterable[dict]) -> "JointStats":
        for ev in events:
            out = tuple(sorted(ev["outgoing"]))
            inc = tuple(sorted(ev["incoming"]))
            self.n_edits += 1
            for c in out:
                self.exit_single[c] += 1
            if len(out) == 2:
                self.exit_pair[out] += 1
            key = out
            for c in inc:
                self.entry_given_exit[key][c] += 1
            if len(inc) == 2:
                self.entry_pair_given_exit[key][inc] += 1
        return self

    def joint_exit(self, pair: tuple) -> Evidence:
        n = self.exit_pair.get(tuple(sorted(pair)), 0)
        return Evidence({tuple(sorted(pair)): n / (self.n_edits + MIN_SUPPORT)},
                        float(n))

    def independent_exit(self, pair: tuple) -> float:
        total = max(1, self.n_edits)
        p = 1.0
        for c in pair:
            p *= self.exit_single.get(c, 0) / (total + MIN_SUPPORT)
        return p


# --------------------------------------------------------------------------
# Candidate edits
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Candidate:
    """One possible next deck. `exits` empty means STAY."""
    exits: tuple = ()
    entries: tuple = ()

    @property
    def size(self) -> int:
        return len(self.exits)

    def apply(self, deck: Iterable[str]) -> frozenset:
        return (frozenset(deck) - frozenset(self.exits)) | frozenset(self.entries)


STAY = Candidate()


def generate(ev: dict, exit_rank: Sequence[str], entry_rank_for,
             width: int = 3) -> list[Candidate]:
    """STAY, the top 1-card swaps, and the top 2-card swaps.

    Deliberately narrow. Scoring every legal edit is 8 x |pool| for one card and
    far worse for two, and Phase 4 showed the ranking is only ~50% accurate at
    the top — so a wide beam mostly adds candidates that cannot win.
    """
    out: list[Candidate] = [STAY]
    for a in exit_rank[:width]:
        for x in entry_rank_for((a,))[:width]:
            out.append(Candidate((a,), (x,)))
    for i, a in enumerate(exit_rank[:width]):
        for b in exit_rank[i + 1:width]:
            pair = tuple(sorted((a, b)))
            entries = entry_rank_for(pair)[:width]
            for j, x in enumerate(entries):
                for y in entries[j + 1:]:
                    out.append(Candidate(pair, tuple(sorted((x, y)))))
    return out


# --------------------------------------------------------------------------
# The decision
# --------------------------------------------------------------------------

@dataclass
class EditDecision:
    """Expected-utility choice between standing still and one specific edit.

    `j_wrong` is the measured Jaccard of a wrong edit — 0.5445 competitive,
    0.5912 duel from Phase 4. It is a parameter rather than a constant because
    it is a property of the data, and a future model that makes better wrong
    guesses would change it.
    """
    exit_model: E.ExitRanker
    entry_model: S.Ranker
    joint: JointStats
    j_wrong: float = 0.57
    temperature: float = 1.0
    use_joint: bool = True
    width: int = 3

    def _entry_ranker(self, ev: dict):
        def rank(exits: tuple) -> list[str]:
            return self.entry_model.rank(dict(ev, outgoing=list(exits)))
        return rank

    def _exit_probs(self, ev: dict) -> dict:
        ranked = self.exit_model.rank(ev)
        pos = {c: len(ranked) - i for i, c in enumerate(ranked)}
        return softmax_over(ranked, lambda c: pos[c] / 2.0, self.temperature)

    def _entry_probs(self, ev: dict, exits: tuple) -> dict:
        ranked = self.entry_model.rank(dict(ev, outgoing=list(exits)))
        if not ranked:
            return {}
        pos = {c: len(ranked) - i for i, c in enumerate(ranked)}
        return softmax_over(ranked, lambda c: pos[c] / 2.0, self.temperature)

    def p_correct(self, ev: dict, cand: Candidate, p_n: dict) -> float:
        """P(this exact edit happens) = P(size) x P(exits) x P(entries|exits)."""
        if cand.size == 0:
            return p_n.get(0, 0.0)
        pe = self._exit_probs(ev)
        px = self._entry_probs(ev, cand.exits)
        p_exit = 1.0
        if cand.size == 1:
            p_exit = pe.get(cand.exits[0], 0.0)
        else:
            # INDEPENDENCE, TESTED. The joint count is used when it has support
            # and the factorised estimate carries the rest.
            indep = 1.0
            for c in cand.exits:
                indep *= pe.get(c, 0.0)
            indep *= 2.0                      # unordered pair, either order
            if self.use_joint:
                jn = self.joint.exit_pair.get(tuple(sorted(cand.exits)), 0)
                w = confidence(float(jn))
                p_joint = jn / (self.joint.n_edits + MIN_SUPPORT)
                p_exit = w * p_joint + (1.0 - w) * indep
            else:
                p_exit = indep
        p_entry = 1.0
        for c in cand.entries:
            p_entry *= px.get(c, 0.0)
        if cand.size == 2:
            p_entry *= 2.0
        return p_n.get(cand.size, 0.0) * p_exit * p_entry

    def expected_jaccard(self, ev: dict, cand: Candidate, p_n: dict) -> float:
        if cand.size == 0:
            # Standing still: right when nothing changed, otherwise off by n.
            return sum(p_n.get(n, 0.0) * jaccard_for_diff(n) for n in (0, 1, 2))
        p = self.p_correct(ev, cand, p_n)
        return p * 1.0 + (1.0 - p) * self.j_wrong

    def decide(self, ev: dict, p_n: dict) -> tuple[Candidate, float, float]:
        """(chosen candidate, its E[J], E[J] of staying)."""
        exits = self.exit_model.rank(ev)
        cands = generate(ev, exits, self._entry_ranker(ev), self.width)
        stay_u = self.expected_jaccard(ev, STAY, p_n)
        best, best_u = STAY, stay_u
        for cand in cands:
            if cand.size == 0:
                continue
            u = self.expected_jaccard(ev, cand, p_n)
            if u > best_u:
                best, best_u = cand, u
        return best, best_u, stay_u
