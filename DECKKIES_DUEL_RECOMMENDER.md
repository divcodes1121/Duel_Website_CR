# Duel recommender — the Coach Assist rebuild

**Read this first if you are a new session.** It is the working record of the
rebuild of Coach Assist's duel suggestion that the account holder asked for on
2026-10-07. It is updated after every crucial step; the newest entry of
[the log](#log) says where the work stands and
[Next action](#next-action) says what to do.

Companions: `MECHANISM.md` (how the old prediction chain works),
`DECK_TUNER.md`, `DECKKIES_TEAM_SCOUT.md`, `server/README.md` (how each module
runs). This file is the only one that describes the rebuild.

---

## What was asked for

In the account holder's words (2026-10-07), tidied:

- Enhance the duel deck recommendation of **Coach Assist's Suggestion**.
- Focus on the **spells and win conditions already used** in the duel, what the
  opponent **might bring next**, and the **support cards and buildings** used.
- Test it **blind**: player A against player B, read only their tags and their
  battles from a window of **30, 15 and 7 days**, recommend, then see what they
  really brought; read again for game 2; again for game 3. Over every stored
  duel, from the oldest.
- **Focus on CRL players** (they have coaches). A list of 1,000 was supplied.
- "We can modify a few cards" — a recommended deck may be a real deck with a few
  cards changed.
- Most duels are best of 3, a few best of 5. **Use the key cards wisely in every
  category** so each deck has a good matchup.
- The decks must have **harmony and make sense** — "not random cards thrown
  together" — and the mechanism must be strong enough to **trust blindly**.
- Keep **this README** current so a new session can continue immediately.

## The facts everything rests on

| fact | measured |
|---|---|
| A duel is **four** prepared decks, 32 different cards; two or three are played. | Supercell's rules; in the data, two consecutive duels of one player hold 2 / 3 / 4 distinct card-disjoint decks in 22% / 64% / 14% of cases |
| The 8-card blocks of a native duel row are in **game order**. | 15,578 of 15,578 sides, June to October 2026, both modes |
| A player's set is stable from one duel to the next. | 74.6% of decks are the exact deck of their previous duel; 1.9% are that deck with one or two cards changed |
| Whole three-deck sets are almost unique to a player. | 122,275 distinct sets in 144,186; 24 are shared by 3+ players in 5+ duels. A set must be composed from decks, never looked up |
| Strong players are harder to read. | Opening deck = their previous opener: 66.9% for everyone, 39.7% for the CRL-list players, 28.7% for players with 5+ friendly duels |
| Games inside a duel are not independent. | After winning game 1 a player wins game 2 57.5% of the time where the win model says 51.6% |
| The order of your decks is worth about ten points of duel-win chance. | Worst pairing 40.4%, average 50.0%, best 59.6% (win model, held-out three-game duels) |

Stored on 2026-10-07: 170,792 native duels, 413,677 games, 1 June to 7 October
2026 (162,788 clan-war duels, 8,004 friendly duels). No stored native duel has
more than three games, so best-of-5 is untested.

**The CRL list** has names and no tags. 474 of the 1,000 names were matched to
455 tags through the 2026 ranked-season leaderboards (the Clash Royale API, top
3,000 of ten seasons); 404 were already collected and 51 were queued (source
`crl-list`). About 3,040 duels are held for them, so every model here is fitted
on **all** duels and **scored** on the CRL and friendly-duel cohorts.

## The blind replay (the test every step must pass)

`brain-evidence/duel_replay_20261007/` — **gitignored, it holds player tags**.
Pure Python, no numpy.

| file | what it does |
|---|---|
| `duel_lab.py` | loads `games.tsv.gz` (the duel index's `games` table) and the card data |
| `duel_struct.py` | the structural census in the table above |
| `replay_predict.py` | for every duel from 15 Sep and each of its players: predict game 1, 2 and 3 from only that player's earlier duels (7 / 15 / 30 days); fits the next-deck model on duels before 10 Sep |
| `replay_recommend.py` | which of their decks a player should bring, scored by who won |
| `replay_series.py`, `replay_series2.py` | the value of the ORDER of the three decks; an independent judge; real outcomes |
| `loadout_census.py` | how spells, win conditions and buildings are spread across a set |

Run one with `python -B <file>` from that folder. To refresh the data, export
`games` from `/opt/royalweb/server/.duel_index.db` and copy
`/opt/royalweb/server/.duel_games.pkl` (read-only, see the scripts' headers).

### Scorecard on 2026-10-07 (fitted before 10 Sep, scored from 15 Sep)

Naming the opponent's **exact deck**: first pick / within the top three.
"Today" is the logic Coach Assist runs now, ported line for line.

| CRL-list players, 30 days (950 player-duels) | today | new model | ceiling |
|---|---|---|---|
| game 1 | 20.3% / 40.8% | **42.8% / 60.6%** | 71.7% |
| game 2 | 28.8% / 50.3% | **41.1% / 66.9%** | 72.3% |
| game 3 (326) | 40.5% / 54.0% | **52.1% / 66.6%** | 70.2% |

The ceiling is how often the deck they brought was one seen in the window; the
rest are new decks. Other cohorts, 30 days, game 1: friendly duels 10.3 / 23.8
-> 18.7 / 32.2 (ceiling 41.4); everyone 15.5 / 32.0 -> 28.5 / 33.7.
Today's logic gets worse with a longer window (first pick 24.5% at 7 days,
20.3% at 30) because it counts plays with no recency; the model improves
(39.8 -> 41.8 -> 42.8).

By category, when there is an answer (CRL, 30 days, top three): their win
condition 67-77% today -> 76-84%; their spells 69-78% -> 77-86%.

The **order** of your three decks, rated by a win model fitted on other games
(10,168 player-duels, 15-25 Sep, opponent has history):

| | duel-win chance |
|---|---|
| a random order | 48.93% |
| the order players really used | 48.98% |
| best deck for the next game, today's read | 49.41% |
| best deck for the next game, new read | 50.28% |
| look-ahead over the whole duel, new read | 51.26% |
| the perfect pairing | 58.82% |

Real results, 6,016 player-duels chosen without looking at the score: players
who opened the way the new read says won the duel **53.2%** against 50.2%
otherwise (today's read 52.2 / 50.7; a perfect read 54.2 / 49.7; noise about
1.4 points).

## The plan

| # | step | state |
|---|---|---|
| 1 | **The new opponent read** — game order, recency, strictly legal decks, a fitted next-deck model, on any window; retrained after every poll | **LIVE 2026-10-07** |
| 2 | **What they have left** — win conditions, spells, buildings and support cards still unspent after each game | **LIVE 2026-10-07** |
| 3 | **Pick for the duel, not the game** — look-ahead over their likely order; the result of each game updates the next read | not started |
| 4 | **The set composer** — three or four card-disjoint decks from duel-proven decks, key spells and win conditions spread so no deck is starved; harmony checklist and duel-pairing gate on every deck; at most two human swaps | not started |
| 5 | **Keep learning** — retrain after every poll; this scorecard re-run before any step ships; a CRL cohort line in it | not started |

## Rules for this work

- **Every step is re-scored on the blind replay before it ships**, against
  today's logic on the same duels. A change that does not move the scorecard
  does not ship as an improvement.
- **Never test on three-game duels only.** They are selected on the result (1-1
  after two games); it made "best deck for this game" look like it loses duels.
  Use players whose three decks repeat their previous three-game duel.
- **Rate a policy with a model it did not plan with.** Judged by its own planner
  the look-ahead gain doubles.
- **A recommendation is strictly legal** (no card already played this duel), and
  so is a predicted deck: a deck sharing a card with a revealed one cannot be
  the next deck.
- **Closed, do not reopen without a new question**: counter-sniping (8.3% ->
  2.7%), spell-conditioned archetype prediction (21A), free generation of decks.
  `MECHANISM.md` §13 has the figures.
- **A built deck is constructed from how duel players build**, never a real deck
  with a card swapped in for the sake of it; duel-proven lists lead.
- **Screens say what to do**, in figures. No explanatory prose is added to
  Coach Assist.
- **The repo is public.** No tag, and no player name from the list, goes into a
  tracked file. The evidence folder is gitignored.
- **`server/` ships by scp and the server goes first**; a push to `main` is a
  production deploy. Ask once before deploying.

## Log

### 2026-10-07 — measurement and plan

Read every recommendation and prediction document, went through the duel rows
(one real duel in each of `battles`, `battle_raw`, `duel_timeline` and the duel
index), measured the block order, resolved the CRL list, built the blind replay
and ran it. Findings are the two sections above. Nothing in the product
changed; 51 CRL-list tags were queued for collection. The account holder
approved the plan and asked for this file.

### 2026-10-07 — step 1a: the read and its trainer exist (not wired, not deployed)

`server/duel_read.py` (pure) and `server/duel_read_train.py` are written and
measured. Three fitted parts per stage:

- **ranking** — a conditional logit over the decks a player has been seen
  bringing, twelve features (recency, position in the duel, what followed the
  same reveal, staleness, their record with it);
- **sharpness** — one scale on those scores from how much the player rotates
  (own new-deck rate, share of friendly duels, whether THIS duel is friendly);
- **new deck** — the chance the next deck is not one seen in the window; every
  row's probability is scaled by what is left.

The trainer's own report (fitted before 24 Sep, scored from then on, 30-day
history): exact deck as first pick, read / count of plays —

| | game 1 | game 2 | game 3 |
|---|---|---|---|
| everyone (29,384 / 29,384 / 11,864) | 67.9 / 37.4 | 60.0 / 52.9 | 52.7 / 49.5 |
| friendly duels (2,486 / 2,486 / 991) | 26.3 / 14.9 | 29.9 / 23.9 | 41.9 / 31.4 |

Printed probability against what happened, first pick, everyone: 45.6 -> 47.4,
65.6 -> 67.3, 83.9 -> 86.8. Before the sharpness and new-deck parts the same
pick printed 96% for something that happened 64% of the time.

**The kind of duel matters and the screen does not ask for it yet.** With the
kind unknown the read uses the player's friendly share, and in friendly duels
it is still over-confident at the top (prints 65%, happens 40%); told the duel
is friendly it prints 64% for 56%. `read(..., friendly_now=)` takes it; the
route parameter and a toggle on the screen are part of step 2.

`brain-evidence/duel_replay_20261007/run_trainer_local.py` runs the production
trainer on the local export (2.5 minutes); `replay_module.py` replays the
cohorts through the production module; `calib_diag.py` splits over-confidence
into its two causes.

### 2026-10-07 — steps 1 and 2 shipped

**Server, deployed 12:09 UTC** (backups
`{coach,duel_index,app,after_poll,test_coach,test_duel_index}.py.bak-20261007-120910-preduelread`;
`.duel_read.json` fitted on the server on 171,054 duels in 197 s):

- `coach._history` builds `read` (the same series in the read's shape) and
  `firsts` from EVERY series; native duels get per-game results from
  `duel_index.player_results` (new).
- `coach.opening_decks` / `next_decks` / `opponent_next` ask `_read_rows`
  first and fall back to the count; the payload gains `engine`, `newDeck` and
  `left`, opponent rows gain `p`.
- `opponent_next` scores up to five of the read's decks (`OPP_READ_DECKS`),
  each worth at least 3%. For a player who rotates, three held 41%.
- `kind=friendly|war` on `/coach/predict` and `/coach/suggest`; `duelRead` on
  `/api/analytics/status`; `after_poll.py` refits the read after each poll.

**Client:** the `LeftPanel` block in both Coach Assist windows, the `new deck`
figure, the Clan war / Friendly switch, each opponent deck printed at the
read's own figure (screen and PDF), release note `2026-10-07-duel-read`.

**Measured through the production code path, on the server** (history built
by the real `coach._history`, cut strictly before each duel; the 950
player-duels of the CRL-list players, 30 days): exact deck first / in the top
three —

| | the count | the read |
|---|---|---|
| game 1 | 19.8% / 34.6% | **40.3% / 57.8%** |
| game 2 | 29.2% / 50.0% | **39.5% / 64.8%** |
| game 3 | 39.9% / 53.4% | **49.4% / 67.8%** |

Reading native duels only (dropping the reconstructed friendly-practice
series) is a point or two better at games 1 and 2 (42.3 / 59.9, 40.6 / 65.9)
and worse in the top three at game 3 (66.3). Not adopted: it is inside the
noise of 950 and it would leave players with no native duel unread.

The whole Suggestion on 12 real pairs, deployed code against staged code (48
answers): 0 illegal decks in either, median 0.70 s -> 0.64 s, "Play this" the
same in 22 of 48. Live after the deploy: predict about 1 s, `kind` moves the
new-deck figure (4.3% war / 8.1% not told / 13.4% friendly on one real pair),
the suggestion scored against five of their decks.

**Tests:** `server/test_duel_read.py` 55 (ten planted faults, ten caught),
`test_coach.py` 143 (eight planted in the wiring, eight caught),
`test_duel_index.py` 71, `tests/coachDuelRead.test.ts` 9. Browser, production
data with real staged payloads replayed: 66 of 66 (both themes, 390 px).

**Live as `365a852`.** `/api/health` reported it about 70 s after the push;
the served bundle carries the release note and the block. 16 of 16 in a real
browser on https://deckkies.com signed in as the account holder (dark, 1440):
the opening read, a pasted game 1, the Friendly switch re-asking with
`kind=friendly`, and the Suggestion. The staging directories on the server are
removed. Full local run: 4,123 Python checks across 73 suites (only the known
`test_ml_21a`), 1,402 vitest across 61 files.

**Still to watch:** the first refit of the read by `after_poll.py` under its
timer (no battle had arrived since the deploy when this was written). Check
`/var/log/clashbot/after-poll.log` for a `duel read: exit 0` line and
`duelRead.trainedAt` on `/api/analytics/status`.

**Known and left for later steps:**

- The kind of duel is only as good as the switch. Not told, a friendly duel is
  read over-confidently at the top (prints 65%, happens 40%).
- `lost_prev` (the opponent lost the previous game) is never sent — the screen
  does not ask who won. Step 3 adds the question.
- `coach.observed_sequences` still treats native duels as unordered ("game
  order not recorded" on the loadout list). It matches by membership, which is
  what that list wants for two reveals; switching it to ordered matching needs
  its own measurement.
- The read is fitted on native duels; reconstructed friendly-practice series
  are fed to it too but were not in the fit.
- The unseen-deck share is printed, not scored against: the expected win rate
  is over the decks listed.

## Next action

**Step 3 — pick for the duel, not the game.** In `coach.suggest`, value each of
my decks by the chance of winning the DUEL: look ahead over the read's
distribution for their games 2 and 3 (`read` with the hypothetical reveals) and
over my own remaining legal decks, on the combined brain's rates. Ask who won
each game (one more step in the interview, `res=` on the route), pass
`lost_prev` to the read, and update the win chance for the games left (after
winning game 1 a player wins game 2 57.5% where the model says 51.6%). Rate it
on `replay_series2.py` with the independent judge and on real outcomes before
it ships; the bar is the myopic pick with the new read (50.28% / 53.2%).
