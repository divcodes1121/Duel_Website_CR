/**
 * PAGE GEOMETRY, THE TYPE SCALE, AND THE LEGIBILITY FLOORS.
 *
 * NO IMPORTS, deliberately — the same rule `tiers.ts`, `format.ts`,
 * `passwordRules.ts`, `squadParse.ts` and `releases.ts` follow. Everything in
 * here is a number that decides what a page looks like, which makes it the
 * half most worth testing exhaustively, and a module that imports jsPDF cannot
 * be imported by a test without constructing a renderer.
 *
 * THE FLOORS ARE THE POINT OF THIS FILE. A layout engine that may choose its
 * own density will always find that one more column fits, because arithmetic
 * has no opinion about whether a 9 mm card is still a card. The floors are
 * where that opinion is written down, once, so that every component inherits
 * the same answer and no single component can quietly decide it is the
 * exception.
 */

/* ------------------------------------------------------------------- page */

/** A4 landscape, in millimetres. Matches the deck report and the team dossier
 *  so the three exports read as one product. */
export const PAGE_W = 297;
export const PAGE_H = 210;

/** The outer panel inset — the frame the whole document is drawn inside. */
export const FRAME = 6;

export const MARGIN = 14;
export const CONTENT_W = PAGE_W - MARGIN * 2;

/** Where a body page's content starts, under the section bar. */
export const BODY_TOP = 34;
export const FOOTER_Y = PAGE_H - 10;
/** The last millimetre a block may occupy. */
export const BODY_BOTTOM = FOOTER_Y - 8;
export const BODY_H = BODY_BOTTOM - BODY_TOP;

/**
 * The room a block actually has on a SPILL page, which is less than the body.
 *
 * A continued block repeats its heading as "(continued)", so solving a row
 * pitch against `BODY_H` produces a layout that fits the first page of a
 * section and no other. That mistake has already been made and measured here:
 * a four-row pairs grid solved against the bare body came to 154 mm, cleared
 * `BODY_H`, and fitted four rows on ZERO of six real pages.
 */
export const CONTINUED_H = 7;
export const SPILL_H = BODY_H - CONTINUED_H;

/** The insight bar at the foot of a section, and the gap above it. */
export const READ_H = 16;
export const READ_GAP = 4;

/* ------------------------------------------------------------- type scale */

/**
 * FIVE LEVELS, AND NOTHING BETWEEN THEM.
 *
 * Hierarchy comes from contrast, not from size alone — so the levels are far
 * apart and there is no sixth. A renderer that may pick any point size between
 * 6 and 34 produces a document where every page has slightly different
 * headings, which reads as carelessness rather than as emphasis.
 */
export const TYPE = {
  /** L1 — the section title. Uppercase, tracked, display cut. */
  title: { size: 17, track: 1.1 },
  /** L1b — a block heading inside a section. */
  heading: { size: 9, track: 0.5 },
  /** L2 — the context line: window, counts, filters, what is ranked by what. */
  context: { size: 6.4, track: 0.55 },
  /** L2b — the small uppercase label over a figure or beside a module. */
  label: { size: 5.8, track: 0.6 },
  /** L3 — a primary metric. The only text allowed to be large. */
  metric: { size: 30, track: 0 },
  /** L3b — a metric inside a module rather than a hero slot. */
  metricSmall: { size: 15, track: 0 },
  /** L4 — supporting data: names, counts, percentages in a row. */
  body: { size: 7.4, track: 0 },
  bodySmall: { size: 6.2, track: 0 },
  /** L5 — the insight sentence. */
  read: { size: 10.5, track: 0 },
  /** Page furniture. */
  footer: { size: 6, track: 0.5 },
} as const;

/** Millimetres per point, for turning a font size into a line box. */
export const PT = 0.3528;

/** The height one line of `size` occupies, including its leading. */
export function lineH(size: number, leading = 1.32): number {
  return size * PT * leading;
}

/* --------------------------------------------------------------- spacing */

/**
 * ONE SPACING LADDER. Every gap in the document is one of these, so the
 * rhythm survives a component being added by someone who never read this file.
 */
export const SPACE = {
  hair: 1.2,
  tight: 2.4,
  snug: 3.6,
  base: 5,
  wide: 8,
  section: 12,
} as const;

/* ------------------------------------------------------------------- art */

/** Clash Royale card art. Every card tile is drawn to this, never stretched. */
export const CARD_RATIO = 302 / 363;

/**
 * THE LEGIBILITY FLOORS — the numbers that stop the engine optimising a page
 * into something nobody can read.
 *
 * `CARD_MIN` is the width below which a reader cannot name the card from
 * across a table, which is what these reports get used for. It is measured
 * against what already ships: the series log draws 8.5 mm and that was
 * accepted, the pair board draws 16.2 mm. So 8 mm is the floor and anything
 * that wants to go under it must paginate instead.
 *
 * `CARD_IDEAL` is what a component gets when there is room, so that having
 * space does not silently produce enormous art — the SaaS failure the brief
 * names. A component asks for `IDEAL`, accepts down to `MIN`, and the engine
 * paginates rather than going below.
 */
export const CARD_MIN = 8;
export const CARD_IDEAL = 15;
export const CARD_MAX = 22;

/** Below this a font is decoration, not information. jsPDF will happily draw
 *  4 pt; a printed page will not show it. */
export const FONT_MIN = 5.2;

/* ---------------------------------------------------------------- fitting */

/** Fit `n` items across `w` millimetres with `gap` between, as an item width. */
export function itemWidth(w: number, n: number, gap: number): number {
  if (n <= 0) return 0;
  return (w - gap * (n - 1)) / n;
}

/** The inverse: how many items of `min` width fit across `w`. */
export function itemsAcross(w: number, min: number, gap: number): number {
  if (min <= 0) return 0;
  return Math.max(1, Math.floor((w + gap) / (min + gap)));
}

/** Clamp, because every fitting decision in this directory ends in one. */
export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * How full a page has to be before it counts as a page rather than a gap.
 *
 * Used by the audit: a body page under this is reported, because the usual
 * cause is a block that was moved wholesale for orphan control and left the
 * sheet before it half empty — which is a reflow opportunity, not a fact about
 * the data. The LAST page of a document is exempt; a report is allowed to end.
 */
export const FILL_MIN = 0.55;

/** And the other end. Over this a page is packed to its edges with no air. */
export const FILL_MAX = 0.985;
