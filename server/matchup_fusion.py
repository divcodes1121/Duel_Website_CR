"""One matchup rate from the ladder AND the duels, at the level of the version.

WHY THIS EXISTS (2026-09-27)
============================

Asked for directly: "log bait has so many versions, each card brings the
matchup up and down, and it's just using one deck and using it all", and "the
prediction should use all the non-duel ranked matchups and the duel rows both,
collaboratively, and then weight them".

Both were true of the engine that shipped. `team_scout.score` asked for one
rate per ARCHETYPE of the threat, so every Log Bait list an opponent might
bring was the same number; and the ladder and the duels were two separate
brains, printed side by side and never combined.

This module is the combination, and it is pure — it imports nothing, so every
rule below is testable against literals. The evidence comes in
from `team_analysis`; this only weighs it.

THE ESTIMATOR, AND WHERE EVERY NUMBER CAME FROM
==============================================

A chain of shrinkage steps, each pulling the evidence at one level toward the
estimate from the level above it:

    p0  the archetype matrix              (win condition vs win condition)
    p0' <- this list's one-card variants vs the archetype  K_CLUSTER = 10
    p1  <- this list vs the threat's archetype      K_ARCH    = 100
    p2  <- this list vs the threat's one-card family K_FAMILY  = 30
    p3  <- this list's one-card family vs the threat K_VERSION = 30

and at every level a duel game counts ALPHA = 4 ladder games, with the duel
result taken as pilot-adjusted wins (`duel_brain`: who flew it is taken out).

All five weights (ALPHA and the four K's) were FITTED, not chosen, on a
temporal holdout of real duel games (train before 2026-09-13; fitted on the
week after, reported on the week after that, 10,839 held-out games). Log loss,
lower is better:

    ladder list vs archetype (the engine that shipped)     0.6873
    fused at the archetype level (p1)                       0.6838
    + list vs the threat's one-card family (p2)             0.6814
    + the list's family vs the exact threat (p3)            0.6798
    + the list's variants as the prior (p0')                0.6793

THIS MODULE'S OWN CODE WAS RUN ON THOSE ROWS, not a re-implementation of it:
`fused()` scored 0.6798 on the same 10,839 games before p0' was added, exactly
the research figure. p0' is the ladder's own `cluster7` rung, which the engine
that shipped already used for a thin list; leaving it out would have been a
small regression hiding inside a large improvement.

Where the threat is a popular list the gain is four times that — 0.6773 to
0.6582 — and where version-level games exist at all, 0.6760 to 0.6587.

Two things the holdout also settled, so nobody re-litigates them:

* **The exact pair is not its own level.** Fitted alone it wanted K = 1000,
  i.e. almost no weight: the exact pairing is too sparse to beat the family it
  sits in. It is counted inside both family levels instead.
* **A hub proxy loses a sixth of the version gain.** Standing a threat in for
  the nearest popular list scored 0.6818 against the true family's 0.6814,
  which is why the families are read, not approximated.

WHAT EACH OUTPUT MEANS
======================

`fused()` returns `winRate` (0-100, the site's unit), `games` — the evidence at
the deepest level that has any, in ladder-game units — and `source`:

    "version"    8+ games at the version levels (this list or its variants
                 against this exact threat, or this list against the threat's
                 variants), ladder and duels together
    "deck"       8+ games of this list against the threat's archetype
    "cluster7"   8+ games of this list's one-card variants against it
    "archetype"  the matrix, and nothing narrower

and None when there is nothing at all — no matrix cell with 8 games and no
evidence at any level — which `team_scout.score` counts as unanswered rather
than as 50%. The confidence tier is NOT decided here: the caller hands the
fused rate and its games to `duel_combos.confidence_tier`, the site's one rule,
which makes no claim at all under its floors.
"""
from __future__ import annotations

FUSION_VERSION = "fusion-1.0"

#: One duel game is worth this many ladder games. Fitted (grid 0..8).
ALPHA = 4.0
#: Prior weight on the archetype matrix for this list's one-card variants vs an
#: archetype (the ladder's `cluster7` rung, the list itself taken out). Fitted:
#: low, because a cluster is usually hundreds of games of near-copies and the
#: matrix is every list of the archetype.
K_CLUSTER = 10.0
#: Prior weight on p0' for this list vs an archetype. Fitted.
K_ARCH = 100.0
#: Prior weight on p1 for this list vs the threat's one-card family. Fitted.
K_FAMILY = 30.0
#: Prior weight on p2 for this list's one-card family vs the exact threat.
K_VERSION = 30.0
#: A matrix cell needs this many games to be a prior at all
#: (`deck_counter.MIN_GAMES`, the site-wide floor for a rate).
MATRIX_MIN = 8
#: Evidence at a level needed to NAME that level as the source.
SOURCE_MIN = 8.0

SOURCE_VERSION = "version"
SOURCE_DECK = "deck"
#: The ladder's own name for "this list's one-card variants vs the archetype",
#: so `team_scout.SOURCE_STRENGTH` already has a weight for it.
SOURCE_CLUSTER = "cluster7"
SOURCE_ARCHETYPE = "archetype"


def _pair(x) -> tuple[float, float]:
    """`(games, wins)` from a pair or None, never negative."""
    if not x:
        return 0.0, 0.0
    n, w = float(x[0] or 0), float(x[1] or 0)
    if n <= 0:
        return 0.0, 0.0
    return n, min(max(w, 0.0), n)


def step(prior: float, ladder, duel, k: float, alpha: float = ALPHA) -> tuple[float, float]:
    """One shrinkage step: `(new estimate, evidence used)`.

    `ladder` is `(games, wins)`, `duel` is `(games, pilot-adjusted wins)`; a
    duel game carries `alpha` times the weight. With no evidence the prior
    comes back unchanged, so a missing level costs nothing.
    """
    ln, lw = _pair(ladder)
    dn, dw = _pair(duel)
    n = ln + alpha * dn
    if n <= 0:
        return prior, 0.0
    w = lw + alpha * dw
    return (w + k * prior) / (n + k), n


def fused(matrix, *, cluster=None, arch_ladder=None, arch_duel=None, fam_ladder=None,
          fam_duel=None, ver_ladder=None, ver_duel=None) -> dict | None:
    """The fused rate for ONE candidate list against ONE threat.

    `matrix` is `(rate 0..1, games)` for the two archetypes, or None. Every
    other argument is `(games, wins)` — pilot-adjusted wins for the duel ones —
    or None when that evidence was not read. KEYWORD-ONLY on purpose: seven
    arguments of one shape are one transposition away from a plausible wrong
    number, and this module's own first test made exactly that mistake.
    Returns None when there is nothing to go on.
    """
    have_matrix = bool(matrix) and float(matrix[1] or 0) >= MATRIX_MIN
    p = float(matrix[0]) if have_matrix else 0.5
    p, n0 = step(p, cluster, None, K_CLUSTER)
    p, n1 = step(p, arch_ladder, arch_duel, K_ARCH)
    p, n2 = step(p, fam_ladder, fam_duel, K_FAMILY)
    p, n3 = step(p, ver_ladder, ver_duel, K_VERSION)
    if not have_matrix and n0 + n1 + n2 + n3 <= 0:
        return None
    version = n2 + n3
    if version >= SOURCE_MIN:
        source, games = SOURCE_VERSION, version
    elif n1 >= SOURCE_MIN:
        source, games = SOURCE_DECK, n1
    elif n0 >= SOURCE_MIN:
        source, games = SOURCE_CLUSTER, n0
    else:
        source, games = SOURCE_ARCHETYPE, float(matrix[1]) if have_matrix else n0 + n1
    p = min(max(p, 0.0), 1.0)
    return {
        "winRate": round(100.0 * p, 1),
        "games": int(round(games)),
        "source": source,
        "levels": {"cluster": round(n0, 1), "archetype": round(n1, 1),
                   "family": round(n2, 1), "version": round(n3, 1)},
        "brain": FUSION_VERSION,
    }

