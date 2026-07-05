import type { Card, CardType } from '../types/card';

export type CardTypeFilter = 'All' | CardType;

export function filterCardsByType(cards: Card[], filter: CardTypeFilter): Card[] {
  if (filter === 'All') return cards;
  return cards.filter((c) => c.type === filter);
}
