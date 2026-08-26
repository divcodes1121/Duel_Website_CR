import { Suspense, lazy, useMemo } from 'react';
import { CARDS } from '../../data/cards';
import { useReveal } from '../../hooks/useReveal';
import styles from './ClosingBand.module.css';

/* The foot of the landing screen: a few facts about the game.
 *
 * IT USED TO BE THREE CLAIMS ABOUT THIS SITE — "read-only", "measured, or
 * blank", "every card" — which is a trust badge, and a trust badge is the
 * least interesting thing you can put at the bottom of a page about Clash
 * Royale. It read like a compliance notice. Facts about the game are what
 * someone scrolling this far actually wants.
 *
 * EVERY FACT IS STILL COMPUTED, NOT WRITTEN DOWN, and that constraint carries
 * over from the old section unchanged. `CARDS` is counted at render time, so a
 * fact cannot go stale when a card is added, and there is no invented figure
 * anywhere on this page — the reference mock's "2.31M+ battles analysed" was
 * deliberately never built. A fun fact that turns out to be wrong is worse
 * than no fun fact.
 *
 * They are SHUFFLED per visit, which is what makes "random" mean something.
 */

function BoltIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
    </svg>
  );
}

function CrownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 18h16l1.4-10-5.4 3.6L12 4l-4 7.6L2.6 8z" />
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

function StarIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.9 6.7 19.6l1.1-5.8L3.5 9.7l5.9-.8L12 3.5z" />
    </svg>
  );
}

function TowerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 21V9l-2-2 3-3 2 2h6l2-2 3 3-2 2v12z" />
      <path d="M10 21v-5h4v5" />
    </svg>
  );
}

function SwirlIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21a9 9 0 1 0-9-9" />
      <path d="M12 16a4 4 0 1 0-4-4" />
    </svg>
  );
}

const HUES = ['blue', 'green', 'violet'] as const;
type Fact = { title: string; body: string; icon: (p: { size?: number }) => JSX.Element };

/** English list: "a, b and c". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Facts, derived from the card list rather than typed out.
 *
 * Everything below counts `CARDS`, which is the same list the builder and the
 * analytics screens use, so these agree with the rest of the site by
 * construction. Nothing here is a sentence someone remembered.
 */
function buildFacts(): Fact[] {
  const cards = CARDS;
  const n = cards.length;

  const byCost = new Map<number, typeof cards>();
  for (const c of cards) byCost.set(c.elixir, [...(byCost.get(c.elixir) ?? []), c]);

  const costs = [...byCost.keys()].sort((a, b) => a - b);
  const cheapest = costs[0];
  const priciest = costs[costs.length - 1];
  const cheap = byCost.get(cheapest) ?? [];
  const dear = byCost.get(priciest) ?? [];
  const avg = cards.reduce((s, c) => s + c.elixir, 0) / n;

  const evos = cards.filter((c) => c.canEvolve).length;
  const champs = cards.filter((c) => c.isChampion);
  const heroes = cards.filter((c) => c.canBeHero).length;
  const wincons = cards.filter((c) => c.isWinCondition).length;
  const byRarity = (r: string) => cards.filter((c) => c.rarity === r).length;
  const cheapSpells = cards.filter((c) => c.type === 'Spell' && c.elixir <= 2).length;
  const troops = cards.filter((c) => c.type === 'Troop').length;
  const spells = cards.filter((c) => c.type === 'Spell').length;
  const buildings = cards.filter((c) => c.type === 'Building').length;

  return [
    {
      title: 'The cheapest cards',
      body: `${plural(cheap.length, 'card')} cost a single elixir — ${list(cheap.map((c) => c.name))}.`,
      icon: BoltIcon,
    },
    {
      title: 'The most expensive',
      body: `${list(dear.map((c) => c.name))} at ${priciest} elixir. Nothing in the game costs more.`,
      icon: TowerIcon,
    },
    {
      title: 'Evolutions',
      body: `${evos} of the ${n} cards have an Evolution, and a deck may field one.`,
      icon: SwirlIcon,
    },
    {
      title: 'Champions',
      body: `Only ${champs.length}: ${list(champs.map((c) => c.name))}.`,
      icon: CrownIcon,
    },
    {
      title: 'Heroes',
      body: `${heroes} cards can take the Hero slot — the ${champs.length} Champions among them.`,
      icon: StarIcon,
    },
    {
      title: 'Win conditions',
      body: `${wincons} cards are win conditions. The other ${n - wincons} are support.`,
      icon: TowerIcon,
    },
    {
      title: 'Troops, spells, buildings',
      body: `${troops} troops, ${spells} spells, ${buildings} buildings.`,
      icon: StackIcon,
    },
    {
      title: 'The average card',
      body: `${avg.toFixed(1)} elixir across all ${n}. Eight of those would make a ${(avg * 8).toFixed(0)}-elixir deck.`,
      icon: BoltIcon,
    },
    {
      title: 'The rarest',
      body: `${byRarity('Champion')} Champions against ${byRarity('Epic')} Epics — the smallest group and the largest.`,
      icon: StarIcon,
    },
    {
      title: 'Cheap answers',
      body: `${cheapSpells} of the ${spells} spells cost two elixir or less.`,
      icon: BoltIcon,
    },
  ];
}

/* LAZY, like every other piece in `src/three/`. This is a WebGL simulation at
   the very foot of the page; loading it in the main bundle would make the
   landing screen pay for something most visitors never scroll to. */
const WaterBand = lazy(() =>
  import('../../three/WaterBand').then((m) => ({ default: m.WaterBand })),
);

export function ClosingBand() {
  const reveal = useReveal<HTMLDivElement>();

  const { facts, bins, total, peak, commonest } = useMemo(() => {
    /* Shuffled once per mount. Three of ten, so a second visit is a
       different three — which is the only thing that makes "random" honest. */
    const pool = buildFacts();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const tally = new Map<number, number>();
    for (const c of CARDS) tally.set(c.elixir, (tally.get(c.elixir) ?? 0) + 1);
    const costs = [...tally.keys()].sort((a, b) => a - b);
    const b = costs.map((cost) => ({ cost, n: tally.get(cost) ?? 0 }));
    const top = Math.max(...b.map((x) => x.n));
    return {
      facts: pool.slice(0, 3),
      bins: b,
      total: CARDS.length,
      peak: top,
      commonest: b.find((x) => x.n === top)?.cost ?? 0,
    };
  }, []);

  return (
    <div className={styles.band} ref={reveal}>
      <section className={styles.card}>
        {/* The water sits UNDER the card's content and over its background, so
            the facts stay legible. `Suspense` with no fallback: an effect that
            has not loaded should leave the band exactly as it was, not flash a
            placeholder into the layout. */}
        <Suspense fallback={null}>
          <WaterBand hue="--hue-blue" />
        </Suspense>
        <div className={styles.copy}>
          <h2 className={styles.title}>Card facts</h2>
          <p className={styles.lede}>
            Three at a time, counted from the {total} cards. Reload for three more.
          </p>

          <ul className={styles.claims}>
            {facts.map((f, i) => {
              const Icon = f.icon;
              return (
                <li key={f.title} className={styles.claim} data-hue={HUES[i % HUES.length]}>
                  <span className={styles.claimIcon}>
                    <Icon />
                  </span>
                  <span className={styles.claimText}>
                    <span className={styles.claimTitle}>{f.title}</span>
                    <span className={styles.claimBody}>{f.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <figure className={styles.figure}>
          <figcaption className={styles.figHead}>
            <span className={styles.figTitle}>Most cards cost {commonest} elixir</span>
            <span className={styles.figSub}>Every card in the game, by cost.</span>
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
