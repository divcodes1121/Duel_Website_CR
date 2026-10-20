import { describe, expect, it } from 'vitest';
import {
  addSeen,
  checkLoadout,
  findDeckLinks,
  isOver,
  keyOf,
  overlap,
  pctLabel,
  roll,
  scoreOf,
  seeded,
  shifted,
  walk,
  winnerOf,
} from '../src/utils/coachDuel';

const deck = (t: string) => Array.from({ length: 8 }, (_, i) => `${t}${i}`);
const SHIFT = { '2': 0.3288, '3': 0.0406 };

describe('score and end of a duel', () => {
  it('counts each side, from yours', () => {
    expect(scoreOf('')).toEqual([0, 0]);
    expect(scoreOf('wl')).toEqual([1, 1]);
    expect(scoreOf('lww')).toEqual([2, 1]);
  });
  it('ends at two wins, not before', () => {
    expect(isOver('w')).toBe(false);
    expect(isOver('wl')).toBe(false);
    expect(isOver('ww')).toBe(true);
    expect(isOver('lwl')).toBe(true);
  });
  it('names the winner only once it is over', () => {
    expect(winnerOf('w')).toBeNull();
    expect(winnerOf('wlw')).toBe('you');
    expect(winnerOf('ll')).toBe('ai');
  });
});

describe('the keys match the server', () => {
  it('path, then your deck indices', () => {
    expect(keyOf('', [])).toBe(':');
    expect(keyOf('w', [2])).toBe('w:2');
    expect(keyOf('wl', [0, 3])).toBe('wl:0,3');
  });
});

describe('a game is decided by its chance', () => {
  it('a draw inside the chance is your win', () => {
    expect(roll(60, 0.59)).toBe('w');
    expect(roll(60, 0.6)).toBe('l');
  });
  it('wins about as often as the chance says', () => {
    const r = seeded(7);
    let w = 0;
    for (let i = 0; i < 20000; i += 1) if (roll(60, r()) === 'w') w += 1;
    expect(w / 20000).toBeGreaterThan(0.585);
    expect(w / 20000).toBeLessThan(0.615);
  });
  it('momentum: game 1 never moves; after a win game 2 is higher, after a loss lower', () => {
    expect(shifted(50, null, 1, SHIFT)).toBe(50);
    // logit(.5) + .3288 -> 58.15%
    expect(shifted(50, 'w', 2, SHIFT)).toBeCloseTo(58.15, 1);
    expect(shifted(50, 'l', 2, SHIFT)).toBeCloseTo(41.85, 1);
    expect(shifted(50, 'w', 3, SHIFT)).toBeCloseTo(51.01, 1);
    expect(shifted(70, 'w', 4, SHIFT)).toBe(70);
  });
});

describe('the duel as played', () => {
  /* The AI brings deck 0 first, then deck 1 if you won, deck 2 if you lost;
     at 1-1 the deck it has not played. */
  const policy: Record<string, number> = {
    ':': 0, 'w:0': 1, 'w:1': 1, 'w:2': 1, 'l:0': 2, 'l:1': 2, 'l:2': 2,
    'wl:0,1': 2, 'wl:1,0': 2, 'wl:0,2': 2, 'lw:0,1': 1, 'lw:1,0': 1, 'lw:2,1': 1,
  };
  const ai = (k: string) => (k in policy ? policy[k] : null);
  const pair = (y: number, a: number) => 40 + 10 * y + a;

  it('reads the AI deck for the state you were in when you picked', () => {
    // game 1: you 0 vs AI 0 at 40% -> draw 10 wins; game 2: you 1 vs AI 1
    const w = walk([0, 1], [10, 99], ai, pair, SHIFT);
    expect(w.games.map((g) => [g.you, g.ai, g.result])).toEqual([[0, 0, 'w'], [1, 1, 'l']]);
    expect(w.path).toBe('wl');
    expect(w.key).toBe('wl:0,1');
  });
  it('game 2 carries the momentum of game 1', () => {
    const w = walk([0, 1], [10, 99], ai, pair, SHIFT);
    expect(w.games[1].matchup).toBe(51);
    expect(w.games[1].chance).toBeGreaterThan(51);
  });
  it('stops once the duel is decided', () => {
    const w = walk([0, 1, 2], [1, 1, 1], ai, pair, SHIFT);
    expect(w.games).toHaveLength(2);
    expect(w.path).toBe('ww');
  });
  it('a pick without a draw yet is the decision in progress', () => {
    const w = walk([2], [], ai, pair, SHIFT);
    expect(w.games).toHaveLength(0);
    expect(w.key).toBe(':');
  });
});

describe('your loadout', () => {
  it('three or four decks that share no card are ready', () => {
    expect(checkLoadout([deck('a'), deck('b'), deck('c')]).ok).toBe(true);
    expect(checkLoadout([deck('a'), deck('b'), deck('c'), deck('d')]).ok).toBe(true);
    expect(checkLoadout([deck('a'), deck('b'), null]).ok).toBe(false);
  });
  it('a card in two decks names both decks and the card', () => {
    const c = checkLoadout([deck('a'), [...deck('b').slice(0, 7), 'a3'], deck('c')]);
    expect(c.ok).toBe(false);
    expect(c.clashes).toEqual([0, 1]);
    expect(c.shared).toEqual(['a3']);
  });
  it('finds every deck link in one paste', () => {
    const text =
      'https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=26000000;26000001;26000002;26000003;26000004;26000005;26000006;26000007&l=Royals\n' +
      'and clashroyale://copyDeck?deck=1%3B2%3B3%3B4%3B5%3B6%3B7%3B8';
    expect(findDeckLinks(text)).toEqual([
      'deck=26000000;26000001;26000002;26000003;26000004;26000005;26000006;26000007',
      'deck=1;2;3;4;5;6;7;8',
    ]);
  });
  it('overlap counts shared cards', () => {
    expect(overlap(deck('a'), [...deck('a').slice(0, 6), 'x', 'y'])).toBe(6);
  });
});

describe('what a rematch tells the AI', () => {
  it('newest first, each deck once whatever the card order, capped', () => {
    const seen = addSeen([deck('a')], [deck('b'), [...deck('a')].reverse()]);
    expect(seen.map((d) => d[0])).toEqual(['a7', 'b0']);
    const many = addSeen([], 'abcdefghij'.split('').map(deck));
    expect(many).toHaveLength(8);
    expect(many[0][0]).toBe('j0');
  });
});

describe('figures', () => {
  it('percent labels drop a needless decimal', () => {
    expect(pctLabel(61.2)).toBe('61.2%');
    expect(pctLabel(59.96)).toBe('60%');
    expect(pctLabel(null)).toBe('—');
  });
});

describe('the rules module stands alone', () => {
  it('imports nothing', async () => {
    const fs = await import('node:fs');
    expect(/^import /m.test(fs.readFileSync('src/utils/coachDuel.ts', 'utf8'))).toBe(false);
  });
});
