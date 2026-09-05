# MECHANISM — how the prediction and recommendation actually work

What the system is, what it is thinking at each step, where every number comes
from, what it refuses to do and why, the flaws found on 2026-09-02, what can be
fixed today with no new data, and what a hand-authored card knowledge base would
unlock.

Companion to `README.md` (the narrative record) and `server/README.md` (the
operational half). This file is the **mechanism**: the reasoning chain, end to
end, at the level of individual functions and constants.

---

## Table of contents

1. [The one rule everything rests on](#1-the-one-rule-everything-rests-on)
2. [Two engines, unrelated](#2-two-engines-unrelated)
3. [The file map](#3-the-file-map)
4. [Step 1 — reading a player's history](#4-step-1--reading-a-players-history)
5. [Step 2 — the opening read](#5-step-2--the-opening-read)
6. [Step 3 — what is left after a reveal](#6-step-3--what-is-left-after-a-reveal)
7. [Step 4 — the loadout record, which is not a prediction](#7-step-4--the-loadout-record-which-is-not-a-prediction)
8. [Step 5 — the recommendation](#8-step-5--the-recommendation)
9. [The evidence ladder, in full](#9-the-evidence-ladder-in-full)
10. [Symmetrisation, and the mirror test](#10-symmetrisation-and-the-mirror-test)
11. [How "generation" works today — it does not generate](#11-how-generation-works-today--it-does-not-generate)
12. [The frozen ML engine (OIE)](#12-the-frozen-ml-engine-oie)
13. [What is deliberately not modelled, with the numbers](#13-what-is-deliberately-not-modelled-with-the-numbers)
14. [Five flaws found on 2026-09-02](#14-five-flaws-found-on-2026-09-02)
15. [What can be fixed right now, with no new data](#15-what-can-be-fixed-right-now-with-no-new-data)
16. [The card knowledge base — what it would unlock](#16-the-card-knowledge-base--what-it-would-unlock)
17. [The trade-offs, stated honestly](#17-the-trade-offs-stated-honestly)
18. [Cost and cache constraints that shape any design](#18-cost-and-cache-constraints-that-shape-any-design)
19. [Future plans, in order](#19-future-plans-in-order)
20. [Constant reference](#20-constant-reference)

---

## 1. The one rule everything rests on

> **A duel loadout is three decks that cannot share a card.**

That is what makes any of this predictable. Every deck revealed removes eight
cards from what a player can still bring, and by game 3 the field is usually down
to a handful of lists they actually own.

**This is physics, not habit.** It is the only part of the system that survives
an opponent who deviates completely from their history. If they played Fireball
in game 1 they cannot play it in game 3, however much they are adapting to you.

Verified absolute against `battle_raw.rounds`: **21,432 deck pairs, zero
overlap.** There is no exception in the data.

Nothing in this system models a personality. It is the card constraint, plus
that player's own history, plus measured matchup records. Where a claim cannot be
grounded in one of those three, it is not made.

---

## 2. Two engines, unrelated

There are two things in this repository that could be called "prediction". They
share no code and answer different questions.

| | **Coach Assist** | **OIE (`ml/`)** |
|---|---|---|
| lives in | `server/coach.py` | `server/ml/production/` |
| status | **live, shipped** | **flagged off** (`CLASH_OIE=off`) |
| method | deterministic — constraint + history + measured matchups | statistical, 24 research phases |
| answers | which decks are still legal, and what to bring | "the most recent deck", plus a confidence word |
| trains | never — there is no model | offline only; `forbid_training()` replaces `fit` with a raise |
| research | open | **CLOSED** — `ml/evaluation/phase22-final-spec.md` is the contract |

**Everything a user sees today comes from the first column.** The OIE is
additive, flagged, and structurally unable to change a prediction
(`policy.enforce_primary()` runs last and unconditionally).

---

## 3. The file map

```
server/
├── coach.py            1,130 lines — BOTH Coach Assist windows
│   ├── _history()          one DB read per (tag, since, until), 120 s TTL
│   ├── opening_decks()     what they open a duel with
│   ├── next_decks()        what is still legal after n reveals
│   ├── observed_sequences() the real loadouts they have run
│   ├── opponent_next()     their likely next deck, as a distribution
│   ├── win_prob()          P(mine beats theirs), lazily laddered
│   ├── _expected()         expected win rate over the distribution
│   ├── suggest()           the recommendation
│   └── _read()/_caveats()  the prose, narrating evidence only
│
├── duel_zone.py        the deck-ranking primitives coach imports
│   ├── decks_match()           6-of-8 identity rule
│   ├── cluster_player_decks()  merge variants, keep a real representative
│   ├── build_series()          rows -> duel series
│   ├── predict_companions()    the candidate pool
│   ├── rank_companions_by_series()  co-occurrence re-rank
│   ├── observed_duel_loadout() their real three-deck bag for an opener
│   └── pick_duel_legal_sequence()  greedy disjoint triple
│
├── deck_counter.py     ALL the win rates come from here
│   ├── deck_profile()       this exact list vs all 17 archetypes
│   ├── cluster_profile()    lists 1 or 2 cards different
│   ├── exact_pair()         these two exact lists, head to head
│   ├── _siblings()          scan 1,054,394 hashes for >=6 shared cards
│   ├── _symmetric()         cancels the 58.6% tracked-player bias
│   ├── matchup_ladder()     every rung, for display
│   ├── find_counters()      which archetypes beat this deck
│   └── _representatives()   a real deck per archetype
│
├── duel_combos.py      read_duel_rows() — the single duel reader
├── meta.py             the population fallback board
└── ml/production/      the OIE, flagged off

src/
├── data/cards.json         122 cards: key, name, elixir, type, rarity, arena,
│                           description, id      <- NO targets/damage/transport
├── data/cardMeta.json      can_evolve / can_be_hero / is_champion /
│                           is_win_condition
├── components/Analytics/CoachAssist.tsx   1,452 lines, both interviews
└── state/analyticsClient.ts               the typed client
```

Routes, in `server/app.py`:

```
GET /api/analytics/coach/predict/<tag>?r1=&r2=&days=
GET /api/analytics/coach/suggest?me=&opp=&m1=&m2=&o1=&o2=&days=
GET /api/analytics/coach/opponent-read/<tag>          (OIE, off by default)
```

---

## 4. Step 1 — reading a player's history

`coach._history(tag, since, until)`.

**One database read serves everything both windows need.** It calls
`duel_combos.read_duel_rows()` — the same single reader `duel_combos` and
`duel_zone` already share, so the Coach cannot end up describing a different set
of duels from the Duel Zone screen for the same player.

### What comes back

| key | meaning |
|---|---|
| `series` | duel series, built by `dz.build_series` |
| `seriesDecks` | `[[deck, deck, deck], ...]` — the loadouts |
| `allDecks` | every deck played, flat |
| `firsts` | game-1 decks, **from ordered series only** |
| `arch` | a closure: cards -> archetype |
| `marks` | a closure: cards -> observed evolution/hero marks |

### Archetypes are READ, never recomputed

`arch_by_sig` is populated from the stored `archetype` column on each row. A
second classifier here would eventually disagree with the one every stored
battle was labelled by. Only when a signature is unknown does it fall through to
`counter.archetype_of()`.

### Ordered vs native — the distinction that decides what can be claimed

* **Reconstructed series** (friendly/practice): one row per game, so row order
  **is** time order. These can answer "what do they open with".
* **Native duel rows**: the whole three-deck loadout in one row. The bot records
  that its 8-card blocks are *"not proven chronological"*. Block 1 is not
  necessarily game 1.

Measured across the twelve most-played tags:

| | |
|---|---:|
| duel series | 759 |
| reconstructed (ordered) | **718 (94.6%)** |
| full ordered three-game series | 587 |
| native (loadout only) | 41 |

So the opening question is answerable for almost everybody on this data — the
opposite of the bot's situation, and the reason the fallback rarely fires.

### The window

`days` counts back from **that player's last stored battle**, not from today —
the site-wide convention, and the reason someone who stopped a month ago still
gets a populated screen. In the Suggestion window it is resolved **separately per
tag**, so one "30 days" means thirty days of *each* player's play.

Options are 15 / 30 / 45 / 60, default 30. It changes the answer materially:

| window | series | games | top predicted deck |
|---|---:|---:|---|
| 15d | 45 | 132 | mortar / goblinstein / elite-barbarians |
| 30d | 90 | 271 | elite-barbarians / valkyrie / battle-ram |
| 45d | 122 | 357 | baby-dragon / berserker / royal-hogs |
| 60d | 139 | 407 | baby-dragon / berserker / royal-hogs |

**Nothing widens itself.** A 15-day window can legitimately come back thin, and
`summary` / `evidence` report what it actually held. There is no automatic
fallback to a longer span — the cap is the control, and silently ignoring it
would make the control a lie.

### Caching

`_HISTORY_TTL_S = 120.0`, `_HISTORY_MAX = 32`, keyed on `(tag, since, until)`.
Both windows are **stepwise** — the user answers "has it started", pastes deck 1,
pastes deck 2 — and each step asks the same question of the same tag. The read is
~3–6 s uncached, so without this every click would pay it again.

---

## 5. Step 2 — the opening read

`coach.opening_decks(tag, hist)`.

```
if len(hist["firsts"]) >= MIN_FIRST_SERIES (3):
    observations = their game-1 decks       basis = "first-game history"
else:
    observations = every duel deck          basis = "overall play rate"

decks = dz.cluster_player_decks(observations, FIRST_MAX_DECKS=6, len(obs), ...)
```

**`basis` is the honesty of the whole screen.** "They open with this" and "they
play this a lot" are different claims and only one of them is about game 1. The
UI states which.

`lowConfidence` fires on **two separate causes**, and they are not merged into
one flag: fewer than 4 observations, **or** the fallback basis.

### How clustering works — `dz.cluster_player_decks`

1. Tally **exact** lists by signature (sorted card keys joined by comma).
2. Walk them most-played first; place each into the first cluster sharing
   `COUNTER_MIN_OVERLAP` (**6**) cards with that cluster's representative.
3. The representative is the cluster's **most-frequent exact variant** — never a
   synthetic average. *A deck that was never played is not a deck they can
   bring.*
4. Sort by count; ties break on the deck signature, never on dict order.

Probabilities are over a caller-supplied `denominator`, so the caller decides
whether "share of all duel decks" or "share of candidates" is being asked.

---

## 6. Step 3 — what is left after a reveal

`coach.next_decks(tag, revealed, hist)`. One reveal predicts game 2; two predict
game 3.

### The candidate pool — `dz.predict_companions`

```python
companions = [
    deck for deck in player_decks
    if all(len(set(deck) & revealed_set) <= PREDICT_COMPANION_MAX_SHARED   # 2
           for revealed_set in revealed_sets)
]
decks = cluster_player_decks(companions, PREDICT_COMPANION_POOL=10, ...)
return rank_companions_by_series(decks, series_decks, revealed)
```

**Why 2 and not 0.** This is a *prediction* off noisy pooled history, so a little
tolerance absorbs cross-loadout noise while still excluding the revealed deck and
its near-mirrors. A *recommendation* uses 0 — see §8.

**Why a pool of 10.** Measured: a 3-deck shortlist contained a legal
card-disjoint pair only **59%** of the time; the full pool **99%**.

### The re-rank that makes the answer situational — `rank_companions_by_series`

Clustering alone ranks by overall play count, which makes every answer the same
regardless of the opener — the player's two most-played decks. On the bot's
sequence page that printed the **same pair on 63% of rows**.

```python
score = CO_WEIGHT * co_occurrences + overall_count      # CO_WEIGHT = 3
```

A deck that actually appeared in a series alongside the revealed deck is direct
evidence of the loadout, so it is worth 3 appearances anywhere else. Measured
leak-free on 839 real 3-game series: naming at least one true companion rose
**16.6% -> 23.6%**, and repeated rows fell **63% -> 8%**.

`coRevealed` is returned to the UI because the ranking is driven by it — without
it the list looks mis-sorted against the usage figures.

### Renormalisation

```python
total = sum(d["count"] for d in decks) or 1
d["prob"] = d["count"] / total
```

Over the **candidates**, not over all their duel decks. The question is "which of
these"; a column summing to 23% reads as an error even when each figure is
individually defensible.

### The derived odds tables

* `_card_odds()` — probability-weighted across candidate decks, **not counted**,
  so a card in the front-runner outranks a card in three long shots. Top 8.
* `_archetype_odds()` — the same, grouped by archetype. Top 4. *The shape of the
  game they will play.*

---

## 7. Step 4 — the loadout record, which is not a prediction

`coach.observed_sequences(revealed, hist)`.

Everything else ranks what a player *could* bring. This ranks nothing: it goes
back through their duel log and returns the **whole three-deck loadouts they have
actually run that contain the pasted deck**, grouped, counted, with the win
record and the date.

Where it finds anything it is the strongest statement the screen can make,
because it is not a prediction at all.

### Matched anywhere in the loadout, not anchored to game 1

The first version anchored on game 1 — "when they *opened* with this they
followed it with that" is the sharper claim. It is, and it is the wrong question:
a coach pastes the deck they have just *seen*, which is game 2 as often as
game 1. Measured over 40 decks these players really ran:

| | |
|---|---:|
| anchored at game 1 | 62 series found |
| decks returning **nothing at all** under the anchor | **20 of 40** |
| matched anywhere in the loadout | **224 series** |

Every one of those 20 has a recorded loadout. The screen said "he has a duel set
where he played this deck" over a blank panel.

### Native rows count for membership, not for order

A native row's 8-card blocks are not proven chronological. That makes the
**order** unusable, not the **membership** — and membership is most of the
answer, because a loadout is three decks that go together. Those series are
included and flagged `ordered: false`, so the UI prints "game order not
recorded" rather than inventing a sequence.

### Grouping — `_cluster_loadouts`

Series are clustered **position by position** at the same 6-of-8 rule, so a tech
swap in game 2 does not split one habit into two. Each group reports
`3x run · 1W-2L · last 11 Aug` — the difference between "they do this" and "they
do this and it works".

The representative at each position is the group's **most-played exact variant**.
Sorts are stable and least-significant-first: most-run wins, ties go to most
recent, ties on both break on the deck signature.

`exact` is true only if every member matched card-for-card. On one account's top
opener only **2 of 7** matches were exact.

For ~**85%** of opener rows the player has a full three-game series that used
that deck — so the rest of the bag is a **fact** rather than a ranking.

---

## 8. Step 5 — the recommendation

`coach.suggest(my_tag, opp_tag, my_played, opp_played, ...)`.

### The full chain

```
stage        = max(len(my_played), len(opp_played))
used_mine    = union of every card I have already played
snap         = counter._snap()                  the archetype matrix snapshot

── THEIR SIDE ────────────────────────────────────────────────────────────
opp = opponent_next(opp_tag, opp_played, opp_hist)
      pool     = next_decks(...) if they have revealed something
                 else opening_decks(...)
      legal    = _legal(pool, used_theirs)          <- 0 shared cards
      if empty -> _population_decks()  (meta board)  source = "population"
      top      = legal[:OPP_TOP_DECKS = 3]
      if thin  -> _fills(top, used, 3 - len(top))    source = "...+population"
      mass     = OPP_HISTORY_MASS (0.7) if fills else 1.0
      prob     = mass * count / total          (their own decks)
      prob     = (1 - mass) * count / total    (meta fills)

── MY SIDE ───────────────────────────────────────────────────────────────
pool  = next_decks(my_tag, my_played, mine_hist) if my_played
        else opening_decks(my_tag, mine_hist)
mine  = _legal(pool, used_mine)                 <- RECOMMEND_MAX_SHARED = 0
if len(mine) < MY_TOP_DECKS (3):
    mine += _fills(mine, used_mine, 3 - len(mine))     <- META DECKS

── SCORING ───────────────────────────────────────────────────────────────
for md in mine:
    md["expected"] = _expected(md["cards"], opp["decks"], snap)

if any deck scored:
    sort by (-winRate, -count, signature)      basis = "expected win rate"
else:
    sort by (-count, signature)                basis = "how much you play it"
```

### `_legal` — a recommendation is stricter than a prediction

```python
RECOMMEND_MAX_SHARED = 0      # vs the predictor's 2
```

The companion predictor tolerates two shared cards because it reads noisy
history. A deck we tell someone to play **next** must share **zero** — they
physically cannot play it otherwise. The bot shipped the looser rule into its
recommendations once and told a player to bring a Golem deck repeating Lightning
and Baby Dragon.

### `_expected` — the scorer, and its one structural weakness

```python
num = den = 0.0
per = []
for od in opp_decks:
    w = od["prob"] or (1 / len(opp_decks))
    m = win_prob(mine, od["cards"], snap)
    per.append({"cards": od["cards"], "prob": w, "matchup": m})
    if m:                       # UNSCORABLE PAIRINGS ARE DROPPED
        num += w * m["winRate"]
        den += w
return {"winRate": num / den, "weight": den, "per": per}
```

**An unscorable matchup is dropped, never guessed at 50%.** An invented coin flip
drags a real edge toward the middle and makes two genuinely different candidates
look alike. The surviving probability mass is returned as `weight` so a reader
can discount the figure.

**This is a probability-weighted MEAN.** That is the flaw discussed in §14.1 —
a deck that crushes their most-likely list and loses to the other two can still
rank first.

Note `per` already carries **every individual matchup**. The worst case is
present in the returned structure and simply unused.

### `_fills` — where "generalized decks" come from

```python
def _fills(existing, used, need):
    for d in _legal(_population_decks(), used):      # meta board top 24
        if any(len(set(d["cards"]) & e) >= MIN_OVERLAP for e in seen):
            continue                                 # skip variants
        out.append(d)
```

When the player's own legal pool cannot fill three rows, the list is topped up
with **meta decks** — decks somebody else plays. They are flagged `fill: True`,
labelled "meta deck" in the UI, and their probability mass is capped at
`1 - OPP_HISTORY_MASS = 30%` on the opponent side.

**This is the single weakest part of the feature**, and it is exactly the
"generalized deck" complaint: at the moment the reader has least history, the
screen stops being about them.

### `_read` — the prose, and its constraint

Every line is either a fact we hold or the ranking already computed. It must not
imply a sharper read than the numbers support — which is a *measured* position,
not a stylistic one (see §13).

Confidence is graded out loud from the margin:

| |edge| from 50 | wording |
|---|---|
| >= 15 | "a real edge in this matchup" |
| >= 6 | "a slight edge — winnable either way" |
| < 6 | "close to a coin flip, so play the one you pilot best" |

And the spread of their distribution:

| top deck probability | wording |
|---|---|
| >= 0.50 | "a clear favourite" |
| >= 0.30 | "the front-runner" |
| < 0.30 | "a wide field — treat this as a lean" |

### `_caveats` — every reason the answer may be weaker than it looks

Listed separately rather than folded into one flag nobody can interrogate: no
opponent history; fewer than `MIN_DUEL_GAMES` (6) stored; a meta-topped-up list
(only for the **blend**, not for a pure population read — saying both made a
no-data read sound like a partial one); no history for you either; and a
`basis` that is not "expected win rate".

---

## 9. The evidence ladder, in full

**Every win rate in the system comes from here.** `coach.win_prob(mine, theirs,
snap)` walks it and stops at the first rung with evidence.

| # | rung | source constant | what it counts | availability |
|---|---|---|---|---|
| 1 | exact pair | `SOURCE_EXACT` | these two exact lists have met | **0.59%** of pairings reach the floor |
| 2 | deck vs archetype | `SOURCE_DECK` | this exact list vs every deck of that archetype | any deck with real play |
| 3 | 7-card cluster | `SOURCE_C7` | lists **one card different** | broad |
| 4 | 6-card cluster | `SOURCE_C6` | lists **two cards different** | broader |
| 5 | archetype matrix | `SOURCE_ARCHETYPE` | win condition and nothing else | always |

Scale, measured on the most-played Hog list:

| | |
|---|---:|
| decks sharing 7+ cards | 1,405 (69,736 games) |
| decks sharing 6+ cards | 4,439 (77,381 games) |
| that list's own battles | 111,663 |

So the rungs are real evidence, not a smoothing trick.

### Lazy, and that is not a micro-optimisation

`matchup_ladder()` builds **every** rung because its caller (the Deck Counter
screen) displays the whole backoff. The >=7 cluster scan costs **11.6 s cold**
against **0.17 s** for the deck's own profile. The Coach asks for a grid — up to
six of my decks against three of theirs — so building rungs nobody reads took
`suggest` to **25.7 s**. Stopping at the first answer takes it to **~1.4 s**, and
the answer is identical: the head of the ladder is the reading either way.

### The rung that makes a NOVEL deck scorable

**A deck nobody has ever played still has siblings.** `_siblings()` scans all
**1,054,394** stored deck hashes for anything sharing >= 6 cards — it is defined
by card overlap against the whole vocabulary, not by the subject deck having been
played. So rungs 3 and 4 work on a list that has never existed.

Rung 1 and rung 2 are gone for a novel deck. Rung 5 is card-blind. **Rungs 3 and
4 are the entire reason construction is possible at all** — and they are the
expensive ones.

### Evidence floors

* `MIN_GAMES = dx.CONF_MIN_GAMES = 8` — below this a rung is silently absent
  (not shown at a low confidence; **absent**).
* `BASELINE_MIN_BATTLES = 50` — before a deck's own overall record is used as the
  baseline counter advantages are measured against. Far above `MIN_GAMES`,
  because this figure pools every archetype and is then subtracted from all of
  them, so an error in it moves every row.

---

## 10. Symmetrisation, and the mirror test

`pair_matchup_agg.deck_a` is **the tracked player's side**. Tracked players win
more than the population — measured at **58.6%** — so raw forward rows make
everything look like a counter.

```python
w = forward.wins   + reverse.losses
l = forward.losses + reverse.wins
d = forward.draws  + reverse.draws
# crowns and three-crown counts swapped identically
```

**The check is that every mirror lands at exactly 50.0%.** A deck's overall
record across the whole field comes out at **49.9%**, not 58%.

This is applied at every rung: `deck_profile` folds the reverse direction in;
`_cluster_all` runs both joins; `exact_pair` builds a two-cell snapshot and calls
`_symmetric` on it.

**Consequence for anything built on top:** never read `pair_matchup_agg`
directly. Go through `deck_counter`, or the 58.6% bias comes back.

---

## 11. How "generation" works today — it does not generate

This is the crux of the "not unique" complaint, stated plainly.

**There is no deck construction anywhere in this system.** What the Suggestion
window does is **selection**:

```
candidates = decks THIS PLAYER has already played  (clustered, 6-of-8)
           filtered to zero card overlap with what they have spent
           topped up with META DECKS if fewer than 3 survive
ranked by expected win rate against the opponent's predicted distribution
```

Three consequences follow directly:

1. **It can only ever return a deck you already own.** By design — the site
   refuses to recommend a list nobody has piloted, the same rule
   `team_analysis` follows with `MIN_COMFORT_GAMES = 5`.
2. **When your history is thin it returns the meta.** `_fills` reaches for
   `meta_board.board()`. Those are the most-played ladder decks — the most
   generic object in the entire dataset.
3. **It has no idea what a card does.** `cards.json` carries elixir, type,
   rarity, arena and flavour text. There is **no `targets`, no `damage` shape,
   no `transport`**. So the question "does this deck have an answer to air" is
   not computable from anything in the repository. Nothing in the system reasons
   about *function* — only about identity (6-of-8), archetype (win condition),
   and measured outcomes.

That third point is the whole gap. Every "smart" behaviour discussed below needs
it and cannot be faked from what exists.

---

## 12. The frozen ML engine (OIE)

`CLASH_OIE` — `off` (default) / `shadow` / `on`. **Research is CLOSED.**
`ml/evaluation/phase22-final-spec.md` is the contract, enforced by
`test_ml_22_final.py` (66 checks).

Twenty-four phases reduce to one sentence:

> The opponent's most recent deck is the prediction. The model layer may add a
> confidence signal and optional secondary suggestions, and may **never** replace
> it.

`policy.enforce_primary()` runs **last and unconditionally**. If any path
produces a primary that is not the most recent deck it is reset and the result
marked `degraded`. Phases 4, 5, 6 and 7 each tried letting a model overrule
Recent; each lost. The design makes that outcome *unreachable* rather than
merely unlikely.

### The seven production rules

| rule | enforcement |
|---|---|
| 1 | the primary is Recent — `enforce_primary`, applied last |
| 2/3 | anything goes wrong -> `safe_fallback`, the current deck, stated plainly |
| 4 | less confidence -> **fewer** alternatives (`ALTERNATIVE_CAPS` 2/1/0) |
| 5/6 | `assert_no_future` — nothing at or after the prediction moment |
| 7 | `forbid_training` replaces `fit` with a raise on every loaded model |
| + | `degraded: true` implies `alternatives: []`, enforced twice |

### What may never be displayed

`policy.BAND_ACCURACY` and `calibration.expected_accuracy()` are **internal
diagnostics and are disproved**:

| band | claimed | measured |
|---|---|---|
| competitive high | 90.5% | **69.1%** (19D, n=343) |
| competitive medium | 73.3% | **55.0%** (n=20) |
| practice high | 92.1% | **65.4%** macro over 11,152 steps |
| practice medium | 75.8% | **69.7%** macro — *above* high |

Practice's bands **do not rank**, so `BAND_SUPPORTED` withholds them entirely,
and the alternatives with them (the 2/1/0 cap is justified by the bands meaning
something). Confidence ships as a **word**, never a number. `changeProbability`
is a logistic score measured at ECE 0.2806 / 0.6097 and does not cross the API
boundary.

### The domain is `practice` and contains no duels

`is_duel_like_mode` admits any mode containing "friendly"; `_rows_to_plays` drops
any row that is not exactly 8 distinct cards. Both are right. Together they admit
practice and discard every real duel — of 1,238 native rows in one census,
**zero** carry 8 cards.

---

## 13. What is deliberately not modelled, with the numbers

These are **ceilings**, not model failures. A better model cannot move a ceiling.
Each one closed a branch that looks obviously worth doing.

### Counter-sniping — closed

*"They just showed Hog, so they will bring the anti-Hog deck next."*

Measured on **3,569 leak-free trials**: top-1 accuracy went **8.3% -> 2.7%**,
three times **worse**. The deck a player actually brings scores **0.4856**
against the opponent's last deck, versus **0.4961** for the average deck they
could have brought. Players do not counter-pick the previous game.

Recency weighting and per-opponent tendency were tested the same way. Neither
beat plain usage.

### Matchup response (Phase 20A) — closed

*Given the opponent, which of X's own decks should X bring?* A choice among 5–40
known objects, not a construction, so it had every reason to be easier.

| competitive, 76 players | games | win rate | player-macro |
|---|---:|---:|---:|
| X plays their **default** deck | 2,777 | **58.9%** | 58.5% |
| the archetype pick | 1,849 | 60.0% | 62.7% |
| the exact-deck pick (**ORACLE**) | 221 | **48.9%** | 56.4% |

**The oracle arm — perfect knowledge of the correct counter — lost to the
player's own default by ten points.** Piloting familiarity is worth more than
matchup optimisation. This is the single most important number in this file for
anyone designing a "counter their deck" feature.

### Historical retrieval (17B) — closed

When a player switches decks, the new one is a deck they have played before only
**49.8%** (competitive) / **38.5%** (practice) of the time. A *perfect*
historical ranker therefore reaches **~5% / ~2%** of all steps.

Retrieval gets **worse** with more history: R@1 falls from **87.4%** at 2–3 known
decks to **24.8%** at 11+, because vocabulary grows faster than the return rate.

### Novel generation (18) — closed

When the deck is genuinely new, only **52.1% / 61.7%** can even be *built* from
cards the player has fielded before. The one generator with real recall
(historical fragments, 38–59%) emits **509 million / 9.7 billion** candidates.
The cheapest useful operating point still emits ~0.9M / ~6.2M for 28–40% recall.

For scale: Phases 9–11 already failed to beat a heuristic over a pool of 228–495.

### Spell conditioning (21A) — closed

Paired A−B **0.000, CI [-0.001, +0.001]**, over **20,702 players**.

### The step-definition mistake, worth not repeating

Phase 14 measured the shortlist adding **+8.4 points**; Phase 16C measured
**+0.5**. Both correct. Phases 8–14 stepped `next-in-cluster`, which by
construction only scores steps where the player **stayed on the shell** —
precisely the case a 1-card shortlist addresses.

What production actually faces:

| cards shared with the previous deck | competitive | practice |
|---|---:|---:|
| 8 — no change | 79.1% | 74.2% |
| 7 — the 1-card edit | **1.8%** | **2.3%** |
| 0–3 — whole-deck switch | 15.9% | 22.1% |

The machinery addressed ~2% of real steps. **The single most expensive mistake in
the programme**, and the lesson is: a step definition that flatters the model is
worse than a weak model.

### What this section means for the card knowledge base

Every branch above is about predicting **another human's choice**, and every one
lost because human choice here is driven by habit, not by matchup logic. A card
knowledge base encodes what a player *should* bring.

**So: a card knowledge base cannot improve prediction.** The README already lists
"the 122-card knowledge graph" under *Not planned, and now with evidence*.

**But none of these branches touches deck construction for yourself.** Choosing
*my* deck under constraints is a different problem — the answer is mine to
choose, not a human's to guess. Nothing above closes it. That is the opening.

---

## 14. Five flaws found on 2026-09-02

Found by working through a concrete duel scenario. None is a bug in the sense of
wrong code; each is a **wrong objective** or a **missing capability**.

### 14.1 `_expected()` optimises the mean, which is snipeable

It returns a probability-weighted average over the opponent's likely decks. A
deck that crushes their most-likely list and **loses badly to the other two** can
still rank first.

Concretely: the opponent spends Fireball in game 1. Their most-likely game-2 deck
now has no answer to swarm, so a swarm deck scores highest on the mean. But Bomb
Tower, Skeleton Dragons, Royal Delivery, Dark Prince and Valkyrie are all still
legal for them — the mean has quietly bet everything on one card being their only
answer.

**The worst case is already in the returned data structure** (`per[]` carries
every individual matchup) and is simply not used.

### 14.2 There is no role-level reasoning, so "what have they run out of" cannot be asked

The system reasons about **whole decks**. It can say "these three lists are still
legal for them". It cannot say:

> They play 5 anti-swarm cards across their decks. Fireball is spent. Bomb Tower,
> Skeleton Dragons, Royal Delivery and Dark Prince are all still legal — swarm is
> **not** open.

or the far more valuable inverse:

> They play 2 cards that hit air. Both are spent. **Nothing they can still bring
> answers air.**

That second statement is a **fact** derived from the disjointness constraint —
no prediction, no history extrapolation, cannot be wrong. It is the single most
actionable thing the screen could say mid-duel, and it is impossible today
because no card carries `targets` or `roles`.

Deck-level reasoning can never see it: it knows which whole *lists* are legal,
not which *functions* the opponent has exhausted.

### 14.3 There is no coverage or robustness objective

Nothing anywhere asks "what is this deck's **worst** matchup across the field".
Against an opponent who deviates from history — brings cards they have never
played, specifically to counter you — the mean-based read has no defence at all,
because the distribution it averaged over was built from their history.

The data to answer it already exists: `deck_profile(cards)["archetypes"]` returns
this exact list's measured record against **all 17 archetypes**. Nothing ranks on
its minimum.

### 14.4 `_fills` hands out the meta

Covered in §8 and §11. The moment the reader most needs a tailored answer is
exactly when they get the most generic possible one.

### 14.5 Coverage is a property of the loadout, and is never computed there

You bring **three** decks. You do not need one deck that answers everything — you
need three that between them have **no shared hole**. Each can stay sharp and
lopsided; what must be complete is the **set**.

Card disjointness already forces the three apart, so this pushes in the direction
the format is pushing anyway. Nothing in the system currently evaluates a
loadout as an object — `pick_duel_legal_sequence` builds one greedily by
legality alone, never by complementary coverage.

---

## 15. What can be fixed right now, with no new data

**All three of these need no card file, no new database read, and no model.**
The data is already in the returned structures.

### 15.1 Floor scoring — rank on the worst case, not the mean

`_expected()` already returns `per: [{cards, prob, matchup}]`.

```python
scored = [p["matchup"]["winRate"] for p in per if p["matchup"]]
floor   = min(scored) if scored else None
```

Rank on `floor` (or a low percentile when the distribution is wide), and show
both figures: **"58.1% expected, 44.0% worst case"**. That single change makes
the recommendation robust to a counter-pick **without modelling whether the
opponent is counter-picking** — which matters, because §13 says you cannot model
that reliably.

Show the mean too. They answer different questions: the mean is "how does this go
on average", the floor is "how bad can this get". A coach wants both.

### 15.2 Coverage ranking — the worst matchup across all 17 archetypes

```python
prof = counter.deck_profile(cards)["archetypes"]
worst = min(prof.values(), key=lambda m: m["winRate"])
```

That is this exact list's worst measured matchup across the whole field —
card-sensitive, symmetrised, evidence-floored at 8 games. `find_counters()`
already computes and ranks the same thing from the other direction, complete with
the rung each row came from.

Use it to answer "which of my decks has no bad matchup", which is the correct
objective against an opponent whose history has stopped being evidence.

Fall through `cluster_profile(7)` then `(6)` for archetypes the exact list has
not met often enough — the same lazy ladder, so the cost is the same.

### 15.3 Loadout coverage — the union of three

For a candidate triple, compute each deck's per-archetype record and take, for
each of the 17 archetypes, the **best** of the three. Then take the **minimum**
across archetypes. That is the loadout's hole:

```
loadout_floor = min over archetypes a of ( max over decks d of winRate(d, a) )
```

Maximise that instead of maximising each deck independently. `pick_duel_legal_sequence`
becomes the fallback rather than the method.

**Cost note:** three `deck_profile` calls, one per deck, each cached
(`_PROFILE_MAX = 64`) and ~0.17 s cold. Cheap. Do **not** reach for
`cluster_profile` in the triple search — that is the 11.6 s path.

### 15.4 Two smaller ones

* **Say what `weight` means.** `_expected` returns the probability mass that
  actually had evidence. It is computed, returned, and never surfaced. "Scored
  against 68% of what they can bring" is a real caveat the reader cannot
  currently see.
* **Fill decks should be ranked by coverage, not by use rate.** `_fills` takes
  the meta board's top 24 in board order. If it must hand out somebody else's
  deck, hand out the one with the fewest bad matchups rather than the most
  popular one.

---

## 16. The card knowledge base — what it would unlock

### The governing rule

> **The knowledge base decides which decks are ELIGIBLE.
> The database decides which of them is GOOD.
> The knowledge base never produces a number.**

Precedent exists in this codebase: `deck_counter.STYLE` maps 17 archetypes to 5
play styles and is labelled *"It is opinion, it is in one place, and the UI says
the grouping is editorial."* Same shape, same labelling, same discipline.

If a hand-authored file is ever allowed to emit a percentage, it becomes a second
source of truth that can disagree with `pair_matchup_agg`, and there is no
principled way to resolve the disagreement.

### The schema

`src/data/cardRoles.json`, one entry per card key, merged in `src/data/cards.ts`
alongside `cardMeta.json`.

```jsonc
"musketeer": {
  // ── MACHINE-READABLE. Closed vocabularies. Scoring may read these. ──
  "targets":   ["ground", "air"],     // what it can hit
  "transport": "ground",              // how it is hit
  "damage":    "single",              // single | splash | chip
  "roles":     ["air-defence", "tank-killer", "support"],
  "range":     "long",                // melee | short | long

  // ── PROSE. UI only. MUST NOT enter a score. ──
  "counters":    ["balloon", "baby-dragon", "mega-minion"],
  "counteredBy": ["fireball", "poison", "lightning"],
  "placement":   "Behind the tower, or at the bridge to punish...",
  "note":        "..."
}
```

A `"source": "editorial"` marker ships with the file and the UI states it.

**Authoring:** a script can seed a first draft from `cards.json` + descriptions,
but all 122 need hand review. The draft is a convenience, never an authority.

**Validation test:** all 122 keys present; closed vocabularies honoured; every
`counters` / `counteredBy` entry a real card key.

### Capability 1 — role exhaustion (§14.2), the highest-value item

For each role, count how many cards fulfilling it the opponent plays across their
historical decks, then subtract what they have spent this duel.

```
they play 5 anti-swarm cards; 1 spent, 4 still legal   -> swarm is NOT open
they play 2 air answers;      2 spent, 0 still legal   -> AIR IS OPEN
```

**No prediction. No model. Pure constraint arithmetic**, and therefore
unfalsifiable in a way nothing else on the screen is. This is the single output
that would make the tool feel like it is thinking, and it does not exist without
the file.

### Capability 2 — the harmony checklist

`server/deck_harmony.py` + `src/state/deckHarmony.ts`, with **no imports beyond
the card data** — following `tiers.ts` / `format.ts` / `squadParse.ts` /
`passwordRules.ts` / `releases.ts`, so the rules are testable without
constructing a database connection.

| rule | requirement |
|---|---|
| win condition | exactly 1 primary (reuse `deck_counter.WIN_CONDITION_MAP`) |
| air defence | >= 2 cards whose `targets` include `air` |
| small spell | >= 1 |
| heavy answer | >= 1 big spell **or** >= 1 building |
| splash | >= 1 `damage: splash` |
| tank-killer | >= 1 |
| elixir | inside a per-archetype band |
| duel legality | **zero** overlap with what is spent |

A **checklist that names what is missing**, never a weighted "harmony score". A
score would be an invented number, and this project does not print those.

### Capability 3 — structural coverage, which statistical coverage cannot give

§15.2's coverage is **statistical**: it can only see archetypes people have
played enough of. Structural coverage asks whether a deck has an answer to air,
swarm, a tank, a building and spell bait *regardless of whether anyone has run
that combination yet*.

That is the only kind of coverage that holds against something genuinely new.
When the two disagree, the disagreement is the interesting signal.

### Capability 4 — construction, in two modes

**Mode A — selection from real decks. Ship this first.**

Candidates are lists that **already exist** in the database, filtered by the
harmony checklist and by card legality. Reuse `_vocabulary()` for the pool and
`deck_profile()` for the record; prefer decks clearing `MIN_GAMES = 8`.

* every candidate has an **exact** `deck_profile` — the sharpest rung
* no `_siblings` scan, so no 11.6 s
* "custom" is still real: the *selection*, the *loadout combination* and the
  *situation* are custom
* it cannot recommend a list nobody has piloted — which §13's 20A result says
  matters by about **ten points**

**Mode B — true synthesis. Second, opt-in, labelled.**

Novel 8-card lists built by filling role slots. Scored at rungs 3 and 4 only, and
every such deck labelled **"never played — scored from decks 1–2 cards
different"**. Candidates capped hard (<= 12 scored per request) because of the
32-entry cluster cache.

**The middle path, and the one I would actually build.** Construct by role and
counter logic, then **snap the result to the nearest real deck at 6-of-8**.
`_siblings()` already finds everything within six cards across 1,054,394 stored
lists. You get a deck genuinely tailored to their spread that still lands on a
list real people play, with a real record. Uniqueness where it matters, evidence
where it matters.

### Capability 5 — explanation

`_read()` today can only narrate evidence: *"Go with X at 61.2%"*. It cannot say
**why**. Card knowledge is the only route to:

> Because they have no reset for your Inferno Tower, and your Fireball answers
> their Musketeer.

Valuable, and it must be labelled as **reasoning**, never as measurement.

---

## 17. The trade-offs, stated honestly

### Coverage costs edge, one for one

A deck with no bad matchup is, by construction, a deck with no good one. The
realistic matchup band here is narrow — roughly **48% to 57%** (observed while
building the team dossier's heatmap, which is why that matrix stretches its scale
across the range present rather than 0–100). "Beats most archetypes" in practice
means "sits near 50 against everything". You buy safety with your edges.

**This is why coverage belongs to the loadout, not the deck** (§14.5). Keep each
deck sharp; make the *set* complete.

### A novel deck loses the sharpest evidence

Rungs 1 and 2 are gone the moment a list has never been played. Card-sensitivity
survives at rungs 3 and 4, but the further you get from decks people actually
play, the less anyone has measured. **Uniqueness and evidential strength pull in
opposite directions.** That is a property of the world, not of the code.

### Familiarity beats optimisation

Phase 20A: the **oracle** pick scored **48.9%** against the player's own default
at **58.9%**. Ten points. A perfectly-countering deck the player has never
piloted can lose to their comfort deck.

Not a reason to skip construction — a reason to **print the comfort figure beside
it**, which the codebase already does elsewhere (`COMFORT_WEIGHT = 1.5`,
`MIN_COMFORT_GAMES = 5` in `team_analysis`).

It also means an *opponent* who deviates to hard-counter you is paying the same
ten points. Their deviation is not free.

### Do not predict level-2 play; defend against it

Modelling "they expect me to go swarm, so they will pre-load anti-swarm" is a
claim about intent. The population data pushes back hard: players do not reliably
counter-pick even one level deep (§13, 8.3% -> 2.7%).

**But you do not have to know whether they are thinking that far ahead.** Floor
scoring (§15.1) wins whether they are or not, and costs nothing if they are not.
Defend, do not predict.

---

## 18. Cost and cache constraints that shape any design

Any new feature is bounded by these. They are the reason the architecture looks
the way it does.

| thing | cost | note |
|---|---|---|
| `_vocabulary()` | 2.2 s, once per process | 1,054,394 hashes, kept in memory |
| `_siblings()` scan | 1.6 s | no index exists for "shares six cards with this" |
| cluster aggregation | 1.0 s | via a TEMP table joined to `ix_pair_a`; was 4.4 s through chunked `IN (...)` |
| **>= 7 cluster path, cold** | **11.6 s** | the expensive rung |
| `deck_profile` | 0.17 s | cheap — use this one |
| `_history` uncached | 3–6 s | hence the 120 s TTL |
| `suggest`, lazy ladder | ~1.4 s | vs **25.7 s** eager |
| Team Analysis 2v2 warm | 1.5 s | cold **31 s** (first hit builds the snapshots) |

Caches, and their failure modes:

| cache | size | behaviour on overflow |
|---|---|---|
| `_PROFILE_CACHE` | 64 | **clears whole** |
| `_CLUSTER_CACHE` | 32 | **clears whole** |
| `_HISTORY_CACHE` | 32 | **clears whole** |
| `_ARCH_CACHE` | 512 | **clears whole** |

**`_CLUSTER_CACHE` at 32 is the binding constraint on any generator.** 17
archetype representatives x 2 cluster levels is 34 — already over. This is why
`team_analysis._SCOUT_POOL` builds its representatives in **one forward pass**
and why that structure must not be reorganised. Any candidate loop that touches
`cluster_profile` on the inside will thrash it.

**Design rule that follows:** a generator must be a **filter that emits a
handful**, never a search that scores thousands. The harmony checklist is what
does the pruning; the database only ever judges the survivors.

Other constraints:

* Hard storage rule: never read `pair_matchup_agg` directly — always through
  `deck_counter`, or the 58.6% bias returns.
* The Python API **does not ship with the frontend.** Vercel builds from GitHub;
  `server/` runs on the VPS at `/opt/royalweb/`. A new screen needs both, and the
  API must land **first** or the area appears and every request 404s.
* `server/test_api_security.py` pins the route count at **21**. A new endpoint
  means bumping it in the same commit, plus the matching auth line.
* `tests/entitlement.test.ts` pins exactly which sections are free.
* Coach Assist is Pro-only and `/api/analytics` needs the VPS key, so **it cannot
  be exercised locally with real data.** Unit-test the pure layers; verify scored
  output against `api.deckkies.com` after deploy, and say plainly which half was
  which.

---

## 19. Future plans, in order

Ordered by value per unit of risk. Each item states what it needs.

### Tier 1 — no new data, no card file, days of work

1. **Floor scoring in `_expected()`** (§15.1). The worst case is already in
   `per[]`. Show mean **and** floor; rank on floor. *The highest
   value-to-effort item in this document.*
2. **Coverage ranking** (§15.2) via `deck_profile()["archetypes"]` minimum.
3. **Surface `weight`** — "scored against 68% of what they can bring".
4. **Rank `_fills` by coverage** rather than by meta use rate.
5. **Loadout-level coverage** (§15.3) — maximise the union floor across the
   three decks instead of picking each independently.

### Tier 2 — needs the card knowledge base

6. **Author `cardRoles.json`** — all 122, hand-reviewed, with the validation
   test. Everything below depends on it.
7. **Role exhaustion reads** (§16.1). *The single output that changes how the
   screen feels.* Pure constraint arithmetic; cannot be wrong.
8. **Harmony checklist** (§16.2) — `deck_harmony.py` / `deckHarmony.ts`, no
   imports, exhaustively unit-tested.
9. **Structural coverage** (§16.3) alongside the statistical kind, with the
   disagreement surfaced.
10. **Fix `_fills` properly** — harmony-constrained, legality-checked,
    evidence-scored selection instead of the raw meta board. Lands inside the
    existing Suggestion window; **needs no new route**.

### Tier 3 — construction

11. **Mode A: selection from real decks** (§16.4). Exact rung, no cluster scan.
12. **Snap-to-real-deck** — construct by role logic, then snap to the nearest
    6-of-8 real list. The recommended shape.
13. **Mode B: true synthesis**, opt-in, capped at <= 12 scored candidates,
    labelled "never played".
14. **A `#/forge` screen.** New route -> bump the tripwire 21 -> 22 and add
    `'Deck Forge'` to `ALL_SECTIONS`. Pro-only. **Deploy the API first.**

### Tier 4 — explanation and polish

15. **Explanations in `_read()`** (§16.5), labelled as reasoning.
16. **Comfort figures beside every constructed deck** — the 20A ten points.

### Explicitly not planned, with evidence

Counter-sniping (3,569 trials, 8.3% -> 2.7%), recency weighting, per-opponent
tendency, matchup-response prediction (20A oracle 48.9% vs 58.9%),
spell-conditioning (21A, 0.000 over 20,702 players), exact historical retrieval
(17B, ~5%/~2% ceiling), novel-deck *prediction* (18, 10^8–10^10 candidates),
Markov chains, elixir/cycle models, neural rankers, and **any use of a card
knowledge base to predict what the opponent will bring** (§13).

**Native duel prediction** is a *possible* future project rather than a blocked
one, because `battle_raw.rounds` holds ordered per-game decks and crowns for both
sides across ~50,000 payloads. It needs a loadout representation and is a
different research programme, not a fix to this one.

---

## 20. Constant reference

### `coach.py`

| constant | value | meaning |
|---|---:|---|
| `MIN_FIRST_SERIES` | 3 | ordered series before openings rank by game-1 history |
| `FIRST_MAX_DECKS` | 6 | opening decks listed |
| `TOP_CARDS` | 8 | rows in the card-odds table |
| `TOP_ARCHETYPES` | 4 | rows in the archetype-odds table |
| `TOP_DECKS` | 3 | companions offered per prediction |
| `OPP_TOP_DECKS` | 3 | opponent candidates scored |
| `MY_TOP_DECKS` | 3 | recommendations shown |
| `OPP_HISTORY_MASS` | 0.7 | probability kept on their own decks when topped up |
| `MIN_DUEL_GAMES` | 6 | below this a prediction is flagged thin |
| `MIN_OVERLAP` | 6 | two decks are "the same deck" |
| **`RECOMMEND_MAX_SHARED`** | **0** | a recommendation must be strictly legal |
| `SEQUENCE_LIMIT` | 6 | loadouts listed |
| `_HISTORY_TTL_S` | 120.0 | history cache lifetime |
| `SURFACED_DOMAIN` | `competitive` | which OIE domain is shown |

### `duel_zone.py`

| constant | value | meaning |
|---|---:|---|
| `COUNTER_MIN_OVERLAP` | 6 | deck identity, project-wide |
| `PREDICT_COMPANION_MAX_SHARED` | 2 | a prediction tolerates noise |
| `PREDICT_COMPANION_POOL` | 10 | 3 gave a legal pair 59% of the time; 10 gives 99% |
| `PREDICT_MIN_DUEL_GAMES` | 6 | thin-prediction flag |
| `PREDICT_DUP_OVERLAP` | 5 | two openers this similar are one opener |
| `CO_WEIGHT` | 3 | co-occurrence vs raw play count |

### `deck_counter.py`

| constant | value | meaning |
|---|---:|---|
| `MIN_GAMES` | 8 | evidence floor on any reported rate |
| `BASELINE_MIN_BATTLES` | 50 | before a deck is its own baseline |
| `CLUSTER_LEVELS` | (7, 6) | one card different, two cards different |
| `TOP_COUNTERS` | 5 | first page of the counters list |
| `_PROFILE_MAX` | 64 | profile cache, clears whole |
| `_CLUSTER_MAX` | 32 | **the binding constraint on any generator** |
| `REFRESH_SECONDS` | 3600 | snapshot rebuild |

### Key measured figures

| figure | value |
|---|---|
| tracked-player bias, cancelled by `_symmetric` | **58.6%** |
| mirror-test check | exactly **50.0%** |
| stored deck hashes | **1,054,394** |
| exact pairings reaching the floor | **0.59%** |
| duel card-reuse violations | **0 of 21,432 pairs** |
| ordered series in this data | **718 of 759 (94.6%)** |
| openers with a full observed loadout | **~85%** |
| counter-sniping, top-1 | **8.3% -> 2.7%** (3,569 trials) |
| 20A oracle vs own default | **48.9% vs 58.9%** |
| `suggest` lazy vs eager | **~1.4 s vs 25.7 s** |
| >= 7 cluster scan, cold | **11.6 s** |
| realistic matchup band | **~48% – 57%** |

---

*Last updated 2026-09-02. Sections 14–19 record a design review, not shipped
code: §15 lists changes that are possible today and **are not implemented**;
§16 depends on `src/data/cardRoles.json`, which **does not exist yet**.*
