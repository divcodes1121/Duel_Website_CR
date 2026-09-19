import { CARDS } from '../../data/cards';
import { useBuilderStore } from '../../state/store';
import { elixirCosts, hasActiveFilters } from '../../utils/filter';
import type { RarityFilter } from '../../utils/filter';
import type { Rarity } from '../../types/card';
import type { SortKey } from '../../utils/sort';
import { SearchIcon, CloseIcon } from '../DuelDeckBuilder/icons';
import { Dropdown } from '../ui/dropdown-menu-14';
import { BarsIcon, CardsIcon, DropIcon } from '../Dashboard/icons';
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
 * THE SHARED DROPDOWN NOW, NOT NATIVE SELECTS (2026-09-20). These were real
 * `<select>` elements for what the platform gives a select: keyboard
 * navigation, type-ahead, a picker on a phone. The shared `Dropdown` keeps the
 * first two — arrows, Home/End, Enter, Esc and type-ahead — and draws its open
 * list in the app's theme and font, which the operating system's never did.
 * A trigger that is narrowing the grid is lit violet (`.on`), the cue the old
 * chips carried.
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

      <span className={styles.field}>
        <Dropdown<SortKey>
          size="sm"
          caption="Sort"
          icon={<BarsIcon />}
          heading="Sort the library"
          value={sortKey}
          // setSort flips direction when the key is unchanged, so only call it
          // for a real change — the Dropdown already skips re-picking the
          // current option, so picking it cannot silently reverse the grid.
          onChange={(next) => setSort(next)}
          options={(Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({ value: key, label: SORT_LABELS[key] }))}
        />
        <button
          type="button"
          className={styles.direction}
          onClick={() => setSort(sortKey)}
          title={sortDirection === 'asc' ? 'Lowest first — click for highest' : 'Highest first — click for lowest'}
          aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </button>
      </span>

      <Dropdown
        size="sm"
        caption="Elixir"
        icon={<DropIcon />}
        heading="Elixir cost"
        className={elixir !== 'all' ? styles.on : undefined}
        value={String(elixir)}
        onChange={(v) => setElixir(v === 'all' ? 'all' : Number(v))}
        options={[
          { value: 'all', label: 'All costs', icon: '∗' },
          ...COSTS.map((cost) => ({ value: String(cost), label: `${cost} elixir`, icon: String(cost) })),
        ]}
      />

      <Dropdown<RarityFilter>
        size="sm"
        caption="Rarity"
        icon={<CardsIcon />}
        heading="Rarity"
        className={rarity !== 'all' ? styles.on : undefined}
        value={rarity}
        onChange={setRarity}
        options={[
          { value: 'all', label: 'All rarities', icon: '∗' },
          ...RARITIES.map((r) => ({ value: r, label: r, icon: r === 'Champion' ? 'Ch' : r[0] })),
        ]}
      />

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
