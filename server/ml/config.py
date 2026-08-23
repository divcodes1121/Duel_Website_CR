"""Tunables for the evaluation harness. Every one is env-overridable.

Values that already exist elsewhere in the project are IMPORTED, never
re-declared — a second copy of the clustering rule is exactly how the harness
would end up measuring a different system from the one that ships.
"""
from __future__ import annotations

import os

# The clustering rule, from the module that owns it. Not a local 6.
from duel_zone import COUNTER_MIN_OVERLAP as CLUSTER_MIN_OVERLAP  # noqa: F401

# The evidence floor the rest of the project uses for "enough to quote a rate".
from duel_combos import CONF_MIN_GAMES  # noqa: F401

DECK_SIZE = 8


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


# A cluster needs this many prior plays before a step is scored. Below it the
# "history" is too thin for modal and recent to even differ meaningfully.
MIN_CLUSTER_HISTORY = _int("CLASH_ML_MIN_CLUSTER_HISTORY", 5)

# A player needs this many eligible battles in a domain to be evaluated at all.
MIN_PLAYER_BATTLES = _int("CLASH_ML_MIN_PLAYER_BATTLES", 20)

DEFAULT_PLAYERS = _int("CLASH_ML_PLAYERS", 400)
BOOTSTRAP_ITERS = _int("CLASH_ML_BOOTSTRAP", 2000)
BOOTSTRAP_SEED = _int("CLASH_ML_SEED", 20260818)
CI_PERCENT = 95

# How many players to pull per batched SQL query. One query per battle would be
# fatal on a spinning volume; one query per player is fine but chatty.
PLAYER_BATCH = _int("CLASH_ML_PLAYER_BATCH", 12)

DOMAINS = ("competitive", "duel")
