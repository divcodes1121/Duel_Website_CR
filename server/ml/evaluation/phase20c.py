"""Phase 20C - are duel confidence bands valid when the deck is legally reusable?

    python -m ml.evaluation.phase20c --report --tags cohorts/tags_20b.json

WHY THIS EXISTS. Phase 20B measured that duel transitions split into two
populations that behave nothing alike:

    previous deck LEGAL     change 16.5%   ECE 0.1252
    previous deck ILLEGAL   change 78.4%   ECE 0.6790

and that the duel `high` band is only 2.8% contaminated by the illegal case,
measuring 92.4% against its 92.1% claim. 20C tests the consequence directly: if
the bands are read on the legal population alone, are they what they say?

TWO ARMS, BECAUSE ONE OF THEM CANNOT CARRY THE ANSWER ALONE.

  * ARM 1, POPULATION - every scoreable historical transition, ~11k duel steps.
    Only here is there enough support to say anything about a band.
  * ARM 2, RECONCILED - the actual shadow-log predictions that produced 19D's
    numbers. Small (153 duel), but it is the real production population and it
    is the only thing that can confirm or refute 20B's inference that the 19D
    duel sample is ~86% forced.

THE LEGALITY DEFINITION IS TIGHTER THAN 20B's, AND THE CHANGE MATTERS.

20B asked whether the outcome battle turned out to continue the duel - it read
the outcome's timestamp and opponent (never its deck). That is EX-POST, and no
production policy could ever compute it, because at prediction time the next
battle has not happened.

20C asks the question production would have to ask: reconstruct the card-free
run ENDING AT THE ANCHOR, and read whether that duel is still undecided.

    undecided  <=>  max(player_wins, opponent_wins) < 2  and  games < 5

If it is undecided, the duel is mid-flight and every card already spent in it
is unavailable to the next game - knowable without seeing that game. `decided`
uses RESULTS, which are independent of cards, so the circularity 20B avoided
stays avoided. `ex_ante_agreement()` reports how often this prediction-time
signal matches what actually happened, which is the honest way to state its
value.

NOTHING HERE TRAINS, RECALIBRATES, OR TOUCHES PRODUCTION. `test_ml_20c.py`
asserts no `ml.production` import and no artifact write. The `timestamp="9999"`
quirk 20B found in `predictor.predict` is again REPRODUCED, not fixed, so 20B,
20C and the shipped engine remain comparable; it is listed as a limitation.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import sqlite3
import sys
import time

import clash_data as cd
from duel_combos import MAX_DUEL_GAMES

from .. import config
from . import phase20b as B
from . import significance as sig

DOMAINS = ("duel", "competitive")

#: Phase 17A's published claims, quoted for comparison. Never used as a target.
REFERENCE = {
    "duel": {"high": 0.921, "medium": 0.758, "low": 0.473},
    "competitive": {"high": 0.905, "medium": 0.733, "low": None},
}

#: A band needs this many independent players before its accuracy is quoted as
#: an estimate. 19D's duel `high` rested on 8 and was read as a verdict; it is
#: not one.
MIN_PLAYERS = 30

LEGAL, FORCED = "legal", "forced"


# --------------------------------------------------------------------------
# Ex-ante legality: what production could know at prediction time
# --------------------------------------------------------------------------

def run_ending_at(plays, i: int) -> list:
    """Indices of the card-free linked chain ending at `i` (inclusive).

    Uses `phase20b.linked` - same opponent, inside the gap, NO card rule.
    """
    idx = [i]
    j = i
    while j - 1 >= 0 and B.linked(plays[j - 1], plays[j]):
        j -= 1
        idx.append(j)
    return list(reversed(idx))


def ex_ante_state(plays, i: int, domain: str) -> dict:
    """Legality of `plays[i]`'s deck for the player's NEXT battle.

    Computed from `plays[:i+1]` only. The next battle is not consulted, which
    is what separates this from 20B and what makes it a policy signal rather
    than a post-hoc label.
    """
    if domain != "duel":
        # No card-reuse rule exists outside a duel. Stated rather than
        # discovered, so the competitive arm is a control on the MACHINERY
        # (see `pseudo_run_state`), not on this rule.
        return {"class": LEGAL, "reason": "no card-reuse rule in this domain",
                "used": set(), "run_len": 0, "score": (0, 0)}

    run = run_ending_at(plays, i)
    pw = sum(1 for k in run if plays[k].result == "win")
    ow = sum(1 for k in run if plays[k].result == "loss")
    undecided = max(pw, ow) < 2 and len(run) < MAX_DUEL_GAMES

    used: set = set()
    for k in run:
        used |= set(plays[k].cards)

    if undecided:
        return {"class": FORCED,
                "reason": "duel in progress, %d-%d after %d game(s)" % (pw, ow, len(run)),
                "used": used, "run_len": len(run), "score": (pw, ow)}
    return {"class": LEGAL,
            "reason": "duel decided, %d-%d after %d game(s)" % (pw, ow, len(run)),
            "used": set(), "run_len": len(run), "score": (pw, ow)}


def pseudo_run_state(plays, i: int) -> dict:
    """The SAME machinery with the duel rule removed, for the control.

    Sessions (consecutive battles inside the gap, any opponent) exist in both
    domains. If 'mid-session' separated change rates in competitive too, the
    20B effect would be a generic session artefact rather than a duel rule.
    """
    idx = [i]
    j = i
    while j - 1 >= 0 and B.same_session(plays[j - 1], plays[j]):
        j -= 1
        idx.append(j)
    run = list(reversed(idx))
    pw = sum(1 for k in run if plays[k].result == "win")
    ow = sum(1 for k in run if plays[k].result == "loss")
    return {"in_progress": max(pw, ow) < 2 and len(run) < MAX_DUEL_GAMES,
            "run_len": len(run)}


# --------------------------------------------------------------------------
# ARM 1 - the historical population
# --------------------------------------------------------------------------

class Obs:
    """One scored prediction. Deliberately plain - it is written once and read
    many times by the tables below."""
    __slots__ = ("tag", "domain", "ts", "p_change", "band", "correct",
                 "klass", "reason", "ex_post_forced", "pseudo_in_progress",
                 "run_len")

    def __init__(self, tag, domain, ts, p_change, band, correct, klass,
                 reason, ex_post_forced, pseudo_in_progress, run_len):
        self.tag, self.domain, self.ts = tag, domain, ts
        self.p_change, self.band, self.correct = p_change, band, correct
        self.klass, self.reason = klass, reason
        self.ex_post_forced = ex_post_forced
        self.pseudo_in_progress = pseudo_in_progress
        self.run_len = run_len


def population_arm(by_player, max_steps, cuts, model, min_plays):
    """Every scoreable transition, classified EX ANTE."""
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

            state = ex_ante_state(plays, t - 1, domain)
            pseudo = pseudo_run_state(plays, t - 1)
            p = B.p_change_for(shell, domain, tag, model)
            # EX POST, kept only to score the ex-ante signal against reality.
            ex_post = bool(set(prev.cards) & B.used_before(plays, t))

            out[domain].append(Obs(
                tag=tag, domain=domain, ts=truth.ts, p_change=p,
                band=B.band_for(p, cuts[domain]),
                correct=truth.card_set == prev.card_set,
                klass=state["class"], reason=state["reason"],
                ex_post_forced=ex_post,
                pseudo_in_progress=pseudo["in_progress"],
                run_len=state["run_len"]))
    return out, degraded


# --------------------------------------------------------------------------
# ARM 2 - the reconciled shadow predictions
# --------------------------------------------------------------------------

#: DUPLICATED FROM `production.shadow`, deliberately, because this module may
#: not import production. The duplication is SELF-VALIDATING: if either formula
#: were wrong, zero log records would resolve to a tag and zero anchors would
#: match `primaryHash`. Both rates are printed, and the report refuses to draw
#: a conclusion when they are not ~100%.
SALT = os.getenv("CLASH_OIE_SALT", "oie-shadow-v1")
LOG_PATH = os.getenv("CLASH_OIE_LOG", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "results", "shadow-log.jsonl"))


def player_hash(tag: str) -> str:
    return hashlib.sha256((SALT + "|" + (tag or "")).encode()).hexdigest()[:16]


def deck_hash(cards) -> str:
    return hashlib.sha256(",".join(sorted(cards or [])).encode()).hexdigest()[:16]


def load_log(path: str = LOG_PATH) -> list:
    try:
        with open(path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]
    except Exception:
        return []


def reconciled_arm(records, by_player, tags):
    """Classify the real shadow predictions and score them against outcomes.

    An outcome is the player's FIRST STRICTLY LATER play in the same domain,
    which is 19D's definition and is not relaxed here.
    """
    by_hash = {player_hash(t): t for t in tags}
    out = collections.defaultdict(list)
    stats = collections.Counter()

    for rec in records:
        anchor_ts = rec.get("anchorTs") or ""
        domain = rec.get("domain") or ""
        if not anchor_ts or domain not in DOMAINS:
            continue
        stats["anchored"] += 1
        tag = by_hash.get(rec.get("player") or "")
        if not tag:
            stats["unresolved_player"] += 1
            continue
        stats["resolved_player"] += 1

        plays = by_player.get((tag, domain)) or []
        if not plays:
            stats["no_history"] += 1
            continue

        # The anchor is the play AT anchor_ts. Located by timestamp, then
        # CONFIRMED against the deck hash the log recorded independently.
        anchor_i = None
        for i, p in enumerate(plays):
            if p.ts == anchor_ts:
                anchor_i = i
                break
        if anchor_i is None:
            stats["anchor_not_found"] += 1
            continue
        stats["anchor_found"] += 1
        if rec.get("primaryHash") and deck_hash(plays[anchor_i].cards) == rec["primaryHash"]:
            stats["primary_hash_match"] += 1

        later = [p for p in plays[anchor_i + 1:] if p.ts > anchor_ts]
        if not later:
            stats["no_outcome"] += 1
            continue
        stats["with_outcome"] += 1
        truth = later[0]

        state = ex_ante_state(plays, anchor_i, domain)
        out[domain].append(Obs(
            tag=tag, domain=domain, ts=truth.ts,
            p_change=float(rec.get("pChange") or 0.0),
            band=rec.get("confidence") or "",
            correct=truth.card_set == plays[anchor_i].card_set,
            klass=state["class"], reason=state["reason"],
            ex_post_forced=bool(set(plays[anchor_i].cards)
                                & B.used_before(plays, anchor_i + 1)),
            pseudo_in_progress=pseudo_run_state(plays, anchor_i)["in_progress"],
            run_len=state["run_len"]))
    return out, stats


# --------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------

def wilson(hits: int, n: int) -> tuple:
    """95% interval for a proportion. Small-n honest, unlike a normal CI."""
    if not n:
        return (0.0, 0.0)
    z = 1.959963985
    p = hits / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(max(0.0, p * (1 - p) / n + z * z / (4 * n * n))) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def band_table(obs, domain, iters, title) -> list:
    L = ["   " + title]
    L.append("   %-8s %7s %8s %7s %9s %8s %-18s %8s %7s"
             % ("band", "n", "players", "share", "pooled", "macro",
                "95% CI (pooled)", "17A ref", "diff"))
    total = len(obs)
    for name in ("high", "medium", "low"):
        sel = [o for o in obs if o.band == name]
        ref = REFERENCE.get(domain, {}).get(name)
        if not sel:
            L.append("   %-8s %7d %8s %7s %9s %8s %-18s %8s %7s"
                     % (name, 0, "-", "-", "-", "-", "-",
                        ("%.1f%%" % (100 * ref)) if ref else "-", "-"))
            continue
        players = len({o.tag for o in sel})
        hits = sum(1 for o in sel if o.correct)
        pooled = hits / len(sel)
        mac = B.macro(B.per_player_of(sel, lambda o: o.correct))
        lo, hi = wilson(hits, len(sel))
        mark = "" if players >= MIN_PLAYERS else "  (under %d players)" % MIN_PLAYERS
        L.append("   %-8s %7d %8d %6.1f%% %8.1f%% %7.1f%% [%5.1f%%, %5.1f%%] %7s %7s%s"
                 % (name, len(sel), players, 100 * B.rate(len(sel), total),
                    100 * pooled, 100 * mac, 100 * lo, 100 * hi,
                    ("%.1f%%" % (100 * ref)) if ref else "n/a",
                    ("%+.1f" % (100 * (pooled - ref))) if ref else "n/a", mark))

    ordered = []
    for name in ("high", "medium", "low"):
        sel = [o for o in obs if o.band == name]
        ordered.append(B.macro(B.per_player_of(sel, lambda o: o.correct)) if sel else None)
    present = [(n, v) for n, v in zip(("high", "medium", "low"), ordered) if v is not None]
    if len(present) >= 2:
        holds = all(present[i][1] >= present[i + 1][1] for i in range(len(present) - 1))
        L.append("   ordering (player-macro): %s   %s"
                 % (" > ".join("%s %.1f%%" % (n, 100 * v) for n, v in present),
                    "HOLDS" if holds else "DOES NOT HOLD"))

    ps = [1.0 - o.p_change for o in obs]
    ys = [1 if o.correct else 0 for o in obs]
    L.append("   calibration: Brier %.4f   ECE %.4f   n=%d   accuracy %.1f%%"
             % (B.brier(ps, ys), B.ece(ps, ys), len(obs),
                100 * B.rate(sum(ys), len(obs)) if obs else 0.0))
    return L


def reliability_block(obs, label) -> list:
    ps = [1.0 - o.p_change for o in obs]
    ys = [1 if o.correct else 0 for o in obs]
    L = ["   reliability, %s" % label,
         "   %-12s %8s %10s %10s" % ("bin", "n", "claimed", "actual")]
    for lo, hi, cnt, conf, acc in B.reliability(ps, ys):
        L.append("   %-12s %8d %9.1f%% %9.1f%%"
                 % ("%.1f-%.1f" % (lo, hi), cnt, 100 * conf, 100 * acc))
    return L


def arm_report(name, by_domain, degraded, iters, extra=None) -> list:
    L = [B._hdr(name)]
    if extra:
        L.extend(extra)
    for domain in DOMAINS:
        obs = by_domain.get(domain, [])
        L.append("\n--- %s ---" % domain.upper())
        if not obs:
            L.append("   no observations")
            continue
        legal = [o for o in obs if o.klass == LEGAL]
        forced = [o for o in obs if o.klass == FORCED]
        L.append("   observations %d over %d players   (degraded %d)"
                 % (len(obs), len({o.tag for o in obs}), degraded.get(domain, 0)))
        L.append("   EX-ANTE legal %d (%.1f%%)   forced %d (%.1f%%)"
                 % (len(legal), 100 * B.rate(len(legal), len(obs)),
                    len(forced), 100 * B.rate(len(forced), len(obs))))
        agree = sum(1 for o in obs if (o.klass == FORCED) == o.ex_post_forced)
        L.append("   ex-ante signal agrees with what happened: %.1f%%"
                 % (100 * B.rate(agree, len(obs))))
        L.append("")
        L.extend(band_table(legal, domain, iters, "LEGAL population"))
        L.append("")
        L.extend(band_table(forced, domain, iters, "FORCED population"))
        if forced:
            chg = sum(1 for o in forced if not o.correct)
            L.append("   forced: actual change %.1f%%   mean predicted P(change) %.4f"
                     % (100 * B.rate(chg, len(forced)),
                        sum(o.p_change for o in forced) / len(forced)))
            reasons = collections.Counter(o.reason.split(",")[0] for o in forced)
            for r, c in reasons.most_common(4):
                L.append("      %-40s %d" % (r, c))
        if legal:
            L.append("")
            L.extend(reliability_block(legal, "%s LEGAL" % domain))
    return L


def policy_block(by_domain, iters) -> list:
    """STEP 4 - the analytical policy, offline only. Never shipped."""
    L = [B._hdr("8. COMBINED ANALYTICAL POLICY  (offline only - not shipped)")]
    L.append("   policy: if the previous deck is ex-ante illegal, call it a")
    L.append("           FORCED CHANGE; otherwise use M2's confidence unchanged.")
    L.append("")
    L.append("   %-14s %-16s %10s %13s %9s %9s"
             % ("domain", "baseline", "accuracy", "player-macro", "Brier", "ECE"))
    for domain in DOMAINS:
        obs = by_domain.get(domain, [])
        if not obs:
            continue

        def sc(pred_change, prob_stay):
            hits, pp = [], collections.defaultdict(list)
            for o in obs:
                ok = 1.0 if (not pred_change(o)) == o.correct else 0.0
                hits.append(ok)
                pp[o.tag].append(ok)
            ps = [prob_stay(o) for o in obs]
            ys = [1 if o.correct else 0 for o in obs]
            return (sum(hits) / len(hits), B.macro(dict(pp)),
                    B.brier(ps, ys), B.ece(ps, ys), dict(pp))

        m2 = sc(lambda o: o.p_change >= 0.5, lambda o: 1.0 - o.p_change)
        pol = sc(lambda o: True if o.klass == FORCED else o.p_change >= 0.5,
                 lambda o: 0.0 if o.klass == FORCED else 1.0 - o.p_change)
        for label, r in (("M2 alone", m2), ("legality + M2", pol)):
            L.append("   %-14s %-16s %9.1f%% %12.1f%% %9.4f %9.4f"
                     % (domain, label, 100 * r[0], 100 * r[1], r[2], r[3]))
        d = sig.paired_delta(pol[4], m2[4], iters=iters)
        L.append("   %-14s paired delta (policy - M2)  %s" % ("", d))
        L.append("   %-14s %s" % ("", sig.verdict(d, "legality+M2", "M2 alone")))
    return L


def control_block(by_domain) -> list:
    """STEP 5 - is 'mid-session' a generic artefact or a duel rule?"""
    L = [B._hdr("9. COMPETITIVE CONTROL  (the machinery, with the rule removed)")]
    L.append("   Sessions exist in both domains. If being mid-session separated")
    L.append("   change rates in COMPETITIVE too, 20B's effect would be a")
    L.append("   generic session artefact rather than the duel card rule.")
    L.append("")
    L.append("   %-14s %14s %14s %14s"
             % ("domain", "mid-session n", "stay rate", "settled stay"))
    for domain in DOMAINS:
        obs = by_domain.get(domain, [])
        if not obs:
            continue
        mid = [o for o in obs if o.pseudo_in_progress]
        settled = [o for o in obs if not o.pseudo_in_progress]
        L.append("   %-14s %14d %13.1f%% %13.1f%%"
                 % (domain, len(mid),
                    100 * B.rate(sum(1 for o in mid if o.correct), len(mid)) if mid else 0.0,
                    100 * B.rate(sum(1 for o in settled if o.correct), len(settled))
                    if settled else 0.0))
    L.append("")
    L.append("   ex-ante FORCED rate by domain (the rule itself):")
    for domain in DOMAINS:
        obs = by_domain.get(domain, [])
        if not obs:
            continue
        L.append("      %-14s %.1f%%" % (domain, 100 * B.rate(
            sum(1 for o in obs if o.klass == FORCED), len(obs))))
    return L


def gates(pop, rec) -> list:
    L = [B._hdr("10. GATES")]
    duel = pop.get("duel", [])
    legal = [o for o in duel if o.klass == LEGAL]
    forced = [o for o in duel if o.klass == FORCED]

    def band_of(sel, name):
        s = [o for o in sel if o.band == name]
        if not s:
            return None
        return (len(s), len({o.tag for o in s}),
                sum(1 for o in s if o.correct) / len(s),
                B.macro(B.per_player_of(s, lambda o: o.correct)))

    hi, med, lo = (band_of(legal, b) for b in ("high", "medium", "low"))

    present = [(n, v) for n, v in zip(("high", "medium", "low"), (hi, med, lo)) if v]
    h1 = len(present) >= 2 and all(
        present[i][1][3] >= present[i + 1][1][3] for i in range(len(present) - 1))
    supported = [n for n, v in present if v[1] >= MIN_PLAYERS]
    L.append("   H1  legal duel predictions preserve High > Medium > Low")
    L.append("       %s - %s" % ("SUPPORTED" if h1 else "NOT SUPPORTED",
                                 ", ".join("%s %.1f%%" % (n, 100 * v[3]) for n, v in present)))
    L.append("       bands with >=%d players: %s" % (MIN_PLAYERS, ", ".join(supported) or "none"))

    ref = REFERENCE["duel"]["high"]
    L.append("")
    L.append("   H2  legal High is consistent with the 17A reference (%.1f%%)" % (100 * ref))
    if hi:
        lo_ci, hi_ci = wilson(int(round(hi[2] * hi[0])), hi[0])
        inside = lo_ci <= ref <= hi_ci
        L.append("       %s - %.1f%% pooled on n=%d over %d players, 95%% CI "
                 "[%.1f%%, %.1f%%]" % ("SUPPORTED" if inside else "NOT SUPPORTED",
                                       100 * hi[2], hi[0], hi[1], 100 * lo_ci, 100 * hi_ci))
        L.append("       the reference %s inside the interval."
                 % ("falls" if inside else "does NOT fall"))
    else:
        L.append("       NOT TESTABLE - no legal high-band observations")

    L.append("")
    L.append("   H3  forced predictions behave differently from legal ones")
    if legal and forced:
        ls = B.rate(sum(1 for o in legal if o.correct), len(legal))
        fs = B.rate(sum(1 for o in forced if o.correct), len(forced))
        le = B.ece([1 - o.p_change for o in legal], [1 if o.correct else 0 for o in legal])
        fe = B.ece([1 - o.p_change for o in forced], [1 if o.correct else 0 for o in forced])
        h3 = fs < ls
        L.append("       %s - stay rate legal %.1f%% vs forced %.1f%%; "
                 "ECE %.4f vs %.4f" % ("SUPPORTED" if h3 else "NOT SUPPORTED",
                                       100 * ls, 100 * fs, le, fe))
    else:
        L.append("       NOT TESTABLE")

    L.append("")
    L.append("   H4  the legality-aware policy improves on M2 without harming")
    L.append("       competitive - see section 8 for the paired intervals.")

    # ---- the 19D reconciliation ------------------------------------------
    L.append("")
    L.append("   19D RECONCILIATION (arm 2)")
    rd = rec.get("duel", [])
    if rd:
        f = B.rate(sum(1 for o in rd if o.klass == FORCED), len(rd))
        L.append("       reconciled duel predictions classified: n=%d, %.1f%% FORCED"
                 % (len(rd), 100 * f))
        L.append("       20B INFERRED ~86%% forced from the stay rate. This is the")
        L.append("       measurement that inference asked for.")
        rl = [o for o in rd if o.klass == LEGAL]
        if rl:
            L.append("       legal subset: n=%d, stay %.1f%%"
                     % (len(rl), 100 * B.rate(sum(1 for o in rl if o.correct), len(rl))))
    else:
        L.append("       no reconciled duel observations resolved")
    return L


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 20C validation")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--tags", default="")
    ap.add_argument("--players", type=int, default=800)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--min-plays", type=int, default=10)
    ap.add_argument("--bootstrap", type=int, default=2000)
    ap.add_argument("--history-days", type=int, default=B.HISTORY_DAYS)
    ap.add_argument("--max-rows", type=int, default=B.MAX_ROWS)
    ap.add_argument("--log", default=LOG_PATH)
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

    # Arm 2 needs every cohort tag to resolve hashes, not just the sampled ones.
    records = load_log(args.log)
    log_tags = sorted({t for t in all_tags})

    t0 = time.time()
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    try:
        by_player = B.load(con, tags, history_days=args.history_days,
                           max_rows=args.max_rows)
        rec_tags = [t for t in log_tags if t not in set(tags)]
        rec_players = dict(by_player)
        if rec_tags:
            rec_players.update(B.load(con, rec_tags,
                                      history_days=args.history_days,
                                      max_rows=args.max_rows))
    finally:
        con.close()
    db_s = time.time() - t0

    t0 = time.time()
    cuts = {d: B.band_cuts(d) for d in DOMAINS}
    pop, degraded = population_arm(by_player, args.steps, cuts, model,
                                   args.min_plays)
    rec, rec_stats = reconciled_arm(records, rec_players, log_tags)
    proc_s = time.time() - t0

    L = [B._hdr("PHASE 20C - DUEL LEGALITY-AWARE CONFIDENCE VALIDATION")]
    L.append("question: are the duel confidence bands valid when the previous")
    L.append("          deck is LEGALLY REUSABLE?")
    L.append("legality: EX ANTE - the run ending at the anchor, and whether that")
    L.append("          duel is still undecided. The outcome is never consulted.")

    L.extend(arm_report("ARM 1 - HISTORICAL POPULATION", pop, degraded,
                        args.bootstrap))

    integrity = ["   log records %d   anchored %d   player resolved %d"
                 % (len(records), rec_stats["anchored"], rec_stats["resolved_player"]),
                 "   anchor located %d   primaryHash confirmed %d   with outcome %d"
                 % (rec_stats["anchor_found"], rec_stats["primary_hash_match"],
                    rec_stats["with_outcome"]),
                 "   (hash formulas are duplicated from production; a wrong one",
                 "    would resolve ZERO of the above, so these counts are the",
                 "    proof that they match)"]
    L.extend(arm_report("ARM 2 - RECONCILED SHADOW PREDICTIONS", rec,
                        collections.Counter(), args.bootstrap, extra=integrity))

    L.extend(policy_block(pop, args.bootstrap))
    L.extend(control_block(pop))
    L.extend(gates(pop, rec))

    L.append(B._hdr("11. LIMITATIONS"))
    L.append("   * `predictor.predict` passes timestamp=\"9999\", which the")
    L.append("     feature parser cannot read, so log_hours_since_change and")
    L.append("     log_hours_since_last_play are 0 on every production read.")
    L.append("     REPRODUCED here, not fixed, so 20B/20C/production stay")
    L.append("     comparable. Its effect is unmeasured and needs its own run.")
    L.append("   * Ex-ante legality is a PREDICTION about the next battle, not")
    L.append("     a fact about it. Its agreement with reality is reported per")
    L.append("     arm; where it is wrong, a step is misclassified both ways.")
    L.append("   * Arm 2 is small. Bands under %d players are marked and must"
             % MIN_PLAYERS)
    L.append("     not be read as estimates - that is 19D duel `high`'s mistake.")
    L.append("   * The population arm samples the newest %d transitions per"
             % args.steps)
    L.append("     player, so it is not a uniform sample of all history.")

    L.append(B._hdr("PERFORMANCE"))
    L.append("   db %.1f s   processing %.1f s   total %.1f s"
             % (db_s, proc_s, time.time() - t_start))
    for domain in DOMAINS:
        L.append("   %-12s population %d obs / %d players   reconciled %d obs"
                 % (domain, len(pop.get(domain, [])),
                    len({o.tag for o in pop.get(domain, [])}),
                    len(rec.get(domain, []))))

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
