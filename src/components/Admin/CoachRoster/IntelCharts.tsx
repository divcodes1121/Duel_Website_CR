import { useId } from 'react';

import type { CoachIntel, CoachTally } from '../../../state/analyticsClient';
import { shortDay } from '../../../state/trackingSources';
import { StackedColumns, TrendChart } from '../../ui/bionis-dashboard';
import styles from './CoachRoster.module.css';

/**
 * The Overview's day chart — TWO charts, one above the other, on Recharts.
 *
 * WHY TWO. It used to be battles as bars and the win rate as a line in ONE
 * plot, on two different scales (a count on the left, a percentage on the
 * right). A dual axis lets the reader compare the heights of two things that
 * are not in the same units, and the dataviz rule is flat about it: two
 * measures, two charts. They share their days and their crosshair (`syncId`),
 * so hovering a day in either shows that day in both.
 *
 * THE WIN RATE IS STILL A GAP ON A THIN DAY. A day with no battles has no win
 * rate, and a day with one has a rate of 0% or 100% that means nothing, so the
 * line is drawn only through days with at least `MIN_DAY_BATTLES` battles and
 * BREAKS across the rest — never bridged, never a zero. The tooltip says which
 * of the two a gap is. The stat card's sparkline reads the same series with
 * the same floor, so the card and the chart cannot disagree about a day.
 *
 * The battles are stacked by RESULT — wins, losses, draws — so a day's volume
 * and its outcome are one mark; the line below is that same split as a rate,
 * against the player's own rate over the window.
 */

/** Battles on a day before its win rate is plotted. */
export const MIN_DAY_BATTLES = 3;

export function DailyChart({ timeline }: { timeline: CoachIntel['timeline'] }) {
  const syncId = useId();
  if (timeline.length === 0) return <p className={styles.muted}>No battles in this window.</p>;

  const rows = timeline.map((d) => ({
    x: d.day,
    wins: d.wins,
    losses: d.losses,
    draws: d.draws,
    battles: d.battles,
    rate: d.battles >= MIN_DAY_BATTLES ? (d.wins / d.battles) * 100 : null,
  }));
  const played = timeline.reduce((n, d) => n + d.battles, 0);
  const won = timeline.reduce((n, d) => n + d.wins, 0);
  const overall = played > 0 ? (won / played) * 100 : null;
  const anyRate = rows.some((r) => r.rate != null);

  return (
    <div className={styles.dayCharts}>
      <p className={styles.dayChartLabel}>Battles per day</p>
      <StackedColumns
        data={rows}
        series={[
          { key: 'wins', label: 'Wins', color: 'var(--hue-green)' },
          { key: 'losses', label: 'Losses', color: 'var(--hue-red)' },
          { key: 'draws', label: 'Draws', color: 'var(--chart-other)' },
        ]}
        xFormat={shortDay}
        tipTitle={shortDay}
        totalLabel="Battles"
        syncId={syncId}
        height={180}
        label="Battles per day, by result"
      />
      <p className={styles.dayChartLabel}>Win rate · days with {MIN_DAY_BATTLES}+ battles</p>
      {anyRate ? (
        <TrendChart
          data={rows}
          series={[{ key: 'rate', label: 'Win rate', color: 'var(--chart-1)', format: (v) => `${v.toFixed(0)}%` }]}
          yDomain={[0, 100]}
          yFormat={(v) => `${v}%`}
          xFormat={shortDay}
          tipTitle={shortDay}
          tipLines={(row) =>
            row.rate == null
              ? [Number(row.battles) > 0 ? `Under ${MIN_DAY_BATTLES} battles — no rate drawn` : 'No battles this day']
              : [`${row.wins}W ${row.losses}L${Number(row.draws) ? ` ${row.draws}D` : ''}`]
          }
          reference={overall != null ? { y: Math.round(overall * 10) / 10, label: `window ${overall.toFixed(1)}%` } : undefined}
          syncId={syncId}
          height={160}
          label={`Win rate per day, on days with ${MIN_DAY_BATTLES} or more battles`}
        />
      ) : (
        <p className={styles.muted}>No day in this window has {MIN_DAY_BATTLES} battles, so no daily rate is drawn.</p>
      )}
    </div>
  );
}

/** A labelled share list: each row's share of the battles, with its record
 *  and — past a floor — its win rate. */
export function ShareBars({
  rows,
  total,
  limit = 6,
  rateFloor = 5,
}: {
  rows: (CoachTally & { key: string; name: string })[];
  total: number;
  limit?: number;
  rateFloor?: number;
}) {
  if (!rows.length) return <p className={styles.muted}>Nothing in this window.</p>;
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((n, r) => n + r.battles, 0);
  return (
    <ul className={styles.shareList}>
      {shown.map((r) => {
        const share = total ? (r.battles / total) * 100 : 0;
        return (
          <li key={r.key} className={styles.shareRow}>
            <span className={styles.shareName}>{r.name}</span>
            <span className={styles.shareTrack}>
              {/* CLAMPED. A share cannot exceed the whole, and a caller that
                  passes a total from a different count would otherwise lay out
                  a fill wider than its track — clipped on screen, so it would
                  never be noticed, and wrong. */}
              <span className={styles.shareFill} style={{ width: `${Math.min(100, share)}%` }} />
            </span>
            <span className={styles.shareFigure}>{share.toFixed(0)}%</span>
            <span className={styles.shareNote}>
              {r.battles} · {r.battles >= rateFloor ? `${((r.wins / r.battles) * 100).toFixed(0)}% won` : 'too few to rate'}
            </span>
          </li>
        );
      })}
      {rest > 0 && <li className={styles.shareRest}>+ {rest} battles in {rows.length - limit} more</li>}
    </ul>
  );
}

/** The last ten results as a row of chips, newest on the left. */
export function FormStrip({ form }: { form: string[] }) {
  if (!form.length) return null;
  return (
    <div className={styles.form} aria-label={`Last ${form.length} results, newest first`}>
      {form.map((r, i) => (
        <span key={i} className={styles.formChip} data-r={r} title={r}>
          {r === 'win' ? 'W' : r === 'loss' ? 'L' : 'D'}
        </span>
      ))}
    </div>
  );
}
