/**
 * THE COMPONENTS — each block kind turned into ATOMS that know their own
 * height before anything is drawn.
 *
 * An atom is the unit that may not split across a page: a table row, a row of
 * deck cards, one duel series. `pack.ts` decides where each lands; the atom
 * draws itself there. Measuring happens here, against the real embedded
 * fonts, so a height is never a guess.
 *
 * SIZING RULE, and the reason for most constants below: things are drawn at
 * the size the WEBSITE draws them relative to its column, not at the largest
 * size that fits. The complaint that started this engine was fonts and card
 * art far bigger than the site's; spare width is left as air.
 */

import { getDeckLinkFromKeys } from '../deckLink';
import type {
  BarsBlock, BattlesBlock, CardGridBlock, DeckLine, DecksBlock, DividerBlock, MatrixBlock,
  NoteBlock, PairsBlock, ReportBlock, ReportHue, SeriesBlock, SpreadBlock, StatsBlock,
  TableBlock, TableCell, TableColumn, TrendBlock, VersusBlock,
} from '../analyticsReport';
import { cardName, type Form } from './art';
import {
  BLOCK_GAP, BODY_H, PT, ROW_GAP, TYPE, cardH, cardWidthFor, columnWidth, stripWidth,
} from './geometry';
import type { PackItem } from './pack';
import { CAP, Surface, type TextStyle } from './surface';
import {
  HUES, P, SERIES, contrast, heat, hue, mix, parsePct, rateColor, type HueName, type RGB,
} from './theme';

export interface Atom extends PackItem {
  draw: (s: Surface, x: number, y: number, w: number) => void;
  drawCont?: (s: Surface, x: number, y: number, w: number) => void;
  /** An outline / contents entry, recorded on the page this lands on. */
  mark?: { title: string; depth: 0 | 1; contents: boolean };
  /** From the page this opens, the running header title and plate hue. */
  section?: { title: string; hue: HueName };
}

export interface BlockCtx {
  s: Surface;
  /** Content width. */
  w: number;
  /** The document's hue, used where a block names none. */
  hue: HueName;
}

const asHue = (h: ReportHue | undefined, fallback: HueName): HueName => (h ?? fallback) as HueName;

/** Baseline for type whose capitals start at `top`. */
const base = (top: number, size: number) => top + size * PT * CAP;

const CONT_H = 7.6;

/* ================================================================ heading */

function contHeading(title: string, extra?: (s: Surface, x: number, y: number, w: number) => void) {
  return (s: Surface, x: number, y: number, w: number) => {
    const size = 11;
    const t = s.text(title, x, base(y + 0.6, size), {
      role: 'display', size, track: 0.22, caps: true, color: P.text2,
    });
    s.label('continued', x + t + 3, base(y + 1.6, TYPE.label.size), { color: P.text3 });
    extra?.(s, x, y + CONT_H, w);
  };
}

/**
 * A block heading: a gradient tick in the section's hue, the title in Bebas,
 * and at most two lines of note under it. Kept with the block's first atom.
 */
function heading(ctx: BlockCtx, title: string, note: string | undefined, h: HueName): Atom {
  const { s, w } = ctx;
  const T = TYPE.heading;
  const capH = T.size * PT * CAP;
  const noteStyle: TextStyle = { size: TYPE.small.size, color: P.text2 };
  const lines = note ? s.wrap(note, w - 4, noteStyle, 2) : [];
  const step = noteStyle.size * PT * 1.3;
  const height = capH + (lines.length ? 2.2 + noteStyle.size * PT * CAP + (lines.length - 1) * step : 0) + 1.4;
  return {
    h: height,
    gap: BLOCK_GAP,
    keep: true,
    mark: { title, depth: 1, contents: false },
    draw: (sf, x, y) => {
      sf.gradient(x, y - 0.3, 1.2, capH + 0.6, 0.6, hue(h).ink, hue(h).deep, 'v', 6);
      sf.text(title, x + 3.4, y + capH, {
        role: 'display', size: T.size, track: T.track, caps: true, color: P.text,
      });
      lines.forEach((ln, i) => {
        sf.text(ln, x + 3.4, y + capH + 2.2 + noteStyle.size * PT * CAP + i * step, noteStyle);
      });
    },
  };
}

/** Attach the heading's continuation to every atom after the first. */
function withCont(atoms: Atom[], title: string | undefined, extraH = 0,
  extra?: (s: Surface, x: number, y: number, w: number) => void): Atom[] {
  if (!title) return atoms;
  const draw = contHeading(title, extra);
  atoms.forEach((a, i) => {
    if (i === 0) return;
    a.contH = CONT_H + extraH;
    a.drawCont = draw;
  });
  return atoms;
}

/** Heading (if any) + body atoms, with the first body atom's gap folded in. */
function titled(ctx: BlockCtx, b: { heading?: string; note?: string }, h: HueName, body: Atom[],
  extraH = 0, extra?: (s: Surface, x: number, y: number, w: number) => void): Atom[] {
  if (!body.length) return [];
  withCont(body, b.heading, extraH, extra);
  if (!b.heading) {
    body[0].gap = BLOCK_GAP;
    return body;
  }
  body[0].gap = 3;
  return [heading(ctx, b.heading, b.note, h), ...body];
}

/* ================================================================== stats */

export const TILE_H = 18;

export function drawTile(s: Surface, x: number, y: number, w: number, t: StatsBlock['tiles'][number], h: HueName) {
  s.panel(x, y, w, TILE_H, { kind: 'kpi' });
  const c = hue(asHue(t.hue, h));
  s.clipTo(x, y, w, TILE_H, 2.6, () => s.gradient(x, y, 1.3, TILE_H, 0, c.ink, c.deep, 'v'));
  const inner = w - 7;
  s.label(s.clip(t.label, inner, { role: 'bodyBold', size: TYPE.label.size, track: TYPE.label.track, caps: true }),
    x + 4.4, y + 5.4);
  let size: number = TYPE.figure.size;
  while (size > 11 && s.width(t.value, { role: 'display', size, track: 0.1 }) > inner) size -= 1;
  s.text(s.clip(t.value, inner, { role: 'display', size, track: 0.1 }), x + 4.4, y + 12.9, {
    role: 'display', size, track: 0.1, color: t.hue ? c.ink : P.text,
  });
  if (t.note) {
    s.text(s.clip(t.note, inner, { size: 5.8 }), x + 4.4, y + 16.1, { size: 5.8, color: P.text3 });
  }
}

export function statsAtoms(ctx: BlockCtx, b: StatsBlock, hueName: HueName): Atom[] {
  const tiles = b.tiles;
  if (!tiles.length) return [];
  const per = Math.min(6, tiles.length);
  const rows: StatsBlock['tiles'][] = [];
  for (let i = 0; i < tiles.length; i += per) rows.push(tiles.slice(i, i + per));
  const gap = 3;
  const body = rows.map((row): Atom => ({
    h: TILE_H,
    gap: ROW_GAP,
    draw: (s, x, y, w) => {
      const tw = columnWidth(w, per, gap);
      row.forEach((t, i) => drawTile(s, x + i * (tw + gap), y, tw, t, hueName));
    },
  }));
  return titled(ctx, b, hueName, body);
}

/* =================================================================== read */

export function readAtom(ctx: BlockCtx, text: string, hueName: HueName): Atom {
  const { s, w } = ctx;
  const style: TextStyle = { size: 7.4, color: P.text };
  const lead = 24;
  const lines = s.wrap(text, w - lead - 8, style, 2);
  const h = Math.max(10, 5.6 + lines.length * 7.4 * PT * 1.3);
  return {
    h,
    gap: 3,
    draw: (sf, x, y, ww) => {
      sf.panel(x, y, ww, h, { fill: mix(P.panel, hue(hueName).deep, 0.1), kind: 'read' });
      sf.clipTo(x, y, ww, h, 2.6, () => sf.gradient(x, y, 1.3, h, 0, hue(hueName).ink, hue(hueName).deep, 'v'));
      sf.label('The read', x + 5, base(y + (h - 7.4 * PT * CAP) / 2, 5.4) - 0.2, { color: hue(hueName).ink });
      const top = y + (h - (lines.length - 1) * 7.4 * PT * 1.3 - 7.4 * PT * CAP) / 2;
      lines.forEach((ln, i) => sf.text(ln, x + lead, base(top, 7.4) + i * 7.4 * PT * 1.3, style));
    },
  };
}

/* ================================================================== table */

const ROW_H = 6.2;
const CELL_PAD = 2.2;
const cellStyle: TextStyle = { size: 6.8, color: P.text };
const headStyle: TextStyle = { role: 'bodyBold', size: TYPE.label.size, track: TYPE.label.track, caps: true, color: P.text2 };

function cellOf(v: TableCell | string | undefined): TableCell {
  if (v === undefined) return { text: '' };
  return typeof v === 'string' ? { text: v } : v;
}

function naturalWidths(s: Surface, b: TableBlock): number[] {
  return b.columns.map((c) => {
    let w = s.width(c.label, headStyle);
    for (const r of b.rows) {
      const cell = cellOf(r[c.key]);
      w = Math.max(w, s.width(cell.text, cellStyle) + (cell.bar !== undefined ? 16 : 0));
    }
    return w + CELL_PAD * 2;
  });
}

/** Column widths for a table `w` wide. Fixed widths are honoured and flex
 *  columns share the rest; a table with no flex column stretches all. */
function solveColumns(cols: TableColumn[], natural: number[], w: number, useNatural: boolean): number[] {
  if (useNatural) {
    const sum = natural.reduce((a, b) => a + b, 0);
    return natural.map((n) => (n / sum) * w);
  }
  const fixed = cols.reduce((a, c) => a + (c.flex ? 0 : c.width ?? 0), 0);
  const flexCols = cols.filter((c) => c.flex || !c.width);
  const room = Math.max(0, w - fixed);
  if (!flexCols.length) return cols.map((c) => ((c.width ?? 0) / fixed) * w);
  const flexNat = cols.map((c, i) => (c.flex || !c.width ? natural[i] : 0));
  const flexSum = flexNat.reduce((a, b) => a + b, 0) || 1;
  return cols.map((c, i) => (c.flex || !c.width ? (flexNat[i] / flexSum) * room : c.width as number));
}

function drawTableHeader(s: Surface, x: number, y: number, cols: TableColumn[], widths: number[]) {
  const w = widths.reduce((a, b) => a + b, 0);
  s.round(x, y, w, ROW_H, 1.8, P.panelHi);
  s.rect(x, y + ROW_H / 2, w, ROW_H / 2, P.panelHi);
  let cx = x;
  cols.forEach((c, i) => {
    const cw = widths[i];
    const t = s.clip(c.label, cw - CELL_PAD * 2, headStyle);
    const ty = base(y + (ROW_H - headStyle.size * PT * CAP) / 2, headStyle.size);
    if (c.align === 'right') s.text(t, cx + cw - CELL_PAD, ty, { ...headStyle, caps: false, align: 'right' });
    else s.text(t, cx + CELL_PAD, ty, { ...headStyle, caps: false });
    cx += cw;
  });
}

function drawTableRow(s: Surface, x: number, y: number, cols: TableColumn[], widths: number[],
  row: TableBlock['rows'][number], last: boolean, hueName: HueName) {
  const w = widths.reduce((a, b) => a + b, 0);
  if (last) {
    s.round(x, y, w, ROW_H, 1.8, P.panel);
    s.rect(x, y, w, ROW_H / 2, P.panel);
  } else {
    s.rect(x, y, w, ROW_H, P.panel);
    s.line(x + 1.5, y + ROW_H, x + w - 1.5, y + ROW_H, P.line, 0.14);
  }
  let cx = x;
  cols.forEach((c, i) => {
    const cw = widths[i];
    const cell = cellOf(row[c.key]);
    const color = cell.thin ? P.text3 : cell.hue ? hue(cell.hue as HueName).ink : P.text;
    const ty = base(y + (ROW_H - cellStyle.size * PT * CAP) / 2, cellStyle.size);
    let text = cell.text;
    const avail = cw - CELL_PAD * 2;
    if (cell.bar !== undefined) {
      const tw = Math.min(s.width(text, cellStyle), avail * 0.55);
      text = s.clip(text, tw + 0.1, cellStyle);
      const mw = Math.max(4, avail - tw - 2.4);
      const my = y + ROW_H / 2 - 0.7;
      if (c.align === 'right') {
        s.meter(cx + CELL_PAD, my, mw, 1.4, cell.bar, cell.thin ? P.text3 : hue(asHue(cell.hue, hueName)).ink);
        s.text(text, cx + cw - CELL_PAD, ty, { ...cellStyle, color, align: 'right' });
      } else {
        s.text(text, cx + CELL_PAD, ty, { ...cellStyle, color });
        s.meter(cx + CELL_PAD + tw + 2.4, my, mw, 1.4, cell.bar, cell.thin ? P.text3 : hue(asHue(cell.hue, hueName)).ink);
      }
    } else {
      text = s.clip(text, avail, cellStyle);
      if (c.align === 'right') s.text(text, cx + cw - CELL_PAD, ty, { ...cellStyle, color, align: 'right' });
      else s.text(text, cx + CELL_PAD, ty, { ...cellStyle, color });
    }
    cx += cw;
  });
}

export function tableAtoms(ctx: BlockCtx, b: TableBlock, hueName: HueName): Atom[] {
  const { s, w } = ctx;
  if (!b.rows.length) return [];
  const natural = naturalWidths(s, b);
  const natSum = natural.reduce((a, c) => a + c, 0);
  const gutter = 6;
  const half = (w - gutter) / 2;
  const twoUp = b.rows.length > 14 && natSum <= half;
  const tw = twoUp ? half : w;
  const widths = solveColumns(b.columns, natural, tw, twoUp || natSum > w);
  const header = (sf: Surface, x: number, y: number) => {
    drawTableHeader(sf, x, y, b.columns, widths);
    if (twoUp) drawTableHeader(sf, x + half + gutter, y, b.columns, widths);
  };
  const lines: TableBlock['rows'][] = [];
  const step = twoUp ? 2 : 1;
  for (let i = 0; i < b.rows.length; i += step) lines.push(b.rows.slice(i, i + step));
  const body: Atom[] = [{
    h: ROW_H,
    gap: 0,
    keep: true,
    draw: (sf, x, y) => header(sf, x, y),
  }];
  lines.forEach((pair, li) => {
    const last = li === lines.length - 1;
    body.push({
      h: ROW_H,
      gap: 0,
      draw: (sf, x, y) => {
        drawTableRow(sf, x, y, b.columns, widths, pair[0], last, hueName);
        if (pair[1]) drawTableRow(sf, x + half + gutter, y, b.columns, widths, pair[1], last, hueName);
      },
    });
  });
  // A continuation repeats the column header under the heading.
  const atoms = titled(ctx, b, hueName, body, ROW_H, (sf, x, y) => header(sf, x, y));
  const headIdx = b.heading ? 1 : 0;
  atoms[headIdx].contH = undefined;
  atoms[headIdx].drawCont = undefined;
  if (!b.heading) {
    // No heading to repeat: a spill still gets its column header back.
    atoms.slice(headIdx + 1).forEach((a) => {
      a.contH = ROW_H;
      a.drawCont = (sf, x, y) => header(sf, x, y);
    });
  }
  return atoms;
}

/* =================================================================== bars */

const BAR_ROW = 6;

export function barsAtoms(ctx: BlockCtx, b: BarsBlock, hueName: HueName): Atom[] {
  const { w } = ctx;
  if (!b.bars.length) return [];
  const twoUp = b.bars.length > 12;
  const gutter = 6;
  const cw = twoUp ? (w - gutter) / 2 : w;
  const labelStyle: TextStyle = { size: 6.8, color: P.text };
  const valueStyle: TextStyle = { role: 'bodyBold', size: 6.8, color: P.text };
  const drawBar = (s: Surface, x: number, y: number, bar: BarsBlock['bars'][number], last: boolean) => {
    if (last) { s.round(x, y, cw, BAR_ROW, 1.8, P.panel); s.rect(x, y, cw, BAR_ROW / 2, P.panel); } else {
      s.rect(x, y, cw, BAR_ROW, P.panel);
      s.line(x + 1.5, y + BAR_ROW, x + cw - 1.5, y + BAR_ROW, P.line, 0.14);
    }
    const lw = cw * (twoUp ? 0.36 : 0.3);
    const ty = base(y + (BAR_ROW - 6.8 * PT * CAP) / 2, 6.8);
    s.text(s.clip(bar.label, lw - 3, labelStyle), x + CELL_PAD, ty, { ...labelStyle, color: bar.thin ? P.text3 : P.text });
    const vw = 16;
    s.text(bar.value, x + cw - CELL_PAD, ty, { ...valueStyle, align: 'right', color: bar.thin ? P.text3 : P.text });
    const tx = x + lw;
    const tw = cw - lw - vw - CELL_PAD;
    const th = 2.2;
    const tyTop = y + (BAR_ROW - th) / 2;
    s.round(tx, tyTop, tw, th, th / 2, mix(P.slot, P.line, 0.5));
    const f = Math.max(0, Math.min(1, bar.fraction));
    if (f > 0) {
      const c = hue(asHue(bar.hue, hueName));
      const fw = Math.max(th, tw * f);
      if (bar.thin) s.round(tx, tyTop, fw, th, th / 2, P.text3);
      else s.gradient(tx, tyTop, fw, th, th / 2, c.deep, c.ink, 'h');
    }
  };
  const rows: BarsBlock['bars'][] = [];
  const step = twoUp ? 2 : 1;
  for (let i = 0; i < b.bars.length; i += step) rows.push(b.bars.slice(i, i + step));
  const body = rows.map((pair, i): Atom => ({
    h: BAR_ROW,
    gap: 0,
    draw: (s, x, y) => {
      const last = i === rows.length - 1;
      drawBar(s, x, y, pair[0], last);
      if (pair[1]) drawBar(s, x + cw + gutter, y, pair[1], last);
    },
  }));
  // First row gets the rounded top.
  const first = body[0].draw;
  body[0].draw = (s, x, y, ww) => {
    s.round(x, y, twoUp ? cw : ww, 2, 1.8, P.panel);
    if (twoUp && rows[0][1]) s.round(x + cw + gutter, y, cw, 2, 1.8, P.panel);
    first(s, x, y, ww);
  };
  return titled(ctx, b, hueName, body);
}

/* ================================================================== decks */

const DECK_GAP = 0.9;

function deckLink(d: DeckLine): string | null {
  return d.cards.length === 8 ? getDeckLinkFromKeys(d.cards) : null;
}

/** A percentage is only coloured as a WIN RATE when it is one. A use rate or
 *  a likelihood of 13% is not a losing record, and printed red it read as
 *  one on every opponent deck in the team dossier. */
const NOT_A_RATE = /use|likelihood|share|of play|of their/i;

function valueColor(d: DeckLine): RGB {
  if (d.valueHue) return hue(d.valueHue as HueName).ink;
  if (d.valueNote && NOT_A_RATE.test(d.valueNote)) return P.text;
  const v = parsePct(d.value);
  return v === null ? P.text : rateColor(v);
}

function metaOf(d: DeckLine): string {
  return [d.meta, d.inferredArt ? 'forms inferred from slot' : ''].filter(Boolean).join(' · ');
}

/** The two-up deck card: name and meta across the top, the strip under them,
 *  the figure, its note and the button in the column beside the strip. */
function deckCard(s: Surface, x: number, y: number, w: number, d: DeckLine, cw: number, hueName: HueName, h: number) {
  const pad = 2.6;
  s.panel(x, y, w, h, { kind: 'deck' });
  const inner = w - pad * 2;
  const nameStyle: TextStyle = { role: 'bodyBold', size: TYPE.name.size, color: P.text };
  s.text(s.clip(d.name, inner, nameStyle), x + pad, base(y + pad, TYPE.name.size), nameStyle);
  const meta = metaOf(d);
  if (meta) s.text(s.clip(meta, inner, { size: 5.8 }), x + pad, y + 7.9, { size: 5.8, color: P.text3 });
  const top = y + 9.6;
  const stripH = s.deck(x + pad, top, cw, DECK_GAP, d.cards, d.art as Record<string, Form> | undefined, 8);
  const rx = x + w - pad;
  if (d.value) {
    s.text(d.value, rx, base(top + 0.2, 15), { role: 'display', size: 15, track: 0.1, color: valueColor(d), align: 'right' });
  }
  if (d.valueNote) s.text(d.valueNote, rx, top + 6.5, { size: 5.6, color: P.text3, align: 'right' });
  const link = deckLink(d);
  if (link) {
    const bh = 4.4;
    const bw = s.buttonWidth('Open in game', bh);
    s.button(rx - bw, top + Math.max(stripH, 12) - bh, bh, 'Open in game', { hue: hueName, url: link });
  }
}

/** The one-up deck row: name block, strip, figures and button in one line. */
function deckRow(s: Surface, x: number, y: number, w: number, d: DeckLine, cw: number, hueName: HueName, h: number) {
  const pad = 2.6;
  s.panel(x, y, w, h, { kind: 'deck' });
  const nameW = 62;
  const nameStyle: TextStyle = { role: 'bodyBold', size: 8, color: P.text };
  const nameLines = s.wrap(d.name, nameW, nameStyle, 2);
  const metaLines = s.wrap(metaOf(d), nameW, { size: 5.8 }, 2);
  let ty = y + pad + 8 * PT * CAP;
  nameLines.forEach((ln) => { s.text(ln, x + pad, ty, nameStyle); ty += 8 * PT * 1.25; });
  ty += 0.6;
  metaLines.forEach((ln) => { s.text(ln, x + pad, ty, { size: 5.8, color: P.text3 }); ty += 5.8 * PT * 1.3; });
  const sx = x + pad + nameW + 3;
  s.deck(sx, y + pad, cw, DECK_GAP, d.cards, d.art as Record<string, Form> | undefined, 8);
  const link = deckLink(d);
  const bh = 4.8;
  const bw = link ? s.buttonWidth('Open in game', bh) : 0;
  const rx = x + w - pad;
  if (link) s.button(rx - bw, y + (h - bh) / 2, bh, 'Open in game', { hue: hueName, url: link });
  const fx = rx - bw - (link ? 5 : 0);
  if (d.value) {
    s.text(d.value, fx, base(y + h / 2 - 3.4, 16), { role: 'display', size: 16, track: 0.1, color: valueColor(d), align: 'right' });
  }
  if (d.valueNote) s.text(d.valueNote, fx, y + h / 2 + 4.2, { size: 5.8, color: P.text3, align: 'right' });
}

export function decksAtoms(ctx: BlockCtx, b: DecksBlock, hueName: HueName): Atom[] {
  const { w } = ctx;
  if (!b.decks.length) return [];
  const oneUp = b.decks.length <= 2;
  const body: Atom[] = [];
  if (oneUp) {
    const cw = 10.4;
    for (const d of b.decks) {
      const rows = Math.max(1, Math.ceil(d.cards.length / 8));
      const h = Math.max(17, rows * cardH(cw) + (rows - 1) * DECK_GAP + 5.2);
      body.push({ h, gap: ROW_GAP, draw: (s, x, y, ww) => deckRow(s, x, y, ww, d, cw, hueName, h) });
    }
  } else {
    const gutter = 4;
    const colW = (w - gutter) / 2;
    const cw = 10;
    for (let i = 0; i < b.decks.length; i += 2) {
      const pair = b.decks.slice(i, i + 2);
      const rows = Math.max(...pair.map((d) => Math.max(1, Math.ceil(d.cards.length / 8))));
      const h = 9.6 + Math.max(12.4, rows * cardH(cw) + (rows - 1) * DECK_GAP) + 2.6;
      body.push({
        h,
        gap: ROW_GAP,
        draw: (s, x, y) => pair.forEach((d, j) => deckCard(s, x + j * (colW + gutter), y, colW, d, cw, hueName, h)),
      });
    }
  }
  return titled(ctx, b, hueName, body);
}

/* ================================================================== pairs */

export function pairsAtoms(ctx: BlockCtx, b: PairsBlock, hueName: HueName): Atom[] {
  const { s, w } = ctx;
  if (!b.pairs.length) return [];
  const per = 4;
  const gap = 3;
  const tw = columnWidth(w, per, gap);
  const pad = 2.4;
  const cw = 10.4;
  const ch = cardH(cw);
  const textW = tw - pad * 2 - cw * 2 - 1 - 3;
  const nameStyle: TextStyle = { role: 'bodyBold', size: 6.8, color: P.text };
  const metaStyle: TextStyle = { size: 5.6, color: P.text3 };
  const measure = (p: PairsBlock['pairs'][number]) => {
    const name = s.wrap(p.name, textW, nameStyle, 2);
    const meta = p.meta ? s.wrap(p.meta, textW, metaStyle, 2) : [];
    return { name, meta, h: name.length * 6.8 * PT * 1.25 + (p.value ? 5.4 : 0) + meta.length * 5.6 * PT * 1.3 + 0.6 };
  };
  const body: Atom[] = [];
  for (let i = 0; i < b.pairs.length; i += per) {
    const row = b.pairs.slice(i, i + per).map((p) => ({ p, m: measure(p) }));
    const h = Math.max(ch, ...row.map((r) => r.m.h)) + pad * 2;
    body.push({
      h,
      gap: ROW_GAP,
      draw: (sf, x, y) => {
        row.forEach(({ p, m }, j) => {
          const tx = x + j * (tw + gap);
          sf.panel(tx, y, tw, h, { kind: 'pair' });
          sf.card(tx + pad, y + pad, cw, p.a, p.artA);
          sf.card(tx + pad + cw + 1, y + pad, cw, p.b, p.artB);
          const lx = tx + pad + cw * 2 + 1 + 3;
          let ty = y + pad + 6.8 * PT * CAP;
          m.name.forEach((ln) => { sf.text(ln, lx, ty, nameStyle); ty += 6.8 * PT * 1.25; });
          if (p.value) {
            const v = parsePct(p.value);
            sf.text(p.value, lx, ty + 3.6, { role: 'display', size: 12, track: 0.1, color: v === null ? P.text : rateColor(v) });
            ty += 5.4;
          }
          ty += 0.4;
          m.meta.forEach((ln) => { sf.text(ln, lx, ty, metaStyle); ty += 5.6 * PT * 1.3; });
        });
      },
    });
  }
  return titled(ctx, b, hueName, body);
}

/* ================================================================= series */

const SERIES_CW = 10;
const GAME_H = cardH(SERIES_CW) + 4.8;
const SERIES_MID = 30;

/** One side's decks, one strip per game, the deck name under each. */
function drawSeriesSide(s: Surface, x: number, y: number, decks: DeckLine[], align: 'left' | 'right') {
  const sw = stripWidth(8, SERIES_CW, DECK_GAP);
  const nameStyle: TextStyle = { size: 5.8, color: P.text2 };
  decks.forEach((d, i) => {
    const gy = y + i * GAME_H;
    s.deck(x, gy, SERIES_CW, DECK_GAP, d.cards.slice(0, 8), d.art as Record<string, Form> | undefined, 8);
    const name = s.clip(d.name, sw, nameStyle);
    s.text(name, align === 'left' ? x : x + sw, gy + cardH(SERIES_CW) + 3, { ...nameStyle, align });
  });
}

/** The middle column: which game, and the crowns it ended on. */
function drawGameColumn(s: Surface, cx: number, y: number, decks: DeckLine[]) {
  decks.forEach((d, i) => {
    const gy = y + i * GAME_H + cardH(SERIES_CW) / 2;
    s.label(`Game ${i + 1}`, cx, gy - 1.2, { align: 'center', color: P.text3 });
    if (d.value) s.text(d.value, cx, gy + 3.6, { role: 'display', size: 11, track: 0.1, color: P.text, align: 'center' });
  });
}

function scoreColor(row: SeriesBlock['rows'][number]): RGB {
  if (!row.score) return P.text3;
  return row.won ? HUES.green.ink : HUES.red.ink;
}

export function seriesAtoms(ctx: BlockCtx, b: SeriesBlock, hueName: HueName): Atom[] {
  if (!b.rows.length) return [];
  const pad = 3;
  const head = 12.4;
  const sw = stripWidth(8, SERIES_CW, DECK_GAP);
  const body: Atom[] = [];
  const rows = b.rows;
  const metaOfRow = (r: SeriesBlock['rows'][number]) => [r.format, r.date, r.caption].filter(Boolean).join('  ·  ');
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    const native = r.right.length === 0;
    const next = rows[i + 1];
    if (native && next && next.right.length === 0) {
      // Two duels with no stored opponent share a line, half each: there is
      // no right-hand side to draw, so a full-width row would be half empty.
      const pair = [r, next];
      const games = Math.max(r.left.length, next.left.length, 1);
      const h = head + games * GAME_H + pad;
      body.push({
        h,
        gap: ROW_GAP,
        draw: (sf, x, y, w) => {
          const hw = (w - 4) / 2;
          pair.forEach((row, j) => {
            const px = x + j * (hw + 4);
            sf.panel(px, y, hw, h, { kind: 'series' });
            const gw = sw + 4 + 22;
            const gx = px + (hw - gw) / 2;
            sf.text(row.leftLabel, gx, base(y + 3, 6.6), { role: 'bodyBold', size: 6.6, color: HUES.blue.ink });
            sf.text(s2(sf, metaOfRow(row), gw - 40), gx, y + 9.2, { role: 'bodyBold', size: 5.2, track: 0.2, caps: true, color: P.text3 });
            if (row.score) sf.text(row.score, gx + gw, base(y + 2.4, 14), { role: 'display', size: 14, color: scoreColor(row), align: 'right' });
            drawSeriesSide(sf, gx, y + head, row.left, 'left');
            drawGameColumn(sf, gx + sw + 4 + 11, y + head, row.left);
          });
        },
      });
      i += 2;
      continue;
    }
    const games = Math.max(r.left.length, r.right.length, 1);
    const h = head + games * GAME_H + pad;
    body.push({
      h,
      gap: ROW_GAP,
      draw: (sf, x, y, w) => {
        sf.panel(x, y, w, h, { kind: 'series' });
        const gw = sw * 2 + SERIES_MID;
        const gx = x + (w - gw) / 2;
        const cx = gx + sw + SERIES_MID / 2;
        sf.text(r.leftLabel, gx, base(y + 3, 6.6), { role: 'bodyBold', size: 6.6, color: HUES.blue.ink });
        sf.text(r.rightLabel, gx + gw, base(y + 3, 6.6), { role: 'bodyBold', size: 6.6, color: HUES.red.ink, align: 'right' });
        if (r.score) sf.text(r.score, cx, base(y + 2, 15), { role: 'display', size: 15, color: scoreColor(r), align: 'center' });
        const meta = metaOfRow(r);
        if (meta) sf.text(meta, cx, y + 10.2, { role: 'bodyBold', size: 5.2, track: 0.2, caps: true, color: P.text3, align: 'center' });
        drawSeriesSide(sf, gx, y + head, r.left, 'left');
        drawGameColumn(sf, cx, y + head, r.left);
        if (!native) {
          drawSeriesSide(sf, gx + gw - sw, y + head, r.right, 'right');
        } else {
          // A stated absence, never a blank half.
          const ah = games * GAME_H - 4.8;
          sf.round(gx + gw - sw, y + head, sw, ah, 1.6, P.slot, P.line, 0.18);
          const note = r.rightNote ?? 'No opponent decks were stored for this duel.';
          const lines = sf.wrap(note, sw - 10, { size: 6 }, 3);
          lines.forEach((ln, k) => sf.text(ln, gx + gw - sw / 2, y + head + ah / 2 - (lines.length - 1) * 1.4 + k * 2.8 + 0.8,
            { size: 6, color: P.text3, align: 'center' }));
        }
      },
    });
    i += 1;
  }
  return titled(ctx, b, hueName, body);
}

/** Clip helper for the compact header's meta line. */
function s2(sf: Surface, text: string, w: number): string {
  return sf.clip(text, w, { role: 'bodyBold', size: 5.2, track: 0.2, caps: true });
}

/* ================================================================ battles */

export function battlesAtoms(ctx: BlockCtx, b: BattlesBlock, hueName: HueName): Atom[] {
  if (!b.rows.length) return [];
  const cw = 9.4;
  const ch = cardH(cw);
  const pad = 2.6;
  const h = ch + 3.8 + pad * 2;
  const sw = stripWidth(8, cw, DECK_GAP);
  const info = 40;
  const mid = 22;
  const body = b.rows.map((r): Atom => ({
    h,
    gap: 1.8,
    draw: (s, x, y, w) => {
      s.panel(x, y, w, h, { kind: 'battle' });
      const c = r.result === 'win' ? HUES.green : r.result === 'loss' ? HUES.red : HUES.neutral;
      s.clipTo(x, y, w, h, 2.6, () => s.gradient(x, y, 1.3, h, 0, c.ink, c.deep, 'v'));
      // The result column: chip and score on one line, then when and where.
      const ix = x + 4.6;
      const cwid = s.chip(ix, y + pad + 0.6, r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : 'Draw', c.ink, 4.4);
      s.text(r.score, ix + cwid + 2.6, base(y + pad + 0.8, 14), { role: 'display', size: 14, track: 0.1, color: P.text });
      s.text(s.clip(r.when, info - 6, { size: 5.8 }), ix, y + h - pad - 3.6, { size: 5.8, color: P.text2 });
      s.text(s.clip(r.mode, info - 6, { size: 5.6 }), ix, y + h - pad - 0.6, { size: 5.6, color: P.text3 });
      // The two decks as one centred group with VS between them, so the
      // comparison reads as a comparison rather than two strips a page apart.
      const gw = sw * 2 + mid;
      const gx = x + info + (w - info - pad - gw) / 2;
      const rx = gx + sw + mid;
      s.deck(gx, y + pad, cw, DECK_GAP, r.left.cards.slice(0, 8), r.left.art as Record<string, Form> | undefined, 8);
      s.deck(rx, y + pad, cw, DECK_GAP, r.right.cards.slice(0, 8), r.right.art as Record<string, Form> | undefined, 8);
      const ny = y + pad + ch + 3.3;
      const nameL = [r.leftLabel, r.left.name].filter(Boolean).join('  ·  ');
      const nameR = [r.rightLabel, r.right.name].filter(Boolean).join('  ·  ');
      s.text(s.clip(nameL, sw, { size: 5.8 }), gx, ny, { size: 5.8, color: P.text2 });
      s.text(s.clip(nameR, sw, { size: 5.8 }), rx + sw, ny, { size: 5.8, color: P.text2, align: 'right' });
      s.text('VS', gx + sw + mid / 2, base(y + pad + ch / 2 - 1.7, 13), { role: 'display', size: 13, track: 0.3, color: P.text3, align: 'center' });
    },
  }));
  return titled(ctx, b, hueName, body);
}

/* ============================================================ card grid */

export function cardGridAtoms(ctx: BlockCtx, b: CardGridBlock, hueName: HueName): Atom[] {
  const { w } = ctx;
  if (!b.cards.length) return [];
  const per = 6;
  const gap = 2.6;
  const tw = columnWidth(w, per, gap);
  const pad = 2.2;
  const cw = 10.6;
  const ch = cardH(cw);
  const h = ch + pad * 2;
  const body: Atom[] = [];
  for (let i = 0; i < b.cards.length; i += per) {
    const row = b.cards.slice(i, i + per);
    body.push({
      h,
      gap: 2,
      draw: (s, x, y) => {
        row.forEach((c, j) => {
          const tx = x + j * (tw + gap);
          s.panel(tx, y, tw, h, { kind: 'cardTile' });
          s.card(tx + pad, y + pad, cw, c.key, c.form);
          const lx = tx + pad + cw + 2.4;
          const lw = tx + tw - pad - lx;
          const nameStyle: TextStyle = { role: 'bodyBold', size: 6.6, color: P.text };
          s.text(s.clip(cardName(c.key), lw, nameStyle), lx, base(y + pad + 0.2, 6.6), nameStyle);
          let sy = y + pad + 5.6;
          for (const st of c.stats.slice(0, 3)) {
            const col = st.thin ? P.text3 : st.hue ? hue(st.hue as HueName).ink : P.text;
            s.text(st.label, lx, sy, { role: 'bodyBold', size: 5, track: 0.18, caps: true, color: P.text3 });
            s.text(st.value, lx + lw, sy, { role: 'bodyBold', size: 5.8, color: col, align: 'right' });
            if (st.fraction !== undefined) s.meter(lx, sy + 0.9, lw, 0.9, st.fraction, st.thin ? P.text3 : col);
            sy += 3.3;
          }
        });
      },
    });
  }
  return titled(ctx, b, hueName, body);
}

/* ================================================================= versus */

export function versusAtoms(ctx: BlockCtx, b: VersusBlock, hueName: HueName): Atom[] {
  const { w } = ctx;
  if (!b.pairs.length) return [];
  const gutter = 4;
  const colW = (w - gutter) / 2;
  const pad = 2.6;
  const cw = cardWidthFor((colW - pad * 2 - 12) / 2, 4, DECK_GAP, 7, 10.2);
  const gridH = cardH(cw) * 2 + DECK_GAP;
  const gridW = stripWidth(4, cw, DECK_GAP);
  const head = 8.6;
  const withNote = b.pairs.some((p) => p.note);
  const h = head + gridH + pad + 1 + (withNote ? 4.4 : 0);
  const nameStyle: TextStyle = { role: 'bodyBold', size: 6.6, color: P.text };
  const side = (s: Surface, x: number, y: number, d: DeckLine | null, label: string | undefined, color: RGB, align: 'left' | 'right', empty: string) => {
    const lx = align === 'left' ? x : x - gridW;
    if (label) s.label(label, lx, y + 2.8, { color });
    if (!d) {
      s.round(lx, y + head - 1, gridW, gridH, 1.6, P.slot, P.line, 0.18);
      const lines = s.wrap(empty, gridW - 6, { size: 5.8 }, 3);
      lines.forEach((ln, i) => s.text(ln, lx + gridW / 2, y + head + gridH / 2 - 2 + i * 2.6, { size: 5.8, color: P.text3, align: 'center' }));
      return;
    }
    const title = [d.name, d.value].filter(Boolean).join('  ');
    s.text(s.clip(title, gridW, nameStyle), lx, y + 6.2, nameStyle);
    s.deck(lx, y + head - 1, cw, DECK_GAP, d.cards.slice(0, 8), d.art as Record<string, Form> | undefined, 4);
  };
  const body: Atom[] = [];
  for (let i = 0; i < b.pairs.length; i += 2) {
    const pair = b.pairs.slice(i, i + 2);
    body.push({
      h,
      gap: ROW_GAP,
      draw: (s, x, y) => {
        pair.forEach((p, j) => {
          const px = x + j * (colW + gutter);
          s.panel(px, y, colW, h, { kind: 'versus' });
          side(s, px + pad, y + pad, p.left, b.leftLabel, HUES.blue.ink, 'left', '');
          side(s, px + colW - pad, y + pad, p.right, b.rightLabel, HUES.red.ink, 'right',
            b.emptyNote ?? 'Nothing clears the evidence floor against this.');
          const join = b.joiner ?? 'VS';
          const js = join === '+' ? 22 : 13;
          s.text(join, px + colW / 2, base(y + head + gridH / 2 - js * PT * CAP / 2, js), {
            role: join === '+' ? 'bodyBold' : 'display', size: js, track: join === '+' ? 0 : 0.3,
            color: join === '+' ? hue(hueName).ink : P.text3, align: 'center',
          });
          if (p.note) {
            s.text(s.clip(p.note, colW - pad * 2, { size: 5.6 }), px + colW / 2, y + h - 2.6, { size: 5.6, color: P.text3, align: 'center' });
          }
        });
      },
    });
  }
  return titled(ctx, b, hueName, body);
}

/* ================================================================= matrix */

export function matrixAtoms(ctx: BlockCtx, b: MatrixBlock, hueName: HueName): Atom[] {
  const { s, w } = ctx;
  if (!b.rows.length || !b.columns.length) return [];
  const labelW = 42;
  const minCell = 17;
  const perChunk = Math.max(1, Math.floor((w - labelW) / minCell));
  const chunks: number[][] = [];
  for (let i = 0; i < b.columns.length; i += perChunk) {
    chunks.push(Array.from({ length: Math.min(perChunk, b.columns.length - i) }, (_, k) => i + k));
  }
  const cellH = 7;
  const headH = 9;
  const atoms: Atom[] = [];
  /* THE SCALE IS STRETCHED ACROSS THE RANGE PRESENT. Expected win rates sit
     in a narrow band; on an absolute scale 68% to 75% is nine cells of one
     green and the pairing that needs attention looks like the rest. The
     legend says so. A null is no evidence and is never painted. */
  const present = b.rows.flatMap((r) => r.cells.map((c) => c?.fraction)).filter((f): f is number => f !== null && f !== undefined);
  const lo = present.length ? Math.min(...present) : 0;
  const hi = present.length ? Math.max(...present) : 1;
  const scale = (f: number) => (hi - lo < 1e-9 ? 0.5 : (f - lo) / (hi - lo));
  chunks.forEach((cols, ci) => {
    const cellW = Math.min(30, (w - labelW) / cols.length);
    const header = (sf: Surface, x: number, y: number) => {
      cols.forEach((c, k) => {
        const cx = x + labelW + k * cellW;
        const col = b.columns[c];
        sf.text(sf.clip(col.label, cellW - 1.5, { role: 'bodyBold', size: 5.8 }), cx + cellW / 2, y + 3.6,
          { role: 'bodyBold', size: 5.8, color: P.text2, align: 'center' });
        if (col.sub) sf.text(sf.clip(col.sub, cellW - 1.5, { size: 5 }), cx + cellW / 2, y + 6.6, { size: 5, color: P.text3, align: 'center' });
      });
    };
    const body: Atom[] = [{ h: headH, gap: 0, keep: true, draw: (sf, x, y) => header(sf, x, y) }];
    b.rows.forEach((r) => {
      body.push({
        h: cellH,
        gap: 0.8,
        draw: (sf, x, y) => {
          sf.text(sf.clip(r.label, labelW - 3, { role: 'bodyBold', size: 6.4 }), x, base(y + 1.2, 6.4), { role: 'bodyBold', size: 6.4, color: P.text });
          if (r.sub) sf.text(sf.clip(r.sub, labelW - 3, { size: 5 }), x, y + cellH - 0.9, { size: 5, color: P.text3 });
          cols.forEach((c, k) => {
            const cell = r.cells[c];
            const cx = x + labelW + k * cellW;
            if (!cell || cell.fraction === null) {
              sf.round(cx + 0.4, y, cellW - 0.8, cellH, 1.2, P.slot);
              sf.line(cx + 2, y + cellH - 1.5, cx + cellW - 2, y + 1.5, P.line, 0.18);
              return;
            }
            const f = scale(cell.fraction);
            const fill = cell.thin ? mix(P.slot, heat(f), 0.4) : heat(f);
            sf.round(cx + 0.4, y, cellW - 0.8, cellH, 1.2, fill);
            const ink: RGB = contrast(P.text, fill) >= 4.5 ? P.text : [10, 10, 12];
            sf.text(cell.text, cx + cellW / 2, base(y + (cellH - 6.4 * PT * CAP) / 2, 6.4),
              { role: 'bodyBold', size: 6.4, color: ink, align: 'center' });
          });
        },
      });
    });
    const titledAtoms = titled(ctx, {
      heading: ci === 0 ? b.heading : b.heading ? `${b.heading} (${ci + 1}/${chunks.length})` : undefined,
      note: ci === 0 ? b.note : undefined,
    }, hueName, body, headH, (sf, x, y) => header(sf, x, y));
    atoms.push(...titledAtoms);
  });
  if (b.legend) {
    const lines = s.wrap(b.legend, w, { size: 5.8 }, 3);
    atoms.push({
      h: lines.length * 5.8 * PT * 1.3 + 1,
      gap: 2,
      draw: (sf, x, y) => lines.forEach((ln, i) => sf.text(ln, x, base(y, 5.8) + i * 5.8 * PT * 1.3, { size: 5.8, color: P.text3 })),
    });
  }
  return atoms;
}

/* ================================================================= spread */

export function spreadAtoms(ctx: BlockCtx, b: SpreadBlock, hueName: HueName): Atom[] {
  const { s, w } = ctx;
  const segs = b.segments.filter((x) => x.share > 0);
  if (!segs.length) return [];
  const total = segs.reduce((a, x) => a + x.share, 0) || 1;
  const colors = segs.map((x, i) => (x.hue ? hue(x.hue as HueName).ink : SERIES[i % SERIES.length]));
  const per = 4;
  const legendRows = Math.ceil(segs.length / per);
  const h = 8 + 3 + legendRows * 5;
  const body: Atom[] = [{
    h,
    gap: 3,
    draw: (sf, x, y) => {
      let sx = x;
      segs.forEach((seg, i) => {
        const sw = (seg.share / total) * w;
        sf.rect(sx, y, Math.max(0.3, sw - 0.4), 8, colors[i]);
        if (sw > 16) {
          const ink: RGB = contrast(P.text, colors[i]) >= 3 ? P.text : [10, 10, 12];
          sf.text(`${Math.round(seg.share)}%`, sx + sw / 2, base(y + 2.8, 6.4), { role: 'bodyBold', size: 6.4, color: ink, align: 'center' });
        }
        sx += sw;
      });
      const lw = w / per;
      segs.forEach((seg, i) => {
        const lx = x + (i % per) * lw;
        const ly = y + 11 + Math.floor(i / per) * 5;
        sf.round(lx, ly, 2.4, 2.4, 0.6, colors[i]);
        const t = `${seg.label}  ${seg.share.toFixed(1)}%${seg.note ? ` · ${seg.note}` : ''}`;
        sf.text(sf.clip(t, lw - 5, { size: 6 }), lx + 3.6, ly + 2.1, { size: 6, color: P.text2 });
      });
      void s;
    },
  }];
  return titled(ctx, b, hueName, body);
}

/* =================================================================== note */

export function noteAtoms(ctx: BlockCtx, b: NoteBlock, hueName: HueName): Atom[] {
  const { s, w } = ctx;
  const style: TextStyle = { size: 6.8, color: P.text2 };
  const lines = s.wrap(b.body, w - 8, style);
  if (!lines.length) return [];
  const step = 6.8 * PT * 1.35;
  const per = 14;
  const body: Atom[] = [];
  for (let i = 0; i < lines.length; i += per) {
    const chunk = lines.slice(i, i + per);
    const h = 5 + (chunk.length - 1) * step + 6.8 * PT * CAP;
    body.push({
      h,
      gap: 2,
      draw: (sf, x, y, ww) => {
        sf.panel(x, y, ww, h, { kind: 'note' });
        chunk.forEach((ln, k) => sf.text(ln, x + 4, base(y + 2.5, 6.8) + k * step, style));
      },
    });
  }
  return titled(ctx, b, hueName, body);
}

/* ================================================================ divider */

export const DIVIDER_H = 34;

export function dividerAtom(ctx: BlockCtx, b: DividerBlock): Atom {
  const h = asHue(b.hue, ctx.hue);
  const c = hue(h);
  return {
    h: DIVIDER_H,
    gap: 0,
    breakBefore: true,
    mark: { title: b.contents ?? b.title, depth: b.depth ?? 0, contents: true },
    section: { title: b.title, hue: h },
    draw: (s, x, y, w) => {
      s.gradient(x, y, w, DIVIDER_H, 3, mix(P.panel, c.deep, 0.5), P.panel, 'h');
      s.round(x, y, w, DIVIDER_H, 3, null, mix(P.line, c.ink, 0.3), 0.25);
      s.box({ x, y, w, h: DIVIDER_H, kind: 'divider' });
      s.clipTo(x, y, w, DIVIDER_H, 3, () => s.gradient(x, y, 1.6, DIVIDER_H, 0, c.ink, c.deep, 'v', 10));
      const lx = x + 7;
      if (b.subtitle) s.label(s.clip(b.subtitle, 150, { role: 'bodyBold', size: 5.6, track: 0.3, caps: true }), lx, y + 8.2, { color: c.ink, size: 5.6 });
      const T = TYPE.sectionTitle;
      s.text(s.clip(b.title, b.stats?.length ? w * 0.5 : w - 14, { role: 'display', size: T.size, track: T.track }),
        lx, base(y + 11, T.size), { role: 'display', size: T.size, track: T.track, color: P.text });
      if (b.tag) s.text(b.tag, lx, y + 27.6, { role: 'bodyBold', size: 7, color: P.text2 });
      const stats = (b.stats ?? []).slice(0, 4);
      if (stats.length) {
        const sw = 34;
        let sx = x + w - 6 - stats.length * sw;
        for (const st of stats) {
          s.line(sx, y + 8, sx, y + DIVIDER_H - 8, mix(P.line, c.ink, 0.25), 0.25);
          s.label(s.clip(st.label, sw - 5, { role: 'bodyBold', size: TYPE.label.size, track: TYPE.label.track, caps: true }), sx + 3.2, y + 11.4);
          s.text(s.clip(st.value, sw - 5, { role: 'display', size: 15 }), sx + 3.2, base(y + 13.4, 15), { role: 'display', size: 15, track: 0.1, color: P.text });
          if (st.note) s.text(s.clip(st.note, sw - 5, { size: 5.4 }), sx + 3.2, y + 24.4, { size: 5.4, color: P.text3 });
          sx += sw;
        }
      }
    },
  };
}

/* ================================================================== trend */

export function trendAtoms(ctx: BlockCtx, b: TrendBlock, hueName: HueName): Atom[] {
  if (!b.series.length || b.ticks.length < 2) return [];
  const h = 62;
  const series = b.series.slice(0, SERIES.length);
  const all = series.flatMap((x) => x.points.filter((v): v is number => v !== null));
  if (!all.length) return [];
  const rawMax = Math.max(...all);
  const niceMax = b.format === 'pct' ? Math.min(100, Math.ceil(rawMax / 10) * 10 || 10) : Math.ceil(rawMax || 1);
  const fmt = (v: number) => (b.format === 'pct' ? `${Math.round(v)}%` : String(Math.round(v)));
  const body: Atom[] = [{
    h,
    gap: 3,
    draw: (s, x, y, w) => {
      s.panel(x, y, w, h, { kind: 'trend' });
      const legendW = 58;
      const px = x + 12;
      const py = y + 5;
      const pw = w - 12 - legendW - 8;
      const ph = h - 14;
      for (let i = 0; i <= 4; i += 1) {
        const gy = py + ph - (ph * i) / 4;
        s.line(px, gy, px + pw, gy, i === 0 ? P.lineStrong : P.line, i === 0 ? 0.22 : 0.12);
        s.text(fmt((niceMax * i) / 4), px - 1.6, gy + 1, { size: 5.2, color: P.text3, align: 'right' });
      }
      const n = b.ticks.length;
      const xOf = (i: number) => px + (pw * i) / (n - 1);
      const every = Math.max(1, Math.ceil(n / 8));
      b.ticks.forEach((t, i) => {
        if (i % every !== 0 && i !== n - 1) return;
        s.text(t, xOf(i), py + ph + 4, { size: 5, color: P.text3, align: 'center' });
      });
      series.forEach((ser, si) => {
        const color = SERIES[si];
        s.stroke(color, 0.45);
        let run: [number, number][] = [];
        const flush = () => {
          if (run.length >= 2) {
            const deltas = run.slice(1).map(([ax, ay], k) => [ax - run[k][0], ay - run[k][1]]);
            s.doc.lines(deltas, run[0][0], run[0][1], [1, 1], 'S', false);
          } else if (run.length === 1) {
            s.fill(color);
            s.doc.circle(run[0][0], run[0][1], 0.45, 'F');
          }
          run = [];
        };
        ser.points.forEach((v, i) => {
          if (v === null) { flush(); return; }
          run.push([xOf(i), py + ph - (ph * Math.min(v, niceMax)) / niceMax]);
        });
        flush();
      });
      const lx = x + w - legendW - 3;
      series.forEach((ser, si) => {
        const ly = y + 7 + si * 6.4;
        s.round(lx, ly - 2, 3, 1.2, 0.6, SERIES[si]);
        s.text(s.clip(ser.label, legendW - 6, { size: 6 }), lx + 4.6, ly - 0.8, { size: 6, color: P.text2 });
      });
    },
  }];
  return titled(ctx, b, hueName, body);
}

/* =============================================================== dispatch */

export function blockAtoms(ctx: BlockCtx, b: ReportBlock): Atom[] {
  const h = ctx.hue;
  switch (b.kind) {
    case 'stats': return statsAtoms(ctx, b, h);
    case 'table': return tableAtoms(ctx, b, h);
    case 'bars': return barsAtoms(ctx, b, h);
    case 'decks': return decksAtoms(ctx, b, h);
    case 'pairs': return pairsAtoms(ctx, b, h);
    case 'series': return seriesAtoms(ctx, b, h);
    case 'battles': return battlesAtoms(ctx, b, h);
    case 'cards': return cardGridAtoms(ctx, b, h);
    case 'versus': return versusAtoms(ctx, b, h);
    case 'matrix': return matrixAtoms(ctx, b, h);
    case 'spread': return spreadAtoms(ctx, b, h);
    case 'note': return noteAtoms(ctx, b, h);
    case 'trend': return trendAtoms(ctx, b, h);
    case 'divider': return [dividerAtom(ctx, b)];
    case 'break': return [{ h: 0, gap: 0, breakBefore: true, draw: () => {} }];
    default: return [];
  }
}

/** Every atom must fit a page; this is the tallest any block may produce. */
export const MAX_ATOM_H = BODY_H;
