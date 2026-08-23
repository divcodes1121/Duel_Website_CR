"""Phase 4 — which card LEAVES. The other half of a deployable substitution.

WHY THIS IS THE BOTTLENECK. Phase 3 showed that conditioning on the outgoing
card lifts incoming-card top-1 by +6.85 pts (competitive) and +5.04 (duel), both
significant. But S2 was HANDED the true exit. Production has to predict it, so
that gain is an upper bound scaled by however often the exit is right — and the
first heuristic gets it right about half the time. Closing that gap is worth
more than any further context modelling, which Phase 3 measured at zero.

THREE QUANTITIES THAT ARE NOT THE SAME THING, and separating them is the point:

    usage        how often the card is fielded
    stability    how consistently it stays across outings
    editability  how often it is the card that actually LEAVES

A staple can be low-usage and never edited (a niche but fixed slot); a card can
be high-usage and highly editable (the flex slot that keeps being retuned). E0-E2
are stability models; E3 is the first editability model.

Shrinkage is inherited from Phase 3 for the same reason: one observed exit must
not outrank a well-supported alternative.
"""
from __future__ import annotations

import collections
from typing import Iterable, Sequence

MIN_SUPPORT = 3.0

#: Half-life in OUTINGS for the recency blend. Tuned on validation, not by eye.
RECENCY_WINDOWS = (5, 10, 20)


def _rank_by(deck: Sequence[str], score, reverse: bool = True) -> list[str]:
    """Deterministic ranking. Ties break on the card key, always."""
    return sorted(deck, key=lambda c: (-score(c) if reverse else score(c), c))


class PopulationExitStats:
    """Card-level exit propensity, fitted on TRAIN edits only.

    `exits[card] / seen[card]` is how often a card, when present in a deck that
    got edited, was the one dropped. That is a population editability prior and
    it is what a player with no personal history backs off to.
    """

    def __init__(self):
        self.exits: collections.Counter = collections.Counter()
        self.seen: collections.Counter = collections.Counter()

    def fit(self, events: Iterable[dict]) -> "PopulationExitStats":
        for ev in events:
            out = set(ev["outgoing"])
            for card in ev["prev_deck"]:
                self.seen[card] += 1
                if card in out:
                    self.exits[card] += 1
        return self

    def editability(self, card: str) -> float:
        n = self.seen.get(card, 0)
        if not n:
            return 0.0
        return self.exits.get(card, 0) / (n + MIN_SUPPORT)


class ExitRanker:
    name = "exit"

    def __init__(self, stats: PopulationExitStats | None = None):
        self.stats = stats or PopulationExitStats()

    def rank(self, ev: dict) -> list[str]:
        raise NotImplementedError


class E0LeastStable(ExitRanker):
    """The Phase 3 heuristic, carried over unchanged as the floor.

    Rank by raw cluster frequency, least-fielded first.
    """
    name = "E0 least-stable"

    def rank(self, ev: dict) -> list[str]:
        counts = ev["cluster_card_counts"]
        n = max(1, ev["cluster_size"])
        return _rank_by(ev["prev_deck"], lambda c: counts.get(c, 0) / n,
                        reverse=False)


class E1PlayerStability(ExitRanker):
    """Shrunk P(card stays), plus the streak it is currently on.

    Adds two things E0 cannot see: the estimate is shrunk toward the cluster
    mean so a card seen twice in a two-play shell is not called perfectly
    stable, and an unbroken run of appearances counts as evidence of stability
    independent of the raw rate.
    """
    name = "E1 player-stability"

    def rank(self, ev: dict) -> list[str]:
        counts = ev["cluster_card_counts"]
        n = max(1, ev["cluster_size"])
        streak = ev.get("streak", {})

        def stay(card: str) -> float:
            p = counts.get(card, 0) / (n + MIN_SUPPORT)
            return p + 0.02 * min(streak.get(card, 0), 10)

        return _rank_by(ev["prev_deck"], stay, reverse=False)


class E2RecencyStability(ExitRanker):
    """Long / medium / short usage blended, plus time since last appearance.

    THE CASE THIS EXISTS FOR: a card fielded 40 times but absent from the last
    15 outings is not more stable than one fielded 12 times in the last 12. E0
    and E1 both get that wrong because an aggregate count has no memory of when.
    """
    name = "E2 recency-stability"

    #: Weight PER WINDOW, shortest first — recent evidence dominates.
    #:
    #: This was written as two parallel tuples zipped together and the zip
    #: silently mis-paired them: the 20-outing window got the largest weight
    #: and the 5-outing window was dropped entirely, which is the exact
    #: opposite of "recency-aware". An explicit map cannot mis-pair.
    WINDOW_WEIGHTS = {5: 0.5, 10: 0.3, 20: 0.2}
    LONG_WEIGHT = 0.2

    def rank(self, ev: dict) -> list[str]:
        n = max(1, ev["cluster_size"])
        counts = ev["cluster_card_counts"]
        recent = ev.get("recent_counts", {})
        last_seen = ev.get("last_seen", {})

        def stay(card: str) -> float:
            long_term = counts.get(card, 0) / (n + MIN_SUPPORT)
            score = self.LONG_WEIGHT * long_term
            for window, w in sorted(self.WINDOW_WEIGHTS.items()):
                span = min(window, n)
                got = recent.get(str(window), {}).get(card, 0)
                score += w * (got / (span + MIN_SUPPORT))
            # Absence is the strongest single signal of an impending drop.
            score -= 0.05 * min(last_seen.get(card, 0), 20)
            return score

        return _rank_by(ev["prev_deck"], stay, reverse=False)


class E3Editability(ExitRanker):
    """How often THIS PLAYER has dropped THIS card, backing off to population.

    Editability is not one minus stability. A card can be fielded in every
    outing and still be the slot that gets retuned whenever anything changes;
    another can be rare but fixed. This rung asks the direct question.
    """
    name = "E3 editability"

    def rank(self, ev: dict) -> list[str]:
        personal: collections.Counter = collections.Counter()
        support = 0.0
        for out, _inc in ev["prior_edits"]:
            for card in out:
                personal[card] += 1
            support += 1

        counts = ev["cluster_card_counts"]
        n = max(1, ev["cluster_size"])

        def editable(card: str) -> float:
            own = personal.get(card, 0) / (support + MIN_SUPPORT) if support else 0.0
            pop = self.stats.editability(card)
            # Instability carries real weight, not a tiebreak. At 0.1 the
            # shrunk personal term still won outright: ONE observed edit of a
            # staple beat a card fielded in 1 of 20 outings, which is the same
            # sparse-data failure the Phase 3 shrinkage was added to prevent.
            # Shrinking the estimate is not sufficient on its own — the layer
            # WEIGHTS have to be commensurate too, since both terms are
            # bounded by 1 and only their coefficients decide who wins.
            instability = 1.0 - counts.get(card, 0) / (n + MIN_SUPPORT)
            return own + 0.3 * pop + 0.4 * instability

        return _rank_by(ev["prev_deck"], editable)


class E4Combined(E3Editability):
    """Editability AND recency-stability together.

    The two disagree often enough to be worth combining: E2 finds the card that
    has quietly stopped appearing, E3 finds the slot the player habitually
    retunes. Neither subsumes the other.
    """
    name = "E4 editability+recency"

    def rank(self, ev: dict) -> list[str]:
        n = max(1, ev["cluster_size"])
        counts = ev["cluster_card_counts"]
        recent = ev.get("recent_counts", {})
        last_seen = ev.get("last_seen", {})
        personal: collections.Counter = collections.Counter()
        support = 0.0
        for out, _inc in ev["prior_edits"]:
            for card in out:
                personal[card] += 1
            support += 1

        def score(card: str) -> float:
            own = personal.get(card, 0) / (support + MIN_SUPPORT) if support else 0.0
            pop = self.stats.editability(card)
            long_term = counts.get(card, 0) / (n + MIN_SUPPORT)
            short = recent.get("5", {}).get(card, 0) / (min(5, n) + MIN_SUPPORT)
            absence = min(last_seen.get(card, 0), 20) / 20.0
            return (1.0 * own + 0.3 * pop
                    + 0.6 * (1.0 - long_term) + 0.6 * (1.0 - short)
                    + 0.5 * absence)

        return _rank_by(ev["prev_deck"], score)


LADDER = (E0LeastStable, E1PlayerStability, E2RecencyStability,
          E3Editability, E4Combined)
