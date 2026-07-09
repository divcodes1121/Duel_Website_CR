import { motion } from 'framer-motion';
import { MAX_CROWNS, type PlayerId } from '../../types/deck';
import styles from './CrownCounter.module.css';

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

interface CrownCounterProps {
  /** Crowns won, 0..MAX_CROWNS. */
  value: number;
  onChange: (crowns: number) => void;
  side: PlayerId;
  deckName: string;
  /** Read-only rendering (e.g. saved-group previews). */
  readOnly?: boolean;
}

/**
 * Crowns a duel deck won: three tappable crowns plus the running total.
 * Clicking crown N sets the count to N; clicking the topmost lit crown clears
 * it back down, so the whole 0–3 range is reachable in one tap.
 */
export function CrownCounter({ value, onChange, side, deckName, readOnly }: CrownCounterProps) {
  const crowns = Math.max(0, Math.min(MAX_CROWNS, Math.round(value || 0)));

  return (
    <div
      className={styles.counter}
      data-side={side}
      data-empty={crowns === 0 ? 'true' : undefined}
      role="group"
      aria-label={`Crowns won by ${deckName}: ${crowns} of ${MAX_CROWNS}`}
    >
      <span className={styles.value}>{crowns}</span>
      <div className={styles.pips}>
        {Array.from({ length: MAX_CROWNS }, (_, i) => {
          const lit = i < crowns;
          const label = `${i + 1} crown${i === 0 ? '' : 's'}`;
          if (readOnly) {
            return (
              <span key={i} className={`${styles.pip} ${lit ? styles.pipLit : ''}`} title={label}>
                <CrownIcon />
              </span>
            );
          }
          return (
            <motion.button
              key={i}
              type="button"
              className={`${styles.pip} ${lit ? styles.pipLit : ''}`}
              aria-pressed={lit}
              title={label}
              // Tapping the highest lit crown turns it off, so 3 -> 2 -> 1 -> 0.
              onClick={() => onChange(crowns === i + 1 ? i : i + 1)}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 460, damping: 18 }}
            >
              <CrownIcon />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
