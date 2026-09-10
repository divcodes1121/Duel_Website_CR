"""recent_battles.py — one player's battle log, newest first, as VS rows.

The rawest screen in the app. Every other analytics view aggregates: the pair
board counts pairings, the meta board ranks decks, the Duel Zone reconstructs
series. This one just lists what happened — their deck, the opponent's deck,
who won, when — and it exists because a reader who does not yet trust an
aggregate wants to see the rows it was computed from.

TWO THINGS IT DOES NOT DO, each on purpose:

  * **No reconstruction.** A native duel row is ONE stored row carrying a whole
    16- or 24-card loadout; it stays one row here rather than being split into
    games. The Duel Zone is where a duel becomes a series, and doing it in two
    places is how the two would eventually disagree.

  * **No aggregation, so no evidence floor.** A single battle is a fact, not an
    estimate, and the floors that protect the aggregates from thin history have
    nothing to protect here.

ONE THING IT DOES DO, and did not until 2026-09-10: **it asks `battle_modes`
what each row is before it draws one.** This shipped with no filter at all, on
the argument that a log silently omitting every ladder game is not a battle
log. That argument still stands, which is why a mode is dropped for what its
row would MISSTATE rather than for taste, and why what is dropped is counted
and reported — `summary.hidden` and `summary.hiddenByMode` put a new Supercell
mode on the screen as a labelled number instead of as an absence nobody can
see. The rule and the measurements behind it are in `battle_modes.py`.

2v2 IS NOT DISCARDED, IT IS ROUTED. `TeamVsTeam` rows go to `duo_pairs`,
which folds them into unique PARTNERSHIPS -- the two teammate decks played
together -- with an occurrence count. This screen refusing to
draw them is not the same as the data being thrown away, and the two must not
be confused: a 2v2 row carries a real deck a real player brought, and the only
thing wrong with it here is the VS shape this screen would force it into.

PAGED ON THE SERVER. An active player has hundreds of battles in thirty days,
and each row carries two decks with their art — send them all and the payload
is megabytes to render ten rows. The window decides the pool, the page decides
what crosses the wire.
"""

from __future__ import annotations

import json

import battle_modes as bm
import clash_data as cd
import duel_combos as dx
# THE SINGLE PATH FOR DRAWING A DECK, imported rather than copied. `_deck_view`
# runs `arrange_deck`, which decides slot ORDER as well as evolution and hero
# art; a screen that skips it renders the same deck in a different order with
# no art, which is exactly how the sequence board and the series log once
# disagreed about one deck. Its leading underscore marks it internal to the
# analytics server, not private to that module.
from duel_zone import _deck_view, deck_label

#: Battles per page. Ten is the ask, and it is also about what fits a screen
#: once each row carries sixteen card tiles.
PER_PAGE = 10

#: Hard ceiling on a page, so `?per=5000` cannot turn one request into the
#: payload the paging exists to avoid.
MAX_PER_PAGE = 50


def _mode_label(game_mode: str) -> str:
    """A readable name for Supercell's mode string.

    The stored strings are Supercell's (`Ranked1v1_NewArena2`, `CW_Duel_1v1`,
    `Friendly`), and there are far more of them than a row should print. This
    collapses them to a handful of readable ones, keeping the raw string in
    `mode` for anyone who wants it.
    """
    m = (game_mode or "").lower()
    if not m:
        return "Battle"
    if dx.is_native_duel(game_mode):
        return "Duel"
    if dx.is_competitive_practice_match(game_mode):
        return "Friendly"
    if "tournament" in m:
        return "Tournament"
    if "challenge" in m:
        return "Challenge"
    if m.startswith(("ranked1v1", "ladder")):
        return "Ladder"
    # NO 2v2 BRANCH. `battle_modes.classify` routes those rows to `duo_pairs`
    # before this function is reached, so a branch here would be unreachable
    # code implying to its next reader that 2v2 appears on this screen.
    # DELIBERATELY "Battle" for an unrecognised mode whose name contains
    # "duel". `is_native_duel` is an allowlist of two verified strings, and a
    # row labelled "Duel" here that the Duel Zone does not list would be a
    # contradiction between two screens reading one database. An unknown mode
    # is unknown; the raw string rides along in `mode` for anyone checking.
    return "Battle"


def _outcome(result: str, crowns: int, opp_crowns: int) -> str:
    """win / loss / draw, preferring the stored result over the crowns.

    `result` is what the bot recorded from the API. Crowns are only the
    fallback, because a battle can end level on crowns and still have a
    recorded winner — deriving from crowns first would relabel those as draws.
    """
    r = (result or "").strip().lower()
    if r in ("win", "victory"):
        return "win"
    if r in ("loss", "lose", "defeat"):
        return "loss"
    if r in ("draw", "tie"):
        return "draw"
    if crowns > opp_crowns:
        return "win"
    if crowns < opp_crowns:
        return "loss"
    return "draw"


def _read_rows(tag: str, since: str | None, until: str | None
               ) -> tuple[list[dict], bool, dict[str, int]]:
    """Every drawable battle for this tag in the window, newest first.

    Walks the same tier partition every other screen does, so a window that
    reaches into the archive reads it here too and says so.

    Returns the rows, whether the archive tier was touched, and a count PER
    RAW MODE STRING of what was refused. The per-mode breakdown is the point:
    a single total says "some battles are missing" and leaves the reader to
    guess, while `{"TeamVsTeam": 34}` says which and lets a new Supercell mode
    announce itself the first time it appears in anyone's log.
    """
    windows = cd.tier_windows(tag, since, until)
    if not windows:
        return [], False, {}

    out: list[dict] = []
    archive_used = False
    hidden: dict[str, int] = {}
    for idx, (path, w_lo, w_hi) in enumerate(windows):
        try:
            con = cd.connect(path)
        except Exception:
            continue
        try:
            rows = con.execute(
                "SELECT battle_time, game_mode, opponent_tag, opponent_name, "
                "       result, player_card_keys, opponent_card_keys, "
                "       player_win_condition, opponent_win_condition, "
                "       player_crowns, opponent_crowns, player_evo, opponent_evo "
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
        for r in rows:
            # THE ROUTER RUNS FIRST — before the decks are even parsed, and
            # before anything gives this row a `player` side and an `opponent`
            # side. That shape is the misstatement in a 2v2 row, so it must
            # not be built and then discarded.
            mode = r["game_mode"] or ""
            if bm.classify(mode) != bm.OWN_DECK_1V1:
                # Counted under the RAW string, not the readable label, so a
                # mode nobody has written a label for is still nameable.
                hidden[mode or "(unrecorded)"] = hidden.get(mode or "(unrecorded)", 0) + 1
                continue
            try:
                cards = json.loads(r["player_card_keys"] or "[]")
            except Exception:
                cards = []
            try:
                opp_cards = json.loads(r["opponent_card_keys"] or "[]")
            except Exception:
                opp_cards = []
            # A row with no deck on either side has nothing to draw. It is kept
            # out of the count as well as the page: a "page 4 of 12" whose rows
            # were dropped after the count is a page that renders empty.
            if not cards and not opp_cards:
                continue
            kept += 1
            out.append(
                {
                    "battle_time": r["battle_time"] or "",
                    "mode": r["game_mode"] or "",
                    "opponent_tag": r["opponent_tag"] or "",
                    "opponent_name": r["opponent_name"] or "",
                    "result": r["result"] or "",
                    "cards": cards,
                    "opp_cards": opp_cards,
                    "archetype": r["player_win_condition"] or "",
                    "opp_archetype": r["opponent_win_condition"] or "",
                    "crowns": r["player_crowns"] or 0,
                    "opp_crowns": r["opponent_crowns"] or 0,
                    "evo": r["player_evo"],
                    "opp_evo": r["opponent_evo"],
                }
            )
        if kept and idx > 0:
            archive_used = True

    # Sorted across tiers, not within one: the hot and archive reads each come
    # back ordered, and concatenating two ordered lists is not ordered.
    out.sort(key=lambda r: r["battle_time"], reverse=True)
    return out, archive_used, hidden


def _side(cards: list[str], evo_raw, archetype: str) -> dict:
    """One side of a battle as the UI draws it."""
    view = _deck_view(cards, evo_raw)
    view["archetype"] = archetype
    view["deckName"] = deck_label(view["cards"], archetype)
    return view


def _battle(row: dict) -> dict:
    outcome = _outcome(row["result"], row["crowns"], row["opp_crowns"])
    return {
        # Time plus the opponent identifies a battle well enough for a React
        # key, and it survives paging where an array index does not.
        "id": f"{row['battle_time']}-{row['opponent_tag']}",
        "battleTime": row["battle_time"],
        "mode": row["mode"],
        "modeLabel": _mode_label(row["mode"]),
        "result": outcome,
        "crowns": row["crowns"],
        "opponentCrowns": row["opp_crowns"],
        "player": _side(row["cards"], row["evo"], row["archetype"]),
        "opponent": {
            **_side(row["opp_cards"], row["opp_evo"], row["opp_archetype"]),
            "tag": row["opponent_tag"],
            "name": row["opponent_name"],
        },
    }


def report(tag: str, since: str | None = None, until: str | None = None,
           page: int = 1, per: int = PER_PAGE) -> dict:
    """One page of a player's battle log, plus the totals for the whole window.

    The summary counts the WINDOW, not the page. A win rate that changed as you
    turned pages would be describing ten battles while sitting under a control
    that says thirty days.
    """
    per = max(1, min(MAX_PER_PAGE, per))
    rows, archive_used, hidden = _read_rows(tag, since, until)

    total = len(rows)
    pages = max(1, -(-total // per))  # ceil
    # CLAMPED, not rejected. Narrowing the window under an open page 9 is the
    # ordinary way to end up past the end, and answering that with an error
    # would make the date control able to break the screen.
    page = max(1, min(pages, page))
    start = (page - 1) * per

    wins = sum(1 for r in rows if _outcome(r["result"], r["crowns"], r["opp_crowns"]) == "win")
    losses = sum(1 for r in rows if _outcome(r["result"], r["crowns"], r["opp_crowns"]) == "loss")

    return {
        "battles": [_battle(r) for r in rows[start:start + per]],
        # THE NAME, so the row can say who played rather than printing a tag at
        # someone. `None` when we have never seen one — the client falls back
        # to the tag, which is the only identifier that always exists.
        "player": {"tag": tag, "name": cd.player_name(tag)},
        "page": page,
        "pages": pages,
        "perPage": per,
        "total": total,
        "summary": {
            "battles": total,
            "wins": wins,
            "losses": losses,
            "draws": total - wins - losses,
            "crowns": sum(r["crowns"] for r in rows),
            "opponentCrowns": sum(r["opp_crowns"] for r in rows),
            "archiveUsed": archive_used,
            # WHAT WAS IN THE WINDOW AND IS NOT ON THE SCREEN. Reported rather
            # than dropped, because the failure mode of an allowlist is a
            # correct battle silently missing, and the only defence against
            # that is making the omission visible where a reader is already
            # looking. Sorted by count so the biggest exclusion reads first.
            "hidden": sum(hidden.values()),
            "hiddenByMode": dict(
                sorted(hidden.items(), key=lambda kv: (-kv[1], kv[0]))
            ),
        },
    }
