import { CARDS_BY_KEY } from '../../data/cards';
import { getCycleCost, getElixirAverage } from '../../state/deckUtils';
import type { Deck } from '../../types/deck';
import styles from './DeckPanel.module.css';

interface DeckStatsProps {
  deck: Deck;
}

export function DeckStats({ deck }: DeckStatsProps) {
  const elixirAverage = getElixirAverage(deck, CARDS_BY_KEY);
  const cycleCost = getCycleCost(deck, CARDS_BY_KEY);

  return (
    <div className={styles.stats}>
      <span className={styles.statBadge} title="Average elixir cost">
        Avg {elixirAverage ?? '–'}
      </span>
      <span className={styles.statBadge} title="Cycle cost (4 cheapest cards)">
        Cycle {cycleCost ?? '–'}
      </span>
    </div>
  );
}
