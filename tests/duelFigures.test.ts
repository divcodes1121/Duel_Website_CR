import { describe, expect, it } from 'vitest';
import type { TeamDuelFigures } from '../src/state/analyticsClient';
import {
  crlTitle, duelChip, duelDeckLabel, duelPickLabel, duelShort, duelTitle, originTitle, topTitle,
} from '../src/utils/duelFigures';

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

  it('brain 5.0: says whether a list is one the CRL group brought or one of the meta', () => {
    expect(duelDeckLabel({ origin: 'crl' })).toBe('CRL duel list');
    expect(duelDeckLabel({ origin: 'meta' })).toBe('Meta list');
    expect(crlTitle({ crl: { games: 12, wins: 8, pilots: 3 } })).toBe(
      'Brought to 12 duel games by 3 CRL players · 8 won',
    );
    expect(crlTitle({ crl: { games: 1, wins: 0, pilots: 1 } })).toBe(
      'Brought to 1 duel game by 1 CRL player · 0 won',
    );
    expect(crlTitle({})).toBeUndefined();
  });

  it('6.1: names a list the top 1,000 use, and says how many of them', () => {
    expect(duelDeckLabel({ origin: 'top' })).toBe('Top 1k list');
    expect(topTitle({ top: { players: 32, games: 1222, wins: 640 } })).toBe(
      'Used by 32 of the top 1,000 players · 1,222 ranked games · 52% won',
    );
    expect(topTitle({})).toBeUndefined();
    expect(originTitle({ top: { players: 3, games: 40, wins: 20 }, crl: { games: 5, wins: 3, pilots: 2 } })).toBe(
      'Used by 3 of the top 1,000 players · 40 ranked games · 50% won\nBrought to 5 duel games by 2 CRL players · 3 won',
    );
    expect(originTitle({})).toBeUndefined();
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
