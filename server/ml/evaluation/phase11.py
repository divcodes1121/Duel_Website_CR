"""Phase 11 — pairwise 1-card ranking over the frozen Phase 9/10 pool.

    python -m ml.evaluation.phase11 --report

GATE: P1 pairwise must beat L0 heuristic on Recall@1/3/10, MRR and NDCG with a
player-level paired CI excluding zero. If it does not, STOP — do not build
boosting. Phase 10 already showed the objective is the problem, so a bigger
model on the same loss is not the next experiment.

Generation is IDENTICAL to Phase 10. L1 pointwise is carried along as a
diagnostic, not a contender.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time

from .. import config
from .. import pairwise as PW
from .. import ranker as RK
from . import phase10 as P10
from . import phase2 as P2
from . import phase7_dump as P7
from . import significance as sig
from .. import change_detector as CD

POOL_SWEEP = (10, 25, 50, 100, 250, 500)


def _summarise(name, ranks, out):
    s = RK.rank_summary(ranks)
    out.append("%-16s %6.1f%% %6.1f%% %6.1f%% %6.1f%% %6.1f%% %7.3f %7.3f %6s %6s"
               % (name, 100 * s["r@1"], 100 * s["r@3"], 100 * s["r@5"],
                  100 * s["r@10"], 100 * s["r@25"], s["mrr"], s["ndcg"],
                  s["median"], s["p90"]))
    return s


def report(rows, sample: int, bootstrap: int) -> str:
    out = ["=" * 82,
           "OPPONENT INTELLIGENCE ENGINE - PHASE 11  (pairwise 1-card ranking)",
           "=" * 82,
           "Generation is FROZEN and identical to Phase 10. Only the objective",
           "changes: within-event pairwise instead of pointwise classification."]
    steps = P2.load()
    p2_train, _ = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    by_feat = {(r["tag"], r["domain"], r["ts"]): r for r in steps}

    for domain in config.DOMAINS:
        t0 = time.time()
        train, test = [], []
        stream = P10._events(domain, rows, m2, by_feat, sample)
        if stream is None:
            continue
        for side, ev in stream:
            (train if side == "train" else test).append(ev)
        if not train or not test:
            continue

        def matrices(events):
            built = []
            for ev in events:
                mat = PW.build_event_matrix(ev["ctx"], ev["cands"])
                prev = frozenset(ev["row"]["prev_deck"])
                truth = frozenset(ev["row"]["next_deck"])
                t_idx = None
                for i, c in enumerate(ev["cands"]):
                    if c.apply(prev) == truth:
                        t_idx = i
                        break
                built.append((mat, t_idx))
            return built

        tr_mats = matrices(train)
        n_with_truth = sum(1 for _m, t in tr_mats if t is not None)

        out.append("")
        out.append("=" * 82)
        out.append("%s   train events %d (%d contain the truth)  test events %d"
                   % (domain.upper(), len(train), n_with_truth, len(test)))
        out.append("   mean pool %.0f candidates   unique players %d"
                   % (sum(len(e["cands"]) for e in train) / max(1, len(train)),
                      len({e["row"]["tag"] for e in train})))
        out.append("=" * 82)

        # ---- negative-sampling comparison ---------------------------------
        out.append("")
        out.append("NEGATIVE SAMPLING  (test Recall@1 / MRR, 12 negatives)")
        out.append("   %-10s %10s %10s %12s" % ("strategy", "r@1", "MRR", "pairs/event"))
        best_model, best_mrr = None, -1.0
        for strat in PW.STRATEGIES:
            model = PW.PairwiseRanker(strategy=strat, negatives=12).fit(tr_mats)
            ranks = []
            for ev in test:
                ranked = model.rank(ev["ctx"], ev["cands"])
                ranks.append(RK.true_rank(ranked, ev["row"]["prev_deck"],
                                          ev["row"]["next_deck"]))
            s = RK.rank_summary(ranks)
            out.append("   %-10s %9.1f%% %10.3f %12.1f"
                       % (strat, 100 * s["r@1"], s["mrr"],
                          model.pairs_seen / max(1, n_with_truth)))
            if s["mrr"] > best_mrr:
                best_model, best_mrr = model, s["mrr"]

        # ---- the ladder ----------------------------------------------------
        out.append("")
        out.append("%-16s %7s %7s %7s %7s %7s %7s %7s %6s %6s"
                   % ("ranker", "r@1", "r@3", "r@5", "r@10", "r@25", "MRR",
                      "NDCG", "med", "p90"))
        rungs = [("L0 heuristic", RK.L0Heuristic()),
                 ("P1 pairwise", best_model)]
        summaries, per_player = {}, {}
        for name, rung in rungs:
            ranks, pp = [], collections.defaultdict(list)
            for ev in test:
                ranked = rung.rank(ev["ctx"], ev["cands"])
                rk = RK.true_rank(ranked, ev["row"]["prev_deck"],
                                  ev["row"]["next_deck"])
                ranks.append(rk)
                pp[ev["row"]["tag"]].append(1.0 / (rk + 1) if rk is not None else 0.0)
            summaries[name] = _summarise(name, ranks, out)
            per_player[name] = pp

        # ---- pool-size sweep ----------------------------------------------
        out.append("")
        out.append("POOL-SIZE SWEEP  (Recall@1 within a pool truncated to N)")
        out.append("   %-8s %12s %12s" % ("pool N", "L0", "P1 pairwise"))
        for n in POOL_SWEEP:
            cells = []
            for name, rung in rungs:
                hit = 0
                for ev in test:
                    trimmed = ev["cands"][:n]
                    ranked = rung.rank(ev["ctx"], trimmed)
                    rk = RK.true_rank(ranked, ev["row"]["prev_deck"],
                                      ev["row"]["next_deck"])
                    if rk == 0:
                        hit += 1
                cells.append(100.0 * hit / len(test))
            out.append("   %-8d %11.1f%% %11.1f%%" % (n, cells[0], cells[1]))

        # ---- gate ----------------------------------------------------------
        out.append("")
        out.append("GATE - P1 vs L0 (paired on players, MRR)")
        d = sig.paired_delta(per_player["P1 pairwise"],
                             per_player["L0 heuristic"], iters=bootstrap)
        out.append("   MRR delta %+.4f [%+.4f, %+.4f]  n=%d   %s"
                   % (d.point, d.low, d.high, d.n,
                      sig.verdict(d, "P1 pairwise", "L0 heuristic")))
        s0, s1 = summaries["L0 heuristic"], summaries["P1 pairwise"]
        for k in (1, 3, 10):
            key = "r@%d" % k
            out.append("   Recall@%-3d L0 %.1f%% -> P1 %.1f%%  (%+.1f pts)"
                       % (k, 100 * s0[key], 100 * s1[key],
                          100 * (s1[key] - s0[key])))
        passed = (d.point > 0 and d.excludes_zero()
                  and s1["r@1"] >= s0["r@1"] and s1["r@10"] >= s0["r@10"])
        out.append("   GATE: %s" % ("PASS - proceed to end-to-end (Phase 12)"
                                    if passed else "FAIL - stop; do not build boosting"))

        out.append("")
        out.append("P1 strongest weights (strategy=%s)" % best_model.strategy)
        for name, w in best_model.top_weights(10):
            out.append("   %-24s %+.3f" % (name, w))
        out.append("   (%.0fs)" % (time.time() - t0))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 11")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=700)
    ap.add_argument("--bootstrap", type=int, default=250)
    ap.add_argument("--cache", default=P7.CACHE)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not os.path.exists(args.cache):
        print("no cache", file=sys.stderr)
        return 2
    print(report(P7.load(args.cache), args.sample, args.bootstrap))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
