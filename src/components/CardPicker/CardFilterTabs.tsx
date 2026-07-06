import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import type { CardTypeFilter } from '../../utils/filter';
import styles from './CardPicker.module.css';

const TABS: { id: CardTypeFilter; label: string }[] = [
  { id: 'All', label: 'All' },
  { id: 'Troop', label: 'Troop' },
  { id: 'Spell', label: 'Spell' },
  { id: 'Building', label: 'Building' },
  { id: 'Evo', label: 'Evos' },
  { id: 'Hero', label: 'Heroes' },
  { id: 'Champion', label: 'Champions' },
];

export function CardFilterTabs() {
  const filterType = useBuilderStore((s) => s.filterType);
  const setFilterType = useBuilderStore((s) => s.setFilterType);

  return (
    <div className={styles.segmented}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`${styles.segment} ${filterType === tab.id ? styles.segmentActive : ''}`}
          onClick={() => setFilterType(tab.id)}
        >
          {filterType === tab.id && (
            <motion.span
              layoutId="filter-indicator"
              className={styles.segmentIndicator}
              transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            />
          )}
          <span className={styles.segmentLabel}>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
