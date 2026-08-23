"""Phase 14 — the shortlist, evaluated on ALL steps with no oracle.

    python -m ml.evaluation.phase14 --report

Recent is the primary prediction and is never displaced, so overall Jaccard and
exact@1 EQUAL the Recent baseline by construction. What is measured here is what
the shortlist ADDS: how often the true next deck appears among the alternatives,
and whether the confidence bands mean anything.

Also emits the data-maturity table, so "is the system still learning" becomes a
number that can be re-run each month rather than an opinion.
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
from .. import shortlist as SL
from .. import substitution as S
from .. import vocabulary as V
from . import metrics as M
from . import phase2 as P2
from . import phase7 as P7H
from . import phase7_dump as P7

K_ALTS = 3


def report(rows, sample: int) -> str:
    out = ["=" * 80,
           "OPPONENT INTELLIGENCE ENGINE - PHASE 14  (shortlist, all steps)",
           "=" * 80,
           "Recent is ALWAYS the primary prediction, so overall Jaccard and",
           "exact@1 equal the Recent baseline by construction. Measured here:",
           "what the alternatives add, and whether the bands are honest."]
    steps = P2.load()
    p2_train, _ = P2.temporal_split(steps)
    m2 = CD.M2ChangeModel().fit([r["x"] for r in p2_train],
                                [r["label"] for r in p2_train])
    by_feat = {(r["tag"], r["domain"], r["ts"]): r for r in steps}

    for domain in config.DOMAINS:
        t0 = time.time()
        dom = sorted([r for r in rows if r["domain"] == domain],
                     key=lambda r: r["ts"])
        stats_s, _t, _c, test_s = P7H.split4(dom)
        fit_edits = P7H._edit_rows(stats_s)
        if not fit_edits or not test_s:
            continue
        gen = C.C1WideOneCard(E.E4Combined(E.PopulationExitStats().fit(fit_edits)),
                              S.S2Transition(S.GlobalStats().fit(fit_edits)),
                              width=8, entry_width=999)
        test_keys = {(r["tag"], r["ts"]) for r in test_s}
        vocab = V.PlayerVocabulary()

        tally = collections.Counter()
        band_hits = collections.defaultdict(lambda: [0, 0])
        by_month = collections.defaultdict(lambda: collections.Counter())
        seen = 0
        for r in dom:
            if (r["tag"], r["ts"]) in test_keys and seen < sample:
                seen += 1
                base = P7.model_view(r)
                view = dict(base, pool_override=vocab.pool_for(base))
                feat = by_feat.get((r["tag"], r["domain"], r["ts"]))
                p_change = 0.0
                if feat:
                    d = m2.predict(feat["x"])
                    p_change = 1.0 - d.get(0, 0.0)
                cands = [c for c in gen.generate(view) if c.size == 1][:40]
                prior = collections.Counter()
                for o, i in view.get("prior_edits", []):
                    if len(o) == 1 and len(i) == 1:
                        prior[(o[0], i[0])] += 1
                sl = SL.build(view["prev_deck"], p_change, cands,
                              lambda c: prior.get((c.exits[0], c.entries[0]), 0),
                              K_ALTS)
                cov = SL.coverage(sl, r["next_deck"])
                changed = frozenset(r["prev_deck"]) != frozenset(r["next_deck"])
                tally["n"] += 1
                tally["changed"] += changed
                tally["primary"] += cov["primary_correct"]
                tally["alt"] += cov["in_alternatives"]
                tally["covered"] += cov["covered"]
                if changed:
                    tally["alt_on_change"] += cov["in_alternatives"]
                tally["p_" + sl.primary_confidence] += 1
                band_hits[sl.primary_confidence][0] += cov["primary_correct"]
                band_hits[sl.primary_confidence][1] += 1
                m = r["ts"][:6]
                by_month[m]["n"] += 1
                by_month[m]["primary"] += cov["primary_correct"]
                by_month[m]["covered"] += cov["covered"]
            vocab.observe_row(r)

        n = max(1, tally["n"])
        ch = max(1, tally["changed"])
        out.append("")
        out.append("=" * 80)
        out.append("%s   steps %d   change rate %.1f%%"
                   % (domain.upper(), n, 100 * tally["changed"] / n))
        out.append("=" * 80)
        out.append("   primary correct (= Recent)        %6.1f%%" % (100 * tally["primary"] / n))
        out.append("   truth in the %d alternatives       %6.1f%%"
                   % (K_ALTS, 100 * tally["alt"] / n))
        out.append("   ... on CHANGE steps only          %6.1f%%"
                   % (100 * tally["alt_on_change"] / ch))
        out.append("   COVERED (primary or alternative)  %6.1f%%   (+%.1f pts over Recent)"
                   % (100 * tally["covered"] / n,
                      100 * (tally["covered"] - tally["primary"]) / n))
        out.append("")
        out.append("   PRIMARY CONFIDENCE BANDS - is the label honest?")
        out.append("   %-10s %8s %12s" % ("band", "share", "actually right"))
        for band in (SL.HIGH, SL.MEDIUM, SL.LOW):
            hit, tot = band_hits[band]
            if tot:
                out.append("   %-10s %7.1f%% %11.1f%%"
                           % (band, 100 * tot / n, 100 * hit / tot))
        out.append("")
        out.append("   DATA MATURITY - re-run monthly to see if it is still learning")
        out.append("   %-8s %8s %10s %10s" % ("month", "steps", "primary", "covered"))
        for mth in sorted(by_month):
            g = by_month[mth]
            if g["n"] < 100:
                continue
            out.append("   %-8s %8d %9.1f%% %9.1f%%"
                       % (mth, g["n"], 100 * g["primary"] / g["n"],
                          100 * g["covered"] / g["n"]))
        out.append("   (%.0fs)" % (time.time() - t0))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OIE Phase 14")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=4000)
    ap.add_argument("--cache", default=P7.CACHE)
    a = ap.parse_args(argv)
    if not a.report:
        ap.print_help()
        return 0
    if not os.path.exists(a.cache):
        print("no cache", file=sys.stderr)
        return 2
    print(report(P7.load(a.cache), a.sample))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
