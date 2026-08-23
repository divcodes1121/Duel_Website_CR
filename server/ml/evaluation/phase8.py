"""Phase 8 — candidate generation. Recall only; no ranking, no new ML.

    python -m ml.evaluation.phase8 --report

ONE QUESTION: can we build a candidate set that contains the actual next deck?
Phase 7 proved a perfect ranker over the old beam caps near 20%, so nothing
about ranking is measured here.

Generation runs on EVERY step from the prefix alone. `test_ml_candidates.py`
pins that as a contract, because Phase 6's "deployable" result turned out to
have been conditioned on knowing an edit occurred.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time

from .. import candidates as C
from .. import config
from .. import exit_model as E
from .. import substitution as S
from . import phase7 as P7H
from . import phase7_dump as P7

KS = (3, 10, 25, 50, 100, 400)
SAMPLE = 1500


def _macro_recall(gen, rows, ks=KS) -> dict:
    hits = collections.Counter()
    sizes = []
    t0 = time.time()
    for r in rows:
        view = P7.model_view(r)
        info = gen.recall(view, r["next_deck"], ks)
        sizes.append(info["n"])
        for k, ok in info["hits"].items():
            if ok:
                hits[k] += 1
    n = len(rows) or 1
    return {"recall": {k: hits[k] / n for k in ks},
            "mean_size": sum(sizes) / n,
            "seconds": time.time() - t0, "n": n}


def report(rows, sample: int) -> str:
    out: list[str] = ["=" * 78,
                      "OPPONENT INTELLIGENCE ENGINE - PHASE 8  (candidate generation)",
                      "=" * 78]

    for domain in config.DOMAINS:
        dom = [r for r in rows if r["domain"] == domain]
        stats_s, _tr, _cal, test_s = P7H.split4(dom)
        fit_edits = P7H._edit_rows(stats_s)
        if not fit_edits or not test_s:
            continue
        exit_model = E.E4Combined(E.PopulationExitStats().fit(fit_edits))
        entry_model = S.S2Transition(S.GlobalStats().fit(fit_edits))

        edits = P7H._edit_rows(test_s)
        ones = [e for e in edits if e["n_changes"] == 1][:sample]
        twos = [e for e in edits if e["n_changes"] >= 2][:sample]
        allx = edits[:sample]

        out.append("")
        out.append("=" * 78)
        out.append("%s   test steps %d   edits %d (1-card %d / 2-card %d)"
                   % (domain.upper(), len(test_s), len(edits),
                      sum(1 for e in edits if e["n_changes"] == 1),
                      sum(1 for e in edits if e["n_changes"] >= 2)))
        out.append("=" * 78)

        # ---- the ceiling on retrieval -------------------------------------
        rep = C.deck_repeat_rate(
            [(P7.model_view(e), e["next_deck"]) for e in allx])
        out.append("")
        out.append("IS THE NEXT DECK ONE THEY HAVE ALREADY PLAYED?")
        out.append("   overall  %.1f%%  (%d of %d edits)"
                   % (100 * rep["rate"], rep["repeat"], rep["total"]))
        for n, r in rep["by_size"].items():
            out.append("   %d-card   %.1f%%  (n=%d)" % (n, 100 * r, rep["counts"][n]))
        out.append("   This is the ceiling on C3 and the cheapest recall available:")
        out.append("   a returning deck needs retrieval, not construction.")

        gens = [
            C.C0Beam(exit_model, entry_model, 3),
            C.C1WideOneCard(exit_model, entry_model),
            C.C2TwoCard(exit_model, entry_model),
            C.C3Historical(exit_model, entry_model),
            C.C4Union(exit_model, entry_model),
        ]

        for label, subset in (("ALL EDITS", allx), ("1-CARD", ones), ("2-CARD", twos)):
            if not subset:
                continue
            out.append("")
            out.append("%s  (n=%d)   candidate recall @k" % (label, len(subset)))
            out.append("   %-18s %6s %6s %6s %6s %6s %6s %8s %8s"
                       % ("generator", "@3", "@10", "@25", "@50", "@100", "@400",
                          "cands", "ms/step"))
            for gen in gens:
                res = _macro_recall(gen, subset)
                out.append("   %-18s %5.1f%% %5.1f%% %5.1f%% %5.1f%% %5.1f%% %5.1f%% %8.0f %8.1f"
                           % (gen.name,
                              100 * res["recall"][3], 100 * res["recall"][10],
                              100 * res["recall"][25], 100 * res["recall"][50],
                              100 * res["recall"][100], 100 * res["recall"][400],
                              res["mean_size"],
                              1000 * res["seconds"] / res["n"]))

        out.append("")
        out.append("PHASE 7 BASELINE for comparison: 1-card @3 was 28.6%% / 35.2%%,")
        out.append("2-card @3 was 0.0%%, 2-card @10 was 1.4%% / 4.2%%.")
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 8")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=SAMPLE)
    ap.add_argument("--cache", default=P7.CACHE)
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0
    if not os.path.exists(args.cache):
        print("no cache", file=sys.stderr)
        return 2
    print(report(P7.load(args.cache), args.sample))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
