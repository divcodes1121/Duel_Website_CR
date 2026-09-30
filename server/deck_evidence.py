"""WHO PLAYED A DECK, AND IN WHAT MODE — the vetting every suggested deck passes.

Reported 2026-09-30: "the decks Deckkies generates lack synergy — I played two
duels against one opponent on its suggestions and the decks were very odd".
Replayed through the live Coach Assist, game by game, the two lost decks that
could be traced were Deckkies' own output: "Log Bait Mega Knight" (the "Play
this" pick) and "Hog Rider Ronin" (the tuner's compose list). Its compose list
also offered two Three Musketeers + Elixir Collector + Rage lists.

NONE OF THAT WAS A SCORING FAULT. The candidate pool (`deck_counter.seeds()`)
is every deck with 60+ games in `pair_matchup_agg`, the bot's deck-vs-deck
totals — which carry NO player and NO game mode. Measured on the three decks:

    deck                       games  pilots  games/pilot  top pilot
    Hog Rider Musketeer (#1)  218,511  19,614        11.1       1.3%
    Log Bait Mega Knight        2,715   2,415         1.1       0.2%
    Hog Rider Ronin             2,663   2,379         1.1       0.2%
    3M Elixir Rage                743       7       106.1      95.7%

The first two are ROYALE SHUFFLE DECKS (a Supercell event, 21 Sep - 5 Oct
2026, that hands every battle a random deck): their battles are `RR_Event_Mega_Monk`,
`RR_MortarCapture_Friendly`, `RR_Rage_Friendly`… — a rotating event family
that draws every battle from one fixed pool of 42 decks (measured: ~540
battles a mode, exactly 42 distinct lists). Nobody built them; thousands of
people were handed them once. The third is one player's deck: 96% of its games
are theirs, so its 62% is that player's skill, not the list's.

So the pool is vetted here on facts about PLAY, not on the cards:

  pilots      at least `MIN_PILOTS` (25) people play it, and no one of them
              holds more than `MAX_PILOT_SHARE` of its games -- the duel
              brain's catalogue rule, tightened, applied to the ladder pool;
  current     somebody played it in the last `RECENT_DAYS` — the current meta,
              not a list from July;
  own deck    at least `MIN_OWN_SHARE` of its sampled battles are modes where
              the player chose the deck (`battle_modes.is_own_deck_1v1`);
  adds        what the list adds over its pilots' OTHER decks — published,
              not gated: a deck strong players fly is not a strong deck.

A rejected deck is REPLACED by the next real one, so every archetype keeps its
full pool (skip-and-replace, the rule the three-slot filter already uses).

`verdict()` and `pilot_adjusted()` are pure; `vet_pool()` is the one function
that reads the database, on the snapshot's background thread, never a request.
"""

from __future__ import annotations

import datetime as _dt
import heapq
import json
import os
import threading
import time

BRAIN = "deck-evidence-1.0"

#: People who must play a list before it counts as something the meta plays.
#: The duel brain's catalogue asks for 3; that admitted two Three Musketeers
#: lists with 14 and 15 pilots in the staged replay. Measured on the vetted
#: pool, only 20 of 680 decks sit under 25 -- so 25 costs the pool almost
#: nothing and means "a list the field plays", not "a list three people tried".
MIN_PILOTS = 25

#: No single player may hold more than this share of a list's games -- the duel
#: catalogue's rule. The 3 Musketeers Elixir Rage list was 95.7% one player.
MAX_PILOT_SHARE = 0.5

#: The current meta. The pool is built from ALL stored pair rows, back to June.
RECENT_DAYS = 30

#: Share of sampled battles that must be own-deck competitive. Measured on the
#: 680-deck pool: real decks sit at a median of 98%; event decks at 0-10% once
#: the router knows `RR_` (they read ~50% before, when four `RR_*_Friendly`
#: modes still counted as friendlies).
MIN_OWN_SHARE = 0.6

#: Pilots whose battles with the deck are read for the mode share, and the
#: fewest battles that make a share worth trusting (fewer passes, unjudged).
PILOT_SAMPLE = 8
MIN_SAMPLED = 5

#: A pilot's rate with their other decks is shrunk toward 50% by this many
#: games, so a pilot with three other games cannot swing the adjustment.
PILOT_PRIOR = 20.0

#: How long a measured mode share is reused. A deck's mode mix does not change
#: within a day, and the sample is the only per-deck database work here.
CACHE_TTL = 24 * 3600

#: HOW THE PILOTS FIELD IT. The slot order a seed is drawn in, and which card
#: is its evolution or hero, used to be GUESSED from what the cards can be
#: ("from slot position") for every deck not on the meta board's top 50. A
#: Lava Hound list was shown with an evolved Baby Dragon in slot 1 where 90% of
#: its real pilots put Lumberjack. The sample below already reads those
#: pilots' battles, so it records the seating they actually use:
#:   * the dominant first-three order, when at least `SEAT_MIN_SHARE` of
#:     battles share it;
#:   * each card's majority form among battles that field any form, when it is
#:     fielded in at least `MARK_MIN_SHARE` of them, CHECKED AGAINST WHAT THE
#:     CARD CAN BE — the bot labels Elite Barbarians "hero" in 77% of one
#:     list's battles, while the raw API says `evolutionLevel: 1,
#:     maxEvolutionLevel: 1` and the card has no hero form. A form the card
#:     cannot take is swapped for the one it can, or dropped.
SEAT_MIN_SHARE = 0.4
MARK_MIN_SHARE = 0.3

#: The cache format. A hit from an older format is re-sampled once.
CACHE_VERSION = 2

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".deck_evidence.json")

REASONS = ("few_pilots", "one_pilot", "stale", "event")

_lock = threading.Lock()
_cache: dict | None = None
_cache_mtime = 0.0
LAST: dict = {}


# ── Pure rules ────────────────────────────────────────────────────────────────


def stamp(day: _dt.date) -> str:
    """A date in `battle_time` form, for string comparison with `last_seen`."""
    return day.strftime("%Y%m%dT000000.000Z")


def pilot_adjusted(pilots: list[tuple[int, int, int, int]]) -> float | None:
    """Points the deck wins above what its pilots win with their OTHER decks.

    `pilots` is `[(battles, wins, all_battles, all_wins)]` per pilot. Positive
    means the list adds something; near zero means the record is the pilots'.
    None with no games.
    """
    games = wins = 0
    expected = 0.0
    for b, w, ab, aw in pilots:
        ob, ow = max(0, ab - b), max(0, aw - w)
        p = (ow + PILOT_PRIOR / 2.0) / (ob + PILOT_PRIOR)
        expected += b * p
        games += b
        wins += w
    if not games:
        return None
    return round(100.0 * (wins - expected) / games, 1)


def verdict(p: dict, cutoff: str) -> str | None:
    """None when the deck may be offered, else the reason it may not.

    `p` carries `games`, `pilots`, `top` (the largest single pilot's battles),
    `last` (latest `last_seen`), `own` (sampled own-deck share or None) and
    `sampled`. Checked cheapest first, so a one-pilot deck never costs a sample.
    """
    games = int(p.get("games") or 0)
    if int(p.get("pilots") or 0) < MIN_PILOTS or not games:
        return "few_pilots"
    if int(p.get("top") or 0) / games > MAX_PILOT_SHARE:
        return "one_pilot"
    if (p.get("last") or "") < cutoff:
        return "stale"
    own = p.get("own")
    if own is not None and int(p.get("sampled") or 0) >= MIN_SAMPLED and own < MIN_OWN_SHARE:
        return "event"
    return None


def observed_seating(first3: dict, marks: dict, marked: int, battles: int,
                     kind) -> dict | None:
    """How the pilots field a list, or None when the evidence does not say.

    `first3` is `{(c0, c1, c2): battles}`; `marks` `{(card, form): battles}`
    over the `marked` battles that fielded any form; `kind(card)` is
    `clash_data.slot_kind` ("evolution" | "hero" | "both" | "champion" | "").
    """
    if battles < MIN_SAMPLED:
        return None
    slots = None
    if first3:
        top, n = max(first3.items(), key=lambda kv: (kv[1], kv[0]))
        if n / battles >= SEAT_MIN_SHARE:
            slots = {c: i for i, c in enumerate(top)}
    art: dict[str, str] = {}
    if marked:
        per: dict[str, dict[str, int]] = {}
        for (card, form), n in marks.items():
            per.setdefault(card, {})[form] = per.setdefault(card, {}).get(form, 0) + n
        for card, forms in per.items():
            if sum(forms.values()) / marked < MARK_MIN_SHARE:
                continue
            form = max(forms.items(), key=lambda kv: (kv[1], kv[0]))[0]
            k = kind(card)
            can = {"evolution": {"evolution"}, "hero": {"hero"},
                   "both": {"evolution", "hero"}}.get(k, set())
            if form not in can:
                other = "hero" if form == "evolution" else "evolution"
                if other not in can:
                    continue
                form = other
            art[card] = form
    if not slots and not art:
        return None
    return {"slots": slots, "art": art, "battles": battles}


def public(p: dict) -> dict:
    """What rides on a seed: counts and shares, never a player tag."""
    games = int(p.get("games") or 0)
    return {
        "pilots": int(p.get("pilots") or 0),
        "topShare": round(int(p.get("top") or 0) / games, 3) if games else None,
        "ownShare": None if p.get("own") is None else round(p["own"], 3),
        "adds": p.get("adds"),
        "lastSeen": (p.get("last") or "")[:8] or None,
        "brain": BRAIN,
    }


# ── The cache ─────────────────────────────────────────────────────────────────


def _load() -> dict:
    global _cache, _cache_mtime
    try:
        m = os.path.getmtime(PATH)
    except OSError:
        m = 0.0
    with _lock:
        if _cache is None or m > _cache_mtime:
            try:
                with open(PATH, encoding="utf-8") as f:
                    _cache = json.load(f)
            except (OSError, ValueError):
                _cache = {}
            _cache_mtime = m
        return _cache


def _save(c: dict) -> None:
    global _cache, _cache_mtime
    tmp = PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f, separators=(",", ":"))
        os.replace(tmp, PATH)
    except OSError:
        return
    with _lock:
        _cache = c
        _cache_mtime = os.path.getmtime(PATH)


def known(hash_: str) -> dict | None:
    """The last verdict recorded for a deck hash, or None if never vetted.

    A request-time read (one dict lookup on a cached file), so a screen can
    refuse a deck the pool already refused without any database work.
    """
    return (_load().get("decks") or {}).get(hash_)


_seat_memo: tuple[float, dict, dict] | None = None


def seatings() -> tuple[dict[str, dict], dict[str, dict]]:
    """`({hash: art}, {hash: slots})` the pilots were OBSERVED using, for every
    vetted deck that had any. Rebuilt only when the cache file changes."""
    global _seat_memo
    c = _load()
    stamp_ = float(c.get("builtAt") or 0)
    if _seat_memo is not None and _seat_memo[0] == stamp_:
        return _seat_memo[1], _seat_memo[2]
    art, slots = {}, {}
    for h, v in (c.get("decks") or {}).items():
        s = v.get("seating") or {}
        if s.get("art"):
            art[h] = s["art"]
        if s.get("slots"):
            slots[h] = s["slots"]
    _seat_memo = (stamp_, art, slots)
    return art, slots


# ── The one impure function ───────────────────────────────────────────────────


def vet_pool(con, by_arch: dict[str, list[dict]], keep: int, *,
             is_own_deck, now: float | None = None,
             kind=None) -> tuple[dict[str, list[dict]], dict]:
    """`by_arch` (each list sorted most-played first) cut to `keep` VETTED decks.

    `con` is a read-only connection to the bot's database; `is_own_deck` is
    `battle_modes.is_own_deck_1v1`. Returns the vetted pool and a report.
    """
    t0 = time.time()
    now = now or time.time()
    cutoff = stamp(_dt.datetime.fromtimestamp(now, _dt.timezone.utc).date()
                   - _dt.timedelta(days=RECENT_DAYS))
    wanted = {d["hash"] for ds in by_arch.values() for d in ds}

    # ONE PASS over player_deck_agg: its primary key leads with the player,
    # so a lookup by deck is a scan — once for all candidates, not per deck.
    per: dict[str, dict] = {}
    rows_by: dict[str, list[tuple[int, int, str]]] = {}
    for tag, h, b, w, last in con.execute(
            "SELECT player_tag, deck_hash, battles, wins, last_seen FROM player_deck_agg"):
        if h not in wanted:
            continue
        b, w = int(b or 0), int(w or 0)
        p = per.setdefault(h, {"games": 0, "wins": 0, "pilots": 0, "top": 0, "last": ""})
        p["games"] += b
        p["wins"] += w
        p["pilots"] += 1
        p["top"] = max(p["top"], b)
        if last and last > p["last"]:
            p["last"] = last
        rows_by.setdefault(h, []).append((b, w, tag))

    stats: dict[str, tuple[int, int]] = {}
    tags = {t for rs in rows_by.values() for _b, _w, t in rs}
    for tag, b, w in con.execute("SELECT player_tag, battles, wins FROM player_stats_agg"):
        if tag in tags:
            stats[tag] = (int(b or 0), int(w or 0))
    for h, rs in rows_by.items():
        per[h]["adds"] = pilot_adjusted([(b, w, *stats.get(t, (b, w))) for b, w, t in rs])

    cache = dict(_load())
    decks_cache = dict(cache.get("decks") or {})
    sampled_now = 0

    def own_share(h: str) -> tuple[float | None, int, float, dict | None]:
        """`(share, battles sampled, when it was measured, observed seating)`."""
        nonlocal sampled_now
        hit = decks_cache.get(h)
        if (hit and hit.get("measured") and hit.get("v") == CACHE_VERSION
                and now - float(hit.get("at") or 0) < CACHE_TTL):
            return hit["own"], int(hit.get("sampled") or 0), float(hit["at"]), hit.get("seating")
        top = heapq.nlargest(PILOT_SAMPLE, rows_by.get(h) or [])
        own = tot = marked = 0
        first3: dict = {}
        marks: dict = {}
        for _b, _w, tag in top:
            for mode, keys, evo in con.execute(
                    "SELECT game_mode, player_card_keys, player_evo FROM battles "
                    "WHERE player_tag = ? AND player_deck_hash = ?", (tag, h)):
                tot += 1
                if not is_own_deck(mode or ""):
                    continue
                own += 1
                try:
                    order = json.loads(keys) if keys else []
                    fielded = json.loads(evo) if evo else []
                except ValueError:
                    continue
                if len(order) == 8:
                    t = tuple(order[:3])
                    first3[t] = first3.get(t, 0) + 1
                ent = [e for e in fielded if isinstance(e, list) and len(e) >= 3]
                if ent:
                    marked += 1
                    for e in ent:
                        marks[(e[0], e[2])] = marks.get((e[0], e[2]), 0) + 1
        sampled_now += 1
        seating = (observed_seating(first3, marks, marked, own, kind)
                   if kind is not None else None)
        return (own / tot if tot else None), tot, now, seating

    out: dict[str, list[dict]] = {}
    rejected = {r: 0 for r in REASONS}
    examples: dict[str, list[str]] = {r: [] for r in REASONS}
    for arch, decks in by_arch.items():
        kept = []
        for d in decks:
            if len(kept) >= keep:
                break
            p = dict(per.get(d["hash"]) or {"games": 0, "pilots": 0, "top": 0, "last": ""})
            reason = verdict(p, cutoff)
            at, measured, seating = now, False, None
            if reason is None:
                p["own"], p["sampled"], at, seating = own_share(d["hash"])
                measured = True
                reason = verdict(p, cutoff)
            # `at` is when the MODE SHARE was measured, so a cache hit keeps
            # its age and expires after CACHE_TTL instead of living forever.
            decks_cache[d["hash"]] = {**public(p), "own": p.get("own"),
                                      "sampled": p.get("sampled", 0),
                                      "verdict": reason, "at": at, "measured": measured,
                                      "v": CACHE_VERSION, "seating": seating}
            if reason:
                rejected[reason] += 1
                if len(examples[reason]) < 5:
                    examples[reason].append(d["hash"])
                continue
            kept.append({**d, "evidence": public(p)})
        out[arch] = kept

    cache["decks"] = decks_cache
    cache["builtAt"] = now
    _save(cache)
    report = {
        "brain": BRAIN,
        "kept": sum(len(v) for v in out.values()),
        "rejected": rejected,
        "examples": examples,
        "sampled": sampled_now,
        "seconds": round(time.time() - t0, 1),
        "rules": {"minPilots": MIN_PILOTS, "maxPilotShare": MAX_PILOT_SHARE,
                  "recentDays": RECENT_DAYS, "minOwnShare": MIN_OWN_SHARE},
    }
    LAST.clear()
    LAST.update(report)
    return out, report
