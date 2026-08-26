"""duel_combos.py — card COMBINATIONS in duel play.

This is the website's port of the Discord bot's Pair Board (Clash_Bot's
`clashdb.get_card_pair_stats` + `pdf_pages.pair_board_data`). The logic is the
bot's; what changes here is the presentation (three tabs instead of a
twenty-four tile board) and one deliberate divergence, flagged below.

WHAT A COMBO IS. A pair of cards the player has actually fielded together in the
same deck, in a duel. Pairs are expanded FROM DECKS, never from a second scan of
`battles` — a battle carries exactly one deck, so grouping by deck first and
expanding to pairs afterwards is lossless for any card-set question, and it
keeps one source of truth. Straight from the bot.

THERE IS NO SYNERGY SCORE, AND THAT IS A MEASURED RESULT. The obvious metric —
a pair's win rate against what each card does apart — was built and tested
against a permutation null across 14 player shapes in the bot project and came
out indistinguishable from chance (median 1.00x its own null's spread, below it
as often as above). A pair inherits WHOLE DECK outcomes, so battles inside one
deck are not independent draws and the textbook standard error is simply wrong.
A "Synergy 78%" computed that way reports deck clustering as a property of two
cards. See report_data.py in Clash_Bot for the numbers. This page states what it
can count. DO NOT ADD A LIFT SCORE without a fresh, leak-free measurement.

WHAT A DUEL IS, and the useful discovery: a NATIVE duel is stored as ONE ROW
carrying the whole loadout — 16 or 24 cards, which is two or three decks laid
end to end. So the G1/G2/G3 split the page shows is read directly out of the
row rather than inferred. Friendly practice has no such row, so those duels are
reconstructed with the bot's own `duel_split` rules (>30 min gap closes a
series, card reuse closes a series, a 2-0 arms exactly one dead rubber). Both
sources reduce to the same unit: a DECK, the slot it occupied, and whether it
was won.

THE ONE DIVERGENCE FROM THE BOT. `pdf_pages._pair_category` assigns each pair
EXACTLY ONE category, because the PDF prints all four on one board and a pair in
two buckets would be one fact printed twice. Tabs are not one board — each tab
is its own question, and an "Evolutions (Combo)" tab that hides Evo Royal Giant
because a win condition outranked it is answering a different question from the
one on the label. So the predicates here are the bot's, applied INDEPENDENTLY;
a pair may appear under two tabs.
"""

from __future__ import annotations

import datetime
import itertools
import json
import math
import os
import sys

import clash_data as cd

# --------------------------------------------------------------------------
# Card metadata — read from the website's own data files, so a key that
# resolves to art in the browser resolves to a flag here.
# --------------------------------------------------------------------------
_DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "data"
)

_CARD_INFO: dict[str, dict] = {}

# Why the failure is recorded instead of swallowed — this cost three screens.
#
# `_DATA` points at `<repo>/src/data`, so this module only works when `server/`
# sits INSIDE the website checkout. The VPS deploy copied `server/` alone, so
# the directory did not exist, `open()` raised, and a bare `except Exception:
# return` turned a missing-file deployment error into an EMPTY `_CARD_INFO`.
#
# Nothing failed. `card_info()` answers with its default for every key, and that
# default says `is_win_condition: False`, `is_spell: False`, `elixir: 0` — so:
#
#   * Duel Analysis's Win Conditions and Spells tabs matched nothing and showed
#     0 for every player, while Evolutions worked, because Evolutions keys off
#     observed slots rather than metadata;
#   * the Cards board rendered NOTHING, because `player_cards.py` iterates
#     `card_keys()`, which was `[]`;
#   * deck names, styles and average elixir degraded everywhere they are drawn,
#     which is what made every Deck Counter row look generic.
#
# Every one of those is a plausible-looking screen. There was no error in any
# log, and `/status` said the service was healthy, because by its own lights it
# was. A silent default for missing REFERENCE data is not a graceful
# degradation — it is a wrong answer delivered confidently, and the only defence
# is to make the failure visible.
_CARD_LOAD_ERROR: str | None = None


def card_data_state() -> dict:
    """Whether the card reference data actually loaded. Surfaced by `/status`.

    NO PATHS IN THE RESULT. `/status` is reachable without a key, and it was
    already stripped of the volume paths and sizes it used to publish; the
    resolved directory is exactly the kind of detail that belongs in the log on
    the box and not in a response body.
    """
    _load_cards()
    return {
        "loaded": bool(_CARD_INFO),
        "count": len(_CARD_INFO),
        "error": _CARD_LOAD_ERROR,
    }


def _load_cards() -> None:
    global _CARD_LOAD_ERROR
    if _CARD_INFO:
        return
    try:
        with open(os.path.join(_DATA, "cards.json"), encoding="utf-8") as fh:
            base = json.load(fh)
        with open(os.path.join(_DATA, "cardMeta.json"), encoding="utf-8") as fh:
            meta = json.load(fh)
    except Exception as exc:
        # A reason code for the wire, the detail only for the operator's log.
        _CARD_LOAD_ERROR = type(exc).__name__
        if not getattr(_load_cards, "_warned", False):
            print(
                "[cards] REFERENCE DATA MISSING: %s: %s\n"
                "        looked in %s\n"
                "        Win Conditions, Spells, the Cards board and every deck "
                "name will be wrong until this is fixed."
                % (type(exc).__name__, exc, _DATA),
                file=sys.stderr,
                flush=True,
            )
            _load_cards._warned = True  # type: ignore[attr-defined]
        return
    _CARD_LOAD_ERROR = None
    for c in base:
        key = c.get("key")
        if not key:
            continue
        m = meta.get(key) or {}
        _CARD_INFO[key] = {
            "name": c.get("name") or key.replace("-", " ").title(),
            "elixir": c.get("elixir") or 0,
            # `type` is the game's own answer ("Troop" / "Spell" / "Building"),
            # which is why the bot switched to it: the <=4-elixir proxy it
            # shipped with filed "Archers + Skeletons" as a spell combo and
            # excluded Lightning and Rocket for costing too much.
            "is_spell": (c.get("type") or "") == "Spell",
            "is_building": (c.get("type") or "") == "Building",
            "is_win_condition": bool(m.get("is_win_condition")),
            "is_champion": bool(m.get("is_champion")),
            "can_evolve": bool(m.get("can_evolve")),
            "can_be_hero": bool(m.get("can_be_hero")),
        }


def card_keys() -> list[str]:
    """Every card key the website knows about, in the data file's own order."""
    _load_cards()
    return list(_CARD_INFO)


def card_info(key: str) -> dict:
    _load_cards()
    return _CARD_INFO.get(
        key,
        {
            "name": (key or "?").replace("-", " ").title(),
            "elixir": 0,
            "is_spell": False,
            "is_building": False,
            "is_win_condition": False,
            "is_champion": False,
            "can_evolve": False,
            "can_be_hero": False,
        },
    )


# --------------------------------------------------------------------------
# Mode classification — mirrors Clash_Bot/duel_stats.py exactly.
# --------------------------------------------------------------------------
#
# Kept identical on purpose: if these two ever disagree, the website starts
# describing a different set of battles from `!duels` for the same player,
# silently and with no error.

NATIVE_DUEL_MODES = {"cw_duel_1v1", "duel_1v1_friendly"}


def is_native_duel(game_mode: str) -> bool:
    """True only for modes on the verified allowlist.

    FAILS SAFE, like the bot: an unrecognised mode containing "duel" is NOT
    parsed as native, so it falls through to the structural path instead of
    being sliced into decks on an assumption about a serialization nobody has
    inspected.
    """
    return bool(game_mode) and game_mode.lower() in NATIVE_DUEL_MODES


def is_competitive_practice_match(game_mode: str) -> bool:
    """Duel-eligible practice — friendly or clanmate. (duel_split's rule.)"""
    if not game_mode:
        return False
    mode = game_mode.lower()
    return "friendly" in mode or "clanmate" in mode


def is_duel_like_mode(game_mode: str) -> bool:
    """Every battle the bot's DuelEngine would consider."""
    return is_native_duel(game_mode) or is_competitive_practice_match(game_mode)


# --------------------------------------------------------------------------
# Series reconstruction — ported from Clash_Bot/duel_split.py
# --------------------------------------------------------------------------
#
# The rules are MEASURED (the measurements are recorded in the bot's CLAUDE.md)
# and are reproduced rather than re-derived. Changing one changes reconstructed
# history, so re-measure over there before touching anything here.

DUEL_MAX_GAP_MINUTES = 30
MIN_DUEL_GAMES = 2
MAX_DUEL_GAMES = 5


def _parse_ts(value: str) -> datetime.datetime:
    try:
        return datetime.datetime.strptime(value, "%Y%m%dT%H%M%S.%fZ")
    except ValueError:
        return datetime.datetime.strptime(value[:15], "%Y%m%dT%H%M%S")


def _split_series(chunk: list[dict]) -> list[list[dict]]:
    """One same-opponent chunk -> individual duel series. See duel_split.split."""
    out: list[list[dict]] = []
    cur: list[dict] = []
    used_p: set[str] = set()
    used_o: set[str] = set()
    pending_dead_rubber = False

    def close():
        nonlocal cur, used_p, used_o, pending_dead_rubber
        if len(cur) >= MIN_DUEL_GAMES:
            out.append(cur)
        cur, used_p, used_o = [], set(), set()
        pending_dead_rubber = False

    for rec in chunk:
        t = _parse_ts(rec["battle_time"])
        if cur:
            gap = (t - _parse_ts(cur[-1]["battle_time"])).total_seconds() / 60
            if gap > DUEL_MAX_GAP_MINUTES:
                close()

        deck = set(rec["cards"])
        # A duel loadout cannot repeat a card, so a repeat means a new duel.
        # BOTH SIDES ARE TRACKED, and separately — duel_split.split does the
        # same. A card in your deck one game and in the opponent's another is
        # legal inside one series, but the opponent repeating a card of their
        # own ends the duel just as surely as you repeating one. Callers that
        # do not read the opponent's deck pass nothing and get the one-sided
        # rule they had before.
        opp = set(rec.get("opp_cards") or ())
        if cur and ((deck & used_p) or (opp & used_o)):
            close()

        cur.append(rec)
        used_p |= deck
        used_o |= opp

        pw = sum(1 for g in cur if g["result"] == "win")
        ow = sum(1 for g in cur if g["result"] == "loss")
        if pending_dead_rubber:
            # A 2-0 decides a Bo3 but not a Bo5; the next game says which this
            # is. 3-0 closes it out, 2-1 means the trailing player is alive.
            if pw >= 3 or ow >= 3 or len(cur) == MAX_DUEL_GAMES:
                close()
            elif (pw == 2 and ow == 1) or (ow == 2 and pw == 1):
                pending_dead_rubber = False
            else:
                close()
        elif (pw == 2 and ow == 0) or (ow == 2 and pw == 0):
            pending_dead_rubber = True
        elif pw == 3 or ow == 3 or len(cur) == MAX_DUEL_GAMES:
            close()

    close()
    return out


def _decided(series: list[dict]) -> bool:
    """True when this series ended the way a duel actually ends.

    Two wins takes a Bo3 and three takes a Bo5, so a finished duel always has a
    side on 2+. Anything below that did not finish.
    """
    pw = sum(1 for g in series if g["result"] == "win")
    ow = sum(1 for g in series if g["result"] == "loss")
    return max(pw, ow) >= 2


def _merge_unfinished(series_list: list[list[dict]]) -> list[list[dict]]:
    """Fold an undecided tail back into the series it was cut from.

    A DELIBERATE DIVERGENCE FROM THE BOT, and the one place this file does not
    reproduce `duel_split`. Its rule is that ANY repeated card ends a series,
    which is right for a duel loadout in principle — but real practice decks
    share incidental cards (Zap, The Log, Skeletons), so one long set gets cut
    at every brushed card rather than at every new duel.

    Measured on the case that produced this: eight consecutive friendly games
    against one opponent, decks overlapping by 1-4 cards and never by 6 (never
    the same deck twice). The bot's rule split them 3 / 3 / 2 and left a
    two-game `1-1` tail, which is not a scoreline a duel can end on. Folding
    the tail back gives a 1-2 Bo3 followed by a 2-3 Bo5 — two complete duels,
    which is what the games actually were.

    So a tail is absorbed only when every one of these holds, and it is put back
    exactly where it was cut from:

      * neither side reached two wins, so it cannot be a finished duel;
      * the series before it is the same opponent (guaranteed inside a chunk)
        and within `DUEL_MAX_GAP_MINUTES`, so a genuinely separate session is
        never glued on;
      * the combined length still fits `MAX_DUEL_GAMES`, so merging can never
        invent a six-game duel.

    A tail that cannot be folded anywhere is DROPPED, for the same reason
    `_split_series` already drops a lone game: two friendly games that ended 1-1
    are not a duel, and a duel does not end 1-1. Over five players that is 3% of
    series; before the fold it was 6.6%.

    WHAT WAS NOT CHANGED, because it was measured. The obvious other fix is to
    let a series survive one or two shared cards. It is wrong — real practice
    decks brush against each other constantly, and raising the threshold splices
    separate duels together. Over the same five players:

        shared cards | coverage | series over 3 games
                   1 |    66.0% |   1.1%   <- the bot's rule, kept
                   2 |    68.9% |   4.3%
                   3 |    70.4% |   9.9%
                   6 |    71.7% |  25.3%

    A genuine Bo5 is roughly 0.3% of this data, so anything past 1 buys a few
    points of coverage by inventing Bo5s. The rule is right; what it needed was
    a tidy-up of the fragments it leaves behind.
    """
    out: list[list[dict]] = []
    for series in series_list:
        if not _decided(series):
            if (
                out
                and len(out[-1]) + len(series) <= MAX_DUEL_GAMES
                and series[0]["opponent_tag"] == out[-1][-1]["opponent_tag"]
                and (_parse_ts(series[0]["battle_time"])
                     - _parse_ts(out[-1][-1]["battle_time"])).total_seconds() / 60
                <= DUEL_MAX_GAP_MINUTES
            ):
                out[-1] = out[-1] + series
            continue
        out.append(series)
    return out


def split_chunk(chunk: list[dict]) -> list[list[dict]]:
    """One same-opponent chunk -> finished duel series.

    THE ENTRY POINT every duel screen uses, so the pair board and the Duel Zone
    can never disagree about where one duel ends and the next begins.
    """
    return _merge_unfinished(_split_series(chunk))


# --------------------------------------------------------------------------
# Reading duel decks out of the databases
# --------------------------------------------------------------------------

DECK_SIZE = 8
SLOTS = 3  # G1 / G2 / G3 — a duel loadout is three decks


def _evo_marks(raw: str | None, deck: list[str]) -> dict[str, str]:
    """{card_key: 'evolution' | 'hero'} for the cards this deck fielded specially.

    `player_evo` stores [card_key, level, art] and it is the LEVEL that decides
    — level 1 is an evolution, level 2 is a hero. The `art` string looks like
    the resolved answer and is not: it mislabels 9.2% of heroes as evolutions
    and writes 'unknown' over 6.9% of evolutions. `cd.mark_variant` owns that
    reading and records the measurement. It exists for ~29% of rows.

    THE SLOT RULE IS 0-2, NOT 0-1. A deck's first THREE positions are the
    special slots (evolution / hero / champion); measured here, of 795 decks
    whose payload carried marks, all 795 had every mark inside slots 0-2 — slot
    0 in 791, slot 1 in 569, slot 2 in 775. An earlier version of this comment
    claimed the positional reading was wrong; it had only checked two slots.

    Nothing is claimed when `player_evo` is absent. The slot tells you WHERE a
    special card sits, not whether one was brought, and `evolution_marks`
    returns None for "we were never told" precisely so that stays distinct from
    "they ran none".
    """
    if not raw:
        return {}
    try:
        marks = json.loads(raw)
    except Exception:
        return {}
    out: dict[str, str] = {}
    for m in marks:
        v = cd.mark_variant(m)
        if v and m[0] in deck:
            out[m[0]] = v
    return out


def read_duel_rows(tag: str, since: str | None,
                   until: str | None) -> tuple[list[dict], bool]:
    """Every duel-like battle row for one player in the window, oldest first.

    ONE READ SERVING EVERY DUEL SCREEN. The pair board and the Duel Zone have to
    describe the same duels — a player whose Duel Zone shows six series and
    whose combos were computed over seven is wrong in a way nothing would
    report. So the query, the mode filter and the tier partition live here once
    and both callers take what they need from the same rows.

    Returns `(rows, archive_used)`; each row is
    `{battle_time, mode, opponent_tag, opponent_name, result, cards, opp_cards,
      archetype, opp_archetype, crowns, opp_crowns, evo}`.
    """
    windows = cd.tier_windows(tag, since, until)
    if not windows:
        return [], False

    raw_rows: list[dict] = []
    archive_used = False
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
                "WHERE player_tag = ? AND battle_time >= ? AND battle_time <= ?",
                (tag, w_lo, w_hi),
            ).fetchall()
        except Exception:
            rows = []
        finally:
            con.close()

        kept = 0
        for r in rows:
            mode = r["game_mode"] or ""
            # SCOPED IN PYTHON, NOT IN SQL, exactly as the bot does it:
            # "duel-like" is a Python predicate over a mode string, and moving
            # it into a WHERE clause would mean two definitions of a duel in two
            # languages, which eventually disagree.
            if not is_duel_like_mode(mode):
                continue
            try:
                cards = json.loads(r["player_card_keys"] or "[]")
            except Exception:
                continue
            if not cards:
                continue
            try:
                opp_cards = json.loads(r["opponent_card_keys"] or "[]")
            except Exception:
                opp_cards = []
            kept += 1
            raw_rows.append(
                {
                    "battle_time": r["battle_time"] or "",
                    "mode": mode,
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
                    # The opponent's marks, in the SAME [card, level, art] shape
                    # as `player_evo`. Carried so the Duel Zone can draw the
                    # deck the player was actually facing with its evolutions
                    # and heroes, rather than as eight plain cards — in a duel
                    # what the opponent spent is the information, and a plain
                    # render throws half of it away.
                    "opp_evo": r["opponent_evo"],
                }
            )
        if kept and idx > 0:
            archive_used = True

    raw_rows.sort(key=lambda r: r["battle_time"])
    return raw_rows, archive_used


def group_chunks(rows: list[dict]) -> list[list[dict]]:
    """Consecutive same-opponent practice rows, as `duel_split.group` does it.

    Because a chunk never spans two opponents, every rule `_split_series` then
    applies gets "same opponent" for free.
    """
    chunks: list[list[dict]] = []
    chunk: list[dict] = []
    for rec in rows:
        if not chunk:
            chunk = [rec]
        elif rec["opponent_tag"] == chunk[-1]["opponent_tag"]:
            chunk.append(rec)
        else:
            if len(chunk) >= MIN_DUEL_GAMES:
                chunks.append(chunk)
            chunk = [rec]
    if len(chunk) >= MIN_DUEL_GAMES:
        chunks.append(chunk)
    return chunks


def _iso_day(stamp: str) -> str:
    """`20260726T131502.000Z` -> `2026-07-26`. Empty stays empty."""
    s = (stamp or "")[:8]
    if len(s) != 8 or not s.isdigit():
        return ""
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def duel_decks(tag: str, since: str | None, until: str | None) -> dict:
    """Every duel deck this player fielded in the window.

    Returns {"decks": [...], "duels": n, "native": n, "reconstructed": n,
             "evoCovered": n, "span": (first, last), "archiveUsed": bool}
    where each deck is {"cards", "hash", "slot", "won", "evo"}.

    `span` is the battle_time of the first and last DUEL row read — not of the
    player's battles generally. A player can be active today and still have their
    last duel months back, and when the Evolutions tab is empty that gap is
    usually the whole explanation, so the tab has to be able to quote it.

    A deck's `slot` is its position in the loadout: 0 = G1, 1 = G2, 2 = G3.

    NATIVE ROWS CARRY THE WHOLE LOADOUT — 16 or 24 cards — so the split is read,
    not inferred, and the row's result is the DUEL's result, which every deck in
    that loadout inherits. Friendly practice stores one deck per row with its
    own result, and the loadout is rebuilt with the bot's series rules.
    """
    raw_rows, archive_used = read_duel_rows(tag, since, until)
    if not raw_rows:
        return {"decks": [], "duels": 0, "native": 0, "reconstructed": 0,
                "evoCovered": 0, "span": ("", ""), "archiveUsed": False}

    decks: list[dict] = []
    duels = native = reconstructed = evo_covered = 0

    # ── native rows: one row IS one duel ────────────────────────────────────
    practice: list[dict] = []
    for r in raw_rows:
        if not is_native_duel(r["mode"]):
            practice.append(r)
            continue
        cards = r["cards"]
        n = min(SLOTS, len(cards) // DECK_SIZE)
        if n < 1:
            continue
        duels += 1
        native += 1
        won = r["result"] == "win"
        for i in range(n):
            deck = cards[i * DECK_SIZE : (i + 1) * DECK_SIZE]
            evo = _evo_marks(r["evo"], deck)
            if r["evo"]:
                evo_covered += 1
            decks.append(
                {
                    "cards": deck,
                    "hash": ",".join(deck),
                    "slot": i,
                    "won": won,
                    "evo": evo,
                }
            )

    # ── practice rows: rebuild the series, then read the slot off the index ──
    for ch in group_chunks(practice):
        for series in split_chunk(ch):
            duels += 1
            reconstructed += 1
            for i, rec in enumerate(series[:SLOTS]):
                deck = rec["cards"][:DECK_SIZE]
                if len(deck) < DECK_SIZE:
                    continue
                evo = _evo_marks(rec["evo"], deck)
                if rec["evo"]:
                    evo_covered += 1
                decks.append(
                    {
                        "cards": deck,
                        "hash": ",".join(deck),
                        "slot": i,
                        "won": rec["result"] == "win",
                        "evo": evo,
                    }
                )

    return {
        "decks": decks,
        "duels": duels,
        "native": native,
        "reconstructed": reconstructed,
        "evoCovered": evo_covered,
        # read_duel_rows() sorts by battle_time, so the ends ARE the span.
        "span": (raw_rows[0]["battle_time"], raw_rows[-1]["battle_time"]),
        "archiveUsed": archive_used,
    }


# --------------------------------------------------------------------------
# Evidence — the bot's thresholds, not new ones
# --------------------------------------------------------------------------

_Z = 1.959963984540054

CONF_HIGH = 10.0
CONF_MEDIUM = 18.0
CONF_LOW = 26.0
CONF_MIN_GAMES = 8

# A pair must clear the same floor as every other win-rate claim. NOT A NEW
# NUMBER: confidence_tier refuses to tier anything under CONF_MIN_GAMES, so a
# pair below it would be a percentage with no evidence attached.
PAIR_MIN_GAMES = CONF_MIN_GAMES

# A PAIRING MUST LIVE IN MORE THAN ONE DECK. The page's claim is "the
# combinations you rebuild around", and a pair confined to a single deck is not
# a pairing — it is that deck, named by two of its cards.
PAIR_MIN_DECKS = 2

# How often one card may reappear across a tab, and how many rows one deck may
# dominate. Both exist because a pair inherits the stats of WHOLE DECKS: a
# player's most-played deck otherwise contributes all 28 of its pairs and the
# table becomes one deck sliced N ways. Measured over 16 players in the bot
# project, cap 2 gives the most diverse board that still fills.
PAIR_CARD_CAP_STRICT = 2
PAIR_CARD_CAP_RELAX = 3
PAIR_DECK_CAP = 2

# Rows returned per tab. The table shows the first eight and "view all" reveals
# the rest, so this is the depth of the whole tab, not of the first screen.
PAIR_TARGET = 24


def wilson_interval(hits: int, n: int) -> tuple[float, float]:
    """95% Wilson score interval. Stays inside [0, 1] and behaves at the
    extremes — 6 wins from 6 games must not read as "100% +/- 0%"."""
    if n <= 0:
        return (0.0, 1.0)
    p = hits / n
    d = 1.0 + _Z * _Z / n
    centre = (p + _Z * _Z / (2 * n)) / d
    half = (_Z * math.sqrt(p * (1 - p) / n + _Z * _Z / (4 * n * n))) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def confidence_tier(wins: int, games: int) -> tuple[str | None, str | None]:
    """-> (tier, interval_text) or (None, None).

    None is NOT "low confidence" — it means the claim is not made at all.
    """
    if not games or games < CONF_MIN_GAMES:
        return None, None
    lo, hi = wilson_interval(wins, games)
    half = (hi - lo) / 2 * 100
    if half <= CONF_HIGH:
        tier = "high"
    elif half <= CONF_MEDIUM:
        tier = "medium"
    elif half <= CONF_LOW:
        tier = "low"
    else:
        return None, None
    return tier, f"±{half:.0f}%"


def is_trustworthy(tier: str | None) -> bool:
    """Whether a claim may RANK, as opposed to merely display."""
    return tier in ("high", "medium")


def classify_lockstep(pct: float | None) -> str:
    """'shared' | 'frequent' | 'locked' — how tightly two cards travel together.

    DELIBERATELY NOT AN EVALUATION. A player who rebuilds around one core pair
    and a player who spreads two cards across many shells are both playing
    legitimately, so the UI paints these neutral. Boundaries are the quartiles
    of the real distribution rather than round numbers.
    """
    if pct is None:
        return "unknown"
    if pct >= 66.0:
        return "locked"
    if pct >= 33.0:
        return "frequent"
    return "shared"


# --------------------------------------------------------------------------
# Pair expansion + the three tabs
# --------------------------------------------------------------------------

TABS = ("win-conditions", "spells", "evolutions")

TAB_META = {
    "win-conditions": {
        "label": "Win Conditions",
        "blurb": "Pairings that carry your win condition.",
        "noun": "Win Condition",
    },
    "spells": {
        "label": "Spells",
        "blurb": "Two spells you bring together.",
        "noun": "Spell",
    },
    "evolutions": {
        "label": "Evolutions",
        "blurb": "Both cards brought in an evolution slot.",
        "noun": "Evolution",
    },
}


def _in_tab(tab: str, a: str, b: str, evo: dict[str, int]) -> bool:
    """The bot's category predicates, applied independently per tab.

    WIN CONDITIONS means AT LEAST ONE, and that is measured rather than chosen:
    "both cards are win conditions" has a median of 0 across 16 players, because
    decks carry one win condition — the category would be empty by construction.
    """
    ia, ib = card_info(a), card_info(b)
    if tab == "win-conditions":
        return ia["is_win_condition"] or ib["is_win_condition"]
    if tab == "spells":
        return ia["is_spell"] and ib["is_spell"]
    if tab == "evolutions":
        # BROUGHT in an evolution slot — the measured reading, never merely
        # `can_evolve`. A card the player owns an evolution for but has never
        # fielded evolved has not been observed here.
        return bool(evo.get(a)) and bool(evo.get(b))
    return False


def _pair_rank(r: dict) -> tuple:
    """EVIDENCE FIRST, then reach, then volume.

    Ranking by games alone returns one deck sliced N ways: a pair inherits the
    stats of the whole decks holding both cards, so the 28 pairs of whichever
    deck the player grinds take the top of every tab. Ranking by reach alone
    fixes that and breaks the evidence rule instead — a pair in twenty decks
    played twice each arrives at 21 games carrying a 95% win rate. So a pairing
    the page can stand behind outranks one it cannot, reach orders within each
    of those groups, and volume only breaks ties.
    """
    return (not is_trustworthy(r["tier"]), -r["decks"], -r["games"], r["a"], r["b"])


def _select(pool: list[dict], want: int) -> list[dict]:
    """Greedy pick under a card budget and a deck budget.

    FRESHEST FIRST, THEN BY RANK — three sweeps over the same pool, taking
    pairings whose cards are both unused before those reusing one, before those
    reusing both. A plain greedy pass does NOT spread: it walks the ranking from
    the top, where the pairings share cards, and spends the budget on the first
    cards it meets.

    `seen` is load-bearing, not defensive: taking a pairing in sweep 0 marks
    both its cards used, which moves that very row into sweep 2's bucket where
    nothing else would stop it being taken twice.
    """
    got: list[dict] = []
    seen: set[tuple[str, str]] = set()
    budget: dict[str, int] = {}
    deck_budget: dict[str, int] = {}

    for cap in (PAIR_CARD_CAP_STRICT, PAIR_CARD_CAP_RELAX):
        for sweep in (0, 1, 2):
            if len(got) >= want:
                break
            for r in pool:
                if len(got) >= want:
                    break
                key = (r["a"], r["b"])
                if key in seen:
                    continue
                used = (1 if budget.get(r["a"], 0) else 0) + (
                    1 if budget.get(r["b"], 0) else 0
                )
                if used != sweep:
                    continue
                if budget.get(r["a"], 0) >= cap or budget.get(r["b"], 0) >= cap:
                    continue
                # THE DECK BUDGET IS THE ONE THAT FIXES THE ONE-DECK BOARD. The
                # card cap alone still returned three decks in twenty-four hats.
                if deck_budget.get(r["top_deck"], 0) >= PAIR_DECK_CAP:
                    continue
                budget[r["a"]] = budget.get(r["a"], 0) + 1
                budget[r["b"]] = budget.get(r["b"], 0) + 1
                deck_budget[r["top_deck"]] = deck_budget.get(r["top_deck"], 0) + 1
                seen.add(key)
                got.append(r)
    return got


def _combo_json(r: dict, total: int, slot_totals: list[int], art: dict | None = None) -> dict:
    ia, ib = card_info(r["a"]), card_info(r["b"])
    art = art or {}
    return {
        "a": r["a"],
        "b": r["b"],
        "aName": ia["name"],
        "bName": ib["name"],
        "name": f"{ia['name']} + {ib['name']}",
        "games": r["games"],
        "wins": r["wins"],
        "winRate": round(r["wins"] / r["games"] * 100, 1) if r["games"] else 0.0,
        "useRate": round(r["games"] / total * 100, 1) if total else 0.0,
        "decks": r["decks"],
        "lock": round(r["lock"], 1),
        "lockClass": classify_lockstep(r["lock"]),
        "tier": r["tier"],
        "interval": r["interval"],
        "slots": r["slots"],
        # Share of the decks played in THAT slot which carried this pair. Not a
        # share of the pair's own games — the question is "how much of my G2 is
        # this combo", and the three slots do not hold equal numbers of decks
        # (a duel decided 2-0 never fields its third).
        "slotShare": [
            round(r["slots"][i] / slot_totals[i] * 100, 1) if slot_totals[i] else 0.0
            for i in range(SLOTS)
        ],
        "topShare": round(r["top_share"], 1),
        "artA": art.get(r["a"]),
        "artB": art.get(r["b"]),
    }


def combo_report(tag: str, since: str | None = None, until: str | None = None) -> dict | None:
    """The Duel Analysis page: three tabs of card combinations."""
    src = duel_decks(tag, since, until)
    decks = src["decks"]
    if not decks:
        return None

    # Group identical decks first. This is the bot's ordering — pairs come from
    # decks, and a deck's whole record travels with every pair it contains.
    by_hash: dict[str, dict] = {}
    for d in decks:
        e = by_hash.setdefault(
            d["hash"],
            {"cards": d["cards"], "games": 0, "wins": 0, "slots": [0] * SLOTS},
        )
        e["games"] += 1
        e["wins"] += 1 if d["won"] else 0
        if 0 <= d["slot"] < SLOTS:
            e["slots"][d["slot"]] += 1

    # Evolution slots, counted over the same population the pairs come from.
    # `evo` counts EVOLUTION fieldings (what the Evolutions tab means); `art`
    # remembers how each card is most often drawn, hero included.
    evo: dict[str, int] = {}
    art_tally: dict[str, dict[str, int]] = {}
    for d in decks:
        for c, kind in d["evo"].items():
            if kind == "evolution":
                evo[c] = evo.get(c, 0) + 1
            per = art_tally.setdefault(c, {})
            per[kind] = per.get(kind, 0) + 1
    # OBSERVED FIRST, THEN THE GLOBAL PROFILE. A combo is a pair of cards, not a
    # deck, so there is no slot to reason about — the only honest statement is
    # "this card is usually brought as X". Without the fallback the tab rendered
    # art for some players and not others, purely because `player_evo` covers
    # battles from 2026-08-05 onward (~29% of the database) and a player whose
    # duels predate that has no marks at all.
    art = dict(cd.card_art_profile())
    art.update({c: max(sorted(k), key=lambda x: k[x]) for c, k in art_tally.items()})

    total = len(decks)
    slot_totals = [0] * SLOTS
    for d in decks:
        if 0 <= d["slot"] < SLOTS:
            slot_totals[d["slot"]] += 1

    pairs: dict[tuple[str, str], dict] = {}
    cards: dict[str, dict] = {}
    for h, e in by_hash.items():
        g, w = e["games"], e["wins"]
        # SET, THEN SORTED. A deck is eight distinct cards, but a legacy row
        # could repeat one; `set` makes the expansion safe and `sorted` makes
        # (a, b) canonical, so there is no code path producing the reversed key.
        keys = sorted(set(e["cards"]))
        for c in keys:
            ce = cards.setdefault(c, {"games": 0, "wins": 0})
            ce["games"] += g
            ce["wins"] += w
        for a, b in itertools.combinations(keys, 2):
            p = pairs.setdefault(
                (a, b),
                {
                    "games": 0, "wins": 0, "decks": 0, "slots": [0] * SLOTS,
                    "top_deck": h, "top_games": 0,
                },
            )
            p["games"] += g
            p["wins"] += w
            p["decks"] += 1
            for i in range(SLOTS):
                p["slots"][i] += e["slots"][i]
            # Explicit tiebreak on the hash so a tie cannot fall through to
            # dict iteration order.
            if (g, h) > (p["top_games"], p["top_deck"]):
                p["top_deck"], p["top_games"] = h, g

    rows: list[dict] = []
    for (a, b), p in pairs.items():
        g = p["games"]
        if g < PAIR_MIN_GAMES or p["decks"] < PAIR_MIN_DECKS:
            continue
        tier, interval = confidence_tier(p["wins"], g)
        # LOCKSTEP = the Jaccard index of the two cards' deck sets: of every
        # deck featuring EITHER card, the share featuring both. Symmetric by
        # construction and exact rather than estimated. It answers a question no
        # other number here does — whether these two are a package or two
        # popular cards that sometimes coincide.
        union = cards[a]["games"] + cards[b]["games"] - g
        rows.append(
            {
                "a": a, "b": b, "games": g, "wins": p["wins"],
                "decks": p["decks"], "slots": p["slots"],
                "lock": (g / union * 100) if union else 0.0,
                "tier": tier, "interval": interval,
                "top_deck": p["top_deck"],
                "top_share": (p["top_games"] / g * 100) if g else 0.0,
            }
        )
    rows.sort(key=_pair_rank)

    tabs = {}
    for tab in TABS:
        pool = [r for r in rows if _in_tab(tab, r["a"], r["b"], evo)]
        chosen = _select(pool, PAIR_TARGET)
        chosen.sort(key=_pair_rank)
        out = [_combo_json(r, total, slot_totals, art) for r in chosen]

        # The headline tiles. "Most used" is by games; the G2/G3 tiles name the
        # combo that dominates that slot, which is a different question and
        # routinely a different pair — it is where a player's second and third
        # decks show their own shape.
        # Explicit tiebreak on the card keys: pairs tie on game count constantly
        # (whole decks move together), and `max` would otherwise fall through to
        # iteration order — the reshuffle-on-identical-data bug this project has
        # already shipped twice.
        ranked = sorted(pool, key=lambda r: (-r["games"], r["a"], r["b"]))
        most_used = ranked[0] if ranked else None
        per_slot = []
        for i in range(SLOTS):
            live = sorted(
                (r for r in pool if r["slots"][i] > 0),
                key=lambda r: (-r["slots"][i], r["a"], r["b"]),
            )
            best = live[0] if live else None
            per_slot.append(_combo_json(best, total, slot_totals, art) if best else None)

        tabs[tab] = {
            "id": tab,
            "label": TAB_META[tab]["label"],
            "blurb": TAB_META[tab]["blurb"],
            "noun": TAB_META[tab]["noun"],
            "eligible": len(pool),
            "mostUsed": _combo_json(most_used, total, slot_totals, art) if most_used else None,
            "perSlot": per_slot,
            "rows": out,
        }

    name = None
    for path in cd._tier_paths():
        try:
            con = cd.connect(path)
            try:
                r = con.execute(
                    "SELECT name FROM player_names WHERE tag = ?", (tag,)
                ).fetchone()
                if r:
                    name = r["name"]
                    break
            finally:
                con.close()
        except Exception:
            continue

    return {
        "player": {"name": name or tag, "tag": tag},
        "duels": {
            "total": src["duels"],
            "native": src["native"],
            "reconstructed": src["reconstructed"],
            "decks": total,
            "uniqueDecks": len(by_hash),
            "slots": slot_totals,
            # Share of duel decks whose evolution slots are actually recorded.
            # Evolution data is OPPORTUNISTIC — only battles whose raw payload
            # was still on the SSD when the backfill ran carry it — so the
            # Evolutions tab has to be able to say why it is thin.
            "evoCoverage": round(src["evoCovered"] / total * 100, 1) if total else 0.0,
            # ISO days (YYYY-MM-DD) for the first and last duel read, so the
            # Evolutions tab can name the period it found nothing in.
            "span": {
                "from": _iso_day(src["span"][0]),
                "to": _iso_day(src["span"][1]),
            },
        },
        "pairs": {"observed": len(pairs), "eligible": len(rows)},
        "floors": {"minGames": PAIR_MIN_GAMES, "minDecks": PAIR_MIN_DECKS},
        "tabs": tabs,
        "archiveUsed": src["archiveUsed"],
    }
