"""player_cards.py — every card, as this player actually plays it.

The board behind `#/player/<tag>/cards`: use rate and win rate for all 122
cards over a date window, plus how each moved against the window before it.

WHY IT SCANS `battles` RATHER THAN `player_card_agg`. The rollup exists and is
one row per card, but it is LIFETIME-ONLY — no date column, no game mode. Read
from it, the date control and the mode control would both be decoration, which
is the exact failure the deck rows had before they moved onto `battles`. A
per-player scan is cheap: the `(player_tag, …)` index makes it ~50 ms.

WHAT THE SERVER DOES NOT DO. Card type, elixir, rarity, win-condition,
champion and evolution are all in the browser already (`cards.json` +
`cardMeta.json`), so every filter on the screen is applied client-side over
122 rows. Sending them from here would be a second copy of the card metadata,
free to disagree with the one drawing the art.

ALL 122 CARDS COME BACK, including the ones this player has never touched.
"Which cards do they not play?" is a real question about a card board, and a
zero row answers it; dropping them would silently turn the board into "cards
they play" while the label says otherwise.
"""

from __future__ import annotations

import datetime
import json

import clash_data as cd
import duel_combos as dx

# --------------------------------------------------------------------------
# Game-mode scopes
# --------------------------------------------------------------------------
#
# The stored `game_mode` strings are Supercell's, and there are more of them
# than a control should offer. Each scope below is a PREDICATE over that string
# rather than a SQL clause, for the reason `duel_stats` gives: the definition of
# a mode group is Python, and a WHERE-clause copy of it drifts.

RANKED_PREFIXES = ("ranked1v1", "ladder")


def _mode_of(game_mode: str) -> set[str]:
    """Every scope this battle belongs to."""
    m = (game_mode or "").lower()
    out = {"all"}
    if m.startswith(RANKED_PREFIXES):
        out.add("ranked")
    if dx.is_duel_like_mode(game_mode):
        out.add("duel")
    if "tournament" in m or "challenge" in m:
        out.add("tournament")
    return out


MODES = ("all", "ranked", "duel", "tournament")

# Battles a card needs before its win rate is RANKED. Not a new number: it is
# `duel_combos.CONF_MIN_GAMES`, the pair board's evidence floor, and it exists
# here for the same reason — without it the top of a "best cards" board is a
# list of cards played once and won once, and Rage at 100% outranks a card with
# a real record. Below the floor a card still appears (all 122 do), it is simply
# not competing for a rank it has no evidence for.
CARD_MIN_BATTLES = dx.CONF_MIN_GAMES


# --------------------------------------------------------------------------
# Counting
# --------------------------------------------------------------------------

def _tally(tag: str, since: str | None, until: str | None,
           mode: str) -> tuple[dict[str, list[int]], int, int, bool]:
    """`(per, battles, wins, archive_used, forms, coverage)`.

    `per`      `{card: [battles, wins, evolved, heroed]}` over every battle.
    `forms`    `{card: {'base'|'evolution'|'hero': [battles, wins]}}` over only
               the battles whose payload recorded the form.
    `coverage` how many battles that was, and the dates they span.

    A card counts once per BATTLE, not once per copy — a deck holds each card
    at most once, so this is the same thing, but saying it out loud matters for
    the denominator: use rate is a share of battles, not of card slots.

    EVOLVED AND HERO ARE COUNTED SEPARATELY. `_evo_marks` resolves each mark to
    'evolution' or 'hero' and these are different things — a Hero Knight is not
    an evolved Knight, it is the other special form, with its own art and its
    own slot. An earlier version added both into one "evolved" counter, so a
    card that had only ever been fielded as a hero reported a 100% evolution
    rate. Sixteen cards can be heroes and four of those can also evolve
    (knight, valkyrie, musketeer, wizard), which is exactly the set where
    conflating them is least visible and most wrong.
    """
    per: dict[str, list[int]] = {}
    total = wins = 0
    archive_used = False

    # The per-FORM board, counted over a different denominator; see _forms.
    forms: dict[str, dict[str, list[int]]] = {}
    marked_total = marked_wins = 0
    marked_lo = marked_hi = None

    for idx, (path, w_lo, w_hi) in enumerate(cd.tier_windows(tag, since, until)):
        try:
            con = cd.connect(path)
        except Exception:
            continue
        try:
            rows = con.execute(
                "SELECT battle_time, game_mode, result, player_card_keys, player_evo "
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
            if mode not in _mode_of(r["game_mode"] or ""):
                continue
            try:
                cards = json.loads(r["player_card_keys"] or "[]")
            except Exception:
                continue
            if not cards:
                continue
            kept += 1
            total += 1
            won = r["result"] == "win"
            if won:
                wins += 1
            evo = dx._evo_marks(r["player_evo"], cards)
            for c in set(cards):
                e = per.setdefault(c, [0, 0, 0, 0])
                e[0] += 1
                if won:
                    e[1] += 1
                art = evo.get(c)
                if art == "evolution":
                    e[2] += 1
                elif art == "hero":
                    e[3] += 1

            # ── the per-form board ────────────────────────────────────────
            # Only battles whose payload actually recorded the forms can be
            # split, and the split is only sound if BOTH sides come from that
            # same subset. Inside a marked row a card that carries no mark was
            # fielded in its base form — that is a real reading of the row, and
            # it is the only place "base" can be counted from. Outside one, the
            # form is unknown, which is not the same as base.
            if r["player_evo"]:
                marked_total += 1
                if won:
                    marked_wins += 1
                t = (r["battle_time"] or "")[:8]
                if t:
                    marked_lo = t if marked_lo is None else min(marked_lo, t)
                    marked_hi = t if marked_hi is None else max(marked_hi, t)
                for c in set(cards):
                    f = forms.setdefault(c, {})
                    e = f.setdefault(evo.get(c, "base"), [0, 0])
                    e[0] += 1
                    if won:
                        e[1] += 1
        if kept and idx > 0:
            archive_used = True

    coverage = {
        "battles": marked_total,
        "wins": marked_wins,
        "from": marked_lo,
        "to": marked_hi,
    }
    return per, total, wins, archive_used, forms, coverage


def _iso(compact: str | None) -> str | None:
    """`20260804` -> `2026-08-04`. Stored times are compact; the API is ISO."""
    if not compact or len(compact) != 8 or not compact.isdigit():
        return None
    return f"{compact[:4]}-{compact[4:6]}-{compact[6:]}"


def _shift(since: str | None, until: str | None) -> tuple[str | None, str | None]:
    """The window of equal length immediately before this one.

    That is what the deltas on the board compare against — "up 1.3 points" has
    to be against something, and the only honest comparison for a 30-day view is
    the 30 days before it. Returns (None, None) when the window is open-ended,
    in which case no delta is claimed at all.
    """
    if not since or not until:
        return None, None
    try:
        a = datetime.date.fromisoformat(since)
        b = datetime.date.fromisoformat(until)
    except ValueError:
        return None, None
    span = (b - a).days + 1
    return (a - datetime.timedelta(days=span)).isoformat(), \
           (a - datetime.timedelta(days=1)).isoformat()


def card_board(tag: str, since: str | None = None, until: str | None = None,
               mode: str = "all") -> dict:
    """Use rate and win rate for every card, plus movement against last window."""
    if mode not in MODES:
        mode = "all"

    now, total, wins, archive_used, forms, marked = _tally(tag, since, until, mode)
    p_since, p_until = _shift(since, until)
    prev, prev_total, _, _, _, _ = (
        _tally(tag, p_since, p_until, mode)
        if p_since else ({}, 0, 0, False, {}, {"battles": 0})
    )

    def rate(n: int, d: int) -> float:
        return round(n / d * 100, 1) if d else 0.0

    m_total = marked.get("battles", 0)

    def form_row(counts: list[int] | None) -> dict | None:
        """One card in ONE form, scored on its own.

        The denominator for a form's use rate is the MARKED battles, not every
        battle — a share of a population the form could not have been observed
        in would understate every one of them by the coverage gap. The win rate
        and the evidence floor are the card board's, unchanged, so a form with
        four battles behind it is marked thin exactly as a card would be.
        """
        if not counts or not counts[0]:
            return None
        b, w = counts
        tier, interval = dx.confidence_tier(w, b)
        return {
            "battles": b,
            "wins": w,
            "useRate": rate(b, m_total),
            "winRate": rate(w, b),
            "tiered": b >= CARD_MIN_BATTLES,
            "tier": tier,
            "interval": interval,
        }

    cards = []
    for key in dx.card_keys():
        b, w, evo, hero = now.get(key, (0, 0, 0, 0))
        row = {
            "key": key,
            "battles": b,
            "wins": w,
            "losses": b - w,
            "useRate": rate(b, total),
            "winRate": rate(w, b),
            # How often it was fielded in each SPECIAL form, as a share of its
            # own play — `player_evo` only covers ~29% of rows, so both are
            # floors rather than counts.
            "evoRate": rate(evo, b),
            "heroRate": rate(hero, b),
            # Enough games behind the win rate for it to be ranked?
            "tiered": b >= CARD_MIN_BATTLES,
        }
        # The pair board's Wilson tier, unchanged. `None` means the sample
        # cannot support a claim at all — not "low confidence".
        tier, interval = dx.confidence_tier(w, b)
        row["tier"] = tier
        row["interval"] = interval

        # The same card scored once per FORM it was actually seen in. Present
        # only where there is something to report — a card with no marked
        # battles gets no `forms` key rather than three zero rows, so the
        # client can tell "not observed in either form" from "observed, 0%".
        f = forms.get(key)
        if f:
            got = {
                name: fr
                for name, fr in (
                    (n, form_row(f.get(n))) for n in ("base", "evolution", "hero")
                )
                if fr
            }
            if got:
                row["forms"] = got
        if prev_total:
            pb, pw, _, _ = prev.get(key, (0, 0, 0, 0))
            row["useDelta"] = round(row["useRate"] - rate(pb, prev_total), 1)
            # A win rate against no games is not 0% — it is nothing, and a card
            # they did not play last window has not "fallen to zero".
            if pb and b:
                row["winDelta"] = round(row["winRate"] - rate(pw, pb), 1)
        cards.append(row)

    # Evidence first, then win rate, then volume, then the key so the order
    # never depends on dict iteration. A card under the floor sorts below every
    # card over it however high its percentage reads.
    cards.sort(key=lambda c: (not c["tiered"], -c["winRate"], -c["battles"], c["key"]))
    for i, c in enumerate(cards):
        c["rank"] = i + 1

    return {
        "cards": cards,
        "totals": {
            "battles": total,
            "wins": wins,
            "played": sum(1 for c in cards if c["battles"]),
            "ranked": sum(1 for c in cards if c["tiered"]),
            "cards": len(cards),
            "minBattles": CARD_MIN_BATTLES,
            "archiveUsed": archive_used,
        },
        "mode": mode,
        "previous": ({"from": p_since, "to": p_until, "battles": prev_total}
                     if p_since else None),
        # What the per-form split is actually built on. Sent so the screen can
        # SAY it: the form is only known for the battles whose payload carried
        # marks, which on a real account is a minority of the window and a
        # narrower date range than the one the user asked for. A per-form win
        # rate presented without that is a number pretending to be the same
        # kind of thing as the card's own.
        "formCoverage": {
            "battles": m_total,
            "share": rate(m_total, total),
            "from": _iso(marked.get("from")),
            "to": _iso(marked.get("to")),
        },
    }
