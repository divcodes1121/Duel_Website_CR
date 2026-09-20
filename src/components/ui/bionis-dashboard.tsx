/**
 * BIONIS DASHBOARD — the layout, ported by hand.
 *
 * Source: the `bionis-dashboard` composition (watermelon.sh house style —
 * greeting header with a period picker, a hero score, a key-metric grid, two
 * chart cards, three tinted insight cards). **It is NOT in the public
 * registry**: `registry.watermelon.sh/r/bionis-dashboard.json` answers 404
 * with the site's HTML shell, so `npx shadcn@latest add` cannot install it
 * and would fail on a JSON parse. This port is from the source we were
 * handed.
 *
 * DEVIATIONS FROM THE SOURCE — all of them, so the next reader can diff:
 *
 *  1. **NO TAILWIND.** This project has no `tailwindcss`, no
 *     `components.json`, no `postcss.config` and no `@` alias. Every utility
 *     class in the original (`flex flex-col gap-8`, `size-7`, `text-(--x)`,
 *     `bg-[linear-gradient(...)]`) is a rule in `bionis-dashboard.css`,
 *     prefix-scoped `bd-` the way `glass-dock` and `footer-5` are.
 *  2. **NO shadcn primitives.** `@/components/ui/button` and
 *     `@/components/ui/dropdown-menu` do not exist here, and installing them
 *     would pull Tailwind, `lucide-react`, `next-themes` and radix. The
 *     period picker is NOT built in — the header takes a `control` slot, and
 *     callers pass `ui/dropdown-menu-14`, which is this project's ONE
 *     select-style dropdown.
 *  3. **NO RECHARTS.** The original's `SleepBreakdownChart` /
 *     `ActivityTrendChart` are a charting library away. These are hand-drawn
 *     SVG, the idiom `Admin/CoachRoster/IntelCharts.tsx` already uses, and
 *     they are bar charts over named categories rather than a time axis —
 *     a time axis would have to be invented for data that has none.
 *  4. **COLOUR COMES FROM THE THEME TOKENS**, not the template's
 *     `--vital-good` / `--chart-warn` / `--insight-prediction` literals. Tone
 *     is a `data-tone` attribute, resolved in CSS, so one component serves
 *     both themes with no `[data-theme]` branch in the TSX. Glow is gated on
 *     `--glow-core`/`--glow-halo`, which are 0% on light — this project's
 *     standing rule that glow is a dark-mode affordance.
 *  5. **NO HEALTH CONTENT.** Wellness scores, sleep, vitals, heartbeat and
 *     "health predictions" are the template's subject, not a layout. Nothing
 *     here knows what it is drawing.
 *  6. **`ScoreDonut` TAKES ITS OWN CAPTION AND IS NOT CALLED A SCORE.** The
 *     original's centrepiece is an "Overall Wellness" number out of 100. On
 *     the Coach Roster that would be a readiness score, which the roster
 *     overview's contract forbids by name. It is used here only for a
 *     PROPORTION OF A COUNT that the caller can state in words, and the
 *     caption is required for exactly that reason.
 *  7. No greeting clock. `useGreeting` reads `new Date().getHours()` and
 *     renames the screen three times a day; the caller passes a title.
 */

import type { ReactNode } from 'react';

import { cn } from './cn';
import './bionis-dashboard.css';

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

/** The hero band: a heading, a badge, a sentence, and a figure on the right. */
export function DashHero({
  heading,
  badge,
  badgeTone = 'good',
  children,
  figure,
}: {
  heading: ReactNode;
  badge?: ReactNode;
  badgeTone?: DashTone;
  children?: ReactNode;
  figure?: ReactNode;
}) {
  return (
    <section className="bd-hero">
      <div className="bd-heroText">
        <h2 className="bd-heroHeading">{heading}</h2>
        <div className="bd-heroBody">
          {badge && (
            <span className="bd-heroBadge" data-tone={badgeTone}>
              {badge}
            </span>
          )}
          {children && <p className="bd-heroCopy">{children}</p>}
        </div>
      </div>
      {figure && <div className="bd-heroFigure">{figure}</div>}
    </section>
  );
}

/* ── the ring ──────────────────────────────────────────────────────────── */

/**
 * A ring filled to `value / max`.
 *
 * **`caption` IS REQUIRED.** A bare number in a ring reads as a score out of
 * a hundred, and on at least one screen using this component a score is the
 * one thing that must not appear. The caption is where the caller says what
 * the proportion is a proportion OF.
 */
export function ScoreDonut({
  value,
  max = 100,
  display,
  caption,
  tone = 'info',
  size = 168,
}: {
  value: number;
  max?: number;
  /** What to print in the middle. Defaults to the rounded percentage. */
  display?: ReactNode;
  caption: ReactNode;
  tone?: DashTone;
  size?: number;
}) {
  const safeMax = max > 0 ? max : 1;
  const share = Math.max(0, Math.min(1, value / safeMax));
  const r = 54;
  const circumference = 2 * Math.PI * r;

  return (
    <figure className="bd-donut" style={{ width: size }} data-tone={tone}>
      <svg viewBox="0 0 128 128" className="bd-donutSvg" role="img" aria-label={`${Math.round(share * 100)}%`}>
        <circle className="bd-donutTrack" cx="64" cy="64" r={r} />
        <circle
          className="bd-donutFill"
          cx="64"
          cy="64"
          r={r}
          /* Dash then gap, rotated so it starts at twelve o'clock. A zero
             share must draw nothing, not a dot: a round cap on a zero-length
             dash still paints. */
          strokeDasharray={`${circumference * share} ${circumference}`}
          strokeLinecap={share > 0.01 ? 'round' : 'butt'}
          transform="rotate(-90 64 64)"
        />
        <text className="bd-donutValue" x="64" y="64" textAnchor="middle" dominantBaseline="central">
          {display ?? `${Math.round(share * 100)}%`}
        </text>
      </svg>
      <figcaption className="bd-donutCaption">{caption}</figcaption>
    </figure>
  );
}

/* ── metric cards ──────────────────────────────────────────────────────── */

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="bd-metricGrid">{children}</div>;
}

export function KeyMetricCard({
  label,
  value,
  note,
  delta,
  tone = 'neutral',
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  /** A short comparison in words. Not computed here — the caller owns what
   *  it is compared against, and an unlabelled delta is unreadable. */
  delta?: ReactNode;
  tone?: DashTone;
  icon?: ReactNode;
}) {
  return (
    <article className="bd-metric" data-tone={tone}>
      <div className="bd-metricHead">
        {icon && <span className="bd-metricIcon">{icon}</span>}
        <span className="bd-metricLabel">{label}</span>
      </div>
      <strong className="bd-metricValue">{value}</strong>
      {delta && <span className="bd-metricDelta">{delta}</span>}
      {note && <span className="bd-metricNote">{note}</span>}
    </article>
  );
}

/* ── chart cards ───────────────────────────────────────────────────────── */

export function ChartGrid({ children }: { children: ReactNode }) {
  return <section className="bd-chartGrid">{children}</section>;
}

export function ChartCard({
  title,
  note,
  badge,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="bd-chartCard">
      <div className="bd-cardHead">
        <div className="bd-cardHeadText">
          <h3 className="bd-cardTitle">{title}</h3>
          {note && <p className="bd-cardNote">{note}</p>}
        </div>
        {badge && <DashBadge>{badge}</DashBadge>}
      </div>
      <div className="bd-chartBody">{children}</div>
    </article>
  );
}

export interface Bar {
  label: string;
  value: number;
  tone?: DashTone;
  /** Printed at the end of the row instead of the bare value. */
  display?: string;
}

/**
 * Horizontal labelled bars.
 *
 * The width is a share of the LARGEST bar unless `max` is given — with a
 * caller-supplied max the bars are a share of a real total and the reader can
 * compare them against it. `Math.min(100, …)` because a value above the max
 * would otherwise lay out wider than its track and be silently clipped (the
 * same fault `ShareBars` had in the scout).
 */
export function BarRows({ bars, max, empty = 'Nothing to show yet.' }: { bars: Bar[]; max?: number; empty?: string }) {
  const ceiling = max ?? Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0) return <p className="bd-empty">{empty}</p>;
  return (
    <ul className="bd-bars">
      {bars.map((b) => (
        <li className="bd-bar" key={b.label}>
          <span className="bd-barLabel">{b.label}</span>
          <span className="bd-barTrack">
            <span
              className="bd-barFill"
              data-tone={b.tone ?? 'info'}
              style={{ width: `${Math.min(100, (b.value / (ceiling || 1)) * 100)}%` }}
            />
          </span>
          <span className="bd-barValue">{b.display ?? b.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars over named categories — the shape of the template's
 *  breakdown chart, without pretending to a time axis. */
export function ColumnChart({ bars, max, empty = 'Nothing to show yet.' }: { bars: Bar[]; max?: number; empty?: string }) {
  const ceiling = max ?? Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0) return <p className="bd-empty">{empty}</p>;
  return (
    <ul className="bd-columns">
      {bars.map((b) => (
        <li className="bd-column" key={b.label}>
          <span className="bd-columnValue">{b.display ?? b.value}</span>
          <span className="bd-columnTrack">
            <span
              className="bd-columnFill"
              data-tone={b.tone ?? 'info'}
              data-empty={b.value === 0 || undefined}
              style={{ height: `${Math.min(100, (b.value / (ceiling || 1)) * 100)}%` }}
            />
          </span>
          <span className="bd-columnLabel">{b.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── insight cards ─────────────────────────────────────────────────────── */

export function InsightGrid({ children }: { children: ReactNode }) {
  return <section className="bd-insightGrid">{children}</section>;
}

export function DashBadge({ children }: { children: ReactNode }) {
  return <span className="bd-badge">{children}</span>;
}

/** One of the three tinted cards. The tint is a wash of the tone's hue
 *  fading out by 42%, as in the source; the icon tile carries the solid. */
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
    <div className="bd-insightRow">
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

/** The flat label/value list the source uses for its vitals panel. */
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
