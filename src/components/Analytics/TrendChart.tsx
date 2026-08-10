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
 */

interface TrendChartProps {
  series: Series[];
  ticks: { at: number; label: string }[];
  /** y-axis tick values, top to bottom. */
  yTicks: number[];
  format: (v: number) => string;
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

export function TrendChart({ series, ticks, yTicks, format }: TrendChartProps) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const n = series[0]?.points.length ?? 0;
  if (n === 0) return null;

  const yMin = Math.min(...yTicks);
  const yMax = Math.max(...yTicks);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (n - 1)) * plotW;
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
          const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p)}`).join(' ');
          return (
            <g key={s.id ?? s.label} style={{ color: colorFor(si) }}>
              <path d={d} className={styles.line} />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p)} r={hover === i ? 3.6 : 2.1} className={styles.dot} />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Read-out for the hovered day. A line chart with this many series cannot
          be read from the marks alone. */}
      {hover !== null && (
        <div className={styles.readout} key={`${uid}-${hover}`}>
          <span className={styles.readoutDay}>Day {hover + 1}</span>
          {series.map((s, si) => (
            <span key={s.id ?? s.label} className={styles.readoutRow}>
              <span
                className={styles.readoutSwatch}
                style={{ background: colorFor(si) }}
                aria-hidden="true"
              />
              <span className={styles.readoutLabel}>{s.label}</span>
              <span className={styles.readoutValue}>{format(s.points[hover])}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend: identity is never colour alone — every entry carries its name. */
export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <ul className={styles.legend}>
      {series.map((s, si) => (
        <li key={s.id ?? s.label} className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ background: colorFor(si) }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
