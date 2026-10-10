import { describe, expect, it } from 'vitest';
import type { TeamDuelFigures } from '../src/state/analyticsClient';
import { duelChip, duelDeckLabel, duelPickLabel, duelShort, duelTitle } from '../src/utils/duelFigures';

/**
 * How the duel brain's figures print, on the screen and in the PDF. One helper
 * for both, so the two cannot disagree about the same row — and a figure, never
 * a sentence, on a screen the account holder asked to carry no prose.
 */

const FIG: TeamDuelFigures = {
  winRate: 58.44, raw: 63.1, low: 55.02, high: 61.9, nEff: 312.4, games: 1540,
  covered: 0.91, exact: 0.8, strength: 0.79, strong: true, brain: 'duel-brain-1.0',
};

describe('duelFigures', () => {
  it('labels only the rows the duel brain chose', () => {
    expect(duelPickLabel({ duelPick: 'own' })).toBe('Duel pick');
    expect(duelPickLabel({ duelPick: 'duel' })).toBe('Duel pick');
    // Team Analysis and the Deck Counter name where the list comes from.
    expect(duelDeckLabel({ origin: 'duel' })).toBe('Duel deck');
    expect(duelDeckLabel({ duelPick: 'own' })).toBe('Duel deck');
    expect(duelDeckLabel({ origin: 'ladder' })).toBeNull();
    expect(duelDeckLabel({})).toBeNull();
    expect(duelPickLabel({})).toBeNull();
  });

  it('prints the rate to one decimal and the games behind it', () => {
    expect(duelChip(FIG)).toBe('Duel 58.4% · 1,540');
    expect(duelShort(FIG)).toBe('Duel 58%');
  });

  it('prints NOTHING for a row the server withheld, never a 50%', () => {
    expect(duelChip(null)).toBeNull();
    expect(duelChip(undefined)).toBeNull();
    expect(duelShort(null)).toBeNull();
    expect(duelTitle(null)).toBeUndefined();
  });

  it('puts the bound and the record as played in the hover line', () => {
    const t = duelTitle(FIG)!;
    expect(t).toContain('55.0–61.9');
    expect(t).toContain('as played 63.1%');
  });

  it('is figures, not sentences', () => {
    for (const s of [duelChip(FIG)!, duelShort(FIG)!, duelTitle(FIG)!, duelPickLabel({ duelPick: 'duel' })!]) {
      expect(s).not.toMatch(/\.\s+[A-Z]/); // no second sentence
      expect(s.split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });
});
