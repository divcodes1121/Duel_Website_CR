import { useState } from 'react';
import { getCardIconUrl } from '../../data/cards';
import { ChartLegend, TrendChart } from './TrendChart';
import {
  DECK_SORTS,
  RANGES,
  SAMPLE_DECKS,
  SAMPLE_PLAYER,
  SAMPLE_USE_TREND,
  SAMPLE_WIN_TREND,
  type DeckSort,
  type Series,
  type TrendData,
} from './playerData';
import styles from './PlayerAnalysis.module.css';

/* Player analysis — the screen the Analyze button lands on.
 *
 * Structure only: every figure below comes from the placeholder set in
 * playerData.ts. Wiring the SQLite import means replacing that module's
 * SAMPLE_* exports; nothing in this file changes. */

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

export function PlayerAnalysis({ tag }: { tag: string }) {
  const [sort, setSort] = useState<DeckSort>('top');
  const player = { ...SAMPLE_PLAYER, tag: tag || SAMPLE_PLAYER.tag };

  const decks = [...SAMPLE_DECKS].sort((a, b) =>
    sort === 'winrate' ? b.winRate - a.winRate : sort === 'recent' ? b.matches - a.matches : a.rank - b.rank,
  );

  return (
    <div className={styles.page}>
      {/* --- player summary --- */}
      <section className={styles.summary}>
        <div className={styles.identity}>
          <span className={styles.badge}>
            <CrownIcon size={22} />
          </span>
          <div className={styles.identityText}>
            <h1 className={styles.playerName}>
              {player.name}
              {player.verified && (
                <span className={styles.verified}>
                  <VerifiedIcon />
                </span>
              )}
            </h1>
            <span className={styles.playerTag}>{player.tag}</span>
          </div>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.trophy}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>{nf.format(player.trophies)}</span>
            <span className={styles.statLabel}>Trophies</span>
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.swords}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>{nf.format(player.battlesAnalyzed)}</span>
            <span className={styles.statLabel}>Battles Analyzed</span>
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.calendar}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>
              {player.rangeStart} – {player.rangeEnd}
            </span>
            <span className={styles.statLabel}>Data Range ({player.rangeDays} Days)</span>
          </span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statIcon}>{ICONS.rank}</span>
          <span className={styles.statText}>
            <span className={styles.statValue}>Top {nf.format(player.globalRank)}</span>
            <span className={styles.statLabel}>Global Rank</span>
          </span>
        </div>
      </section>

      {/* --- top 10 decks --- */}
      <section className={styles.decksPanel}>
        <header className={styles.decksHead}>
          <h2 className={styles.decksTitle}>
            <span className={styles.decksTitleIcon}>
              <CrownIcon size={17} />
            </span>
            Top 10 Decks
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
                  Trend (30d) <span className={styles.thInfo}>{ICONS.info}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {decks.map((d) => (
                <tr key={d.name}>
                  <td>
                    <span className={styles.rank} data-medal={d.rank <= 3 ? d.rank : undefined}>
                      {d.rank}
                    </span>
                  </td>
                  <td className={styles.deckName}>{d.name}</td>
                  <td>
                    <span className={styles.cards}>
                      {d.cards.map((c) => (
                        <img
                          key={c}
                          src={getCardIconUrl(c)}
                          alt=""
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
                        style={{ width: `${Math.min(100, d.useRate * 4)}%` }}
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
                  <td className={styles.num}>{d.matches}</td>
                  <td className={styles.num}>{d.wins}</td>
                  <td className={styles.num}>{d.losses}</td>
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

      {/* --- trends. Two charts, not one with two y-scales. --- */}
      <div className={styles.charts}>
        <TrendPanel title="Use Rate Trend" data={SAMPLE_USE_TREND} yTicks={[0, 5, 10, 15, 20, 25]} />
        <TrendPanel title="Win Rate Trend" data={SAMPLE_WIN_TREND} yTicks={[40, 50, 60, 70, 80]} />
      </div>

      <footer className={styles.foot}>
        <p>All data is based on the battles we have stored and analyzed.</p>
        <p>Data refreshes every 24 hours.</p>
      </footer>
    </div>
  );
}
