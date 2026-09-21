import { describe, expect, it } from 'vitest';

import type { TeamRecommendation } from '../src/state/analyticsClient';
import { deckKey, type ArsenalDeck } from '../src/state/coachArsenal';
import { normalizeTag } from '../src/state/coachRoster';
import {
  PLAN_SLOTS,
  PlanError,
  buildSnapshot,
  candidateLabel,
  canConfirm,
  cleanNewPlan,
  deckInSlot,
  fitSnapshot,
  memoryPlanRepo,
  planGap,
  planLabel,
  sortPlans,
  type MatchPlan,
  type PlanCandidate,
} from '../src/state/coachPlans';

const HOG = ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];
const GOLEM = ['golem', 'night-witch', 'baby-dragon', 'lumberjack', 'tornado', 'lightning', 'mega-minion', 'barbarian-barrel'];
const XBOW = ['x-bow', 'tesla', 'archers', 'knight', 'skeletons', 'ice-spirit', 'fireball', 'the-log'];

const rec = (cards: string[], over: Partial<TeamRecommendation> = {}): TeamRecommendation =>
  ({
    cards,
    art: {},
    archetype: 'Hog Rider',
    name: 'Hog 2.6',
    avgElixir: 2.6,
    owner: { tag: '#P', name: 'Rahul' },
    comfort: { games: 147, wins: 90, winRate: 61, useRate: 40, bonus: 1 },
    expectedWinRate: 67.7,
    spreadCovered: 100,
    score: 68,
    matchups: [],
    ...over,
  }) as TeamRecommendation;

const arsenalDeck = (cards: string[], over: Partial<ArsenalDeck> = {}): ArsenalDeck => ({
  id: `a-${cards[0]}`,
  playerId: 'p1',
  cards,
  deckKey: deckKey(cards),
  name: `${cards[0]} deck`,
  archetype: 'Golem',
  comfort: 4,
  tags: [],
  status: 'active',
  source: 'manual',
  sourceRef: null,
  notes: null,
  sortOrder: 0,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

describe('freezing what the screen showed', () => {
  it('keeps BOTH sources, each labelled', () => {
    const snap = buildSnapshot([rec(HOG)], [arsenalDeck(GOLEM)], null);
    expect(snap.map((c) => c.source)).toEqual(['coach_assist', 'arsenal']);
  });

  it('carries the engine’s figures for its own picks', () => {
    const [pick] = buildSnapshot([rec(HOG)], [], null);
    expect(pick.expectedWinRate).toBe(67.7);
    expect(pick.spreadCovered).toBe(100);
    expect(pick.played).toBe(147);
  });

  it('records an unscored arsenal deck as NULL, never zero', () => {
    const snap = buildSnapshot([], [arsenalDeck(GOLEM)], null);
    expect(snap[0].expectedWinRate).toBeNull();
    expect(snap[0].spreadCovered).toBeNull();
  });

  it('does not list one deck twice when the engine picked an approved deck', () => {
    const snap = buildSnapshot([rec(HOG)], [arsenalDeck([...HOG].reverse())], null);
    expect(snap).toHaveLength(1);
    expect(snap[0].source).toBe('coach_assist');
  });

  it('leaves archived decks out of the freeze', () => {
    expect(buildSnapshot([], [arsenalDeck(GOLEM, { status: 'archived' })], null)).toEqual([]);
  });

  it('takes the played count from the player’s own history when the engine has none', () => {
    const played = new Map([[deckKey(GOLEM), 19]]);
    const [c] = buildSnapshot([], [arsenalDeck(GOLEM)], played);
    expect(c.played).toBe(19);
  });
});

describe('fitting the snapshot inside the column', () => {
  const big = (n: number, source: PlanCandidate['source']): PlanCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      cards: HOG,
      name: `deck ${i} ${'x'.repeat(40)}`,
      source,
      expectedWinRate: null,
      spreadCovered: null,
      played: null,
      archetype: null,
    }));

  it('leaves a snapshot that already fits alone', () => {
    const snap = big(3, 'arsenal');
    expect(fitSnapshot(snap)).toHaveLength(3);
  });

  it('drops unscored arsenal decks FIRST, keeping the engine’s picks', () => {
    const snap = [...big(2, 'coach_assist'), ...big(40, 'arsenal')];
    const out = fitSnapshot(snap, 900);
    expect(out.filter((c) => c.source === 'coach_assist')).toHaveLength(2);
    expect(out.length).toBeLessThan(snap.length);
  });
});

describe('a new plan', () => {
  it('refuses an opponent tag that is not one', () => {
    expect(() => cleanNewPlan({ opponentTag: 'nope' }, normalizeTag)).toThrow(PlanError);
  });

  it('normalises the tag and trims the text', () => {
    const p = cleanNewPlan({ opponentTag: '2pylq0', opponentName: '  Lion MG  ', notes: '   ' }, normalizeTag);
    expect(p.opponentTag).toBe('#2PYLQ0');
    expect(p.opponentName).toBe('Lion MG');
    expect(p.notes).toBeNull();
  });

  it('is real coaching unless it says otherwise', () => {
    expect(cleanNewPlan({ opponentTag: '#2PYLQ0' }, normalizeTag).testMode).toBe(false);
    expect(cleanNewPlan({ opponentTag: '#2PYLQ0', testMode: true }, normalizeTag).testMode).toBe(true);
  });
});

describe('slots', () => {
  it('are exactly three, in reading order', () => {
    expect(PLAN_SLOTS).toEqual(['primary', 'backup', 'alternative']);
  });

  it('hold one deck each — setting a taken slot replaces it', async () => {
    const repo = memoryPlanRepo();
    const plan = await repo.create('p1', { opponentTag: '#2PYLQ0' });
    await repo.setDeck(plan.id, { slot: 'primary', cards: HOG, source: 'coach_assist' });
    await repo.setDeck(plan.id, { slot: 'primary', cards: GOLEM, source: 'manual' });
    const [saved] = await repo.list('p1');
    expect(saved.decks).toHaveLength(1);
    expect(deckInSlot(saved, 'primary')?.source).toBe('manual');
  });

  it('can be cleared without touching the others', async () => {
    const repo = memoryPlanRepo();
    const plan = await repo.create('p1', { opponentTag: '#2PYLQ0' });
    await repo.setDeck(plan.id, { slot: 'primary', cards: HOG, source: 'arsenal' });
    await repo.setDeck(plan.id, { slot: 'backup', cards: GOLEM, source: 'arsenal' });
    await repo.clearDeck(plan.id, 'backup');
    const [saved] = await repo.list('p1');
    expect(saved.decks.map((d) => d.slot)).toEqual(['primary']);
  });
});

describe('confirming', () => {
  const plan = (decks: { slot: string }[], status = 'draft') =>
    ({ decks, status } as unknown as MatchPlan);

  it('needs a primary and nothing more', () => {
    expect(canConfirm(plan([{ slot: 'primary' }]))).toBe(true);
    expect(canConfirm(plan([{ slot: 'backup' }, { slot: 'alternative' }]))).toBe(false);
  });

  it('says what is missing, rather than disabling a button in silence', () => {
    expect(planGap(plan([]))).toMatch(/Pick a primary deck/);
    expect(planGap(plan([{ slot: 'primary' }]))).toBeNull();
  });

  it('is not offered twice for a plan already confirmed', () => {
    expect(canConfirm(plan([{ slot: 'primary' }], 'confirmed'))).toBe(false);
  });

  it('stamps the moment it was confirmed, once', async () => {
    const repo = memoryPlanRepo();
    const p = await repo.create('p1', { opponentTag: '#2PYLQ0' });
    const first = await repo.update(p.id, { status: 'confirmed' });
    expect(first.confirmedAt).not.toBeNull();
    const again = await repo.update(p.id, { notes: 'later edit' });
    expect(again.confirmedAt).toBe(first.confirmedAt);
  });
});

describe('the plan list', () => {
  it('reads newest first — you open it to find the match you are about to play', () => {
    const mk = (id: string, createdAt: string) => ({ id, createdAt } as MatchPlan);
    expect(sortPlans([mk('a', '2026-09-01T00:00:00Z'), mk('b', '2026-09-19T00:00:00Z')]).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('is labelled by the opponent’s name, falling back to the tag', () => {
    expect(planLabel({ opponentName: 'Lion MG', opponentTag: '#2PYLQ0' })).toBe('Lion MG');
    expect(planLabel({ opponentName: null, opponentTag: '#2PYLQ0' })).toBe('#2PYLQ0');
  });

  it('keeps plans per player', async () => {
    const repo = memoryPlanRepo();
    await repo.create('p1', { opponentTag: '#2PYLQ0' });
    await repo.create('p2', { opponentTag: '#2PYLQ0' });
    expect(await repo.list('p1')).toHaveLength(1);
  });

  it('keeps the frozen snapshot and the engine that made it', async () => {
    const repo = memoryPlanRepo();
    const snap = buildSnapshot([rec(XBOW)], [], null);
    const engine = { name: 'team_analysis', route: '/api/analytics/teams', days: 30, opponentTag: '#2PYLQ0', at: '2026-09-20T00:00:00Z' };
    const p = await repo.create('p1', { opponentTag: '#2PYLQ0', recommendations: snap, engine });
    const [saved] = await repo.list('p1');
    expect(saved.recommendations[0].cards).toEqual(XBOW);
    expect(saved.engine?.name).toBe('team_analysis');
    expect(saved.id).toBe(p.id);
  });
});

describe('a Deckkies pick is frozen as one', () => {
  /* Phase 7 reads results back against this snapshot. A win on a deck the
   * player had never played is evidence about something different from a win
   * on one of theirs, so the snapshot must keep them apart. */
  const pick = rec(GOLEM, { owner: null, comfort: null, fill: true, expectedWinRate: 71.7 });

  it('carries the fill mark into the frozen candidate', () => {
    const [c] = buildSnapshot([pick], [], null);
    expect(c.fill).toBe(true);
    expect(c.source).toBe('coach_assist');
    expect(c.played).toBeNull();
  });

  it('an owned pick carries no mark at all, not a false one', () => {
    const [c] = buildSnapshot([rec(HOG)], [], null);
    expect(c).not.toHaveProperty('fill');
  });

  it('describes a frozen pick as one the player had not played', () => {
    expect(candidateLabel({ source: 'coach_assist', fill: true })).toMatch(/had not played/);
    expect(candidateLabel({ source: 'coach_assist' })).toBe('The engine suggested it');
    expect(candidateLabel({ source: 'arsenal' })).toBe('From their arsenal');
  });
});
