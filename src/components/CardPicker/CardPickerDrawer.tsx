import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBuilderStore } from '../../state/store';
import { useFlightStore, rectOf } from '../../state/flightStore';
import { getDrag, endDrag } from '../../state/dragContext';
import { getCardIconUrl } from '../../data/cards';
import { CardFilterTabs } from './CardFilterTabs';
import { CardSortControls } from './CardSortControls';
import { CardGrid } from './CardGrid';
import styles from './CardPicker.module.css';

const OWNER_LABEL = {
  solo: '',
  blue: 'Blue ',
  red: 'Red ',
  home: '',
} as const;

export function CardPickerDrawer() {
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const sets = useBuilderStore((s) => s.sets);
  const clearSlot = useBuilderStore((s) => s.clearSlot);
  const launchFlight = useFlightStore((s) => s.launch);
  const [removeHover, setRemoveHover] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Picking a slot means the user wants a card — bring the selector back up.
  useEffect(() => {
    if (selectedSlot) setCollapsed(false);
  }, [selectedSlot]);

  const targetDeck = selectedSlot ? sets[selectedSlot.owner].decks[selectedSlot.deckIndex] : null;

  return (
    <div
      className={`${styles.drawer} ${collapsed ? styles.drawerCollapsed : ''} ${
        removeHover ? styles.drawerRemoveHover : ''
      }`}
      data-drawer
      onDragOver={(e) => {
        // Dropping a deck card onto the browser removes it from the deck.
        if (getDrag()?.type === 'slot') {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setRemoveHover(true);
        }
      }}
      onDragLeave={() => setRemoveHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setRemoveHover(false);
        const drag = getDrag();
        if (drag?.type !== 'slot') return;
        const targetEl =
          document.querySelector(`[data-card-key="${drag.cardKey}"]`) ?? e.currentTarget;
        launchFlight(getCardIconUrl(drag.cardKey), drag.sourceRect, rectOf(targetEl));
        clearSlot(drag.owner, drag.deckIndex, drag.slotIndex);
        endDrag();
      }}
    >
      <button
        type="button"
        className={styles.drawerToggle}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Show card selector' : 'Hide card selector'}
        aria-label={collapsed ? 'Show card selector' : 'Hide card selector'}
        aria-expanded={!collapsed}
      >
        <motion.span
          className={styles.drawerToggleChevron}
          animate={{ rotate: collapsed ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 24 }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="drawer-content"
            className={styles.drawerContent}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className={styles.toolbar}>
              <CardFilterTabs />
              {removeHover ? (
                <span className={`${styles.target} ${styles.targetRemove}`}>Drop to remove</span>
              ) : (
                selectedSlot &&
                targetDeck && (
                  <span className={styles.target} data-owner={selectedSlot.owner}>
                    Adding to {OWNER_LABEL[selectedSlot.owner]}
                    {targetDeck.name} · slot {selectedSlot.slotIndex + 1} of 8 — Esc to stop
                  </span>
                )
              )}
              <CardSortControls />
            </div>
            {!selectedSlot && !removeHover && (
              <div className={styles.hint}>Select a slot to add a card — or drag cards directly</div>
            )}
            <CardGrid />
          </motion.div>
        )}
      </AnimatePresence>

      {collapsed && (
        <button
          type="button"
          className={styles.collapsedRow}
          onClick={() => setCollapsed(false)}
        >
          Card selector hidden — tap to open
        </button>
      )}
    </div>
  );
}
