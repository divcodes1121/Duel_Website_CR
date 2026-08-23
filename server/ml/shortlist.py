"""Phase 14 — the product shape the evidence actually supports.

THIRTEEN PHASES OF MEASUREMENT SAY THIS AND NOT MORE:

    Recent is undefeated as THE prediction     0.9678 / 0.8710 Jaccard
    change detection is strong                 ROC-AUC 0.932 / 0.803
    the truth is in the candidate pool         89-94% (1-card)
    the truth is in the top 10                 43-49%
    exit prediction plateaus                   ~45% / ~53% top-1
    exact next-deck prediction                 never beat Recent

So the system does not claim to know the next deck. It states the safest
prediction, and — only where the evidence supports it — offers ranked
alternatives with an honest confidence band.

RECENT IS NEVER DISPLACED. That is a structural guarantee, not a tuned
threshold: `primary` is always the current deck, so overall Jaccard and exact@1
are IDENTICAL to the Recent baseline by construction. The shortlist can only
add information; it cannot cost accuracy. Every attempt to let a model overrule
Recent (Phases 4, 5, 6, 7) lost, and this design makes that failure mode
unreachable rather than unlikely.
"""
from __future__ import annotations

from dataclasses import dataclass, field

#: Confidence bands for the shortlist as a whole. Derived from the measured
#: top-10 recall (43-49%) and change rates, NOT from a tuned cut.
HIGH, MEDIUM, LOW, NONE = "high", "medium", "low", "none"


@dataclass
class Alternative:
    """One possible next deck, with why it is being suggested."""
    cards: list
    exits: tuple
    entries: tuple
    rank: int
    confidence: str
    evidence: list = field(default_factory=list)


@dataclass
class Shortlist:
    """What the product returns for one opponent at one moment."""
    primary: list                      # ALWAYS the current/Recent deck
    primary_confidence: str
    change_probability: float
    alternatives: list = field(default_factory=list)
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "primary": {"cards": list(self.primary),
                        "confidence": self.primary_confidence,
                        "basis": "most recent deck in this shell"},
            "changeProbability": round(self.change_probability, 3),
            "alternatives": [
                {"cards": list(a.cards), "out": list(a.exits),
                 "in": list(a.entries), "rank": a.rank,
                 "confidence": a.confidence, "evidence": list(a.evidence)}
                for a in self.alternatives],
            "note": self.note,
        }


def _band(p_change: float, rank: int, support: int) -> str:
    """Confidence for ONE alternative.

    Deliberately conservative. Phase 13 measured exit top-1 at 35-47%, so no
    single alternative is ever 'high' unless a change looks likely AND it is the
    leading candidate AND the player has real history behind it.
    """
    if p_change < 0.15:
        return LOW
    if rank == 1 and p_change >= 0.5 and support >= 5:
        return HIGH
    if rank <= 3 and p_change >= 0.3:
        return MEDIUM
    return LOW


def _primary_band(p_change: float) -> str:
    """How sure we are that the CURRENT deck is what they bring.

    This is the one number the system is genuinely good at: the change detector
    reaches ROC-AUC 0.932 / 0.803, and Recent is right 89.7% / 58.8% of the time.
    """
    if p_change < 0.15:
        return HIGH
    if p_change < 0.45:
        return MEDIUM
    return LOW


def build(prev_deck, p_change: float, ranked_candidates, support_of,
          max_alternatives: int = 3) -> Shortlist:
    """Assemble the product payload.

    `ranked_candidates` is the frozen generator's output already ordered by the
    best available ranker; `support_of(candidate)` returns how many prior edits
    back it. Nothing here re-ranks — this layer only decides what to SHOW and
    how strongly to phrase it.
    """
    prev = list(prev_deck)
    primary_conf = _primary_band(p_change)

    alts = []
    for cand in ranked_candidates:
        if cand.size == 0:
            continue
        if len(alts) >= max_alternatives:
            break
        support = support_of(cand)
        rank = len(alts) + 1
        evidence = []
        if support:
            evidence.append("this player has made this swap %d time%s before"
                            % (support, "" if support == 1 else "s"))
        evidence.append("drops %s for %s"
                        % (", ".join(cand.exits), ", ".join(cand.entries)))
        alts.append(Alternative(sorted(cand.apply(prev)), cand.exits,
                                cand.entries, rank,
                                _band(p_change, rank, support), evidence))

    if p_change < 0.15:
        note = ("No strong change signal — the current deck is the safest "
                "prediction.")
    elif not alts:
        note = "A change looks possible, but no specific alternative is supported."
    else:
        note = ("A change looks possible. These are plausible configurations, "
                "not forecasts.")
    return Shortlist(prev, primary_conf, p_change, alts, note)


def coverage(shortlist: Shortlist, next_deck) -> dict:
    """Did the shortlist contain what actually happened?

    `primary_correct` is the honest headline — it is exactly the Recent
    baseline. `in_alternatives` is the value this layer adds on top.
    """
    truth = frozenset(next_deck)
    primary_ok = frozenset(shortlist.primary) == truth
    hit_rank = None
    for a in shortlist.alternatives:
        if frozenset(a.cards) == truth:
            hit_rank = a.rank
            break
    return {"primary_correct": primary_ok,
            "in_alternatives": hit_rank is not None,
            "alternative_rank": hit_rank,
            "covered": primary_ok or hit_rank is not None}
