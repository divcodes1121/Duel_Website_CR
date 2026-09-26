/**
 * THE AUDIT — run on every export, reading what was COMMITTED.
 *
 * Every primitive in `surface.ts` records the rectangle it drew. This reads
 * those records rather than the layout's own arithmetic, because a check that
 * shares its numbers with the thing it checks can only confirm it. Pure: no
 * imports but geometry, so it is tested without jsPDF.
 *
 * What it flags, and why each is a defect rather than a preference:
 *
 *   type-floor   text under FONT_MIN — unreadable on paper.
 *   card-floor   a card under CARD_MIN — unrecognisable.
 *   card-ceiling a card over CARD_MAX — the "images far too big" complaint.
 *   bleed        body content outside the body box, into the margins, the
 *                brand bar or the footer.
 */

import { BODY_BOTTOM, BODY_TOP, CARD_MAX, CARD_MIN, FONT_MIN, MARGIN, PAGE_W } from './geometry';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  /** Point size, for text. */
  font?: number;
  /** Width, for a card. */
  cardW?: number;
  /** 'chrome' boxes (brand bar, footer, cover) are exempt from the bleed
   *  check; they are meant to sit outside the body. */
  zone?: 'body' | 'chrome';
}

export interface Issue {
  page: number;
  rule: 'type-floor' | 'card-floor' | 'card-ceiling' | 'bleed';
  detail: string;
}

const TOL = 0.6;

export function auditPage(page: number, boxes: readonly Box[]): Issue[] {
  const out: Issue[] = [];
  for (const b of boxes) {
    if (b.font !== undefined && b.font < FONT_MIN - 1e-6) {
      out.push({ page, rule: 'type-floor', detail: `${b.kind} at ${b.font.toFixed(1)}pt` });
    }
    if (b.cardW !== undefined) {
      if (b.cardW < CARD_MIN - 1e-6) out.push({ page, rule: 'card-floor', detail: `card ${b.cardW.toFixed(1)}mm` });
      if (b.cardW > CARD_MAX + 1e-6) out.push({ page, rule: 'card-ceiling', detail: `card ${b.cardW.toFixed(1)}mm` });
    }
    if (b.zone !== 'chrome') {
      const bleed = b.x < MARGIN - TOL || b.x + b.w > PAGE_W - MARGIN + TOL
        || b.y < BODY_TOP - TOL || b.y + b.h > BODY_BOTTOM + TOL;
      if (bleed) {
        out.push({
          page, rule: 'bleed',
          detail: `${b.kind} at ${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}x${b.h.toFixed(1)}`,
        });
      }
    }
  }
  return out;
}

export function auditDocument(pages: readonly (readonly Box[])[]): Issue[] {
  return pages.flatMap((boxes, i) => auditPage(i + 1, boxes));
}
