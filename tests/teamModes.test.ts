import { describe, expect, it } from 'vitest';
import { gamesLabel, modeSplit } from '../src/utils/teamModes';

describe('modeSplit', () => {
  it('lists kinds in a fixed order and leaves out empty ones', () => {
    expect(modeSplit({ friendly: 12, ranked: 58, duel: 3, ladder: 9 })).toBe(
      '58 ranked · 9 ladder · 12 friendly · 3 duel',
    );
    expect(modeSplit({ ranked: 0, friendly: 4 })).toBe('4 friendly');
  });

  it('says nothing for a deck from an older server', () => {
    expect(modeSplit(undefined)).toBe('');
    expect(modeSplit({})).toBe('');
  });
});

describe('gamesLabel', () => {
  it('rounds a percentage of games', () => {
    expect(gamesLabel(76.6)).toBe('77% of games');
    expect(gamesLabel(0.3)).toBe('<1% of games');
    expect(gamesLabel(0)).toBe('0% of games');
    expect(gamesLabel(undefined)).toBe('');
  });
});
