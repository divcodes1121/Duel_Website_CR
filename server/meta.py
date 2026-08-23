"""meta.py — the global meta leaderboard: which decks the whole player base plays.

Different question from everything else in this API, which is per-player. This
one aggregates across all ~88,000 tracked players to answer "what is everyone
running right now", ranked by use rate.

WHY THIS IS PRECOMPUTED, AND WHY IT HAS TO BE.

The obvious implementation — GROUP BY player_deck_hash over a date window on
request — was built and measured first. It is not viable:

    window   via idx_battles_time    full table scan
     7 days      39.9 s                    —
    10 days      48.3 s (49.3 s warm)    45.1 s
    30 days      76.3 s                    —

The cost is I/O, not CPU. `idx_battles_time` yields rowids in time order and
then every one of ~1.4M rows has to be fetched from a 12.9 GB table whose rows
carry two JSON card-list columns. Warm re-runs do not improve it, and forcing a
sequential scan instead only saves ~8%.

The normal fix is a covering index on (battle_time, player_deck_hash). THAT IS
NOT AVAILABLE HERE: this process opens the bot's databases `mode=ro` precisely
so it can never modify them, and adding an index to a live 12.9 GB file the bot
is writing to is exactly the kind of "small change" that is not ours to make.

So the rollup runs on a background thread on a timer and requests are served
from the finished snapshot. The scan still costs ~45 s; it just no longer
happens while somebody is waiting. Because the meta moves over days and not
seconds, a refresh every REFRESH_SECONDS is comfortably fresher than the thing
it is describing, and every response carries `computedAt` so the UI can say
exactly how old the numbers are rather than implying they are live.

The snapshot is persisted next to this file so a restart serves the previous
numbers immediately while the first refresh runs.
"""

from __future__ import annotations

import json
import os
import threading
import time

import clash_data as cd
import duel_combos as dcx

# Days of history the leaderboard covers.
WINDOW_DAYS = int(os.getenv("CLASH_META_DAYS", "10"))

# How often the background thread recomputes. The meta shifts over days, so
# half an hour is far finer-grained than the signal.
REFRESH_SECONDS = float(os.getenv("CLASH_META_REFRESH", "1800"))

# How many decks the leaderboard holds. The UI shows a scrolling list, so this
# is the depth of the whole board rather than of the first screen.
BOARD_SIZE = int(os.getenv("CLASH_META_SIZE", "50"))

# HOW MANY DIFFERENT PLAYERS A DECK NEEDS BEFORE IT COUNTS AS "META".
#
# Not a smoothing constant — it fixes a real result. Without it the first board
# ranked a deck 50th on 1,703 Ladder battles at an 8.5% win rate: 144 wins from
# 1,703. The results were clean (only win/loss/draw are stored), so those are
# real battles — they are simply almost all ONE account grinding one deck badly.
#
# A use-rate board is exactly the shape of ranking that a single heavy player
# can inject themselves into, the same disease as the Pair Board inheriting one
# deck's stats 28 times. "What the player base is running" has to be measured
# across the player base, so a deck must be picked up by MIN_PLAYERS different
# people before it is meta rather than a habit.
MIN_PLAYERS = int(os.getenv("CLASH_META_MIN_PLAYERS", "25"))

# VARIANT MERGING. Two decks that share 6 of 8 cards are the same deck wearing a
# tech swap, and counting them separately does two visible kinds of damage:
#
#   * the board printed "Mortar" twice, "Bridge Spam" twice and "Royal Giant"
#     twice — the same archetype split across near-identical lists;
#   * and it made every use rate look impossibly small. The top deck sat at
#     1.79% not because nobody plays Hog but because Hog's play was divided
#     across dozens of one-card variants.
#
# 6-of-8 is the bot's own COUNTER_MIN_OVERLAP, the same threshold !counter, the
# clusterer and the duel matcher share, so "the same deck" means one thing
# across both projects.
MERGE_MIN_OVERLAP = 6

# Only the head of the distribution is clustered — pairwise comparison is
# quadratic, and nothing below the head can reach the board anyway.
CLUSTER_CANDIDATES = int(os.getenv("CLASH_META_CANDIDATES", "600"))

# THE THREE SPECIAL SLOTS. A Clash Royale deck's first three positions carry the
# evolution / hero / champion slots; positions 3-7 are ordinary. Measured on this
# data: of 795 decks whose payload carried evolution marks, **795** had every
# mark inside slots 0-2 — slot 0 in 791, slot 1 in 569, slot 2 in 775.
#
# The rule caps a deck at two evolutions, two heroes and three marks in total,
# and `arrange_deck` is what puts each one in its position. This module does NOT
# apply it as a positional filter over the representative's stored order — that
# deleted real marks off 21 of 50 decks; see `cd.cap_special_marks`.
SPECIAL_SLOTS = 3

# Within those slots a card must still be the deck's HABITUAL fielding, since a
# cluster pools many different players' evolution choices.
ART_MIN_SHARE = 0.25

# The art pass reads only a short recent slice: it has to establish how a deck is
# CURRENTLY brought, and a second full-window scan was most of the rollup's cost.
ART_WINDOW_DAYS = int(os.getenv("CLASH_META_ART_DAYS", "3"))

# Our own file, in our own directory. Nothing here ever writes to the bot's data.
SNAPSHOT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".meta_snapshot.json")

# WHAT COUNTS AS "THE META" — competitive 1v1 where the player chose the deck.
#
# Not every stored battle belongs on this board. `TeamVsTeam` is 2v2, and
# `Crazy_Arena` / `All_Random_Princess` / the event modes either hand the player
# a deck or randomise it, so counting them would measure Supercell's choices
# rather than the player base's. Friendly and duel modes are excluded too — they
# have their own screen.
META_MODES = {
    "ranked1v1_newarena2",
    "ranked1v1_newarena",
    "ladder",
    "cw_battle_1v1",
    "tournament",
}

_lock = threading.Lock()
_snapshot: dict | None = None
_state = {"building": False, "error": None, "startedAt": None}


# One definition, in clash_data — the board and the player screen must not name
# the same archetype two different ways.
_archetype_title = cd._archetype_title


# Also in clash_data, for the same reason as `_archetype_title`: the Duel Zone
# lists a player's openers and hit the identical problem — two genuinely
# different Mortar decks, both labelled "Mortar".
_deck_name = cd.deck_name


def select_board(rows, min_players: int = None, size: int = None):
    """Rank and filter the raw GROUP BY output. PURE — no database.

    Returns (board_rows, total_battles, excluded_count).

    Extracted so the two rules that decide what the board claims can be tested
    directly: the distinct-player floor, and the fact that the use-rate
    denominator counts EVERY competitive battle in the window rather than only
    the ones on decks that survived the floor. `rows` may be sqlite3.Row objects
    or plain dicts — both index by key.
    """
    min_players = MIN_PLAYERS if min_players is None else min_players
    size = BOARD_SIZE if size is None else size

    # The denominator is every competitive battle in the window, including the
    # ones on decks the floor rejects — use rate is a share of all play, not a
    # share of the board.
    total = sum(r["n"] or 0 for r in rows)
    eligible = [r for r in rows if (r["players"] or 0) >= min_players]
    excluded = len(rows) - len(eligible)
    # Deterministic tiebreak on the hash: deck counts tie constantly at the
    # tail, and row order is not an order.
    ranked = sorted(eligible, key=lambda r: (-(r["n"] or 0), r["h"]))[:size]
    return ranked, total, excluded


def cluster_variants(rows, min_overlap: int = MERGE_MIN_OVERLAP, size: int = None):
    """Merge near-identical decks into one board entry. PURE — no database.

    `rows` are the ranked, floor-passing decks, biggest first; each needs "h",
    "n", "w", "d" and a "cards" set. Greedy, most-played first: the first deck
    to claim a cluster becomes its representative, and any later deck sharing
    `min_overlap` cards with that representative folds into it.

    Greedy-from-the-top is deliberate. It makes the representative the variant
    the player base actually plays most, rather than whichever list happened to
    be compared first, and it is the same shape as the bot's
    `_cluster_player_decks`.

    Returns clusters as dicts carrying the representative plus summed counts and
    a `variants` count, so the board can say a row is one deck rather than
    twelve near-copies of it.
    """
    size = BOARD_SIZE if size is None else size
    clusters: list[dict] = []
    for r in rows:
        cards = r["cards"] if isinstance(r["cards"], set) else set(r["cards"])
        placed = False
        for c in clusters:
            if len(cards & c["cards"]) >= min_overlap:
                c["n"] += r["n"] or 0
                c["w"] += r["w"] or 0
                c["d"] += r["d"] or 0
                c["variants"] += 1
                placed = True
                break
        if not placed:
            clusters.append(
                {
                    "h": r["h"],
                    "cards": cards,
                    "order": r.get("order") or sorted(cards),
                    "n": r["n"] or 0,
                    "w": r["w"] or 0,
                    "d": r["d"] or 0,
                    "players": r.get("players") or 0,
                    "last": r.get("last") or "",
                    "variants": 1,
                }
            )
    # Merging changes the ordering, so rank again afterwards. Explicit tiebreak
    # on the hash for the same reason as everywhere else in this project.
    clusters.sort(key=lambda c: (-c["n"], c["h"]))
    return clusters[:size]


def card_totals(rows, total: int) -> list[dict]:
    """Global use and win rate for every card, from the board's OWN scan.

    PURE, so the rule is testable without a database.

    `player_deck_hash` is the sorted card list — that is stated all over this
    project and is why the hash is useless for display — which means the grouped
    result the board already has is also a complete per-card tally. Splitting
    each hash and adding that row's battles and wins to each of its eight cards
    is EXACT, not a sample: every competitive battle in the window contributes
    its whole deck. So this costs a dictionary walk over the deck hashes rather
    than a second 45-second pass over `battles`.

    It is computed over `rows`, the full grouped result, and not over the ranked
    board: the board is the top 600 candidates and the 25-player floor has
    already thrown decks away, so counting cards there would answer "what is on
    the leaderboard" while the label says "what people play".

    Use rate is a share of every competitive battle in the window, the same
    denominator the deck board uses, so the two figures are comparable.
    """
    tally: dict[str, dict] = {}
    for r in rows:
        h = r["h"] or ""
        n, w = r["n"] or 0, r["w"] or 0
        if not n:
            continue
        # A hash with the wrong shape is a duel loadout or junk, never a deck —
        # `deck_counter._build_reps` rejects the same thing for the same reason.
        keys = [c for c in h.split(",") if c]
        if len(keys) != 8:
            continue
        for c in set(keys):
            t = tally.setdefault(c, {"battles": 0, "wins": 0, "decks": 0})
            t["battles"] += n
            t["wins"] += w
            t["decks"] += 1

    out = []
    for card, t in tally.items():
        n, w = t["battles"], t["wins"]
        out.append(
            {
                "key": card,
                "battles": n,
                "wins": w,
                "decks": t["decks"],
                "useRate": round(n / total * 100, 3) if total else 0.0,
                "winRate": round(w / n * 100, 1) if n else 0.0,
            }
        )
    # Ties break on the key so identical data always ranks identically.
    out.sort(key=lambda c: (-c["battles"], c["key"]))
    return out


def merge_forms(cards: list[dict], forms: dict) -> None:
    """Attach per-form records to the card rows, in place.

    A card carries `forms` ONLY if it was seen in a battle that recorded which
    form was fielded, so the client can tell "never observed in either form"
    from "observed, zero" — the same distinction `player_cards.py` draws, for
    the same reason.

    A form's use rate is a share of the MARKED battles, never of every battle:
    a share of a population the form could not have been observed in would
    understate every one of them by the coverage gap.
    """
    for row in cards:
        seen = forms.get(row["key"])
        if not seen:
            continue
        total = sum(v["battles"] for v in seen.values())
        if not total:
            continue
        row["forms"] = {
            name: {
                "battles": v["battles"],
                "wins": v["wins"],
                "winRate": round(v["wins"] / v["battles"] * 100, 1) if v["battles"] else 0.0,
                "share": round(v["battles"] / total * 100, 1),
            }
            for name, v in sorted(seen.items())
            if v["battles"]
        }


def _evo_art(con, lo: str, hashes: list[str]) -> tuple[dict, dict, dict, dict]:
    """({deck_hash: {card: variant}}, {deck_hash: {card: slot}}, forms, coverage).

    `player_evo` is JSON and only ~29% of rows carry it, so this parses only the
    rows that have it AND belong to a deck on the board. The variant is read off
    the mark's LEVEL rather than its `art` string — `cd.mark_variant` records
    why, and it is the difference between this board drawing heroes and not.

    Two constraints. A card must be marked in at least ART_MIN_SHARE of the
    deck's sampled battles, because a row here is a CLUSTER and pools many
    players' choices; and the survivors are then capped to the slots that
    exist — two evolutions, two heroes, three in total, most-observed first.

    Together those stop a deck being drawn with five evolved cards. The cap used
    to be positional instead, against the representative's stored order, and it
    silently deleted a fifth of the board's marks: see `cd.cap_special_marks`.

    The second return is the slot each mark was most often seen in, which is the
    only thing that can order two marks of the same form.

    The third and fourth are a GLOBAL per-card form record — an evolved
    Skeletons scored apart from a plain one — and how thin the evidence for it
    is. They come out of this same cursor deliberately: the pass is most of the
    rollup's cost, and a second scan of the same rows is how the board's art and
    the card board's forms would eventually describe different battles.

    They are tallied BEFORE the two filters below them. `want` keeps only decks
    on the board and the 400-row cap keeps only enough of each to establish a
    habit — both correct for drawing a deck, both wrong for counting cards,
    because they would answer "how do the top decks field this card" while the
    label says "how does everyone".
    """
    if not hashes:
        return {}, {}, {}, {}
    want = set(hashes)
    tally: dict[str, dict[str, dict[str, int]]] = {}
    where: dict[str, dict[str, dict[int, int]]] = {}
    seen: dict[str, int] = {}
    forms: dict[str, dict[str, dict[str, int]]] = {}
    cov = {"battles": 0, "from": "", "to": ""}
    try:
        cur = con.execute(
            "SELECT player_deck_hash AS h, player_evo AS e, player_card_keys AS k, "
            "       result AS res, battle_time AS t "
            "FROM battles "
            "WHERE battle_time >= ? AND player_evo IS NOT NULL AND player_evo != ''",
            (lo,),
        )
        for r in cur:
            h = r["h"]
            try:
                marks = json.loads(r["e"])
            except Exception:
                continue
            try:
                keys = json.loads(r["k"] or "[]")
            except Exception:
                keys = []

            # ── the global per-card form tally, over every marked row ────────
            # Only a battle that recorded the form can be split, and BOTH sides
            # come from that subset: inside a marked row, a card carrying no
            # mark of its own was fielded plain, and that is the only place
            # `base` can honestly be counted from. Outside one the form is
            # unknown, which is not the same thing.
            if len(keys) == 8:
                cov["battles"] += 1
                t = r["t"] or ""
                if t:
                    cov["from"] = min(cov["from"] or t, t)
                    cov["to"] = max(cov["to"], t)
                won = 1 if (r["res"] or "") == "win" else 0
                worn = {}
                for m in marks:
                    v = cd.mark_variant(m)
                    if v:
                        worn[m[0]] = v
                for c in set(keys):
                    bucket = forms.setdefault(c, {})
                    slot = bucket.setdefault(worn.get(c, "base"), {"battles": 0, "wins": 0})
                    slot["battles"] += 1
                    slot["wins"] += won

            # ── the board's own art, which wants a much narrower sample ──────
            if h not in want:
                continue
            # Enough rows to know the usual fielding; more would only cost time.
            if seen.get(h, 0) >= 400:
                continue
            seen[h] = seen.get(h, 0) + 1
            deck = tally.setdefault(h, {})
            seats = where.setdefault(h, {})
            for m in marks:
                v = cd.mark_variant(m)
                if not v:
                    continue
                per = deck.setdefault(m[0], {})
                per[v] = per.get(v, 0) + 1
                if m[0] in keys:
                    pos = seats.setdefault(m[0], {})
                    i = keys.index(m[0])
                    pos[i] = pos.get(i, 0) + 1
    except Exception:
        return {}, {}, {}, {}

    out: dict[str, dict[str, str]] = {}
    slots: dict[str, dict[str, int]] = {}
    for h, cards in tally.items():
        sampled = seen.get(h, 0)
        if not sampled:
            continue
        habitual = []
        for card, kinds in cards.items():
            n = sum(kinds.values())
            if n / sampled < ART_MIN_SHARE:
                continue
            # Deterministic on ties, so identical data renders identically.
            habitual.append((n, card, max(sorted(kinds), key=lambda k: kinds[k])))
        picked = cd.cap_special_marks(habitual)
        if picked:
            out[h] = picked
            slots[h] = {
                c: max(sorted(p), key=lambda i: p[i])
                for c, p in (where.get(h) or {}).items()
                if c in picked
            }
    return out, slots, forms, cov


def _compute() -> dict:
    """One pass over the window. Hot tier only — it holds ~102 days, so a
    10-day window never needs the archive."""
    path = cd.resolve_db_path()
    if not path:
        raise RuntimeError("no readable database")

    cov = cd.coverage()
    if not cov["end"]:
        raise RuntimeError("no battles stored")

    import datetime as _dt

    end = _dt.date.fromisoformat(cov["end"])
    start = end - _dt.timedelta(days=WINDOW_DAYS - 1)
    lo = start.isoformat().replace("-", "")

    started = time.time()
    con = cd.connect(path)
    try:
        placeholders = ",".join("?" for _ in META_MODES)
        rows = con.execute(
            f"""
            SELECT player_deck_hash AS h,
                   COUNT(*) AS n,
                   COUNT(DISTINCT player_tag) AS players,
                   SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END) AS w,
                   SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS d,
                   MAX(battle_time) AS last
            FROM battles
            WHERE battle_time >= ?
              AND lower(game_mode) IN ({placeholders})
              AND player_deck_hash IS NOT NULL AND player_deck_hash != ''
            GROUP BY h
            """,
            (lo, *sorted(META_MODES)),
        ).fetchall()

        ranked, total, excluded = select_board(rows, size=CLUSTER_CANDIDATES)

        # Deck metadata for every clustering candidate, so a representative
        # carries the right archetype, elixir and played card ORDER.
        meta: dict[str, dict] = {}
        for i in range(0, len(ranked), 400):
            chunk = ranked[i : i + 400]
            ph = ",".join("?" for _ in chunk)
            for m in con.execute(
                f"SELECT deck_hash, cards, archetype, avg_elixir, win_condition "
                f"FROM decks WHERE deck_hash IN ({ph})",
                [r["h"] for r in chunk],
            ):
                meta[m["deck_hash"]] = m

        candidates = []
        for r in ranked:
            h = r["h"]
            m = meta.get(h)
            order = []
            if m and m["cards"]:
                try:
                    order = json.loads(m["cards"])
                except Exception:
                    order = []
            keys = [c for c in (h or "").split(",") if c]
            candidates.append(
                {
                    "h": h,
                    "cards": set(keys),
                    "order": order or keys,
                    "n": r["n"] or 0,
                    "w": r["w"] or 0,
                    "d": r["d"] or 0,
                    "players": r["players"] or 0,
                    "last": r["last"] or "",
                }
            )

        clusters = cluster_variants(candidates)

        # Which cards each surviving deck is fielded WITH EVOLUTION OR HERO ART.
        # `player_evo` stores [card_key, level, art] where art is already
        # resolved to 'evolution' or 'hero' by the bot — the fact, not an
        # inference. A positional guess would be wrong here: measured over 391
        # real rows, only 63 had their marked cards inside the first two slots.
        # ART_WINDOW_DAYS, not the whole window: this only has to establish how
        # each deck is currently brought, and the second scan was most of the
        # rollup's cost. A shorter bound means idx_battles_time touches far
        # fewer rows.
        art_lo = (end - _dt.timedelta(days=ART_WINDOW_DAYS - 1)).isoformat().replace("-", "")
        art, art_slots, card_forms, form_cov = _evo_art(
            con, max(art_lo, lo), [c["h"] for c in clusters]
        )
    finally:
        con.close()

    # The global card board, off the SAME grouped result the decks came from.
    cards_board = card_totals(rows, total)
    merge_forms(cards_board, card_forms)

    card_meta = {c: dcx.card_info(c) for c in {c for r in clusters for c in r["order"]}}

    decks = []
    for i, r in enumerate(clusters):
        h = r["h"]
        m = meta.get(h)
        n, w, d = r["n"] or 0, r["w"] or 0, r["d"] or 0
        cards, slot_art = cd.arrange_deck(
            (r["order"] or sorted(r["cards"]))[:8], art.get(h, {}),
            slot_of=art_slots.get(h),
        )
        decks.append(
            {
                "rank": i + 1,
                "deckHash": h,
                "name": _deck_name(m["archetype"] if m else None, cards, card_meta),
                "cards": cards,
                # Per-card art variant: 'evolution' | 'hero' for the cards this
                # deck is actually fielded with, absent for the rest.
                # Same arrangement as the player screen — see arrange_deck.
                "art": slot_art,
                "variants": r["variants"],
                "players": r["players"] or 0,
                "useRate": round(n / total * 100, 2) if total else 0.0,
                "winRate": round(w / n * 100, 1) if n else 0.0,
                "battles": n,
                "wins": w,
                "losses": max(0, n - w - d),
                "avgElixir": (m["avg_elixir"] if m else None),
                "winCondition": (m["win_condition"] if m else None),
                "lastSeen": r["last"] or "",
            }
        )

    dedupe_names(decks, card_meta)

    return {
        "decks": decks,
        "cards": cards_board,
        # How thin the per-form half is, stated rather than implied: a form's
        # win rate must not pass for the same kind of number as a card's.
        "formCoverage": {
            "battles": form_cov["battles"],
            "from": form_cov["from"][:8] or None,
            "to": form_cov["to"][:8] or None,
            "days": ART_WINDOW_DAYS,
        },
        "window": {"from": start.isoformat(), "to": cov["end"], "days": WINDOW_DAYS},
        "totalBattles": total,
        "distinctDecks": len(clusters),
        "minPlayers": MIN_PLAYERS,
        "excludedByFloor": excluded,
        "modes": sorted(META_MODES),
        "computedAt": time.time(),
        "tookSeconds": round(time.time() - started, 1),
        "refreshSeconds": REFRESH_SECONDS,
    }


def dedupe_names(decks: list[dict], card_meta: dict) -> None:
    """Make every row's name unique, in place. PURE apart from the mutation.

    One qualifier is not always enough: two Golem decks can both lean on Elixir
    Collector. Where a name still collides, the next distinguishing card — the
    priciest card the colliding decks do NOT share — is appended, and if even
    that fails the elixir cost is, which cannot collide because the decks would
    otherwise be the same deck.
    """
    by_name: dict[str, list[dict]] = {}
    for d in decks:
        by_name.setdefault(d["name"], []).append(d)

    for name, group in by_name.items():
        if len(group) < 2:
            continue
        shared = set.intersection(*(set(d["cards"]) for d in group))
        for d in group:
            extra = [c for c in d["cards"] if c not in shared]
            extra.sort(key=lambda c: (-((card_meta.get(c) or {}).get("elixir") or 0), c))
            if extra:
                label = (card_meta.get(extra[0]) or {}).get("name") or extra[0].replace("-", " ").title()
                d["name"] = f"{name} {label}"

    # Anything still tied gets its elixir, which is the last thing separating
    # two decks that share this many cards.
    seen: dict[str, int] = {}
    for d in decks:
        seen[d["name"]] = seen.get(d["name"], 0) + 1
    for d in decks:
        if seen[d["name"]] > 1 and d.get("avgElixir"):
            d["name"] = f"{d['name']} {d['avgElixir']:.1f}"


def _load_snapshot() -> None:
    global _snapshot
    try:
        with open(SNAPSHOT_PATH, encoding="utf-8") as fh:
            _snapshot = json.load(fh)
    except Exception:
        _snapshot = None


def _save_snapshot(snap: dict) -> None:
    # Write to a temp file and replace, so a crash mid-write cannot leave a
    # half-written snapshot that fails to parse on the next boot.
    tmp = SNAPSHOT_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(snap, fh)
        os.replace(tmp, SNAPSHOT_PATH)
    except Exception:
        pass


def refresh(force: bool = False) -> None:
    """Recompute if the snapshot is missing or older than REFRESH_SECONDS."""
    global _snapshot
    with _lock:
        if _state["building"]:
            return
        fresh = (
            _snapshot
            and not force
            and (time.time() - _snapshot.get("computedAt", 0)) < REFRESH_SECONDS
        )
        if fresh:
            return
        _state["building"] = True
        _state["startedAt"] = time.time()
        _state["error"] = None

    try:
        snap = _compute()
        with _lock:
            _snapshot = snap
        _save_snapshot(snap)
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state["error"] = str(exc)
    finally:
        with _lock:
            _state["building"] = False


def _envelope(snap, building, error, started, empty: dict) -> dict:
    if snap is None:
        return {
            "building": True,
            "error": error,
            "elapsedSeconds": round(time.time() - started, 1) if started else 0,
            "window": {"from": None, "to": None, "days": WINDOW_DAYS},
            **empty,
        }
    out = dict(snap)
    out["building"] = building
    out["error"] = error
    # Age in seconds, so the UI can say how old the numbers are instead of
    # implying they are live.
    out["ageSeconds"] = round(time.time() - snap.get("computedAt", 0), 1)
    return out


def board() -> dict:
    """What the deck endpoint returns. Never blocks: if nothing is computed yet
    it says so, and the client polls."""
    with _lock:
        snap, building = _snapshot, _state["building"]
        error, started = _state["error"], _state["startedAt"]
    out = _envelope(snap, building, error, started, {"decks": []})
    # The card board rides in the same snapshot; it has its own endpoint and
    # would otherwise double every meta response for no reader.
    out.pop("cards", None)
    return out


def card_board() -> dict:
    """Global use and win rate for every card, from the same snapshot.

    One rollup, two products. The alternative was a second background scan of
    the same window, which costs the same 45 seconds and creates a second
    source of truth for a number the deck board is already computing on the way
    past. Nothing here is card METADATA — type, elixir, rarity and the
    evolution flags live in `src/data/*.json`, which the browser already loads
    to draw the art.
    """
    with _lock:
        snap, building = _snapshot, _state["building"]
        error, started = _state["error"], _state["startedAt"]
    out = _envelope(snap, building, error, started, {"cards": [], "formCoverage": None})
    out.pop("decks", None)
    return out


def start_background() -> None:
    """Load any previous snapshot, then keep it refreshed on a timer."""
    _load_snapshot()

    def loop():
        while True:
            try:
                refresh()
            except Exception:
                pass
            time.sleep(min(REFRESH_SECONDS, 300))

    threading.Thread(target=loop, daemon=True, name="meta-refresh").start()
