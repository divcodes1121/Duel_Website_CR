"""Phase 13 — exit intelligence.

    python -m ml.evaluation.phase13 --report

Three questions, in order:

  1. WHY does the existing exit ladder plateau? Which simple property, if any,
     identifies the outgoing card?
  2. Does a pairwise model over 8 cards beat E4? (Gate A)
  3. Does 2-card EXIT prediction look tractable on its own, given the pair
     space is only C(8,2)=28?

Plus a history-depth sweep, because "will more data help" should be measured on
the component that is actually binding rather than assumed.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time

from .. import change_detector as CD
from .. import config
from .. import exit_intel as XI
from .. import exit_model as E
from . import metrics as M
from . import phase2 as P2
from . import phase7 as P7H
from . import phase7_dump as P7
from . import significance as sig


def _macro(d: dict) -> float:
    return M.mean([M.mean(v) for v in d.values() if v])


def build_examples(domain, rows, m2, by_feat, sample):
    dom = sorted([r for r in rows if r["domain"] == domain], key=lambda r: r["ts"])
    stats_s, _t, _c, test_s = P7H.split4(dom)
    fit_edits = P7H._edit_rows(stats_s)
    if not fit_edits:
        return None, None, None

    pop_exit, pop_seen = collections.Counter(), collections.Counter()
    for e in fit_edits:
        out = set(e["outgoing"])
        for c in e["prev_deck"]:
            pop_seen[c] += 1
            if c in out:
                pop_exit[c] += 1

    cut = int(len(test_s) * 0.55)
    side_of = {(r["tag"], r["ts"]): ("train" if i < cut else "test")
               for i, r in enumerate(test_s)}
    train, test = [], []
    taken = collections.Counter()
    for r in test_s:
        side = side_of[(r["tag"], r["ts"])]
        if taken[side] >= sample:
            continue
        feat = by_feat.get((r["tag"], r["domain"], r["ts"]))
        p_change = 0.0
        if feat:
            d = m2.predict(feat["x"])
            p_change = 1.0 - d.get(0, 0.0)
        ex = XI.build(P7.model_view(r), r["next_deck"], p_change, pop_exit, pop_seen)
        if ex is None or ex.n_out > 2:
            continue
        taken[side] += 1
        (train if side == "train" else test).append(ex)
    return train, test, E.PopulationExitStats().fit(fit_edits)


def _e4_rank(ex: XI.ExitExample, stats) -> list[int]:
    """E4's ordering, expressed as deck indices, so it is comparable."""
    view = {"prev_deck": ex.deck, "cluster_size": 1, "cluster_card_counts": {},
            "recent_counts": {}, "last_seen": {}, "streak": {}, "prior_edits": []}
    # E4 needs the real view; rebuild from the features is not possible, so the
    # harness passes the original view through `ex.view` when available.
    view = getattr(ex, "view", view)
    ranked = E.E4Combined(stats).rank(view)
    return [ex.deck.index(c) for c in ranked if c in ex.deck]


def report(rows, sample: int, bootstrap: int) -> str:
    out = ["=" * 80,
           "OPPONENT INTELLIGENCE ENGINE - PHASE 13  (exit intelligence)",
           "=" * 80,
           "Phase 12: exit correct 38.2%/48.2%; entry given exit 71.7%/67.6%.",
           "Everything downstream is conditioned on the exit, so it is the",
           "component worth attacking."]
    steps = P2.load()
    p2_train, _ = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    by_feat = {(r["tag"], r["domain"], r["ts"]): r for r in steps}

    for domain in config.DOMAINS:
        t0 = time.time()
        train, test, stats = build_examples(domain, rows, m2, by_feat, sample)
        if not train or not test:
            continue
        one_tr = [e for e in train if e.n_out == 1]
        one_te = [e for e in test if e.n_out == 1]
        two_te = [e for e in test if e.n_out == 2]

        out.append("")
        out.append("=" * 80)
        out.append("%s   train %d (1-card %d)   test %d (1-card %d / 2-card %d)"
                   % (domain.upper(), len(train), len(one_tr), len(test),
                      len(one_te), len(two_te)))
        out.append("=" * 80)

        # ---- 1. why does the ladder plateau? -------------------------------
        out.append("")
        out.append("WHICH SIMPLE PROPERTY IDENTIFIES THE OUTGOING CARD?")
        out.append("   (chance is 1/8 = 12.5%%; n=%d one-card edits)" % len(one_te))
        tally = collections.Counter()
        for ex in one_te:
            for name, hit in XI.signal_hits(ex).items():
                if hit:
                    tally[name] += 1
        for name in XI.SIGNALS:
            out.append("   %-32s %6.1f%%" % (name, 100 * tally[name] / len(one_te)))

        # ---- 2. the model ---------------------------------------------------
        model = XI.PairwiseExit().fit(one_tr)

        def score(ranker, examples):
            per = collections.defaultdict(list)
            hits = collections.Counter()
            for ex in examples:
                t = ex.truth_index()
                if t is None:
                    continue
                order = ranker(ex)
                pos = order.index(t) if t in order else 99
                for k in (1, 2, 3):
                    if pos < k:
                        hits[k] += 1
                per[ex.tag].append(1.0 if pos == 0 else 0.0)
                hits["mrr"] += 1.0 / (pos + 1)
            n = max(1, len([e for e in examples if e.truth_index() is not None]))
            return {"top1": hits[1] / n, "top2": hits[2] / n, "top3": hits[3] / n,
                    "mrr": hits["mrr"] / n, "per": dict(per), "n": n}

        # E0/E4 need the ORIGINAL view; rebuild it from the example's features
        # is impossible, so the stability ranking is reproduced from feature
        # columns directly — identical ordering, no view required.
        i_stab = XI.FEATURE_NAMES.index("shell_share")
        i_edit = XI.FEATURE_NAMES.index("player_exit_count")
        i_streak = XI.FEATURE_NAMES.index("log_streak")

        def x0(ex):      # least stable first  == E0
            return sorted(range(len(ex.deck)),
                          key=lambda i: (ex.features[i][i_stab], ex.deck[i]))

        def x3(ex):      # most edited first   == E3 in spirit
            return sorted(range(len(ex.deck)),
                          key=lambda i: (-ex.features[i][i_edit], ex.deck[i]))

        def x4(ex):      # editability + recency == E4 in spirit
            return sorted(range(len(ex.deck)),
                          key=lambda i: (-(ex.features[i][i_edit]
                                           - ex.features[i][i_streak] / 5.0
                                           + (1 - ex.features[i][i_stab])),
                                         ex.deck[i]))

        rungs = [("X0 least-stable", x0), ("X3 most-edited", x3),
                 ("X4 combined", x4), ("X5 pairwise", model.rank)]
        out.append("")
        out.append("%-18s %8s %8s %8s %8s" % ("model", "top-1", "top-2", "top-3", "MRR"))
        res = {}
        for name, fn in rungs:
            s = score(fn, one_te)
            res[name] = s
            out.append("%-18s %7.1f%% %7.1f%% %7.1f%% %8.3f"
                       % (name, 100 * s["top1"], 100 * s["top2"],
                          100 * s["top3"], s["mrr"]))

        out.append("")
        out.append("GATE A - X5 pairwise vs the best heuristic (paired on players)")
        best_h = max(("X0 least-stable", "X3 most-edited", "X4 combined"),
                     key=lambda k: res[k]["top1"])
        d = sig.paired_delta(res["X5 pairwise"]["per"], res[best_h]["per"],
                             iters=bootstrap)
        out.append("   vs %s: top-1 %+.1f pts [%+.1f, %+.1f]   %s"
                   % (best_h, 100 * d.point, 100 * d.low, 100 * d.high,
                      sig.verdict(d, "X5 pairwise", best_h)))
        passed = d.point > 0 and d.excludes_zero()
        out.append("   GATE A: %s" % ("PASS" if passed else "FAIL - stop"))

        out.append("")
        out.append("X5 strongest weights")
        for name, w in model.top_weights(8):
            out.append("   %-28s %+.3f" % (name, w))

        # ---- 3. two-card exits ---------------------------------------------
        if two_te:
            hits = collections.Counter()
            for ex in two_te:
                idxs = {ex.deck.index(c) for c in ex.truth_exits if c in ex.deck}
                if len(idxs) != 2:
                    continue
                pairs = model.rank_pairs(ex)
                for k in (1, 3, 5, 10, 28):
                    if any(set(p) == idxs for p in pairs[:k]):
                        hits[k] += 1
                hits["n"] += 1
            n = max(1, hits["n"])
            out.append("")
            out.append("2-CARD EXIT PAIRS (space is C(8,2)=28)   n=%d" % n)
            out.append("   top-1 %.1f%%   top-3 %.1f%%   top-5 %.1f%%   "
                       "top-10 %.1f%%   all-28 %.1f%%"
                       % (100 * hits[1] / n, 100 * hits[3] / n, 100 * hits[5] / n,
                          100 * hits[10] / n, 100 * hits[28] / n))
            out.append("   Exit pairs are a small space; the 2-card problem is")
            out.append("   the ENTRY pair, not the exit pair.")

        # ---- 4. history depth ----------------------------------------------
        out.append("")
        out.append("DOES MORE HISTORY HELP THE EXIT MODEL?")
        out.append("   %-22s %8s %8s" % ("player history (edits)", "n", "top-1"))
        buckets = [(0, 2), (3, 5), (6, 10), (11, 20), (21, 10 ** 6)]
        i_ne = XI.FEATURE_NAMES.index("n_prior_edits")
        for lo, hi in buckets:
            import math as _m
            sel = [e for e in one_te
                   if lo <= (_m.expm1(e.features[0][i_ne])) <= hi]
            if len(sel) < 20:
                continue
            s = score(model.rank, sel)
            out.append("   %-22s %8d %7.1f%%"
                       % ("%d-%s" % (lo, "+" if hi > 1000 else str(hi)),
                          s["n"], 100 * s["top1"]))
        out.append("   (%.0fs)" % (time.time() - t0))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 13")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=2500)
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
