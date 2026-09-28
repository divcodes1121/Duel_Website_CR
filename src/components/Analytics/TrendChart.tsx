import { useId, useState } from 'react';
import type { Series } from './playerData';
import styles from './PlayerAnalysis.module.css';

/**
 * Multi-series line chart, inline SVG — no charting dependency.
 *
 * Series colour is the one place colour is functional rather than decorative,
 * so it does not come from the neutral UI palette. The eight hues are the
 * validated categorical set (see PlayerAnalysis.module.css), assigned in fixed
 * order and never cycled: a ninth series would not be distinguishable, so the
 * caller folds the tail into a single muted "Other" line instead.
 *
 * A `null` point is a GAP, not a zero: the line lifts there and no dot is
 * drawn. See `utils/trendSeries.ts` for why a day the deck was not played
 * cannot be plotted as a 0% win rate.
 *
 * EIGHT LINES ARE READ ONE AT A TIME. `focus` names the series to emphasise and
 * every other one drops to a faint trace — the legend drives it, and so does
 * hovering a line itself. Opacity only, so it is one compositor change and it
 * never moves anything.
 */

interface TrendChartProps {
  series: Series[];
  ticks: { at: number; label: string }[];
  /** y-axis tick values, top to bottom. */
  yTicks: number[];
  format: (v: number) => string;
  /** One label per point for the hover read-out ('14 Sept'). Falls back to
   *  "Day n" when absent. */
  labels?: string[];
  /** What a gap means, in the read-out. */
  gapLabel?: string;
  /** Index of the emphasised series; the rest dim. */
  focus?: number | null;
  /** Hovering a line reports it, so the legend and the line agree. */
  onSeriesHover?: (index: number | null) => void;
  /** Clicking a line pins it. */
  onSeriesPick?: (index: number) => void;
}

/* Eight validated slots, then stop. A ninth series does not get a generated or
   recycled hue — cycling back to slot 1 would put two identical blues on the
   same chart. Anything past the eighth is the caller's folded "Other" line and
   is drawn in muted ink instead. */
const SLOTS = 8;
const colorFor = (i: number) => (i < SLOTS ? `var(--series-${i + 1})` : 'var(--text-muted)');

const W = 620;
const H = 210;
const PAD = { top: 10, right: 12, bottom: 26, left: 40 };

/** SVG path for a series, lifting the pen at every gap. */
function pathOf(points: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p === null || !Number.isFinite(p)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function TrendChart({
  series,
  ticks,
  yTicks,
  format,
  labels,
  gapLabel = 'no games',
  focus = null,
  onSeriesHover,
  onSeriesPick,
}: TrendChartProps) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const n = series[0]?.points.length ?? 0;
  if (n === 0) return null;

  const yMin = Math.min(...yTicks);
  const yMax = Math.max(...yTicks);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.left) / plotW) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  }

  return (
    <div className={styles.chartWrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-label={`Trend for ${series.length} decks`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive grid: horizontal rules only, the axis values carry the rest. */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={styles.grid} />
            <text x={PAD.left - 8} y={y(v) + 3.5} className={styles.axisText} textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}

        {ticks.map((t) => (
          <text key={t.at} x={x(t.at)} y={H - 8} className={styles.axisText} textAnchor="middle">
            {t.label}
          </text>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            className={styles.crosshair}
          />
        )}

        {series.map((s, si) => {
          const d = pathOf(s.points, x, y);
          const dim = focus !== null && focus !== si;
          return (
            <g
              key={s.id ?? s.label}
              style={{ color: colorFor(si) }}
              className={`${styles.series} ${dim ? styles.seriesDim : ''}`}
            >
              <path d={d} className={styles.line} />
              {s.points.map((p, i) =>
                p === null || !Number.isFinite(p) ? null : (
                  <circle key={i} cx={x(i)} cy={y(p)} r={hover === i ? 3.6 : 2.1} className={styles.dot} />
                ),
              )}
              {/* A wide transparent stroke over the line, so a 2px line can be
                  pointed at. Only when something is listening. */}
              {onSeriesHover && d && (
                <path
                  d={d}
                  className={styles.lineHit}
                  onMouseEnter={() => onSeriesHover(si)}
                  onMouseLeave={() => onSeriesHover(null)}
                  onClick={() => onSeriesPick?.(si)}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Read-out for the hovered day. A line chart with this many series cannot
          be read from the marks alone. */}
      {hover !== null && (
        <div className={styles.readout} key={`${uid}-${hover}`}>
          <span className={styles.readoutDay}>{labels?.[hover] ?? `Day ${hover + 1}`}</span>
          {series.map((s, si) => {
            const v = s.points[hover];
            const gap = v === null || !Number.isFinite(v);
            return (
              <span
                key={s.id ?? s.label}
                className={styles.readoutRow}
                data-focus={focus === si ? '' : undefined}
              >
                <span
                  className={styles.readoutSwatch}
                  style={{ background: colorFor(si) }}
                  aria-hidden="true"
                />
                <span className={styles.readoutLabel}>{s.label}</span>
                <span className={styles.readoutValue} data-gap={gap ? '' : undefined}>
                  {gap ? gapLabel : format(v as number)}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Legend: identity is never colour alone — every entry carries its name.
 *
 * With `onPin` it is also the chart's control: hovering or focusing an entry
 * isolates that line, and pressing it keeps it isolated until pressed again.
 * `aria-pressed` says which one is held.
 */
export function ChartLegend({
  series,
  focus = null,
  pinned = null,
  onHover,
  onPin,
}: {
  series: Series[];
  focus?: number | null;
  pinned?: number | null;
  onHover?: (index: number | null) => void;
  onPin?: (index: number) => void;
}) {
  return (
    <ul className={styles.legend}>
      {series.map((s, si) => {
        const swatch = (
          <span
            className={styles.legendDot}
            style={{ background: colorFor(si) }}
            aria-hidden="true"
          />
        );
        if (!onPin) {
          return (
            <li key={s.id ?? s.label} className={styles.legendItem}>
              {swatch}
              {s.label}
            </li>
          );
        }
        return (
          <li key={s.id ?? s.label}>
            <button
              type="button"
              className={styles.legendButton}
              aria-pressed={pinned === si}
              data-focus={focus === si ? '' : undefined}
              onMouseEnter={() => onHover?.(si)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(si)}
              onBlur={() => onHover?.(null)}
              onClick={() => onPin(si)}
            >
              {swatch}
              {s.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
