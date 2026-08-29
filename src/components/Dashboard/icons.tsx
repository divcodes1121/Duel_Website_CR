import { useId } from 'react';

/* Line icons for the dashboard shell. All 24x24, 1.8 stroke, currentColor, so
   they inherit the nav item's colour and need no per-theme handling. */

type P = { size?: number };

/**
 * A crown in struck gold — the one icon in this app that does not take
 * `currentColor`.
 *
 * Metal needs a highlight, a body and a shade; a flat `#FFD700` reads as yellow
 * plastic. That means a real gradient, which means an SVG `<linearGradient>`,
 * which means an id — and a fixed id would be duplicated the moment two crowns
 * are on screen, which is invalid and makes the second one inherit the first's
 * stops. `useId` gives each instance its own.
 *
 * The stops are CSS variables rather than literals, applied through `style` so
 * they resolve as properties: both themes step their own gold, and neither is
 * the other one dimmed.
 */
export function GoldCrownIcon({ size = 18 }: P) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--gold-bright)' }} />
          <stop offset="42%" style={{ stopColor: 'var(--gold)' }} />
          <stop offset="78%" style={{ stopColor: 'var(--gold-deep)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--gold)' }} />
        </linearGradient>
      </defs>
      <path
        d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"
        fill={`url(#${id})`}
        stroke="var(--gold-deep)"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const base = (size: number) => ({
  viewBox: '0 0 24 24',
  width: size,
  height: size,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function CrownIcon({ size = 18 }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

export function HomeIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </svg>
  );
}

export function AnalyticsIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 15v-3M12 15v-6M16 15v-4" />
    </svg>
  );
}

export function DeckIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="8" y="9" width="8" height="6" rx="1" />
    </svg>
  );
}

export function SwordsIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M9.5 6.5 21 18v3h-3L6.5 9.5" />
    </svg>
  );
}

/* Three stacked decks — a duel loadout is three decks, which is what the Duel
   Zone is about. Deliberately not the swords: those are Duel Analysis, and two
   sidebar rows wearing one glyph is two rows that look like the same thing. */
export function LoadoutIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="8" height="11" rx="1.5" />
      <path d="M13 6h3.5a1.5 1.5 0 0 1 1.5 1.5V17" />
      <path d="M16.5 9H19a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5H9" />
    </svg>
  );
}

export function InfoIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function SearchIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/* A log with a time marker — a list of things that happened, in order.
   Deliberately not the bars (that is the meta ranking) and not the swords
   (Duel Analysis): this row lists battles rather than measuring them. */
export function LogIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 5h16M4 12h16M4 19h9" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

export function BarsIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  );
}

export function PieIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3z" />
    </svg>
  );
}

export function ShieldIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" />
    </svg>
  );
}

/* A coach's whistle — the one object that reads as "someone calling the play"
   at 17px without needing a face or a clipboard's fine detail. */
export function CoachIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M13.5 8.5h6.2a1.3 1.3 0 0 1 1.3 1.3v1.4a1.3 1.3 0 0 1-1.3 1.3H13.5" />
      <circle cx="8.5" cy="12.5" r="5" />
      <path d="M11 6.2 14.6 4" />
    </svg>
  );
}

export function TargetIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function CardsIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="3" width="12" height="17" rx="2" />
      <path d="M4 6v12a2 2 0 0 0 2 2" />
    </svg>
  );
}

export function EvolutionIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M5 15l7-7 7 7" />
      <path d="M5 20l7-7 7 7" />
    </svg>
  );
}

export function TrendIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function SunIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function BellIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10.5 19a2 2 0 0 0 3 0" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** A single chevron. Points left to collapse the rail, right to bring it back —
 *  the direction IS the affordance, so it flips with the state. */
export function ChevronLeftIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}

export function PaletteIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}

/* Two figures side by side — the roster icon. Stroked like its neighbours, so
   the dock's filled single-path twin lives in `dockIcons.tsx` instead. */
export function TeamIcon({ size = 17 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h2a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M15.5 14h1a4 4 0 0 1 4 4v2" />
    </svg>
  );
}

export function StarIcon({ size = 14 }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.3 9.4l6.1-.8z" />
    </svg>
  );
}
