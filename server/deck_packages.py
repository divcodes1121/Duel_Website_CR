"""WHAT DUEL PLAYERS PUT AROUND A WIN CONDITION — and is this deck one of those?

    python3 deck_packages.py --build              # rebuild .deck_packages.json
    python3 deck_packages.py --report             # win conditions, ranked
    python3 deck_packages.py --report hog-rider   # its spells, buildings, cards
    python3 deck_packages.py --report hog-rider friendly

Asked for (2026-10-07), looking at "Deckkies built for this duel": "these decks
don't make sense — at least check the synergy of the spells in the deck, the
buildings in the deck, the support cards in the deck", and then: "from the
duels data check what all spells are combined with win cons and rank them, in
competitive [friendly duels], which support cards are best, which win cons are
best".

The deck that prompted it: a Log Bait list with Rocket -> Freeze and The Log ->
Arrows. Each swap is one real players make on its own (38 and 401 deck pairs);
the deck that RESULTS is a bait deck with no Log and no big spell, whose spell
set is in 0.24% of Goblin Barrel deck-games. Nothing looked at the result.

THE TABLE IS COUNTED. For every win condition, over every deck fielded in a
native duel game in the window:

    spells      the exact SET of spells in the deck (a package, not a card)
    buildings   the exact set of buildings
    cards       every other card, one at a time

each with games, wins, the wins the two pilots' own records predicted (log5 of
their running duel records, so "best" is not "played by the best players"),
and distinct pilots. Two populations: every duel, and FRIENDLY duels alone —
scrims and tournament matches, the competitive ones.

THE CHECK (`check`) is three measures of a deck against its own win condition:

    spell    share of that win condition's deck-games that run exactly these spells
    building the same for its buildings
    card     the share for its LEAST-run other card

IT PREDICTS DUEL RESULTS, AND THAT WAS MEASURED BEFORE IT WAS USED (2026-10-07;
packages counted on the first 75% of duels by time, results on the last 25%,
decks with under 30 duel games of their own, each pilot's record taken out):

    least-run card under 0.5% of its win condition's decks   -6.4 points
                   0.5 - 2%                                   -3.3
                   2 - 5%                                     -0.4
                   5% and over                                +1.6
    spell set under 0.1%                                      -4.6
              0.1 - 0.5%                                      -1.8
              5% and over                                     +0.9

A GATE FOR DECKS DECKKIES CONSTRUCTS, never a verdict on a deck a player
brings: a real list is its own evidence. A constructed deck passes a measure
when it clears the gate OR is no worse on it than the deck it was built from
(a swap may not make a package rarer than it found it).

Reads the duel index read-only. Writes only its own file. The core is pure:
`table_from` takes the games and a `role_of`, and knows no card.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import sys
import threading
import time

BRAIN = "deck-packages-1.0"

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, ".deck_packages.json")

#: Days of duel games counted. The duel-pairing table's own window.
WINDOW_DAYS = 60
FRIENDLY_MODE = "duel_1v1_friendly"
POPULATIONS = ("all", "friendly")

#: A spell or building set seen in fewer deck-games than this is not stored;
#: absent reads as zero, which is what it nearly is.
MIN_ROW_GAMES = 3

#: THE GATES, as shares of the win condition's deck-games.
#:
#: Spell and card are the TENTH PERCENTILE, by games, of the decks duel players
#: repeatedly field (10+ games, 3+ pilots) — the duel-pairing gate's own
#: convention. Measured 2026-10-07 on 2,563 such decks: spell set 1.18%,
#: least-run card 3.08%.
#:
#: Building is NOT that percentile (6.98%): held out, a building set under 2%
#: costs 1 to 7 points and one over 2% costs nothing more than one over 5%
#: (-0.7 both), so the line is where the signal stops. Goblin Barrel with
#: Tombstone (2.7%) is a deck; a gate at 7% would call it a pile.
SPELL_MIN_SHARE = 0.012
BUILDING_MIN_SHARE = 0.02
CARD_MIN_SHARE = 0.03

#: A pilot's record before a game: wins and games with this many 50/50 games
#: added, so a new player is a coin and not a certainty.
PILOT_PRIOR_GAMES = 20
#: Games added to a row's count when it is ranked by results, so twelve games
#: at 75% do not outrank two thousand at 54%.
RANK_SHRINK = 200
#: Rows under this many games are not ranked by results at all.
RANK_MIN_GAMES = 100

_lock = threading.Lock()
_loaded: tuple[tuple, dict] | None = None


def default_role(card: str) -> str:
    """`wincon` / `spell` / `building` / `support`, from the card data."""
    import duel_combos as dx
    info = dx.card_info(card)
    if info.get("is_win_condition"):
        return "wincon"
    if info.get("is_spell"):
        return "spell"
    if info.get("is_building"):
        return "building"
    return "support"


def roles(cards, role_of=default_role) -> tuple:
    """`(win conditions, spells, buildings, support)`, each a sorted tuple."""
    out: dict[str, list] = {"wincon": [], "spell": [], "building": [], "support": []}
    for c in sorted(set(cards or ())):
        out.get(role_of(c), out["support"]).append(c)
    return tuple(out["wincon"]), tuple(out["spell"]), tuple(out["building"]), tuple(out["support"])


def _log5(a: float, b: float) -> float:
    return a * (1.0 - b) / (a * (1.0 - b) + b * (1.0 - a))


def table_from(games, role_of=default_role, since: str | None = None) -> dict:
    """The counts. Pure.

    `games` is every stored duel game OLDEST FIRST: `(battle_time, mode,
    a_tag, b_tag, a_deck, b_deck, winner)` with the decks as comma-joined card
    keys and `winner` 1 for a, 2 for b. Every game moves the two pilots'
    running records; only games at or after `since` are counted in the table.

    -> `{"all": pop, "friendly": pop}`; a pop is `{"n": deck-games, "wc":
    {win condition: {"n", "w", "x", "pilots", "spells": {set: [games, wins,
    expected, pilots]}, "buildings": {...}, "cards": {card: [games, wins,
    expected]}}}}`. A deck with two win conditions is counted under each; one
    with none under `""`.
    """
    record: dict[str, list] = {}
    split: dict[str, tuple] = {}
    pops = {p: {} for p in POPULATIONS}
    totals = {p: 0 for p in POPULATIONS}

    def strength(tag: str) -> float:
        g, w = record.get(tag) or (0, 0)
        return (w + PILOT_PRIOR_GAMES / 2.0) / (g + PILOT_PRIOR_GAMES)

    def add(pop: dict, deck: str, tag: str, won: int, exp: float) -> bool:
        parts = split.get(deck)
        if parts is None:
            cs = deck.split(",")
            parts = split[deck] = roles(cs, role_of) if len(set(cs)) == 8 else ()
        if not parts:
            return False
        wc, sp, bd, su = parts
        skey, bkey = ",".join(sp), ",".join(bd)
        for w in wc or ("",):
            t = pop.get(w)
            if t is None:
                t = pop[w] = {"n": 0, "w": 0, "x": 0.0, "pilots": set(),
                              "spells": {}, "buildings": {}, "cards": {}}
            t["n"] += 1
            t["w"] += won
            t["x"] += exp
            t["pilots"].add(tag)
            for name, key in (("spells", skey), ("buildings", bkey)):
                row = t[name].get(key)
                if row is None:
                    row = t[name][key] = [0, 0, 0.0, set()]
                row[0] += 1
                row[1] += won
                row[2] += exp
                row[3].add(tag)
            for c in sp + bd + su + tuple(x for x in wc if x != w):
                row = t["cards"].get(c)
                if row is None:
                    row = t["cards"][c] = [0, 0, 0.0]
                row[0] += 1
                row[1] += won
                row[2] += exp
        return True

    for bt, mode, a, b, da, db, winner in games:
        sa, sb = strength(a), strength(b)
        ea = _log5(sa, sb)
        wa, wb = (1, 0) if winner == 1 else (0, 1) if winner == 2 else (0, 0)
        if since is None or bt >= since:
            names = ("all", "friendly") if (mode or "").lower() == FRIENDLY_MODE else ("all",)
            for name in names:
                for deck, tag, won, exp in ((da, a, wa, ea), (db, b, wb, 1.0 - ea)):
                    if add(pops[name], deck, tag, won, exp):
                        totals[name] += 1
        if winner in (1, 2):
            for tag, won in ((a, wa), (b, wb)):
                r = record.get(tag)
                if r is None:
                    r = record[tag] = [0, 0]
                r[0] += 1
                r[1] += won

    out = {}
    for name, pop in pops.items():
        wcs = {}
        for w, t in pop.items():
            wcs[w] = {
                "n": t["n"], "w": t["w"], "x": round(t["x"], 2), "pilots": len(t["pilots"]),
                "spells": {k: [r[0], r[1], round(r[2], 2), len(r[3])]
                           for k, r in t["spells"].items() if r[0] >= MIN_ROW_GAMES},
                "buildings": {k: [r[0], r[1], round(r[2], 2), len(r[3])]
                              for k, r in t["buildings"].items() if r[0] >= MIN_ROW_GAMES},
                "cards": {k: [r[0], r[1], round(r[2], 2)] for k, r in t["cards"].items()},
            }
        out[name] = {"n": totals[name], "wc": wcs}
    return out


# ── the check ────────────────────────────────────────────────────────────────

def fit(cards, table: dict | None = None, role_of=default_role, pop: str = "all") -> dict | None:
    """How a deck sits with its own win condition, or None when it cannot be
    said (no table, not eight cards, a win condition the table has not seen).

    -> `{"wc": [...], "spell": share, "spellSet": [...], "spellPilots": n,
    "building": share, "buildingSet": [...], "card": share, "rarest": card}`.
    With two win conditions each measure is the LOWER of the two: a deck has
    to make sense as both.
    """
    t = table if table is not None else load()
    cs = sorted(set(cards or ()))
    if not t or len(cs) != 8:
        return None
    wcs = ((t.get(pop) or {}).get("wc")) or {}
    wc, sp, bd, su = roles(cs, role_of)
    out = None
    for w in wc or ("",):
        row = wcs.get(w)
        if not row or not row.get("n"):
            continue
        n = row["n"]
        s = row["spells"].get(",".join(sp)) or [0, 0, 0.0, 0]
        b = row["buildings"].get(",".join(bd)) or [0, 0, 0.0, 0]
        rare, rare_share = None, 1.0
        for c in sp + bd + su + tuple(x for x in wc if x != w):
            share = (row["cards"].get(c) or [0])[0] / n
            if share < rare_share:
                rare, rare_share = c, share
        cur = {"spell": s[0] / n, "spellPilots": s[3], "building": b[0] / n,
               "card": rare_share, "rarest": rare}
        if out is None:
            out = cur
        else:
            if cur["spell"] < out["spell"]:
                out["spell"], out["spellPilots"] = cur["spell"], cur["spellPilots"]
            out["building"] = min(out["building"], cur["building"])
            if cur["card"] < out["card"]:
                out["card"], out["rarest"] = cur["card"], cur["rarest"]
    if out is None:
        return None
    return {"wc": list(wc), "spellSet": list(sp), "buildingSet": list(bd), **out}


GATES = (("spell", SPELL_MIN_SHARE), ("building", BUILDING_MIN_SHARE), ("card", CARD_MIN_SHARE))


def check(cards, table: dict | None = None, role_of=default_role, seed=None) -> dict:
    """Does a CONSTRUCTED deck's spell package, buildings and support make sense
    with its win condition?

    -> `{"ok", "problems": ["spell" | "building" | "card"], "fit", "seedFit"}`.
    A measure is a problem when it is under its gate AND, if `seed` is given
    (the real deck this one was built from), under the seed's own figure.
    No table, or a deck the table cannot place, is `ok` with no `fit`: the
    other gates still stand, and a host without the file keeps working.
    """
    t = table if table is not None else load()
    f = fit(cards, t, role_of) if t else None
    if f is None:
        return {"ok": True, "problems": [], "fit": None, "seedFit": None}
    sf = fit(seed, t, role_of) if seed else None
    problems = []
    for name, gate in GATES:
        if f[name] >= gate:
            continue
        if sf is not None and f[name] >= sf[name] - 1e-12:
            continue
        problems.append(name)
    return {"ok": not problems, "problems": problems, "fit": f, "seedFit": sf}


def passes(cards, table: dict | None = None, role_of=default_role, seed=None) -> bool:
    return check(cards, table, role_of, seed)["ok"]


# ── the rankings ─────────────────────────────────────────────────────────────

def _edge(games: int, wins: int, expected: float) -> float:
    """Points won over what the pilots' records predicted, shrunk toward zero."""
    return 100.0 * (wins - expected) / (games + RANK_SHRINK)


def rank_wincons(table: dict | None = None, pop: str = "all", min_games: int = RANK_MIN_GAMES) -> list[dict]:
    """Win conditions, most played first: `{card, games, share, pilots,
    winRate, edge}`. `share` is of all deck-games; `edge` is points over the
    pilots' own records."""
    t = table if table is not None else load()
    p = (t or {}).get(pop) or {}
    total = p.get("n") or 0
    out = []
    for w, row in (p.get("wc") or {}).items():
        if not w or row["n"] < min_games:
            continue
        out.append({"card": w, "games": row["n"], "share": row["n"] / total if total else 0.0,
                    "pilots": row["pilots"], "winRate": 100.0 * row["w"] / row["n"],
                    "edge": _edge(row["n"], row["w"], row["x"])})
    out.sort(key=lambda r: (-r["games"], r["card"]))
    return out


def rank_sets(wincon: str, kind: str = "spells", table: dict | None = None, pop: str = "all",
              min_games: int = RANK_MIN_GAMES) -> list[dict]:
    """A win condition's spell (or building) packages, most played first:
    `{set, games, share, pilots, winRate, edge}`."""
    t = table if table is not None else load()
    row = ((((t or {}).get(pop) or {}).get("wc")) or {}).get(wincon)
    if not row:
        return []
    out = []
    for key, (g, w, x, pil) in row[kind].items():
        if g < min_games:
            continue
        out.append({"set": key.split(",") if key else [], "games": g, "share": g / row["n"],
                    "pilots": pil, "winRate": 100.0 * w / g, "edge": _edge(g, w, x)})
    out.sort(key=lambda r: (-r["games"], ",".join(r["set"])))
    return out


def rank_cards(wincon: str, table: dict | None = None, role_of=default_role, pop: str = "all",
               role: str | None = "support", min_games: int = RANK_MIN_GAMES) -> list[dict]:
    """The cards run with a win condition, most played first: `{card, role,
    games, share, winRate, edge}`. `role=None` lists every role."""
    t = table if table is not None else load()
    row = ((((t or {}).get(pop) or {}).get("wc")) or {}).get(wincon)
    if not row:
        return []
    out = []
    for c, (g, w, x) in row["cards"].items():
        r = role_of(c)
        if g < min_games or (role and r != role):
            continue
        out.append({"card": c, "role": r, "games": g, "share": g / row["n"],
                    "winRate": 100.0 * w / g, "edge": _edge(g, w, x)})
    out.sort(key=lambda r: (-r["games"], r["card"]))
    return out


# ── the file ─────────────────────────────────────────────────────────────────

def build(index_path: str, path: str = PATH, now: float | None = None) -> dict:
    t0 = time.time()
    since = _dt.datetime.fromtimestamp((now or time.time()) - WINDOW_DAYS * 86400,
                                       _dt.timezone.utc).strftime("%Y%m%dT%H%M%S.000Z")
    con = sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT battle_time, mode, a_tag, b_tag, a_deck, b_deck, winner "
                           "FROM games ORDER BY battle_time, a_tag, b_tag, round")
        table = table_from(rows, default_role, since)
    finally:
        con.close()
    body = {"brain": BRAIN, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "since": since,
            "gates": {"spell": SPELL_MIN_SHARE, "building": BUILDING_MIN_SHARE, "card": CARD_MIN_SHARE},
            **table}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    os.replace(tmp, path)
    return {"deckGames": table["all"]["n"], "friendlyDeckGames": table["friendly"]["n"],
            "winConditions": len([w for w in table["all"]["wc"] if w]),
            "seconds": round(time.time() - t0, 1)}


def load(path: str = PATH) -> dict | None:
    """The table, re-read only when the file changes. None before the first build."""
    global _loaded
    try:
        m = os.path.getmtime(path)
    except OSError:
        return None
    # KEYED BY THE PATH AS WELL AS THE TIME. Two files written in the same
    # instant share a time; by the time alone the second read handed back the
    # first file's table (seen on the server, where the clock is coarser).
    stamp = (os.path.abspath(path), m)
    with _lock:
        if _loaded is not None and _loaded[0] == stamp:
            return _loaded[1]
    try:
        with open(path, encoding="utf-8") as f:
            body = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(body, dict) or not isinstance(body.get("all"), dict):
        return None
    with _lock:
        _loaded = (stamp, body)
    return body


def status() -> dict | None:
    t = load()
    if not t:
        return None
    return {"brain": t.get("brain"), "builtAt": t.get("builtAt"),
            "deckGames": t["all"]["n"], "friendlyDeckGames": (t.get("friendly") or {}).get("n"),
            "winConditions": len([w for w in t["all"]["wc"] if w]), "gates": t.get("gates")}


def _report(argv: list[str]) -> int:
    t = load()
    if not t:
        print("no table — run --build")
        return 1
    args = [a for a in argv if not a.startswith("--")]
    pop = "friendly" if "friendly" in args else "all"
    args = [a for a in args if a not in POPULATIONS]
    if not args:
        print(f"win conditions, {pop} duels since {t.get('since', '')[:8]}: games  share  win%  edge")
        for r in rank_wincons(t, pop):
            print(f"  {r['card']:18} {r['games']:7}  {100 * r['share']:5.1f}%  {r['winRate']:5.1f}  {r['edge']:+5.1f}")
        return 0
    w = args[0]
    for kind in ("spells", "buildings"):
        print(f"{w}: {kind}, {pop} duels: games  share  pilots  win%  edge")
        for r in rank_sets(w, kind, t, pop)[:15]:
            print(f"  {(', '.join(r['set']) or '(none)'):44} {r['games']:6}  {100 * r['share']:5.1f}%  "
                  f"{r['pilots']:5}  {r['winRate']:5.1f}  {r['edge']:+5.1f}")
    print(f"{w}: support cards, {pop} duels: games  share  win%  edge")
    for r in rank_cards(w, t, pop=pop)[:20]:
        print(f"  {r['card']:18} {r['games']:6}  {100 * r['share']:5.1f}%  {r['winRate']:5.1f}  {r['edge']:+5.1f}")
    return 0


if __name__ == "__main__":
    if "--build" in sys.argv:
        idx = os.environ.get("CLASH_DUEL_INDEX") or os.path.join(HERE, ".duel_index.db")
        print(json.dumps(build(idx)))
    else:
        sys.exit(_report(sys.argv[1:]))
