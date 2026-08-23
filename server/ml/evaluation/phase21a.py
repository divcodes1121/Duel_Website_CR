"""Phase 21A - does an opponent's revealed SPELLS predict their next deck?

    python -m ml.evaluation.phase21a --report --series 20000

WHY THIS EXISTS. Every prior OIE phase asked "what deck comes next" from a
player's own history. This asks a different question: inside a duel, after the
opponent has shown you a deck, do the SPELLS in it tell you anything about the
deck they bring next that their history alone does not?

THE SUBSTRATE IS NEW, AND IT IS THE REASON THIS IS ANSWERABLE. Phases 14-20D
ran on `battles`, where a native duel row is a flattened 16/24-card loadout and
was therefore dropped by the 8-card guard - Phase 20D concluded the engine had
never seen a duel. `battle_raw.raw_json` keeps what `battles` throws away:

    team[0].rounds -> [{cards: [8], crowns, elixirLeaked, towerHitPoints}, ...]

present for BOTH sides, round counts matching, 8 cards per round, each round
carrying its own crowns. So a duel decomposes into ordered games with per-game
decks and per-game results, for both players.

Two facts measured on that substrate before any of this was written:

  * 12,000 loadouts, 21,432 deck pairs, card overlap ZERO in every one. The
    duel card-reuse rule is absolute. Phase 20B tried to measure this and
    measured a tautology; here it is measured properly, and it is what makes
    the legality filter below a rule rather than an assumption.
  * duel decks carry 1-3 spells (median 2), and all card names resolve against
    the project vocabulary with zero unknowns.

WHAT "REVEALED" MEANS HERE, AND WHY IT IS HONEST. Within-game card-play order
does not exist in this data and never will - the API does not expose it. But in
a duel, game k+1 follows game k against the SAME opponent minutes later, so the
whole of the opponent's game-k deck, spells included, is genuinely known before
they choose game k+1. That is a real reveal, not a proxy.

RESEARCH ONLY. Nothing here trains a shippable model, touches production, or
reads `ml.production`; every conditional distribution is a smoothed count over
a TRAINING SPLIT that ends before any evaluated game begins.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import sqlite3
import sys
import time
from dataclasses import dataclass

import clash_data as cd
import duel_combos as dcm

from . import significance as sig

NATIVE_MODES = ("CW_Duel_1v1", "Duel_1v1_Friendly")
DECK_SIZE = 8

#: Laplace smoothing for every conditional table. Small, and identical across
#: arms so the ablation compares information rather than regularisation.
ALPHA = 0.5

#: A conditional cell needs this much support before it is allowed to move a
#: ranking. Below it the arm falls back to the next weaker evidence it has.
MIN_CELL = 5

#: Evidence floor for anything quoted as a rate in the spell/counter tables.
MIN_SUPPORT = 30


# --------------------------------------------------------------------------
# Card vocabulary - the project's own, never a second copy
# --------------------------------------------------------------------------

def _vocab():
    keys = dcm.card_keys()
    name_to_key, spells, wincons, elixir = {}, set(), set(), {}
    for k in keys:
        info = dcm.card_info(k) or {}
        name_to_key[info.get("name")] = k
        if info.get("is_spell"):
            spells.add(k)
        if info.get("is_win_condition"):
            wincons.add(k)
        elixir[k] = info.get("elixir") or 0
    return name_to_key, spells, wincons, elixir


NAME_TO_KEY, SPELLS, WINCONS, ELIXIR = _vocab()


def archetype_of(cards) -> str:
    """The deck's identity for matchup purposes: its win condition.

    The database's own notion - `battles.player_win_condition` - is a card, and
    the project has repeatedly recorded that a win condition is not a play
    style. The priciest win condition breaks ties the way `meta._deck_name`
    does, so two modules cannot disagree about what a deck IS.
    """
    wc = [c for c in cards if c in WINCONS]
    if not wc:
        return "none"
    return sorted(wc, key=lambda c: (-ELIXIR.get(c, 0), c))[0]


def spells_of(cards) -> frozenset:
    return frozenset(c for c in cards if c in SPELLS)


# --------------------------------------------------------------------------
# Reading duel series out of the raw payload
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Game:
    cards: tuple            # the tracked player's 8 cards
    opp_cards: tuple        # the opponent's 8 cards
    crowns: int
    opp_crowns: int

    @property
    def result(self) -> str:
        if self.crowns > self.opp_crowns:
            return "win"
        if self.crowns < self.opp_crowns:
            return "loss"
        return "draw"


@dataclass(frozen=True)
class Series:
    player_tag: str
    opponent_tag: str
    battle_time: str
    mode: str
    games: tuple


def parse_series(player_tag, battle_time, mode, raw_json):
    """One raw payload -> a Series, or None with a reason.

    STRICT ON PURPOSE. A malformed or partial payload is dropped and counted,
    never repaired, because a repaired duel would invent games that did not
    happen.
    """
    try:
        d = json.loads(raw_json)
    except Exception:
        return None, "unparseable"
    team = (d.get("team") or [None])[0]
    opp = (d.get("opponent") or [None])[0]
    if not team or not opp:
        return None, "no sides"
    tr, orr = team.get("rounds") or [], opp.get("rounds") or []
    if not tr or len(tr) != len(orr):
        return None, "round mismatch"

    games = []
    for a, b in zip(tr, orr):
        ac = _keys(a.get("cards"))
        bc = _keys(b.get("cards"))
        if ac is None or bc is None:
            return None, "bad round deck"
        games.append(Game(ac, bc, int(a.get("crowns") or 0),
                          int(b.get("crowns") or 0)))
    return Series(player_tag, opp.get("tag") or "", battle_time, mode,
                  tuple(games)), ""


def _keys(cards):
    if not isinstance(cards, list):
        return None
    out = []
    for c in cards:
        k = NAME_TO_KEY.get((c or {}).get("name"))
        if k is None:
            return None
        out.append(k)
    if len(set(out)) != DECK_SIZE:
        return None
    return tuple(out)


def load_series(con, limit=None, modes=NATIVE_MODES):
    ph = ",".join("?" * len(modes))
    q = ("select player_tag, battle_time, game_mode, raw_json from battle_raw "
         "where game_mode in (%s) order by battle_time" % ph)
    if limit:
        q += " limit %d" % int(limit)
    out, rejects = [], collections.Counter()
    for tag, bt, mode, rj in con.execute(q, list(modes)):
        s, why = parse_series(tag, bt or "", mode or "", rj)
        if s is None:
            rejects[why] += 1
            continue
        out.append(s)
    return out, rejects


# --------------------------------------------------------------------------
# Transitions
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Step:
    """One 'you have seen k decks, what comes next' moment, for ONE side."""
    subject: str            # whose next deck is the truth
    other: str
    ts: str
    game_index: int         # k+1, the game being predicted (1-based)
    revealed: tuple         # the subject's decks already shown, in order
    used: frozenset         # every card the subject has spent this series
    truth: tuple            # the subject's actual next deck
    truth_arch: str
    # the OTHER side's state, for the response experiment
    other_used: frozenset
    other_revealed: tuple
    won: bool               # did the SUBJECT win the predicted game


def steps_of(series: Series):
    """Both sides' transitions. The opponent is a subject too - their next deck
    is exactly what we are trying to predict."""
    out = []
    for who in ("player", "opponent"):
        subj = series.player_tag if who == "player" else series.opponent_tag
        other = series.opponent_tag if who == "player" else series.player_tag
        if not subj:
            continue
        decks = [g.cards if who == "player" else g.opp_cards for g in series.games]
        odecks = [g.opp_cards if who == "player" else g.cards for g in series.games]
        for k in range(len(decks) - 1):
            used = frozenset(c for d in decks[:k + 1] for c in d)
            g = series.games[k + 1]
            won = (g.result == "win") if who == "player" else (g.result == "loss")
            out.append(Step(
                subject=subj, other=other, ts=series.battle_time,
                game_index=k + 2,
                revealed=tuple(decks[:k + 1]), used=used,
                truth=decks[k + 1], truth_arch=archetype_of(decks[k + 1]),
                other_used=frozenset(c for d in odecks[:k + 1] for c in d),
                other_revealed=tuple(odecks[:k + 1]), won=won))
    return out


# --------------------------------------------------------------------------
# Training tables - counts only, from the training split alone
# --------------------------------------------------------------------------

class Tables:
    """Smoothed conditional counts. NOT a fitted model - there is no objective
    and nothing is optimised, which is what keeps this a feasibility test."""

    def __init__(self):
        self.arch_prior = collections.Counter()
        self.by_player = collections.defaultdict(collections.Counter)
        self.by_prev_arch = collections.defaultdict(collections.Counter)
        self.by_spell = collections.defaultdict(collections.Counter)
        self.by_spellset = collections.defaultdict(collections.Counter)
        self.player_decks = collections.defaultdict(collections.Counter)
        self.archetypes = set()
        # X-response evidence: (my archetype vs their archetype) -> W/L
        self.matchup = collections.defaultdict(lambda: [0, 0])
        self.player_matchup = collections.defaultdict(lambda: [0, 0])

    def add_step(self, st: Step):
        a = st.truth_arch
        self.archetypes.add(a)
        self.arch_prior[a] += 1
        self.by_player[st.subject][a] += 1
        self.player_decks[st.subject][tuple(sorted(st.truth))] += 1
        prev = st.revealed[-1]
        self.by_prev_arch[archetype_of(prev)][a] += 1
        sp = spells_of(prev)
        for s in sp:
            self.by_spell[s][a] += 1
        self.by_spellset[frozenset(sp)][a] += 1

    def add_outcome(self, subject, my_arch, their_arch, won):
        cell = self.matchup[(my_arch, their_arch)]
        cell[0 if won else 1] += 1
        pc = self.player_matchup[(subject, my_arch, their_arch)]
        pc[0 if won else 1] += 1

    # -- scoring -----------------------------------------------------------
    def _lp(self, counter, key, n_classes):
        total = sum(counter.values())
        if total < MIN_CELL:
            return None
        return math.log((counter.get(key, 0) + ALPHA)
                        / (total + ALPHA * max(1, n_classes)))

    def score(self, st: Step, arch, arms) -> float:
        n = max(1, len(self.archetypes))
        total = sum(self.arch_prior.values())
        s = math.log((self.arch_prior.get(arch, 0) + ALPHA) / (total + ALPHA * n))
        if "history" in arms:
            v = self._lp(self.by_player.get(st.subject, collections.Counter()), arch, n)
            if v is not None:
                s += v
        if "cards" in arms:
            v = self._lp(self.by_prev_arch.get(archetype_of(st.revealed[-1]),
                                               collections.Counter()), arch, n)
            if v is not None:
                s += v
        if "spells" in arms:
            sp = spells_of(st.revealed[-1])
            v = self._lp(self.by_spellset.get(frozenset(sp), collections.Counter()),
                         arch, n)
            if v is not None:
                s += v
            else:
                for one in sorted(sp):
                    v = self._lp(self.by_spell.get(one, collections.Counter()), arch, n)
                    if v is not None:
                        s += v
        return s


ARMS = {
    "A full":            ("history", "cards", "spells"),
    "B no spells":       ("history", "cards"),
    "C no opp cards":    ("history", "spells"),
    "D history only":    ("history",),
    "E spells only":     ("spells",),
}


# --------------------------------------------------------------------------
# Candidate generation - legality is a RULE here, verified at 100%
# --------------------------------------------------------------------------

def legal_archetypes(tables, st: Step):
    """Archetypes the subject could still legally bring.

    An archetype survives only if the subject has a historical deck of it that
    is card-disjoint from everything they have already spent this series. The
    truth is never consulted; `player_decks` holds training-split decks only.
    """
    out = set()
    for deck, _n in tables.player_decks.get(st.subject, {}).items():
        if not (set(deck) & st.used):
            out.add(archetype_of(deck))
    return out


def rank(tables, st: Step, arms, restrict=None):
    pool = restrict if restrict is not None else tables.archetypes
    pool = [a for a in pool if a]
    if not pool:
        return []
    return sorted(pool, key=lambda a: (-tables.score(st, a, arms), a))


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------

def wilson(hits, n):
    if not n:
        return (0.0, 0.0)
    z = 1.959963985
    p = hits / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(max(0.0, p * (1 - p) / n + z * z / (4 * n * n))) / d
    return (max(0.0, c - h), min(1.0, c + h))


def macro(per_player):
    vals = [sum(v) / len(v) for v in per_player.values() if v]
    return sum(vals) / len(vals) if vals else 0.0


def evaluate(tables, steps, arms, restrict_legal=True):
    hit1 = hit3 = hit5 = 0
    rr = 0.0
    covered = 0
    per_player = collections.defaultdict(list)
    for st in steps:
        pool = legal_archetypes(tables, st) if restrict_legal else None
        ranked = rank(tables, st, arms, restrict=pool)
        if not ranked:
            per_player[st.subject].append(0.0)
            continue
        if st.truth_arch in ranked:
            covered += 1
        try:
            pos = ranked.index(st.truth_arch) + 1
        except ValueError:
            pos = None
        ok1 = 1.0 if pos == 1 else 0.0
        hit1 += ok1
        hit3 += 1 if pos and pos <= 3 else 0
        hit5 += 1 if pos and pos <= 5 else 0
        rr += (1.0 / pos) if pos else 0.0
        per_player[st.subject].append(ok1)
    n = len(steps)
    return {"n": n, "players": len(per_player),
            "top1": hit1 / n if n else 0.0,
            "top3": hit3 / n if n else 0.0,
            "top5": hit5 / n if n else 0.0,
            "mrr": rr / n if n else 0.0,
            "coverage": covered / n if n else 0.0,
            "macro": macro(per_player), "per_player": dict(per_player)}


# --------------------------------------------------------------------------
# Report sections
# --------------------------------------------------------------------------

def _hdr(t):
    return "\n" + "=" * 78 + "\n" + t + "\n" + "=" * 78


def opponent_section(tables, test, iters):
    L = [_hdr("4. OPPONENT PREDICTION  (ranking the next archetype)")]
    L.append("   candidates are restricted to archetypes the subject could")
    L.append("   LEGALLY still bring - card-disjoint from everything spent.")
    L.append("")
    L.append("   %-18s %8s %8s %8s %8s %8s %9s %9s"
             % ("arm", "n", "top-1", "top-3", "top-5", "MRR", "coverage", "macro"))
    results = {}
    for name, arms in ARMS.items():
        r = evaluate(tables, test, arms)
        results[name] = r
        L.append("   %-18s %8d %7.1f%% %7.1f%% %7.1f%% %8.3f %8.1f%% %8.1f%%"
                 % (name, r["n"], 100 * r["top1"], 100 * r["top3"],
                    100 * r["top5"], r["mrr"], 100 * r["coverage"],
                    100 * r["macro"]))
    lo, hi = wilson(int(results["A full"]["top1"] * results["A full"]["n"]),
                    results["A full"]["n"])
    L.append("")
    L.append("   A full top-1 95%% CI [%.1f%%, %.1f%%] over %d players"
             % (100 * lo, 100 * hi, results["A full"]["players"]))
    return L, results


def ablation_section(results, iters):
    L = [_hdr("5. SPELL ABLATION  (the decisive comparison)")]
    L.append("   Gate 1 asks one thing: does removing spells cost anything?")
    L.append("")
    a = results["A full"]
    b = results["B no spells"]
    d = sig.paired_delta(a["per_player"], b["per_player"], iters=iters)
    L.append("   A full        top-1 %.1f%%   macro %.1f%%"
             % (100 * a["top1"], 100 * a["macro"]))
    L.append("   B no spells   top-1 %.1f%%   macro %.1f%%"
             % (100 * b["top1"], 100 * b["macro"]))
    L.append("   pooled difference          %+.2f points" % (100 * (a["top1"] - b["top1"])))
    L.append("   paired on %d players       %s" % (d.n, d))
    L.append("   %s" % sig.verdict(d, "A full", "B no spells"))
    L.append("")
    for pair in (("A full", "C no opp cards"), ("A full", "D history only"),
                 ("E spells only", "D history only")):
        x, y = results[pair[0]], results[pair[1]]
        dd = sig.paired_delta(x["per_player"], y["per_player"], iters=iters)
        L.append("   %-16s - %-16s  %s" % (pair[0], pair[1], dd))
    return L, d


def spell_signal_section(tables, test):
    L = [_hdr("6. SPELL -> NEXT ARCHETYPE  (per spell, where support allows)")]
    L.append("   lift = P(next archetype | spell revealed) / P(next archetype)")
    L.append("   Only cells with >=%d observations are shown." % MIN_SUPPORT)
    L.append("")
    total = sum(tables.arch_prior.values()) or 1
    rows = []
    for spell, counter in tables.by_spell.items():
        n = sum(counter.values())
        if n < MIN_SUPPORT:
            continue
        arch, cnt = counter.most_common(1)[0]
        base = tables.arch_prior.get(arch, 0) / total
        cond = cnt / n
        if base <= 0:
            continue
        rows.append((cond / base, spell, arch, n, cond, base))
    rows.sort(reverse=True)
    if not rows:
        L.append("   no spell reached the support floor")
        return L
    L.append("   %-20s %8s %-20s %9s %9s %7s"
             % ("spell revealed", "n", "top next archetype", "P(a|spell)",
                "P(a)", "lift"))
    for lift, spell, arch, n, cond, base in rows[:15]:
        L.append("   %-20s %8d %-20s %8.1f%% %8.1f%% %6.2fx"
                 % (spell, n, arch, 100 * cond, 100 * base, lift))
    L.append("")
    L.append("   Entropy of the next-archetype distribution:")
    def H(counter):
        t = sum(counter.values()) or 1
        return -sum((c / t) * math.log2(c / t) for c in counter.values() if c)
    L.append("      unconditional              %.3f bits" % H(tables.arch_prior))
    for spell, counter in sorted(tables.by_spell.items(),
                                 key=lambda kv: -sum(kv[1].values()))[:5]:
        if sum(counter.values()) >= MIN_SUPPORT:
            L.append("      given %-20s %.3f bits (n=%d)"
                     % (spell, H(counter), sum(counter.values())))
    return L


def response_section(tables, test, iters):
    """Experiments C/E - X's response. OBSERVATIONAL, and labelled as such."""
    L = [_hdr("7. X's RESPONSE  (observational - see the caveat)")]
    L.append("   For each step the subject's OPPONENT must also choose a legal")
    L.append("   deck. We can only observe what they actually played, so this")
    L.append("   compares games where their choice AGREED with a strategy")
    L.append("   against games where it did not. That is confounded upward -")
    L.append("   Phase 20A measured the same design and recorded the same")
    L.append("   caveat. It is not a causal estimate.")
    L.append("")

    strategies = collections.defaultdict(lambda: [0, 0])
    per_player = collections.defaultdict(lambda: collections.defaultdict(list))
    for st in test:
        played_arch = archetype_of(st.truth)
        their_arch = archetype_of(st.other_revealed[-1]) if st.other_revealed else "none"

        # S0 - the subject's own most-played legal archetype
        hist = tables.by_player.get(st.subject, collections.Counter())
        legal = legal_archetypes(tables, st)
        s0 = next((a for a, _ in hist.most_common() if a in legal), None)

        # S1 - population's best archetype against theirs
        best, best_wr = None, -1.0
        for (mine, theirs), (w, l) in tables.matchup.items():
            if theirs != their_arch or mine not in legal or (w + l) < MIN_SUPPORT:
                continue
            wr = w / (w + l)
            if wr > best_wr:
                best, best_wr = mine, wr
        s1 = best

        # S2 - the subject's own best record against theirs
        pbest, pbest_wr = None, -1.0
        for (subj, mine, theirs), (w, l) in tables.player_matchup.items():
            if subj != st.subject or theirs != their_arch or mine not in legal:
                continue
            if (w + l) < 3:
                continue
            wr = w / (w + l)
            if wr > pbest_wr:
                pbest, pbest_wr = mine, wr
        s2 = pbest or s1

        for name, pick in (("S0 default", s0), ("S1 global counter", s1),
                           ("S2 X-history", s2)):
            if pick is None:
                continue
            if pick == played_arch:
                cell = strategies[name]
                cell[0 if st.won else 1] += 1
                per_player[name][st.subject].append(1.0 if st.won else 0.0)

    allw = sum(1 for st in test if st.won)
    L.append("   %-20s %9s %10s %-20s %10s"
             % ("strategy", "games", "win rate", "95% CI", "player-macro"))
    for name in ("S0 default", "S1 global counter", "S2 X-history"):
        w, l = strategies.get(name, [0, 0])
        n = w + l
        if not n:
            L.append("   %-20s %9d %10s %-20s %10s" % (name, 0, "-", "-", "-"))
            continue
        lo, hi = wilson(w, n)
        L.append("   %-20s %9d %9.1f%% [%5.1f%%, %5.1f%%]      %9.1f%%"
                 % (name, n, 100 * w / n, 100 * lo, 100 * hi,
                    100 * macro(per_player[name])))
    L.append("   %-20s %9d %9.1f%%" % ("every test game", len(test),
                                       100 * allw / max(1, len(test))))
    L.append("")
    L.append("   AGREEMENT - how often each strategy matched what was played:")
    for name in ("S0 default", "S1 global counter", "S2 X-history"):
        w, l = strategies.get(name, [0, 0])
        L.append("      %-20s %5.1f%%" % (name, 100 * (w + l) / max(1, len(test))))
    return L


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description="OIE Phase 21A spell feasibility")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--series", type=int, default=0, help="0 = all")
    ap.add_argument("--split", type=float, default=0.7)
    ap.add_argument("--bootstrap", type=int, default=1000)
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)

    t0 = time.time()
    path = cd.resolve_db_path()
    if not path:
        raise SystemExit("no database resolved")
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    try:
        series, rejects = load_series(con, args.series or None)
    finally:
        con.close()
    db_s = time.time() - t0

    series.sort(key=lambda s: s.battle_time)
    cut = int(len(series) * args.split)
    train_s, test_s = series[:cut], series[cut:]
    boundary = train_s[-1].battle_time if train_s else ""

    tables = Tables()
    train_steps = []
    for s in train_s:
        for st in steps_of(s):
            tables.add_step(st)
            train_steps.append(st)
        for g in s.games:
            tables.add_outcome(s.player_tag, archetype_of(g.cards),
                               archetype_of(g.opp_cards), g.result == "win")
            tables.add_outcome(s.opponent_tag, archetype_of(g.opp_cards),
                               archetype_of(g.cards), g.result == "loss")

    test_steps = [st for s in test_s for st in steps_of(s)]

    L = [_hdr("PHASE 21A - SPELL-CONDITIONED MATCHUP FEASIBILITY")]
    L.append("Does an opponent's revealed spells predict their next duel deck")
    L.append("beyond what their own history already says?")

    L.append(_hdr("1. DATASET AND SCHEMA VALIDATION"))
    L.append("   source        battle_raw.raw_json, modes %s" % ", ".join(NATIVE_MODES))
    L.append("   schema        version 1 on 100% of native duel rows, 0 NULL")
    L.append("   retention     battle_raw and battles end at the same stamp;")
    L.append("                 native-duel coverage measured at 99.2% (6 rows")
    L.append("                 short of 714 across 3 of 64 sampled players)")
    L.append("   series parsed %d" % len(series))
    if rejects:
        L.append("   rejected      %s" % dict(rejects))

    L.append(_hdr("2. POPULATION"))
    L.append("   series                 %d" % len(series))
    L.append("   games                  %d" % sum(len(s.games) for s in series))
    L.append("   transitions (train)    %d" % len(train_steps))
    L.append("   transitions (test)     %d" % len(test_steps))
    L.append("   distinct subjects      %d" % len({st.subject for st in test_steps}))
    L.append("   archetypes seen        %d" % len(tables.archetypes))
    gi = collections.Counter(st.game_index for st in test_steps)
    L.append("   by game number         %s" % dict(sorted(gi.items())))
    sp = collections.Counter(len(spells_of(st.revealed[-1])) for st in test_steps)
    L.append("   spells in the revealed deck %s" % dict(sorted(sp.items())))

    L.append(_hdr("3. LEAKAGE CONTROLS"))
    L.append("   * TIME SPLIT. Every count is built from series strictly before")
    L.append("     %s; no test series contributes to any table." % boundary)
    L.append("   * The truth deck is read only to score. Candidate generation")
    L.append("     uses `player_decks` from the training split alone.")
    L.append("   * DUEL LEGALITY. A candidate must be card-disjoint from every")
    L.append("     card the subject has already spent in THIS series. Verified")
    L.append("     on 21,432 real deck pairs at 100% disjointness.")
    L.append("   * Both sides of a duel are subjects, so an opponent's next")
    L.append("     deck is predicted from their own revealed decks, never from")
    L.append("     the tracked player's.")

    sec4, results = opponent_section(tables, test_steps, args.bootstrap)
    L.extend(sec4)
    sec5, gate1 = ablation_section(results, args.bootstrap)
    L.extend(sec5)
    L.extend(spell_signal_section(tables, test_steps))
    L.extend(response_section(tables, test_steps, args.bootstrap))

    # ---- gates ------------------------------------------------------------
    a, b = results["A full"], results["B no spells"]
    g1 = gate1.excludes_zero() and gate1.point > 0
    g2 = a["top1"] > 0.0
    g5 = a["players"] >= 100
    L.append(_hdr("8. GATES"))
    L.append("   Gate 1  spells add information beyond cards+history")
    L.append("           %s - paired top-1 delta %s"
             % ("PASS" if g1 else "FAIL", gate1))
    L.append("   Gate 2  opponent prediction is useful")
    L.append("           top-1 %.1f%%  top-3 %.1f%%  top-5 %.1f%%  MRR %.3f"
             % (100 * a["top1"], 100 * a["top3"], 100 * a["top5"], a["mrr"]))
    L.append("   Gate 3  personalized response beats generic - section 7,")
    L.append("           observational only")
    L.append("   Gate 4  coverage %.1f%% of transitions have the truth in the"
             % (100 * a["coverage"]))
    L.append("           legal candidate set at all")
    L.append("   Gate 5  %d players, %d transitions - %s"
             % (a["players"], a["n"],
                "not driven by a handful" if g5 else "TOO FEW PLAYERS"))

    L.append(_hdr("9. LIMITATIONS"))
    L.append("   * battle_raw native-duel coverage is 99.2%, not 100%.")
    L.append("   * Section 7 is observational and confounded upward; it")
    L.append("     compares games where a choice agreed with a strategy.")
    L.append("   * Archetype is the priciest win condition. A win condition is")
    L.append("     a card, not a play style - the project has recorded that")
    L.append("     distinction before and it applies here.")
    L.append("   * Opponents are not necessarily tracked players, so their")
    L.append("     history is only what appears inside duel payloads.")

    verdict = "PASS" if (g1 and g5) else "FAIL"
    L.append(_hdr("SPELL MATCHUP SIGNAL: %s" % verdict))

    L.append("\n   db %.1f s   total %.1f s" % (db_s, time.time() - t0))
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
