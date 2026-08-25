import {
  CARDS_BY_KEY,
  getCardIconUrl,
  getEvolutionIconUrl,
  getHeroIconUrl,
} from '../data/cards';
import { getSlotVisualVariant } from '../state/deckUtils';
import type { Deck } from '../types/deck';

/**
 * The icon a deck slot should SHOW, honouring the special slots.
 *
 * Slot 0 is Evolution and slot 1 is Hero, and a card sitting in one of them is
 * drawn with that form's art rather than its base art — the same selection the
 * live slots make through `getSlotVisualVariant`, so a preview matches the deck
 * it is previewing. `Deck.wildVariant` is honoured too, because the variant
 * lookup reads it.
 *
 * THIS LIVES HERE BECAUSE THERE ARE NOW THREE CALLERS. It began as a private
 * helper inside `SavedGroups`, and the filmstrip's folder faces were written
 * with a plain `getCardIconUrl` instead — so a folder holding an evolution deck
 * showed the base card, which is the one thing a preview must not do. One
 * implementation, three callers.
 *
 * A champion in the Hero slot keeps its own art: champions have no hero form,
 * and asking for one returns a URL that 404s.
 */
export function previewIconFor(deck: Deck, slotIndex: number, key: string): string {
  const card = CARDS_BY_KEY.get(key);
  const variant = getSlotVisualVariant(deck, slotIndex, CARDS_BY_KEY);
  if (variant === 'evolution') return getEvolutionIconUrl(key);
  if (variant === 'hero' && card && !card.isChampion) return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

/**
 * A deck's face for a preview: its filled slots, in order, with the right art.
 *
 * Returns `{ key, src }` so a caller can key a list without re-deriving the
 * URL, and caps the count for the small faces a filmstrip card draws.
 */
export function deckFaces(deck: Deck, limit = 8): { key: string; src: string }[] {
  const out: { key: string; src: string }[] = [];
  deck.slots.forEach((key, i) => {
    if (!key || out.length >= limit) return;
    out.push({ key: `${key}-${i}`, src: previewIconFor(deck, i, key) });
  });
  return out;
}
