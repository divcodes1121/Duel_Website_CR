import {
  CARDS,
  CARDS_BY_KEY,
  getCardIconUrl,
  getEvolutionIconUrl,
  getHeroIconUrl,
} from '../../data/cards';
import { filterCardsByType } from '../../utils/filter';
import { sortCards } from '../../utils/sort';
import { useBuilderStore } from '../../state/store';
import { useFlightStore, rectOf } from '../../state/flightStore';
import { canPlaceCardInSlot, getUsedCardKeys, MAX_CHAMPIONS_PER_DECK } from '../../state/deckUtils';
import { CardTile } from './CardTile';
import styles from './CardPicker.module.css';

export function CardGrid() {
  const sets = useBuilderStore((s) => s.sets);
  const mode = useBuilderStore((s) => s.mode);
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const filterType = useBuilderStore((s) => s.filterType);
  const sortKey = useBuilderStore((s) => s.sortKey);
  const sortDirection = useBuilderStore((s) => s.sortDirection);
  const assignCard = useBuilderStore((s) => s.assignCard);
  const launchFlight = useFlightStore((s) => s.launch);

  const cards = sortCards(filterCardsByType(CARDS, filterType), sortKey, sortDirection);

  // The Evos / Heroes filters preview the cards in their special art form.
  const iconFor = (cardKey: string) =>
    filterType === 'Evo'
      ? getEvolutionIconUrl(cardKey)
      : filterType === 'Hero'
        ? getHeroIconUrl(cardKey)
        : getCardIconUrl(cardKey);

  // Ownership ribbons (Versus mode only, and never in the Deck's Home picker).
  const showRibbons = mode === 'versus' && selectedSlot?.owner !== 'home';
  const blueUsed = showRibbons ? getUsedCardKeys(sets.blue) : null;
  const redUsed = showRibbons ? getUsedCardKeys(sets.red) : null;

  const activeSet = selectedSlot ? sets[selectedSlot.owner] : null;

  return (
    <div className={styles.grid}>
      {cards.map((card) => {
        let state: 'selected' | 'used' | 'available' | 'inactive' = 'available';
        let disabledReason: string | undefined;

        if (!selectedSlot || !activeSet) {
          state = 'inactive'; // nothing selected: picker is non-interactive
        } else {
          const currentDeck = activeSet.decks[selectedSlot.deckIndex];
          if (currentDeck.slots[selectedSlot.slotIndex] === card.key) {
            state = 'selected';
          } else if (!canPlaceCardInSlot(card, selectedSlot.slotIndex)) {
            state = 'used';
            disabledReason = 'Champions can only go in the 2nd (Hero) or 3rd (Wild) slot';
          } else {
            // Deck's Home decks are independent — only the deck being edited blocks reuse.
            const searchDecks =
              selectedSlot.owner === 'home' ? [currentDeck] : activeSet.decks;
            const ownerIndex = searchDecks.findIndex((deck) => deck.slots.includes(card.key));
            if (ownerIndex !== -1) {
              state = 'used';
              disabledReason =
                selectedSlot.owner === 'home'
                  ? 'Already in this deck'
                  : `Already used in ${searchDecks[ownerIndex].name}`;
            } else if (card.isChampion) {
              // The selected slot is about to be replaced, so it doesn't count
              // toward the cap (mirrors canAssignCardToSlot).
              const otherChampions = currentDeck.slots.filter(
                (k, i) =>
                  i !== selectedSlot.slotIndex && k !== null && CARDS_BY_KEY.get(k)?.isChampion,
              ).length;
              if (otherChampions >= MAX_CHAMPIONS_PER_DECK) {
                state = 'used';
                disabledReason = `Only ${MAX_CHAMPIONS_PER_DECK} Champions allowed per deck`;
              }
            }
          }
        }

        return (
          <CardTile
            key={card.key}
            card={card}
            iconSrc={iconFor(card.key)}
            state={state}
            disabledReason={disabledReason}
            ownedByBlue={blueUsed?.has(card.key) ?? false}
            ownedByRed={redUsed?.has(card.key) ?? false}
            onClick={(e) => {
              if (!selectedSlot) return;
              // Fly the card art from its tile into the destination slot.
              const tileEl = e.currentTarget;
              const slotEl = document.querySelector(
                `[data-slot="${selectedSlot.owner}-${selectedSlot.deckIndex}-${selectedSlot.slotIndex}"]`,
              );
              if (slotEl) {
                launchFlight(getCardIconUrl(card.key), rectOf(tileEl), rectOf(slotEl));
              }
              assignCard(card.key);
            }}
          />
        );
      })}
    </div>
  );
}
