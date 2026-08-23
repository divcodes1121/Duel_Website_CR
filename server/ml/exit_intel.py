"""Phase 13 — exit prediction as its own problem.

PHASE 12 LOCATED THE BOTTLENECK PRECISELY. L0's rank-1 pick decomposes as:

    exit correct overall            38.2% competitive / 48.2% duel
    entry correct GIVEN the exit    71.7% / 67.6%
    entry correct, exit wrong        2.2% / 2.2%

So the entry model is working and entry errors almost never occur on their own.
Everything downstream is conditioned on an exit that is right under half the
time, which makes this the one component worth attacking.

WHY PAIRWISE SHOULD WORK HERE AND DID NOT IN PHASE 11. Ranking 500 candidates
gave ~0.2% positives and ~519 mostly-trivial pairs per event, and the loss was
swamped. An exit choice is 1 true against 7 false — 12.5% positives, seven
pairs, every one of them meaningful. That is the regime pairwise learning is
built for.

TRANSITION-CONDITIONED BY CONSTRUCTION. `prior_edits` on a cached step are the
edits made WITHIN this cluster, so the player's exit counts here already answer
"when this player changes THIS deck, what leaves" rather than the weaker global
"which cards are unstable".
"""
from __future__ import annotations

import collections
import math
import random
from dataclasses import dataclass, field

MIN_SUPPORT = 3.0

FEATURE_NAMES = (
    # --- usage / stability ------------------------------------------------
    "shell_share",            # fielded in this shell
    "recent5_share",
    "recent20_share",
    "log_streak",             # UNCAPPED continuous presence
    "streak",                 # capped at 20, kept for continuity
    # --- editability ------------------------------------------------------
    "player_exit_count",      # times THIS player dropped it FROM THIS shell
    "player_exit_share",      # ... as a share of their edits here
    "pop_exit_rate",          # population rate of this card being dropped
    # --- relative, within the 8 cards -------------------------------------
    "rel_stability_rank",
    "rel_exit_rank",
    "rel_stability_share",
    "rel_exit_share_of_max",
    "rel_streak_rank",
    "streak_share",
    "is_least_stable",
    "is_most_edited",
    "is_shortest_streak",
    # --- context ----------------------------------------------------------
    "p_change",
    "cluster_size",
    "n_prior_edits",
)

N_FEATURES = len(FEATURE_NAMES)


@dataclass
class ExitExample:
    """One edit, framed as a choice among the eight cards in the deck."""
    tag: str
    ts: str
    domain: str
    deck: list
    truth_exits: frozenset
    features: list = field(default_factory=list)   # per card, deck order

    @property
    def n_out(self) -> int:
        return len(self.truth_exits)

    def truth_index(self) -> int | None:
        """Index of the outgoing card, for 1-card edits only."""
        if len(self.truth_exits) != 1:
            return None
        card = next(iter(self.truth_exits))
        return self.deck.index(card) if card in self.deck else None


def _ranks(values: list[float], descending: bool = True) -> list[float]:
    order = sorted(range(len(values)),
                   key=(lambda i: -values[i]) if descending else (lambda i: values[i]))
    out = [0.0] * len(values)
    n = max(1, len(values) - 1)
    for pos, i in enumerate(order):
        out[i] = pos / n
    return out


def build(view: dict, next_deck, p_change: float,
          pop_exit: collections.Counter,
          pop_seen: collections.Counter) -> ExitExample | None:
    """One ExitExample from a cached step. Reads no future information."""
    deck = sorted(view["prev_deck"])
    prev, truth = frozenset(deck), frozenset(next_deck)
    outs = prev - truth
    if not outs:
        return None

    n = max(1, view.get("cluster_size", 1))
    counts = view.get("cluster_card_counts", {})
    recent = view.get("recent_counts", {})
    streak = view.get("streak", {})

    exits: collections.Counter = collections.Counter()
    for out, _inc in view.get("prior_edits", []):
        for c in out:
            exits[c] += 1
    n_edits = len(view.get("prior_edits", []))

    stability = [counts.get(c, 0) / n for c in deck]
    editability = [exits.get(c, 0) for c in deck]
    streaks = [float(streak.get(c, 0)) for c in deck]

    r_stab = _ranks(stability, descending=False)   # least stable first
    r_edit = _ranks(editability, descending=True)
    r_streak = _ranks(streaks, descending=False)   # shortest streak first
    max_stab = max(stability) or 1.0
    max_edit = max(editability) or 1.0
    max_streak = max(streaks) or 1.0

    feats = []
    for i, c in enumerate(deck):
        seen = pop_seen.get(c, 0)
        feats.append([
            stability[i],
            recent.get("5", {}).get(c, 0) / (min(5, n) + MIN_SUPPORT),
            recent.get("20", {}).get(c, 0) / (min(20, n) + MIN_SUPPORT),
            # PHASE 14: `last_seen` was constant at 0 — every card in the
            # current deck appeared in the last outing, so it carried no
            # information and its diagnostic read 0.0%. `streak` already
            # measures the quantity that was wanted (outings of continuous
            # presence); the defect was that it was CAPPED at 20, which
            # flattens every stable core card in a long cluster together.
            math.log1p(streaks[i]),
            float(min(streaks[i], 20)),

            math.log1p(editability[i]),
            editability[i] / (n_edits + MIN_SUPPORT) if n_edits else 0.0,
            (pop_exit.get(c, 0) / (seen + MIN_SUPPORT)) if seen else 0.0,

            r_stab[i], r_edit[i],
            stability[i] / max_stab,
            editability[i] / max_edit,
            r_streak[i],
            streaks[i] / max_streak,
            1.0 if r_stab[i] == 0.0 else 0.0,
            1.0 if r_edit[i] == 0.0 else 0.0,
            1.0 if r_streak[i] == 0.0 else 0.0,

            p_change,
            math.log1p(n),
            math.log1p(n_edits),
        ])
    return ExitExample(view["tag"], view["ts"], view["domain"], deck, outs, feats)


# --------------------------------------------------------------------------
# Diagnostic: WHICH simple property identifies the outgoing card?
# --------------------------------------------------------------------------

SIGNALS = ("least stable", "shortest streak", "most edited",
           "lowest recent-5 use", "highest population exit rate")


def signal_hits(ex: ExitExample) -> dict:
    """For each simple property, is the true exit the card it points at?

    This is what explains why E4 plateaus around 52-55%: if no single property
    identifies the exit much above chance (1/8 = 12.5%), the signal is genuinely
    distributed and a combination model is the only way up.
    """
    idx = ex.truth_index()
    if idx is None:
        return {}
    F = FEATURE_NAMES
    cols = {
        "least stable": (F.index("shell_share"), False),
        "most edited": (F.index("player_exit_count"), True),
        "shortest streak": (F.index("streak"), False),
        "lowest recent-5 use": (F.index("recent5_share"), False),
        "highest population exit rate": (F.index("pop_exit_rate"), True),
    }
    out = {}
    for name, (col, high) in cols.items():
        vals = [row[col] for row in ex.features]
        best = max(vals) if high else min(vals)
        winners = [i for i, v in enumerate(vals) if v == best]
        out[name] = idx in winners and len(winners) <= 2
    return out


# --------------------------------------------------------------------------
# Pairwise exit ranker — 1 true against 7 false
# --------------------------------------------------------------------------

@dataclass
class PairwiseExit:
    """score(card) fitted so the true exit outranks the seven others.

    No bias (it cancels), no negative sampling (seven negatives is already the
    whole set), and no class imbalance to fight.
    """
    name: str = "X5 pairwise"
    epochs: int = 25
    lr: float = 0.12
    l2: float = 1e-5
    seed: int = 20260819
    w: list = field(default_factory=list)
    mean: list = field(default_factory=list)
    std: list = field(default_factory=list)

    def _scale(self, row):
        return [(v - m) / s for v, m, s in zip(row, self.mean, self.std)]

    def fit(self, examples) -> "PairwiseExit":
        rows = [r for ex in examples for r in ex.features]
        d = N_FEATURES
        self.mean = [0.0] * d
        self.std = [1.0] * d
        if rows:
            for j in range(d):
                col = [r[j] for r in rows]
                mu = sum(col) / len(col)
                var = sum((v - mu) ** 2 for v in col) / len(col)
                self.mean[j] = mu
                self.std[j] = math.sqrt(var) if var > 1e-12 else 1.0

        prepared = []
        for ex in examples:
            t = ex.truth_index()
            if t is None:
                continue
            prepared.append(([self._scale(r) for r in ex.features], t))

        self.w = [0.0] * d
        rng = random.Random(self.seed)
        for epoch in range(self.epochs):
            lr = self.lr / (1.0 + epoch * 0.5)
            rng.shuffle(prepared)
            for scaled, t in prepared:
                pos = scaled[t]
                for i, neg in enumerate(scaled):
                    if i == t:
                        continue
                    diff = [a - b for a, b in zip(pos, neg)]
                    margin = sum(wi * di for wi, di in zip(self.w, diff))
                    g = -1.0 / (1.0 + math.exp(min(35.0, max(-35.0, margin))))
                    for j in range(d):
                        self.w[j] -= lr * (g * diff[j] + self.l2 * self.w[j])
        return self

    def rank(self, ex: ExitExample) -> list[int]:
        """Card indices, most likely to leave first."""
        if not self.w:
            return list(range(len(ex.deck)))
        scores = [sum(wi * zi for wi, zi in zip(self.w, self._scale(r)))
                  for r in ex.features]
        return sorted(range(len(scores)), key=lambda i: (-scores[i], i))

    def rank_pairs(self, ex: ExitExample) -> list[tuple]:
        """Index PAIRS for 2-card exits, by summed score. C(8,2)=28 of them."""
        order = self.rank(ex)
        scores = {i: len(order) - p for p, i in enumerate(order)}
        pairs = [(a, b) for ai, a in enumerate(order) for b in order[ai + 1:]]
        return sorted(pairs, key=lambda p: -(scores[p[0]] + scores[p[1]]))

    def top_weights(self, k: int = 10):
        if not self.w:
            return []
        return sorted(zip(FEATURE_NAMES, self.w), key=lambda kv: -abs(kv[1]))[:k]
