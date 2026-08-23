"""Analyse a player's live battlelog, for tags the stored history does not cover.

The gap this fills: `battles.db` holds what the bot polled, so the first time
anyone searches a tag there is nothing there and the analysis screen 404s. The
game has been keeping that player's recent battles the whole time, and the API
hands over the last ~25 of them in one request. So a brand-new tag gets a real
screen immediately, and the stored history takes over once the bot catches up.

WHAT THIS IS NOT. It is not a second implementation of `player_report`. The
figures here are computed over at most 25 battles from a fixed, non-paginated
endpoint; no date window reaches past it, movement against a previous window
cannot be computed, and the evidence floors the rest of this project applies
(`CONF_MIN_GAMES` = 8) would reject most of what it can say. Every response is
therefore stamped `basis: "live"` with its own battle count, and the UI is
expected to label it rather than let it pass for the stored kind of number.
Merging the two would produce a screen where the same figure means different
things on different days.

THREE THINGS ARE SHARED WITH THE STORED PATH RATHER THAN REBUILT, because a
second copy of any of them is a second source of truth that is free to drift:

  * `clash_data.mark_variant` decides evolution vs hero. The live payload
    carries `evolutionLevel` on each card, which is the SAME field the stored
    `player_evo` triple carries in position 1 — the one this project established
    is exact where the `art` string is 16.1% wrong. Level 1 is an evolution,
    level 2 is a hero.
  * `clash_data.arrange_deck` owns slot order and which art each card wears.
  * `clash_data.deck_name` names the deck, so a deck reads identically here and
    on the meta board.
"""

from __future__ import annotations

import clash_data as cd
import deck_counter as dkc
import duel_combos as dcx

# The battlelog mixes real competitive play with 2v2, friendlies and event modes
# that hand the player a deck. Counting those would measure Supercell's choices,
# which is the same rule the meta board applies — kept in the same shape so the
# two cannot disagree about what "competitive" means.
_TEAM_SIZE_1V1 = 1

# Modes whose deck the player did not choose. Matched loosely because the live
# `gameMode.name` strings are far more varied than the stored `game_mode`
# column: "Ranked1v1_NewArena", "Challenge_AllCards_EventDeck", and so on.
_GIVEN_DECK_HINTS = ("eventdeck", "draft", "mirror", "ramp", "touchdown", "megadeck")


def _is_competitive(b: dict) -> bool:
    team = b.get("team") or []
    opp = b.get("opponent") or []
    if len(team) != _TEAM_SIZE_1V1 or len(opp) != _TEAM_SIZE_1V1:
        return False  # 2v2
    mode = ((b.get("gameMode") or {}).get("name") or "").lower()
    return not any(h in mode for h in _GIVEN_DECK_HINTS)


def _card_key(card: dict) -> str | None:
    """The live payload gives a display name; the rest of this project keys off
    the hyphenated slug in `cards.json`. 'P.E.K.K.A' -> 'pekka'."""
    name = card.get("name")
    if not name:
        return None
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in name)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-") or None


# `cards.json` keys are authoritative; the slug above agrees with them for the
# overwhelming majority but not all. Only genuine mismatches belong here.
_KEY_FIXES = {
    "p-e-k-k-a": "pekka",
    "pekka": "pekka",
    "mini-p-e-k-k-a": "mini-pekka",
    "x-bow": "x-bow",
    "electro-wizard": "electro-wizard",
    "barbarian-hut": "barbarian-hut",
}


def _resolve(card: dict, known: set[str]) -> str | None:
    key = _card_key(card)
    if not key:
        return None
    key = _KEY_FIXES.get(key, key)
    if key in known:
        return key
    # Fall back to a punctuation-free comparison against the known keys, which
    # catches the remaining "P.E.K.K.A"-shaped names without a hand-written
    # entry per card.
    flat = key.replace("-", "")
    for k in known:
        if k.replace("-", "") == flat:
            return k
    return None


def _outcome(b: dict) -> str:
    team = (b.get("team") or [{}])[0]
    opp = (b.get("opponent") or [{}])[0]
    tc, oc = team.get("crowns"), opp.get("crowns")
    if tc is None or oc is None:
        return "unknown"
    if tc > oc:
        return "win"
    if tc < oc:
        return "loss"
    return "draw"


def report(tag: str) -> dict | None:
    """Everything the analysis screen can honestly show from the live log.

    None means the API could not be reached at all — distinct from a player who
    has genuinely played nothing recently, which comes back as a real report
    with `battles: 0`.
    """
    log = cd.cr_battlelog(tag)
    if log is None:
        return None

    known = set(dcx.card_keys())

    battles = 0
    wins = losses = draws = 0
    crowns_for = crowns_against = 0
    trophy_change = 0
    modes: dict[str, int] = {}
    decks: dict[tuple[str, ...], dict] = {}
    cards: dict[str, list[int]] = {}  # key -> [games, wins]
    first_time = last_time = None
    skipped_non_competitive = 0

    for b in log:
        if not _is_competitive(b):
            skipped_non_competitive += 1
            continue

        team = (b.get("team") or [{}])[0]
        opp = (b.get("opponent") or [{}])[0]

        keys: list[str] = []
        marks: dict[str, str] = {}
        for c in team.get("cards") or []:
            k = _resolve(c, known)
            if not k:
                continue
            keys.append(k)
            # `evolutionLevel` here is the same 1/2 the stored `player_evo`
            # triple carries, so the same resolver decides what it means. The
            # third element is the `art` string, which the live payload has no
            # equivalent of and which mark_variant only consults as a fallback.
            lvl = c.get("evolutionLevel")
            v = cd.mark_variant([k, lvl, None]) if lvl else None
            if v:
                marks[k] = v

        if len(keys) != 8:
            # A duel row carries 16 or 24 cards, and an incomplete one is not a
            # deck. Counted in the totals, but it cannot contribute a deck row.
            keys = []

        battles += 1
        res = _outcome(b)
        if res == "win":
            wins += 1
        elif res == "loss":
            losses += 1
        elif res == "draw":
            draws += 1

        crowns_for += team.get("crowns") or 0
        crowns_against += opp.get("crowns") or 0
        trophy_change += team.get("trophyChange") or 0

        mode = (b.get("gameMode") or {}).get("name") or "Unknown"
        modes[mode] = modes.get(mode, 0) + 1

        t = b.get("battleTime")
        if t:
            first_time = t if first_time is None or t < first_time else first_time
            last_time = t if last_time is None or t > last_time else last_time

        if keys:
            sig = tuple(sorted(keys))
            row = decks.setdefault(
                sig, {"cards": keys, "marks": {}, "games": 0, "wins": 0, "last": None}
            )
            row["games"] += 1
            row["wins"] += 1 if res == "win" else 0
            row["marks"].update(marks)
            if t and (row["last"] is None or t > row["last"]):
                row["last"] = t

            for k in set(keys):
                slot = cards.setdefault(k, [0, 0])
                slot[0] += 1
                slot[1] += 1 if res == "win" else 0

    # PERCENT, NOT A FRACTION. Every other endpoint in this API reports rates on
    # a 0-100 scale — `meta` sends useRate 2.13, `cards` sends winRate 75.0 —
    # and a single endpoint answering 0.75 for the same kind of field is the
    # sort of thing that reads correctly in a JSON dump and renders as "7500%"
    # three layers away. One convention, and this is the one that already
    # exists.
    def rate(num: int, den: int, digits: int = 1) -> float:
        return round(100.0 * num / den, digits) if den else 0.0

    card_meta = {c: dcx.card_info(c) for c in cards}

    deck_rows = []
    for sig, row in decks.items():
        # Same arrangement the stored screens use, and the marks decide: a card
        # nobody was seen fielding specially stays plain however capable it is.
        #
        # The returned `art` is what gets reported, NOT the marks that went in.
        # `arrange_deck` applies the game's cap on the way through — one mark per
        # slot, so two evolutions, two heroes, three in total — and a deck row
        # here pools every battle that used the list, which across a session can
        # name more special cards than any single battle fielded.
        order, art = cd.arrange_deck(row["cards"], row["marks"])
        info = {c: dcx.card_info(c) for c in order}
        try:
            archetype = dkc.archetype_of(order)
        except Exception:
            # It opens the bot's database to look the list up. That database may
            # be absent — which is exactly the case this whole module serves —
            # and an unnamed deck is a far better outcome than a dead screen.
            archetype = None
        deck_rows.append(
            {
                "hash": ",".join(sig),
                "cards": order,
                "art": art,
                # Never inferred here: the live payload states the form for every
                # card in every battle, so absence of a mark IS evidence of a
                # plain card, unlike the stored path where it usually means the
                # battle predates the backfill.
                "inferredArt": False,
                # The SHARED classifier, not a local one: it reads the stored
                # `decks.win_condition` the bot itself wrote when the list is
                # already known, and only derives from win-condition cards
                # otherwise. A second classifier here would eventually label a
                # deck differently from every stored battle on it.
                "archetype": archetype,
                "name": cd.deck_name(archetype, order, info),
                "games": row["games"],
                "wins": row["wins"],
                "winRate": rate(row["wins"], row["games"]),
                "useRate": rate(row["games"], battles),
                "lastSeen": row["last"],
            }
        )
    deck_rows.sort(key=lambda d: (-d["games"], d["hash"]))

    card_rows = [
        {
            "key": k,
            "name": (card_meta.get(k) or {}).get("name") or k.replace("-", " ").title(),
            "games": g,
            "wins": w,
            "winRate": rate(w, g),
            "useRate": rate(g, battles),
        }
        for k, (g, w) in cards.items()
    ]
    card_rows.sort(key=lambda c: (-c["games"], c["key"]))

    decided = wins + losses
    return {
        "basis": "live",
        "tag": tag,
        # The honest denominator for every rate below it, printed by the UI so a
        # 100% win rate off 3 battles cannot read like one off 3,000.
        "battles": battles,
        "wins": wins,
        "losses": losses,
        "draws": draws,
        # Draws are excluded from the denominator, matching the stored path.
        "winRate": rate(wins, decided),
        "crownsFor": crowns_for,
        "crownsAgainst": crowns_against,
        "trophyChange": trophy_change,
        "span": {"from": first_time, "to": last_time},
        "modes": [
            {"mode": m, "battles": n}
            for m, n in sorted(modes.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "decks": deck_rows,
        "cards": card_rows,
        # Stated rather than silently dropped: "25 battles" on the tin and 19 in
        # the figures needs an explanation on screen.
        "skipped": skipped_non_competitive,
        "logSize": len(log),
        "limits": {
            # The endpoint's cap, not ours, and the UI says so — otherwise the
            # date control looks broken on a live-only player.
            "endpointCap": True,
            "note": "Clash Royale serves only the most recent battles and does "
            "not paginate; no window reaches further back than this log.",
        },
    }
