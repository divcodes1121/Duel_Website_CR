import { motion } from 'framer-motion';
import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../data/cards';
import { useBuilderStore } from '../../state/store';
import { getSlotRoleByPosition, getSlotVisualVariant, type SlotVisualVariant } from '../../state/deckUtils';
import type { Card } from '../../types/card';
import type { Deck } from '../../types/deck';
import styles from './DeckPanel.module.css';

interface DeckSlotProps {
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

export function DeckSlot({ deckIndex, slotIndex, cardKey, deck }: DeckSlotProps) {
  const selectedSlot = useBuilderStore((s) => s.selectedSlot);
  const selectSlot = useBuilderStore((s) => s.selectSlot);
  const clearSlot = useBuilderStore((s) => s.clearSlot);

  const isSelected = selectedSlot?.deckIndex === deckIndex && selectedSlot?.slotIndex === slotIndex;
  const card = cardKey ? CARDS_BY_KEY.get(cardKey) : undefined;
  const variant = getSlotVisualVariant(deck, slotIndex, CARDS_BY_KEY);
  // Champions occupy the Hero/Wild slot but aren't Heroes — the gold outline already
  // marks the slot, so skip the (misleading) "HERO" label for them.
  const badgeLabel = card?.isChampion ? null : VARIANT_BADGE_LABEL[variant];
  const role = getSlotRoleByPosition(slotIndex);
  const roleClass = ROLE_CLASS[role] ? styles[ROLE_CLASS[role]] : '';

  const title = card ? card.name : role === 'normal' ? 'Empty slot' : `Empty slot — ${ROLE_LABEL[role]}`;

  return (
    <button
      type="button"
      className={`${styles.slot} ${roleClass} ${card ? '' : styles.slotEmpty} ${
        isSelected ? styles.slotSelected : ''
      }`}
      data-rarity={card?.rarity}
      onClick={() => selectSlot(deckIndex, slotIndex)}
      title={title}
    >
      {card ? (
        <>
          <motion.img
            key={card.key}
            src={getSlotIconUrl(variant, card)}
            alt={card.name}
            className={styles.slotIcon}
            initial={{ scale: 0.5, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          />
          <span className={styles.slotElixir}>{card.elixir}</span>
          {badgeLabel && (
            <span className={`${styles.slotRoleBadge} ${styles[`slotRoleBadge-${variant}`]}`}>
              {badgeLabel}
            </span>
          )}
          <span
            className={styles.slotClear}
            role="button"
            aria-label={`Remove ${card.name}`}
            onClick={(e) => {
              e.stopPropagation();
              clearSlot(deckIndex, slotIndex);
            }}
          >
            ×
          </span>
        </>
      ) : (
        <span className={styles.slotPlaceholder}>+</span>
      )}
    </button>
  );
}
