"""Phase 10 — 1-card candidate ranking over a frozen pool.

    python -m ml.evaluation.phase10 --report

GATE A: L1 must beat L0 on Recall@1/3/10, MRR and NDCG with player-level paired
evaluation. If it does not, STOP — there is no case for boosting.

THE SPLIT IS AT THE PREDICTION EVENT, NEVER THE CANDIDATE ROW. Candidates from
one step are near-duplicates of each other; splitting them randomly would put a
step's own candidates on both sides and score memorisation. Events are split
chronologically first, candidates generated inside each side afterwards.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time

from .. import candidates as C
from .. import change_detector as CD
from .. import config
from .. import exit_model as E
from .. import ranker as R
from .. import substitution as S
from .. import vocabulary as V
from . import phase2 as P2
from . import phase7 as P7H
from . import phase7_dump as P7
from . import significance as sig

#: The FROZEN pool. Every rung ranks exactly this.
POOL_EXITS, POOL_ENTRIES = 8, 999


def _events(domain, rows, m2, by_feat, sample):
    """Chronological 1-card prediction events with their frozen candidates.

    Yields (split_slice, event) so the caller can keep train and test apart at
    the EVENT level. The vocabulary is folded in only after an event is emitted,
    so the pool at T holds nothing observed at or after T.
    """
    dom = sorted([r for r in rows if r["domain"] == domain], key=lambda r: r["ts"])
    stats_s, _t, _c, test_s = P7H.split4(dom)
    fit_edits = P7H._edit_rows(stats_s)
    if not fit_edits:
        return None
    exit_model = E.E4Combined(E.PopulationExitStats().fit(fit_edits))
    entry_model = S.S2Transition(S.GlobalStats().fit(fit_edits))
    gen = C.C1WideOneCard(exit_model, entry_model, POOL_EXITS, POOL_ENTRIES)

    pop_exit, pop_exit_seen, pop_in = (collections.Counter() for _ in range(3))
    for e in fit_edits:
        out = set(e["outgoing"])
        for c in e["prev_deck"]:
            pop_exit_seen[c] += 1
            if c in out:
                pop_exit[c] += 1
        pop_in.update(e["incoming"])

    # Events come from the LAST slice; the earlier 70% fitted the counting
    # models, so nothing here has been seen by them.
    cut = int(len(test_s) * 0.55)
    test_keys = {(r["tag"], r["ts"]): ("train" if i < cut else "test")
                 for i, r in enumerate(test_s)}

    vocab = V.PlayerVocabulary()
    taken = collections.Counter()
    for r in dom:
        side = test_keys.get((r["tag"], r["ts"]))
        if side and taken[side] < sample:
            prev, nxt = frozenset(r["prev_deck"]), frozenset(r["next_deck"])
            if prev != nxt and len(nxt - prev) == 1:
                taken[side] += 1
                base = P7.model_view(r)
                pool = vocab.pool_for(base)
                view = dict(base, pool_override=pool)
                feat = by_feat.get((r["tag"], r["domain"], r["ts"]))
                d = m2.predict(feat["x"]) if feat else {}
                p_n = {0: d.get(0, 0.0), 1: d.get(1, 0.0), 2: d.get(2, 0.0)}
                cands = [c for c in gen.generate(view) if c.size == 1]
                ctx = R.EventContext(view, p_n, pool, pop_exit, pop_exit_seen,
                                     pop_in, len(fit_edits),
                                     vocab.known(r["tag"], r["domain"]))
                yield side, {"row": r, "ctx": ctx, "cands": cands}
        vocab.observe_row(r)


def report(rows, sample: int, bootstrap: int) -> str:
    out = ["=" * 78,
           "OPPONENT INTELLIGENCE ENGINE - PHASE 10  (1-card candidate ranking)",
           "=" * 78,
           "The candidate pool is FROZEN: every rung orders the identical set,",
           "so any movement is the ranker's and not the generator's.",
           "2-card edits are explicitly out of scope (recall 32.2%/45.8%)."]
    steps = P2.load()
    p2_train, _ = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    by_feat = {(r["tag"], r["domain"], r["ts"]): r for r in steps}

    for domain in config.DOMAINS:
        t0 = time.time()
        train, test = [], []
        stream = _events(domain, rows, m2, by_feat, sample)
        if stream is None:
            continue
        for side, ev in stream:
            (train if side == "train" else test).append(ev)
        if not train or not test:
            continue

        # ---- L1 training rows: one per CANDIDATE, grouped by event ---------
        X, y = [], []
        for ev in train:
            prev = frozenset(ev["row"]["prev_deck"])
            truth = frozenset(ev["row"]["next_deck"])
            for c in ev["cands"]:
                X.append(R.extract(ev["ctx"], c))
                y.append(1.0 if c.apply(prev) == truth else 0.0)
        l1 = R.L1Logistic().fit(X, y)

        rungs = [R.L0Heuristic(), l1]
        per_rung = {}
        out.append("")
        out.append("=" * 78)
        out.append("%s   train events %d  test events %d  candidate rows %d"
                   % (domain.upper(), len(train), len(test), len(X)))
        out.append("   mean pool %.0f candidates   positives %.2f%%"
                   % (len(X) / max(1, len(train)), 100 * sum(y) / max(1, len(y))))
        out.append("=" * 78)

        out.append("")
        out.append("%-16s %7s %7s %7s %7s %7s %7s %7s %6s %6s %6s"
                   % ("ranker", "r@1", "r@3", "r@5", "r@10", "r@25", "MRR",
                      "NDCG", "med", "p90", "p95"))
        for rung in rungs:
            ranks, per_player = [], collections.defaultdict(list)
            for ev in test:
                ranked = rung.rank(ev["ctx"], ev["cands"])
                rk = R.true_rank(ranked, ev["row"]["prev_deck"],
                                 ev["row"]["next_deck"])
                ranks.append(rk)
                per_player[ev["row"]["tag"]].append(
                    1.0 / (rk + 1) if rk is not None else 0.0)
            s = R.rank_summary(ranks)
            per_rung[rung.name] = (s, per_player, ranks)
            out.append("%-16s %6.1f%% %6.1f%% %6.1f%% %6.1f%% %6.1f%% %7.3f %7.3f %6s %6s %6s"
                       % (rung.name, 100 * s["r@1"], 100 * s["r@3"],
                          100 * s["r@5"], 100 * s["r@10"], 100 * s["r@25"],
                          s["mrr"], s["ndcg"], s["median"], s["p90"], s["p95"]))

        # ---- ceiling decomposition ----------------------------------------
        s0 = per_rung["L0 heuristic"][0]
        out.append("")
        out.append("CEILING DECOMPOSITION")
        out.append("   candidate recall (truth anywhere in pool) : %.1f%%"
                   % (100 * s0["coverage"]))
        best = per_rung[rungs[-1].name][0]
        out.append("   best ranker Recall@10                     : %.1f%%"
                   % (100 * best["r@10"]))
        out.append("   -> generation failure : %.1f%% of steps"
                   % (100 * (1 - s0["coverage"])))
        out.append("   -> ranking failure    : %.1f%% of steps"
                   % (100 * (s0["coverage"] - best["r@10"])))

        # ---- Gate A --------------------------------------------------------
        out.append("")
        out.append("GATE A - L1 vs L0 (paired on players, MRR)")
        d = sig.paired_delta(per_rung["L1 logistic"][1],
                             per_rung["L0 heuristic"][1], iters=bootstrap)
        out.append("   MRR delta %+.4f [%+.4f, %+.4f]  n=%d   %s"
                   % (d.point, d.low, d.high, d.n,
                      sig.verdict(d, "L1 logistic", "L0 heuristic")))
        s1 = per_rung["L1 logistic"][0]
        for k in (1, 3, 10):
            key = "r@%d" % k
            out.append("   Recall@%-3d  L0 %.1f%%  ->  L1 %.1f%%   (%+.1f pts)"
                       % (k, 100 * s0[key], 100 * s1[key],
                          100 * (s1[key] - s0[key])))
        passed = (d.point > 0 and d.excludes_zero() and s1["r@10"] > s0["r@10"])
        out.append("   GATE A: %s" % ("PASS - boosting is justified" if passed
                                      else "FAIL - stop; do not build L2"))

        out.append("")
        out.append("L1 strongest weights")
        for name, w in l1.top_weights(8):
            out.append("   %-24s %+.3f" % (name, w))
        out.append("")
        out.append("   (%.0fs)" % (time.time() - t0))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 10")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=900)
    ap.add_argument("--bootstrap", type=int, default=300)
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
