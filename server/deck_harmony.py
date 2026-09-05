"""deck_harmony.py — is this eight-card list a deck, or a pile of cards?

Design record: `DECK_TUNER.md` section 4. This implements the veto and nothing
else.

    IT NAMES WHAT IS MISSING. IT NEVER SCORES.

There is no "harmony score" here and there must never be one. A weighted number
would be an invented figure, which is the thing this project refuses on the
landing page, in the release feed and in every report it prints. A checklist
that says "no second air answer" is actionable; a 6.4/10 is not, and it is not
derivable from anything either.

    THE KNOWLEDGE BASE DECIDES WHICH DECKS ARE ELIGIBLE. THE DATABASE DECIDES
    WHICH OF THEM IS GOOD.

`deck_tuner.rank()` takes this as its `veto` callable. A failing swap is
DROPPED, not down-weighted -- down-weighting is how a deck with four
tank-killers and no air answer ends up recommended because the numbers liked it.

NO IMPORTS BEYOND CARD DATA, like `tiers.ts`, `squadParse.ts`,
`passwordRules.ts` and `releases.ts`. The rules most worth testing exhaustively
must be importable without constructing a database connection or a Supabase
client.

── THE DISTINCTION THAT MATTERS MOST ───────────────────────────────────────

**A SPELL THAT HITS AIR IS NOT AN AIR ANSWER.**

Fireball, Lightning, Poison, Rocket, Tornado, Freeze, Giant Snowball and the
spirits all damage air units, so `hitsAir` is true for every one of them. But a
deck whose only "air answer" is Fireball has no air defence at all -- a Lava
Hound push is not stopped by a one-shot, and the spirits die on contact.

Counting them would pass exactly the decks this check exists to fail, and it
would do it silently. So an air answer must be a TROOP or a BUILDING that
targets air. That single rule takes the roster's air answers from 52 to a much
smaller and much more honest set.

The same reasoning applies to splash: a spell is not the deck's anti-swarm
plan, it is a one-off.
"""

from __future__ import annotations

import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_DATA = os.path.join(os.path.dirname(_HERE), "src", "data")


def _load(name: str):
    with open(os.path.join(_DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def _roster() -> dict:
    raw = _load("cards.json")
    if isinstance(raw, dict):
        raw = raw.get("items") or list(raw.values())
    return {c["key"]: c for c in raw}


CARDS = _roster()
META = _load("cardMeta.json")
ROLES = _load("cardRoles.json")["cards"]

DECK_SIZE = 8

# ── Thresholds ──────────────────────────────────────────────────────────────
#
# TWO air answers, not one. One is a single point of failure: it gets spelled,
# it gets pulled out of cycle, or it is simply the wrong one for what arrives.
# Every competitive deck list in the meta population carries two, and a check
# that accepted one would pass decks nobody plays.
MIN_AIR = 2
MIN_ANTI_SWARM = 1
MIN_CHEAP = 2          # cards at or under CHEAP_ELIXIR
CHEAP_ELIXIR = 3
MIN_WIN_CONDITIONS = 1
MIN_SPELLS = 1
SMALL_SPELL_ELIXIR = 3

# The band is WIDE on purpose. A siege deck and a Golem deck are both real, and
# a band tight enough to express "correct" for one calls the other broken.
# These are the outer edges of what people actually play, not a target.
#
# THE FLOOR WAS 2.60 AND IT REJECTED MORTAR CYCLE AT 2.50. That was the check
# being wrong, not the deck: real cycle lists run this low and Hog 2.6 sits at
# 2.62 with almost no clearance. Measured against twelve real meta decks, which
# is what `test_deck_harmony.py` now pins.
MIN_AVG_ELIXIR = 2.4
MAX_AVG_ELIXIR = 4.6

# ── Cards that cannot be classified from a deck list ────────────────────────
#
# Not a failure and not a pass -- an UNKNOWN, and it must be reported as one.
#
#   spirit-empress  Her cost (6 or 3) AND her troop type (air or ground) are
#                   chosen by the player's Elixir bar at the moment she is
#                   deployed. "Does this deck answer air" genuinely has no
#                   deck-list answer for her.
#   mirror          Copies the last card played, so its profile is whatever
#                   that was.
#
# A deck holding either is INCOMPLETELY CHECKED. Passing it would state a
# structural fact nothing verified, which is the failure mode the card manual
# was written to avoid.
SPECIAL = {
    "spirit-empress": "her form, cost and targeting are decided by your Elixir "
                      "bar at deployment, so a deck list cannot say whether "
                      "she answers air",
    "mirror": "copies the last card played, so it has no profile of its own",
}


def _elixir(card: str) -> float:
    c = CARDS.get(card)
    return float(c["elixir"]) if c else 0.0


def avg_elixir(cards: list[str]) -> float:
    """Mean Elixir. NOTE `void` is recorded as 3 in `cards.json` and is really
    5 since the 2026-08-04 balance update -- see `DECK_TUNER.md` section 4.
    This function inherits that error until the data is fixed; it does not
    paper over it, because a silent correction here and a wrong figure in the
    builder would be worse than one wrong figure in both."""
    if not cards:
        return 0.0
    return round(sum(_elixir(c) for c in cards) / len(cards), 2)


def _is(card: str, kind: str) -> bool:
    c = CARDS.get(card)
    return bool(c) and (c.get("type") or "").lower() == kind


def answers_air(card: str) -> bool:
    """A TROOP OR BUILDING that targets air. See the module docstring: a spell
    that hits air is not an air answer, and counting spells here would pass
    exactly the decks this check exists to fail."""
    r = ROLES.get(card)
    return bool(r) and r.get("hitsAir") and not _is(card, "spell")


def has_splash(card: str) -> bool:
    """Area damage from something that STAYS ON THE FIELD.

    Reported, and the basis of a soft note — not a hard veto. See
    `is_anti_swarm` for why the two are separated.
    """
    r = ROLES.get(card)
    return bool(r) and r.get("damage") == "area" and not _is(card, "spell")


def is_anti_swarm(card: str) -> bool:
    """Anything that clears a group — a splash troop, a building, OR a spell.

    THE ASYMMETRY WITH `answers_air` IS DELIBERATE AND IT IS NOT AN
    INCONSISTENCY. A spell counts here and does not count there, because the
    two threats have different shapes:

      * A SWARM ARRIVES ONCE. The Log, Arrows, Zap and Fireball are the
        canonical answers to Skeleton Army and Goblin Gang — for a great many
        real decks the spell IS the anti-swarm plan, and always was.
      * AN AIR PUSH IS SUSTAINED. A Lava Hound is not stopped by a one-shot,
        so a deck whose only "air answer" is Fireball has no air defence.

    THIS WAS FOUND BY VALIDATION, NOT BY REASONING FROM FIRST PRINCIPLES.
    Requiring a splash TROOP failed X-Bow 2.9 — a deck that is genuinely built
    with Tesla, The Log and Fireball and no splash troop at all. The check was
    wrong; the deck was not. A deck with no splash troop still gets a NOTE,
    because answering every swarm with a spell is a real cost.
    """
    r = ROLES.get(card)
    return bool(r) and r.get("damage") == "area"


def is_win_condition(card: str) -> bool:
    """From `cardMeta.json`, which is the authority. The manual deliberately
    does not duplicate these flags -- two copies of one fact drift."""
    return bool(META.get(card, {}).get("is_win_condition"))


def is_small_spell(card: str) -> bool:
    return _is(card, "spell") and _elixir(card) <= SMALL_SPELL_ELIXIR


def check(cards: list[str]) -> dict:
    """The full checklist. `ok` is the veto; `problems` is why.

    Returns::

        {"ok": bool, "problems": [...], "unknowns": [...], "counts": {...}}

    `problems` are HARD failures. `unknowns` are cards that cannot be
    classified from a list -- a deck with unknowns is reported as
    INCOMPLETELY CHECKED and `ok` is False, because passing it would assert
    something nothing verified.
    """
    uniq = list(dict.fromkeys(cards))
    problems: list[str] = []
    unknowns: list[str] = []

    if len(uniq) != DECK_SIZE:
        problems.append("a deck is %d cards; this is %d%s"
                        % (DECK_SIZE, len(uniq),
                           " (after removing duplicates)"
                           if len(cards) != len(uniq) else ""))

    unknown_cards = [c for c in uniq if c not in CARDS]
    if unknown_cards:
        problems.append("not a card: " + ", ".join(sorted(unknown_cards)))
        return {"ok": False, "problems": problems, "unknowns": [],
                "counts": {}, "checked": False}

    for c in uniq:
        if c in SPECIAL:
            unknowns.append("%s — %s" % (c, SPECIAL[c]))

    air = [c for c in uniq if answers_air(c)]
    splash = [c for c in uniq if has_splash(c)]
    swarm = [c for c in uniq if is_anti_swarm(c)]
    wincons = [c for c in uniq if is_win_condition(c)]
    spells = [c for c in uniq if _is(c, "spell")]
    small = [c for c in uniq if is_small_spell(c)]
    cheap = [c for c in uniq if _elixir(c) <= CHEAP_ELIXIR]
    avg = avg_elixir(uniq)

    if len(wincons) < MIN_WIN_CONDITIONS:
        problems.append("no win condition — nothing in this deck threatens a tower")
    if len(air) < MIN_AIR:
        problems.append(
            "only %d air answer%s (need %d) — a spell that hits air is not an "
            "air answer" % (len(air), "" if len(air) == 1 else "s", MIN_AIR))
    if len(swarm) < MIN_ANTI_SWARM:
        problems.append("nothing with area damage — swarms go unanswered")
    if len(spells) < MIN_SPELLS:
        problems.append("no spell")
    elif not small:
        problems.append("no small spell (%d Elixir or less)" % SMALL_SPELL_ELIXIR)
    if len(cheap) < MIN_CHEAP:
        problems.append("only %d card%s at %d Elixir or less (need %d) — "
                        "nothing to cycle with"
                        % (len(cheap), "" if len(cheap) == 1 else "s",
                           CHEAP_ELIXIR, MIN_CHEAP))
    if avg < MIN_AVG_ELIXIR:
        problems.append("average Elixir %.2f is below %.2f" % (avg, MIN_AVG_ELIXIR))
    elif avg > MAX_AVG_ELIXIR:
        problems.append("average Elixir %.2f is above %.2f" % (avg, MAX_AVG_ELIXIR))

    # SOFT — reported, never enforced. These are real costs that real decks
    # accept on purpose, so refusing them would refuse decks people win with.
    # X-Bow 2.9 is exactly this: no splash troop at all, and correct.
    notes: list[str] = []
    if not splash:
        notes.append("no splash troop or building — every swarm has to be "
                     "answered with a spell")
    if len(air) == MIN_AIR:
        notes.append("exactly %d air answers — losing one to a spell leaves "
                     "the deck thin" % MIN_AIR)

    return {
        # Unknowns fail the veto. A deck that MIGHT lack an air answer is not a
        # deck this may recommend, and the reason is reported rather than the
        # deck silently disappearing.
        "ok": not problems and not unknowns,
        "problems": problems,
        "notes": notes,
        "unknowns": unknowns,
        "checked": not unknowns,
        "counts": {
            "airAnswers": len(air), "air": sorted(air),
            "antiSwarm": len(swarm), "antiSwarmCards": sorted(swarm),
            "splash": len(splash), "splashCards": sorted(splash),
            "winConditions": len(wincons), "winConditionCards": sorted(wincons),
            "spells": len(spells), "smallSpells": len(small),
            "cheap": len(cheap), "avgElixir": avg,
        },
    }


def veto(cards: list[str]) -> str | None:
    """`deck_tuner.rank()`'s `veto` callable: a reason, or None to allow.

    The FIRST problem only. A swap dropped for three reasons is dropped for the
    first one as far as the caller is concerned, and a caller that wants all of
    them calls `check()`.
    """
    r = check(cards)
    if r["ok"]:
        return None
    if r["problems"]:
        return r["problems"][0]
    return r["unknowns"][0]
