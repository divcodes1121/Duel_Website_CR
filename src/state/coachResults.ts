/**
 * COACH ROSTER — WHAT ACTUALLY HAPPENED: the pure half.
 *
 * NO SUPABASE, NO REACT. The arithmetic that turns a handful of recorded
 * matches into a sentence about whether the advice is working is the part
 * most able to mislead, so it lives where it can be tested alone.
 *
 * THIS IS THE END OF THE CHAIN: recommendation → decision → deck played →
 * result. Phases 5 and 6 recorded the first two and froze the reasoning; this
 * one records the last two and is the only phase that can say whether any of
 * it helped.
 *
 * THREE RULES, AND THEY ARE WHAT MAKE THE NUMBERS WORTH HAVING.
 *
 *   1. THE CARDS DECIDE WHICH SLOT WAS PLAYED, not the coach's memory.
 *      `inferSlot` matches the deck played against the plan's own slots by
 *      the order-free deck key. A coach recording a loss is the least
 *      reliable moment to ask "was that the backup or the alternative?", and
 *      a misremembered slot would corrupt the one figure this phase exists
 *      to produce.
 *
 *   2. NOTHING IS CLAIMED UNDER A FLOOR. Four matches cannot say whether the
 *      engine's picks beat the coach's own. Below the floor the screen says
 *      how many are recorded and nothing else — not a percentage with a
 *      caveat, which is read as a percentage.
 *
 *   3. TEST PLANS AND TEST RESULTS ARE EXCLUDED FROM EVERY FIGURE. That is
 *      what the flag is for: trying the tool out must not become evidence
 *      about the advice.
 */

import { deckKey } from './coachArsenal';
import type { MatchPlan, PlanSlot, PlanSource } from './coachPlans';

export type MatchOutcome = 'win' | 'loss' | 'draw';
/** Which planned deck was played — or `other`, meaning they went off-plan. */
export type PlayedSlot = PlanSlot | 'other';

export const OUTCOME_LABEL: Record<MatchOutcome, string> = {
  win: 'Won',
  loss: 'Lost',
  draw: 'Drew',
};

export const PLAYED_SLOT_LABEL: Record<PlayedSlot, string> = {
  primary: 'The primary',
  backup: 'The backup',
  alternative: 'The alternative',
  other: 'Off-plan',
};

export const RESULT_NOTES_MAX = 4000;

export interface MatchResult {
  id: string;
  playerId: string;
  /** Null for a result logged without a plan — a match that just happened. */
  planId: string | null;
  opponentTag: string;
  deckPlayed: string[];
  playedSlot: PlayedSlot | null;
  result: MatchOutcome;
  playerCrowns: number | null;
  opponentCrowns: number | null;
  notes: string | null;
  playedAt: string;
  testMode: boolean;
  createdAt: string;
}

export interface NewMatchResult {
  planId?: string | null;
  opponentTag: string;
  deckPlayed: string[];
  playedSlot?: PlayedSlot | null;
  result: MatchOutcome;
  playerCrowns?: number | null;
  opponentCrowns?: number | null;
  notes?: string | null;
  playedAt?: string;
  testMode?: boolean;
}

export interface ResultRepo {
  readonly kind: 'supabase' | 'memory';
  list(playerId: string): Promise<MatchResult[]>;
  add(playerId: string, result: NewMatchResult): Promise<MatchResult>;
  remove(id: string): Promise<void>;
}

export class ResultError extends Error {
  constructor(
    public readonly code: 'invalid_deck' | 'invalid_tag' | 'too_long' | 'bad_crowns' | 'not_authorised' | 'unknown',
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ResultError';
  }
}

export function explainResultError(code: string | undefined, message: string): ResultError {
  switch (code) {
    case '23514':
      return new ResultError('invalid_deck', 'The database refused that result as malformed.', message);
    case '42501':
      return new ResultError('not_authorised', 'The database refused this: Coach Roster is for administrators only.', message);
    default:
      return new ResultError('unknown', 'Could not save that result.', message);
  }
}

/**
 * Which of the plan's slots these eight cards are.
 *
 * ORDER-FREE, via the same key the table generates, so a deck rebuilt in a
 * different order still matches. `other` is a real answer and the honest one
 * when the player brought something the plan never named.
 */
export function inferSlot(plan: Pick<MatchPlan, 'decks'> | null, cards: readonly string[]): PlayedSlot {
  if (!plan) return 'other';
  const key = deckKey(cards);
  return plan.decks.find((d) => deckKey(d.cards) === key)?.slot ?? 'other';
}

/** Where the deck that was played came from, when the plan can say. Null when
 *  it was off-plan — an unplanned deck has no recorded provenance, and
 *  guessing one would invent the very fact this phase measures. */
export function playedSource(plan: Pick<MatchPlan, 'decks'> | null, cards: readonly string[]): PlanSource | null {
  if (!plan) return null;
  const key = deckKey(cards);
  return plan.decks.find((d) => deckKey(d.cards) === key)?.source ?? null;
}

const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

export function cleanNewResult(r: NewMatchResult, normaliseTag: (t: string) => string | null): NewMatchResult {
  const tag = normaliseTag(r.opponentTag ?? '');
  if (!tag) {
    throw new ResultError(
      'invalid_tag',
      'That is not a Clash Royale player tag — # followed by 5 to 12 of 0 2 8 9 P Y L Q G R J C U V.',
    );
  }
  const cards = [...(r.deckPlayed ?? [])];
  if (cards.length !== 8 || new Set(cards).size !== 8) {
    throw new ResultError('invalid_deck', 'A result needs the eight distinct cards that were actually played.');
  }
  for (const [name, v] of [
    ['Your crowns', r.playerCrowns],
    ['Their crowns', r.opponentCrowns],
  ] as const) {
    if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0 || v > 3)) {
      throw new ResultError('bad_crowns', `${name} is 0 to 3, or left blank.`);
    }
  }
  const notes = clean(r.notes);
  if (notes && notes.length > RESULT_NOTES_MAX) {
    throw new ResultError('too_long', `Notes can be at most ${RESULT_NOTES_MAX} characters.`);
  }
  return { ...r, opponentTag: tag, deckPlayed: cards, notes, testMode: r.testMode ?? false };
}

/* ── the learning loop ──────────────────────────────────────────────────── */

/** Recorded matches before anything is said about a rate. Ten is not a
 *  research threshold; it is the point below which one match moves the figure
 *  by ten points and a reader would rightly ignore it. */
export const LEARNING_FLOOR = 10;
/** Matches behind ONE source before that source's rate is printed. */
export const SOURCE_FLOOR = 5;

export interface SourceRecord {
  source: PlanSource | 'off_plan';
  played: number;
  wins: number;
  /** Null under the floor — never a percentage the next match would rewrite. */
  winRate: number | null;
}

export interface Learning {
  /** Real, non-test results only. */
  recorded: number;
  /** Of those, how many were played against a plan at all. */
  withPlan: number;
  followed: number;
  /** Null under the floor. */
  followRate: number | null;
  wins: number;
  winRate: number | null;
  bySource: SourceRecord[];
  /** What cannot be said yet, in words, or null when nothing is withheld. */
  withheld: string | null;
}

/**
 * What the recorded matches support — and nothing more.
 *
 * TEST ROWS ARE DROPPED FIRST, both the result's own flag and the plan's:
 * a plan made while trying the tool out produces results that are not
 * evidence about the advice.
 */
export function learn(results: readonly MatchResult[], plans: readonly MatchPlan[]): Learning {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const real = results.filter((r) => {
    if (r.testMode) return false;
    const plan = r.planId ? planById.get(r.planId) : null;
    return !plan?.testMode;
  });

  const withPlan = real.filter((r) => r.planId && planById.has(r.planId));
  const followed = withPlan.filter((r) => r.playedSlot && r.playedSlot !== 'other');
  const wins = real.filter((r) => r.result === 'win').length;

  const buckets = new Map<SourceRecord['source'], { played: number; wins: number }>();
  for (const r of real) {
    const plan = r.planId ? (planById.get(r.planId) ?? null) : null;
    const src = playedSource(plan, r.deckPlayed) ?? 'off_plan';
    const b = buckets.get(src) ?? { played: 0, wins: 0 };
    b.played += 1;
    if (r.result === 'win') b.wins += 1;
    buckets.set(src, b);
  }

  const bySource: SourceRecord[] = [...buckets.entries()]
    .map(([source, b]) => ({
      source,
      played: b.played,
      wins: b.wins,
      winRate: b.played >= SOURCE_FLOOR ? (b.wins / b.played) * 100 : null,
    }))
    .sort((a, b) => b.played - a.played);

  const thin = real.length < LEARNING_FLOOR;
  return {
    recorded: real.length,
    withPlan: withPlan.length,
    followed: followed.length,
    followRate: withPlan.length >= LEARNING_FLOOR ? (followed.length / withPlan.length) * 100 : null,
    wins,
    winRate: thin ? null : (wins / real.length) * 100,
    bySource,
    withheld: thin
      ? `${real.length} match${real.length === 1 ? '' : 'es'} recorded. Rates appear at ${LEARNING_FLOOR} — below that one match moves the figure by ten points.`
      : null,
  };
}

export const SOURCE_RECORD_LABEL: Record<SourceRecord['source'], string> = {
  coach_assist: 'Decks the engine suggested',
  arsenal: 'Decks from their arsenal',
  manual: 'Decks you chose yourself',
  variant: 'Variants of another deck',
  off_plan: 'Played off-plan',
};

/** Newest match first — a results list is read to see how the last few went. */
export function sortResults(results: readonly MatchResult[]): MatchResult[] {
  return [...results].sort((a, b) => b.playedAt.localeCompare(a.playedAt) || b.createdAt.localeCompare(a.createdAt));
}

/** The record as a plain string: 5W 2L 1D. */
export function tallyOf(results: readonly MatchResult[]): { wins: number; losses: number; draws: number; text: string } {
  const wins = results.filter((r) => r.result === 'win').length;
  const losses = results.filter((r) => r.result === 'loss').length;
  const draws = results.filter((r) => r.result === 'draw').length;
  return { wins, losses, draws, text: `${wins}W ${losses}L${draws ? ` ${draws}D` : ''}` };
}

/* ── the in-memory repository ───────────────────────────────────────────── */

export function memoryResultRepo(seed: MatchResult[] = []): ResultRepo {
  let rows = [...seed];
  let n = 0;
  return {
    kind: 'memory',
    async list(playerId) {
      return sortResults(rows.filter((r) => r.playerId === playerId));
    },
    async add(playerId, result) {
      const now = new Date().toISOString();
      const row: MatchResult = {
        id: `mem-result-${++n}`,
        playerId,
        planId: result.planId ?? null,
        opponentTag: result.opponentTag,
        deckPlayed: [...result.deckPlayed],
        playedSlot: result.playedSlot ?? null,
        result: result.result,
        playerCrowns: result.playerCrowns ?? null,
        opponentCrowns: result.opponentCrowns ?? null,
        notes: result.notes ?? null,
        playedAt: result.playedAt ?? now,
        testMode: result.testMode ?? false,
        createdAt: now,
      };
      rows = [...rows, row];
      return row;
    },
    async remove(id) {
      rows = rows.filter((r) => r.id !== id);
    },
  };
}
