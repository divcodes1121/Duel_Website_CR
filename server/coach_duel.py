"""THE COACH DUEL (`coach-duel-1.0`): two AI coaches play a duel, one for each
player, game by game.

Asked for on 2026-10-20: "an AI coach for duels which will be like a game — you
enter two players, an AI coach enters for each, it shows the matchup percentage
and who won, then game 2 proceeds ... the coach must have a brain reading the
top CRL decks, the trees, the meta trends ... all three games, make a plan".

── WHAT EACH COACH IS ────────────────────────────────────────────────────────

  Coach Assist, unchanged, once for each side (`coach.suggest`, stage 0): the
  set of decks it would load for this player against this opponent (their own
  duel decks and the counters — the CRL group's duel lists and the vetted meta
  lists of the window, rated against the read of the opponent), the read of the
  opponent's next deck (`duel_read`, fitted on the CRL group for CRL players),
  and every pairing rated by the combined brain (fused ladder+duel rate, card
  model, both players' strength, card levels and their skill with each win
  condition). So what a coach brings in this game is exactly what Coach Assist
  would tell that player to bring.

  The games after the first are picked by the same look-ahead Coach Assist runs
  (`duel_plan.plan`), over the decks that coach loaded and has not spent, told
  the decks the other side has shown and who won each game. A coach does NOT
  see the other coach's set — it reads the other player from their history,
  as it would in a real duel. That is where a coach can be surprised.

── WHAT DECIDES A GAME ───────────────────────────────────────────────────────

  The referee is both coaches' rulers at once: the chance the first player
  wins a game is the mean of coach A's figure for A's deck against B's and one
  minus coach B's figure for B's deck against A's. The two are close (the
  model is antisymmetric) and averaging them takes no side. The result of the
  game before then moves the chance of the next one by the in-duel shift
  `duel_plan.SHIFT` (fitted: after winning game 1 a player wins game 2 more
  often than any matchup says).

── WHY A TREE AND NOT ONE RUN ────────────────────────────────────────────────

  Both coaches' picks depend only on what has been shown and who won, so a
  best-of-3 has five games that can be played at most: game 1, game 2 after
  each result, game 3 after each 1-1. All five are worked out in one request,
  which gives the EXACT chance of every final score with no sampling, and lets
  the screen play the duel like a game — a result is drawn from that game's
  chance and the next game is already known — and play it again at once.

Pure where it can be: `play` and `disjoint_set` take functions and know nothing
of the database (`test_coach_duel.py`). `simulate` is the glue to `coach`.
"""
from __future__ import annotations

import sys
import threading
import time
import traceback

import duel_plan as dp

BRAIN = "coach-duel-1.0"

#: A duel is the best of this many games (no stored duel has more than three).
GAMES = 3

#: The most decks a coach loads (a duel set is four decks), and the fewest
#: that can play a whole best-of-3 without a deck sharing a card.
SET_MAX = 4
SET_MIN = 3

#: The coach's read of the other side shown per game: what it expected.
EXPECT_SHOW = 3

#: A deck counts as the one the coach expected when they share this many
#: cards — two changed is the same deck with a tech swap, the rule the read
#: and the set composer fold lists by (`duel_zone.COUNTER_MIN_OVERLAP`).
NEAR = 6

#: The answers are cached so a rematch costs nothing.
CACHE_TTL_S = 600.0
CACHE_MAX = 32

#: The fields of a deck row the screen draws.
_DECK_FIELDS = ("cards", "art", "inferredArt", "artFilled", "deckName", "archetype",
                "avgElixir", "counter", "origin", "winCon")


def _key(cards) -> str:
    return ",".join(sorted(set(cards or [])))


def disjoint_set(rows: list[dict], size: int = SET_MAX) -> list[dict]:
    """The first rows, in order, that share no card with a row already taken,
    up to `size`. Rows that are not eight distinct cards are skipped."""
    out: list[dict] = []
    used: set = set()
    seen: set = set()
    for r in rows or []:
        cards = set(r.get("cards") or [])
        k = _key(cards)
        if len(cards) != 8 or k in seen or cards & used:
            continue
        seen.add(k)
        out.append(r)
        used |= cards
        if len(out) >= size:
            break
    return out


def _flip(path: str) -> str:
    return path.translate(str.maketrans("wl", "lw"))


def play(a_decks: list, b_decks: list, a_pick, b_pick, referee, *,
         games: int = GAMES, shift: dict | None = None) -> dict:
    """Every game the duel can reach, and the exact chance of each final score.

    `a_decks` / `b_decks`: each side's loaded decks (card lists).
    `a_pick(my_played, opp_played, results) -> (index or None, info or None)`:
    the deck that side brings, given the decks each side has played so far (in
    order) and who won each game from ITS side ('w' / 'l'). `info` is whatever
    that coach wants shown beside its pick. None = no legal deck left.
    `referee(i, j) -> chance` that A's deck i beats B's deck j.

    -> `{"games": [node, ...], "outcomes": {"2-0": p, ...}, "duel": {"a", "b"}}`.
    A node is `{"path", "game", "a": {"deck", ...info}, "b": {...}, "matchup",
    "chance", "forfeit"}`: `path` is who won each game before it from A's side
    ("" for game 1, "w", "l", "wl", "lw"), `matchup` A's chance on the decks and
    players alone, `chance` with the result before it (`duel_plan.shifted`).
    Probabilities are fractions here; `simulate` turns them into percents.
    """
    need = games // 2 + 1
    nodes: list[dict] = []
    reach: dict[str, float] = {}
    outcomes: dict[str, float] = {}

    def walk(path: str, a_idx: list, b_idx: list, weight: float) -> None:
        mw, ow = path.count("w"), path.count("l")
        if mw >= need or ow >= need:
            score = "%d-%d" % (mw, ow)
            outcomes[score] = outcomes.get(score, 0.0) + weight
            return
        a_played = [a_decks[i] for i in a_idx]
        b_played = [b_decks[j] for j in b_idx]
        ai, a_info = a_pick(a_played, b_played, path)
        bi, b_info = b_pick(b_played, a_played, _flip(path))
        game = mw + ow + 1
        forfeit = None
        if ai is None and bi is None:
            p = 0.5
            forfeit = "both"
        elif ai is None:
            p, forfeit = 0.0, "a"
        elif bi is None:
            p, forfeit = 1.0, "b"
        else:
            p = min(max(float(referee(ai, bi)), 1e-6), 1.0 - 1e-6)
        last = path[-1] if path else None
        chance = p if forfeit else dp.shifted(p, last, game, shift)
        reach[path] = weight
        nodes.append({"path": path, "game": game,
                      "a": {"deck": ai, **(a_info or {})},
                      "b": {"deck": bi, **(b_info or {})},
                      "matchup": p, "chance": chance, "forfeit": forfeit})
        walk(path + "w", a_idx + ([ai] if ai is not None else []),
             b_idx + ([bi] if bi is not None else []), weight * chance)
        walk(path + "l", a_idx + ([ai] if ai is not None else []),
             b_idx + ([bi] if bi is not None else []), weight * (1.0 - chance))

    walk("", [], [], 1.0)
    for n in nodes:
        n["reach"] = reach[n["path"]]
    a_wins = sum(p for s, p in outcomes.items() if int(s.split("-")[0]) >= need)
    return {"games": nodes, "outcomes": outcomes, "duel": {"a": a_wins, "b": 1.0 - a_wins}}


def policy(decks: list, read, win, *, games: int = GAMES):
    """A coach: the look-ahead over its own loaded `decks` (`duel_plan.plan`),
    with `read(revealed, lost) -> [(cards, p)]` its read of the other side and
    `win(my, theirs) -> chance` its ruler. Without a read or a ruler, the first
    loaded deck it can still legally bring.

    Each pick carries what the coach believed: its chance in this game and in
    the duel (percent), and the decks it expected the other side to bring.
    """
    def first_legal(my_played) -> int | None:
        spent = set().union(*[set(d) for d in my_played]) if my_played else set()
        return next((i for i, d in enumerate(decks) if not (set(d) & spent)), None)

    def pick(my_played, opp_played, results):
        info: dict = {}
        if read is not None and win is not None:
            try:
                out = dp.plan(decks, read, win, my_played=my_played, opp_played=opp_played,
                              results=results, games=games)
                if out.get("options"):
                    o = out["options"][0]
                    info = {"believed": {"game": round(100 * o["game"], 1),
                                         "duel": round(100 * o["duel"], 1)}}
                    revealed = tuple(frozenset(d) for d in opp_played)
                    info["expected"] = [{"cards": sorted(c), "p": round(100 * float(p), 1)}
                                        for c, p in (read(revealed, None) or [])[:EXPECT_SHOW]]
                    return out["pick"], info
            except Exception:  # noqa: BLE001 - the coach still brings a deck
                traceback.print_exc()
        return first_legal(my_played), info

    return pick


def _referee(win_a, win_b):
    """The chance A's deck beats B's deck: the mean of both coaches' rulers,
    each from its own side; one of them when the other has none."""
    def ref(a_cards, b_cards) -> float:
        got = []
        if win_a is not None:
            got.append(float(win_a(frozenset(a_cards), frozenset(b_cards))))
        if win_b is not None:
            got.append(1.0 - float(win_b(frozenset(b_cards), frozenset(a_cards))))
        return sum(got) / len(got) if got else 0.5
    return ref


# ── THE GLUE TO COACH ASSIST ───────────────────────────────────────────────

_cache: dict = {}
_cache_lock = threading.Lock()


def _brief(row: dict) -> dict:
    out = {k: row[k] for k in _DECK_FIELDS if k in row}
    b = (row.get("brain") or {}).get("winRate")
    if b is not None:
        out["vsRead"] = b
    return out


def _profile(p: dict | None) -> list[dict]:
    """A coached player's win conditions, the three they play most."""
    rows = (p or {}).get("winCons") or (p or {}).get("rows") or []
    out = []
    for r in rows[:3]:
        sk = r.get("skill") or {}
        out.append({k: r.get(k) for k in ("card", "name", "share", "winRate", "use")}
                   | {"tag": sk.get("tag")})
    return out


def _side(me: str, opp: str, me_win: tuple, opp_win: tuple, kind) -> dict:
    """One coach: Coach Assist's stage-0 answer for `me` against `opp`, the set
    it loads, and its read and ruler for the games after."""
    import coach
    keep: dict = {}
    ans = coach.suggest(me, opp, [], [], me_win[0], me_win[1], opp_win[0], opp_win[1],
                        kind=kind, keep=keep)
    recs = list(ans.get("recommendations") or [])
    counters = list(((ans.get("counters") or {}).get("decks")) or [])
    duel_set = ans.get("duelSet")
    # Coach Assist's set when it composed one; else the best of its options and
    # counters that fit together.
    decks = disjoint_set(recs) if duel_set else disjoint_set(recs + counters)
    if len(decks) < SET_MIN and duel_set:
        decks = disjoint_set(recs + counters)
    cards = [list(d["cards"]) for d in decks]
    read = win = None
    ctx, oh, rates = keep.get("ctx"), keep.get("opp_hist"), keep.get("rates")
    if ctx and ctx.get("model") and cards and coach._dp is not None and coach._dr is not None:
        oh = oh if oh and oh.get("read") is not None else {"read": [], "tag": opp}
        try:
            read, win = coach._plan_tools(cards, oh, kind, ctx, rates)
        except Exception:  # noqa: BLE001 - the coach still plays its set in order
            traceback.print_exc()
            read = win = None
    return {"tag": me, "name": ans.get("myName") or me, "answer": ans, "decks": decks,
            "cards": cards, "read": read, "win": win, "rates": rates,
            "setInfo": duel_set}


def _label(cards, side: dict) -> str:
    """A deck the coach expected, by name."""
    try:
        import coach
        import duel_zone as dz
        return dz.deck_label(list(cards), coach._archetype(list(cards)))
    except Exception:  # noqa: BLE001 - a name is decoration
        return ""


def simulate(a_tag: str, b_tag: str, a_win: tuple, b_win: tuple, kind=None) -> dict:
    """The coach duel between two players. See the module docstring.

    `a_win` / `b_win` are each player's `(since, until)` window, `kind` what sort
    of duel (True friendly, False clan war, None not told).
    """
    ck = (a_tag, b_tag, tuple(a_win), tuple(b_win), kind)
    now = time.time()
    with _cache_lock:
        got = _cache.get(ck)
        if got and now - got[0] < CACHE_TTL_S:
            return got[1]
    t0 = time.time()
    a = _side(a_tag, b_tag, a_win, b_win, kind)
    b = _side(b_tag, a_tag, b_win, a_win, kind)
    base = {"brain": BRAIN, "games": GAMES, "kind": kind,
            "window": {"a": {"from": a_win[0], "to": a_win[1]},
                       "b": {"from": b_win[0], "to": b_win[1]}}}
    for s in (a, b):
        if len(s["decks"]) < SET_MIN:
            return {**base, "error": "short_set", "side": "a" if s is a else "b",
                    "name": s["name"], "decks": len(s["decks"])}
    if a["win"] is None and b["win"] is None:
        return {**base, "error": "no_brain"}

    # Each ruler sees the other set's decks prepared, not only the history.
    for s, o in ((a, b), (b, a)):
        r = s.get("rates")
        if r is not None and getattr(r, "on", False):
            try:
                r.prepare(s["cards"], o["cards"])
            except Exception:  # noqa: BLE001
                traceback.print_exc()

    ref = _referee(a["win"], b["win"])
    out = play(a["cards"], b["cards"],
               policy(a["cards"], a["read"], a["win"]),
               policy(b["cards"], b["read"], b["win"]),
               lambda i, j: ref(a["cards"][i], b["cards"][j]))

    names: dict = {}
    for n in out["games"]:
        for side_key, side, other in (("a", a, b), ("b", b, a)):
            pick = n[side_key]
            brought = n["b" if side_key == "a" else "a"]["deck"]
            got = set(other["cards"][brought]) if brought is not None else set()
            exp = []
            for e in pick.get("expected") or []:
                k = _key(e["cards"])
                if k not in names:
                    names[k] = _label(e["cards"], side)
                exp.append({"name": names[k], "p": e["p"],
                            "hit": len(set(e["cards"]) & got) >= NEAR})
            if pick.get("expected") is not None:
                pick["expected"] = exp
        n["matchup"] = round(100 * n["matchup"], 1)
        n["chance"] = round(100 * n["chance"], 1)
        n["reach"] = round(100 * n["reach"], 2)

    def side_out(s: dict) -> dict:
        ans = s["answer"]
        ci = ans.get("counters") or {}
        bm = ans.get("brainModel") or {}
        opp = ans.get("opponent") or {}
        return {
            "tag": s["tag"], "name": s["name"],
            "set": [_brief(d) for d in s["decks"]],
            # The set's chance of winning the duel, as this coach valued it
            # against its READ of the other player (not their real set).
            "belief": (s["setInfo"] or {}).get("duel"),
            "composed": bool(s["setInfo"]),
            "brain": {
                "read": bool(s["read"]), "readFit": opp.get("readFit"),
                "engine": opp.get("engine"),
                "counters": len(ci.get("decks") or []), "counterPool": ci.get("pool"),
                "cardModel": (ans.get("fusion") or {}).get("cardModel"),
                "skill": bool(bm.get("skill")),
                "levelScale": bm.get("levelScale"),
            },
            "profile": _profile((ans.get("profiles") or {}).get("mine")),
            "evidence": {"duels": (ans.get("evidence") or {}).get("mySeries", 0),
                         "games": (ans.get("evidence") or {}).get("myGames", 0)},
        }

    result = {
        **base,
        "a": side_out(a), "b": side_out(b),
        "tree": out["games"],
        "outcomes": {k: round(100 * v, 1) for k, v in sorted(out["outcomes"].items())},
        "duel": {"a": round(100 * out["duel"]["a"], 1), "b": round(100 * out["duel"]["b"], 1)},
        "shift": dict(dp.SHIFT),
        "ms": int(1000 * (time.time() - t0)),
    }
    with _cache_lock:
        if len(_cache) >= CACHE_MAX:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[: CACHE_MAX // 2]:
                _cache.pop(k, None)
        _cache[ck] = (time.time(), result)
    return result


if __name__ == "__main__":  # pragma: no cover - a manual run on the server
    import json
    if len(sys.argv) < 3:
        print("usage: coach_duel.py <tag A> <tag B>", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(simulate(sys.argv[1], sys.argv[2], (None, None), (None, None)),
                     indent=1, default=str)[:20000])
