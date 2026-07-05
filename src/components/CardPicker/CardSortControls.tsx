import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import type { SortKey } from '../../utils/sort';
import styles from './CardPicker.module.css';

const SORT_LABELS: Record<SortKey, string> = {
  rarity: 'Rarity',
  elixir: 'Elixir',
};

export function CardSortControls() {
  const sortKey = useBuilderStore((s) => s.sortKey);
  const sortDirection = useBuilderStore((s) => s.sortDirection);
  const setSort = useBuilderStore((s) => s.setSort);

  return (
    <div className={styles.segmented}>
      {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
        <button
          key={key}
          type="button"
          className={`${styles.segment} ${sortKey === key ? styles.segmentActive : ''}`}
          onClick={() => setSort(key)}
        >
          {sortKey === key && (
            <motion.span
              layoutId="sort-indicator"
              className={styles.segmentIndicator}
              transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            />
          )}
          <span className={styles.segmentLabel}>
            {SORT_LABELS[key]} {sortKey === key ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
