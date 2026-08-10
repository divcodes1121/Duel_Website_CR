/**
 * Shapes for the player-analysis screen, plus a placeholder set.
 *
 * Nothing here talks to a database yet. The SQLite import will replace
 * `SAMPLE_*` with real rows; these types are the contract it has to satisfy, so
 * the screen does not change when the data becomes real.
 */

export interface PlayerSummary {
  name: string;
  tag: string;
  verified: boolean;
  trophies: number;
  battlesAnalyzed: number;
  /** Inclusive window the stats cover. */
  rangeStart: string;
  rangeEnd: string;
  rangeDays: number;
  globalRank: number;
}

export interface DeckRow {
  rank: number;
  name: string;
  /** Eight card keys, resolved through data/cards for the art. */
  cards: string[];
  useRate: number;
  winRate: number;
  matches: number;
  wins: number;
  losses: number;
  /** Percentage-point change over the window; negative is a decline. */
  trend: number;
}

/** One line on a trend chart. */
export interface Series {
  label: string;
  points: number[];
}

export interface TrendData {
  /** x-axis tick labels, one per point index that should be labelled. */
  ticks: { at: number; label: string }[];
  series: Series[];
}

export type DeckSort = 'top' | 'recent' | 'winrate';

export const DECK_SORTS: { id: DeckSort; label: string }[] = [
  { id: 'top', label: 'Top 10' },
  { id: 'recent', label: 'Most Recent' },
  { id: 'winrate', label: 'Highest Win Rate' },
];

/* Clash Royale seasons run a calendar month. 'Current' is the month the latest
   stored battle falls in — not today's month, or a player who stopped playing
   would get an empty screen. */
export const SEASONS = ['Current Season', 'Last Season', 'All Time'] as const;
export type Season = (typeof SEASONS)[number];

export function seasonWindow(season: Season, coverageEnd: string | null): { from?: string; to?: string } {
  if (!coverageEnd || season === 'All Time') return {};
  const end = new Date(coverageEnd + 'T00:00:00Z');
  const y = end.getUTCFullYear();
  const m = end.getUTCMonth();
  const shift = season === 'Last Season' ? -1 : 0;
  const first = new Date(Date.UTC(y, m + shift, 1));
  const last = new Date(Date.UTC(y, m + shift + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: season === 'Last Season' ? iso(last) : coverageEnd };
}
/* Presets, plus 'Custom' which reveals the two date fields. The list is
   filtered against real coverage at render time — offering 90 days when the
   databases hold 50 is just a way to show an empty chart. */
export const RANGE_PRESETS = [
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 14 Days', days: 14 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 60 Days', days: 60 },
  { label: 'Last 90 Days', days: 90 },
  { label: 'All Data', days: 0 },
  { label: 'Custom…', days: -1 },
] as const;

/* ----------------------------------------------------------- placeholder */

export const SAMPLE_PLAYER: PlayerSummary = {
  name: 'Mohamed Light',
  tag: '#QJ2L9V8R',
  verified: true,
  trophies: 9001,
  battlesAnalyzed: 1284,
  rangeStart: 'May 10',
  rangeEnd: 'Jun 10, 2025',
  rangeDays: 31,
  globalRank: 2311,
};

export const SAMPLE_DECKS: DeckRow[] = [
  { rank: 1, name: 'P.E.K.K.A Bridge Spam', cards: ['pekka', 'bandit', 'royal-ghost', 'battle-ram', 'electro-wizard', 'zap', 'poison', 'magic-archer'], useRate: 18.7, winRate: 62.4, matches: 240, wins: 149, losses: 91, trend: 2.1 },
  { rank: 2, name: 'Royal Giant Deck', cards: ['royal-giant', 'fisherman', 'hunter', 'electro-spirit', 'lightning', 'barbarian-barrel', 'skeletons', 'mother-witch'], useRate: 14.3, winRate: 59.8, matches: 183, wins: 109, losses: 74, trend: -1.4 },
  { rank: 3, name: 'Hog Cycle', cards: ['hog-rider', 'ice-spirit', 'skeletons', 'cannon', 'musketeer', 'ice-golem', 'fireball', 'the-log'], useRate: 11.6, winRate: 61.2, matches: 149, wins: 91, losses: 58, trend: 0.7 },
  { rank: 4, name: 'Logbait', cards: ['goblin-barrel', 'princess', 'knight', 'ice-spirit', 'goblin-gang', 'inferno-tower', 'rocket', 'the-log'], useRate: 8.9, winRate: 58.6, matches: 114, wins: 67, losses: 47, trend: -0.9 },
  { rank: 5, name: 'Golem Beatdown', cards: ['golem', 'baby-dragon', 'night-witch', 'lumberjack', 'mega-minion', 'tornado', 'lightning', 'barbarian-barrel'], useRate: 6.8, winRate: 56.1, matches: 87, wins: 49, losses: 38, trend: -2.3 },
  { rank: 6, name: 'X-Bow Control', cards: ['x-bow', 'tesla', 'archers', 'knight', 'ice-spirit', 'skeletons', 'fireball', 'the-log'], useRate: 5.1, winRate: 55.7, matches: 66, wins: 37, losses: 29, trend: 1.0 },
  { rank: 7, name: 'Graveyard', cards: ['graveyard', 'knight', 'baby-dragon', 'bowler', 'tornado', 'barbarian-barrel', 'poison', 'archers'], useRate: 3.6, winRate: 54.6, matches: 46, wins: 25, losses: 21, trend: -0.2 },
  { rank: 8, name: 'Mortar Cycle', cards: ['mortar', 'knight', 'archers', 'ice-spirit', 'skeletons', 'goblins', 'fireball', 'the-log'], useRate: 3.6, winRate: 55.1, matches: 46, wins: 25, losses: 21, trend: 0.5 },
  { rank: 9, name: 'Lava Hound', cards: ['lava-hound', 'balloon', 'minions', 'mega-minion', 'guards', 'tombstone', 'fireball', 'zap'], useRate: 2.7, winRate: 53.8, matches: 35, wins: 19, losses: 16, trend: -1.1 },
  { rank: 10, name: 'Miner Control', cards: ['miner', 'poison', 'bats', 'skeletons', 'ice-spirit', 'valkyrie', 'inferno-tower', 'the-log'], useRate: 2.0, winRate: 53.3, matches: 26, wins: 14, losses: 12, trend: 0.3 },
];

/** Deterministic wobble, so the placeholder does not reshuffle every render. */
function walk(seed: number, base: number, spread: number, n: number): number[] {
  const out: number[] = [];
  let v = base;
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v += ((s / 2147483648) - 0.5) * spread;
    v = Math.max(0.4, v);
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

const DAYS = 30;

const TICKS = [
  { at: 1, label: 'May 12' },
  { at: 8, label: 'May 19' },
  { at: 15, label: 'May 26' },
  { at: 22, label: 'Jun 02' },
  { at: 29, label: 'Jun 09' },
];

export const SAMPLE_USE_TREND: TrendData = {
  ticks: TICKS,
  series: SAMPLE_DECKS.map((d, i) => ({
    label: d.name,
    points: walk(i * 977 + 13, d.useRate, 1.1, DAYS),
  })),
};

export const SAMPLE_WIN_TREND: TrendData = {
  ticks: TICKS,
  series: SAMPLE_DECKS.map((d, i) => ({
    label: d.name,
    points: walk(i * 613 + 71, d.winRate, 2.4, DAYS),
  })),
};
