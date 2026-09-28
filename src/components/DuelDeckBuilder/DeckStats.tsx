import { CARDS_BY_KEY } from '../../data/cards';
import { getCycleCost, getElixirAverage } from '../../state/deckUtils';
import { cardMix, elixirCurve } from '../../state/deckFill';
import { DECK_SIZE } from '../../types/deck';
import type { Deck } from '../../types/deck';
import { ElixirIcon, CycleIcon } from './icons';
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
  const cards = deck.slots.map((k) => (k ? CARDS_BY_KEY.get(k) : undefined)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const curve = elixirCurve(cards);
  const top = Math.max(3, ...curve);
  const mix = cardMix(cards);
  const mixText = [
    `${mix.winConditions} win condition${mix.winConditions === 1 ? '' : 's'}`,
    `${mix.spells} spell${mix.spells === 1 ? '' : 's'}`,
    `${mix.buildings} building${mix.buildings === 1 ? '' : 's'}`,
    `${mix.troops} troop${mix.troops === 1 ? '' : 's'}`,
  ].join(' · ');

  return (
    <div className={styles.stats} data-complete={complete || undefined}>
      <span className={styles.stat} title="Average elixir cost across the cards placed so far">
        <span className={styles.statIcon} aria-hidden="true">
          <ElixirIcon />
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

      {/* THE SHAPE, not only the average: seven bars for 1 to 7+ elixir.
          An average of 3.5 is a deck of 3s and 4s or a deck of 1s and 7s, and
          those play nothing alike. The mix rides in the title, counted from the
          catalogue's own flags — no judgement words. */}
      {cards.length > 0 && (
        <span
          className={styles.curve}
          role="img"
          aria-label={`Elixir curve: ${curve.map((n, i) => `${n} at ${i === 6 ? '7 or more' : i + 1}`).join(', ')}. ${mixText}`}
          title={`Elixir curve, 1 to 7+ · ${mixText}`}
        >
          {curve.map((n, i) => (
            <span
              key={i}
              className={styles.curveBar}
              data-empty={n === 0 || undefined}
              style={{ height: n ? `${Math.round((n / top) * 100)}%` : undefined }}
            />
          ))}
        </span>
      )}
    </div>
  );
}
