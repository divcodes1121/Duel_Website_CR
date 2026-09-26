/**
 * THE KIT'S CHARTS, ON RECHARTS.
 *
 * WHY RECHARTS. Chosen on 2026-09-26 against Nivo, visx, Chart.js, ECharts and
 * Tremor: it is SVG (so a CSS custom property works as a fill or a stroke and
 * both themes come free — the shadcn/ui charts rely on exactly this), it is
 * the renderer the shadcn and Tremor dashboards are built on, it ships a
 * keyboard layer by default in v3 (arrow keys walk the points and move the
 * tooltip), and it is ~100 kB gzip ONLY in the three lazy chunks that draw a
 * chart — nothing in the public bundle imports this file.
 *
 * THE RULES EVERY CHART HERE FOLLOWS — the dataviz skill's, and each is a
 * line of code below rather than a habit:
 *   * one y-axis, never two: two measures of different scale are two charts
 *     (the day chart is a battles chart above a win-rate chart, synced);
 *   * bars at most 24px thick, 4px rounded at the data end and square at the
 *     baseline; a 2px surface gap between stacked segments;
 *   * 2px lines, markers 8px with a 2px ring in the card colour;
 *   * an area is a wash (~10-24% alpha), never a solid block;
 *   * hairline solid gridlines in `--dash-grid`, the axis a step darker;
 *   * text wears text tokens — full ink here, the project's contrast rule —
 *     and never the series colour; identity is the swatch beside it;
 *   * a legend whenever there are two or more series;
 *   * the tooltip leads with the value and keys each series with a short
 *     stroke of its colour;
 *   * every chart has a TABLE VIEW (`useChartView`), so no value is reachable
 *     only by hovering.
 *
 * Nothing here imports the kit at runtime — only its types — so the kit can
 * import this file without a cycle.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from 'react';
import {
  Area,
  AreaChart,
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import type { Bar, DashTone, Trend } from './bionis-dashboard';

/* ── colour by job ─────────────────────────────────────────────────────── */

/** A kit tone as a mark colour. `info` is the first series slot; the three
 *  status tones keep the site's status hues. */
export const TONE_COLOR: Record<DashTone, string> = {
  info: 'var(--chart-1)',
  good: 'var(--hue-green)',
  warn: 'var(--warning)',
  bad: 'var(--hue-red)',
  neutral: 'var(--chart-other)',
};

/** The categorical slots, in their validated order. */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

const TICK = { fill: 'var(--text)', fontSize: 11, fontWeight: 500 } as const;
const LABEL = { fill: 'var(--text)', fontSize: 12, fontWeight: 700 } as const;

const nf = new Intl.NumberFormat('en-US');

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** `useId` without the colons, which do not belong inside `url(#…)`. */
function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/* ── the table view ────────────────────────────────────────────────────── */

interface ChartView {
  table: boolean;
  register: () => () => void;
}

/** Provided by `ChartCard`: whether its chart is showing as a table, and a
 *  way for a chart to say it can. The card draws its toggle only then. */
export const ChartViewContext = createContext<ChartView>({ table: false, register: () => () => {} });

/** A chart's half of the table toggle: registers that it has a table, and
 *  answers whether to draw it. */
export function useChartView(): boolean {
  const { table, register } = useContext(ChartViewContext);
  useEffect(() => register(), [register]);
  return table;
}

export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export function DashTable({
  columns,
  rows,
  caption,
}: {
  columns: TableColumn[];
  rows: Record<string, ReactNode>[];
  caption?: string;
}) {
  return (
    <div className="bd-tableWrap">
      <table className="bd-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-num={c.numeric || undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} data-num={c.numeric || undefined}>
                  {r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── the tooltip card ──────────────────────────────────────────────────── */

export interface TipRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  color: string;
  /** A stroke for a line or an area, a square for a bar. */
  shape?: 'line' | 'rect';
}

/** Values lead, names follow, each row keyed by a short stroke of its colour
 *  — the legend's hierarchy inverted, because here the reader has the series
 *  and wants the number. Opaque, like every tooltip in the kit. */
export function TipCard({ title, rows, lines }: { title: ReactNode; rows: TipRow[]; lines?: ReactNode[] }) {
  return (
    <div className="bd-tip bd-rcTip">
      <span className="bd-tipTitle">{title}</span>
      {rows.map((r) => (
        <span className="bd-tipRow" key={r.key}>
          <i className="bd-tipKey" data-shape={r.shape ?? 'line'} style={{ background: r.color }} aria-hidden="true" />
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </span>
      ))}
      {lines?.map((l, i) => (
        <span className="bd-tipLine" key={i}>
          {l}
        </span>
      ))}
    </div>
  );
}

/* ── the legend ────────────────────────────────────────────────────────── */

export function Legend({
  items,
}: {
  items: { key: string; label: ReactNode; color: string; shape?: 'line' | 'rect'; note?: ReactNode }[];
}) {
  return (
    <ul className="bd-legend">
      {items.map((it) => (
        <li key={it.key}>
          <i className="bd-legendKey" data-shape={it.shape ?? 'rect'} style={{ background: it.color }} aria-hidden="true" />
          <span>{it.label}</span>
          {it.note != null && <strong>{it.note}</strong>}
        </li>
      ))}
    </ul>
  );
}

/* ── columns over categories ───────────────────────────────────────────── */

/**
 * Vertical bars over named categories — the kit's `ColumnChart`. Each column's
 * value sits on its cap (twelve or fewer), so the y-axis is left off: every
 * value is labelled. A zero draws nothing.
 */
export function Columns({
  bars,
  max,
  empty = 'Nothing to show yet.',
  height = 220,
  label,
}: {
  bars: Bar[];
  max?: number;
  empty?: string;
  height?: number;
  label?: string;
}) {
  const table = useChartView();
  const reduced = useReducedMotion();
  if (bars.length === 0) return <p className="bd-empty">{empty}</p>;
  if (table) {
    return (
      <DashTable
        caption={label}
        columns={[
          { key: 'label', label: 'Category' },
          { key: 'value', label: 'Value', numeric: true },
          { key: 'detail', label: 'Detail' },
        ]}
        rows={bars.map((b) => ({ label: b.label, value: b.display ?? nf.format(b.value), detail: b.detail }))}
      />
    );
  }
  const data = bars.map((b, i) => ({
    i,
    label: b.label,
    value: b.value,
    display: b.display ?? nf.format(b.value),
    detail: b.detail,
    tone: b.tone ?? 'info',
    color: b.color ?? TONE_COLOR[b.tone ?? 'info'],
  }));
  const labelled = bars.length <= 12;
  return (
    <div className="bd-rc" aria-label={label}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <BarChart data={data} margin={{ top: labelled ? 24 : 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--dash-grid)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--dash-axis)' }}
            tick={TICK}
            interval={0}
            tickMargin={8}
          />
          <YAxis hide domain={[0, max ?? 'auto']} />
          <Tooltip
            cursor={{ fill: 'var(--dash-hover)' }}
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const row = p.active ? (p.payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!row) return null;
              return (
                <TipCard
                  title={row.label}
                  rows={[{ key: 'v', label: '', value: row.display, color: row.color, shape: 'rect' }]}
                  lines={row.detail ? [row.detail] : undefined}
                />
              );
            }}
          />
          <RBar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={!reduced} animationDuration={560}>
            {data.map((d) => (
              <Cell key={d.i} fill={d.color} />
            ))}
            {labelled && <LabelList dataKey="display" position="top" offset={8} style={LABEL} />}
          </RBar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── the sparkline ─────────────────────────────────────────────────────── */

/**
 * A small area under a line, hoverable point by point — the kit's
 * `Sparkline`. A null is a GAP, never a zero and never bridged, so a day under
 * a floor breaks the line (the day chart and its card cannot disagree).
 */
export function SparkArea({ trend, height = 48 }: { trend: Trend; height?: number }) {
  const uid = useSvgId();
  const reduced = useReducedMotion();
  const color = TONE_COLOR[trend.tone ?? 'info'];
  const fmt = trend.format ?? ((v: number) => String(v));
  const values = trend.values;
  const lastIndex = (() => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
    return -1;
  })();
  if (lastIndex < 0) return null;
  const data = values.map((v, i) => ({ i, v, label: trend.labels?.[i] ?? `#${i + 1}` }));
  return (
    <div
      className="bd-spark"
      style={{ height }}
      role="group"
      aria-label={`${trend.label}. Latest ${fmt(values[lastIndex] as number)}.`}
    >
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 160, height }}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 3, left: 5 }}>
          <defs>
            <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide domain={[trend.min ?? 'auto', trend.max ?? 'auto']} />
          <Tooltip
            cursor={{ stroke: 'var(--dash-axis)', strokeWidth: 1 }}
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const row = p.active ? (p.payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!row) return null;
              return (
                <TipCard
                  title={row.label}
                  rows={[{ key: 'v', label: '', value: row.v == null ? '—' : fmt(row.v), color }]}
                  lines={row.v == null && trend.gapNote ? [trend.gapNote] : undefined}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${uid}-g)`}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--dash-card)', strokeWidth: 2, fill: color }}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── a trend over time ─────────────────────────────────────────────────── */

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  /** `area` (the default) is a line with its wash; `line` has none. */
  kind?: 'area' | 'line';
  format?: (v: number) => string;
}

/**
 * One measure over time, one axis — a line with its wash, or up to a few
 * lines. A null is a gap. `reference` draws one labelled baseline (an overall
 * rate, a target). `syncId` ties the crosshair to another chart, so a small
 * multiple below reads as the same days.
 */
export function TrendChart({
  data,
  xKey = 'x',
  series,
  height = 200,
  yDomain,
  yFormat,
  xFormat,
  tipTitle,
  tipLines,
  reference,
  syncId,
  curve = 'monotone',
  label,
  empty = 'Nothing to show yet.',
}: {
  data: Record<string, string | number | null>[];
  xKey?: string;
  series: TrendSeries[];
  height?: number;
  yDomain?: [number | 'auto', number | 'auto'];
  yFormat?: (v: number) => string;
  xFormat?: (x: string) => string;
  tipTitle?: (x: string) => ReactNode;
  tipLines?: (row: Record<string, string | number | null>) => ReactNode[] | undefined;
  reference?: { y: number; label: string };
  syncId?: string;
  /** `stepAfter` for a running total, which only moves when something is
   *  added — a smooth curve would draw growth between two sign-ups. */
  curve?: 'monotone' | 'stepAfter' | 'linear';
  label?: string;
  empty?: string;
}) {
  const uid = useSvgId();
  const table = useChartView();
  const reduced = useReducedMotion();
  const fmtY = yFormat ?? ((v: number) => nf.format(v));
  if (data.length === 0) return <p className="bd-empty">{empty}</p>;
  if (table) {
    return (
      <DashTable
        caption={label}
        columns={[
          { key: '__x', label: 'Day' },
          ...series.map((s) => ({ key: s.key, label: s.label, numeric: true })),
        ]}
        rows={data.map((r) => ({
          __x: xFormat ? xFormat(String(r[xKey])) : String(r[xKey]),
          ...Object.fromEntries(
            series.map((s) => [s.key, r[s.key] == null ? '—' : (s.format ?? fmtY)(Number(r[s.key]))]),
          ),
        }))}
      />
    );
  }
  return (
    <div className="bd-rc" aria-label={label}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <AreaChart data={data} syncId={syncId} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.24} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--dash-grid)" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={{ stroke: 'var(--dash-axis)' }}
            tick={TICK}
            tickFormatter={xFormat}
            minTickGap={18}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={TICK}
            tickFormatter={fmtY}
            width={44}
            domain={yDomain ?? [0, 'auto']}
            allowDecimals={false}
          />
          {reference && (
            <ReferenceLine
              y={reference.y}
              stroke="var(--dash-axis)"
              strokeWidth={1}
              label={{ value: reference.label, position: 'insideTopRight', fill: 'var(--text)', fontSize: 11, fontWeight: 600 }}
            />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--dash-axis)', strokeWidth: 1 }}
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const row = p.active ? (p.payload?.[0]?.payload as Record<string, string | number | null> | undefined) : undefined;
              if (!row) return null;
              const x = String(row[xKey]);
              return (
                <TipCard
                  title={tipTitle ? tipTitle(x) : xFormat ? xFormat(x) : x}
                  rows={series.map((s) => ({
                    key: s.key,
                    label: s.label,
                    value: row[s.key] == null ? '—' : (s.format ?? fmtY)(Number(row[s.key])),
                    color: s.color,
                  }))}
                  lines={tipLines?.(row)}
                />
              );
            }}
          />
          {series.map((s) =>
            s.kind === 'line' ? (
              <Line
                key={s.key}
                type={curve}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--dash-card)', strokeWidth: 2, fill: s.color }}
                isAnimationActive={!reduced}
              />
            ) : (
              <Area
                key={s.key}
                type={curve}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${uid}-${s.key})`}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--dash-card)', strokeWidth: 2, fill: s.color }}
                isAnimationActive={!reduced}
                animationDuration={700}
              />
            ),
          )}
        </AreaChart>
      </ResponsiveContainer>
      {series.length > 1 && <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color, shape: 'line' }))} />}
    </div>
  );
}

/* ── stacked columns over time ─────────────────────────────────────────── */

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

/** A rect with only its TOP corners rounded — the data end. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  if (rr === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

interface SegmentShape {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: Record<string, unknown>;
}

/**
 * Columns stacked by category over time. Only the TOPMOST non-empty segment
 * of a column is rounded, and every segment with one above it gives up 2px at
 * its top — the surface gap that separates neighbours without drawing a
 * stroke round them. The tooltip lists every series at that day, and a total.
 */
export function StackedColumns({
  data,
  xKey = 'x',
  series,
  height = 240,
  xFormat,
  tipTitle,
  label,
  totalLabel = 'Total',
  syncId,
  empty = 'Nothing to show yet.',
}: {
  data: Record<string, string | number | null>[];
  xKey?: string;
  series: StackSeries[];
  height?: number;
  xFormat?: (x: string) => string;
  tipTitle?: (x: string) => ReactNode;
  label?: string;
  totalLabel?: string;
  /** Ties the crosshair to another chart of the same days. */
  syncId?: string;
  empty?: string;
}) {
  const table = useChartView();
  const reduced = useReducedMotion();
  const keys = series.map((s) => s.key);
  const total = (row: Record<string, unknown>) => keys.reduce((n, k) => n + (Number(row[k]) || 0), 0);
  if (data.length === 0) return <p className="bd-empty">{empty}</p>;
  if (table) {
    return (
      <DashTable
        caption={label}
        columns={[
          { key: '__x', label: 'Day' },
          ...series.map((s) => ({ key: s.key, label: s.label, numeric: true })),
          { key: '__t', label: totalLabel, numeric: true },
        ]}
        rows={data
          .filter((r) => total(r) > 0)
          .map((r) => ({
            __x: xFormat ? xFormat(String(r[xKey])) : String(r[xKey]),
            ...Object.fromEntries(series.map((s) => [s.key, nf.format(Number(r[s.key]) || 0)])),
            __t: nf.format(total(r)),
          }))}
      />
    );
  }
  const shapeFor = (k: number) => (raw: unknown) => {
    const p = raw as SegmentShape;
    const row = p.payload ?? {};
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    const w = p.width ?? 0;
    const h = p.height ?? 0;
    if (h <= 0 || w <= 0) return <g />;
    const above = keys.slice(k + 1).some((kk) => (Number(row[kk]) || 0) > 0);
    const gap = above && h > 3 ? 2 : 0;
    return <path d={topRounded(x, y + gap, w, h - gap, above ? 0 : 4)} fill={p.fill} />;
  };
  return (
    <div className="bd-rc" aria-label={label}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        <BarChart data={data} syncId={syncId} margin={{ top: 10, right: 12, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--dash-grid)" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={{ stroke: 'var(--dash-axis)' }}
            tick={TICK}
            tickFormatter={xFormat}
            minTickGap={16}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tick={TICK} width={44} allowDecimals={false} tickFormatter={(v: number) => nf.format(v)} />
          <Tooltip
            cursor={{ fill: 'var(--dash-hover)' }}
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const row = p.active ? (p.payload?.[0]?.payload as Record<string, string | number | null> | undefined) : undefined;
              if (!row) return null;
              const x = String(row[xKey]);
              const t = total(row);
              return (
                <TipCard
                  title={tipTitle ? tipTitle(x) : xFormat ? xFormat(x) : x}
                  rows={series
                    .filter((s) => (Number(row[s.key]) || 0) > 0)
                    .reverse()
                    .map((s) => ({ key: s.key, label: s.label, value: nf.format(Number(row[s.key])), color: s.color, shape: 'rect' as const }))}
                  lines={[`${totalLabel}: ${nf.format(t)}`]}
                />
              );
            }}
          />
          {series.map((s, k) => (
            <RBar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.color}
              maxBarSize={24}
              shape={shapeFor(k)}
              isAnimationActive={!reduced}
              animationDuration={560}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
    </div>
  );
}
