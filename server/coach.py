"""coach.py — Coach Assist: what they will bring, and what you should answer with.

Two windows, both ported from the bot's duel advisor:

    Duel Prediction   !predict / !predict2 / !predict3
                      one tag. Which decks this player opens with, and — given
                      what they have already shown this duel — what is left.

    Suggestion        !suggestion #YOURTAG [#OPPONENTTAG]
                      two tags. The same read, then MY still-legal decks ranked
                      by expected win rate against their predicted deck.

────────────────────────────────────────────────────────────────────────────
THE RULE THE WHOLE FILE RESTS ON
────────────────────────────────────────────────────────────────────────────

A duel loadout is three decks that **cannot share a card**. That is what makes
any of this predictable: every deck revealed removes eight cards from what the
player can still bring, and by game 3 the field is usually down to a handful of
lists they actually own. Nothing here is a personality model — it is the card
constraint plus that player's own history.

`duel_zone` already ports the deck-ranking half of this (`predict_companions`,
`observed_duel_loadout`, `pick_duel_legal_sequence`, `rank_companions_by_series`)
for its sequence board, and it is imported rather than re-implemented. What this
module adds is the parts that belong to the interactive commands: the OPENING
distribution, the per-card and per-archetype odds, and the recommendation.

────────────────────────────────────────────────────────────────────────────
WHERE THE MODEL IS OURS, AND WHY IT IS BETTER HERE
────────────────────────────────────────────────────────────────────────────

The bot scores a candidate with a trained gradient-boosted matchup model loaded
from artifacts on disk (`archetype_predictor`, `tree_runtime`), and falls back
to nothing when the artifacts are missing. That is not portable into a
stdlib-only service, and it should not be: this project already has a better
grounded answer for the same question in `deck_counter`, and it is the one the
Deck Counter screen shows.

So expected win rate comes off the evidence ladder — exact pair, then this exact
list against that archetype, then lists one and two cards different, then
archetype against archetype — and **every number carries the rung it came
from**. Two consequences worth stating:

  * it is card-sensitive. Swap one card in your Hog deck and the deck hash
    changes, so a different set of battles is counted. A trained archetype model
    cannot do that; it returns the same figure for every Hog list.
  * it is symmetrised. `deck_counter._symmetric` cancels the 58.6% tracked-player
    bias, checked by every mirror landing at exactly 50.0%. An unsymmetrised
    table makes everything look like a counter.

────────────────────────────────────────────────────────────────────────────
WHAT IS DELIBERATELY NOT MODELLED
────────────────────────────────────────────────────────────────────────────

Counter-sniping. It is the obvious feature — "they just showed Hog, so they will
bring the anti-Hog deck next" — and the bot measured it on 3,569 leak-free
trials: it made top-1 accuracy three times WORSE (8.3% -> 2.7%). The deck a
player actually brings scores 0.4856 against the opponent's last deck, versus
0.4961 for the average deck they could have brought. Players do not counter-pick
the previous game. Recency weighting and per-opponent tendency were tested the
same way and neither beat plain usage.

So this narrates evidence and never invents a tendency to read.
"""

from __future__ import annotations

import os
import sys
import threading
import time

import clash_data as cd
import deck_counter as counter
import duel_combos as dx
import duel_zone as dz
import meta as meta_board

# ── PORTED CONSTANTS ───────────────────────────────────────────────────────
# Names match the bot's so the two can be diffed. Where a value is ours it says
# so and says why.

#: Ordered series needed before openings are ranked by game-1 history rather
#: than by overall duel play rate. (bot.PREDICT_MIN_FIRST_SERIES)
MIN_FIRST_SERIES = 3

#: How many opening decks are listed. (bot.PREDICT_FIRST_MAX_DECKS)
FIRST_MAX_DECKS = 6

#: Cards and archetypes in the odds tables. (bot.PREDICT_TOP_CARDS / _ARCHETYPES)
TOP_CARDS = 8
TOP_ARCHETYPES = 4

#: Companion decks offered per prediction. (bot.PREDICT_TOP_DECKS)
TOP_DECKS = 3

#: Opponent candidates scored, and recommendations shown.
#: (bot.SUGGEST_OPP_TOP_DECKS / SUGGEST_MY_TOP_DECKS)
OPP_TOP_DECKS = 3
MY_TOP_DECKS = 3

#: When a player's own history is too thin to fill the candidate list, meta
#: decks top it up — but their history keeps this much of the probability mass,
#: so a thin read never collapses into one overconfident guess.
#: (bot.OPP_HISTORY_MASS)
OPP_HISTORY_MASS = 0.7

#: Duel games before a prediction is presented without a warning.
#: (bot.PREDICT_MIN_DUEL_GAMES, same as duel_zone's)
MIN_DUEL_GAMES = dz.PREDICT_MIN_DUEL_GAMES

#: Two decks are "the same deck" at this many shared cards — the bot's
#: COUNTER_MIN_OVERLAP, shared by !counter, the clusterer and the duel matcher.
MIN_OVERLAP = dz.COUNTER_MIN_OVERLAP

#: A recommendation must be LEGAL, which is stricter than a prediction. The
#: companion predictor tolerates two shared cards because it reads noisy
#: history; a deck we tell someone to play next must share ZERO with what they
#: have already used. The bot learned this by recommending a Golem deck that
#: repeated Lightning and Baby Dragon. (bot._duel_legal_decks)
RECOMMEND_MAX_SHARED = 0


# ── READING ONE PLAYER'S DUEL HISTORY ──────────────────────────────────────

#: A player's duel history costs ~6 s to read and is stable within a duel, but
#: BOTH WINDOWS ARE STEPWISE — the user answers "has it started", pastes deck 1,
#: then pastes deck 2, and each step asks the same question of the same tag.
#: Uncached that is 6 s per click. Short enough that a duel finishing mid-session
#: still picks up its own games on the next question. (bot's _HISTORY_TTL_SECONDS)
_HISTORY_TTL_S = 120.0
_HISTORY_CACHE: dict[str, tuple[float, dict]] = {}
_HISTORY_MAX = 32


def _history(tag: str, since: str | None = None, until: str | None = None) -> dict:
    """Everything both windows need about one player, from ONE database read.

    `read_duel_rows` is the single reader `duel_combos` and `duel_zone` already
    share, so the Coach cannot end up describing a different set of duels from
    the Duel Zone screen for the same player.

    ORDERED SERIES ARE NOT ALL SERIES, and the difference decides whether an
    opening can be ranked at all. A friendly/practice duel stores one row per
    game, so its order is real time order; a NATIVE duel stores the whole
    loadout in one row and the bot is explicit that those 8-card blocks are
    "not proven chronological" — block 1 is not necessarily game 1. Only
    reconstructed series can answer "what do they open with".

    Measured across the twelve most-played tags: 718 of 759 series (94.6%) are
    reconstructed and 587 are full ordered three-game series, so on this data
    the opening question is answerable for almost everybody. That is the
    opposite of the bot's situation and worth stating, because it is why the
    fallback below almost never fires.
    """
    key = f"{tag}|{since or ''}|{until or ''}"
    hit = _HISTORY_CACHE.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _HISTORY_TTL_S:
        return hit[1]

    rows, archive_used = dx.read_duel_rows(tag, since, until)

    # Archetypes and marks are READ from the rows, never recomputed — same
    # reasoning as duel_zone.report: a second classifier over here would
    # eventually disagree with the one every stored battle was labelled by.
    arch_by_sig: dict[str, str] = {}
    marks_by_sig: dict[str, dict] = {}
    for r in rows:
        if r["archetype"]:
            arch_by_sig.setdefault(",".join(sorted(r["cards"][:dx.DECK_SIZE])),
                                   r["archetype"])
        if not r["evo"]:
            continue
        for i in range(max(1, len(r["cards"]) // dx.DECK_SIZE)):
            deck = r["cards"][i * dx.DECK_SIZE:(i + 1) * dx.DECK_SIZE]
            if len(deck) < dx.DECK_SIZE:
                continue
            m = dx._evo_marks(r["evo"], deck)
            if m:
                marks_by_sig.setdefault(",".join(sorted(deck)), m)

    def arch(cards) -> str:
        return arch_by_sig.get(",".join(sorted(cards)), "") or counter.archetype_of(cards)

    def marks(cards) -> dict:
        return marks_by_sig.get(",".join(sorted(cards[:dx.DECK_SIZE])), {})

    series = dz.build_series(rows, arch)
    series_decks = [[g["cards"] for g in s["games"]] for s in series]
    all_decks = [g["cards"] for s in series for g in s["games"]]
    firsts = [s["games"][0]["cards"] for s in series
              if s["source"] == "reconstructed" and s["games"]]

    out = {
        "series": series,
        "seriesDecks": series_decks,
        "allDecks": all_decks,
        "firsts": firsts,
        "arch": arch,
        "marks": marks,
        "archiveUsed": archive_used,
    }
    if len(_HISTORY_CACHE) >= _HISTORY_MAX:
        _HISTORY_CACHE.clear()
    _HISTORY_CACHE[key] = (now, out)
    return out


def _player_name(tag: str) -> str:
    """Display name if the databases hold one, else the tag."""
    try:
        rep = cd.player_report(tag, None, None)
        if rep and rep.get("player", {}).get("name"):
            return rep["player"]["name"]
    except Exception:
        pass
    return tag


# ── WINDOW 1a: THE OPENING (!predict) ──────────────────────────────────────

def opening_decks(tag: str, hist: dict | None = None) -> dict:
    """Which decks this player is likely to OPEN a duel with, ranked.

    Prefers their real game-1 picks; falls back to overall duel play rate when
    there are too few ordered series, and SAYS WHICH via `basis`. That
    distinction is the whole honesty of the screen — "they open with this" and
    "they play this a lot" are different claims and only one of them is about
    game 1.
    """
    h = hist or _history(tag)
    if not h["allDecks"]:
        return {"decks": [], "basis": None, "nObs": 0, "nSeries": 0,
                "nGames": 0, "lowConfidence": True}

    if len(h["firsts"]) >= MIN_FIRST_SERIES:
        obs, basis = h["firsts"], "first-game history"
    else:
        obs, basis = h["allDecks"], "overall play rate"

    decks = dz.cluster_player_decks(obs, FIRST_MAX_DECKS, len(obs),
                                    h["arch"], h["marks"])
    return {
        "decks": decks,
        "basis": basis,
        "nObs": len(obs),
        "nSeries": len(h["series"]),
        "nGames": len(h["allDecks"]),
        "orderedSeries": len(h["firsts"]),
        # Two separate reasons to distrust the answer, and the UI says which.
        "lowConfidence": len(obs) < 4 or basis == "overall play rate",
    }


# ── WINDOW 1b: WHAT IS LEFT (!predict2 / !predict3) ────────────────────────

def _card_odds(decks: list[dict], limit: int = TOP_CARDS) -> list[dict]:
    """Which individual cards are most likely to appear next.

    Probability-weighted across the candidate decks rather than counted, so a
    card in the front-runner outranks a card in three long shots. This is the
    bot's `!predict2` card table, which `duel_zone` deliberately left out of the
    sequence board — that board answers "which decks", this screen answers
    "what will I be facing", and a card is the thing you actually play around.
    """
    total = sum(d.get("prob") or 0 for d in decks) or 1.0
    per: dict[str, float] = {}
    for d in decks:
        p = (d.get("prob") or 0) / total
        for c in d["cards"]:
            per[c] = per.get(c, 0.0) + p
    rows = [{"card": c, "prob": round(p, 4)} for c, p in per.items()]
    # Ties on probability are constant here (whole decks share a probability),
    # so the card key is the tiebreak — never dict order.
    rows.sort(key=lambda r: (-r["prob"], r["card"]))
    return rows[:limit]


def _archetype_odds(decks: list[dict], limit: int = TOP_ARCHETYPES) -> list[dict]:
    """The same, grouped by archetype — the shape of the game they will play."""
    total = sum(d.get("prob") or 0 for d in decks) or 1.0
    per: dict[str, float] = {}
    for d in decks:
        a = d.get("archetype") or "other"
        per[a] = per.get(a, 0.0) + (d.get("prob") or 0) / total
    rows = [{"archetype": a, "name": counter._label(a), "prob": round(p, 4)}
            for a, p in per.items()]
    rows.sort(key=lambda r: (-r["prob"], r["archetype"]))
    return rows[:limit]


#: How many real series to list. Enough to see a habit, few enough to read.
SEQUENCE_LIMIT = 6


def observed_sequences(revealed: list[list[str]], hist: dict,
                       limit: int = SEQUENCE_LIMIT) -> dict:
    """The series where they actually opened like this, and what came NEXT.

    Everything else on this screen ranks what they *could* bring. This does not
    rank anything: it goes back through their duel log, finds the series that
    began with the deck(s) just pasted, and reports the decks that followed **in
    game order**. Where it finds anything it is the strongest statement the
    screen can make, because it is not a prediction at all.

    ORDERED SERIES ONLY. A friendly/practice duel stores one row per game so its
    order is real time order; a native duel stores the whole loadout in one row
    and the bot records that those 8-card blocks are "not proven chronological".
    A sequence read off a native row would be an artefact of storage order, so
    those series are skipped and the count of what was searched is returned.

    MATCHED ANYWHERE IN THE LOADOUT, not anchored to game 1. An earlier version
    anchored, reasoning that "when they opened with this they followed it with
    that" is the sharper claim. It is, and it is also the wrong question: a
    coach pastes the deck they have just *seen*, which is game 2 as often as
    game 1. Measured over 40 decks these players really ran but not necessarily
    first, the anchor found 62 series and left **20 of the 40 showing nothing at
    all** — every one of which has a recorded loadout. Reported from the screen
    as "he has a duel set where he played this deck" against a blank panel, and
    that is exactly what it was.

    NATIVE DUELS COUNT HERE, which is the other half of the same correction.
    A native row stores the whole three-deck loadout in one row; the bot records
    only that its 8-card blocks are "not proven chronological". That makes the
    ORDER unusable, not the membership — and membership is most of the answer,
    because a loadout is three decks that go together. Those series are included
    and flagged `ordered: false` so the UI can say the sequence is unknown
    rather than invent one.

    Deck identity is the project's usual 6-of-8 (`decks_match`), so a tech swap
    is the same deck; each row says whether it was an exact list or a variant,
    since "they have literally run this" and "they have run something like this"
    are worth telling apart.
    """
    if not revealed or not hist.get("series"):
        return {"loadouts": [], "nextDecks": [], "matched": 0, "ordered": 0,
                "searched": 0, "searchedFor": len(revealed)}

    depth = len(revealed)
    hits = []
    others: list[list[str]] = []
    searched = 0

    def view(g, i, revealed_here):
        a = hist["arch"](g["cards"])
        return dz._arranged(g["cards"], hist["marks"](g["cards"])) | {
            "game": i + 1,
            "archetype": a,
            "deckName": dz.deck_label(g["cards"], a),
            # Empty on a native row — it stores the duel's result, not each
            # game's — and the UI simply omits the badge rather than guessing.
            "result": g.get("result") or "",
            "revealed": revealed_here,
        }

    for s in hist["series"]:
        games = s["games"]
        if len(games) <= depth:
            continue                      # nothing beyond the reveal to show
        searched += 1
        is_ordered = s["source"] == "reconstructed"
        cards = [g["cards"] for g in games]

        # Which slots the pasted decks occupy. Consecutive and in order when the
        # series is ordered; anywhere, one slot each, when it is not.
        idx: list[int] = []
        if is_ordered:
            for start in range(len(cards) - depth + 1):
                if all(dz.decks_match(cards[start + i], revealed[i]) for i in range(depth)):
                    idx = list(range(start, start + depth))
                    break
        else:
            used: set[int] = set()
            for r in revealed:
                hit = next((j for j, c in enumerate(cards)
                            if j not in used and dz.decks_match(c, r)), None)
                if hit is None:
                    idx = []
                    break
                used.add(hit)
                idx.append(hit)
        if len(idx) != depth:
            continue

        marked = set(idx)
        exact = all(sorted(cards[idx[i]]) == sorted(revealed[i]) for i in range(depth))
        others.extend(c for j, c in enumerate(cards) if j not in marked)

        hits.append({
            "when": s["startTime"],
            "opponentName": s.get("opponentName") or "",
            "format": s.get("format"),
            "caption": s.get("caption") or "",
            "won": s.get("won"),
            "exact": exact,
            "ordered": is_ordered,
            # Where in the duel they were seen with it — "they opened with this"
            # and "they answered with it in game 3" are different reads.
            "position": idx[0] + 1 if is_ordered else None,
            "games": [view(g, i, i in marked) for i, g in enumerate(games)],
        })

    # Newest first — a habit from last week beats one from three months ago,
    # and the reader can see the date to judge that for themselves.
    hits.sort(key=lambda h: h["when"], reverse=True)

    # The decks that travel WITH it, merged so a tech swap counts once.
    companions = dz.cluster_player_decks(others, TOP_DECKS, len(others),
                                         hist["arch"], hist["marks"]) if others else []

    return {
        "loadouts": _cluster_loadouts(hits, hist, limit),
        "nextDecks": companions,
        "matched": len(hits),
        # How many of the matches have a usable game order. The rest are native
        # rows: real loadouts whose sequence was never recorded.
        "ordered": sum(1 for h in hits if h["ordered"]),
        "searched": searched,
        "searchedFor": depth,
    }


def _cluster_loadouts(hits: list[dict], hist: dict, limit: int) -> list[dict]:
    """Group the matching series into WHOLE LOADOUTS, ranked by how often.

    A duel is not three independent picks, it is one three-deck loadout that a
    player builds, registers and reuses. So the useful answer to "he opened with
    this" is not a list of individual games and not a ranking of loose
    candidates — it is *the rest of the loadout, in order*: play this, then
    this. Anything else makes the reader reassemble the triple themselves from
    rows that were never separate to begin with.

    Series are clustered position by position at the same 6-of-8 rule the rest
    of the project uses, so a tech swap in game 2 does not split one habit into
    two. Each group reports how many times it was run and how those duels went,
    which is the difference between "they do this" and "they do this and it
    works".

    The representative for each position is the group's most-played EXACT
    variant, never a synthetic average — the same rule `cluster_player_decks`
    follows, and for the same reason: a deck that was never played is not a deck
    they can bring.
    """
    groups: list[dict] = []
    for h in hits:
        seq = [g["cards"] for g in h["games"]]
        for gr in groups:
            if len(gr["seq"]) == len(seq) and all(
                    dz.decks_match(gr["seq"][i], seq[i]) for i in range(len(seq))):
                gr["hits"].append(h)
                break
        else:
            groups.append({"seq": seq, "hits": [h]})

    out = []
    for gr in groups:
        members = gr["hits"]
        length = len(gr["seq"])

        def rep(index: int, members=members) -> list[str]:
            """The most-played exact list at this position in the loadout."""
            tally: dict[str, list] = {}
            for m in members:
                cards = m["games"][index]["cards"]
                sig = ",".join(sorted(cards))
                e = tally.setdefault(sig, [cards, 0])
                e[1] += 1
            # sorted() first so ties break on the signature — identical evidence
            # must always render the identical loadout.
            best = max(sorted(tally), key=lambda s: tally[s][1])
            return tally[best][0]

        games = []
        for i in range(length):
            cards = rep(i)
            a = hist["arch"](cards)
            games.append(dz._arranged(cards, hist["marks"](cards)) | {
                "game": i + 1,
                "archetype": a,
                "deckName": dz.deck_label(cards, a),
                # The deck that matched the paste is context; the rest are the
                # answer. The UI draws them differently and needs to know.
                "revealed": members[0]["games"][i]["revealed"],
                "result": members[0]["games"][i]["result"] if len(members) == 1 else "",
            })

        wins = sum(1 for m in members if m["won"])
        out.append({
            "times": len(members),
            "wins": wins,
            "losses": len(members) - wins,
            "lastSeen": max(m["when"] for m in members),
            "seenOn": sorted((m["when"] for m in members), reverse=True)[:6],
            # True only if every member matched the paste card-for-card.
            "exact": all(m["exact"] for m in members),
            # False as soon as ONE member is a native row: the decks are real,
            # the sequence is not recorded, and the UI must say so.
            "ordered": all(m["ordered"] for m in members),
            "position": members[0]["position"] if all(m["ordered"] for m in members) else None,
            "games": games,
        })

    # Stable sorts, least significant first: most-run loadout wins, a tie goes
    # to whichever was played most recently, and a tie on both breaks on the
    # deck signature so the order never depends on dict iteration.
    out.sort(key=lambda g: ",".join(sorted(g["games"][-1]["cards"])))
    out.sort(key=lambda g: g["lastSeen"], reverse=True)
    out.sort(key=lambda g: g["times"], reverse=True)
    return out[:limit]


def next_decks(tag: str, revealed: list[list[str]],
               hist: dict | None = None) -> dict:
    """What this player can still bring, given the decks they have shown.

    `revealed` is the decks already played this duel, in order. One entry
    predicts game 2, two entries predict game 3.

    The candidate pool comes from `duel_zone.predict_companions`, which excludes
    anything overlapping the reveal and then re-ranks by CO-OCCURRENCE with it —
    a deck seen in the same series as the revealed deck is direct evidence of
    the loadout, and ranking on overall play count alone printed the same pair
    on 63% of the bot's rows.

    `observedLoadout` is the strongest thing this screen can say and is reported
    separately: for ~85% of openers the player has a full three-game series that
    used that deck, so the rest of the loadout is a FACT rather than a ranking.
    """
    h = hist or _history(tag)
    revealed = [list(d) for d in revealed if d]

    if not h["allDecks"]:
        return {"decks": [], "cards": [], "archetypes": [], "observedLoadout": None,
                "nGames": 0, "lowConfidence": True, "revealed": []}

    decks = dz.predict_companions(h["allDecks"], h["seriesDecks"], revealed,
                                  h["arch"], h["marks"])
    # Renormalised over the candidates, not over all their duel decks: the
    # question is "which of these", and a column that sums to 23% reads as an
    # error even when each figure is individually defensible.
    total = sum(d.get("count") or 0 for d in decks) or 1
    for d in decks:
        d["prob"] = (d.get("count") or 0) / total

    shown = decks[:TOP_DECKS]
    observed = None
    if revealed:
        seen = dz.observed_duel_loadout(h["seriesDecks"], revealed[0])
        if seen:
            _played, others, times = seen
            observed = {
                "times": times,
                "decks": [dz._arranged(d, h["marks"](d)) | {
                    "archetype": h["arch"](d),
                    "deckName": dz.deck_label(d, h["arch"](d)),
                } for d in others],
            }

    return {
        "decks": shown,
        "cards": _card_odds(shown),
        "archetypes": _archetype_odds(shown),
        "observedLoadout": observed,
        # What they REALLY played after this, in game order, from the duel log.
        "history": observed_sequences(revealed, h),
        "nCandidates": len(decks),
        "nGames": len(h["allDecks"]),
        "nSeries": len(h["series"]),
        "lowConfidence": len(h["allDecks"]) < MIN_DUEL_GAMES,
        "revealed": [dz._arranged(d, h["marks"](d)) | {
            "archetype": h["arch"](d),
            "deckName": dz.deck_label(d, h["arch"](d)),
        } for d in revealed],
    }


# ── WINDOW 2: THE RECOMMENDATION (!suggestion) ─────────────────────────────

def _legal(decks: list[dict], used: set) -> list[dict]:
    """Only decks sharing ZERO cards with what has been played.

    Stricter than the prediction pool on purpose — see RECOMMEND_MAX_SHARED.
    """
    if not used:
        return list(decks)
    return [d for d in decks if len(set(d["cards"]) & used) <= RECOMMEND_MAX_SHARED]


def _population_decks(limit: int = 24) -> list[dict]:
    """Meta decks, for a player whose own history cannot fill the list.

    The board is a snapshot that exists either way, its decks are lists real
    players are running this week, and its evolution/hero art is already
    resolved — so a filled row renders exactly like a personal one.
    """
    try:
        board = meta_board.board()
    except Exception:
        return []
    out = []
    for d in (board.get("decks") or [])[:limit]:
        out.append({
            "cards": d["cards"], "art": d.get("art") or {},
            "archetype": d.get("archetype") or _archetype(d["cards"]),
            "deckName": d.get("name") or "",
            "avgElixir": d.get("avgElixir"),
            "count": max(1, int((d.get("useRate") or 0) * 100)),
            "fill": True,
        })
    return out


def _fills(existing: list[dict], used: set, need: int) -> list[dict]:
    """Meta decks to top up a thin list, skipping variants of what is already
    there — three near-identical Hog lists is one suggestion, not three."""
    if need <= 0:
        return []
    out = []
    seen = [set(d["cards"]) for d in existing]
    for d in _legal(_population_decks(), used):
        s = set(d["cards"])
        if any(len(s & e) >= MIN_OVERLAP for e in seen):
            continue
        out.append(dict(d))
        seen.append(s)
        if len(out) >= need:
            break
    return out


def opponent_next(opp_tag: str, opp_played: list[list[str]],
                  hist: dict | None = None) -> dict:
    """The opponent's likely next deck, as a distribution over legal decks.

    Their own history when there is any, meta decks otherwise, and a labelled
    blend when the history is thin. `OPP_HISTORY_MASS` keeps 70% of the mass on
    what they have actually shown, so topping up never turns a two-deck read
    into a confident five-deck one.
    """
    used = set().union(*[set(d) for d in opp_played]) if opp_played else set()
    candidates: list[dict] = []
    source = "population"

    if opp_tag:
        h = hist or _history(opp_tag)
        if h["allDecks"]:
            pool = (next_decks(opp_tag, opp_played, h)["decks"] if opp_played
                    else opening_decks(opp_tag, h)["decks"])
            legal = _legal(pool, used)
            if legal:
                candidates, source = legal, "opponent-history"

    if not candidates:
        candidates = _legal(_population_decks(), used)

    top = [dict(d) for d in candidates[:OPP_TOP_DECKS]]
    fills = []
    if source == "opponent-history" and len(top) < OPP_TOP_DECKS:
        fills = _fills(top, used, OPP_TOP_DECKS - len(top))
        if fills:
            source = "opponent-history+population"

    mass = OPP_HISTORY_MASS if fills else 1.0
    total = sum(d.get("count") or 1 for d in top) or 1
    for d in top:
        d["prob"] = mass * (d.get("count") or 1) / total
    ftotal = sum(d.get("count") or 1 for d in fills) or 1
    for d in fills:
        d["prob"] = (1.0 - mass) * (d.get("count") or 1) / ftotal

    return {"decks": top + fills, "source": source,
            "nCandidates": len(candidates) + len(fills)}


def win_prob(mine: list[str], theirs: list[str], snap) -> dict | None:
    """P(my deck beats theirs), on the best evidence there is, with the rung.

    The same ladder the Deck Counter shows — exact pair, this list vs that
    archetype, lists one and two cards different, archetype vs archetype — but
    walked LAZILY and stopped at the first rung with evidence.

    That is not a micro-optimisation, it is the difference between a usable
    screen and an unusable one. `matchup_ladder` builds every rung because its
    caller displays the whole backoff, and the ≥7-card cluster scan costs
    **11.6 s cold** against 0.17 s for the deck's own profile. The Coach asks
    for a whole grid of these — up to six of my decks against three of theirs —
    so building rungs nobody will read took `suggest` to 25.7 s. Stopping at the
    first answer takes it to 1.4 s, and the answer is identical: the head of the
    ladder is the reading either way, and a deck with any real play has its own
    record long before the clusters are needed.
    """
    exact = counter.exact_pair(mine, theirs)
    if exact:
        return {"winRate": exact["winRate"], "games": exact["games"],
                "source": counter.SOURCE_EXACT, "tier": exact.get("tier"),
                "decks": 1}

    other = _archetype(theirs)
    m = counter.deck_profile(mine)["archetypes"].get(other)
    if m:
        return {"source": counter.SOURCE_DECK, "decks": 1, "winRate": m["winRate"],
                "games": m["games"], "tier": m.get("tier")}

    for overlap in counter.CLUSTER_LEVELS:
        prof = counter.cluster_profile(mine, overlap)
        m = prof["archetypes"].get(other)
        if m:
            return {"source": counter._CLUSTER_SOURCE[overlap],
                    "decks": prof["decks"], "winRate": m["winRate"],
                    "games": m["games"], "tier": m.get("tier")}

    if snap:
        m = counter._symmetric(snap, _archetype(mine), other)
        if m:
            return {"source": counter.SOURCE_ARCHETYPE, "decks": None,
                    "winRate": m["winRate"], "games": m["games"],
                    "tier": m.get("tier")}
    return None


#: `archetype_of` reads the stored deck row, so it is a query per call and the
#: Coach asks for the same handful of decks repeatedly across one request.
_ARCH_CACHE: dict[str, str] = {}


def _archetype(cards: list[str]) -> str:
    key = ",".join(sorted(cards))
    hit = _ARCH_CACHE.get(key)
    if hit is None:
        if len(_ARCH_CACHE) >= 512:
            _ARCH_CACHE.clear()
        hit = _ARCH_CACHE[key] = counter.archetype_of(cards)
    return hit


def _expected(mine: list[str], opp_decks: list[dict], snap) -> dict | None:
    """Expected win rate against the whole predicted distribution.

    Weighted by each opponent deck's probability rather than averaged, and the
    weights of decks with no evidence are dropped instead of being scored at
    50% — an invented coin flip pulls a real edge toward the middle and makes
    two genuinely different candidates look alike.
    """
    num = den = 0.0
    per = []
    for od in opp_decks:
        w = od.get("prob") or (1.0 / max(1, len(opp_decks)))
        m = win_prob(mine, od["cards"], snap)
        per.append({"cards": od["cards"], "prob": round(w, 4), "matchup": m})
        if m:
            num += w * m["winRate"]
            den += w
    if not den:
        return None
    return {"winRate": round(num / den, 1), "weight": round(den, 4), "per": per}


def _spread(opp_decks: list[dict]) -> tuple[list[str], dict[str, float]]:
    """The opponent's likely decks, collapsed to `(archetypes, weights)`.

    The tuner scores against ARCHETYPES because that is what `pair_matchup_agg`
    can answer for a deck neither player has played. Two of their decks sharing
    an archetype have their probabilities SUMMED rather than listed twice --
    the weight is how much of their play that archetype accounts for.
    """
    weights: dict[str, float] = {}
    for d in opp_decks:
        a = _archetype(d["cards"])
        weights[a] = weights.get(a, 0.0) + (d.get("prob") or 0.0)
    return sorted(weights, key=lambda a: -weights[a]), weights


def tune(my_deck: list[str], opp_decks: list[dict],
         used: set | None = None, hist: dict | None = None) -> dict | None:
    """Card-level swaps for one deck. See `DECK_TUNER.md`.

    OPT-IN AND ADMIN-ONLY at the route, because it costs a full sibling scan --
    the estimate is ~2.6 s and it has not been measured on the live database
    yet. It must never be added to the default Coach response.

    Imported INSIDE the function on purpose. `deck_tuner` reaches into
    `deck_counter`'s internals and `deck_harmony` loads three JSON files at
    import; a deployment missing either must cost this block and nothing else,
    which is the same rule the ops snapshot follows.
    """
    if not my_deck or len(set(my_deck)) != 8:
        return None
    try:
        import deck_tuner as tuner
        import deck_harmony as harmony
    except Exception as exc:  # pragma: no cover - deployment shape
        print("coach.tune: tuner unavailable: %r" % (exc,), file=sys.stderr)
        return None

    archetypes, weights = _spread(opp_decks)
    if not archetypes:
        return None

    # Cards the player has actually piloted in the window. A TIEBREAK, and the
    # result says so -- `team_analysis` calls its equivalent "not a model" and
    # this is the same claim.
    comfort = set()
    if hist and hist.get("allDecks"):
        for d in hist["allDecks"]:
            comfort.update(d)

    try:
        out = tuner.rank(my_deck, archetypes, weights=weights,
                         used=used or set(), comfort=comfort,
                         veto=harmony.veto)
    except Exception as exc:  # pragma: no cover - degradation
        print("coach.tune: %r" % (exc,), file=sys.stderr)
        return None

    # The structural reading of the deck as it stands, beside the swaps. A
    # reader owed "swap bomber for baby dragon" is also owed "because you have
    # one air answer", and that sentence comes from the checklist, not the
    # database.
    out["harmony"] = harmony.check(my_deck)
    out["weights"] = {a: round(w, 4) for a, w in weights.items()}

    # MODE B beside Mode A, because they answer different questions and a coach
    # wants both: "change this card" and "bring this deck instead". The
    # composer does NO database work -- its pool is the snapshot's seeds -- so
    # this costs almost nothing on top of the scan already paid for above.
    try:
        out["compose"] = tuner.compose(
            archetypes, weights=weights, used=used or set(),
            comfort=comfort, veto=harmony.veto,
            # Never offer back the deck they are already being told to play.
            exclude={",".join(sorted(set(my_deck)))})
        out["loadout"] = tuner.loadout(
            archetypes, weights=weights, comfort=comfort, veto=harmony.veto)
    except Exception as exc:  # pragma: no cover - degradation
        print("coach.tune: composer: %r" % (exc,), file=sys.stderr)
        out["compose"] = None
        out["loadout"] = None
    return out


def suggest(my_tag: str, opp_tag: str, my_played: list[list[str]],
            opp_played: list[list[str]],
            my_since: str | None = None, my_until: str | None = None,
            opp_since: str | None = None, opp_until: str | None = None,
            swaps: bool = False) -> dict:
    """What to play next, and why.

    `my_played` / `opp_played` are the decks already used this duel, in order.
    Both empty means the duel has not started, so this is the opening pick.

    Ranked on expected win rate where there is evidence, and on how much the
    player actually plays the deck where there is not — with `basis` saying
    which, because "your best matchup" and "your most-played deck" are
    different recommendations and only one of them is a read.
    """
    stage = max(len(my_played), len(opp_played))
    used_mine = set().union(*[set(d) for d in my_played]) if my_played else set()
    snap = counter._snap()

    # A WINDOW EACH, and they are not the same dates. `days` counts back from
    # the last battle stored for THAT player -- the site-wide convention, so a
    # player who stopped a month ago still gets a populated screen instead of an
    # empty one and no explanation. Two players with different last-seen dates
    # therefore get two different calendar spans from one "30 days", which is
    # the intended reading of the control: thirty days of THEIR play, each.
    mine_hist = _history(my_tag, my_since, my_until) if my_tag else None
    opp_hist = _history(opp_tag, opp_since, opp_until) if opp_tag else None

    # What they will bring.
    opp = opponent_next(opp_tag, opp_played, opp_hist)

    # What I can still bring. Their history-shaped pool, then the legality
    # filter, then meta fills if my own list runs short.
    if mine_hist and mine_hist["allDecks"]:
        pool = (next_decks(my_tag, my_played, mine_hist)["decks"] if my_played
                else opening_decks(my_tag, mine_hist)["decks"])
    else:
        pool = []
    mine = _legal(pool, used_mine)
    if len(mine) < MY_TOP_DECKS:
        mine = mine + _fills(mine, used_mine, MY_TOP_DECKS - len(mine))

    recs = []
    for md in mine:
        exp = _expected(md["cards"], opp["decks"], snap)
        recs.append({**md, "expected": exp})

    scored = [r for r in recs if r["expected"]]
    if scored:
        # Deterministic to the last field: two decks tie on a rounded win rate
        # constantly, and the deck signature is the only stable tiebreak.
        recs.sort(key=lambda r: (
            r["expected"] is None,
            -(r["expected"]["winRate"] if r["expected"] else 0),
            -(r.get("count") or 0),
            ",".join(sorted(r["cards"])),
        ))
        basis = "expected win rate"
    else:
        recs.sort(key=lambda r: (-(r.get("count") or 0), ",".join(sorted(r["cards"]))))
        basis = "how much you play it"

    best = recs[0] if recs else None
    observed = None
    if opp_tag and opp_played and opp_hist:
        seen = dz.observed_duel_loadout(opp_hist["seriesDecks"], opp_played[0])
        if seen:
            _p, others, times = seen
            observed = {
                "times": times,
                "decks": [dz._arranged(d, opp_hist["marks"](d)) | {
                    "archetype": opp_hist["arch"](d),
                    "deckName": dz.deck_label(d, opp_hist["arch"](d)),
                } for d in others],
            }

    return {
        "stage": stage,
        "myTag": my_tag,
        "oppTag": opp_tag,
        # TWO WINDOWS, reported separately because they are separate spans --
        # each is counted back from that player's own last stored battle.
        "window": {
            "mine": {"from": my_since, "to": my_until},
            "opponent": {"from": opp_since, "to": opp_until},
        },
        # How much play each window actually held. A cap that leaves someone
        # with three games must not look like a cap that left them with ninety.
        "evidence": {
            "mySeries": len(mine_hist["series"]) if mine_hist else 0,
            "myGames": len(mine_hist["allDecks"]) if mine_hist else 0,
            "oppSeries": len(opp_hist["series"]) if opp_hist else 0,
            "oppGames": len(opp_hist["allDecks"]) if opp_hist else 0,
        },
        "myName": _player_name(my_tag) if my_tag else "",
        "oppName": _player_name(opp_tag) if opp_tag else "Opponent",
        "opponent": opp,
        "recommendations": recs[:MY_TOP_DECKS],
        "best": best,
        "basis": basis,
        "observedLoadout": observed,
        # The opponent's real duel log for the decks they have shown — the same
        # sequence block the prediction window carries, because the question
        # "what did they actually do after this" is the same question whichever
        # window is asking it.
        "history": (observed_sequences(opp_played, opp_hist)
                    if opp_played and opp_hist else None),
        "myPlayed": _decorate(my_played, mine_hist),
        "oppPlayed": _decorate(opp_played, opp_hist),
        # OPT-IN, and absent rather than null when it was not asked for -- a
        # null would read as "no swaps found" where the truth is "nobody
        # asked". Costs a full sibling scan, so the route only sets `swaps`
        # for an admin. See `DECK_TUNER.md`.
        **({"tuner": tune(best["cards"], opp["decks"], used_mine, mine_hist)}
           if swaps and best else {}),
        "notes": _read(stage, best, opp, my_played, opp_played, observed),
        # Every reason the answer might be weaker than it looks, listed rather
        # than folded into one flag the reader cannot interrogate.
        "caveats": _caveats(mine_hist, opp_hist, opp, basis),
    }


def _decorate(decks: list[list[str]], hist: dict | None) -> list[dict]:
    """Arrange played decks for display — same slots and art as everywhere else."""
    out = []
    for d in decks:
        if not d:
            continue
        a = hist["arch"](d) if hist else _archetype(d)
        m = hist["marks"](d) if hist else {}
        out.append(dz._arranged(d, m) | {"archetype": a,
                                         "deckName": dz.deck_label(d, a)})
    return out


def _caveats(mine_hist, opp_hist, opp, basis) -> list[str]:
    out = []
    if not opp_hist or not opp_hist["allDecks"]:
        out.append("No duel history for the opponent — their side is the current meta, "
                   "not a read on them.")
    elif len(opp_hist["allDecks"]) < MIN_DUEL_GAMES:
        out.append(f"Only {len(opp_hist['allDecks'])} duel games stored for the opponent.")
    # Only for the BLEND. When the source is plain "population" there is no
    # history to have been topped up, and the line above already says so —
    # saying both made a no-data read sound like a partial one.
    if opp["source"] == "opponent-history+population":
        pct = round((1 - OPP_HISTORY_MASS) * 100)
        out.append(f"Their own decks did not fill the list, so it is topped up with meta "
                   f"decks — those rows are labelled and hold {pct}% of the probability.")
    if not mine_hist or not mine_hist["allDecks"]:
        out.append("No duel history for you either — the options offered are meta decks.")
    if basis != "expected win rate":
        out.append("No matchup evidence for any of these pairings, so the options are "
                   "ranked by how much you play them rather than by matchup.")
    return out


def _read(stage, best, opp, my_played, opp_played, observed) -> list[str]:
    """The coach's read, in sentences. EXPLANATORY, never a second opinion.

    Every line is either a fact we hold or the ranking already computed, stated
    honestly. It must not imply a sharper read than the numbers support — which
    is the measured position, not a stylistic one: counter-sniping and recency
    both made the bot's predictions worse when they were tried as features.
    """
    out = []
    if opp_played:
        out.append("They have shown " +
                   " then ".join(counter._label(_archetype(d))
                                 for d in opp_played) + " so far.")
    if observed:
        rest = " + ".join(d["deckName"] for d in observed["decks"])
        times = "once" if observed["times"] == 1 else f"{observed['times']} times"
        out.append(f"When they opened this way before ({times}), the rest of their "
                   f"loadout was {rest}.")
    decks = opp["decks"]
    if decks:
        top = decks[0]
        p = top.get("prob") or 0
        name = top.get("deckName") or counter._label(top.get("archetype") or "")
        if len(decks) == 1:
            out.append(f"Only {name} fits what they have left.")
        else:
            spread = ("a clear favourite" if p >= 0.5 else
                      "the front-runner" if p >= 0.3 else
                      "a wide field — treat this as a lean")
            out.append(f"{name} at {round(p * 100)}% of {len(decks)} decks they can "
                       f"still bring — {spread}.")
    if best:
        exp = best.get("expected")
        name = best.get("deckName") or counter._label(best.get("archetype") or "")
        if not exp:
            out.append(f"Go with {name} — ranked on how much you play it, since there "
                       f"is no matchup evidence here.")
        else:
            edge = abs(exp["winRate"] - 50)
            why = ("a real edge in this matchup" if edge >= 15 else
                   "a slight edge — winnable either way" if edge >= 6 else
                   "close to a coin flip, so play the one you pilot best")
            out.append(f"Go with {name} at {exp['winRate']}% — {why}.")
    if my_played:
        out.append("Already spent by you: " +
                   ", ".join(counter._label(_archetype(d)) for d in my_played) +
                   " — those cards cannot repeat.")
    elif stage == 0 and out:
        # `and out` matters. This line FRAMES a recommendation — it is the
        # reason the pick has consequences beyond this game. On its own, with
        # no deck to suggest and no read to give, it is the screen sounding
        # like it has something to say when it does not.
        out.append("Nothing is burned yet — this pick sets up the next two.")
    return out


# ── THE TWO ENTRY POINTS THE API CALLS ─────────────────────────────────────

def predict(tag: str, revealed: list[list[str]],
            since: str | None = None, until: str | None = None) -> dict:
    """Window 1. No reveals = the opening; one or two = what is left.

    THE HISTORY IS WINDOWED. It used to read everything stored for the player,
    which quietly answered a different question from the one being asked: a
    duel is decided by what someone is playing NOW, and a deck they ran daily
    six weeks ago carries the same weight as one they ran this morning. The
    caller picks the window; `_history` already caches per `(tag, since,
    until)`, so a window is not a second database read for the same span.

    A NARROW WINDOW CAN LEGITIMATELY BE EMPTY, and nothing here pretends
    otherwise — `summary.series` and `summary.games` report what the window
    actually held, so a thin answer is visibly thin rather than confidently
    wrong. There is deliberately no automatic widening: the cap is the control,
    and silently ignoring it would make the control a lie.
    """
    hist = _history(tag, since, until)
    out = {
        "tag": tag,
        "name": _player_name(tag),
        "stage": len(revealed),
        # What the figures below were computed over, so the screen can state it
        # rather than the reader having to trust the control they set.
        "window": {"from": since, "to": until},
        "summary": {
            "series": len(hist["series"]),
            "games": len(hist["allDecks"]),
            "orderedSeries": len(hist["firsts"]),
            "archiveUsed": hist["archiveUsed"],
        },
    }
    if revealed:
        out.update(next_decks(tag, revealed, hist))
    else:
        out.update(opening_decks(tag, hist))
        out["revealed"] = []

    _observe_opponent(tag)
    return out


# --------------------------------------------------------------------------
# Opponent Intelligence Engine — ADDITIVE, FLAGGED, AND UNABLE TO BREAK THIS
# --------------------------------------------------------------------------
#
# Fifteen phases of offline measurement produced exactly one shippable claim:
# the most recent deck is the safest prediction, and a short ranked list of
# alternatives can be offered alongside it with an honest confidence band.
# Measured on 400 players, all steps, no oracle:
#
#     primary correct (= Recent)   86.7% competitive / 53.1% duel
#     coverage incl. alternatives  88.7% / 61.6%
#     "high" band actually right   95.7% / 87.3%
#     "low" band actually right    15.5% / 28.9%
#
# THREE PROPERTIES MAKE THIS SAFE TO ADD HERE:
#   * it is ADDITIVE — one new key; every existing field is untouched;
#   * it is FLAGGED — CLASH_OIE=on to enable, absent by default;
#   * it CANNOT RAISE — the engine returns a fallback rather than throwing, and
#     this wrapper swallows anything that still escapes.
#
# The engine never replaces the prediction. `ml.production.policy` enforces
# that with `enforce_primary`, because every offline attempt to let a model
# overrule the recent deck lost.

_OIE_MODE = os.getenv("CLASH_OIE", "off").lower()

#: PHASE 23B. Which domain the opponent-read endpoint SHOWS.
#:
#: `competitive`, on a product decision, and the reasoning is worth keeping
#: because the obvious choice is the wrong one. This screen is about duels, so
#: the duel-ish domain looks like the natural thing to surface — but Phase 20D
#: established that domain is practice, and `policy.BAND_SUPPORTED` withholds
#: its band because its ordering does not hold (macro high 65.4% < medium
#: 69.7%). Without a band there are also no alternatives, so surfacing it would
#: ship a panel containing the recent deck and nothing else: technically "on",
#: informationally empty.
#:
#: Competitive is the domain whose ordering survived reconciliation against
#: real outcomes (68.2% > 55.0% > 0.0%, Phase 19D), so it is the only one where
#: a qualitative band and a capped alternatives list are defensible.
#:
#: THIS IS NOT A CLAIM OF NATIVE DUEL SUPPORT. Practice remains observed and
#: logged; it is simply not shown. Native duel rows are still dropped upstream
#: by the 8-card guard and no part of this pipeline reads them.
SURFACED_DOMAIN = "competitive"


def observe(tag: str) -> dict:
    """Run the engine for BOTH domains and return the surfaced read.

    Shared by the shadow observer and the `/opponent-read` endpoint so there is
    exactly ONE place the engine is invoked from production.

    BOTH DOMAINS ARE OBSERVED, only one is surfaced. Hardcoding one domain for
    the RECORDING meant the shadow experiment could never reach its competitive
    target, and competitive is the stronger domain, so the weaker half would
    have been the only half with evidence.

    PHASE 23, FIX 2. The old `duel` domain is `practice`. Phase 20D measured
    that population as 97.8% Friendly/Showdown_Friendly, with every native duel
    row dropped upstream by the 8-card guard, so the old name promised duel
    support that has never existed.

    PHASE 23B. BOTH are still observed and logged; `SURFACED_DOMAIN` decides
    which one is returned, and it is competitive. See that constant for why.
    """
    from ml.production import predictor as oie
    surfaced = None
    for domain in ("practice", "competitive"):
        try:
            r = oie.predict_for_tag(tag, domain, record_shadow=True)
        except Exception:
            continue
        if domain == SURFACED_DOMAIN:
            surfaced = r
    return surfaced.as_dict() if surfaced is not None else None


def _observe_opponent(tag: str) -> None:
    """PHASE 19B — fire-and-forget. The Coach never waits for the engine.

    Previously this ran inline and its result was attached to the Coach
    response, so a cold read on the spinning volume delayed the whole screen —
    the entire primary experience waited on an ADDITIVE enhancement. Phase 19A
    measured that read at up to ~2.5 s p95 under bot write load and established
    it cannot be optimised away against a read-only database.

    So the Coach no longer returns the read at all. In `shadow` it is observed
    on a daemon thread purely to fill the log; in `on` the UI fetches it from
    `/api/analytics/coach/opponent-read/<tag>` after the deck has rendered.
    """
    if _OIE_MODE != "shadow":
        # In `on` the endpoint performs (and records) the read, so observing
        # here too would double-count every player in the shadow log.
        return
    try:
        t = threading.Thread(target=lambda: _safe_observe(tag), daemon=True)
        t.start()
    except Exception:
        pass


def _safe_observe(tag: str) -> None:
    try:
        observe(tag)
    except Exception:
        # A research package must never be able to break the Coach.
        pass


def opponent_read(tag: str) -> dict:
    """What `/api/analytics/coach/opponent-read/<tag>` returns.

    `enabled` is false in every mode but `on`, so the client can render nothing
    without needing to know what a feature flag is.
    """
    if _OIE_MODE != "on":
        return {"enabled": False, "read": None}
    try:
        return {"enabled": True, "read": observe(tag)}
    except Exception:
        return {"enabled": True, "read": None}
