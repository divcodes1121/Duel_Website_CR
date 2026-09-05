# Deck Tuner — the swap brain and the composer

**Status: PHASES A–D BUILT, NOT YET DEPLOYED OR MEASURED.** Written and built
2026-09-05.

| phase | what | state |
|---|---|---|
| A | `deck_tuner.neighbours()` / `rank()` — swaps | **built**, 79 checks |
| B | `cardRoles.json` + `deck_harmony.py` — the veto | **built**, 74 checks |
| C | `_build_seeds()` + `compose()` / `loadout()` | **built**, in A's suite |
| D | `swaps=1` on the route + admin panel | **built** |

**Nothing has run against the real database.** Every figure below that is
called an estimate is still an estimate, the cost discrepancy in section 6 is
still unresolved, and the API has not been deployed to the VPS. `tsc -b`, 398
vitest and 787 Python checks are green — that is not evidence the brain works.

**Two things the tests caught that reasoning had not**, both recorded in place:
a delta between floors measured over different archetype subsets is not a
comparison (section 3, `_comparable`), and the composition thresholds rejected
two real meta decks until they were measured against twelve of them (section 4).
Companion to `MECHANISM.md`, which records what the live system already
does. Read that first; this describes only the new part.

Two modes, one engine:

- **MODE A — TUNE.** A deck the player already plays, with one or two cards
  named for replacement.
- **MODE B — COMPOSE.** A deck built from the meta population, balanced by
  composition, aimed at the opponent's spread — and every card in it
  explained, with alternatives per slot.

Everything the Coach already outputs stays exactly as it is. This runs
beside it, admin-gated, because `main` deploys straight to production and an
admin gate is the only staging this project has.

---

## 1. The one sentence that makes generation safe

> **GENERATION IS A SEARCH FOR A REAL DECK NOBODY HAS SHOWN YOU YET — not
> an invention of a deck nobody has played.**

Phase 18 closed free generation: 122 choose 8 is 2.4 x 10^11 candidates and
no evidence for any of them. That result stands and is not being reopened.

What is being built is a different thing. The evidence ladder scores any
deck within **two cards of something real**, and the meta population is
~231,000 distinct played decks. So the reachable space is the union of
their two-card neighbourhoods — enormous, but every point in it is
*scoreable*, which the free space was not.

And the search runs **toward** the population, not away from it:

> **A proposal that turns out to already exist in the vocabulary is
> STRICTLY BETTER — cheaper to score, stronger evidence, and known to be
> playable because somebody plays it. The generator should be trying to
> land on real decks, and should say when it did not.**

That single rule is what stops Mode B producing the thing that was
explicitly rejected: a pile of counters that no human would pilot.

---

## 2. What the database already computes and throws away

`deck_counter._build_reps()` runs on the background snapshot thread. It
builds:

```python
totals: dict[str, int]     # deck_hash -> total games, ~231k entries
```

...from a `GROUP BY` over 1.98M pair rows — and then keeps **only the single
most-played deck per archetype**, discarding the rest.

That map is exactly the seeding source Mode B needs: **every real deck,
ranked by how much the world actually plays it.**

**PROPOSED CHANGE, and it is the cheapest win in this document:** keep the
top *N* per archetype instead of the top 1. Same query, same thread, same
1.98M-row scan, no request-time cost at all. At N = 20 over 17 archetypes
that is ~340 heavily-played real decks sitting in memory.

The snapshot already carries `cells` (the full archetype x archetype
matrix), `archetypes`, `reps` and `computedAt`, refreshed hourly
(`REFRESH_SECONDS = 3600`). Adding a `seeds` key changes nothing about how
it is loaded or saved.

---

## 3. The objective — and why it is a floor, not an average

The user's own earlier question settles this:

> *"what if he does not play any of the 5 cards I stated and still brings
> them just to counter our decks — we need to build a deck which covers and
> counters most of the archetypes"*

That is a **coverage** objective, not a prediction-fitting one. A deck tuned
to three predicted decks is a bad deck the moment they deviate, and
`MECHANISM.md` §13 already records that counter-sniping does not work
(8.3% -> 2.7% over 3,569 trials).

So:

```
deck_floor(D)     = min over archetype a in THEIR SPREAD of winRate(D, a)
coverage_floor(D) = min over ALL 17 archetypes    of winRate(D, a)
```

Rank on `deck_floor`. Report `coverage_floor` beside it. And for a whole
duel loadout:

```
loadout_floor(D1,D2,D3) = min over a of ( max over d in {D1,D2,D3} of winRate(d,a) )
```

Three decks cover *between* them — no single deck has to answer everything,
which is the actual shape of a duel and the reason picking three decks
independently is wrong.

**`_expected()` currently ranks on a probability-weighted MEAN**
(`MECHANISM.md` §five flaws), so a deck that crushes the front-runner and
loses to the other two can rank first. The per-deck matchups are already in
`per[]` — the floor is one line away and must be shown alongside, never
instead: *"58.1% expected, 44.0% worst case"* answers two different
questions and a coach wants both.

---

## 4. Balance is a VETO. Counter-fit is the OBJECTIVE.

These two requirements pull against each other, and the resolution decides
whether the feature produces sane decks:

> **Maximise counter-fit SUBJECT TO balance. Balance is never a weight, and
> counter-fit never overrules it.**

A swap or a composition that fails a structural check is **dropped**, not
down-weighted. Down-weighting is how you end up with a deck carrying four
tank-killers and no air answer that still scored well because the numbers
liked it.

### The composition checklist

Derived from the card manual's tags plus the repo's own data. Every check
names a source; none of them is invented.

| check | requirement | source |
|---|---|---|
| win condition | >= 1 | `cardMeta.is_win_condition` |
| air answers | **>= 2** cards that hit air | manual `TARGETS: air-and-ground` \| `air` |
| small spell | >= 1 spell at <= 3 Elixir | manual `TYPE:spell` + `cards.json` elixir |
| splash / anti-swarm | >= 1 | manual `DAMAGE:area` |
| heavy answer | >= 1 | manual `ROLE:tank-killer` |
| cheap cycle | >= 2 cards at <= 3 Elixir | `cards.json` elixir |
| average elixir | inside the archetype's band | `cards.json` elixir |
| no duplicates | set arithmetic | — |
| duel legality | no card used by another deck in the loadout | `coach`'s `used_mine` |

A defensive building is **archetype-dependent and therefore soft** — siege
and cycle shells want one, beatdown often does not. Soft checks are
reported, not enforced.

> **A checklist that NAMES WHAT IS MISSING. Never a weighted "harmony
> score" — that would be an invented number, which this project refuses
> everywhere else.**

### Three cards the veto must special-case

All three found while completing the card manual, all recorded there:

- **`spirit-empress`** — her cost (6 or 3) and troop type (air or ground)
  are chosen by the player's Elixir bar at deployment. **"Does this deck
  answer air" has no deck-list answer for her.** She must be a declared
  special case, and a deck containing her is reported as INCOMPLETELY
  CHECKED rather than passed.
- **`void`** — `cards.json` says 3 Elixir; it is **5** since the 2026-08-04
  balance update. The average-elixir check inherits that error directly.
  **Fix the data before the band check ships.**
- **`suspicious-bush`** — recorded as Epic, is Rare. Display only; harmless
  here.

---

## 5. Where the card manual belongs — and where it must not go

`Deckkies_Master_Card_Manual.md` is complete: 122/122 cards, machine-
readable tag blocks, to be extracted into `src/data/cardRoles.json`.

> **THE KNOWLEDGE BASE DECIDES WHICH DECKS ARE ELIGIBLE AND WHICH CARDS ARE
> WORTH CONSIDERING. THE DATABASE DECIDES WHICH OF THEM IS GOOD. THE MANUAL
> NEVER PRODUCES A NUMBER.**

Three jobs, all of them upstream or downstream of the scoring — never
inside it.

### Job 1 — the veto (section 4)

### Job 2 — the candidate pool

This is what makes generation tractable. Expanding a seed against all 122
cards is 8 x 122 = 976 one-swap candidates per seed. Against a **targeted
pool** it is 8 x ~25.

The pool is built by inverting the manual's `COUNTERS:` and `COUNTERED_BY:`
fields into `card -> cards that answer it`, then unioning:

- cards that answer the opponent's *actual named threats* (not their
  archetype — their cards),
- cards the player has actually played (comfort, from `_history`),
- cards legal in this duel.

**This is genuinely new capability.** The database knows deck-vs-archetype.
The manual knows card-vs-card. Together they support a claim neither could
make alone: *"Inferno Tower belongs here because they run Golem AND Electro
Giant, and it answers both."*

### Job 3 — the sentence

`Bomber -> Baby Dragon, +6.2pp` is a number. What a reader can act on is:

> *"Bomber is your only splash and it cannot touch air. Baby Dragon splashes
> too, flies, and survives the small spells that delete Bomber — you give up
> ranged reach and 2 Elixir of cycle."*

Every clause is already in the tags (`TARGETS`, `WEAK_TO`, `COUNTERED_BY`,
`REQUIRES`) plus the prose. **No new data is needed. The manual was the
missing half and it is now written.**

---

## 6. Mode A — TUNE (swaps)

### The finding that makes it cheap

`deck_counter.py`'s comment above `CLUSTER_LEVELS` records a real
measurement:

> Measured on the most-played Hog list: **1,405 decks share 7+ cards with
> it** and 4,439 share 6+, carrying **69,736** and 77,381 games.

**A deck sharing 7 of 8 cards with yours IS a one-card swap of your deck.**
About fourteen hundred exist for a typical list, every one is a deck real
people pilot, and each has its own rows in `pair_matchup_agg` — so each
scores at the **deck-vs-archetype rung**, the one `deck_vs_deck` calls
card-sensitive:

> *"swap a card and the deck hash changes, so a different set of battles is
> counted."*

### The trap, and the shape that avoids it

`CLAUDE.md` is explicit: `cluster_profile` is the expensive path and
`_CLUSTER_CACHE` is **32 entries that clear WHOLE on overflow**. Looping
1,405 neighbours through `deck_profile` at ~0.17 s each is four minutes and
would thrash a 64-entry cache twenty-two times.

But `_cluster_all` **already scans every one of those candidates**. It:

1. calls `_siblings()` once (1.6 s; `_VOCAB` process-cached after a 2.2 s
   first read),
2. inserts the sibling hashes into a TEMP table,
3. joins to `pair_matchup_agg` on `ix_pair_a` / `ix_pair_b` (1.0 s),
4. **and pools everything into one figure.**

Steps 1-3 are exactly right. Step 4 is the only change: **keep the tally per
sibling hash instead of summing.** Same scan, same join, same indexes, a
different `GROUP BY`.

> **ONE PASS FOR EVERY CANDIDATE — because the pass was always over every
> candidate. The existing code just adds them up at the end.**

**Estimated ~2.6 s warm** (1.6 scan + 1.0 join) for all ~1,400 candidates,
i.e. the cost of a single `cluster_profile` call. `CLAUDE.md` elsewhere
calls this "the 11.6 s path", which does not match the in-file timings —
**the discrepancy is unresolved and the real figure must be MEASURED against
the live database before anything is claimed.**

Its own cache, its own key, its own cap. **It must not share
`_CLUSTER_CACHE`**, whose whole-clear behaviour is tuned for a different
access pattern.

### Algorithm

```
tune(my_deck, their_spread, used_cards) ->
  1 RETRIEVE  neighbours at overlap >= 6      one shared scan
  2 SCORE     per-neighbour record per archetype, MIN_GAMES (8) floor
  3 BASELINE  my_deck's own figure            deck_profile(), cached
  4 DIFF      swap = set difference; reject if > 2 cards
  5 LEGAL     incoming card not used elsewhere in the loadout
  6 VETO      composition checklist (section 4)
  7 COMFORT   prefer incoming cards the player has piloted
  8 RANK      by deck_floor delta, not mean
  9 EXPLAIN   the manual supplies the sentence
```

---

## 7. Mode B — COMPOSE (generation)

Six stages. Everything before stage 5 is in-memory and free; stage 5 is the
only database work.

```
1 SEED      top-N real decks per archetype from the extended snapshot,
            plus the player's own decks.            ~340 + history, in memory

2 PRE-RANK  each seed's archetype row against their spread, via
            _symmetric(snap, seed_arch, opp_arch).  pure dict lookups, free
            keep the top ~24 by deck_floor

3 EXPAND    <= 2 swaps per seed, incoming cards drawn from the TARGETED
            POOL (section 5, job 2), not from all 122.
            ~24 seeds x 8 slots x ~25 cards, cheap to enumerate

4 VETO      composition checklist. Drops most candidates.       in memory
            + PROMOTE: any candidate whose hash is in _VOCAB is marked
            REAL and preferred — cheaper, better evidence, known playable

5 EVIDENCE  the real ladder on the ~16 survivors.
            real candidates  -> deck_profile()      2 indexed lookups each
            novel candidates -> one shared sibling scan, bitmask-filtered

6 RANK      deck_floor first, coverage_floor beside it,
            comfort as a TIEBREAK only
```

### Why stage 5 is affordable

Because stage 4 promotes real decks, and **most candidates will be real
decks**. Seeding from the meta and swapping toward common counter cards
lands on lists people have already tried. The cheap path dominates; the
expensive path is a fallback for the genuinely novel few.

For those few, encode decks as 122-bit integers and use `int.bit_count()`
for overlap. Any sibling of a candidate that is <= 2 cards from its seed is
within 4 cards of that seed, so **one wide scan per surviving seed at
overlap >= 4** yields a subset that contains every sibling of every
candidate derived from it — and the per-candidate refinement is then a cheap
popcount inside a much smaller set.

### Loadout selection

A duel is three decks with **no shared cards** — verified absolute in
`MECHANISM.md` (21,432 pairs, zero overlap). Greedy selection is wrong: deck
one eats the good air answers and decks two and three are left with none.

Instead: build a pool of ~30 scored candidates, then choose the disjoint
triple maximising `loadout_floor`. With that pool size the search is small
enough to be exhaustive with pruning, and
`dz.pick_duel_legal_sequence()` remains the fallback.

---

## 8. The honest limits — say these in the UI, not just here

**The further a deck is from something real, the less its number is about
that deck.** At two cards out you are on the >= 6 rung, which pools 4,439
decks and 77,381 games — that is telling you *"decks vaguely like this win
X%"*, which is barely a statement about your two changes. So:

- **Report the rung on every figure.** The ladder already does this
  (`SOURCE_DECK`, `SOURCE_C7`, `SOURCE_C6`, `SOURCE_ARCHETYPE`) and the
  output must not collapse it.
- **Label a novel deck as never played**, exactly as the approved plan's
  Mode B requires.
- **Prefer real decks and say when the answer is one.** *"Played by 340
  people"* is a stronger recommendation than any win rate.

Three risks worth naming:

1. **The checklist is a proxy for playability.** Real decks carry synergies
   it cannot see — Miner + Poison, Graveyard + Freeze. Mitigation: seed from
   real decks so synergy is inherited, and cap the distance at two cards.
   Beyond two, synergy degrades and the evidence rung drops together.
2. **Overfitting to the opponent.** Answered by the floor objective rather
   than the mean, and by reporting `coverage_floor`.
3. **The aggregate rollup is ~48% behind the live table** (`CLAUDE.md`,
   2026-09-03): `pair_matchup_agg` holds 4.4M games against 9.5M stored
   battles. Rates should be unbiased — arrival lateness tracks API flakiness,
   not outcomes — but **fewer decks clear `MIN_GAMES = 8`**, which pushes
   answers to coarser rungs. This feature is more exposed to that than any
   existing screen, because it asks per-deck questions of thousands of decks.

---

## 9. Where it plugs in

### Server

- **New module `server/deck_tuner.py`.** Retrieval, composition, ranking. It
  imports `deck_counter` and reuses `_siblings`, `_score`, `MIN_GAMES`,
  `matchup_ladder` and the archetype map. It reimplements nothing.
- **`server/deck_harmony.py`** — the checklist. **No imports beyond card
  data**, like `tiers.ts` / `squadParse.ts` / `passwordRules.ts` /
  `releases.ts`, and for the same reason: the rules most worth testing
  exhaustively must be importable without constructing anything.
- **A small change to `deck_counter._build_reps()`** to keep top-N seeds.
- **NO NEW ROUTE.** It rides on `/api/analytics/coach/suggest` behind an
  opt-in `swaps=1` parameter, returning a `tuner` field — the arrangement
  `ops_snapshot` uses on `/coverage`, for the same three reasons: the
  route-count tripwire in `test_api_security.py` **stays at 21**, there is no
  second endpoint to hand-deploy, and the cost is opt-in rather than added to
  every Coach call.
- **`server/test_deck_tuner.py` + `test_deck_harmony.py`**, fixtures written
  from the PRODUCER's real output. `CLAUDE.md` records `test_team_analysis.py`
  passing 59/59 against a field that does not exist, because the fixture had
  invented the same wrong name. Do not repeat that.

### Client

- **Gated in the component, not in `ADMIN_ONLY_SECTIONS`.** That list HIDES a
  whole section and Coach Assist must stay visible to Pro. The panel checks
  `useAccess() === 'admin'`, and the client sends `swaps=1` only for admin so
  nobody else pays the cost.
- **`useAccess()`, never `useAccountStore(s => s.tier)`** — `CLAUDE.md`
  records that exact regression: the raw store initialises and resets to
  `'free'`, and only `useAccess()` knows `'anon'` is not a tier.
- A new block inside `CoachAssist.tsx`, below the existing recommendation.
  **Nothing above it changes.**

---

## 10. Build order

**Phase A — retrieval core** (server only, nothing user-visible)
1. `neighbours(cards)` — one scan, per-hash tally, own cache.
2. `rank()` — floor-first delta.
3. Unit tests on a temp SQLite file, as `test_ops_snapshot.py` does.
4. **MEASURE the real cost** against `api.deckkies.com`, and resolve the
   2.6 s / 11.6 s discrepancy in section 6.

**Phase B — the veto and the sentence**
5. `src/data/cardRoles.json` extracted from the manual, with a completeness
   test: 122 keys, closed vocabularies, every referenced card a real key.
6. `deck_harmony.py` — the checklist.
7. Fix `void`'s elixir in `cards.json` before the band check goes live.

**Phase C — the composer**
8. Extend `_build_reps` to keep top-N seeds.
9. Stages 1-6 of section 7.
10. Loadout triple selection.

**Phase D — the panel**
11. `swaps=1` on the existing route; `tuner` field in the response.
12. Admin-gated block in `CoachAssist.tsx`.
13. Browser pass per the project pattern.

**Deploy order is fixed:** the API lands on the VPS FIRST, then the
frontend. A screen whose API is not there yet appears in the rail and 404s
on every request.

---

## 11. What cannot be verified locally

- `/api/analytics` needs the VPS key and 500s under `vite dev`.
- Coach Assist is `PRO_ONLY_SECTIONS`; the tuner is admin-only on top.
- The verify login recorded in `CLAUDE.md` is dead — the 20-account gate was
  deleted and auth is Supabase now.

**Unit-test the pure layers locally; verify the scored half against
production after deploy; and report which half was which.** A green
`tsc -b` and a green vitest run are not evidence that the brain works.

---

## 12. Explicitly out of scope

- **Nothing touches `predict()`, `next_decks()` or `opening_decks()`.** A
  card knowledge base cannot improve prediction — measured and closed:
  counter-sniping 8.3% -> 2.7% over 3,569 trials; the 20A oracle 48.9%
  against its own 58.9% default; 21A spell-conditioning 0.000 over 20,702
  players. `MECHANISM.md` §13.
- **No free combinatorial generation.** Every candidate stays within two
  cards of something real, which is what keeps it scoreable.
- **No "harmony score".** A checklist naming what is missing.
- **The existing suggestion is not replaced.** Parallel, additive,
  admin-gated.
