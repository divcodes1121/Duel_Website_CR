"""player_decks.py — the decks one player is using, most played first.

One row a deck: the eight cards, how much of the player's play it was, their
record with it, and the same list's record across every player we hold.

WHERE THE GAMES COME FROM. Two sources, never the same game twice:

  * `battles`, through `recent_battles._read_rows` — so the mode router runs
    first and only own-deck 1v1 rows are counted (2v2, drafts and event decks
    are not this player's decks). A row counts when it holds exactly one
    eight-card deck.

  * `duel_index.games` for NATIVE DUELS. In `battles` a native duel is one row
    carrying the whole 16- or 24-card loadout and only the duel's result, so
    it cannot say which deck won which game. The duel index reads the same
    duel's rounds out of the raw payload: one row a game, with that game's
    deck and its crowns. Rows in a native duel mode are therefore NEVER
    counted from `battles`, whatever they hold, or a duel would count twice.
    With no duel index the duel games are simply absent and `summary`
    says so (`duelIndex: false`).

THE COMMUNITY RECORD is the exact list across the whole stored population:
`pair_matchup_agg`, both directions, which is what `deck_counter.deck_profile`
sums. It is all stored time and every mode, so it is not the player's window —
the payload names it (`communityBasis`). Read from the cluster index when the
index knows the deck (a few rows in a small file), live otherwise.

RATES ARE SHARES OF ALL GAMES, draws included, so a row's three figures add up
to 100. Every other screen quotes a win rate over DECIDED games; this one
prints a Draws column, so the denominator has to hold the draws.
"""

from __future__ import annotations

import json
import time

import battle_modes as bm
import clash_data as cd
import duel_combos as dx
import recent_battles as rb
from duel_zone import _arranged, deck_label

#: The windows this screen offers, and the one it opens on.
DAYS = (7, 14, 30)
DEFAULT_DAYS = 7

#: A community record is all-time and moves slowly; a deck is asked about
#: again every time anybody opens a player who runs it.
_COMMUNITY_TTL_S = 1800.0
_COMMUNITY_MAX = 6000
_COMMUNITY: dict[str, tuple[float, tuple[int, int, int] | None]] = {}


def valid_days(raw) -> int:
    """One of `DAYS`, or the default. The value comes from a query string."""
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return n if n in DAYS else DEFAULT_DAYS


def deck_key(cards) -> str:
    return ",".join(sorted(set(cards or [])))


def _pct(n: int, of: int, places: int = 1) -> float:
    return round(100.0 * n / of, places) if of else 0.0


def _cycle(cards: list[str]) -> int | None:
    """The four cheapest cards — `getCycleCost` in the builder."""
    costs = sorted(dx.card_info(c).get("elixir") or 0 for c in cards)
    return sum(costs[:4]) if len(costs) >= 4 else None


def _duel_index():
    """`duel_index`, or None. An accelerator's absence is a state, not an error."""
    try:
        import duel_index
        return duel_index
    except Exception:  # noqa: BLE001
        return None


def _cluster_index():
    try:
        import cluster_index
        return cluster_index
    except Exception:  # noqa: BLE001
        return None


def _live_totals(keys: list[str]) -> dict[str, tuple[int, int, int]]:
    """`{key: (wins, losses, draws)}` straight off `pair_matchup_agg`.

    Both directions, the second with the sides swapped — a pairing is stored
    once, whichever way round it was first seen.
    """
    tiers = cd._tier_paths()
    if not keys or not tiers:
        return {}
    try:
        con = cd.connect(tiers[0])
    except Exception:  # noqa: BLE001
        return {}
    out: dict[str, tuple[int, int, int]] = {}
    try:
        for key in keys:
            a = con.execute(
                "SELECT SUM(a_wins), SUM(a_losses), SUM(a_draws) "
                "FROM pair_matchup_agg WHERE deck_a = ?", (key,)).fetchone()
            b = con.execute(
                "SELECT SUM(a_losses), SUM(a_wins), SUM(a_draws) "
                "FROM pair_matchup_agg WHERE deck_b = ?", (key,)).fetchone()
            w = (a[0] or 0) + (b[0] or 0)
            l = (a[1] or 0) + (b[1] or 0)
            d = (a[2] or 0) + (b[2] or 0)
            if w + l + d:
                out[key] = (w, l, d)
    except Exception:  # noqa: BLE001
        return out
    finally:
        con.close()
    return out


def community(keys: list[str]) -> dict[str, tuple[int, int, int]]:
    """`{key: (wins, losses, draws)}` for each list anybody has a record with.

    A list nobody has a stored pairing for is absent, which the screen draws
    as no community row rather than as a row of zeros.
    """
    now = time.monotonic()
    out: dict[str, tuple[int, int, int]] = {}
    missing: list[str] = []
    for key in keys:
        hit = _COMMUNITY.get(key)
        if hit is not None and now - hit[0] < _COMMUNITY_TTL_S:
            if hit[1] is not None:
                out[key] = hit[1]
        else:
            missing.append(key)
    if not missing:
        return out

    found: dict[str, tuple[int, int, int]] = {}
    ci = _cluster_index()
    if ci is not None:
        try:
            found = ci.totals(missing) or {}
        except Exception:  # noqa: BLE001
            found = {}
    # A deck newer than the index's last build is read live.
    rest = [k for k in missing if k not in found]
    if rest:
        found.update(_live_totals(rest))

    if len(_COMMUNITY) + len(missing) > _COMMUNITY_MAX:
        _COMMUNITY.clear()
    for key in missing:
        rec = found.get(key)
        _COMMUNITY[key] = (now, rec)
        if rec is not None:
            out[key] = rec
    return out


def _record(wins: int, losses: int, draws: int) -> dict:
    games = wins + losses + draws
    return {
        "battles": games, "wins": wins, "losses": losses, "draws": draws,
        "winRate": _pct(wins, games), "drawRate": _pct(draws, games),
        "lossRate": _pct(losses, games),
    }


def _own_rows(tag: str, since: str | None, until: str | None
              ) -> tuple[list[dict], bool, dict[str, int]]:
    """`recent_battles._read_rows`, for a caller that only COUNTS DECKS.

    The same tier walk, the same router and the same "a row with no deck on
    either side is not a battle" rule, row for row — `test_player_decks` holds
    the two equal — without what a deck count never reads. `_read_rows` parses
    two JSON decks for every battle, and a player with three thousand battles
    in the window has perhaps two hundred distinct lists: here a deck string is
    parsed once however often it was played, a mode is routed once however
    many rows carry it, and the opponent's deck is not parsed at all (SQL says
    whether there was one).

    It matters since Team Analysis reads this for every player on both sides:
    twenty-four players at 0.2 s each was most of a board's wait.
    """
    windows = cd.tier_windows(tag, since, until)
    if not windows:
        return [], False, {}

    out: list[dict] = []
    archive_used = False
    hidden: dict[str, int] = {}
    parsed: dict[str, list] = {}
    routed: dict[str, bool] = {}
    for idx, (path, w_lo, w_hi) in enumerate(windows):
        try:
            con = cd.connect(path)
        except Exception:
            continue
        try:
            rows = con.execute(
                "SELECT battle_time, game_mode, result, player_card_keys, "
                "       player_win_condition, player_crowns, opponent_crowns, player_evo, "
                "       CASE WHEN opponent_card_keys IS NULL "
                "              OR opponent_card_keys IN ('', '[]') THEN 0 ELSE 1 END "
                "FROM battles "
                "WHERE player_tag = ? AND battle_time >= ? AND battle_time <= ? "
                "ORDER BY battle_time DESC",
                (tag, w_lo, w_hi),
            ).fetchall()
        except Exception:
            rows = []
        finally:
            con.close()

        kept = 0
        for bt, mode, result, raw, arch, crowns, opp_crowns, evo, has_opp in rows:
            mode = mode or ""
            own = routed.get(mode)
            if own is None:
                own = routed[mode] = bm.classify(mode) == bm.OWN_DECK_1V1
            if not own:
                hidden[mode or "(unrecorded)"] = hidden.get(mode or "(unrecorded)", 0) + 1
                continue
            raw = raw or "[]"
            cards = parsed.get(raw)
            if cards is None:
                try:
                    cards = json.loads(raw)
                except Exception:
                    cards = []
                parsed[raw] = cards
            if not cards and not has_opp:
                continue
            kept += 1
            out.append({
                "battle_time": bt or "", "mode": mode, "result": result or "",
                "cards": cards, "archetype": arch or "",
                "crowns": crowns or 0, "opp_crowns": opp_crowns or 0, "evo": evo,
            })
        if kept and idx > 0:
            archive_used = True

    out.sort(key=lambda r: r["battle_time"], reverse=True)
    return out, archive_used, hidden


def played(tag: str, since: str | None = None, until: str | None = None) -> dict:
    """The COUNTING half of `report`: every deck this player fielded in the
    window, with their record on it, and nothing drawn or looked up.

    It exists on its own because a second reader needs exactly this and none of
    the rest: Team Analysis and the Deck Counter's "Bring this against them"
    project what an opponent PLAYS, and that has to be the same list this
    screen shows — own-deck 1v1 games plus native duel games, with 2v2, drafts
    and event decks left out by the mode router. Reading it from
    `player_report` instead (every mode, the top 25 lists) put event decks in
    the projection and, for a player with hundreds of variants, named the wrong
    archetype as the one they play most.

    Returns `per` — `{deck key: [wins, losses, draws, last seen, stored-order
    cards, archetype]}` — the forms each deck was last seen fielded with
    (`marks`), and the counts `report` publishes in its summary.
    """
    rows, archive_used, hidden = _own_rows(tag, since, until)

    # key -> [wins, losses, draws, last seen, stored-order cards, archetype]
    per: dict[str, list] = {}
    # The forms a deck was last SEEN fielded with, newest first (the rows are).
    marks: dict[str, dict] = {}
    loadouts = 0

    def note_marks(cards: list[str], evo_raw) -> None:
        key = deck_key(cards)
        if key in marks:
            return
        seen = dx._evo_marks(evo_raw, cards)
        if seen:
            marks[key] = seen

    for r in rows:
        cards = r["cards"]
        if dx.is_native_duel(r["mode"]):
            # Counted from the duel index, game by game. The loadout row still
            # says which forms each of its decks was fielded with.
            loadouts += 1
            for i in range(0, len(cards) - dx.DECK_SIZE + 1, dx.DECK_SIZE):
                note_marks(cards[i:i + dx.DECK_SIZE], r["evo"])
            continue
        if len(cards) != dx.DECK_SIZE or len(set(cards)) != dx.DECK_SIZE:
            loadouts += 1
            continue
        key = deck_key(cards)
        note_marks(cards, r["evo"])
        e = per.get(key)
        if e is None:
            e = per[key] = [0, 0, 0, r["battle_time"], cards, r["archetype"]]
        outcome = rb._outcome(r["result"], r["crowns"], r["opp_crowns"])
        e[0 if outcome == "win" else 1 if outcome == "loss" else 2] += 1

    duel_games = 0
    di = _duel_index()
    duel_ok = False
    if di is not None:
        try:
            duel_ok = di.available()
            duel = di.player_decks(tag, di.iso_to_stamp(since),
                                   di.iso_to_stamp(until, end=True)) if duel_ok else []
        except Exception:  # noqa: BLE001
            duel_ok, duel = False, []
        for d in duel:
            cards = list(d["cards"])
            if len(cards) != dx.DECK_SIZE:
                continue
            key = deck_key(cards)
            games, wins = int(d["games"]), int(d["wins"])
            duel_games += games
            e = per.get(key)
            if e is None:
                e = per[key] = [0, 0, 0, d.get("lastSeen") or "", cards,
                                d.get("archetype") or ""]
            elif (d.get("lastSeen") or "") > e[3]:
                e[3] = d["lastSeen"]
            e[0] += wins
            # A duel game has a winner — a level game takes a tiebreak tower.
            e[1] += games - wins

    return {
        "per": per, "marks": marks, "loadouts": loadouts,
        "duelGames": duel_games, "duelIndex": duel_ok,
        "archiveUsed": archive_used, "hidden": hidden,
    }


def report(tag: str, since: str | None = None, until: str | None = None) -> dict:
    """Every deck this player fielded in the window, most played first."""
    got = played(tag, since, until)
    per, marks, hidden = got["per"], got["marks"], got["hidden"]
    loadouts, duel_games = got["loadouts"], got["duelGames"]
    duel_ok, archive_used = got["duelIndex"], got["archiveUsed"]
    di = _duel_index()

    total = sum(e[0] + e[1] + e[2] for e in per.values())
    everyone = community(list(per))

    decks = []
    for key, (w, l, d, last, cards, arch) in per.items():
        view = _arranged(cards, marks.get(key))
        arch = arch or (di.classify(key) if di is not None else "")
        com = everyone.get(key)
        row = {
            "key": key,
            **view,
            "archetype": arch,
            "deckName": deck_label(view["cards"], arch),
            "cycle": _cycle(view["cards"]),
            "lastSeen": last,
            **_record(w, l, d),
            # Two places: a deck played once in 260 is 0.38%, and at one place
            # that and a deck played twice both print as rounding.
            "useRate": _pct(w + l + d, total, 2),
            "community": _record(*com) if com else None,
        }
        decks.append(row)

    # Most played first; the more recent of two equally played; then the key,
    # because dict order is not an order.
    decks.sort(key=lambda r: r["key"])
    decks.sort(key=lambda r: r["lastSeen"], reverse=True)
    decks.sort(key=lambda r: r["battles"], reverse=True)

    wins = sum(e[0] for e in per.values())
    losses = sum(e[1] for e in per.values())
    return {
        "player": {"tag": tag, "name": cd.player_name(tag)},
        "decks": decks,
        "total": total,
        "summary": {
            **_record(wins, losses, total - wins - losses),
            "decks": len(decks),
            "duelGames": duel_games,
            "duelIndex": duel_ok,
            "archiveUsed": archive_used,
            # Own-deck rows that are not one eight-card deck: native duel
            # loadouts (counted game by game above when the index is there).
            "loadouts": loadouts,
            # In the window and not on this screen, by raw mode — the battle
            # log's rule, for the same reason.
            "hidden": sum(hidden.values()),
            "hiddenByMode": dict(sorted(hidden.items(), key=lambda kv: (-kv[1], kv[0]))),
        },
        # What the community row is measured over, since it is not the window.
        "communityBasis": "all_stored",
    }
