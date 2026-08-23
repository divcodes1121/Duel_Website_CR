"""Phase 1 runner: baselines x domains x event splits, with timing.

    python -m ml.evaluation.harness --players 400 --domain duel --report

Produces the benchmark that decides what gets built next. It trains nothing,
imports no model, and touches no production module — `coach.py`, `duel_zone.py`
and `deck_counter.py` are read-only inputs here.
"""
from __future__ import annotations

import argparse
import collections
import sys
import time
from dataclasses import dataclass, field

from .. import config
from .. import dataset as ds
from . import metrics as M
from . import splits


NEXT_DECK_METRICS = ("exact@1", "exact@3", "jaccard", "hamming",
                     "card_precision", "card_recall")
INCOMING_METRICS = ("top-1", "top-3", "top-5", "mrr", "ndcg")


def _nested():
    return collections.defaultdict(lambda: collections.defaultdict(list))


@dataclass
class DomainResult:
    domain: str
    step_mode: str = "next-in-cluster"
    players_sampled: int = 0
    players_eligible: int = 0
    battles: int = 0
    clusters: int = 0
    steps: int = 0
    change_events: int = 0
    incoming_cards: int = 0
    same_cluster: int = 0
    # next_deck[model][bucket][metric][tag] -> [values]
    next_deck: dict = field(default_factory=dict)
    # incoming[metric][tag] -> [values]
    incoming: dict = field(default_factory=_nested)
    bucket_counts: collections.Counter = field(default_factory=collections.Counter)
    db_seconds: float = 0.0
    compute_seconds: float = 0.0

    def ensure_model(self, name: str) -> None:
        if name not in self.next_deck:
            self.next_deck[name] = {b: _nested() for b in splits.EVENT_BUCKETS}


def _score_next_deck(result: DomainResult, name: str, predict, rank,
                     example) -> None:
    pred = predict(example)
    truth = example.truth.card_set
    ranked = rank(example, 3)
    values = {
        "exact@1": M.exact(pred, truth),
        "exact@3": M.exact_at_k(ranked, truth, 3),
        "jaccard": M.jaccard(pred, truth),
        "hamming": M.hamming(pred, truth),
        "card_precision": M.card_precision(pred, truth),
        "card_recall": M.card_recall(pred, truth),
    }
    tag = example.player_tag
    for bucket in splits.buckets_for(example):
        store = result.next_deck[name][bucket]
        for metric, value in values.items():
            store[metric][tag].append(value)


def _score_incoming(result: DomainResult, example) -> None:
    """Change events only. One scored observation per incoming CARD."""
    ranked = splits.incoming_candidates(example)
    incoming = example.incoming
    tag = example.player_tag
    for card in sorted(incoming):
        # Scored per card: the ranker is asked to surface THIS card. Relevance
        # is the single card, not the whole incoming set, so a two-card swap
        # cannot be half-credited by naming the easier of the two.
        rel = {card}
        result.incoming["top-1"][tag].append(M.top_k(ranked, rel, 1))
        result.incoming["top-3"][tag].append(M.top_k(ranked, rel, 3))
        result.incoming["top-5"][tag].append(M.top_k(ranked, rel, 5))
        result.incoming["mrr"][tag].append(M.reciprocal_rank(ranked, rel))
        result.incoming["ndcg"][tag].append(M.ndcg(ranked, rel, 10))
        result.incoming_cards += 1


def run_domain(con, domain: str, n_players: int, verbose: bool = True,
               step_mode: str = "next-in-cluster") -> DomainResult:
    result = DomainResult(domain=domain, step_mode=step_mode)
    for name in splits.NEXT_DECK_MODELS:
        result.ensure_model(name)

    t_db = time.time()
    tags = ds.eligible_players(con, n_players)
    result.db_seconds += time.time() - t_db
    result.players_sampled = len(tags)

    for start in range(0, len(tags), config.PLAYER_BATCH):
        batch = tags[start:start + config.PLAYER_BATCH]

        t0 = time.time()
        plays_by_key = ds.load_plays(con, batch)
        result.db_seconds += time.time() - t0

        t1 = time.time()
        for tag in batch:
            plays = plays_by_key.get((tag, domain), [])
            if len(plays) < config.MIN_PLAYER_BATTLES:
                continue
            result.battles += len(plays)
            result.clusters += len(ds.cluster_prefix(plays))

            examples = list(ds.iter_examples(tag, plays, domain, step_mode))
            if not examples:
                continue
            result.players_eligible += 1

            for example in examples:
                result.steps += 1
                if example.same_cluster:
                    result.same_cluster += 1
                for bucket in splits.buckets_for(example):
                    result.bucket_counts[bucket] += 1
                if example.changed:
                    result.change_events += 1
                    _score_incoming(result, example)
                for name, (predict, rank) in splits.NEXT_DECK_MODELS.items():
                    _score_next_deck(result, name, predict, rank, example)
        result.compute_seconds += time.time() - t1

        if verbose:
            print("  %s: %d/%d players, %d steps"
                  % (domain, min(start + config.PLAYER_BATCH, len(tags)),
                     len(tags), result.steps), flush=True)

    return result


def change_detection(result: DomainResult) -> dict:
    """The trivial 'predict NO CHANGE' control, scored both ways.

    Reported for both class conventions on purpose. Treating "change" as the
    positive class shows the control detects NOTHING (recall 0); treating
    "no change" as positive shows the deceptively high score it earns for free.
    Printing only the second is how a useless model looks skilful.
    """
    total = result.bucket_counts.get("overall", 0)
    changes = result.bucket_counts.get("change", 0)
    no_change = total - changes
    # Always predicts "no change".
    change_p, change_r, change_f = M.prf(tp=0, fp=0, fn=changes)
    nochange_p, nochange_r, nochange_f = M.prf(tp=no_change, fp=changes, fn=0)
    return {
        "total": total,
        "changes": changes,
        "no_change": no_change,
        "accuracy": (no_change / total) if total else 0.0,
        "change_class": (change_p, change_r, change_f),
        "no_change_class": (nochange_p, nochange_r, nochange_f),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 1 benchmark")
    ap.add_argument("--players", type=int, default=config.DEFAULT_PLAYERS)
    ap.add_argument("--domain", choices=list(config.DOMAINS) + ["both"],
                    default="both")
    ap.add_argument("--step", choices=list(ds.STEP_MODES),
                    default="next-in-cluster",
                    help="next-in-cluster: the substitution question (default). "
                         "next-play: the literal next battle; wrong for duels.")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=None)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    if args.bootstrap is not None:
        config.BOOTSTRAP_ITERS = args.bootstrap

    con, path = ds.connect()
    if con is None:
        print("no database resolved — check CLASH_DB_PATH", file=sys.stderr)
        return 2
    print("database: %s" % path, flush=True)

    domains = list(config.DOMAINS) if args.domain == "both" else [args.domain]
    results = []
    for domain in domains:
        t0 = time.time()
        res = run_domain(con, domain, args.players,
                         verbose=not args.quiet, step_mode=args.step)
        total = time.time() - t0
        print("%s: %d steps in %.1fs (db %.1fs, compute %.1fs)"
              % (domain, res.steps, total, res.db_seconds, res.compute_seconds),
              flush=True)
        results.append(res)

    if args.report:
        from . import reports
        for res in results:
            print(reports.render(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
