import { CARDS_BY_KEY } from '../data/cards';
import { DECK_SIZE, type Deck } from '../types/deck';

/**
 * Official Clash Royale "copy deck" deep link. Opening it in a browser hands
 * the deck straight to the game via the clashroyale:// protocol.
 * Format: ...copyDeck?deck=<8 official card ids, ;-separated>&l=Royals&tt=159000000
 *
 * Returns null while the deck has empty slots or an unknown card.
 */
export function getClashRoyaleDeckLink(deck: Deck): string | null {
  const keys = deck.slots.filter((k): k is string => k !== null);
  if (keys.length !== DECK_SIZE) return null;

  const ids: number[] = [];
  for (const key of keys) {
    const id = CARDS_BY_KEY.get(key)?.id;
    if (!id) return null;
    ids.push(id);
  }

  return `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${ids.join(';')}&l=Royals&tt=159000000`;
}
