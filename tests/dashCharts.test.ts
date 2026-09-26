import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE CHART RULES, PINNED AT THE SOURCE.
 *
 * The kit's charts are Recharts (`src/components/ui/dash-charts.tsx`) and a
 * component test cannot draw an SVG in this suite's node environment, so the
 * rules the dataviz skill sets — and this project has broken before — are
 * swept for in the source instead, the way `coachScout.test.ts` sweeps for a
 * bare floor. A rule that can only be checked by reading the page is checked
 * in the browser pass; these are the ones a diff can break silently.
 */

const charts = readFileSync('src/components/ui/dash-charts.tsx', 'utf-8');
const kitCss = readFileSync('src/components/ui/bionis-dashboard.css', 'utf-8');
const shellCss = readFileSync('src/components/ui/dash-shell.css', 'utf-8');

/** Every JSX element `<Name ...>` in `src`, with its attributes. */
function elements(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe('the charts keep the rules', () => {
  it('never bridges a gap: every line and area leaves a null as a break', () => {
    // A day with too few battles has no win rate; joining across it draws a
    // movement that did not happen. The sparkline geometry that used to pin
    // this left with the hand-drawn sparkline.
    const marks = [...elements(charts, 'Area'), ...elements(charts, 'Line')].filter((e) => !/AreaChart|LineChart/.test(e.slice(0, 12)));
    expect(marks.length).toBeGreaterThan(0);
    for (const e of marks) expect(e).toMatch(/connectNulls=\{false\}/);
  });

  it('keeps every bar at 24px or thinner', () => {
    const bars = elements(charts, 'RBar');
    expect(bars.length).toBeGreaterThan(0);
    for (const e of bars) expect(e).toMatch(/maxBarSize=\{24\}/);
  });

  it('draws one y-axis per chart — two measures are two charts', () => {
    expect(charts).not.toMatch(/yAxisId/);
    expect(charts).not.toMatch(/orientation=["']right["']/);
  });

  it('keeps gridlines solid and hairline', () => {
    for (const g of elements(charts, 'CartesianGrid')) {
      expect(g).not.toMatch(/strokeDasharray/);
      expect(g).toMatch(/stroke="var\(--dash-grid\)"/);
    }
  });

  it('never gives text a series colour', () => {
    // Identity rides on the swatch beside a label; a light series hue is
    // illegible as text. The axis ticks and labels read `--text`.
    expect(kitCss).not.toMatch(/(^|[^-])color:\s*var\(--chart-/m);
    expect(charts).toMatch(/const TICK = \{ fill: 'var\(--text\)'/);
  });

  it('never animates forever', () => {
    // Comments may say "never infinite"; declarations may not.
    const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const css of [kitCss, shellCss]) expect(code(css)).not.toMatch(/\binfinite\b/);
    expect(charts).not.toMatch(/Infinity/);
  });
});

describe('the dashboard palette is the validated one', () => {
  const block = (theme: 'dark' | 'light') => {
    const i = kitCss.indexOf(`:root[data-theme='${theme}'] {`);
    return kitCss.slice(i, kitCss.indexOf('}', i));
  };
  const series = (theme: 'dark' | 'light') =>
    [1, 2, 3, 4, 5, 6].map((n) => new RegExp(`--chart-${n}:\\s*(#[0-9a-f]{6})`).exec(block(theme))?.[1]);

  it('steps its own series for each theme, in the fixed order', () => {
    // violet > teal > amber > blue > pink > lime, validated by the dataviz
    // skill's script against #ffffff and #141417 — re-run it before changing
    // any of these.
    expect(series('light')).toEqual(['#7c3aed', '#0d9488', '#d97706', '#2563eb', '#db2777', '#65a30d']);
    expect(series('dark')).toEqual(['#8b5cf6', '#0f9e8f', '#c47a08', '#3b82f6', '#e0508f', '#5f9e12']);
  });

  it('draws the dark card on the surface the palette was validated against', () => {
    expect(block('dark')).toMatch(/--dash-card:\s*#141417/);
    expect(block('light')).toMatch(/--dash-card:\s*#ffffff/);
  });
});
