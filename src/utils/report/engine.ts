/**
 * THE PIPELINE: fonts and art -> atoms -> pages -> ink -> audit -> blob.
 *
 *   1. Register the embedded faces (Helvetica if they cannot be fetched).
 *   2. Bake every raster the document will use — card tiles, the page plate
 *      per hue, the hero band or cover, the logo — opaque, once each.
 *   3. Turn every block into atoms that know their height (`blocks.ts`).
 *   4. Pack the atoms onto pages (`pack.ts`), pure and greedy.
 *   5. Draw: page plate, brand bar, footer, then each atom where it landed,
 *      with a "continued" heading wherever a block spilled onto a new sheet.
 *   6. Outline (the viewer's bookmark panel), contents links, audit.
 *
 * Nothing is drawn until everything is measured, so the contents page quotes
 * real page numbers and every footer knows the total.
 */

import type { jsPDF } from 'jspdf';
import { reportFilename, type ReportBlock, type ReportDoc, type StatsBlock } from '../analyticsReport';
import { artUrl, coverPlate, heroPlate, logoTile, glowPlate, cardTile, CROWN, GHOST, type Form, type Glow, type Raster } from './art';
import { auditPage, type Issue } from './audit';
import {
  blockAtoms, drawTile, readAtom, statsAtoms, TILE_H, type Atom, type BlockCtx,
} from './blocks';
import { loadFonts } from './fonts';
import {
  BLOCK_GAP, BODY_BOTTOM, BODY_H, BODY_TOP, CONTENT_W, FOOTER_Y, HEADER_H, MARGIN, PAGE_H, PAGE_W, PT, TYPE,
} from './geometry';
import { pack, type Placement } from './pack';
import { CAP, Surface, type TextStyle } from './surface';
import { HUES, P, hue, mix, type HueName } from './theme';

export interface RenderResult {
  blob: Blob;
  pages: number;
  issues: Issue[];
  /** Milliseconds from call to blob. */
  ms: number;
}

const HERO_H = 46;
export const BRAND = 'DECKKIES';
export const FAN_LINE = 'Unofficial fan content, not affiliated with or endorsed by Supercell.';

/* ------------------------------------------------------------ art sweep */

type Deckish = { cards: string[]; art?: Record<string, Form> };

/**
 * EVERY CARD URL THE DOCUMENT WILL DRAW, swept out of the model first.
 *
 * A block kind missing from this sweep would draw name-only placeholders for
 * its whole section — silently, because a placeholder is a valid-looking
 * tile. That happened twice to the previous renderer, so the sweep is written
 * over every art-bearing kind, and a test fails if a new kind carrying cards
 * is added without appearing here.
 */
export function collectArt(blocks: readonly ReportBlock[]): string[] {
  const seen = new Set<string>();
  const deck = (d: Deckish | null | undefined) => {
    if (!d) return;
    for (const c of d.cards) seen.add(artUrl(c, d.art?.[c]));
  };
  for (const b of blocks) {
    switch (b.kind) {
      case 'decks': b.decks.forEach(deck); break;
      case 'versus': b.pairs.forEach((p) => { deck(p.left); deck(p.right); }); break;
      case 'series': b.rows.forEach((r) => { r.left.forEach(deck); r.right.forEach(deck); }); break;
      case 'battles': b.rows.forEach((r) => { deck(r.left); deck(r.right); }); break;
      case 'pairs': b.pairs.forEach((p) => { seen.add(artUrl(p.a, p.artA)); seen.add(artUrl(p.b, p.artB)); }); break;
      case 'cards': b.cards.forEach((c) => seen.add(artUrl(c.key, c.form))); break;
      default: break;
    }
  }
  return [...seen];
}

/* ------------------------------------------------------------- chrome */

export function stamp(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A bare player tag gets its '#', so every header prints it the same way
 *  whichever adapter produced it. Anything that is not a tag is left alone. */
export function tagged(subject: string | undefined): string | undefined {
  if (!subject) return subject;
  const t = subject.trim();
  return /^#?[0289PYLQGRJCUV]{4,12}$/i.test(t) ? `#${t.replace(/^#/, '').toUpperCase()}` : t;
}

const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export function logoMark(s: Surface, logo: Raster | null, x: number, y: number, size: number): void {
  s.round(x, y, size, size, size * 0.24, P.brandTile, mix(P.brandTile, P.text, 0.18), 0.2);
  if (logo) {
    s.clipTo(x, y, size, size, size * 0.24, () => s.image(logo, x, y, size, size));
  } else {
    s.crown(x + size * 0.2, y + size * 0.3, size * 0.6, P.gold, CROWN);
  }
}

/** The wordmark with its trademark sign. Returns the width drawn. */
export function wordmark(s: Surface, x: number, y: number, size: number): number {
  const w = s.text(BRAND, x, y, { role: 'display', size, track: size * 0.018, color: P.text });
  const tm = Math.max(5.2, size * 0.36);
  s.text('™', x + w + 0.5, y - size * PT * 0.42, { role: 'body', size: tm, color: P.text2 });
  return w + 0.5 + s.width('™', { size: tm });
}

export function brandBar(s: Surface, logo: Raster | null, model: { screen: string; subject?: string }, section: { title: string; hue: HueName }, page: number, total: number): void {
  s.chrome(() => {
    const y = 9.6;
    logoMark(s, logo, MARGIN, 4.4, 7);
    const ww = wordmark(s, MARGIN + 9.4, y + 0.3, 13);
    const sx = MARGIN + 9.4 + ww + 4.5;
    s.line(sx, 5.4, sx, 10.6, P.lineStrong, 0.22);
    const crumbs = [model.screen, model.subject].filter(Boolean).join('  ·  ');
    const tail = section.title && section.title !== model.screen ? `  ›  ${section.title}` : '';
    const label: TextStyle = { role: 'bodyBold', size: 5.8, track: 0.26, caps: true, color: P.text2 };
    s.text(s.clip(crumbs + tail, 170, label), sx + 4.5, y - 0.4, label);
    s.text(`${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, PAGE_W - MARGIN, y - 0.4, {
      role: 'bodyBold', size: 6.4, track: 0.3, color: P.text2, align: 'right',
    });
    const c = hue(section.hue);
    s.gradient(MARGIN, HEADER_H, 70, 0.4, 0, c.ink, P.line, 'h', 12);
    s.rect(MARGIN + 70, HEADER_H, CONTENT_W - 70, 0.4, P.line);
  });
}

export function footer(s: Surface, generated: string, label = 'Intelligence report'): void {
  s.chrome(() => {
    const st: TextStyle = { role: 'bodyBold', size: TYPE.footer.size, track: TYPE.footer.track, caps: true, color: P.text3 };
    s.text(`${BRAND}™  ·  ${label}`, MARGIN, FOOTER_Y, st);
    s.text(`Generated ${generated}  ·  build ${BUILD}`, PAGE_W - MARGIN, FOOTER_Y, { ...st, align: 'right' });
  });
}

/** The page ground: a solid vector fill, the section's glow in the top-right
 *  corner, and the ghost crown as a pre-mixed opaque fill. */
export function ground(s: Surface, glow: Glow | null): void {
  s.chrome(() => {
    s.rect(0, 0, PAGE_W, PAGE_H, P.ground);
    if (glow) s.image(glow, glow.x, glow.y, glow.w, glow.h);
    s.crown(PAGE_W - 62, PAGE_H - 44, 44, GHOST, CROWN);
  });
}

/* ----------------------------------------------------------- front page */

function heroBand(s: Surface, plate: Raster | null, model: ReportDoc): void {
  const x = MARGIN;
  const y = BODY_TOP;
  const w = CONTENT_W;
  const c = hue(model.hue as HueName);
  if (plate) s.clipTo(x, y, w, HERO_H, 3.2, () => s.image(plate, x, y, w, HERO_H));
  else s.gradient(x, y, w, HERO_H, 3.2, mix(P.panel, c.deep, 0.45), P.panel, 'h', 24);
  s.round(x, y, w, HERO_H, 3.2, null, mix(P.line, c.ink, 0.25), 0.25);
  s.box({ x, y, w, h: HERO_H, kind: 'hero' });
  const lx = x + 8;
  const copyW = w * 0.62;
  s.label('Intelligence report', lx, y + 9, { color: c.ink, size: 6 });
  const T = TYPE.heroTitle;
  s.text(s.clip(model.screen, copyW, { role: 'display', size: T.size, track: T.track }), lx, base(y + 12, T.size), {
    role: 'display', size: T.size, track: T.track, color: P.text,
  });
  const sub = [model.subject, model.summary].filter(Boolean).join('  ·  ');
  if (sub) s.text(s.clip(sub, copyW, { role: 'bodyBold', size: 9 }), lx, y + 29.4, { role: 'bodyBold', size: 9, color: P.text2 });
  // The query facts, as a line of label/value pairs.
  let mx = lx;
  const my = y + HERO_H - 7.6;
  for (const m of model.meta) {
    const lab: TextStyle = { role: 'bodyBold', size: 5.2, track: 0.24, caps: true, color: P.text3 };
    const val: TextStyle = { role: 'bodyBold', size: 6.6, color: P.text };
    const need = s.width(m.label, lab) + 2 + s.width(m.value, val) + 7;
    if (mx + need > x + w * 0.7) break;
    const lw = s.text(m.label, mx, my, lab);
    const vw = s.text(m.value, mx + lw + 2, my, val);
    mx += lw + 2 + vw + 7;
  }
}

const base = (top: number, size: number) => top + size * PT * CAP;

interface ContentsEntry { title: string; depth: 0 | 1; page: number }

function coverPage(s: Surface, plate: Raster | null, logo: Raster | null, model: ReportDoc, lead: StatsBlock | null,
  entries: ContentsEntry[], generated: string, contentsPages: number): void {
  s.chrome(() => {
    const h = model.hue as HueName;
    const c = hue(h);
    if (plate) s.image(plate, 0, 0, PAGE_W, PAGE_H);
    else s.rect(0, 0, PAGE_W, PAGE_H, P.ground);
    logoMark(s, logo, MARGIN, 13, 12);
    wordmark(s, MARGIN + 15.5, 23.2, 24);
    s.text(`Generated ${generated}`, PAGE_W - MARGIN, 20.6, {
      role: 'bodyBold', size: 6, track: 0.26, caps: true, color: P.text2, align: 'right',
    });
    const lx = MARGIN;
    const copyW = entries.length ? 158 : 200;
    s.label('Intelligence report', lx, 56, { color: c.ink, size: 7 });
    const T = TYPE.coverTitle;
    const titleLines = s.wrap(model.screen, copyW, { role: 'display', size: T.size, track: T.track }, 2);
    let ty = base(60, T.size);
    for (const ln of titleLines) {
      s.text(ln, lx, ty, { role: 'display', size: T.size, track: T.track, color: P.text });
      ty += T.size * PT * 0.92;
    }
    ty += 1;
    if (model.subject) {
      s.text(s.clip(model.subject, copyW, { role: 'bodyBold', size: 12 }), lx, ty, { role: 'bodyBold', size: 12, color: P.text });
      ty += 6.6;
    }
    if (model.summary) {
      for (const ln of s.wrap(model.summary, copyW, { size: 8 }, 3)) {
        s.text(ln, lx, ty, { size: 8, color: P.text2 });
        ty += 8 * PT * 1.35;
      }
    }
    ty += 5;
    const tiles = (lead?.tiles ?? []).slice(0, 4);
    if (tiles.length) {
      const tw = Math.min(40, (copyW - (tiles.length - 1) * 3) / tiles.length);
      tiles.forEach((t, i) => drawTile(s, lx + i * (tw + 3), ty, tw, t, h));
      ty += TILE_H + 7;
    }
    // The query facts in two columns.
    const facts = model.meta.slice(0, 8);
    const colW = copyW / 2;
    facts.forEach((m, i) => {
      const fx = lx + (i % 2) * colW;
      const fy = ty + Math.floor(i / 2) * 8.4;
      if (fy > PAGE_H - 26) return;
      s.label(m.label, fx, fy, { color: P.text3 });
      s.text(s.clip(m.value, colW - 4, { role: 'bodyBold', size: 7.4 }), fx, fy + 3.8, { role: 'bodyBold', size: 7.4, color: P.text });
    });

    if (entries.length) {
      const px = 190;
      const pw = PAGE_W - MARGIN - px;
      const py = 40;
      // Short enough to clear the king under it; a longer list moves whole
      // to the contents page(s) after the cover.
      const maxRows = COVER_ROWS;
      const shown = entries.slice(0, maxRows);
      const ph = 14 + shown.length * 6.4 + (entries.length > maxRows ? 6 : 0);
      s.round(px, py, pw, ph, 3, mix(P.ground, P.panel, 0.9), P.line, 0.22);
      s.label('Contents', px + 5, py + 8, { color: c.ink });
      shown.forEach((e, i) => {
        const ey = py + 15 + i * 6.4;
        const indent = e.depth ? 4 : 0;
        const st: TextStyle = e.depth ? { size: 6.6, color: P.text2 } : { role: 'bodyBold', size: 7, color: P.text };
        s.text(s.clip(e.title, pw - 22 - indent, st), px + 5 + indent, ey + 2.4, st);
        s.text(String(e.page), px + pw - 5, ey + 2.4, { role: 'bodyBold', size: 7, color: c.ink, align: 'right' });
        s.pageLink(px + 3, ey - 1.6, pw - 6, 6, e.page);
      });
      if (entries.length > maxRows) {
        s.text(`Full contents on page${contentsPages > 1 ? 's' : ''} 2${contentsPages > 1 ? `-${1 + contentsPages}` : ''}`,
          px + 5, py + ph - 3.4, { size: 6, color: P.text3 });
      }
    }
    s.text(`${BRAND}™  ·  ${FAN_LINE}`, MARGIN, PAGE_H - 9, {
      role: 'bodyBold', size: 5.4, track: 0.22, caps: true, color: P.text3,
    });
  });
}

const COVER_ROWS = 8;
const CONTENTS_ROW = 6.2;
const CONTENTS_TOP = BODY_TOP + 12;
const CONTENTS_PER_COL = Math.floor((BODY_BOTTOM - CONTENTS_TOP) / CONTENTS_ROW);

function contentsPage(s: Surface, entries: ContentsEntry[], h: HueName): void {
  const c = hue(h);
  s.gradient(MARGIN, BODY_TOP - 0.3, 1.2, 14 * PT * CAP + 0.6, 0.6, c.ink, c.deep, 'v', 6);
  s.text('Contents', MARGIN + 3.4, base(BODY_TOP, 14), { role: 'display', size: 14, track: 0.28, caps: true, color: P.text });
  const colW = (CONTENT_W - 8) / 2;
  entries.forEach((e, i) => {
    const col = Math.floor(i / CONTENTS_PER_COL);
    const row = i % CONTENTS_PER_COL;
    const x = MARGIN + col * (colW + 8);
    const y = CONTENTS_TOP + row * CONTENTS_ROW;
    s.rect(x, y, colW, CONTENTS_ROW - 0.6, e.depth ? P.panel : P.panelHi);
    const indent = e.depth ? 5 : 2.4;
    const st: TextStyle = e.depth ? { size: 6.6, color: P.text2 } : { role: 'bodyBold', size: 7, color: P.text };
    s.text(s.clip(e.title, colW - 20 - indent, st), x + indent, y + 3.7, st);
    s.text(String(e.page), x + colW - 2.4, y + 3.7, { role: 'bodyBold', size: 7, color: c.ink, align: 'right' });
    s.pageLink(x, y, colW, CONTENTS_ROW - 0.6, e.page);
  });
}

/* ------------------------------------------------------------ the tail */

function caveatAtoms(ctx: BlockCtx, caveats: string[]): Atom[] {
  const { s, w } = ctx;
  const style: TextStyle = { size: 6.2, color: P.text2 };
  const step = 6.2 * PT * 1.35;
  const items = caveats.map((c) => s.wrap(c, w - 14, style));
  const atoms: Atom[] = [];
  const title = 'About these figures';
  atoms.push({
    h: 5.2, gap: BLOCK_GAP + 2, keep: true,
    draw: (sf, x, y) => sf.label(title, x, base(y + 1, 6), { size: 6, color: P.text2 }),
  });
  items.forEach((lines) => {
    const h = (lines.length - 1) * step + 6.2 * PT * CAP + 2.4;
    atoms.push({
      h, gap: 0.8,
      draw: (sf, x, y) => {
        sf.round(x + 1, y + 0.9, 1.3, 1.3, 0.65, P.text3);
        lines.forEach((ln, i) => sf.text(ln, x + 5, base(y + 0.6, 6.2) + i * step, style));
      },
    });
  });
  return atoms;
}

function endAtom(generated: string): Atom {
  return {
    h: 12,
    gap: BLOCK_GAP + 2,
    draw: (s, x, y, w) => {
      const cx = x + w / 2;
      s.line(x, y + 3, cx - 22, y + 3, P.line, 0.25);
      s.line(cx + 22, y + 3, x + w, y + 3, P.line, 0.25);
      s.text('End of report', cx, y + 4.1, { role: 'bodyBold', size: 5.8, track: 0.4, caps: true, color: P.text2, align: 'center' });
      s.text(`${BRAND}™  ·  ${FAN_LINE}  ·  ${generated}`, cx, y + 10, { size: 5.4, color: P.text3, align: 'center' });
    },
  };
}

/* --------------------------------------------------------------- render */

export async function renderReport(input: ReportDoc): Promise<RenderResult> {
  let model = input;
  const t0 = performance.now();
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  const embedded = await loadFonts(doc);
  const docHue = (model.hue ?? 'violet') as HueName;
  const fullCover = (model.cover ?? (model.contents ? 'full' : 'band')) === 'full';
  const generated = stamp(new Date());
  model = { ...model, subject: tagged(model.subject) };

  // A leading, un-headed stats row is the report's headline: it goes on the
  // cover when there is one, and straight under the hero band otherwise.
  let blocks = [...model.blocks];
  let lead: StatsBlock | null = null;
  if (blocks[0]?.kind === 'stats' && !blocks[0].heading) {
    lead = blocks[0];
    blocks = blocks.slice(1);
  }

  // Rasters, all in parallel.
  const urls = collectArt(blocks);
  const hues = new Set<HueName>([docHue]);
  for (const b of blocks) if (b.kind === 'divider' && b.hue) hues.add(b.hue as HueName);
  const [tileList, plateList, front, logo] = await Promise.all([
    Promise.all(urls.map((u) => cardTile(u, P.slot))),
    Promise.all([...hues].map(async (h) => [h, await glowPlate(h)] as const)),
    fullCover ? coverPlate(docHue) : heroPlate(CONTENT_W, HERO_H, docHue),
    logoTile(),
  ]);
  const tiles = new Map<string, Raster | null>(urls.map((u, i) => [u, tileList[i]]));
  const plates = new Map(plateList);

  const s = new Surface(doc, embedded, tiles);
  const ctx: BlockCtx = { s, w: CONTENT_W, hue: docHue };

  // Atoms.
  const raw: Atom[] = [];
  if (!fullCover && lead) raw.push(...statsAtoms(ctx, lead, docHue));
  if (model.read) raw.push(readAtom(ctx, model.read, docHue));
  for (const b of blocks) raw.push(...blockAtoms(ctx, b));
  if (model.caveats?.length) raw.push(...caveatAtoms(ctx, model.caveats));
  raw.push(endAtom(generated));

  // A `break` is a zero-height marker: fold it into the atom after it.
  const atoms: Atom[] = [];
  let pendingBreak = false;
  for (const a of raw) {
    if (a.h === 0 && a.breakBefore) { pendingBreak = true; continue; }
    if (pendingBreak) { a.breakBefore = true; pendingBreak = false; }
    atoms.push(a);
  }
  if (atoms.length) atoms[0].gap = 0;

  const pages = pack(atoms, {
    top: BODY_TOP,
    bottom: BODY_BOTTOM,
    firstTop: fullCover ? BODY_TOP : BODY_TOP + HERO_H + 5,
    contGap: 0,
  });

  // Where every marked atom landed — for the contents and the outline.
  const contentsCount = atoms.filter((a) => a.mark?.contents).length;
  const contentsPages = fullCover && contentsCount > COVER_ROWS ? Math.ceil(contentsCount / (CONTENTS_PER_COL * 2)) : 0;
  const offset = fullCover ? 1 + contentsPages : 0;
  const total = offset + pages.length;
  const marks: { atom: Atom; page: number }[] = [];
  pages.forEach((pg, pi) => pg.forEach((pl) => {
    if (!pl.cont && atoms[pl.item].mark) marks.push({ atom: atoms[pl.item], page: offset + pi + 1 });
  }));
  const entries: ContentsEntry[] = marks
    .filter((m) => m.atom.mark!.contents)
    .map((m) => ({ title: m.atom.mark!.title, depth: m.atom.mark!.depth, page: m.page }));

  const issues: Issue[] = [];
  let pageNo = 0;
  const openPage = () => {
    if (pageNo > 0) doc.addPage();
    pageNo += 1;
    s.boxes = [];
  };
  const closePage = () => { issues.push(...auditPage(pageNo, s.boxes)); };

  if (fullCover) {
    openPage();
    coverPage(s, front, logo, model, lead, entries, generated, contentsPages);
    closePage();
    for (let cp = 0; cp < contentsPages; cp += 1) {
      openPage();
      ground(s, plates.get(docHue) ?? null);
      brandBar(s, logo, model, { title: 'Contents', hue: docHue }, pageNo, total);
      footer(s, generated);
      const per = CONTENTS_PER_COL * 2;
      contentsPage(s, entries.slice(cp * per, (cp + 1) * per), docHue);
      closePage();
    }
  }

  let running = { title: model.screen, hue: docHue };
  pages.forEach((pg: Placement[], pi) => {
    openPage();
    const first = pg.find((pl) => !pl.cont);
    const sec = first ? atoms[first.item].section : undefined;
    if (sec) running = sec;
    ground(s, plates.get(running.hue) ?? plates.get(docHue) ?? null);
    brandBar(s, logo, model, running, pageNo, total);
    footer(s, generated);
    if (pi === 0 && !fullCover) heroBand(s, front, model);
    for (const pl of pg) {
      const a = atoms[pl.item];
      if (pl.cont) a.drawCont?.(s, MARGIN, pl.y, CONTENT_W);
      else a.draw(s, MARGIN, pl.y, CONTENT_W);
    }
    closePage();
  });

  // The viewer's bookmark panel: sections, and the headings inside them.
  let parent: unknown = null;
  const outline = (doc as unknown as { outline?: { add: (p: unknown, t: string, o: { pageNumber: number }) => unknown } }).outline;
  if (outline) {
    for (const m of marks) {
      const title = s.prep(m.atom.mark!.title, { size: 7 });
      if (!title) continue;
      if (m.atom.mark!.depth === 0) parent = outline.add(null, title, { pageNumber: m.page });
      else outline.add(parent, title, { pageNumber: m.page });
    }
  }

  doc.setProperties({
    title: `${BRAND} — ${model.screen}${model.subject ? ` — ${model.subject}` : ''}`,
    subject: `${model.screen} intelligence report`,
    author: BRAND,
    creator: `${BRAND} report engine (build ${BUILD})`,
  });

  if (issues.length && import.meta.env.DEV) {
    console.warn(`[report] audit ${issues.length}: ${issues.slice(0, 12).map((i) => `p${i.page} ${i.rule} ${i.detail}`).join(' | ')}`);
  }
  const blob = doc.output('blob');
  return { blob, pages: total, issues, ms: Math.round(performance.now() - t0) };
}

export async function renderAnalyticsReport(model: ReportDoc): Promise<Blob> {
  return (await renderReport(model)).blob;
}

export async function downloadAnalyticsReport(model: ReportDoc): Promise<RenderResult> {
  const result = await renderReport(model);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(model);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a later tick — revoking synchronously races the download in
  // Firefox and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return result;
}

/** For callers that draw their own documents in the report's look. */
export { Surface };
export type { jsPDF };
export { BODY_H };
export { HUES };
