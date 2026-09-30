import { describe, expect, it } from 'vitest';

import { focusLine, formatDay, todayRow, todaySummary, type TodayPlanInput } from '../src/state/coachToday';

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
  /**
   * THE ROSTER BOARD SHOWED EVERY PLAYER THE SAME DECK.
   *
   * It drew `recommendations[0]`, and `diversify()` makes that the best deck
   * of the strongest archetype — the same deck for everyone, by construction.
   * Six roster rows drew six identical Balloon decks. `closest[0]` is the best
   * answer built from cards THIS player runs, so it differs by construction.
   */
  it('prefers the deck built from cards they actually play', () => {
    const r = todayRow('#A', 'RIZAL', plan({
      closest: [{
        key: 'mine', name: 'Mortar', expectedWinRate: 58.8,
        cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        affinity: { shared: 7, of: 8, deckBattles: 28, familiar: true },
      }],
    }));
    expect(r.pick?.key).toBe('mine');
    expect(r.source).toBe('their-deck');
    expect(r.kind).toBe('tailored');
    expect(r.note).toContain('7 of 8 cards');
    expect(r.note).toContain('28 times');
  });

  it('two players with different repertoires get different decks', () => {
    const a = todayRow('#A', 'A', plan({
      closest: [{ key: 'mortar', name: 'Mortar', expectedWinRate: 58.8,
                  cards: ['a'], affinity: { shared: 7, of: 8, deckBattles: 28, familiar: true } }],
    }));
    const b = todayRow('#B', 'B', plan({
      closest: [{ key: 'balloon', name: 'Balloon', expectedWinRate: 57.3,
                  cards: ['b'], affinity: { shared: 6, of: 8, deckBattles: 41, familiar: true } }],
    }));
    expect(a.pick?.key).not.toBe(b.pick?.key);
  });

  it('falls back to the field when nothing they play is close, and SAYS so', () => {
    const r = todayRow('#A', 'A', plan({ closest: [], tailoredPicks: 0 }));
    expect(r.source).toBe('field');
    expect(r.note).toContain('Nothing they play is close');
  });

  it('never claims a personal pick it does not have', () => {
    const r = todayRow('#A', 'A', plan({ tailoredPicks: 0 }));
    expect(r.pick?.shared).toBeUndefined();
    expect(r.source).toBe('field');
  });

  it('weighted but unchanged is ORDERED, never tailored', () => {
    const r = todayRow('#A', 'NannoS', plan({ tailoredPicks: 0 }));
    expect(r.kind).toBe('ordered');
    expect(r.note).toContain('Nothing they play is close');
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

    // THE SEATING MUST SURVIVE THE TYPE. It did not: `pick` was narrowed to
    // {key, name, expectedWinRate, cards} and the art the server had already
    // computed was dropped one type before the board, so every card on the
    // Today board rendered in its base form -- no evolution, no hero, no
    // champion in slots 0/1/2.
    const seated = todayRow('#A', 'X', plan({
      recommendations: [{
        key: 'g',
        name: 'Graveyard',
        expectedWinRate: 63.7,
        cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        art: { a: 'evolution', b: 'hero' },
        artInferred: false,
      }],
    }));
    expect(seated.pick?.art).toEqual({ a: 'evolution', b: 'hero' });
    expect(seated.pick?.artInferred).toBe(false);
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

/**
 * TODAY'S SESSION DRIVES THE ROW NOW.
 *
 * Reported: "the daily practice for everyone on the roster does not change".
 * Measured: the row's deck (`closest[0]`, a thirty-day answer) was identical
 * five days running for seven of eight real roster players. The session's
 * deck is picked for TODAY'S matchup, so it moves when the focus moves.
 */
describe("today's session", () => {
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const session = (over: Partial<NonNullable<TodayPlanInput['session']>> = {}): TodayPlanInput['session'] => ({
    day: '2026-09-30',
    since: '2026-09-29',
    focus: { name: 'Golem', why: 'rotation', recent: null, rotation: { index: 2, of: 3, next: 'Mortar' } },
    practise: {
      key: 'today', name: 'Mortar', expectedWinRate: 57.1, cards: eight,
      vsFocus: { winRate: 64.8 }, source: 'their-cards', shared: 7, deckBattles: 41,
    },
    ...over,
  });
  const closest = [{ key: 'thirty-day', name: 'Bridge Spam', expectedWinRate: 60.4, cards: eight,
                     affinity: { shared: 8, of: 8, deckBattles: 300, familiar: true } }];

  it("draws the session's deck, not the thirty-day closest", () => {
    const r = todayRow('#A', 'A', plan({ closest, session: session() }));
    expect(r.pick?.key).toBe('today');
    expect(r.pick?.vsFocus).toBe(64.8);
    expect(r.source).toBe('their-deck');
    expect(r.note).toContain('7 of 8 cards');
  });

  it('two days with different foci draw different decks', () => {
    const mon = todayRow('#A', 'A', plan({ closest, session: session() }));
    const tue = todayRow('#A', 'A', plan({
      closest,
      session: session({
        focus: { name: 'Mortar', why: 'rotation', recent: null, rotation: { index: 3, of: 3, next: 'Hog Rider' } },
        practise: { key: 'tuesday', name: 'Graveyard', expectedWinRate: 56.0, cards: eight,
                    vsFocus: { winRate: 62.0 }, source: 'their-cards', shared: 6, deckBattles: 20 },
      }),
    }));
    expect(mon.pick?.key).not.toBe(tue.pick?.key);
    expect(mon.focus?.name).not.toBe(tue.focus?.name);
  });

  it('a rotation is printed as a schedule, never as a finding', () => {
    const f = focusLine(session());
    expect(f?.line).toBe('rotation day 2 of 3 · next Mortar');
    expect(f?.line).not.toMatch(/lost|since/);
  });

  it("yesterday's losses are printed as counts", () => {
    const f = focusLine(session({
      focus: { name: 'Hog Rider', why: 'lost_recently', recent: { battles: 7, wins: 1, losses: 6 },
               excessLosses: 3.2, rotation: null },
    }));
    expect(f?.line).toBe('1–6 since 29 Sep · 3.2 more losses than usual');
  });

  it("the field's rotation says it is the field's", () => {
    const f = focusLine(session({
      focus: { name: 'Hog Rider', why: 'field_rotation', recent: null, rotation: { index: 1, of: 3, next: 'Golem' } },
    }));
    expect(f?.line).toContain('field rotation');
  });

  it("a field deck from the session is labelled the field's", () => {
    const r = todayRow('#A', 'A', plan({ session: session({
      practise: { key: 'f', name: 'Balloon', expectedWinRate: 61, cards: eight,
                  vsFocus: { winRate: 60 }, source: 'field' },
    }) }));
    expect(r.source).toBe('field');
    expect(r.pick?.shared).toBeUndefined();
  });

  it('an older server with no session keeps the old behaviour', () => {
    const r = todayRow('#A', 'A', plan({ closest }));
    expect(r.pick?.key).toBe('thirty-day');
    expect(r.focus).toBeNull();
  });

  it('a failed read carries no focus', () => {
    expect(todayRow('#A', 'A', null).focus).toBeNull();
  });

  it('formats a day without the local clock', () => {
    expect(formatDay('2026-09-30')).toBe('30 Sep');
    expect(formatDay('2026-01-01')).toBe('1 Jan');
    expect(formatDay(null)).toBe('—');
    expect(formatDay('garbage')).toBe('garbage');
  });
});
