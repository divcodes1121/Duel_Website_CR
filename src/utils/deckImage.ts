import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../data/cards';
import { elixirCurve } from '../state/deckFill';

/**
 * A deck as a 1200×630 picture — the size link previews and social posts use
 * — for sharing where a link is not enough: Discord, Reddit, a group chat.
 *
 * DYNAMICALLY IMPORTED FROM THE BUTTONS, so none of this is in the main
 * bundle; it arrives on the first press.
 *
 * ONE LOOK IN BOTH THEMES. The picture leaves the site, so it wears the brand
 * rather than the reader's theme: the dark ground, the logo on its own tile,
 * the site's name. The card art is the site's own self-hosted WebP, so the
 * canvas is never tainted and `toBlob` always works.
 *
 * THE FIRST THREE SLOTS WEAR THEIR FORMS, the same seating every deck on the
 * site is drawn in, with the evolution and hero edges the PDF uses. A slot's
 * form is only drawn when the card has that form; otherwise the base art.
 */

export type SlotForm = 'evolution' | 'hero';

export interface ShareDeck {
  /** Eight card keys in seated order. */
  cards: readonly string[];
  /** Forms for the special slots, keyed by card. */
  art?: Record<string, SlotForm | 'champion' | undefined>;
  name: string;
}

const W = 1200;
const H = 630;
const RATIO = 363 / 302;

function artUrl(key: string, form: SlotForm | 'champion' | undefined): string {
  const card = CARDS_BY_KEY.get(key);
  if (form === 'evolution' && card?.canEvolve) return getEvolutionIconUrl(key);
  if (form === 'hero' && card?.canBeHero && !card.isChampion) return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const DISPLAY = '"Bebas Neue", "Arial Narrow", Impact, sans-serif';
const BODY = "Inter, 'Segoe UI', system-ui, sans-serif";

export async function renderDeckImage(deck: ShareDeck): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  try {
    await document.fonts.load(`84px ${DISPLAY}`);
  } catch {
    /* the fallback stack draws instead */
  }
  const cards = deck.cards.slice(0, 8);
  const [logo, ...imgs] = await Promise.all([
    load(`${import.meta.env.BASE_URL}assets/brand/logo-dark.png`),
    ...cards.map((k) => load(artUrl(k, deck.art?.[k]))),
  ]);

  // Ground: the dark brand ground with a violet glow top right.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0a0a0d');
  g.addColorStop(1, '#17111f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.86, 30, 10, W * 0.86, 30, 560);
  glow.addColorStop(0, 'rgba(109,40,217,0.34)');
  glow.addColorStop(1, 'rgba(109,40,217,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand: the logo on the favicon's tile, the wordmark, the address.
  rounded(ctx, 56, 44, 52, 52, 12);
  ctx.fillStyle = '#0c1222';
  ctx.fill();
  if (logo) ctx.drawImage(logo, 62, 50, 40, 40);
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 40px ${DISPLAY}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('DECKKIES', 122, 72);
  ctx.textAlign = 'right';
  ctx.font = `600 22px ${BODY}`;
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('deckkies.com', W - 56, 72);
  ctx.textAlign = 'left';

  // The deck's name.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 84px ${DISPLAY}`;
  ctx.fillText(deck.name.toUpperCase(), 54, 186, W - 108);

  // Eight cards in one row.
  const cw = 128;
  const ch = Math.round(cw * RATIO);
  const gap = 14;
  const x0 = (W - (8 * cw + 7 * gap)) / 2;
  const y0 = 226;
  cards.forEach((key, i) => {
    const x = x0 + i * (cw + gap);
    const form = i < 3 ? deck.art?.[key] : undefined;
    rounded(ctx, x, y0, cw, ch, 14);
    ctx.fillStyle = '#1a1a1f';
    ctx.fill();
    const edge = form === 'evolution' ? '#a78bfa' : form === 'hero' ? '#fbbf24' : null;
    ctx.lineWidth = edge ? 3 : 1.5;
    ctx.strokeStyle = edge ?? '#34343b';
    ctx.stroke();
    const img = imgs[i];
    if (img) {
      const s = Math.min((cw - 8) / img.width, (ch - 8) / img.height);
      const iw = img.width * s;
      const ih = img.height * s;
      ctx.drawImage(img, x + (cw - iw) / 2, y0 + (ch - ih) / 2, iw, ih);
    }
    if (edge) {
      ctx.font = `700 15px ${BODY}`;
      ctx.fillStyle = '#e8e8e8';
      ctx.textAlign = 'center';
      ctx.fillText(form === 'evolution' ? 'EVO' : 'HERO', x + cw / 2, y0 + ch + 28);
      ctx.textAlign = 'left';
    }
  });

  // Figures: average elixir, four-card cycle, and the curve.
  const known = cards.map((k) => CARDS_BY_KEY.get(k)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const avg = known.length ? known.reduce((a, c) => a + c.elixir, 0) / known.length : null;
  const costs = known.map((c) => c.elixir).sort((a, b) => a - b);
  const cycle = costs.length >= 4 ? costs.slice(0, 4).reduce((a, b) => a + b, 0) : null;
  let sx = 56;
  const baseline = 566;
  for (const [value, label] of [
    [avg === null ? '–' : avg.toFixed(1), 'AVG ELIXIR'],
    [cycle === null ? '–' : String(cycle), '4-CARD CYCLE'],
  ] as const) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `400 60px ${DISPLAY}`;
    ctx.fillText(value, sx, baseline);
    const vw = ctx.measureText(value).width;
    ctx.font = `700 16px ${BODY}`;
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText(label, sx + vw + 12, baseline - 8);
    sx += vw + 12 + ctx.measureText(label).width + 48;
  }
  const curve = elixirCurve(known);
  const max = Math.max(3, ...curve);
  const bw = 22;
  const bx = W - 56 - 7 * bw - 6 * 8;
  curve.forEach((n, i) => {
    const hgt = n ? Math.round((n / max) * 56) : 3;
    const x = bx + i * (bw + 8);
    ctx.fillStyle = n ? '#a78bfa' : '#34343b';
    rounded(ctx, x, baseline - 18 - hgt, bw, hgt, Math.min(5, hgt / 2));
    ctx.fill();
    ctx.fillStyle = '#e8e8e8';
    ctx.font = `700 13px ${BODY}`;
    ctx.textAlign = 'center';
    ctx.fillText(i === 6 ? '7+' : String(i + 1), x + bw / 2, baseline + 4);
    ctx.textAlign = 'left';
  });

  return canvas;
}

function fileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  return `${slug}-deckkies.png`;
}

/**
 * The share sheet where the device has one for files (phones), a download
 * everywhere else — and a download too when the browser refuses the sheet,
 * which Safari does once too long has passed since the tap.
 */
export async function shareDeckImage(deck: ShareDeck): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  try {
    const canvas = await renderDeckImage(deck);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return 'failed';
    const file = new File([blob], fileName(deck.name), { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse && nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: deck.name });
        return 'shared';
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
        // NotAllowedError and friends: fall through to the download.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
