import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { badgeOf, byDeck, leftTheBoard, movementNote, type Movement, type MovementRow } from '../src/utils/metaMovement';

const row = (p: Partial<MovementRow>): MovementRow => ({
  deckHash: 'h', name: 'Deck', rank: 5, previousRank: 7, rankDelta: 2, entered: false, left: false, ...p,
});
const measured = (rows: MovementRow[]): Movement => ({
  basis: 'measured', reason: null, snapshots: 9, latest: '2026-09-30', comparedWith: '2026-09-23', daysApart: 7, requestedDays: 7, rows,
});
const none: Movement = {
  basis: 'none', reason: 'only 6 day(s) stored', snapshots: 6, latest: '2026-09-28', comparedWith: null, daysApart: null, requestedDays: 7, rows: [],
};

describe('badgeOf', () => {
  it('climbs and falls by places, naming the old rank', () => {
    expect(badgeOf(row({ rankDelta: 3, previousRank: 8 }), measured([]))).toMatchObject({ kind: 'up', text: '▲3' });
    const down = badgeOf(row({ rankDelta: -2, previousRank: 3 }), measured([]));
    expect(down).toMatchObject({ kind: 'down', text: '▼2' });
    expect(down!.title).toContain('was #3');
  });

  it('calls an entrant NEW, never a climb from the edge of the board', () => {
    expect(badgeOf(row({ entered: true, rankDelta: null, previousRank: null }), measured([]))).toMatchObject({ kind: 'new', text: 'NEW' });
  });

  it('draws nothing for no movement, and nothing without a baseline', () => {
    expect(badgeOf(row({ rankDelta: 0 }), measured([]))).toBeNull();
    expect(badgeOf(row({}), none)).toBeNull();
    expect(badgeOf(undefined, measured([]))).toBeNull();
  });
});

describe('the rest of the board', () => {
  it('lists departures best-placed first, never as a fall to zero', () => {
    const m = measured([
      row({ deckHash: 'a', left: true, rank: null, previousRank: 30 }),
      row({ deckHash: 'b', left: true, rank: null, previousRank: 9 }),
      row({ deckHash: 'c' }),
    ]);
    expect(leftTheBoard(m).map((r) => r.deckHash)).toEqual(['b', 'a']);
    expect([...byDeck(m).keys()]).toEqual(['c']);
  });

  it('says why there are no badges yet, with the count so far', () => {
    expect(movementNote(none)).toMatch(/6 of 7 days/);
    expect(movementNote(measured([]))).toBe('Movement: 2026-09-23 to 2026-09-30 (7 days).');
    expect(movementNote(null)).toBeNull();
  });

  it('the board reads the movement route rather than inventing one', () => {
    const src = readFileSync('src/components/Analytics/MetaDecks.tsx', 'utf8');
    expect(src).toContain('fetchMetaMovement(7)');
    expect(src).toContain('badgeOf(');
  });
});
