import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CARDS, CARDS_BY_KEY, getCardIconUrl } from '../../data/cards';
import type { Card } from '../../types/card';
import styles from './WinConFilter.module.css';

const byElixirThenName = (a: Card, b: Card) => a.elixir - b.elixir || a.name.localeCompare(b.name);

/** Win conditions get permanent chips — they're the filters people reach for most. */
export const WIN_CONDITIONS = CARDS.filter((c) => c.isWinCondition).sort(byElixirThenName);

/** Every card, for the "All cards" dropdown selector. */
const ALL_CARDS = [...CARDS].sort(byElixirThenName);

const WIN_CONDITION_KEYS = new Set(WIN_CONDITIONS.map((c) => c.key));

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
    <motion.button
      type="button"
      className={`${styles.winconChip} ${active ? styles.winconChipActive : ''}`}
      title={`${card.name} decks`}
      aria-pressed={active}
      onClick={() => onToggle(card.key)}
      whileHover={{ y: -3, scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
    >
      <img src={getCardIconUrl(card.key)} alt={card.name} draggable={false} />
    </motion.button>
  );
}

interface WinConFilterProps {
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** Optional trailing content (e.g. a "2 of 5 decks" counter). */
  children?: React.ReactNode;
}

export function WinConFilter({ selected, onToggle, onClear, children }: WinConFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Selected non-win-condition cards get their own chips, so they stay visible
  // (and removable) once the dropdown is closed.
  const extraSelected = selected
    .filter((k) => !WIN_CONDITION_KEYS.has(k))
    .map((k) => CARDS_BY_KEY.get(k))
    .filter((c): c is Card => !!c);

  const q = query.trim().toLowerCase();
  const results = q ? ALL_CARDS.filter((c) => c.name.toLowerCase().includes(q)) : ALL_CARDS;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.winconBar} role="group" aria-label="Filter decks by card">
        {WIN_CONDITIONS.map((card) => (
          <CardChip
            key={card.key}
            card={card}
            active={selected.includes(card.key)}
            onToggle={onToggle}
          />
        ))}

        {extraSelected.map((card) => (
          <CardChip key={card.key} card={card} active onToggle={onToggle} />
        ))}

        <button
          type="button"
          className={`${styles.moreButton} ${open ? styles.moreButtonOpen : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="Filter by any card"
        >
          All cards
          <motion.span
            className={styles.moreChevron}
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </motion.span>
        </button>

        <AnimatePresence>
          {selected.length > 0 && (
            <motion.button
              type="button"
              className={styles.winconClear}
              onClick={onClear}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.15 }}
            >
              Clear ×
            </motion.button>
          )}
        </AnimatePresence>

        {children}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.panel}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className={styles.panelInner}>
              <input
                className={styles.search}
                value={query}
                autoFocus
                spellCheck={false}
                placeholder={`Search ${ALL_CARDS.length} cards…`}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length === 0 ? (
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
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
