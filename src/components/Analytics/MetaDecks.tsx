import { useEffect, useRef, useState } from 'react';
import { WinConFilter, deckMatchesFilter } from '../WinConFilter/WinConFilter';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { ReportButton } from '../Export/ReportButton';
import { metaBoardDoc } from '../../utils/reportAdapters';
import { ReadingState } from './ReadingState';
import {
  AnalyticsError,
  fetchMetaBoard,
  type MetaBoard,
} from '../../state/analyticsClient';
import styles from './MetaDecks.module.css';
import { useHeldLoading } from '../../hooks/useHeldLoading';

/* Top Meta Decks — what the whole player base is running, ranked by use rate.
 *
 * Every other analytics screen is about one player; this one aggregates across
 * all tracked players. It reads a background-computed snapshot rather than
 * querying live, because the underlying scan takes ~45 s — see server/meta.py.
 * That is why the header states how old the numbers are instead of pretending
 * they are real-time. */

const nf = new Intl.NumberFormat('en-US');

/** '2026-08-01' -> '1 Aug'. */
function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function ago(seconds: number): string {
  if (seconds < 90) return 'just now';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const ICONS = {
  trophy: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
      <path d="M10 19h4M12 14v5" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 4v7h-7" />
    </svg>
  ),
};

export function MetaDecks() {
  const [board, setBoard] = useState<MetaBoard | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);
  /* Cards the board is filtered to. Empty means the whole top 50. */
  const [cardFilter, setCardFilter] = useState<string[]>([]);
  /* THE WHOLE CONDITION, not the flag: `!board` flips at the same instant
     the data lands, so holding a bare `loading` would let this guard fall
     through anyway. See the hook. */
  const reading = useHeldLoading(loading && !board);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;

    const load = () => {
      fetchMetaBoard()
        .then((b) => {
          if (!live) return;
          setBoard(b);
          setError(null);
          // While the first snapshot is being built the server has nothing to
          // serve, so poll until it does. Once there is a board, stop — the
          // background thread refreshes it on its own schedule.
          if (b.building && !b.decks.length) {
            timer.current = window.setTimeout(load, 4000);
          }
        })
        .catch((e) => live && setError(e as AnalyticsError))
        .finally(() => live && setLoading(false));
    };

    load();
    return () => {
      live = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  if (reading) {
    return (
      <section className={styles.panelBare}>
        <ReadingState k="meta" hue="blue">
          Reading the meta snapshot…
        </ReadingState>
      </section>
    );
  }

  if (error) {
    const offline = error.kind === 'offline';
    return (
      <section className={styles.panel}>
        <div className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'Could not load the meta'}
          </h2>
          <p>{error.message}</p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </div>
      </section>
    );
  }

  if (board?.building && !board.decks.length) {
    return (
      <section className={styles.panelBare}>
        {/* The longest wait in the app — a cold rollup reads millions of rows
            off the spinning volume. If any state has earned a visible sign of
            life rather than a paragraph and a seconds counter, it is this one. */}
        <ReadingState k="meta-cold" hue="blue">
          <h2 className={styles.noticeTitle}>Building the meta snapshot…</h2>
          <p>
            Ranking every deck across the whole database takes about 45 seconds — it reads
            millions of battles. This runs once in the background and then refreshes itself, so
            it only happens on a cold start.
          </p>
          <p className={styles.noticeSub}>
            {/* DISAMBIGUATED, because the rig above now shows an elapsed
                counter too and they are not the same number. That one is how
                long YOU have been waiting; this is how long the background
                rollup has been running, which may have started before this
                screen was opened. Two bare "elapsed" figures disagreeing on
                one panel reads as a bug. */}
            {board.elapsedSeconds
              ? `Rollup running ${Math.round(board.elapsedSeconds)}s`
              : 'Rollup starting…'}
          </p>
        </ReadingState>
      </section>
    );
  }

  if (!board || !board.decks.length) {
    return (
      <section className={styles.panel}>
        <p className={styles.notice}>No competitive battles stored for this window yet.</p>
      </section>
    );
  }

  const { decks: allDecks, window: win } = board;

  /* PICK CARDS, KEEP THE DECKS THAT HOLD THEM ALL.
     The same control and the same predicate as Deck's Home and the Counter Hub
     — `deckMatchesFilter` is multi-select AND — so "decks with Hog Rider and
     Fireball" means the same thing on every screen that offers it. A second
     implementation here would eventually disagree with those two about what a
     match is. */
  const decks = cardFilter.length
    ? allDecks.filter((d) => deckMatchesFilter(d.cards, cardFilter))
    : allDecks;

  /* THE RULER STAYS THE WHOLE BOARD'S, not the filtered subset's.
     Use rate is a deck's share of every battle in the window, so rescaling the
     bars to the survivors would make a 0.4% deck look like the most-played in
     the game the moment you filtered down to it. The number beside the bar
     would then disagree with the bar. */
  const topUse = Math.max(...allDecks.map((d) => d.useRate), 0.01);

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.headLead}>
          <span className={styles.headIcon}>{ICONS.trophy}</span>
          <div className={styles.headText}>
            <h1 className={styles.title}>Top Meta Decks</h1>
            <p className={styles.blurb}>
              What the whole player base is running, ranked by use rate — last {win.days} days
              {win.from ? `, ${shortDay(win.from)} – ${shortDay(win.to)}` : ''}.
            </p>
          </div>
        </div>

        {/* THE MIDDLE COLUMN, not a third thing pushed onto the right edge.
            The header is a grid of 1fr / auto / 1fr precisely so this sits in
            the centre of the panel however wide the title and the stats turn
            out to be - flex auto-margins would only centre it in the space
            those two happened to leave over. */}
        <div className={styles.filterSlot}>
          <WinConFilter
            align="center"
            selected={cardFilter}
            onToggle={(key) =>
              setCardFilter((f) => (f.includes(key) ? f.filter((k) => k !== key) : [...f, key]))
            }
            onClear={() => setCardFilter([])}
          />
        </div>

        <div className={styles.headStats}>
          {/* A thunk, not a built document — the report describes the board as
              it stands when the button is pressed, including how stale the
              snapshot has become by then. */}
          <ReportButton build={() => metaBoardDoc(board)} />
          <span className={styles.stat}>
            {cardFilter.length ? (
              <>
                <span className={styles.statValue}>
                  {decks.length} / {allDecks.length}
                </span>
                <span className={styles.statLabel}>decks match</span>
              </>
            ) : (
              <>
                <span className={styles.statValue}>{nf.format(board.totalBattles ?? 0)}</span>
                <span className={styles.statLabel}>battles ranked</span>
              </>
            )}
          </span>
          {/* Honest about freshness: this is a snapshot, not a live query. */}
          <span className={styles.freshness} title={`Recomputed every ${Math.round((board.refreshSeconds ?? 1800) / 60)} min`}>
            {ICONS.refresh}
            {board.building ? 'refreshing…' : `updated ${ago(board.ageSeconds ?? 0)}`}
          </span>
        </div>
      </header>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thRank}>#</th>
              <th>Deck</th>
              <th className={styles.thCards}>Cards</th>
              <th className={styles.thMeter}>Use Rate</th>
              <th className={styles.thMeter}>Win Rate</th>
              <th className={styles.thNum}>Battles</th>
              <th className={styles.thNum}>Elixir</th>
            </tr>
          </thead>
          <tbody>
            {decks.map((d) => (
              <tr key={d.deckHash} className={styles.row}>
                <td>
                  <span className={styles.rank} data-medal={d.rank <= 3 ? d.rank : undefined}>
                    {d.rank}
                  </span>
                </td>
                <td className={styles.deckName} title={d.deckHash}>
                  {d.name}
                  {/* Variants merged into this row, so a reader can see that
                      "Hog" is one deck with tech swaps rather than a name that
                      happens to appear twice. */}
                  <span className={styles.deckMeta}>
                    {d.variants > 1
                      ? `${d.variants} variants · ${nf.format(d.players)} players`
                      : `${nf.format(d.players)} players`}
                  </span>
                </td>
                <td>
                  <span className={styles.cardsCell}>
                    <span className={styles.cards}>
                      {d.cards.map((c) => (
                        <CardArt key={c} card={c} variant={d.art?.[c]} className={styles.cardIcon} />
                      ))}
                    </span>
                    <DeckActions cards={d.cards} name={d.name} />
                  </span>
                </td>
                <td>
                  <span className={styles.meterValue} data-key="use">
                    {d.useRate.toFixed(2)}%
                  </span>
                  <span className={styles.meter}>
                    <span
                      className={styles.meterFill}
                      data-key="use"
                      style={{ width: `${Math.min(100, (d.useRate / topUse) * 100)}%` }}
                    />
                  </span>
                </td>
                <td>
                  <span className={styles.meterValue} data-key="win">
                    {d.winRate.toFixed(1)}%
                  </span>
                  <span className={styles.meter}>
                    <span
                      className={styles.meterFill}
                      data-key="win"
                      style={{ width: `${d.winRate}%` }}
                    />
                  </span>
                </td>
                <td className={styles.num}>{nf.format(d.battles)}</td>
                <td className={styles.num}>{d.avgElixir ? d.avgElixir.toFixed(1) : '—'}</td>
              </tr>
            ))}
            {/* A filter that matches nothing must say so. An empty table reads
                as a broken board, and the fix is one sentence naming what was
                asked for and what was searched. */}
            {decks.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.noMatch}>
                  No deck in the top {allDecks.length} runs{' '}
                  {cardFilter.length === 1 ? 'that card' : 'all those cards together'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </section>
  );
}
