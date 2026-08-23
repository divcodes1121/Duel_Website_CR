import { useMemo } from 'react';
import { CARDS } from '../../data/cards';
import { useReveal } from '../../hooks/useReveal';
import styles from './ClosingBand.module.css';

/* The foot of the landing screen: what the numbers on this site rest on.
 *
 * EVERY FIGURE HERE IS COMPUTED, NOT WRITTEN DOWN. The chart is the real elixir
 * distribution of the real card list the app ships (`CARDS`), counted at render
 * time — so it cannot drift when a card is added, and there is no invented
 * "2.31M battles analysed" anywhere on the page. That restraint is the point:
 * a trust section that opens with a fabricated number is worse than no trust
 * section, and this one has to survive someone checking it.
 *
 * The three claims beside it are properties of how the thing is built, each
 * true and each checkable in this repo — not marketing adjectives.
 */

function ShieldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M9.2 12.2l1.9 1.9 3.7-3.8" />
    </svg>
  );
}

function ScaleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v16" />
      <path d="M6 8h12" />
      <path d="M3 15l3-7 3 7a3.2 3.2 0 0 1-6 0z" />
      <path d="M15 15l3-7 3 7a3.2 3.2 0 0 1-6 0z" />
    </svg>
  );
}

function StackIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12l9 4.5L21 12" />
      <path d="M3 16.5L12 21l9-4.5" />
    </svg>
  );
}

const CLAIMS = [
  {
    hue: 'blue',
    icon: ShieldIcon,
    title: 'Read-only, by construction',
    /* No backticks: this is rendered text, not markdown, and they showed up as
       literal characters on the page. */
    body: 'The analytics service opens the battle database in SQLite’s read-only mode. Nothing this site can do writes to it — that is a property of how it connects, not a promise.',
  },
  {
    hue: 'green',
    icon: ScaleIcon,
    title: 'Measured, or not shown',
    body: 'A percentage appears only once it clears an evidence floor — eight decks and two different shells — with Wilson confidence on every row. Thin samples say they are thin instead of guessing.',
  },
  {
    hue: 'violet',
    icon: StackIcon,
    title: 'The whole card set',
    body: 'Every card in the game, and an evolved or hero form counted as its own card rather than folded into the base one, because they do not play the same.',
  },
] as const;

export function ClosingBand() {
  const reveal = useReveal<HTMLDivElement>();

  /* Counted from the shipped card list at render time. If a card is added the
     chart moves on its own; nothing here is a literal to keep in step. */
  const { bins, total, peak } = useMemo(() => {
    const tally = new Map<number, number>();
    for (const c of CARDS) tally.set(c.elixir, (tally.get(c.elixir) ?? 0) + 1);
    const costs = [...tally.keys()].sort((a, b) => a - b);
    const b = costs.map((cost) => ({ cost, n: tally.get(cost) ?? 0 }));
    return { bins: b, total: CARDS.length, peak: Math.max(...b.map((x) => x.n)) };
  }, []);

  return (
    <div className={styles.band} ref={reveal}>
      <section className={styles.card}>
        <div className={styles.copy}>
          <h2 className={styles.title}>Nothing here is a round number</h2>
          <p className={styles.lede}>
            Every figure on this site is counted from real battles in a local database, under rules
            that are written down. Where the evidence is thin, the screen says so rather than
            filling the gap.
          </p>

          <ul className={styles.claims}>
            {CLAIMS.map((c) => {
              const Icon = c.icon;
              return (
                <li key={c.title} className={styles.claim} data-hue={c.hue}>
                  <span className={styles.claimIcon}>
                    <Icon />
                  </span>
                  <span className={styles.claimText}>
                    <span className={styles.claimTitle}>{c.title}</span>
                    <span className={styles.claimBody}>{c.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <figure className={styles.figure}>
          <figcaption className={styles.figHead}>
            <span className={styles.figTitle}>All {total} cards, by elixir cost</span>
            <span className={styles.figSub}>
              Counted from the card list this app ships — not a sample, not an estimate.
            </span>
          </figcaption>

          {/* A histogram: magnitude across ordered bins, so height carries the
              value and colour carries nothing. One series, one flat hue, and
              therefore no legend — the title names it. */}
          <div className={styles.chart} role="img"
               aria-label={`Elixir cost distribution of all ${total} cards. ${bins.map((b) => `${b.cost} elixir: ${b.n} cards`).join('. ')}.`}>
            {bins.map((b) => (
              <div key={b.cost} className={styles.col} title={`${b.n} cards cost ${b.cost} elixir`}>
                <span className={styles.barWrap}>
                  {/* The count rides above only the tallest bar — a number on
                      every bar is noise when the axis already reads. */}
                  {b.n === peak && <span className={styles.barValue}>{b.n}</span>}
                  <span
                    className={styles.bar}
                    style={{ height: `${(b.n / peak) * 100}%` }}
                  />
                </span>
                <span className={styles.colLabel}>{b.cost}</span>
              </div>
            ))}
          </div>
          <span className={styles.axisNote}>elixir cost</span>
        </figure>
      </section>

      <p className={styles.footer}>
        Built for duelists · card art and card data are Supercell’s, used under their Fan Content
        Policy · this site is not affiliated with Supercell
      </p>
    </div>
  );
}
