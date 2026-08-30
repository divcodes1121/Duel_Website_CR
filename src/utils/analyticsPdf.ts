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
  type DividerBlock,
  type MatrixBlock,
  type ReportBlock,
  type ReportDoc,
  type ReportHue,
  type SpreadBlock,
  type TableBlock,
  type TableCell,
  type VersusBlock,
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
  /** Filled by `drawDivider` as sections land, read by the contents pass. */
  contents: { title: string; page: number; depth: number }[];
  /** The heading of the block being drawn, so a page it spills onto can say
   *  what it is continuing. Null between blocks and for unheaded ones. */
  flow: string | null;
}

/**
 * A fresh sheet.
 *
 * THE HEADER IS DRAWN HERE, NOT BY THE CALLER, and that is a fix rather than a
 * tidy-up. It used to be the render loop's job, which meant only a page opened
 * by an explicit `break` ever got one — every page a block SPILLED onto came
 * out with a 30 mm empty band at the top where the bar should be, and no
 * indication of which report it belonged to. Half the sheets in a long
 * document are spill pages, so half the document looked unfinished.
 *
 * `bare` is for the divider, which paints its own full-width band and must not
 * have a second, smaller one over it.
 */
function newPage(ctx: Ctx, chrome: 'body' | 'bare' = 'body') {
  ctx.doc.addPage();
  ctx.page += 1;
  paintPage(ctx);
  if (chrome === 'bare') {
    ctx.y = BODY_TOP;
    return;
  }
  header(ctx);
  ctx.y = BODY_TOP + 4;

  /* A CONTINUED BLOCK SAYS SO. Landing on a sheet that opens with six deck
     plates and no heading, because the heading was on the sheet before, is the
     single most disorienting thing a paginated document can do — the reader
     cannot tell whose decks they are without turning back. */
  if (ctx.flow) {
    const { doc, p } = ctx;
    setFont(doc, 'sans', true);
    doc.setFontSize(8);
    ink(doc, p.muted);
    doc.text(`${ctx.flow} (continued)`, MARGIN, ctx.y + 3.5);
    ctx.y += 8;
  }
}

/** Ensure `h` millimetres are available; break if not. */
function reserve(ctx: Ctx, h: number) {
  if (ctx.y + h <= BODY_BOTTOM) return;
  newPage(ctx);
}

/**
 * The least of a block that must fit beside its own heading.
 *
 * ORPHAN CONTROL. `blockHeading` used to reserve only its own two lines, so a
 * heading could be placed with 6 mm left on the sheet and everything it
 * introduced began on the next one — "What your squad should bring" alone at
 * the foot of a page, decks overleaf. A heading that is not on the same sheet
 * as the thing it names is not a heading, it is a loose sentence.
 */
function firstChunk(block: ReportBlock): number {
  switch (block.kind) {
    case 'stats': return 25;
    case 'table': return 7 * 3;          // column head + two rows
    case 'bars': return 8 * 2;
    case 'decks': return 34;             // one whole deck row, art-sized
    case 'note': return 12;
    case 'matrix': return 15 + 11 * 2;   // column heads + two rows
    case 'spread': return 11 + 8;        // the band and its first legend line
    case 'versus': return 100;           // one full pair — they stand ~94 mm
    default: return 0;
  }
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
  doc.text('Deckkies', MARGIN, FOOTER_Y);
  doc.text(`${ctx.page} / ${total}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
}

/* ---------------------------------------------------------------- blocks */

function blockHeading(ctx: Ctx, heading?: string, note?: string, minBody = 0): void {
  const { doc, p } = ctx;
  /* Cleared FIRST: the heading is about to be drawn fresh, so a break taken
     inside the reserve below is not a continuation and must not be labelled
     as one. It is set again once the heading is actually on the page. */
  ctx.flow = null;
  if (!heading && !note) return;
  const own = (heading ? 6.5 : 0) + (note ? 5 : 0) + 1.5;
  // Reserved TOGETHER — see `firstChunk`.
  reserve(ctx, own + minBody);
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
  ctx.flow = heading ?? null;
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

  let repeated = false;
  const head = () => {
    reserve(ctx, ROW * 2);
    fill(doc, p.sunken);
    doc.rect(MARGIN, ctx.y, CONTENT_W, ROW, 'F');
    // A repeated column head is otherwise indistinguishable from the start of
    // a second, different table.
    if (repeated) {
      setFont(doc, 'sans');
      doc.setFontSize(6);
      ink(doc, p.muted);
      doc.text('continued', PAGE_W - MARGIN, ctx.y - 1.5, { align: 'right' });
    }
    repeated = true;
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
  const IDENT_W = 62;
  const VALUE_W = 22;
  const gap = 1.2;
  const stripW = CONTENT_W - IDENT_W - VALUE_W;

  for (const d of decks) {
    /* THE ROW IS SIZED BY THE ART, AND IT USED TO BE THE OTHER WAY ROUND.
       `ROW` was a flat 20 mm while the strip is 185 mm wide, so eight cards
       came out 22.1 mm across and — at the card aspect — 26.5 mm TALL. The art
       overflowed its own row by 3.3 mm at the top and the bottom: it printed
       over the block's note above it and welded every row to the next, so a
       list of six decks read as one continuous slab. It is a flat-`ROW` bug,
       so it was in every analytics report that draws decks, not just this one.

       Sizing the row from the art keeps the cards large (which is the point of
       printing them) and cannot overflow by construction. The 20 mm floor is
       still there for a short deck, where the art is not the constraint. */
    const n = Math.max(1, d.cards.length);
    const cw = (stripW - gap * (n - 1)) / n;
    const ch = cw / CARD_RATIO;
    const ROW = Math.max(20, ch + 4);

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

    /* CLIPPED TO THE COLUMN. These are right-aligned in a 22 mm value column,
       so anything wider does not overflow to the right where it would be
       obvious — it grows LEFTWARDS, straight over the card art, and the only
       sign is a caption sitting on top of a picture. A caller passing too long
       a note is not a bug in the caller; a column that does not hold its own
       width is a bug here. */
    const valueX = PAGE_W - MARGIN - 3;
    if (d.value) {
      setFont(doc, 'display');
      doc.setFontSize(12);
      ink(doc, p.text);
      doc.text(clip(doc, d.value, VALUE_W - 4), valueX, top + 9, { align: 'right' });
    }
    if (d.valueNote) {
      setFont(doc, 'sans');
      doc.setFontSize(5.8);
      ink(doc, p.muted);
      doc.text(clip(doc, d.valueNote, VALUE_W - 4), valueX, top + 13, { align: 'right' });
    }

    ctx.y += ROW + 2.5;
  }
  ctx.y += 2;
}

/* ------------------------------------------------- divider (a title sheet) */

/**
 * Opens a section on its own sheet.
 *
 * The one place besides the cover where a large field of hue is allowed. It is
 * deliberate: a reader flicking through forty pages needs a landmark that is
 * recognisable at thumb speed, and a heading in the body text is not one.
 */
function drawDivider(ctx: Ctx, block: DividerBlock) {
  const { doc, p } = ctx;
  newPage(ctx, 'bare');
  // A divider is not a continuation of anything.
  ctx.flow = null;
  const accent = hueColor(p, block.hue, true);

  // A tall band rather than the cover's full bleed, so the two never read as
  // the same kind of page — a section is subordinate to the document.
  fill(doc, accent);
  doc.rect(0, 0, PAGE_W, 74, 'F');

  // A hairline of the ink step under the band. On dark the solid step and the
  // page are close enough in value that the band's lower edge disappears.
  fill(doc, hueColor(p, block.hue));
  doc.rect(0, 74, PAGE_W, 0.8, 'F');

  if (block.subtitle) {
    setFont(doc, 'sans', true);
    doc.setFontSize(9);
    ink(doc, p.onSolid);
    alpha(doc, 0.8, () =>
      doc.text(block.subtitle!.toUpperCase(), MARGIN, 26, { charSpace: 0.6 }),
    );
  }

  setFont(doc, 'display');
  doc.setFontSize(30);
  ink(doc, p.onSolid);
  doc.text(clip(doc, block.title, CONTENT_W - 40), MARGIN, 45);

  if (block.tag) {
    setFont(doc, 'sans');
    doc.setFontSize(11);
    ink(doc, p.onSolid);
    alpha(doc, 0.85, () => doc.text(block.tag!, MARGIN, 57));
  }

  setFont(doc, 'display');
  doc.setFontSize(10);
  ink(doc, p.onSolid);
  alpha(doc, 0.65, () => doc.text('DECKKIES', PAGE_W - MARGIN, 26, { align: 'right' }));

  if (block.stats?.length) {
    const n = Math.min(block.stats.length, 4);
    const gap = 4;
    const w = (CONTENT_W - gap * (n - 1)) / n;
    block.stats.slice(0, n).forEach((s, i) => {
      const x = MARGIN + i * (w + gap);
      fill(doc, p.nested);
      stroke(doc, p.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, 88, w, 26, 2.5, 2.5, 'FD');

      setFont(doc, 'display');
      doc.setFontSize(19);
      ink(doc, p.text);
      doc.text(clip(doc, s.value, w - 8), x + 4, 101);

      setFont(doc, 'sans', true);
      doc.setFontSize(7.4);
      ink(doc, p.muted);
      doc.text(clip(doc, s.label.toUpperCase(), w - 8), x + 4, 107, { charSpace: 0.3 });

      if (s.note) {
        setFont(doc, 'sans');
        doc.setFontSize(6.4);
        ink(doc, p.muted);
        doc.text(clip(doc, s.note, w - 8), x + 4, 111.5);
      }
    });
    ctx.y = 122;
  } else {
    ctx.y = 90;
  }

  ctx.contents.push({
    title: block.contents ?? block.title,
    page: ctx.page,
    depth: block.depth ?? 0,
  });
}

/* ---------------------------------------------------------------- matrix */

/**
 * The whole board as a grid.
 *
 * COLOUR IS SCALED ACROSS THE RANGE PRESENT, not across 0..100. Every figure in
 * this grid is an expected win rate, and those live in a narrow band — a run of
 * values from 48 to 57 painted on an absolute scale is nine shades of the same
 * beige, and the pairing that needs attention looks like all the others. The
 * legend says what the ends of the scale are so the compression is stated
 * rather than hidden.
 *
 * A null cell is drawn EMPTY, with a rule through it. It is not a low score; it
 * is the absence of evidence, and the two must not look alike.
 */
function drawMatrix(ctx: Ctx, block: MatrixBlock) {
  const { doc, p } = ctx;
  if (!block.rows.length || !block.columns.length) return;

  const LABEL_W = 46;
  const HEAD_H = 15;
  const ROW_H = 11;
  const cellW = Math.max(14, (CONTENT_W - LABEL_W) / block.columns.length);
  const gridW = LABEL_W + cellW * block.columns.length;

  const values = block.rows
    .flatMap((r) => r.cells.map((c) => c.fraction))
    .filter((f): f is number => f !== null);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const span = hi - lo || 1;

  reserve(ctx, HEAD_H + ROW_H * block.rows.length + 10);
  const top = ctx.y;

  // Column headings, rotated is tempting and wrong: at this size rotated text
  // is unreadable and the labels are short enough to clip honestly.
  setFont(doc, 'sans', true);
  doc.setFontSize(6.4);
  ink(doc, p.muted);
  block.columns.forEach((c, i) => {
    const x = MARGIN + LABEL_W + i * cellW;
    doc.text(clip(doc, c.label, cellW - 2), x + cellW / 2, top + 6, { align: 'center' });
    if (c.sub) {
      setFont(doc, 'sans');
      doc.setFontSize(5.4);
      doc.text(clip(doc, c.sub, cellW - 2), x + cellW / 2, top + 10, { align: 'center' });
      setFont(doc, 'sans', true);
      doc.setFontSize(6.4);
    }
  });

  block.rows.forEach((r, ri) => {
    const y = top + HEAD_H + ri * ROW_H;

    setFont(doc, 'sans', true);
    doc.setFontSize(7);
    ink(doc, p.text);
    doc.text(clip(doc, r.label, LABEL_W - 4), MARGIN, y + 6);
    if (r.sub) {
      setFont(doc, 'sans');
      doc.setFontSize(5.6);
      ink(doc, p.muted);
      doc.text(clip(doc, r.sub, LABEL_W - 4), MARGIN, y + 9.6);
    }

    r.cells.forEach((cell, ci) => {
      const x = MARGIN + LABEL_W + ci * cellW;
      if (cell.fraction === null) {
        fill(doc, p.sunken);
        doc.roundedRect(x + 0.6, y + 0.6, cellW - 1.2, ROW_H - 1.2, 1, 1, 'F');
        stroke(doc, p.border);
        doc.setLineWidth(0.3);
        doc.line(x + 3, y + ROW_H / 2, x + cellW - 3, y + ROW_H / 2);
        return;
      }
      const t = (cell.fraction - lo) / span;
      /* Green at the top of the range, red at the bottom, through the surface
         in the middle — so "better than the rest of this board" and "worse
         than it" are opposite directions rather than two depths of one
         colour. The mix is against the SURFACE, not white, which is what keeps
         it legible when the theme flips. */
      const hue = t >= 0.5 ? p.green : p.red;
      const strength = Math.abs(t - 0.5) * 2;
      fill(doc, mix(hue, p.surface, 0.12 + strength * (cell.thin ? 0.18 : 0.48)));
      doc.roundedRect(x + 0.6, y + 0.6, cellW - 1.2, ROW_H - 1.2, 1, 1, 'F');

      setFont(doc, 'sans', true);
      doc.setFontSize(7);
      ink(doc, cell.thin ? p.muted : p.text);
      doc.text(cell.text, x + cellW / 2, y + 7, { align: 'center' });
    });
  });

  ctx.y = top + HEAD_H + ROW_H * block.rows.length + 3;

  if (block.legend) {
    setFont(doc, 'sans');
    doc.setFontSize(6.4);
    ink(doc, p.muted);
    doc.text(clip(doc, block.legend, gridW), MARGIN, ctx.y + 3);
    ctx.y += 6;
  }
  ctx.y += 3;
}

/* ---------------------------------------------------------------- spread */

/** One proportional band plus a legend. */
function drawSpread(ctx: Ctx, block: SpreadBlock) {
  const { doc, p } = ctx;
  const segs = block.segments.filter((s) => s.share > 0);
  if (!segs.length) return;

  const BAR_H = 11;
  const rows = Math.ceil(segs.length / 3);
  reserve(ctx, BAR_H + rows * 6 + 8);
  const top = ctx.y;

  const total = segs.reduce((a, s) => a + s.share, 0) || 100;
  // The five hues in a fixed order, so the same archetype keeps its colour
  // down a section rather than changing between the bar and the legend.
  const HUES: ReportHue[] = ['violet', 'blue', 'green', 'pink', 'red'];

  fill(doc, p.sunken);
  doc.roundedRect(MARGIN, top, CONTENT_W, BAR_H, 1.5, 1.5, 'F');

  let x = MARGIN;
  segs.forEach((s, i) => {
    const w = (s.share / total) * CONTENT_W;
    const c = hueColor(p, s.hue ?? HUES[i % HUES.length], true);
    fill(doc, c);
    doc.rect(x, top, w, BAR_H, 'F');
    // Only label in place when the segment can actually hold the text.
    if (w > 16) {
      setFont(doc, 'sans', true);
      doc.setFontSize(6.6);
      ink(doc, p.onSolid);
      doc.text(`${s.share.toFixed(0)}%`, x + w / 2, top + 7.2, { align: 'center' });
    }
    x += w;
  });

  // Hairline separators, drawn after so a segment cannot paint over its own
  // neighbour's edge.
  stroke(doc, p.page);
  doc.setLineWidth(0.4);
  let sx = MARGIN;
  segs.forEach((s) => {
    sx += (s.share / total) * CONTENT_W;
    if (sx < MARGIN + CONTENT_W - 0.5) doc.line(sx, top, sx, top + BAR_H);
  });

  let ly = top + BAR_H + 5;
  const colW = CONTENT_W / 3;
  segs.forEach((s, i) => {
    const col = i % 3;
    const lx = MARGIN + col * colW;
    if (col === 0 && i > 0) ly += 6;
    fill(doc, hueColor(p, s.hue ?? HUES[i % HUES.length], true));
    doc.roundedRect(lx, ly - 2.6, 3, 3, 0.6, 0.6, 'F');
    setFont(doc, 'sans', true);
    doc.setFontSize(6.8);
    ink(doc, p.text);
    doc.text(clip(doc, s.label, colW - 30), lx + 5, ly);
    setFont(doc, 'sans');
    ink(doc, p.muted);
    doc.text(s.note ?? `${s.share.toFixed(1)}%`, lx + colW - 4, ly, { align: 'right' });
  });

  ctx.y = ly + 7;
}

/* ---------------------------------------------------------------- versus */

/**
 * The card size a versus plate uses. ONE DEFINITION, read by both the plate
 * and the reserve that decides whether the pair fits — they were computed
 * separately and could disagree, which is how a block ends up half off a page.
 *
 * WIDTH-DRIVEN, AND ONE PAIR TO A SHEET. Sizing it to fit two was tried and
 * reverted: two pairs only fit by dropping the cards to ~17 mm, which leaves
 * the plate two-thirds empty across and makes the head-to-head — the one
 * spread in the document whose whole job is showing two decks at a glance —
 * the page with the smallest art on it. At full width a pair stands ~94 mm and
 * fills about four fifths of the body, which is a page, not a gap.
 */
const VS_GUTTER = 16;
function versusCard(w: number, gap: number): { cw: number; ch: number } {
  const cw = (w - 6 - gap * 3) / 4;
  return { cw, ch: cw / CARD_RATIO };
}

/** One deck as a 4x2 plate. Returns the height it drew. */
function deckPlate(ctx: Ctx, d: DeckLine, x: number, y: number, w: number, hue: ReportHue): number {
  const { doc, p } = ctx;
  const gap = 1.6;
  const { cw, ch } = versusCard(w, gap);
  const artH = ch * 2 + gap;
  const H = 15 + artH + 4;
  // The grid is CENTRED in the plate: the card size now comes from the height
  // budget, so it no longer necessarily fills the width, and a left-aligned
  // grid under a full-width title bar reads as a layout fault.
  const gridW = cw * 4 + gap * 3;
  const gx = x + (w - gridW) / 2;

  fill(doc, p.nested);
  stroke(doc, p.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, H, 2.5, 2.5, 'FD');

  // The side's own hue, as an edge rather than a fill — the plate has card art
  // in it and a tinted ground fights every one of the 122 palettes.
  fill(doc, hueColor(p, hue, true));
  doc.roundedRect(x, y, w, 1.6, 0.8, 0.8, 'F');

  setFont(doc, 'sans', true);
  doc.setFontSize(8.4);
  ink(doc, p.text);
  doc.text(clip(doc, d.name, w - 30), x + 3, y + 8);

  if (d.value) {
    setFont(doc, 'display');
    doc.setFontSize(11);
    ink(doc, hueColor(p, hue));
    doc.text(clip(doc, d.value, 26), x + w - 3, y + 8.4, { align: 'right' });
  }
  if (d.meta) {
    setFont(doc, 'sans');
    doc.setFontSize(6.2);
    ink(doc, p.muted);
    doc.text(clip(doc, d.meta, w - 6), x + 3, y + 12.6);
  }

  d.cards.slice(0, 8).forEach((card, i) => {
    const url = artUrl(card, d.art?.[card]);
    const data = ctx.tiles.get(url);
    const cx = gx + (i % 4) * (cw + gap);
    const cy = y + 15 + Math.floor(i / 4) * (ch + gap);
    if (data) {
      doc.addImage(data, 'JPEG', cx, cy, cw, ch, url, 'FAST');
    } else {
      fill(doc, p.sunken);
      doc.roundedRect(cx, cy, cw, ch, 0.8, 0.8, 'F');
      setFont(doc, 'sans');
      doc.setFontSize(4.6);
      ink(doc, p.muted);
      const name = CARDS_BY_KEY.get(card)?.name ?? card;
      doc.text(clip(doc, name, cw - 1), cx + cw / 2, cy + ch / 2, { align: 'center' });
    }
  });

  return H;
}

/** An absent answer, stated. Never a blank half. */
function emptyPlate(ctx: Ctx, x: number, y: number, w: number, h: number, body: string) {
  const { doc, p } = ctx;
  fill(doc, p.sunken);
  stroke(doc, p.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
  setFont(doc, 'sans');
  doc.setFontSize(7.4);
  ink(doc, p.muted);
  const lines = doc.splitTextToSize(body, w - 10) as string[];
  lines.forEach((ln, i) =>
    doc.text(ln, x + w / 2, y + h / 2 - (lines.length - 1) * 2 + i * 4, { align: 'center' }),
  );
}

function drawVersus(ctx: Ctx, block: VersusBlock) {
  const { doc, p } = ctx;
  const GUT = VS_GUTTER;
  const half = (CONTENT_W - GUT) / 2;

  if (block.leftLabel || block.rightLabel) {
    reserve(ctx, 7);
    setFont(doc, 'sans', true);
    doc.setFontSize(6.8);
    ink(doc, p.muted);
    if (block.leftLabel) doc.text(block.leftLabel.toUpperCase(), MARGIN, ctx.y + 3, { charSpace: 0.4 });
    if (block.rightLabel) {
      doc.text(block.rightLabel.toUpperCase(), MARGIN + half + GUT, ctx.y + 3, { charSpace: 0.4 });
    }
    ctx.y += 6;
  }

  for (const pair of block.pairs) {
    // Measured before it is drawn, so a pair never straddles a page break —
    // half a versus on each of two sheets is not a versus.
    const H = 15 + versusCard(half, 1.6).ch * 2 + 1.6 + 4;
    reserve(ctx, H + (pair.note ? 9 : 4));
    const top = ctx.y;

    deckPlate(ctx, pair.left, MARGIN, top, half, 'red');
    if (pair.right) {
      deckPlate(ctx, pair.right, MARGIN + half + GUT, top, half, 'blue');
    } else {
      emptyPlate(ctx, MARGIN + half + GUT, top, half, H, 'Nothing on the squad clears the floor against this.');
    }

    // The word, between them. It is the relationship the page is about.
    setFont(doc, 'display');
    doc.setFontSize(13);
    ink(doc, p.muted);
    doc.text('VS', MARGIN + half + GUT / 2, top + H / 2 + 2, { align: 'center' });

    ctx.y = top + H + 2;
    if (pair.note) {
      setFont(doc, 'sans');
      doc.setFontSize(6.4);
      ink(doc, p.muted);
      doc.text(clip(doc, pair.note, CONTENT_W), MARGIN, ctx.y + 3);
      ctx.y += 6;
    }
    ctx.y += 2;
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
    doc.text(docModel.subject ?? 'Deckkies analytics', MARGIN, 41);
  });

  setFont(doc, 'display');
  doc.setFontSize(11);
  ink(doc, p.onSolid);
  alpha(doc, 0.8, () => doc.text('DECKKIES', PAGE_W - MARGIN, 30, { align: 'right' }));

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

/* -------------------------------------------------------------- contents */

/**
 * The contents sheet, drawn on the SECOND pass into a page reserved on the
 * first.
 *
 * A page number cannot be known until the thing it points at has been laid
 * out, and a contents page that guesses is worse than none — the reader trusts
 * it once, is sent to the wrong sheet, and stops trusting the document. So
 * page 2 is left blank while everything else is drawn, `drawDivider` records
 * where each section actually landed, and this fills it in at the end. The same
 * trick the footers already use for the page total.
 */
function drawContents(ctx: Ctx) {
  const { doc, p, docModel } = ctx;
  const accent = hueColor(p, docModel.hue, true);
  paintPage(ctx);

  setFont(doc, 'display');
  doc.setFontSize(20);
  ink(doc, p.text);
  doc.text('Contents', MARGIN, 26);
  fill(doc, accent);
  doc.rect(MARGIN, 30, 26, 1.6, 'F');

  // Two columns, because forty sections down one column runs off the sheet and
  // a contents page that itself needs a second page is a contradiction.
  const entries = ctx.contents;
  const perCol = Math.ceil(entries.length / 2) || 1;
  const colW = (CONTENT_W - 10) / 2;

  entries.forEach((e, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = MARGIN + col * (colW + 10);
    const y = 42 + row * 7.2;
    if (y > BODY_BOTTOM) return;

    const indent = e.depth * 5;
    setFont(doc, 'sans', e.depth === 0);
    doc.setFontSize(e.depth === 0 ? 8 : 7.4);
    ink(doc, e.depth === 0 ? p.text : p.muted);
    const label = clip(doc, e.title, colW - indent - 14);
    doc.text(label, x + indent, y);

    // A leader rule, so the eye can cross to the number without drifting a row.
    const lw = doc.getTextWidth(label);
    stroke(doc, p.border);
    doc.setLineWidth(0.2);
    if (colW - indent - lw - 16 > 4) {
      doc.line(x + indent + lw + 2, y - 1, x + colW - 12, y - 1);
    }

    setFont(doc, 'sans', true);
    doc.setFontSize(8);
    ink(doc, p.muted);
    doc.text(String(e.page), x + colW - 2, y, { align: 'right' });
  });
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

  // Every card in the report, built once and reused by URL alias. Versus
  // plates hold decks too, so both block kinds are swept — missing the second
  // one would silently draw name-only placeholders for half the document.
  const decks = docModel.blocks.flatMap((b) =>
    b.kind === 'decks'
      ? b.decks
      : b.kind === 'versus'
        ? b.pairs.flatMap((pr) => (pr.right ? [pr.left, pr.right] : [pr.left]))
        : [],
  );
  const tiles = new Map<string, string | null>();
  await Promise.all(
    deckUrls(decks).map(async ({ url }) => {
      tiles.set(url, await buildTile(url, p.nested));
    }),
  );

  const ctx: Ctx = { doc, p, docModel, tiles, y: BODY_TOP, page: 1, contents: [], flow: null };

  drawCover(ctx);

  /* Page 2 is RESERVED and left blank for now — see `drawContents`. It has to
     exist before the body so that every page number the body produces is
     final, and it cannot be filled until the body has told us those numbers. */
  const contentsPage = docModel.contents ? 2 : 0;
  if (contentsPage) {
    doc.addPage();
    ctx.page += 1;
    paintPage(ctx);
  }

  /* A BODY PAGE IS OPENED WHEN CONTENT ARRIVES, NOT BEFORE.
     Opening one up front produced a sheet carrying nothing but a header and a
     footer whenever the first block was a divider — which it always is here,
     and which was page 3 of every dossier. The same emptiness appeared after
     any `break` immediately followed by a divider. Deferring it means a page
     exists only once something needs to be on it. */
  let open = false;
  const body = () => {
    if (open) return;
    newPage(ctx);
    open = true;
  };

  for (const block of docModel.blocks as ReportBlock[]) {
    if (block.kind === 'break') {
      // A deliberate break starts a section, never continues one.
      ctx.flow = null;
      open = false;
      continue;
    }
    // A divider owns its whole sheet, so it draws its own page and must not be
    // given a block heading above it.
    if (block.kind === 'divider') {
      drawDivider(ctx, block);
      // Content continues on the divider's own sheet, under its stat strip.
      open = true;
      continue;
    }
    body();
    blockHeading(ctx, block.heading, block.note, firstChunk(block));
    switch (block.kind) {
      case 'stats': drawStats(ctx, block.tiles); break;
      case 'table': drawTable(ctx, block); break;
      case 'bars': drawBars(ctx, block.bars); break;
      case 'decks': drawDecks(ctx, block.decks); break;
      case 'note': drawNote(ctx, block.body); break;
      case 'matrix': drawMatrix(ctx, block); break;
      case 'spread': drawSpread(ctx, block); break;
      case 'versus': drawVersus(ctx, block); break;
    }
  }

  body();
  if (docModel.caveats?.length) {
    // Its own heading, kept with its first entry like every other block.
    ctx.flow = null;
    reserve(ctx, 18);
    setFont(doc, 'sans', true);
    doc.setFontSize(7.5);
    ink(doc, p.muted);
    doc.text('WHAT THIS REPORT DOES NOT SAY', MARGIN, ctx.y + 4, { charSpace: 0.4 });
    ctx.y += 7;
    ctx.flow = 'What this report does not say';
    setFont(doc, 'sans');
    doc.setFontSize(7);
    for (const c of docModel.caveats) {
      const lines = doc.splitTextToSize(`— ${c}`, CONTENT_W) as string[];
      // The WHOLE entry moves, rather than splitting one bullet across a page.
      reserve(ctx, lines.length * 3.6 + 1.5);
      setFont(doc, 'sans');
      doc.setFontSize(7);
      ink(doc, p.muted);
      lines.forEach((ln, i) => doc.text(ln, MARGIN, ctx.y + i * 3.6));
      ctx.y += lines.length * 3.6 + 1.5;
    }
  }

  /* A DOCUMENT THAT STOPS HAS NOT ENDED. Forty pages of sections that each
     open with a title sheet, and then the last one simply runs out mid-column,
     reads as a truncated file rather than a finished report — the reader's
     first question is whether they got all of it. This is the answer. */
  ctx.flow = null;
  reserve(ctx, 20);
  ctx.y += 4;
  stroke(doc, p.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, ctx.y, PAGE_W - MARGIN, ctx.y);
  ctx.y += 6;
  setFont(doc, 'display');
  doc.setFontSize(10);
  ink(doc, hueColor(p, docModel.hue));
  doc.text('END OF REPORT', MARGIN, ctx.y, { charSpace: 0.8 });
  setFont(doc, 'sans');
  doc.setFontSize(7);
  ink(doc, p.muted);
  doc.text(
    `${docModel.screen}${docModel.subject ? ` — ${docModel.subject}` : ''} · generated ${new Date().toLocaleString('en-GB')}`,
    PAGE_W - MARGIN,
    ctx.y,
    { align: 'right' },
  );

  // Footers last: the page total is not known until everything is laid out.
  const total = doc.getNumberOfPages();

  // And the contents with them, for the same reason one page further on — the
  // body has now told us where every section actually landed.
  if (contentsPage) {
    doc.setPage(contentsPage);
    ctx.page = contentsPage;
    drawContents(ctx);
  }

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
