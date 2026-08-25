import { useEffect, useMemo, useState } from 'react';
import { CARDS_BY_KEY } from '../../data/cards';
import { parseClashRoyaleDeckLink } from '../../utils/deckLink';
import {
  fetchCounters,
  fetchDrawnDeck,
  fetchMetaBoard,
  type CountersReport,
  type DrawnDeck,
  type MetaDeck,
} from '../../state/analyticsClient';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { PieIcon } from '../Dashboard/icons';
import { PasteIntro, PasteHeader } from './PasteIntro';
import { ReadingState } from './ReadingState';
import styles from './DeckLab.module.css';

const pct = (v: number) => `${v.toFixed(1)}%`;
const num = (v: number) => v.toLocaleString();

/** The rung a figure came from, in words. A number without its evidence is a
 *  claim; this is the difference between "this deck's own 4,000 battles" and
 *  "the archetype average". */
const SOURCE_LABEL: Record<string, string> = {
  exact: 'these two exact lists',
  deck: 'this exact list',
  cluster7: 'lists one card different',
  cluster6: 'lists two cards different',
  archetype: 'the archetype average',
};

/* ── Charts ───────────────────────────────────────────────────────────────
   Inline SVG, no library. Three of them, and the FORM was picked before the
   colour in every case:

   · the elixir curve is a magnitude-by-bucket histogram — one series, so it
     needs no legend and takes a single hue;
   · the matchup spread is POLARITY, so it diverges from a 50% centre line.
     Position carries the sign and colour reinforces it, which is the order
     that survives a colourblind reader;
   · the style exposure is a ranked magnitude list — one hue again, identity
     carried by the label beside each bar rather than by nine colours.

   Every bar prints its own figure. That is the secondary encoding the palette
   validator requires, not a decoration. */

function ElixirCurve({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const costs = counts.map((n, i) => ({ cost: i + 1, n })).filter((c) => c.cost <= 9);

  return (
    <div className={styles.curve}>
      {costs.map(({ cost, n }) => (
        <div key={cost} className={styles.curveCol} title={`${n} card${n === 1 ? '' : 's'} at ${cost} elixir`}>
          <span className={styles.curveCount} data-zero={n === 0 || undefined}>
            {n || ''}
          </span>
          <span className={styles.curveTrack}>
            {/* No bar at all for an empty bucket. `min-height: 2px` keeps a
                one-card bar visible, and it was drawing that same sliver for
                zero — a mark where there is no data. */}
            {n > 0 && <span className={styles.curveBar} style={{ height: `${(n / max) * 100}%` }} />}
          </span>
          <span className={styles.curveCost}>{cost}</span>
        </div>
      ))}
    </div>
  );
}

interface SpreadRow {
  key: string;
  name: string;
  /** The DECK's win rate against this archetype. */
  winRate: number;
  games: number;
  /** Below this, the percentage is real but the ranking it produces is noise. */
  thin: boolean;
}

/**
 * A reading under this many games is marked thin.
 *
 * The spread is sorted by win rate, which is the right order for a spread — and
 * it put "77.8% over 9 games" above "56.1% over 3,684". Both figures are true;
 * only one of them would survive being measured again. The floor does not hide
 * the row (a game that happened is not an estimate and does not need a sample
 * size — the same argument `real_opponents` makes server-side); it drains the
 * colour out of it and leaves the count to speak.
 */
const THIN_GAMES = 50;

function MatchupSpread({ rows }: { rows: SpreadRow[] }) {
  // Widest deviation from even, so the axis is symmetric and a 4-point edge
  // never draws the same length as a 30-point one on a different deck.
  const span = Math.max(10, ...rows.map((r) => Math.abs(r.winRate - 50)));

  return (
    <div className={styles.spread}>
      <div className={styles.spreadAxis} aria-hidden="true">
        <span>{(50 - span).toFixed(0)}%</span>
        <span className={styles.spreadEven}>even</span>
        <span>{(50 + span).toFixed(0)}%</span>
      </div>

      {rows.map((r) => {
        const diff = r.winRate - 50;
        const width = (Math.abs(diff) / span) * 50;
        return (
          <div
            key={r.key}
            className={styles.spreadRow}
            data-thin={r.thin || undefined}
            title={
              r.thin
                ? `${r.name}: ${pct(r.winRate)} over only ${num(r.games)} battles — real, but thin`
                : `${r.name}: ${pct(r.winRate)} over ${num(r.games)} battles`
            }
          >
            <span className={styles.spreadName}>{r.name}</span>
            <span className={styles.spreadTrack}>
              <span className={styles.spreadCentre} aria-hidden="true" />
              <span
                className={styles.spreadBar}
                data-sign={diff >= 0 ? 'up' : 'down'}
                style={
                  diff >= 0
                    ? { left: '50%', width: `${width}%` }
                    : { right: '50%', width: `${width}%` }
                }
              />
            </span>
            <span className={styles.spreadValue} data-sign={diff >= 0 ? 'up' : 'down'}>
              {pct(r.winRate)}
            </span>
            <span className={styles.spreadGames}>{num(r.games)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RankedBars({
  rows,
}: {
  rows: { key: string; label: string; value: number; caption: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={styles.ranked}>
      {rows.map((r) => (
        <div key={r.key} className={styles.rankedRow}>
          <span className={styles.rankedLabel}>{r.label}</span>
          <span className={styles.rankedTrack}>
            <span className={styles.rankedBar} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className={styles.rankedValue}>{r.caption}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({
  value,
  label,
  hint,
  tone,
}: {
  value: string;
  label: string;
  hint?: string;
  tone?: 'win' | 'loss';
}) {
  return (
    <div className={styles.stat} title={hint}>
      <span className={styles.statValue} data-tone={tone}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}

/* ── The screen ───────────────────────────────────────────────────────── */

export function DeckLab() {
  const [link, setLink] = useState('');
  const [cards, setCards] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<DrawnDeck | null>(null);
  const [report, setReport] = useState<CountersReport | null>(null);
  const [meta, setMeta] = useState<MetaDeck | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Paste, press Analyze, THEN the results — and the box empties itself as they
   * land.
   *
   * It used to analyse the instant a link parsed, which made the Analyze button
   * decoration and started a multi-second matchup query off a keystroke. Now
   * the link sits there until it is asked for, so a mistyped or half-pasted URL
   * can be fixed before anything runs.
   *
   * The emptying happens on submit, not on paste: a 200-character URL left in
   * the field says nothing the eight cards below it do not say better, and
   * pasting the next deck otherwise means selecting all of it first.
   */
  function submit(text: string) {
    const keys = parseClashRoyaleDeckLink(text);
    if (!keys) {
      setError('That is not a Clash Royale deck link.');
      return;
    }
    setError(null);
    setCards(keys);
    setLink('');
  }

  useEffect(() => {
    if (!cards) return;
    let live = true;
    setLoading(true);
    setFailed(false);
    // The drawing lands first and on its own: it touches no database, so the
    // deck appears in its real slots while the matchup work is still running
    // rather than after it.
    fetchDrawnDeck(cards)
      .then((d) => live && setDrawn(d))
      .catch(() => {});
    Promise.all([fetchCounters(cards), fetchMetaBoard().catch(() => null)])
      .then(([r, board]) => {
        if (!live) return;
        setReport(r);
        // `deck_hash` is the sorted card list, so the board can be asked
        // whether it already covers this deck without a second endpoint.
        const hash = [...cards].sort().join(',');
        setMeta((board?.decks ?? []).find((d) => d.deckHash === hash) ?? null);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cards]);

  /* Everything derivable from the cards themselves, with no service running.
     Type, elixir and rarity live in the JSON the browser already loaded to
     draw the art, so asking the server for them would be a second copy free
     to disagree with the one drawing the cards. */
  const shape = useMemo(() => {
    if (!cards) return null;
    const info = cards.map((k) => CARDS_BY_KEY.get(k)).filter((c): c is NonNullable<typeof c> => !!c);
    const costs = info.map((c) => c.elixir).sort((a, b) => a - b);
    const curve = Array.from({ length: 9 }, (_, i) => costs.filter((c) => c === i + 1).length);
    return {
      avg: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10) / 10 : 0,
      cycle: costs.length >= 4 ? costs.slice(0, 4).reduce((a, b) => a + b, 0) : null,
      curve,
      winCons: info.filter((c) => c.isWinCondition),
      spells: info.filter((c) => c.type === 'Spell').length,
      buildings: info.filter((c) => c.type === 'Building').length,
      champions: info.filter((c) => c.isChampion).length,
    };
  }, [cards]);

  const spread = useMemo<SpreadRow[]>(() => {
    const field = report?.field ?? [];
    return field
      // Each row's winRate is the ARCHETYPE's, so the deck's own is its
      // complement — the same flip the counter table makes, and the reason the
      // colour has to follow the number on screen rather than the one it came
      // from.
      .map((r) => ({
        key: r.archetype,
        name: r.name,
        winRate: 100 - r.winRate,
        games: r.games,
        thin: r.games < THIN_GAMES,
      }))
      .sort((a, b) => b.winRate - a.winRate);
  }, [report]);

  const thinCount = spread.filter((r) => r.thin).length;

  const overall = report?.overall ?? null;
  const hasOverall = overall?.winRate != null && overall.games > 0;

  /* The paste form is the same control in both states — the opening hero and
     the compact header once there is a deck — so it is built once. */
  const form = (
    <>
      <form
        className={styles.paste}
        onSubmit={(e) => {
          e.preventDefault();
          submit(link);
        }}
      >
        <input
          className={`${styles.pasteInput} ${error ? styles.pasteInputError : ''}`}
          value={link}
          spellCheck={false}
          placeholder="Paste a Clash Royale deck link…"
          aria-label="Clash Royale deck link"
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className={styles.pasteButton} aria-disabled={!link.trim()}>
          Analyze
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </>
  );

  if (!cards) {
    return (
      <section className={styles.page}>
        <PasteIntro
          hue="pink"
          icon={PieIcon}
          kicker="Deck Analysis"
          title={
            <>
              Paste a deck. See what it <em>actually</em> does.
            </>
          }
          blurb="Its curve, what it is built out of, how it has really performed, and every archetype it has to answer — all measured on stored battles. Nothing here is a rating out of ten."
          chips={['Elixir curve', 'Measured win rate', 'Every matchup', 'Meta standing']}
        >
          {form}
        </PasteIntro>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.body}>
        <PasteHeader hue="pink" icon={PieIcon} title="Deck Analysis">
          {form}
        </PasteHeader>

      {shape && (
        <>
          <div className={styles.deckStrip}>
            {(drawn?.cards ?? cards).map((key, i) => (
              <CardArt
                key={`${key}-${i}`}
                card={key}
                variant={drawn?.art?.[key]}
                inferred={drawn?.inferredArt}
                className={styles.deckCard}
              />
            ))}
            {/* The server's arranged order when it has answered, the raw paste
                while that is still in flight — the same source the strip above
                draws from, so the link can never describe a different deck from
                the one on screen. */}
            {/* No name: a pasted deck has none until the matchup answers, and
                `DrawnDeck` carries only the arrangement. The generic label is
                the honest one here. */}
            <DeckActions cards={drawn?.cards ?? cards} size="md" />
          </div>

          <div className={styles.statRow}>
            <Stat value={String(shape.avg)} label="Avg elixir" />
            <Stat value={shape.cycle == null ? '–' : String(shape.cycle)} label="Cycle cost" hint="The four cheapest cards" />
            <Stat
              value={hasOverall ? pct(overall!.winRate!) : '–'}
              label="Win rate"
              hint={
                hasOverall
                  ? `${num(overall!.games)} battles · ${SOURCE_LABEL[report?.source ?? 'archetype'] ?? ''}`
                  : 'Not enough stored battles'
              }
              tone={hasOverall ? (overall!.winRate! >= 50 ? 'win' : 'loss') : undefined}
            />
            <Stat
              value={report ? num(report.target.battles ?? 0) : '–'}
              label="Battles on this list"
              hint="Stored battles for these exact eight cards"
            />
          </div>

          {meta && (
            <p className={styles.metaNote}>
              This deck is <strong>#{meta.rank}</strong> on the current meta board — {pct(meta.useRate)} use
              rate, {pct(meta.winRate)} win rate over {num(meta.battles)} battles from {num(meta.players)}{' '}
              players.
            </p>
          )}

          <div className={styles.grid}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Elixir curve</h2>
              <p className={styles.cardSub}>How the eight cards are spread across cost.</p>
              <ElixirCurve counts={shape.curve} />
            </section>

            <section className={styles.card}>
              <h2 className={styles.cardTitle}>What it is made of</h2>
              <p className={styles.cardSub}>Roles, from the card data the page already holds.</p>
              <RankedBars
                rows={[
                  {
                    key: 'win',
                    label: 'Win conditions',
                    value: shape.winCons.length,
                    caption: shape.winCons.map((c) => c.name).join(', ') || 'none',
                  },
                  { key: 'spell', label: 'Spells', value: shape.spells, caption: String(shape.spells) },
                  { key: 'build', label: 'Buildings', value: shape.buildings, caption: String(shape.buildings) },
                  { key: 'champ', label: 'Champions', value: shape.champions, caption: String(shape.champions) },
                ]}
              />
              {shape.winCons.length === 0 && (
                <p className={styles.warn}>
                  No win condition in this list — nothing here reliably takes a tower.
                </p>
              )}
            </section>
          </div>

          {loading && (
            <ReadingState className={styles.loading} hue="pink">
              Measuring it against the field…
            </ReadingState>
          )}
          {failed && (
            <p className={styles.error}>
              The analytics service is not running, so only the card-derived half above is shown.
            </p>
          )}

          {spread.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Matchup spread</h2>
              <p className={styles.cardSub}>
                This deck&apos;s win rate against every archetype it has met, best first. The
                figure beside each bar is the number the bar draws — colour follows it, and the
                battle count beside it is what the figure is worth.
                {thinCount > 0 && (
                  <>
                    {' '}
                    {thinCount} row{thinCount === 1 ? ' is' : 's are'} drawn back because{' '}
                    {thinCount === 1 ? 'it rests' : 'they rest'} on under {THIN_GAMES} battles —
                    the percentage is real, the ranking it produces is noise.
                  </>
                )}
              </p>
              <MatchupSpread rows={spread} />
            </section>
          )}

          {report && report.styles.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Where the danger comes from</h2>
              <p className={styles.cardSub}>
                Play styles of the {report.counters.length} archetype
                {report.counters.length === 1 ? '' : 's'} that beat this deck, weighted by battles.
                The grouping is editorial — the database stores a win condition, which is a card,
                not a play style.
              </p>
              <RankedBars
                rows={report.styles.map((s) => ({
                  key: s.style,
                  label: s.style,
                  value: s.share,
                  caption: `${s.share.toFixed(0)}% · ${num(s.games)}`,
                }))}
              />
            </section>
          )}
        </>
      )}
      </div>
    </section>
  );
}
