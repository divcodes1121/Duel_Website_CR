/**
 * THE BUILDER'S DECK REPORT — "Export PDF" in Royal Duels and Deck's Home —
 * drawn by the same engine as every other Deckkies PDF.
 *
 * WHAT IT REPLACED. This file used to draw its own document with its own
 * look, and faked depth the only way a PDF without blur can: concentric
 * semi-transparent rounded rectangles behind every card, row and plate, a
 * tiled 4%-opacity watermark on every sheet and stacked translucent ellipses
 * for the glow. Each of those is a transparency state a viewer composites per
 * pixel, which is exactly what made the site's other export slow. Now every
 * fill is opaque: the glow is the engine's baked corner image, the watermark
 * is an opaque tint a hair off the ground, and the cards sit in slots.
 *
 * WHAT IT KEPT, because each is a recorded decision (see `deckExport.ts`):
 *   * three deck rows a sheet, and sections never sharing one ("part i of j");
 *   * set headings positional, not the saved name — `deckExport` decides that;
 *   * the cover: the handle, the headline figures, the three most-played cards,
 *     and NO contents listing;
 *   * the tiled @handle watermark on every sheet;
 *   * OPEN IN GAME and COPY LINK side by side, both real link annotations, and
 *     the card strip itself as a hit area (a PDF cannot write the clipboard,
 *     so COPY LINK is a link to long-press);
 *   * NO SITE URL anywhere in the document.
 */

import { CARDS_BY_KEY } from '../data/cards';
import { getCycleCost, getElixirAverage, getSlotVisualVariant } from '../state/deckUtils';
import { DECK_SIZE, type Deck } from '../types/deck';
import { getClashRoyaleDeckLink } from './deckLink';
import { paginate, summarize, type ContentPage, type ExportRequest } from './deckExport';
import { CROWN, artUrl, cardTile, coverPlate, glowPlate, logoTile, type Form, type Raster } from './report/art';
import { loadFonts } from './report/fonts';
import { BODY_TOP, CONTENT_W, MARGIN, PAGE_H, PAGE_W, PT, TYPE, cardH, stripWidth } from './report/geometry';
import { CAP, Surface, type TextStyle } from './report/surface';
import { HUES, P, hue, mix, type HueName } from './report/theme';
import { BRAND, FAN_LINE, brandBar, footer, ground, logoMark, stamp, wordmark } from './report/engine';

const HUE: HueName = 'violet';
const ROW_H = 38;
const ROW_GAP = 8;
const CARD_W = 14.2;
const CARD_GAP = 1.4;

const base = (top: number, size: number) => top + size * PT * CAP;

/* ----------------------------------------------------------------- slots */

/** The form a slot's card is drawn in — the builder's own positional rule,
 *  so the report shows the evolution or hero art the builder shows. A
 *  champion in the hero slot keeps its base art: it has no hero form. */
function formOf(deck: Deck, i: number): Form | undefined {
  const key = deck.slots[i];
  if (!key) return undefined;
  const v = getSlotVisualVariant(deck, i, CARDS_BY_KEY);
  if (v === 'evolution') return 'evolution';
  if (v === 'hero' && !CARDS_BY_KEY.get(key)?.isChampion) return 'hero';
  return undefined;
}

function collectUrls(pages: ContentPage[], topCards: string[]): string[] {
  const urls = new Set<string>();
  for (const page of pages) {
    for (const { deck } of page.deckEntries) {
      deck.slots.forEach((key, i) => { if (key) urls.add(artUrl(key, formOf(deck, i))); });
    }
  }
  topCards.forEach((k) => urls.add(artUrl(k)));
  return [...urls];
}

/* ------------------------------------------------------------- watermark */

/** The tiled @handle, as an OPAQUE tint 3% toward the hue — the old one was
 *  white at 4% opacity, a transparency state on every glyph of every sheet. */
function watermark(s: Surface, handle: string): void {
  const tint = mix(P.ground, hue(HUE).ink, 0.05);
  s.chrome(() => {
    for (let row = -1; row < 6; row += 1) {
      for (let col = -1; col < 5; col += 1) {
        const text = s.prep(handle, { role: 'display', size: 17 });
        s.doc.setFont('dkDisplay', 'normal');
        if (!s.embedded) s.doc.setFont('helvetica', 'bold');
        s.doc.setFontSize(17);
        s.doc.setTextColor(tint[0], tint[1], tint[2]);
        s.doc.text(text, col * 68 - 20, row * 42 + 30, { angle: 20 });
      }
    }
  });
}

/* ----------------------------------------------------------------- cover */

function cover(s: Surface, plate: Raster | null, logo: Raster | null, req: ExportRequest,
  stats: ReturnType<typeof summarize>, sets: number, generated: string): void {
  const c = hue(HUE);
  s.chrome(() => {
    if (plate) s.image(plate, 0, 0, PAGE_W, PAGE_H);
    else s.rect(0, 0, PAGE_W, PAGE_H, P.ground);
    logoMark(s, logo, MARGIN, 13, 12);
    wordmark(s, MARGIN + 15.5, 23.2, 24);
    s.text(`Generated ${generated}`, PAGE_W - MARGIN, 20.6, {
      role: 'bodyBold', size: 6, track: 0.26, caps: true, color: P.text2, align: 'right',
    });

    s.label(req.subtitle, MARGIN, 58, { color: c.ink, size: 7 });
    const T = TYPE.coverTitle;
    s.text(s.clip(req.title, 170, { role: 'display', size: T.size, track: T.track }), MARGIN, base(62, T.size),
      { role: 'display', size: T.size, track: T.track, color: P.text });
    s.text(s.clip(req.handle, 170, { role: 'display', size: 17 }), MARGIN, base(81, 17),
      { role: 'display', size: 17, track: 0.3, color: c.ink });

    // Headline figures on the same tiles the analytics reports use.
    const cells = [
      { label: 'Decks', value: String(stats.decks) },
      { label: 'Cards', value: String(stats.cards) },
      { label: 'Avg elixir', value: stats.avgElixir },
      { label: sets === 1 ? 'Set' : 'Sets', value: String(sets) },
    ];
    const tw = 36;
    cells.forEach((cell, i) => {
      const x = MARGIN + i * (tw + 3);
      const y = 96;
      s.panel(x, y, tw, 18, { kind: 'kpi' });
      s.clipTo(x, y, tw, 18, 2.6, () => s.gradient(x, y, 1.3, 18, 0, c.ink, c.deep, 'v'));
      s.label(cell.label, x + 4.4, y + 5.4);
      s.text(cell.value, x + 4.4, y + 13.4, { role: 'display', size: 17, track: 0.1, color: P.text });
    });

    // The three cards this collection leans on most, in their slots.
    if (stats.topCards.length) {
      s.label('Most played', MARGIN, 128, { color: P.text2 });
      const w = 16;
      stats.topCards.forEach((key, i) => s.card(MARGIN + i * (w + 3), 131, w, key));
    }
    s.text('Tap any deck to open it in Clash Royale', MARGIN, 162, { size: 7, color: P.text2 });
    s.text(`${BRAND}™  ·  ${FAN_LINE}`, MARGIN, PAGE_H - 9, {
      role: 'bodyBold', size: 5.4, track: 0.22, caps: true, color: P.text3,
    });
  });
}

/* -------------------------------------------------------------- deck row */

/** Cards at each elixir cost, 1..7 and 8+. */
function curve(deck: Deck): number[] {
  const out = new Array(8).fill(0);
  for (const key of deck.slots) {
    if (!key) continue;
    const e = CARDS_BY_KEY.get(key)?.elixir ?? 0;
    if (e <= 0) continue;
    out[Math.min(8, e) - 1] += 1;
  }
  return out;
}

function deckRow(s: Surface, deck: Deck, index: number, y: number): void {
  const x = MARGIN;
  const w = CONTENT_W;
  const c = hue(HUE);
  const filled = deck.slots.filter((k) => k !== null).length;
  const avg = getElixirAverage(deck, CARDS_BY_KEY);
  const cycle = getCycleCost(deck, CARDS_BY_KEY);
  const link = getClashRoyaleDeckLink(deck);

  s.panel(x, y, w, ROW_H, { kind: 'deck' });
  s.clipTo(x, y, w, ROW_H, 2.6, () => s.gradient(x, y, 1.3, ROW_H, 0, c.ink, c.deep, 'v'));

  // Identity column.
  const ix = x + 6;
  s.gradient(ix, y + 5, 8, 8, 4, c.ink, c.deep, 'v');
  s.text(String(index), ix + 4, base(y + 7.2, 8), { role: 'bodyBold', size: 8, color: P.text, align: 'center' });
  s.text(s.clip(deck.name, 48, { role: 'display', size: 15 }), ix + 11, base(y + 5.2, 15),
    { role: 'display', size: 15, track: 0.2, color: P.text });
  let cx = ix;
  cx += s.chip(cx, y + 17, `Avg ${avg ?? '–'}`, P.text2, 4.6) + 2;
  cx += s.chip(cx, y + 17, `Cycle ${cycle ?? '–'}`, P.text2, 4.6) + 2;
  s.chip(cx, y + 17, `${filled}/${DECK_SIZE} cards`, filled === DECK_SIZE ? HUES.green.ink : P.text2, 4.6);
  if (typeof deck.crowns === 'number' && deck.crowns > 0) {
    s.crown(ix, y + 26, 5, P.gold, CROWN);
    s.text(`${deck.crowns} ${deck.crowns === 1 ? 'crown' : 'crowns'}`, ix + 6.6, y + 29, { role: 'bodyBold', size: 6.6, color: P.gold });
  }

  // The strip: eight slots, empty ones drawn as empty slots.
  const sx = x + 70;
  // Strip and buttons centred in the row.
  const sy = y + (ROW_H - (cardH(CARD_W) + 3.6 + 5.6)) / 2;
  const sw = stripWidth(DECK_SIZE, CARD_W, CARD_GAP);
  for (let i = 0; i < DECK_SIZE; i += 1) {
    const key = deck.slots[i];
    const cxx = sx + i * (CARD_W + CARD_GAP);
    if (key) s.card(cxx, sy, CARD_W, key, formOf(deck, i));
    else s.round(cxx, sy, CARD_W, cardH(CARD_W), 1.4, P.panel, P.line, 0.25);
  }
  if (link) s.link(sx, sy, sw, cardH(CARD_W), link);

  // Buttons under the strip, side by side across its width.
  const by = sy + cardH(CARD_W) + 3.6;
  const bh = 5.6;
  const bw1 = s.button(sx, by, bh, 'Open in game', { hue: HUE, url: link });
  s.button(sx + bw1 + 3, by, bh, 'Copy link', { hue: HUE, url: link, ghost: true });

  // Elixir curve: cards at each cost.
  const kx = sx + sw + 8;
  const kw = x + w - 6 - kx;
  const counts = curve(deck);
  const max = Math.max(1, ...counts);
  s.label('Elixir curve', kx, y + 7.4);
  const barW = (kw - 7 * 1.6) / 8;
  const top = y + 10;
  const chartH = ROW_H - 19;
  counts.forEach((n, i) => {
    const bx = kx + i * (barW + 1.6);
    s.round(bx, top, barW, chartH, 1, mix(P.slot, P.line, 0.4));
    if (n > 0) {
      const bh2 = Math.max(2, (chartH * n) / max);
      s.gradient(bx, top + chartH - bh2, barW, bh2, 1, c.ink, c.deep, 'v');
      s.text(String(n), bx + barW / 2, top + chartH - bh2 - 1, { role: 'bodyBold', size: 5.4, color: P.text, align: 'center' });
    }
    s.text(i === 7 ? '8+' : String(i + 1), bx + barW / 2, top + chartH + 3.4, { size: 5.4, color: P.text3, align: 'center' });
  });
}

function banner(s: Surface, heading: string, sub: string): void {
  const capH = 14 * PT * CAP;
  s.gradient(MARGIN, BODY_TOP - 0.3, 1.2, capH + 0.6, 0.6, hue(HUE).ink, hue(HUE).deep, 'v');
  s.text(heading, MARGIN + 3.4, BODY_TOP + capH, { role: 'display', size: 14, track: 0.28, caps: true, color: P.text });
  const st: TextStyle = { role: 'bodyBold', size: 5.8, track: 0.26, caps: true, color: P.text2 };
  s.text(sub, PAGE_W - MARGIN, BODY_TOP + capH, { ...st, align: 'right' });
}

/* ------------------------------------------------------------------ main */

export interface RenderOptions {
  /** 0..1 while card art loads, then 1 as pages are drawn. */
  onProgress?: (ratio: number) => void;
}

export async function renderDeckReport(req: ExportRequest, opts: RenderOptions = {}): Promise<Blob> {
  const pages = paginate(req.sections);
  if (pages.length === 0) throw new Error('Nothing to export — add some cards first.');
  const stats = summarize(req.sections);

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  const embedded = await loadFonts(doc);

  const urls = collectUrls(pages, stats.topCards);
  let loaded = 0;
  const tileList = await Promise.all(urls.map(async (u) => {
    const t = await cardTile(u, P.slot);
    loaded += 1;
    opts.onProgress?.((loaded / Math.max(1, urls.length)) * 0.85);
    return t;
  }));
  const tiles = new Map<string, Raster | null>(urls.map((u, i) => [u, tileList[i]]));
  const [plate, glow, logo] = await Promise.all([coverPlate(HUE), glowPlate(HUE), logoTile()]);

  const s = new Surface(doc, embedded, tiles);
  const generated = stamp(new Date());
  const total = pages.length + 1;
  const crumbs = { screen: req.title, subject: req.handle };

  cover(s, plate, logo, req, stats, req.sections.length, generated);

  pages.forEach((page, i) => {
    doc.addPage();
    ground(s, glow);
    watermark(s, req.handle);
    brandBar(s, logo, crumbs, { title: page.heading, hue: HUE }, i + 2, total);
    footer(s, generated, `Deck report  ·  ${req.handle}`);
    const unit = page.kind === 'decks' ? 'deck' : 'duel';
    const n = page.sectionTotal;
    const sub = page.sectionPages > 1
      ? `${n} ${unit}${n === 1 ? '' : 's'}  ·  part ${page.pageInSection} of ${page.sectionPages}`
      : `${n} ${unit}${n === 1 ? '' : 's'}`;
    banner(s, page.heading, sub);
    page.deckEntries.forEach((entry, k) => {
      deckRow(s, entry.deck, page.startIndex + k, BODY_TOP + 10 + k * (ROW_H + ROW_GAP));
    });
    opts.onProgress?.(0.85 + ((i + 1) / pages.length) * 0.15);
  });

  doc.setProperties({ title: `${BRAND} — ${req.title}`, subject: req.subtitle, author: BRAND, creator: `${BRAND} report engine` });
  return doc.output('blob');
}

/** Renders and triggers a browser download. */
export async function downloadDeckReport(req: ExportRequest, opts: RenderOptions = {}): Promise<void> {
  const blob = await renderDeckReport(req, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = req.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
