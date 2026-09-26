/**
 * The report engine's pure half: geometry, pagination, the audit, the palette,
 * the glyph filter and the art sweep. None of these import jsPDF or touch a
 * browser, which is the point of the split — the rules that decide what a
 * page looks like are testable on their own.
 *
 * WHAT THESE TESTS CANNOT DO is tell you the document looks right. Every fault
 * found while building the engine — a score drawn over a date, a matrix that
 * painted every cell one green, two decks a page apart with a hole between
 * them — was found by rendering pages and looking at them. The tests pin the
 * rules; the rendering pass checks they were the right rules.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BODY_BOTTOM, BODY_TOP, CARD_MAX, CARD_MIN, CARD_RATIO, CONTENT_W, FONT_MIN, MARGIN, PAGE_W,
  cardH, cardWidthFor, columnWidth, columnsFor, stripWidth,
} from '../src/utils/report/geometry';
import { pack, type PackItem } from '../src/utils/report/pack';
import { auditDocument, auditPage, type Box } from '../src/utils/report/audit';
import { HUES, P, contrast, heat, mix, parsePct, rateColor } from '../src/utils/report/theme';
import { drawable, latin1, printableName } from '../src/utils/report/text';
import { collectArt, tagged } from '../src/utils/report/engine';
import type { ReportBlock } from '../src/utils/analyticsReport';

/* ---------------------------------------------------------------- geometry */

describe('geometry', () => {
  it('keeps the card art at its true ratio', () => {
    expect(cardH(10)).toBeCloseTo(10 / CARD_RATIO);
    expect(CARD_RATIO).toBeCloseTo(302 / 363);
  });

  it('never sizes a card past the ceiling, however much room there is', () => {
    // The complaint that started the rewrite: art far bigger than the site.
    expect(cardWidthFor(400, 8, 1)).toBe(CARD_MAX);
    expect(cardWidthFor(10, 8, 1)).toBe(CARD_MIN);
    expect(cardWidthFor(90, 8, 1)).toBeCloseTo((90 - 7) / 8);
  });

  it('measures a strip as cards plus the gaps between them', () => {
    expect(stripWidth(8, 10, 1)).toBe(87);
    expect(stripWidth(0, 10, 1)).toBe(0);
  });

  it('splits a width into equal columns', () => {
    expect(columnWidth(100, 4, 4)).toBeCloseTo(22);
    expect(columnsFor(CONTENT_W, 40, 3, 6)).toBe(6);
    expect(columnsFor(50, 40, 3)).toBe(1);
  });
});

/* -------------------------------------------------------------- pagination */

const items = (hs: number[], extra: Partial<PackItem>[] = []): PackItem[] =>
  hs.map((h, i) => ({ h, gap: 2, ...(extra[i] ?? {}) }));

describe('pack', () => {
  const opts = { top: 0, bottom: 100 };

  it('fills a page and turns it', () => {
    const pages = pack(items([40, 40, 40]), opts);
    expect(pages.map((p) => p.map((x) => x.item))).toEqual([[0, 1], [2]]);
  });

  it('places the first atom on a page with no gap above it', () => {
    const pages = pack(items([40, 40, 40]), opts);
    expect(pages[1][0].y).toBe(0);
    expect(pages[0][1].y).toBe(42);
  });

  it('keeps a heading with the row under it', () => {
    // 60 + heading 10 + row 30 = 102 > 100: the heading must not be stranded.
    const pages = pack(items([60, 10, 30], [{}, { keep: true }, {}]), opts);
    expect(pages.map((p) => p.map((x) => x.item))).toEqual([[0], [1, 2]]);
  });

  it('opens a new page for a section opener', () => {
    const pages = pack(items([10, 10], [{}, { breakBefore: true }]), opts);
    expect(pages).toHaveLength(2);
  });

  it('reserves a continuation heading when a block spills', () => {
    const pages = pack(items([70, 20, 20], [{}, {}, { contH: 8 }]), { ...opts, contGap: 0 });
    const second = pages[1];
    expect(second[0]).toEqual({ item: 2, y: 0, cont: true });
    expect(second[1]).toEqual({ item: 2, y: 8 });
  });

  it('places an atom taller than a page rather than looping', () => {
    const pages = pack(items([10, 150, 10]), opts);
    expect(pages.flat().filter((p) => !p.cont).map((p) => p.item)).toEqual([0, 1, 2]);
  });

  it('never leaves a trailing empty page', () => {
    const pages = pack(items([10, 10], [{}, { breakBefore: true }]), opts);
    expect(pages.every((p) => p.length > 0)).toBe(true);
  });

  it('starts the first page lower when a hero band sits above it', () => {
    const pages = pack(items([10]), { ...opts, firstTop: 50 });
    expect(pages[0][0].y).toBe(50);
  });
});

/* ------------------------------------------------------------------- audit */

describe('audit', () => {
  const ok: Box = { x: MARGIN, y: BODY_TOP, w: 20, h: 10, kind: 'panel' };

  it('passes a box inside the body', () => {
    expect(auditPage(1, [ok])).toEqual([]);
  });

  it('flags type under the print floor', () => {
    expect(auditPage(1, [{ ...ok, kind: 'text', font: FONT_MIN - 0.5 }])[0].rule).toBe('type-floor');
  });

  it('flags cards under the floor and over the ceiling', () => {
    expect(auditPage(1, [{ ...ok, kind: 'card', cardW: CARD_MIN - 1 }])[0].rule).toBe('card-floor');
    expect(auditPage(1, [{ ...ok, kind: 'card', cardW: CARD_MAX + 1 }])[0].rule).toBe('card-ceiling');
  });

  it('flags body content that bleeds into the margin or the footer', () => {
    expect(auditPage(1, [{ ...ok, x: PAGE_W - MARGIN - 5, w: 20 }])[0].rule).toBe('bleed');
    expect(auditPage(1, [{ ...ok, y: BODY_BOTTOM - 2, h: 10 }])[0].rule).toBe('bleed');
  });

  it('exempts the brand bar and footer, which live outside the body', () => {
    expect(auditPage(1, [{ ...ok, y: 2, zone: 'chrome' }])).toEqual([]);
  });

  it('numbers issues by page', () => {
    const issues = auditDocument([[ok], [{ ...ok, kind: 'text', font: 3 }]]);
    expect(issues[0].page).toBe(2);
  });
});

/* ----------------------------------------------------------------- palette */

describe('theme', () => {
  it('holds the secondary and caption inks above 4.5:1 on a panel', () => {
    expect(contrast(P.text2, P.panel)).toBeGreaterThan(4.5);
    expect(contrast(P.text3, P.panel)).toBeGreaterThan(4.5);
  });

  it('holds every hue ink above 4.5:1 on a panel', () => {
    for (const [name, h] of Object.entries(HUES)) {
      expect(contrast(h.ink, P.panel), name).toBeGreaterThan(4.5);
    }
  });

  it('holds white button labels on every deep step', () => {
    for (const [name, h] of Object.entries(HUES)) {
      if (name === 'neutral' || name === 'amber') continue;
      expect(contrast(P.text, h.deep), name).toBeGreaterThan(4.5);
    }
  });

  it('colours a win rate only outside the coin-flip band', () => {
    expect(rateColor(60)).toEqual(HUES.green.ink);
    expect(rateColor(40)).toEqual(HUES.red.ink);
    expect(rateColor(50)).toEqual(P.text);
    expect(rateColor(90, true)).toEqual(P.text3);
    expect(rateColor(null)).toEqual(P.text3);
  });

  it('reads a percentage back out of a printed figure', () => {
    expect(parsePct('63.3%')).toBe(63.3);
    expect(parsePct('3-1')).toBeNull();
  });

  it('runs the matrix ramp red to green', () => {
    expect(heat(0)[0]).toBeGreaterThan(heat(0)[1]);
    expect(heat(1)[1]).toBeGreaterThan(heat(1)[0]);
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
  });
});

/* ------------------------------------------------------------------ glyphs */

describe('text', () => {
  it('keeps accented Latin and drops what the fonts cannot draw', () => {
    expect(drawable('Łukasz ✨', 'body', true)).toBe('Łukasz');
    expect(drawable('Zoë 😀 Hog', 'body', true)).toBe('Zoë Hog');
  });

  it('keeps the en dash in a score with the embedded fonts, maps it for Helvetica', () => {
    expect(drawable('2–1', 'body', true)).toBe('2–1');
    expect(latin1('2–1')).toBe('2-1');
  });

  it('falls back to the tag when most of a name cannot be printed', () => {
    // Keeps only the Latin "i": printed, it was a different player.
    expect(printableName('Потужнi лававод', '#J00VYRCR2')).toBe('#J00VYRCR2');
    expect(printableName('ゴリラ✨', '#RQ0J8GQRJ')).toBe('#RQ0J8GQRJ');
    expect(printableName('EthanWinters', '#8CRPJ2RCG')).toBe('EthanWinters');
    expect(printableName('', '#TAG')).toBe('#TAG');
    // Cleaned, not raw: the space before a stripped emoji must not survive
    // into "Danzai ’s decks".
    expect(printableName('Danzai ✨', '#TAG')).toBe('Danzai');
    expect(`${printableName('Danzai ✨', '#TAG')}’s decks`).toBe('Danzai’s decks');
  });

  it('gives a bare tag its hash, and leaves names alone', () => {
    expect(tagged('yypcuuy0')).toBe('#YYPCUUY0');
    expect(tagged('#YYPCUUY0')).toBe('#YYPCUUY0');
    expect(tagged('3 v 3 — #ABC')).toBe('3 v 3 — #ABC');
  });
});

/* ---------------------------------------------------------------- art sweep */

describe('collectArt', () => {
  const deck = { name: 'd', cards: ['hog-rider', 'musketeer'], art: { musketeer: 'evolution' as const } };
  const all: ReportBlock[] = [
    { kind: 'decks', decks: [deck] },
    { kind: 'versus', pairs: [{ left: deck, right: null }] },
    { kind: 'series', rows: [{ leftLabel: '', rightLabel: '', score: '', caption: '', date: '', format: '', won: true, left: [deck], right: [] }] },
    { kind: 'battles', rows: [{ result: 'win', score: '', when: '', mode: '', leftLabel: '', rightLabel: '', left: deck, right: { name: 'x', cards: ['zap'] } }] },
    { kind: 'pairs', pairs: [{ a: 'knight', b: 'wizard', artB: 'hero', name: '' }] },
    { kind: 'cards', cards: [{ key: 'valkyrie', form: 'hero', stats: [] }] },
  ];

  it('finds the art of every block kind that draws cards', () => {
    // A kind missed here prints name-only placeholders for its whole section,
    // silently — a placeholder is a valid-looking tile.
    for (const b of all) {
      expect(collectArt([b]).length, b.kind).toBeGreaterThan(0);
    }
  });

  it('asks for the evolution or hero art where the deck fields that form', () => {
    const urls = collectArt(all);
    expect(urls.some((u) => /evolutions\/musketeer/.test(u))).toBe(true);
    expect(urls.some((u) => /heroes\/wizard/.test(u))).toBe(true);
    expect(urls.some((u) => /heroes\/valkyrie/.test(u))).toBe(true);
  });

  it('deduplicates', () => {
    const urls = collectArt([{ kind: 'decks', decks: [deck, deck] }]);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

/* ----------------------------------------------------- the lag tripwire */

describe('no transparency in the report engine', () => {
  /* THE REASON THE OLD EXPORT WAS SLOW. A PDF viewer composites every
     transparency state per pixel; the print export carried 60-263 of them and
     painted a page in ~430 ms. The engine draws opaque fills only — muted
     colours are real colours, glows are baked into images — and this fails
     if a GState or an opacity creeps back in. */
  const dir = path.resolve(__dirname, '../src/utils/report');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    it(f, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/setGState|new GState|GState\(/);
      expect(src).not.toMatch(/opacity\s*:/);
    });
  }
});
