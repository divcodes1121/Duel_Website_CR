"""HOW A PLAYER BUILDS A DECK, and which real ladder lists are built that way.

REPORTED 2026-10-12, against the coach's "Every way to answer this field":
"everyone should not have the same, as everyone's playstyle is different ...
see what spells they are pairing with which win cons, check usage, search
those decks from actual playing ones used widely, see all support types ...
it should not be generic and the same for all".

MEASURED FIRST, on the seven roster players: the lead deck of a win condition
was the SAME LIST for all seven in 11 of 17 win conditions, and two thirds of
any player's board was also on another player's. Two causes:

  * the pool was the twelve most-played lists of each win condition (204),
    while the snapshot holds every vetted ladder list (about forty each, 651
    -- 25+ pilots, played in the last thirty days, `deck_evidence`);
  * "theirs" meant raw card overlap (`affinity.known`), which cannot tell a
    spell from a win condition. Two Hog decks sharing six cards with a player
    can differ in exactly the part that is the player's own: Fireball + Log
    against Earthquake + Snowball, Cannon against Tesla against no building.

THE ANSWER IS A ROLE-AWARE PROFILE, FROM THEIR OWN GAMES. `profile()` reads
the decks they actually played and how much, split by `deck_packages`' own
roles (win condition / spell / building / support):

    card      share of their battles each card was in
    packages  share of their battles with each exact spell SET
    noBuilding / elixir    share with no building, mean deck cost

...and the same again for each WIN CONDITION CARD they have real games with
(`byWinCon`), because the question asked was "what spells are they pairing
with which win cons": a player's Hog decks may run Earthquake while their
Graveyard decks run Poison, and a Hog list is fitted against the Hog games
first.

`fit()` scores one list against it -- spells, support, building, pace, each
0..1 -- and `pick()` chooses a win condition's decks:

    AMONG THE REAL LISTS THAT STILL BEAT THE FIELD (`STYLE_FLOOR`) AND ARE NOT
    FAR BEHIND THE WIN CONDITION'S BEST (`STYLE_BAND`), THE ONES BUILT THE WAY
    THIS PLAYER BUILDS.

THE FLOOR AND THE BAND ARE WHAT KEEP IT HONEST. An unbounded familiarity
weight would rank a losing deck above a winning one on a soft signal (the
mistake `coach_daily.FAMILIAR_WEIGHT` is capped to avoid). Every list this can
choose is one that wins against the field, and the rate printed beside it is
its own expected rate -- nothing here changes a figure. The win condition's
best rate rides along (`fieldBest`), so what was passed over is never hidden.

PURE: no imports beyond the standard library. `role_of` and `elixir_of` are
passed in, so `test_coach_style.py` drives every rule with literals.
"""

from __future__ import annotations

BRAIN = "coach-style-1.0"

#: A list must still beat the field to be shown for fitting how they build...
STYLE_FLOOR = 52.0

#: ...and sit within this many points of the win condition's best list.
#:
#: REPLAYED on the seven roster players, 651 real lists scored for each (the
#: old board is the live one: 204 lists, two slots reserved on card overlap):
#:
#:     rule            lead list the    a board also on   shown   spells   support
#:                     same for all 7   another player's   rate   theirs    theirs
#:     old board          11 of 17           66%           55.5     66%      41%
#:     wide pool only     10 of 17           81%           59.1     59%      36%
#:     band 3              4 of 17           69%           58.6     62%      39%
#:     band 8, floor 52    2 of 17           44%           56.7     71%      49%
#:     band 10, floor 52   1 of 17           38%           56.1     72%      50%
#:     band 12, floor 52   0 of 17           36%           55.8     73%      50%
#:     no band, floor 50   0 of 17           27%           54.7     76%      52%
#:
#: A wider pool ALONE makes the boards more alike (everybody gets the same
#: stronger lists), and a narrow band cannot separate them: within three
#: points of the best there are one to four lists in a third of the win
#: conditions. Ten is where the boards stop being the same board while the
#: decks shown are still better than the old board's (56.1 against 55.5),
#: because the pool they are chosen from is three times the size. Past it the
#: shown rate falls under the old board's for little more separation.
STYLE_BAND = 10.0

#: Battles on their own rated decks before a profile says anything. Under it
#: the board is the field's, as it was -- twenty games is four or five decks'
#: worth of the repertoire floor, and a profile off less is one evening. The
#: same floor decides whether a win condition has a reading of its own.
STYLE_MIN_BATTLES = 20

#: Share of their battles a card must be in to be counted as one they play, in
#: the PRINTED counts ("spells 2/2"). The ranking uses the shares themselves.
USES = 0.05

#: What each part of a build is worth. Spells and support are the player's own
#: choices inside a win condition; the building is one slot; pace is how heavy
#: they like a deck. They sum to one.
#:
#: PACE AND THE BUILDING ARE SMALL ON PURPOSE. Their parts are near 1 for most
#: lists (a deck cost within a few tenths; "no building" for a player who runs
#: none), while a support card's share is a fraction -- at equal weights the
#: two easy parts decided the pick, and a Hog list with NONE of a player's
#: spells or support ranked second for them.
WEIGHTS = (("spells", 0.40), ("support", 0.40), ("building", 0.12), ("pace", 0.08))

#: How much of the score is their games WITH THIS WIN CONDITION, when they
#: have `STYLE_MIN_BATTLES` of them; the rest is everything they play.
WINCON_SHARE = 0.5

#: Elixir of difference in mean deck cost at which the pace part reaches zero.
PACE_SPAN = 1.0

#: Two lists sharing this many cards are one deck with a swap; a win
#: condition's four rows should be four builds, not one build four times.
NEAR_COPY = 7


def _split(cards, role_of):
    out = {"wincon": [], "spell": [], "building": [], "support": []}
    for c in cards or []:
        out.get(role_of(c), out["support"]).append(c)
    return out


def _cost(cards, elixir_of) -> float | None:
    vals = [float(elixir_of(c) or 0) for c in cards or []]
    vals = [v for v in vals if v > 0]
    return sum(vals) / len(vals) if vals else None


def _profile(own: list[dict], role_of, elixir_of) -> dict | None:
    total = sum(int(d.get("battles") or 0) for d in own or [])
    if total < STYLE_MIN_BATTLES:
        return None
    card: dict[str, float] = {}
    packages: dict[tuple, float] = {}
    no_building = 0.0
    cost_sum = cost_n = 0.0
    decks = 0
    for d in own:
        n = int(d.get("battles") or 0)
        cards = [c for c in (d.get("cards") or []) if c]
        if n <= 0 or not cards:
            continue
        decks += 1
        w = n / total
        for c in set(cards):
            card[c] = card.get(c, 0.0) + w
        parts = _split(cards, role_of)
        key = tuple(sorted(parts["spell"]))
        packages[key] = packages.get(key, 0.0) + w
        if not parts["building"]:
            no_building += w
        cost = _cost(cards, elixir_of)
        if cost is not None:
            cost_sum += cost * n
            cost_n += n
    return {
        "battles": total,
        "decks": decks,
        "card": card,
        "packages": packages,
        "noBuilding": no_building,
        "elixir": (cost_sum / cost_n) if cost_n else None,
    }


def profile(own: list[dict], role_of, elixir_of) -> dict | None:
    """How this player builds, from `[{cards, battles}]` -- their own decks.

    None under `STYLE_MIN_BATTLES`: no profile is a real answer, and the
    caller then shows the field's order rather than a style read off noise.
    `byWinCon` holds the same reading over the decks that field each win
    condition card, where those alone clear the floor.
    """
    prof = _profile(own, role_of, elixir_of)
    if prof is None:
        return None
    seen: dict[str, list] = {}
    for d in own or []:
        for c in set(_split(d.get("cards"), role_of)["wincon"]):
            seen.setdefault(c, []).append(d)
    by: dict[str, dict] = {}
    for c, decks in seen.items():
        sub = _profile(decks, role_of, elixir_of)
        if sub is not None:
            by[c] = sub
    prof["byWinCon"] = by
    return prof


def _mean(values) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def fit(cards, prof: dict | None, role_of, elixir_of) -> dict | None:
    """How closely one list is built the way this player builds. None without
    a profile.

    `score` (0..1) ranks; the counts are what a reader can check by looking at
    the card strip: how many of its spells and support cards are ones they
    play, and whether the building slot is theirs.
    """
    if not prof:
        return None
    use = prof["card"]
    parts = _split(cards, role_of)
    spells, support, buildings = parts["spell"], parts["support"], parts["building"]
    spell_key = tuple(sorted(spells))
    cost = _cost(cards, elixir_of)

    def against(p: dict) -> float:
        u = p["card"]
        # SPELLS: half the cards themselves, half the exact package. Fireball
        # + Log for a player who runs that pair in 70% of games is a 0.7;
        # Fireball + Zap for the same player uses two of their spells but is
        # not a package they field, and scores under half of it.
        pk = p["packages"].get(spell_key, 0.0)
        s_spells = (0.5 * _mean(u.get(c, 0.0) for c in spells) + 0.5 * pk) if spells else pk
        s_support = _mean(u.get(c, 0.0) for c in support)
        s_building = _mean(u.get(c, 0.0) for c in buildings) if buildings else p["noBuilding"]
        if cost is None or p["elixir"] is None:
            s_pace = 0.0
        else:
            s_pace = max(0.0, 1.0 - abs(cost - p["elixir"]) / PACE_SPAN)
        part = {"spells": s_spells, "support": s_support, "building": s_building, "pace": s_pace}
        return sum(part[k] * w for k, w in WEIGHTS)

    score = against(prof)
    # THEIR GAMES WITH THIS WIN CONDITION, when there are enough of them: the
    # reading with the most battles among the list's win-condition cards.
    subs = [prof.get("byWinCon", {}).get(c) for c in parts["wincon"]]
    subs = [s for s in subs if s]
    own = max(subs, key=lambda s: s["battles"]) if subs else None
    if own is not None:
        score = (1.0 - WINCON_SHARE) * score + WINCON_SHARE * against(own)

    return {
        "score": round(score, 4),
        "spells": [sum(1 for c in spells if use.get(c, 0.0) >= USES), len(spells)],
        "support": [sum(1 for c in support if use.get(c, 0.0) >= USES), len(support)],
        # Their building, a building they do not run, or -- like them -- none.
        "building": ("none" if not buildings and prof["noBuilding"] >= USES
                     else "yours" if buildings and all(use.get(c, 0.0) >= USES for c in buildings)
                     else "other"),
        # Share of their battles played with exactly this spell set.
        "package": round(prof["packages"].get(spell_key, 0.0), 3),
        # Battles they have with this list's win condition; 0 when the score
        # is read off everything they play.
        "winConBattles": own["battles"] if own else 0,
        "elixir": round(cost, 2) if cost is not None else None,
    }


def _rate(r: dict) -> float:
    return float(r.get("expectedWinRate") or 0.0)


def pick(decks: list[dict], per: int, band: float = STYLE_BAND,
         floor: float = STYLE_FLOOR) -> list[dict]:
    """The `per` lists of one win condition this player should see.

    `decks` carry `expectedWinRate`, `cards` and `style` (`fit()`, or absent).
    Among the lists at `floor` or better and inside `band` of the best: the
    best fits first, skipping a near copy of one already chosen. Short of
    `per`, the rest of the win condition by rate. Returned best rate first --
    the row order is still a ranking; this only decides WHO is in it.

    WITH NO STYLE ON ANY ROW IT IS THE FIELD'S ORDER, which is the answer for
    a player nothing is known about.
    """
    if not decks:
        return []
    by_rate = sorted(decks, key=lambda r: (-_rate(r), r.get("name") or "", r.get("key") or ""))
    if not any(r.get("style") for r in decks):
        return by_rate[:per]

    bar = max(floor, _rate(by_rate[0]) - band)
    eligible = [r for r in by_rate if _rate(r) >= bar]
    ranked = sorted(eligible, key=lambda r: (-((r.get("style") or {}).get("score") or 0.0),
                                             -_rate(r), r.get("key") or ""))
    chosen: list[dict] = []

    def near(r):
        cs = set(r.get("cards") or [])
        return any(len(cs & set(c.get("cards") or [])) >= NEAR_COPY for c in chosen)

    def held(r):
        return any(r is c for c in chosen)

    for r in ranked:
        if len(chosen) >= per:
            break
        if not near(r):
            chosen.append(r)
    # Short: first the rest of the win condition that is not a near copy, by
    # rate, then anything at all -- four rows where four lists exist.
    for strict in (True, False):
        for r in by_rate:
            if len(chosen) >= per:
                break
            if held(r) or (strict and near(r)):
                continue
            chosen.append(r)
    chosen.sort(key=lambda r: (-_rate(r), r.get("name") or "", r.get("key") or ""))
    return chosen


def public(prof: dict | None, name_of=None, top: int = 3) -> dict | None:
    """What the profile says, small enough to ride on a payload: their most
    used spell packages and whether they run a building. Counts and shares,
    never a judgement."""
    if not prof:
        return None
    label = name_of or (lambda c: c)
    packs = sorted(prof["packages"].items(), key=lambda kv: (-kv[1], kv[0]))[:top]
    return {
        "brain": BRAIN,
        "battles": prof["battles"],
        "decks": prof["decks"],
        "band": STYLE_BAND,
        "floor": STYLE_FLOOR,
        "elixir": round(prof["elixir"], 2) if prof["elixir"] is not None else None,
        "noBuilding": round(prof["noBuilding"], 3),
        "packages": [{"spells": list(k), "names": [label(c) for c in k], "share": round(v, 3)}
                     for k, v in packs],
        # Win-condition cards they have enough games with to be read alone.
        "winCons": sorted(prof.get("byWinCon") or {}),
    }
