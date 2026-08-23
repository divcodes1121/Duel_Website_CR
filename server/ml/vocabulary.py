"""Phase 9 — the player-wide entry vocabulary.

PHASE 8 PROVED THIS IS THE BINDING CONSTRAINT. Restricting entries to cards the
player has fielded in the CURRENT SHELL caps recall at 54.7%/61.2% (1-card) and
23.8%/37.4% (2-card), and the generators were already at 93-98% of that. Using
every card the player has ever fielded raises the ceiling to 89.1%/91.3% and
78.5%/84.4%. Nothing else in the pipeline offers a jump of that size.

LEAK-FREE BY CONSTRUCTION. The vocabulary is accumulated by walking a player's
rows in chronological order and is only ever read BEFORE the row it will be
used on is folded in. `observe()` is called after `pool_for()`, never before,
and `test_ml_vocabulary.py` asserts a card first seen at T is absent from the
pool at T.

TIERS, BECAUSE BREADTH IS NOT THE SAME AS PLAUSIBILITY. Phases 3 and 4 both
produced bugs where one observation outranked well-supported evidence. A wide
pool makes that risk worse, so a card carries the tier it earned:

    1  in the current shell           strongest evidence
    2  player-wide, frequently used   good
    3  player-wide, rarely used       weak
    4  global / population            very weak

Generation may use every tier. RANKING is a separate concern and is not done
here — Phase 9 answers only whether the truth is reachable.
"""
from __future__ import annotations

import collections
from dataclasses import dataclass, field

#: A card must be seen this often to count as "frequently used" (tier 2).
TIER2_MIN = 3

TIER_SHELL, TIER_PLAYER_FREQ, TIER_PLAYER_RARE, TIER_GLOBAL = 1, 2, 3, 4


@dataclass
class PlayerVocabulary:
    """Cards a player has been observed fielding, per domain, over time."""
    counts: dict = field(default_factory=lambda: collections.defaultdict(
        collections.Counter))
    decks: dict = field(default_factory=lambda: collections.defaultdict(set))

    def observe(self, tag: str, domain: str, cards) -> None:
        key = (tag, domain)
        self.counts[key].update(cards)
        self.decks[key].add(frozenset(cards))

    def observe_row(self, row: dict) -> None:
        """Fold one cached step in. Uses only the deck that was PLAYED."""
        self.observe(row["tag"], row["domain"], row["prev_deck"])

    def known(self, tag: str, domain: str) -> collections.Counter:
        return self.counts.get((tag, domain), collections.Counter())

    def pool_for(self, view: dict, global_prior=None) -> dict:
        """{card: tier} for every card that could enter this deck.

        Excludes the current deck — a fielded card cannot be swapped in.
        """
        prev = set(view["prev_deck"])
        shell = set(view.get("cluster_card_counts", {}))
        mine = self.known(view["tag"], view["domain"])

        out: dict = {}
        for card in shell - prev:
            out[card] = TIER_SHELL
        for card, n in mine.items():
            if card in prev or card in out:
                continue
            out[card] = TIER_PLAYER_FREQ if n >= TIER2_MIN else TIER_PLAYER_RARE
        if global_prior:
            for card in global_prior:
                if card not in prev and card not in out:
                    out[card] = TIER_GLOBAL
        return out

    def size(self, tag: str, domain: str) -> int:
        return len(self.known(tag, domain))


def tier_weight(tier: int) -> float:
    """How much a tier's evidence is worth when ordering candidates.

    Ordering only — generation admits every tier. The gradient is steep on
    purpose: a card the player has used three times in another deck is a real
    possibility, one they have never used is a guess.
    """
    return {TIER_SHELL: 1.0, TIER_PLAYER_FREQ: 0.6,
            TIER_PLAYER_RARE: 0.25, TIER_GLOBAL: 0.05}.get(tier, 0.05)


def diversity(candidates, prev_deck) -> dict:
    """Is a large pool genuinely varied, or one edit wearing many hats?

    A 500-candidate set that is really five edits with reordering has not
    expanded the search space, and recall@k would flatter it.
    """
    decks, cards, patterns = set(), set(), set()
    prev = frozenset(prev_deck)
    for c in candidates:
        decks.add(c.apply(prev))
        cards.update(c.entries)
        patterns.add((c.exits, c.entries))
    return {"unique_decks": len(decks), "unique_entry_cards": len(cards),
            "unique_patterns": len(patterns), "n": len(candidates)}
