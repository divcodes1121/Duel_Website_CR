import { describe, expect, it } from 'vitest';
import {
  branchesOf,
  isOver,
  momentum,
  nodeAt,
  outcomeRows,
  pctLabel,
  playedAlong,
  roll,
  scoreOf,
  seeded,
  winnerOf,
  type DuelNode,
} from '../src/utils/coachDuel';

/* The five games a best-of-3 can reach, as the server sends them
   (`server/coach_duel.py`), with figures that make the arithmetic visible. */
const TREE: DuelNode[] = [
  { path: '', game: 1, chance: 60, matchup: 60, reach: 100 },
  { path: 'w', game: 2, chance: 65, matchup: 57, reach: 60 },
  { path: 'l', game: 2, chance: 42, matchup: 50, reach: 40 },
  { path: 'wl', game: 3, chance: 51, matchup: 50, reach: 21 },
  { path: 'lw', game: 3, chance: 49, matchup: 50, reach: 16.8 },
];

describe('score and end of a duel', () => {
  it('counts each side', () => {
    expect(scoreOf('')).toEqual([0, 0]);
    expect(scoreOf('wl')).toEqual([1, 1]);
    expect(scoreOf('lww')).toEqual([2, 1]);
  });
  it('a best of 3 ends at two wins, not before', () => {
    expect(isOver('w')).toBe(false);
    expect(isOver('wl')).toBe(false);
    expect(isOver('ww')).toBe(true);
    expect(isOver('lwl')).toBe(true);
  });
  it('a best of 5 needs three', () => {
    expect(isOver('ww', 5)).toBe(false);
    expect(isOver('www', 5)).toBe(true);
  });
  it('names the winner only once it is over', () => {
    expect(winnerOf('w')).toBeNull();
    expect(winnerOf('wlw')).toBe('a');
    expect(winnerOf('ll')).toBe('b');
  });
});

describe('walking the tree', () => {
  it('finds the next game along a path', () => {
    expect(nodeAt(TREE, '')?.game).toBe(1);
    expect(nodeAt(TREE, 'l')?.chance).toBe(42);
    expect(nodeAt(TREE, 'wl')?.game).toBe(3);
  });
  it('has no next game once the duel is over, even if a node had that path', () => {
    expect(nodeAt([...TREE, { path: 'ww', game: 3, chance: 50, matchup: 50, reach: 0 }], 'ww')).toBeNull();
  });
  it('a path the server did not send is no game, not a crash', () => {
    expect(nodeAt(TREE, 'x')).toBeNull();
  });
  it('lists the games played along a path with their results, in order', () => {
    const p = playedAlong(TREE, 'wl');
    expect(p.map((g) => [g.node.game, g.result])).toEqual([[1, 'w'], [2, 'l']]);
    expect(p[1].node.path).toBe('w');
  });
  it('gives both roads out of a game', () => {
    const b = branchesOf(TREE, 'w');
    expect(b.won).toBeNull(); // 2-0 ends it
    expect(b.lost?.path).toBe('wl');
    expect(branchesOf(TREE, '').won?.path).toBe('w');
  });
});

describe('a game is decided by its chance', () => {
  it('a draw inside the chance is a win for the first player', () => {
    expect(roll(60, 0.59)).toBe('w');
    expect(roll(60, 0.6)).toBe('l');
    expect(roll(0, 0)).toBe('l');
    expect(roll(100, 0.999)).toBe('w');
  });
  it('over many draws it wins about as often as the chance says', () => {
    const r = seeded(7);
    let w = 0;
    for (let i = 0; i < 20000; i += 1) if (roll(60, r()) === 'w') w += 1;
    expect(w / 20000).toBeGreaterThan(0.585);
    expect(w / 20000).toBeLessThan(0.615);
  });
  it('the seeded draw replays exactly', () => {
    const a = seeded(42);
    const b = seeded(42);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('figures', () => {
  it('momentum is the shift from the game before, in points', () => {
    expect(momentum(TREE[0])).toBe(0);
    expect(momentum(TREE[1])).toBe(8);
    expect(momentum(TREE[2])).toBe(-8);
  });
  it('percent labels drop a needless decimal', () => {
    expect(pctLabel(61.2)).toBe('61.2%');
    expect(pctLabel(60)).toBe('60%');
    expect(pctLabel(59.96)).toBe('60%');
    expect(pctLabel(null)).toBe('—');
    expect(pctLabel(Number.NaN)).toBe('—');
  });
  it('final scores come out first player first, missing ones as 0', () => {
    const rows = outcomeRows({ '2-0': 30, '0-2': 20, '2-1': 25 });
    expect(rows.map((r) => r.score)).toEqual(['2-0', '2-1', '1-2', '0-2']);
    expect(rows.map((r) => r.chance)).toEqual([30, 25, 0, 20]);
    expect(rows.map((r) => r.winner)).toEqual(['a', 'a', 'b', 'b']);
  });
});

describe('the rules module stands alone', () => {
  it('imports nothing', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/utils/coachDuel.ts', 'utf8');
    expect(/^import /m.test(src)).toBe(false);
  });
});
