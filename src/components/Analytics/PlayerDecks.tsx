import { useEffect, useState } from 'react';
import { useScreenExport } from '../Export/ExportButton';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { ReadingState } from './ReadingState';
import {
  AnalyticsError,
  fetchPlayerDecks,
  type DeckRecord,
  type PlayerDeckRow,
  type PlayerDecksReport,
} from '../../state/analyticsClient';
import {
  DECK_DAY_PRESETS,
  DECK_DEFAULT_DAYS,
  dayChip,
  type DeckDayPreset,
} from '../../utils/datePresets';
import { useHeldLoading } from '../../hooks/useHeldLoading';
import { rememberPlayer } from '../../state/recentPlayers';
import { DeckRankIcon, DropIcon } from '../Dashboard/icons';
import { CARDS_BY_KEY } from '../../data/cards';
import { distinctDeckLabels } from '../../utils/trendSeries';
import styles from './PlayerDecks.module.css';

/* Decks — every deck the player fielded in the window, most played first.
 *
 * ONE ROW A DECK, in three parts: what the deck is and how much of their play
 * it was, the eight cards, and the record — theirs on the first line, the same
 * exact list across every player on the second.
 *
 * THREE WINDOWS, AND NO OTHER CONTROL. 7, 14 and 30 days, counted back from
 * the player's last stored battle like every window on the site. The shell's
 * season menu does not reach this screen.
 *
 * THE SERVER DECIDES THE ORDER, THE FORMS AND THE NAMES. Nothing here sorts,
 * reseats or renames a deck.
 */

const nf = new Intl.NumberFormat('en-US');

/** How many decks are drawn before "Show more". */
const PAGE = 20;

const pct = (n: number) => `${n.toFixed(1)}%`;

/** '2026-08-10' -> '10 Aug'. */
function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A share prints two places below 1% — 0.38% and 0.77% are different decks. */
function share(n: number): string {
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

function RecordRow({ label, title, rec }: { label: string; title?: string; rec: DeckRecord | null }) {
  return (
    <tr>
      <th scope="row" title={title}>
        {label}
      </th>
      {rec ? (
        <>
          <td>{nf.format(rec.battles)}</td>
          <td data-kind="win">{pct(rec.winRate)}</td>
          <td>{pct(rec.drawRate)}</td>
          <td data-kind="loss">{pct(rec.lossRate)}</td>
        </>
      ) : (
        <>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </>
      )}
    </tr>
  );
}

function DeckRow({
  deck,
  name,
  rank,
  total,
  scale,
}: {
  deck: PlayerDeckRow;
  /** The deck's name, told apart from any other deck here that shares it. */
  name: string;
  rank: number;
  total: number;
  /** The most-played deck's share, so every bar is read against the first. */
  scale: number;
}) {
  return (
    <article className={styles.deck} data-deck={deck.key}>
      <div className={styles.lead}>
        <span className={styles.rank} data-medal={rank <= 3 ? rank : undefined}>
          {rank}
        </span>
        <div className={styles.ident}>
          <h2 className={styles.name} title={name}>
            {name}
          </h2>
          <div className={styles.figures}>
            <span className={styles.elixir} title="Average elixir">
              <span className={styles.elixirIcon} aria-hidden="true">
                <DropIcon size={13} />
              </span>
              {deck.avgElixir.toFixed(1)}
              <span className={styles.srOnly}> average elixir</span>
            </span>
            {deck.cycle !== null && (
              <span className={styles.cycle} title="The four cheapest cards">
                {deck.cycle} <span className={styles.unit}>cycle</span>
              </span>
            )}
          </div>
          <div className={styles.use}>
            <span className={styles.useValue}>{share(deck.useRate)}</span>
            <span className={styles.useCount}>
              {nf.format(deck.battles)} / {nf.format(total)} games
            </span>
            <span className={styles.meter} aria-hidden="true">
              <span
                className={styles.meterFill}
                style={{ width: `${scale > 0 ? Math.max(2, (deck.useRate / scale) * 100) : 0}%` }}
              />
            </span>
          </div>
        </div>
      </div>

      <div className={styles.cardsCell}>
        <div className={styles.strip}>
          {deck.cards.map((c) => (
            <span key={c} className={styles.slot}>
              <CardArt
                card={c}
                variant={deck.art?.[c]}
                inferred={deck.artInferred}
                className={styles.card}
              />
            </span>
          ))}
        </div>
        <DeckActions cards={deck.cards} name={name} art={deck.art} className={styles.actions} />
      </div>

      <table className={styles.record}>
        <thead>
          <tr>
            <td />
            <th scope="col">Battles</th>
            <th scope="col">Wins</th>
            <th scope="col">Draws</th>
            <th scope="col">Losses</th>
          </tr>
        </thead>
        <tbody>
          <RecordRow label="Player" rec={deck} />
          <RecordRow
            label="Community"
            title="This exact deck across every player we hold, over all stored battles"
            rec={deck.community}
          />
        </tbody>
      </table>
    </article>
  );
}

export function PlayerDecks({ tag }: { tag: string }) {
  const [days, setDays] = useState<DeckDayPreset>(DECK_DEFAULT_DAYS);
  const [report, setReport] = useState<PlayerDecksReport | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(PAGE);
  /* Held only on the first read. Changing the window dims the list in place
     rather than swapping the whole screen for a loader, so the three chips
     stay under the pointer that pressed one. */
  const reading = useHeldLoading(loading && !report);

  const exportButton = useScreenExport({
    id: 'decks',
    ready: Boolean(report),
    win: { days },
    build: async () =>
      (await import('../../utils/screenAdapters')).playerDecksDoc(report as PlayerDecksReport, tag),
  });

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchPlayerDecks(tag, days)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
        setShown(PAGE);
        // Only with games to show for it — an empty window proves no player.
        if (r.total > 0) rememberPlayer(tag, r.player?.name ?? null);
      })
      .catch((e) => {
        if (!live) return;
        setReport(null);
        setError(e as AnalyticsError);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [tag, days]);

  // A new player starts from an empty screen, not the last player's list dimmed.
  useEffect(() => {
    setReport(null);
  }, [tag]);

  if (reading) {
    return (
      <div className={styles.page}>
        <ReadingState k="player-decks" hue="pink">
          Reading their decks…
        </ReadingState>
      </div>
    );
  }

  if (error || !report) {
    const offline = error?.kind === 'offline';
    return (
      <div className={styles.page}>
        <section className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'No decks stored for that tag'}
          </h2>
          <p className={styles.noticeBody}>
            {offline ? error?.message : `Nothing is stored for ${tag} yet.`}
          </p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </section>
      </div>
    );
  }

  const { summary, decks, total } = report;
  const scale = decks[0]?.useRate ?? 0;
  /* A generated name is not an identity: one player here ran two different
     lists both called "Log Bait Inferno Tower". Same-named decks are told
     apart by the first card the others do not hold, as on the trend charts. */
  const names = distinctDeckLabels(
    decks.map((d) => ({ name: d.deckName, cards: d.cards })),
    (k) => CARDS_BY_KEY.get(k)?.name ?? k,
  );
  const hiddenTitle = Object.entries(summary.hiddenByMode ?? {})
    .map(([mode, n]) => `${mode}: ${nf.format(n)}`)
    .join('\n');

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.panelIcon}>
            <DeckRankIcon size={20} />
          </span>
          <div className={styles.panelHeadText}>
            <h1 className={styles.title}>Decks</h1>
            <p className={styles.blurb}>
              {nf.format(total)} {total === 1 ? 'game' : 'games'} · {nf.format(summary.decks)}{' '}
              {summary.decks === 1 ? 'deck' : 'decks'}
              {total > 0 && ` · ${pct(summary.winRate)} won`}
            </p>
          </div>

          <div className={styles.range} role="group" aria-label="Time frame">
            {exportButton}
            {DECK_DAY_PRESETS.map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.rangeChip} ${days === d ? styles.rangeChipOn : ''}`}
                aria-pressed={days === d}
                title={`Last ${d} days`}
                onClick={() => setDays(d)}
              >
                {dayChip(d)}
              </button>
            ))}
          </div>
        </header>

        <section className={styles.body} data-busy={loading || undefined}>
          {decks.length === 0 ? (
            <p className={styles.empty}>No games stored in the last {days} days.</p>
          ) : (
            <>
              {decks.slice(0, shown).map((d, i) => (
                <DeckRow key={d.key} deck={d} name={names[i]} rank={i + 1} total={total} scale={scale} />
              ))}
              {decks.length > shown && (
                <button type="button" className={styles.more} onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, decks.length - shown)} more · {decks.length - shown} left
                </button>
              )}
            </>
          )}
        </section>

        <footer className={styles.foot}>
          <span>
            {shortDay(report.window.from)} – {shortDay(report.window.to)}
          </span>
          {summary.hidden > 0 && (
            <span className={styles.hidden} title={hiddenTitle || undefined}>
              {nf.format(summary.hidden)} other-mode {summary.hidden === 1 ? 'battle' : 'battles'} not
              counted
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}
