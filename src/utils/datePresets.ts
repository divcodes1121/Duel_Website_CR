/**
 * THE DAY WINDOWS EVERY DATE FILTER OFFERS — one list, read everywhere.
 *
 * NO IMPORTS, like `tiers.ts`, `format.ts` and `pageWindow.ts`, so the set can
 * be tested without constructing a store or a Supabase client.
 *
 * WHY ONE LIST. Before this there were three and they disagreed: the analytics
 * screens offered 7/14/30/60/90 (`RANGE_PRESETS`), Coach Assist offered
 * 15/30/45/60, and the Coach Roster 7/30/90. A coach moving from the public
 * Coach Assist into the roster lost the 15- and 45-day windows they had just
 * been using, and the 2v2 Team Analysis had no window at all. The account
 * holder asked for 7, 15, 30, 45, 60 and 90 on every date filter (2026-09-21);
 * a single source is what keeps that true after the next person adds a screen.
 *
 * WHAT A SCREEN ADDS ON TOP IS ITS OWN BUSINESS. The analytics screens keep
 * "All Data" and "Custom…", and the Coach Roster keeps "All". Those are
 * different kinds of control — a span with no end, a hand-picked range — and
 * nothing asked for them to go.
 *
 * Every `days` value the server takes is clamped to 1..4000
 * (`app._window`, the `/teams` route), so none of these needs a server change.
 */
export const DAY_PRESETS = [7, 15, 30, 45, 60, 90] as const;

export type DayPreset = (typeof DAY_PRESETS)[number];

/** The window a screen opens on when nothing has been chosen. */
export const DEFAULT_DAYS: DayPreset = 30;

/** "Last 15 Days" — the long form the analytics screens' menus print. */
export function dayLabel(days: number): string {
  return `Last ${days} Days`;
}

/** "15d" — the chip form the coach screens print. */
export function dayChip(days: number): string {
  return `${days}d`;
}
