/**
 * THE PAGE-LEVEL QUALITY CHECK.
 *
 * NO IMPORTS beyond `geometry` and the `fit` types. It runs over a laid-out
 * plan — boxes with real coordinates and real measured heights — and reports
 * what is wrong with it, in time for the engine to reflow rather than after a
 * reader has opened the file.
 *
 * WHY THIS EXISTS AT ALL, given the packer already refuses to split an atom:
 * because every layout fault this project has actually shipped got past code
 * that was individually correct. The Duel Zone shipped with four layout faults
 * and a green test suite; the team dossier shipped with a 30 mm empty band at
 * the top of every spill page and passed a check that grepped the PDF for
 * strings. `tsc` says nothing about whether a page is readable, and neither
 * does a unit test on the packer, because the packer is not the only thing
 * that puts ink on a page.
 *
 * So this is a SECOND, INDEPENDENT reading of the result. It does not ask the
 * packer whether it did the right thing; it measures the boxes and says what
 * it finds. A check that shares its arithmetic with the thing it checks is not
 * a check.
 *
 * THE ONE THING IT CANNOT DO is see the page. It knows every box's rectangle,
 * so it catches overflow, overlap, orphans, empty sheets and starved images;
 * it cannot catch ugly. Rendering the pages and looking at them stays
 * necessary and is written into the verification notes rather than implied
 * away by a green audit.
 */

import { BODY_BOTTOM, BODY_TOP, CARD_MIN, FILL_MIN, FONT_MIN, MARGIN, PAGE_W } from './geometry';

/** A rectangle that was actually drawn, recorded as it was committed. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  /** Set on anything carrying type, so a starved font is reportable. */
  fontSize?: number;
  /** Set on card art, so a starved image is reportable. */
  imageW?: number;
  /** Boxes inside other boxes overlap legitimately; this says so. */
  nested?: boolean;
}

export interface AuditPage {
  index: number;
  boxes: Box[];
  /** How much of the body this page used, 0..1. */
  fill: number;
  /** True for the cover, the contents and a section divider — pages whose job
   *  is not to be full, and which must not be reported as underfilled. */
  exempt?: boolean;
  /** True for the last page of the document, which is allowed to end early. */
  last?: boolean;
}

export type Severity = 'error' | 'warn';

export interface Finding {
  page: number;
  rule: string;
  severity: Severity;
  detail: string;
  /** Set when the engine knows how to fix this one by re-laying it out. */
  reflow?: boolean;
}

/** Two rectangles sharing area. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const EPS = 0.35;

/**
 * Run every rule over one page.
 *
 * Ordered by how badly each fault reads, because the engine acts on the first
 * `reflow` finding it gets and the worst thing on a page should be the thing
 * it fixes.
 */
export function auditPage(page: AuditPage): Finding[] {
  const out: Finding[] = [];
  const at = (rule: string, severity: Severity, detail: string, reflow = false) =>
    out.push({ page: page.index, rule, severity, detail, reflow });

  const content = page.boxes.filter((b) => !b.nested);

  /* CLIPPED / OVERFLOWING. A box past the body floor is ink in the footer, or
     off the sheet entirely. This is the fault that makes a reader think the
     file is corrupt. */
  for (const b of page.boxes) {
    if (b.y + b.h > BODY_BOTTOM + EPS) {
      at('overflow-bottom', 'error',
        `${b.kind} ends at ${(b.y + b.h).toFixed(1)}mm, past the body floor at ${BODY_BOTTOM}`,
        true);
    }
    if (b.y < BODY_TOP - EPS && !page.exempt) {
      at('overflow-top', 'error',
        `${b.kind} starts at ${b.y.toFixed(1)}mm, above the body top at ${BODY_TOP}`);
    }
    if (b.x < MARGIN - EPS || b.x + b.w > PAGE_W - MARGIN + EPS) {
      at('overflow-side', 'error',
        `${b.kind} runs from ${b.x.toFixed(1)} to ${(b.x + b.w).toFixed(1)}mm, outside the margins`);
    }
  }

  /* OVERLAP. Nested boxes are excluded by their own flag; anything left that
     intersects is two components drawn on top of each other, which is what a
     row sized by its padding rather than by its art produces. */
  for (let i = 0; i < content.length; i += 1) {
    for (let j = i + 1; j < content.length; j += 1) {
      if (overlaps(content[i], content[j])) {
        at('overlap', 'error',
          `${content[i].kind} and ${content[j].kind} overlap`, true);
      }
    }
  }

  /* AN ORPHANED HEADING. A heading that is the last thing on a page is a
     heading for something the reader cannot see. */
  const ordered = [...content].sort((a, b) => a.y - b.y);
  const last = ordered[ordered.length - 1];
  if (last && /heading|title|context|columns/.test(last.kind) && !page.exempt) {
    at('orphan-heading', 'error',
      `page ends on ${last.kind} with nothing under it`, true);
  }

  /* STARVED TYPE AND STARVED ART. Both are the engine having optimised past
     the floors in `geometry`, which should be impossible — so these are
     assertions that the floors were honoured, not suggestions. */
  for (const b of page.boxes) {
    if (b.fontSize !== undefined && b.fontSize < FONT_MIN) {
      at('type-too-small', 'error',
        `${b.kind} is set at ${b.fontSize}pt, under the ${FONT_MIN}pt floor`);
    }
    if (b.imageW !== undefined && b.imageW < CARD_MIN) {
      at('art-too-small', 'error',
        `${b.kind} art is ${b.imageW.toFixed(1)}mm wide, under the ${CARD_MIN}mm floor`,
        true);
    }
  }

  /* A BLANK PAGE. Always a fault: it is a page opened before anything needed
     to be on it, which this renderer has produced before — page 3 of every
     dossier was a header and a footer for a while. */
  if (content.length === 0 && !page.exempt) {
    at('blank-page', 'error', 'page carries no content', true);
  }

  /* HALF EMPTY. Not an error — a section that ends is allowed to leave room,
     and the last page always does. It is reported so the engine can try a
     denser variant, and so a person reading the audit can tell the difference
     between a page that ended and a page that gave up. */
  if (!page.exempt && !page.last && content.length > 0 && page.fill < FILL_MIN) {
    at('underfilled', 'warn',
      `page is ${(page.fill * 100).toFixed(0)}% full, under the ${FILL_MIN * 100}% floor`,
      true);
  }

  return out;
}

export interface AuditResult {
  findings: Finding[];
  errors: number;
  warnings: number;
  /** True when nothing here can be fixed by laying the section out again — so
   *  the engine stops retrying and the caller is told what it shipped. */
  clean: boolean;
}

export function auditDocument(pages: AuditPage[]): AuditResult {
  const findings = pages.flatMap(auditPage);
  const errors = findings.filter((f) => f.severity === 'error').length;
  return {
    findings,
    errors,
    warnings: findings.length - errors,
    clean: findings.length === 0,
  };
}

/**
 * A one-line summary for the console, and the thing to paste into a commit.
 *
 * It prints the COUNT of clean pages too, not only the faults — an audit that
 * only ever speaks when something is wrong is one nobody can tell is running.
 */
export function auditSummary(pages: AuditPage[], result: AuditResult): string {
  if (result.clean) return `layout audit: ${pages.length} pages, clean`;
  const worst = result.findings
    .slice(0, 6)
    .map((f) => `p${f.page}: ${f.rule} (${f.detail})`)
    .join('; ');
  return `layout audit: ${pages.length} pages, ${result.errors} errors, `
    + `${result.warnings} warnings — ${worst}`;
}

/** Does this result justify laying the document out again? */
export function shouldReflow(result: AuditResult): boolean {
  return result.findings.some((f) => f.reflow);
}
