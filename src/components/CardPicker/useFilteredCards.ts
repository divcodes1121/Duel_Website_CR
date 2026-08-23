import { CARDS } from '../../data/cards';
import { useBuilderStore } from '../../state/store';
import { filterCards } from '../../utils/filter';
import { sortCards } from '../../utils/sort';

/**
 * The card list the library is currently showing, filtered and sorted.
 *
 * A hook in its own file rather than a computation inside the grid, because the
 * library header prints the count — and a header that counts its own copy of
 * the four filters is a second place for them to drift.
 */
export function useFilteredCards() {
  const filterType = useBuilderStore((s) => s.filterType);
  const search = useBuilderStore((s) => s.cardSearch);
  const elixir = useBuilderStore((s) => s.elixirFilter);
  const rarity = useBuilderStore((s) => s.rarityFilter);
  const sortKey = useBuilderStore((s) => s.sortKey);
  const sortDirection = useBuilderStore((s) => s.sortDirection);

  return sortCards(
    filterCards(CARDS, { type: filterType, search, elixir, rarity }),
    sortKey,
    sortDirection,
  );
}
