import { CARDS, CARDS_BY_KEY } from '../../data/cards';
import { filterCardsByType } from '../../utils/filter';
import { sortCards } from '../../utils/sort';
import { useBuilderStore } from '../../state/store';
import { countChampionsInDeck } from '../../state/deckUtils';
import { CardTile } from './CardTile';
import styles from './CardPicker.module.css';

export function CardGrid() {
  const duelDeckSet = useBuilderStore((s) => s.duelDeckSet);
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const filterType = useBuilderStore((s) => s.filterType);
  const sortKey = useBuilderStore((s) => s.sortKey);
  const sortDirection = useBuilderStore((s) => s.sortDirection);
  const assignCard = useBuilderStore((s) => s.assignCard);

  const cards = sortCards(filterCardsByType(CARDS, filterType), sortKey, sortDirection);

  return (
    <div className={styles.grid}>
      {cards.map((card) => {
        let state: 'selected' | 'used' | 'available' | 'inactive' = 'available';
        let disabledReason: string | undefined;

        if (!selectedSlot) {
          state = 'inactive'; // nothing selected: picker is non-interactive
        } else {
          const currentDeck = duelDeckSet.decks[selectedSlot.deckIndex];
          if (currentDeck.slots[selectedSlot.slotIndex] === card.key) {
            state = 'selected';
          } else {
            const ownerIndex = duelDeckSet.decks.findIndex((deck) => deck.slots.includes(card.key));
            if (ownerIndex !== -1) {
              state = 'used';
              disabledReason = `Already used in ${duelDeckSet.decks[ownerIndex].name}`;
            } else if (card.isChampion && countChampionsInDeck(currentDeck, CARDS_BY_KEY) > 0) {
              state = 'used';
              disabledReason = 'Only 1 Champion allowed per deck';
            }
          }
        }

        return (
          <CardTile
            key={card.key}
            card={card}
            state={state}
            disabledReason={disabledReason}
            onClick={() => {
              if (!selectedSlot) return;
              assignCard(card.key);
            }}
          />
        );
      })}
    </div>
  );
}
