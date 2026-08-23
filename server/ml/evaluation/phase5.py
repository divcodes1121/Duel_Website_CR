"""Phase 5 — the complete edit decision, scored against standing still.

    python -m ml.evaluation.phase5 --report

THE GATE IS JACCARD, NOT A RANKING METRIC. Phase 4's chain won change-only
exact@1 and still lost on Jaccard, because a wrong edit is worse than no edit.
So the primary criterion is a paired improvement in Jaccard whose 95% CI
excludes zero, with exact@1 not allowed to regress to buy it.

    J0  Phase 4 chain, unchanged                     the control
    J1  + expected-utility STAY vs EDIT              the decision layer
    J2  + joint (non-independent) 2-card exits
    J3  + joint 2-card entries
    J4  + full candidate scoring over whole decks

An explicit independence experiment sits alongside: P(A,B) against P(A)P(B).
"""
from __future__ import annotations

import argparse
import collections
import os
import sys

from .. import change_detector as CD
from .. import config
from .. import edit_model as EM
from .. import exit_model as E
from .. import substitution as S
from . import metrics as M
from . import phase2 as P2
from . import phase3 as P3
from . import significance as sig

EDITS_CACHE = os.path.join(P3.RESULTS_DIR, "phase4-edits.jsonl.gz")

#: Measured in Phase 4: mean Jaccard of a chained edit that turned out wrong.
J_WRONG = {"competitive": 0.5445, "duel": 0.5912}
BREAK_EVEN = {"competitive": 0.303, "duel": 0.233}


def _macro(d: dict) -> float:
    return M.mean([M.mean(v) for v in d.values() if v])


def _truth(ev: dict) -> frozenset:
    return (frozenset(ev["prev_deck"]) - frozenset(ev["outgoing"])) \
        | frozenset(ev["incoming"])


# --------------------------------------------------------------------------
# Independence — is a 2-card edit two 1-card edits?
# --------------------------------------------------------------------------

def independence(train: list[dict], test: list[dict]) -> list[str]:
    out = ["", "=" * 72,
           "INDEPENDENCE EXPERIMENT - does P(A,B) factorise into P(A)P(B)?",
           "=" * 72]
    for domain in config.DOMAINS:
        tr = [e for e in train if e["domain"] == domain]
        te = [e for e in test if e["domain"] == domain and e["n_changes"] == 2]
        if not te:
            continue
        joint = EM.JointStats().fit(tr)
        seen = sum(1 for e in te
                   if tuple(sorted(e["outgoing"])) in joint.exit_pair)
        # Log-likelihood of the observed pairs under each model.
        ll_joint = ll_indep = 0.0
        for e in te:
            pair = tuple(sorted(e["outgoing"]))
            pj = joint.exit_pair.get(pair, 0) / (joint.n_edits + EM.MIN_SUPPORT)
            pi = joint.independent_exit(pair) * 2.0
            ll_joint += _safe_log(pj)
            ll_indep += _safe_log(pi)
        out.append("")
        out.append("%s   2-card edits in test: %d" % (domain.upper(), len(te)))
        out.append("  exit pairs also seen in train : %d (%.1f%%)"
                   % (seen, 100.0 * seen / len(te)))
        out.append("  mean log-lik, JOINT count     : %+.3f" % (ll_joint / len(te)))
        out.append("  mean log-lik, INDEPENDENT     : %+.3f" % (ll_indep / len(te)))
        better = "JOINT" if ll_joint > ll_indep else "INDEPENDENT"
        out.append("  -> %s fits the observed pairs better" % better)
        out.append("  (a joint model can only pay off on pairs it has seen; the")
        out.append("   coverage figure above is the ceiling on how often it can)")
    return out


def _safe_log(p: float) -> float:
    import math
    return math.log(max(p, 1e-12))


# --------------------------------------------------------------------------
# The J ladder
# --------------------------------------------------------------------------

def run_ladder(edits: list[dict], bootstrap: int) -> list[str]:
    out: list[str] = []
    steps = P2.load()
    p2_train, p2_test = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    e_train, _ = P3.temporal_split(edits)
    by_key = {(e["tag"], e["domain"], e["ts"]): e for e in edits}

    for domain in config.DOMAINS:
        tr = [e for e in e_train if e["domain"] == domain]
        subset = [r for r in p2_test if r["domain"] == domain]
        if not subset or not tr:
            continue
        exit_model = E.E4Combined(E.PopulationExitStats().fit(tr))
        entry_model = S.S2Transition(S.GlobalStats().fit(tr))
        joint = EM.JointStats().fit(tr)

        out.append("")
        out.append("=" * 72)
        out.append("%s   test steps %d   (break-even whole-edit accuracy %.1f%%)"
                   % (domain.upper(), len(subset), 100 * BREAK_EVEN[domain]))
        out.append("=" * 72)
        out.append("%-26s %9s %9s %10s %9s %8s"
                   % ("Strategy", "jaccard", "exact@1", "chg-jacc", "chg-e@1", "edits"))

        # ---- Recent (the thing to beat) -------------------------------------
        rj, re1, rjc, rec = (collections.defaultdict(list) for _ in range(4))
        for r in subset:
            rj[r["tag"]].append(r["rec_j"])
            re1[r["tag"]].append(r["rec_e1"])
            if r["label"]:
                rjc[r["tag"]].append(r["rec_j"])
                rec[r["tag"]].append(r["rec_e1"])
        out.append("%-26s %8.4f %8.1f%% %9.4f %8.1f%% %8s"
                   % ("Recent (stand still)", _macro(rj), 100 * _macro(re1),
                      _macro(rjc), 100 * _macro(rec), "0%"))

        variants = [
            ("J0 chain @0.9 (control)", dict(mode="threshold", thr=0.9)),
            ("J1 expected utility", dict(mode="utility", use_joint=False, width=1)),
            ("J2 +joint exits", dict(mode="utility", use_joint=True, width=1)),
            ("J4 +wide candidates", dict(mode="utility", use_joint=True, width=3)),
        ]
        results = {}
        for label, cfg in variants:
            dec = EM.EditDecision(exit_model, entry_model, joint,
                                  j_wrong=J_WRONG[domain],
                                  use_joint=cfg.get("use_joint", True),
                                  width=cfg.get("width", 3))
            j, e1, jc, ec = (collections.defaultdict(list) for _ in range(4))
            n_edit = 0
            correct_edits = 0
            for r in subset:
                dist = m2.predict(r["x"])
                p_n = {0: dist.get(0, 0.0), 1: dist.get(1, 0.0), 2: dist.get(2, 0.0)}
                ev = by_key.get((r["tag"], r["domain"], r["ts"]))
                tag = r["tag"]

                if cfg["mode"] == "threshold":
                    do_edit = (1.0 - p_n[0]) >= cfg["thr"]
                    cand = None
                    if do_edit and ev is not None:
                        n = 1 if p_n[1] >= p_n[2] else 2
                        ex = tuple(exit_model.rank(ev)[:n])
                        en = tuple(entry_model.rank(dict(ev, outgoing=list(ex)))[:n])
                        cand = EM.Candidate(ex, en)
                elif ev is None:
                    # No card-level row means this step was NOT an edit. The
                    # decision still has to be made without knowing that, so
                    # it is made from p_n alone: stay unless an edit's expected
                    # utility could beat it, which without a candidate it cannot.
                    do_edit, cand = False, None
                else:
                    chosen, u_edit, u_stay = dec.decide(ev, p_n)
                    do_edit = chosen.size > 0 and u_edit > u_stay
                    cand = chosen if do_edit else None

                if not do_edit or cand is None:
                    jv, ev1 = r["rec_j"], r["rec_e1"]
                else:
                    n_edit += 1
                    if ev is None:
                        # We edited; nothing actually changed.
                        pred = cand.apply(set())      # unreachable without deck
                        jv, ev1 = EM.jaccard_for_diff(cand.size), 0.0
                    else:
                        pred = cand.apply(ev["prev_deck"])
                        truth = _truth(ev)
                        jv = M.jaccard(pred, truth)
                        ev1 = 1.0 if pred == truth else 0.0
                        correct_edits += ev1
                j[tag].append(jv)
                e1[tag].append(ev1)
                if r["label"]:
                    jc[tag].append(jv)
                    ec[tag].append(ev1)
            results[label] = (j, e1, jc, ec)
            acc = (correct_edits / n_edit) if n_edit else 0.0
            out.append("%-26s %8.4f %8.1f%% %9.4f %8.1f%% %7.1f%%"
                       % (label, _macro(j), 100 * _macro(e1), _macro(jc),
                          100 * _macro(ec), 100.0 * n_edit / len(subset)))
            if n_edit:
                out.append("%-26s   whole-edit accuracy when it edits: %.1f%%  (need %.1f%%)"
                           % ("", 100 * acc, 100 * BREAK_EVEN[domain]))

        out.append("")
        out.append("GATE - paired vs Recent (95%% CI must exclude zero)")
        for label, (j, e1, jc, ec) in results.items():
            d_j = sig.paired_delta(j, rj, iters=bootstrap)
            d_e = sig.paired_delta(e1, re1, iters=bootstrap)
            d_jc = sig.paired_delta(jc, rjc, iters=bootstrap) if rjc else None
            out.append("  %-24s jaccard %+.4f [%+.4f, %+.4f]  %s"
                       % (label, d_j.point, d_j.low, d_j.high,
                          "PASS" if d_j.point > 0 and d_j.excludes_zero() else "fail"))
            out.append("  %-24s exact@1 %+.2f pts  chg-jacc %s"
                       % ("", 100 * d_e.point,
                          ("%+.4f" % d_jc.point) if d_jc else "n/a"))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 5")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=400)
    ap.add_argument("--cache", default=EDITS_CACHE)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not os.path.exists(args.cache):
        print("no cache", file=sys.stderr)
        return 2
    edits = P3.load(args.cache)
    train, test = P3.temporal_split(edits)
    lines = ["=" * 72,
             "OPPONENT INTELLIGENCE ENGINE - PHASE 5  (the edit decision)",
             "=" * 72,
             "edits %d   train %d   test %d" % (len(edits), len(train), len(test))]
    lines += independence(train, test)
    lines += run_ladder(edits, args.bootstrap)
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
