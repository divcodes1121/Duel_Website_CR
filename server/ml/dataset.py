"""Leak-free chronological examples for the Phase 1 benchmark.

THE ONE RULE. For a prediction at time T the model may see rows strictly before
T and nothing else. That is enforced by construction rather than by care:

  * `DeckPlay` and `PredictionExample` are frozen dataclasses.
  * `history` is a TUPLE built from the prefix and frozen before `truth` is
    attached, so a predictor holding an example cannot reach the answer by
    mutating anything.
  * Predictors are handed `example.history`; only the scorer sees `example.truth`.
  * `PredictionExample.assert_leak_free()` re-checks the invariant, and
    `test_ml_contract.py` runs it over every generated example.

THE STEP IS DEFINED BY THE PREVIOUS DECK, NOT BY THE TRUTH. An earlier
throwaway harness selected steps by asking which cluster the TRUTH belonged to,
which is selection leakage: it uses the answer to decide whether the question is
asked at all. Here the current cluster is the cluster of the deck the player
last played, which is knowable at T. Whether the truth stays in that cluster is
then a measurable OUTCOME (`same_cluster`) rather than a precondition.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterator, Sequence

import clash_data as cd
from meta import META_MODES
from duel_combos import is_duel_like_mode

from . import config


# --------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class DeckPlay:
    """One battle in which the player brought one 8-card deck."""
    battle_time: str
    mode: str
    cards: tuple[str, ...]
    result: str = ""
    opponent_cards: tuple[str, ...] = ()
    opponent_win_condition: str = ""

    @property
    def card_set(self) -> frozenset[str]:
        return frozenset(self.cards)


@dataclass(frozen=True)
class PredictionExample:
    """History strictly before `timestamp`, and the deck actually played at it."""
    player_tag: str
    timestamp: str
    domain: str
    history: tuple[DeckPlay, ...]
    truth: DeckPlay
    # The cluster the player was ON at T, derived from the PREVIOUS deck only.
    cluster_history: tuple[DeckPlay, ...] = field(default=())

    @property
    def previous(self) -> DeckPlay:
        """The last play OF THIS CLUSTER — the deck the truth is compared to.

        Not `history[-1]`. In a duel the immediately preceding battle is
        usually a different deck of the same loadout (they are card-disjoint by
        rule), so comparing against it would score loadout rotation as a
        substitution. Under `next-play` the two coincide, because the cluster
        is the one the previous play belongs to.
        """
        return self.cluster_history[-1] if self.cluster_history else self.history[-1]

    @property
    def changed(self) -> bool:
        return self.truth.card_set != self.previous.card_set

    @property
    def n_changes(self) -> int:
        """Cards swapped IN. A one-card swap is 1, not 2 (that is Hamming)."""
        return len(self.truth.card_set - self.previous.card_set)

    @property
    def incoming(self) -> frozenset[str]:
        return self.truth.card_set - self.previous.card_set

    @property
    def outgoing(self) -> frozenset[str]:
        return self.previous.card_set - self.truth.card_set

    @property
    def same_cluster(self) -> bool:
        """Did the truth stay in the cluster the player was on? An OUTCOME."""
        if not self.cluster_history:
            return False
        overlap = len(self.truth.card_set & self.cluster_history[-1].card_set)
        return overlap >= config.CLUSTER_MIN_OVERLAP

    def assert_leak_free(self) -> None:
        """Raise if any history row is at or after the prediction timestamp."""
        for play in self.history:
            if play.battle_time >= self.timestamp:
                raise AssertionError(
                    "leak: history row %s >= T %s for %s"
                    % (play.battle_time, self.timestamp, self.player_tag))
        for play in self.cluster_history:
            if play.battle_time >= self.timestamp:
                raise AssertionError(
                    "leak: cluster row %s >= T %s"
                    % (play.battle_time, self.timestamp))


# --------------------------------------------------------------------------
# Domain — the repository's own definitions, never a second taxonomy
# --------------------------------------------------------------------------

def classify_domain(game_mode: str | None) -> str | None:
    """'competitive' | 'duel' | None.

    MODE STRINGS ARE STORED CASED (`Ranked1v1_NewArena2`, `Ladder`) while
    META_MODES is lowercase — exactly what the production rollup's
    `lower(game_mode) IN (...)` assumes. Comparing raw is why an earlier
    harness run returned zero steps against a database full of them.

    Duel membership comes from `is_duel_like_mode`, never from the substring
    "duel": `is_native_duel` fails safe on an unrecognised mode, and that
    behaviour is preserved rather than re-derived.
    """
    if not game_mode:
        return None
    if is_duel_like_mode(game_mode):
        return "duel"
    if game_mode.lower() in META_MODES:
        return "competitive"
    return None


def parse_cards(raw: str | None) -> tuple[str, ...] | None:
    """Exactly DECK_SIZE distinct card keys, else None.

    Rejects, in order: malformed JSON, a non-list, a wrong length (a NATIVE
    duel row carries the whole 16/24-card loadout in this column and is not a
    deck), non-string entries, and duplicates.
    """
    try:
        value = json.loads(raw or "[]")
    except (ValueError, TypeError):
        return None
    if not isinstance(value, list) or len(value) != config.DECK_SIZE:
        return None
    if any(not isinstance(c, str) or not c for c in value):
        return None
    if len(set(value)) != config.DECK_SIZE:
        return None
    return tuple(value)


# --------------------------------------------------------------------------
# Clustering — the production rule, applied to a PREFIX
# --------------------------------------------------------------------------

def cluster_prefix(plays: Sequence[DeckPlay]) -> list[list[DeckPlay]]:
    """Group plays at >= CLUSTER_MIN_OVERLAP shared cards.

    Reproduces `duel_zone.cluster_player_decks`'s algorithm — exact variants
    first, most-frequent first, greedy assignment, representative set following
    the most-frequent variant — but returns MEMBERSHIP, which the production
    function does not need and therefore does not expose.

    `test_ml_dataset.py` pins the representative against `cluster_player_decks`
    so the two cannot drift into measuring different systems.
    """
    exact: dict[str, list[DeckPlay]] = {}
    for play in plays:
        exact.setdefault(",".join(sorted(play.cards)), []).append(play)

    ordered = sorted(exact.items(), key=lambda kv: (-len(kv[1]), kv[0]))

    clusters: list[dict] = []
    for _sig, members in ordered:
        cset = set(members[0].cards)
        placed = False
        for cl in clusters:
            if len(cset & cl["rep"]) >= config.CLUSTER_MIN_OVERLAP:
                cl["members"].extend(members)
                if len(members) > cl["best"]:
                    cl["rep"] = cset
                    cl["best"] = len(members)
                placed = True
                break
        if not placed:
            clusters.append({"rep": cset, "best": len(members),
                             "members": list(members)})

    return [sorted(cl["members"], key=lambda p: p.battle_time)
            for cl in clusters]


def cluster_containing(clusters: Sequence[Sequence[DeckPlay]],
                       cards: frozenset[str]) -> list[DeckPlay]:
    """The cluster a deck belongs to, by overlap with its most recent member."""
    for members in clusters:
        if not members:
            continue
        if len(cards & members[-1].card_set) >= config.CLUSTER_MIN_OVERLAP:
            return list(members)
    return []


# --------------------------------------------------------------------------
# Example generation
# --------------------------------------------------------------------------

#: Two questions, and picking the wrong one silently measures something else.
STEP_MODES = ("next-in-cluster", "next-play")


def iter_examples(tag: str, plays: Sequence[DeckPlay], domain: str,
                  step_mode: str = "next-in-cluster") -> Iterator[PredictionExample]:
    """One example per eligible position, oldest first.

    Clustering is recomputed FROM THE PREFIX at every step. Clustering once
    over the whole history would fold the future into the representation — the
    subtlest leak available here, and one no assertion about timestamps would
    ever catch.

    TWO STEP DEFINITIONS, AND THE DIFFERENCE IS NOT COSMETIC.

    `next-play` asks "what deck do they bring in their very next battle". That
    is the right question on ladder, where consecutive games are usually the
    same deck. IT IS THE WRONG QUESTION IN DUELS: a duel loadout is three decks
    that CANNOT share a card, so consecutive duel games are card-disjoint BY
    RULE. Measured on real duel rows this framing reported 86% "change" and 85%
    of steps as 3+-card swaps — it was describing loadout rotation, not deck
    editing, and every substitution metric built on it was meaningless.

    `next-in-cluster` (the default) asks "the next time they bring THIS shell,
    what eight cards is it". That is the substitution question, and it is the
    one the Coach actually needs, because the Coach predicts per candidate deck.

    LEAKAGE NOTE, STATED PLAINLY. `next-in-cluster` uses the truth's cards to
    decide WHICH cluster the step belongs to — that is selection, not a feature.
    The predictor still receives only plays strictly before T, and never the
    truth. This mirrors production, where the shell being predicted is given
    (the Coach is ranking a known candidate deck) rather than inferred. The
    cost is that the cluster-choice problem is excluded from these numbers, so
    they must not be read as end-to-end "what will they bring" accuracy.
    """
    if step_mode not in STEP_MODES:
        raise ValueError("unknown step_mode %r" % (step_mode,))

    ordered = sorted(plays, key=lambda p: p.battle_time)
    for i in range(1, len(ordered)):
        prefix = tuple(ordered[:i])
        truth = ordered[i]
        if truth.battle_time <= prefix[-1].battle_time:
            # Ties and out-of-order stamps cannot define a "next" deck.
            continue
        clusters = cluster_prefix(prefix)
        if step_mode == "next-play":
            current = cluster_containing(clusters, prefix[-1].card_set)
        else:
            current = cluster_containing(clusters, truth.card_set)
        if len(current) < config.MIN_CLUSTER_HISTORY:
            continue
        yield PredictionExample(
            player_tag=tag,
            timestamp=truth.battle_time,
            domain=domain,
            history=prefix,
            truth=truth,
            cluster_history=tuple(current),
        )


# --------------------------------------------------------------------------
# Loading — one indexed query per BATCH of players, never one per battle
# --------------------------------------------------------------------------

def eligible_players(con, limit: int, min_battles: int | None = None) -> list[str]:
    floor = config.MIN_PLAYER_BATTLES if min_battles is None else min_battles
    rows = con.execute(
        "SELECT player_tag FROM player_stats_agg WHERE battles >= ? "
        "ORDER BY battles DESC LIMIT ?", (floor, limit))
    return [r[0] for r in rows]


def load_plays(con, tags: Sequence[str]) -> dict:
    """{(tag, domain): [DeckPlay, ...]} for a batch, in one indexed query."""
    if not tags:
        return {}
    placeholders = ",".join("?" for _ in tags)
    rows = con.execute(
        "SELECT player_tag, battle_time, game_mode, player_card_keys, result, "
        "       opponent_card_keys, opponent_win_condition "
        "FROM battles WHERE player_tag IN (%s) "
        "ORDER BY player_tag, battle_time" % placeholders, tuple(tags))

    out: dict = {}
    for r in rows:
        domain = classify_domain(r["game_mode"])
        if domain is None:
            continue
        cards = parse_cards(r["player_card_keys"])
        if cards is None:
            continue
        out.setdefault((r["player_tag"], domain), []).append(DeckPlay(
            battle_time=r["battle_time"] or "",
            mode=r["game_mode"] or "",
            cards=cards,
            result=r["result"] or "",
            opponent_cards=parse_cards(r["opponent_card_keys"]) or (),
            opponent_win_condition=r["opponent_win_condition"] or "",
        ))
    return out


def connect():
    """(connection, path) or (None, None) when no database resolves."""
    path = cd.resolve_db_path()
    if not path:
        return None, None
    return cd.connect(path), path
