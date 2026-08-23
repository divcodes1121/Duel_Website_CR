"""duel_zone.py — a player's duel series, and what they bring after their opener.

Two questions the website could not answer before, both ported from the Discord
bot rather than re-derived:

  * **Recent duels** — the series log behind `!duels`: every Bo3/Bo5 this player
    played, newest first, with each game's deck and result.
  * **Deck sequence** — the `!duelspdf` "Deck Sequence Prediction" page: for each
    deck they open with, which two decks follow.

A PORT, NOT A REIMPLEMENTATION, for the reason `duel_combos.py` already gives:
if the two ever disagreed, this site would start describing a different set of
duels from `!duels` for the same player, silently and with no error. Every
constant below is carried over with the name it has over there, and the ones
that were measured are labelled as measured — do not retune them here.

WHERE IT DELIBERATELY DIVERGES. `SEQ_MAX_ROWS` and `SERIES_LIMIT` are ours. The
bot's equivalents (27 rows, split across four pages) are PDF page geometry —
its own comment records the layout engine refusing fourteen tiles because four
rows need 552px against a 540px band. A scrolling panel has no such limit, so
the number is chosen for reading rather than copied from a page that does not
exist here.

Both screens are served from ONE database read (`duel_combos.read_duel_rows`),
so the series log and the sequence can never be computed over different duels.
"""

from __future__ import annotations

import clash_data as cd
import duel_combos as dx

# --------------------------------------------------------------------------
# Constants, carried over with the bot's own names
# --------------------------------------------------------------------------

# Cards shared before two decks are "the same deck". `duel_stats`' rule, which
# !counter, the clusterer and the duel matcher all share; the meta board's
# MERGE_MIN_OVERLAP is the same 6 for the same reason.
COUNTER_MIN_OVERLAP = 6

# A candidate companion may share at most this many cards with a revealed deck.
# Not zero: a little tolerance absorbs cross-loadout noise while still excluding
# the revealed deck itself and its near-mirrors. (bot.PREDICT_COMPANION_MAX_SHARED)
PREDICT_COMPANION_MAX_SHARED = 2

# How many companions to cluster before the legality filter runs. MEASURED: a
# 3-deck shortlist contained a legal card-disjoint pair only 59% of the time,
# the full pool 99%. (duel_stats.PREDICT_COMPANION_POOL)
PREDICT_COMPANION_POOL = 10

# Below this many duel games the prediction is flagged thin rather than hidden.
# (bot.PREDICT_MIN_DUEL_GAMES)
PREDICT_MIN_DUEL_GAMES = 6

# Two openers this similar are the same opener. (pdf_report.PDF_PREDICT_DUP_OVERLAP)
PREDICT_DUP_OVERLAP = 5

# How much a companion seen in the SAME series as the opener outweighs one
# merely played often. MEASURED leak-free on 839 real 3-game series: naming at
# least one true companion rose 16.6% -> 23.6% and repeated rows fell 63% -> 8%.
# (bot.rank_companions_by_series)
CO_WEIGHT = 3

# NO DISPLAY CAPS. The bot has three (40 openers clustered, 27 rows, split over
# four pages) and every one of them is PDF page geometry — its own comment
# records the layout engine refusing fourteen tiles because four rows need 552px
# against a 540px band. A scrolling panel has no pages, so the window the user
# picked decides how much there is, and all of it is shown: 100 duels is ~187 kB
# of JSON, which is a page weight rather than a problem.
SEQ_MAX_OPENERS = None
SEQ_MAX_ROWS = None
SERIES_LIMIT = None


# --------------------------------------------------------------------------
# Deck identity and clustering — duel_stats._decks_match / _cluster_player_decks
# --------------------------------------------------------------------------

def decks_match(a, b) -> bool:
    """Two card lists are the same deck at COUNTER_MIN_OVERLAP+ shared cards."""
    return len(set(a) & set(b)) >= COUNTER_MIN_OVERLAP


def deck_label(cards: list[str], archetype: str) -> str:
    """The display name for a deck: its archetype, qualified so two different
    decks of one archetype do not both read "Mortar". `clash_data.deck_name`
    owns the rule — the meta board hit this first."""
    if not archetype:
        return "Unknown Deck"
    return cd.deck_name(archetype, cards, {c: dx.card_info(c) for c in cards})


def _avg_elixir(cards: list[str]) -> float:
    if not cards:
        return 0.0
    total = sum(dx.card_info(c).get("elixir") or 0 for c in cards)
    return round(total / len(cards), 1)


def cluster_player_decks(deck_lists: list[list[str]], max_decks: int | None,
                         denominator: int, arch=None, marks=None) -> list[dict]:
    """Cluster a player's decks at 6+ shared cards, merging minor variants.

    The representative is the cluster's most-frequent EXACT variant, never a
    synthetic average — a deck that was never played is not a deck the player
    can bring. Probabilities are over `denominator` so the caller decides
    whether "share of all duel decks" or "share of candidates" is being asked.
    """
    exact: dict[str, dict] = {}
    for deck in deck_lists:
        sig = ",".join(sorted(deck))
        e = exact.setdefault(sig, {"cards": deck, "count": 0})
        e["count"] += 1

    clusters: list[dict] = []
    for e in sorted(exact.values(), key=lambda x: (-x["count"],
                                                   ",".join(sorted(x["cards"])))):
        cset = set(e["cards"])
        placed = False
        for cl in clusters:
            if len(cset & cl["rep_set"]) >= COUNTER_MIN_OVERLAP:
                cl["count"] += e["count"]
                if e["count"] > cl["best_count"]:
                    cl["best_cards"] = e["cards"]
                    cl["best_count"] = e["count"]
                    cl["rep_set"] = cset
                placed = True
                break
        if not placed:
            clusters.append({"rep_set": cset, "count": e["count"],
                             "best_cards": e["cards"], "best_count": e["count"]})

    # Ties on count are common and dict order is not an order.
    clusters.sort(key=lambda c: (-c["count"], ",".join(sorted(c["best_cards"]))))

    out = []
    for cl in (clusters if max_decks is None else clusters[:max_decks]):
        cards = cl["best_cards"]
        a = arch(cards) if arch else ""
        row = {
            "count": cl["count"],
            "prob": (cl["count"] / denominator) if denominator else 0.0,
            "archetype": a,
            "deckName": deck_label(cards, a),
        }
        row.update(_arranged(cards, marks(cards) if marks else None))
        out.append(row)
    return out


# --------------------------------------------------------------------------
# Loadouts — duel_stats.observed_duel_loadout / pick_duel_legal_sequence
# --------------------------------------------------------------------------

def observed_duel_loadout(series_decks: list[list[list[str]]],
                          opener_cards: list[str]):
    """This player's REAL three-deck loadout for an opener, from one series.

    Returns `(opener_as_played, [deck2, deck3], times_seen)` or None. Preferred
    over predicting the companions because for ~85% of opener rows the player
    has a full 3-game series that used that deck — so the answer is observed
    rather than inferred, and it is card-legal by construction: all three decks
    came from one series, and a series with repeated cards is not a duel.

    The opener comes back AS PLAYED, not as the cluster representative. The rep
    is a sibling variant, and pairing it with another series' companions is
    exactly what produces a "loadout" that shares cards with itself.
    """
    groups: dict[tuple, int] = {}
    reps: dict[tuple, tuple] = {}
    for decks in series_decks:
        if len(decks) < 3:
            continue                       # no full loadout on show
        hit = next((i for i, d in enumerate(decks)
                    if decks_match(d, opener_cards)), None)
        if hit is None:
            continue
        others = [d for i, d in enumerate(decks) if i != hit][:2]
        if len(others) < 2:
            continue
        key = tuple(sorted(",".join(sorted(d)) for d in others))
        groups[key] = groups.get(key, 0) + 1
        reps.setdefault(key, (decks[hit], others))
    if not groups:
        return None
    key = max(sorted(groups), key=lambda k: groups[k])
    played, others = reps[key]
    return played, others, groups[key]


def pick_duel_legal_sequence(revealed_decks: list[list[str]],
                             deck_dicts: list[dict], want: int = 2) -> list[dict]:
    """Greedily pick `want` companions forming a LEGAL loadout — zero cards
    shared with the revealed deck(s) or with each other.

    The bot's prediction pages used to take the top two candidates
    independently, and 76% of the rendered triples were impossible: two decks
    sharing cards, sometimes the opener predicted as its own companion.
    Returning fewer than `want` is correct and happens (measured: 4% of rows) —
    one real companion beats an invented pair.
    """
    used: set[str] = set()
    for r in revealed_decks:
        used |= set(r)
    out: list[dict] = []
    for d in deck_dicts:
        cards = set(d["cards"])
        if cards & used:
            continue
        out.append(d)
        used |= cards
        if len(out) >= want:
            break
    return out


def rank_companions_by_series(deck_dicts: list[dict],
                              series_decks: list[list[list[str]]],
                              revealed_decks: list[list[str]],
                              co_weight: int = CO_WEIGHT) -> list[dict]:
    """Re-rank companions by CO-OCCURRENCE with what was revealed.

    Clustering alone ranks by overall play count, which makes every answer the
    same regardless of the opener — the player's two most-played decks. On the
    bot's sequence page that printed the SAME pair on 63% of rows. A deck that
    actually appeared in a series alongside the revealed deck is direct evidence
    of the loadout, so it counts `co_weight` appearances anywhere else.

    `coRevealed` is returned because the UI must show it: the ranking is driven
    by it, and without it the list looks mis-sorted against the usage figures.
    """
    if not revealed_decks or not series_decks:
        return deck_dicts
    scored = []
    for d in deck_dicts:
        cards = d["cards"]
        co = 0
        for decks in series_decks:
            if not any(decks_match(x, r) for x in decks for r in revealed_decks):
                continue                   # this series never featured the reveal
            if any(decks_match(x, cards) for x in decks):
                co += 1
        d["coRevealed"] = co
        scored.append((co_weight * co + d.get("count", 0), co,
                       ",".join(sorted(cards)), d))
    # Deterministic to the last field: ties on score AND co-occurrence break on
    # the deck signature, never on the order the clusterer happened to emit.
    scored.sort(key=lambda e: (-e[0], -e[1], e[2]))
    return [d for _, _, _, d in scored]


def predict_companions(player_decks: list[list[str]],
                       series_decks: list[list[list[str]]],
                       revealed: list[list[str]], arch=None,
                       marks=None) -> list[dict]:
    """The companion pool for a set of revealed decks — bot.predict_duel_decks.

    A duel forces all three decks to use distinct cards, so once the revealed
    cards are excluded the remaining pool is genuinely predictable. Only the
    deck ranking is ported; the bot's separate card-odds and archetype-odds
    tables belong to `!predict2`, which is a different screen.
    """
    revealed_sets = [set(d) for d in revealed]
    companions = [
        deck for deck in player_decks
        if all(len(set(deck) & rs) <= PREDICT_COMPANION_MAX_SHARED
               for rs in revealed_sets)
    ]
    if not companions:
        return []
    decks = cluster_player_decks(companions, PREDICT_COMPANION_POOL,
                                 len(companions), arch, marks)
    return rank_companions_by_series(decks, series_decks, revealed)


# --------------------------------------------------------------------------
# Describing a finished duel — duel_split.infer_format / duel_stats caption
# --------------------------------------------------------------------------

def infer_format(n_games: int) -> str:
    """"bo3" or "bo5", decided ONLY by a 4th game.

    "Someone reached 3 wins" is not evidence: a Bo3 decided 2-0 whose dead third
    game gets played out reaches 3-0 in three games and is still a Bo3. Only a
    4th game is impossible under Bo3. Real Bo5 is ~0.3% of this data.
    """
    return "bo5" if n_games >= 4 else "bo3"


def duel_score_caption(player_wins, opponent_wins, n_games: int) -> str:
    """A short phrase for HOW a duel was won or lost. The score is never
    rewritten — a 2-0 stays 2-0; this only names the shape of the result.

    `None` wins mean the score is unverified and the caption is empty, which is
    distinct from a real scoreless tie ("NO RESULT").
    """
    if player_wins is None or opponent_wins is None:
        return ""
    hi, lo = max(player_wins, opponent_wins), min(player_wins, opponent_wins)
    margin = hi - lo
    if player_wins == opponent_wins:
        if player_wins == 0:
            return "NO RESULT"
        return "UNFINISHED" if n_games <= 2 else "DEAD EVEN"
    won = player_wins > opponent_wins
    if lo == 0:
        # A sweep stopped at 2-0 was decided and left there; one played out to
        # 3-0 was finished for the third deck. Different stories.
        if n_games <= 2:
            return "CLEAN SWEEP" if won else "SWEPT ASIDE"
        return "FLAWLESS" if won else "SHUT OUT"
    if margin == 1:
        return "EDGED IT" if won else "SO CLOSE"
    if margin == 2:
        return "IN CONTROL" if won else "OUTPLAYED"
    return "WON" if won else "LOST"


# --------------------------------------------------------------------------
# Building the series log
# --------------------------------------------------------------------------

def _iso(stamp: str) -> str:
    """`20260810T143000.000Z` -> `2026-08-10T14:30:00Z`, for the browser."""
    try:
        t = dx._parse_ts(stamp)
    except Exception:
        return stamp
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _deck_view(cards: list[str], evo_raw: str | None) -> dict:
    """One deck as the UI draws it: arranged into slots, with its art.

    The same path every other screen takes — `arrange_deck` decides the order
    and the art falls out of the arrangement, and a deck whose payload carried
    no marks is flagged `artInferred` so the UI can say so rather than implying
    the evolutions were observed.
    """
    return _arranged(cards, dx._evo_marks(evo_raw, cards[:dx.DECK_SIZE]))


def _arranged(cards: list[str], observed: dict | None) -> dict:
    """Arrange a deck into its slots and say what art each one draws.

    THE SINGLE PATH for every deck this app draws, series log and sequence board
    alike. `arrange_deck` decides the ORDER as well as the art, so a deck that
    skips it renders its cards in a different order AND with no evolution or
    hero art — which is exactly how the sequence board and the series log ended
    up disagreeing about the same deck.

    A deck whose payload carried no marks is flagged `artInferred`, so the UI
    can say the variant came from slot position rather than from the payload.
    """
    deck = cards[:dx.DECK_SIZE]
    ordered, art = cd.arrange_deck(deck, observed or {})
    view = {"cards": ordered, "avgElixir": _avg_elixir(ordered)}
    if art:
        view["art"] = art
        if not observed:
            view["artInferred"] = True
    return view


def _opponent_view(rec: dict) -> dict:
    """The deck the player was facing, drawn the same way their own is.

    `rec["opp_evo"]` is the opponent's marks in the same shape as the player's,
    so this is `_deck_view` with the other side's columns — same slot rules,
    same evolution/hero resolution, same `artInferred` flag when the payload
    carried nothing. Rendering the opponent plain while the player is drawn with
    evolutions would make the two strips in one row incomparable, which is the
    whole reason the row shows both.
    """
    view = _deck_view(rec["opp_cards"], rec.get("opp_evo"))
    view["archetype"] = rec["opp_archetype"]
    view["deckName"] = deck_label(view["cards"], rec["opp_archetype"])
    return view


def build_series(rows: list[dict], arch=None) -> list[dict]:
    """Every duel in these rows, newest first.

    TWO SOURCES, ONE SHAPE, exactly as `DuelEngine.extract` merges them:

    * a NATIVE duel is one row carrying the whole loadout (16 or 24 cards), so
      the decks are read rather than inferred — but the row stores only the
      duel's own result, so there is no per-game score to report and the
      caption is left empty rather than invented;
    * friendly practice stores one row per game, so the series is rebuilt with
      the measured `duel_split` rules and every game keeps its own result.
    """
    out: list[dict] = []

    practice: list[dict] = []
    for r in rows:
        if not dx.is_native_duel(r["mode"]):
            practice.append(r)
            continue
        cards = r["cards"]
        n = min(dx.SLOTS, len(cards) // dx.DECK_SIZE)
        if n < 1:
            continue
        games = []
        for i in range(n):
            deck = cards[i * dx.DECK_SIZE:(i + 1) * dx.DECK_SIZE]
            g = _deck_view(deck, r["evo"])
            # A native row stores ONE win condition for a loadout of three
            # decks, so the row's own column cannot describe deck 2 or 3. Each
            # deck is looked up by its cards instead.
            a = arch(deck) if arch else ""
            g.update({"slot": i, "result": None, "archetype": a,
                      "deckName": deck_label(deck, a), "opponent": None})
            games.append(g)
        out.append({
            "id": f"{r['battle_time']}|{r['opponent_tag']}",
            "startTime": _iso(r["battle_time"]),
            "opponentTag": r["opponent_tag"],
            "opponentName": r["opponent_name"] or r["opponent_tag"],
            "source": "native",
            "format": infer_format(n),
            "games": games,
            # The loadout is known; the per-game scoreline is not stored.
            "playerWins": None,
            "opponentWins": None,
            "caption": duel_score_caption(None, None, n),
            "won": r["result"] == "win",
            "scoreKnown": False,
        })

    for chunk in dx.group_chunks(practice):
        for series in dx.split_chunk(chunk):
            pw = sum(1 for g in series if g["result"] == "win")
            ow = sum(1 for g in series if g["result"] == "loss")
            games = []
            for i, rec in enumerate(series):
                g = _deck_view(rec["cards"], rec["evo"])
                g.update({
                    "slot": i,
                    "result": rec["result"] or "",
                    "playerCrowns": rec["crowns"],
                    "opponentCrowns": rec["opp_crowns"],
                    "archetype": rec["archetype"],
                    "deckName": deck_label(g["cards"], rec["archetype"]),
                    # THE OPPONENT'S DECK GOES THROUGH `_deck_view` TOO, so it
                    # is arranged into its slots and wears its evolution and
                    # hero art exactly as the player's does. `opponent_evo`
                    # carries the same [card, level, art] triples as
                    # `player_evo`, so there is no second reading of the marks
                    # here — one function decides for both sides, which is the
                    # only way the two strips in a row can be compared.
                    "opponent": _opponent_view(rec) if rec["opp_cards"] else None,
                })
                games.append(g)
            first = series[0]
            out.append({
                "id": f"{first['battle_time']}|{first['opponent_tag']}",
                "startTime": _iso(first["battle_time"]),
                "endTime": _iso(series[-1]["battle_time"]),
                "opponentTag": first["opponent_tag"],
                "opponentName": first["opponent_name"] or first["opponent_tag"],
                "source": "reconstructed",
                "format": infer_format(len(series)),
                "games": games,
                "playerWins": pw,
                "opponentWins": ow,
                "caption": duel_score_caption(pw, ow, len(series)),
                "won": pw > ow,
                "scoreKnown": True,
            })

    out.sort(key=lambda s: s["startTime"], reverse=True)
    return out


# --------------------------------------------------------------------------
# The sequence board — pdf_duel_pages.sequence_data
# --------------------------------------------------------------------------

def _named_deck(cards: list[str], arch=None, seen: int | None = None,
                marks=None) -> dict:
    """A deck as the sequence board lists it — archetype resolved, slots
    arranged and art applied, the same as a deck in the series log."""
    a = arch(cards) if arch else ""
    out = {"archetype": a, "deckName": deck_label(cards, a)}
    out.update(_arranged(cards, marks(cards) if marks else None))
    if seen is not None:
        out["seen"] = seen
    return out


def sequence_entries(series_decks: list[list[list[str]]], arch=None,
                     marks=None) -> dict:
    """For each deck this player opens with, the two that follow.

    The order is the bot's and each step exists because the step before it was
    not enough on its own:

      1. cluster every duel deck they played, so variants of one deck are one
         opener rather than six;
      2. drop openers that are near-duplicates of an earlier one — merging, not
         hiding: two lists five cards apart are one deck said twice;
      3. rank by usage — the deck played 30 times is the one to prepare for;
      4. per opener, take the OBSERVED loadout if a real series shows one, and
         only otherwise predict companions and filter them for legality.

    EVERY opener in the window is listed. The bot drops those played once
    (`count >= 2`) because it is filling a fixed page; here the count is printed
    beside each row, so a one-off can be shown and judged instead of hidden.
    """
    all_decks = [d for decks in series_decks for d in decks]
    if not all_decks:
        return {"entries": [], "nGames": 0, "observed": 0, "lowConfidence": True}

    openers = cluster_player_decks(all_decks, SEQ_MAX_OPENERS, len(all_decks),
                                   arch, marks)

    unique: list[dict] = []
    for o in openers:
        cards = set(o["cards"])
        if any(len(cards & set(k["cards"])) >= PREDICT_DUP_OVERLAP for k in unique):
            continue
        unique.append(o)
    unique = sorted(unique, key=lambda o: (-o["count"],
                                           ",".join(sorted(o["cards"]))))
    if SEQ_MAX_ROWS is not None:
        unique = unique[:SEQ_MAX_ROWS]

    entries = []
    for op in unique:
        obs = observed_duel_loadout(series_decks, op["cards"])
        if obs:
            played, others, seen = obs
            shown = dict(op)
            # AS PLAYED, not the cluster rep — the companions came from the
            # series this exact deck was in. Re-arranged for the same reason
            # every other deck is: the order and the art come together.
            shown.update(_arranged(played, marks(played) if marks else None))
            shown["deckName"] = deck_label(played, shown["archetype"])
            entries.append({
                "opener": shown,
                "source": "observed",
                "seen": seen,
                "next": [_named_deck(d, arch, seen, marks) for d in others],
            })
            continue
        pool = predict_companions(all_decks, series_decks, [op["cards"]], arch,
                                  marks)
        nxt = pick_duel_legal_sequence([op["cards"]], pool, want=2)
        if nxt:
            entries.append({"opener": op, "source": "predicted", "next": nxt})

    return {
        "entries": entries,
        "nGames": len(all_decks),
        "observed": sum(1 for e in entries if e["source"] == "observed"),
        "lowConfidence": len(all_decks) < PREDICT_MIN_DUEL_GAMES,
    }


# --------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------

def report(tag: str, since: str | None = None, until: str | None = None,
           limit: int | None = SERIES_LIMIT) -> dict:
    """Both Duel Zone windows, from one read of the databases."""
    rows, archive_used = dx.read_duel_rows(tag, since, until)

    # Archetypes are READ, not recomputed. `player_win_condition` was written by
    # the bot's own `get_win_condition`, so taking it from the row keeps one
    # definition of an archetype instead of a second one over here that would
    # quietly disagree on some deck nobody checked.
    arch_by_sig: dict[str, str] = {}
    for r in rows:
        if r["archetype"]:
            arch_by_sig.setdefault(",".join(sorted(r["cards"][:dx.DECK_SIZE])),
                                   r["archetype"])

    def arch(cards) -> str:
        return arch_by_sig.get(",".join(sorted(cards)), "")

    # The same lookup for the payload's evolution/hero marks. The sequence board
    # shows decks pulled out of the series rather than out of a row, so without
    # this it had no marks at all — every card drew plain, and the same deck
    # rendered one way in the log and another on the board.
    marks_by_sig: dict[str, dict] = {}
    for r in rows:
        if not r["evo"]:
            continue
        for i in range(max(1, len(r["cards"]) // dx.DECK_SIZE)):
            deck = r["cards"][i * dx.DECK_SIZE:(i + 1) * dx.DECK_SIZE]
            if len(deck) < dx.DECK_SIZE:
                continue
            m = dx._evo_marks(r["evo"], deck)
            if m:
                marks_by_sig.setdefault(",".join(sorted(deck)), m)

    def marks(cards) -> dict:
        return marks_by_sig.get(",".join(sorted(cards[:dx.DECK_SIZE])), {})

    series = build_series(rows, arch)
    series_decks = [[g["cards"] for g in s["games"]] for s in series]

    games = sum(len(s["games"]) for s in series)
    wins = sum(1 for s in series for g in s["games"] if g["result"] == "win")

    return {
        "series": series if limit is None else series[:limit],
        "sequence": sequence_entries(series_decks, arch, marks),
        "summary": {
            "duels": len(series),
            "native": sum(1 for s in series if s["source"] == "native"),
            "reconstructed": sum(1 for s in series if s["source"] == "reconstructed"),
            "games": games,
            "wins": wins,
            "shown": len(series) if limit is None else min(limit, len(series)),
            "archiveUsed": archive_used,
        },
    }
