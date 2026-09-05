import { pdfSafe } from './analyticsReport';
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
import { paginate, summarize, type ContentPage, type ExportRequest } from './deckExport';

/* ------------------------------------------------------------------ theme */

type RGB = readonly [number, number, number];

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
  shadow: [0, 0, 0] as RGB,
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

/**
 * Three rows fill the sheet between the banner and the footer: 40 + 3*44 + 2*9
 * lands at 190, clear of the footer rule at 198.
 */
const DECK_ROW_H = 44;
const DECK_ROW_GAP = 9;

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
  for (const page of pages) page.deckEntries.forEach((e) => addDeck(e.deck));
  topCards.forEach((key) => urls.add(getCardIconUrl(key)));
  return [...urls];
}

/* --------------------------------------------------------------- typography */

/**
 * The site's display face — the same font the builder, Deck's Home and the
 * landing headings use. Embedding it makes the report read as the product
 * rather than a generic Helvetica PDF. Fetched at export time (no bundle cost)
 * and jsPDF subsets it, so it costs a few KB in the file. Small copy stays on
 * Helvetica: the face has a single weight and gets mushy below ~8 pt.
 */
/* NOT the site's display face, and it cannot be.
 * The site sets headings in Kids Word, which is OpenType/CFF ('OTTO'). jsPDF
 * embeds TrueType only — it has no CFF parser — so pointing this at Kids Word
 * produces an export with no headings rather than an error. Subscribe.ttf stays
 * because it is TrueType and already known to subset cleanly here. A future
 * display face can follow the site into the PDF only if its outlines are
 * TrueType; check the first four bytes before wiring it up. */
const DISPLAY = 'Subscribe';
const DISPLAY_URL = `${import.meta.env.BASE_URL}assets/fonts/Subscribe.ttf`;

let displayFontData: string | null | undefined;
/** True once the active doc can render `DISPLAY`; false → fall back to Helvetica. */
let displayReady = false;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked — spreading 57 KB into one fromCharCode call blows the arg limit.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

async function loadDisplayFont(): Promise<string | null> {
  if (displayFontData !== undefined) return displayFontData;
  try {
    const res = await fetch(DISPLAY_URL);
    displayFontData = res.ok ? toBase64(await res.arrayBuffer()) : null;
  } catch {
    displayFontData = null;
  }
  return displayFontData;
}

function registerDisplayFont(doc: JsPdfType, data: string | null) {
  displayReady = false;
  if (!data) return;
  try {
    doc.addFileToVFS('Subscribe.ttf', data);
    // One cut only — register it under both styles so setFont(…, 'bold') resolves
    // instead of throwing, and fake the weight with a stroke where it matters.
    doc.addFont('Subscribe.ttf', DISPLAY, 'normal');
    doc.addFont('Subscribe.ttf', DISPLAY, 'bold');
    displayReady = true;
  } catch {
    displayReady = false;
  }
}

/* ------------------------------------------------------------------ effects */

let GStateCtor: typeof import('jspdf').GState | null = null;

/**
 * Runs `draw` at reduced opacity, then restores it. Both alphas are set —
 * `opacity` alone is the PDF `ca` (fill) key, so strokes would come out solid.
 */
function alpha(doc: JsPdfType, value: number, draw: () => void) {
  if (!GStateCtor) {
    draw();
    return;
  }
  doc.setGState(new GStateCtor({ opacity: value, 'stroke-opacity': value }));
  draw();
  doc.setGState(new GStateCtor({ opacity: 1, 'stroke-opacity': 1 }));
}

/**
 * PDF has no blur filter, so depth is faked the way it was before CSS had
 * shadows: concentric rounded rects fading outward. It stays vector, so it
 * survives zooming and costs nothing in file size.
 */
function softShadow(
  doc: JsPdfType,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { spread?: number; layers?: number; opacity?: number; color?: RGB; offsetY?: number } = {},
) {
  const { spread = 1.8, layers = 5, opacity = 0.55, color = INK.shadow, offsetY = 0.9 } = opts;
  setFill(doc, color);
  for (let i = layers; i >= 1; i--) {
    const grow = (spread * i) / layers;
    // Falls off faster than linear so the inner ring carries the weight.
    const step = opacity * (1 - (i - 1) / layers) ** 1.7;
    alpha(doc, step / layers + 0.01, () => {
      doc.roundedRect(x - grow, y - grow + offsetY, w + grow * 2, h + grow * 2, r + grow, r + grow, 'F');
    });
  }
}

/** The same trick in reverse — a coloured halo that reads as emissive on dark. */
function glowRect(
  doc: JsPdfType,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: RGB,
  opts: { spread?: number; layers?: number; opacity?: number } = {},
) {
  const { spread = 2.2, layers = 4, opacity = 0.3 } = opts;
  setFill(doc, color);
  for (let i = layers; i >= 1; i--) {
    const grow = (spread * i) / layers;
    alpha(doc, (opacity / layers) * (1 - (i - 1) / layers) ** 1.2 + 0.008, () => {
      doc.roundedRect(x - grow, y - grow, w + grow * 2, h + grow * 2, r + grow, r + grow, 'F');
    });
  }
}

function glowCircle(
  doc: JsPdfType,
  cx: number,
  cy: number,
  radius: number,
  color: RGB,
  opts: { spread?: number; layers?: number; opacity?: number } = {},
) {
  const { spread = 3, layers = 5, opacity = 0.34 } = opts;
  setFill(doc, color);
  for (let i = layers; i >= 1; i--) {
    const grow = (spread * i) / layers;
    alpha(doc, (opacity / layers) * (1 - (i - 1) / layers) ** 1.3 + 0.006, () => {
      doc.circle(cx, cy, radius + grow, 'F');
    });
  }
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
  /** `display` uses the site's heading face when it loaded, Helvetica otherwise. */
  font?: 'sans' | 'display';
  /** Coloured halo behind the glyphs — for the few hero moments only. */
  glow?: RGB;
}

/** Selects the face for a text run and reports whether a faux-bold stroke is due. */
function useFont(doc: JsPdfType, font: 'sans' | 'display', bold: boolean): boolean {
  if (font === 'display' && displayReady) {
    doc.setFont(DISPLAY, 'normal');
    // The face ships one weight, so bold is drawn as fill + hairline stroke.
    return bold;
  }
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  return false;
}

/** Trims to an ellipsis at the current font settings. */
function fit(doc: JsPdfType, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function label(doc: JsPdfType, text: string, x: number, y: number, opts: TextOpts = {}) {
  const {
    size = 9,
    bold = false,
    color = INK.text,
    align = 'left',
    spacing = 0,
    maxWidth,
    font = 'sans',
    glow,
  } = opts;
  const faux = useFont(doc, font, bold);
  doc.setFontSize(size);
  setText(doc, color);
  doc.setCharSpace(spacing);
  const body = maxWidth ? fit(doc, text, maxWidth) : text;

  if (glow) {
    // Concentric stroked copies behind the fill — the type equivalent of the
    // text-shadow the headings carry on the site.
    setStroke(doc, glow);
    setText(doc, glow);
    for (const [width, op] of [
      [size * 0.09, 0.3],
      [size * 0.05, 0.42],
    ] as const) {
      doc.setLineWidth(width);
      alpha(doc, op, () => doc.text(body, x, y, { align, renderingMode: 'fillThenStroke' }));
    }
    setText(doc, color);
  }

  if (faux) {
    setStroke(doc, color);
    doc.setLineWidth(size * 0.014);
    doc.text(body, x, y, { align, renderingMode: 'fillThenStroke' });
  } else {
    doc.text(body, x, y, { align });
  }
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
    if (live) glowRect(doc, x, y, w, h, 1.4, INK.accent, { spread: 1.8, opacity: 0.32 });
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
    // A rim keeps the art from bleeding into the panel behind it. One stroke per
    // tile — anything heavier multiplies across every deck on the sheet.
    setStroke(doc, INK.panelEdge);
    doc.setLineWidth(0.25);
    alpha(doc, 0.75, () => doc.roundedRect(x, y, w, h, 1.1, 1.1, 'D'));
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

function pageBackground(doc: JsPdfType, handle: string) {
  setFill(doc, INK.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Aurora bloom — the landing page's glow, flattened into stacked ellipses so
  // the sheet isn't a flat black rectangle.
  for (const [cx, cy, rx, ry, color, op] of [
    [PAGE_W / 2, -18, 150, 78, INK.accent, 0.05],
    [PAGE_W / 2, -18, 96, 52, INK.accent, 0.05],
    [24, PAGE_H + 22, 110, 62, INK.frame, 0.05],
    [PAGE_W - 24, PAGE_H + 26, 100, 56, INK.accent, 0.035],
  ] as const) {
    setFill(doc, color);
    for (let i = 3; i >= 1; i--) {
      alpha(doc, op / 3, () => doc.ellipse(cx, cy, (rx * i) / 3, (ry * i) / 3, 'F'));
    }
  }

  // Ambassador watermark: the tiled diagonal handle, faint enough to read
  // straight through but present on every screenshot of the report.
  alpha(doc, 0.04, () => {
    useFont(doc, 'display', false);
    doc.setFontSize(17);
    setText(doc, INK.accent);
    for (let row = -1; row < 6; row++) {
      for (let col = -1; col < 5; col++) {
        doc.text(handle, col * 68 - 20, row * 42 + 26, { angle: 20 });
      }
    }
  });

  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.roundedRect(FRAME, FRAME, PAGE_W - FRAME * 2, PAGE_H - FRAME * 2, 3, 3, 'D');

  // Corner brackets, the detail that makes the sheet read as a report card.
  const b = 12;
  const [l, t, r, bo] = [FRAME + 3, FRAME + 3, PAGE_W - FRAME - 3, PAGE_H - FRAME - 3];
  const brackets = () => {
    doc.line(l, t, l + b, t);
    doc.line(l, t, l, t + b);
    doc.line(r - b, t, r, t);
    doc.line(r, t, r, t + b);
    doc.line(l, bo - b, l, bo);
    doc.line(l, bo, l + b, bo);
    doc.line(r - b, bo, r, bo);
    doc.line(r, bo - b, r, bo);
  };
  setStroke(doc, INK.bracket);
  // Wide faint pass under the crisp one — the corners pick up a neon halo.
  doc.setLineWidth(2.6);
  alpha(doc, 0.24, brackets);
  doc.setLineWidth(1);
  brackets();
}

function footer(doc: JsPdfType, handle: string, page: number, total: number) {
  alpha(doc, 0.5, () => crown(doc, CONTENT_X, FOOTER_Y - 3.9, 5.6, INK.gold));
  crown(doc, CONTENT_X, FOOTER_Y - 3.4, 5, INK.gold);
  label(doc, `ROYAL DUELS  ·  ${handle}`, CONTENT_X + 7, FOOTER_Y, {
    size: 6.4,
    bold: true,
    color: INK.muted,
    spacing: 0.4,
  });

  // Hairline rule bridging the two ends of the footer.
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.3);
  alpha(doc, 0.6, () => doc.line(CONTENT_X + 58, FOOTER_Y - 1.4, PAGE_W - CONTENT_X - 26, FOOTER_Y - 1.4));

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
  useFont(doc, 'display', true);
  doc.setFontSize(15);
  doc.setCharSpace(0.9);
  const textW = doc.getTextWidth(heading.toUpperCase());
  doc.setCharSpace(0);
  const w = Math.min(CONTENT_W, textW + 46);
  const x = (PAGE_W - w) / 2;

  softShadow(doc, x, y, w, h, 1.5, { spread: 2.4, opacity: 0.6 });
  glowRect(doc, x, y, w, h, 1.5, INK.accent, { spread: 2, opacity: 0.16 });
  setFill(doc, INK.panel);
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
  // Inner top highlight — the glass edge the app's panels carry.
  setStroke(doc, INK.bracket);
  doc.setLineWidth(0.3);
  alpha(doc, 0.5, () => doc.line(x + 2, y + 0.5, x + w - 2, y + 0.5));
  // Angled shoulders flanking the plate.
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.line(CONTENT_X, y + h / 2, x - 4, y + h / 2);
  doc.line(x + w + 4, y + h / 2, PAGE_W - CONTENT_X, y + h / 2);
  setFill(doc, INK.bracket);
  alpha(doc, 0.7, () => {
    doc.circle(x - 6, y + h / 2, 0.9, 'F');
    doc.circle(x + w + 6, y + h / 2, 0.9, 'F');
  });

  label(doc, heading.toUpperCase(), PAGE_W / 2, y + 8.4, {
    size: 15,
    bold: true,
    color: INK.text,
    align: 'center',
    spacing: 0.9,
    maxWidth: w - 8,
    font: 'display',
    glow: INK.accent,
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
  setCount: number,
  tiles: Map<string, string | null>,
  totalPages: number,
) {
  glowCircle(doc, PAGE_W / 2, 31, 11, INK.gold, { spread: 9, opacity: 0.22 });
  crown(doc, PAGE_W / 2 - 9, 24, 18, INK.gold);

  label(doc, req.title.toUpperCase(), PAGE_W / 2, 58, {
    size: 40,
    bold: true,
    color: INK.text,
    align: 'center',
    spacing: 1.4,
    font: 'display',
    glow: INK.accent,
  });
  label(doc, req.handle, PAGE_W / 2, 70, {
    size: 15,
    bold: true,
    color: INK.accent,
    align: 'center',
    spacing: 1.2,
    font: 'display',
  });

  // Rule with a lit centre rather than a flat hairline.
  setStroke(doc, INK.frame);
  doc.setLineWidth(0.5);
  doc.line(PAGE_W / 2 - 62, 77, PAGE_W / 2 + 62, 77);
  setStroke(doc, INK.bracket);
  doc.setLineWidth(0.7);
  alpha(doc, 0.55, () => doc.line(PAGE_W / 2 - 18, 77, PAGE_W / 2 + 18, 77));

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
    { value: String(setCount), label: setCount === 1 ? 'Set' : 'Sets' },
  ];
  const step = 62;
  const startX = PAGE_W / 2 - ((cells.length - 1) * step) / 2;
  cells.forEach((cell, i) => {
    const cx = startX + i * step;
    // Each figure sits on its own softly lit plate.
    softShadow(doc, cx - 24, 96, 48, 24, 2.5, { spread: 2.4, opacity: 0.5 });
    setFill(doc, INK.panel);
    setStroke(doc, INK.panelEdge);
    doc.setLineWidth(0.4);
    doc.roundedRect(cx - 24, 96, 48, 24, 2.5, 2.5, 'FD');
    label(doc, cell.value, cx, 108, {
      size: 24,
      bold: true,
      color: INK.accent,
      align: 'center',
      font: 'display',
      glow: INK.accent,
    });
    label(doc, cell.label.toUpperCase(), cx, 115, {
      size: 6.6,
      bold: true,
      color: INK.muted,
      align: 'center',
      spacing: 0.7,
    });
  });

  // Signature art: the three cards this collection leans on most. Sized to fill
  // the sheet now that the contents listing is gone.
  if (stats.topCards.length > 0) {
    const w = 30;
    const h = w / CARD_RATIO;
    const gap = 7;
    const top = 133;
    label(doc, 'MOST PLAYED', PAGE_W / 2, 128, {
      size: 6.6,
      bold: true,
      color: INK.muted,
      align: 'center',
      spacing: 1.2,
    });
    const totalW = stats.topCards.length * w + (stats.topCards.length - 1) * gap;
    let x = PAGE_W / 2 - totalW / 2;
    stats.topCards.forEach((key, i) => {
      const url = getCardIconUrl(key);
      const data = tiles.get(url);
      // The most-used card wears a gold halo; the rest sit on plain shadow.
      if (i === 0) glowRect(doc, x, top, w, h, 1.2, INK.gold, { spread: 3, opacity: 0.3 });
      softShadow(doc, x, top, w, h, 1.2, { spread: 2, opacity: 0.6 });
      setFill(doc, INK.tile);
      doc.roundedRect(x, top, w, h, 1.2, 1.2, 'F');
      if (data) doc.addImage(data, 'JPEG', x, top, w, h, url, 'FAST');
      setStroke(doc, i === 0 ? INK.gold : INK.panelEdge);
      doc.setLineWidth(0.4);
      alpha(doc, i === 0 ? 0.8 : 0.5, () => doc.roundedRect(x, top, w, h, 1.2, 1.2, 'D'));
      x += w + gap;
    });
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

  softShadow(doc, CONTENT_X, y, CONTENT_W, h, 2.4, { spread: 3, opacity: 0.65 });
  setFill(doc, INK.panel);
  setStroke(doc, INK.panelEdge);
  doc.setLineWidth(0.4);
  doc.roundedRect(CONTENT_X, y, CONTENT_W, h, 2.4, 2.4, 'FD');
  setStroke(doc, INK.bracket);
  doc.setLineWidth(0.3);
  alpha(doc, 0.34, () => doc.line(CONTENT_X + 14, y + 0.4, CONTENT_X + CONTENT_W - 14, y + 0.4));

  // Identity column, centred against the taller row.
  const infoX = CONTENT_X + 6;
  glowCircle(doc, infoX + 3.4, y + 13.6, 3.4, INK.accent, { spread: 2.8, opacity: 0.34 });
  setFill(doc, INK.accent);
  doc.circle(infoX + 3.4, y + 13.6, 3.4, 'F');
  label(doc, String(index), infoX + 3.4, y + 15.8, { size: 7.6, bold: true, color: INK.page, align: 'center' });

  label(doc, deck.name, infoX + 9.6, y + 16, {
    size: 11,
    bold: true,
    color: INK.text,
    maxWidth: 44,
    font: 'display',
  });

  let px = infoX;
  px += pill(doc, `AVG ${avg ?? '–'}`, px, y + 21, 5.8, { border: INK.panelEdge, color: INK.muted }) + 2;
  pill(doc, `CYCLE ${cycle ?? '–'}`, px, y + 21, 5.8, { border: INK.panelEdge, color: INK.muted });
  pill(doc, `${filled}/${DECK_SIZE} CARDS`, infoX, y + 29, 5.8, {
    border: filled === DECK_SIZE ? INK.accent : INK.panelEdge,
    color: filled === DECK_SIZE ? INK.accent : INK.muted,
  });

  if (typeof deck.crowns === 'number' && deck.crowns > 0) {
    // Clear of the pill above it, which ends at y + 34.8.
    crown(doc, infoX, y + 36, 4.8, INK.gold);
    label(doc, `${deck.crowns} ${deck.crowns === 1 ? 'crown' : 'crowns'}`, infoX + 6.4, y + 39.6, {
      size: 6.6,
      bold: true,
      color: INK.gold,
    });
  }

  // Card strip — sized to the space the taller row frees up.
  const stripX = CONTENT_X + 62;
  const stripW = CONTENT_X + CONTENT_W - 6 - stripX;
  const gap = 1.6;
  const cardW = (stripW - (DECK_SIZE - 1) * gap) / DECK_SIZE;
  const cardH = cardW / CARD_RATIO;
  const cardY = y + 4.4;
  softShadow(doc, stripX, cardY, stripW, cardH, 1.1, { spread: 1.5, opacity: 0.5, offsetY: 0.6 });
  for (let i = 0; i < DECK_SIZE; i++) {
    cardTile(doc, deck, i, stripX + i * (cardW + gap), cardY, cardW, cardH, tiles);
  }
  // The whole strip is a shortcut to the same deep link as the buttons.
  if (link) doc.link(stripX, cardY, stripW, cardH, { url: link });

  // Actions sit under the strip, side by side, spanning its full width.
  const btnY = cardY + cardH + 3.2;
  const btnH = Math.min(7.6, y + h - 3.4 - btnY);
  const btnGap = 4;
  const btnW = (stripW - btnGap) / 2;
  linkButton(doc, 'OPEN IN GAME', link, stripX, btnY, btnW, btnH, 'primary');
  linkButton(doc, 'COPY LINK', link, stripX + btnW + btnGap, btnY, btnW, btnH, 'ghost');
}

function drawDecksPage(doc: JsPdfType, page: ContentPage, tiles: Map<string, string | null>) {
  page.deckEntries.forEach((entry, i) => {
    drawDeckRow(doc, entry.deck, page.startIndex + i, BODY_TOP + i * (DECK_ROW_H + DECK_ROW_GAP), tiles);
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

/**
 * Latin-1, because jsPDF's built-in fonts are WinAnsi and this report still
 * sets its small copy in Helvetica. A character outside that range makes
 * jsPDF emit the string's raw UTF-16 BYTES, one Latin-1 glyph each, so a
 * single emoji in a handle or a deck name turns the whole string into noise.
 * The full account is in `analyticsPdf.ts`, where it was first measured on a
 * shipped dossier. The registered display face does not rescue it — it is a
 * display cut and carries no emoji either.
 */
/** Guard every string the document draws, at the one place they pass through. */
function guardText(doc: { text: (...a: unknown[]) => unknown }): void {
  const orig = doc.text.bind(doc);
  doc.text = (txt: unknown, ...rest: unknown[]) =>
    orig(
      Array.isArray(txt) ? txt.map((x) => pdfSafe(String(x))) : pdfSafe(String(txt)),
      ...rest,
    );
}

export async function renderDeckReport(req: ExportRequest, opts: RenderOptions = {}): Promise<Blob> {
  const { jsPDF, GState } = await import('jspdf');

  const pages = paginate(req.sections);
  if (pages.length === 0) throw new Error('Nothing to export — add some cards first.');

  const stats = summarize(req.sections);

  const urls = collectIconUrls(pages, stats.topCards);
  const tiles = new Map<string, string | null>();
  const fontData = await loadDisplayFont();
  let loaded = 0;
  for (const url of urls) {
    tiles.set(url, await buildTile(url));
    loaded++;
    opts.onProgress?.((loaded / urls.length) * 0.85);
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  guardText(doc as unknown as { text: (...a: unknown[]) => unknown });
  GStateCtor = GState;
  registerDisplayFont(doc, fontData);
  const totalPages = pages.length + 1;

  pageBackground(doc, req.handle);
  drawCover(doc, req, stats, req.sections.length, tiles, totalPages);

  pages.forEach((page, i) => {
    doc.addPage();
    pageBackground(doc, req.handle);
    const total = page.sectionTotal;
    const unit = page.kind === 'decks' ? 'deck' : 'duel';
    const sub =
      page.sectionPages > 1
        ? `${total} ${unit}${total === 1 ? '' : 's'} · part ${page.pageInSection} of ${page.sectionPages}`
        : `${total} ${unit}${total === 1 ? '' : 's'}`;
    banner(doc, page.heading, sub);
    drawDecksPage(doc, page, tiles);
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
