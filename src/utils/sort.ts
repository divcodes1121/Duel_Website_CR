import type { Card } from '../types/card';
import { RARITY_ORDER } from './rarityOrder';

export type SortKey = 'rarity' | 'elixir';
export type SortDirection = 'asc' | 'desc';

export function sortCards(cards: Card[], sortKey: SortKey, direction: SortDirection): Card[] {
  const sorted = [...cards].sort((a, b) => {
    const diff =
      sortKey === 'rarity'
        ? RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.elixir - b.elixir
        : a.elixir - b.elixir || RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity];
    return direction === 'asc' ? diff : -diff;
  });
  return sorted;
}
