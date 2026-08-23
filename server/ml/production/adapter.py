"""Turning live battle rows into the view the research models expect.

The research code was written against the Phase 7 cache, whose rows carry a
cluster's aggregate counts, recency windows and prior edits. Production has the
same information in a different shape — a player's ordered plays — so this
module rebuilds the view at request time and NOTHING downstream changes.

Everything here is derived from plays strictly before the prediction moment.
"""
from __future__ import annotations

import collections

from ..dataset import DeckPlay, cluster_prefix, cluster_containing
from .. import config


def current_shell(ordered):
    """The cluster that actually CONTAINS the most recent play.

    NOT `cluster_containing`. That matches by >=6-card overlap against a
    cluster's LAST member and returns the first cluster that qualifies — which
    in production was a DIFFERENT shell 25% of the time, because a player with
    49 clusters has several that overlap each other. The symptom was Rule 1
    firing ("primary was not Recent and has been reset") and, worse, candidates
    generated from a shell the player is not on.

    Membership is exact and cannot pick the wrong one.
    """
    if not ordered:
        return []
    last = ordered[-1]
    for members in cluster_prefix(ordered):
        if any(m is last for m in members):
            return members
    return []


def build_context(tag: str, domain: str, plays, cutoff_ts: str | None = None):
    """(view, shell_plays) — the view AND the cluster it was built from.

    The cluster is returned because the change model's features must be
    computed over the SHELL, not the whole history. Feeding it every play made
    a player look maximally volatile and pinned P(change) near 1.0 in
    production against a 9.8% offline base rate.
    """
    ordered = sorted(plays, key=lambda p: p.battle_time)
    if cutoff_ts:
        ordered = [p for p in ordered if p.battle_time < cutoff_ts]
    if len(ordered) < 2:
        return None, []

    cluster = current_shell(ordered)
    if len(cluster) < 2:
        return None, []

    prev = cluster[-1]
    counts: collections.Counter = collections.Counter()
    for p in cluster:
        counts.update(p.card_set)

    recent = {}
    for w in (5, 10, 20):
        rc: collections.Counter = collections.Counter()
        for p in cluster[-w:]:
            rc.update(p.card_set)
        recent[str(w)] = dict(rc)

    streak = {}
    for card in prev.card_set:
        run = 0
        for p in reversed(cluster):
            if card in p.card_set:
                run += 1
            else:
                break
        streak[card] = run

    edits = []
    for i in range(1, len(cluster)):
        a, b = cluster[i - 1], cluster[i]
        inc = sorted(b.card_set - a.card_set)
        if inc:
            edits.append([sorted(a.card_set - b.card_set), inc])

    view = {
        "tag": tag, "domain": domain, "ts": prev.battle_time,
        "prev_deck": sorted(prev.card_set),
        "cluster_size": len(cluster),
        "cluster_card_counts": dict(counts),
        "recent_counts": recent,
        "streak": streak,
        "prior_edits": edits,
        "result": (prev.result or "").lower(),
        "opp_wc": prev.opponent_win_condition or "",
    }
    return view, cluster


def build_view(tag: str, domain: str, plays, cutoff_ts: str | None = None):
    """Just the view, for callers that do not need the shell."""
    view, _cluster = build_context(tag, domain, plays, cutoff_ts)
    return view


def player_vocabulary(plays) -> dict:
    """Every card this player has fielded, for the Phase 9 wide entry pool."""
    counts: collections.Counter = collections.Counter()
    for p in plays:
        counts.update(p.card_set)
    return dict(counts)


def plays_from_rows(rows) -> list:
    """`DeckPlay`s from whatever the caller has, skipping non-8-card rows.

    A native duel row carries a 16/24-card loadout and is not a deck; it is
    dropped here for the same reason the research dataset drops it.
    """
    out = []
    for r in rows:
        cards = r.get("cards") if isinstance(r, dict) else getattr(r, "cards", None)
        if not cards or len(set(cards)) != config.DECK_SIZE:
            continue
        get = (r.get if isinstance(r, dict) else lambda k, d=None: getattr(r, k, d))
        out.append(DeckPlay(
            battle_time=get("battle_time", "") or "",
            mode=get("mode", "") or "",
            cards=tuple(cards),
            result=get("result", "") or "",
            opponent_win_condition=get("opp_archetype", "") or "",
        ))
    return out
