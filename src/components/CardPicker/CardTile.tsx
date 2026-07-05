import { motion } from 'framer-motion';
import type { Card } from '../../types/card';
import { getCardIconUrl } from '../../data/cards';
import styles from './CardPicker.module.css';

interface CardTileProps {
  card: Card;
  state: 'selected' | 'used' | 'available' | 'inactive';
  disabledReason?: string;
  onClick: () => void;
}

export function CardTile({ card, state, disabledReason, onClick }: CardTileProps) {
  const disabled = state === 'used' || state === 'inactive';
  const title = state === 'used' && disabledReason ? disabledReason : card.name;

  return (
    <motion.button
      type="button"
      className={`${styles.tile} ${state === 'selected' ? styles.tileSelected : ''} ${
        disabled ? styles.tileDisabled : ''
      }`}
      data-rarity={card.rarity}
      disabled={disabled}
      title={title}
      onClick={onClick}
      whileHover={disabled ? undefined : { y: -5, rotate: -1.5, scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
    >
      <img src={getCardIconUrl(card.key)} alt={card.name} className={styles.tileIcon} />
      <span className={styles.tileElixir}>{card.elixir}</span>
    </motion.button>
  );
}
