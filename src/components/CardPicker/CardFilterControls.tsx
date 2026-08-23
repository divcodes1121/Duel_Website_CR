import { CARDS } from '../../data/cards';
import { useBuilderStore } from '../../state/store';
import { elixirCosts, hasActiveFilters } from '../../utils/filter';
import type { RarityFilter } from '../../utils/filter';
import type { Rarity } from '../../types/card';
import type { SortKey } from '../../utils/sort';
import { SearchIcon, ChevronDownIcon, CloseIcon } from '../DuelDeckBuilder/icons';
import styles from './CardPicker.module.css';

const SORT_LABELS: Record<SortKey, string> = {
  elixir: 'Elixir',
  rarity: 'Rarity',
};

const RARITIES: Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary', 'Champion'];

const COSTS = elixirCosts(CARDS);

/**
 * The library's control row: Reset, sort, the two value filters and search.
 *
 * These are real `<select>` elements rather than the portalled menus the rest of
 * the app builds by hand. A dropdown over a list of five fixed values is the one
 * case the platform control already answers — it is keyboard-navigable, it
 * type-aheads, and on a phone it opens the native wheel. The chip look is a
 * wrapper plus a caret; the select itself is transparent on top of it, so what
 * you click is the control you see.
 */
export function CardFilterControls() {
  const sortKey = useBuilderStore((s) => s.sortKey);
  const sortDirection = useBuilderStore((s) => s.sortDirection);
  const setSort = useBuilderStore((s) => s.setSort);
  const search = useBuilderStore((s) => s.cardSearch);
  const setSearch = useBuilderStore((s) => s.setCardSearch);
  const elixir = useBuilderStore((s) => s.elixirFilter);
  const setElixir = useBuilderStore((s) => s.setElixirFilter);
  const rarity = useBuilderStore((s) => s.rarityFilter);
  const setRarity = useBuilderStore((s) => s.setRarityFilter);
  const filterType = useBuilderStore((s) => s.filterType);
  const resetFilters = useBuilderStore((s) => s.resetCardFilters);

  const active = hasActiveFilters({ type: filterType, search, elixir, rarity });

  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={styles.reset}
        onClick={resetFilters}
        // A Reset that does nothing is worse than no Reset — it still looks
        // like the thing to press when the grid is not showing what you expect.
        aria-disabled={!active}
        data-active={active || undefined}
        title={active ? 'Clear the type, search, elixir and rarity filters' : 'No filters applied'}
      >
        Reset
      </button>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Sort</span>
        <span className={styles.select}>
          <select
            value={sortKey}
            onChange={(e) => {
              const next = e.target.value as SortKey;
              // setSort flips direction when the key is unchanged, so only call
              // it for a real change — otherwise picking the current option out
              // of the list would silently reverse the grid.
              if (next !== sortKey) setSort(next);
            }}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
          <ChevronDownIcon />
        </span>
        <button
          type="button"
          className={styles.direction}
          onClick={() => setSort(sortKey)}
          title={sortDirection === 'asc' ? 'Lowest first — click for highest' : 'Highest first — click for lowest'}
          aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </button>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Elixir</span>
        <span className={styles.select} data-narrow="true">
          <select
            value={String(elixir)}
            onChange={(e) => setElixir(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            data-on={elixir !== 'all' || undefined}
          >
            <option value="all">All</option>
            {COSTS.map((cost) => (
              <option key={cost} value={cost}>
                {cost}
              </option>
            ))}
          </select>
          <ChevronDownIcon />
        </span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Rarity</span>
        <span className={styles.select}>
          <select
            value={rarity}
            onChange={(e) => setRarity(e.target.value as RarityFilter)}
            data-on={rarity !== 'all' || undefined}
          >
            <option value="all">All</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <ChevronDownIcon />
        </span>
      </label>

      <div className={styles.search}>
        <span className={styles.searchIcon} aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          value={search}
          placeholder="Search cards"
          aria-label="Search cards by name"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && search) {
              // Swallow it: Escape is the builder's "stop editing this slot"
              // shortcut, and clearing the box is the closer meaning while the
              // caret is in it.
              e.stopPropagation();
              setSearch('');
            }
          }}
        />
        {search && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setSearch('')}
            title="Clear search"
            aria-label="Clear search"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
