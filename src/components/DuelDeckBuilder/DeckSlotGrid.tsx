import type { Deck, DeckOwner } from '../../types/deck';
import { DeckSlot } from './DeckSlot';
import styles from './DeckPanel.module.css';

interface DeckSlotGridProps {
  owner: DeckOwner;
  deckIndex: number;
  deck: Deck;
  /** A deck hidden with the eye: its slots are drawn but cannot be edited. */
  readOnly?: boolean;
}

export function DeckSlotGrid({ owner, deckIndex, deck, readOnly }: DeckSlotGridProps) {
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
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}
