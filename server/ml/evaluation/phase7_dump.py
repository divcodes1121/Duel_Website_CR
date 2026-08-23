"""Phase 7 extraction — EVERY step with card-level detail, not just edits.

Phases 3-6 cached edits only, which is why every policy so far needed a
selection oracle on "is this an edit". A deployable policy has to decide on a
step without knowing that, so it needs the same card-level evidence on steps
where nothing changed.

TRUTH IS CARRIED, AND IT IS QUARANTINED. `next_deck` is in the row because the
scorer needs it, and every key the models may read is listed in `INPUT_KEYS`.
`test_ml_policy.py` asserts that feature and candidate code touches nothing
else, which is the structural version of "do not leak".

    python -m ml.evaluation.phase7_dump --players 400
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import os
import sys
import time

from .. import config
from .. import dataset as ds
from . import phase3 as P3

CACHE = os.path.join(P3.RESULTS_DIR, "phase7-steps.jsonl.gz")

#: Everything a model may read. `next_deck` is deliberately absent.
INPUT_KEYS = frozenset({
    "tag", "domain", "ts", "prev_deck", "cluster_size", "cluster_card_counts",
    "recent_counts", "last_seen", "streak", "prior_edits", "result", "opp_wc",
})


def _row(ex, cluster, prev) -> dict:
    counts: collections.Counter = collections.Counter()
    for p in cluster:
        counts.update(p.card_set)

    recent = {}
    for w in (5, 10, 20):
        rc: collections.Counter = collections.Counter()
        for p in cluster[-w:]:
            rc.update(p.card_set)
        recent[str(w)] = dict(rc)

    last_seen, streak = {}, {}
    for card in prev.card_set:
        for back, p in enumerate(reversed(cluster)):
            if card in p.card_set:
                last_seen[card] = back
                break
        else:
            last_seen[card] = len(cluster)
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

    return {
        "tag": ex.player_tag, "domain": ex.domain, "ts": ex.timestamp,
        "prev_deck": sorted(prev.card_set),
        "cluster_size": len(cluster),
        "cluster_card_counts": dict(counts),
        "recent_counts": recent,
        "last_seen": last_seen,
        "streak": streak,
        "prior_edits": edits,
        "result": (prev.result or "").lower(),
        "opp_wc": prev.opponent_win_condition or "",
        # ---- evaluation only, never a model input ----
        "next_deck": sorted(ex.truth.card_set),
    }


def dump(players: int, path: str = CACHE) -> int:
    con, db = ds.connect()
    if con is None:
        print("no database", file=sys.stderr)
        return 2
    print("database: %s" % db, flush=True)
    os.makedirs(P3.RESULTS_DIR, exist_ok=True)
    tags = ds.eligible_players(con, players)
    n = 0
    t0 = time.time()
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for start in range(0, len(tags), config.PLAYER_BATCH):
            batch = tags[start:start + config.PLAYER_BATCH]
            plays = ds.load_plays(con, batch)
            for domain in config.DOMAINS:
                for tag in batch:
                    seq = plays.get((tag, domain), [])
                    if len(seq) < config.MIN_PLAYER_BATTLES:
                        continue
                    for ex in ds.iter_examples(tag, seq, domain):
                        fh.write(json.dumps(
                            _row(ex, ex.cluster_history, ex.previous)) + "\n")
                        n += 1
            print("  %d/%d players, %d steps (%.0fs)"
                  % (min(start + config.PLAYER_BATCH, len(tags)), len(tags),
                     n, time.time() - t0), flush=True)
    print("wrote %d steps to %s" % (n, path))
    return 0


def load(path: str = CACHE) -> list[dict]:
    out = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            out.append(json.loads(line))
    return out


def model_view(row: dict) -> dict:
    """The row with the truth REMOVED. Models are handed this, never `row`."""
    return {k: v for k, v in row.items() if k in INPUT_KEYS}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", type=int, default=config.DEFAULT_PLAYERS)
    ap.add_argument("--cache", default=CACHE)
    a = ap.parse_args()
    raise SystemExit(dump(a.players, a.cache))
