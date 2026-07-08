import type { Card, CardType } from '../types/card';

export type CardTypeFilter = 'All' | CardType | 'Evo' | 'Hero' | 'Champion' | 'WinCondition';

export function filterCardsByType(cards: Card[], filter: CardTypeFilter): Card[] {
  if (filter === 'All') return cards;
  if (filter === 'Evo') return cards.filter((c) => c.canEvolve);
  if (filter === 'Hero') return cards.filter((c) => c.canBeHero);
  if (filter === 'Champion') return cards.filter((c) => c.isChampion);
  if (filter === 'WinCondition') return cards.filter((c) => c.isWinCondition);
  return cards.filter((c) => c.type === filter);
}
