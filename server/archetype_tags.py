"""archetype_tags.py — the NAME a player would give a deck, inside its family.

ASKED FOR (2026-11-09): "Bridge Spam is not generalised: Mega Knight bridge
spam, Giant Skeleton bridge spam ... Log Bait with MK and normal Log Bait are
different, Knight Log Bait is different, with Valkyrie and Goblin Barrel it is
Hyper Bait as it is very cheap ... search online all the tags and their
significance and change the tagging."

THE FAMILY STAYS THE BOT'S. `deck_counter._archetype_of_hash` decides which of
the 17 families a deck is in (miner, bait, hog, bridge-spam ...) and every
model, matchup table and folder in this project is keyed on it. A tag is one
level BELOW that: what separates two decks of one family in the way players
talk about them. It never moves a deck to another family, so nothing that reads
families changes.

WHERE THE NAMES COME FROM. The community names that recur across guide sites
and leaderboard write-ups (RoyaleTracker, StatsRoyale, RoyaleAPI's season deck
posts, guild wikis), checked 2026-11-09:

  * Bridge Spam is named by its big tank: P.E.K.K.A Bridge Spam, MK Bridge Spam,
    and Giant Skeleton Bridge Spam ("very similar to Mega Knight Bridge Spam").
  * Bait: Log Bait (Princess, Rocket, Goblin Gang, Inferno Tower ...), MK Bait
    (Mega Knight as the defence), Knight Log Bait (the classic Knight version),
    and Hyper Bait — bait "pushed to maximum aggression", very cheap, built on
    Goblin Barrel with Skeleton Barrel / Wall Breakers / Suspicious Bush; the
    account holder adds Valkyrie + Goblin Barrel to it.
  * Hog: Hog 2.6 (Cannon, Musketeer, Ice Golem, Fireball), Hog Cycle (any
    cheap Hog), Hog EQ (Earthquake). Royal Hogs EQ.
  * Graveyard Freeze, Splashyard (Graveyard + splash troops), Giant Graveyard.
  * Lava Loon, Lava Miner; Loon Freeze, Miner Loon.
  * Miner Poison, Miner Wall Breakers.
  * X-Bow 3.0 (cheap X-Bow), Mortar Bait, Mortar Cycle.
  * Bait with a second win condition: Mortar Bait, Hog Bait, Bridge Spam
    Bait, Giant Bait, Minion Giant Bait (the bot files any Goblin Barrel or
    Wall Breakers deck as bait).
  * Hog Exe Nado; Graveyard Poison; Miner Loon, MK Miner; Golem Pump.
  * Golem Night Witch; Giant Double Prince, Giant Sparky; RG Fisherman;
    E-Giant Tornado; Drill Cycle; 3M Pump.

FIRST RULE THAT MATCHES WINS, inside each family, and the order is the point:
"has a Mega Knight" is checked before "is cheap" for bait, because an MK Bait
deck can be cheap too and players call it MK Bait. A deck no rule names keeps
its family's own name (`Log Bait`, `Bridge Spam` ...), so a tag is never worse
than the old label.

PURE: no imports. `elixir_of(card) -> number` is passed in.
"""

from __future__ import annotations

#: The plain name of each family, used when no rule names a deck. Matches the
#: labels the screens already print (`deck_counter._label`).
FAMILY_NAMES = {
    "hog": "Hog Rider", "drill": "Goblin Drill", "graveyard": "Graveyard",
    "miner": "Miner", "bridge-spam": "Bridge Spam", "piggies": "Royal Hogs",
    "royal-giant": "Royal Giant", "lava": "Lava Hound", "giant": "Giant",
    "balloon": "Balloon", "e-giant": "Electro Giant", "golem": "Golem",
    "3-musk": "Three Musketeers", "mortar": "Mortar", "xbow": "X-Bow",
    "bait": "Log Bait", "other": "Mixed",
}

SPLASH = ("baby-dragon", "bowler", "executioner", "valkyrie", "dark-prince", "wizard")
HYPER = ("skeleton-barrel", "wall-breakers", "suspicious-bush")
PRINCES = ("prince", "dark-prince")
BAIT_SMALL = ("goblin-gang", "dart-goblin", "spear-goblins", "skeleton-barrel", "princess")


def avg_elixir(cards, elixir_of) -> float:
    vals = [elixir_of(c) or 0 for c in cards]
    return sum(vals) / len(vals) if vals else 0.0


def _has(c, *keys):
    return any(k in c for k in keys)


def _rules(family: str, c: set, e: float) -> str | None:
    """The tag's label, or None for the family's plain name."""
    if family == "bridge-spam":
        if "mega-knight" in c:
            return "MK Bridge Spam"
        if "pekka" in c:
            return "P.E.K.K.A Bridge Spam"
        if "giant-skeleton" in c:
            return "Giant Skeleton Bridge Spam"
        return None
    if family == "bait":
        if "mega-knight" in c:
            return "MK Bait"
        if "valkyrie" in c or (e <= 2.9 and _has(c, *HYPER)):
            return "Hyper Bait"
        # A SECOND WIN CONDITION NAMES THE DECK. The bot files any deck with
        # Goblin Barrel or Wall Breakers under bait, so Mortar, Hog, Battle Ram
        # and Giant decks carrying a barrel land here; measured on the 2v2
        # board, they were most of the decks left plain "Log Bait".
        if "mortar" in c:
            return "Mortar Bait"
        if "hog-rider" in c:
            return "Hog Bait"
        if _has(c, "battle-ram", "ram-rider"):
            return "Bridge Spam Bait"
        if "giant" in c:
            return "Giant Bait"
        if "minion-giant" in c:
            return "Minion Giant Bait"
        if "knight" in c:
            return "Knight Log Bait"
        return None
    if family == "hog":
        if {"cannon", "musketeer", "ice-golem", "fireball"} <= c:
            return "Hog 2.6"
        if "earthquake" in c:
            return "Hog EQ"
        if {"executioner", "tornado"} <= c:
            return "Hog Exe Nado"
        if e <= 3.0:
            return "Hog Cycle"
        return None
    if family == "piggies":
        return "Royal Hogs EQ" if "earthquake" in c else None
    if family == "graveyard":
        if "freeze" in c:
            return "Graveyard Freeze"
        if "giant" in c:
            return "Giant Graveyard"
        if _has(c, *SPLASH):
            return "Splashyard"
        if "poison" in c:
            return "Graveyard Poison"
        return None
    if family == "lava":
        if "balloon" in c:
            return "Lava Loon"
        if "miner" in c:
            return "Lava Miner"
        return None
    if family == "balloon":
        if "freeze" in c:
            return "Loon Freeze"
        if "miner" in c:
            return "Miner Loon"
        return "Loon Cycle" if e <= 3.2 else None
    if family == "miner":
        if "balloon" in c:
            return "Miner Loon"
        if "wall-breakers" in c:
            return "Miner Wall Breakers"
        if "mega-knight" in c:
            return "MK Miner"
        if "poison" in c:
            return "Miner Poison"
        return None
    if family == "xbow":
        return "X-Bow 3.0" if e <= 3.1 else None
    if family == "mortar":
        if _has(c, *BAIT_SMALL):
            return "Mortar Bait"
        return "Mortar Cycle" if e <= 3.2 else None
    if family == "golem":
        if "night-witch" in c:
            return "Golem Night Witch"
        return "Golem Pump" if "elixir-collector" in c else None
    if family == "giant":
        if sum(1 for p in PRINCES if p in c) == 2:
            return "Giant Double Prince"
        if "graveyard" in c:
            return "Giant Graveyard"
        if "sparky" in c:
            return "Giant Sparky"
        return None
    if family == "royal-giant":
        return "RG Fisherman" if "fisherman" in c else None
    if family == "e-giant":
        return "E-Giant Tornado" if "tornado" in c else None
    if family == "drill":
        return "Drill Cycle" if e <= 3.0 else None
    if family == "3-musk":
        return "3M Pump" if "elixir-collector" in c else None
    return None


def slug(label: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "-" for ch in label)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


def tag(cards, family: str, elixir_of, other_name: str | None = None) -> dict:
    """`{"key": "<family>:<slug>", "label": ..., "family": family, "named": bool}`.

    `named` is False when no rule matched and the label is the family's own
    name. `other_name` labels a deck in the `other` family (the bot's map does
    not cover its win condition), e.g. "Minion Giant" from `deck_title`.
    """
    c = set(cards or ())
    label = _rules(family, c, avg_elixir(c, elixir_of)) if c else None
    named = label is not None
    if not named:
        label = (other_name if family == "other" and other_name else
                 FAMILY_NAMES.get(family, family))
    return {"key": family + ":" + slug(label), "label": label, "family": family, "named": named}
