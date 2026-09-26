/**
 * WHERE A QUEUED TAG CAME FROM, for the console's Tracking view.
 *
 * No imports, so every rule here is testable without React or a network (the
 * `tiers.ts` rule). The server reports the raw `source` each route wrote into
 * the queue (`_note_tag(tag, "duels")` and so on); thirteen of them is too many
 * colours for one chart, so they are folded into six FAMILIES that each take a
 * categorical slot, in the validated order, plus a neutral "Other".
 *
 * COLOUR FOLLOWS THE FAMILY, NEVER ITS RANK. A family keeps its slot whether
 * or not the others are present, so filtering a window never repaints what is
 * left (the dataviz skill's non-negotiable).
 */

export type SourceFamily = 'search' | 'screens' | 'coach' | 'leaderboard' | 'duo' | 'opponent' | 'direct';

export interface FamilyDef {
  id: SourceFamily;
  label: string;
  color: string;
  /** What it covers, for a legend's title and the table. */
  note: string;
}

export const FAMILIES: readonly FamilyDef[] = [
  { id: 'search', label: 'Player search', color: 'var(--chart-1)', note: 'the search box, a player link, a tag saved on a profile' },
  { id: 'screens', label: 'Analytics screens', color: 'var(--chart-2)', note: 'Duel Analysis, Duel Zone, Recent Battles, Cards, Deck Counter' },
  { id: 'coach', label: 'Coach & teams', color: 'var(--chart-3)', note: 'Coach Assist, Coach Roster, Team Analysis' },
  { id: 'leaderboard', label: 'Leaderboard', color: 'var(--chart-4)', note: 'the recruiter reading the ranked top 2,000' },
  { id: 'duo', label: '2v2', color: 'var(--chart-5)', note: 'players promoted from the 2v2 population' },
  { id: 'opponent', label: 'Opponents', color: 'var(--chart-6)', note: 'opponents met by tracked players' },
  {
    id: 'direct',
    label: 'Other',
    color: 'var(--chart-other)',
    note: 'no queue record — enrolled by the bot directly, or before 26 Sep 2026, when the queue began keeping its history',
  },
];

/** The families somebody asked for on the site — a search, a screen, a coach
 *  tool — as against the recruiter's bulk runs and enrolments with no queue
 *  record. The Tracking view's "Asked on the site" tab draws only these. */
export const SITE_FAMILY_IDS: readonly SourceFamily[] = ['search', 'screens', 'coach'];
export const SITE_FAMILIES: ReadonlySet<SourceFamily> = new Set(SITE_FAMILY_IDS);

const FAMILY_OF: Readonly<Record<string, SourceFamily>> = {
  search: 'search',
  track: 'search',
  live: 'search',
  duels: 'screens',
  duelzone: 'screens',
  battles: 'screens',
  cards: 'screens',
  counter: 'screens',
  coverage: 'screens',
  coach: 'coach',
  roster: 'coach',
  team: 'coach',
  teams: 'coach',
  leaderboard: 'leaderboard',
  '2v2': 'duo',
  opponent: 'opponent',
  direct: 'direct',
};

/** A raw source's family. Anything unrecognised is "Other", never guessed. */
export function familyOf(source: string | null | undefined): SourceFamily {
  return FAMILY_OF[(source ?? '').toLowerCase()] ?? 'direct';
}

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  search: 'Player search',
  track: 'Profile tag',
  live: 'Live battlelog',
  duels: 'Duel Analysis',
  duelzone: 'Duel Zone',
  battles: 'Recent Battles',
  cards: 'Cards',
  counter: 'Deck Counter',
  coverage: 'Coverage',
  coach: 'Coach Assist',
  roster: 'Coach Roster',
  team: 'Team Analysis',
  leaderboard: 'Leaderboard',
  '2v2': '2v2',
  opponent: 'Opponents',
  direct: 'No queue record',
  unknown: 'Unknown',
};

/** The screen a raw source names, for the requests table. */
export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

export interface DailyAdded {
  day: string;
  bySource: Record<string, number>;
}

/**
 * The bot's additions as one row per day, oldest first, every family a column
 * — with the empty days filled, because a chart that skips them closes the
 * gaps and draws a week as three days. `today` is the UTC day the server's
 * window ends on; the window is `days` whole days ending there.
 */
export function dailyStack(daily: readonly DailyAdded[], days: number, today: string): Record<string, string | number>[] {
  const byDay = new Map(daily.map((d) => [d.day, d.bySource]));
  const end = Date.parse(`${today}T00:00:00Z`);
  const out: Record<string, string | number>[] = [];
  if (Number.isNaN(end) || days < 1) return out;
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    const row: Record<string, string | number> = { x: day };
    for (const f of FAMILIES) row[f.id] = 0;
    for (const [src, n] of Object.entries(byDay.get(day) ?? {})) {
      const f = familyOf(src);
      row[f] = (row[f] as number) + n;
    }
    out.push(row);
  }
  return out;
}

/** Totals per family across the whole stack. */
export function familyTotals(rows: readonly Record<string, string | number>[]): Record<SourceFamily, number> {
  const out = Object.fromEntries(FAMILIES.map((f) => [f.id, 0])) as Record<SourceFamily, number>;
  for (const r of rows) for (const f of FAMILIES) out[f.id] += Number(r[f.id]) || 0;
  return out;
}

/** A wait in words: "under a minute", "58 min", "2 h 5 min", "3 d 4 h". */
export function formatWait(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return 'under a minute';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h} h ${mm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}

/** "26 Sep" from `2026-09-26`, in UTC so a day never slides by a timezone. */
export function shortDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return day;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
