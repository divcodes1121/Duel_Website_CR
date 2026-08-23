import { describe, expect, it } from 'vitest';
import type { DuelSeries } from '../src/state/analyticsClient';
import {
  MIN_SERIES,
  adaptation,
  keyInsights,
  lineup,
  opponents,
  performance,
  reveals,
  verdicts,
  withGames,
} from '../src/components/Analytics/duelInsightRules';

/* The invariant under test throughout: a native duel row carries the SERIES
 * result and nothing else — no per-game scoreline, no opponent deck. Every
 * game-level figure must therefore ignore it, and every figure must refuse to
 * report below its evidence floor. Both were measured on real data before this
 * file existed: on a 96-duel player, all 114 native games came back with an
 * empty result and a null opponent. */

let n = 0;

function game(
  slot: number,
  result: 'win' | 'loss' | '' | null,
  deckName: string,
  oppArch?: string,
  cards?: string[],
) {
  return {
    slot,
    cards: cards ?? [`c${slot}a`, `c${slot}b`],
    avgElixir: 3.5,
    result,
    archetype: deckName.toLowerCase(),
    deckName,
    opponent: oppArch
      ? { cards: [`o${slot}a`, `o${slot}b`], archetype: oppArch, deckName: oppArch }
      : null,
  };
}

function series(
  opts: Partial<DuelSeries> & { games: ReturnType<typeof game>[]; won: boolean },
): DuelSeries {
  n += 1;
  return {
    id: `s${n}`,
    startTime: '2026-08-01T00:00:00Z',
    opponentTag: '#OPP',
    opponentName: 'Opp',
    source: 'reconstructed',
    format: 'bo3',
    playerWins: null,
    opponentWins: null,
    caption: '',
    scoreKnown: false,
    ...opts,
  } as DuelSeries;
}

const native = (won: boolean) =>
  series({
    source: 'native',
    won,
    games: [game(0, '', 'A'), game(1, '', 'B'), game(2, '', 'C')],
  });

/** A reconstructed 2-1 win: G1 win, G2 loss, G3 win. */
const comeback = (openerName = 'Hog') =>
  series({
    won: true,
    scoreKnown: true,
    playerWins: 2,
    opponentWins: 1,
    games: [
      game(0, 'win', openerName, 'hog'),
      game(1, 'loss', 'Miner', 'lava'),
      game(2, 'win', 'RG', 'hog'),
    ],
  });

/** A reconstructed 1-2 loss: G1 loss, G2 win, G3 loss. */
const collapse = (openerName = 'Hog') =>
  series({
    won: false,
    scoreKnown: true,
    playerWins: 1,
    opponentWins: 2,
    games: [
      game(0, 'loss', openerName, 'lava'),
      game(1, 'win', 'Miner', 'hog'),
      game(2, 'loss', 'RG', 'lava'),
    ],
  });

describe('native rows are excluded from game-level figures', () => {
  it('withGames keeps only reconstructed series that have decided games', () => {
    const all = [native(true), native(false), comeback()];
    expect(withGames(all)).toHaveLength(1);
  });

  it('series win rate counts native rows, game figures do not', () => {
    // 6 native wins + 1 reconstructed win = 7 of 8 series.
    const all = [...Array(6)].map(() => native(true)).concat([native(false), comeback()]);
    const p = performance(all);
    expect(p.seriesRecord.total).toBe(8);
    expect(p.seriesRecord.wins).toBe(7);
    expect(p.nativeSeries).toBe(7);
    expect(p.detailSeries).toBe(1);
    // Only the one reconstructed series contributes games.
    expect(p.gameRate).toBeNull(); // 3 games < MIN_GAMES
  });

  it('a native row contributes no opponent data', () => {
    const o = opponents([native(true), native(false)]);
    expect(o.known).toBe(0);
    expect(o.archetypes).toEqual([]);
  });
});

describe('evidence floors', () => {
  it('returns null rather than a small-sample percentage', () => {
    const p = performance([comeback(), comeback()]);
    expect(p.seriesRate).toBeNull();
    expect(p.seriesRecord.total).toBe(2); // the record is still shown
  });

  it('reports once the floor is cleared', () => {
    const all = [...Array(MIN_SERIES)].map(() => comeback());
    const p = performance(all);
    expect(p.seriesRate).not.toBeNull();
    expect(p.seriesRate!.pct).toBe(100);
    expect(p.seriesRate!.total).toBe(MIN_SERIES);
  });

  it('a deck played twice is never "best"', () => {
    const l = lineup([comeback('Twice'), comeback('Twice'), comeback('Other')]);
    expect(l.bestOpener).toBeNull();
  });

  it('a deck at the floor can be best', () => {
    const all = [...Array(3)].map(() => comeback('Thrice'));
    const l = lineup(all);
    expect(l.bestOpener?.deckName).toBe('Thrice');
    expect(l.bestOpener?.uses).toBe(3);
  });
});

describe('adaptation', () => {
  it('separates series by the game 1 result', () => {
    const all = [...Array(6)].map(() => comeback()).concat([...Array(5)].map(() => collapse()));
    const a = adaptation(all);
    // 6 series opened with a win, all won.
    expect(a.afterG1Win!.total).toBe(6);
    expect(a.afterG1Win!.pct).toBe(100);
    // 5 opened with a loss, none won.
    expect(a.afterG1Loss!.total).toBe(5);
    expect(a.afterG1Loss!.pct).toBe(0);
  });

  it('game 2 after a lost game 1 is its own figure', () => {
    const all = [...Array(5)].map(() => collapse());
    const a = adaptation(all);
    // collapse() wins game 2 every time.
    expect(a.g2AfterG1Loss!.pct).toBe(100);
    expect(a.g2AfterG1Win).toBeNull();
  });
});

describe('deciders', () => {
  it('a 2-0 played out to 3-0 is not a decider', () => {
    const sweep = series({
      won: true,
      games: [game(0, 'win', 'A'), game(1, 'win', 'B'), game(2, 'win', 'C')],
    });
    const p = performance([...Array(6)].map(() => sweep));
    expect(p.deciderRate).toBeNull();
  });

  it('a genuine 2-1 counts its last game as the decider', () => {
    const p = performance([...Array(5)].map(() => comeback()));
    expect(p.deciderRate!.total).toBe(5);
    expect(p.deciderRate!.pct).toBe(100); // comeback wins its G3
  });
});

describe('lineup', () => {
  it('tracks a deck per position independently', () => {
    const l = lineup([...Array(5)].map(() => comeback()));
    expect(l.perSlot[0][0].deckName).toBe('Hog');
    expect(l.perSlot[1][0].deckName).toBe('Miner');
    expect(l.perSlot[2][0].deckName).toBe('RG');
    // Miner loses every game 2 in comeback().
    expect(l.perSlot[1][0].pct).toBe(0);
  });

  it('finds the most-played full order', () => {
    const l = lineup([...Array(4)].map(() => comeback()));
    expect(l.bestLineup?.order).toEqual(['Hog', 'Miner', 'RG']);
    expect(l.bestLineup?.uses).toBe(4);
  });

  it('measures opener concentration', () => {
    const all = [...Array(8)].map(() => comeback('Same')).concat([comeback('Other')]);
    const l = lineup(all);
    expect(l.topOpenerName).toBe('Same');
    expect(l.topOpenerShare).toBeCloseTo((8 / 9) * 100, 5);
    expect(l.distinctOpeners).toBe(2);
  });
});

describe('opponents', () => {
  it('records per-archetype and ranks only above the floor', () => {
    const all = [...Array(5)].map(() => comeback());
    const o = opponents(all);
    // comeback faces hog twice and lava once per series.
    expect(o.archetypes.find((a) => a.archetype === 'hog')!.games).toBe(10);
    expect(o.archetypes.find((a) => a.archetype === 'lava')!.games).toBe(5);
    expect(o.best!.archetype).toBe('hog'); // won every hog game
    expect(o.worst!.archetype).toBe('lava'); // lost every lava game
  });

  it('reports the usual answer to the opener', () => {
    const o = opponents([...Array(5)].map(() => comeback()));
    expect(o.vsOpener!.archetype).toBe('hog');
    expect(o.vsOpener!.share).toBe(100);
  });
});

describe('reveals', () => {
  it('counts distinct cards across a series', () => {
    const r = reveals([...Array(5)].map(() => comeback()));
    // 3 games x 2 distinct cards each, no overlap between slots.
    expect(r.avgPlayerRevealed).toBe(6);
    expect(r.avgOpponentRevealed).toBe(6);
    expect(r.fullLoadouts).toBe(5);
  });

  it('stays null below the floor', () => {
    expect(reveals([comeback()]).avgPlayerRevealed).toBeNull();
  });
});

describe('verdicts', () => {
  const build = (all: DuelSeries[]) => {
    const p = performance(all);
    const l = lineup(all);
    return verdicts(p, adaptation(all), l, opponents(all));
  };

  it('says nothing about a coin-flip record', () => {
    // 5 wins, 5 losses, and a different opener each time so nothing stands out.
    const all = [
      ...[...Array(5)].map((_, i) => comeback(`W${i}`)),
      ...[...Array(5)].map((_, i) => collapse(`L${i}`)),
    ];
    const v = build(all);
    expect(v.find((x) => x.id === 'closer')).toBeUndefined();
    expect(v.find((x) => x.id === 'closer-weak')).toBeUndefined();
  });

  it('calls a concentrated opener readable', () => {
    const all = [...Array(8)].map(() => comeback('OnlyOne'));
    const v = build(all);
    expect(v.find((x) => x.id === 'predictable')).toBeTruthy();
  });

  it('calls a varied opener hard to prepare for', () => {
    const all = [...Array(10)].map((_, i) => comeback(`Deck${i}`));
    const v = build(all);
    expect(v.find((x) => x.id === 'varied')).toBeTruthy();
    expect(v.find((x) => x.id === 'predictable')).toBeUndefined();
  });

  it('emits nothing at all when there is no data', () => {
    expect(build([])).toEqual([]);
    expect(keyInsights([])).toEqual([]);
  });

  it('key insights prefer a mix of tones', () => {
    const all = [
      ...[...Array(9)].map(() => comeback('OnlyOne')), // strong record + readable opener
    ];
    const k = keyInsights(build(all));
    expect(k.length).toBeGreaterThan(1);
    expect(new Set(k.map((x) => x.tone)).size).toBeGreaterThan(1);
  });
});
