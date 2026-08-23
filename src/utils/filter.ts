import type { Card, CardType, Rarity } from '../types/card';

export type CardTypeFilter = 'All' | CardType | 'Evo' | 'Hero' | 'Champion' | 'WinCondition';

/* `'all'` rather than `null` so the value round-trips through a <select> without
   a second encoding on the way in and out. */
export type ElixirFilter = 'all' | number;
export type RarityFilter = 'all' | Rarity;

export interface CardFilters {
  type: CardTypeFilter;
  search: string;
  elixir: ElixirFilter;
  rarity: RarityFilter;
}

/** What the library's Reset returns to. */
export const NO_CARD_FILTERS: CardFilters = {
  type: 'All',
  search: '',
  elixir: 'all',
  rarity: 'all',
};

export function filterCardsByType(cards: Card[], filter: CardTypeFilter): Card[] {
  if (filter === 'All') return cards;
  if (filter === 'Evo') return cards.filter((c) => c.canEvolve);
  if (filter === 'Hero') return cards.filter((c) => c.canBeHero);
  if (filter === 'Champion') return cards.filter((c) => c.isChampion);
  if (filter === 'WinCondition') return cards.filter((c) => c.isWinCondition);
  return cards.filter((c) => c.type === filter);
}

/**
 * Fold a name the way a player types one: case, spaces, hyphens and dots do not
 * count. "elitebarbs" and "Elite Barbarians" have to meet somewhere, and the
 * card KEY is already the hyphenated form, so folding both ends lets a query
 * match either without two comparisons.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Every library filter in one pass. The four are independent and AND together —
 * a search inside the Evolutions tab means "an evolution card called this",
 * which is the only reading that keeps the tab's label honest.
 */
export function filterCards(cards: Card[], f: CardFilters): Card[] {
  const query = fold(f.search);
  return filterCardsByType(cards, f.type).filter((card) => {
    if (f.elixir !== 'all' && card.elixir !== f.elixir) return false;
    if (f.rarity !== 'all' && card.rarity !== f.rarity) return false;
    if (query && !fold(card.name).includes(query) && !fold(card.key).includes(query)) return false;
    return true;
  });
}

/** True when anything is narrowing the list — what lights the Reset control. */
export function hasActiveFilters(f: CardFilters): boolean {
  return (
    f.type !== 'All' || f.search.trim() !== '' || f.elixir !== 'all' || f.rarity !== 'all'
  );
}

/**
 * The elixir costs that actually exist in the pool, ascending. Derived rather
 * than written out as 1–9: the dropdown then cannot offer a cost no card has,
 * and it follows the card data if Supercell ever adds one.
 */
export function elixirCosts(cards: Card[]): number[] {
  return [...new Set(cards.map((c) => c.elixir))].sort((a, b) => a - b);
}
