"""test_coach_choice.py — decks around the cards the reader names.

    python server/test_coach_choice.py

No database. The rules (`coach_choice.py`) are pure and tested against
literals; the wiring (`coach.chosen`) is driven with every reader replaced, on
real card keys so the structural checks it calls are the real ones. The
builder itself is tested in `test_deck_architect.py`.
"""

from __future__ import annotations

import os
import sys

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


HOG7 = ["hog-rider", "musketeer", "cannon", "fireball", "the-log", "ice-spirit", "skeletons"]
HOG = HOG7 + ["ice-golem"]
HOG_K = HOG7 + ["knight"]
HOG_V = HOG7 + ["valkyrie"]
HOG_EQ = ["hog-rider", "firecracker", "tesla", "earthquake", "the-log", "ice-spirit", "skeletons", "valkyrie"]
GOLEM = ["golem", "night-witch", "baby-dragon", "lightning", "tornado", "lumberjack", "mega-minion",
         "barbarian-barrel"]
BAIT = ["goblin-barrel", "princess", "knight", "rocket", "goblin-gang", "inferno-tower", "ice-spirit",
        "the-log"]
MINER = ["miner", "poison", "wall-breakers", "knight", "bats", "spear-goblins", "bomb-tower", "the-log"]
CAT_HOG = ["hog-rider", "executioner", "tornado", "rocket", "goblins", "mini-pekka", "bats",
           "barbarian-barrel"]
CAT_THIN = ["hog-rider", "firecracker", "mighty-miner", "earthquake", "goblins", "bomb-tower",
            "electro-spirit", "barbarian-barrel"]
KNOWN = set(HOG + HOG_EQ + GOLEM + BAIT + MINER + ["pekka", "bandit", "x-bow"])


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
check("the substitution path is gone: no `forced`, no one-card swap into a stranger's deck",
      not hasattr(cc, "forced") and not hasattr(cc, "FORCED_MIN_PAIRS"))


# ── Which lists the combined brain rates ────────────────────────────────────
print("\nthe shortlist")


def cand(n, source, fast=None, plays=0, **kw):
    return {"cards": [f"{source}{n}-{i}" for i in range(8)], "source": source,
            "fast": fast, "plays": plays, **kw}


many = ([cand(i, "yours", 50 + i) for i in range(6)]
        + [cand(i, "duel", 60 + i, plays=1000 - 10 * i) for i in range(30)]
        + [cand(i, "meta", 55 + i) for i in range(20)] + [cand(i, "built", 58 + i) for i in range(20)])
sl = cc.shortlist(many)
per = {s: sum(1 for c in sl if c["source"] == s) for s in cc.SOURCES}
check("never more than FINALISTS", len(sl) == cc.FINALISTS == sum(cc.QUOTA.values()), str(len(sl)))
check("each source gets its quota when it can fill it", per == cc.QUOTA, str(per))
check("duel decks hold the largest share of the shortlist", cc.QUOTA["duel"] == max(cc.QUOTA.values()))
duel = [c for c in sl if c["source"] == "duel"]
most_played = sorted(duel, key=lambda c: -c["plays"])[:cc.QUOTA["duel"] // 2]
check("HALF the duel lists rated are simply the most duel-played",
      [c["plays"] for c in most_played] == [1000 - 10 * i for i in range(cc.QUOTA["duel"] // 2)],
      str([c["plays"] for c in most_played]))
check("…and the other half are the quick model's favourites",
      sorted((c["fast"] for c in duel), reverse=True)[:cc.QUOTA["duel"] // 2]
      == [89 - i for i in range(cc.QUOTA["duel"] // 2)], str(sorted(c["fast"] for c in duel)))
# The reported fault: 148 lists, the most-played (1,348 duel games) scored low
# by the quick model and was never rated.
field = [cand(i, "duel", 70 - i * 0.1, plays=14) for i in range(147)] + [cand("big", "duel", 20.0, plays=1348)]
check("the most duel-played list is ALWAYS rated, however the quick model scores it",
      any(c["plays"] == 1348 for c in cc.shortlist(field)))
check("a source that is not evidence-first is by the quick model alone",
      [c["fast"] for c in sl if c["source"] == "meta"] == [74, 73, 72, 71] and "meta" not in cc.EVIDENCE_FIRST)
only_meta = [cand(i, "meta", 50 + i) for i in range(40)]
check("a request only one source can answer still gets a full shortlist",
      len(cc.shortlist(only_meta)) == cc.FINALISTS)
nofast = [cand(1, "meta", None, plays=5), cand(2, "meta", None, plays=90)]
check("with no model the most-played lead", cc.shortlist(nofast)[0]["plays"] == 90)
dup = [dict(cand(1, "yours", 40), cards=HOG), dict(cand(1, "duel", 70), cards=list(reversed(HOG)))]
got = cc.shortlist(dup)
check("one deck in two sources is rated once, as the more trusted source",
      len(got) == 1 and got[0]["source"] == "yours", str(got))
pinned = [cand(i, "meta", 90 - i) for i in range(10)] + [cand("p", "meta", 1.0, pin=True)]
check("a pinned list is rated whatever its rank (the builder's own pick)",
      any(c.get("pin") for c in cc.shortlist(pinned, quota={"meta": 3}, limit=3)))


# ── The order ───────────────────────────────────────────────────────────────
print("\nthe order")


def row(name, win, strong=False, source="meta", plays=0, **kw):
    return {"cards": [f"{name}{i}" for i in range(8)], "win": win, "source": source, "plays": plays,
            "duel": {"strong": strong} if strong is not None else None, "name": name, **kw}


names = lambda rows: [r["name"] for r in rows]
check("the higher win chance leads", names(cc.order([row("a", 52.0), row("b", 58.0)])) == ["b", "a"])
check("a duel-proven deck leads one within the band",
      names(cc.order([row("plain", 58.0), row("proven", 56.0, strong=True)])) == ["proven", "plain"])
check("but not one clearly better — proof breaks near-ties, it does not overrule",
      names(cc.order([row("plain", 60.0), row("proven", 56.0, strong=True)])) == ["plain", "proven"])
check("the band is three points, Coach Assist's lead margin", cc.DUEL_BAND == coach.LEAD_MARGIN == 3.0)
check("an unrated deck comes after every rated one",
      names(cc.order([row("none", None), row("low", 41.0)])) == ["low", "none"])
check("a row with no duel figures at all is simply not proven",
      names(cc.order([row("nofig", 55.0, strong=None), row("p", 54.0, strong=True)])) == ["p", "nofig"])
# Evidence before size: the reported list led with a 14-game deck.
thin_hi = row("thin", 60.0, source="duel", plays=14)
solid_lo = row("solid", 46.0, source="duel", plays=321)
check("a THIN duel list (under 30 duel games) ranks after every proven one, whatever it rates",
      names(cc.order([thin_hi, solid_lo])) == ["solid", "thin"] and cc.PROVEN_GAMES == 30)
check("exactly at the floor a list is proven", not cc.thin(row("x", 50.0, source="duel", plays=30))
      and cc.thin(row("y", 50.0, source="duel", plays=29)))
check("only duel lists can be thin — the player's own deck is not here for its duel record",
      not cc.thin(row("m", 50.0, source="yours", plays=1)) and not cc.thin(row("l", 50.0, source="meta", plays=0)))
a = cc.order([row("x", 50.0), row("y", 50.0)])
check("identical evidence orders identically", names(a) == names(cc.order(list(reversed(a)))))


# ── What is shown ───────────────────────────────────────────────────────────
print("\nwhat is shown: duel decks, then yours, the meta, then built")

duels = [row(f"d{i}", 60.0 - i, source="duel", plays=100) for i in range(7)]
mine = [row(f"y{i}", 40.0 - i, source="yours", plays=5) for i in range(3)]
meta = [row(f"m{i}", 70.0 - i, source="meta", plays=900) for i in range(4)]
made = [row(f"b{i}", 80.0 - i, source="built", architect={"shell": {"rank": i}}) for i in range(5)]
shown = cc.arrange(duels + mine + meta + made, ["x"])
check("sections come in the order duel, yours, meta, built",
      [r["section"] for r in shown] == ["duel"] * 4 + ["yours"] * 2 + ["meta"] * 2 + ["built"] * 3,
      str([r["section"] for r in shown]))
check("duel decks lead even when a ladder deck rates higher (70 vs 60)",
      shown[0]["name"] == "d0" and cc.SHOW["duel"] == max(cc.SHOW.values()))
check("each section keeps its own order", names(shown) ==
      ["d0", "d1", "d2", "d3", "y0", "y1", "m0", "m1", "b0", "b1", "b2"], str(names(shown)))
check("a built deck never outranks a real one — it has its own section", cc.SECTIONS[-1] == "built")
twin = dict(row("twin", 65.0, source="duel", plays=500), cards=mine[0]["cards"][:7] + ["zz"])
kept = cc.arrange([twin] + duels + mine, ["x"])
check("a duel list one card from the player's own deck: THEIR deck stands for both",
      "twin" not in names(kept) and "y0" in names(kept), str(names(kept)))
same = dict(row("same", 90.0, source="built", architect={"shell": {"rank": 0}}), cards=list(duels[0]["cards"]))
check("a built deck that IS a deck already shown is not shown twice",
      "same" not in names(cc.arrange(duels + [same], ["x"])))
close = dict(row("close", 50.0, source="built", architect={"shell": {"rank": 0}}),
             cards=duels[0]["cards"][:7] + ["zz"])
check("…but one card from a real list is what a build is, and it stays",
      "close" in names(cc.arrange(duels + [close], ["x"])))
one_shell = [row(f"s{i}", 80.0 - i, source="built", architect={"shell": {"rank": 0}}) for i in range(3)]
other = row("o", 50.0, source="built", architect={"shell": {"rank": 1}})
picked = names(cc.arrange(one_shell + [other], ["x"]))
check("one build per way of playing the card before any gets a second",
      "o" in picked and picked[:2] == ["s0", "s1"] and len(picked) == 3, str(picked))
real_pick = row("rp", 30.0, source="duel", plays=40, architect={"shell": {"rank": 2}})
lost = cc.arrange(duels + [real_pick], ["x"])
check("a real list the builder arrived at that missed its own section is shown with the builds",
      [r["section"] for r in lost if r["name"] == "rp"] == ["built"], str(names(lost)))
check("with four cards named, decks one card apart are still the same answer",
      cc.same_at(["a", "b", "c", "d"]) == 7 and cc.same_at(["a"]) == 6)


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
    """`_Rates`' surface: a fused rate keyed on my deck."""
    table: dict = {}
    duel_ctx = None

    def __init__(self, snap):
        self.on = True
        self.duel = FakeRates.duel_ctx

    def prepare(self, mine, theirs):
        pass

    def rate(self, mine, theirs=None, archetype=None):
        r = FakeRates.table.get(key(mine))
        return None if r is None else {"winRate": r, "games": 120, "source": "version",
                                       "tier": "high", "interval": None, "decks": None}

    def summary(self):
        return None


OPP = {"decks": [{"cards": GOLEM, "prob": 0.6, "deckName": "Golem Night Witch", "archetype": "golem"},
                 {"cards": BAIT, "prob": 0.4, "deckName": "Log Bait", "archetype": "bait"}],
       "source": "opponent-history", "nCandidates": 2}


def cat(cards, games, wins, players):
    return {"key": key(cards), "cards": sorted(cards), "archetype": "hog", "games": games,
            "wins": wins, "players": players, "records": {}}


def lst(cards, games, wins, players=None):
    return {"key": key(cards), "cards": sorted(cards), "archetype": "hog", "games": games,
            "wins": wins, "players": games if players is None else players, "topPilot": 1}


# Every duel list holding Hog Rider: the 2.6 shell (a seven-card core and one
# slot its pilots vary), and two catalogue lists of other shells.
DUEL_LISTS = [lst(HOG, 300, 160), lst(HOG_K, 100, 50), lst(HOG_V, 60, 30),
              lst(CAT_HOG, 140, 80, 31), lst(CAT_THIN, 14, 10, 8)]

saved = {n: getattr(coach, n) for n in
         ("_history", "opponent_next", "_Rates", "_own_decks", "_archetype", "_brain_ctx",
          "_drop_event_decks", "_synergy_gate", "_duel_projection", "_build_for_duel", "_duel_lists")}
saved_seeds, saved_snap, saved_seater = coach.counter.seeds, coach.counter._snap, coach.counter.seater
built_calls: list = []
asked_lists: list = []
try:
    coach._history = lambda tag, since=None, until=None: {"allDecks": [], "series": [],
                                                          "marks": lambda c: {}, "arch": lambda c: ""}
    coach.opponent_next = lambda tag, played, hist=None: OPP
    coach._Rates = FakeRates
    coach._archetype = lambda cards: next((a for c, a in (("hog-rider", "hog"), ("golem", "golem"),
                                                          ("miner", "miner"), ("goblin-barrel", "bait"))
                                           if c in cards), "other")
    coach._brain_ctx = lambda opp, me, them: None          # the fused rate answers
    coach._drop_event_decks = lambda decks: (list(decks), 0)
    coach._synergy_gate = lambda: None
    coach._duel_projection = lambda rates, opp, tag, win: ({"golem": 0.6, "bait": 0.4}, 0.0)
    coach.counter._snap = lambda: None
    coach.counter.seater = lambda: (lambda cards: (list(cards), {}, True))
    coach.counter.seeds = lambda: {"hog": [{"hash": key(HOG_EQ), "cards": sorted(HOG_EQ), "games": 900,
                                           "archetypes": {}}],
                                  "miner": [{"hash": key(MINER), "cards": sorted(MINER), "games": 500,
                                             "archetypes": {}}]}
    coach._own_decks = lambda tag, since, until, hist, rates: (
        {key(HOG): {"cards": HOG, "plays": 40}}, set(HOG))

    def duel_lists(cards):
        asked_lists.append(list(cards))
        return [dict(d) for d in DUEL_LISTS if set(cards) <= set(d["cards"])]

    coach._duel_lists = duel_lists
    FakeRates.duel_ctx = FakeDuel([cat(CAT_HOG, 140, 80, 31), cat(CAT_THIN, 14, 10, 8)], strong=[CAT_HOG])
    FakeRates.table = {key(HOG): 58.0, key(HOG_EQ): 54.0, key(CAT_HOG): 46.0, key(CAT_THIN): 66.0,
                       key(HOG_V): 51.0, key(HOG_K): 49.0, key(MINER): 70.0}

    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider"])
    decks = r["decks"]
    check("every deck returned holds the named card",
          decks and all("hog-rider" in d["cards"] for d in decks), str([d["cards"][:2] for d in decks]))
    check("a deck without it is never offered, however good (Miner 70%)",
          all("miner" not in d["cards"] for d in decks))
    check("duel decks come first, then the player's own, then the meta",
          [d["section"] for d in decks] == ["duel", "duel", "yours", "meta"], str([d["section"] for d in decks]))
    check("the proven duel list (140 games, 46%) leads the thin one (14 games, 66%)",
          [d["plays"] for d in decks[:2]] == [140, 14] and decks[0]["win"] < decks[1]["win"],
          str([(d["plays"], d["win"]) for d in decks[:2]]))
    check("each row carries its win chance and the matchup against EACH of their decks",
          all(d["win"] is not None and [v["name"] for v in d["vs"]] == ["Golem Night Witch", "Log Bait"]
              for d in decks), str(decks[0]["vs"]))
    check("a duel deck carries its real duel record and pilots",
          decks[0]["duelRecord"] == [140, 80] and decks[0]["players"] == 31)
    check("the builder read EVERY duel list holding the card, not only the catalogue",
          asked_lists == [["hog-rider"]] and r["corpus"] == {"decks": 5, "games": 614}, str(r.get("corpus")))
    mine_row = next(d for d in decks if d["section"] == "yours")
    ar = mine_row.get("architect")
    check("with no model the shell's consensus build IS the player's own list — and says so on that row",
          ar and ar["shell"]["decks"] == 3 and ar["tuned"] == [] and ar["nearest"]["shared"] == 8,
          str(ar))
    check("so nothing is listed twice: no separate built row for a deck already shown",
          all(d["section"] != "built" for d in decks) and r["counts"]["built"] == 0)
    check("how much of each deck the player already plays is counted",
          mine_row["familiar"] == 8 and decks[0]["familiar"] < 8)
    check("the counts say how many decks held the card, per source",
          r["counts"] == {"yours": 1, "duel": 2, "meta": 1, "built": 0}, str(r["counts"]))
    check("with no trained model the engine is the fused rate, and says so",
          r["engine"] == "fused" and all(d["engine"] == "fused" for d in decks))
    check("the request is echoed back", r["want"] == ["hog-rider"] and r["reason"] is None
          and r["brain"] == cc.BRAIN)

    r = coach.chosen("#ME", "#OPP", [HOG], [GOLEM], ["hog-rider"])
    check("a named card already spent this duel is REPORTED and nothing is offered",
          r["spent"] == ["hog-rider"] and r["decks"] == [] and r["reason"] == "spent", str(r))

    spent = ["fireball", "zap", "arrows", "giant", "witch", "minions", "bomber", "archers"]
    r = coach.chosen("#ME", "#OPP", [spent], [GOLEM], ["hog-rider"])
    check("no deck offered shares a card with what has been played (their own Hog has Fireball)",
          r["decks"] and all(not (set(d["cards"]) & set(spent)) for d in r["decks"]),
          str([d["source"] for d in r["decks"]]))
    check("…so the player's own deck is out, and the stage is game 2",
          "yours" not in {d["source"] for d in r["decks"]} and r["stage"] == 1)

    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider", "earthquake"])
    check("two named cards: only decks holding BOTH",
          r["decks"] and all({"hog-rider", "earthquake"} <= set(d["cards"]) for d in r["decks"]),
          str([d["cards"] for d in r["decks"]]))

    r = coach.chosen("#ME", "#OPP", [], [], ["golem", "hog-rider"])
    check("cards nobody plays together: nothing found, nothing built, and the reason",
          r["decks"] == [] and r["reason"] == "none" and r["counts"]["built"] == 0)
    check("…and the builder was NOT asked to force one of them into the other's decks",
          asked_lists[-1] == ["golem", "hog-rider"], str(asked_lists[-1]))

    r = coach.chosen("#ME", "#OPP", [], [], ["nonsense"])
    check("only unknown cards named: nothing asked, the key echoed",
          r["reason"] == "no_cards" and r["dropped"] == ["nonsense"] and r["decks"] == [])

    # An event deck is refused whoever played it.
    coach._drop_event_decks = lambda decks: ([d for d in decks if key(d["cards"]) != key(HOG_EQ)], 1)
    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider", "earthquake"])
    check("an event deck is never offered",
          all(key(d["cards"]) != key(HOG_EQ) for d in r["decks"]), str([d["cards"] for d in r["decks"]]))
    coach._drop_event_decks = lambda decks: (list(decks), 0)

    # A structural hole: a meta list that cannot field three special slots.
    real_slots = coach.cd.fillable_slots
    coach.cd.fillable_slots = lambda cards: 2 if key(cards) == key(HOG_EQ) else real_slots(cards)
    r = coach.chosen("#ME", "#OPP", [], [], ["hog-rider", "tesla"])
    check("a stranger's deck that cannot field three special slots is not offered",
          r["decks"] == [], str([d["cards"] for d in r["decks"]]))
    coach.cd.fillable_slots = real_slots

    # With a trained model: it fills the shell's open slot against THIS
    # opponent, the combined brain rates, and the swap builder keeps the cards.
    model = {"weights": {"p:valkyrie": 2.0}}
    ctx = {"model": model, "decks": OPP["decks"],
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
    built = [d for d in r["decks"] if d["section"] == "built"]
    check("with a model Deckkies BUILDS: the shell's core, the open slot chosen for this opponent",
          len(built) == 1 and set(built[0]["cards"]) == set(HOG_V) and built[0]["source"] == "built",
          str([d["cards"] for d in built]))
    ar = built[0]["architect"]
    check("the build says what was core, what was chosen, and what the opponent changed",
          set(ar["core"]) == set(HOG7) and ar["flex"] == ["valkyrie"] and ar["tuned"] == ["valkyrie"], str(ar))
    check("…and which way of playing the card it rests on: its lists and duel games",
          ar["shell"]["decks"] == 3 and ar["shell"]["games"] == 460 and ar["shell"]["wins"] == 240, str(ar["shell"]))
    check("a build that HAS been fielded as listed carries that list's real duel record",
          built[0]["real"] == [60, 30, 60] and ar["nearest"]["shared"] == 8, str(built[0].get("real")))
    check("built decks come after every real one", [d["section"] for d in r["decks"]][-1] == "built"
          and r["counts"]["built"] == 1)
    check("with a model the combined brain rates every row", r["engine"] == "combined"
          and all(d["engine"] in ("combined", "model") for d in r["decks"]), str(r["engine"]))
    check("the swap builder is asked to keep the named cards, and each deck's win conditions",
          built_calls and built_calls[-1]["keep"] == {"hog-rider"} and built_calls[-1]["wincons"] is True,
          str(built_calls[-1:]))
    check("it improves the decks SHOWN, at most CHOICE_IMPROVE_SEEDS of them",
          0 < len(built_calls[-1]["seeds"]) <= coach.CHOICE_IMPROVE_SEEDS
          and {key(c) for c in built_calls[-1]["seeds"]} <= {key(d["cards"]) for d in r["decks"]})
    mine_row = next(d for d in r["decks"] if d["source"] == "yours")
    imp = mine_row.get("improve")
    check("its change rides on the deck it changes: the swap, the new rate, the gain",
          imp and imp["win"] == 63.0 and imp["seedWin"] == 58.0 and imp["gain"] == 5.0
          and imp["swaps"] == [{"out": "cannon", "in": "tesla", "pairs": 800}]
          and "tesla" in imp["cards"] and "hog-rider" in imp["cards"], str(imp))
    check("a deck the swap builder did not change carries no improvement",
          all("improve" not in d for d in r["decks"] if d is not mine_row) and r["improved"] == 1)

    # A build may not hold a card already spent, and a spent core card leaves the core.
    r = coach.chosen("#ME", "#OPP", [["valkyrie", "zap", "arrows", "giant", "witch", "minions", "bomber",
                                      "archers"]], [GOLEM], ["hog-rider"])
    check("mid-duel, no build holds a card already played (Valkyrie is spent)",
          all("valkyrie" not in d["cards"] for d in r["decks"]), str([d["cards"] for d in r["decks"]]))
finally:
    for n, v in saved.items():
        setattr(coach, n, v)
    coach.counter.seeds, coach.counter._snap, coach.counter.seater = saved_seeds, saved_snap, saved_seater

# The real swap builder honours `keep`: a swap that removes a named card is refused.
print("\nthe swap builder keeps the named cards")
try:
    import types

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
