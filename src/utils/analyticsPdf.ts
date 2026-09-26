/**
 * THE REPORT ENGINE'S FRONT DOOR — a lazy seam.
 *
 * Every PDF the site produces is drawn by `report/`: the analytics screens,
 * the Team Analysis dossier, the full player report and the builder's deck
 * report alike. Nothing here runs until somebody presses Export, so none of it
 * belongs in the bundle every reader downloads; the engine and jsPDF are one
 * chunk fetched by that click. It is an `import()` inside a function rather
 * than `React.lazy`, because a dynamic import in an event handler never
 * touches Suspense (see the render-loop note in the README).
 *
 *   report/geometry.ts  page geometry, the type scale, the legibility floors
 *   report/theme.ts     the fixed Deckkies dark palette (not read off the page)
 *   report/text.ts      strings filtered to the glyphs the fonts really hold
 *   report/fonts.ts     Inter + Bebas Neue, fetched once, embedded subset
 *   report/art.ts       every raster, baked opaque (cards, plates, cover, logo)
 *   report/surface.ts   drawing primitives — no transparency, ever
 *   report/blocks.ts    each block kind measured into atoms
 *   report/pack.ts      pagination, pure
 *   report/audit.ts     the page check, read off what was committed
 *   report/engine.ts    the pipeline
 */

import type { ReportDoc } from './analyticsReport';
import type { RenderResult } from './report/engine';

export type { RenderResult };

/** Draw a report: the blob, the audit, the page count and how long it took. */
export async function renderReport(model: ReportDoc): Promise<RenderResult> {
  const { renderReport: run } = await import('./report/engine');
  return run(model);
}

export async function renderAnalyticsReport(model: ReportDoc): Promise<Blob> {
  const { renderAnalyticsReport: run } = await import('./report/engine');
  return run(model);
}

export async function downloadAnalyticsReport(model: ReportDoc): Promise<RenderResult> {
  const { downloadAnalyticsReport: run } = await import('./report/engine');
  return run(model);
}
