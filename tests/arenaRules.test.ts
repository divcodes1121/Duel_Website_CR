import { describe, expect, it } from 'vitest';
import {
  ARENA,
  BEST_KEY,
  ELIXIR_PER_LEVEL,
  aimAt,
  clampToArena,
  dropSpot,
  fireballHits,
  flightTime,
  levelFor,
  logGap,
  logHits,
  readBest,
  spawnGap,
  step,
  storeBest,
  volley,
} from '../src/three/arenaRules';

const NO_KEYS = { up: false, down: false, left: false, right: false };

describe('difficulty', () => {
  it('a level is eight elixir', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(ELIXIR_PER_LEVEL - 1)).toBe(1);
    expect(levelFor(ELIXIR_PER_LEVEL)).toBe(2);
  });
  it('gets harder and then stops getting harder', () => {
    expect(spawnGap(2)).toBeLessThan(spawnGap(1));
    expect(spawnGap(99)).toBe(spawnGap(100));
    expect(flightTime(5)).toBeLessThan(flightTime(1));
    expect(flightTime(99)).toBeGreaterThanOrEqual(0.8);
  });
  it('no Log before level 3, and no volley at level 1', () => {
    expect(logGap(1)).toBe(Infinity);
    expect(logGap(2)).toBe(Infinity);
    expect(Number.isFinite(logGap(3))).toBe(true);
    for (let r = 0; r < 1; r += 0.05) expect(volley(1, r)).toBe(1);
    expect(volley(8, 0.01)).toBe(3);
  });
});

describe('movement', () => {
  it('keys move at speed and diagonals are not faster', () => {
    const [x] = step([0, 3], { ...NO_KEYS, right: true }, null, 0.1);
    expect(x).toBeCloseTo(0.62);
    const [dx, dz] = step([0, 3], { ...NO_KEYS, right: true, up: true }, null, 0.1);
    expect(Math.hypot(dx - 0, dz - 3)).toBeCloseTo(0.62);
  });
  it('a pointer target is reached and never overshot', () => {
    expect(step([0, 3], NO_KEYS, [0.1, 3], 0.1)).toEqual([0.1, 3]);
    const p = step([0, 3], NO_KEYS, [4, 3], 0.1);
    expect(p[0]).toBeCloseTo(0.62);
  });
  it('the player never leaves their half or the arena', () => {
    expect(clampToArena(99, -99)).toEqual([ARENA.maxX, ARENA.minZ]);
    expect(step([0, ARENA.minZ], { ...NO_KEYS, up: true }, null, 1)[1]).toBe(ARENA.minZ);
  });
  it('no input, no movement', () => {
    expect(step([1, 2], NO_KEYS, null, 0.5)).toEqual([1, 2]);
  });
});

describe('collisions', () => {
  it('a fireball catches a player inside its splash, not outside', () => {
    expect(fireballHits(0, 3, 0.5, 3)).toBe(true);
    expect(fireballHits(0, 3, 2.5, 3)).toBe(false);
  });
  it('a Log catches a player in its lane at its position only', () => {
    expect(logHits(0, 3, 3, 0.2)).toBe(true);
    expect(logHits(0, 3, 3, 3)).toBe(false);
    expect(logHits(0, 3, 4.5, 0)).toBe(false);
  });
  it('aims stay on the player half', () => {
    for (const r of [0, 0.5, 0.999]) {
      const [x, z] = aimAt([ARENA.maxX, ARENA.maxZ], [9, 9], 1.4, r, r);
      expect(x).toBeLessThanOrEqual(ARENA.maxX);
      expect(z).toBeLessThanOrEqual(ARENA.maxZ);
      expect(z).toBeGreaterThanOrEqual(ARENA.minZ);
    }
  });
  it('a drop lands away from the player when it can', () => {
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i += 1) {
      const [x, z] = dropSpot([0, 3], rand);
      expect(Math.hypot(x, z - 3)).toBeGreaterThan(1.5);
    }
  });
});

describe('best score', () => {
  it('reads, keeps the higher, and survives broken storage', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readBest(st)).toBe(0);
    expect(storeBest(st, 12)).toBe(12);
    expect(storeBest(st, 5)).toBe(12);
    expect(m.get(BEST_KEY)).toBe('12');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readBest(broken)).toBe(0);
    expect(storeBest(broken, 3)).toBe(3);
    expect(readBest(null)).toBe(0);
  });
});
