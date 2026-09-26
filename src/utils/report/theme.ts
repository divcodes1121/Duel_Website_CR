/**
 * THE DECKKIES REPORT THEME — fixed, dark, and not read off the page.
 *
 * The previous renderer read the LIVE CSS tokens at export time, so a report
 * came out white if the reader happened to be on the light theme. A report is
 * a branded document, not a screenshot of a preference: it is always dark,
 * always in the site's own dark values, and always the same file for the same
 * data. The hues below are the site's dark-mode `--hue-*` (ink) and
 * `--solid-*` (fill) tokens, copied from `index.css`, so a violet in the PDF
 * is the violet on the screen.
 *
 * No imports: `mix` and the lookups are pure and tested.
 */

export type RGB = readonly [number, number, number];

export type HueName = 'violet' | 'pink' | 'blue' | 'green' | 'red' | 'amber' | 'neutral';

export interface Hue {
  /** Bright step — graded for text and marks on a dark ground. */
  ink: RGB;
  /** Deep step — graded to carry white text; fills, buttons, gradient roots. */
  deep: RGB;
}

export const P = {
  /** The page. Near-black, a hair lifted so the panels read as surfaces. */
  ground: [7, 8, 11] as RGB,
  groundTop: [14, 15, 21] as RGB,
  /** A panel on the page. */
  panel: [18, 19, 25] as RGB,
  /** A table header, a hero band's lit edge. */
  panelHi: [25, 27, 35] as RGB,
  /** A card slot. Card art is flattened onto exactly this colour. */
  slot: [30, 32, 41] as RGB,
  line: [40, 43, 55] as RGB,
  lineStrong: [64, 68, 84] as RGB,
  text: [255, 255, 255] as RGB,
  /** Labels and secondary copy. 10.9:1 on the panel. */
  text2: [204, 208, 218] as RGB,
  /** Captions and footers. 6.1:1 on the panel. */
  text3: [142, 148, 163] as RGB,
  /** The crown on the logo. */
  gold: [245, 184, 46] as RGB,
  /** The favicon tile the D sits on. */
  brandTile: [12, 18, 34] as RGB,
} as const;

export const HUES: Record<HueName, Hue> = {
  violet: { ink: [167, 139, 250], deep: [109, 40, 217] },
  pink: { ink: [226, 112, 172], deep: [150, 32, 74] },
  blue: { ink: [91, 141, 239], deep: [29, 78, 216] },
  green: { ink: [52, 211, 153], deep: [4, 120, 87] },
  red: { ink: [248, 113, 113], deep: [192, 38, 24] },
  amber: { ink: [251, 191, 36], deep: [180, 83, 9] },
  neutral: { ink: [229, 231, 235], deep: [58, 63, 78] },
};

/**
 * Eight categorical colours for multi-series charts, in an order where
 * neighbours differ in hue AND lightness, so a legend can be read without
 * matching shades.
 */
export const SERIES: RGB[] = [
  [167, 139, 250],
  [52, 211, 153],
  [251, 191, 36],
  [91, 141, 239],
  [248, 113, 113],
  [226, 112, 172],
  [45, 212, 191],
  [203, 213, 225],
];

export function hue(name: HueName | undefined | null): Hue {
  return HUES[name ?? 'neutral'] ?? HUES.neutral;
}

/** Linear mix: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function css(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** WCAG relative luminance and contrast ratio, for the tests that hold the
 *  palette to its floors. */
export function luminance(c: RGB): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The colour a WIN RATE is printed in.
 *
 * Green at 55% and over, red at 45% and under, plain ink between: the band is
 * where a rate is indistinguishable from a coin flip at the sample sizes these
 * screens carry, and colouring it would claim a direction the data does not
 * have. `thin` (under the screen's evidence floor) is always the caption
 * colour — true, but not something to rank on.
 */
export function rateColor(rate: number | null | undefined, thin = false): RGB {
  if (thin || rate === null || rate === undefined || Number.isNaN(rate)) return P.text3;
  if (rate >= 55) return HUES.green.ink;
  if (rate <= 45) return HUES.red.ink;
  return P.text;
}

/** Pull a percentage back out of a printed value — "63.3%" -> 63.3 — so a
 *  deck's figure can be coloured without the adapter restating it. */
export function parsePct(text: string | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * A 0..1 fraction on a sequential red -> amber -> green ramp, for the matrix.
 * Stops are the red, amber and green INKS, so every cell holds dark text.
 */
export function heat(f: number): RGB {
  const t = Math.max(0, Math.min(1, f));
  const lo: RGB = [168, 52, 52];
  const mid: RGB = [176, 128, 28];
  const hi: RGB = [22, 150, 104];
  return t < 0.5 ? mix(lo, mid, t / 0.5) : mix(mid, hi, (t - 0.5) / 0.5);
}
