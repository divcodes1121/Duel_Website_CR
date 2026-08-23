"""Phase 7 — the oracle-free selective edit policy, end to end.

    python -m ml.evaluation.phase7 --report

FOUR-WAY CHRONOLOGICAL SPLIT, because this phase has four things to fit and
each must be fitted on data the next one has not seen:

    35%  stats      exit / entry / population counts
    25%  scorer     predictability model, trained on proposals over this slice
    10%  calibrate  Platt, on proposals the scorer never saw
    30%  test       everything reported

Every step is scored ONCE and the thresholds are swept over the cached scores,
so the coverage curve costs one pass rather than one per threshold.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys
import time

from .. import change_detector as CD
from .. import config
from .. import edit_model as EM
from .. import exit_model as E
from .. import policy as PO
from .. import predictability as PR
from .. import substitution as S
from . import metrics as M
from . import phase2 as P2
from . import phase3 as P3
from . import phase7_dump as P7
from . import significance as sig

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "models")
J_WRONG = {"competitive": 0.5445, "duel": 0.5912}
BREAK_EVEN = {"competitive": 0.303, "duel": 0.233}
COVERAGES = (0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.00)
MODEL_VERSION = "oie-phase7-0.1.0"


def _macro(d: dict) -> float:
    return M.mean([M.mean(v) for v in d.values() if v])


def split4(rows: list[dict]):
    o = sorted(rows, key=lambda r: r["ts"])
    a, b, c = int(len(o) * .35), int(len(o) * .60), int(len(o) * .70)
    return o[:a], o[a:b], o[b:c], o[c:]


def _edit_rows(rows: list[dict]) -> list[dict]:
    """Rows where an edit actually happened, shaped for the counting models."""
    out = []
    for r in rows:
        prev, nxt = frozenset(r["prev_deck"]), frozenset(r["next_deck"])
        if prev == nxt:
            continue
        out.append(dict(r, outgoing=sorted(prev - nxt), incoming=sorted(nxt - prev),
                        n_changes=len(nxt - prev)))
    return out


def build(domain: str, rows: list[dict], m2, by_feat: dict, width: int):
    stats_s, train_s, cal_s, test_s = split4(
        [r for r in rows if r["domain"] == domain])
    fit_edits = _edit_rows(stats_s)
    gen = PO.CandidateGenerator(
        E.E4Combined(E.PopulationExitStats().fit(fit_edits)),
        S.S2Transition(S.GlobalStats().fit(fit_edits)), width=width)

    def proposals(slice_rows):
        X, y, raw = [], [], []
        for r in slice_rows:
            feat = by_feat.get((r["tag"], r["domain"], r["ts"]))
            if feat is None:
                continue
            d = m2.predict(feat["x"])
            p_n = {0: d.get(0, 0.), 1: d.get(1, 0.), 2: d.get(2, 0.)}
            view = P7.model_view(r)
            cand, ep, np_ = PR.propose(view, p_n, gen.exit_model, gen.entry_model)
            if cand is None:
                continue
            X.append(PR.extract(view, cand, p_n, ep, np_))
            truth = frozenset(r["next_deck"])
            y.append(1.0 if cand.apply(view["prev_deck"]) == truth else 0.0)
            raw.append(r)
        return X, y, raw

    Xtr, ytr, _ = proposals(train_s)
    scorer = PR.PredictabilityModel().fit(Xtr, ytr) if Xtr else PR.PredictabilityModel()
    Xc, yc, _ = proposals(cal_s)
    scores = [scorer.predict(x) for x in Xc]
    cal = PO.Calibrator().fit(scores, yc)
    return gen, scorer, cal, test_s, (Xtr, ytr), (scores, yc)


def score_all(test_rows, gen, scorer, cal, m2, by_feat, domain, width):
    """One pass: best candidate, calibrated confidence, and its outcome."""
    pol = PO.SelectivePolicy(gen, scorer, cal, j_wrong=J_WRONG[domain])
    out = []
    for r in test_rows:
        feat = by_feat.get((r["tag"], r["domain"], r["ts"]))
        if feat is None:
            continue
        d = m2.predict(feat["x"])
        p_n = {0: d.get(0, 0.), 1: d.get(1, 0.), 2: d.get(2, 0.)}
        view = P7.model_view(r)
        prev, truth = frozenset(r["prev_deck"]), frozenset(r["next_deck"])
        cand, p, u_edit, u_stay, should = pol.decide(view, p_n)
        rec_j = M.jaccard(prev, truth)
        rec_e = 1.0 if prev == truth else 0.0
        row = {"tag": r["tag"], "ts": r["ts"], "changed": prev != truth,
               "n_diff": len(truth - prev), "rec_j": rec_j, "rec_e1": rec_e,
               "p": p, "u_edit": u_edit, "u_stay": u_stay, "should": should,
               "cand": cand, "view": view, "next": r["next_deck"],
               "edit_j": rec_j, "edit_e1": rec_e, "size": 0}
        if cand is not None:
            got = cand.apply(prev)
            row["edit_j"] = M.jaccard(got, truth)
            row["edit_e1"] = 1.0 if got == truth else 0.0
            row["size"] = cand.size
        out.append(row)
    return out


def recall_report(test_rows, gen, out: list[str], domain: str):
    out.append("")
    out.append("CANDIDATE RECALL - is the true next deck reachable at all?")
    edits = _edit_rows(test_rows)
    buckets = {"1-card": [e for e in edits if e["n_changes"] == 1],
               "2-card": [e for e in edits if e["n_changes"] >= 2]}
    out.append("   %-10s %8s %8s %8s %8s %8s"
               % ("edits", "n", "top-1", "top-3", "top-5", "top-10"))
    for label, rows in [("all", edits)] + list(buckets.items()):
        if not rows:
            continue
        hits = collections.Counter()
        sample = rows[:2500]
        for r in sample:
            info = gen.recall(P7.model_view(r), r["next_deck"])
            if info["found"]:
                for k in (1, 3, 5, 10):
                    if info["rank"] is not None and info["rank"] < k:
                        hits[k] += 1
        n = len(sample)
        out.append("   %-10s %8d %7.1f%% %7.1f%% %7.1f%% %7.1f%%"
                   % (label, n, 100 * hits[1] / n, 100 * hits[3] / n,
                      100 * hits[5] / n, 100 * hits[10] / n))
    out.append("   (rank 0 is STAY, so top-1 recall on an EDIT is 0 by")
    out.append("    construction — the useful figures are top-3 and beyond)")


def evaluate(scored, chooser, label, out, rj, re1, rjc, bootstrap):
    j, e1, jc = (collections.defaultdict(list) for _ in range(3))
    n_edit = correct = 0
    ones = twos = 0
    for s in scored:
        if s["cand"] is not None and chooser(s):
            n_edit += 1
            correct += s["edit_e1"]
            ones += s["size"] == 1
            twos += s["size"] == 2
            jv, ev = s["edit_j"], s["edit_e1"]
        else:
            jv, ev = s["rec_j"], s["rec_e1"]
        j[s["tag"]].append(jv)
        e1[s["tag"]].append(ev)
        if s["changed"]:
            jc[s["tag"]].append(jv)
    d = sig.paired_delta(j, rj, iters=bootstrap)
    de = sig.paired_delta(e1, re1, iters=bootstrap)
    cov = n_edit / len(scored) if scored else 0.0
    acc = correct / n_edit if n_edit else 0.0
    out.append("%-22s %8.4f %8.1f%% %9.4f %7.1f%% %7.1f%%  %+.4f %s"
               % (label, _macro(j), 100 * _macro(e1), _macro(jc),
                  100 * cov, 100 * acc, d.point,
                  "PASS" if d.point > 0 and d.excludes_zero() else ""))
    return {"j": j, "e1": e1, "jc": jc, "cov": cov, "acc": acc,
            "d": d, "de": de, "ones": ones, "twos": twos}


def report(rows, bootstrap: int, width: int) -> str:
    out: list[str] = ["=" * 78,
                      "OPPONENT INTELLIGENCE ENGINE - PHASE 7  (selective edit policy)",
                      "=" * 78]
    steps = P2.load()
    p2_train, _ = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    by_feat = {(r["tag"], r["domain"], r["ts"]): r for r in steps}
    meta_all = {}

    for domain in config.DOMAINS:
        t0 = time.time()
        gen, scorer, cal, test_s, (Xtr, ytr), (cscores, cy) = build(
            domain, rows, m2, by_feat, width)
        if not test_s or not Xtr:
            continue
        out.append("")
        out.append("=" * 78)
        out.append("%s   test steps %d   scorer trained on %d proposals (%.1f%% correct)"
                   % (domain.upper(), len(test_s), len(Xtr),
                      100 * sum(ytr) / len(ytr)))
        out.append("=" * 78)

        recall_report(test_s, gen, out, domain)

        # ---- calibration -------------------------------------------------
        raw_b = M.brier(cscores, cy)
        raw_e = PO.ece(cscores, cy)
        capp = [cal.apply(s) for s in cscores]
        out.append("")
        out.append("CALIBRATION of P(candidate correct)  (held-out slice, n=%d)"
                   % len(cscores))
        out.append("   %-12s %10s %10s" % ("", "Brier", "ECE"))
        out.append("   %-12s %10.4f %10.4f" % ("raw", raw_b, raw_e))
        out.append("   %-12s %10.4f %10.4f"
                   % ("calibrated", M.brier(capp, cy), PO.ece(capp, cy)))
        for r in PO.reliability(capp, cy, bins=5):
            out.append("     bin %.1f-%.1f  n=%-6d predicted %.3f  observed %.3f"
                       % (r["lo"], r["hi"], r["n"], r["predicted"], r["observed"]))

        scored = score_all(test_s, gen, scorer, cal, m2, by_feat, domain, width)
        rj, re1, rjc = (collections.defaultdict(list) for _ in range(3))
        for s in scored:
            rj[s["tag"]].append(s["rec_j"])
            re1[s["tag"]].append(s["rec_e1"])
            if s["changed"]:
                rjc[s["tag"]].append(s["rec_j"])

        out.append("")
        out.append("POLICIES  (oracle-free: every step decided from the prefix)")
        out.append("%-22s %8s %8s %9s %7s %7s  %8s"
                   % ("Strategy", "jaccard", "exact@1", "chg-jacc", "cover", "acc", "dJ"))
        out.append("%-22s %8.4f %8.1f%% %9.4f %7s %7s"
                   % ("R0 Recent (stay)", _macro(rj), 100 * _macro(re1),
                      _macro(rjc), "0%", "-"))

        results = {}
        results["R1 one-card only"] = evaluate(
            scored, lambda s: s["size"] == 1, "R1 one-card only", out,
            rj, re1, rjc, bootstrap)
        results["R2 expected utility"] = evaluate(
            scored, lambda s: s["should"], "R2 expected utility",
            out, rj, re1, rjc, bootstrap)

        # ---- coverage-risk curve ------------------------------------------
        out.append("")
        out.append("COVERAGE-RISK CURVE  (edit the top-N%% of ALL steps by confidence)")
        out.append("   %-8s %8s %9s %10s %8s %8s %9s"
                   % ("cover", "acc", "jaccard", "chg-jacc", "exact@1", "wrong", "dJ"))
        ranked = sorted([s for s in scored if s["cand"] is not None],
                        key=lambda s: -s["p"])
        for cov in COVERAGES:
            k = int(len(scored) * cov)
            chosen = {id(s) for s in ranked[:k]}
            res = evaluate(scored, lambda s: id(s) in chosen, "", [],
                           rj, re1, rjc, max(80, bootstrap // 4))
            wrong = (1 - res["acc"]) * res["cov"]
            out.append("   %-8s %7.1f%% %9.4f %10.4f %7.1f%% %7.1f%% %+9.4f %s"
                       % ("%.0f%%" % (100 * cov), 100 * res["acc"],
                          _macro(res["j"]), _macro(res["jc"]),
                          100 * _macro(res["e1"]), 100 * wrong, res["d"].point,
                          "PASS" if res["d"].point > 0 and res["d"].excludes_zero() else ""))

        # ---- 1 vs 2 card ---------------------------------------------------
        out.append("")
        out.append("EDIT SIZE  (within R2's chosen edits)")
        r2 = results["R2 expected utility"]
        out.append("   1-card chosen %d, 2-card chosen %d" % (r2["ones"], r2["twos"]))

        # ---- temporal robustness -------------------------------------------
        out.append("")
        out.append("TEMPORAL ROBUSTNESS")
        out.append("   %-8s %8s %9s %9s %8s" % ("month", "steps", "edit rate", "acc", "dJ"))
        by_month = collections.defaultdict(list)
        for s in scored:
            by_month[s["ts"][:6]].append(s)
        for month in sorted(by_month):
            g = by_month[month]
            if len(g) < 200:
                continue
            sub_rj = collections.defaultdict(list)
            for s in g:
                sub_rj[s["tag"]].append(s["rec_j"])
            res = evaluate(g, lambda s: s["should"], "", [],
                           sub_rj, sub_rj, sub_rj, 120)
            rate = sum(1 for s in g if s["changed"]) / len(g)
            out.append("   %-8s %8d %8.1f%% %8.1f%% %+9.4f"
                       % (month, len(g), 100 * rate, 100 * res["acc"],
                          res["d"].point))

        # ---- error taxonomy -------------------------------------------------
        out.append("")
        out.append("ERROR TAXONOMY")
        abstain: collections.Counter = collections.Counter()
        errors: collections.Counter = collections.Counter()
        for s in scored:
            acted = s["cand"] is not None and s["u_edit"] > s["u_stay"]
            if not acted:
                if s["changed"]:
                    abstain[PO.classify_abstention(
                        s["view"], {0: 1 - s["p"]}, s["p"],
                        {"found": s["cand"] is not None})] += 1
            elif not s["edit_e1"]:
                errors[PO.classify_error(s["view"], s["cand"], s["next"])] += 1
        tot_a = sum(abstain.values()) or 1
        out.append("   abstained on a real edit (%d):" % sum(abstain.values()))
        for k, v in abstain.most_common(6):
            out.append("     %-34s %6d  %5.1f%%" % (k, v, 100 * v / tot_a))
        tot_e = sum(errors.values()) or 1
        out.append("   made a wrong edit (%d):" % sum(errors.values()))
        for k, v in errors.most_common(6):
            out.append("     %-34s %6d  %5.1f%%" % (k, v, 100 * v / tot_e))

        meta_all[domain] = {
            "model_version": MODEL_VERSION,
            "domain": domain,
            "training_start": test_s[0]["ts"][:8] if test_s else None,
            "examples_scorer": len(Xtr),
            "examples_calibration": len(cscores),
            "test_steps": len(test_s),
            "features": list(PR.FEATURE_NAMES),
            "hyperparameters": {"width": width, "j_wrong": J_WRONG[domain]},
            "metrics": {k: {"jaccard_delta": v["d"].point,
                            "coverage": v["cov"], "accuracy": v["acc"]}
                        for k, v in results.items()},
            "calibration_metrics": {"brier_raw": raw_b, "ece_raw": raw_e,
                                    "brier_cal": M.brier(capp, cy),
                                    "ece_cal": PO.ece(capp, cy)},
            "break_even": BREAK_EVEN[domain],
            "seconds": round(time.time() - t0, 1),
        }

    _write_metadata(meta_all, out)
    return "\n".join(out)


def _write_metadata(meta: dict, out: list[str]) -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)
    try:
        rev = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        rev = ""
    payload = {"model_version": MODEL_VERSION, "git_revision": rev,
               "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "domains": meta,
               "note": "Offline research artifact. NOT loaded by production."}
    path = os.path.join(MODELS_DIR, "metadata.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    out.append("")
    out.append("model metadata written to %s" % path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 7")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=250)
    ap.add_argument("--width", type=int, default=2)
    ap.add_argument("--cache", default=P7.CACHE)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not os.path.exists(args.cache):
        print("no cache — run phase7_dump first", file=sys.stderr)
        return 2
    print(report(P7.load(args.cache), args.bootstrap, args.width))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
