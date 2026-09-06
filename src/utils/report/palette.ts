/**
 * THE REPORT'S COLOUR, READ OFF THE LIVE PAGE.
 *
 * Every value here is resolved from the CSS custom properties on `<html>` at
 * export time, so a report is drawn in the colours the reader was just looking
 * at, in whichever theme they have on, with no per-theme branch anywhere in
 * the renderer. `index.css` stays the single source of truth for colour, which
 * is the rule the whole project follows — no component defines a colour of its
 * own, and neither does the PDF.
 *
 * MOVED HERE FROM `analyticsPdf.ts` RATHER THAN COPIED. Two renderers now draw
 * these documents and a second copy of the token list is exactly the drift
 * this project keeps recording under other names (two date windows, four
 * copies of the evolution-mark test). The old renderer imports it from here.
 */

import type { ReportHue } from '../analyticsReport';

export type RGB = readonly [number, number, number];

/** Every token the renderers need, by its CSS name. */
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
 * Everything goes through a real element rather than being regex'd, because
 * the tokens are not all one syntax: some are `#rrggbb`, the theme blocks emit
 * `rgb(r, g, b)`, and anything built with `color-mix` serialises as
 * `color(srgb r g b / a)` in Chrome — a form a naive `rgba(...)` regex reports
 * as "no colour", which this project has already been caught by. Painting the
 * value and reading it back makes the browser do the parsing.
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
  const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return [clamp255(r), clamp255(g), clamp255(b)];
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

export function hueColor(p: Palette, hue: ReportHue | undefined, solid = false): RGB {
  switch (hue) {
    case 'violet': return solid ? p.solidViolet : p.violet;
    case 'pink': return solid ? p.solidPink : p.pink;
    case 'blue': return solid ? p.solidBlue : p.blue;
    case 'green': return solid ? p.solidGreen : p.green;
    case 'red': return solid ? p.solidRed : p.red;
    default: return solid ? p.borderStrong : p.muted;
  }
}

/** A tint of `c` over `ground` — mixed against the surface it will actually
 *  sit on rather than faded to white, which is what keeps a tint honest in
 *  both themes. */
export function mix(c: RGB, ground: RGB, amount: number): RGB {
  return [
    Math.round(ground[0] + (c[0] - ground[0]) * amount),
    Math.round(ground[1] + (c[1] - ground[1]) * amount),
    Math.round(ground[2] + (c[2] - ground[2]) * amount),
  ];
}

/* ------------------------------------------------------------- semantics */

/**
 * WHAT A RATE MEANS, AS A COLOUR — and the one place that judgement is made.
 *
 * The brief asks for accent colours that communicate meaning, and the danger
 * in that is every component inventing its own thresholds, so a 52% reads as
 * good on one page and neutral on the next. It is decided once, here.
 *
 * THE GREY BAND IS NOT A GAP IN THE SCALE, IT IS A CLAIM. A rate with no
 * evidence behind it is drained to neutral rather than painted at the bottom,
 * for the same reason `MatrixBlock` draws a null cell empty instead of cold:
 * painting an unmeasured pairing at the cold end ranks it below a measured
 * loss, which is backwards. `thin` is how a caller says so.
 */
export type Semantic = 'good' | 'bad' | 'even' | 'none';

export function semanticOf(rate: number | null | undefined, thin = false): Semantic {
  if (thin || rate === null || rate === undefined || Number.isNaN(rate)) return 'none';
  if (rate >= 55) return 'good';
  if (rate <= 45) return 'bad';
  return 'even';
}

export function semanticColor(p: Palette, s: Semantic): RGB {
  switch (s) {
    case 'good': return p.green;
    case 'bad': return p.red;
    case 'even': return p.blue;
    /* DRAINED, NOT NEUTRAL — and the difference is a bug worth recording.
       `--text-muted` is PURE WHITE on dark in this project, deliberately, so
       that no body copy is grey. Handing that value to a bar meant a reading
       too thin to rank on came out as the single brightest mark on the page,
       shouting louder than every measured one. A drained figure has to recede,
       so it is mixed back toward the surface it sits on: still legible, no
       longer competing. */
    default: return mix(p.muted, p.nested, 0.52);
  }
}
