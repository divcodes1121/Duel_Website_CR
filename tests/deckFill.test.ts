import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/state/accountStore', () => ({
  useAccountStore: { getState: () => ({ userId: null, ready: true }), subscribe: () => () => {} },
}));
vi.mock('../src/state/syncClient', () => ({
  pushRemoteDecks: async () => true,
  readRemoteDecks: async () => ({ status: 'missing' }),
}));

import { CARDS, CARDS_BY_KEY } from '../src/data/cards';
import { FILL_ELIXIR, cardMix, elixirCurve, fillDeck } from '../src/state/deckFill';
import { canPlaceCardInSlot } from '../src/state/deckUtils';
import { useBuilderStore } from '../src/state/store';

const card = (k: string) => CARDS_BY_KEY.get(k)!;
const initial = useBuilderStore.getState();
const S = () => useBuilderStore.getState();
beforeEach(() => useBuilderStore.setState(initial, true));

/** A seeded generator, so a failure reproduces. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('curve and mix', () => {
  it('buckets 1..6 and 7+', () => {
    const cards = ['skeletons', 'the-log', 'knight', 'hog-rider', 'balloon', 'golem'].map(card);
    expect(elixirCurve(cards)).toEqual([1, 1, 1, 1, 1, 0, 1]);
  });

  it('counts from the catalogue flags', () => {
    const mix = cardMix(['hog-rider', 'fireball', 'the-log', 'cannon', 'musketeer'].map(card));
    expect(mix).toEqual({ winConditions: 1, spells: 2, buildings: 1, troops: 2 });
  });
});

describe('fillDeck', () => {
  const set = () => structuredClone(S().sets.solo);

  it('fills every empty slot and keeps the cards already placed', () => {
    const s = set();
    s.decks[0].slots[3] = 'hog-rider';
    s.decks[0].slots[4] = 'fireball';
    const out = fillDeck(s, 0, CARDS, CARDS_BY_KEY, 'collection', seeded(1))!;
    expect(out.every((k) => k !== null)).toBe(true);
    expect(out[3]).toBe('hog-rider');
    expect(out[4]).toBe('fireball');
  });

  it('builds real decks: special slots used, a win condition, a spell, a sane average', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const out = fillDeck(set(), 0, CARDS, CARDS_BY_KEY, 'collection', seeded(seed))!;
      const cards = out.map((k) => card(k!));
      expect(new Set(out).size, `seed ${seed}`).toBe(8);
      expect(cards[0].canEvolve, `seed ${seed} evo`).toBe(true);
      expect(cards[1].canBeHero || cards[1].isChampion, `seed ${seed} hero`).toBe(true);
      expect(cards.some((c) => c.isWinCondition), `seed ${seed} wc`).toBe(true);
      expect(cards.some((c) => c.type === 'Spell'), `seed ${seed} spell`).toBe(true);
      const avg = cards.reduce((a, c) => a + c.elixir, 0) / 8;
      expect(avg).toBeGreaterThanOrEqual(FILL_ELIXIR.min);
      expect(avg).toBeLessThanOrEqual(FILL_ELIXIR.max);
      cards.forEach((c, i) => expect(canPlaceCardInSlot(c, i), `${c.key} in ${i}`).toBe(true));
    }
  });

  it('never reuses a card another duel deck holds', () => {
    const s = set();
    s.decks[1].slots = ['knight', 'musketeer', 'wizard', 'hog-rider', 'fireball', 'the-log', 'cannon', 'ice-spirit'];
    for (let seed = 1; seed <= 20; seed++) {
      const out = fillDeck(s, 0, CARDS, CARDS_BY_KEY, 'collection', seeded(seed))!;
      expect(out.some((k) => s.decks[1].slots.includes(k))).toBe(false);
    }
  });

  it('returns a full deck unchanged', () => {
    const s = set();
    s.decks[0].slots = ['knight', 'musketeer', 'wizard', 'hog-rider', 'fireball', 'the-log', 'cannon', 'ice-spirit'];
    expect(fillDeck(s, 0, CARDS, CARDS_BY_KEY, 'collection')).toEqual(s.decks[0].slots);
  });
});

describe('fillDeck in the store', () => {
  it('fills, names the step, and undoes', () => {
    const added = S().fillDeck('solo', 0);
    expect(added).toBe(8);
    expect(S().sets.solo.decks[0].slots.every(Boolean)).toBe(true);
    expect(S().undo('duels')).toMatch(/^Surprise me on /);
    expect(S().sets.solo.decks[0].slots.every((k) => k === null)).toBe(true);
  });

  it('says "Fill" when some cards were already there', () => {
    S().assignCardAt('home', 0, 3, 'golem');
    expect(S().fillDeck('home', 0)).toBe(7);
    expect(S().undo('home')).toMatch(/^Fill /);
    expect(S().sets.home.decks[0].slots.filter(Boolean)).toEqual(['golem']);
  });
});
