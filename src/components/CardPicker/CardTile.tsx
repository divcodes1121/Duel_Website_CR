import { motion } from 'framer-motion';
import type { Card } from '../../types/card';
import { getCardIconUrl } from '../../data/cards';
import { startDrag, endDrag } from '../../state/dragContext';
import { rectOf } from '../../state/flightStore';
import styles from './CardPicker.module.css';

interface CardTileProps {
  card: Card;
  /** Art to display (evo/hero form when those filters are active); defaults to base card art. */
  iconSrc?: string;
  state: 'selected' | 'used' | 'available' | 'inactive';
  disabledReason?: string;
  ownedByBlue?: boolean;
  ownedByRed?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function CardTile({
  card,
  iconSrc,
  state,
  disabledReason,
  ownedByBlue = false,
  ownedByRed = false,
  onClick,
}: CardTileProps) {
  const disabled = state === 'used' || state === 'inactive';
  const ownership =
    ownedByBlue && ownedByRed
      ? ' (used by Blue & Red)'
      : ownedByBlue
        ? ' (used by Blue)'
        : ownedByRed
          ? ' (used by Red)'
          : '';
  const title = state === 'used' && disabledReason ? disabledReason : `${card.name}${ownership}`;

  return (
    <motion.button
      type="button"
      className={`${styles.tile} ${state === 'selected' ? styles.tileSelected : ''} ${
        disabled ? styles.tileDisabled : ''
      }`}
      data-rarity={card.rarity}
      data-card-key={card.key}
      // Not the `disabled` attribute: tiles stay draggable even when they can't
      // be clicked (e.g. a Blue-used card dragged onto a Red slot in Versus).
      aria-disabled={disabled}
      title={title}
      onClick={(e) => {
        if (disabled) return;
        onClick(e);
      }}
      draggable
      // Capture-phase handlers: framer-motion reserves onDragStart/onDragEnd
      // for its own gesture system on motion components.
      onDragStartCapture={(e: React.DragEvent<HTMLButtonElement>) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', card.key);
        startDrag({ type: 'picker', cardKey: card.key, sourceRect: rectOf(e.currentTarget) });
      }}
      onDragEndCapture={endDrag}
      whileHover={disabled ? undefined : { y: -5, rotate: -1.5, scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
    >
      <img
        src={iconSrc ?? getCardIconUrl(card.key)}
        alt={card.name}
        className={styles.tileIcon}
        draggable={false}
        onError={(e) => {
          // A few cards lack special-form art (e.g. Bowler's hero art) — fall back to base art.
          const base = getCardIconUrl(card.key);
          if (e.currentTarget.src !== new URL(base, window.location.href).href) {
            e.currentTarget.src = base;
          }
        }}
      />
      {(ownedByBlue || ownedByRed) && (
        <span className={styles.ribbons} aria-hidden="true">
          {ownedByBlue && <span className={`${styles.ribbon} ${styles.ribbonBlue}`} />}
          {ownedByRed && <span className={`${styles.ribbon} ${styles.ribbonRed}`} />}
        </span>
      )}
    </motion.button>
  );
}
