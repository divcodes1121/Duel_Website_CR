"""Phase 18 - can a genuinely novel next deck be GENERATED from the player's
own history, or is it underdetermined?

    python -m ml.evaluation.phase18 --report --tags tags.json --players 797

WHY THIS EXISTS. Phase 17B closed historical retrieval: when a player switches
they usually switch to a deck they have never played, and a perfect historical
ranker would reach ~5%/~2% of production steps. The one remaining possibility is
that novel decks are BUILT from structure the player already shows. This phase
measures that ceiling before anything is ranked or trained.

MEASUREMENT ONLY. No model, no training, no production import, no writes.

THE CENTRAL TRICK: MEMBERSHIP, NOT ENUMERATION. The question "is the truth in
this generator's output?" does not require materialising the output. For every
generator below there is an exact predicate deciding whether it WOULD have
produced the truth deck, so candidate-set recall is computed in microseconds and
the C(70,8) space is never touched. Candidate COUNTS are then computed
analytically, which is what answers the practicality gate - a generator that
covers the truth by emitting ten million decks has not solved anything.
"""
from __future__ import annotations

import argparse
import collections
import itertools
import os
import pickle
import sqlite3
import sys
import time

from . import metrics as M
from . import significance as sig
from .phase17b import DOMAINS, classify_domain, deck_key, load_players

FRAGMENT_SIZES = (6, 5, 4)
VOCAB_BUCKETS = ((2, 3), (4, 6), (7, 10), (11, 25), (26, 10 ** 9))
SHAPE_BUCKETS = (("0-2 shared", 0, 2), ("3-4 shared", 3, 4),
                 ("5-6 shared", 5, 6), ("7 shared", 7, 7))


class PlayerState:
    """Everything the player has demonstrated STRICTLY BEFORE the current step.

    Folded forward as the walk proceeds; a step is always scored before its own
    play is absorbed, which is the single invariant that keeps this leak-free.
    """

    __slots__ = ("cards", "pairs", "triples", "fragments", "decks", "card_counts")

    def __init__(self):
        self.cards = set()
        self.pairs = set()
        self.triples = set()
        self.fragments = {k: set() for k in FRAGMENT_SIZES}
        self.decks = set()
        self.card_counts = collections.Counter()

    def absorb(self, deck):
        for c in deck:
            self.cards.add(c)
            self.card_counts[c] += 1
        if deck in self.decks:
            return                      # subsets already recorded
        self.decks.add(deck)
        self.pairs.update(itertools.combinations(deck, 2))
        self.triples.update(itertools.combinations(deck, 3))
        for k in FRAGMENT_SIZES:
            self.fragments[k].update(itertools.combinations(deck, k))


# --------------------------------------------------------------------------
# generators, expressed as EXACT membership predicates
# --------------------------------------------------------------------------

def c0_covered(truth, prev, state, max_subs):
    """C0 - substitute up to `max_subs` cards of the current deck.

    Produced iff the truth differs from the current deck by at most `max_subs`
    cards AND every incoming card is one the player has already fielded.
    """
    incoming = set(truth) - set(prev)
    return len(incoming) <= max_subs and incoming <= state.cards


def c0_size(prev, state, max_subs):
    """How many decks C0 would emit. Analytic - nothing is enumerated."""
    pool = len(state.cards - set(prev))
    total = 0
    for k in range(1, max_subs + 1):
        total += _choose(8, k) * _choose(pool, k)
    return total


def _choose(n, k):
    if k < 0 or k > n:
        return 0
    r = 1
    for i in range(k):
        r = r * (n - i) // (i + 1)
    return r


def c1_covered(truth, state):
    """C1 - every card PAIR in the truth has been fielded together before."""
    return all(p in state.pairs for p in itertools.combinations(truth, 2))


def c2_covered(truth, state):
    """C2 - every card TRIPLE in the truth has been fielded together before."""
    return all(t in state.triples for t in itertools.combinations(truth, 3))


def c3_covered(truth, state):
    """C3 - some k-card fragment of the truth was previously played together,
    and the rest of the deck comes from the player's card pool."""
    for k in FRAGMENT_SIZES:
        frags = state.fragments[k]
        for combo in itertools.combinations(truth, k):
            if combo in frags and set(truth) - set(combo) <= state.cards:
                return True
    return False


def c3_size(state):
    """How many decks C3 would emit. THE decisive practicality number, because
    C3 is the generator with real recall - sizing only C0 would have graded the
    gate on the generator that does not work.

    Each stored k-fragment is completed from the remaining pool, so the count is
    sum over k of |fragments[k]| * C(pool - k, 8 - k). Distinct completions are
    over-counted across fragments; this is an UPPER bound, which is the right
    side to err on when asking whether a search is practical.
    """
    pool = len(state.cards)
    total = 0
    for k in FRAGMENT_SIZES:
        total += len(state.fragments[k]) * _choose(max(0, pool - k), 8 - k)
    return total


def c3_by_k(truth, state):
    """(covered, size) per fragment size - the OPERATING POINTS.

    Aggregate C3 is dominated by its 4-card fragments, which are both the most
    permissive and by far the most expensive. Splitting by k is what reveals
    whether any point on the curve has usable recall at a tractable size.
    """
    pool = len(state.cards)
    out = {}
    for k in FRAGMENT_SIZES:
        frags = state.fragments[k]
        hit = any(c in frags and set(truth) - set(c) <= state.cards
                  for c in itertools.combinations(truth, k))
        out[k] = (hit, len(frags) * _choose(max(0, pool - k), 8 - k))
    return out


def c3_detail(truth, state):
    """Which fragment size, if any, covers the truth. Largest first."""
    for k in FRAGMENT_SIZES:
        frags = state.fragments[k]
        for combo in itertools.combinations(truth, k):
            if combo in frags and set(truth) - set(combo) <= state.cards:
                return k
    return None


def pool_covered(truth, state):
    """H1 - the truth is fully representable from cards the player has used."""
    return set(truth) <= state.cards


def c0_one_card_rank(truth, prev, state):
    """The ONE generator small enough to order honestly.

    8 x |pool| candidates, scored by how often the player has fielded the
    incoming card. Returns the truth's 1-based rank, or None if C0-1 cannot
    produce it. No training - a frequency count is not a model.
    """
    incoming = set(truth) - set(prev)
    outgoing = set(prev) - set(truth)
    if len(incoming) != 1 or len(outgoing) != 1:
        return None
    inc = next(iter(incoming))
    if inc not in state.cards:
        return None
    pool = [c for c in state.cards if c not in set(prev)]
    scored = sorted(pool, key=lambda c: (-state.card_counts[c], c))
    # every (slot, card) pair is a candidate; slots are interchangeable for
    # ordering purposes, so rank by the incoming card alone.
    try:
        return scored.index(inc) + 1
    except ValueError:
        return None


# --------------------------------------------------------------------------
# the walk
# --------------------------------------------------------------------------

class Step:
    __slots__ = ("tag", "domain", "ts", "prev", "truth", "changed", "novel",
                 "shared", "truth_in_pool", "vocab_decks", "vocab_cards",
                 "c0_1", "c0_2", "c0_3", "c1", "c2", "c3", "c3_k",
                 "c0_size_1", "c0_size_2", "c0_size_3", "rank_c0_1",
                 "c3_size", "c3_by_k")

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def walk(tag, domain, plays):
    """Emit one Step per transition. History folds in only after scoring."""
    state = PlayerState()
    out = []
    for i, (ts, deck) in enumerate(plays):
        if i > 0:
            prev = plays[i - 1][1]
            changed = deck != prev
            novel = changed and deck not in state.decks
            shared = len(set(deck) & set(prev))
            if novel:
                out.append(Step(
                    tag=tag, domain=domain, ts=ts, prev=prev, truth=deck,
                    changed=changed, novel=True, shared=shared,
                    truth_in_pool=sum(1 for c in deck if c in state.cards),
                    vocab_decks=len(state.decks), vocab_cards=len(state.cards),
                    c0_1=c0_covered(deck, prev, state, 1),
                    c0_2=c0_covered(deck, prev, state, 2),
                    c0_3=c0_covered(deck, prev, state, 3),
                    c1=c1_covered(deck, state), c2=c2_covered(deck, state),
                    c3=c3_covered(deck, state), c3_k=c3_detail(deck, state),
                    c3_size=c3_size(state),
                    c3_by_k=c3_by_k(deck, state),
                    c0_size_1=c0_size(prev, state, 1),
                    c0_size_2=c0_size(prev, state, 2),
                    c0_size_3=c0_size(prev, state, 3),
                    rank_c0_1=c0_one_card_rank(deck, prev, state)))
            else:
                out.append(Step(
                    tag=tag, domain=domain, ts=ts, prev=prev, truth=deck,
                    changed=changed, novel=False, shared=shared,
                    truth_in_pool=None, vocab_decks=len(state.decks),
                    vocab_cards=len(state.cards), c0_1=None, c0_2=None,
                    c0_3=None, c1=None, c2=None, c3=None, c3_k=None,
                    c3_size=None, c3_by_k=None,
                    c0_size_1=None, c0_size_2=None, c0_size_3=None,
                    rank_c0_1=None))
        state.absorb(deck)
    return out


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------

def _pct(n, d):
    return 100.0 * n / d if d else 0.0


def _macro_ci(steps, pred, iters):
    per = collections.defaultdict(list)
    for s in steps:
        per[s.tag].append(1.0 if pred(s) else 0.0)
    if not per:
        return None, 0.0
    ci = sig.bootstrap_mean(dict(per), iters=iters)
    return ci, M.mean([M.mean(v) for v in per.values()])


def report(all_steps, timings, iters):
    o = ["=" * 74, "PHASE 18 - NOVEL-DECK FEASIBILITY / GENERATION CEILING",
         "=" * 74,
         "Production semantics. NOVEL = the next deck differs from the current",
         "one AND that exact deck never appeared for this player/domain before",
         "the step. All structure is folded in only AFTER a step is scored.",
         "Candidate-set recall is decided by exact membership predicates, so no",
         "generator is ever enumerated; sizes below are analytic.", ""]
    gates = {}
    for dom in DOMAINS:
        steps = all_steps.get(dom) or []
        if not steps:
            o += ["DOMAIN %s - no steps" % dom.upper(), ""]
            continue
        novel = [s for s in steps if s.novel]
        changed = [s for s in steps if s.changed]
        players = {s.tag for s in steps}
        ci, macro = _macro_ci(changed, lambda s: s.novel, iters)

        o += ["=" * 74, "DOMAIN: %s" % dom.upper(), "=" * 74,
              "Players:                %d" % len(players),
              "Prediction steps:       %d" % len(steps),
              "No-change steps:        %d  (%.1f%%)"
              % (len(steps) - len(changed), _pct(len(steps) - len(changed), len(steps))),
              "Switch steps:           %d  (%.1f%%)"
              % (len(changed), _pct(len(changed), len(steps))),
              "Historical switches:    %d" % (len(changed) - len(novel)),
              "Novel switches:         %d" % len(novel),
              "Novel rate of switches: %.1f%% pooled   %.1f%% player-macro"
              % (_pct(len(novel), len(changed)), 100 * macro)]
        if ci:
            o.append("  95%% CI (player bootstrap): [%.1f%%, %.1f%%]"
                     % (100 * ci.low, 100 * ci.high))
        o.append("")
        if not novel:
            continue

        # --- 3. card-vocabulary ceiling ---------------------------------
        dist = collections.Counter(s.truth_in_pool for s in novel)
        o.append("CARD-VOCABULARY CEILING - truth cards the player had used before")
        for k in range(9):
            o.append("   %d/8 %8d %6.1f%%" % (k, dist[k], _pct(dist[k], len(novel))))
        seen = [s.truth_in_pool for s in novel]
        ge4 = sum(1 for v in seen if v >= 4)
        ge6 = sum(1 for v in seen if v >= 6)
        full = sum(1 for v in seen if v == 8)
        o += ["   mean %.2f   median %.1f" % (M.mean(seen), M.median(seen)),
              "   >=4/8 %.1f%%   >=6/8 %.1f%%   8/8 %.1f%%"
              % (_pct(ge4, len(novel)), _pct(ge6, len(novel)), _pct(full, len(novel))),
              ""]
        gates[dom] = {"h1": full / len(novel)}

        # --- 4. current-deck distance -----------------------------------
        o.append("DISTANCE FROM THE CURRENT DECK (novel switches)")
        sh = collections.Counter(min(s.shared, 4) for s in novel)
        for k in range(5):
            label = "%d shared" % k if k < 4 else "4+ shared"
            o.append("   %-10s %8d %6.1f%%" % (label, sh[k], _pct(sh[k], len(novel))))
        o.append("")

        # --- 5/6/7/11. generators ---------------------------------------
        o.append("STRUCTURAL GENERATORS - candidate-set recall (is the truth in it?)")
        o.append("   %-26s %10s %14s" % ("generator", "recall", "median size"))
        gen = [("C0 substitute <=1 card", lambda s: s.c0_1, "c0_size_1"),
               ("C0 substitute <=2 cards", lambda s: s.c0_2, "c0_size_2"),
               ("C0 substitute <=3 cards", lambda s: s.c0_3, "c0_size_3"),
               ("C1 historical pairs", lambda s: s.c1, None),
               ("C2 historical triples", lambda s: s.c2, None),
               ("C3 historical fragments", lambda s: s.c3, "c3_size"),
               ("H1 player card pool", lambda s: s.truth_in_pool == 8, None)]
        recalls = {}
        for name, pred, size_attr in gen:
            hit = sum(1 for s in novel if pred(s))
            recalls[name] = hit / len(novel)
            if size_attr:
                sizes = [getattr(s, size_attr) for s in novel]
                o.append("   %-26s %9.1f%% %14s"
                         % (name, _pct(hit, len(novel)),
                            "{:,}".format(int(M.median(sizes)))))
            else:
                o.append("   %-26s %9.1f%% %14s"
                         % (name, _pct(hit, len(novel)), "-"))
        o.append("")
        o.append("   C3 OPERATING POINTS - recall against candidate count")
        o.append("      %-10s %9s %16s %16s"
                 % ("fragment", "recall", "median size", "recall per 1M"))
        best_eff = None
        for k in FRAGMENT_SIZES:
            hits = sum(1 for s_ in novel if s_.c3_by_k[k][0])
            med = M.median([float(s_.c3_by_k[k][1]) for s_ in novel])
            eff = (hits / len(novel)) / (med / 1e6) if med else 0.0
            if best_eff is None or med < best_eff[1]:
                best_eff = (hits / len(novel), med)
            o.append("      %-10d %8.1f%% %16s %16.4f"
                     % (k, _pct(hits, len(novel)), "{:,}".format(int(med)), eff))
        o.append("      The cheapest USEFUL point still emits %s candidates"
                 % "{:,}".format(int(best_eff[1])))
        o.append("      for %.1f%% recall." % (100 * best_eff[0]))
        gates.setdefault(dom, {})["cheapest"] = best_eff
        o.append("")
        o.append("   C3 fragment size that covered the truth:")
        fk = collections.Counter(s.c3_k for s in novel if s.c3_k)
        for k in FRAGMENT_SIZES:
            o.append("      %d-card fragment %7d %6.1f%%"
                     % (k, fk[k], _pct(fk[k], len(novel))))
        o.append("")

        # --- heuristic ordering, only where it is honest -----------------
        ranked = [s.rank_c0_1 for s in novel if s.rank_c0_1]
        o.append("HEURISTIC ORDERING - only C0-1 is small enough to order honestly")
        if ranked:
            o.append("   applicable to %d of %d novel switches (%.1f%%)"
                     % (len(ranked), len(novel), _pct(len(ranked), len(novel))))
            for k in (1, 3, 10, 50, 100):
                o.append("      Recall@%-4d %6.1f%% of novel switches"
                         % (k, _pct(sum(1 for r in ranked if r <= k), len(novel))))
            o.append("      MRR (over applicable) %.3f"
                     % M.mean([1.0 / r for r in ranked]))
        else:
            o.append("   no applicable steps")
        o.append("   Larger generators are NOT ordered: C0-2 alone has a median")
        o.append("   of %s candidates, so any Recall@100 over it would be"
                 % "{:,}".format(int(M.median([s.c0_size_2 for s in novel]))))
        o.append("   a statement about the ranker, not the generator.")
        o.append("")

        # --- 8. switch shape --------------------------------------------
        o.append("BY SWITCH SHAPE (a 7-shared novel deck is a different problem)")
        o.append("   %-12s %8s %9s %9s %9s %9s"
                 % ("shape", "n", "8/8 pool", "C0<=2", "C3 frag", "C1 pairs"))
        for label, lo, hi in SHAPE_BUCKETS:
            sel = [s for s in novel if lo <= s.shared <= hi]
            if not sel:
                continue
            o.append("   %-12s %8d %8.1f%% %8.1f%% %8.1f%% %8.1f%%"
                     % (label, len(sel),
                        _pct(sum(1 for s in sel if s.truth_in_pool == 8), len(sel)),
                        _pct(sum(1 for s in sel if s.c0_2), len(sel)),
                        _pct(sum(1 for s in sel if s.c3), len(sel)),
                        _pct(sum(1 for s in sel if s.c1), len(sel))))
        o.append("")

        # --- 9. vocabulary stratification --------------------------------
        o.append("BY PLAYER DECK VOCABULARY")
        o.append("   %-10s %8s %10s %11s %10s %10s"
                 % ("decks", "novel n", "avg cards", "truth cov", "C3 frag", "8/8 pool"))
        for lo, hi in VOCAB_BUCKETS:
            sel = [s for s in novel if lo <= s.vocab_decks <= hi]
            if not sel:
                continue
            o.append("   %-10s %8d %10.1f %10.2f/8 %9.1f%% %9.1f%%"
                     % ("%d-%s" % (lo, "+" if hi > 1000 else str(hi)), len(sel),
                        M.mean([float(s.vocab_cards) for s in sel]),
                        M.mean([float(s.truth_in_pool) for s in sel]),
                        _pct(sum(1 for s in sel if s.c3), len(sel)),
                        _pct(sum(1 for s in sel if s.truth_in_pool == 8), len(sel))))
        o.append("")

        # --- 10. retention effect ---------------------------------------
        o.append("RETENTION EFFECT - does more history raise the ceiling?")
        ordered = sorted(novel, key=lambda s: s.ts)
        third = max(1, len(ordered) // 3)
        o.append("   %-10s %8s %10s %11s %10s"
                 % ("window", "n", "avg cards", "truth cov", "8/8 pool"))
        for label, sel in (("early", ordered[:third]),
                           ("middle", ordered[third:2 * third]),
                           ("recent", ordered[2 * third:])):
            if not sel:
                continue
            o.append("   %-10s %8d %10.1f %10.2f/8 %9.1f%%"
                     % (label, len(sel),
                        M.mean([float(s.vocab_cards) for s in sel]),
                        M.mean([float(s.truth_in_pool) for s in sel]),
                        _pct(sum(1 for s in sel if s.truth_in_pool == 8), len(sel))))
        gates[dom]["recalls"] = recalls
        gates[dom]["median_c0_2"] = M.median([s.c0_size_2 for s in novel])
        gates[dom]["median_c3"] = M.median([s.c3_size for s in novel])
        gates[dom]["cov_early"] = M.mean([float(s.truth_in_pool)
                                          for s in ordered[:third]]) if third else 0
        gates[dom]["cov_recent"] = M.mean([float(s.truth_in_pool)
                                           for s in ordered[2 * third:]]) or 0
        o.append("")

    o += ["=" * 74, "PERFORMANCE", "=" * 74,
          "   db read      %.1fs" % timings["db"],
          "   processing   %.1fs" % timings["compute"],
          "   total        %.1fs" % timings["total"], ""]

    o += ["=" * 74, "PHASE 18 GATE", "=" * 74]
    final = {}
    for dom in DOMAINS:
        g = gates.get(dom)
        if not g:
            continue
        h1v = g["h1"]
        h1 = "PASS" if h1v >= 0.80 else ("PARTIAL" if h1v >= 0.50 else "FAIL")
        best = max(g["recalls"].values())
        h2 = ("strong" if best >= 0.70 else
              ("meaningful" if best >= 0.50 else "weak"))
        # Judged on C3 - the generator with usable recall. A cheap generator
        # that never contains the answer is not a practical search.
        h3 = "FAIL" if g["median_c3"] > 100000 else "PASS"
        d = g["cov_recent"] - g["cov_early"]
        h4 = ("A increases coverage" if d >= 0.25 else
              ("B larger search, no coverage gain" if d <= 0.05 else "C inconclusive"))
        o += ["", dom.upper(),
              "   H1 full card representability  %.1f%%  -> %s" % (100 * h1v, h1),
              "   H2 best generator recall       %.1f%%  -> %s" % (100 * best, h2),
              "   H3 search practicality         median C3 = %s "
              "(C0<=2 = %s) -> %s"
              % ("{:,}".format(int(g["median_c3"])),
                 "{:,}".format(int(g["median_c0_2"])), h3),
              "   H4 more history                %+.2f cards -> %s" % (d, h4)]
        final[dom] = (h1v, best, h3)
    o += ["", "=" * 74, "FINAL RECOMMENDATION", "=" * 74]
    if final:
        worst_h1 = min(v[0] for v in final.values())
        best_rec = max(v[1] for v in final.values())
        impractical = any(v[2] == "FAIL" for v in final.values())
        # H3 GATES. An earlier version of this rule returned "partial signal"
        # without consulting practicality, and would have recommended a hybrid
        # over a search space of 5x10^8. Coverage inside an untraversable space
        # is not signal.
        if impractical:
            rec = ("3. Novel-deck generation ceiling is too low; "
                   "stop exact-deck research. "
                   "(Coverage is partial, but NO generator reaches usable "
                   "recall at a tractable candidate count.)")
        elif worst_h1 >= 0.80 and best_rec >= 0.70:
            rec = ("1. Novel-deck generation has enough structural signal; "
                   "proceed to ranking feasibility.")
        elif best_rec >= 0.50:
            rec = ("2. Novel-deck generation has partial signal; "
                   "investigate a constrained hybrid.")
        elif worst_h1 < 0.50:
            rec = ("3. Novel-deck generation ceiling is too low; "
                   "stop exact-deck research.")
        else:
            rec = "4. Evidence is insufficient; collect more data before deciding."
        o.append(rec)
    o += ["", "STOP. The measurement is the deliverable."]
    return "\n".join(o)


def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 18 feasibility")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--tags", default="")
    ap.add_argument("--players", type=int, default=797)
    ap.add_argument("--min-plays", type=int, default=10)
    ap.add_argument("--bootstrap", type=int, default=1000)
    ap.add_argument("--cache", default="ml/results/phase18-plays.pkl")
    args = ap.parse_args(argv)
    if not args.report:
        ap.print_help()
        return 0

    t0 = time.time()
    tdb = 0.0
    if os.path.exists(args.cache):
        with open(args.cache, "rb") as fh:
            by_player = pickle.load(fh)
        tdb = time.time() - t0
    else:
        if not args.tags:
            print("--tags required on a cold run", file=sys.stderr)
            return 2
        import json
        import clash_data as cd
        path = cd.resolve_db_path()
        if not path:
            print("no database", file=sys.stderr)
            return 2
        tags = json.load(open(args.tags))[:args.players]
        con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
        s = time.time()
        by_player = dict(load_players(con, tags))
        tdb = time.time() - s
        os.makedirs(os.path.dirname(args.cache), exist_ok=True)
        with open(args.cache, "wb") as fh:
            pickle.dump(by_player, fh, protocol=4)

    tc = time.time()
    all_steps = collections.defaultdict(list)
    for (tag, dom), plays in by_player.items():
        if len(plays) < args.min_plays:
            continue
        all_steps[dom].extend(walk(tag, dom, plays))
    print(report(all_steps,
                 {"db": tdb, "compute": time.time() - tc,
                  "total": time.time() - t0}, args.bootstrap))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
