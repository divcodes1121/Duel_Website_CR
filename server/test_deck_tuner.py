"""test_deck_tuner.py — the swap brain's retrieval and ranking.

    python server/test_deck_tuner.py

Plain asserts and a counter, matching the other suites here. A real SQLite file
IS opened, but it is a temporary one this module writes — the same arrangement
`test_ops_snapshot.py` and `test_recent_battles.py` use, and for the same
reason: every figure here comes out of a join over real rows, and a hand-built
dict cannot test a join.

THE FIXTURE IS WRITTEN FROM THE PRODUCER'S SHAPE, NOT THE CONSUMER'S.
`CLAUDE.md` records `test_team_analysis.py` passing 59/59 against a field that
does not exist on any real record, because the fixture had invented the same
wrong name as the module. So the tables below carry the exact column names
`deck_counter` reads — `a_wins`, `a_losses`, `a_draws`, `a_crowns`, `b_crowns`,
`a_three`, `b_three`, `games` — and the deck hashes are sorted comma-joined card
lists, which is what `deck_hash` actually is.

WHAT IS WORTH TESTING, which is the half that would be quietly wrong rather
than broken:

  * THE BASE DECK MUST NOT BE ITS OWN SWAP. It is a sibling of itself at
    overlap 8, and a "swap" that changes nothing would rank first for ever
    because its delta is exactly zero and it is maximally comfortable;
  * BOTH DIRECTIONS OF THE PAIR TABLE must be counted, with the columns
    swapped on the reverse. Counting one direction reproduces the 58.6%
    tracked-player bias the symmetrisation exists to cancel;
  * THE ARCHETYPE COMES OFF THE OTHER SIDE OF THE PAIR, never off the sibling.
    Getting this backwards yields a table where every deck appears to have
    played only itself, and the win rates would still look plausible;
  * THE FLOOR IS THE MINIMUM, NOT THE MEAN. A swap that gains eight points
    against their likeliest deck and loses six against the other two is not an
    improvement, and only the minimum says so;
  * AN UNMEASURED ARCHETYPE IS SKIPPED, NEVER SCORED 50%. Averaging over an
    empty set flattens the ranking exactly when evidence is thinnest;
  * `MIN_GAMES` MUST BE THE SHARED FLOOR. A swap advisor applying a different
    one would disagree with the counter board about the same deck;
  * AN ILLEGAL CARD IS REFUSED, NOT DOWN-WEIGHTED. In a duel a card used by
    another deck of the loadout cannot be played, and a ranking that merely
    prefers legal swaps will eventually offer one that cannot be made.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


# --------------------------------------------------------------------------
# A database with KNOWN contents.
#
# BASE is a real-shaped Hog list. The three neighbours are one card different
# each; FAR is two different; STRANGER shares only four and must never appear.
# Card keys are real ones from `src/data/cards.json`, because
# `_archetype_of_hash` reads them against the win-condition map and an invented
# key would silently fall through to "other".
# --------------------------------------------------------------------------

def h(*cards: str) -> str:
    return ",".join(sorted(cards))


BASE = h("hog-rider", "musketeer", "cannon", "ice-golem",
         "skeletons", "the-log", "fireball", "bomber")

# One card different: bomber -> baby-dragon. The swap the suite follows.
N_DRAGON = h("hog-rider", "musketeer", "cannon", "ice-golem",
             "skeletons", "the-log", "fireball", "baby-dragon")

# One card different: cannon -> tesla.
N_TESLA = h("hog-rider", "musketeer", "tesla", "ice-golem",
            "skeletons", "the-log", "fireball", "bomber")

# One card different: musketeer -> valkyrie. Thin evidence on purpose.
N_VALK = h("hog-rider", "valkyrie", "cannon", "ice-golem",
           "skeletons", "the-log", "fireball", "bomber")

# Two cards different: still inside MAX_SWAP.
FAR = h("hog-rider", "musketeer", "cannon", "ice-golem",
        "skeletons", "the-log", "poison", "baby-dragon")

# Four cards shared only — below the >= 6 floor, must never be retrieved.
STRANGER = h("golem", "night-witch", "baby-dragon", "lightning",
             "skeletons", "the-log", "mega-minion", "tombstone")

# The opponents, one per archetype we score against.
OPP_GOLEM = h("golem", "night-witch", "baby-dragon", "lightning",
              "mega-minion", "tombstone", "zap", "elixir-collector")
OPP_LOON = h("balloon", "lumberjack", "barbarian-barrel", "arrows",
             "bats", "mega-minion", "tombstone", "musketeer")
OPP_XBOW = h("x-bow", "tesla", "archers", "knight",
             "the-log", "fireball", "ice-spirit", "skeletons")


def build(path: str) -> None:
    """`decks` + `pair_matchup_agg`, with the real column names.

    Rows are written in ONE direction only (`deck_a` = ours) except where a
    test needs the reverse, so the both-directions check below is meaningful
    rather than accidentally satisfied.
    """
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE decks (deck_hash TEXT PRIMARY KEY, win_condition TEXT);
        CREATE TABLE pair_matchup_agg (
            deck_a TEXT, deck_b TEXT, games INTEGER,
            a_wins INTEGER, a_losses INTEGER, a_draws INTEGER,
            a_crowns INTEGER, b_crowns INTEGER,
            a_three INTEGER, b_three INTEGER);
        CREATE INDEX ix_pair_a ON pair_matchup_agg(deck_a);
        CREATE INDEX ix_pair_b ON pair_matchup_agg(deck_b);
        """
    )
    for d in (BASE, N_DRAGON, N_TESLA, N_VALK, FAR, STRANGER,
              OPP_GOLEM, OPP_LOON, OPP_XBOW):
        con.execute("INSERT OR IGNORE INTO decks VALUES (?, ?)", (d, ""))

    def pair(a, b, w, l, d=0, forward=True):
        row = (a, b, w + l + d, w, l, d, 0, 0, 0, 0) if forward else \
              (b, a, w + l + d, l, w, d, 0, 0, 0, 0)
        con.execute("INSERT INTO pair_matchup_agg VALUES (?,?,?,?,?,?,?,?,?,?)", row)

    # BASE: even against golem, poor against balloon, good against x-bow.
    pair(BASE, OPP_GOLEM, 50, 50)      # 50.0
    pair(BASE, OPP_LOON, 30, 70)       # 30.0  <- the hole
    pair(BASE, OPP_XBOW, 60, 40)       # 60.0

    # N_DRAGON: the honest improvement. Fixes balloon, holds the rest.
    pair(N_DRAGON, OPP_GOLEM, 52, 48)  # 52.0
    pair(N_DRAGON, OPP_LOON, 55, 45)   # 55.0
    pair(N_DRAGON, OPP_XBOW, 58, 42)   # 58.0   floor 52.0

    # N_TESLA: THE MEAN TRAP. Huge against x-bow, worse against balloon.
    # Its mean beats N_DRAGON's; its floor is far worse. Ranking on the mean
    # would put this first, which is the bug the floor exists to prevent.
    pair(N_TESLA, OPP_GOLEM, 55, 45)   # 55.0
    pair(N_TESLA, OPP_LOON, 25, 75)    # 25.0   floor 25.0
    pair(N_TESLA, OPP_XBOW, 90, 10)    # 90.0

    # N_VALK: written in the REVERSE direction only, and with one archetype
    # under the MIN_GAMES floor.
    pair(N_VALK, OPP_GOLEM, 40, 20, forward=False)   # 40 w / 20 l after swap
    pair(N_VALK, OPP_LOON, 2, 1, forward=False)      # 3 games — under the floor

    # FAR: two cards different, real evidence.
    pair(FAR, OPP_GOLEM, 45, 55)
    pair(FAR, OPP_LOON, 60, 40)
    pair(FAR, OPP_XBOW, 50, 50)

    # STRANGER: plenty of games, but only four cards shared.
    pair(STRANGER, OPP_GOLEM, 99, 1)
    pair(STRANGER, OPP_LOON, 99, 1)

    con.commit()
    con.close()


# --------------------------------------------------------------------------

def main() -> int:
    tmp = tempfile.mkdtemp(prefix="tuner-")
    path = os.path.join(tmp, "battles.db")
    build(path)

    import clash_data as cd
    import deck_counter as counter
    import deck_tuner as tuner

    # Point every reader at the temp file and clear the caches the real module
    # would otherwise carry in from a previous run.
    cd._tier_paths = lambda: [path]
    counter._VOCAB = None
    counter._PROFILE_CACHE.clear()
    counter._CLUSTER_CACHE.clear()
    tuner._TUNE_CACHE.clear()

    base = BASE.split(",")
    archs = ["golem", "balloon", "xbow"]

    # -- what the fixture actually says, before anything is asserted about it --
    print("\nfixture")
    for d, name in ((BASE, "BASE"), (N_DRAGON, "N_DRAGON"), (N_TESLA, "N_TESLA")):
        p = counter.deck_profile(d.split(","))
        got = {a: p["archetypes"][a]["winRate"] for a in p["archetypes"]}
        print(f"  {name:9} {got}")

    print("\nvocabulary and retrieval")
    vocab = counter._vocabulary()
    check("vocabulary reads every stored deck", len(vocab) == 9, str(len(vocab)))

    sibs = counter._siblings(base)
    check("base is its own sibling at overlap 8", sibs.get(BASE) == 8, str(sibs.get(BASE)))
    check("one-card neighbour found at overlap 7", sibs.get(N_DRAGON) == 7,
          str(sibs.get(N_DRAGON)))
    check("two-card neighbour found at overlap 6", sibs.get(FAR) == 6, str(sibs.get(FAR)))
    check("a four-card stranger is NOT a sibling", STRANGER not in sibs,
          str(sibs.get(STRANGER)))

    nb = tuner.neighbours(base, archs)
    check("neighbours() drops the base deck itself", BASE not in nb["decks"],
          "the base would otherwise rank first with a zero delta for ever")
    check("neighbours() finds the one-card swap", N_DRAGON in nb["decks"])
    check("neighbours() finds the two-card swap", FAR in nb["decks"])
    check("neighbours() never returns the stranger", STRANGER not in nb["decks"])

    print("\nboth directions of the pair table")
    # N_VALK's rows were written REVERSED, so it is only reachable if the second
    # query runs and swaps its columns.
    check("a reverse-direction row is counted", N_VALK in nb["decks"],
          "only the deck_a query ran — the tracked-player bias is uncancelled")
    if N_VALK in nb["decks"]:
        # The row was STORED as the opponent's, with its perspective flipped:
        # `deck_a = OPP_GOLEM` holding 20 wins and 40 losses. Read back from
        # N_VALK's side it must come out 40 wins and 20 losses. Asserting the
        # stored numbers rather than the swapped ones is how a reverse query
        # that forgot to swap its columns would pass.
        g = nb["decks"][N_VALK]["archetypes"].get("golem")
        check("reverse row has wins and losses swapped correctly",
              bool(g) and g["wins"] == 40 and g["losses"] == 20,
              str(g))

    print("\nthe archetype comes off the OTHER side of the pair")
    dragon = nb["decks"].get(N_DRAGON, {}).get("archetypes", {})
    check("a neighbour is scored against golem", "golem" in dragon, str(list(dragon)))
    check("a neighbour is scored against balloon", "balloon" in dragon, str(list(dragon)))
    check("a neighbour is NOT scored against its own archetype",
          "hog" not in dragon,
          "the sibling hash leaked into the archetype slot: " + str(list(dragon)))

    print("\nthe MIN_GAMES floor")
    check("tuner reuses deck_counter's floor", tuner.MIN_GAMES == counter.MIN_GAMES == 8,
          f"{tuner.MIN_GAMES} vs {counter.MIN_GAMES}")
    valk = nb["decks"].get(N_VALK, {}).get("archetypes", {})
    check("a 3-game archetype is dropped by the floor", "balloon" not in valk,
          str(list(valk)))

    print("\nthe diff")
    gone, arrived = tuner.diff(base, N_DRAGON.split(","))
    check("diff names the card leaving", gone == ["bomber"], str(gone))
    check("diff names the card arriving", arrived == ["baby-dragon"], str(arrived))
    g2, a2 = tuner.diff(base, FAR.split(","))
    check("a two-card diff reports both", len(g2) == 2 and len(a2) == 2, f"{g2} {a2}")

    print("\nthe floor is the minimum, not the mean")
    r = tuner.rank(base, archs)
    check("the base deck's floor is its worst archetype",
          r["base"]["floor"] == 30.0 and r["base"]["floorArchetype"] == "balloon",
          str(r["base"]))
    by = {s["hash"]: s for s in r["swaps"]}
    check("N_DRAGON's floor is its worst, not its average",
          by[N_DRAGON]["floor"] == 52.0, str(by.get(N_DRAGON, {}).get("floor")))
    check("N_TESLA's floor is its balloon hole",
          by[N_TESLA]["floor"] == 25.0, str(by.get(N_TESLA, {}).get("floor")))
    check("N_TESLA's MEAN is higher than N_DRAGON's",
          by[N_TESLA]["expected"] > by[N_DRAGON]["expected"],
          f'{by[N_TESLA]["expected"]} vs {by[N_DRAGON]["expected"]} '
          "— if this fails the fixture no longer poses the trap")
    check("...but N_DRAGON RANKS FIRST, because ranking is on the floor",
          r["swaps"][0]["hash"] == N_DRAGON,
          "ranked on the mean: " + str(r["swaps"][0]["out"]))
    check("a swap that opens a hole has a NEGATIVE floor delta",
          by[N_TESLA]["floorDelta"] == -5.0, str(by[N_TESLA]["floorDelta"]))
    check("a swap that closes one has a positive floor delta",
          by[N_DRAGON]["floorDelta"] == 22.0, str(by[N_DRAGON]["floorDelta"]))
    check("both figures are reported, never one",
          by[N_DRAGON]["expected"] is not None and by[N_DRAGON]["floor"] is not None)

    print("\na delta is like-for-like, or it is not a delta")
    # THE BUG THIS PINS. N_VALK has evidence against golem ONLY. Its own floor
    # is 66.7 and the base's is 30.0 — but the base's 30.0 comes from BALLOON,
    # which N_VALK was never measured against. Subtracting those two credits the
    # swap with fixing a hole nothing looked at, and it ranked first on a +36.7
    # that meant nothing.
    check("a one-archetype swap still reports its own floor",
          by[N_VALK]["floor"] == 66.7, str(by[N_VALK]["floor"]))
    check("...but the DELTA is taken over the shared archetypes only",
          by[N_VALK]["comparedOn"] == ["golem"], str(by[N_VALK]["comparedOn"]))
    check("...against the base's figure for THOSE archetypes",
          by[N_VALK]["baseFloorHere"] == 50.0, str(by[N_VALK]["baseFloorHere"]))
    check("...so the delta is +16.7, not the flattering +36.7",
          by[N_VALK]["floorDelta"] == 16.7, str(by[N_VALK]["floorDelta"]))
    check("a fully measured swap is compared on the whole spread",
          sorted(by[N_DRAGON]["comparedOn"]) == ["balloon", "golem", "xbow"],
          str(by[N_DRAGON]["comparedOn"]))
    check("coverage says how much of the spread was measured",
          by[N_VALK]["coverage"] < by[N_DRAGON]["coverage"] == 1.0,
          f'{by[N_VALK]["coverage"]} {by[N_DRAGON]["coverage"]}')
    check("the thin swap no longer outranks the measured one",
          r["swaps"].index(by[N_DRAGON]) < r["swaps"].index(by[N_VALK]),
          "a swap measured on one archetype beat one measured on three")

    print("\nEVIDENCE BEFORE SIZE — the production defect")
    # FOUND ON THE FIRST LIVE RUN, 2026-09-05. The top six swaps were all
    # 15-25 games on one archetype of three, and the leader claimed +34.5pp.
    # `_comparable` had already made the delta honest, so the arithmetic was
    # right and the ADVICE was still bad: an 85.7% win rate over 25 games is
    # noise with a decimal point, and it outranked better-evidenced swaps
    # because coverage was only the second sort key.
    #
    # N_VALK is the fixture's thin swap: 60 games, one archetype. It is still
    # RETURNED — withholding a real option would be worse — but it must never
    # lead.
    check("SWAP_MIN_GAMES is stricter than the display floor",
          tuner.SWAP_MIN_GAMES > tuner.MIN_GAMES,
          f"{tuner.SWAP_MIN_GAMES} vs {tuner.MIN_GAMES}")
    check("a swap is marked thin when its deciding archetype is under-played",
          by[N_VALK]["thin"] is (by[N_VALK]["deltaGames"] < tuner.SWAP_MIN_GAMES),
          str(by[N_VALK]["deltaGames"]))
    check("the games behind the DELTA are reported, not just the deck's total",
          by[N_DRAGON]["deltaGames"] == 100, str(by[N_DRAGON]["deltaGames"]))
    thin = [s for s in r["swaps"] if s["thin"]]
    solid = [s for s in r["swaps"] if not s["thin"]]
    check("every well-evidenced swap outranks every thin one",
          all(r["swaps"].index(a) < r["swaps"].index(b)
              for a in solid for b in thin),
          "a thin swap outranked a measured one — the production defect is back")
    check("thin swaps are still returned, not deleted",
          len(r["swaps"]) == len(thin) + len(solid))
    check("the count of thin swaps shown is reported",
          r["thin"] == len(thin), f'{r["thin"]} vs {len(thin)}')

    print("\nan unmeasured archetype is skipped, never scored 50%")
    # N_VALK has golem only; balloon fell under the floor and xbow was never
    # played. Its floor must be golem's figure, not a 50 dragged in from nothing.
    if N_VALK in by:
        check("floor ignores archetypes with no evidence",
              by[N_VALK]["floor"] == by[N_VALK]["archetypes"]["golem"]["winRate"],
              str(by[N_VALK]["floor"]))
        check("the floor names which archetype it came from",
              by[N_VALK]["floorArchetype"] == "golem", str(by[N_VALK]["floorArchetype"]))

    print("\nlegality is a refusal, not a preference")
    r2 = tuner.rank(base, archs, used={"baby-dragon"})
    check("a swap onto a used card is removed entirely",
          all(s["hash"] != N_DRAGON for s in r2["swaps"]),
          "an illegal swap survived the filter")
    check("the refusal is counted and reported", r2["skipped"]["illegal"] >= 1,
          str(r2["skipped"]))
    check("legal swaps are unaffected", any(s["hash"] == N_TESLA for s in r2["swaps"]))

    print("\nthe veto")
    r3 = tuner.rank(base, archs, veto=lambda cards: "no air answer"
                    if "baby-dragon" not in cards else None)
    check("a vetoed swap is dropped", all(s["hash"] != N_TESLA for s in r3["swaps"]))
    check("the veto is counted", r3["skipped"]["vetoed"] >= 1, str(r3["skipped"]))
    check("rank() says whether the veto ran", r3["vetoed"] is True and r["vetoed"] is False,
          f'{r3["vetoed"]} {r["vetoed"]}')

    print("\ncomfort is a tiebreak, not a model")
    r4 = tuner.rank(base, archs, comfort={"baby-dragon"})
    cby = {s["hash"]: s for s in r4["swaps"]}
    check("a piloted incoming card is marked comfortable",
          cby[N_DRAGON]["comfortable"] is True)
    check("an unpiloted one is marked, not dropped",
          N_TESLA in cby and cby[N_TESLA]["comfortable"] is False)
    check("comfort does not overturn the floor",
          r4["swaps"][0]["hash"] == N_DRAGON)

    print("\nthe swap cap")
    check("MAX_SWAP matches the lowest cluster level",
          8 - min(counter.CLUSTER_LEVELS) == tuner.MAX_SWAP,
          f"{counter.CLUSTER_LEVELS} vs {tuner.MAX_SWAP}")
    check("a two-card swap is allowed", any(s["cards"] == 2 for s in r["swaps"]),
          str([s["cards"] for s in r["swaps"]]))
    check("every returned swap is within the cap",
          all(s["cards"] <= tuner.MAX_SWAP for s in r["swaps"]))

    print("\nreported working")
    check("the base reading is included", r["base"]["hash"] == BASE)
    check("the base is marked measured", r["base"]["measured"] is True)
    check("the archetypes asked for are echoed", r["archetypes"] == archs)
    check("sibling and scan counts are reported",
          r["siblings"] >= 4 and r["scanned"] == 9, f'{r["siblings"]} {r["scanned"]}')
    check("the floor's game count is carried", by[N_DRAGON]["floorGames"] == 100,
          str(by[N_DRAGON]["floorGames"]))

    print("\ndeterminism and caching")
    a = tuner.rank(base, archs)
    b = tuner.rank(base, archs)
    check("two identical calls rank identically",
          [s["hash"] for s in a["swaps"]] == [s["hash"] for s in b["swaps"]])
    check("the tuner cache is its own, not deck_counter's",
          tuner._TUNE_CACHE is not counter._CLUSTER_CACHE
          and len(tuner._TUNE_CACHE) > 0)
    before = dict(counter._CLUSTER_CACHE)
    tuner.rank(base, archs)
    check("ranking does not disturb _CLUSTER_CACHE",
          dict(counter._CLUSTER_CACHE) == before,
          "the counter screens' cache was evicted by a swap lookup")

    print("\nMODE B — the composer")
    # A pool shaped like `deck_counter._build_seeds()`'s real output: keyed by
    # archetype, each deck carrying its own per-archetype records. Written from
    # the PRODUCER's shape, not the consumer's.
    def seed(cards, games, **rates):
        return {"hash": ",".join(sorted(cards)), "cards": sorted(cards),
                "games": games,
                "archetypes": {a: {"winRate": r, "games": 200, "wins": 0,
                                   "losses": 0, "draws": 0}
                               for a, r in rates.items()}}

    # ALL-ROUNDER: nothing below 52. Should win on the floor.
    ALLROUND = ["hog-rider", "musketeer", "cannon", "ice-golem",
                "skeletons", "the-log", "fireball", "baby-dragon"]
    # SPECIALIST: crushes golem, folds to balloon. Higher MEAN, worse floor.
    SPECIAL = ["golem", "night-witch", "baby-dragon", "mega-minion",
               "tombstone", "lightning", "barbarian-barrel", "electro-dragon"]
    # BROKEN: no air answer at all — the veto must remove it however good the
    # numbers are.
    BROKEN = ["hog-rider", "knight", "cannon", "ice-golem",
              "skeletons", "the-log", "fireball", "valkyrie"]
    # DISJOINT pair for the loadout test: shares no card with ALLROUND.
    OTHER = ["x-bow", "tesla", "archers", "knight",
             "barbarian-barrel", "poison", "ice-spirit", "bats"]
    THIRD = ["balloon", "lumberjack", "mega-minion", "guards",
             "tombstone", "arrows", "rage", "minions"]

    pool = {
        "hog": [seed(ALLROUND, 900, golem=54.0, balloon=52.0, xbow=58.0),
                seed(BROKEN, 900, golem=70.0, balloon=70.0, xbow=70.0)],
        "golem": [seed(SPECIAL, 800, golem=80.0, balloon=31.0, xbow=64.0)],
        "xbow": [seed(OTHER, 700, golem=49.0, balloon=61.0, xbow=50.0)],
        "balloon": [seed(THIRD, 600, golem=57.0, balloon=48.0)],
    }

    import deck_harmony as harmony
    c = tuner.compose(archs, pool=pool, veto=harmony.veto)
    names = [x["hash"] for x in c["decks"]]
    check("the composer returns real decks from the pool",
          all(n in {seed(d, 0).get("hash") for d in
                    (ALLROUND, SPECIAL, BROKEN, OTHER, THIRD)} for n in names),
          str(names))
    check("it never invents a deck",
          all(len(x["deck"]) == 8 for x in c["decks"]))
    check("the all-rounder outranks the specialist",
          names.index(",".join(sorted(ALLROUND)))
          < names.index(",".join(sorted(SPECIAL))),
          "ranked on the mean: " + str(names))
    check("the specialist's own floor is its balloon hole",
          [x for x in c["decks"] if x["hash"] == ",".join(sorted(SPECIAL))][0]["floor"] == 31.0)
    check("a deck with no air answer is VETOED however good its numbers",
          ",".join(sorted(BROKEN)) not in names,
          "a 70/70/70 deck with no air answer was recommended")
    check("the veto is counted", c["skipped"]["vetoed"] >= 1, str(c["skipped"]))
    check("the pool is reported as ready", c["poolReady"] is True)
    check("the pool size is stated", c["poolSize"] == 5, str(c["poolSize"]))
    check("every composed deck carries a display name, never the raw key",
          all(x.get("name") and x["name"] != x["family"] for x in c["decks"]),
          str([(x.get("family"), x.get("name")) for x in c["decks"]]))

    print("\nevery offered deck can field all three special slots (2026-09-27)")
    # THE DECK A SCREENSHOT CAUGHT, offered as "Bridge Spam": Battle Ram and
    # P.E.K.K.A evolutions with a PLAIN Bandit in slot 2. No card in it can be
    # a hero and there is no champion, so slot 2 can never be special. It
    # passes the composition veto and is given the best numbers in the pool,
    # so only the slot rule can keep it out (proven: with `_full_loadout`
    # removed from `compose`, the first check below fails).
    #
    # THE FIXTURE IS NO LONGER THE SCREENSHOT'S EXACT EIGHT, AND THAT IS THE
    # RULE WORKING. That list held Electro Wizard, which gained a hero form on
    # 2026-10-06 — so the very deck that was reported as skipping a hero can
    # field one now, and is correctly offered. Mother Witch stands in for it
    # here (plain, and the veto still passes the list), because what this block
    # tests is a list with NO hero-capable card, not that one list. The check
    # below pins the other half so the swap cannot quietly stop meaning that.
    SCREENSHOT = ["battle-ram", "bandit", "pekka", "electro-wizard",
                  "fireball", "royal-ghost", "skeleton-dragons", "zap"]
    check("the screenshot's own list fields three now that Electro Wizard can be a hero",
          cd.fillable_slots(SCREENSHOT) == 3 and cd.slot_kind("electro-wizard") == "hero",
          f"{cd.fillable_slots(SCREENSHOT)} {cd.slot_kind('electro-wizard')!r}")
    NO_HERO = ["battle-ram", "bandit", "pekka", "mother-witch",
               "fireball", "royal-ghost", "skeleton-dragons", "zap"]
    check("the fixture really cannot field a hero, and the veto passes it",
          cd.fillable_slots(NO_HERO) == 2 and harmony.veto(NO_HERO) is None)
    slot_pool = dict(pool)
    slot_pool["bridge-spam"] = [seed(NO_HERO, 950, golem=90.0, balloon=90.0, xbow=90.0)]
    cs = tuner.compose(archs, pool=slot_pool, veto=harmony.veto)
    no_hero = ",".join(sorted(NO_HERO))
    check("a list that cannot field three special slots is never composed, however strong",
          no_hero not in [x["hash"] for x in cs["decks"]], str([x["hash"][:30] for x in cs["decks"]]))
    check("the skip is counted", cs["skipped"].get("slots") == 1, str(cs["skipped"]))
    check("and the rest of the list is exactly what it was",
          [x["hash"] for x in cs["decks"]] == names)

    def specials(view):
        return sum(1 for card in view["cards"][:3]
                   if (view.get("art") or {}).get(card) or cd.slot_kind(card) == "champion")

    check("every composed deck fields all three special slots",
          all(specials(x["view"]) == 3 for x in cs["decks"]),
          str([(x["view"]["cards"][:3], x["view"].get("art")) for x in cs["decks"]]))
    check("the deck and its view agree on the order",
          all(x["deck"] == x["view"]["cards"] for x in cs["decks"]))
    lo2 = tuner.loadout(archs, pool=slot_pool, veto=harmony.veto)
    check("the loadout never takes that list either",
          all(d["hash"] != no_hero for d in lo2["decks"]))
    check("`_offered` fills what `_view` leaves plain; `_view` still draws a record as fielded",
          specials(tuner._offered(ALLROUND)) == 3
          and set(tuner._offered(ALLROUND)["cards"]) == set(ALLROUND))

    print("\na deck whose cards duel players do not pair is skipped and replaced (2026-09-30)")
    # The gate is a callable `(cards) -> (passes, percentile)`. OTHER is the
    # pile here; the list must lose exactly it and keep the rest's order.
    pile = ",".join(sorted(OTHER))
    gate = lambda cards: ((",".join(sorted(cards)) != pile), 7 if ",".join(sorted(cards)) == pile else 64)
    synbase = tuner.compose(archs, pool=pool, veto=harmony.veto)
    gated = tuner.compose(archs, pool=pool, veto=harmony.veto, synergy=gate)
    check("the fixture's pile was offered before the gate",
          pile in [x["hash"] for x in synbase["decks"]])
    check("A DECK THAT FAILS THE SYNERGY GATE IS NEVER OFFERED, however good its floor",
          pile not in [x["hash"] for x in gated["decks"]])
    check("the skip is counted", gated["skipped"]["synergy"] == 1, str(gated["skipped"]))
    check("the rest keep their order",
          [x["hash"] for x in gated["decks"]] == [h for h in (x["hash"] for x in synbase["decks"]) if h != pile])
    check("every offered deck carries its synergy percentile",
          all(x["synergy"] == 64 for x in gated["decks"]))
    check("the report says a gate ran", gated["synergyGate"] is True and synbase["synergyGate"] is False)
    check("no gate = no percentile and nothing skipped",
          all(x["synergy"] is None for x in synbase["decks"]) and synbase["skipped"]["synergy"] == 0)
    lo_g = tuner.loadout(archs, pool=pool, veto=harmony.veto, synergy=gate)
    check("the loadout honours the gate too",
          all(d["hash"] != pile for d in lo_g["decks"]), str([d["hash"][:20] for d in lo_g["decks"]]))

    print("\nan empty pool is a SNAPSHOT problem, not 'no good decks'")
    c0 = tuner.compose(archs, pool={})
    check("an empty pool says so", c0["poolReady"] is False and c0["decks"] == [])

    print("\nlegality removes a deck, it does not rank it lower")
    c2 = tuner.compose(archs, pool=pool, used={"musketeer"}, veto=harmony.veto)
    check("a deck using a spent card is gone",
          ",".join(sorted(ALLROUND)) not in [x["hash"] for x in c2["decks"]])
    check("...and counted", c2["skipped"]["illegal"] >= 1, str(c2["skipped"]))

    print("\nfamiliarity is a count, not a score")
    c3 = tuner.compose(archs, pool=pool, comfort=set(ALLROUND), veto=harmony.veto)
    top = c3["decks"][0]
    check("a deck the player knows reports how many cards they have piloted",
          top["familiar"] == 8, str(top["familiar"]))
    check("it does not overturn the floor",
          c3["decks"][0]["hash"] == ",".join(sorted(ALLROUND)))

    print("\nthe loadout covers BETWEEN its decks")
    lo = tuner.loadout(archs, pool=pool, veto=harmony.veto)
    check("three decks are chosen", len(lo["decks"]) == 3, str(len(lo["decks"])))
    cards = [c for d in lo["decks"] for c in d["deck"]]
    check("THEY SHARE NO CARD — a duel loadout cannot",
          len(cards) == len(set(cards)),
          "the same card appears in two decks of one loadout")
    check("every archetype reports which deck answers it",
          all(c["by"] for c in lo["coverage"] if c["measured"]))
    check("the loadout floor is the worst archetype's BEST answer",
          lo["loadoutFloor"] == min(c["best"] for c in lo["coverage"] if c["measured"]),
          str(lo["loadoutFloor"]))
    check("the loadout floor beats any single deck's floor",
          lo["loadoutFloor"] >= max(x["floor"] for x in c["decks"]),
          f'{lo["loadoutFloor"]} vs {max(x["floor"] for x in c["decks"])} '
          "— three decks covering together should beat the best one alone")
    check("an unmeasured archetype is NAMED, not scored 50%",
          isinstance(lo["uncovered"], list))

    print("\nmid-duel the loadout is the REST of the duel, and never a spent card")
    # Reported: game 1 was a Giant Skeleton drill deck, and after it the
    # loadout offered a Giant Skeleton graveyard deck. The caller did not pass
    # the spent cards and this started from an empty set.
    spent = set(lo["decks"][0]["deck"])
    lo_mid = tuner.loadout(archs, pool=pool, veto=harmony.veto, used=spent, size=2)
    mid_cards = [c for d in lo_mid["decks"] for c in d["deck"]]
    check("no deck in a mid-duel loadout holds a card already played",
          not (set(mid_cards) & spent), str(sorted(set(mid_cards) & spent)))
    check("it asks for the games left, and says how many",
          lo_mid["size"] == 2 and len(lo_mid["decks"]) <= 2, str(len(lo_mid["decks"])))
    check("...and its decks still share no card with each other",
          len(mid_cards) == len(set(mid_cards)))
    check("the opening loadout reports size 3", lo["size"] == 3)

    print("\nMODE B, FOR THIS PLAYER — personalise (2026-09-25)")
    # Twelve production players against one opponent were handed ONE list.
    # Rows are compose's own shape: hash, deck, floor, family, archetype.
    def row(h, fam, floor, cards=None):
        cards = cards or [f"{h}-{i}" for i in range(8)]
        return {"hash": h, "deck": cards, "floor": floor, "family": fam,
                "archetype": fam, "familiar": 0}

    LAVA_CARDS = ["lava-hound", "balloon", "miner", "mega-minion",
                  "tombstone", "arrows", "fireball", "guards"]
    field = [row("xb1", "xbow", 64.8), row("go1", "golem", 63.0),
             row("ba1", "balloon", 62.1), row("ba2", "balloon", 60.1),
             row("rg1", "royal-giant", 59.3), row("rg2", "royal-giant", 59.3),
             row("hg1", "hog", 58.0), row("pk1", "pekka", 57.5),
             row("lv1", "lava", 57.0, LAVA_CARDS), row("lv2", "lava", 48.0),
             row("mn1", "miner", 56.0)]
    snapshot = [dict(r) for r in field]

    none = tuner.personalise(field, None)
    fams = [r["family"] for r in none]
    check("with no profile the lead is the best counter", none[0]["hash"] == "xb1")
    check("...and the list is one deck per family, not two Balloons and two RGs",
          len(fams) == len(set(fams)) == tuner.TOP_DECKS, str(fams))

    lava = {"cards": set(LAVA_CARDS), "families": {"lava": 216, "miner": 108}}
    xbow = {"cards": set(field[0]["deck"]), "families": {"xbow": 300}}
    lv = tuner.personalise(field, lava)
    xb = tuner.personalise(field, xbow)
    check("a Lava player is offered a Lava deck that still counters",
          any(r["hash"] == "lv1" and r["yours"] and r.get("reserved") for r in lv),
          str([(r["hash"], r.get("reserved")) for r in lv]))
    check("...but never one that LOSES its worst matchup (floor under 50)",
          all(r["hash"] != "lv2" for r in lv))
    check("two players with different playstyles get different lists",
          [r["hash"] for r in lv] != [r["hash"] for r in xb],
          str([r["hash"] for r in lv]))
    check("every lead is within the band of the best counter",
          all(p[0]["floor"] >= 64.8 - tuner.LEAD_BAND for p in (none, lv, xb)))
    check("a family they play may appear twice, any other once",
          all(sum(1 for r in lv if r["family"] == f) <= (2 if f in ("lava", "miner") else 1)
              for f in {r["family"] for r in lv}))
    check("`familiar` counts cards from ALL their play, not duel rows only",
          next(r for r in lv if r["hash"] == "lv1")["familiar"] == 8)
    check("the caller's rows are not written onto",
          [dict(r) for r in field] == snapshot)

    # Equal floors: the one built from their cards leads.
    even = [row("aa", "hog", 60.0), row("bb", "golem", 60.0, LAVA_CARDS)]
    check("between equal counters the one built from their cards leads",
          tuner.personalise(even, {"cards": set(LAVA_CARDS), "families": {}})[0]["hash"] == "bb")

    check("a win condition is theirs past 15 battles",
          tuner.playstyle_families({"lava": 16, "hog": 2000}) == {"lava", "hog"})
    check("...or past 5% of their battles, and not otherwise",
          tuner.playstyle_families({"xbow": 10, "hog": 100}) == {"xbow", "hog"}
          and tuner.playstyle_families({"xbow": 10, "hog": 1000}) == {"hog"})
    check("an empty list stays empty", tuner.personalise([], lava) == [])
    check("`other` is never a playstyle — it is the classifier's catch-all",
          tuner.playstyle_families({"other": 900, "hog": 100}) == {"hog"})
    check("...but it still counts toward the share, so a minor win condition "
          "is not inflated past 5%",
          tuner.playstyle_families({"other": 900, "hog": 90, "xbow": 10}) == {"hog"})
    check("the broken deck never enters the loadout either",
          all(d["hash"] != ",".join(sorted(BROKEN)) for d in lo["decks"]))

    print("\nPILOTABLE FIRST, AND THE LOADOUT IS THEIRS (2026-09-30)")
    # Two players, one opponent: one list reordered and ONE identical loadout,
    # including a Golem deck for a player who runs 1 of its 8 cards.
    GOLEM = ["golem", "elite-barbarians", "dark-prince", "musketeer", "phoenix",
             "fireball", "skeletons", "zap"]
    DRILL = ["goblin-drill", "giant-snowball", "ice-wizard", "poison", "goblin-hut",
             "fire-spirit", "skeletons", "knight"]
    MG = ["minion-giant", "goblinstein", "musketeer", "royal-ghost", "skeletons",
          "barbarian-barrel", "fireball", "goblin-hut"]
    duel_field = [row("go9", "golem", 65.8, GOLEM), row("mg9", "minion-giant", 64.4, MG),
                  row("dr9", "drill", 60.0, DRILL), row("xb9", "xbow", 64.0),
                  row("rg9", "royal-giant", 63.0), row("dr8", "drill", 49.0)]
    drill_player = {"cards": set(DRILL) | {"cannon", "tesla"}, "families": {"drill": 300}}
    got = tuner.personalise(duel_field, drill_player)
    hashes = [r["hash"] for r in got]
    check("a deck with 1/8 of their cards is labelled new to them",
          all(r["newToYou"] for r in got if r["hash"] == "go9"))
    check("their own win condition is offered when it still counters", "dr9" in hashes, str(hashes))
    check("...and a pilotable deck that LOSES its worst matchup is not", "dr8" not in hashes)
    check("the list fills with new-to-them decks that still win their worst matchup",
          sum(1 for r in got if r["newToYou"]) >= 2
          and all(r["floor"] >= tuner.STYLE_FLOOR for r in got), str(hashes))
    weak_field = duel_field + [row("gz9", "golem", 33.5)]
    got3 = tuner.personalise(weak_field, drill_player)
    check("a deck new to them must still win its worst matchup (no 33.5%-floor stranger)",
          all(r["hash"] != "gz9" for r in got3), str([(r["hash"], r["floor"]) for r in got3]))
    near_bar = [row("top", "hog", 66.0), row("mine", "drill", 55.0, DRILL)]
    got5 = tuner.personalise(near_bar + [row(f"v{i}", f"fam{i}", 54.0 - i) for i in range(6)],
                             {"cards": set(DRILL), "families": {}})
    check("a deck they can pilot that sits under the pilotable bar is still listed (not new to them)",
          any(r["hash"] == "mine" and not r["newToYou"] for r in got5), [(r["hash"], r["newToYou"]) for r in got5])
    wide = [row(f"w{i}", f"fam{i}", 60.0 - i) for i in range(8)]
    got4 = tuner.personalise(wide, {"cards": {"nothing"}, "families": {}})
    check("with nothing pilotable the list still has TOP_DECKS rows, all labelled new",
          len(got4) == tuner.TOP_DECKS and all(r["newToYou"] for r in got4), len(got4))
    check("new-to-them decks read after the pilotable ones",
          [r["newToYou"] for r in got[1:]] == sorted(r["newToYou"] for r in got[1:]))
    mg_player = {"cards": set(MG) | set(GOLEM[:5]), "families": {"minion-giant": 400}}
    got2 = tuner.personalise(duel_field, mg_player)
    check("inside the band a pilotable deck leads over a stronger stranger",
          got2[0]["hash"] == "mg9", str([r["hash"] for r in got2]))
    check("no profile: nothing is labelled new (the field's answer, as before)",
          not any(r.get("newToYou") for r in tuner.personalise(duel_field, None)))

    # The loadout, packed from each player's own pool. Five REAL decks that
    # share no card and can each field the three special slots.
    RG = ["royal-giant", "skeleton-king", "witch", "barbarian-barrel", "fisherman",
          "lightning", "tombstone", "zappies"]
    LAVA = ["baby-dragon", "mega-minion", "barbarians", "clone", "flying-machine",
            "giant-snowball", "lava-hound", "lumberjack"]
    DRILL2 = ["bats", "ice-wizard", "goblin-drill", "poison", "goblin-hut", "fire-spirit",
              "knight", "tesla"]
    MG2 = ["royal-ghost", "magic-archer", "cannon", "minion-giant", "goblinstein",
           "electro-spirit", "goblins", "arrows"]
    allc = [c for d in (GOLEM, RG, LAVA, DRILL2, MG2) for c in d]
    check("the loadout fixture really is card-disjoint", len(allc) == len(set(allc)) == 40)

    def seed(h, cards, rates):
        return {"hash": h, "cards": cards, "games": 500,
                "archetypes": {a: {"winRate": w, "games": 100, "wins": int(w)} for a, w in rates.items()}}
    ARCH = ["hog", "e-giant", "royal-hogs"]
    lpool = {
        "golem": [seed("G", GOLEM, {"hog": 70, "e-giant": 70, "royal-hogs": 70})],
        "royal-giant": [seed("R", RG, {"hog": 69, "e-giant": 69, "royal-hogs": 69})],
        "lava": [seed("L", LAVA, {"hog": 68, "e-giant": 68, "royal-hogs": 68})],
        "drill": [seed("D", DRILL2, {"hog": 60, "e-giant": 58, "royal-hogs": 61})],
        "minion-giant": [seed("M", MG2, {"hog": 62, "e-giant": 60, "royal-hogs": 59})],
    }

    def lhashes(profile):
        lo = tuner.loadout(ARCH, pool=lpool, size=3, profile=profile)
        return [d["hash"] for d in lo["decks"]], lo
    field_l, lo0 = lhashes(None)
    drill_l, lo1 = lhashes({"cards": set(DRILL2), "families": {"drill": 300}})
    mg_l, lo2 = lhashes({"cards": set(MG2), "families": {}})
    check("with no profile the loadout is the field's three", set(field_l) == {"G", "R", "L"}, str(field_l))
    check("a drill player's loadout holds their drill deck", "D" in drill_l, str(drill_l))
    check("a Minion Giant player's holds theirs", "M" in mg_l, str(mg_l))
    check("two players with different styles get different loadouts", drill_l != mg_l, f"{drill_l} {mg_l}")
    check("their own deck costs the loadout's floor nothing here (70 either way)",
          lo1["loadoutFloor"] == lo0["loadoutFloor"] == 70, f"{lo1['loadoutFloor']} {lo0['loadoutFloor']}")
    check("the loadout says it was packed for them", lo1["personal"] and not lo0["personal"])
    check("decks new to them are labelled in the loadout",
          all(d["newToYou"] == (d["hash"] != "D") for d in lo1["decks"]), str([(d["hash"], d["newToYou"]) for d in lo1["decks"]]))
    check("still no shared cards across the three",
          len({c for d in lo1["decks"] for c in d["deck"]}) == 8 * len(lo1["decks"]))
    # Their own decks all share cards: two pilotable lists that collide.
    D_TWIN = DRILL2[:7] + ["valkyrie"]
    lpool2 = dict(lpool, drill=[lpool["drill"][0], seed("D2", D_TWIN, {"hog": 61, "e-giant": 59, "royal-hogs": 60})])
    # LOADOUT_POOL = 2: their two colliding decks fill the candidate pool on
    # their own, which is the production case (a player with 24+ pilotable
    # lists), so only the whole-pool fallback can complete the loadout.
    _cap = tuner.LOADOUT_POOL
    tuner.LOADOUT_POOL = 2
    try:
        lo3 = tuner.loadout(ARCH, pool=lpool2, size=3,
                            profile={"cards": set(DRILL2) | {"valkyrie"}, "families": {"drill": 300}})
    finally:
        tuner.LOADOUT_POOL = _cap
    check("a pool that runs out of disjoint pilotable decks still fills the loadout",
          len(lo3["decks"]) == 3, str([d["hash"] for d in lo3["decks"]]))
    check("...with one of theirs and the rest labelled new",
          sum(1 for d in lo3["decks"] if not d["newToYou"]) == 1)

    print("\nseeds() degrades on an old snapshot")
    check("no snapshot gives an empty pool, not a crash",
          isinstance(counter.seeds(), dict))
    check("SEEDS_PER_ARCHETYPE and SEED_MIN_GAMES are stated",
          counter.SEEDS_PER_ARCHETYPE > 0 and counter.SEED_MIN_GAMES > 0)

    print("\ncoach.tune() ties the three together")
    # The route's actual entry point. Mode A (swaps), Mode B (whole decks) and
    # the loadout must all come back from ONE call, because the panel shows
    # them together and a partial answer would look like a missing feature.
    import coach
    counter._snapshot = {"seeds": pool, "computedAt": 0, "cells": {},
                         "archetypes": archs, "reps": {}}
    opp_decks = [{"cards": OPP_GOLEM.split(","), "prob": 0.5},
                 {"cards": OPP_LOON.split(","), "prob": 0.3},
                 {"cards": OPP_XBOW.split(","), "prob": 0.2}]
    t2 = coach.tune(base, opp_decks)
    check("tune() returns something", t2 is not None)
    if t2:
        check("...with the swaps", "swaps" in t2 and isinstance(t2["swaps"], list))
        check("...with the harmony reading", "harmony" in t2 and "counts" in t2["harmony"])
        check("...with composed decks", "compose" in t2)
        check("...with a loadout", "loadout" in t2)
        check("...and the opponent's archetype weights",
              isinstance(t2.get("weights"), dict) and len(t2["weights"]) >= 1,
              str(t2.get("weights")))
        check("the spread sums the probabilities of decks sharing an archetype",
              abs(sum(t2["weights"].values()) - 1.0) < 0.01,
              str(t2["weights"]))
        if t2.get("compose"):
            check("the composer never offers back the deck being played",
                  all(d["hash"] != ",".join(sorted(set(base)))
                      for d in t2["compose"]["decks"]))
    check("tune() refuses a deck that is not 8 cards",
          coach.tune(base[:6], opp_decks) is None)
    check("tune() refuses an empty opponent spread",
          coach.tune(base, []) is None)
    counter._snapshot = None

    print("\ndegradation")
    cd._tier_paths = lambda: []
    counter._VOCAB = None
    tuner._TUNE_CACHE.clear()
    n0 = tuner.neighbours(base, archs)
    check("no database gives an empty result, not a crash",
          n0["decks"] == {} and n0["found"] == 0, str(n0))

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
