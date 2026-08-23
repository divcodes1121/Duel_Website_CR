"""Rendering. The ONLY place a 'better' claim is allowed to appear.

The verdict is derived from the PAIRED bootstrap delta and nothing else. The
marginal per-model CIs printed in the tables are descriptive: two overlapping
marginal intervals say nothing about whether the paired difference is real, and
using them as a test would be wrong in the direction of under-claiming.
"""
from __future__ import annotations

from .. import config
from . import metrics as M
from . import significance as sig
from . import splits
from .harness import DomainResult, INCOMING_METRICS, change_detection


LINE = "-" * 72
RULE = "=" * 72


def _macro(per_player: dict) -> float:
    return M.mean([M.mean(v) for v in per_player.values() if v])


def _player_means(per_player: dict) -> list[float]:
    return [M.mean(v) for v in per_player.values() if v]


def _pct(value: float) -> str:
    return "%5.1f%%" % (100.0 * value)


def render(result: DomainResult) -> str:
    out: list[str] = []
    add = out.append

    add("")
    add(RULE)
    add("OPPONENT INTELLIGENCE ENGINE - PHASE 1")
    add(RULE)
    add("DOMAIN: %s        STEP: %s"
        % (result.domain.upper(), result.step_mode))
    add("")
    add("Players sampled : %d" % result.players_sampled)
    add("Players eligible: %d" % result.players_eligible)
    add("Battles         : %d" % result.battles)
    add("Clusters        : %d" % result.clusters)
    add("Prediction steps: %d" % result.steps)
    add("Change events   : %d (%.1f%% of steps)"
        % (result.change_events,
           100.0 * result.change_events / result.steps if result.steps else 0.0))
    add("Incoming cards  : %d" % result.incoming_cards)
    if result.step_mode == "next-in-cluster":
        add("Stayed in cluster: 100%% BY CONSTRUCTION (the step is selected by")
        add("                   the truth's cluster) — not a finding.")
        add("NOTE: a >=3-card edit leaves only 5 shared cards, which is BELOW")
        add("      the %d-card cluster rule, so it is a cluster SWITCH and is"
            % config.CLUSTER_MIN_OVERLAP)
        add("      unobservable here. Change buckets cap at 2-card by design.")
    else:
        add("Stayed in cluster: %.1f%%"
            % (100.0 * result.same_cluster / result.steps if result.steps else 0.0))
    add("Runtime         : db %.1fs, compute %.1fs"
        % (result.db_seconds, result.compute_seconds))

    if not result.steps:
        add("")
        add("NO STEPS — nothing to report.")
        return "\n".join(out)

    # ---------------------------------------------------------------- next deck
    add("")
    add("NEXT-DECK  (macro-average over players, 95% CI, player bootstrap)")
    add(LINE)
    add("%-12s %-22s %-22s %s" % ("Model", "Exact@1", "Jaccard", "Hamming"))
    for name in splits.NEXT_DECK_MODELS:
        overall = result.next_deck[name]["overall"]
        e1 = sig.bootstrap_mean(overall["exact@1"])
        ja = sig.bootstrap_mean(overall["jaccard"])
        ha = _macro(overall["hamming"])
        add("%-12s %-22s %-22s %.2f"
            % (name,
               "%.1f%% [%.1f, %.1f]" % (100 * e1.point, 100 * e1.low, 100 * e1.high),
               "%.3f [%.3f, %.3f]" % (ja.point, ja.low, ja.high),
               ha))

    add("")
    add("%-12s %8s %8s %8s" % ("Model", "Exact@3", "CardPrec", "CardRec"))
    for name in splits.NEXT_DECK_MODELS:
        overall = result.next_deck[name]["overall"]
        add("%-12s %8s %8s %8s"
            % (name, _pct(_macro(overall["exact@3"])),
               _pct(_macro(overall["card_precision"])),
               _pct(_macro(overall["card_recall"]))))

    # ------------------------------------------------------------- event splits
    add("")
    add("EVENT SPLIT  (exact@1, macro-average)")
    add(LINE)
    names = list(splits.NEXT_DECK_MODELS)
    add("%-12s %8s %10s %10s" % ("Bucket", "N", names[0], names[1]))
    for bucket in splits.EVENT_BUCKETS:
        n = result.bucket_counts.get(bucket, 0)
        if not n:
            continue
        cells = []
        for name in names:
            per = result.next_deck[name][bucket]["exact@1"]
            cells.append(_pct(_macro(per)) if per else "     n/a")
        add("%-12s %8d %10s %10s" % (bucket, n, cells[0], cells[1]))

    # -------------------------------------------------------- player dispersion
    add("")
    add("PLAYER-LEVEL DISPERSION  (exact@1, overall)")
    add(LINE)
    add("%-12s %9s %9s %9s %9s" % ("Model", "macro", "median", "worst10", "best10"))
    for name in names:
        vals = _player_means(result.next_deck[name]["overall"]["exact@1"])
        add("%-12s %9s %9s %9s %9s"
            % (name, _pct(M.mean(vals)), _pct(M.median(vals)),
               _pct(M.decile(vals, 0.1)), _pct(M.decile(vals, 0.9))))

    # ------------------------------------------------------------ incoming card
    add("")
    add("INCOMING CARD - CHANGE EVENTS ONLY  (player-history frequency ranker)")
    add(LINE)
    if result.incoming_cards:
        for metric in INCOMING_METRICS:
            per = result.incoming.get(metric, {})
            iv = sig.bootstrap_mean(per)
            if metric.startswith("top"):
                add("%-8s %.1f%% [%.1f, %.1f]"
                    % (metric, 100 * iv.point, 100 * iv.low, 100 * iv.high))
            else:
                add("%-8s %.3f [%.3f, %.3f]" % (metric, iv.point, iv.low, iv.high))
        add("")
        add("Note: M0/M1 are next-deck predictors and produce no card ranking,")
        add("so they have no score in this table. The two tasks are separate.")
    else:
        add("no change events — nothing to rank")

    # --------------------------------------------------------- change detection
    add("")
    add("CHANGE DETECTION - trivial 'predict NO CHANGE' control")
    add(LINE)
    cd = change_detection(result)
    add("accuracy: %.1f%%  (%d no-change of %d steps)"
        % (100 * cd["accuracy"], cd["no_change"], cd["total"]))
    p, r, f = cd["change_class"]
    add("positive = CHANGE    : precision %.3f  recall %.3f  F1 %.3f"
        % (p, r, f))
    p, r, f = cd["no_change_class"]
    add("positive = NO CHANGE : precision %.3f  recall %.3f  F1 %.3f"
        % (p, r, f))
    add("The control detects no change at all. Any change model must be read")
    add("against the CHANGE row, never against the accuracy figure.")

    # -------------------------------------------------------- model comparison
    add("")
    add("MODEL COMPARISON  (paired on players; verdict from the DELTA CI only)")
    add(LINE)
    a, b = names[1], names[0]          # recent - modal
    for bucket in ("overall", "change", "no-change"):
        pa = result.next_deck[a][bucket]["exact@1"]
        pb = result.next_deck[b][bucket]["exact@1"]
        if not pa or not pb:
            continue
        delta = sig.paired_delta(pa, pb)
        add("%-10s exact@1  delta %+.1f pts [%+.1f, %+.1f]  n=%d"
            % (bucket, 100 * delta.point, 100 * delta.low, 100 * delta.high,
               delta.n))
        add("%-10s %s" % ("", sig.verdict(delta, a, b)))
    ja_a = result.next_deck[a]["overall"]["jaccard"]
    ja_b = result.next_deck[b]["overall"]["jaccard"]
    if ja_a and ja_b:
        delta = sig.paired_delta(ja_a, ja_b)
        add("%-10s jaccard  delta %+.3f [%+.3f, %+.3f]"
            % ("overall", delta.point, delta.low, delta.high))
        add("%-10s %s" % ("", sig.verdict(delta, a, b)))

    add("")
    return "\n".join(out)
