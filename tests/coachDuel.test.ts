import { describe, expect, it } from 'vitest';
import {
  addFaced,
  addSeen,
  decide,
  deckKey,
  MU_DECIDES,
  nextFresh,
  clashWith,
  findDeckLinks,
  isDecided,
  isFinished,
  nextLegal,
  overlap,
  pctLabel,
  roll,
  scoreOf,
  seeded,
  winnerOf,
  winsNeeded,
} from '../src/utils/coachDuel';

const deck = (t: string) => Array.from({ length: 8 }, (_, i) => `${t}${i}`);

describe('score and the end of a duel', () => {
  it('counts each side, from yours', () => {
    expect(scoreOf('')).toEqual([0, 0]);
    expect(scoreOf('lww')).toEqual([2, 1]);
  });
  it('two wins take a best of 3, three a best of 5', () => {
    expect(winsNeeded(3)).toBe(2);
    expect(winsNeeded(5)).toBe(3);
    expect(isDecided('ww', 3)).toBe(true);
    expect(isDecided('ww', 5)).toBe(false);
    expect(isDecided('wlwlw', 5)).toBe(true);
  });
  it('stopping on a win ends at the decision; playing all ends at the last game', () => {
    expect(isFinished('ww', 3, false)).toBe(true);
    expect(isFinished('ww', 3, true)).toBe(false);
    expect(isFinished('wwl', 3, true)).toBe(true);
    expect(isFinished('www', 5, true)).toBe(false);
    expect(isFinished('wwwll', 5, true)).toBe(true);
  });
  it('the winner is who won more, once it is finished', () => {
    expect(winnerOf('w', 3)).toBeNull();
    expect(winnerOf('wlw', 3)).toBe('you');
    expect(winnerOf('ll', 3)).toBe('ai');
    expect(winnerOf('ll', 3, true)).toBeNull();
    expect(winnerOf('llw', 3, true)).toBe('ai');
    expect(winnerOf('wwlll', 5, true)).toBe('ai');
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
});

describe('one deck a game, no card twice', () => {
  it('names the cards already played', () => {
    expect(clashWith(deck('a'), [deck('b')])).toEqual([]);
    expect(clashWith([...deck('a').slice(0, 7), 'b3'], [deck('b'), deck('c')])).toEqual(['b3']);
  });
  it('a Coach Assist deck: the first one still legal, then the next on each press', () => {
    const sug = [deck('a'), deck('b'), deck('c')];
    expect(nextLegal(sug, [])).toBe(0);
    expect(nextLegal(sug, [], deck('a'))).toBe(1);
    expect(nextLegal(sug, [], deck('c'))).toBe(0);
    // deck a's cards are spent: skip it
    expect(nextLegal(sug, [[...deck('z').slice(0, 7), 'a2']])).toBe(1);
    expect(nextLegal(sug, [deck('a'), deck('b'), deck('c')])).toBeNull();
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

describe('the decks offered and faced across a session', () => {
  it('offers every legal deck once before any comes back', () => {
    const decks = [deck('a'), deck('b'), deck('c')];
    const offered = new Set<string>();
    const order: number[] = [];
    let cur: string[] | null = null;
    for (let k = 0; k < 3; k += 1) {
      const n = nextFresh(decks, [], offered, cur)!;
      expect(n.fresh).toBe(true);
      order.push(n.index);
      offered.add(deckKey(decks[n.index]));
      cur = decks[n.index];
    }
    expect(new Set(order).size).toBe(3);
    const again = nextFresh(decks, [], offered, cur)!;
    expect(again.fresh).toBe(false);
    expect(again.index).not.toBe(order[2]);
  });
  it('a rematch starts on a deck not offered before', () => {
    const decks = [deck('a'), deck('b'), deck('c'), deck('d')];
    const offered = new Set([deckKey(deck('a')), deckKey(deck('b'))]);
    expect(nextFresh(decks, [], offered, null)).toEqual({ index: 2, fresh: true });
  });
  it('never offers a deck clashing with a card already played', () => {
    const decks = [deck('a'), deck('b')];
    expect(nextFresh(decks, [deck('a')], new Set(), null)).toEqual({ index: 1, fresh: true });
    expect(nextFresh([deck('a')], [deck('a')], new Set(), null)).toBeNull();
  });
  it('remembers the AI decks faced, newest first, each once', () => {
    const f = addFaced(addFaced([], [deck('a'), deck('b')]), [deck('b'), deck('c')]);
    expect(f.map((d) => d[0])).toEqual(['b0', 'c0', 'a0']);
  });
});

describe('a game won on the matchup', () => {
  it('over 55% wins outright, under 45% loses, close is rolled', () => {
    expect(MU_DECIDES).toBe(55);
    expect(decide('mu', 55.1, 40, 0.99)).toEqual({ result: 'w', rolled: false });
    expect(decide('mu', 44.9, 60, 0.01)).toEqual({ result: 'l', rolled: false });
    expect(decide('mu', 55, 55, 0.2)).toEqual({ result: 'w', rolled: true });
    expect(decide('mu', 52, 52, 0.9)).toEqual({ result: 'l', rolled: true });
    expect(decide('roll', 70, 70, 0.95)).toEqual({ result: 'l', rolled: true });
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
