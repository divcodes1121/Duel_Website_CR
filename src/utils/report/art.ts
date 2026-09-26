/**
 * EVERY RASTER IN A REPORT, BAKED OPAQUE ON A CANVAS.
 *
 * THIS FILE IS WHY THE NEW REPORTS OPEN FAST. The export that preceded this
 * engine printed the live page, and Chrome can only print `backdrop-filter`
 * glass by rasterising it into soft-masked bitmaps: measured on production,
 * 60-263 transparency states and up to 8 megapixels of image per document,
 * 380-480 ms for a viewer to paint ONE page. PDF viewers composite a soft mask
 * per pixel on the CPU; that is the lag.
 *
 * So nothing here carries alpha. Card art is flattened onto the exact colour
 * of the slot it sits in; the page background, the hero band and the cover
 * are painted — gradient, glow, artwork, scrim, even the ghost crown — into a
 * single JPEG each, reused by alias on every page that wants it. The PDF ends
 * up holding a handful of opaque images and vector shapes, which every viewer
 * paints in milliseconds.
 *
 *   * JPEG, NOT PNG: a canvas PNG is always RGBA, and jsPDF turns an alpha
 *     channel into exactly the soft mask this file exists to avoid.
 *   * `contain`, NOT `cover`, for card art: evolution art has its own taller
 *     aspect, and stretching it would make an evolution a different shape
 *     from the card beside it.
 *   * 120 px card tiles: ~300 dpi at the largest size a report draws a card
 *     (10.6 mm). 150 was measured and cost a third more decode per page for
 *     nothing a printer can resolve.
 */

import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../data/cards';
import { CARD_RATIO, PAGE_H, PAGE_W } from './geometry';
import { P, css, hue, type HueName, type RGB } from './theme';

const TILE_PX = 120;

export type Form = 'evolution' | 'hero';

export interface Raster {
  data: string;
  /** jsPDF image alias: one embedded object however many times it is drawn. */
  alias: string;
}

export function artUrl(card: string, form?: Form): string {
  if (form === 'evolution') return getEvolutionIconUrl(card);
  if (form === 'hero') return getHeroIconUrl(card);
  return getCardIconUrl(card);
}

export function cardName(key: string): string {
  return CARDS_BY_KEY.get(key)?.name ?? key.replace(/-/g, ' ');
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const ctx = c.getContext('2d');
  return ctx ? [c, ctx] : null;
}

/* ------------------------------------------------------------ card tiles */

const tiles = new Map<string, Raster | null>();

/** A card's art flattened onto `ground`, at the art frame's true ratio. */
export async function cardTile(url: string, ground: RGB): Promise<Raster | null> {
  const key = `${url}|${ground.join(',')}`;
  if (tiles.has(key)) return tiles.get(key) ?? null;
  const img = await loadImage(url);
  const cv = img ? canvas(TILE_PX, TILE_PX / CARD_RATIO) : null;
  if (!img || !cv) {
    tiles.set(key, null);
    return null;
  }
  const [c, ctx] = cv;
  ctx.fillStyle = css(ground);
  ctx.fillRect(0, 0, c.width, c.height);
  const scale = Math.min(c.width / img.width, c.height / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  const r: Raster = { data: c.toDataURL('image/jpeg', 0.86), alias: `card:${key}` };
  tiles.set(key, r);
  return r;
}

/* --------------------------------------------------------- the ghost crown */

/** The crown outline as one polygon, in a unit box — shared by the canvas
 *  watermark and the vector mark in the header. Peaks at 0.05/0.5/0.95,
 *  valleys at 0.27/0.73: a single closed path, because three overlapping
 *  triangles union into a mountain range with no dips. */
export const CROWN: readonly (readonly [number, number])[] = [
  [0, 1], [0.05, 0.3], [0.27, 0.62], [0.5, 0.06], [0.73, 0.62], [0.95, 0.3], [1, 1],
];

/* ------------------------------------------------------ page background */

/**
 * A GLOW, NOT A PAGE. The first version of this engine baked the whole page
 * ground into one full-bleed image: correct, opaque, and ~1 megapixel a viewer
 * had to resample on every sheet. Measured at 56-68 ms a page against 22 for
 * plain vectors. The ground is a solid vector fill now; only the section's
 * hue glow is an image, and only the corner it lives in.
 *
 * The glow fades to EXACTLY the ground colour before it reaches the image's
 * edges (radius smaller than the distance to every edge), so the rectangle is
 * invisible against the vector ground around it.
 */
export interface Glow extends Raster {
  x: number;
  y: number;
  w: number;
  h: number;
}

const plates = new Map<string, Promise<Glow | null>>();

export const GLOW_W = 150;
export const GLOW_H = 96;

export function glowPlate(h: HueName): Promise<Glow | null> {
  const key = `glow:${h}`;
  let p = plates.get(key);
  if (!p) {
    p = Promise.resolve().then(() => {
      const PX = 3;
      const cv = canvas(GLOW_W * PX, GLOW_H * PX);
      if (!cv) return null;
      const [c, ctx] = cv;
      ctx.fillStyle = css(P.ground);
      ctx.fillRect(0, 0, c.width, c.height);
      const deep = hue(h).deep;
      const cx = (GLOW_W - 4) * PX;
      const cy = 0;
      const r = (GLOW_H - 6) * PX;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0.24)`);
      rg.addColorStop(0.55, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0.08)`);
      rg.addColorStop(1, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, c.width, c.height);
      return {
        data: c.toDataURL('image/jpeg', 0.9), alias: key,
        x: PAGE_W - GLOW_W, y: 0, w: GLOW_W, h: GLOW_H,
      };
    });
    plates.set(key, p);
  }
  return p;
}

/** The ghost crown's colour: 2.5% white over the ground, pre-mixed so it is
 *  an opaque fill rather than a transparency state. */
export const GHOST: RGB = [
  Math.round(P.ground[0] + (255 - P.ground[0]) * 0.025),
  Math.round(P.ground[1] + (255 - P.ground[1]) * 0.025),
  Math.round(P.ground[2] + (255 - P.ground[2]) * 0.025),
];

/* ------------------------------------------------- hero band and cover */

const ASSET = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;

/**
 * The castle backdrop and the king from the landing screen, with the scrim
 * and the section's glow painted in, at `wMm` x `hMm`.
 *
 * `strength` is how much of the painting survives the scrim on the copy side:
 * the hero band keeps more (its copy is short), the cover less (it carries a
 * contents list).
 */
async function scene(key: string, wMm: number, hMm: number, px: number, h: HueName, opts: {
  scrimLeft: number; scrimRight: number; king: number;
}): Promise<Raster | null> {
  const [back, king] = await Promise.all([
    loadImage(ASSET('background/dark_background.webp')),
    loadImage(ASSET('background/king.webp')),
  ]);
  const cv = canvas(wMm * px, hMm * px);
  if (!cv) return null;
  const [c, ctx] = cv;
  const W = c.width;
  const H = c.height;
  ctx.fillStyle = css(P.ground);
  ctx.fillRect(0, 0, W, H);

  if (back) {
    // Cover-fit, framed on the castles (they sit in the upper-middle band).
    const s = Math.max(W / back.width, H / back.height);
    const dw = back.width * s;
    const dh = back.height * s;
    ctx.drawImage(back, (W - dw) / 2, (H - dh) * 0.42, dw, dh);
  }

  const g = ctx.createLinearGradient(0, 0, W, 0);
  const [r0, g0, b0] = P.ground;
  g.addColorStop(0, `rgba(${r0}, ${g0}, ${b0}, ${opts.scrimLeft})`);
  g.addColorStop(0.55, `rgba(${r0}, ${g0}, ${b0}, ${(opts.scrimLeft + opts.scrimRight) / 2})`);
  g.addColorStop(1, `rgba(${r0}, ${g0}, ${b0}, ${opts.scrimRight})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const v = ctx.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, `rgba(${r0}, ${g0}, ${b0}, 0.15)`);
  v.addColorStop(0.7, `rgba(${r0}, ${g0}, ${b0}, 0)`);
  v.addColorStop(1, `rgba(${r0}, ${g0}, ${b0}, 0.55)`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  const deep = hue(h).deep;
  const rg = ctx.createRadialGradient(W * 0.08, H * 0.1, 0, W * 0.08, H * 0.1, W * 0.55);
  rg.addColorStop(0, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0.32)`);
  rg.addColorStop(1, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0)`);
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  if (king && opts.king > 0) {
    const kh = H * opts.king;
    const kw = kh * (king.width / king.height);
    ctx.drawImage(king, W - kw - W * 0.02, H - kh, kw, kh);
  }

  return { data: c.toDataURL('image/jpeg', 0.84), alias: key };
}

const scenes = new Map<string, Promise<Raster | null>>();

export function heroPlate(wMm: number, hMm: number, h: HueName): Promise<Raster | null> {
  const key = `hero:${h}:${wMm}x${hMm}`;
  let p = scenes.get(key);
  if (!p) {
    p = scene(key, wMm, hMm, 4, h, { scrimLeft: 0.93, scrimRight: 0.35, king: 1.18 });
    scenes.set(key, p);
  }
  return p;
}

export function coverPlate(h: HueName): Promise<Raster | null> {
  const key = `cover:${h}`;
  let p = scenes.get(key);
  if (!p) {
    p = scene(key, PAGE_W, PAGE_H, 4.2, h, { scrimLeft: 0.92, scrimRight: 0.42, king: 0.5 });
    scenes.set(key, p);
  }
  return p;
}

/* -------------------------------------------------------------- the logo */

let logo: Promise<Raster | null> | null = null;

/** The D-and-crown mark flattened onto the favicon tile colour. */
export function logoTile(): Promise<Raster | null> {
  if (!logo) {
    logo = loadImage(ASSET('brand/logo-dark.png')).then((img) => {
      const cv = img ? canvas(160, 160) : null;
      if (!img || !cv) return null;
      const [c, ctx] = cv;
      ctx.fillStyle = css(P.brandTile);
      ctx.fillRect(0, 0, c.width, c.height);
      const pad = 18;
      ctx.drawImage(img, pad, pad, c.width - pad * 2, c.height - pad * 2);
      return { data: c.toDataURL('image/jpeg', 0.92), alias: 'brand:logo' };
    });
  }
  return logo;
}
