/**
 * The arithmetic behind the player screen's two trend charts and its Trend
 * column. No imports, so every rule here is testable on its own.
 *
 * ── A DAY THE DECK WAS NOT PLAYED IS NOT A 0% WIN RATE ──────────────────
 *
 * The server's daily series (`clash_data.py`, the `trends` block) writes
 * `0.0` for the win rate on a day a deck had no games, because a JSON number
 * is what the field holds. Plotted as a value, every line dived to the axis
 * between sessions, and the Trend column averaged those zeros in — so a deck
 * simply played less often in the last third of the window read as getting
 * WORSE. The PDF already drew those days as gaps; the screen did not, so the
 * export and the page disagreed about the same player.
 *
 * The use series is the tell: a day with 0% use is a day with no games, and
 * only then. A day the deck WAS played and lost every game has a use above
 * zero and keeps its honest 0%.
 *
 * The use series itself is left alone. 0% use on a day with no games is true.
 */

/** A win-rate series with the unplayed days turned into gaps (`null`).
 *  `games`, when the server sends it, is the exact test; `use` is the
 *  fallback for an older API and says the same thing (0% use = no games). */
export function gapUnplayed(
  win: readonly number[],
  use: readonly number[],
  games?: readonly number[],
): (number | null)[] {
  return win.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    const played = games ? games[i] > 0 : use[i] > 0;
    return played ? v : null;
  });
}

/**
 * Played days each half needs before the Trend column compares them. Two,
 * because one day can be a single game, and one game against one game is a
 * coin toss printed as a trend.
 */
export const TREND_MIN_DAYS = 2;

/**
 * Games each half needs when the server sends per-day game counts. The same
 * five as `DECK_RATE_FLOOR` in `state/coachScout.ts` — the site's floor for
 * printing a deck's rate at all — and a test holds the two together. This
 * module takes no imports, so it is restated rather than imported.
 */
export const TREND_MIN_GAMES = 5;

/**
 * Win-rate change for one deck, in percentage points: the mean of the LATER
 * half of the days it was played minus the mean of the EARLIER half. `null`
 * when it was played on fewer than `2 * TREND_MIN_DAYS` days, because there is
 * nothing honest to compare. An odd middle day is left out of both halves.
 *
 * HALVES OF ITS OWN PLAYED DAYS, NOT THIRDS OF THE WINDOW, and that was
 * measured (2026-09-28, five real players, 30-day window). Players rotate
 * decks, so most top-10 decks are not played at both ends of a window: a
 * first-third-against-last-third rule on played days withheld 4 to 9 of 10
 * decks per player. Halves of the deck's own days withheld 0 to 2, and only
 * decks played on one to three days in total.
 *
 * What the old column did instead is the reason this module exists: it
 * averaged the unplayed days in as zeros and printed ▼ 83.2 and ▼ 68.2 for two
 * decks the same player was winning 87.9% and 87.8% with. The halves rule
 * gives ▲ 2.7 and ▲ 1.3 for them.
 *
 * Days, not games: the payload carries each day's rate but not its game count,
 * so a day with one game counts as much as a day with ten. The chart above the
 * table has the same limitation, and the column now agrees with the chart
 * rather than with a series of invented zeros.
 */
export function trendOf(
  points: readonly (number | null)[],
  games?: readonly number[],
  minDays = TREND_MIN_DAYS,
): number | null {
  const played: { rate: number; n: number }[] = [];
  points.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    played.push({ rate: v, n: games ? games[i] ?? 0 : 1 });
  });
  if (played.length < 2 * minDays) return null;
  const half = Math.floor(played.length / 2);
  const earlier = played.slice(0, half);
  const later = played.slice(played.length - half);
  // WITH GAME COUNTS, EACH HALF IS ITS POOLED WIN RATE — the wins over the
  // games — and a half under TREND_MIN_GAMES is withheld. Without them (an
  // API not yet redeployed) each played day counts once, as described above.
  const rate = (xs: typeof played) => {
    const n = xs.reduce((a, x) => a + x.n, 0);
    return n ? xs.reduce((a, x) => a + x.rate * x.n, 0) / n : 0;
  };
  if (games) {
    const g = (xs: typeof played) => xs.reduce((a, x) => a + x.n, 0);
    if (g(earlier) < TREND_MIN_GAMES || g(later) < TREND_MIN_GAMES) return null;
  }
  return Number((rate(later) - rate(earlier)).toFixed(1));
}

/**
 * The folded "Other" line: the mean of the series that have a value on each
 * day, and a gap where none of them do. Averaging a gap in as zero would put
 * back exactly the fault `gapUnplayed` removes.
 */
export function foldMean(series: readonly (readonly (number | null)[])[]): (number | null)[] {
  const n = series[0]?.length ?? 0;
  return Array.from({ length: n }, (_, i) => {
    const vals = series
      .map((s) => s[i])
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  });
}

/**
 * A label per deck that tells same-named decks apart.
 *
 * Deck names are generated from the archetype and collide constantly — one
 * player's legend read Giant, Giant, Royal Hogs, Royal Hogs, Royal Hogs, and
 * this project already decided that a deck is its cards, never its name. A
 * deck whose name is unique keeps it. One that shares it gets the first card,
 * in seated order, that no other deck of that name runs ("Royal Hogs + Fire
 * Spirit"). When every card it has appears in one of the others, it falls back
 * to its position among them ("Royal Hogs #2"), which is unique by
 * construction.
 */
export function distinctDeckLabels(
  decks: readonly { name: string; cards: readonly string[] }[],
  cardName: (key: string) => string,
): string[] {
  const groups = new Map<string, number[]>();
  decks.forEach((d, i) => groups.set(d.name, [...(groups.get(d.name) ?? []), i]));
  return decks.map((d, i) => {
    const group = groups.get(d.name) ?? [i];
    if (group.length < 2) return d.name;
    const others = group.filter((j) => j !== i).map((j) => new Set(decks[j].cards));
    const tell = d.cards.find((c) => others.every((o) => !o.has(c)));
    return tell ? `${d.name} + ${cardName(tell)}` : `${d.name} #${group.indexOf(i) + 1}`;
  });
}
