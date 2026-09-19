"""Coach Roster, Phase 2 — one player's intelligence, in one read.

What the Player Analysis report does not carry and a coach needs: how the
player's results move DAY BY DAY, which MODES they play, which ARCHETYPES and
DECKS they bring, what they meet, and WHO they keep running into.

WHY DECKS ARE COUNTED HERE AND NOT TAKEN FROM THE PLAYER REPORT. The report
counts every mode, 2v2 included — measured on one real player, 1,816 battles
in 90 days against a 1v1 log where most of their play was hidden as 2v2 — so
its decks and its win rate describe mostly team games. A coaching screen
reads 1v1, and a deck table built from a different set of battles than the
Battles and Opponents tabs beside it would contradict them.

ONE READ, AND IT IS AN EXISTING ONE. Every figure here comes from a single
pass over `recent_battles._read_rows` — the Recent Battles screen's reader —
so it inherits that reader's rules instead of restating them:

  * the storage-tier walk (hot, then archive, reported when touched);
  * the MODE ROUTER running first, so 2v2, drafts and preset-deck events are
    never counted as the player's own 1v1 battles — they are counted by mode
    and returned as `hidden`, exactly as the battle log shows them;
  * `_outcome`, which prefers the recorded result over the crowns.

A second reader would be a second opinion about which battles exist, and the
coaching screen would eventually disagree with the battle log sitting beside
it. That is the whole reason this module does not open the database itself.

NOTHING IS ESTIMATED. Every number is a count of stored battles. A day with no
battles is a zero-battle day with NO win rate (not 0%), and an opponent met
once is listed with n=1, never scored. The client decides what is worth
saying; this only counts.
"""

from __future__ import annotations

import datetime as _dt

import clash_data as cd
import recent_battles as rb

#: Opponents returned, most-met first. The distinct total is reported beside it.
OPPONENT_LIMIT = 50
#: Newest results returned as "current form".
FORM_LENGTH = 10
#: Decks returned, most-played first. The distinct total is reported beside it.
DECK_LIMIT = 25


def _day(battle_time: str) -> str | None:
    t = battle_time or ""
    if len(t) < 8 or not t[:8].isdigit():
        return None
    return f"{t[:4]}-{t[4:6]}-{t[6:8]}"


def _tally() -> dict:
    return {"battles": 0, "wins": 0, "losses": 0, "draws": 0}


def _add(t: dict, outcome: str) -> None:
    t["battles"] += 1
    t[{"win": "wins", "loss": "losses"}.get(outcome, "draws")] += 1


def _days_between(first: str, last: str) -> list[str]:
    a = _dt.date.fromisoformat(first)
    b = _dt.date.fromisoformat(last)
    if b < a:
        a, b = b, a
    # Bounded: a window is at most a few hundred days, and the hot tier holds
    # ten months. A guard anyway, so a corrupt timestamp cannot ask for a
    # century of zero-filled days.
    span = min((b - a).days, 4000)
    return [(a + _dt.timedelta(days=i)).isoformat() for i in range(span + 1)]


def report(tag: str, since: str | None = None, until: str | None = None) -> dict:
    rows, archive_used, hidden = rb._read_rows(tag, since, until)

    total = _tally()
    daily: dict[str, dict] = {}
    modes: dict[str, dict] = {}
    mine: dict[str, dict] = {}
    theirs: dict[str, dict] = {}
    opponents: dict[str, dict] = {}
    decks: dict[str, dict] = {}
    form: list[str] = []

    for r in rows:  # newest first — `_read_rows` sorts across tiers
        outcome = rb._outcome(r["result"], r["crowns"], r["opp_crowns"])
        _add(total, outcome)
        if len(form) < FORM_LENGTH:
            form.append(outcome)

        day = _day(r["battle_time"])
        if day:
            _add(daily.setdefault(day, _tally()), outcome)

        _add(modes.setdefault(rb._mode_label(r["mode"]), _tally()), outcome)

        a = (r["archetype"] or "").strip().lower()
        if a:
            _add(mine.setdefault(a, _tally()), outcome)
        oa = (r["opp_archetype"] or "").strip().lower()
        if oa:
            _add(theirs.setdefault(oa, _tally()), outcome)

        # A DECK is exactly eight distinct cards. A native duel row stores a
        # 16- or 24-card loadout, which is not one deck and is not split into
        # invented ones here.
        cards = r["cards"] or []
        if len(cards) == 8 and len(set(cards)) == 8:
            key = ",".join(sorted(cards))
            d = decks.get(key)
            if d is None:
                # Newest sighting first, so this is how they field it NOW —
                # drawn by the battle log's own helper (arrangement + art).
                d = decks[key] = {"key": key, **rb._side(cards, r["evo"], r["archetype"] or ""),
                                  "last": r["battle_time"], **_tally()}
            _add(d, outcome)

        ot = r["opponent_tag"] or ""
        if ot:
            o = opponents.get(ot)
            if o is None:
                # Rows arrive newest first, so the FIRST sighting carries the
                # most recent battle and the most recent name.
                o = opponents[ot] = {
                    "tag": ot,
                    "name": r["opponent_name"] or None,
                    "last": r["battle_time"],
                    **_tally(),
                }
            elif not o["name"] and r["opponent_name"]:
                o["name"] = r["opponent_name"]
            _add(o, outcome)

    # ZERO-FILLED between the first and last battle in the window, so a chart
    # shows a gap as a gap rather than joining two distant days with a line.
    timeline = []
    if daily:
        days = sorted(daily)
        for d in _days_between(days[0], days[-1]):
            timeline.append({"day": d, **daily.get(d, _tally())})

    def ranked(src: dict, name) -> list[dict]:
        out = [{"key": k, "name": name(k), **v} for k, v in src.items()]
        out.sort(key=lambda x: (-x["battles"], x["name"]))
        return out

    # Most-met first; among equals, the most recently met first. Two passes
    # because the sort is STABLE: newest-first, then by count, keeps the
    # newest-first order inside each count.
    opp_list = sorted(opponents.values(), key=lambda o: o["last"], reverse=True)
    opp_list.sort(key=lambda o: -o["battles"])

    deck_list = sorted(decks.values(), key=lambda d: d["last"], reverse=True)
    deck_list.sort(key=lambda d: -d["battles"])

    return {
        "player": {"tag": tag, "name": cd.player_name(tag)},
        "window": {"from": since, "to": until},
        "archiveUsed": archive_used,
        "summary": total,
        "form": form,
        "timeline": timeline,
        "modes": ranked(modes, lambda k: k),
        "archetypes": ranked(mine, cd._archetype_title),
        "opponentArchetypes": ranked(theirs, cd._archetype_title),
        "decks": deck_list[:DECK_LIMIT],
        "decksTotal": len(decks),
        "opponents": opp_list[:OPPONENT_LIMIT],
        "opponentsTotal": len(opponents),
        # Faced more than once in the window — a figure the Insights read.
        "opponentsRepeat": sum(1 for o in opponents.values() if o["battles"] > 1),
        # The same honesty the battle log keeps: what was in the window and is
        # not counted, by raw mode string.
        "hidden": sum(hidden.values()),
        "hiddenByMode": dict(sorted(hidden.items(), key=lambda kv: (-kv[1], kv[0]))),
    }

