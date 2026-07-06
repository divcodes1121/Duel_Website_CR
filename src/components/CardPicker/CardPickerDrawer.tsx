import { useState } from 'react';
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

  const targetDeck = selectedSlot ? sets[selectedSlot.owner].decks[selectedSlot.deckIndex] : null;

  return (
    <div
      className={`${styles.drawer} ${removeHover ? styles.drawerRemoveHover : ''}`}
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
    </div>
  );
}
