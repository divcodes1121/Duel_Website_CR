import { describe, expect, it } from 'vitest';

import { normalizeTag } from '../src/state/coachRoster';
import type { MatchPlan, PlanDeck } from '../src/state/coachPlans';
import {
  LEARNING_FLOOR,
  ResultError,
  SOURCE_FLOOR,
  cleanNewResult,
  inferSlot,
  learn,
  memoryResultRepo,
  playedSource,
  sortResults,
  tallyOf,
  type MatchResult,
} from '../src/state/coachResults';

const HOG = ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];
const GOLEM = ['golem', 'night-witch', 'baby-dragon', 'lumberjack', 'tornado', 'lightning', 'mega-minion', 'barbarian-barrel'];
const XBOW = ['x-bow', 'tesla', 'archers', 'knight', 'skeletons', 'ice-spirit', 'fireball', 'the-log'];

const planDeck = (slot: PlanDeck['slot'], cards: string[], source: PlanDeck['source']): PlanDeck => ({
  id: `${slot}-deck`,
  planId: 'plan1',
  slot,
  cards,
  source,
  sourceRef: null,
  name: slot,
  createdAt: '2026-09-01T00:00:00Z',
});

const plan = (over: Partial<MatchPlan> = {}): MatchPlan =>
  ({
    id: 'plan1',
    playerId: 'p1',
    opponentTag: '#2PYLQ0',
    opponentName: 'Rival',
    recommendations: [],
    engine: null,
    generatedAt: null,
    status: 'confirmed',
    confirmedAt: null,
    notes: null,
    testMode: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    decks: [planDeck('primary', HOG, 'coach_assist'), planDeck('backup', GOLEM, 'arsenal')],
    ...over,
  }) as MatchPlan;

const result = (over: Partial<MatchResult> = {}): MatchResult => ({
  id: `r${Math.random()}`,
  playerId: 'p1',
  planId: 'plan1',
  opponentTag: '#2PYLQ0',
  deckPlayed: HOG,
  playedSlot: 'primary',
  result: 'win',
  playerCrowns: null,
  opponentCrowns: null,
  notes: null,
  playedAt: '2026-09-19T12:00:00Z',
  testMode: false,
  createdAt: '2026-09-19T12:00:00Z',
  ...over,
});

describe('the cards decide which slot was played', () => {
  it('matches a planned deck whatever order it was rebuilt in', () => {
    expect(inferSlot(plan(), [...HOG].reverse())).toBe('primary');
    expect(inferSlot(plan(), GOLEM)).toBe('backup');
  });

  it('calls a deck the plan never named off-plan', () => {
    expect(inferSlot(plan(), XBOW)).toBe('other');
  });

  it('is off-plan when there was no plan at all', () => {
    expect(inferSlot(null, HOG)).toBe('other');
  });

  it('reads the source from the plan, and refuses to guess one off-plan', () => {
    expect(playedSource(plan(), HOG)).toBe('coach_assist');
    expect(playedSource(plan(), GOLEM)).toBe('arsenal');
    expect(playedSource(plan(), XBOW)).toBeNull();
  });
});

describe('recording a result', () => {
  it('needs the eight cards that were actually played', () => {
    expect(() => cleanNewResult({ opponentTag: '#2PYLQ0', deckPlayed: HOG.slice(0, 7), result: 'win' }, normalizeTag)).toThrow(
      ResultError,
    );
    expect(() =>
      cleanNewResult({ opponentTag: '#2PYLQ0', deckPlayed: [...HOG.slice(0, 7), 'hog-rider'], result: 'win' }, normalizeTag),
    ).toThrow(/eight distinct/);
  });

  it('refuses a tag that is not one', () => {
    expect(() => cleanNewResult({ opponentTag: 'nope', deckPlayed: HOG, result: 'win' }, normalizeTag)).toThrow(/player tag/);
  });

  it('holds crowns to 0–3, or blank', () => {
    expect(cleanNewResult({ opponentTag: '#2PYLQ0', deckPlayed: HOG, result: 'win', playerCrowns: 3 }, normalizeTag).playerCrowns).toBe(3);
    expect(() =>
      cleanNewResult({ opponentTag: '#2PYLQ0', deckPlayed: HOG, result: 'win', playerCrowns: 4 }, normalizeTag),
    ).toThrow(/0 to 3/);
  });

  it('is real coaching unless it says otherwise', () => {
    expect(cleanNewResult({ opponentTag: '#2PYLQ0', deckPlayed: HOG, result: 'loss' }, normalizeTag).testMode).toBe(false);
  });
});

describe('the learning loop', () => {
  const many = (n: number, over: Partial<MatchResult> = {}) => Array.from({ length: n }, () => result(over));

  it('says how many are recorded and NOTHING else under the floor', () => {
    const out = learn(many(LEARNING_FLOOR - 1), [plan()]);
    expect(out.winRate).toBeNull();
    expect(out.followRate).toBeNull();
    expect(out.withheld).toMatch(/Rates appear at 10/);
  });

  it('reports rates once there is enough', () => {
    const out = learn([...many(6), ...many(4, { result: 'loss' })], [plan()]);
    expect(out.recorded).toBe(10);
    expect(out.winRate).toBeCloseTo(60);
    expect(out.withheld).toBeNull();
  });

  it('measures whether the plan was actually followed', () => {
    const out = learn([...many(7), ...many(3, { deckPlayed: XBOW, playedSlot: 'other' })], [plan()]);
    expect(out.withPlan).toBe(10);
    expect(out.followed).toBe(7);
    expect(out.followRate).toBeCloseTo(70);
  });

  it('splits outcomes by where the deck came from', () => {
    const out = learn(
      [
        ...many(SOURCE_FLOOR, { deckPlayed: HOG }), // engine picks, all won
        ...many(SOURCE_FLOOR, { deckPlayed: GOLEM, playedSlot: 'backup', result: 'loss' }), // arsenal, all lost
      ],
      [plan()],
    );
    const engine = out.bySource.find((s) => s.source === 'coach_assist');
    const arsenal = out.bySource.find((s) => s.source === 'arsenal');
    expect(engine).toMatchObject({ played: SOURCE_FLOOR, wins: SOURCE_FLOOR, winRate: 100 });
    expect(arsenal).toMatchObject({ played: SOURCE_FLOOR, wins: 0, winRate: 0 });
  });

  it('withholds a source’s rate under ITS own floor', () => {
    const out = learn(many(SOURCE_FLOOR - 1), [plan()]);
    expect(out.bySource[0].winRate).toBeNull();
    expect(out.bySource[0].played).toBe(SOURCE_FLOOR - 1);
  });

  it('counts an off-plan deck as off-plan rather than inventing a source', () => {
    const out = learn(many(3, { deckPlayed: XBOW, playedSlot: 'other' }), [plan()]);
    expect(out.bySource[0].source).toBe('off_plan');
  });

  it('EXCLUDES test results and results from test plans', () => {
    const real = learn(
      [...many(2), ...many(5, { testMode: true }), ...many(5, { planId: 'testplan' })],
      [plan(), plan({ id: 'testplan', testMode: true })],
    );
    expect(real.recorded).toBe(2);
  });

  it('counts a result with no plan, without pretending it followed one', () => {
    const out = learn(many(4, { planId: null, playedSlot: null }), []);
    expect(out.recorded).toBe(4);
    expect(out.withPlan).toBe(0);
    expect(out.followRate).toBeNull();
    expect(out.bySource[0].source).toBe('off_plan');
  });
});

describe('the results list', () => {
  it('reads newest match first', async () => {
    const repo = memoryResultRepo();
    await repo.add('p1', { opponentTag: '#2PYLQ0', deckPlayed: HOG, result: 'win', playedAt: '2026-09-01T00:00:00Z' });
    await repo.add('p1', { opponentTag: '#2PYLQ0', deckPlayed: GOLEM, result: 'loss', playedAt: '2026-09-19T00:00:00Z' });
    const rows = await repo.list('p1');
    expect(rows[0].result).toBe('loss');
  });

  it('keeps results per player', async () => {
    const repo = memoryResultRepo();
    await repo.add('p1', { opponentTag: '#2PYLQ0', deckPlayed: HOG, result: 'win' });
    await repo.add('p2', { opponentTag: '#2PYLQ0', deckPlayed: HOG, result: 'win' });
    expect(await repo.list('p1')).toHaveLength(1);
  });

  it('prints a record without inventing a draw column', () => {
    expect(tallyOf([result(), result({ result: 'loss' })]).text).toBe('1W 1L');
    expect(tallyOf([result({ result: 'draw' })]).text).toBe('0W 0L 1D');
  });

  it('sorts a mixed list by when the match was played', () => {
    const a = result({ playedAt: '2026-09-01T00:00:00Z' });
    const b = result({ playedAt: '2026-09-19T00:00:00Z' });
    expect(sortResults([a, b])[0]).toBe(b);
  });
});
