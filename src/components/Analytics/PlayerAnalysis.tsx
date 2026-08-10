import { useEffect, useState } from 'react';
import { getCardIconUrl } from '../../data/cards';
import { ChartLegend, TrendChart } from './TrendChart';
import {
  AnalyticsError,
  fetchPlayerReport,
  type PlayerReport,
} from '../../state/analyticsClient';
import { DECK_SORTS, RANGES, type DeckSort, type Series, type TrendData } from './playerData';
import styles from './PlayerAnalysis.module.css';

/* Player analysis — the screen the Analyze button lands on.
 *
 * Reads the local analytics API (server/app.py), which serves the Clash_Bot
 * SQLite tiers read-only. Three states matter and all three are handled: the
 * service not running, a tag with no stored battles, and a successful report. */

function CrownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

function VerifiedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-label="Verified">
      <path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1.2 2.8 1.2 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9L3.2 15.8 4.4 13 3.2 10.2l2.5-1.7.9-2.9 3 .2z" />
      <path d="M10.8 14.6L8.4 12.2l1-1 1.4 1.4 3.6-3.6 1 1z" fill="var(--surface)" />
    </svg>
  );
}

const ICONS = {
  trophy: (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
      <path d="M10 19h4M12 14v5" />
    </svg>
  ),
  swords: (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6M16 16l4 4M9.5 6.5 21 18v3h-3L6.5 9.5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  rank: (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
};

const nf = new Intl.NumberFormat('en-US');
const pct = (v: number) => `${v.toFixed(1)}%`;

/**
 * The categorical palette carries eight distinguishable hues. A ninth would not
 * be separable, so anything past the eighth deck folds into one muted "Other"
 * line — the table above still lists every deck.
 */
const MAX_SERIES = 8;

function foldSeries(data: TrendData): { plotted: Series[]; folded: number } {
  if (data.series.length <= MAX_SERIES) return { plotted: data.series, folded: 0 };
  const head = data.series.slice(0, MAX_SERIES);
  const tail = data.series.slice(MAX_SERIES);
  const points = tail[0].points.map((_, i) =>
    Number((tail.reduce((s, t) => s + t.points[i], 0) / tail.length).toFixed(2)),
  );
  return { plotted: [...head, { label: `Other (${tail.length})`, points }], folded: tail.length };
}

function TrendPanel({
  title,
  data,
  yTicks,
}: {
  title: string;
  data: TrendData;
  yTicks: number[];
}) {
  const [range, setRange] = useState<string>(RANGES[0]);
  const { plotted, folded } = foldSeries(data);

  return (
    <section className={styles.chartPanel}>
      <header className={styles.chartHead}>
        <h3 className={styles.chartTitle}>
          {title} <span className={styles.chartTitleSub}>(Top 10 Decks)</span>
        </h3>
        <label className={styles.selectWrap}>
          <span className="sr-only">Range for {title}</span>
          <select
            className={styles.select}
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {RANGES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </header>

      <div className={styles.chartBody}>
        <TrendChart series={plotted} ticks={data.ticks} yTicks={yTicks} format={pct} />
        <ChartLegend series={plotted} />
      </div>

      {folded > 0 && (
        <p className={styles.foldNote}>
          Ranks {MAX_SERIES + 1}–{MAX_SERIES + folded} are averaged into “Other” — eight is the
          most lines that stay separable. Every deck is listed in the table above.
        </p>
      )}
    </section>
  );
}


/** Percentage-point change across the window, for the Trend column. */
function trendOf(points: number[]): number {
  if (points.length < 2) return 0;
  const third = Math.max(1, Math.ceil(points.length / 3));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return Number((avg(points.slice(-third)) - avg(points.slice(0, third))).toFixed(1));
}

/** '2026-08-10' -> '10 Aug'. */
function shortDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function PlayerAnalysis({ tag }: { tag: string }) {
  const [sort, setSort] = useState<DeckSort>('top');
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchPlayerReport(tag)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
      })
      .catch((e) => {
        if (!live) return;
        setReport(null);
        setError(e as AnalyticsError);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tag]);

  if (loading) {
    return (
      <div className={styles.page}>
        <section className={styles.notice}>Reading the battle database…</section>
      </div>
    );
  }

  if (error || !report) {
    const offline = error?.kind === 'offline';
    return (
      <div className={styles.page}>
        <section className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'No stored battles for that tag'}
          </h2>
          <p className={styles.noticeBody}>{error?.message}</p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
          <p className={styles.noticeBody}>
            Searched for <strong>{tag}</strong>.
          </p>
        </section>
      </div>
    );
  }

  const { player, decks: apiDecks, trends, sources } = report;

  // Series are keyed by deck hash, so re-sorting the table never repaints the
  // charts — colour follows the deck, not its row position.
  const byHash = new Map(trends.series.map((s) => [s.deckHash, s]));
  const withTrend = apiDecks.map((d) => ({
    ...d,
    trend: trendOf(byHash.get(d.deckHash)?.win ?? []),
  }));

  const decks = [...withTrend].sort((a, b) =>
    sort === 'winrate'
      ? b.winRate - a.winRate
      : sort === 'recent'
        ? (b.lastSeen || '').localeCompare(a.lastSeen || '')
        : a.rank - b.rank,
  );

  const ticks = trends.days.length
    ? [0, 0.25, 0.5, 0.75, 1]
        .map((f) => Math.round(f * (trends.days.length - 1)))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((at) => ({ at, label: shortDay(trends.days[at]) }))
    : [];

  const toTrendData = (pick: 'use' | 'win'): TrendData => ({
    ticks,
    series: apiDecks.map((d) => ({
      label: d.name,
      points: byHash.get(d.deckHash)?.[pick] ?? trends.days.map(() => 0),
    })),
  });

  const winRate = player.battles ? (player.wins / player.battles) * 100 : 0;
  const rangeLabel = trends.days.length
    ? `${shortDay(trends.days[0])} – ${shortDay(trends.days[trends.days.length - 1])}`
    : '—';

  return (
    <div className={styles.page}>
      <section className={styles.summary}>
        <div className={styles.identity}>
          <span className={styles.badge}>
            <CrownIcon size={22} />
          </span>
          <div className={styles.identityText}>
            <h1 className={styles.playerName}>
              {player.name}
              {player.verified && (
                <span className={styles.verified} title="Tracked player">
                  <VerifiedIcon />
                </span>
              )}
            </h1>
            <span className={styles.playerTag}>{player.tag}</span>
          </div>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.swords}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>{nf.format(player.battles)}</span>
            <span className={styles.statLabel}>Battles Analyzed</span>
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.trophy}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>{winRate.toFixed(1)}%</span>
            <span className={styles.statLabel}>
              Win Rate ({nf.format(player.wins)}W / {nf.format(player.losses)}L)
            </span>
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.calendar}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>{rangeLabel}</span>
            <span className={styles.statLabel}>Data Range ({trends.days.length} Days)</span>
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.rank}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>{nf.format(player.crownsFor)}</span>
            <span className={styles.statLabel}>
              Crowns For ({nf.format(player.crownsAgainst)} against)
            </span>
          </span>
        </div>
      </section>

      <section className={styles.decksPanel}>
        <header className={styles.decksHead}>
          <h2 className={styles.decksTitle}>
            <span className={styles.decksTitleIcon}>
              <CrownIcon size={17} />
            </span>
            Top {decks.length} Decks
          </h2>
          <button type="button" className={styles.exportButton}>
            {ICONS.download}
            Export Data
          </button>
        </header>

        <div className={styles.sortTabs}>
          {DECK_SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.sortTab} ${sort === s.id ? styles.sortTabActive : ''}`}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thRank}>Rank</th>
                <th>Deck</th>
                <th>Cards</th>
                <th>
                  Use Rate <span className={styles.thInfo}>{ICONS.info}</span>
                </th>
                <th>
                  Win Rate <span className={styles.thInfo}>{ICONS.info}</span>
                </th>
                <th className={styles.thNum}>Matches</th>
                <th className={styles.thNum}>Wins</th>
                <th className={styles.thNum}>Losses</th>
                <th className={styles.thNum}>
                  Trend ({trends.days.length}d) <span className={styles.thInfo}>{ICONS.info}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {decks.map((d) => (
                <tr key={d.deckHash}>
                  <td>
                    <span className={styles.rank} data-medal={d.rank <= 3 ? d.rank : undefined}>
                      {d.rank}
                    </span>
                  </td>
                  <td className={styles.deckName} title={d.deckHash}>
                    {d.name}
                    {d.avgElixir ? (
                      <span className={styles.deckMeta}>{d.avgElixir.toFixed(1)} elixir</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.cards}>
                      {d.cards.map((c) => (
                        <img
                          key={c}
                          src={getCardIconUrl(c)}
                          alt={c}
                          title={c}
                          draggable={false}
                          className={styles.cardIcon}
                        />
                      ))}
                    </span>
                  </td>
                  <td>
                    <span className={styles.meterValue}>{pct(d.useRate)}</span>
                    <span className={styles.meter}>
                      <span
                        className={styles.meterFill}
                        style={{ width: `${Math.min(100, d.useRate * 3)}%` }}
                      />
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.meterValue} ${styles.meterValueWin}`}>
                      {pct(d.winRate)}
                    </span>
                    <span className={styles.meter}>
                      <span
                        className={`${styles.meterFill} ${styles.meterFillWin}`}
                        style={{ width: `${d.winRate}%` }}
                      />
                    </span>
                  </td>
                  <td className={styles.num}>{nf.format(d.matches)}</td>
                  <td className={styles.num}>{nf.format(d.wins)}</td>
                  <td className={styles.num}>{nf.format(d.losses)}</td>
                  <td className={styles.num}>
                    <span className={styles.trend} data-dir={d.trend >= 0 ? 'up' : 'down'}>
                      {d.trend >= 0 ? '▲' : '▼'} {Math.abs(d.trend).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two charts, not one with two y-scales. */}
      <div className={styles.charts}>
        <TrendPanel title="Use Rate Trend" data={toTrendData('use')} yTicks={[0, 25, 50, 75, 100]} />
        <TrendPanel title="Win Rate Trend" data={toTrendData('win')} yTicks={[0, 25, 50, 75, 100]} />
      </div>

      <footer className={styles.foot}>
        <p>All data is based on the battles we have stored and analyzed.</p>
        <p>
          Reading {sources.hot.available ? 'the local database' : 'no local database'}
          {sources.archive.available
            ? trends.archiveUsed
              ? ' plus the archive drive.'
              : ' — archive connected, not needed for this window.'
            : ' — archive drive not connected, showing the recent window only.'}
        </p>
      </footer>
    </div>
  );
}
