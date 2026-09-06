/**
 * THE COMPONENTS — each one measures itself, offers the compositions that make
 * sense for its data, and hands back atoms that know how to draw themselves.
 *
 * THE CONTRACT, and every line in this file obeys it:
 *
 *   1. MEASURE FIRST. A builder computes every height from real text metrics
 *      and real art ratios before it commits to anything. No constant in here
 *      is a guess about how tall something will come out; where a number is a
 *      choice rather than a measurement it is a PADDING, and it is named.
 *   2. OFFER, DO NOT DECIDE. A builder returns candidate variants. Which one
 *      ships is `chooseVariant`'s call, made against the room actually left on
 *      the page, which the builder cannot know.
 *   3. AN ATOM IS INDIVISIBLE. If it can be split, it is two atoms; if it must
 *      not be, it is one. That single judgement is what the entire pagination
 *      guarantee rests on.
 *
 * This replaces a renderer whose block heights were hardcoded estimates —
 * `case 'decks': return 34` — used to decide whether a heading could be placed.
 * When the estimate was low the heading was stranded; when it was high the page
 * broke early and left a gap. Both faults are the same fault, and measuring is
 * the only fix for either.
 */

import type {
  BarsBlock, DeckLine, DecksBlock, DividerBlock, MatrixBlock, PairsBlock,
  ReportBlock, ReportHue, SeriesBlock, SpreadBlock, StatTile, TableBlock,
  TableCell, TableRow, VersusBlock,
} from '../analyticsReport';
import {
  CARD_IDEAL, CARD_MAX, CARD_MIN, CARD_RATIO, SPACE, TYPE, clamp, lineH,
} from './geometry';
import { chooseGrid, type Atom, type Variant } from './fit';
import { hueColor, mix, semanticColor, semanticOf, type RGB } from './palette';
import type { Surface } from './paint';

/** An atom that knows how to put itself on the page. */
export interface PlacedAtom extends Atom {
  draw: (s: Surface, x: number, y: number, w: number) => void;
}

export interface BuildCtx {
  s: Surface;
  hue: ReportHue;
  width: number;
  /** Room on the page this block starts on, and on any page after it. */
  first: number;
  rest: number;
}

const px = (a: PlacedAtom): PlacedAtom => a;

/* ------------------------------------------------------------------ text */

/** The heading over a block, and the note under it. One atom, keeping with
 *  whatever follows — that is the orphan guarantee, expressed as data. */
export function headingAtom(s: Surface, heading: string | undefined,
                            note: string | undefined, width: number): PlacedAtom | null {
  if (!heading && !note) return null;
  const noteLines = note
    ? s.wrap(note, width, { size: TYPE.bodySmall.size })
    : [];
  const h = (heading ? lineH(TYPE.heading.size) + 1.4 : 0)
    + noteLines.length * lineH(TYPE.bodySmall.size)
    + SPACE.tight;
  return px({
    h,
    keepWithNext: true,
    kind: 'heading',
    draw: (surf, x, y, w) => {
      let cy = y;
      if (heading) {
        cy += lineH(TYPE.heading.size) * 0.78;
        surf.text(heading, x, cy, {
          size: TYPE.heading.size, bold: true, track: TYPE.heading.track,
          color: surf.p.text, caps: true,
        });
        cy += 1.4 + lineH(TYPE.heading.size) * 0.22;
      }
      for (const ln of noteLines) {
        cy += lineH(TYPE.bodySmall.size) * 0.78;
        surf.text(ln, x, cy, { size: TYPE.bodySmall.size, color: surf.p.muted });
        cy += lineH(TYPE.bodySmall.size) * 0.22;
      }
      surf.box({ x, y, w, h, kind: 'heading', fontSize: TYPE.heading.size });
    },
  });
}

/** Editorial body copy. Each PARAGRAPH is an atom — splitting prose at a page
 *  break is fine and normal, splitting it mid-paragraph is not. */
export function noteAtoms(s: Surface, body: string, width: number): PlacedAtom[] {
  return body.split(/\n{2,}/).map((para) => {
    const lines = s.wrap(para, width - 8, { size: TYPE.body.size });
    const h = lines.length * lineH(TYPE.body.size) + SPACE.snug;
    return px({
      h,
      kind: 'note',
      draw: (surf, x, y, w) => {
        surf.fill(mix(surf.p.nested, surf.p.sunken, 0.5));
        surf.doc.roundedRect(x, y, w, h - SPACE.tight, 1.6, 1.6, 'F');
        lines.forEach((ln, i) => {
          surf.text(ln, x + 4, y + 3.6 + i * lineH(TYPE.body.size),
            { size: TYPE.body.size, color: surf.p.text });
        });
        surf.box({ x, y, w, h: h - SPACE.tight, kind: 'note', fontSize: TYPE.body.size });
      },
    });
  });
}

/* ------------------------------------------------------------------- KPIs */

/**
 * A KPI STRIP, and the one place the brief's "large numbers only when they are
 * genuinely important" rule is enforced mechanically.
 *
 * ONE OR TWO TILES GET THE HERO TREATMENT — a full-width module with the
 * figure at level 3. Three or more share a ruled strip at level 3b. That is
 * not a style preference: a lone figure on a page IS the page's headline and
 * should read like one, while six figures are a context strip and six large
 * numbers are just noise with nothing to compare against.
 */
export function statsVariants(tiles: StatTile[], ctx: BuildCtx): Variant[] {
  if (tiles.length === 0) return [];
  const out: Variant[] = [];

  if (tiles.length <= 2) {
    const H = 34;
    out.push({
      id: 'stats:hero',
      legibility: 1,
      atoms: tiles.map((t) => px({
        h: H + SPACE.tight,
        kind: 'kpi-hero',
        draw: (surf, x, y, w) => {
          const accent = hueColor(surf.p, t.hue ?? ctx.hue);
          surf.module(x, y, w, H, { accent: mix(accent, surf.p.border, 0.5), kind: 'kpi-hero' });
          surf.label(t.label, x + w / 2, y + 8, { align: 'center' });
          surf.text(t.value, x + w / 2, y + 22, {
            size: TYPE.metric.size, bold: true, color: accent, align: 'center',
          });
          if (t.note) {
            surf.text(t.note, x + w / 2, y + 28.5, {
              size: TYPE.label.size, bold: true, track: TYPE.label.track,
              color: surf.p.muted, align: 'center', caps: true,
            });
          }
        },
      })),
    });
    return out;
  }

  // A strip. Per row, so a long list wraps rather than shrinking to nothing.
  const perRow = clamp(tiles.length <= 4 ? tiles.length : Math.ceil(tiles.length / 2), 2, 6);
  const rows: StatTile[][] = [];
  for (let i = 0; i < tiles.length; i += perRow) rows.push(tiles.slice(i, i + perRow));
  const gap = SPACE.base;
  out.push({
    id: `stats:strip-${perRow}`,
    legibility: 1,
    atoms: rows.map((row) => px({
      h: 16,
      kind: 'kpi-strip',
      draw: (surf, x, y, w) => {
        const cw = (w - gap * (row.length - 1)) / row.length;
        row.forEach((t, i) => {
          surf.kpi(x + i * (cw + gap), y, cw, {
            label: t.label,
            value: t.value,
            note: t.note,
            accent: t.hue ? hueColor(surf.p, t.hue) : hueColor(surf.p, ctx.hue),
          });
        });
      },
    })),
  });
  return out;
}

/* ------------------------------------------------------------------ table */

const cellOf = (v: TableCell | string): TableCell =>
  typeof v === 'string' ? { text: v } : v;

/**
 * A DATA TABLE.
 *
 * TWO THINGS MAKE IT CONTENT-AWARE, and both come from the same measurement:
 * how wide the table actually WANTS to be.
 *
 * 1. A FLEX COLUMN IS CAPPED AT ITS CONTENT. The old behaviour handed all the
 *    spare width to whichever column asked for it, so a list of card names —
 *    none longer than 30 mm — got a 190 mm column, and every row read as a name
 *    at one edge and three figures at the other with a hand's width of nothing
 *    between them. A column is as wide as the widest thing in it plus room to
 *    breathe; anything past that is not generosity, it is a gap.
 *
 * 2. WHAT IS LEFT OVER BECOMES MORE COLUMNS. Forty rows at 7 mm need 280 mm of
 *    height and the body has 158, so a single column is two pages of half-empty
 *    sheet. Two tables side by side is one page, at exactly the same row height
 *    and type size — nothing is shrunk, the page is just used. This is the
 *    "eighteen records, therefore three columns" decision, and it is made by
 *    measuring rather than by a rule of thumb: the k-up variant is only offered
 *    when k tables genuinely fit, and only wins if the packer says it saves a
 *    sheet.
 *
 * THE READING ORDER OF A k-UP TABLE IS ACROSS, THEN DOWN, and that is the one
 * real cost. A ranked list split into two columns could also be read down the
 * left and then down the right, which is what a phone book does — but that
 * ordering cannot be built until the page break is known, and the page break
 * depends on the composition. Reading across keeps the rank order correct on
 * every page however the packer splits it, which matters more than the habit.
 */
export function tableVariants(block: TableBlock, ctx: BuildCtx): Variant[] {
  const { s, width } = ctx;
  if (block.rows.length === 0) return [];

  const headStyle = { size: TYPE.label.size, bold: true as const, track: TYPE.label.track,
                      caps: true as const };
  const bodyStyle = { size: TYPE.body.size };

  /* WHAT EACH COLUMN WANTS. A declared `width` is honoured exactly — a table
     whose columns are computed from content does not line up between pages —
     and everything else is measured against the real strings. */
  const natural = block.columns.map((c) => {
    if (c.width) return c.width;
    let w = s.width(c.label, headStyle);
    for (const row of block.rows) {
      const cell = cellOf(row[c.key] ?? '');
      w = Math.max(w, s.width(cell.text, bodyStyle));
    }
    return Math.min(w + 6, 74);
  });
  const naturalW = natural.reduce((a, b) => a + b, 0);

  const headH = lineH(TYPE.label.size) + 2.6;
  const rowH = lineH(TYPE.body.size) + 3.4;
  const GUTTER = SPACE.wide;

  const build = (k: number): Variant | null => {
    const tableW = (width - GUTTER * (k - 1)) / k;
    if (k > 1 && tableW < naturalW) return null;
    // One table never exceeds what it wants; the leftover is simply not used.
    const useW = Math.min(tableW, Math.max(naturalW, tableW * 0.5));
    const scale = useW / naturalW;
    let cx = 0;
    const laid = block.columns.map((c, i) => {
      const w = natural[i] * scale;
      const out = { ...c, w, x: cx };
      cx += w;
      return out;
    });

    const drawHead = (surf: Surface, x: number, y: number, w: number) => {
      for (let t = 0; t < k; t += 1) {
        const ox = x + t * (tableW + GUTTER);
        for (const c of laid) {
          surf.label(c.label, ox + c.x + (c.align === 'right' ? c.w - 2 : 0), y + 3.2,
            { align: c.align === 'right' ? 'right' : 'left' });
        }
        surf.stroke(surf.p.border);
        surf.doc.setLineWidth(0.25);
        surf.doc.line(ox, y + headH - 1, ox + useW, y + headH - 1);
      }
      void w;
    };

    const drawRow = (surf: Surface, row: TableRow, ox: number, y: number, band: boolean) => {
      if (band) {
        surf.alpha(0.5, () => {
          surf.fill(mix(surf.p.nested, surf.p.sunken, 0.6));
          surf.doc.rect(ox, y, useW, rowH, 'F');
        });
      }
      for (const c of laid) {
        const cell = cellOf(row[c.key] ?? '');
        const right = c.align === 'right';
        const tx = ox + c.x + (right ? c.w - 2 : 0);
        if (cell.bar !== undefined) {
          const bw = Math.max(0, c.w - 4);
          surf.fill(mix(surf.p.border, surf.p.nested, 0.75));
          surf.doc.roundedRect(ox + c.x, y + rowH - 2.4, bw, 0.9, 0.45, 0.45, 'F');
          surf.fill(cell.thin
            ? semanticColor(surf.p, 'none')
            : hueColor(surf.p, cell.hue ?? ctx.hue));
          surf.doc.roundedRect(ox + c.x, y + rowH - 2.4,
            Math.max(0.6, bw * clamp(cell.bar, 0, 1)), 0.9, 0.45, 0.45, 'F');
        }
        const color = cell.thin
          ? semanticColor(surf.p, 'none')
          : cell.hue ? hueColor(surf.p, cell.hue) : surf.p.text;
        surf.text(surf.clip(cell.text, c.w - 3, bodyStyle), tx, y + 3.4, {
          ...bodyStyle, color, align: right ? 'right' : 'left',
        });
      }
    };

    const atoms: PlacedAtom[] = [
      px({
        h: headH,
        keepWithNext: true,
        kind: 'columns',
        payload: { repeatHead: drawHead, headH },
        draw: (surf, x, y, w) => {
          drawHead(surf, x, y, w);
          surf.box({ x, y, w, h: headH, kind: 'columns', fontSize: TYPE.label.size });
        },
      }),
    ];

    // One atom per BAND of k rows, so a break can never split a row from the
    // one beside it.
    for (let i = 0; i < block.rows.length; i += k) {
      const band = block.rows.slice(i, i + k);
      const striped = (i / k) % 2 === 1;
      atoms.push(px({
        h: rowH,
        kind: 'row',
        payload: { repeatHead: drawHead, headH },
        draw: (surf, x, y, w) => {
          band.forEach((row, t) => {
            drawRow(surf, row, x + t * (tableW + GUTTER), y, striped);
          });
          surf.box({ x, y, w, h: rowH, kind: 'row', fontSize: TYPE.body.size });
        },
      }));
    }
    return { id: `table:${k}`, atoms, legibility: 1 };
  };

  const out: Variant[] = [];
  for (let k = 1; k <= 3; k += 1) {
    const v = build(k);
    if (v) out.push(v);
  }
  return out;
}

/* ------------------------------------------------------------------ chart */

/**
 * A HORIZONTAL BAR CHART, drawn for print rather than borrowed from a chart
 * library.
 *
 * DIRECT LABELS, NO LEGEND, NO GRIDLINES, NO AXIS. Every one of those is
 * decoration that costs width the bars could use, and a legend is a lookup the
 * reader has to perform for every row. The value is printed at the end of its
 * own bar, which is the shortest path from the mark to its meaning.
 *
 * THE TAIL BECOMES CHIPS. A chart of 30 rows is not a chart, it is a list
 * pretending to be one, and shrinking 30 bars to fit is how a page becomes
 * unreadable. The top rows are drawn at full size and the remainder are named
 * in a chip row underneath — which is what the reference does, and it says so
 * out loud: "4 MORE LINES BELOW THE CUT".
 */
export function barsVariants(block: BarsBlock, ctx: BuildCtx): Variant[] {
  const { s } = ctx;
  const bars = block.bars;
  if (bars.length === 0) return [];

  const labelW = Math.min(
    52,
    Math.max(24, ...bars.map((b) => s.width(b.label, {
      size: TYPE.label.size, bold: true, track: TYPE.label.track, caps: true,
    }))) + 4,
  );
  const valueW = 16;

  const build = (cut: number, id: string, lossy: boolean): Variant => {
    const shown = bars.slice(0, cut);
    const rest = bars.slice(cut);
    const rowH = 7.4;
    const atoms: PlacedAtom[] = shown.map((b) => px({
      h: rowH,
      kind: 'bar',
      draw: (surf, x, y, w) => {
        const trackW = w - labelW - valueW;
        surf.label(surf.clip(b.label, labelW - 4, {
          size: TYPE.label.size, bold: true, caps: true,
        }), x, y + 4.2);
        surf.fill(mix(surf.p.border, surf.p.nested, 0.7));
        surf.doc.roundedRect(x + labelW, y + 2.4, trackW, 2.2, 1.1, 1.1, 'F');
        const c = b.thin
          ? semanticColor(surf.p, 'none')
          : hueColor(surf.p, b.hue ?? ctx.hue);
        surf.fill(c);
        surf.doc.roundedRect(x + labelW, y + 2.4,
          Math.max(1, trackW * clamp(b.fraction, 0, 1)), 2.2, 1.1, 1.1, 'F');
        surf.text(b.value, x + w, y + 4.4, {
          size: TYPE.body.size, bold: true, color: b.thin ? surf.p.muted : c, align: 'right',
        });
        surf.box({ x, y, w, h: rowH, kind: 'bar', fontSize: TYPE.body.size });
      },
    }));

    if (rest.length > 0) {
      const chipH = 5.4;
      const rows = Math.ceil(rest.length / 6);
      atoms.push(px({
        h: rows * (chipH + 2) + 7,
        kind: 'bar-tail',
        draw: (surf, x, y, w) => {
          surf.label(`${rest.length} more below the cut`, x, y + 3.4);
          let cx = x;
          let cy = y + 6.4;
          for (const b of rest) {
            const text = `${b.label} ${b.value}`;
            const cw = surf.chip(cx, cy, text, b.thin
              ? semanticColor(surf.p, 'none')
              : hueColor(surf.p, b.hue ?? ctx.hue));
            cx += cw + 2.4;
            if (cx > x + w - 30) { cx = x; cy += chipH + 2; }
          }
          surf.box({ x, y, w, h: rows * (chipH + 2) + 7, kind: 'bar-tail' });
        },
      }));
    }
    return { id, atoms, legibility: 1, lossy };
  };

  const out: Variant[] = [build(bars.length, 'bars:all', false)];
  // Only offer a cut when there is enough of a tail for it to save a page.
  if (bars.length > 12) out.push(build(10, 'bars:cut', true));
  return out;
}

/* ------------------------------------------------------------------ decks */

/** The type that sits under a deck's art: name, then meta. */
const DECK_CAP = lineH(TYPE.body.size) + lineH(TYPE.bodySmall.size) + 1.2;

function drawDeck(surf: Surface, d: DeckLine, x: number, y: number, w: number,
                  cardW: number, cols: number, hue: ReportHue,
                  artUrl: (c: string, v?: 'evolution' | 'hero') => string,
                  nameOf: (c: string) => string): void {
  const gap = 1.4;
  const rows = Math.ceil(Math.min(8, d.cards.length) / cols);
  const gridW = cardW * cols + gap * (cols - 1);
  const gx = x + (w - gridW) / 2;
  d.cards.slice(0, 8).forEach((card, i) => {
    surf.cardTile(
      gx + (i % cols) * (cardW + gap),
      y + Math.floor(i / cols) * (cardW / CARD_RATIO + gap),
      cardW,
      artUrl(card, d.art?.[card]),
      nameOf(card),
    );
  });
  /* THE CAPTION IS SET TO THE GRID, NOT TO THE COLUMN.

     The art is centred in its column and is often narrower than it — cards are
     capped, columns are not — so a name at the column's left edge and a rate
     right-aligned at its right edge put the two ends of one caption up to a
     hundred millimetres apart, with the deck they describe floating between
     them. Bound to the grid, the caption is the width of the thing it names. */
  const capX = gx;
  const capW = gridW;
  const capY = y + rows * (cardW / CARD_RATIO + gap) + 1.2;
  const nameStyle = { size: TYPE.body.size, bold: true as const };
  const valueW = d.value
    ? surf.width(d.value, { size: TYPE.body.size, bold: true }) + 3
    : 0;
  /* PAST ABOUT SEVENTY MILLIMETRES A RIGHT-ALIGNED VALUE STOPS BELONGING TO
     THE NAME. Two decks across a sheet gives each a 130 mm caption, and a name
     at one end with its win rate at the other is not a label, it is two labels
     that happen to share a line — the reader has to re-find which deck the
     figure was for. Under the threshold the split reads as a table row and is
     worth keeping, because it lines the figures up down the page. */
  const nameW = surf.width(surf.clip(d.name, capW - valueW, nameStyle), nameStyle);
  surf.text(surf.clip(d.name, capW - valueW, nameStyle), capX, capY + 2.6, {
    ...nameStyle, color: surf.p.text,
  });
  if (d.value) {
    const adjacent = capW > 70;
    surf.text(d.value, adjacent ? capX + nameW + 3 : capX + capW, capY + 2.6, {
      size: TYPE.body.size, bold: true, color: hueColor(surf.p, hue),
      align: adjacent ? 'left' : 'right',
    });
  }
  if (d.meta) {
    surf.text(surf.clip(d.meta, capW, { size: TYPE.bodySmall.size }), capX, capY + 6, {
      size: TYPE.bodySmall.size, color: surf.p.muted,
    });
  }
}

/**
 * DECKS. Three compositions, and the engine picks by measuring.
 *
 * The art is the content here, so every variant keeps the card above the
 * legibility floor and the choice is only ever how many decks share a row.
 * A single deck across the full width would draw 33 mm cards, which is why
 * `CARD_MAX` exists — having room is not a reason to print a playing card the
 * size of a playing card.
 */
export function decksVariants(block: DecksBlock, ctx: BuildCtx,
                              artUrl: (c: string, v?: 'evolution' | 'hero') => string,
                              nameOf: (c: string) => string): Variant[] {
  const decks = block.decks;
  if (decks.length === 0) return [];
  const out: Variant[] = [];
  const gap = SPACE.base;

  for (const perRow of [1, 2, 3]) {
    if (perRow > decks.length) break;
    const colW = (ctx.width - gap * (perRow - 1)) / perRow;
    // Eight in a row while they stay legible, 4x2 once they would not.
    const oneRow = (colW - 1.4 * 7) / 8;
    const cols = oneRow >= CARD_MIN ? 8 : 4;
    const cardW = Math.min(CARD_MAX, (colW - 1.4 * (cols - 1)) / cols);
    if (cardW < CARD_MIN) continue;
    const artRows = Math.ceil(8 / cols);
    const rowH = artRows * (cardW / CARD_RATIO + 1.4) + DECK_CAP + SPACE.snug;

    const rows: DeckLine[][] = [];
    for (let i = 0; i < decks.length; i += perRow) rows.push(decks.slice(i, i + perRow));

    out.push({
      id: `decks:${perRow}`,
      legibility: clamp(cardW / CARD_IDEAL, 0, 1),
      atoms: rows.map((row) => px({
        h: rowH,
        kind: 'deck-row',
        draw: (surf, x, y, w) => {
          const cw = (w - gap * (perRow - 1)) / perRow;
          row.forEach((d, i) => {
            const dx = x + i * (cw + gap);
            drawDeck(surf, d, dx, y, cw, cardW, cols, ctx.hue, artUrl, nameOf);
            surf.box({ x: dx, y, w: cw, h: rowH - SPACE.snug, kind: 'deck' });
          });
        },
      })),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ pairs */

/**
 * THE CARD-PAIR GRID — the component that most needed this engine.
 *
 * It shipped at a hardcoded five across in tiles 33.5 mm tall, solved by hand
 * against one page geometry. Every one of those numbers is now derived:
 * `chooseCardGrid` measures the caption, tries every column count that clears
 * the card floor, and keeps whichever lands the fewest pages at the largest
 * legible art. Hand it a half-width column and it comes back four across
 * without anybody editing a constant.
 */
export function pairsVariants(block: PairsBlock, ctx: BuildCtx,
                              artUrl: (c: string, v?: 'evolution' | 'hero') => string,
                              nameOf: (c: string) => string): Variant[] {
  const pairs = block.pairs;
  if (pairs.length === 0) return [];

  // Caption: the pair's name, then a meter.
  const capH = lineH(TYPE.bodySmall.size) + 11;

  /* THE GRID IS SOLVED ON THE CARD, NOT ON THE TILE, and the difference is a
     bug the audit caught on its first run. A tile here holds TWO cards and the
     plus between them, so bounds expressed per tile let the engine pick a
     column count whose tiles clear the floor while the CARDS inside them come
     out at 4 mm — half the legibility floor, reported 180 times on one
     document. Every bound below is therefore two cards plus the gap, and
     `rowHeight` derives the art height from the same arithmetic the drawing
     uses, so the measurement and the ink cannot disagree. */
  const PLUS = 4;
  const cardOf = (tileW: number) => (tileW - PLUS) / 2;
  const plan = chooseGrid({
    count: pairs.length,
    width: ctx.width,
    first: ctx.first,
    rest: ctx.rest,
    gap: 3.2,
    rowGap: 3.6,
    min: CARD_MIN * 2 + PLUS,
    ideal: 15 * 2 + PLUS,
    max: 19 * 2 + PLUS,
    rowHeight: (tileW) => cardOf(tileW) / CARD_RATIO + capH,
  });
  if (!plan) return [];

  // Two cards per tile, so the tile is two cards plus the plus sign.
  const rows: typeof pairs[] = [];
  let seen = 0;
  for (const n of plan.rows) { rows.push(pairs.slice(seen, seen + n)); seen += n; }

  const tileGap = 3.2;
  const rowH = plan.rowH;

  return [{
    id: `pairs:${plan.cols}`,
    legibility: plan.legibility,
    atoms: rows.map((row) => px({
      h: rowH + 3.6,
      kind: 'pair-row',
      draw: (surf, x, y, w) => {
        const tileW = (w - tileGap * (plan.cols - 1)) / plan.cols;
        row.forEach((pr, i) => {
          const tx = x + i * (tileW + tileGap);
          // Two cards, centred, with a plus between them.
          const cardW = cardOf(Math.min(tileW, plan.itemW));
          const cardH = cardW / CARD_RATIO;
          const pairW = cardW * 2 + PLUS;
          const px0 = tx + (tileW - pairW) / 2;
          surf.cardTile(px0, y, cardW, artUrl(pr.a, pr.artA), nameOf(pr.a));
          surf.cardTile(px0 + cardW + PLUS, y, cardW, artUrl(pr.b, pr.artB), nameOf(pr.b));
          surf.text('+', px0 + cardW + PLUS / 2, y + cardH / 2 + 1, {
            size: 7, bold: true, color: surf.p.muted, align: 'center',
          });
          let cy = y + cardH + 3.2;
          if (pr.meta) {
            surf.text(surf.clip(pr.meta, tileW, { size: TYPE.bodySmall.size }), tx, cy, {
              size: TYPE.bodySmall.size, color: surf.p.muted,
            });
            cy += 3.2;
          }
          if (pr.value) {
            const rate = Number.parseFloat(pr.value);
            const sem = semanticOf(Number.isNaN(rate) ? null : rate);
            surf.meter(tx, cy + 1, tileW, {
              label: pr.valueNote ?? 'WIN RATE',
              value: pr.value,
              fraction: Number.isNaN(rate) ? 0 : rate / 100,
              color: semanticColor(surf.p, sem),
            });
          }
          surf.box({ x: tx, y, w: tileW, h: rowH, kind: 'pair' });
        });
      },
    })),
  }];
}

/* ----------------------------------------------------------------- series */

/**
 * A DUEL SERIES. Your loadout, the score, theirs.
 *
 * THE TWO SIDES ARE STACKED, NOT FACED, AND THAT IS AN A4 DECISION MADE BY
 * MEASUREMENT.
 *
 * The obvious composition is the one the screen uses and the one the reference
 * document prints: your three decks on the left, theirs on the right, the
 * score between. It was built first and the audit refused it — on A4 landscape
 * a side gets 111 mm, three decks share it at 35 mm each, and a 4x2 grid inside
 * 35 mm is a 7.9 mm card, under the legibility floor. The reference gets away
 * with facing them because its page is 513 mm wide; ours is 297.
 *
 * So the sides stack: your three decks across the FULL width, the score strip,
 * then theirs. Each deck is one row of eight rather than 4x2, because at 85 mm
 * a column that is the shape that makes the card biggest — 9.6 mm against 7.8.
 * The comparison survives, because the two loadouts are still adjacent and
 * still on one sheet; what is given up is left-and-right, which was never the
 * thing being compared.
 *
 * A SERIES WITH NO STORED OPPONENT IS ONE ROW, NOT A HALF-EMPTY ONE. On a real
 * account nine duels in ten are native rows carrying one loadout and no
 * per-game opponent, so a faced layout printed a grey plate repeating one
 * sentence twenty times over. With nothing to face, the three decks simply
 * take the width, and the reason is said once in the block note.
 */
export function seriesVariants(block: SeriesBlock, ctx: BuildCtx,
                               artUrl: (c: string, v?: 'evolution' | 'hero') => string,
                               nameOf: (c: string) => string): Variant[] {
  const rows = block.rows;
  if (rows.length === 0) return [];

  const PAD = 4;
  const DECK_GAP = 3;
  const CARD_GAP = 1.2;
  const capH = lineH(TYPE.bodySmall.size) + 1.6;
  const headH = 6.4;

  /** One side's decks, laid across `w`. Returns the height drawn. */
  const sideHeight = (cardW: number, cols: number) =>
    Math.ceil(8 / cols) * (cardW / CARD_RATIO + CARD_GAP) + capH;

  const drawSide = (surf: Surface, side: DeckLine[], x: number, w: number, y: number,
                    cardW: number, cols: number, accent: RGB): void => {
    const n = Math.max(1, side.length);
    const dw = (w - DECK_GAP * (n - 1)) / n;
    side.forEach((d, i) => {
      const dx = x + i * (dw + DECK_GAP);
      const gridW = cardW * cols + CARD_GAP * (cols - 1);
      const gx = dx + Math.max(0, (dw - gridW) / 2);
      d.cards.slice(0, 8).forEach((card, ci) => {
        surf.cardTile(
          gx + (ci % cols) * (cardW + CARD_GAP),
          y + Math.floor(ci / cols) * (cardW / CARD_RATIO + CARD_GAP),
          cardW, artUrl(card, d.art?.[card]), nameOf(card),
        );
      });
      const artH = Math.ceil(8 / cols) * (cardW / CARD_RATIO + CARD_GAP);
      const label = d.value ? `${d.name}  ${d.value}` : d.name;
      surf.text(surf.clip(label, dw, { size: TYPE.bodySmall.size, bold: true, caps: true }),
        dx, y + artH + 2.6, {
          size: TYPE.bodySmall.size, bold: true, track: 0.3, color: accent, caps: true,
        });
    });
  };

  /** The score, drawn as its own strip between the two sides. */
  const drawScore = (surf: Surface, r: SeriesBlock['rows'][0], x: number, y: number,
                     w: number): void => {
    const c = r.won ? surf.p.green : surf.p.red;
    surf.stroke(mix(surf.p.border, surf.p.nested, 0.4));
    surf.doc.setLineWidth(0.25);
    surf.doc.line(x, y + 2, x + w, y + 2);
    if (!r.score) return;
    const parts = [r.score, r.caption].filter(Boolean);
    const scoreW = surf.width(parts[0], { size: 9, bold: true });
    const capW = parts[1] ? surf.width(parts[1], { size: 5, bold: true, track: 0.4, caps: true }) + 3 : 0;
    const total = scoreW + capW;
    const sx = x + (w - total) / 2;
    surf.fill(surf.p.nested);
    surf.doc.rect(sx - 4, y - 1.4, total + 8, 6.6, 'F');
    surf.text(r.score, sx, y + 3.4, { size: 9, bold: true, color: c });
    if (parts[1]) {
      surf.text(parts[1], sx + scoreW + 3, y + 3.2, {
        size: 5, bold: true, track: 0.4, color: c, caps: true,
      });
    }
  };

  const build = (cols: number, shrink: number, id: string): Variant | null => {
    const inner = ctx.width - PAD * 2;
    const deckW = (inner - DECK_GAP * 2) / 3;
    const cardW = Math.min(CARD_MAX, (deckW - CARD_GAP * (cols - 1)) / cols) * shrink;
    if (cardW < CARD_MIN) return null;
    const side = sideHeight(cardW, cols);

    const atoms: PlacedAtom[] = rows.map((r) => {
      const solo = r.right.length === 0;
      const h = headH + side + (solo ? 0 : 6.6 + side) + PAD + SPACE.snug;
      return px({
        h,
        kind: 'series',
        draw: (surf, x, y, w) => {
          const boxH = h - SPACE.snug;
          surf.module(x, y, w, boxH, { kind: 'series' });
          surf.label(r.leftLabel, x + PAD, y + 4.4, { color: surf.p.blue });

          // The format, date and — when the sides are stacked — the result all
          // sit on the header line, which is the only place they are equally
          // near both loadouts.
          const meta = [r.format, r.date].filter(Boolean).join('  //  ');
          surf.label(meta, x + w / 2, y + 4.4, { align: 'center' });
          if (solo) {
            if (r.score) {
              surf.text(r.score, x + w - PAD, y + 4.8, {
                size: 8, bold: true, align: 'right',
                color: r.won ? surf.p.green : surf.p.red,
              });
            }
          } else {
            surf.label(r.rightLabel, x + w - PAD, y + 4.4,
              { color: surf.p.red, align: 'right' });
          }

          drawSide(surf, r.left, x + PAD, w - PAD * 2, y + headH, cardW, cols, surf.p.muted);
          if (!solo) {
            const scoreY = y + headH + side;
            drawScore(surf, r, x + PAD, scoreY, w - PAD * 2);
            drawSide(surf, r.right, x + PAD, w - PAD * 2, scoreY + 6.6,
                     cardW, cols, surf.p.muted);
          } else if (r.rightNote) {
            // Said once in the block note, not twenty times on the page.
            void r.rightNote;
          }
        },
      });
    });
    return { id, atoms, legibility: clamp(cardW / CARD_IDEAL, 0, 1) };
  };

  const out: Variant[] = [];
  /* THREE THINGS ARE OFFERED, AND THE ENGINE MEASURES ALL THREE.

     Eight across is the shape that makes the card biggest at this width; 4x2
     is offered because in a narrower column it wins instead. The SHRUNK arm is
     the one that matters most on a real duel history: at full size a series
     row stands 55 mm and two fit a sheet, leaving 46 mm of nothing, while at
     0.86 it stands 49 and three fit — nine series over three sheets instead of
     five. The card goes 9.7 mm to 8.3, still clear of the floor.

     This is exactly the trade the brief asks for and the reason it is offered
     rather than chosen: whether a fifth of a millimetre of card is worth two
     sheets depends on how many series there are, which only the packer knows. */
  for (const [cols, shrink] of [[8, 1], [8, 0.86], [4, 1]] as const) {
    const v = build(cols, shrink, `series:${cols}${shrink < 1 ? '-compact' : ''}`);
    if (v) out.push(v);
  }
  return out;
}

/* ----------------------------------------------------------------- matrix */

export function matrixVariants(block: MatrixBlock, ctx: BuildCtx): Variant[] {
  const { s, width } = ctx;
  if (block.rows.length === 0) return [];
  const labelW = Math.min(60, Math.max(30, ...block.rows.map((r) =>
    s.width(r.label, { size: TYPE.bodySmall.size, bold: true }))) + 6);
  const cellW = (width - labelW) / Math.max(1, block.columns.length);
  const cellH = 9;

  const atoms: PlacedAtom[] = [
    px({
      h: 12,
      keepWithNext: true,
      kind: 'columns',
      draw: (surf, x, y, w) => {
        block.columns.forEach((c, i) => {
          surf.label(surf.clip(c.label, cellW - 2, {
            size: TYPE.label.size, bold: true, caps: true,
          }), x + labelW + i * cellW + cellW / 2, y + 6, { align: 'center' });
        });
        surf.box({ x, y, w, h: 12, kind: 'columns', fontSize: TYPE.label.size });
      },
    }),
  ];

  block.rows.forEach((r) => {
    atoms.push(px({
      h: cellH + 1,
      kind: 'matrix-row',
      draw: (surf, x, y, w) => {
        surf.text(surf.clip(r.label, labelW - 4, { size: TYPE.bodySmall.size, bold: true }),
          x, y + 6, { size: TYPE.bodySmall.size, bold: true, color: surf.p.text });
        r.cells.forEach((cell, i) => {
          const cxx = x + labelW + i * cellW;
          if (cell.fraction === null) {
            /* AN EMPTY CELL WITH A RULE THROUGH IT, never a cold one. No
               evidence is not a bad matchup, and painting it at the bottom of
               the scale ranks it below a measured loss — backwards. */
            surf.stroke(surf.p.border);
            surf.doc.setLineWidth(0.25);
            surf.doc.roundedRect(cxx + 0.6, y, cellW - 1.2, cellH, 1, 1, 'D');
            surf.alpha(0.6, () => surf.doc.line(
              cxx + 2.4, y + cellH - 2.4, cxx + cellW - 2.4, y + 2.4));
          } else {
            const sem = semanticOf(cell.fraction * 100, cell.thin);
            const c = semanticColor(surf.p, sem);
            surf.fill(mix(c, surf.p.nested, 0.2 + 0.55 * clamp(cell.fraction, 0, 1)));
            surf.doc.roundedRect(cxx + 0.6, y, cellW - 1.2, cellH, 1, 1, 'F');
            surf.text(cell.text, cxx + cellW / 2, y + 5.8, {
              size: TYPE.bodySmall.size, bold: true,
              color: surf.p.dark ? surf.p.text : surf.p.onSolid, align: 'center',
            });
          }
        });
        surf.box({ x, y, w, h: cellH + 1, kind: 'matrix-row', fontSize: TYPE.bodySmall.size });
      },
    }));
  });

  if (block.legend) {
    atoms.push(px({
      h: 6,
      kind: 'legend',
      draw: (surf, x, y, w) => {
        surf.text(block.legend as string, x, y + 3.4,
          { size: TYPE.bodySmall.size, color: surf.p.muted });
        surf.box({ x, y, w, h: 6, kind: 'legend' });
      },
    }));
  }
  return [{ id: 'matrix', atoms, legibility: 1 }];
}

/* ----------------------------------------------------------------- spread */

export function spreadVariants(block: SpreadBlock): Variant[] {
  const segs = block.segments;
  if (segs.length === 0) return [];
  const barH = 9;
  const legendRows = Math.ceil(segs.length / 4);
  const h = barH + legendRows * 5.4 + SPACE.snug;
  const HUES: ReportHue[] = ['blue', 'violet', 'green', 'pink', 'red'];
  return [{
    id: 'spread',
    legibility: 1,
    atoms: [px({
      h,
      kind: 'spread',
      draw: (surf, x, y, w) => {
        const total = segs.reduce((s2, g) => s2 + g.share, 0) || 100;
        let sx = x;
        segs.forEach((g, i) => {
          const sw = (w * g.share) / total;
          surf.fill(hueColor(surf.p, g.hue ?? HUES[i % HUES.length], true));
          surf.doc.rect(sx, y, Math.max(0.6, sw - 0.4), barH, 'F');
          sx += sw;
        });
        segs.forEach((g, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const lx = x + col * (w / 4);
          const ly = y + barH + 4 + row * 5.4;
          surf.fill(hueColor(surf.p, g.hue ?? HUES[i % HUES.length], true));
          surf.doc.circle(lx + 1.2, ly - 1.2, 1.2, 'F');
          surf.text(surf.clip(`${g.label} ${g.share.toFixed(0)}%`, w / 4 - 8,
            { size: TYPE.bodySmall.size }), lx + 4, ly,
            { size: TYPE.bodySmall.size, color: surf.p.text });
        });
        surf.box({ x, y, w, h, kind: 'spread' });
      },
    })],
  }];
}

/* ----------------------------------------------------------------- versus */

export function versusVariants(block: VersusBlock, ctx: BuildCtx,
                               artUrl: (c: string, v?: 'evolution' | 'hero') => string,
                               nameOf: (c: string) => string): Variant[] {
  const pairs = block.pairs;
  if (pairs.length === 0) return [];
  const out: Variant[] = [];
  const gutter = 16;

  for (const perPage of [1, 2]) {
    const rowW = ctx.width;
    const sideW = (rowW - gutter) / 2;
    const cols = 8;
    const cardW = Math.min(CARD_MAX, (sideW - 4 - 1.4 * (cols - 1)) / cols);
    if (cardW < CARD_MIN) continue;
    const cardH = cardW / CARD_RATIO;
    const plateH = 12 + cardH + DECK_CAP;
    const rowH = plateH + SPACE.base;
    if (perPage === 2 && rowH * 2 > ctx.rest) continue;

    out.push({
      id: `versus:${perPage}`,
      legibility: clamp(cardW / CARD_IDEAL, 0, 1),
      atoms: pairs.map((pr) => px({
        h: rowH,
        kind: 'versus',
        draw: (surf, x, y, w) => {
          const sw = (w - gutter) / 2;
          const plate = (d: DeckLine | null, px1: number, hue: ReportHue) => {
            /* THE SIDE'S HUE IS AN EDGE, NOT AN OUTLINE. At full saturation
               the border competes with 122 card palettes inside it and the
               plate reads as a warning box; mixed most of the way back to the
               neutral border it still says which side this is, and the cap
               along the top carries the colour at full strength where nothing
               is sitting on it. */
            const side = hueColor(surf.p, hue, true);
            surf.module(px1, y, sw, plateH, {
              accent: mix(side, surf.p.border, 0.35), cap: true, kind: 'plate',
            });
            surf.fill(side);
            surf.doc.roundedRect(px1, y, sw, 1.4, 0.7, 0.7, 'F');
            if (!d) {
              surf.text(surf.clip(block.emptyNote ?? 'Nothing recorded', sw - 10,
                { size: TYPE.bodySmall.size }), px1 + sw / 2, y + plateH / 2, {
                  size: TYPE.bodySmall.size, color: surf.p.muted, align: 'center',
                });
              return;
            }
            surf.text(surf.clip(d.name, sw - 30, { size: TYPE.body.size, bold: true }),
              px1 + 3, y + 8, { size: TYPE.body.size, bold: true, color: surf.p.text });
            if (d.value) {
              surf.text(d.value, px1 + sw - 3, y + 8, {
                size: TYPE.body.size, bold: true,
                color: hueColor(surf.p, hue), align: 'right',
              });
            }
            const gridW = cardW * cols + 1.4 * (cols - 1);
            const gx = px1 + (sw - gridW) / 2;
            d.cards.slice(0, 8).forEach((card, i) => {
              surf.cardTile(gx + i * (cardW + 1.4), y + 12, cardW,
                artUrl(card, d.art?.[card]), nameOf(card));
            });
            if (d.meta) {
              surf.text(surf.clip(d.meta, sw - 6, { size: TYPE.bodySmall.size }),
                px1 + 3, y + 12 + cardH + 4,
                { size: TYPE.bodySmall.size, color: surf.p.muted });
            }
          };
          plate(pr.left, x, 'blue');
          plate(pr.right, x + sw + gutter, 'red');
          surf.text('VS', x + sw + gutter / 2, y + plateH / 2 + 2, {
            size: 11, bold: true, color: surf.p.muted, align: 'center',
          });
        },
      })),
    });
  }
  return out;
}

/* ---------------------------------------------------------------- divider */

/** A section title sheet. Its own page, always — that is what makes a long
 *  document navigable, and what the contents page is built from. */
export function dividerAtom(block: DividerBlock, ctx: BuildCtx): PlacedAtom {
  const { s, width } = ctx;
  const subLines = block.subtitle
    ? s.wrap(block.subtitle, width * 0.7, { size: TYPE.body.size })
    : [];
  /* MEASURED FROM WHERE THE CONTENT ACTUALLY ENDS. A flat reserve was 25 mm
     taller than the ink, and because a divider shares its sheet with the
     section's first block, every one of those millimetres printed as a gap
     between the title's own figures and the block underneath them. */
  const TOP = 38;
  const subH = subLines.length * lineH(TYPE.body.size);
  const statsH = block.stats?.length ? 22 : 0;
  const h = TOP + subH + statsH + SPACE.base;
  return px({
    h,
    kind: 'divider',
    draw: (surf, x, y, w) => {
      const accent = hueColor(surf.p, block.hue ?? ctx.hue);
      surf.fill(accent);
      surf.doc.rect(x, y + 6, 22, 1, 'F');
      if (block.tag) {
        surf.label(block.tag, x, y + 16, { color: accent });
      }
      surf.text(block.title, x, y + 30, {
        size: 24, bold: true, track: 1, color: surf.p.text, caps: true,
      });
      let cy = y + 36;
      for (const ln of subLines) {
        surf.text(ln, x, cy, { size: TYPE.body.size, color: surf.p.muted });
        cy += lineH(TYPE.body.size);
      }
      if (block.stats?.length) {
        /* CAPPED, or two figures share a sheet's width and each gets 132 mm of
           rule to itself — a KPI reads as one object and stops looking like
           one somewhere around sixty millimetres. */
        const gap = SPACE.base;
        const cw = Math.min(62, (w - gap * (block.stats.length - 1)) / block.stats.length);
        block.stats.forEach((t, i) => {
          surf.kpi(x + i * (cw + gap), cy + 4, cw, {
            label: t.label, value: t.value, note: t.note, accent, nested: true,
          });
        });
      }
      surf.box({ x, y, w, h, kind: 'divider' });
    },
  });
}

/* ------------------------------------------------------------- dispatcher */

export interface BuildDeps {
  artUrl: (c: string, v?: 'evolution' | 'hero') => string;
  nameOf: (c: string) => string;
}

/** Every variant a block can be drawn as, measured against `ctx`. */
export function buildVariants(block: ReportBlock, ctx: BuildCtx, deps: BuildDeps): Variant[] {
  switch (block.kind) {
    case 'stats': return statsVariants(block.tiles, ctx);
    case 'table': return tableVariants(block, ctx);
    case 'bars': return barsVariants(block, ctx);
    case 'decks': return decksVariants(block, ctx, deps.artUrl, deps.nameOf);
    case 'pairs': return pairsVariants(block, ctx, deps.artUrl, deps.nameOf);
    case 'series': return seriesVariants(block, ctx, deps.artUrl, deps.nameOf);
    case 'matrix': return matrixVariants(block, ctx);
    case 'spread': return spreadVariants(block);
    case 'versus': return versusVariants(block, ctx, deps.artUrl, deps.nameOf);
    case 'note': return [{
      id: 'note', legibility: 1, atoms: noteAtoms(ctx.s, block.body, ctx.width),
    }];
    default: return [];
  }
}

export type { RGB };
