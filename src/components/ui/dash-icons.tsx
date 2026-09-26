/* Line icons for the dashboard shell and its three screens (console, coach
   roster, the player's own page). Same contract as `Dashboard/icons.tsx`:
   24x24, 1.8 stroke, `currentColor`, so an icon takes its nav item's colour —
   including the violet of the current item — with no per-theme handling. */

type P = { size?: number };

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

export function GridIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

/** The tracking queue: a radar sweep over rings. */
export function RadarIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18 6" />
      <circle cx="16.2" cy="15.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DatabaseIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6.5c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V5.5" />
      <path d="M4.5 12v6.5c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V12" />
    </svg>
  );
}

export function DiskIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M5.2 13 8 5h8l2.8 8" />
      <path d="M7 16.5h.01M10 16.5h.01" />
    </svg>
  );
}

export function LayersIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5z" />
      <path d="M3 12.2l9 4.5 9-4.5" />
      <path d="M3 16.4l9 4.5 9-4.5" />
    </svg>
  );
}

export function UsersIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.8 20c.6-3.4 3.1-5.5 6.2-5.5s5.6 2.1 6.2 5.5" />
      <path d="M16 4.8a3.4 3.4 0 0 1 0 6.4M18.2 14.8c1.7.8 2.8 2.6 3.1 5.2" />
    </svg>
  );
}

export function RefreshIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3.5V8h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20.5V16h-4.5" />
    </svg>
  );
}

/** Minimise: the panel folds to its rail. */
export function PanelCloseIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
      <path d="M16 9.5 13.5 12l2.5 2.5" />
    </svg>
  );
}

/** Expand: the rail opens back to the full panel. */
export function PanelOpenIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
      <path d="M13.5 9.5 16 12l-2.5 2.5" />
    </svg>
  );
}

export function XIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function MenuIcon({ size = 20 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" />
    </svg>
  );
}

export function TableIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18M3 14.5h18M9.5 9.5v10" />
    </svg>
  );
}

export function ChartIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 14 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  );
}

export function AlertIcon({ size = 14 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 4 21 19.5H3L12 4z" />
      <path d="M12 10v4.2M12 17h.01" />
    </svg>
  );
}

export function XCircleIcon({ size = 14 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </svg>
  );
}

export function ClockIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ServerIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="4" width="17" height="7" rx="2" />
      <rect x="3.5" y="13" width="17" height="7" rx="2" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </svg>
  );
}

export function ArchiveIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

export function BoltIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M13 3 5 13.5h6L10.5 21 19 10.5h-6L13 3z" />
    </svg>
  );
}
