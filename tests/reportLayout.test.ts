/**
 * The report layout engine's decision layer.
 *
 * These three modules are import-free by design — `geometry` has no imports at
 * all and `fit` and `audit` import only it — precisely so that the arithmetic
 * that decides what a page looks like can be tested without a jsPDF instance,
 * a browser or card art. That is the same reasoning behind `tiers.ts`,
 * `squadParse.ts` and `passwordRules.ts`.
 *
 * WHAT THESE TESTS CANNOT DO is tell you the document looks right. Every fault
 * this engine shipped during its own construction — a 4 mm card, a heading
 * written across the title beside it, a section bar naming content that was on
 * a different page — was found by rendering pages and looking at them, and two
 * of the three would have passed everything below. The unit tests pin the
 * rules; the rendering pass is what checks they were the right rules.
 */

import { describe, expect, it } from 'vitest';
import {
  CARD_MIN, FILL_MIN, clamp, itemWidth, itemsAcross, lineH,
} from '../src/utils/report/geometry';
import {
  balanceRows, chooseGrid, chooseVariant, packAtoms, underfilled,
  type Atom, type Variant,
} from '../src/utils/report/fit';
import { auditDocument, auditPage, shouldReflow, type AuditPage, type Box } from '../src/utils/report/audit';

/* ---------------------------------------------------------------- geometry */

describe('geometry', () => {
  it('divides a width into items and gaps', () => {
    expect(itemWidth(100, 4, 4)).toBeCloseTo((100 - 12) / 4);
    expect(itemWidth(100, 1, 4)).toBe(100);
  });

  it('is the inverse of itemsAcross at the boundary', () => {
    const w = itemWidth(269, 8, 3.2);
    expect(itemsAcross(269, w, 3.2)).toBe(8);
  });

  it('never reports fewer than one item across', () => {
    expect(itemsAcross(10, 400, 4)).toBe(1);
  });

  it('clamps both ways', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('turns a point size into a line box in millimetres', () => {
    // 10 pt at 1.32 leading is 10 * 0.3528 * 1.32.
    expect(lineH(10)).toBeCloseTo(4.657, 2);
  });
});

/* ------------------------------------------------------------ balanceRows */

describe('balanceRows', () => {
  it('leaves an exact fit alone', () => {
    expect(balanceRows(24, 8)).toEqual([8, 8, 8]);
  });

  it('spreads a lone orphan rather than stranding it', () => {
    // 9 in 8 columns is 8 + 1; the orphan reads as a mistake.
    expect(balanceRows(9, 8)).toEqual([5, 4]);
  });

  it('leaves a last row alone once it is half the width', () => {
    expect(balanceRows(12, 8)).toEqual([8, 4]);
  });

  it('never loses or invents an item', () => {
    for (let n = 1; n <= 60; n += 1) {
      for (let c = 1; c <= 10; c += 1) {
        const rows = balanceRows(n, c);
        expect(rows.reduce((a, b) => a + b, 0)).toBe(n);
        expect(Math.max(...rows)).toBeLessThanOrEqual(c);
      }
    }
  });

  it('handles a count under one row', () => {
    expect(balanceRows(3, 8)).toEqual([3]);
  });

  it('returns nothing for nothing', () => {
    expect(balanceRows(0, 8)).toEqual([]);
    expect(balanceRows(5, 0)).toEqual([]);
  });
});

/* -------------------------------------------------------------- chooseGrid */

const cardGrid = (count: number, width = 269, first = 158, rest = 158) => chooseGrid({
  count, width, first, rest,
  gap: 3.2, rowGap: 3.6,
  min: CARD_MIN * 2 + 4, ideal: 34, max: 42,
  rowHeight: (w) => (w - 4) / 2 / 0.832 + 14,
});

describe('chooseGrid', () => {
  it('never returns an item under the floor', () => {
    for (let n = 1; n <= 120; n += 1) {
      const plan = cardGrid(n);
      if (!plan) continue;
      expect(plan.itemW).toBeGreaterThanOrEqual(CARD_MIN * 2 + 4);
    }
  });

  it('prefers fewer pages over a larger item', () => {
    // 72 pairs: a wide grid fits them in two sheets, a narrow one in four.
    const plan = cardGrid(72);
    expect(plan).not.toBeNull();
    expect(plan!.pages).toBeLessThanOrEqual(2);
  });

  it('does not stretch a handful of items across the whole sheet', () => {
    const plan = cardGrid(3);
    expect(plan!.cols).toBeLessThanOrEqual(3);
    expect(plan!.itemW).toBeLessThanOrEqual(42);
  });

  it('gives a narrow column fewer columns, with no caller change', () => {
    const wide = cardGrid(24, 269);
    const narrow = cardGrid(24, 120);
    expect(narrow!.cols).toBeLessThan(wide!.cols);
  });

  it('reports the page count the packer will actually produce', () => {
    const plan = cardGrid(40)!;
    const rows = plan.rows.length;
    const expected = plan.rowsFirst >= rows
      ? 1
      : 1 + Math.ceil((rows - plan.rowsFirst) / plan.rowsRest);
    expect(plan.pages).toBe(expected);
  });

  it('returns null when nothing can be laid out', () => {
    expect(chooseGrid({
      count: 0, width: 269, first: 158, rest: 158, gap: 2, rowGap: 2,
      min: 10, ideal: 20, max: 30, rowHeight: () => 10,
    })).toBeNull();
    expect(cardGrid(5, 4)).toBeNull();
  });

  it('honours an explicit column allowlist', () => {
    const plan = chooseGrid({
      count: 24, width: 269, first: 158, rest: 158, gap: 3, rowGap: 3,
      min: 10, ideal: 30, max: 60, rowHeight: (w) => w / 2,
      allow: [3, 6],
    });
    expect([3, 6]).toContain(plan!.cols);
  });
});

/* --------------------------------------------------------------- packAtoms */

const atom = (h: number, extra: Partial<Atom> = {}): Atom => ({ h, kind: 'row', ...extra });

describe('packAtoms', () => {
  it('never splits an atom across a page', () => {
    const pages = packAtoms([atom(50), atom(50), atom(50), atom(50)],
      { first: 158, rest: 158 });
    for (const p of pages) {
      expect(p.atoms.reduce((s, a) => s + a.h, 0)).toBeLessThanOrEqual(p.room);
    }
  });

  it('keeps a heading with the block it introduces', () => {
    // Only 30 mm left: the heading must travel with its first row.
    const pages = packAtoms(
      [atom(10, { kind: 'heading', keepWithNext: true }), atom(40), atom(40)],
      { first: 30, rest: 158 },
    );
    const first = pages.find((p) => p.atoms.length > 0)!;
    expect(first.atoms[0].kind).toBe('heading');
    expect(first.atoms[1].kind).toBe('row');
  });

  it('moves a whole keep-with-next chain, however long', () => {
    const pages = packAtoms(
      [
        atom(10, { kind: 'a', keepWithNext: true }),
        atom(10, { kind: 'b', keepWithNext: true }),
        atom(10, { kind: 'c' }),
        atom(140),
      ],
      { first: 25, rest: 158 },
    );
    const withChain = pages.find((p) => p.atoms.some((a) => a.kind === 'a'))!;
    expect(withChain.atoms.map((a) => a.kind).slice(0, 3)).toEqual(['a', 'b', 'c']);
  });

  it('turns the page rather than overhanging, even with nothing placed yet', () => {
    /* THE REGRESSION THIS PINS: "the current page is empty" is not the same
       question as "this is a whole page". A flow usually starts in whatever is
       left under the block before it. */
    const pages = packAtoms([atom(100)], { first: 70, rest: 158 });
    expect(pages[0].atoms).toHaveLength(0);
    expect(pages[1].atoms).toHaveLength(1);
  });

  it('places a genuinely oversized atom rather than looping for ever', () => {
    const pages = packAtoms([atom(400)], { first: 158, rest: 158 });
    expect(pages).toHaveLength(1);
    expect(pages[0].atoms).toHaveLength(1);
  });

  it('gives the first page a different budget from the rest', () => {
    const pages = packAtoms([atom(40), atom(40), atom(40)], { first: 45, rest: 158 });
    expect(pages[0].atoms).toHaveLength(1);
    expect(pages[1].atoms).toHaveLength(2);
  });

  it('reports a fill for every page', () => {
    const pages = packAtoms([atom(79), atom(79)], { first: 158, rest: 158 });
    expect(pages[0].fill).toBeCloseTo(1, 2);
  });

  it('emits one page for no atoms at all', () => {
    expect(packAtoms([], { first: 158, rest: 158 })).toHaveLength(1);
  });

  it('counts the gap between atoms', () => {
    const pages = packAtoms([atom(50), atom(50), atom(50)],
      { first: 158, rest: 158, gap: 5 });
    // 50 + 5 + 50 + 5 + 50 = 160 > 158, so the third moves.
    expect(pages[0].atoms).toHaveLength(2);
  });
});

/* ----------------------------------------------------------- chooseVariant */

const variant = (id: string, heights: number[], legibility: number,
                 lossy = false): Variant => ({
  id, legibility, lossy, atoms: heights.map((h) => atom(h)),
});

describe('chooseVariant', () => {
  it('prefers the composition that costs fewer pages', () => {
    const dense = variant('dense', [30, 30, 30, 30], 0.6);
    const loose = variant('loose', [80, 80, 80, 80], 1);
    const pick = chooseVariant([dense, loose], { first: 158, rest: 158 });
    expect(pick!.variant.id).toBe('dense');
  });

  it('prefers the more legible composition at equal page counts', () => {
    const small = variant('small', [30, 30], 0.4);
    const big = variant('big', [60, 60], 0.95);
    const pick = chooseVariant([small, big], { first: 158, rest: 158 });
    expect(pick!.variant.id).toBe('big');
  });

  it('makes a lossy variant earn its place by a whole page', () => {
    // Same page count: the faithful one must win.
    const full = variant('full', [70, 70], 1);
    const cut = variant('cut', [70], 1, true);
    const pick = chooseVariant([full, cut], { first: 158, rest: 158 });
    expect(pick!.variant.id).toBe('full');
  });

  it('lets a lossy variant win when it genuinely saves sheets', () => {
    const full = variant('full', Array<number>(12).fill(80), 1);
    const cut = variant('cut', [80, 80], 1, true);
    const pick = chooseVariant([full, cut], { first: 158, rest: 158 });
    expect(pick!.variant.id).toBe('cut');
  });

  it('ignores an empty variant', () => {
    const pick = chooseVariant([variant('empty', [], 1), variant('real', [40], 1)],
      { first: 158, rest: 158 });
    expect(pick!.variant.id).toBe('real');
  });

  it('returns null when there is nothing to choose', () => {
    expect(chooseVariant([], { first: 158, rest: 158 })).toBeNull();
  });
});

describe('underfilled', () => {
  it('never reports the last page, which is allowed to end', () => {
    const pages = packAtoms([atom(150), atom(10)], { first: 158, rest: 158 });
    expect(underfilled(pages)).toEqual([]);
  });

  it('reports a page that gave up early', () => {
    const pages = packAtoms([atom(40), atom(150)], { first: 158, rest: 158 });
    expect(pages[0].fill).toBeLessThan(FILL_MIN);
    expect(underfilled(pages)).toEqual([0]);
  });
});

/* ------------------------------------------------------------------ audit */

const box = (b: Partial<Box>): Box =>
  ({ x: 14, y: 40, w: 100, h: 20, kind: 'row', ...b });

const page = (boxes: Box[], extra: Partial<AuditPage> = {}): AuditPage =>
  ({ index: 2, boxes, fill: 0.8, ...extra });

describe('audit', () => {
  it('passes a well-formed page', () => {
    expect(auditPage(page([box({ y: 40 }), box({ y: 70 })]))).toEqual([]);
  });

  it('catches ink past the body floor', () => {
    const f = auditPage(page([box({ y: 185, h: 20 })]));
    expect(f.map((x) => x.rule)).toContain('overflow-bottom');
    expect(f[0].severity).toBe('error');
  });

  it('catches ink outside the side margins', () => {
    const f = auditPage(page([box({ x: 280, w: 30 })]));
    expect(f.map((x) => x.rule)).toContain('overflow-side');
  });

  it('catches two components drawn on top of each other', () => {
    const f = auditPage(page([box({ y: 40, h: 30 }), box({ y: 50, h: 30 })]));
    expect(f.map((x) => x.rule)).toContain('overlap');
  });

  it('does not read legitimate containment as an overlap', () => {
    const f = auditPage(page([
      box({ y: 40, h: 30, kind: 'module' }),
      box({ y: 45, h: 10, kind: 'card', nested: true }),
    ]));
    expect(f.map((x) => x.rule)).not.toContain('overlap');
  });

  it('catches a heading with nothing under it', () => {
    const f = auditPage(page([box({ y: 40, kind: 'row' }), box({ y: 70, kind: 'heading' })]));
    expect(f.map((x) => x.rule)).toContain('orphan-heading');
  });

  it('does not call a heading orphaned when content follows it', () => {
    const f = auditPage(page([box({ y: 40, kind: 'heading' }), box({ y: 70, kind: 'row' })]));
    expect(f.map((x) => x.rule)).not.toContain('orphan-heading');
  });

  it('catches art starved below the legibility floor', () => {
    const f = auditPage(page([box({ kind: 'card', imageW: 4, nested: true })]));
    expect(f.map((x) => x.rule)).toContain('art-too-small');
  });

  it('catches type starved below the legibility floor', () => {
    const f = auditPage(page([box({ kind: 'row', fontSize: 4 })]));
    expect(f.map((x) => x.rule)).toContain('type-too-small');
  });

  it('catches a blank page', () => {
    expect(auditPage(page([])).map((x) => x.rule)).toContain('blank-page');
  });

  it('exempts a cover or divider from every page-shape rule', () => {
    expect(auditPage(page([], { exempt: true }))).toEqual([]);
  });

  it('warns rather than errors on a half-empty page', () => {
    const f = auditPage(page([box({})], { fill: 0.2 }));
    const under = f.find((x) => x.rule === 'underfilled')!;
    expect(under.severity).toBe('warn');
  });

  it('does not judge the last page on how full it is', () => {
    const f = auditPage(page([box({})], { fill: 0.2, last: true }));
    expect(f.map((x) => x.rule)).not.toContain('underfilled');
  });

  it('totals errors and warnings across a document', () => {
    const result = auditDocument([
      page([box({})]),
      page([box({ y: 185, h: 20 })], { index: 3 }),
      page([box({})], { index: 4, fill: 0.1 }),
    ]);
    expect(result.errors).toBe(1);
    expect(result.warnings).toBe(1);
    expect(result.clean).toBe(false);
  });

  it('says a document is clean when it is', () => {
    const result = auditDocument([page([box({})]), page([box({})], { index: 3 })]);
    expect(result.clean).toBe(true);
    expect(shouldReflow(result)).toBe(false);
  });

  it('marks the findings the engine knows how to fix', () => {
    const result = auditDocument([page([box({ y: 185, h: 20 })])]);
    expect(shouldReflow(result)).toBe(true);
  });
});
