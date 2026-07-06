import type { Deck, DeckOwner } from '../../types/deck';
import { DeckSlot } from './DeckSlot';
import styles from './DeckPanel.module.css';

interface DeckSlotGridProps {
  owner: DeckOwner;
  deckIndex: number;
  deck: Deck;
}

export function DeckSlotGrid({ owner, deckIndex, deck }: DeckSlotGridProps) {
  return (
    <div className={styles.slotGrid}>
      {deck.slots.map((cardKey, slotIndex) => (
        <DeckSlot
          key={slotIndex}
          owner={owner}
          deckIndex={deckIndex}
          slotIndex={slotIndex}
          cardKey={cardKey}
          deck={deck}
        />
      ))}
    </div>
  );
}
