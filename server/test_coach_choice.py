"""test_coach_choice.py — decks built around the cards the reader names.

    python server/test_coach_choice.py

No database. The rules (`coach_choice.py`) are pure and tested against
literals; the wiring (`coach.chosen`) is driven with every reader replaced, on
real card keys so the structural checks it calls are the real ones.
"""

from __future__ import annotations

import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coach  # noqa: E402
import coach_choice as cc  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def key(cards):
    return ",".join(sorted(cards))


HOG = ["hog-rider", "musketeer", "cannon", "fireball", "the-log", "ice-spirit", "skeletons", "ice-golem"]
HOG_EQ = ["hog-rider", "firecracker", "tesla", "earthquake", "the-log", "ice-spirit", "skeletons", "valkyrie"]
GOLEM = ["golem", "night-witch", "baby-dragon", "lightning", "tornado", "lumberjack", "mega-minion",
         "barbarian-barrel"]
BAIT = ["goblin-barrel", "princess", "knight", "rocket", "goblin-gang", "inferno-tower", "ice-spirit",
        "the-log"]
RAM = ["ram-rider", "bandit", "pekka", "electro-wizard", "magic-archer", "zap", "poison", "royal-ghost"]
RAMHOG = ["hog-rider" if c == "ram-rider" else c for c in RAM]
MINER = ["miner", "poison", "wall-breakers", "knight", "bats", "spear-goblins", "bomb-tower", "the-log"]
KNOWN = set(HOG + HOG_EQ + GOLEM + BAIT + RAM + MINER)


# ── What the reader named ───────────────────────────────────────────────────
print("\nthe named cards")

w, d = cc.valid_want(["hog-rider", "fireball"], KNOWN)
check("known cards are kept, in the order given", w == ["hog-rider", "fireball"] and d == [])
w, d = cc.valid_want(["Hog Rider", " THE LOG "], KNOWN)
check("a name typed with capitals and spaces is the card's key", w == ["hog-rider", "the-log"], str(w))
w, d = cc.valid_want(["hog-rider", "not-a-card"], KNOWN)
check("an unknown key is dropped AND echoed, never an error",
      w == ["hog-rider"] and d == ["not-a-card"], str((w, d)))
w, d = cc.valid_want(["hog-rider", "hog-rider", "golem"], KNOWN)
check("a card named twice counts once", w == ["hog-rider", "golem"] and d == [])
w, d = cc.valid_want(["hog-rider", "golem", "miner", "pekka", "bandit"], KNOWN)
check("no more than MAX_WANT cards; the rest are reported",
      len(w) == cc.MAX_WANT == 4 and d == ["bandit"], str((w, d)))
check("nothing named is nothing wanted", cc.valid_want([], KNOWN) == ([], [])
      and cc.valid_want(None, KNOWN) == ([], []))

check("a deck holds the named cards only if it holds ALL of them",
      cc.holds(HOG, ["hog-rider", "fireball"]) and not cc.holds(HOG, ["hog-rider", "earthquake"]))
check("seven cards, or a repeated card, is not a deck",
      not cc.holds(HOG[:7], ["hog-rider"]) and not cc.holds(HOG[:7] + ["hog-rider"], ["hog-rider"]))
check("a deck sharing a spent card is illegal; one sharing none is legal",
      not cc.legal(HOG, {"fireball"}) and cc.legal(HOG, {"zap"}) and cc.legal(HOG, set()))
check("missing lists the named cards a deck lacks, in the order named",
      cc.missing(RAM, ["hog-rider", "bandit", "golem"]) == ["hog-rider", "golem"])


# ── A real deck one card short, and the swap people make ────────────────────
print("\nbringing a named card into a real deck")

G = {"ram-rider": [["battle-ram", 0.4, 300], ["hog-rider", 0.3, 120]],
     "zap": [["the-log", 0.5, 900], ["hog-rider", 0.01, 30]],
     "bandit": [["royal-ghost", 0.2, 50]]}
f = cc.forced(RAM, ["hog-rider"], G)
check("the card real players trade for it gives way (Ram Rider -> Hog Rider)",
      f and f[0]["swaps"] == [{"out": "ram-rider", "in": "hog-rider", "pairs": 120}]
      and set(f[0]["cards"]) == set(RAMHOG), str(f[:1]))
check("the best swap comes first, by the graph's own score",
      [x["swaps"][0]["out"] for x in f] == ["ram-rider", "zap"], str(f))
check("a built deck is still eight distinct cards holding the named one",
      all(cc.holds(x["cards"], ["hog-rider"]) for x in f))
check("at most FORCED_PER_DECK ways per deck",
      len(cc.forced(RAM, ["hog-rider"], {c: [["hog-rider", 0.1, 50]] for c in RAM})) == cc.FORCED_PER_DECK)
f2 = cc.forced(RAM, ["hog-rider", "bandit"], {"bandit": [["hog-rider", 0.9, 999]],
                                             "zap": [["hog-rider", 0.1, 40]]})
check("a NAMED card never leaves, however good the swap looks",
      f2 and [x["swaps"][0]["out"] for x in f2] == ["zap"], str(f2))
check("a deck that already holds every named card is not rebuilt",
      cc.forced(RAMHOG, ["hog-rider"], G) == [])
check("two named cards short is out of reach — one human swap, not two",
      cc.forced(RAM, ["hog-rider", "golem"], G) == [] and cc.MAX_FORCED == 1)
check("a named card already spent this duel is never swapped in",
      cc.forced(RAM, ["hog-rider"], G, used={"hog-rider"}) == [])
check("a swap nobody makes is not made", cc.forced(RAM, ["golem"], G) == [])
check("no graph, no built decks", cc.forced(RAM, ["hog-rider"], None) == [])
deep = {"ram-rider": [[f"x{i}", 0.9, 9] for i in range(cc.FORCED_PER_CARD)] + [["hog-rider", 0.1, 9]]}
check("only a card's leading substitutes count (FORCED_PER_CARD)",
      cc.forced(RAM, ["hog-rider"], deep) == [])
thin = {"ram-rider": [["hog-rider", 0.9, cc.FORCED_MIN_PAIRS - 1]]}
check("a swap too few real deck pairs make is not made (FORCED_MIN_PAIRS)",
      cc.forced(RAM, ["hog-rider"], thin) == []
      and len(cc.forced(RAM, ["hog-rider"], {"ram-rider": [["hog-rider", 0.9, cc.FORCED_MIN_PAIRS]]})) == 1)
ROLE = {"hog-rider": "wincon", "ram-rider": "wincon", "zap": "spell", "poison": "spell"}
role = lambda c: ROLE.get(c, "troop")
fr = cc.forced(RAM, ["hog-rider"], G, role=role, min_pairs=1)
check("like for like: a win condition takes a win condition's place, never a spell's",
      [x["swaps"][0]["out"] for x in fr] == ["ram-rider"], str(fr))
check("…and with no win condition to give way, nothing is built",
      cc.forced(RAM, ["hog-rider"], {"zap": [["hog-rider", 0.9, 500]]}, role=role) == [])


# ── Which lists the combined brain rates ────────────────────────────────────
print("\nthe shortlist")


def cand(n, source, fast=None, plays=0):
    return {"cards": [f"{source}{n}-{i}" for i in range(8)], "source": source,
            "fast": fast, "plays": plays}


many = ([cand(i, "yours", 50 + i) for i in range(6)] + [cand(i, "duel", 60 + i) for i in range(20)]
        + [cand(i, "meta", 55 + i) for i in range(20)] + [cand(i, "built", 58 + i) for i in range(20)])
sl = cc.shortlist(many)
per = {s: sum(1 for c in sl if c["source"] == s) for s in cc.SOURCES}
check("never more than FINALISTS", len(sl) == cc.FINALISTS == sum(cc.QUOTA.values()), str(len(sl)))
check("each source gets its quota when it can fill it", per == cc.QUOTA, str(per))
check("within a source the quick model's best come first",
      [c["fast"] for c in sl if c["source"] == "duel"] == [79 - i for i in range(cc.QUOTA["duel"])])
check("duel decks hold the largest share of the shortlist",
      cc.QUOTA["duel"] == max(cc.QUOTA.values()))
only_meta = [cand(i, "meta", 50 + i) for i in range(30)]
check("a request only one source can answer still gets a full shortlist",
      len(cc.shortlist(only_meta)) == cc.FINALISTS)
nofast = [cand(1, "duel", None, plays=5), cand(2, "duel", None, plays=90)]
check("with no model the most-played lead", cc.shortlist(nofast)[0]["plays"] == 90)
dup = [dict(cand(1, "yours", 40), cards=HOG), dict(cand(1, "duel", 70), cards=list(reversed(HOG)))]
got = cc.shortlist(dup)
check("one deck in two sources is rated once, as the more trusted source",
      len(got) == 1 and got[0]["source"] == "yours", str(got))


# ── The order: win chance, with duel proof breaking near-ties ───────────────
print("\nthe order")


def row(name, win, strong=False, source="meta", plays=0):
    return {"cards": [f"{name}{i}" for i in range(8)], "win": win, "source": source, "plays": plays,
            "duel": {"strong": strong} if strong is not None else None, "name": name}


names = lambda rows: [r["name"] for r in rows]
check("the higher win chance leads", names(cc.order([row("a", 52.0), row("b", 58.0)])) == ["b", "a"])
check("a duel-proven deck leads one within the band",
      names(cc.order([row("plain", 58.0), row("proven", 56.0, strong=True)])) == ["proven", "plain"])
check("but not one clearly better — proof breaks near-ties, it does not overrule",
      names(cc.order([row("plain", 60.0), row("proven", 56.0, strong=True)])) == ["plain", "proven"])
check("the band is three points, Coach Assist's lead margin", cc.DUEL_BAND == coach.LEAD_MARGIN == 3.0)
check("exactly on the band, proof wins the tie",
      names(cc.order([row("plain", 59.0), row("proven", 56.0, strong=True)])) == ["proven", "plain"])
check("an unrated deck comes after every rated one",
      names(cc.order([row("none", None), row("low", 41.0)])) == ["low", "none"])
check("level on everything else, the player's own deck leads",
      names(cc.order([row("meta", 55.0), row("mine", 55.0, source="yours")])) == ["mine", "meta"])
check("a row with no duel figures at all is simply not proven",
      names(cc.order([row("nofig", 55.0, strong=None), row("p", 54.0, strong=True)])) == ["p", "nofig"])
a = cc.order([row("x", 50.0), row("y", 50.0)])
check("identical evidence orders identically", names(a) == names(cc.order(list(reversed(a)))))

near = [{"cards": HOG, "win": 60.0}, {"cards": HOG[:7] + ["zap"], "win": 59.0},
        {"cards": GOLEM, "win": 50.0}]
check("near-copies are one answer", [r["cards"] for r in cc.pick(near, ["hog-rider"])] == [HOG, GOLEM])
check("never more than SHOW decks",
      len(cc.pick([row(str(i), 50.0) for i in range(20)], ["a"])) == cc.SHOW)
check("with four cards named, decks one card apart are still the same answer",
      cc.same_at(["a", "b", "c", "d"]) == 7 and cc.same_at(["a"]) == 6)
four = [{"cards": HOG, "win": 60.0}, {"cards": HOG[:6] + ["zap", "bats"], "win": 59.0}]
check("…and decks two apart are different answers",
      len(cc.pick(four, HOG[:4])) == 2 and len(cc.pick(four, HOG[:1])) == 1)


# ── What is shown: real decks lead, built decks follow ──────────────────────
print("\nreal decks lead, built decks follow")

real = [row(f"r{i}", 55.0 - i) for i in range(8)]
made = [row(f"b{i}", 70.0 - i, source="built") for i in range(5)]
shown = cc.arrange(real + made, ["x"])
check("a built deck never outranks a real one, whatever its inherited rate",
      [r["source"] for r in shown] == ["meta"] * 4 + ["built"] * 2, str([r["name"] for r in shown]))
check("the real ones keep their own order, and so do the built",
      names(shown) == ["r0", "r1", "r2", "r3", "b0", "b1"])
check("built decks take BUILT_SLOTS while real ones are available", cc.BUILT_SLOTS == 2)
few = cc.arrange(real[:1] + made, ["x"])
check("when real decks run out, built ones fill the list",
      names(few) == ["r0", "b0", "b1", "b2", "b3", "b4"], str(names(few)))
check("with no built decks the list is all real", names(cc.arrange(real, ["x"])) == [f"r{i}" for i in range(6)])
check("with only built decks they are the list", len(cc.arrange(made, ["x"])) == 5)
copy = dict(row("copy", 80.0, source="built"), cards=real[0]["cards"][:7] + ["zz"])
check("a built near-copy of a real deck already shown is not a second answer",
      "copy" not in names(cc.arrange(real + [copy], ["x"])))
own = row("mine", 40.0, source="yours")
kept = cc.arrange(real + [own] + made, ["x"])
check("the player's own deck holding the cards is always shown, in rank order",
      names(kept) == ["r0", "r1", "r2", "mine", "b0", "b1"], str(names(kept)))
unrated = row("mine", None, source="yours")
check("…unless it could not be rated at all",
      "mine" not in names(cc.arrange(real + [unrated] + made, ["x"])))
check("never more than SHOW in total", len(cc.arrange(real + made + [own], ["x"])) == cc.SHOW)


# ── The wiring: `coach.chosen`, every reader replaced ───────────────────────
print("\ncoach.chosen")


class FakeDuel:
    def __init__(self, catalogue, strong=()):
        self.on = True
        self.status = {"windowFrom": None}
        self.catalogue = catalogue
        self._strong = {key(c) for c in strong}

    def figures(self, cards, projection):
        return {"winRate": 61.0, "nEff": 80.0, "games": 80, "strong": key(cards) in self._strong}


class FakeRates:
    """`_Rates`' surface: a fused rate keyed on my deck's first card."""
    table: dict = {}
    duel_ctx = None

    def __init__(self, snap):
        self.on = True
        self.duel = FakeRates.duel_ctx
        self.prepared = []

    def prepare(self, mine, theirs):
        self.prepared.append((len(list(mine)), len(list(theirs))))

    def rate(self, mine, theirs=None, archetype=None):
        r = FakeRates.table.get(key(mine))
        return None if r is None else {"winRate": r, "games": 120, "source": "version",
                                       "tier": "high", "interval": None, "decks": None}

    def summary(self):
        return None


OPP = {"decks": [{"cards": GOLEM, "prob": 0.6, "deckName": "Golem Night Witch", "archetype": "golem"},
                 {"cards": BAIT, "prob": 0.4, "deckName": "Log Bait", "archetype": "bait"}],
       "source": "opponent-history", "nCandidates": 2}

saved = {n: getattr(coach, n) for n in
         ("_history", "opponent_next", "_Rates", "_own_decks", "_archetype", "_brain_ctx",
          "_drop_event_decks", "_synergy_gate", "_duel_projection", "_build_for_duel")}
saved_seeds, saved_snap, saved_seater = coach.counter.seeds, coach.counter._snap, coach.counter.seater
saved_sg = sys.modules.get("swap_graph")
built_calls: list = []
try:
    coach._history = lambda tag, since=None, until=None: {"allDecks": [], "series": [],
                                                          "marks": lambda c: {}, "arch": lambda c: ""}
    coach.opponent_next = lambda tag, played, hist=None: OPP
    coach._Rates = FakeRates
    coach._archetype = lambda cards: {"hog-rider": "hog", "golem": "golem", "ram-rider": "ram",
                                      "miner": "miner", "goblin-barrel": "bait"}.get(
        next((c for c in cards if c in ("hog-rider", "golem", "ram-rider", "miner", "goblin-barrel")), ""),
        "other")
    coach._brain_ctx = lambda opp, me, them: None          # the fused rate answers
    coach._drop_event_decks = lambda decks: (list(decks), 0)
    coach._synergy_gate = lambda: None
    coach._duel_projection = lambda rates, opp, tag, win: ({"golem": 0.6, "bait": 0.4}, 0.0)
    coach.counter._snap = lambda: None
    coach.counter.seater = lambda: (lambda cards: (list(cards), {}, True))
    coach.counter.seeds = lambda: {"hog": [{"hash": key(HOG_EQ), "cards": sorted(HOG_EQ), "games": 900,
                                           "archetypes": {}}],
                                  "ram": [{"hash": key(RAM), "cards": sorted(RAM), "games": 700,
                                           "archetypes": {}}],
                                  "miner": [{"hash": key(MINER), "cards": sorted(MINER), "games": 500,
                                             "archetypes": {}}]}
    coach._own_decks = lambda tag, since, until, hist, rates: (
        {key(HOG): {"cards": HOG, "plays": 40}}, set(HOG))
    fake_sg = types.ModuleType("swap_graph")
    fake_sg.load = lambda: {"graph": {"ram-rider": [["hog-rider", 0.3, 120]]}, "decks": 10}
    sys.modules["swap_graph"] = fake_sg

    CAT_HOG = ["hog-rider", "executioner", "tornado", "rocket", "goblins", "mini-pekka", "bats",
               "barbarian-barrel"]
    FakeRates.duel_ctx = FakeDuel(
        [{"key": key(CAT_HOG), "cards": sorted(CAT_HOG), "archetype": "hog", "games": 140, "wins": 80,
          "players": 31, "records": {}}], strong=[CAT_HOG])
    FakeRates.table = {key(HOG): 58.0, key(HOG_EQ): 54.0, key(CAT_HOG): 56.5, key(RAMHOG): 51.0,
                       key(MINER): 70.0}

    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider"])
    decks = r["decks"]
    check("every deck returned holds the named card",
          decks and all("hog-rider" in d["cards"] for d in decks), str([d["cards"][:2] for d in decks]))
    check("a deck without it is never offered, however good (Miner 70%)",
          all("miner" not in d["cards"] for d in decks))
    src = {d["source"]: d for d in decks}
    check("it draws on all four sources: yours, duel, meta and built",
          set(src) == set(cc.SOURCES), str(sorted(src)))
    check("the duel-proven deck leads the player's own within the band (56.5 vs 58.0)",
          decks[0]["source"] == "duel" and decks[1]["source"] == "yours",
          str([(d["source"], d["win"]) for d in decks]))
    check("each row carries its win chance and the matchup against EACH of their decks",
          all(d["win"] is not None and [v["name"] for v in d["vs"]] == ["Golem Night Witch", "Log Bait"]
              for d in decks), str(decks[0]["vs"]))
    check("the duel deck carries its real duel record and pilots",
          src["duel"]["duelRecord"] == [140, 80] and src["duel"]["players"] == 31)
    check("the built deck names its swap and the real deck it came from",
          src["built"]["swaps"] == [{"out": "ram-rider", "in": "hog-rider", "pairs": 120}]
          and src["built"]["seedSource"] == "meta" and src["built"]["seedName"], str(src["built"]))
    check("how much of each deck the player already plays is counted",
          src["yours"]["familiar"] == 8 and src["meta"]["familiar"] < 8)
    check("the counts say how many decks held the card, per source",
          r["counts"] == {"yours": 1, "duel": 1, "meta": 1, "built": 1}, str(r["counts"]))
    check("with no trained model the engine is the fused rate, and says so",
          r["engine"] == "fused" and all(d["engine"] == "fused" for d in decks))
    check("the request is echoed back", r["want"] == ["hog-rider"] and r["reason"] is None)

    r = coach.chosen("#ME", "#OPP", [HOG], [GOLEM], ["hog-rider"])
    check("a named card already spent this duel is REPORTED and nothing is offered",
          r["spent"] == ["hog-rider"] and r["decks"] == [] and r["reason"] == "spent", str(r))

    spent = ["fireball", "zap", "arrows", "giant", "witch", "minions", "bomber", "archers"]
    r = coach.chosen("#ME", "#OPP", [spent], [GOLEM], ["hog-rider"])
    check("no deck offered shares a card with what has been played (their own Hog has Fireball)",
          r["decks"] and all(not (set(d["cards"]) & set(spent)) for d in r["decks"]),
          str([d["source"] for d in r["decks"]]))
    check("…so the player's own deck is out and the stage is game 2",
          "yours" not in {d["source"] for d in r["decks"]} and r["stage"] == 1)
    check("…and the built deck that needed Zap's seed is out too (Ram has Zap)",
          "built" not in {d["source"] for d in r["decks"]})

    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider", "earthquake"])
    check("two named cards: only decks holding BOTH",
          r["decks"] and all({"hog-rider", "earthquake"} <= set(d["cards"]) for d in r["decks"]),
          str([d["cards"] for d in r["decks"]]))

    r = coach.chosen("#ME", "#OPP", [], [], ["golem", "hog-rider"])
    check("cards no real deck holds together, and no single swap makes: none, with the reason",
          r["decks"] == [] and r["reason"] == "none")

    r = coach.chosen("#ME", "#OPP", [], [], ["nonsense"])
    check("only unknown cards named: nothing asked, the key echoed",
          r["reason"] == "no_cards" and r["dropped"] == ["nonsense"] and r["decks"] == [])

    # An event deck is refused whoever played it.
    coach._drop_event_decks = lambda decks: ([d for d in decks if key(d["cards"]) != key(HOG_EQ)], 1)
    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider", "earthquake"])
    check("an event deck is never offered", r["decks"] == [] and r["reason"] == "none", str(r["decks"]))
    coach._drop_event_decks = lambda decks: (list(decks), 0)

    # A structural hole: a meta list that cannot field three special slots.
    real_slots = coach.cd.fillable_slots
    coach.cd.fillable_slots = lambda cards: 2 if key(cards) == key(HOG_EQ) else real_slots(cards)
    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider", "earthquake"])
    check("a stranger's deck that cannot field three special slots is not offered",
          r["decks"] == [], str([d["cards"] for d in r["decks"]]))
    coach.cd.fillable_slots = real_slots

    # With a trained model: the combined brain rates, and the builder runs
    # with the named cards KEPT.
    ctx = {"model": {"weights": {}}, "decks": OPP["decks"],
           "kw": dict(my_def=None, opp_def=None, my_str=0.5, opp_str=0.5), "records": ((0, 0), (0, 0))}
    coach._brain_ctx = lambda opp, me, them: ctx

    def fake_build(c, seeds, rates, used, stage, keep=None, keep_win_conditions=False):
        built_calls.append({"seeds": [s["cards"] for s in seeds], "keep": set(keep or ()),
                            "wincons": keep_win_conditions})
        better = [c2 if c2 != "cannon" else "tesla" for c2 in HOG]
        return {"decks": [{"cards": better, "art": {}, "inferredArt": True, "name": "Hog Rider",
                           "win": 63.0, "seedWin": 58.0, "gain": 5.0,
                           "vs": [{"name": "Golem Night Witch", "likelihood": 0.6, "winRate": 64.0},
                                  {"name": "Log Bait", "likelihood": 0.4, "winRate": 61.5}],
                           "swaps": [{"out": "cannon", "in": "tesla", "pairs": 800}],
                           "seedName": "Hog Rider Musketeer", "seedSource": "yours",
                           "seed": list(HOG)}]}

    coach._build_for_duel = fake_build
    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider"])
    check("with a model the combined brain rates every row", r["engine"] == "combined"
          and all(d["engine"] in ("combined", "model") for d in r["decks"]), str(r["engine"]))
    check("the deck builder is asked to keep the named cards, and each deck's win conditions",
          built_calls and built_calls[-1]["keep"] == {"hog-rider"} and built_calls[-1]["wincons"] is True,
          str(built_calls[-1:]))
    check("it improves the decks SHOWN, at most CHOICE_IMPROVE_SEEDS of them",
          0 < len(built_calls[-1]["seeds"]) <= coach.CHOICE_IMPROVE_SEEDS
          and {key(c) for c in built_calls[-1]["seeds"]} == {key(d["cards"]) for d in r["decks"]})
    srcs = [d["source"] for d in r["decks"]]
    check("real decks lead and built decks follow", srcs == sorted(srcs, key=lambda x: x == "built")
          and "built" in srcs, str(srcs))
    mine = next(d for d in r["decks"] if d["source"] == "yours")
    imp = mine.get("improve")
    check("the builder's change rides on the deck it changes: the swap, the new rate, the gain",
          imp and imp["win"] == 63.0 and imp["seedWin"] == 58.0 and imp["gain"] == 5.0
          and imp["swaps"] == [{"out": "cannon", "in": "tesla", "pairs": 800}]
          and "tesla" in imp["cards"] and "hog-rider" in imp["cards"], str(imp))
    check("it carries its own matchup against each of their decks",
          imp and [v["name"] for v in imp["vs"]] == ["Golem Night Witch", "Log Bait"])
    check("a deck the builder did not change carries no improvement",
          all("improve" not in d for d in r["decks"] if d is not mine) and r["improved"] == 1)
    check("and it is not a second row — the list is still different decks",
          all(len(set(x["cards"]) & set(y["cards"])) < 6
              for i, x in enumerate(r["decks"]) for y in r["decks"][i + 1:]))
finally:
    for n, v in saved.items():
        setattr(coach, n, v)
    coach.counter.seeds, coach.counter._snap, coach.counter.seater = saved_seeds, saved_snap, saved_seater
    if saved_sg is None:
        sys.modules.pop("swap_graph", None)
    else:
        sys.modules["swap_graph"] = saved_sg

# The real builder honours `keep`: a swap that removes a named card is refused.
print("\nthe builder keeps the named cards")
try:
    import deck_builder as dbl
    seen_allow: list = []
    real_build = dbl.build

    def spy(seeds, score, graph, *, used=(), allow=None, **kw):
        new_without = [c for c in HOG if c != "hog-rider"] + ["ram-rider"]
        new_with = [c for c in HOG if c != "cannon"] + ["tesla"]
        seen_allow.append((allow(new_without, HOG), allow(new_with, HOG)))
        return []

    dbl.build = spy
    fake_sg = types.ModuleType("swap_graph")
    fake_sg.load = lambda: {"graph": {"cannon": [["tesla", 0.5, 800]]}, "decks": 1}
    saved_sg = sys.modules.get("swap_graph")
    sys.modules["swap_graph"] = fake_sg
    try:
        ctx = {"model": {"weights": {"pilot": 1.0}}, "decks": OPP["decks"],
               "kw": dict(my_def=None, opp_def=None, my_str=0.5, opp_str=0.5)}
        coach._build_for_duel(ctx, [{"cards": HOG, "source": "yours"}], None, set(), 0,
                              keep={"hog-rider"})
        check("a swap that takes a named card out is refused; one that keeps it is allowed",
              seen_allow == [(False, True)], str(seen_allow))
        seen_allow.clear()
        coach._build_for_duel(ctx, [{"cards": HOG, "source": "yours"}], None, set(), 0)
        check("with nothing named the builder is exactly as before",
              seen_allow == [(True, True)], str(seen_allow))
        seen_allow.clear()
        coach._build_for_duel(ctx, [{"cards": HOG, "source": "yours"}], None, set(), 0,
                              keep_win_conditions=True)
        check("asked to, it never trades the deck's own win condition away (Hog -> Ram Rider)",
              seen_allow == [(False, True)], str(seen_allow))
    finally:
        dbl.build = real_build
        if saved_sg is None:
            sys.modules.pop("swap_graph", None)
        else:
            sys.modules["swap_graph"] = saved_sg
except ImportError:
    print("  --   builder check skipped: deck_builder not importable here")

print("\nnothing here reads a database or the network")
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
