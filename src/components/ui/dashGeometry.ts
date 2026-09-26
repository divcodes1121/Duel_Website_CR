/**
 * THE DASHBOARD KIT'S ARITHMETIC — no imports, so every decision about where
 * a mark or a tooltip lands is testable without React, a DOM or a browser
 * (the `tiers.ts` / `squadParse.ts` rule, applied to drawing).
 */

export interface SparkPoint {
  i: number;
  x: number;
  y: number;
  value: number;
}

export interface SparkGeometry {
  /** One polyline per unbroken run. A run of ONE point is a dot, not a line. */
  runs: SparkPoint[][];
  /** Every drawn point, in order — what the hover snaps to. */
  points: SparkPoint[];
  /** The floor of the plot, in the same units, for the area under each run. */
  floorY: number;
  /** x of every index, drawn or not, so a gap can still be hovered. */
  xs: number[];
}

/**
 * Lays a series out in a `w` x `h` box.
 *
 * **A NULL IS A GAP, NEVER A ZERO.** A day with too few battles has no win
 * rate at all, and joining across it draws movement that did not happen —
 * the rule `DailyChart` already follows. So nulls split the series into runs
 * and nothing bridges them.
 *
 * The scale is the series' own range unless `min`/`max` pin it. A pinned scale
 * is right for a rate (0..100 means the same thing on every card); the series'
 * own range is right for a count, where the shape is the point.
 */
export function sparkGeometry(
  values: readonly (number | null)[],
  w: number,
  h: number,
  opts: { pad?: number; min?: number; max?: number } = {},
): SparkGeometry {
  const pad = opts.pad ?? 3;
  const n = values.length;
  const real = values.filter((v): v is number => v != null && Number.isFinite(v));
  const lo = opts.min ?? (real.length ? Math.min(...real) : 0);
  const hiRaw = opts.max ?? (real.length ? Math.max(...real) : 1);
  /* A flat series would divide by zero; give it a span so it draws as a level
     line through the middle rather than as NaN. */
  const hi = hiRaw === lo ? lo + 1 : hiRaw;
  const flat = hiRaw === lo;
  const floorY = h - pad;
  const xs = values.map((_, i) => (n <= 1 ? w / 2 : pad + ((w - pad * 2) * i) / (n - 1)));
  const y = (v: number) => {
    if (flat) return h / 2;
    const t = (v - lo) / (hi - lo);
    return floorY - Math.max(0, Math.min(1, t)) * (h - pad * 2);
  };

  const runs: SparkPoint[][] = [];
  const points: SparkPoint[] = [];
  let cur: SparkPoint[] = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (cur.length) runs.push(cur);
      cur = [];
      return;
    }
    const p = { i, x: xs[i], y: y(v), value: v };
    cur.push(p);
    points.push(p);
  });
  if (cur.length) runs.push(cur);
  return { runs, points, floorY, xs };
}

export const pointsAttr = (run: readonly SparkPoint[]) =>
  run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** The area under one run, closed on the plot's floor. Built from THE SAME
 *  points as the line, so the shading can never disagree with it. */
export const areaAttr = (run: readonly SparkPoint[], floorY: number) =>
  run.length < 2
    ? ''
    : `${run[0].x.toFixed(1)},${floorY} ${pointsAttr(run)} ${run[run.length - 1].x.toFixed(1)},${floorY}`;

/** The index under a pointer at `px`, snapping to the nearest column —
 *  including a gap, so hovering a day with no rate can still say why. */
export function nearestIndex(px: number, xs: readonly number[]): number | null {
  if (!xs.length) return null;
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
  return best;
}

/**
 * Where a tooltip's LEFT edge goes so the whole of it stays inside its box.
 *
 * Centred on the anchor when there is room; pinned to whichever edge it would
 * otherwise cross. A tooltip wider than the box is pinned left — clipping its
 * end is better than clipping its title.
 */
export function clampTip(anchorX: number, tipW: number, boxW: number, margin = 4): number {
  const ideal = anchorX - tipW / 2;
  const max = boxW - margin - tipW;
  if (max < margin) return margin;
  return Math.max(margin, Math.min(max, ideal));
}

/** Whether a tooltip anchored at `anchorY` fits ABOVE the anchor; if not it
 *  hangs below, where the box has room. */
export const tipAbove = (anchorY: number, tipH: number, gap = 10) => anchorY - tipH - gap >= 0;

/**
 * The gauge: an arc from `-sweep/2` to `+sweep/2` degrees about twelve
 * o'clock. Returned as a path plus its length so a caller can dash it.
 */
export function gaugeArc(cx: number, cy: number, r: number, sweep = 180) {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const a0 = rad(-sweep / 2);
  const a1 = rad(sweep / 2);
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = sweep > 180 ? 1 : 0;
  return {
    d: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    length: (Math.PI * r * sweep) / 180,
  };
}

/** A share in 0..1, safe against a zero or negative maximum. */
export const shareOf = (value: number, max: number) => Math.max(0, Math.min(1, value / (max > 0 ? max : 1)));
