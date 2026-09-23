import { useEffect, useId, useRef, useState } from 'react';

import type { CoachIntel, CoachTally } from '../../../state/analyticsClient';
import styles from './CoachRoster.module.css';

/**
 * The Overview's two charts — inline SVG and CSS, no charting library.
 *
 * WHY NOT `TrendChart`. It draws a continuous line through every point, which
 * is right for use rate and wrong for a DAILY WIN RATE: a day with no battles
 * has no win rate at all, and a day with one battle has a win rate of 0% or
 * 100% that means nothing. Joining those into a line would draw movement
 * that did not happen. So the win-rate line here is drawn only through days
 * with at least `MIN_DAY_BATTLES` battles, and BREAKS across the rest.
 *
 * THE VIEWBOX IS THE MEASURED WIDTH, not a constant. A fixed 640-wide viewBox
 * stretched into an 1,100px column scales everything by 1.7 — the axis type
 * came out at 17px and the chart 330px tall. Measuring keeps type and height
 * at their stated size at every width, phone included.
 */

/** Battles on a day before its win rate is plotted. */
export const MIN_DAY_BATTLES = 3;

const H = 190;
const PAD = { top: 12, right: 40, bottom: 24, left: 34 };

export function DailyChart({ timeline }: { timeline: CoachIntel['timeline'] }) {
  const uid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const n = timeline.length;
  const hasDays = n > 0;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDays]);
  if (n === 0) return <p className={styles.muted}>No battles in this window.</p>;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxB = Math.max(1, ...timeline.map((d) => d.battles));
  const slot = plotW / n;
  const bar = Math.max(1, Math.min(18, slot * 0.7));
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const yB = (b: number) => PAD.top + plotH - (b / maxB) * plotH;
  const yR = (r: number) => PAD.top + plotH - (r / 100) * plotH;

  /* The win-rate line as SEPARATE segments, broken wherever a day falls
     under the floor — never bridged. */
  const segments: string[] = [];
  let cur: string[] = [];
  timeline.forEach((d, i) => {
    if (d.battles >= MIN_DAY_BATTLES) {
      cur.push(`${x(i).toFixed(1)},${yR((d.wins / d.battles) * 100).toFixed(1)}`);
    } else if (cur.length) {
      segments.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) segments.push(cur.join(' '));

  const tickEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 64))));
  const h = hover !== null ? timeline[hover] : null;
  const floorY = PAD.top + plotH;

  /* The filled area under each segment, built from THE SAME points the line
     is drawn from — so the shading can never disagree with the line about
     where the rate was, and a break in the line is a break in the fill. */
  const areas = segments
    .filter((pts) => pts.includes(' '))
    .map((pts) => {
      const first = pts.split(' ')[0].split(',')[0];
      const last = pts.split(' ').slice(-1)[0].split(',')[0];
      return `${first},${floorY} ${pts} ${last},${floorY}`;
    });

  return (
    <div className={styles.chartWrap} ref={wrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-labelledby={`${uid}-t`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const i = Math.floor((px - PAD.left) / slot);
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        <title id={`${uid}-t`}>
          Battles per day, with the day’s win rate where at least {MIN_DAY_BATTLES} were played
        </title>
        {/* IDS ARE SCOPED PER INSTANCE. A literal id would be global, and two
            charts on one page would both resolve to whichever mounted last —
            the same fault the pagination's `layoutId` had. */}
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hue-blue)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--hue-blue)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hue-green)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--hue-green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line className={styles.gridLine} x1={PAD.left} x2={W - PAD.right} y1={yR(v)} y2={yR(v)} />
            <text className={styles.axisText} x={W - PAD.right + 6} y={yR(v) + 4}>
              {v}%
            </text>
          </g>
        ))}
        <text className={styles.axisText} x={PAD.left - 6} y={PAD.top + 8} textAnchor="end">
          {maxB}
        </text>
        {hover !== null && (
          <line
            className={styles.hoverGuide}
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={floorY}
          />
        )}
        {timeline.map((d, i) => (
          <rect
            key={d.day}
            className={styles.dayBar}
            data-on={hover === i || undefined}
            fill={`url(#${uid}-bar)`}
            /* A DAY WITH NO BATTLES DRAWS NOTHING. A rounded corner on a
               zero-height rect still paints, the same way a round line-cap on
               a zero-length ring does. */
            rx={d.battles > 0 ? Math.min(3, bar / 3) : 0}
            x={x(i) - bar / 2}
            y={yB(d.battles)}
            width={bar}
            height={Math.max(0, floorY - yB(d.battles))}
          />
        ))}
        {areas.map((pts, i) => (
          <polygon key={`a${i}`} className={styles.rateArea} fill={`url(#${uid}-area)`} points={pts} />
        ))}
        {segments.map((pts, i) =>
          pts.includes(' ') ? (
            <polyline key={i} className={styles.rateLine} points={pts} />
          ) : (
            <circle key={i} className={styles.rateDot} cx={pts.split(',')[0]} cy={pts.split(',')[1]} r={3} />
          ),
        )}
        {timeline.map((d, i) =>
          i % tickEvery === 0 ? (
            <text key={d.day} className={styles.axisText} x={x(i)} y={H - 6} textAnchor="middle">
              {d.day.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <div className={styles.chartLegend}>
        <span>
          <i className={styles.keyBar} /> battles per day
        </span>
        <span>
          <i className={styles.keyLine} /> win rate (days with {MIN_DAY_BATTLES}+ battles)
        </span>
        <span className={styles.chartReadout} aria-live="polite">
          {h
            ? `${h.day}: ${h.battles} battles · ${h.wins}W ${h.losses}L${h.draws ? ` ${h.draws}D` : ''}${
                h.battles >= MIN_DAY_BATTLES ? ` · ${((h.wins / h.battles) * 100).toFixed(0)}%` : ''
              }`
            : ' '}
        </span>
      </div>
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
