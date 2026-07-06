import { describe, expect, it } from 'vitest';
import { getClashRoyaleDeckLink } from '../src/utils/deckLink';
import { CARDS, CARDS_BY_KEY } from '../src/data/cards';
import { createEmptyDeck } from '../src/state/deckUtils';
import type { Deck } from '../src/types/deck';

function deckWith(keys: string[]): Deck {
  const deck = createEmptyDeck('Test');
  keys.forEach((k, i) => {
    deck.slots[i] = k;
  });
  return deck;
}

describe('getClashRoyaleDeckLink', () => {
  it('returns null for an empty deck', () => {
    expect(getClashRoyaleDeckLink(createEmptyDeck('Empty'))).toBeNull();
  });

  it('returns null for a partially filled deck', () => {
    const deck = deckWith(CARDS.slice(0, 5).map((c) => c.key));
    expect(getClashRoyaleDeckLink(deck)).toBeNull();
  });

  it('returns null when a slot holds an unknown card key', () => {
    const keys = CARDS.slice(0, 8).map((c) => c.key);
    keys[3] = 'not-a-real-card';
    expect(getClashRoyaleDeckLink(deckWith(keys))).toBeNull();
  });

  it('builds the official copyDeck link for a full deck', () => {
    const cards = CARDS.slice(0, 8);
    const link = getClashRoyaleDeckLink(deckWith(cards.map((c) => c.key)));
    const expectedIds = cards.map((c) => c.id).join(';');
    expect(link).toBe(
      `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${expectedIds}&l=Royals&tt=159000000`,
    );
  });

  it('preserves slot order in the link', () => {
    const keys = ['knight', 'archers', 'goblins', 'giant', 'fireball', 'musketeer', 'mini-pekka', 'zap'];
    const available = keys.filter((k) => CARDS_BY_KEY.has(k));
    expect(available).toHaveLength(8);
    const link = getClashRoyaleDeckLink(deckWith(keys));
    const ids = keys.map((k) => CARDS_BY_KEY.get(k)!.id);
    expect(link).toContain(`deck=${ids.join(';')}`);
  });
});
