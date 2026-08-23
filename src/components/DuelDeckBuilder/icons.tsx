/**
 * The deck panel's action rail.
 *
 * The header used to carry five text buttons ("Open in Game", "Copy Link",
 * "Import", "Rename", "Clear") which is most of a deck panel's width — and the
 * width is what the two-column workspace needs back, since the eight card slots
 * are now competing with the card library for the same row. Icons buy it: the
 * label survives as `title` + `aria-label`, and the one genuinely primary
 * action keeps its words in the footer.
 *
 * Stroke icons on a 24 grid, `currentColor` throughout, so a button colours its
 * own glyph by setting `color` — which is how the destructive one goes red
 * without a second copy of the path.
 */

interface P {
  size?: number;
}

function Svg({ size = 15, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Open in Clash Royale — a box with an arrow leaving it. */
export function LaunchIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </Svg>
  );
}

/** Copy the share link — two chain segments. */
export function LinkIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M10 13a4 4 0 0 0 5.7.4l3-3A4 4 0 0 0 13 4.7l-1.7 1.7" />
      <path d="M14 11a4 4 0 0 0-5.7-.4l-3 3A4 4 0 0 0 11 19.3l1.7-1.7" />
    </Svg>
  );
}

/** Paste a deck link in — an arrow landing in a tray. */
export function ImportIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </Svg>
  );
}

export function RenameIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  );
}

/** Clear the deck — an eraser sweeping a line. */
export function ClearIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M8.5 19H20" />
      <path d="M13 5.5l5.5 5.5-6 6H8l-3.5-3.5a1.4 1.4 0 0 1 0-2L13 5.5z" />
    </Svg>
  );
}

export function TrashIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    </Svg>
  );
}

export function PlusIcon({ size = 18 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function MinusIcon({ size = 18 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function CheckIcon({ size }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Svg>
  );
}

export function CloseIcon({ size = 14 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Svg>
  );
}

/** Average elixir — the in-game drop, outlined rather than filled purple. */
export function ElixirIcon({ size = 14 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M12 3.5c3.2 3.6 5.5 6.4 5.5 9.1a5.5 5.5 0 0 1-11 0c0-2.7 2.3-5.5 5.5-9.1z" />
    </Svg>
  );
}

/** Cycle cost — the four cheapest cards coming back around. */
export function CycleIcon({ size = 14 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </Svg>
  );
}

export function SearchIcon({ size = 15 }: P = {}) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 14 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function LayersIcon({ size = 15 }: P = {}) {
  return (
    <Svg size={size}>
      <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" />
      <path d="M4 12.5L12 17l8-4.5" />
      <path d="M4 16.8L12 21.3l8-4.5" />
    </Svg>
  );
}
