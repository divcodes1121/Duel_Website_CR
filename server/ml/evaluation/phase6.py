"""Phase 6 — selective prediction. Act only where the edit is predictable.

    python -m ml.evaluation.phase6 --report

    P0  never edit (the Phase 5 safety baseline)
    P1  edit only when a 1-card change is predicted
    P2  edit on the top-N% most PREDICTABLE proposals (the coverage curve)
    P3  expected utility using the calibrated P(correct)

THE GATE IS DELIBERATELY STRICT, and the full coverage/accuracy curve is
reported rather than the nicest point on it:

    primary   overall Jaccard > Recent, paired 95% CI excluding zero
    secondary change-only Jaccard > Recent
    safety    overall exact@1 not materially below Recent
    utility   coverage large enough to be worth having

THREE-WAY TEMPORAL SPLIT. The exit/entry models are fitted on the earliest
slice, the predictability model is trained on proposals generated over the
middle slice, and everything is evaluated on the last. Training the
predictability model on proposals made by models that had already seen those
same edits would score its own memorisation.
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
from .. import predictability as PR
from .. import substitution as S
from . import metrics as M
from . import phase2 as P2
from . import phase3 as P3
from . import significance as sig

EDITS_CACHE = os.path.join(P3.RESULTS_DIR, "phase4-edits.jsonl.gz")
J_WRONG = {"competitive": 0.5445, "duel": 0.5912}
BREAK_EVEN = {"competitive": 0.303, "duel": 0.233}
COVERAGES = (0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.75, 1.00)


def _macro(d: dict) -> float:
    return M.mean([M.mean(v) for v in d.values() if v])


def _truth(ev: dict):
    return (frozenset(ev["prev_deck"]) - frozenset(ev["outgoing"])) \
        | frozenset(ev["incoming"])


def three_way(events: list[dict]):
    ordered = sorted(events, key=lambda e: e["ts"])
    a = int(len(ordered) * 0.45)
    b = int(len(ordered) * 0.70)
    return ordered[:a], ordered[a:b], ordered[b:]


def build(domain: str, edits: list[dict], steps_by_key: dict, m2):
    """Fit the stack for one domain and train the predictability model."""
    dom_edits = [e for e in edits if e["domain"] == domain]
    fit_slice, label_slice, _test = three_way(dom_edits)
    exit_model = E.E4Combined(E.PopulationExitStats().fit(fit_slice))
    entry_model = S.S2Transition(S.GlobalStats().fit(fit_slice))

    rows, labels = [], []
    for ev in label_slice:
        feat = steps_by_key.get((ev["tag"], ev["domain"], ev["ts"]))
        if feat is None:
            continue
        dist = m2.predict(feat["x"])
        p_n = {0: dist.get(0, 0.0), 1: dist.get(1, 0.0), 2: dist.get(2, 0.0)}
        cand, ex_p, en_p = PR.propose(ev, p_n, exit_model, entry_model)
        if cand is None:
            continue
        rows.append(PR.extract(ev, cand, p_n, ex_p, en_p))
        labels.append(PR.was_correct(ev, cand))
    model = PR.PredictabilityModel().fit(rows, labels) if rows else PR.PredictabilityModel()
    return exit_model, entry_model, model, (rows, labels)


def report(edits: list[dict], bootstrap: int) -> str:
    out: list[str] = ["=" * 72,
                      "OPPONENT INTELLIGENCE ENGINE - PHASE 6  (selective prediction)",
                      "=" * 72]
    steps = P2.load()
    p2_train, p2_test = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    by_step = {(r["tag"], r["domain"], r["ts"]): r for r in steps}
    by_edit = {(e["tag"], e["domain"], e["ts"]): e for e in edits}

    for domain in config.DOMAINS:
        exit_model, entry_model, pred_model, (trows, tlabels) = build(
            domain, edits, by_step, m2)
        subset = [r for r in p2_test if r["domain"] == domain]
        if not subset or not trows:
            continue

        out.append("")
        out.append("=" * 72)
        out.append("%s   test steps %d   predictability trained on %d proposals "
                   "(%.1f%% correct)"
                   % (domain.upper(), len(subset), len(trows),
                      100.0 * sum(tlabels) / len(tlabels)))
        out.append("=" * 72)

        # ---- score every test step once -----------------------------------
        scored = []
        for r in subset:
            dist = m2.predict(r["x"])
            p_n = {0: dist.get(0, 0.0), 1: dist.get(1, 0.0), 2: dist.get(2, 0.0)}
            ev = by_edit.get((r["tag"], r["domain"], r["ts"]))
            entry = {"row": r, "ev": ev, "p_n": p_n, "cand": None,
                     "score": 0.0, "correct": 0.0, "jac": r["rec_j"]}
            if ev is not None:
                cand, ex_p, en_p = PR.propose(ev, p_n, exit_model, entry_model)
                if cand is not None:
                    feats = PR.extract(ev, cand, p_n, ex_p, en_p)
                    entry["cand"] = cand
                    entry["score"] = pred_model.predict(feats)
                    truth = _truth(ev)
                    got = cand.apply(ev["prev_deck"])
                    entry["correct"] = 1.0 if got == truth else 0.0
                    entry["jac"] = M.jaccard(got, truth)
            else:
                # A non-edit step: the proposal cannot be built, but the model
                # must still be able to DECIDE. Score it from p_n alone, which
                # is what production would have.
                entry["score"] = pred_model.predict(
                    PR.extract({"prior_edits": [], "cluster_card_counts": {"x": 1},
                                "cluster_size": 1, "domain": domain},
                               EM.Candidate(("x",), ("y",)), p_n, {"x": 1.0}, {"y": 1.0}))
                entry["jac"] = 0.0            # editing when nothing changed
            scored.append(entry)

        # ---- Recent ------------------------------------------------------
        rj, re1, rjc = (collections.defaultdict(list) for _ in range(3))
        for e in scored:
            r = e["row"]
            rj[r["tag"]].append(r["rec_j"])
            re1[r["tag"]].append(r["rec_e1"])
            if r["label"]:
                rjc[r["tag"]].append(r["rec_j"])

        out.append("%-30s %9s %9s %10s %9s"
                   % ("Strategy", "jaccard", "exact@1", "chg-jacc", "coverage"))
        out.append("%-30s %8.4f %8.1f%% %9.4f %9s"
                   % ("P0 never edit (= Recent)", _macro(rj), 100 * _macro(re1),
                      _macro(rjc), "0.0%"))

        def evaluate(label: str, should_edit) -> dict:
            j, e1, jc = (collections.defaultdict(list) for _ in range(3))
            n_edit = correct = 0
            for e in scored:
                r = e["row"]
                act = e["cand"] is not None and should_edit(e)
                if act or (e["cand"] is None and should_edit(e)):
                    n_edit += 1
                    jv = e["jac"] if e["cand"] is not None else 0.0
                    ev1 = e["correct"] if e["cand"] is not None else 0.0
                    correct += ev1
                else:
                    jv, ev1 = r["rec_j"], r["rec_e1"]
                j[r["tag"]].append(jv)
                e1[r["tag"]].append(ev1)
                if r["label"]:
                    jc[r["tag"]].append(jv)
            cov = n_edit / len(scored) if scored else 0.0
            acc = correct / n_edit if n_edit else 0.0
            out.append("%-30s %8.4f %8.1f%% %9.4f %8.1f%%   acc %.1f%%"
                       % (label, _macro(j), 100 * _macro(e1), _macro(jc),
                          100 * cov, 100 * acc))
            return {"j": j, "e1": e1, "jc": jc, "cov": cov, "acc": acc}

        results = {}
        results["P1 one-card only"] = evaluate(
            "P1 one-card only",
            lambda e: e["cand"] is not None and e["cand"].size == 1)

        # ---- P2 coverage curve --------------------------------------------
        out.append("")
        out.append("P2 PREDICTABILITY COVERAGE CURVE (edit the top-N%% by score)")
        out.append("   %-10s %9s %9s %10s %9s"
                   % ("coverage", "acc", "jaccard", "chg-jacc", "vs Recent"))
        ranked = sorted(scored, key=lambda e: -e["score"])
        edit_true = [e for e in scored if e["cand"] is not None]
        curve = []
        for cov in COVERAGES:
            k = int(len(ranked) * cov)
            chosen = {id(e) for e in ranked[:k]}
            res = {"j": collections.defaultdict(list),
                   "jc": collections.defaultdict(list),
                   "e1": collections.defaultdict(list)}
            n_edit = correct = 0
            for e in scored:
                r = e["row"]
                if id(e) in chosen and e["cand"] is not None:
                    n_edit += 1
                    correct += e["correct"]
                    jv, ev1 = e["jac"], e["correct"]
                elif id(e) in chosen:
                    n_edit += 1
                    jv, ev1 = 0.0, 0.0
                else:
                    jv, ev1 = r["rec_j"], r["rec_e1"]
                res["j"][r["tag"]].append(jv)
                res["e1"][r["tag"]].append(ev1)
                if r["label"]:
                    res["jc"][r["tag"]].append(jv)
            d = sig.paired_delta(res["j"], rj, iters=bootstrap)
            acc = correct / n_edit if n_edit else 0.0
            out.append("   %-10s %8.1f%% %9.4f %10.4f %+9.4f %s"
                       % ("%.0f%%" % (100 * cov), 100 * acc, _macro(res["j"]),
                          _macro(res["jc"]), d.point,
                          "PASS" if d.point > 0 and d.excludes_zero() else ""))
            curve.append((cov, acc, _macro(res["j"]), d))

        # ---- P3 expected utility on the calibrated score -------------------
        out.append("")

        def utility_edit(e) -> bool:
            if e["cand"] is None:
                return False
            p = e["score"]
            u_edit = p * 1.0 + (1.0 - p) * J_WRONG[domain]
            p_n = e["p_n"]
            u_stay = sum(p_n.get(n, 0.0) * EM.jaccard_for_diff(n) for n in (0, 1, 2))
            return u_edit > u_stay

        results["P3 expected utility"] = evaluate("P3 expected utility", utility_edit)

        # ---- gate ----------------------------------------------------------
        out.append("")
        out.append("GATE vs Recent (paired, 95%% CI)")
        for label, res in results.items():
            d = sig.paired_delta(res["j"], rj, iters=bootstrap)
            de = sig.paired_delta(res["e1"], re1, iters=bootstrap)
            out.append("  %-24s jaccard %+.4f [%+.4f, %+.4f]  exact@1 %+.2f pts  %s"
                       % (label, d.point, d.low, d.high, 100 * de.point,
                          "PASS" if d.point > 0 and d.excludes_zero() else "fail"))
        best = max(curve, key=lambda c: c[2])
        out.append("  best coverage point: %.0f%% -> jaccard %.4f (%+.4f) %s"
                   % (100 * best[0], best[2], best[3].point,
                      "PASS" if best[3].point > 0 and best[3].excludes_zero() else "fail"))
        out.append("  break-even accuracy for this domain: %.1f%%"
                   % (100 * BREAK_EVEN[domain]))

        out.append("")
        out.append("PREDICTABILITY MODEL - strongest weights")
        for name, w in pred_model.top_weights(8):
            out.append("   %-22s %+.3f" % (name, w))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 6")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=300)
    ap.add_argument("--cache", default=EDITS_CACHE)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not os.path.exists(args.cache):
        print("no cache", file=sys.stderr)
        return 2
    print(report(P3.load(args.cache), args.bootstrap))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
