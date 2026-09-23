import { describe, expect, it } from 'vitest';

import { todayRow, todaySummary, type TodayPlanInput } from '../src/state/coachToday';

const rec = (name: string, rate = 60, fromWeighting = false) => ({
  key: name.toLowerCase(),
  name,
  expectedWinRate: rate,
  cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  fromWeighting,
});

const plan = (over: Partial<TodayPlanInput> = {}): TodayPlanInput => ({
  basis: 'weighted',
  battles: 700,
  tailoredPicks: 0,
  recommendations: [rec('Graveyard', 63.7), rec('Bridge Spam', 61.2)],
  weighted: [
    { archetype: 'drill', name: 'Goblin Drill', battles: 18, winRate: 22.2, deficit: 38.1 },
    { archetype: 'bridge-spam', name: 'Bridge Spam', battles: 100, winRate: 49, deficit: 11.3 },
  ],
  ...over,
});

describe('one row per player', () => {
  it('a plan the weighting actually changed is tailored, and says by how much', () => {
    const r = todayRow('#A', 'RIZAL', plan({ tailoredPicks: 1 }));
    expect(r.kind).toBe('tailored');
    expect(r.note).toContain('1 of 2 picks is here');
    expect(r.workOn).toEqual(['Goblin Drill', 'Bridge Spam']);
  });

  /* THE DISTINCTION THIS WHOLE MODULE EXISTS FOR. Live, the weighting changes
     0-1 of 7 picks, so 'weighted' alone is not 'tailored'. */
  it('weighted but unchanged is ORDERED, never tailored', () => {
    const r = todayRow('#A', 'NannoS', plan({ tailoredPicks: 0 }));
    expect(r.kind).toBe('ordered');
    expect(r.note).toContain('moved the order, not the set');
    expect(r.note).not.toContain('because of their own record');
  });

  it('history that clears no floor is the field’s answer, and says why', () => {
    const r = todayRow('#A', 'Kuru', plan({ basis: 'unweighted', battles: 17, weighted: [] }));
    expect(r.kind).toBe('field');
    expect(r.note).toContain('17 battles');
    expect(r.workOn).toEqual([]);
  });

  it('a player with nothing stored is told that, not given a tailored claim', () => {
    const r = todayRow('#A', 'New', plan({ basis: 'no_history', battles: 0, weighted: [] }));
    expect(r.kind).toBe('new');
    expect(r.note).toContain('Nothing stored');
    expect(r.pick).not.toBeNull();
  });

  /* "No plan" and "we could not ask" look identical on a row and mean
     opposite things. */
  it('a plan that could not be read is its own kind', () => {
    expect(todayRow('#A', 'X', null).kind).toBe('failed');
    expect(todayRow('#A', 'X', plan({ basis: 'none' })).kind).toBe('failed');
    expect(todayRow('#A', 'X', plan({ recommendations: [] })).kind).toBe('failed');
    expect(todayRow('#A', 'X', null).pick).toBeNull();
  });

  it('carries the one deck to put in front of them, with its cards', () => {
    const r = todayRow('#A', 'RIZAL', plan({ tailoredPicks: 1 }));
    expect(r.pick?.name).toBe('Graveyard');
    expect(r.pick?.expectedWinRate).toBe(63.7);
    expect(r.pick?.cards).toHaveLength(8);
  });

  it('a brief payload whose later picks dropped their cards still works', () => {
    const r = todayRow('#A', 'RIZAL', plan({
      recommendations: [{ key: 'g', name: 'Graveyard', expectedWinRate: 63.7 }],
    }));
    expect(r.pick?.cards).toEqual([]);
    expect(r.kind).toBe('ordered');
  });

  it('never uses an adjective the plan cannot carry', () => {
    const text = [
      todayRow('#A', 'A', plan({ tailoredPicks: 1 })),
      todayRow('#B', 'B', plan({ basis: 'unweighted', weighted: [] })),
      todayRow('#C', 'C', null),
    ].map((r) => r.note).join(' ').toLowerCase();
    for (const w of ['best', 'worst', 'ready', 'unready', 'weak', 'strong', 'should win']) {
      expect(text).not.toContain(w);
    }
  });
});

describe('the roster line', () => {
  const rows = [
    todayRow('#A', 'A', plan({ tailoredPicks: 1 })),
    todayRow('#B', 'B', plan({ tailoredPicks: 0 })),
    todayRow('#C', 'C', plan({ basis: 'unweighted', weighted: [] })),
    todayRow('#D', 'D', null),
  ];

  it('counts the kinds apart rather than calling them all plans', () => {
    const s = todaySummary(rows);
    expect(s.players).toBe(4);
    expect(s.tailored).toBe(1);
    expect(s.ordered).toBe(1);
    expect(s.field).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.line).toContain('3 of 4 have a plan for today');
    expect(s.line).toContain('1 shaped by their own record');
    expect(s.line).toContain('1 could not be read');
  });

  it('a failure is excluded from the plan count, not folded into it', () => {
    expect(todaySummary([todayRow('#D', 'D', null)]).line).not.toContain('1 of 1 have a plan');
  });

  it('is counts only — never a ranking word', () => {
    const line = todaySummary(rows).line.toLowerCase();
    for (const w of ['best', 'top', 'worst', 'ranked', 'leading', 'behind']) {
      expect(line).not.toContain(w);
    }
  });

  it('an empty roster says so', () => {
    expect(todaySummary([]).line).toContain('No active players');
  });
});
