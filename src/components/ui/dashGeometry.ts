/**
 * THE DASHBOARD KIT'S ARITHMETIC — no imports, so every decision about where
 * a mark or a tooltip lands is testable without React, a DOM or a browser
 * (the `tiers.ts` / `squadParse.ts` rule, applied to drawing).
 */

/* THE SPARKLINE'S GEOMETRY LEFT WITH IT (2026-09-26). `sparkGeometry`,
   `pointsAttr`, `areaAttr` and `nearestIndex` laid out and hit-tested the
   hand-drawn sparkline; the kit's charts are Recharts now (`dash-charts.tsx`)
   and nothing called them. The rule they pinned — a null is a gap, never a
   zero, and nothing bridges it — is `connectNulls={false}` on every line and
   area there, and `tests/dashCharts.test.ts` sweeps for it. */

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
