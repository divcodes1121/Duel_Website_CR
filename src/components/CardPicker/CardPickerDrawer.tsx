import { useBuilderStore } from '../../state/store';
import { CardFilterTabs } from './CardFilterTabs';
import { CardSortControls } from './CardSortControls';
import { CardGrid } from './CardGrid';
import styles from './CardPicker.module.css';

export function CardPickerDrawer() {
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const duelDeckSet = useBuilderStore((s) => s.duelDeckSet);

  const targetDeck = selectedSlot ? duelDeckSet.decks[selectedSlot.deckIndex] : null;

  return (
    <div className={styles.drawer}>
      <div className={styles.toolbar}>
        <CardFilterTabs />
        {selectedSlot && targetDeck && (
          <span className={styles.target}>
            Adding to {targetDeck.name} · slot {selectedSlot.slotIndex + 1} of 8 — Esc to stop
          </span>
        )}
        <CardSortControls />
      </div>
      {!selectedSlot && <div className={styles.hint}>Select a slot to add a card</div>}
      <CardGrid />
    </div>
  );
}
