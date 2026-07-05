import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import type { CardTypeFilter } from '../../utils/filter';
import styles from './CardPicker.module.css';

const TABS: CardTypeFilter[] = ['All', 'Troop', 'Spell', 'Building'];

export function CardFilterTabs() {
  const filterType = useBuilderStore((s) => s.filterType);
  const setFilterType = useBuilderStore((s) => s.setFilterType);

  return (
    <div className={styles.segmented}>
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          className={`${styles.segment} ${filterType === tab ? styles.segmentActive : ''}`}
          onClick={() => setFilterType(tab)}
        >
          {filterType === tab && (
            <motion.span
              layoutId="filter-indicator"
              className={styles.segmentIndicator}
              transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            />
          )}
          <span className={styles.segmentLabel}>{tab}</span>
        </button>
      ))}
    </div>
  );
}
