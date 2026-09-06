/**
 * THE ANALYTICS RENDERER — now a seam, and a lazy one.
 *
 * The 1,962-line greedy renderer that used to live here has been replaced by
 * the measure-then-commit pipeline in `report/`. This file survives as the
 * import path, because `ReportButton` already points at it and a rename that
 * moves code between two directories buys nothing.
 *
 * WHAT MOVED, AND WHERE TO LOOK:
 *
 *   report/geometry.ts   page geometry, the five-level type scale, and the
 *                        legibility floors. No imports.
 *   report/fit.ts        the decision layer: grid solving, row balancing, atom
 *                        packing, variant scoring. No imports but geometry, so
 *                        it is testable without a renderer.
 *   report/audit.ts      the page-level quality check, read independently off
 *                        the committed boxes.
 *   report/palette.ts    colour, read off the live page. Was here.
 *   report/paint.ts      drawing primitives. No decisions in any of them.
 *   report/sections.ts   the components, each measuring itself and offering
 *                        the compositions its data supports.
 *   report/art.ts        card tiles, downscaled once. Was here.
 *   report/engine.ts     the pipeline that runs them in order.
 *
 * THE IMPORT IS DYNAMIC, AND IT PAYS FOR ITSELF TWICE OVER. Nothing here runs
 * until somebody presses Export, so none of it belongs in the bundle every
 * reader downloads — the same arrangement `teamReport.ts` already uses, and
 * for the same reason it is an `import()` inside a function rather than
 * `React.lazy`: a dynamic import in an event handler never touches Suspense,
 * so it is unaffected by the render-loop trap recorded in the README.
 *
 * MEASURED, baseline taken by stashing and rebuilding rather than assumed:
 * main bundle 346.07 kB gzip at HEAD, 352.00 with the engine eager, and
 * 346.07 with it lazy. The engine lands in its own chunk beside jspdf's
 * 390 kB, which is only ever fetched by the same click.
 *
 * The old implementation is in git rather than commented out here; what was
 * worth keeping from its comments has been carried into the module that now
 * owns each decision, which is where somebody changing that decision will
 * actually be standing.
 */

import type { ReportDoc } from './analyticsReport';
import type { RenderResult } from './report/engine';

export type { RenderResult };
export type { Palette } from './report/palette';

/**
 * Draw a report and hand back the blob, the layout audit and the page count.
 *
 * The audit travels WITH the result rather than being logged and dropped: it
 * runs on every export in production, and a caller that wants to know whether
 * the document it just produced is well formed should not have to re-derive
 * that from the PDF.
 */
export async function renderReport(model: ReportDoc): Promise<RenderResult> {
  const { renderReport: run } = await import('./report/engine');
  return run(model);
}

export async function renderAnalyticsReport(model: ReportDoc): Promise<Blob> {
  const { renderAnalyticsReport: run } = await import('./report/engine');
  return run(model);
}

export async function downloadAnalyticsReport(model: ReportDoc): Promise<void> {
  const { downloadAnalyticsReport: run } = await import('./report/engine');
  return run(model);
}

/** The live palette, for anything that wants to draw in the report's colours.
 *  Async only because the module it lives in is fetched on demand. */
export async function readPalette() {
  const { readPalette: run } = await import('./report/palette');
  return run();
}
