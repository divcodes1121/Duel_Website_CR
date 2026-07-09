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

/** A crown struck through — "this deck won no crowns". */
function CrownOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M4.5 4.5 L19.5 19.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

interface CrownCounterProps {
  /** Crowns won, 0..MAX_CROWNS. */
  value: number;
  onChange: (crowns: number) => void;
  side: PlayerId;
  deckName: string;
}

/**
 * Crowns a duel deck won. Each button sets its value directly: the struck-through
 * crown means zero, and crown N sets the count to N.
 */
export function CrownCounter({ value, onChange, side, deckName }: CrownCounterProps) {
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
          const n = i + 1;
          const lit = n <= crowns;
          return (
            <motion.button
              key={n}
              type="button"
              className={`${styles.pip} ${lit ? styles.pipLit : ''}`}
              aria-pressed={lit}
              title={`${n} crown${n === 1 ? '' : 's'}`}
              onClick={() => onChange(n)}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 460, damping: 18 }}
            >
              <CrownIcon />
            </motion.button>
          );
        })}

        <motion.button
          type="button"
          className={`${styles.pip} ${styles.pipZero} ${crowns === 0 ? styles.pipZeroActive : ''}`}
          aria-pressed={crowns === 0}
          title="No crowns"
          onClick={() => onChange(0)}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.88 }}
          transition={{ type: 'spring', stiffness: 460, damping: 18 }}
        >
          <CrownOffIcon />
        </motion.button>
      </div>
    </div>
  );
}
