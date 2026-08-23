import type { jsPDF as JsPdfType } from 'jspdf';
import {
  CARDS_BY_KEY,
  getCardIconUrl,
  getEvolutionIconUrl,
  getHeroIconUrl,
} from '../data/cards';
import {
  reportFilename,
  type DeckLine,
  type ReportBlock,
  type ReportDoc,
  type ReportHue,
  type TableBlock,
  type TableCell,
} from './analyticsReport';

/**
 * Draws a `ReportDoc` as a PDF, in the site's own colours.
 *
 * THE PALETTE IS READ FROM THE PAGE, NOT DECLARED HERE. `index.css` is this
 * project's single source of colour truth and the rule is that no module
 * defines a colour of its own — a rule a PDF renderer is the most tempting
 * place to break, because jsPDF wants numbers and CSS has strings. The deck
 * report broke it: `pdfRenderer.ts` carries a hardcoded navy `INK` table that
 * has never matched either theme and cannot follow a palette change.
 *
 * So this reads the computed custom properties off `<html>` at export time and
 * converts them. Three things fall out of that for free, and they are the
 * reason it is worth the parser:
 *
 *   - the report is drawn in the theme the reader currently has on, because
 *     `data-theme` has already resolved every token by the time we look;
 *   - a palette change reaches the PDF with no edit here at all;
 *   - the colours are EXACTLY the screen's, not a hand-matched approximation,
 *     which is what "the same colours as the website" has to mean to be
 *     checkable.
 *
 * `color-mix()` is the one thing not handled — Chrome serialises it as
 * `color(srgb …)`, which the parser does read, but only once a value has been
 * resolved against a real element. Tokens that are plain hex resolve directly;
 * the few mixed ones are resolved by painting them on a probe element first.
 */

type RGB = readonly [number, number, number];

/* --------------------------------------------------------------- palette */

/** Every token the renderer needs, by its CSS name. */
const TOKENS = {
  page: '--bg-1',
  surface: '--surface',
  nested: '--surface-nested',
  sunken: '--surface-sunken',
  border: '--border',
  borderStrong: '--border-strong',
  text: '--text',
  muted: '--text-muted',
  onSolid: '--on-solid',
  violet: '--hue-violet',
  pink: '--hue-pink',
  blue: '--hue-blue',
  green: '--hue-green',
  red: '--hue-red',
  solidViolet: '--solid-violet',
  solidPink: '--solid-maroon',
  solidBlue: '--solid-blue',
  solidGreen: '--solid-green',
  solidRed: '--solid-red',
  gold: '--gold',
  use: '--c-use',
  win: '--c-win',
} as const;

type PaletteKey = keyof typeof TOKENS;
export type Palette = Record<PaletteKey, RGB> & { dark: boolean };

const FALLBACK: RGB = [128, 128, 128];

/**
 * Resolve a CSS colour string to RGB.
 *
 * Everything goes through a real element rather than being regex'd, because the
 * tokens are not all one syntax: some are `#rrggbb`, the theme blocks emit
 * `rgb(r, g, b)`, and anything built with `color-mix` serialises as
 * `color(srgb r g b / a)` in Chrome — a form a naive `rgba(...)` regex reports
 * as "no colour" (this project has already been caught by exactly that).
 * Painting the value and reading it back makes the browser do the parsing.
 */
function resolveColor(probe: HTMLElement, value: string): RGB {
  if (!value) return FALLBACK;
  probe.style.color = '';
  probe.style.color = value.trim();
  const out = getComputedStyle(probe).color;
  const m = out.match(/-?[\d.]+(?:e[-+]?\d+)?/gi);
  if (!m || m.length < 3) return FALLBACK;
  // `color(srgb …)` reports 0..1 components; `rgb()` reports 0..255.
  const srgb = out.startsWith('color(');
  const scale = srgb ? 255 : 1;
  const [r, g, b] = m.slice(0, 3).map((n) => Number(n) * scale);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return [clamp(r), clamp(g), clamp(b)];
}

export function readPalette(): Palette {
  const root = document.documentElement;
  const cs = getComputedStyle(root);

  // Off-screen, but attached — a detached node has no computed style.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;pointer-events:none';
  document.body.appendChild(probe);

  const out = {} as Palette;
  try {
    for (const [key, token] of Object.entries(TOKENS) as [PaletteKey, string][]) {
      out[key] = resolveColor(probe, cs.getPropertyValue(token));
    }
  } finally {
    probe.remove();
  }

  // Which theme is on decides more than colour: page furniture that reads as a
  // subtle sheen on a dark ground reads as dirt on a white one.
  out.dark = (root.dataset.theme ?? '') === 'dark'
    || (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return out;
}

function hueColor(p: Palette, hue: ReportHue | undefined, solid = false): RGB {
  switch (hue) {
    case 'violet': return solid ? p.solidViolet : p.violet;
    case 'pink': return solid ? p.solidPink : p.pink;
    case 'blue': return solid ? p.solidBlue : p.blue;
    case 'green': return solid ? p.solidGreen : p.green;
    case 'red': return solid ? p.solidRed : p.red;
    default: return solid ? p.borderStrong : p.muted;
  }
}

/* ---------------------------------------------------------------- layout */

/** A4 landscape, matching the deck report so the two exports read as one
 *  product — and matching the screens, which are wide tables. */
const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_TOP = 30;
const FOOTER_Y = PAGE_H - 10;
const BODY_BOTTOM = FOOTER_Y - 8;

const CARD_RATIO = 302 / 363;
/** Downscaled tile width. Card art at native size makes a 10-deck report ~40 MB;
 *  at 150 px it is under a megabyte and still sharp at print size. */
const TILE_PX = 150;

/* ------------------------------------------------------------------ fonts */

/**
 * NO EMBEDDED FONT. The site's display face is Arial, a system font, and
 * jsPDF's built-in Helvetica is metrically compatible with it — same widths,
 * same shapes to within a hair — so the report matches the screen with nothing
 * downloaded, nothing converted and nothing to verify.
 *
 * That is worth stating because it replaces machinery. The face used to be
 * Kids Word, an OpenType/CFF file, and jsPDF has no CFF parser: `addFont`
 * SUCCEEDED and then every glyph failed at draw time into a PubSub error jsPDF
 * swallows, leaving a valid PDF whose headings were silently Helvetica anyway.
 * Fixing it properly took a conversion script, a committed TrueType build, and
 * a runtime check that the embed had actually worked. Moving the site to a
 * system face deleted all three.
 *
 * `scripts/build-pdf-font.py` is kept, unreferenced, as the record of how to
 * bring a custom face back — that is the part that is hard to rediscover.
 *
 * `bold` is a real cut here, unlike the single-cut face this replaced, so a
 * heading gets a drawn weight rather than a synthesised one.
 */
function setFont(doc: JsPdfType, kind: 'sans' | 'display', bold = false) {
  doc.setFont('helvetica', kind === 'display' || bold ? 'bold' : 'normal');
}

/* ---------------------------------------------------------------- effects */

let GStateCtor: typeof import('jspdf').GState | null = null;

/** Both alphas — jsPDF's `opacity` is only the fill key `ca`, so a stroke drawn
 *  inside this would otherwise come out fully solid. */
function alpha(doc: JsPdfType, value: number, draw: () => void) {
  if (!GStateCtor) {
    draw();
    return;
  }
  doc.setGState(new GStateCtor({ opacity: value, 'stroke-opacity': value }));
  draw();
  doc.setGState(new GStateCtor({ opacity: 1, 'stroke-opacity': 1 }));
}

const fill = (doc: JsPdfType, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const stroke = (doc: JsPdfType, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
const ink = (doc: JsPdfType, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

/** A tint of `c` over `ground`, the way the app's level-1 and level-2 washes
 *  work — mixed against the surface it will actually sit on rather than faded
 *  to white, which is what keeps a tint honest in both themes. */
function mix(c: RGB, ground: RGB, amount: number): RGB {
  return [
    Math.round(ground[0] + (c[0] - ground[0]) * amount),
    Math.round(ground[1] + (c[1] - ground[1]) * amount),
    Math.round(ground[2] + (c[2] - ground[2]) * amount),
  ];
}

/* ------------------------------------------------------------ card images */

const tileCache = new Map<string, string | null>();

function artUrl(card: string, variant?: 'evolution' | 'hero'): string {
  if (variant === 'evolution') return getEvolutionIconUrl(card);
  if (variant === 'hero') return getHeroIconUrl(card);
  return getCardIconUrl(card);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * A card as a JPEG data URI on the tile colour.
 *
 * JPEG, not PNG: the art is photographic and PNG keeps a 10-deck report near
 * 40 MB. JPEG has no alpha, which is why the canvas is flooded with the tile
 * colour first — otherwise every transparent corner comes out black.
 */
async function buildTile(url: string, bg: RGB): Promise<string | null> {
  const key = `${url}|${bg.join(',')}`;
  const hit = tileCache.get(key);
  if (hit !== undefined) return hit;

  const img = await loadImage(url);
  if (!img) {
    tileCache.set(key, null);
    return null;
  }
  const w = TILE_PX;
  const h = Math.round(TILE_PX / CARD_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    tileCache.set(key, null);
    return null;
  }
  ctx.fillStyle = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
  ctx.fillRect(0, 0, w, h);
  // `contain`, matching the screens: the PNGs are not one shape, so sizing by
  // width alone makes a row's height depend on whether it holds an evolution.
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const data = canvas.toDataURL('image/jpeg', 0.82);
  tileCache.set(key, data);
  return data;
}

function deckUrls(decks: DeckLine[]): { url: string; card: string }[] {
  const seen = new Set<string>();
  const out: { url: string; card: string }[] = [];
  for (const d of decks) {
    for (const c of d.cards) {
      const url = artUrl(c, d.art?.[c]);
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, card: c });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ text */

function clip(doc: JsPdfType, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/* ----------------------------------------------------------------- state */

interface Ctx {
  doc: JsPdfType;
  p: Palette;
  docModel: ReportDoc;
  tiles: Map<string, string | null>;
  y: number;
  page: number;
}

function newPage(ctx: Ctx) {
  ctx.doc.addPage();
  ctx.page += 1;
  paintPage(ctx);
  ctx.y = BODY_TOP;
}

/** Ensure `h` millimetres are available; break if not. */
function reserve(ctx: Ctx, h: number) {
  if (ctx.y + h <= BODY_BOTTOM) return;
  newPage(ctx);
}

function paintPage(ctx: Ctx) {
  const { doc, p } = ctx;
  fill(doc, p.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
}

function header(ctx: Ctx) {
  const { doc, p, docModel } = ctx;
  const accent = hueColor(p, docModel.hue, true);

  // A solid block of the screen's own hue with white lettering — the painted
  // heading the app uses for area titles. `--on-solid` is graded so white holds
  // 5.5:1 on every solid step in both themes, so no per-theme variant here.
  setFont(doc, 'display');
  doc.setFontSize(15);
  const title = docModel.screen;
  const tw = doc.getTextWidth(title);
  fill(doc, accent);
  doc.roundedRect(MARGIN, 12, tw + 8, 10, 2.5, 2.5, 'F');
  ink(doc, p.onSolid);
  doc.text(title, MARGIN + 4, 19.2);

  if (docModel.subject) {
    setFont(doc, 'sans', true);
    doc.setFontSize(10);
    ink(doc, p.text);
    doc.text(docModel.subject, MARGIN + tw + 14, 19);
  }

  stroke(doc, p.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 25, PAGE_W - MARGIN, 25);
}

function footer(ctx: Ctx, total: number) {
  const { doc, p } = ctx;
  stroke(doc, p.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, FOOTER_Y - 4, PAGE_W - MARGIN, FOOTER_Y - 4);

  setFont(doc, 'sans');
  doc.setFontSize(7.5);
  ink(doc, p.muted);
  doc.text('Dekkies', MARGIN, FOOTER_Y);
  doc.text(`${ctx.page} / ${total}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
}

/* ---------------------------------------------------------------- blocks */

function blockHeading(ctx: Ctx, heading?: string, note?: string): void {
  const { doc, p } = ctx;
  if (!heading && !note) return;
  reserve(ctx, note ? 12 : 8);
  if (heading) {
    setFont(doc, 'display');
    doc.setFontSize(11);
    ink(doc, p.text);
    doc.text(heading, MARGIN, ctx.y + 4);
    ctx.y += 6.5;
  }
  if (note) {
    setFont(doc, 'sans');
    doc.setFontSize(7.5);
    ink(doc, p.muted);
    doc.text(clip(doc, note, CONTENT_W), MARGIN, ctx.y + 3);
    ctx.y += 5;
  }
  ctx.y += 1.5;
}

function drawStats(ctx: Ctx, tiles: { label: string; value: string; note?: string; hue?: ReportHue }[]) {
  const { doc, p } = ctx;
  if (!tiles.length) return;
  const H = 20;
  reserve(ctx, H + 4);

  const gap = 3;
  const n = Math.min(tiles.length, 6);
  const w = (CONTENT_W - gap * (n - 1)) / n;

  tiles.slice(0, n).forEach((t, i) => {
    const x = MARGIN + i * (w + gap);
    fill(doc, p.nested);
    stroke(doc, p.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, ctx.y, w, H, 2.5, 2.5, 'FD');

    setFont(doc, 'display');
    doc.setFontSize(15);
    ink(doc, t.hue ? hueColor(p, t.hue) : p.text);
    doc.text(clip(doc, t.value, w - 6), x + 3, ctx.y + 9);

    setFont(doc, 'sans', true);
    doc.setFontSize(7);
    ink(doc, p.text);
    doc.text(clip(doc, t.label, w - 6), x + 3, ctx.y + 13.5);

    if (t.note) {
      setFont(doc, 'sans');
      doc.setFontSize(6.2);
      ink(doc, p.muted);
      doc.text(clip(doc, t.note, w - 6), x + 3, ctx.y + 17.2);
    }
  });
  ctx.y += H + 5;
}

function cellOf(v: TableCell | string): TableCell {
  return typeof v === 'string' ? { text: v } : v;
}

function columnX(block: TableBlock): { x: number; w: number }[] {
  const fixed = block.columns.reduce((a, c) => a + (c.flex ? 0 : (c.width ?? 24)), 0);
  const flexCount = block.columns.filter((c) => c.flex).length;
  const spare = Math.max(0, CONTENT_W - fixed);
  const each = flexCount ? spare / flexCount : 0;
  let x = MARGIN;
  return block.columns.map((c) => {
    const w = c.flex ? each : (c.width ?? 24);
    const out = { x, w };
    x += w;
    return out;
  });
}

function drawTable(ctx: Ctx, block: TableBlock) {
  const { doc, p } = ctx;
  const cols = columnX(block);
  const ROW = 7;

  const head = () => {
    reserve(ctx, ROW * 2);
    fill(doc, p.sunken);
    doc.rect(MARGIN, ctx.y, CONTENT_W, ROW, 'F');
    setFont(doc, 'sans', true);
    doc.setFontSize(6.8);
    ink(doc, p.muted);
    block.columns.forEach((c, i) => {
      const { x, w } = cols[i];
      const right = c.align === 'right';
      doc.text(clip(doc, c.label.toUpperCase(), w - 4), right ? x + w - 2 : x + 2, ctx.y + 4.7, {
        align: right ? 'right' : 'left',
      });
    });
    ctx.y += ROW;
  };

  head();

  for (const row of block.rows) {
    if (ctx.y + ROW > BODY_BOTTOM) {
      newPage(ctx);
      head();
    }
    block.columns.forEach((c, i) => {
      const { x, w } = cols[i];
      const cell = cellOf(row[c.key] ?? '');

      // The bar sits BEHIND the text, as a proportional wash — the same
      // "figure plus its own bar" the screens use, so a column can be scanned
      // as a shape and read as a number without two separate columns.
      if (cell.bar !== undefined && cell.bar > 0) {
        const bw = Math.max(0.6, Math.min(1, cell.bar)) * (w - 4);
        fill(doc, mix(hueColor(p, cell.hue), p.surface, cell.thin ? 0.12 : 0.3));
        doc.roundedRect(x + 2, ctx.y + 1.2, bw, ROW - 2.4, 0.8, 0.8, 'F');
      }

      setFont(doc, 'sans', false);
      doc.setFontSize(7.2);
      ink(doc, cell.thin ? p.muted : cell.hue ? hueColor(p, cell.hue) : p.text);
      const right = c.align === 'right';
      doc.text(clip(doc, cell.text, w - 4), right ? x + w - 2 : x + 2, ctx.y + 4.8, {
        align: right ? 'right' : 'left',
      });
    });

    stroke(doc, p.border);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, ctx.y + ROW, PAGE_W - MARGIN, ctx.y + ROW);
    ctx.y += ROW;
  }
  ctx.y += 4;
}

function drawBars(
  ctx: Ctx,
  bars: { label: string; value: string; fraction: number; hue?: ReportHue; thin?: boolean }[],
) {
  const { doc, p } = ctx;
  const ROW = 8;
  const LABEL_W = 64;
  const VALUE_W = 22;
  const trackW = CONTENT_W - LABEL_W - VALUE_W - 6;

  for (const b of bars) {
    reserve(ctx, ROW);
    setFont(doc, 'sans');
    doc.setFontSize(7.4);
    ink(doc, p.text);
    doc.text(clip(doc, b.label, LABEL_W - 3), MARGIN, ctx.y + 5);

    const tx = MARGIN + LABEL_W;
    // The track is the well colour — a meter needs somewhere to be empty, and
    // an unfilled bar with no track is indistinguishable from a missing row.
    fill(doc, p.sunken);
    doc.roundedRect(tx, ctx.y + 1.4, trackW, 4.4, 1.2, 1.2, 'F');

    const f = Math.max(0, Math.min(1, b.fraction));
    if (f > 0) {
      // A thin reading keeps its place and loses its colour — true, but not
      // something that would survive being measured again.
      fill(doc, b.thin ? p.borderStrong : hueColor(p, b.hue));
      doc.roundedRect(tx, ctx.y + 1.4, Math.max(1.2, trackW * f), 4.4, 1.2, 1.2, 'F');
    }

    setFont(doc, 'sans', true);
    doc.setFontSize(7.4);
    ink(doc, b.thin ? p.muted : p.text);
    doc.text(b.value, PAGE_W - MARGIN, ctx.y + 5, { align: 'right' });
    ctx.y += ROW;
  }
  ctx.y += 3;
}

function drawDecks(ctx: Ctx, decks: DeckLine[]) {
  const { doc, p } = ctx;
  const ROW = 20;
  const IDENT_W = 62;
  const VALUE_W = 22;

  for (const d of decks) {
    reserve(ctx, ROW + 2);
    const top = ctx.y;

    fill(doc, p.nested);
    stroke(doc, p.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, top, CONTENT_W, ROW, 2, 2, 'FD');

    setFont(doc, 'sans', true);
    doc.setFontSize(8);
    ink(doc, p.text);
    doc.text(clip(doc, d.name, IDENT_W - 6), MARGIN + 3, top + 7);

    if (d.meta) {
      setFont(doc, 'sans');
      doc.setFontSize(6.4);
      ink(doc, p.muted);
      doc.text(clip(doc, d.meta, IDENT_W - 6), MARGIN + 3, top + 11.5);
    }
    if (d.inferredArt) {
      setFont(doc, 'sans');
      doc.setFontSize(5.8);
      ink(doc, p.muted);
      doc.text('art inferred from slot position', MARGIN + 3, top + 15.5);
    }

    // The strip: eight cards on one line, sharing whatever the column has.
    const stripX = MARGIN + IDENT_W;
    const stripW = CONTENT_W - IDENT_W - VALUE_W;
    const gap = 1.2;
    const cw = (stripW - gap * (d.cards.length - 1)) / d.cards.length;
    const ch = cw / CARD_RATIO;
    const cy = top + (ROW - ch) / 2;

    d.cards.forEach((card, i) => {
      const url = artUrl(card, d.art?.[card]);
      const data = ctx.tiles.get(url);
      const x = stripX + i * (cw + gap);
      if (data) {
        // Aliased on the URL so eight decks sharing a card embed it once.
        doc.addImage(data, 'JPEG', x, cy, cw, ch, url, 'FAST');
      } else {
        fill(doc, p.sunken);
        doc.roundedRect(x, cy, cw, ch, 0.8, 0.8, 'F');
        setFont(doc, 'sans');
        doc.setFontSize(4.5);
        ink(doc, p.muted);
        const name = CARDS_BY_KEY.get(card)?.name ?? card;
        doc.text(clip(doc, name, cw - 1), x + cw / 2, cy + ch / 2, { align: 'center' });
      }
    });

    if (d.value) {
      setFont(doc, 'display');
      doc.setFontSize(12);
      ink(doc, p.text);
      doc.text(d.value, PAGE_W - MARGIN - 3, top + 9, { align: 'right' });
    }
    if (d.valueNote) {
      setFont(doc, 'sans');
      doc.setFontSize(5.8);
      ink(doc, p.muted);
      doc.text(d.valueNote, PAGE_W - MARGIN - 3, top + 13, { align: 'right' });
    }

    ctx.y += ROW + 2.5;
  }
  ctx.y += 2;
}

function drawNote(ctx: Ctx, body: string) {
  const { doc, p } = ctx;
  setFont(doc, 'sans');
  doc.setFontSize(7.6);
  const lines = doc.splitTextToSize(body, CONTENT_W - 8) as string[];
  const h = lines.length * 4 + 6;
  reserve(ctx, h);

  fill(doc, p.nested);
  doc.roundedRect(MARGIN, ctx.y, CONTENT_W, h, 2, 2, 'F');
  ink(doc, p.muted);
  lines.forEach((ln, i) => doc.text(ln, MARGIN + 4, ctx.y + 5 + i * 4));
  ctx.y += h + 4;
}

/* ------------------------------------------------------------------ cover */

function drawCover(ctx: Ctx) {
  const { doc, p, docModel } = ctx;
  const accent = hueColor(p, docModel.hue, true);

  paintPage(ctx);

  // A wide band of the screen's hue. The one large coloured surface in the
  // report — everywhere else the raw hue only ever lands on small things, which
  // is the rule that keeps a neutral document neutral.
  fill(doc, accent);
  doc.rect(0, 0, PAGE_W, 52, 'F');

  setFont(doc, 'display');
  doc.setFontSize(30);
  ink(doc, p.onSolid);
  doc.text(docModel.screen, MARGIN, 30);

  setFont(doc, 'sans', true);
  doc.setFontSize(11);
  alpha(doc, 0.85, () => {
    doc.text(docModel.subject ?? 'Dekkies analytics', MARGIN, 41);
  });

  setFont(doc, 'display');
  doc.setFontSize(11);
  ink(doc, p.onSolid);
  alpha(doc, 0.8, () => doc.text('DEKKIES', PAGE_W - MARGIN, 30, { align: 'right' }));

  // The query. Every one of these is needed to interpret the figures, which is
  // why the cover states them rather than leaving them implicit.
  let y = 66;
  setFont(doc, 'sans', true);
  doc.setFontSize(8);
  ink(doc, p.muted);
  doc.text('ABOUT THIS REPORT', MARGIN, y);
  y += 6;

  for (const m of docModel.meta) {
    fill(doc, p.nested);
    doc.roundedRect(MARGIN, y, CONTENT_W / 2 - 4, 9, 1.8, 1.8, 'F');
    setFont(doc, 'sans');
    doc.setFontSize(7.2);
    ink(doc, p.muted);
    doc.text(m.label, MARGIN + 3, y + 5.8);
    setFont(doc, 'sans', true);
    ink(doc, p.text);
    doc.text(clip(doc, m.value, CONTENT_W / 2 - 46), MARGIN + 42, y + 5.8);
    y += 11;
  }

  setFont(doc, 'sans');
  doc.setFontSize(7);
  ink(doc, p.muted);
  doc.text(
    `Generated ${new Date().toLocaleString('en-GB')} — figures are as stored at that moment.`,
    MARGIN,
    PAGE_H - 16,
  );
}

/* ----------------------------------------------------------------- render */

export async function renderAnalyticsReport(docModel: ReportDoc): Promise<Blob> {
  // Dynamic, and it must stay that way — jsPDF is 390 kB and no one who never
  // exports should pay for it on load.
  const { jsPDF, GState } = await import('jspdf');
  GStateCtor = GState;

  const p = readPalette();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  // No font to register: the display face is Arial and jsPDF's built-in
  // Helvetica matches it metrically. See `setFont`.

  // Every card in the report, built once and reused by URL alias.
  const decks = docModel.blocks.flatMap((b) => (b.kind === 'decks' ? b.decks : []));
  const tiles = new Map<string, string | null>();
  await Promise.all(
    deckUrls(decks).map(async ({ url }) => {
      tiles.set(url, await buildTile(url, p.nested));
    }),
  );

  const ctx: Ctx = { doc, p, docModel, tiles, y: BODY_TOP, page: 1 };

  drawCover(ctx);
  newPage(ctx);
  header(ctx);
  ctx.y = BODY_TOP + 4;

  for (const block of docModel.blocks as ReportBlock[]) {
    if (block.kind === 'break') {
      newPage(ctx);
      header(ctx);
      ctx.y = BODY_TOP + 4;
      continue;
    }
    blockHeading(ctx, block.heading, block.note);
    switch (block.kind) {
      case 'stats': drawStats(ctx, block.tiles); break;
      case 'table': drawTable(ctx, block); break;
      case 'bars': drawBars(ctx, block.bars); break;
      case 'decks': drawDecks(ctx, block.decks); break;
      case 'note': drawNote(ctx, block.body); break;
    }
  }

  if (docModel.caveats?.length) {
    reserve(ctx, 8 + docModel.caveats.length * 4);
    setFont(doc, 'sans', true);
    doc.setFontSize(7.5);
    ink(doc, p.muted);
    doc.text('WHAT THIS REPORT DOES NOT SAY', MARGIN, ctx.y + 4);
    ctx.y += 7;
    setFont(doc, 'sans');
    doc.setFontSize(7);
    for (const c of docModel.caveats) {
      const lines = doc.splitTextToSize(`— ${c}`, CONTENT_W) as string[];
      reserve(ctx, lines.length * 3.6);
      lines.forEach((ln, i) => doc.text(ln, MARGIN, ctx.y + i * 3.6));
      ctx.y += lines.length * 3.6 + 1.5;
    }
  }

  // Footers last: the page total is not known until everything is laid out.
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i += 1) {
    doc.setPage(i);
    ctx.page = i;
    footer(ctx, total);
  }

  return doc.output('blob');
}

export async function downloadAnalyticsReport(docModel: ReportDoc): Promise<void> {
  const blob = await renderAnalyticsReport(docModel);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(docModel);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick — revoking synchronously races the download in
  // Firefox and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
