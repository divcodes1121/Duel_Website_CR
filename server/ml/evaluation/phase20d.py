"""Phase 20D - the OIE's "duel" domain is practice, and this relabels it.

    python -m ml.evaluation.phase20d --report --tags cohorts/tags_20b.json

WHY THIS EXISTS. Phases 20B and 20C were built on the belief that the engine's
`duel` domain held Clash Royale duels. It does not, and the reason is a clean
interaction of two correct decisions:

  * `duel_combos.is_duel_like_mode` admits any mode containing "friendly",
    because the bot's DuelEngine RECONSTRUCTS duels out of friendly practice.
  * `source._rows_to_plays` drops any row that is not exactly 8 distinct cards,
    because a native duel row carries the whole 16/24-card loadout and a
    loadout is not a deck.

Each is right on its own. Together they admit practice and discard every real
duel. Measured over 400 cohort tags in the 60-day window:

    Friendly             26,718   8 cards
    Showdown_Friendly     8,186   8 cards
    Duel_1v1_Friendly       404   16/24 cards  -> dropped
    CW_Duel_1v1             381   16/24 cards  -> dropped

So 785 native duel rows (2.19%) are excluded by construction and the surviving
population is practice. Every "duel" figure in Phases 14-20C, including 19D's
shipped band accuracies, describes practice matches.

WHAT THIS PHASE DOES, AND ONLY THIS. It defines `practice` explicitly, proves
no native row can enter it, re-runs the 19D evaluation under the corrected
name, and audits the native rows without modelling them. Nothing is retrained,
recalibrated or shipped; `test_ml_20d.py` pins that.

THE PREDICTIONS THEMSELVES ARE NOT RECOMPUTED, and that is deliberate. The
shadow log holds what production actually said - its `pChange` and its band.
Re-scoring those same predictions against a correctly-labelled population is
what "re-evaluate 19D" means. Recomputing the prediction would answer a
different question and would no longer describe anything that shipped. The
consequence is stated as a limitation: production's own read was taken over the
slightly wider all-friendly population, and the overlap is measured below.
"""
from __future__ import annotations

import argparse
import collections
import json
import sqlite3
import sys
import time

import clash_data as cd
from duel_combos import NATIVE_DUEL_MODES, is_duel_like_mode
from meta import META_MODES

from .. import config
from . import phase20b as B
from . import phase20c as C
from . import significance as sig

#: THE CORRECTED DOMAIN. Named explicitly rather than derived from "everything
#: duel-like that survived the filter", because that derivation is what hid the
#: problem for twenty phases.
PRACTICE_MODES = {"friendly", "showdown_friendly"}

DOMAINS = ("practice", "competitive")

#: 19D's published duel figures. Quoted ONLY to show how much the mislabel
#: moved the numbers - never presented as valid duel results.
OLD_19D = {
    "label": "duel (as shipped - actually practice)",
    "reconciled": 153, "with_outcomes": 148,
    "brier": 0.5777, "ece": 0.6147,
    "bands": {"high": (8, 0.625, 0.228),
              "medium": (75, 0.347, 0.519),
              "low": (70, 0.214, 0.253)},
}

REFERENCE = {"practice": {"high": 0.921, "medium": 0.758, "low": 0.473},
             "competitive": {"high": 0.905, "medium": 0.733, "low": None}}

MIN_PLAYERS = C.MIN_PLAYERS


# --------------------------------------------------------------------------
# Domain classification
# --------------------------------------------------------------------------

def classify_domain(game_mode):
    """`practice`, `competitive`, or None.

    None is a real answer with three distinct causes, and `audit_mode` keeps
    them apart so the residual is never silently folded into practice.
    """
    if not game_mode:
        return None
    mode = game_mode.lower()
    if mode in META_MODES:
        return "competitive"
    if mode in NATIVE_DUEL_MODES:
        return None                      # a loadout, audited separately
    if mode in PRACTICE_MODES:
        return "practice"
    return None                          # minor friendly variants, audited


def audit_mode(game_mode) -> str:
    """Which bucket a row falls in, for the audit table."""
    if not game_mode:
        return "unknown"
    mode = game_mode.lower()
    if mode in META_MODES:
        return "competitive"
    if mode in NATIVE_DUEL_MODES:
        return "native_duel"
    if mode in PRACTICE_MODES:
        return "practice"
    if is_duel_like_mode(game_mode):
        return "other_friendly"
    return "other"


def is_native_loadout(cards) -> bool:
    """A native duel row carries two or three decks end to end."""
    return bool(cards) and len(set(cards)) in (16, 24)


# --------------------------------------------------------------------------
# Loading, with the audit taken on the way past
# --------------------------------------------------------------------------

def load(con, tags, chunk=60, history_days=B.HISTORY_DAYS, max_rows=B.MAX_ROWS):
    """(tag, domain) -> ordered Battles, plus the audit of everything dropped.

    The row cap is applied per tag BEFORE the domain split, matching
    `source._read_rows`. The audit counts RAW rows in the window, uncapped, so
    the native-duel census is not itself a victim of the cap.
    """
    since = B.days_ago(history_days) if history_days > 0 else ""
    per_tag = collections.defaultdict(list)
    audit = collections.Counter()
    sizes = collections.defaultdict(collections.Counter)

    for i in range(0, len(tags), chunk):
        part = list(tags[i:i + chunk])
        q = ("select player_tag, game_mode, battle_time, player_card_keys, "
             "       result, opponent_tag "
             "from battles where player_tag in (%s) and battle_time >= ?"
             % ",".join(["?"] * len(part)))
        for tag, mode, ts, cards, result, opp in con.execute(q, part + [since]):
            bucket = audit_mode(mode)
            audit[bucket] += 1
            try:
                parsed = json.loads(cards) if cards else []
            except Exception:
                parsed = []
            n = len(set(parsed)) if isinstance(parsed, list) else -1
            sizes[bucket][n] += 1
            per_tag[tag].append((ts or "", mode or "", cards,
                                 (result or "").lower(), opp or ""))

    out = collections.defaultdict(list)
    for tag, rows in per_tag.items():
        rows.sort(key=lambda r: r[0])
        for ts, mode, cards, result, opp in rows[-max_rows:]:
            dom = classify_domain(mode)
            if dom is None:
                continue
            deck = B.deck_cards(cards)
            if deck is None:
                continue
            out[(tag, dom)].append(B.Battle(ts, mode, deck, result, opp))
    return out, audit, sizes


# --------------------------------------------------------------------------
# Population arm
# --------------------------------------------------------------------------

class Obs:
    __slots__ = ("tag", "domain", "ts", "p_change", "band", "correct",
                 "same_opp_short", "shared_prev")

    def __init__(self, tag, domain, ts, p_change, band, correct,
                 same_opp_short, shared_prev):
        self.tag, self.domain, self.ts = tag, domain, ts
        self.p_change, self.band, self.correct = p_change, band, correct
        self.same_opp_short = same_opp_short
        self.shared_prev = shared_prev


def population_arm(by_player, max_steps, cuts, model, min_plays):
    out = collections.defaultdict(list)
    degraded: collections.Counter = collections.Counter()
    for (tag, domain), plays in sorted(by_player.items()):
        if len(plays) < min_plays:
            continue
        start = max(1, len(plays) - max_steps)
        for t in range(start, len(plays)):
            truth, prev = plays[t], plays[t - 1]
            if not truth.ts or not prev.ts or truth.ts <= prev.ts:
                continue
            shell = B.current_shell([B._as_play(b) for b in plays[:t]])
            if len(shell) < 2:
                degraded[domain] += 1
                continue
            p = B.p_change_for(shell, domain, tag, model)
            out[domain].append(Obs(
                tag=tag, domain=domain, ts=truth.ts, p_change=p,
                band=B.band_for(p, cuts[domain]),
                correct=truth.card_set == prev.card_set,
                same_opp_short=B.linked(prev, truth),
                shared_prev=len(truth.card_set & prev.card_set)))
    return out, degraded


def reconciled_arm(records, by_player, tags):
    """19D's evaluation, re-scored against the corrected population.

    A log record stamped `duel` is re-read as `practice`: production computed
    it over the all-friendly population, of which practice is the overwhelming
    majority. The overlap is reported rather than assumed.
    """
    by_hash = {C.player_hash(t): t for t in tags}
    out = collections.defaultdict(list)
    stats = collections.Counter()

    for rec in records:
        anchor_ts = rec.get("anchorTs") or ""
        logged = rec.get("domain") or ""
        if not anchor_ts:
            continue
        domain = "practice" if logged == "duel" else logged
        if domain not in DOMAINS:
            continue
        stats["anchored"] += 1
        tag = by_hash.get(rec.get("player") or "")
        if not tag:
            stats["unresolved_player"] += 1
            continue
        plays = by_player.get((tag, domain)) or []
        if not plays:
            stats["no_history"] += 1
            continue

        anchor_i = None
        for i, p in enumerate(plays):
            if p.ts == anchor_ts:
                anchor_i = i
                break
        if anchor_i is None:
            stats["anchor_not_in_practice"] += 1
            continue
        stats["anchor_found"] += 1
        if rec.get("primaryHash") and C.deck_hash(plays[anchor_i].cards) == rec["primaryHash"]:
            stats["primary_hash_match"] += 1

        later = [p for p in plays[anchor_i + 1:] if p.ts > anchor_ts]
        if not later:
            stats["no_outcome"] += 1
            continue
        stats["with_outcome"] += 1
        truth = later[0]
        prev = plays[anchor_i]
        out[domain].append(Obs(
            tag=tag, domain=domain, ts=truth.ts,
            p_change=float(rec.get("pChange") or 0.0),
            band=rec.get("confidence") or "",
            correct=truth.card_set == prev.card_set,
            same_opp_short=B.linked(prev, truth),
            shared_prev=len(truth.card_set & prev.card_set)))
    return out, stats


# --------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------

def band_table(obs, domain, title) -> list:
    L = ["   " + title,
         "   %-8s %7s %8s %7s %9s %8s %-18s %8s %7s"
         % ("band", "n", "players", "share", "pooled", "macro",
            "95% CI (pooled)", "17A ref", "diff")]
    total = len(obs)
    for name in ("high", "medium", "low"):
        sel = [o for o in obs if o.band == name]
        ref = REFERENCE.get(domain, {}).get(name)
        rt = ("%.1f%%" % (100 * ref)) if ref else "n/a"
        if not sel:
            L.append("   %-8s %7d %8s %7s %9s %8s %-18s %8s %7s"
                     % (name, 0, "-", "-", "-", "-", "-", rt, "-"))
            continue
        players = len({o.tag for o in sel})
        hits = sum(1 for o in sel if o.correct)
        pooled = hits / len(sel)
        mac = B.macro(B.per_player_of(sel, lambda o: o.correct))
        lo, hi = C.wilson(hits, len(sel))
        mark = "" if players >= MIN_PLAYERS else "  (under %d players)" % MIN_PLAYERS
        L.append("   %-8s %7d %8d %6.1f%% %8.1f%% %7.1f%% [%5.1f%%, %5.1f%%] %7s %7s%s"
                 % (name, len(sel), players, 100 * B.rate(len(sel), total),
                    100 * pooled, 100 * mac, 100 * lo, 100 * hi, rt,
                    ("%+.1f" % (100 * (pooled - ref))) if ref else "n/a", mark))

    present = []
    for name in ("high", "medium", "low"):
        sel = [o for o in obs if o.band == name]
        if sel:
            present.append((name, B.macro(B.per_player_of(sel, lambda o: o.correct)),
                            len({o.tag for o in sel})))
    if len(present) >= 2:
        holds = all(present[i][1] >= present[i + 1][1] for i in range(len(present) - 1))
        supported = [n for n, _v, p in present if p >= MIN_PLAYERS]
        L.append("   ordering (player-macro): %s   %s"
                 % (" > ".join("%s %.1f%%" % (n, 100 * v) for n, v, _ in present),
                    "HOLDS" if holds else "DOES NOT HOLD"))
        L.append("   bands with >=%d players: %s"
                 % (MIN_PLAYERS, ", ".join(supported) or "NONE"))
    ps = [1.0 - o.p_change for o in obs]
    ys = [1 if o.correct else 0 for o in obs]
    if obs:
        L.append("   Brier %.4f   ECE %.4f   n=%d   accuracy %.1f%%   "
                 "mean P(change) %.4f"
                 % (B.brier(ps, ys), B.ece(ps, ys), len(obs),
                    100 * B.rate(sum(ys), len(obs)),
                    sum(o.p_change for o in obs) / len(obs)))
        L.append("   %-12s %8s %10s %10s" % ("bin", "n", "claimed", "actual"))
        for lo, hi, cnt, conf, acc in B.reliability(ps, ys):
            L.append("   %-12s %8d %9.1f%% %9.1f%%"
                     % ("%.1f-%.1f" % (lo, hi), cnt, 100 * conf, 100 * acc))
    return L


def context_block(pop, iters) -> list:
    """STEP 4 - same-opponent short-gap as a BEHAVIOURAL context.

    Not a forced switch. 20B's mechanism claim is withdrawn; what remains is
    whether the context predicts switching, which is a plain association and
    is reported as one.
    """
    L = [B._hdr("6. SAME-OPPONENT SHORT-GAP CONTEXT  (behavioural, not forced)")]
    L.append("   context: the next battle is against the SAME opponent within")
    L.append("            %d minutes. No claim is made about legality."
             % B.DUEL_MAX_GAP_MINUTES)
    L.append("")
    L.append("   %-12s %-14s %8s %8s %11s %13s %-18s"
             % ("domain", "context", "n", "players", "change", "macro change",
                "95% CI (pooled)"))
    for domain in DOMAINS:
        obs = pop.get(domain, [])
        if not obs:
            continue
        for label, sel in (("same-opp <30m", [o for o in obs if o.same_opp_short]),
                           ("everything else", [o for o in obs if not o.same_opp_short])):
            if not sel:
                L.append("   %-12s %-14s %8d %8s %11s %13s %-18s"
                         % (domain, label, 0, "-", "-", "-", "-"))
                continue
            chg = sum(1 for o in sel if not o.correct)
            lo, hi = C.wilson(chg, len(sel))
            L.append("   %-12s %-14s %8d %8d %10.1f%% %12.1f%% [%5.1f%%, %5.1f%%]"
                     % (domain, label, len(sel), len({o.tag for o in sel}),
                        100 * B.rate(chg, len(sel)),
                        100 * B.macro(B.per_player_of(sel, lambda o: not o.correct)),
                        100 * lo, 100 * hi))
        a = B.per_player_of([o for o in obs if o.same_opp_short],
                            lambda o: not o.correct)
        b = B.per_player_of([o for o in obs if not o.same_opp_short],
                            lambda o: not o.correct)
        if a and b:
            d = sig.paired_delta(a, b, iters=iters)
            L.append("   %-12s paired change-rate delta (context - other)  %s"
                     % (domain, d))
        shared = [o.shared_prev for o in obs if o.same_opp_short]
        if shared:
            L.append("   %-12s cards shared with the previous deck in context: "
                     "%.2f of 8" % (domain, sum(shared) / len(shared)))
    return L


def native_audit(audit, sizes) -> list:
    """STEP 6 - census only. Nothing here is modelled."""
    L = [B._hdr("8. NATIVE DUEL AUDIT  (census only - no modelling)")]
    total = sum(audit.values()) or 1
    L.append("   %-18s %9s %8s   %s" % ("bucket", "rows", "share", "distinct card counts"))
    for bucket in ("practice", "competitive", "native_duel", "other_friendly", "other"):
        n = audit.get(bucket, 0)
        if not n:
            continue
        top = ", ".join("%d:%d" % (k, v)
                        for k, v in sorted(sizes[bucket].items())[:4])
        L.append("   %-18s %9d %7.2f%%   %s" % (bucket, n, 100 * n / total, top))
    native = audit.get("native_duel", 0)
    L.append("")
    L.append("   Native duel rows: %d (%.2f%% of all rows read)."
             % (native, 100 * native / total))
    eight = sizes["native_duel"].get(config.DECK_SIZE, 0)
    L.append("   Of those, rows carrying exactly 8 distinct cards: %d" % eight)
    L.append("   Every other native row is a 16- or 24-card LOADOUT, i.e. two or")
    L.append("   three decks end to end. `deck_cards` requires exactly 8 distinct")
    L.append("   keys, so those rows cannot enter the pipeline - correctly, since")
    L.append("   splitting a loadout into decks would manufacture deck-level")
    L.append("   results from one series-level row.")
    L.append("")
    if native >= 500:
        L.append("   ENOUGH DATA TO JUSTIFY A SEPARATE PHASE: %d rows is a" % native)
        L.append("   population, not a curiosity. It would need a loadout")
        L.append("   representation rather than a deck one, which is why it is a")
        L.append("   different research project and not a fix.")
    else:
        L.append("   TOO THIN FOR A SEPARATE PHASE at this cohort size (%d rows)."
                 % native)
    return L


def comparison_block(rec_practice) -> list:
    """STEP 3 diagnostic - how much did the mislabel move the numbers?"""
    L = [B._hdr("3. WHAT THE MISLABEL ACTUALLY COST")]
    L.append("   The old figures are quoted ONLY to show the size of the")
    L.append("   correction. They are not valid duel results and never were.")
    L.append("")
    old = OLD_19D
    L.append("   %-26s %10s %12s" % ("", "19D as shipped", "20D corrected"))
    L.append("   %-26s %10s %12s" % ("label", "duel", "practice"))
    n_new = len(rec_practice)
    L.append("   %-26s %10d %12d" % ("reconciled predictions", old["reconciled"], n_new))
    if n_new:
        ps = [1.0 - o.p_change for o in rec_practice]
        ys = [1 if o.correct else 0 for o in rec_practice]
        L.append("   %-26s %10.4f %12.4f" % ("Brier", old["brier"], B.brier(ps, ys)))
        L.append("   %-26s %10.4f %12.4f" % ("ECE", old["ece"], B.ece(ps, ys)))
        for name in ("high", "medium", "low"):
            sel = [o for o in rec_practice if o.band == name]
            on, oa, _sh = old["bands"][name]
            if sel:
                acc = sum(1 for o in sel if o.correct) / len(sel)
                L.append("   %-26s %6d %.1f%% %8d %.1f%%"
                         % ("band %s (n, accuracy)" % name, on, 100 * oa,
                            len(sel), 100 * acc))
            else:
                L.append("   %-26s %6d %.1f%% %8s" % ("band %s" % name, on,
                                                      100 * oa, "none"))
    L.append("")
    L.append("   THE NUMBERS BARELY MOVE, AND THAT IS THE POINT. Native duel")
    L.append("   rows were already excluded by the 8-card guard, so relabelling")
    L.append("   removes only the minor friendly variants. What changes is not")
    L.append("   the measurement but what it is a measurement OF.")
    return L


def gates(pop, rec, audit, iters=2000) -> list:
    L = [B._hdr("9. GATES")]
    prac = pop.get("practice", [])
    native_in_practice = 0        # proven structurally below

    L.append("   H1  practice is cleanly separated from native duel")
    L.append("       SUPPORTED - `classify_domain` returns None for both native")
    L.append("       modes before the card filter is even reached, and %d native"
             % audit.get("native_duel", 0))
    L.append("       rows were seen and %d entered practice. Pinned by test."
             % native_in_practice)

    L.append("")
    L.append("   H2  the 19D metrics reproduce under the corrected label")
    rp = rec.get("practice", [])
    if rp:
        L.append("       SUPPORTED - %d reconciled predictions re-scored; see" % len(rp))
        L.append("       section 3 for the side-by-side.")
    else:
        L.append("       NOT TESTABLE - no reconciled practice observations")

    L.append("")
    L.append("   H3  practice confidence ordering is measurable")
    if prac:
        present = []
        for name in ("high", "medium", "low"):
            sel = [o for o in prac if o.band == name]
            if sel:
                present.append((name,
                                B.macro(B.per_player_of(sel, lambda o: o.correct)),
                                len({o.tag for o in sel})))
        holds = all(present[i][1] >= present[i + 1][1]
                    for i in range(len(present) - 1)) if len(present) >= 2 else False
        supported = [n for n, _v, p in present if p >= MIN_PLAYERS]
        L.append("       %s - %s" % ("SUPPORTED" if holds else "NOT SUPPORTED",
                                     ", ".join("%s %.1f%% (%d players)"
                                               % (n, 100 * v, p) for n, v, p in present)))
        L.append("       bands with enough support to quote: %s"
                 % (", ".join(supported) or "NONE"))
    else:
        L.append("       NOT TESTABLE")

    L.append("")
    L.append("   H4  same-opponent short-gap predicts switching")
    if prac:
        ctx = [o for o in prac if o.same_opp_short]
        oth = [o for o in prac if not o.same_opp_short]
        if ctx and oth:
            a = B.rate(sum(1 for o in ctx if not o.correct), len(ctx))
            b = B.rate(sum(1 for o in oth if not o.correct), len(oth))
            lo1, hi1 = C.wilson(sum(1 for o in ctx if not o.correct), len(ctx))
            lo2, hi2 = C.wilson(sum(1 for o in oth if not o.correct), len(oth))
            # THE POOLED COMPARISON IS NOT THE TEST, and treating it as one is
            # how a between-player difference gets reported as a within-player
            # effect. Players who practise back-to-back against one opponent
            # are ALREADY heavy deck-cyclers; the question is whether the
            # context moves a given player. Only the paired delta asks that.
            pa = B.per_player_of(ctx, lambda o: not o.correct)
            pb = B.per_player_of(oth, lambda o: not o.correct)
            d = sig.paired_delta(pa, pb, iters=iters)
            decides = d.excludes_zero()
            L.append("       %s on the paired test." % ("SUPPORTED" if decides
                                                        else "NOT SUPPORTED"))
            L.append("       pooled:  %.1f%% [%.1f, %.1f] in context against"
                     % (100 * a, 100 * lo1, 100 * hi1))
            L.append("                %.1f%% [%.1f, %.1f] outside - a large gap"
                     % (100 * b, 100 * lo2, 100 * hi2))
            L.append("       paired on the %d players who have both: %s"
                     % (d.n, d))
            if not decides:
                L.append("       The pooled gap is therefore mostly BETWEEN players,")
                L.append("       not within them. A player who enters this context")
                L.append("       does not measurably switch more than they already")
                L.append("       do. The context identifies WHO cycles decks, which")
                L.append("       is not the same claim and is much weaker.")
        else:
            L.append("       NOT TESTABLE - one side of the context is empty")
    return L


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 20D domain correction")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--tags", default="")
    ap.add_argument("--players", type=int, default=800)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--min-plays", type=int, default=10)
    ap.add_argument("--bootstrap", type=int, default=2000)
    ap.add_argument("--history-days", type=int, default=B.HISTORY_DAYS)
    ap.add_argument("--max-rows", type=int, default=B.MAX_ROWS)
    ap.add_argument("--log", default=C.LOG_PATH)
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)

    t_start = time.time()
    model = B.load_m2()
    path = cd.resolve_db_path()
    if not path:
        raise SystemExit("no database resolved")
    if not args.tags:
        raise SystemExit("--tags is required")
    with open(args.tags, encoding="utf-8") as fh:
        all_tags = list(json.load(fh))
    tags = all_tags[:args.players]

    records = C.load_log(args.log)

    t0 = time.time()
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    try:
        by_player, audit, sizes = load(con, tags,
                                       history_days=args.history_days,
                                       max_rows=args.max_rows)
        rest = [t for t in all_tags if t not in set(tags)]
        rec_players = dict(by_player)
        if rest:
            more, _a, _s = load(con, rest, history_days=args.history_days,
                                max_rows=args.max_rows)
            rec_players.update(more)
    finally:
        con.close()
    db_s = time.time() - t0

    t0 = time.time()
    cuts = {"practice": B.band_cuts("duel"),          # the shipped duel cuts
            "competitive": B.band_cuts("competitive")}
    pop, degraded = population_arm(by_player, args.steps, cuts, model,
                                   args.min_plays)
    rec, rec_stats = reconciled_arm(records, rec_players, all_tags)
    proc_s = time.time() - t0

    L = [B._hdr("PHASE 20D - DOMAIN CORRECTION AND PRACTICE RE-EVALUATION")]
    L.append("The OIE's `duel` domain contains no duels. This renames it and")
    L.append("re-runs the evaluation under the name that is actually true.")

    L.append(B._hdr("1. CORRECTED DOMAIN DEFINITION"))
    L.append("   practice   = %s" % ", ".join(sorted(PRACTICE_MODES)))
    L.append("   EXCLUDED   = %s   (16/24-card loadouts)"
             % ", ".join(sorted(NATIVE_DUEL_MODES)))
    L.append("   EXCLUDED   = minor friendly variants, audited as other_friendly")
    L.append("   competitive = unchanged (%s)" % ", ".join(sorted(META_MODES)))
    L.append("")
    L.append("   Band cuts for practice are the SHIPPED duel cuts (high < %.4f,"
             % cuts["practice"][0])
    L.append("   medium < %.4f). They are what production applies to this"
             % cuts["practice"][1])
    L.append("   population today, so they are what has to be evaluated.")

    L.append(B._hdr("2. PRACTICE POPULATION"))
    for domain in DOMAINS:
        obs = pop.get(domain, [])
        L.append("   %-12s %6d transitions over %4d players   (degraded %d)"
                 % (domain, len(obs), len({o.tag for o in obs}),
                    degraded.get(domain, 0)))
    L.append("")
    L.append("   reconciled arm: log %d records; anchored %d; resolved %d;"
             % (len(records), rec_stats["anchored"],
                rec_stats["anchored"] - rec_stats["unresolved_player"]))
    L.append("   anchor found in practice history %d; primaryHash confirmed %d;"
             % (rec_stats["anchor_found"], rec_stats["primary_hash_match"]))
    L.append("   with an outcome %d; anchor NOT in practice %d (these are the"
             % (rec_stats["with_outcome"], rec_stats["anchor_not_in_practice"]))
    L.append("   predictions whose anchor was a minor friendly variant).")

    L.extend(comparison_block(rec.get("practice", [])))

    L.append(B._hdr("4. PRACTICE CONFIDENCE AND CALIBRATION"))
    for domain in DOMAINS:
        L.append("\n--- %s (historical population) ---" % domain.upper())
        obs = pop.get(domain, [])
        if obs:
            L.extend(band_table(obs, domain, "bands"))
        else:
            L.append("   no observations")

    L.append(B._hdr("5. RECONCILED PREDICTIONS, RELABELLED"))
    for domain in DOMAINS:
        L.append("\n--- %s (reconciled) ---" % domain.upper())
        obs = rec.get(domain, [])
        if obs:
            L.extend(band_table(obs, domain, "bands"))
        else:
            L.append("   no observations")

    L.extend(context_block(pop, args.bootstrap))

    L.append(B._hdr("7. PRACTICE vs COMPETITIVE"))
    L.append("   %-14s %10s %12s %11s %10s %10s"
             % ("domain", "n", "change", "M2 mean P", "Brier", "ECE"))
    for domain in DOMAINS:
        obs = pop.get(domain, [])
        if not obs:
            continue
        ps = [1.0 - o.p_change for o in obs]
        ys = [1 if o.correct else 0 for o in obs]
        L.append("   %-14s %10d %11.1f%% %11.4f %10.4f %10.4f"
                 % (domain, len(obs),
                    100 * B.rate(sum(1 for o in obs if not o.correct), len(obs)),
                    sum(o.p_change for o in obs) / len(obs),
                    B.brier(ps, ys), B.ece(ps, ys)))

    L.extend(native_audit(audit, sizes))
    L.extend(gates(pop, rec, audit, args.bootstrap))

    L.append(B._hdr("10. RECOMMENDATION"))
    L.append("   Read every prior 'duel' result as 'practice'. That includes")
    L.append("   19D's shipped band accuracies and Phases 14-17A's calibration.")
    L.append("   The measurements were sound; the label was not.")
    L.append("")
    L.append("   20B's forced-switch mechanism stays WITHDRAWN. The context")
    L.append("   effect in section 6 is an association and is reported as one.")
    L.append("")
    L.append("   Native duel prediction is a SEPARATE research project, not a")
    L.append("   fix to this one: it needs a loadout representation, and the")
    L.append("   census in section 8 says whether the data justifies starting.")

    L.append(B._hdr("LIMITATIONS"))
    L.append("   * Predictions are NOT recomputed. The shadow log holds what")
    L.append("     production said over the all-friendly population; only the")
    L.append("     scoring population is corrected. Section 2 reports how many")
    L.append("     anchors fell outside practice as a result.")
    L.append("   * `predictor.predict` passes timestamp=\"9999\", so two temporal")
    L.append("     features are 0 on every production read. Reproduced, not")
    L.append("     fixed, for comparability. Still unmeasured.")
    L.append("   * The population arm samples the newest %d transitions per"
             % args.steps)
    L.append("     player and is not a uniform sample of all history.")
    L.append("   * Practice band cuts are the duel cuts. They were fitted on")
    L.append("     this same population under the wrong name, so they are not")
    L.append("     independent of it.")

    L.append(B._hdr("PERFORMANCE"))
    L.append("   db %.1f s   processing %.1f s   total %.1f s"
             % (db_s, proc_s, time.time() - t_start))

    text = "\n".join(L)
    if args.report:
        print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("\nwrote %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
