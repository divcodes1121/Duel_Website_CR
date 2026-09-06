/**
 * CARD ART, DOWNSCALED ONCE AND REUSED.
 *
 * Ported unchanged from the renderer this engine replaces, because every line
 * of it is a measurement rather than a preference and re-deriving them would
 * be re-making the same three mistakes:
 *
 *   * JPEG, NOT PNG. The art is photographic and PNG keeps a ten-deck report
 *     near 40 MB. JPEG has no alpha, which is why the canvas is flooded with
 *     the tile colour first — otherwise every transparent corner comes out
 *     black.
 *   * `contain`, NOT `cover`. The PNGs are not all one shape (evolution art
 *     has its own aspect), so sizing by width alone makes a row's height
 *     depend on whether it happens to hold an evolution.
 *   * 150 px. Sharp at print size, and the difference between a report under a
 *     megabyte and one nobody can email.
 *
 * The cache is keyed on URL AND ground colour, because the same card drawn on
 * a light theme's surface is a different tile.
 */

import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../data/cards';
import type { DeckLine } from '../analyticsReport';
import { CARD_RATIO } from './geometry';
import type { RGB } from './palette';

const TILE_PX = 150;

const tileCache = new Map<string, string | null>();

export function artUrl(card: string, variant?: 'evolution' | 'hero'): string {
  if (variant === 'evolution') return getEvolutionIconUrl(card);
  if (variant === 'hero') return getHeroIconUrl(card);
  return getCardIconUrl(card);
}

/** The card's real name, for the placeholder drawn when art is missing. */
export function cardName(key: string): string {
  return CARDS_BY_KEY.get(key)?.name ?? key;
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

export async function buildTile(url: string, bg: RGB): Promise<string | null> {
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
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const data = canvas.toDataURL('image/jpeg', 0.82);
  tileCache.set(key, data);
  return data;
}

function pushDeck(out: { url: string; card: string }[], seen: Set<string>, d: DeckLine): void {
  for (const c of d.cards) {
    const url = artUrl(c, d.art?.[c]);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, card: c });
  }
}

/**
 * EVERY URL THE DOCUMENT WILL DRAW, swept out of the model before rendering
 * starts.
 *
 * A BLOCK KIND LEFT OUT OF THIS SWEEP DRAWS NAME-ONLY PLACEHOLDERS FOR ITS
 * WHOLE SECTION, silently, because a placeholder is a valid-looking tile. That
 * has happened here twice — once for `versus` and once for `pairs` — so the
 * sweep is exhaustive over the model rather than over the kinds someone
 * remembered, and a new art-bearing block kind that forgets to appear here is
 * the one failure this file can still have.
 */
export function collectArt(blocks: readonly { kind: string }[]): { url: string; card: string }[] {
  const seen = new Set<string>();
  const out: { url: string; card: string }[] = [];
  for (const b of blocks as readonly Record<string, unknown>[]) {
    switch (b.kind) {
      case 'decks':
        for (const d of b.decks as DeckLine[]) pushDeck(out, seen, d);
        break;
      case 'versus':
        for (const pr of b.pairs as { left: DeckLine; right: DeckLine | null }[]) {
          pushDeck(out, seen, pr.left);
          if (pr.right) pushDeck(out, seen, pr.right);
        }
        break;
      case 'series':
        for (const rw of b.rows as { left: DeckLine[]; right: DeckLine[] }[]) {
          for (const d of [...rw.left, ...rw.right]) pushDeck(out, seen, d);
        }
        break;
      case 'pairs':
        for (const pr of b.pairs as {
          a: string; b: string;
          artA?: 'evolution' | 'hero'; artB?: 'evolution' | 'hero';
        }[]) {
          for (const [card, variant] of [[pr.a, pr.artA], [pr.b, pr.artB]] as const) {
            const url = artUrl(card, variant);
            if (seen.has(url)) continue;
            seen.add(url);
            out.push({ url, card });
          }
        }
        break;
      default:
        break;
    }
  }
  return out;
}
