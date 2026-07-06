import { useState } from 'react';
import { motion } from 'framer-motion';
import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../data/cards';
import { useBuilderStore } from '../../state/store';
import { useFlightStore, rectOf } from '../../state/flightStore';
import { startDrag, getDrag, endDrag } from '../../state/dragContext';
import {
  canAssignCardToSlot,
  canMoveCard,
  getSlotRoleByPosition,
  getSlotVisualVariant,
  type SlotVisualVariant,
} from '../../state/deckUtils';
import type { Card } from '../../types/card';
import type { Deck, DeckOwner } from '../../types/deck';
import styles from './DeckPanel.module.css';

interface DeckSlotProps {
  owner: DeckOwner;
  deckIndex: number;
  slotIndex: number;
  cardKey: string | null;
  deck: Deck;
}

// Champions don't have a separate "hero" art file — their normal card art already
// represents the champion form, so the Hero/Wild slot falls back to base art for them.
function getSlotIconUrl(variant: SlotVisualVariant, card: Card): string {
  if (variant === 'evolution') return getEvolutionIconUrl(card.key);
  if (variant === 'hero' && !card.isChampion) return getHeroIconUrl(card.key);
  return getCardIconUrl(card.key);
}

const VARIANT_BADGE_LABEL = {
  base: null,
  evolution: 'EVO',
  hero: 'HERO',
};

const ROLE_CLASS = {
  evolution: 'slotRoleEvolution',
  hero: 'slotRoleHero',
  wild: 'slotRoleWild',
  normal: '',
} as const;

const ROLE_LABEL = {
  evolution: 'Evolution slot',
  hero: 'Hero slot',
  wild: 'Wild slot',
  normal: '',
};

export function DeckSlot({ owner, deckIndex, slotIndex, cardKey, deck }: DeckSlotProps) {
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const selectSlot = useBuilderStore((s) => s.selectSlot);
  const clearSlot = useBuilderStore((s) => s.clearSlot);
  const assignCardAt = useBuilderStore((s) => s.assignCardAt);
  const moveCard = useBuilderStore((s) => s.moveCard);
  const ownerSet = useBuilderStore((s) => s.sets[owner]);
  const launchFlight = useFlightStore((s) => s.launch);
  const [dropHover, setDropHover] = useState(false);

  const isSelected =
    selectedSlot?.owner === owner &&
    selectedSlot?.deckIndex === deckIndex &&
    selectedSlot?.slotIndex === slotIndex;
  const card = cardKey ? CARDS_BY_KEY.get(cardKey) : undefined;
  // An imported deck may repeat a card another duel deck already owned — only
  // the pasted copy renders black & white, and only while the clash persists
  // (removing either copy restores the color live).
  const isDuplicate =
    !!card &&
    owner !== 'home' &&
    !!deck.importedDuplicates?.includes(card.key) &&
    ownerSet.decks.some((d, i) => i !== deckIndex && d.slots.includes(card.key));
  const variant = getSlotVisualVariant(deck, slotIndex, CARDS_BY_KEY);
  // Champions occupy the Hero/Wild slot but aren't Heroes — they get their own
  // "CHAMPION" label there instead of the misleading "HERO" one.
  const isChampionBadge = !!card?.isChampion && variant === 'hero';
  const badgeLabel = card?.isChampion
    ? isChampionBadge
      ? 'CHAMPION'
      : null
    : VARIANT_BADGE_LABEL[variant];
  const badgeClass = isChampionBadge
    ? styles['slotRoleBadge-champion']
    : styles[`slotRoleBadge-${variant}`];
  const role = getSlotRoleByPosition(slotIndex);
  const roleClass = ROLE_CLASS[role] ? styles[ROLE_CLASS[role]] : '';

  const title = card
    ? isDuplicate
      ? `${card.name} — already used in another deck`
      : card.name
    : role === 'normal'
      ? 'Empty slot'
      : `Empty slot — ${ROLE_LABEL[role]}`;

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!card) return;
    // Animate the card gracefully back toward its tile in the browser (or the
    // drawer itself if the tile is filtered out of view).
    const slotEl = (e.currentTarget as HTMLElement).closest('button');
    const targetEl =
      document.querySelector(`[data-card-key="${card.key}"]`) ??
      document.querySelector('[data-drawer]');
    if (slotEl && targetEl) {
      launchFlight(getCardIconUrl(card.key), rectOf(slotEl), rectOf(targetEl));
    }
    clearSlot(owner, deckIndex, slotIndex);
  }

  /** Whether the drag currently in progress may drop on this slot. */
  function canAcceptDrag(): boolean {
    const drag = getDrag();
    if (!drag) return false;
    const set = useBuilderStore.getState().sets[owner];
    // Deck's Home decks are independent — uniqueness only applies within one deck.
    const scope = owner === 'home' ? ('deck' as const) : ('collection' as const);
    if (drag.type === 'picker') {
      const dragCard = CARDS_BY_KEY.get(drag.cardKey);
      return (
        !!dragCard && canAssignCardToSlot(set, deckIndex, slotIndex, dragCard, CARDS_BY_KEY, scope)
      );
    }
    if (drag.owner !== owner) return false; // never across players
    return canMoveCard(
      set,
      { deckIndex: drag.deckIndex, slotIndex: drag.slotIndex },
      { deckIndex, slotIndex },
      CARDS_BY_KEY,
    );
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDropHover(false);
    const drag = getDrag();
    if (!drag || !canAcceptDrag()) return;
    const targetRect = rectOf(e.currentTarget);

    if (drag.type === 'picker') {
      launchFlight(getCardIconUrl(drag.cardKey), drag.sourceRect, targetRect);
      assignCardAt(owner, deckIndex, slotIndex, drag.cardKey);
    } else {
      launchFlight(getCardIconUrl(drag.cardKey), drag.sourceRect, targetRect);
      if (cardKey) {
        // Swap: the displaced card flies back to the source slot.
        launchFlight(getCardIconUrl(cardKey), targetRect, drag.sourceRect);
      }
      moveCard(
        owner,
        { deckIndex: drag.deckIndex, slotIndex: drag.slotIndex },
        { deckIndex, slotIndex },
      );
    }
    endDrag();
  }

  return (
    <button
      type="button"
      className={`${styles.slot} ${roleClass} ${card ? '' : styles.slotEmpty} ${
        isSelected ? styles.slotSelected : ''
      } ${dropHover ? styles.slotDropHover : ''} ${isDuplicate ? styles.slotDuplicate : ''}`}
      data-rarity={card?.rarity}
      data-slot={`${owner}-${deckIndex}-${slotIndex}`}
      onClick={() => selectSlot(owner, deckIndex, slotIndex)}
      title={title}
      draggable={!!card}
      onDragStart={(e) => {
        if (!card) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.key);
        startDrag({
          type: 'slot',
          owner,
          deckIndex,
          slotIndex,
          cardKey: card.key,
          sourceRect: rectOf(e.currentTarget),
        });
      }}
      onDragEnd={endDrag}
      onDragOver={(e) => {
        if (canAcceptDrag()) {
          e.preventDefault();
          e.dataTransfer.dropEffect = getDrag()?.type === 'picker' ? 'copy' : 'move';
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={handleDrop}
    >
      {card ? (
        <>
          <motion.img
            key={card.key}
            src={getSlotIconUrl(variant, card)}
            alt={card.name}
            className={styles.slotIcon}
            draggable={false}
            onError={(e) => {
              // A few cards lack special-form art (e.g. Bowler's hero art) — fall back to base art.
              const base = getCardIconUrl(card.key);
              if (e.currentTarget.src !== new URL(base, window.location.href).href) {
                e.currentTarget.src = base;
              }
            }}
            initial={{ scale: 0.5, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          />
          {badgeLabel && (
            <span className={`${styles.slotRoleBadge} ${badgeClass}`}>{badgeLabel}</span>
          )}
          <span
            className={styles.slotClear}
            role="button"
            aria-label={`Remove ${card.name}`}
            onClick={handleRemove}
          >
            ×
          </span>
        </>
      ) : null}
    </button>
  );
}
