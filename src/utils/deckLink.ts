import { CARDS, CARDS_BY_KEY } from '../data/cards';
import { DECK_SIZE, type Deck } from '../types/deck';

const CARDS_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

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

/**
 * Reads a Clash Royale copy-deck link (any variant: full https URL,
 * clashroyale:// URI, or URL-encoded) and returns the 8 card keys in link
 * order. Returns null when the text isn't a valid deck link or any card id
 * is unknown.
 */
export function parseClashRoyaleDeckLink(text: string): string[] | null {
  let decoded = text.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* malformed escape — keep raw text */
  }

  const match = decoded.match(/deck=([0-9;]+)/i);
  if (!match) return null;

  const idParts = match[1].split(';').filter((p) => p.length > 0);
  if (idParts.length !== DECK_SIZE) return null;

  const keys: string[] = [];
  for (const part of idParts) {
    const card = CARDS_BY_ID.get(Number(part));
    if (!card) return null;
    keys.push(card.key);
  }
  return keys;
}
