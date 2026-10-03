/**
 * THE DRAWING SURFACE — primitives only, no decisions.
 *
 * Everything here takes coordinates it was handed and puts ink there; column
 * counts, card sizes and page breaks are all decided in `blocks.ts` and
 * `pack.ts` before a primitive is called. The split is what lets a block
 * measure itself before it draws.
 *
 * WHAT IT DELIBERATELY NEVER DOES: set a transparency state. Every "gradient"
 * is opaque bands inside a clip, every glow is baked into an image by
 * `art.ts`, every muted colour is a real colour rather than white at 40%. A
 * PDF viewer paints opaque fills in microseconds and composites transparency
 * per pixel, and the old print export was slow for exactly that reason.
 *
 * Every primitive that puts something on the page records its rectangle, so
 * the audit reads what was actually committed rather than the layout's own
 * arithmetic.
 */

import type { jsPDF } from 'jspdf';
import type { Box } from './audit';
import { artUrl, cardName, type Form, type Raster } from './art';
import { faceOf } from './fonts';
import { PT, RADIUS_SM, TYPE, cardH } from './geometry';
import { drawable, faceFor, type ExtraFace, type Face, type FontRole } from './text';
import { HUES, P, hue, mix, type HueName, type RGB } from './theme';

export interface TextStyle {
  role?: FontRole;
  size: number;
  color?: RGB;
  align?: 'left' | 'center' | 'right';
  /** Letterspacing in mm, applied after every glyph. */
  track?: number;
  caps?: boolean;
}

/** The share of the em a capital occupies — for centring type in a box. */
export const CAP = 0.71;

/** A stretch of one string drawn in one face. */
interface Run { face: Face; text: string; scale: number }

/**
 * A FALLBACK FACE BESIDE BEBAS IS DRAWN SMALLER. Bebas is all capitals 0.70 em
 * tall; a kana fills ~0.88 em and an Inter capital 0.73, so at the heading's
 * own size a Japanese name stood a fifth taller than the title around it.
 */
const DISPLAY_SCALE: Partial<Record<Face, number>> = { kana: 0.8, kanji: 0.8, bodyBold: 0.94 };

export class Surface {
  readonly doc: jsPDF;

  readonly embedded: boolean;

  /** The fallback faces (Japanese) registered on this document. */
  readonly extra: ReadonlySet<ExtraFace>;

  /** Card art by URL, already flattened onto the slot colour. */
  readonly tiles: Map<string, Raster | null>;

  boxes: Box[] = [];

  /** Brand bar, footer and cover draw as 'chrome', exempt from the audit's
   *  body-bleed rule; everything else is 'body'. */
  zone: 'body' | 'chrome' = 'body';

  constructor(doc: jsPDF, embedded: boolean, tiles: Map<string, Raster | null>,
    extra: ReadonlySet<ExtraFace> = new Set()) {
    this.doc = doc;
    this.embedded = embedded;
    this.extra = extra;
    this.tiles = tiles;
  }

  box(b: Box): void {
    this.boxes.push({ ...b, zone: b.zone ?? this.zone });
  }

  /** Draw `fn` as chrome. */
  chrome(fn: () => void): void {
    const prev = this.zone;
    this.zone = 'chrome';
    try { fn(); } finally { this.zone = prev; }
  }

  /* ----------------------------------------------------------------- type */

  private face(s: TextStyle, face?: Face, scale = 1): void {
    const [family, style] = faceOf(face ?? s.role ?? 'body', this.embedded);
    this.doc.setFont(family, style);
    this.doc.setFontSize(s.size * scale);
  }

  /** The string exactly as it will be drawn: cased, then filtered to the
   *  glyphs the fonts on this document hold. */
  prep(text: string | null | undefined, s: TextStyle): string {
    const t = s.caps ? String(text ?? '').toUpperCase() : String(text ?? '');
    return drawable(t, s.role ?? 'body', this.embedded, this.extra);
  }

  /**
   * A prepared string as runs of one face each. Almost every string is ONE
   * run in the role's own face and takes the path it always took; a name in
   * kana, or a Cyrillic word in a Bebas heading, is cut where the face
   * changes. A space always belongs to the role's own face: the Japanese
   * files hold no Latin, a space included.
   */
  private runs(t: string, s: TextStyle): Run[] {
    const role = s.role ?? 'body';
    if (!this.embedded) return [{ face: role, text: t, scale: 1 }];
    const out: Run[] = [];
    for (const ch of t) {
      const own = faceFor(ch.codePointAt(0) as number, role, this.extra) ?? role;
      const last = out[out.length - 1];
      if (last && last.face === own) last.text += ch;
      else out.push({ face: own, text: ch, scale: role === 'display' && own !== role ? DISPLAY_SCALE[own] ?? 1 : 1 });
    }
    // Bebas draws lower case as capitals; a face standing in for it must too.
    if (role === 'display') for (const r of out) if (r.face !== role) r.text = r.text.toUpperCase();
    return out;
  }

  /** Advance of each run — glyphs plus the tracking after every glyph. */
  private advances(runs: Run[], s: TextStyle): number[] {
    const track = s.track ?? 0;
    return runs.map((r) => {
      this.face(s, r.face, r.scale);
      return this.doc.getTextWidth(r.text) + track * r.text.length;
    });
  }

  /** Visual width: glyph advances plus tracking between glyphs (the trailing
   *  track after the last glyph is not ink and is not counted). */
  width(text: string, s: TextStyle): number {
    const t = this.prep(text, s);
    if (!t) return 0;
    const adv = this.advances(this.runs(t, s), s);
    return adv.reduce((a, b) => a + b, 0) - (s.track ?? 0);
  }

  /** Draw at baseline `y`. Alignment is computed here, from `width`, because
   *  jsPDF's own alignment ignores letterspacing. */
  text(text: string, x: number, y: number, s: TextStyle): number {
    const t = this.prep(text, s);
    if (!t) return 0;
    const runs = this.runs(t, s);
    const adv = this.advances(runs, s);
    const w = adv.reduce((a, b) => a + b, 0) - (s.track ?? 0);
    let left = x;
    if (s.align === 'right') left = x - w;
    else if (s.align === 'center') left = x - w / 2;
    const c = s.color ?? P.text;
    this.doc.setTextColor(c[0], c[1], c[2]);
    let at = left;
    runs.forEach((r, i) => {
      this.face(s, r.face, r.scale);
      this.doc.text(r.text, at, y, s.track ? { charSpace: s.track } : undefined);
      at += adv[i];
    });
    this.box({ x: left, y: y - s.size * PT * CAP, w, h: s.size * PT, kind: 'text', font: s.size });
    return w;
  }

  /** Truncate with an ellipsis to fit `w`, measuring what will be drawn. */
  clip(text: string, w: number, s: TextStyle): string {
    const t = this.prep(text, s);
    if (this.width(t, { ...s, caps: false }) <= w) return t;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.width(`${t.slice(0, mid).trimEnd()}…`, { ...s, caps: false }) <= w) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? `${t.slice(0, lo).trimEnd()}…` : '';
  }

  /** Word-wrap to `w`; with `maxLines`, the last line is clipped with an
   *  ellipsis rather than silently dropping the rest. */
  wrap(text: string, w: number, s: TextStyle, maxLines = Infinity): string[] {
    const t = this.prep(text, s);
    if (!t) return [];
    let lines: string[];
    if (this.runs(t, s).length > 1) {
      // jsPDF measures a line in ONE face; a line holding two is broken here.
      lines = this.wrapMixed(t, w, { ...s, caps: false });
    } else {
      this.face(s);
      const track = s.track ?? 0;
      const avg = s.size * PT * 0.5;
      const budget = track > 0 ? Math.max(4, w * (avg / (avg + track))) : w;
      lines = this.doc.splitTextToSize(t, budget) as string[];
    }
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    const rest = lines.slice(maxLines - 1).join(' ');
    kept[maxLines - 1] = this.clip(rest, w, { ...s, caps: false });
    return kept;
  }

  /** Greedy word wrap measured run by run. A word wider than the line (a
   *  sentence in a script with no spaces) is broken between characters. */
  private wrapMixed(t: string, w: number, s: TextStyle): string[] {
    const lines: string[] = [];
    let line = '';
    const push = (word: string) => {
      const next = line ? `${line} ${word}` : word;
      if (this.width(next, s) <= w) { line = next; return; }
      if (line) { lines.push(line); line = ''; }
      if (this.width(word, s) <= w) { line = word; return; }
      let part = '';
      for (const ch of word) {
        if (part && this.width(part + ch, s) > w) { lines.push(part); part = ch; } else part += ch;
      }
      line = part;
    };
    for (const para of t.split('\n')) {
      for (const word of para.split(' ')) if (word) push(word);
      lines.push(line);
      line = '';
    }
    return lines;
  }

  /** Height of `n` lines at `size` with the given leading. */
  static lines(n: number, size: number, leading = 1.28): number {
    return n <= 0 ? 0 : size * PT * (1 + (n - 1) * leading);
  }

  /* --------------------------------------------------------------- shapes */

  fill(c: RGB): void { this.doc.setFillColor(c[0], c[1], c[2]); }

  stroke(c: RGB, w = 0.25): void {
    this.doc.setDrawColor(c[0], c[1], c[2]);
    this.doc.setLineWidth(w);
  }

  rect(x: number, y: number, w: number, h: number, fill: RGB): void {
    this.fill(fill);
    this.doc.rect(x, y, w, h, 'F');
  }

  /** A rounded rectangle; `stroke` draws a hairline border. */
  round(x: number, y: number, w: number, h: number, r: number, fill: RGB | null, stroke?: RGB, lw = 0.25): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (fill) this.fill(fill);
    if (stroke) this.stroke(stroke, lw);
    const style = fill && stroke ? 'FD' : fill ? 'F' : 'S';
    this.doc.roundedRect(x, y, w, h, rr, rr, style);
  }

  line(x1: number, y1: number, x2: number, y2: number, c: RGB, w = 0.25): void {
    this.stroke(c, w);
    this.doc.line(x1, y1, x2, y2);
  }

  /** Clip what `draw` paints to a (rounded) rectangle. */
  clipTo(x: number, y: number, w: number, h: number, r: number, draw: () => void): void {
    const { doc } = this;
    doc.saveGraphicsState();
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (rr > 0) doc.roundedRect(x, y, w, h, rr, rr, null as unknown as string);
    else doc.rect(x, y, w, h, null as unknown as string);
    doc.clip();
    doc.discardPath();
    draw();
    doc.restoreGraphicsState();
  }

  /**
   * An opaque gradient: `steps` solid bands inside a clip. Each band overlaps
   * the next by a hair so anti-aliasing cannot open a seam between them.
   */
  gradient(x: number, y: number, w: number, h: number, r: number, from: RGB, to: RGB,
    dir: 'h' | 'v' = 'h', stepsIn = 0): void {
    // Enough bands that none is wider than 0.8 mm, never more than one per
    // colour level, capped at 72. The first cut used eight across a 180 mm
    // bar, and then 2.5 mm bands on a 20 mm bar — both plainly striped.
    const len = dir === 'h' ? w : h;
    const levels = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), Math.abs(to[2] - from[2]));
    const steps = stepsIn > 0 ? stepsIn : Math.max(4, Math.min(72, Math.ceil(len / 0.8), levels + 1));
    this.clipTo(x, y, w, h, r, () => {
      for (let i = 0; i < steps; i += 1) {
        this.fill(mix(from, to, (i + 0.5) / steps));
        if (dir === 'h') {
          const bw = w / steps;
          this.doc.rect(x + i * bw, y, bw + 0.12, h, 'F');
        } else {
          const bh = h / steps;
          this.doc.rect(x, y + i * bh, w, bh + 0.12, 'F');
        }
      }
    });
  }

  image(r: Raster, x: number, y: number, w: number, h: number): void {
    this.doc.addImage(r.data, 'JPEG', x, y, w, h, r.alias, 'FAST');
  }

  link(x: number, y: number, w: number, h: number, url: string): void {
    this.doc.link(x, y, w, h, { url });
  }

  pageLink(x: number, y: number, w: number, h: number, pageNumber: number): void {
    this.doc.link(x, y, w, h, { pageNumber });
  }

  /* --------------------------------------------------------- components */

  /** A panel: the container every block sits in. */
  panel(x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; r?: number; kind?: string } = {}): void {
    this.round(x, y, w, h, opts.r ?? 2.6, opts.fill ?? P.panel, opts.stroke ?? P.line, 0.22);
    this.box({ x, y, w, h, kind: opts.kind ?? 'panel' });
  }

  /** The hue's short gradient tick that marks a heading as belonging to its
   *  section. */
  tick(x: number, y: number, w: number, h: number, name: HueName): void {
    const c = hue(name);
    this.gradient(x, y, w, h, h / 2, c.ink, c.deep, 'h', 8);
  }

  buttonWidth(label: string, h: number): number {
    const size = Math.max(5.2, h * 1.1);
    return this.width(label, { role: 'bodyBold', size, track: 0.22, caps: true }) + h * 2.9;
  }

  /**
   * A BUTTON — the gradient pill every deck carries, and the one piece of the
   * report a reader can press. Deep hue at the bottom rising to a lifted top,
   * a lit hairline along the top edge for the shade, white semibold caps, and
   * a play glyph. `url` makes the whole pill a link.
   */
  button(x: number, y: number, h: number, label: string, opts: { hue: HueName; url?: string | null; ghost?: boolean }): number {
    const w = this.buttonWidth(label, h);
    const c = hue(opts.hue);
    const r = h / 2;
    if (opts.ghost) {
      this.round(x, y, w, h, r, P.slot, c.ink, 0.25);
    } else {
      const top = mix(c.deep, c.ink, 0.42);
      this.gradient(x, y, w, h, r, top, c.deep, 'v', 10);
      // The lit edge: a thin band a shade lighter, just inside the top.
      this.clipTo(x, y, w, h, r, () => {
        this.rect(x, y, w, h * 0.16, mix(top, P.text, 0.18));
      });
      this.round(x, y, w, h, r, null, mix(c.deep, c.ink, 0.7), 0.18);
    }
    // Play glyph: a small right-pointing triangle.
    const gx = x + h * 0.95;
    const gy = y + h / 2;
    const gs = h * 0.24;
    this.fill(P.text);
    this.doc.triangle(gx - gs * 0.55, gy - gs, gx - gs * 0.55, gy + gs, gx + gs * 0.85, gy, 'F');
    const size = Math.max(5.2, h * 1.1);
    this.text(label, x + h * 1.75, y + h / 2 + size * PT * CAP / 2, {
      role: 'bodyBold', size, track: 0.22, caps: true, color: P.text,
    });
    if (opts.url) this.link(x, y, w, h, opts.url);
    this.box({ x, y, w, h, kind: 'button', font: size });
    return w;
  }

  /**
   * A CARD IN ITS SLOT. The slot is a rounded tile a shade above the panel;
   * the art sits inside it at its true ratio. An evolution's slot takes a
   * violet edge and a hero's an amber one — the same two gems the in-game
   * frame lights — so the special forms read at a glance even when small.
   */
  card(x: number, y: number, w: number, key: string, form?: Form): void {
    const h = cardH(w);
    const pad = Math.max(0.35, w * 0.035);
    const edge = form === 'evolution' ? HUES.violet.ink : form === 'hero' ? HUES.amber.ink : P.line;
    this.round(x, y, w, h, RADIUS_SM, P.slot, edge, form ? 0.32 : 0.18);
    const url = artUrl(key, form);
    const t = this.tiles.get(url);
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    if (t) {
      this.image(t, x + pad, y + pad, iw, ih);
    } else {
      const s: TextStyle = { size: Math.max(4.4, Math.min(6, w * 0.5)), color: P.text3, align: 'center' };
      const lines = this.wrap(cardName(key), iw, s, 3);
      const lh = s.size * PT * 1.2;
      const top = y + h / 2 - ((lines.length - 1) * lh) / 2 + s.size * PT * CAP / 2;
      lines.forEach((ln, i) => this.text(ln, x + w / 2, top + i * lh, s));
    }
    this.box({ x, y, w, h, kind: 'card', cardW: w });
  }

  /** A deck: `cols` cards a line (8 for a strip, 4 for a 4x2 grid). */
  deck(x: number, y: number, w: number, gap: number, cards: string[], art: Record<string, Form> | undefined, cols = 8): number {
    const rows = Math.ceil(Math.max(cards.length, 1) / cols);
    const h = cardH(w);
    cards.forEach((c, i) => {
      const cx = x + (i % cols) * (w + gap);
      const cy = y + Math.floor(i / cols) * (h + gap);
      this.card(cx, cy, w, c, art?.[c]);
    });
    return rows * h + (rows - 1) * gap;
  }

  /** A meter: a rounded track with a proportional fill. */
  meter(x: number, y: number, w: number, h: number, fraction: number, color: RGB): void {
    this.round(x, y, w, h, h / 2, mix(P.slot, P.line, 0.5));
    const f = Math.max(0, Math.min(1, fraction));
    if (f > 0) this.round(x, y, Math.max(h, w * f), h, h / 2, color);
  }

  /** A small status chip. Returns its width. */
  chip(x: number, y: number, text: string, color: RGB, h = 4.4): number {
    const s: TextStyle = { role: 'bodyBold', size: Math.max(5.2, h * 1.12), track: 0.2, caps: true, color };
    const w = this.width(text, s) + h * 1.5;
    this.round(x, y, w, h, h / 2, mix(P.panel, color, 0.16), mix(P.panel, color, 0.45), 0.2);
    this.text(text, x + h * 0.75, y + h / 2 + s.size * PT * CAP / 2, s);
    return w;
  }

  /** The small upper-case label that names a figure. */
  label(text: string, x: number, y: number, opts: { color?: RGB; align?: 'left' | 'center' | 'right'; size?: number } = {}): number {
    return this.text(text, x, y, {
      role: 'bodyBold', size: opts.size ?? TYPE.label.size, track: TYPE.label.track,
      caps: true, color: opts.color ?? P.text2, align: opts.align,
    });
  }

  /** The crown mark as a filled vector polygon in a `w`-wide box. */
  crown(x: number, y: number, w: number, color: RGB, crown: readonly (readonly [number, number])[]): void {
    const h = w * 0.62;
    const abs = crown.map(([fx, fy]) => [x + fx * w, y + fy * h] as [number, number]);
    const deltas = abs.slice(1).map(([ax, ay], i) => [ax - abs[i][0], ay - abs[i][1]]);
    this.fill(color);
    this.doc.lines(deltas, abs[0][0], abs[0][1], [1, 1], 'F', true);
  }
}
