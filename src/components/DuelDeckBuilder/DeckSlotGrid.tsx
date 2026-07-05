import type { Deck } from '../../types/deck';
import { DeckSlot } from './DeckSlot';
import styles from './DeckPanel.module.css';

interface DeckSlotGridProps {
  deckIndex: number;
  deck: Deck;
}

export function DeckSlotGrid({ deckIndex, deck }: DeckSlotGridProps) {
  return (
    <div className={styles.slotGrid}>
      {deck.slots.map((cardKey, slotIndex) => (
        <DeckSlot
          key={slotIndex}
          deckIndex={deckIndex}
          slotIndex={slotIndex}
          cardKey={cardKey}
          deck={deck}
        />
      ))}
    </div>
  );
}
