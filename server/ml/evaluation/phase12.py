"""Phase 12 — L0/P1 disagreement analysis, then hybrid ranking.

    python -m ml.evaluation.phase12 --report

ANALYSIS BEFORE IMPLEMENTATION, in that order and gated:

  GATE A  the disagreement matrix must show a meaningful `p1_only` cell. If P1
          only rearranges cases L0 had already lost, no hybrid can help and the
          phase stops there.
  GATE B  a hybrid must improve Recall@3/@10 and MRR WITHOUT losing Recall@1.

Also decomposes L0's first pick into exit-correct / entry-correct, because if
the exit is usually right and the entry usually wrong then the weak component is
the entry ranker and a general candidate ranker is the wrong instrument.

Generation stays frozen and identical to Phases 10 and 11.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time

from .. import change_detector as CD
from .. import config
from .. import hybrid as H
from .. import pairwise as PW
from .. import ranker as RK
from . import phase10 as P10
from . import phase2 as P2
from . import phase7_dump as P7
from . import significance as sig

MIN_RESCUE = 0.03      # Gate A: p1_only must reach this share of events


def report(rows, sample: int, bootstrap: int) -> str:
    out = ["=" * 82,
           "OPPONENT INTELLIGENCE ENGINE - PHASE 12  (L0 prior + P1 evidence)",
           "=" * 82,
           "Generation frozen and identical to Phases 10-11.",
           "Analysis first: the disagreement matrix gates everything after it."]
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

        mats = []
        for ev in train:
            mat = PW.build_event_matrix(ev["ctx"], ev["cands"])
            prev = frozenset(ev["row"]["prev_deck"])
            truth = frozenset(ev["row"]["next_deck"])
            t_idx = next((i for i, c in enumerate(ev["cands"])
                          if c.apply(prev) == truth), None)
            mats.append((mat, t_idx))
        strategy = "hard" if domain == "competitive" else "mix"
        p1 = PW.PairwiseRanker(strategy=strategy, negatives=12).fit(mats)

        out.append("")
        out.append("=" * 82)
        out.append("%s   train %d  test %d   P1 strategy=%s"
                   % (domain.upper(), len(train), len(test), strategy))
        out.append("=" * 82)

        # ---------------------------------------------------- GATE A --------
        l0 = RK.L0Heuristic()
        cells: collections.Counter = collections.Counter()
        picks: collections.Counter = collections.Counter()
        cached = []
        for ev in test:
            prev, nxt = ev["row"]["prev_deck"], ev["row"]["next_deck"]
            a = l0.rank(ev["ctx"], ev["cands"])
            b = p1.rank(ev["ctx"], ev["cands"])
            cached.append((ev, a, b))
            cells[H.disagreement(a, b, prev, nxt)] += 1
            picks[H.decompose_pick(a[0] if a else None, prev, nxt)] += 1
        n = len(test)

        out.append("")
        out.append("DISAGREEMENT MATRIX at rank 1  (n=%d)" % n)
        for key, label in (("both", "both correct"),
                           ("l0_only", "L0 correct, P1 wrong"),
                           ("p1_only", "L0 wrong, P1 CORRECT  <- rescue"),
                           ("neither", "both wrong")):
            out.append("   %-34s %6d  %5.1f%%"
                       % (label, cells[key], 100 * cells[key] / n))
        rescue = cells["p1_only"] / n
        out.append("   GATE A: %s (rescue %.1f%%, floor %.0f%%)"
                   % ("PASS" if rescue >= MIN_RESCUE else "FAIL",
                      100 * rescue, 100 * MIN_RESCUE))

        out.append("")
        out.append("WHY IS L0 STRONG?  its rank-1 pick, decomposed")
        for label, count in picks.most_common():
            out.append("   %-34s %6d  %5.1f%%" % (label, count, 100 * count / n))

        if rescue < MIN_RESCUE:
            out.append("")
            out.append("   Stopping: P1 rescues too few events for a hybrid to pay.")
            continue

        # ---------------------------------------------------- GATE B --------
        rungs = [("H0 = L0", l0), ("P1 alone", p1),
                 ("H1 anchor", H.H1HardAnchor(p1)),
                 ("H2 protected m=1.0", H.H2ProtectedAnchor(p1, 1.0)),
                 ("H2 protected m=2.0", H.H2ProtectedAnchor(p1, 2.0)),
                 ("H3 blend a=0.5", H.H3Blend(p1, 0.5)),
                 ("H3 blend a=0.7", H.H3Blend(p1, 0.7))]

        out.append("")
        out.append("%-22s %7s %7s %7s %7s %7s %7s %6s"
                   % ("ranker", "r@1", "r@3", "r@5", "r@10", "r@25", "MRR", "med"))
        summaries, per_player = {}, {}
        for name, rung in rungs:
            ranks, pp = [], collections.defaultdict(list)
            for ev, a, b in cached:
                ranked = (a if name == "H0 = L0" else
                          b if name == "P1 alone" else
                          rung.rank(ev["ctx"], ev["cands"]))
                rk = RK.true_rank(ranked, ev["row"]["prev_deck"],
                                  ev["row"]["next_deck"])
                ranks.append(rk)
                pp[ev["row"]["tag"]].append(1.0 / (rk + 1) if rk is not None else 0.0)
            s = RK.rank_summary(ranks)
            summaries[name], per_player[name] = s, pp
            out.append("%-22s %6.1f%% %6.1f%% %6.1f%% %6.1f%% %6.1f%% %7.3f %6s"
                       % (name, 100 * s["r@1"], 100 * s["r@3"], 100 * s["r@5"],
                          100 * s["r@10"], 100 * s["r@25"], s["mrr"], s["median"]))

        base = summaries["H0 = L0"]
        out.append("")
        out.append("GATE B - hybrids vs L0 (paired on players, MRR)")
        winner = None
        for name, _r in rungs[2:]:
            s = summaries[name]
            d = sig.paired_delta(per_player[name], per_player["H0 = L0"],
                                 iters=bootstrap)
            keeps_top = s["r@1"] >= base["r@1"] - 1e-9
            better = (s["r@3"] > base["r@3"] and s["r@10"] > base["r@10"]
                      and d.point > 0 and d.excludes_zero())
            verdict = "PASS" if (keeps_top and better) else ""
            out.append("   %-22s MRR %+.4f [%+.4f, %+.4f]  r@1 %+.1f  r@10 %+.1f  %s"
                       % (name, d.point, d.low, d.high,
                          100 * (s["r@1"] - base["r@1"]),
                          100 * (s["r@10"] - base["r@10"]), verdict))
            if verdict and (winner is None
                            or s["mrr"] > summaries[winner]["mrr"]):
                winner = name
        out.append("   GATE B: %s"
                   % ("PASS - %s" % winner if winner else "FAIL - no hybrid clears it"))
        out.append("   (%.0fs)" % (time.time() - t0))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 12")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=600)
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
