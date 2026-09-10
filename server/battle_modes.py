"""battle_modes.py — what kind of battle a stored row is, decided once.

**MODE DETECTION HAPPENS BEFORE THE DECK PIPELINE, NOT INSIDE IT.** That is
the whole reason this module exists rather than a predicate sitting in
`recent_battles`. A `TeamVsTeam` row stores exactly eight player cards, eight
opponent cards and one opponent tag — STRUCTURALLY IDENTICAL to a ladder row —
so nothing downstream of the read can tell the two apart. By the time a row is
a `player` side and an `opponent` side it is already too late: the 2v2 battle
has been given the shape of a duel between two people, and every consumer
inherits the misstatement. The routing decision has to be made on `game_mode`,
first, and the row sent down one path or the other.

    raw battles row
      -> is_own_deck_1v1  -> Recent Battles, drawn as deck vs deck
      -> is_duo           -> duo_pairs, folded into unique deck PAIRS
      -> otherwise          counted as hidden, drawn nowhere

NO IMPORTS BEYOND THE STANDARD LIBRARY, and none at all as it stands — the
same rule `deck_harmony.py`, `tiers.ts`, `squadParse.ts`, `passwordRules.ts`
and `releases.ts` follow, for the same reason: the rules most worth testing
exhaustively must be importable without constructing anything. Every mode
string the live database holds is pinned in `test_battle_modes.py`.

WHY THIS IS AN ALLOWLIST ON PATTERNS. Two facts about the data decided it,
both measured on the live database on 2026-09-10:

  * **Supercell increments mode strings without warning.** `Ranked1v1_NewArena`
    became `Ranked1v1_NewArena2` and both are stored in quantity. An allowlist
    of exact strings — which is what `meta.META_MODES` is — would drop
    `Ranked1v1_NewArena3` out of a player's battle log in silence, on the day
    the season turned, with nothing raised anywhere. A prefix catches it.

  * **A mode's share can move by 7x in a month.** 2v2 was 2.77% of all stored
    battles in June, 2.85% in July, 3.67% in August and **25.11% in
    September**. A blocklist is only ever as current as the last time somebody
    looked, and this is what "the last time somebody looked" costs.

The cost of an allowlist is the opposite failure: a genuinely new competitive
mode is excluded until someone adds it. That is paid for by `hidden_by_mode`,
which counts what was dropped and names it, so a new Supercell mode shows up
as a labelled number on the screen rather than as an absence nobody can see.
"""

from __future__ import annotations

#: A mode must name one of these families to be a battle the player brought
#: their own deck to. Substrings, not equality — see the module docstring.
_FAMILY_MARKERS = (
    "ranked1v1",      # Ranked1v1_NewArena, _NewArena2, and whatever is next
    "ladder",         # Ladder, Rage_Ladder
    "cw_battle_1v1",  # clan war, one on one
    "duel_1v1",       # CW_Duel_1v1, Duel_1v1_Friendly, Duel_1v1_Tournament
    "friendly",       # Friendly, Overtime_/Rage_/Showdown_Friendly, _FixedDeckOrder
    "clanmate",       # duel_split's second practice marker. Unseen in the live
                      # data so far, and kept because
                      # `duel_combos.is_competitive_practice_match` names it,
                      # so a clanmate row must not be a duel to one screen and
                      # a hidden battle to another
    "tournament",     # Tournament, Overtime_Tournament
)

#: ...and then these take it back, because the markers COMBINE. Four fire on
#: real stored modes today: `ClassicDecks_Friendly` and `MirrorDeck_Friendly`
#: really are friendlies and `CaptureTheEgg_Tournament` really is a tournament,
#: and `Heist_Friendly` is a friendly played at a different objective — none of
#: the four is a deck the player built.
#:
#: THE REST CANNOT FIRE ON ANYTHING IN THE DATABASE AS IT STANDS, AND THAT IS
#: EXACTLY WHY THEY ARE HERE. `TeamVsTeam` and `PickMode` name no family at
#: all, so stage one already drops them and these lines look like dead weight.
#: They are the guard against the combination: a 2v2 ladder mode named
#: `TeamVsTeam_Ladder` would sail through stage one on the word "ladder", and
#: the September surge is the evidence that Supercell ships modes like that.
_NOT_OWN_DECK = (
    "teamvsteam",     # 2v2 — two decks a side, and a row can only carry one
    "2v2",
    "eventdeck",      # the deck belongs to the event, not to the player
    "classicdecks",   # measured: 9 distinct decks across 5,131 battles
    "mirrordeck",     # both sides handed the same deck
    "pickmode",       # measured: 100% distinct decks across 55,972 — a draft
    "all_random",
    "crazy",          # Crazy_Arena and its two variants
    "heist",
    "capturetheegg",
    "training",
)

#: What makes a row 2v2. Kept separate from `_NOT_OWN_DECK` because these two
#: lists answer different questions: that one is "may this be drawn as one
#: deck against another", this one is "does this row belong to the duo
#: collection". A draft mode is barred from the first and is not the second.
_DUO_MARKERS = ("teamvsteam", "2v2")

#: The three destinations. Strings rather than an enum so a snapshot or a JSON
#: response can carry one without a converter.
OWN_DECK_1V1 = "own_deck_1v1"
DUO = "duo"
OTHER = "other"


def is_duo(game_mode: str) -> bool:
    """True for a two-against-two battle.

    Checked BEFORE `is_own_deck_1v1` by `classify`, so a hypothetical
    `TeamVsTeam_Ladder` is routed to the duo collection rather than merely
    refused by the 1v1 rule and lost.
    """
    m = (game_mode or "").lower()
    return any(marker in m for marker in _DUO_MARKERS)


def is_own_deck_1v1(game_mode: str) -> bool:
    """True for a battle that can honestly be drawn as one deck against one.

    AN EMPTY MODE IS KEPT. It means the bot stored a battle without recording
    what kind it was, which is a gap in collection rather than evidence the
    battle was 2v2, and the row still carries two decks and a result. This
    fails toward completeness, which is the direction a log should fail.
    """
    m = (game_mode or "").lower()
    if not m:
        return True
    if not any(marker in m for marker in _FAMILY_MARKERS):
        return False
    return not any(marker in m for marker in _NOT_OWN_DECK)


def classify(game_mode: str) -> str:
    """Which pipeline this row belongs to: `OWN_DECK_1V1`, `DUO` or `OTHER`.

    ONE FUNCTION, so the two paths cannot both claim a row or both refuse it.
    Duo is tested first for the reason `is_duo` gives.
    """
    if is_duo(game_mode):
        return DUO
    if is_own_deck_1v1(game_mode):
        return OWN_DECK_1V1
    return OTHER
