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
_DECK_FIELDS = ("cards", "art", "inferredArt", "artInferred", "artFilled", "switched", "deckName", "archetype",
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
                if not out.get("options") and results:
                    # THE DUEL IS DECIDED BUT THE GAMES GO ON ("play all games"):
                    # nothing is left to win but this game, so the results are
                    # not told and the deck with the best chance in it is the pick.
                    out = dp.plan(decks, read, win, my_played=my_played, opp_played=opp_played,
                                  results="", games=games)
                    if out.get("options") and out.get("gamePick") is not None:
                        o = next(o for o in out["options"] if o["deck"] == out["gamePick"])
                        out = {**out, "options": [o] + [x for x in out["options"] if x is not o],
                               "pick": out["gamePick"]}
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
            "setInfo": duel_set, "keep": keep, "opp": opp}


def _label(cards, side: dict) -> str:
    """A deck the coach expected, by name."""
    try:
        import coach
        import duel_zone as dz
        return dz.deck_label(list(cards), coach._archetype(list(cards)))
    except Exception:  # noqa: BLE001 - a name is decoration
        return ""


def _public(s: dict, with_set: bool = True) -> dict:
    """A coach as the screen sees it. `with_set=False` keeps its loaded decks
    secret (the AI coach's set is shown only once the duel is over)."""
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

    result = {
        **base,
        "a": _public(a), "b": _public(b),
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


# ══ YOU AGAINST THE AI COACH, ONE GAME AT A TIME (2026-10-21) ═══════════════
#
# Asked for after the first build: "the blue coach is a human ... red is an AI
# coach; after a rematch the red coach's decks change, based on the player's
# past trends, sometimes with a card switched, as the AI decides, reading the
# opponent player"; then "one deck at a time — paste one deck, then the game
# starts — and before that ask best of 3 / best of 5, and we proceed one by
# one".
#
#   * YOU bring one deck per game, pasted before that game. No card twice in a
#     duel (the duel rule): a deck sharing a card with one you already played is
#     refused.
#   * THE AI is Coach Assist for the other player. Its set is fixed for the
#     duel. Best of 3, duel 1: Coach Assist's own set. Every rematch, and every
#     best of 5 (which needs five decks), a set drawn by `vary_set`: decks of
#     its player's own duel rotation weighted by how much they play each — the
#     player's trend — and the counters, within `VARY_BAND` of the best the
#     coach can see. Sometimes (`SWITCH_P`) one deck carries a one-card switch
#     real duel players made to that very list (`duel_index.near_variants`).
#   * IT PICKS BEFORE IT SEES YOUR DECK. `turn` computes the AI's pick for this
#     game from the decks you played in EARLIER games and the results only —
#     the deck you just locked in is used for nothing but the game's chance,
#     after the pick. That is the fairness of the game, and it lives here, not
#     in the screen.
#   * IT LEARNS FROM THE DUEL BEFORE. The decks you showed in earlier duels of
#     the session are folded into its read of you (`blend_read`).

#: A rematch set must be within this much duel-win chance of the best set the
#: AI coach could compose, or it is not one a coach would choose.
VARY_BAND = 0.06

#: How many candidate sets a draw tries before choosing.
VARY_DRAWS = 60

#: A counter from outside the player's own decks weighs this share of their
#: median deck in the draw: the AI leans on what its player really plays.
COUNTER_WEIGHT = 0.5

#: The chance a rematch set carries one real one-card switch.
SWITCH_P = 0.4

#: Real variants considered for a switch (most played first).
SWITCH_CANDIDATES = 12

#: Of the AI's read of your next deck, the share given to the decks you showed
#: in earlier duels of the session.
SEEN_WEIGHT = 0.5

#: The formats a duel can be played in, and the decks the AI loads for each.
FORMATS = {3: (4, 3), 5: (5, 5)}          # games -> (most decks, fewest)
MAX_DECKS = 4

#: REAL DUEL LISTS BUILT ON THE PLAYER'S OWN WIN CONDITIONS join both sides'
#: pools (asked 2026-10-21: "there are countless decks in the duel battles
#: which match the player's playstyle"): the most played lists of each of
#: their three main win conditions, fielded by enough pilots that one player's
#: pet list does not speak for everyone.
STYLE_WINCONS = 3
STYLE_PER_WINCON = 12
STYLE_MIN_GAMES = 10
STYLE_MIN_PLAYERS = 3
#: Their weight in the AI's draw, as a share of the player's median own deck.
STYLE_WEIGHT = 0.35

#: Two decks sharing this many cards are ONE deck for "brought before": a
#: one-card switch of a deck already faced is not a new deck.
REPEAT_NEAR = 7

#: A deck already brought in an earlier duel of the session still counts this
#: much (of its weight) when fresh decks cannot fill the format.
REPEAT_WEIGHT = 0.05

#: The most decks offered to you (the "Coach Assist deck" button cycles them).
YOU_POOL = 40

#: Rows of the read a deck's figure for you is taken against.
YOU_READ_ROWS = 6

_side_cache: dict = {}
_side_lock = threading.Lock()
_set_cache: dict = {}


def blend_read(read, seen: list, weight: float = SEEN_WEIGHT):
    """`read` with the decks you showed before folded in: each still-legal seen
    deck gets an equal part of `weight`, the history read keeps the rest. A
    seen deck within two cards of a row of the read adds to that row."""
    seen = [frozenset(d) for d in seen or [] if len(set(d)) == 8]
    if not seen:
        return read

    def blended(revealed, lost):
        shown = [frozenset(r) for r in revealed if r]
        base = list(read(revealed, lost) or []) if read is not None else []
        legal = [d for d in seen if not any(d & s for s in shown)]
        if not legal:
            return base
        rows = [[frozenset(c), (1.0 - weight) * float(p)] for c, p in base]
        each = weight / len(legal)
        for d in legal:
            home = next((r for r in rows if len(r[0] & d) >= NEAR), None)
            if home is not None:
                home[1] += each
            else:
                rows.append([d, each])
        rows.sort(key=lambda r: (-r[1], ",".join(sorted(r[0]))))
        return [(sorted(c), p) for c, p in rows]

    return blended


def vary_set(entries: list, value, rng, *, size: int = MAX_DECKS, min_size: int = SET_MIN,
             draws: int = VARY_DRAWS, band: float = VARY_BAND, avoid=None,
             shrink: bool = False) -> list | None:
    """A set: indices into `entries` (`{"cards", "weight"}`), sharing no card,
    drawn in proportion to `weight`, and within `band` of the best set drawn
    (`band=0` is the best). `avoid` (a frozenset of entry indices) is a set
    never chosen while another qualifies. None when no set of `min_size` can
    be drawn. `shrink` also weighs each drawn set cut down towards
    `min_size` (in draw order), so a fallback can field fewer decks rather
    than more of the ones it would rather not bring."""
    pool = [i for i, e in enumerate(entries) if len(set(e["cards"])) == 8 and e.get("weight", 0) > 0]
    sets: dict = {}
    for _ in range(draws):
        left, used, got = list(pool), set(), []
        while left and len(got) < size:
            tot = sum(entries[i]["weight"] for i in left)
            x, acc, pick = rng.random() * tot, 0.0, left[-1]
            for i in left:
                acc += entries[i]["weight"]
                if acc >= x:
                    pick = i
                    break
            left.remove(pick)
            cards = set(entries[pick]["cards"])
            if cards & used:
                continue
            got.append(pick)
            used |= cards
        if len(got) >= min_size:
            sets.setdefault(frozenset(got), None)
            if shrink:
                for n in range(min_size, len(got)):
                    sets.setdefault(frozenset(got[:n]), None)
    if not sets:
        return None
    vals = {s: float(value([entries[i]["cards"] for i in sorted(s)])) for s in sets}
    best = max(vals.values())
    ok = sorted((s for s, v in vals.items() if v >= best - band), key=lambda s: sorted(s))
    fresh = [s for s in ok if s != avoid] or ok
    return sorted(rng.choice(fresh))


def switch_card(decks: list, variants_for, rng, p: float = SWITCH_P, ok=None):
    """Maybe one real one-card switch in one deck: `(decks, switch or None)`.
    `variants_for(cards) -> [{"cards", "games"}]` are real lists one card away;
    a variant whose new card another deck of the set already holds is skipped,
    and so is one `ok(new cards, old cards)` refuses (the deck must still make
    sense after the switch).
    `switch` = `{"deck": index, "out": card, "in": card, "games": n}`."""
    if not decks or rng.random() >= p:
        return decks, None
    order = list(range(len(decks)))
    rng.shuffle(order)
    for k in order:
        mine = set(decks[k])
        others = set().union(*[set(d) for i, d in enumerate(decks) if i != k])
        opts = []
        for v in (variants_for(decks[k]) or [])[:SWITCH_CANDIDATES]:
            new = set(v["cards"])
            add, drop = new - mine, mine - new
            if len(add) == 1 and len(drop) == 1 and not (add & others) and (ok is None or ok(list(v["cards"]), list(decks[k]))):
                opts.append((v, next(iter(drop)), next(iter(add))))
        if not opts:
            continue
        tot = sum(max(1, int(v.get("games") or 1)) for v, _o, _i in opts)
        x, acc = rng.random() * tot, 0
        for v, out_c, in_c in opts:
            acc += max(1, int(v.get("games") or 1))
            if acc >= x:
                new_decks = list(decks)
                new_decks[k] = [in_c if c == out_c else c for c in decks[k]]
                return new_decks, {"deck": k, "out": out_c, "in": in_c, "games": int(v.get("games") or 0)}
    return decks, None


def ai_picks(ai_cards: list, your_decks: list, results: str, pick, upto: int) -> list:
    """The AI's deck (index into `ai_cards`) for games 1..`upto`, each chosen
    from what it knew BEFORE that game: its own earlier picks, your decks of
    the EARLIER games and their results (from its side). `pick(ai_played,
    your_played, ai_results) -> (index, info)`. Out: `[(index, info), ...]`,
    stopping at a game where it has no legal deck (index None)."""
    out: list = []
    for g in range(upto):
        played = [ai_cards[i] for i, _info in out]
        idx, info = pick(played, list(your_decks[:g]), _flip(results[:g]))
        out.append((idx, info))
        if idx is None:
            break
    return out


def _side_cached(me: str, opp: str, me_win: tuple, opp_win: tuple, kind) -> dict:
    ck = (me, opp, tuple(me_win), tuple(opp_win), kind)
    with _side_lock:
        got = _side_cache.get(ck)
        if got and time.time() - got[0] < CACHE_TTL_S:
            return got[1]
    side = _side(me, opp, me_win, opp_win, kind)
    with _side_lock:
        if len(_side_cache) >= CACHE_MAX:
            for k in sorted(_side_cache, key=lambda k: _side_cache[k][0])[: CACHE_MAX // 2]:
                _side_cache.pop(k, None)
        _side_cache[ck] = (time.time(), side)
    return side


def prep(you: str, ai: str, you_win: tuple, ai_win: tuple, kind=None) -> dict:
    """Both players read once (and kept), before the first game: your player as
    the screen shows them, Coach Assist's set for your player (to fill a game's
    deck in one press), and the AI coach without its decks."""
    y = _side_cached(you, ai, you_win, ai_win, kind)
    a = _side_cached(ai, you, ai_win, you_win, kind)
    return {"brain": BRAIN, "mode": "prep",
            "you": _public(y) | {"set": [_brief(_seat(d)) for d in y["decks"]], "pool": _you_pool(y)},
            "ai": _public(a, with_set=False)}


def _rng(*parts) -> "random.Random":
    import hashlib
    import random
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(h[:16], 16))


def _deck_row(cards: list) -> dict:
    import coach
    import duel_zone as dz
    a = coach._archetype(list(cards))
    row = {"archetype": a, "deckName": dz.deck_label(list(cards), a)}
    row.update(dz._arranged(list(cards), {}))
    return row


# A deck that fails `_sensible` still counts this much (of its weight) when the
# sensible ones cannot fill the format on their own.
UNSENSIBLE_WEIGHT = 0.05


def _sensible(cards, seed=None) -> bool:
    """Does the deck make sense (`coach._constructed_ok`: its spell set, its
    buildings and its least-run card against what duel players field with its
    win condition, and the duel card-pairing gate, which a deck proven in 30+
    real duels passes)? Asked for (2026-10-21) after the AI brought a Golem
    list with a Goblin Hut and a Tornado: "check the synergy, it must make
    sense". A missing table is no gate."""
    try:
        import coach
        return bool(coach._constructed_ok(list(cards), seed=list(seed) if seed else None))
    except Exception:  # noqa: BLE001 - no tables, no gate
        return True


def _seat(row: dict) -> dict:
    """The row with every special slot its cards can fill drawn in its form
    (`clash_data.complete_seating`): observed forms keep their seats, the
    rest are filled. Reported 2026-10-21: evolutions and heroes were drawn as
    plain cards on decks that came without marks."""
    cards = list(row.get("cards") or [])
    if len(cards) != 8:
        return row
    try:
        import clash_data as cd
        art = dict(row.get("art") or {})
        ordered, art2, filled = cd.complete_seating(cards, art, cd.seated_positions(cards, art))
    except Exception:  # noqa: BLE001 - drawn as it came
        return row
    out = dict(row)
    out["cards"], out["art"] = list(ordered), dict(art2)
    if filled:
        out["artFilled"] = sorted(set(filled) | set(row.get("artFilled") or []))
    return out


def _style_lists(s: dict) -> list[dict]:
    """Real duel lists on the player's own main win conditions (`STYLE_*`)."""
    try:
        import duel_index as di
    except Exception:  # noqa: BLE001 - no index, no lists
        return []
    wins = [w.get("card") for w in _profile((s["answer"].get("profiles") or {}).get("mine"))][:STYLE_WINCONS]
    out: list[dict] = []
    for wc in wins:
        if not wc:
            continue
        try:
            rows = di.decks_holding([wc], min_games=STYLE_MIN_GAMES, limit=400)
        except Exception:  # noqa: BLE001
            continue
        n = 0
        for r in rows:
            g = int(r.get("games") or 0)
            if int(r.get("players") or 0) < STYLE_MIN_PLAYERS or 2 * int(r.get("topPilot") or 0) > g:
                continue
            try:
                row = _deck_row(list(r["cards"]))
            except Exception:  # noqa: BLE001
                continue
            out.append(row | {"games": g, "origin": "duel"})
            n += 1
            if n >= STYLE_PER_WINCON:
                break
    return out


def _pool(s: dict) -> list[dict]:
    """Every deck a coach may load for its player, kept on the side (it is
    read once): `[{"cards", "row", "weight", "counter", "sensible"}]`.

    The player's own duel rotation weighted by how often they play each (their
    trend), Coach Assist's answer and the counters to the other player, and
    real duel lists on their own win conditions. Lists within one card of a
    deck already in are the same deck. Every row is seated (`_seat`)."""
    got = s.get("_pool")
    if got is not None:
        return got
    import coach
    own = coach._own_duel_decks((s.get("keep") or {}).get("mine_hist"), set())
    own, _dropped = coach._drop_event_decks(own)
    counts = sorted(int(r.get("count") or 1) for r in own) or [1]
    median = float(counts[len(counts) // 2])
    counters = list(((s["answer"].get("counters") or {}).get("decks")) or [])
    entries: list[dict] = []
    for rows, weight, counter in ((own, None, False), (counters, COUNTER_WEIGHT * median, True),
                                  (s["decks"], median, False), (_style_lists(s), STYLE_WEIGHT * median, False)):
        for r in rows:
            cards = set(r.get("cards") or [])
            if len(cards) != 8 or any(len(cards & set(e["cards"])) >= REPEAT_NEAR for e in entries):
                continue
            row = _seat(dict(r))
            entries.append({"cards": list(row["cards"]), "row": row, "counter": bool(counter or r.get("counter")),
                            "weight": float(r.get("count") or 1) if weight is None else weight,
                            "sensible": _sensible(row["cards"])})
    s["_pool"] = entries
    return entries


def _you_pool(y: dict) -> list[dict]:
    """The decks offered to YOU, best first against the AI player as your
    coach reads them; Coach Assist's own set leads. Reported 2026-10-21:
    "the Coach Assist pick is always the same, it needs to differ every
    time" — the screen cycles this list and never offers a deck twice until
    it has offered them all."""
    got = y.get("_youPool")
    if got is not None:
        return got
    entries = _pool(y)
    good = [e for e in entries if e["sensible"]]
    if len(good) < 2 * SET_MAX:
        good = entries
    rows_read = []
    if y.get("read") is not None and y.get("win") is not None:
        try:
            rows_read = [(frozenset(c), float(p)) for c, p in (y["read"]((), None) or [])[:YOU_READ_ROWS]]
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            rows_read = []

    def value(cards) -> float | None:
        tot = sum(p for _c, p in rows_read)
        if tot <= 0:
            return None
        try:
            mine = frozenset(cards)
            return sum(p * float(y["win"](mine, c)) for c, p in rows_read) / tot
        except Exception:  # noqa: BLE001
            return None

    lead = [_key(d["cards"]) for d in y["decks"]]
    scored = [(e, value(e["cards"])) for e in good]
    first = sorted((x for x in scored if _key(x[0]["cards"]) in lead), key=lambda x: lead.index(_key(x[0]["cards"])))
    rest = sorted((x for x in scored if _key(x[0]["cards"]) not in lead),
                  key=lambda x: (-(x[1] if x[1] is not None else -1.0), _key(x[0]["cards"])))
    out = []
    for e, v in (first + rest)[:YOU_POOL]:
        row = _brief(e["row"]) | ({"counter": True} if e["counter"] else {})
        if v is not None:
            row["vsRead"] = round(100 * v, 1)
        out.append(row)
    y["_youPool"] = out
    return out


def _ai_set(a: dict, read, round_: int, seed: str, games: int = GAMES,
            faced: list | None = None) -> tuple[list, dict | None, dict]:
    """The AI coach's decks for duel number `round_` (0 = the first) of a best
    of `games`: `(rows, switch, info)`.

    Every deck must make sense (`_sensible`), and NO DECK IT BROUGHT IN AN
    EARLIER DUEL OF THE SESSION (`faced`, sent by the screen) comes back while
    fresh ones can fill the format (reported 2026-10-21: "the decks repeat on
    a rematch, they should not"). When they cannot, the rest come in at a
    small weight and the set with the fewest of them is chosen."""
    most, fewest = FORMATS.get(games, FORMATS[GAMES])
    base = [dict(d) for d in a["decks"]]
    faced_sets = [frozenset(d) for d in faced or [] if len(set(d)) == 8]

    def repeat(cards) -> bool:
        s = set(cards)
        return any(len(s & f) >= REPEAT_NEAR for f in faced_sets)

    base_ok = all(_sensible(d["cards"]) and not repeat(d["cards"]) for d in base)
    if a["win"] is None or (round_ <= 0 and len(base) >= fewest and base_ok):
        return [_seat(d) for d in base], None, {"source": "coach-assist"}
    rng = _rng(seed, round_)
    every = [dict(e, repeat=repeat(e["cards"])) for e in _pool(a)]
    dropped = sum(1 for e in every if not e["sensible"])
    memo: dict = {}

    def value(group):
        k = frozenset(_key(d) for d in group)
        if k not in memo:
            out = dp.plan(group, read, a["win"], games=games)
            memo[k] = out["options"][0]["duel"] if out.get("options") else 0.0
        return memo[k]

    def draw(pool, score=None, shrink=False):
        # Without the decks faced (an older screen), at least not the set
        # Coach Assist loaded in duel 1.
        base_keys = frozenset(i for i, e in enumerate(pool) if _key(e["cards"]) in {_key(d["cards"]) for d in base})
        return vary_set(pool, score or value, rng, size=most, min_size=fewest,
                        band=0.0 if round_ <= 0 else VARY_BAND,
                        avoid=base_keys if round_ == 1 and not faced_sets else None, shrink=shrink)

    # Fresh decks that make sense; then fresh ones of any kind; then repeats.
    # A penalty of 1 a deck outweighs any duel value (a chance, under 1), so a
    # fallback set holds as few such decks as it can.
    tiers = (
        ([e for e in every if e["sensible"] and not e["repeat"]], False),
        ([e for e in every if not e["repeat"]], True),
        (every, True),
    )
    entries, pick, fallback = every, None, False
    for i, (pool_, penal) in enumerate(tiers):
        if len(pool_) < fewest:
            continue
        pool_ = [dict(e, weight=e["weight"] * (1.0 if e["sensible"] else UNSENSIBLE_WEIGHT)
                      * (REPEAT_WEIGHT if e["repeat"] else 1.0)) for e in pool_]
        bad = {_key(e["cards"]) for e in pool_ if not e["sensible"] or e["repeat"]}
        pick = draw(pool_, (lambda g, bad=bad: value(g) - sum(1 for d in g if _key(d) in bad)) if penal else None,
                    shrink=penal)
        if pick:
            entries, fallback = pool_, i > 0
            break
    if not pick:
        return [_seat(d) for d in base], None, {"source": "coach-assist", "reason": "no_draw"}
    rows = [dict(entries[i]["row"]) | ({"counter": True} if entries[i].get("counter") else {}) for i in pick]
    cards = [list(r["cards"]) for r in rows]
    switch = None
    if round_ > 0:
        def variants(c):
            try:
                import duel_index as di
                return di.near_variants(c)
            except Exception:  # noqa: BLE001 - no index, no switch
                return []
        # A switch must leave the deck making sense AND not turn it into one
        # already faced this session.
        cards2, switch = switch_card(cards, variants, rng,
                                     ok=lambda new, old: _sensible(new, seed=old) and not repeat(new))
        if switch:
            k = switch["deck"]
            rows[k] = _seat(_deck_row(cards2[k])) | ({"counter": True} if rows[k].get("counter") else {}) | {"switched": True}
    info = {"source": "rotation" if round_ > 0 else "composed",
            "candidates": len(entries), "dropped": dropped, "fallback": fallback,
            "unsensible": sum(1 for i in pick if not entries[i]["sensible"]),
            "repeats": sum(1 for i in pick if entries[i]["repeat"]), "faced": len(faced_sets),
            "value": round(100 * value([r["cards"] for r in rows]), 1)}
    return rows, switch, info


def turn(you: str, ai: str, your_decks: list, results: str, you_win: tuple, ai_win: tuple,
         kind=None, round_: int = 0, seen: list | None = None, games: int = GAMES,
         play_all: bool = False, faced: list | None = None) -> dict:
    """One game of you against the AI coach. See the section note above.

    `your_decks` are your decks of every game so far, in order, THIS game's
    last; `results` who won each earlier game from your side ('w' / 'l').
    `play_all` plays every game of the format even once the duel is decided
    (asked for: "play all games of the duel / stop as you win").
    """
    import coach
    base = {"brain": BRAIN, "mode": "game", "games": int(games), "round": int(round_),
            "playAll": bool(play_all)}
    if games not in FORMATS:
        return {**base, "error": "bad_format"}
    need = games // 2 + 1
    decks = [list(dict.fromkeys(d)) for d in your_decks if d]
    res = "".join(c for c in str(results or "").lower() if c in "wl")
    known = set(coach.dx.card_keys()) if hasattr(coach, "dx") else None
    flat = [c for d in decks for c in d]
    if (not 1 <= len(decks) <= games or any(len(d) != 8 for d in decks)
            or len(flat) != len(set(flat)) or (known and any(c not in known for c in flat))):
        return {**base, "error": "bad_decks"}
    if len(res) != len(decks) - 1 or (not play_all and (res.count("w") >= need or res.count("l") >= need)):
        return {**base, "error": "bad_results"}
    y = _side_cached(you, ai, you_win, ai_win, kind)
    a = _side_cached(ai, you, ai_win, you_win, kind)
    if a["win"] is None and y["win"] is None:
        return {**base, "error": "no_brain"}
    ai_read = blend_read(a["read"], seen or [])
    # THE AI'S SET BELONGS TO THE DUEL, not to the game: worked out once and
    # kept, so a best of 5 (five decks composed, ~9 s on the VPS) pays it on
    # game 1 only. Keyed on everything it depends on; `id(a)` changes when the
    # side is read again.
    sk = (id(a), you, ai, games, int(round_), tuple(sorted(_key(d) for d in seen or [])),
          tuple(sorted(_key(d) for d in faced or [])))
    with _side_lock:
        hit = _set_cache.get(sk)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        rows, switch, set_info = hit[1]
    else:
        rows, switch, set_info = _ai_set(a, ai_read, int(round_), f"{you}|{ai}|{games}", games, faced)
        with _side_lock:
            if len(_set_cache) >= CACHE_MAX:
                for k in sorted(_set_cache, key=lambda k: _set_cache[k][0])[: CACHE_MAX // 2]:
                    _set_cache.pop(k, None)
            _set_cache[sk] = (time.time(), (rows, switch, set_info))
    ai_cards = [list(r["cards"]) for r in rows]
    if len(ai_cards) < FORMATS[games][1]:
        return {**base, "error": "short_set", "name": a["name"], "decks": len(ai_cards)}

    game = len(decks)
    picks = ai_picks(ai_cards, decks, res, policy(ai_cards, ai_read, a["win"], games=games), game)
    now, info = picks[-1] if len(picks) == game else (None, {})
    exp = []
    for e in (info or {}).get("expected") or []:
        exp.append({"name": _label(e["cards"], a), "p": e["p"], "cards": e["cards"],
                    "hit": len(set(e["cards"]) & set(decks[-1])) >= NEAR})

    # The game's chance — your deck against the AI's, which was chosen without it.
    if now is None:
        matchup = chance = 1.0
    else:
        matchup = min(max(_referee(y["win"], a["win"])(decks[-1], ai_cards[now]), 1e-6), 1 - 1e-6)
        chance = dp.shifted(matchup, res[-1] if res else None, game)
    odds = None
    if y["win"] is not None:
        try:
            ai_shown = [ai_cards[i] for i, _ in picks[:game - 1] if i is not None]
            out = dp.plan([decks[-1]], y["read"], y["win"], my_played=decks[:-1],
                          opp_played=ai_shown, results=res, games=games)
            if out.get("options"):
                o = out["options"][0]
                odds = {"game": round(100 * o["game"], 1), "duel": round(100 * o["duel"], 1)}
        except Exception:  # noqa: BLE001 - the figure is extra
            traceback.print_exc()
    return {
        **base, "game": game,
        "you": _public(y, with_set=False) | {"deck": _brief(_deck_row(decks[-1]))},
        "ai": _public(a, with_set=False) | {"set": [_brief(r) for r in rows]},
        "aiSet": set_info, "switch": switch,
        "aiDeck": now, "aiPicks": [i for i, _ in picks],
        "believed": (info or {}).get("believed"), "expected": exp,
        "matchup": round(100 * matchup, 1), "chance": round(100 * chance, 1),
        "yourOdds": odds, "seen": len(seen or []),
    }


if __name__ == "__main__":  # pragma: no cover - a manual run on the server
    import json
    if len(sys.argv) < 3:
        print("usage: coach_duel.py <tag A> <tag B>", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(simulate(sys.argv[1], sys.argv[2], (None, None), (None, None)),
                     indent=1, default=str)[:20000])
