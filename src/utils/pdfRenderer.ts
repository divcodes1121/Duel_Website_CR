import type { jsPDF as JsPdfType } from 'jspdf';
import {
  CARDS_BY_KEY,
  getCardIconUrl,
  getEvolutionIconUrl,
  getHeroIconUrl,
} from '../data/cards';
import { getCycleCost, getElixirAverage, getSlotVisualVariant } from '../state/deckUtils';
import { DECK_SIZE, type Deck } from '../types/deck';
import { getClashRoyaleDeckLink } from './deckLink';
import {
  buildContents,
  paginate,
  summarize,
  type ContentPage,
  type ExportRequest,
  type PairEntry,
} from './deckExport';

/* ------------------------------------------------------------------ theme */

type RGB = readonly [number, number, number];

const SITE = 'royal-duels.vercel.app';
const SITE_URL = 'https://royal-duels.vercel.app';

const INK = {
  page: [9, 12, 20] as RGB,
  frame: [38, 68, 122] as RGB,
  bracket: [77, 163, 255] as RGB,
  panel: [17, 24, 39] as RGB,
  panelEdge: [35, 49, 74] as RGB,
  tile: [22, 30, 48] as RGB,
  text: [232, 238, 248] as RGB,
  muted: [124, 138, 165] as RGB,
  accent: [77, 163, 255] as RGB,
  gold: [245, 197, 66] as RGB,
  blue: [86, 154, 255] as RGB,
  red: [248, 113, 113] as RGB,
} as const;

/** Canvas fill for the card tiles — must match INK.tile so JPEG edges blend in. */
const TILE_BG_CSS = 'rgb(22, 30, 48)';

/* ----------------------------------------------------------------- layout */

const PAGE_W = 297;
const PAGE_H = 210;
const FRAME = 7;
const CONTENT_X = 16;
const CONTENT_W = PAGE_W - CONTENT_X * 2;
const BODY_TOP = 40;
const FOOTER_Y = PAGE_H - 12;

/** Clash Royale card art is 302x363. */
const CARD_RATIO = 302 / 363;
/** Downscaled tile width in pixels — keeps a 40-deck report near 1 MB. */
const TILE_PX = 150;

const DECK_ROW_H = 32;
const DECK_ROW_GAP = 5;
/** Three duels per page, spread to fill the sheet rather than bunching up top. */
const PAIR_ROW_H = 42;
const PAIR_ROW_GAP = 13;

/* ------------------------------------------------------------- card images */

/** Same evo/hero art the builder shows, so the report matches the screen. */
function iconUrlForSlot(deck: Deck, slotIndex: number): string | null {
  const key = deck.slots[slotIndex];
  if (!key) return null;
  const card = CARDS_BY_KEY.get(key);
  const variant = getSlotVisualVariant(deck, slotIndex, CARDS_BY_KEY);
  if (variant === 'evolution') return getEvolutionIconUrl(key);
  if (variant === 'hero' && card && !card.isChampion) return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Card art is ~150 KB per file at full resolution; embedding it raw would make
 * a report of 40 decks tens of megabytes. Each icon is downscaled once, flattened
 * onto the tile colour (so JPEG can be used despite the source alpha) and cached
 * — jsPDF then dedupes repeats via the image alias.
 */
const tileCache = new Map<string, string | null>();

async function buildTile(url: string): Promise<string | null> {
  const cached = tileCache.get(url);
  if (cached !== undefined) return cached;

  const img = await loadImage(url);
  let data: string | null = null;
  if (img) {
    const w = TILE_PX;
    const h = Math.round(TILE_PX / CARD_RATIO);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = TILE_BG_CSS;
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Contain-fit: never crop a card, letterbox onto the tile colour instead.
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      data = canvas.toDataURL('image/jpeg', 0.86);
    }
  }
  tileCache.set(url, data);
  return data;
}

function collectIconUrls(pages: ContentPage[], topCards: string[]): string[] {
  const urls = new Set<string>();
  const addDeck = (deck: Deck | null) => {
    if (!deck) return;
    for (let i = 0; i < deck.slots.length; i++) {
      const url = iconUrlForSlot(deck, i);
      if (url) urls.add(url);
    }
  };
  for (const page of pages) {
    page.deckEntries.forEach((e) => addDeck(e.deck));
    page.pairEntries.forEach((p) => {
      addDeck(p.blue);
      addDeck(p.red);
    });
  }
  topCards.forEach((key) => urls.add(getCardIconUrl(key)));
  return [...urls];
}

/* ------------------------------------------------------------- draw helpers */

function setFill(doc: JsPdfType, c: RGB) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setStroke(doc: JsPdfType, c: RGB) {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function setText(doc: JsPdfType, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}

interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: 'left' | 'center' | 'right';
  spacing?: number;
  maxWidth?: number;
}

/** Trims to an ellipsis at the current font settings. */
function fit(doc: JsPdfType, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function label(doc: JsPdfType, text: string, x: number, y: number, opts: TextOpts = {}) {
  const { size = 9, bold = false, color = INK.text, align = 'left', spacing = 0, maxWidth } = opts;
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  setText(doc, color);
  doc.setCharSpace(spacing);
  const body = maxWidth ? fit(doc, text, maxWidth) : text;
  doc.text(body, x, y, { align });
  doc.setCharSpace(0);
}

/** The app's crown mark, drawn from the same 24x24 path used in the UI. */
function crown(doc: JsPdfType, x: number, y: number, size: number, color: RGB) {
  const s = size / 24;
  setFill(doc, color);
  doc.lines(
    [
      [4 * s, 4 * s],
      [5 * s, -7 * s],
      [5 * s, 7 * s],
      [4 * s, -4 * s],
      [0, 9 * s],
      [-18 * s, 0],
    ],
    x + 3 * s,
    y + 8 * s,
    [1, 1],
    'F',
    true,
  );
}

function pill(
  doc: JsPdfType,
  text: string,
  x: number,
  y: number,
  h: number,
  opts: { fill?: RGB; border?: RGB; color?: RGB; size?: number; padding?: number } = {},
): number {
  const { fill, border, color = INK.muted, size = 6.5, padding = 2.6 } = opts;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  const w = doc.getTextWidth(text) + padding * 2;
  if (fill) setFill(doc, fill);
  if (border) setStroke(doc, border);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, fill && border ? 'FD' : fill ? 'F' : 'D');
  setText(doc, color);
  doc.text(text, x + w / 2, y + h / 2 + size * 0.125, { align: 'center' });
  return w;
}

/** A labelled rounded button wired to a PDF link annotation. */
function linkButton(
  doc: JsPdfType,
  text: string,
  url: string | null,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: 'primary' | 'ghost',
) {
  const live = !!url;
  const size = h <= 6 ? 5.6 : 6.6;
  if (tone === 'primary') {
    setFill(doc, live ? INK.accent : INK.panelEdge);
    doc.roundedRect(x, y, w, h, 1.4, 1.4, 'F');
    setText(doc, live ? INK.page : INK.muted);
  } else {
    setStroke(doc, live ? INK.accent : INK.panelEdge);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 1.4, 1.4, 'D');
    setText(doc, live ? INK.accent : INK.muted);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setCharSpace(0.25);
  doc.text(text, x + w / 2, y + h / 2 + size * 0.13, { align: 'center' });
  doc.setCharSpace(0);
  if (url) doc.link(x, y, w, h, { url });
}

function cardTile(
  doc: JsPdfType,
  deck: Deck,
  slotIndex: number,
  x: number,
  y: number,
  w: number,
  h: number,
  tiles: Map<string, string | null>,
) {
  setFill(doc, INK.tile);
  doc.roundedRect(x, y, w, h, 1.1, 1.1, 'F');

  const url = iconUrlForSlot(deck, slotIndex);
  const data = url ? tiles.get(url) : null;
  if (data && url) {
    // The alias makes jsPDF store each distinct icon once, however many decks use it.
    doc.addImage(data, 'JPEG', x, y, w, h, url, 'FAST');
  } else if (url) {
    // Art missing (offline export) — fall back to the card's name.
    const key = deck.slots[slotIndex];
    const name = (key && CARDS_BY_KEY.get(key)?.name) || '?';
    label(doc, name, x + w / 2, y + h / 2, { size: 4.4, color: INK.muted, align: 'center', maxWidth: w - 1.5 });
  } else {
    setStroke(doc, INK.panelEdge);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 1.1, 1.1, 'D');
  }
}

/* ------------------------------------------------------------------ chrome */

function pageBackground(doc: JsPdfType, GState: typeof import('jspdf').GState, handle: string) {
  setFill(doc, INK.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Ambassador watermark: tiled diagonal handle + site, faint enough to read
  // straight through but present on every screenshot of the report.
  doc.setGState(new GState({ opacity: 0.035 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  setText(doc, INK.accent);
  const mark = `${handle}  ${SITE}`;
  for (let row = -1; row < 6; row++) {
    for (let col = -1; col < 4; col++) {
      doc.text(mark, col * 95 - 20, row * 42 + 26, { angle: 20 });
    }
  }
  doc.setGState(new GState({ opacity: 1 }));

  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.roundedRect(FRAME, FRAME, PAGE_W - FRAME * 2, PAGE_H - FRAME * 2, 3, 3, 'D');

  // Corner brackets, the detail that makes the sheet read as a report card.
  setStroke(doc, INK.bracket);
  doc.setLineWidth(1);
  const b = 12;
  const [l, t, r, bo] = [FRAME + 3, FRAME + 3, PAGE_W - FRAME - 3, PAGE_H - FRAME - 3];
  doc.line(l, t, l + b, t);
  doc.line(l, t, l, t + b);
  doc.line(r - b, t, r, t);
  doc.line(r, t, r, t + b);
  doc.line(l, bo - b, l, bo);
  doc.line(l, bo, l + b, bo);
  doc.line(r - b, bo, r, bo);
  doc.line(r, bo - b, r, bo);
}

function footer(doc: JsPdfType, handle: string, page: number, total: number) {
  crown(doc, CONTENT_X, FOOTER_Y - 3.4, 5, INK.gold);
  label(doc, `ROYAL DUELS  ·  ${handle}`, CONTENT_X + 7, FOOTER_Y, {
    size: 6.4,
    bold: true,
    color: INK.muted,
    spacing: 0.4,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  const siteW = doc.getTextWidth(SITE);
  label(doc, SITE, PAGE_W / 2, FOOTER_Y, { size: 6.4, bold: true, color: INK.accent, align: 'center', spacing: 0.4 });
  doc.link(PAGE_W / 2 - siteW / 2 - 2, FOOTER_Y - 4, siteW + 6, 6, { url: SITE_URL });

  label(doc, `PAGE ${page} / ${total}`, PAGE_W - CONTENT_X, FOOTER_Y, {
    size: 6.4,
    bold: true,
    color: INK.muted,
    align: 'right',
    spacing: 0.4,
  });
}

/** The banner plate every content page opens with. */
function banner(doc: JsPdfType, heading: string, sub: string) {
  const y = 14;
  const h = 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setCharSpace(0.9);
  const textW = doc.getTextWidth(heading.toUpperCase());
  doc.setCharSpace(0);
  const w = Math.min(CONTENT_W, textW + 46);
  const x = (PAGE_W - w) / 2;

  setFill(doc, INK.panel);
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
  // Angled shoulders flanking the plate.
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.line(CONTENT_X, y + h / 2, x - 4, y + h / 2);
  doc.line(x + w + 4, y + h / 2, PAGE_W - CONTENT_X, y + h / 2);

  label(doc, heading.toUpperCase(), PAGE_W / 2, y + 8.4, {
    size: 15,
    bold: true,
    color: INK.text,
    align: 'center',
    spacing: 0.9,
    maxWidth: w - 8,
  });
  label(doc, sub.toUpperCase(), PAGE_W / 2, y + h + 6.5, {
    size: 6.6,
    color: INK.muted,
    align: 'center',
    spacing: 0.5,
  });
}

/* ------------------------------------------------------------------- cover */

function drawCover(
  doc: JsPdfType,
  req: ExportRequest,
  stats: ReturnType<typeof summarize>,
  contents: ReturnType<typeof buildContents>,
  tiles: Map<string, string | null>,
  totalPages: number,
) {
  crown(doc, PAGE_W / 2 - 9, 24, 18, INK.gold);

  label(doc, req.title.toUpperCase(), PAGE_W / 2, 58, {
    size: 40,
    bold: true,
    color: INK.text,
    align: 'center',
    spacing: 1.4,
  });
  label(doc, req.handle, PAGE_W / 2, 70, {
    size: 15,
    bold: true,
    color: INK.accent,
    align: 'center',
    spacing: 1.2,
  });

  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.line(PAGE_W / 2 - 62, 77, PAGE_W / 2 + 62, 77);

  label(doc, req.subtitle.toUpperCase(), PAGE_W / 2, 87, {
    size: 11,
    bold: true,
    color: INK.text,
    align: 'center',
    spacing: 1,
  });

  const cells: { value: string; label: string }[] = [
    { value: String(stats.decks), label: 'Decks' },
    { value: String(stats.cards), label: 'Cards' },
    { value: stats.avgElixir, label: 'Avg Elixir' },
    { value: String(contents.length), label: contents.length === 1 ? 'Section' : 'Sections' },
  ];
  const step = 62;
  const startX = PAGE_W / 2 - ((cells.length - 1) * step) / 2;
  cells.forEach((cell, i) => {
    const cx = startX + i * step;
    label(doc, cell.value, cx, 108, { size: 24, bold: true, color: INK.accent, align: 'center' });
    label(doc, cell.label.toUpperCase(), cx, 115, {
      size: 6.6,
      bold: true,
      color: INK.muted,
      align: 'center',
      spacing: 0.7,
    });
  });

  // Signature art: the three cards this collection leans on most.
  if (stats.topCards.length > 0) {
    const w = 22;
    const h = w / CARD_RATIO;
    const gap = 5;
    const totalW = stats.topCards.length * w + (stats.topCards.length - 1) * gap;
    let x = PAGE_W / 2 - totalW / 2;
    for (const key of stats.topCards) {
      const url = getCardIconUrl(key);
      const data = tiles.get(url);
      setFill(doc, INK.tile);
      doc.roundedRect(x, 124, w, h, 1.2, 1.2, 'F');
      if (data) doc.addImage(data, 'JPEG', x, 124, w, h, url, 'FAST');
      x += w + gap;
    }
  }

  if (contents.length > 0) {
    label(doc, 'CONTENTS', PAGE_W / 2, 163, {
      size: 6.6,
      bold: true,
      color: INK.muted,
      align: 'center',
      spacing: 1.2,
    });
    const rows = contents.slice(0, 6);
    rows.forEach((row, i) => {
      const y = 170 + i * 5;
      label(doc, `${row.heading}  —  ${row.count} ${row.count === 1 ? 'deck' : 'decks'}`, PAGE_W / 2 - 4, y, {
        size: 7.4,
        color: INK.text,
        align: 'right',
        maxWidth: 100,
      });
      label(doc, `p.${row.page}`, PAGE_W / 2 + 4, y, { size: 7.4, bold: true, color: INK.accent });
    });
    if (contents.length > rows.length) {
      label(doc, `+${contents.length - rows.length} more`, PAGE_W / 2, 170 + rows.length * 5, {
        size: 6.6,
        color: INK.muted,
        align: 'center',
      });
    }
  }

  const generated = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  label(doc, `GENERATED ${generated}  ·  TAP ANY DECK TO OPEN IT IN CLASH ROYALE`, PAGE_W / 2, 190, {
    size: 6.6,
    bold: true,
    color: INK.muted,
    align: 'center',
    spacing: 0.5,
  });

  footer(doc, req.handle, 1, totalPages);
}

/* -------------------------------------------------------------- deck rows */

function deckMeta(deck: Deck) {
  const filled = deck.slots.filter((k) => k !== null).length;
  return {
    filled,
    avg: getElixirAverage(deck, CARDS_BY_KEY),
    cycle: getCycleCost(deck, CARDS_BY_KEY),
    link: getClashRoyaleDeckLink(deck),
  };
}

function drawDeckRow(
  doc: JsPdfType,
  deck: Deck,
  index: number,
  y: number,
  tiles: Map<string, string | null>,
) {
  const { filled, avg, cycle, link } = deckMeta(deck);
  const h = DECK_ROW_H;

  setFill(doc, INK.panel);
  setStroke(doc, INK.panelEdge);
  doc.setLineWidth(0.4);
  doc.roundedRect(CONTENT_X, y, CONTENT_W, h, 2, 2, 'FD');

  // Index chip
  const infoX = CONTENT_X + 5;
  setFill(doc, INK.accent);
  doc.circle(infoX + 3, y + 7.5, 3, 'F');
  label(doc, String(index), infoX + 3, y + 9.4, { size: 7, bold: true, color: INK.page, align: 'center' });

  label(doc, deck.name, infoX + 8.5, y + 9.6, { size: 10, bold: true, color: INK.text, maxWidth: 47 });

  let px = infoX;
  px += pill(doc, `AVG ${avg ?? '–'}`, px, y + 14, 5.4, { border: INK.panelEdge, color: INK.muted }) + 2;
  px += pill(doc, `CYCLE ${cycle ?? '–'}`, px, y + 14, 5.4, { border: INK.panelEdge, color: INK.muted }) + 2;
  pill(doc, `${filled}/${DECK_SIZE}`, px, y + 14, 5.4, {
    border: filled === DECK_SIZE ? INK.accent : INK.panelEdge,
    color: filled === DECK_SIZE ? INK.accent : INK.muted,
  });

  if (typeof deck.crowns === 'number' && deck.crowns > 0) {
    crown(doc, infoX, y + 21.5, 4.6, INK.gold);
    label(doc, `${deck.crowns} ${deck.crowns === 1 ? 'crown' : 'crowns'}`, infoX + 6, y + 25, {
      size: 6.4,
      bold: true,
      color: INK.gold,
    });
  }

  // Card strip
  const stripX = CONTENT_X + 60;
  const cardW = 17.6;
  const cardH = cardW / CARD_RATIO;
  const gap = 1.4;
  const cardY = y + (h - cardH) / 2;
  for (let i = 0; i < DECK_SIZE; i++) {
    cardTile(doc, deck, i, stripX + i * (cardW + gap), cardY, cardW, cardH, tiles);
  }
  const stripW = DECK_SIZE * cardW + (DECK_SIZE - 1) * gap;
  // The whole strip is a shortcut to the same deep link as the button.
  if (link) doc.link(stripX, cardY, stripW, cardH, { url: link });

  // Actions
  const btnX = stripX + stripW + 4;
  const btnW = CONTENT_X + CONTENT_W - 5 - btnX;
  linkButton(doc, 'OPEN IN GAME', link, btnX, y + 6, btnW, 8, 'primary');
  linkButton(doc, 'COPY LINK', link, btnX, y + 17, btnW, 8, 'ghost');
}

function drawDecksPage(doc: JsPdfType, page: ContentPage, tiles: Map<string, string | null>) {
  page.deckEntries.forEach((entry, i) => {
    drawDeckRow(doc, entry.deck, page.startIndex + i, BODY_TOP + i * (DECK_ROW_H + DECK_ROW_GAP), tiles);
  });
}

/* -------------------------------------------------------------- pair rows */

function drawPairSide(
  doc: JsPdfType,
  deck: Deck | null,
  side: 'blue' | 'red',
  x: number,
  y: number,
  w: number,
  tiles: Map<string, string | null>,
) {
  const tone = side === 'blue' ? INK.blue : INK.red;
  const nameY = y + 5.4;

  if (!deck) {
    label(doc, side === 'blue' ? 'NO BLUE DECK' : 'NO RED DECK', x + w / 2, y + 18, {
      size: 8,
      bold: true,
      color: INK.muted,
      align: 'center',
      spacing: 0.6,
    });
    return;
  }

  const { filled, avg, link } = deckMeta(deck);
  const crowns = deck.crowns ?? 0;

  // Crown badges hug the VS gutter so the two players' counts face each other,
  // exactly like the saved-group previews in the app.
  const crownW = 12;
  const crownX = side === 'blue' ? x + w - crownW : x;
  const nameX = side === 'blue' ? x : x + crownW + 2;
  const nameW = w - crownW - 2;

  setFill(doc, tone);
  doc.circle(side === 'blue' ? x + 1.4 : x + w - 1.4, nameY - 1.2, 1.2, 'F');
  label(doc, deck.name, side === 'blue' ? nameX + 4 : nameX, nameY, {
    size: 8.6,
    bold: true,
    color: INK.text,
    align: side === 'blue' ? 'left' : 'left',
    maxWidth: nameW - 24,
  });
  label(doc, `AVG ${avg ?? '–'} · ${filled}/${DECK_SIZE}`, side === 'blue' ? nameX + nameW - 2 : x + w - 5, nameY, {
    size: 6.4,
    bold: true,
    color: INK.muted,
    align: 'right',
  });

  crown(doc, crownX, nameY - 4.6, 4.6, crowns > 0 ? INK.gold : INK.panelEdge);
  label(doc, String(crowns), crownX + 6, nameY, {
    size: 7,
    bold: true,
    color: crowns > 0 ? INK.gold : INK.muted,
  });

  const cardsY = y + 8;
  const gap = 1.2;
  const cardW = (w - (DECK_SIZE - 1) * gap) / DECK_SIZE;
  const cardH = cardW / CARD_RATIO;
  for (let i = 0; i < DECK_SIZE; i++) {
    cardTile(doc, deck, i, x + i * (cardW + gap), cardsY, cardW, cardH, tiles);
  }
  if (link) doc.link(x, cardsY, w, cardH, { url: link });

  const btnY = cardsY + cardH + 2;
  const btnW = (w - 3) / 2;
  linkButton(doc, 'OPEN IN GAME', link, x, btnY, btnW, 6, 'primary');
  linkButton(doc, 'COPY LINK', link, x + btnW + 3, btnY, btnW, 6, 'ghost');
}

function drawPairRow(doc: JsPdfType, pair: PairEntry, index: number, y: number, tiles: Map<string, string | null>) {
  const h = PAIR_ROW_H;
  setFill(doc, INK.panel);
  setStroke(doc, INK.panelEdge);
  doc.setLineWidth(0.4);
  doc.roundedRect(CONTENT_X, y, CONTENT_W, h, 2, 2, 'FD');

  const gutter = 26;
  const sideW = (CONTENT_W - 10 - gutter) / 2;
  const blueX = CONTENT_X + 5;
  const redX = blueX + sideW + gutter;

  // A side's content is ~33mm tall; centre it so the row's padding is even.
  const sideY = y + (h - 33) / 2;
  drawPairSide(doc, pair.blue, 'blue', blueX, sideY, sideW, tiles);
  drawPairSide(doc, pair.red, 'red', redX, sideY, sideW, tiles);

  // VS divider
  const cx = PAGE_W / 2;
  setStroke(doc, INK.panelEdge);
  doc.setLineWidth(0.4);
  doc.line(cx, y + 4, cx, y + h / 2 - 6);
  doc.line(cx, y + h / 2 + 6, cx, y + h - 4);
  setFill(doc, INK.page);
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.circle(cx, y + h / 2, 5.6, 'FD');
  label(doc, 'VS', cx, y + h / 2 + 1.6, { size: 8, bold: true, color: INK.accent, align: 'center', spacing: 0.4 });
  label(doc, `DUEL ${index}`, cx, y + h / 2 + 11, {
    size: 5.4,
    bold: true,
    color: INK.muted,
    align: 'center',
    spacing: 0.4,
  });
}

function drawPairsPage(doc: JsPdfType, page: ContentPage, tiles: Map<string, string | null>) {
  page.pairEntries.forEach((pair, i) => {
    drawPairRow(doc, pair, page.startIndex + i, BODY_TOP + i * (PAIR_ROW_H + PAIR_ROW_GAP), tiles);
  });
}

/* -------------------------------------------------------------------- main */

export interface RenderOptions {
  /** 0..1 while card art loads, then 1 as pages are drawn. */
  onProgress?: (ratio: number) => void;
}

/**
 * Renders the report and hands back a Blob. jsPDF is imported dynamically so
 * the ~400 KB library only reaches the browsers that actually export.
 */
export async function renderDeckReport(req: ExportRequest, opts: RenderOptions = {}): Promise<Blob> {
  const { jsPDF, GState } = await import('jspdf');

  const pages = paginate(req.sections);
  if (pages.length === 0) throw new Error('Nothing to export — add some cards first.');

  const stats = summarize(req.sections);
  const contents = buildContents(req.sections);

  const urls = collectIconUrls(pages, stats.topCards);
  const tiles = new Map<string, string | null>();
  let loaded = 0;
  for (const url of urls) {
    tiles.set(url, await buildTile(url));
    loaded++;
    opts.onProgress?.((loaded / urls.length) * 0.85);
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const totalPages = pages.length + 1;

  pageBackground(doc, GState, req.handle);
  drawCover(doc, req, stats, contents, tiles, totalPages);

  pages.forEach((page, i) => {
    doc.addPage();
    pageBackground(doc, GState, req.handle);
    const total = page.sectionTotal;
    const unit = page.kind === 'decks' ? 'deck' : 'duel';
    const sub =
      page.sectionPages > 1
        ? `${total} ${unit}${total === 1 ? '' : 's'} · part ${page.pageInSection} of ${page.sectionPages}`
        : `${total} ${unit}${total === 1 ? '' : 's'}`;
    banner(doc, page.heading, sub);
    if (page.kind === 'decks') drawDecksPage(doc, page, tiles);
    else drawPairsPage(doc, page, tiles);
    footer(doc, req.handle, i + 2, totalPages);
    opts.onProgress?.(0.85 + ((i + 1) / pages.length) * 0.15);
  });

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
