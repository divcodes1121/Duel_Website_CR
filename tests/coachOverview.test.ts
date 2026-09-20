import { describe, expect, it } from 'vitest';

import type { RosterPlayer } from '../src/state/coachRoster';
import {
  FLAG_ACTION,
  FLAG_LABEL,
  ROSTER_RATE_FLOOR,
  sortOverview,
  summarise,
  totals,
  type AttentionFlag,
  type OverviewInput,
} from '../src/state/coachOverview';

const player = (id: string, over: Partial<RosterPlayer> = {}): RosterPlayer => ({
  id,
  playerTag: `#${id.toUpperCase()}`,
  displayName: id,
  notes: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

const input = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  players: [player('p1')],
  decks: [],
  plans: [],
  results: [],
  ...over,
});

const deck = (playerId: string, status = 'active') => ({ playerId, status });
const plan = (id: string, playerId: string, status = 'draft', testMode = false) => ({
  id,
  playerId,
  status,
  testMode,
  createdAt: '2026-09-10T00:00:00Z',
});
const res = (playerId: string, over: Partial<{ result: string; testMode: boolean; planId: string | null; playedAt: string }> = {}) => ({
  playerId,
  result: 'win',
  testMode: false,
  planId: null,
  playedAt: '2026-09-19T00:00:00Z',
  ...over,
});

describe('what the roster screen counts', () => {
  it('counts only ACTIVE arsenal decks', () => {
    const [row] = summarise(input({ decks: [deck('p1'), deck('p1', 'archived')] }));
    expect(row.arsenal).toBe(1);
  });

  it('keeps each player’s rows apart', () => {
    const rows = summarise(
      input({ players: [player('p1'), player('p2')], decks: [deck('p1'), deck('p1'), deck('p2')] }),
    );
    expect(rows.map((r) => r.arsenal)).toEqual([2, 1]);
  });

  it('leaves test plans and test results out of every figure', () => {
    const [row] = summarise(
      input({
        plans: [plan('a', 'p1'), plan('b', 'p1', 'draft', true)],
        results: [res('p1'), res('p1', { testMode: true })],
      }),
    );
    expect(row.plans).toBe(1);
    expect(row.results).toBe(1);
  });

  it('withholds a win rate under the same floor the results screen uses', () => {
    const thin = summarise(input({ results: Array.from({ length: ROSTER_RATE_FLOOR - 1 }, () => res('p1')) }));
    expect(thin[0].winRate).toBeNull();
    const enough = summarise(input({ results: Array.from({ length: ROSTER_RATE_FLOOR }, () => res('p1')) }));
    expect(enough[0].winRate).toBe(100);
  });

  it('takes last activity from the latest plan or result, whichever is newer', () => {
    const [row] = summarise(
      input({ plans: [plan('a', 'p1')], results: [res('p1', { playedAt: '2026-09-19T00:00:00Z' })] }),
    );
    expect(row.lastActivity).toBe('2026-09-19T00:00:00Z');
  });
});

describe('the attention flags', () => {
  const flagsOf = (i: Partial<OverviewInput>): AttentionFlag[] => summarise(input(i))[0].flags;

  it('name what is missing at each step of the workflow', () => {
    expect(flagsOf({})).toContain('no_arsenal');
    expect(flagsOf({})).toContain('no_plans');
  });

  it('point at a draft that was never confirmed', () => {
    expect(flagsOf({ decks: [deck('p1')], plans: [plan('a', 'p1', 'draft')] })).toContain('plan_unconfirmed');
  });

  it('point at a CONFIRMED plan with no result — the loop left open', () => {
    expect(flagsOf({ decks: [deck('p1')], plans: [plan('a', 'p1', 'confirmed')] })).toContain('plan_without_result');
  });

  it('stop pointing once the result is recorded against THAT plan', () => {
    const flags = flagsOf({
      decks: [deck('p1')],
      plans: [plan('a', 'p1', 'confirmed')],
      results: [res('p1', { planId: 'a' })],
    });
    expect(flags).not.toContain('plan_without_result');
  });

  it('are not fooled by a result recorded against a DIFFERENT plan', () => {
    const flags = flagsOf({
      decks: [deck('p1')],
      plans: [plan('a', 'p1', 'confirmed')],
      results: [res('p1', { planId: 'other-plan' })],
    });
    expect(flags).toContain('plan_without_result');
  });

  it('withhold "not collected" when the tracked set is unknown', () => {
    expect(flagsOf({})).not.toContain('not_collected');
    expect(summarise(input({ trackedTags: new Set<string>() }))[0].flags).toContain('not_collected');
    expect(summarise(input({ trackedTags: new Set(['#P1']) }))[0].flags).not.toContain('not_collected');
  });

  it('every flag has a label and an action — a flag with no action is a nag', () => {
    for (const flag of Object.keys(FLAG_LABEL) as AttentionFlag[]) {
      expect(FLAG_LABEL[flag].length).toBeGreaterThan(0);
      expect(FLAG_ACTION[flag].length).toBeGreaterThan(0);
    }
  });

  it('never judge the player, only the preparation', () => {
    const words = Object.values(FLAG_LABEL).concat(Object.values(FLAG_ACTION)).join(' ').toLowerCase();
    for (const bad of ['weak', 'bad', 'poor', 'lazy', 'behind', 'failing']) {
      expect(words).not.toContain(bad);
    }
  });
});

describe('the order', () => {
  it('is roster order — active first, then by name, never by attention', () => {
    const rows = summarise(
      input({
        players: [player('zed'), player('amy'), player('old', { isActive: false })],
      }),
    );
    expect(sortOverview(rows).map((r) => r.player.id)).toEqual(['amy', 'zed', 'old']);
  });

  it('does not move a flagged player up', () => {
    const rows = summarise(
      input({ players: [player('amy'), player('zed')], decks: [deck('amy')], plans: [plan('a', 'amy')] }),
    );
    // zed has every flag; amy has fewer. Order is still alphabetical.
    expect(sortOverview(rows).map((r) => r.player.id)).toEqual(['amy', 'zed']);
  });
});

describe('the roster totals', () => {
  it('count active players only', () => {
    const rows = summarise(input({ players: [player('a'), player('b', { isActive: false })] }));
    expect(totals(rows).players).toBe(1);
  });

  it('say how many need something done', () => {
    const rows = summarise(
      input({
        players: [player('a'), player('b')],
        decks: [deck('a')],
        plans: [plan('p', 'a', 'confirmed')],
        results: [res('a', { planId: 'p' })],
      }),
    );
    // a is complete; b has nothing at all.
    expect(totals(rows).needingAttention).toBe(1);
    expect(totals(rows).withArsenal).toBe(1);
  });
});
