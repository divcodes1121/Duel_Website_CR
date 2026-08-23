import { useEffect, useRef, useState } from 'react';
import { CARDS, CARDS_BY_KEY, getCardIconUrl } from '../../data/cards';
import type { Card } from '../../types/card';
import styles from './WinConFilter.module.css';

const byElixirThenName = (a: Card, b: Card) => a.elixir - b.elixir || a.name.localeCompare(b.name);

/** Win conditions lead the panel — they are the filters people reach for most. */
export const WIN_CONDITIONS = CARDS.filter((c) => c.isWinCondition).sort(byElixirThenName);

/** Every card, for the full list under them. */
const ALL_CARDS = [...CARDS].sort(byElixirThenName);

/** A deck matches when it holds every selected card (multi-select AND). */
export function deckMatchesFilter(slots: (string | null)[], selected: string[]): boolean {
  return selected.every((k) => slots.includes(k));
}

export function filterCardName(key: string): string {
  return CARDS_BY_KEY.get(key)?.name ?? key;
}

function CardChip({
  card,
  active,
  onToggle,
}: {
  card: Card;
  active: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.winconChip} ${active ? styles.winconChipActive : ''}`}
      title={`${card.name} decks`}
      aria-pressed={active}
      onClick={() => onToggle(card.key)}
    >
      <img src={getCardIconUrl(card.key)} alt={card.name} draggable={false} />
    </button>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
    </svg>
  );
}

interface WinConFilterProps {
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** Optional trailing content (e.g. a "2 of 5 decks" counter). */
  children?: React.ReactNode;
}

/**
 * Filter the decks on screen down to the ones holding particular cards.
 *
 * The twenty-one win conditions used to sit here as permanent 44px chips. That
 * fitted when a deck screen was one full-width column and the row of them was a
 * row; beside a card library it wraps to two lines and becomes the largest
 * thing on the page — a control for a job most visits do not do, drawn bigger
 * than the decks it filters.
 *
 * So it is one button now, and the panel behind it keeps everything: the win
 * conditions first because they are what people want, then all 122 cards, with
 * the search that was already there. Whatever IS selected stays out on the bar
 * as a chip, because a filter you cannot see is a filter you cannot undo.
 */
export function WinConFilter({ selected, onToggle, onClear, children }: WinConFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // The deck screens use Escape to drop the slot selection; while this is
        // open, closing it is the nearer meaning.
        e.stopPropagation();
        setOpen(false);
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const selectedCards = selected
    .map((k) => CARDS_BY_KEY.get(k))
    .filter((c): c is Card => !!c);

  const q = query.trim().toLowerCase();
  const results = q ? ALL_CARDS.filter((c) => c.name.toLowerCase().includes(q)) : null;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.winconBar} role="group" aria-label="Filter decks by card">
        <button
          type="button"
          className={styles.trigger}
          data-on={selected.length > 0 || undefined}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="Show only decks holding particular cards"
        >
          <FilterIcon />
          Filter
          {selected.length > 0 && <span className={styles.triggerCount}>{selected.length}</span>}
        </button>

        {/* Selected cards stay on the bar so the filter is visible and
            reversible with the panel shut. */}
        {selectedCards.map((card) => (
          <CardChip key={card.key} card={card} active onToggle={onToggle} />
        ))}

        {selected.length > 0 && (
          <button type="button" className={styles.winconClear} onClick={onClear}>
            Clear
          </button>
        )}

        {children}
      </div>

      {open && (
        <div className={styles.panel}>
          <input
            className={styles.search}
            value={query}
            autoFocus
            spellCheck={false}
            aria-label="Search cards to filter by"
            placeholder={`Search ${ALL_CARDS.length} cards…`}
            onChange={(e) => setQuery(e.target.value)}
          />

          {results ? (
            results.length === 0 ? (
              <p className={styles.noResults}>No cards match “{query}”.</p>
            ) : (
              <div className={styles.panelGrid}>
                {results.map((card) => (
                  <CardChip
                    key={card.key}
                    card={card}
                    active={selected.includes(card.key)}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            )
          ) : (
            <div className={styles.panelScroll}>
              <p className={styles.groupLabel}>Win conditions</p>
              <div className={styles.panelGrid}>
                {WIN_CONDITIONS.map((card) => (
                  <CardChip
                    key={card.key}
                    card={card}
                    active={selected.includes(card.key)}
                    onToggle={onToggle}
                  />
                ))}
              </div>

              <p className={styles.groupLabel}>Every card</p>
              <div className={styles.panelGrid}>
                {ALL_CARDS.map((card) => (
                  <CardChip
                    key={card.key}
                    card={card}
                    active={selected.includes(card.key)}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
