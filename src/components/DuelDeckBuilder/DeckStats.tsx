import { CARDS_BY_KEY } from '../../data/cards';
import { getCycleCost, getElixirAverage } from '../../state/deckUtils';
import { DECK_SIZE } from '../../types/deck';
import type { Deck } from '../../types/deck';
import { ElixirIcon, CycleIcon } from './icons';
import { ElixirOrb } from '../../three/ElixirOrb';
import styles from './DeckPanel.module.css';

interface DeckStatsProps {
  deck: Deck;
}

/**
 * Average elixir and cycle cost, as figures rather than badges.
 *
 * Both are `null` until there is something to average — `getCycleCost` needs
 * four cards before a four-card cycle means anything — and an en-dash says that
 * out loud instead of printing a 0 that would read as a measured zero.
 *
 * They go quiet green once all eight slots are filled, because until then both
 * numbers are about a partial deck and will still move.
 */
export function DeckStats({ deck }: DeckStatsProps) {
  const elixirAverage = getElixirAverage(deck, CARDS_BY_KEY);
  const cycleCost = getCycleCost(deck, CARDS_BY_KEY);
  const complete = deck.slots.filter((s) => s !== null).length === DECK_SIZE;

  return (
    <div className={styles.stats} data-complete={complete || undefined}>
      <span className={styles.stat} title="Average elixir cost across the cards placed so far">
        <span className={styles.statIcon} aria-hidden="true">
          {/* The flat glyph stays as the child: it is what renders under the
              orb, and all that renders without WebGL. */}
          <ElixirOrb>
            <ElixirIcon />
          </ElixirOrb>
        </span>
        <span className={styles.statValue}>{elixirAverage ?? '–'}</span>
        <span className={styles.statLabel}>avg</span>
      </span>

      <span className={styles.stat} title="Cycle cost — the four cheapest cards added together">
        <span className={styles.statIcon} aria-hidden="true">
          <CycleIcon />
        </span>
        <span className={styles.statValue}>{cycleCost ?? '–'}</span>
        <span className={styles.statLabel}>cycle</span>
      </span>
    </div>
  );
}
