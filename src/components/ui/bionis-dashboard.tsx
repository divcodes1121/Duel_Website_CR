/**
 * THE DASHBOARD KIT — one kit, four screens (the console summary, the coach
 * roster overview, a player's coach dashboard and the player's own `#/my`).
 * Replacing this file's internals while keeping its exports is how all four
 * change together and stay alike.
 *
 * DESIGN: TailAdmin's (demo.tailadmin.com), chosen on 2026-09-26 against 30
 * other free admin templates by screenshot in both themes: 16px cards with a
 * 24px pad on a 24px grid, a 48px icon tile, 30px/700 figures, 18px/600 card
 * titles, a segmented tab control inside the card head, a gauge card whose
 * figures sit on a tinted band beneath it, and a tooltip on every chart mark.
 * The stat card's sparkline and progress bar are Gentelella's. The previous
 * layout was the `bionis-dashboard` composition, whose name the file keeps so
 * no import moved.
 *
 * DEVIATIONS FROM TAILADMIN — all of them, so the next reader can diff:
 *
 *  1. **NO TAILWIND, NO APEXCHARTS, NO ALPINE.** Every utility is a rule in
 *     `bionis-dashboard.css`, prefix-scoped `bd-` like `glass-dock` and
 *     `footer-5`. The time and category charts are RECHARTS (2026-09-26,
 *     `dash-charts.tsx`, which says why); the bar list, the gauge and the
 *     part-to-whole bar stay HTML/SVG, where a library adds nothing.
 *  2. **COLOUR IS OURS.** TailAdmin's dark mode is navy; this site's is black
 *     with grey edges, and a navy card under a black top bar reads as another
 *     site. Every colour is a token from `index.css`, tone is a `data-tone`
 *     attribute resolved in CSS, and glow stays gated on `--glow-*`, which is
 *     0% on light.
 *  3. **NO GREY LABELS.** TailAdmin sets its labels in gray-500. This project's
 *     contrast sweep made `--text-muted` full ink in both themes on purpose, so
 *     hierarchy here is size, weight and case — never a faded colour.
 *  4. **NO CARD MENUS.** TailAdmin puts a ⋮ on every card. None of ours has an
 *     action to put in one, and a menu that opens onto nothing is decoration.
 *  5. **THE GAUGE IS NOT A SCORE.** TailAdmin's is "Monthly Target 75.55%".
 *     Ours shows a PROPORTION OF A COUNT the caller states in words, and the
 *     caption is a required prop for exactly that reason (the roster
 *     overview's contract forbids a readiness score by name).
 *  6. **LAYOUT IS BY CONTAINER, NOT VIEWPORT.** The kit lives in columns that
 *     are a fraction of the page, so `.bd-root` is a size container and every
 *     breakpoint is a `@container` query — a breakpoint on the page does not
 *     describe a box that is half of it (this project hit that on Team
 *     Analysis).
 *  7. **MOTION IS ONE-SHOT**, transform/opacity only, `backwards` fill so a
 *     finished entrance holds no stacking context that could trap a tooltip.
 *     `prefers-reduced-motion` switches it all off via `index.css`, and the tab
 *     slab via `MotionConfig`.
 *  8. **A TOOLTIP IS ALSO A TAP AND A FOCUS.** Every mark that has one takes
 *     focus, so a keyboard reaches it and a phone opens it with a tap; a
 *     touch pointer leaving does not close it (it always "leaves" on lift).
 */

import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { LayoutGroup, MotionConfig, motion } from 'framer-motion';

import { cn } from './cn';
import { clampTip, gaugeArc, shareOf, tipAbove } from './dashGeometry';
import { ChartViewContext, Columns, DashTable, SparkArea, TONE_COLOR, useChartView } from './dash-charts';
import { AlertIcon, ChartIcon, CheckCircleIcon, TableIcon, XCircleIcon } from './dash-icons';
import './bionis-dashboard.css';

export {
  DashTable,
  Legend,
  SERIES,
  StackedColumns,
  TONE_COLOR,
  TrendChart,
  type StackSeries,
  type TrendSeries,
} from './dash-charts';

export type DashTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

/* ── shell ─────────────────────────────────────────────────────────────── */

export function Dashboard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('bd-root', className)}>{children}</div>;
}

/** Title on the left, one control on the right. The control is a slot rather
 *  than a built-in period picker: this project has exactly one select, and a
 *  second one living inside a layout component would be a second one. */
export function DashboardHeader({
  title,
  subtitle,
  control,
  level = 1,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  control?: ReactNode;
  /* The console already carries a page heading, so the dashboard's is a
     section there. An `<h1>` after an `<h2>` is a real document-order fault,
     not a style preference. */
  level?: 1 | 2 | 3;
}) {
  const Heading = (`h${level}` as const) satisfies keyof JSX.IntrinsicElements;
  return (
    <div className="bd-header">
      <div className="bd-headerText">
        <Heading className="bd-title">{title}</Heading>
        {subtitle && <p className="bd-subtitle">{subtitle}</p>}
      </div>
      {control && <div className="bd-headerControl">{control}</div>}
    </div>
  );
}

export interface DashStat {
  label: ReactNode;
  value: ReactNode;
  tone?: DashTone;
}

/**
 * The hero: a raised card with a heading, a badge, a sentence and a figure.
 * Given `stats`, it sits on a tinted band that carries them underneath —
 * TailAdmin's target card. Stats are figures the screen does not already
 * print elsewhere; repeating the metric cards here would be the same number
 * twice on one screen.
 */
export function DashHero({
  heading,
  badge,
  badgeTone = 'good',
  children,
  figure,
  stats,
}: {
  heading: ReactNode;
  badge?: ReactNode;
  badgeTone?: DashTone;
  children?: ReactNode;
  figure?: ReactNode;
  stats?: DashStat[];
}) {
  const body = (
    <div className="bd-heroMain">
      <div className="bd-heroText">
        <h2 className="bd-heroHeading">{heading}</h2>
        <div className="bd-heroBody">
          {badge && (
            <span className="bd-pill" data-tone={badgeTone}>
              {badge}
            </span>
          )}
          {children && <p className="bd-heroCopy">{children}</p>}
        </div>
      </div>
      {figure && <div className="bd-heroFigure">{figure}</div>}
    </div>
  );
  if (!stats?.length) return <section className="bd-hero">{body}</section>;
  return (
    <section className="bd-hero" data-banded="">
      {body}
      <dl className="bd-heroStats">
        {stats.map((s, i) => (
          <div className="bd-heroStat" key={i}>
            <dt>{s.label}</dt>
            <dd data-tone={s.tone ?? 'neutral'}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── the gauge ─────────────────────────────────────────────────────────── */

/**
 * An arc filled to `value / max`.
 *
 * **`caption` IS REQUIRED.** A bare number in a gauge reads as a score out of
 * a hundred, and on at least one screen using this component a score is the
 * one thing that must not appear. The caption is where the caller says what
 * the proportion is a proportion OF.
 *
 * `variant="gauge"` (the default) is TailAdmin's half arc; `ring` keeps the
 * full circle for a caller that wants it.
 */
export function ScoreDonut({
  value,
  max = 100,
  display,
  caption,
  tone = 'info',
  size,
  variant = 'gauge',
}: {
  value: number;
  max?: number;
  /** What to print in the middle. Defaults to the rounded percentage. */
  display?: ReactNode;
  caption: ReactNode;
  tone?: DashTone;
  size?: number;
  variant?: 'gauge' | 'ring';
}) {
  const share = shareOf(value, max);
  const label = `${Math.round(share * 100)}%`;

  if (variant === 'ring') {
    const r = 54;
    const c = 2 * Math.PI * r;
    return (
      <figure className="bd-donut" style={{ width: size ?? 168 }} data-tone={tone}>
        <svg viewBox="0 0 128 128" className="bd-donutSvg" role="img" aria-label={label}>
          <circle className="bd-donutTrack" cx="64" cy="64" r={r} />
          <circle
            className="bd-donutFill"
            cx="64"
            cy="64"
            r={r}
            /* A zero share must draw nothing, not a dot: a round cap on a
               zero-length dash still paints. */
            strokeDasharray={`${c * share} ${c}`}
            strokeLinecap={share > 0.01 ? 'round' : 'butt'}
            transform="rotate(-90 64 64)"
          />
          <text className="bd-donutValue" x="64" y="64" textAnchor="middle" dominantBaseline="central">
            {display ?? label}
          </text>
        </svg>
        <figcaption className="bd-donutCaption">{caption}</figcaption>
      </figure>
    );
  }

  const arc = gaugeArc(110, 108, 92, 180);
  const dash = arc.length * share;
  return (
    <figure className="bd-donut bd-gauge" style={{ width: size ?? 236 }} data-tone={tone}>
      <svg viewBox="0 0 220 124" className="bd-donutSvg" role="img" aria-label={label}>
        <path className="bd-donutTrack" d={arc.d} />
        {share > 0 && (
          <path
            className="bd-donutFill"
            d={arc.d}
            strokeDasharray={`${dash} ${arc.length}`}
            strokeLinecap={share > 0.01 ? 'round' : 'butt'}
            style={{ ['--bd-dash' as string]: dash }}
          />
        )}
        <text className="bd-donutValue" x="110" y="96" textAnchor="middle">
          {display ?? label}
        </text>
      </svg>
      <figcaption className="bd-donutCaption">{caption}</figcaption>
    </figure>
  );
}

/* ── tooltips ──────────────────────────────────────────────────────────── */

export interface TipContent {
  title: ReactNode;
  value?: ReactNode;
  lines?: ReactNode[];
  tone?: DashTone;
}

export interface TipAt extends TipContent {
  /** Anchor, in the host's own pixels. */
  x: number;
  y: number;
}

/**
 * A host's tooltip state. `show` anchors on an element (top-centre, or its
 * top-right end for a horizontal bar); `showAt` on a point.
 */
export function useChartTip() {
  const host = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipAt | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const showAt = useCallback((i: number, x: number, y: number, content: TipContent) => {
    setActive(i);
    setTip({ ...content, x, y });
  }, []);

  const show = useCallback(
    (i: number, el: Element, content: TipContent, anchor: 'top' | 'end' = 'top') => {
      const box = host.current?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!box) return;
      const x = anchor === 'end' ? r.right - box.left : r.left + r.width / 2 - box.left;
      showAt(i, x, r.top - box.top, content);
    },
    [showAt],
  );

  const hide = useCallback(() => {
    setActive(null);
    setTip(null);
  }, []);

  /* A touch pointer ALWAYS "leaves" when the finger lifts, so closing on
     leave would open and shut the tooltip within one tap. Touch closes on
     blur instead — tapping anywhere else. */
  const leave = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') hide();
    },
    [hide],
  );

  return { host, tip, active, show, showAt, hide, leave };
}

/** The floating card. Positions itself after it has measured itself, so it
 *  is clamped to its host's width and flips below when there is no room
 *  above it in the viewport. */
export function ChartTip({ tip, host }: { tip: TipAt | null; host: RefObject<HTMLDivElement> }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = el.current;
    const box = host.current;
    if (!node || !box || !tip) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const hostRect = box.getBoundingClientRect();
    const above = tipAbove(hostRect.top + tip.y, h);
    node.style.left = `${clampTip(tip.x, w, box.clientWidth)}px`;
    node.style.top = `${above ? tip.y - h - 10 : tip.y + 16}px`;
    node.dataset.place = above ? 'above' : 'below';
  }, [tip, host]);
  if (!tip) return null;
  return (
    <div ref={el} className="bd-tip" role="tooltip" data-tone={tip.tone ?? 'info'}>
      <span className="bd-tipTitle">{tip.title}</span>
      {tip.value != null && (
        <span className="bd-tipValue">
          <i aria-hidden="true" />
          {tip.value}
        </span>
      )}
      {tip.lines?.map((l, i) => (
        <span className="bd-tipLine" key={i}>
          {l}
        </span>
      ))}
    </div>
  );
}

/* ── sparkline ─────────────────────────────────────────────────────────── */

export interface Trend {
  values: (number | null)[];
  /** One per value; what the tooltip is titled with (a day, usually). */
  labels?: string[];
  format?: (v: number) => string;
  /** What a null means, in words — "under 3 battles", not a blank. */
  gapNote?: string;
  min?: number;
  max?: number;
  tone?: DashTone;
  /** For a screen reader: what the line is a line OF. */
  label: string;
}

/**
 * A small line with its area, hoverable point by point — drawn by Recharts
 * (`SparkArea`). A null is a gap; the tooltip says what a gap means.
 */
export function Sparkline({ trend, height = 48 }: { trend: Trend; height?: number }) {
  return <SparkArea trend={trend} height={height} />;
}

/* ── metric cards ──────────────────────────────────────────────────────── */

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="bd-metricGrid">{children}</div>;
}

const Arrow = ({ dir }: { dir: 'up' | 'down' }) => (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
    <path d={dir === 'up' ? 'M6 2.5 10 8H2z' : 'M6 9.5 2 4h8z'} fill="currentColor" />
  </svg>
);

/** A state in a word, with the icon that says it without the colour. */
export function StatusPill({ tone, children }: { tone: DashTone; children: ReactNode }) {
  const Icon = tone === 'bad' ? XCircleIcon : tone === 'warn' ? AlertIcon : CheckCircleIcon;
  return (
    <span className="bd-pill bd-status" data-tone={tone}>
      <Icon size={13} />
      {children}
    </span>
  );
}

export function KeyMetricCard({
  label,
  value,
  note,
  delta,
  deltaTone,
  deltaDir,
  tone = 'neutral',
  icon,
  trend,
  progress,
  onClick,
  actionLabel,
  status,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  /** A short comparison in words. Not computed here — the caller owns what
   *  it is compared against, and an unlabelled delta is unreadable. */
  delta?: ReactNode;
  /** The pill's tone when it differs from the card's (a rise in volume is
   *  not good or bad; a rise in win rate is). */
  deltaTone?: DashTone;
  deltaDir?: 'up' | 'down';
  tone?: DashTone;
  icon?: ReactNode;
  trend?: Trend;
  /** A share of a real total, drawn as a thin bar under the figure. */
  progress?: { value: number; max: number; tone?: DashTone };
  /** Makes the figure a button — used to jump to the block that explains it. */
  onClick?: () => void;
  actionLabel?: string;
  /** A state, in a word, with its icon — "Healthy", "Late", "Stalled". The
   *  dataviz rule: a status colour ships with an icon and a label. */
  status?: { tone: DashTone; label: string };
}) {
  const head = (
    <>
      <div className="bd-metricHead">
        {icon && (
          <span className="bd-metricIcon" data-tone={tone}>
            {icon}
          </span>
        )}
        <span className="bd-metricLabel">{label}</span>
        {onClick && (
          <svg className="bd-metricGo" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="bd-metricRow">
        <strong className="bd-metricValue">{value}</strong>
        {delta && (
          <span className="bd-pill bd-metricDelta" data-tone={deltaTone ?? tone}>
            {deltaDir && <Arrow dir={deltaDir} />}
            {delta}
          </span>
        )}
        {status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
      </div>
      {note && <span className="bd-metricNote">{note}</span>}
    </>
  );
  return (
    <article className="bd-metric" data-tone={tone} data-clickable={onClick ? '' : undefined}>
      {onClick ? (
        <button type="button" className="bd-metricHit" onClick={onClick} aria-label={actionLabel}>
          {head}
        </button>
      ) : (
        head
      )}
      {progress && (
        <span className="bd-metricProgress" aria-hidden="true">
          <span
            className="bd-barFill"
            data-tone={progress.tone ?? (tone === 'neutral' ? 'info' : tone)}
            style={{ width: `${shareOf(progress.value, progress.max) * 100}%` }}
          />
        </span>
      )}
      {trend && (
        <div className="bd-metricTrend">
          <Sparkline trend={{ ...trend, tone: trend.tone ?? (tone === 'neutral' ? 'info' : tone) }} />
        </div>
      )}
    </article>
  );
}

/* ── tabs ──────────────────────────────────────────────────────────────── */

export interface DashTab {
  id: string;
  label: ReactNode;
}

/**
 * TailAdmin's segmented control. The slab TRAVELS to the picked tab
 * (`layoutId`), scoped per instance with `LayoutGroup` — a literal id is
 * global and two controls on one screen would share one slab, the fault the
 * pagination's `layoutId` had. Arrow keys move between tabs.
 */
export function DashTabs({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: DashTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  idBase?: string;
}) {
  const own = useId();
  const base = idBase ?? own;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === value);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    (e.currentTarget.querySelectorAll('button')[next] as HTMLButtonElement | undefined)?.focus();
  };
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={base}>
        <div className="bd-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
          {tabs.map((t) => {
            const on = t.id === value;
            return (
              <button
                key={t.id}
                id={`${base}-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`${base}-panel`}
                tabIndex={on ? 0 : -1}
                className="bd-tab"
                onClick={() => onChange(t.id)}
              >
                {on && (
                  <motion.span
                    layoutId="slab"
                    className="bd-tabSlab"
                    transition={{ type: 'tween', duration: 0.32, ease: [0.22, 0.68, 0.32, 1] }}
                  />
                )}
                <span className="bd-tabText">{t.label}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}

/* ── chart cards ───────────────────────────────────────────────────────── */

export function ChartGrid({ children }: { children: ReactNode }) {
  return <section className="bd-chartGrid">{children}</section>;
}

/**
 * A card with a head. Given `tabs`, the head carries a segmented control and
 * `children` may be a function of the picked tab; the pick is held here
 * unless the caller passes `tab` and owns it.
 */
export function ChartCard({
  title,
  note,
  badge,
  children,
  tabs,
  tab,
  onTabChange,
  footer,
  id,
}: {
  title: ReactNode;
  note?: ReactNode;
  badge?: ReactNode;
  children: ReactNode | ((tab: string) => ReactNode);
  tabs?: DashTab[];
  tab?: string;
  onTabChange?: (id: string) => void;
  footer?: ReactNode;
  id?: string;
}) {
  const base = useId();
  const [own, setOwn] = useState(tabs?.[0]?.id ?? '');
  const current = tab ?? own;
  const pick = (t: string) => {
    if (tab === undefined) setOwn(t);
    onTabChange?.(t);
  };
  /* THE TABLE VIEW. A chart inside says it has one (`useChartView`), and the
     card then offers the switch — so no value on a chart is reachable only
     by hovering, and a card holding no chart shows no dead button. */
  const [charts, setCharts] = useState(0);
  const [table, setTable] = useState(false);
  const register = useCallback(() => {
    setCharts((n) => n + 1);
    return () => setCharts((n) => n - 1);
  }, []);
  const view = useMemo(() => ({ table, register }), [table, register]);
  const body = typeof children === 'function' ? children(current) : children;
  const titleText = typeof title === 'string' ? title : 'this chart';
  return (
    <article className="bd-chartCard" id={id}>
      <div className="bd-cardHead">
        <div className="bd-cardHeadText">
          <h3 className="bd-cardTitle">{title}</h3>
          {note && <p className="bd-cardNote">{note}</p>}
        </div>
        {(tabs || badge || charts > 0) && (
          <div className="bd-cardHeadSide">
            {badge && <DashBadge>{badge}</DashBadge>}
            {tabs && tabs.length > 1 && (
              <DashTabs tabs={tabs} value={current} onChange={pick} label={typeof title === 'string' ? title : 'View'} idBase={base} />
            )}
            {charts > 0 && (
              <button
                type="button"
                className="bd-viewToggle"
                aria-pressed={table}
                aria-label={table ? `Show ${titleText} as a chart` : `Show ${titleText} as a table`}
                title={table ? 'Show as a chart' : 'Show as a table'}
                onClick={() => setTable((t) => !t)}
              >
                {table ? <ChartIcon /> : <TableIcon />}
              </button>
            )}
          </div>
        )}
      </div>
      <div
        className="bd-chartBody"
        {...(tabs && tabs.length > 1
          ? { role: 'tabpanel', id: `${base}-panel`, 'aria-labelledby': `${base}-tab-${current}` }
          : {})}
      >
        <ChartViewContext.Provider value={view}>{body}</ChartViewContext.Provider>
      </div>
      {footer && <div className="bd-cardFoot">{footer}</div>}
    </article>
  );
}

export interface Bar {
  label: string;
  value: number;
  tone?: DashTone;
  /** An entity's own colour (a CSS colour or `var(--chart-n)`), when the bar
   *  stands for something a legend elsewhere already colours. Wins over
   *  `tone`, so the same thing is never two colours on one screen. */
  color?: string;
  /** Printed at the end of the row instead of the bare value. */
  display?: string;
  /** The figures behind the bar, for its tooltip — counts, never adjectives. */
  detail?: string;
}

const tipFor = (b: Bar): TipContent => ({
  title: b.label,
  value: b.display ?? String(b.value),
  lines: b.detail ? [b.detail] : undefined,
  tone: b.tone ?? 'info',
});

const ariaFor = (b: Bar) => [b.label, b.display ?? String(b.value), b.detail].filter(Boolean).join(', ');

/**
 * Horizontal labelled bars.
 *
 * The width is a share of the LARGEST bar unless `max` is given — with a
 * caller-supplied max the bars are a share of a real total and the reader can
 * compare them against it. Clamped, because a value above the max would
 * otherwise lay out wider than its track and be silently clipped (the same
 * fault `ShareBars` had in the scout).
 *
 * Hovering, focusing or tapping a row dims the others and opens its tooltip.
 */
export function BarRows({ bars, max, empty = 'Nothing to show yet.' }: { bars: Bar[]; max?: number; empty?: string }) {
  const t = useChartTip();
  const table = useChartView();
  const ceiling = max ?? Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0) return <p className="bd-empty">{empty}</p>;
  if (table) {
    return (
      <DashTable
        columns={[
          { key: 'label', label: 'Category' },
          { key: 'value', label: 'Value', numeric: true },
          { key: 'detail', label: 'Detail' },
        ]}
        rows={bars.map((b) => ({ label: b.label, value: b.display ?? String(b.value), detail: b.detail }))}
      />
    );
  }
  const open = (i: number, el: HTMLElement) =>
    t.show(i, el.querySelector('.bd-barTrack') ?? el, tipFor(bars[i]), 'top');
  return (
    <div className="bd-plot" ref={t.host} data-focus={t.active != null ? '' : undefined}>
      <ul className="bd-bars">
        {bars.map((b, i) => (
          <li
            className="bd-bar"
            key={b.label}
            tabIndex={0}
            aria-label={ariaFor(b)}
            data-on={t.active === i ? '' : undefined}
            onPointerEnter={(e) => open(i, e.currentTarget)}
            onPointerLeave={t.leave}
            onFocus={(e) => open(i, e.currentTarget)}
            onBlur={t.hide}
          >
            <span className="bd-barLabel">{b.label}</span>
            <span className="bd-barTrack">
              <span
                className="bd-barFill"
                data-tone={b.tone ?? 'info'}
                style={{ width: `${shareOf(b.value, ceiling) * 100}%`, ...(b.color ? { background: b.color } : {}) }}
              />
            </span>
            <span className="bd-barValue">{b.display ?? b.value}</span>
          </li>
        ))}
      </ul>
      <ChartTip tip={t.tip} host={t.host} />
    </div>
  );
}

/** Vertical bars over named categories — TailAdmin's monthly-sales card,
 *  without pretending to a time axis. Drawn by Recharts (`Columns`). */
export function ColumnChart({
  bars,
  max,
  empty = 'Nothing to show yet.',
  height,
}: {
  bars: Bar[];
  max?: number;
  empty?: string;
  height?: number;
}) {
  return <Columns bars={bars} max={max} empty={empty} height={height} />;
}

/* ── part of a whole ───────────────────────────────────────────────────── */

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Printed instead of the bare value. */
  display?: string;
  detail?: string;
}

/**
 * One bar split into its parts, with a legend that carries every figure —
 * the skill's form for part-to-whole (a donut is deprioritised: angles are
 * read worse than lengths). Segments are separated by a 2px surface gap, not
 * a stroke; an empty part is left out of the bar and kept in the legend, so
 * a zero is stated rather than silently missing.
 */
export function SegmentBar({
  segments,
  total,
  label,
  empty = 'Nothing to show yet.',
}: {
  segments: Segment[];
  /** The whole, when it is more than the parts listed (an "other" not drawn). */
  total?: number;
  label?: string;
  empty?: string;
}) {
  const t = useChartTip();
  const table = useChartView();
  const sum = total ?? segments.reduce((n, x) => n + x.value, 0);
  const share = (v: number) => (sum > 0 ? `${((v / sum) * 100).toFixed(v / sum < 0.1 ? 1 : 0)}%` : '—');
  if (sum <= 0) return <p className="bd-empty">{empty}</p>;
  if (table) {
    return (
      <DashTable
        caption={label}
        columns={[
          { key: 'label', label: 'Part' },
          { key: 'value', label: 'Count', numeric: true },
          { key: 'share', label: 'Share', numeric: true },
        ]}
        rows={segments.map((x) => ({ label: x.label, value: x.display ?? x.value.toLocaleString('en-US'), share: share(x.value) }))}
      />
    );
  }
  const drawn = segments.filter((x) => x.value > 0);
  return (
    <div className="bd-seg bd-plot" ref={t.host} data-focus={t.active != null ? '' : undefined}>
      <div className="bd-segBar" role="img" aria-label={`${label ? `${label}: ` : ''}${segments.map((x) => `${x.label} ${x.display ?? x.value} (${share(x.value)})`).join(', ')}`}>
        {drawn.map((x, i) => (
          <span
            key={x.key}
            className="bd-segPart"
            data-on={t.active === i ? '' : undefined}
            style={{ flexGrow: x.value, background: x.color }}
            onPointerEnter={(e) =>
              t.show(i, e.currentTarget, {
                title: x.label,
                value: `${x.display ?? x.value.toLocaleString('en-US')} · ${share(x.value)}`,
                lines: x.detail ? [x.detail] : undefined,
              })
            }
            onPointerLeave={t.leave}
          />
        ))}
      </div>
      <ul className="bd-segLegend">
        {segments.map((x) => (
          <li key={x.key}>
            <i style={{ background: x.color }} aria-hidden="true" />
            <span className="bd-segName">{x.label}</span>
            <strong>{x.display ?? x.value.toLocaleString('en-US')}</strong>
            <span className="bd-segShare">{share(x.value)}</span>
          </li>
        ))}
      </ul>
      <ChartTip tip={t.tip} host={t.host} />
    </div>
  );
}

/** A tone as a mark colour, for a caller building its own series. */
export const toneColor = (tone: DashTone) => TONE_COLOR[tone];

/* ── insight cards ─────────────────────────────────────────────────────── */

export function InsightGrid({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <section className="bd-insightGrid" id={id}>
      {children}
    </section>
  );
}

export function DashBadge({ children }: { children: ReactNode }) {
  return <span className="bd-badge">{children}</span>;
}

/** A card tinted by its tone: a wash fading out down the card, and a solid
 *  icon tile that carries it. */
export function InsightCard({
  title,
  icon,
  tone = 'info',
  badge,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  tone?: DashTone;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="bd-insight" data-tone={tone}>
      <div className="bd-cardHead">
        <div className="bd-insightTitle">
          {icon && <span className="bd-insightIcon">{icon}</span>}
          <h3 className="bd-cardTitle">{title}</h3>
        </div>
        {badge && <DashBadge>{badge}</DashBadge>}
      </div>
      <div className="bd-insightBody">{children}</div>
    </article>
  );
}

export function InsightRow({
  icon,
  title,
  description,
  tone = 'neutral',
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: DashTone;
}) {
  return (
    <div className="bd-insightRow" data-tone={tone}>
      {icon && (
        <span className="bd-rowIcon" data-tone={tone}>
          {icon}
        </span>
      )}
      <div className="bd-rowText">
        <p className="bd-rowTitle">{title}</p>
        {description && <p className="bd-rowNote">{description}</p>}
      </div>
    </div>
  );
}

/** A label/value list with a rule between rows — TailAdmin's list card. */
export function ReadoutList({
  rows,
}: {
  rows: { id: string; label: ReactNode; value: ReactNode; tone?: DashTone }[];
}) {
  return (
    <div className="bd-readout">
      {rows.map((r) => (
        <div className="bd-readoutRow" key={r.id}>
          <span className="bd-readoutLabel">{r.label}</span>
          <span className="bd-readoutValue" data-tone={r.tone ?? 'neutral'}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
