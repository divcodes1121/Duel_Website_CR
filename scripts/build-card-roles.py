#!/usr/bin/env python3
"""build-card-roles.py — extract `src/data/cardRoles.json` from the card manual.

    python scripts/build-card-roles.py [--manual PATH] [--check]

`--check` writes nothing and exits non-zero if the output would differ, which is
what a test or a pre-deploy hook wants.

NEVER HAND-EDIT `src/data/cardRoles.json`. Re-run this. That is the same rule
`build-logo.py`, `build-panel-art.py`, `build-guide-art.py` and
`build-hero-art.py` follow, and for the same reason: the master is the manual.

WHY THIS SCRIPT EXISTS AT ALL

`cards.json` carries name, type, rarity, elixir, id and description.
`cardMeta.json` carries can_evolve / can_be_hero / is_champion /
is_win_condition. **Neither carries what a card TARGETS, how it travels, or
what shape its damage is** — so "does this deck answer air" is not computable
from the repository. That gap is the whole reason the manual was written, and
this script is the bridge.

THE VOCABULARY IS NOT CLOSED IN THE SOURCE, AND THAT IS THE MAIN JOB HERE.

The manual was written in batches over several days and the tag vocabulary
drifted between them. Measured across the 122 blocks:

    TARGETS   35 cards write `air,ground` as a comma pair
              16 write `air-and-ground`
              -- the same fact, two spellings
    DAMAGE    29 say `splash`, 12 say `area`
              -- synonyms
    RANGE     `short` / `long` (early batches) against `ranged` (later ones)

A harmony check looking only for `DAMAGE:area` would have missed twenty-nine
splash cards and cheerfully passed decks with no splash at all. So every value
goes through `NORMALISE` below, and `--check`'s vocabulary assertion is what
stops the drift coming back.

WHAT IS DELIBERATELY NOT COPIED

  * `can_evolve`, `can_be_hero`, `is_champion`, `is_win_condition`. These live
    in `cardMeta.json`, which is what the app already merges and what the
    win-condition filter chips and the Wild-slot picker already read. Copying
    them here would create a second source of truth that can drift, and the
    manual's own Appendix B says to read them from there.
  * elixir, rarity, name. Those are `cards.json`'s.
  * every NUMBER. The manual carries no hitpoints, no damage figures, no radii
    and no durations, by design -- they are patch-dependent and a stale number
    that looks precise is worse than an absent one.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MANUAL = os.path.join(
    os.path.expanduser("~"), "Downloads", "Deckkies_Master_Card_Manual.md")
OUT = os.path.join(ROOT, "src", "data", "cardRoles.json")


# ── Normalisation ───────────────────────────────────────────────────────────
#
# Left: every spelling the manual actually uses. Right: the one this file emits.
# A value not in here is an ERROR, not a passthrough -- that is what keeps the
# output vocabulary closed once it is closed.

TARGETS = {
    "air": "air",
    "ground": "ground",
    "air-and-ground": "air+ground",   # expanded below
    "buildings": "buildings",
    "none": None,
    # Legitimately not an attack. Rage and Clone act on units without
    # targeting them as enemies, so they answer nothing and must not be
    # counted as an air answer or a splash answer.
    "all-units-in-area": "area-effect",
    "friendly-units-in-area": "friendly-effect",
    # Mirror copies the last card played, so its profile is whatever that was.
    "inherits": "inherits",
    # Spirit Empress: air troop at 6+ Elixir, ground troop below. Her targeting
    # is chosen by the player's Elixir bar at deployment, so there is no
    # deck-list answer. See `deck_harmony.SPECIAL`.
    "variable": "variable",
}

TRANSPORT = {
    "ground": "ground", "air": "air",
    "none": "none",          # spells and buildings do not travel
    "variable": "variable",
    "inherits": "inherits",
}

DAMAGE = {
    "single": "single",
    "splash": "area", "area": "area",          # SYNONYMS -- see the docstring
    "multi-target": "multi",
    "chip": "chip",
    "none": "none",
    "inherits": "inherits",
}

RANGE = {
    "melee": "melee",
    "short": "ranged", "long": "ranged", "ranged": "ranged", "medium": "ranged",
    "none": "none",
    "variable": "variable",
    "inherits": "inherits",
}

MOVEMENT = {
    "very-slow": "very-slow", "slow": "slow", "medium": "medium",
    "fast": "fast", "very-fast": "very-fast",
}

# Fields copied verbatim as lists of tokens. These are PROSE — they may name
# concepts ("any-splash", "cycle-decks") as well as cards, and the loader must
# treat them as data for a human, never as a score.
LIST_FIELDS = {
    "ROLE": "roles",
    "COUNTERS": "counters",
    "COUNTERED_BY": "counteredBy",
    "SYNERGY": "synergy",
    "ANTI_SYNERGY": "antiSynergy",
    "WEAK_TO": "weakTo",
    "REQUIRES": "requires",
    "NO_EFFECT_ON": "noEffectOn",
    "IMMUNE_TO": "immuneTo",
    "RESISTS": "resists",
    "RESETS": "resets",
    "KITES": "kites",
}


def parse_blocks(text: str) -> dict[str, dict[str, list[str]]]:
    """Every tag block keyed by card, with the manual's own skip rules applied.

    Three classes are skipped, all documented in the manual's Appendix B:

      * blocks with no `CARD:` line -- 19 fragments inside the recovered
        entries #001-#020. They are not card tag blocks and must be skipped
        rather than guessed at from position;
      * `SUPERSEDED_CARD:` blocks -- the legacy duplicates that Appendix A
        replaced. Retiring the key was how the duplicate and snake_case
        problems were fixed without editing 700,000 characters of prose;
      * snake_case keys -- none survive, but the normalisation is kept so a
        reintroduced one is folded rather than counted as a new card.
    """
    out: dict[str, dict[str, list[str]]] = {}
    for body in re.findall(r"```text\s*\n(.*?)```", text, re.S):
        m = re.search(r"(?m)^CARD:(\S+)\s*$", body)
        if not m:
            continue
        key = m.group(1).strip().lower().replace("_", "-")
        fields: dict[str, list[str]] = {}
        for line in body.splitlines():
            line = line.strip()
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            k, v = k.strip().upper(), v.strip()
            if not k or k.startswith("SUPERSEDED"):
                continue
            for tok in v.split(","):
                tok = tok.strip()
                if tok:
                    fields.setdefault(k, []).append(tok)
        if key in out:
            raise SystemExit("duplicate CARD: key %r — Appendix A should have "
                             "retired one of them" % key)
        out[key] = fields
    return out


def one(field: str, table: dict, values: list[str], card: str) -> list[str]:
    """Normalise every value of one field, refusing anything not in the table."""
    got = []
    for v in values:
        if v not in table:
            raise SystemExit(
                "%s: unknown %s value %r.\n"
                "  Add it to the table in scripts/build-card-roles.py, or fix\n"
                "  the manual. It is NOT passed through — an unrecognised value\n"
                "  silently excluded from a harmony check is exactly the failure\n"
                "  this script exists to prevent." % (card, field, v))
        n = table[v]
        if n is None:
            continue
        if n == "air+ground":
            got.extend(["air", "ground"])
        else:
            got.append(n)
    # Order-independent and de-duplicated: `air,ground` and `ground,air` are the
    # same fact and must produce the same JSON, or the --check diff is noise.
    return sorted(set(got))


def build(manual: str) -> dict:
    text = open(manual, encoding="utf-8").read()
    blocks = parse_blocks(text)

    cards = json.load(open(os.path.join(ROOT, "src", "data", "cards.json"),
                           encoding="utf-8"))
    if isinstance(cards, dict):
        cards = cards.get("items") or list(cards.values())
    roster = {c["key"] for c in cards}

    missing = sorted(roster - set(blocks))
    if missing:
        raise SystemExit("no tag block for: %s" % ", ".join(missing))
    extra = sorted(set(blocks) - roster)
    if extra:
        raise SystemExit("tag block for a card not in cards.json: %s"
                         % ", ".join(extra))

    out = {}
    for key in sorted(roster):
        f = blocks[key]
        targets = one("TARGETS", TARGETS, f.get("TARGETS", []), key)

        # A CARD CAN CARRY MORE THAN ONE ATTACK PROFILE, and reading only the
        # first one gets two cards materially wrong:
        #
        #   goblin-machine  a ground melee BODY plus an independently-firing
        #                   rocket that targets AIR. Reading only `TARGETS` it
        #                   looks ground-only -- but it is one of the very few
        #                   ground melee cards that does not need a separate
        #                   air answer, because it carries one on its back.
        #   goblinstein     two bodies: the Doctor (air and ground) and the
        #                   Monster (buildings). `TARGETS` describes the pair,
        #                   `BODY_n_TARGETS` describes each.
        #
        # Both were flagged by a check comparing `ROLE:anti-air` against
        # `hitsAir`, which disagreed on exactly these two.
        extra = []
        for tag in ("SECOND_WEAPON_TARGETS", "BODY_1_TARGETS", "BODY_2_TARGETS"):
            extra.extend(one("TARGETS", TARGETS, f.get(tag, []), key))
        if extra:
            targets = sorted(set(targets) | set(extra))

        rec = {
            "targets": targets,
            # DERIVED, and derived here rather than at every call site so the
            # rule lives in exactly one place. `variable` and `inherits` are
            # NOT air answers — they are unknowns, and `deck_harmony` reports a
            # deck containing one as incompletely checked rather than passing it.
            "hitsAir": "air" in targets,
            "transport": (one("TRANSPORT", TRANSPORT, f.get("TRANSPORT", []), key)
                          or ["none"])[0],
            "damage": (one("DAMAGE", DAMAGE, f.get("DAMAGE", []), key)
                       or ["none"])[0],
            "range": (one("RANGE", RANGE, f.get("RANGE", []), key)
                      or ["none"])[0],
        }
        mv = one("MOVEMENT", MOVEMENT, f.get("MOVEMENT", []), key)
        if mv:
            rec["movement"] = mv[0]
        for tag, name in LIST_FIELDS.items():
            vals = [v for v in f.get(tag, []) if v not in ("none", "unknown")]
            if vals:
                rec[name] = sorted(set(vals))
        if f.get("VERIFIED"):
            rec["verified"] = f["VERIFIED"][0]
        out[key] = rec

    return {
        "$comment": "GENERATED by scripts/build-card-roles.py from "
                    "Deckkies_Master_Card_Manual.md. Do not hand-edit; re-run "
                    "the script. Flags (can_evolve / can_be_hero / is_champion "
                    "/ is_win_condition) live in cardMeta.json and are "
                    "deliberately NOT duplicated here. Elixir and rarity are "
                    "cards.json's. This file carries no numbers by design.",
        "version": 1,
        "source": os.path.basename(manual),
        "cards": out,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manual", default=DEFAULT_MANUAL)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(a.manual):
        raise SystemExit("manual not found: %s" % a.manual)

    data = build(a.manual)
    text = json.dumps(data, indent=2, sort_keys=False, ensure_ascii=False) + "\n"

    if a.check:
        if not os.path.exists(OUT):
            print("cardRoles.json missing — run without --check")
            return 1
        cur = open(OUT, encoding="utf-8").read()
        if cur != text:
            print("cardRoles.json is STALE — re-run scripts/build-card-roles.py")
            return 1
        print("cardRoles.json is up to date (%d cards)" % len(data["cards"]))
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(text)

    c = data["cards"]
    print("wrote %s" % os.path.relpath(OUT, ROOT))
    print("  %d cards" % len(c))
    print("  %d answer air" % sum(1 for v in c.values() if v["hitsAir"]))
    print("  %d deal area damage" % sum(1 for v in c.values() if v["damage"] == "area"))
    print("  %d need a special case (variable/inherits): %s"
          % (sum(1 for v in c.values()
                 if "variable" in v["targets"] or "inherits" in v["targets"]),
             ", ".join(sorted(k for k, v in c.items()
                              if "variable" in v["targets"]
                              or "inherits" in v["targets"]))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
