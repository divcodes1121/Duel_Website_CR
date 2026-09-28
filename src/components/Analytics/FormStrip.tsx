import { useState } from 'react';
import type { RecentBattle } from '../../state/analyticsClient';
import { formOf, streakLabel } from '../../utils/formStrip';
import styles from './FormStrip.module.css';

/**
 * The last results as a row of pips, oldest left, with the current run named.
 *
 * A TOOLTIP IS A HOVER, A TAP AND A FOCUS, but a floating one here would sit
 * over the first battle row. So the details go in the strip's own read-out
 * line instead: hovering or focusing a pip replaces the tally with that
 * battle, leaving puts the tally back. Pressing a pip asks the log to scroll to
 * that battle, turning the page if it is on the next one.
 */

const WORD = { win: 'Victory', loss: 'Defeat', draw: 'Draw' } as const;
const LETTER = { win: 'W', loss: 'L', draw: 'D' } as const;

export function FormStrip({
  battles,
  when,
  onPick,
}: {
  /** Newest first, as the log arrives. Only the first 20 are drawn. */
  battles: RecentBattle[];
  /** Formats a battle stamp, shared with the log so the two agree. */
  when: (raw: string) => string;
  /** A pip was pressed; `newestIndex` is its position in the log. */
  onPick: (battle: RecentBattle, newestIndex: number) => void;
}) {
  const [shown, setShown] = useState<RecentBattle | null>(null);
  if (battles.length === 0) return null;

  const form = formOf(battles);
  const n = form.ordered.length;
  const describe = (b: RecentBattle) =>
    `${WORD[b.result]} ${b.crowns}–${b.opponentCrowns} · ${b.modeLabel} · vs ${
      b.opponent.name || b.opponent.tag || 'unknown'
    } (${b.opponent.deckName}) · ${when(b.battleTime)}`;

  return (
    <section className={styles.form} aria-label={`Last ${n} results`}>
      <span className={styles.label}>Form</span>

      <div className={styles.pips}>
        {form.ordered.map((b, i) => (
          <button
            key={b.id}
            type="button"
            className={styles.pip}
            data-result={b.result}
            data-newest={i === n - 1 ? '' : undefined}
            aria-label={`${describe(b)}. Show it in the log.`}
            onMouseEnter={() => setShown(b)}
            onMouseLeave={() => setShown(null)}
            onFocus={() => setShown(b)}
            onBlur={() => setShown(null)}
            onClick={() => onPick(b, n - 1 - i)}
          >
            {LETTER[b.result]}
          </button>
        ))}
      </div>

      {form.streak && (
        <span className={styles.streak} data-result={form.streak.result}>
          {streakLabel(form.streak)}
        </span>
      )}

      {/* Not a live region: a focused pip already speaks its own label, and
          announcing it again here would say every battle twice. */}
      <p className={styles.readout}>
        {shown
          ? describe(shown)
          : `Last ${n}: ${form.wins}W ${form.losses}L${form.draws ? ` ${form.draws}D` : ''}${
              form.winRate !== null ? ` · ${form.winRate.toFixed(1)}% won` : ''
            }`}
      </p>
    </section>
  );
}
