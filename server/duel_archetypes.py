"""EVERY DUEL DECK, GROUPED BY ARCHETYPE (`duel-archetypes-1.0`, 2026-10-21).

Asked for after Coach Duel offered the same few decks to different players:
"we literally have so many decks under each archetype of duels, CRL players +
normal duels ... give priority to CRL-level players' duel decks, then normal
decks ... group all the decks under those archetypes, rank them, see which
one can counter the opponent's archetypes well but also be surprising ...
make a group for all duel decks under archetypes so it can be stored".

THE GROUPS ARE BUILT FROM THE DUEL INDEX (`duel_index.py`), after every poll
(a step in `after_poll.py`), into `.duel_archetypes.json` (gitignored):

    {"brain", "builtAt", "indexBuild", "families": {family: [list, ...]}}

A FAMILY is the archetype (`duel_index.classify`, the label every matchup
record uses), except the bot's `other` bucket, which is split by the win
condition the list plays ("other:minion-giant") — the rule Team Analysis
groups by (`team_analysis._family`).

A LIST is one exact eight-card duel deck:

    {"cards", "games", "wins", "players", "crlGames", "crlPlayers", "tier",
     "edge", "vs": {opponent archetype: [games, wins, expected]}}

  * Fielded in `MIN_GAMES`+ duel games by `MIN_PLAYERS`+ pilots, none of them
    more than `TOP_SHARE` of its games: a list one player keeps playing is
    that player's, not a deck of the archetype.
  * `tier` "crl" when the CRL group (`.duel_cohorts.json`, `crl`) played it in
    `CRL_MIN_GAMES`+ duel games, else "duel". CRL lists rank first.
  * `vs` = its duel record against each opponent archetype with the pilots'
    expected wins (`duel_index`'s `deck_wc`), so a list is credited for beating
    an archetype beyond what its pilots would have done anyway. `edge` is the
    same over all its games, in points per game, shrunk by `K`.
  * Within a family: CRL first, then most played. At most `PER_FAMILY`.

`counter_score(list, mix)` reads a list against an opponent's archetype MIX
(`{archetype: chance}`); `pick(...)` chooses lists from families for a
player: their own families and the ones that counter the opponent, CRL first,
best counters first, with a seeded draw among the close ones so two players
(and two duels) do not get the same lists — "but also surprising".

Pure except `build`, `load` and `status`. `test_duel_archetypes.py`.
"""

from __future__ import annotations

import datetime
import json
import os
import sqlite3
import sys
import time

BRAIN = "duel-archetypes-1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.environ.get("CLASH_DUEL_ARCHETYPES") or os.path.join(HERE, ".duel_archetypes.json")

#: A list counts once this many duel games and pilots have fielded it.
MIN_GAMES = 3
MIN_PLAYERS = 2
#: No single pilot may hold more than this share of a list's games.
TOP_SHARE = 0.6
#: CRL tier: the CRL group fielded it in this many duel games.
CRL_MIN_GAMES = 2
#: Lists kept per family (CRL first, then most played).
PER_FAMILY = 1000
#: An opponent-archetype record is kept from this many games.
VS_MIN = 3
#: Shrinkage of a record toward "as expected", in games.
K = 20.0
#: How much a list's general edge counts beside its record against the mix.
GENERAL_WEIGHT = 0.25

#: THE SURPRISE (measured 2026-10-21): drawing only among lists tied with the
#: best handed two different players the SAME counters (pools 24% shared
#: against one opponent, 16% before the groups). A family's picks are drawn
#: from its best `DRAW_WIDTH` x as many lists as are wanted, and the counter
#: families from the best `FAMILY_SLACK` more than are wanted.
DRAW_WIDTH = 4
FAMILY_SLACK = 2


def edge_of(games: float, wins: float, expected: float, k: float = K) -> float:
    """Wins over what the pilots should have won, per game, shrunk toward 0."""
    return (float(wins) - float(expected)) / (float(games) + k)


def family_of(arch: str | None, cards, title=None) -> str:
    """The family a list is grouped under: its archetype, or for the bot's
    `other` bucket the win condition it plays (`title(cards)` names it)."""
    arch = arch or "other"
    if arch != "other":
        return arch
    name = ""
    if title is not None:
        try:
            name = str(title(list(cards)) or "")
        except Exception:  # noqa: BLE001 - grouped as plain "other"
            name = ""
    return "other:" + name.lower().replace(" ", "-") if name else "other"


def group(rows, vs: dict, crl: dict, *, title=None, per_family: int = PER_FAMILY) -> dict:
    """The families. Pure.

    `rows`: `[(key, archetype, games, wins, players, top pilot games)]`.
    `vs`: `{key: {opp archetype: (games, wins, expected)}}`.
    `crl`: `{key: (games, pilots)}` — what the CRL group fielded."""
    fam: dict[str, list] = {}
    for key, arch, games, wins, players, top in rows:
        games, players = int(games or 0), int(players or 0)
        cards = [c for c in str(key).split(",") if c]
        if (len(set(cards)) != 8 or games < MIN_GAMES or players < MIN_PLAYERS
                or int(top or 0) > TOP_SHARE * games):
            continue
        k = ",".join(sorted(set(cards)))
        rec = {opp: [int(g), int(w), round(float(e), 2)]
               for opp, (g, w, e) in (vs.get(k) or {}).items() if int(g) >= VS_MIN}
        g_all = sum(r[0] for r in rec.values())
        cg, cp = crl.get(k) or (0, 0)
        entry = {
            "cards": sorted(set(cards)), "games": games, "wins": int(wins or 0), "players": players,
            "crlGames": int(cg), "crlPlayers": int(cp),
            "tier": "crl" if int(cg) >= CRL_MIN_GAMES else "duel",
            "edge": round(edge_of(g_all, sum(r[1] for r in rec.values()),
                                  sum(r[2] for r in rec.values())), 4) if g_all else 0.0,
            "vs": rec,
        }
        fam.setdefault(family_of(arch, cards, title), []).append(entry)
    out = {}
    for f, lists in fam.items():
        lists.sort(key=lambda e: (e["tier"] != "crl", -e["crlGames"], -e["games"], ",".join(e["cards"])))
        out[f] = lists[:per_family]
    return out


def counter_score(entry: dict, mix: dict) -> float:
    """A list against an opponent's archetype MIX (`{archetype: chance}`):
    its shrunk record over expectation against each, weighted by the chance,
    plus a quarter of its general edge. Points per game; 0 = as expected."""
    tot = sum(float(p) for p in (mix or {}).values()) or 0.0
    s = 0.0
    if tot > 0:
        for arch, p in mix.items():
            r = (entry.get("vs") or {}).get(arch)
            if r:
                s += float(p) / tot * edge_of(r[0], r[1], r[2])
    return s + GENERAL_WEIGHT * float(entry.get("edge") or 0.0)


def family_score(lists: list, mix: dict, top: int = 5) -> float:
    """How well a family answers the mix: the mean of its best `top` lists."""
    got = sorted((counter_score(e, mix) for e in lists), reverse=True)[:top]
    return sum(got) / len(got) if got else -1.0


def pick(families: dict, own: list, mix: dict, rng, *, per_own: int = 6, counter_families: int = 4,
         per_counter: int = 4, exclude=(), band: float = 0.02, width: int = DRAW_WIDTH,
         slack: int = FAMILY_SLACK) -> list[dict]:
    """Lists for one player: up to `per_own` from each of their `own`
    families, then up to `per_counter` from each of the `counter_families`
    families that answer the opponent's `mix` best (not already theirs).

    Within a family the order is CRL first, then the counter score; the
    picks are drawn by `rng` from the best `width` x `n` lists of the tier
    (and any within `band` of the best) — the surprise, seeded by the caller
    so the same two players see the same lists and two different players do
    not. The counter families are drawn from the best `counter_families +
    slack`. `exclude` = deck keys never picked. Each pick is the list with
    `family` and `score` added."""
    skip = set(exclude or ())
    out: list[dict] = []

    def take(fam: str, n: int) -> None:
        ranked = sorted(((e, counter_score(e, mix)) for e in families.get(fam) or []
                         if ",".join(e["cards"]) not in skip),
                        key=lambda x: (x[0]["tier"] != "crl", -x[1], ",".join(x[0]["cards"])))
        for tier in ("crl", "duel"):
            pool = [x for x in ranked if x[0]["tier"] == tier]
            if not pool or n <= 0:
                continue
            best = pool[0][1]
            short = [x for i, x in enumerate(pool) if i < max(1, width * n) or x[1] >= best - band]
            got = rng.sample(short, min(n, len(short)))
            got.sort(key=lambda x: (-x[1], ",".join(x[0]["cards"])))
            for e, s in got:
                k = ",".join(e["cards"])
                if k in skip:
                    continue
                skip.add(k)
                out.append(dict(e, family=fam, score=round(s, 4)))
                n -= 1

    for fam in own:
        take(fam, per_own)
    others = [f for f in families if f not in set(own)]
    others.sort(key=lambda f: (-family_score(families[f], mix), f))
    top = others[:counter_families + slack]
    chosen = set(rng.sample(top, min(counter_families, len(top))))
    for fam in [f for f in top if f in chosen]:
        take(fam, per_counter)
    return out


# ── stored artifact ───────────────────────────────────────────────────────

_cache: dict = {"sig": None, "data": None}


def load(path: str = PATH) -> dict | None:
    """The stored groups, re-read when the file changes. None without one."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    sig = (path, st.st_mtime_ns, st.st_size)
    if _cache["sig"] != sig:
        try:
            with open(path, encoding="utf-8") as f:
                _cache["data"] = json.load(f)
            _cache["sig"] = sig
        except (OSError, ValueError):
            return None
    return _cache["data"]


def families() -> dict:
    return (load() or {}).get("families") or {}


def status() -> dict | None:
    d = load()
    if not d:
        return None
    fams = d.get("families") or {}
    return {"brain": d.get("brain"), "builtAt": d.get("builtAt"), "families": len(fams),
            "lists": sum(len(v) for v in fams.values()),
            "crlLists": sum(1 for v in fams.values() for e in v if e.get("tier") == "crl")}


def _crl_tags() -> set:
    try:
        import duel_read_train as drt
        return set((drt.load_cohorts().get("crl")) or ())
    except Exception:  # noqa: BLE001 - no group, no CRL tier
        return set()


def build(path: str = PATH) -> dict:
    """Read the duel index and write the groups (tmp + replace)."""
    import duel_index as di
    import clash_data as cd
    t0 = time.time()
    if di._current() is None:
        raise SystemExit("no usable duel index")
    con = di._ro(di.PATH)
    try:
        rows = con.execute(
            "SELECT key, wc, games, wins, players, top_pilot FROM deck "
            "WHERE games >= ? AND players >= ?", (MIN_GAMES, MIN_PLAYERS)).fetchall()
        vs: dict = {}
        for key, opp, g, w, e in con.execute(
                "SELECT d.key, w.opp_wc, w.games, w.wins, w.exp FROM deck_wc w JOIN deck d ON d.id = w.deck "
                "WHERE d.games >= ? AND d.players >= ? AND w.games >= ?", (MIN_GAMES, MIN_PLAYERS, VS_MIN)):
            vs.setdefault(",".join(sorted(key.split(","))), {})[opp] = (g, w, e)
        meta = di._meta(con)
    finally:
        con.close()
    crl = {k: tuple(v) for k, v in di.lists_of(_crl_tags()).items()}
    fams = group(rows, vs, crl, title=lambda cards: cd.deck_title("other", cards))
    data = {"brain": BRAIN, "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "indexBuild": meta.get("built_at") or meta.get("builtAt"), "families": fams}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)
    out = status() or {}
    out["seconds"] = round(time.time() - t0, 1)
    return out


if __name__ == "__main__":  # pragma: no cover - the after-poll step
    if "--build" in sys.argv:
        print(json.dumps(build()))
    else:
        print(json.dumps(status()))
