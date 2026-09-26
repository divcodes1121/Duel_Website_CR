/**
 * PAGE GEOMETRY AND THE TYPE SCALE — no imports, so every layout decision that
 * depends on a number here is testable without jsPDF or a browser.
 *
 * A4 LANDSCAPE, because the thing these reports mostly draw is a deck — eight
 * cards in a row — and a comparison of two of them side by side. Portrait
 * fits one strip a line at a card size nobody can read across a table.
 *
 * Every figure is in millimetres unless it says `pt`.
 */

export const PAGE_W = 297;
export const PAGE_H = 210;

/** Side margin. The content column is everything between the two. */
export const MARGIN = 12;
export const CONTENT_W = PAGE_W - MARGIN * 2;

/** The running brand bar at the top of every page, and the rule under it. */
export const HEADER_H = 15;
/** Where page content starts and must stop. */
export const BODY_TOP = 21;
export const BODY_BOTTOM = PAGE_H - 13;
export const BODY_H = BODY_BOTTOM - BODY_TOP;
/** Baseline of the footer line. */
export const FOOTER_Y = PAGE_H - 6.2;

/** One typographic point in millimetres. */
export const PT = 25.4 / 72;

/** The card art's own frame: 119 of 122 base cards are exactly 302 x 363. */
export const CARD_RATIO = 302 / 363;

/** Vertical rhythm between blocks and between the rows inside one. */
export const BLOCK_GAP = 6;
export const ROW_GAP = 2.4;

/** Corner radius of a panel, and of the smaller things inside one. */
export const RADIUS = 2.6;
export const RADIUS_SM = 1.4;

/**
 * THE TYPE SCALE. Four roles and no more — the rule every report and
 * dashboard reference agrees on is that size and weight do the scanning, and
 * a fifth size is a size nobody can tell from its neighbour.
 *
 *   display  Bebas Neue — titles and the big figures. Draws capitals only.
 *   heading  Bebas Neue at block-title size.
 *   body     Inter 400/600 — names, table cells, notes.
 *   label    Inter 600, upper case, tracked — the small print that names a
 *            figure.
 *
 * `track` is letterspacing in MILLIMETRES (jsPDF's `charSpace` is in the
 * document unit and is applied after every glyph, the last one included).
 */
export const TYPE = {
  coverTitle: { size: 46, track: 0.4 },
  heroTitle: { size: 30, track: 0.3 },
  sectionTitle: { size: 24, track: 0.3 },
  heading: { size: 14, track: 0.28 },
  figure: { size: 17, track: 0.1 },
  figureSmall: { size: 13, track: 0.08 },
  name: { size: 7.6 },
  body: { size: 7.2 },
  small: { size: 6.2 },
  label: { size: 5.4, track: 0.28 },
  footer: { size: 5.2, track: 0.3 },
} as const;

/**
 * LEGIBILITY FLOORS. A layout engine free to choose density will always find
 * that one more column fits; these are where that stops. Measured against
 * printed output, not guessed: 5 pt is the smallest caption that survives an
 * office printer, and a card under 7 mm wide stops being recognisable.
 */
export const FONT_MIN = 5;
export const CARD_MIN = 7;
/** And a ceiling, because the complaint that started this engine was cards
 *  and type drawn far larger than the website draws them. */
export const CARD_MAX = 11.5;

/** Height of a card of width `w`, at the art's true ratio. */
export function cardH(w: number): number {
  return w / CARD_RATIO;
}

/**
 * The widest card that lets `n` cards and their gaps fit in `room`,
 * clamped to [min, max]. Never returns more than `max` however much room
 * there is — spare width is left as margin, not spent on art.
 */
export function cardWidthFor(room: number, n: number, gap: number, min = CARD_MIN, max = CARD_MAX): number {
  if (n <= 0) return max;
  const w = (room - gap * (n - 1)) / n;
  return Math.max(min, Math.min(max, w));
}

/** Width of `n` cards of width `w` with `gap` between them. */
export function stripWidth(n: number, w: number, gap: number): number {
  return n <= 0 ? 0 : n * w + (n - 1) * gap;
}

/**
 * How many equal columns of at least `minW` fit in `room` with `gap` between
 * them, capped at `max`.
 */
export function columnsFor(room: number, minW: number, gap: number, max = 8): number {
  let n = Math.max(1, Math.floor((room + gap) / (minW + gap)));
  if (n > max) n = max;
  return n;
}

/** Width of one of `n` equal columns across `room`. */
export function columnWidth(room: number, n: number, gap: number): number {
  return (room - gap * (n - 1)) / n;
}
