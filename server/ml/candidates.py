"""Phase 8 — candidate generation. The proven bottleneck.

PHASE 7 SETTLED WHAT THIS PHASE IS FOR. With the beam used through Phases 4-7,
the true next deck was absent from the candidate set 80-88% of the time, and for
2-card edits it was essentially never there (top-3 recall 0.0%, top-10 1.4-4.2%).
A perfect ranker over that set caps around 20%. So the only question here is:

    CAN WE GENERATE A CANDIDATE SET THAT CONTAINS THE ACTUAL NEXT DECK?

No ranking model, no new features, no capacity. Recall first.

THE LADDER:

    C0  the Phase 4-7 beam                        the control
    C1  wide 1-card beam                          more exits x more entries
    C2  explicit 2-card generation                the structural gap
    C3  historical variants                       decks this player HAS played
    C4  union of all of it, deduped and ordered

C3 IS THE INTERESTING ONE. Every earlier phase built candidates card-by-card,
which treats an 8-card deck as eight independent choices. But a player's past
decks are real, observed, legal configurations — and a deck they return to is
one they have already built. Reconstructing those costs nothing: `prior_edits`
holds every (out, in) pair in order, so walking backwards from the current deck
replays the whole variant history.
"""
from __future__ import annotations

import collections
from typing import Iterable, Sequence

from .edit_model import Candidate, STAY


def historical_variants(view: dict) -> list[frozenset]:
    """Every exact deck this player has fielded in this shell, newest first.

    Reconstructed by replaying `prior_edits` backwards from the current deck:
    if a -> b removed `out` and added `in`, then a = b - in + out. No extra
    extraction is needed and nothing is inferred — these are decks that were
    actually played.
    """
    current = frozenset(view["prev_deck"])
    seen = [current]
    deck = current
    for out, inc in reversed(view.get("prior_edits", [])):
        deck = (deck - frozenset(inc)) | frozenset(out)
        if len(deck) != 8:
            break
        if deck not in seen:
            seen.append(deck)
    return seen


def _to_candidate(prev: frozenset, target: frozenset) -> Candidate | None:
    """The edit that turns `prev` into `target`, or None if it is not one."""
    if target == prev:
        return STAY
    exits = tuple(sorted(prev - target))
    entries = tuple(sorted(target - prev))
    if len(exits) != len(entries) or not exits:
        return None
    return Candidate(exits, entries)


class Generator:
    """Base. Every generator returns an ORDERED, deduplicated candidate list."""
    name = "generator"

    def __init__(self, exit_model=None, entry_model=None, width: int = 3):
        self.exit_model = exit_model
        self.entry_model = entry_model
        self.width = width

    def generate(self, view: dict) -> list[Candidate]:
        raise NotImplementedError

    def recall(self, view: dict, next_deck, ks=(3, 10, 25, 50, 100)) -> dict:
        """At which rank does the true next deck first appear?"""
        prev = frozenset(view["prev_deck"])
        truth = frozenset(next_deck)
        cands = self.generate(view)
        rank = None
        for i, c in enumerate(cands):
            if c.apply(prev) == truth:
                rank = i
                break
        return {"rank": rank, "n": len(cands),
                "hits": {k: (rank is not None and rank < k) for k in ks}}


def _dedup(cands: Iterable[Candidate]) -> list[Candidate]:
    out, seen = [], set()
    for c in cands:
        key = (c.exits, c.entries)
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


class C0Beam(Generator):
    """The Phase 4-7 beam: top-`width` exits x top-`width` entries, plus pairs."""
    name = "C0 beam(3)"

    def generate(self, view: dict) -> list[Candidate]:
        exits = self.exit_model.rank(view)[:self.width]
        out = [STAY]
        for a in exits:
            for x in self.entry_model.rank(dict(view, outgoing=[a]))[:self.width]:
                out.append(Candidate((a,), (x,)))
        for i, a in enumerate(exits):
            for b in exits[i + 1:]:
                pair = tuple(sorted((a, b)))
                ent = self.entry_model.rank(dict(view, outgoing=list(pair)))[:self.width]
                for j, x in enumerate(ent):
                    for y in ent[j + 1:]:
                        out.append(Candidate(pair, tuple(sorted((x, y)))))
        return _dedup(out)


class C1WideOneCard(Generator):
    """Every exit x the top `entry_width` entries for it. One-card only.

    The point is coverage, not precision: with 8 possible exits and a generous
    entry list this is a few hundred candidates, which is cheap and gives the
    ranker something to actually work with.
    """
    name = "C1 wide 1-card"

    def __init__(self, exit_model, entry_model, width=8, entry_width=12):
        super().__init__(exit_model, entry_model, width)
        self.entry_width = entry_width

    def generate(self, view: dict) -> list[Candidate]:
        out = [STAY]
        for a in self.exit_model.rank(view)[:self.width]:
            for x in self.entry_model.rank(dict(view, outgoing=[a]))[:self.entry_width]:
                out.append(Candidate((a,), (x,)))
        return _dedup(out)


class C2TwoCard(Generator):
    """Explicit exit-PAIR x entry-PAIR generation.

    C0 offered 3 exit pairs against a real space of C(8,2)=28, and its entry
    pairs came from a 3-card list. That is why 2-card recall was 0.0%. Here the
    exit pairs are enumerated properly and the entry pairs come from a wider
    pool, which is combinatorially larger but still bounded.
    """
    name = "C2 2-card"

    def __init__(self, exit_model, entry_model, exit_pairs=15, entry_width=6):
        super().__init__(exit_model, entry_model)
        self.exit_pairs = exit_pairs
        self.entry_width = entry_width

    def generate(self, view: dict) -> list[Candidate]:
        exits = self.exit_model.rank(view)
        pairs = []
        for i, a in enumerate(exits):
            for b in exits[i + 1:]:
                pairs.append(tuple(sorted((a, b))))
        out = [STAY]
        for pair in pairs[:self.exit_pairs]:
            ent = self.entry_model.rank(dict(view, outgoing=list(pair)))[:self.entry_width]
            for j, x in enumerate(ent):
                for y in ent[j + 1:]:
                    out.append(Candidate(pair, tuple(sorted((x, y)))))
        return _dedup(out)


class C3Historical(Generator):
    """Decks this player has ACTUALLY fielded in this shell.

    Ordered by recency, which is the project's most reliable single signal —
    Phase 1 measured `recent` beating `modal` by +11 to +19 points.
    """
    name = "C3 historical"

    def generate(self, view: dict) -> list[Candidate]:
        prev = frozenset(view["prev_deck"])
        out = []
        for deck in historical_variants(view):
            c = _to_candidate(prev, deck)
            if c is not None:
                out.append(c)
        return _dedup(out)


class C4Union(Generator):
    """Everything, deduplicated, ordered cheapest-first.

    Order matters because recall is measured at k: historical variants come
    first (they are real decks and the player returns to them), then the narrow
    beam, then the wide 1-card sweep, then 2-card. No model ranks these — the
    ordering is a heuristic, and improving it is Phase 9's job, not this one's.
    """
    name = "C4 union"

    def __init__(self, exit_model, entry_model, cap: int = 400):
        super().__init__(exit_model, entry_model)
        self.cap = cap
        self.c0 = C0Beam(exit_model, entry_model, 3)
        self.c1 = C1WideOneCard(exit_model, entry_model)
        self.c2 = C2TwoCard(exit_model, entry_model)
        self.c3 = C3Historical(exit_model, entry_model)

    def generate(self, view: dict) -> list[Candidate]:
        merged = (self.c3.generate(view) + self.c0.generate(view)
                  + self.c1.generate(view) + self.c2.generate(view))
        return _dedup(merged)[:self.cap]


def deck_repeat_rate(views_and_truths) -> dict:
    """How often is the next deck one the player has ALREADY played here?

    The ceiling on C3, and the single most informative number in this phase: if
    it is high, candidate generation is largely a retrieval problem rather than
    a construction one.
    """
    total = repeat = 0
    by_size: collections.Counter = collections.Counter()
    repeat_by_size: collections.Counter = collections.Counter()
    for view, truth in views_and_truths:
        prev = frozenset(view["prev_deck"])
        t = frozenset(truth)
        if t == prev:
            continue
        total += 1
        n = len(t - prev)
        by_size[n] += 1
        if t in set(historical_variants(view)):
            repeat += 1
            repeat_by_size[n] += 1
    return {"total": total, "repeat": repeat,
            "rate": repeat / total if total else 0.0,
            "by_size": {n: (repeat_by_size[n] / by_size[n]) if by_size[n] else 0.0
                        for n in sorted(by_size)},
            "counts": dict(by_size)}
