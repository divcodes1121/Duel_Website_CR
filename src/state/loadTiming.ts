/**
 * How long each slow screen actually takes to load, remembered per browser.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. `fetch` reports no progress for these
 * calls — the analytics API answers with one JSON body at the end of a read
 * that can run 30-160 seconds, so there is no byte count to divide and no
 * server-side percentage to display. A progress bar therefore has exactly three
 * honest inputs: elapsed time, an expectation to measure it against, and the
 * moment the data lands.
 *
 * This module owns the middle one, and it MEASURES rather than guesses. Every
 * `ReadingState` records how long it was mounted for; the estimate is the
 * MEDIAN of the last few samples for that screen, so the second visit knows
 * what the first one cost. The seeds below are only what a cold browser starts
 * from, and they are the figures measured in the README, not invented ones.
 *
 * Median, not mean, because a sample is recorded on unmount and unmount also
 * happens when a read FAILS fast or the user navigates away mid-load. Those
 * land as short outliers, and a median of five ignores one or two of them where
 * a mean would drag the whole estimate down and make the bar sprint to 90% and
 * sit there.
 */

/** Matches the other persisted keys — see the note in README about why the
 *  `royal-` prefix stays even though the product is DEKKIES now. */
const STORE_KEY = 'royal-load-timing';

/** Samples kept per screen. Five is enough for a median to be stable and short
 *  enough that a genuinely slower machine is tracked within a session or two. */
const WINDOW = 5;

/**
 * Where a cold browser starts, in milliseconds.
 *
 * These are the measured figures the README records, not aspirations: the Coach
 * is 29-57 s over its two reads, a cold meta rollup is the longest wait in the
 * app, and the rest are ordinary reads off the same spinning volume. A key with
 * no seed falls back to `DEFAULT_SEED`.
 */
const SEEDS: Record<string, number> = {
  'coach-history': 40_000,
  'coach-matchups': 40_000,
  'meta-cold': 90_000,
  meta: 9_000,
  player: 14_000,
  'player-cards': 14_000,
  'duel-analysis': 14_000,
  'duel-zone': 14_000,
  'duel-insights': 14_000,
  'deck-counter': 16_000,
  'deck-lab': 12_000,
  'counter-lab': 16_000,
};

const DEFAULT_SEED = 12_000;

/** Anything outside this is not a load measurement worth keeping. */
const MIN_SAMPLE = 250;
const MAX_SAMPLE = 300_000;

type Samples = Record<string, number[]>;

/* localStorage throws outright in some contexts (a private window with site
   data blocked), so every access is guarded and simply falls back to the seed —
   a loader that cannot remember is still a loader. */
function read(): Samples {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Samples) : {};
  } catch {
    return {};
  }
}

function write(all: Samples): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* Full, blocked, or unavailable. The estimate degrades to the seed. */
  }
}

/** The expectation to measure this load against, in milliseconds. */
export function expectedDuration(key: string): number {
  const seed = SEEDS[key] ?? DEFAULT_SEED;
  const samples = read()[key];
  if (!Array.isArray(samples) || samples.length === 0) return seed;

  const clean = samples.filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= MIN_SAMPLE);
  if (clean.length === 0) return seed;

  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  /* Blended with the seed while there is little evidence, so ONE unlucky first
     read does not become the whole expectation. By the third sample the
     measurement carries it. */
  if (clean.length < 3) return Math.round((median + seed) / 2);
  return Math.round(median);
}

/** Record what a load actually cost. Called when a `ReadingState` unmounts. */
export function recordDuration(key: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < MIN_SAMPLE || ms > MAX_SAMPLE) return;
  const all = read();
  const samples = Array.isArray(all[key]) ? all[key] : [];
  all[key] = [...samples, Math.round(ms)].slice(-WINDOW);
  write(all);
}
