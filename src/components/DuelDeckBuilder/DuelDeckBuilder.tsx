import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import { DeckPanel } from './DeckPanel';
import { CardPickerDrawer } from '../CardPicker/CardPickerDrawer';
import styles from './DuelDeckBuilder.module.css';

export function DuelDeckBuilder() {
  const duelDeckSet = useBuilderStore((s) => s.duelDeckSet);
  const clearSelection = useBuilderStore((s) => s.clearSelection);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);

  return (
    <div className={styles.builder}>
      <div className={styles.scrollArea}>
        <div className={styles.panels}>
          {duelDeckSet.decks.map((deck, i) => (
            <motion.div
              key={deck.id}
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ type: 'spring', stiffness: 240, damping: 26, delay: i * 0.07 }}
            >
              <DeckPanel deckIndex={i} deck={deck} />
            </motion.div>
          ))}
        </div>
      </div>
      <CardPickerDrawer />
    </div>
  );
}
