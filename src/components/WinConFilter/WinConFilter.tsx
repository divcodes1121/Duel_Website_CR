import { AnimatePresence, motion } from 'framer-motion';
import { CARDS, getCardIconUrl } from '../../data/cards';
import styles from './WinConFilter.module.css';

/** Every win-condition card, cheap to expensive — the deck filter chips. */
export const WIN_CONDITIONS = CARDS.filter((c) => c.isWinCondition).sort(
  (a, b) => a.elixir - b.elixir || a.name.localeCompare(b.name),
);

/** A deck matches when it holds every selected win condition (multi-select AND). */
export function deckMatchesWinCons(slots: (string | null)[], selected: string[]): boolean {
  return selected.every((k) => slots.includes(k));
}

interface WinConFilterProps {
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** Optional trailing content (e.g. a "2 of 5 decks" counter). */
  children?: React.ReactNode;
}

export function WinConFilter({ selected, onToggle, onClear, children }: WinConFilterProps) {
  return (
    <div className={styles.winconBar} role="group" aria-label="Filter decks by win condition">
      {WIN_CONDITIONS.map((card) => {
        const active = selected.includes(card.key);
        return (
          <motion.button
            key={card.key}
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
      })}

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
  );
}
