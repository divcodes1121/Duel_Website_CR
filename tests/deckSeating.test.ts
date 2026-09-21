import { describe, expect, it } from 'vitest';

import { CARDS_BY_KEY } from '../src/data/cards';
import { drawnDeck, positionalArt, seatDeck } from '../src/utils/deckSeating';
import fixture from './fixtures/seating.json';

/*
 * `seatDeck` is a second copy of `server/clash_data.arrange_deck`'s
 * no-evidence branch, which is exactly the arrangement this project warns
 * about: two implementations of one rule eventually disagree. So it is pinned
 * against the SERVER'S OWN OUTPUT — `fixtures/seating.json` was produced by
 * running `arrange_deck(cards, {})` over every deck in live 2v2, Team Analysis
 * and scouting payloads, plus constructed champion cases. Change the rule on
 * one side and this fails until the other matches.
 */

type Case = { input: string[]; cards: string[]; art: Record<string, 'evolution' | 'hero'> };
const CASES = (fixture as { cases: Case[] }).cases;

const isChampion = (k: string) => !!CARDS_BY_KEY.get(k)?.isChampion;
const canEvolve = (k: string) => !!CARDS_BY_KEY.get(k)?.canEvolve;

describe('seatDeck matches the server', () => {
  it('has real decks to compare, champions among them', () => {
    expect(CASES.length).toBeGreaterThan(50);
    expect(CASES.filter((c) => c.input.some(isChampion)).length).toBeGreaterThan(10);
  });

  it.each(CASES.map((c) => [c.input.join(','), c] as const))('%s', (_label, c) => {
    const out = seatDeck(c.input);
    expect(out.cards).toEqual(c.cards);
    expect(out.art).toEqual(c.art);
  });
});

describe('the slot rule holds for every seated deck', () => {
  for (const c of CASES) {
    const { cards, art } = seatDeck(c.input);
    it(`${c.input.slice(0, 3).join(',')}…`, () => {
      // Slot 1 is the evolution whenever the deck owns an evolution-capable card.
      if (cards.some(canEvolve)) expect(art[cards[0]]).toBe('evolution');
      // Slot 2 never draws an evolution.
      expect(art[cards[1]]).not.toBe('evolution');
      // Nothing past slot 3 draws special art.
      for (const k of Object.keys(art)) expect(cards.indexOf(k)).toBeLessThan(3);
      // A champion sits in slot 2 or 3 (measured: never lower).
      for (const k of cards.filter(isChampion).slice(0, 2)) expect([1, 2]).toContain(cards.indexOf(k));
      // Seating a seated deck changes nothing.
      expect(seatDeck(cards)).toEqual({ cards, art });
    });
  }
});

describe('positionalArt reads the forms off a trusted order', () => {
  it('evolution / hero / wild', () => {
    expect(positionalArt(['skeletons', 'bowler', 'mortar', 'hog-rider'])).toEqual({
      skeletons: 'evolution',
      bowler: 'hero',
      mortar: 'evolution',
    });
  });

  it('a both-form card in the wild slot defaults to its evolution, as the builder does', () => {
    expect(positionalArt(['skeletons', 'bowler', 'knight'])).toMatchObject({ knight: 'evolution' });
  });

  it('a champion draws as itself and a plain card in slot 1 draws plain', () => {
    expect(positionalArt(['hog-rider', 'archer-queen', 'fireball'])).toEqual({});
  });

  it('nothing past slot 3 is ever marked', () => {
    expect(positionalArt(['hog-rider', 'fireball', 'the-log', 'skeletons', 'bowler'])).toEqual({});
  });
});

describe('drawnDeck keeps the server’s seating and only fills the gap', () => {
  it('server art is used exactly as sent', () => {
    const cards = ['mortar', 'bowler', 'skeletons', 'hog-rider', 'fireball', 'the-log', 'rocket', 'arrows'];
    const art = { mortar: 'evolution', bowler: 'hero' } as const;
    expect(drawnDeck(cards, { ...art }, false)).toEqual({ cards, art, inferred: false });
  });

  it('a bare alphabetical deck (a board saved before seating) is seated and flagged', () => {
    const bare = [...CASES[0].input];
    const out = drawnDeck(bare, {});
    expect(out.cards).toEqual(CASES[0].cards);
    expect(out.inferred).toBe(Object.keys(CASES[0].art).length > 0);
  });
});
