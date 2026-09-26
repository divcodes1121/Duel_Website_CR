/**
 * THE CONSOLE'S VERDICTS — one place for every threshold that turns a figure
 * into "fine / watch this / something is wrong".
 *
 * WHY A MODULE. The redesigned console shows each verdict TWICE: as the dot on
 * a section's sidebar item, readable from anywhere, and as the status pill on
 * the card inside the section. Two copies of "past 6 hours is stalled" drift
 * apart, and a sidebar calling a collector healthy while its own card says
 * Stalled is worse than no sidebar dot at all. No runtime imports, so every
 * rule is testable without React or a network (the `tiers.ts` rule).
 *
 * EVERY VERDICT IS A WORD AND A TONE, never a colour alone — the screen draws
 * the word beside an icon (`StatusPill`), and the sidebar reads the word to a
 * screen reader.
 */

import type { AdminUser, AnalyticsStatus, Health } from './adminStore';

export type VerdictTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export interface Verdict {
  tone: VerdictTone;
  label: string;
}

/** Hours since an ISO stamp, or null when there is nothing to measure. */
export function hoursSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * THE HEADLINE SIGNAL. The bot polls every two hours, so a gap under ~3h is an
 * ordinary trough between passes and says nothing. Past 6h a pass has been
 * missed outright, which is the first thing that is actually wrong rather
 * than merely quiet.
 */
export function battleVerdict(newest: string | null | undefined, now = Date.now()): Verdict | null {
  const h = hoursSince(newest, now);
  if (h === null) return null;
  if (h > 6) return { tone: 'bad', label: 'Stalled' };
  if (h > 3) return { tone: 'warn', label: 'Late' };
  return { tone: 'good', label: 'Arriving' };
}

/**
 * A RATE BETWEEN THE LAST TWO POLLS, not a lifetime total. The CR API returns
 * 5xx under load, so a small non-zero figure is the normal state and only a
 * jump is worth reading.
 */
export function pollFailureVerdict(pct: number | null | undefined): Verdict | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 10) return { tone: 'bad', label: 'High' };
  if (pct > 3) return { tone: 'warn', label: 'Raised' };
  return { tone: 'good', label: 'Normal' };
}

/** How much of the stored battles the rollup has folded in. */
export function coverageVerdict(pct: number | null | undefined): Verdict | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 95) return { tone: 'good', label: 'Complete' };
  if (pct > 80) return { tone: 'warn', label: 'Drifting' };
  return { tone: 'bad', label: 'Behind' };
}

/**
 * THE REPAIR MECHANISM'S OWN CLOCK. Incremental folds drift; a full rebuild is
 * what corrects them. No record is itself worth a look.
 */
export function rebuildVerdict(lastRebuild: string | null | undefined, now = Date.now()): Verdict {
  const h = hoursSince(lastRebuild, now);
  if (h === null) return { tone: 'warn', label: 'No record' };
  const days = Math.floor(h / 24);
  if (days > 14) return { tone: 'bad', label: 'Overdue' };
  if (days > 7) return { tone: 'warn', label: 'Due' };
  return { tone: 'good', label: 'Recent' };
}

/** A capacity meter: its verdict is a function of the fill, so they agree. */
export function diskVerdict(used: number, total: number): Verdict {
  const pct = total > 0 ? (used / total) * 100 : 0;
  if (pct > 90) return { tone: 'bad', label: 'Nearly full' };
  if (pct > 75) return { tone: 'warn', label: 'Filling' };
  return { tone: 'good', label: 'Room' };
}

/** The retention runway: only worth flagging when the first delete is close. */
export function retentionVerdict(daysUntilFirstDelete: number | null | undefined): Verdict | null {
  if (daysUntilFirstDelete == null) return null;
  if (daysUntilFirstDelete < 14) return { tone: 'warn', label: 'Deleting soon' };
  return { tone: 'good', label: 'Runway' };
}

/**
 * The site's own health, for the sidebar dot on "Site & domain". A down
 * analytics API or a missing card catalogue is a fault (every screen answers
 * 200 with wrong numbers when the catalogue is missing); a missing integration
 * is a warning; the rest is healthy.
 */
export function siteVerdict(health: Health | null, analytics: AnalyticsStatus | null): Verdict {
  if (!health) return { tone: 'bad', label: 'Deployment unreachable' };
  if (!analytics?.hot.available) return { tone: 'bad', label: 'Analytics down' };
  if (analytics.cardData && !analytics.cardData.loaded) return { tone: 'bad', label: 'Card data missing' };
  const missing = Object.values(health.configured).filter((v) => !v).length;
  if (missing > 0) return { tone: 'warn', label: `${missing} integration${missing === 1 ? '' : 's'} missing` };
  return { tone: 'good', label: 'Healthy' };
}

/* ── accounts ───────────────────────────────────────────────────────────── */

/**
 * Accounts over time: the running total at the end of each day, from the day
 * the first account was made to `today`, with the empty days filled so the
 * line does not jump across a quiet week.
 */
export function cumulativeAccounts(createdAt: readonly string[], today: string): { x: string; total: number; joined: number }[] {
  const days = createdAt
    .map((c) => (c ? c.slice(0, 10) : ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!days.length) return [];
  const perDay = new Map<string, number>();
  for (const d of days) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Math.max(Date.parse(`${today}T00:00:00Z`), Date.parse(`${days[days.length - 1]}T00:00:00Z`));
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  const out: { x: string; total: number; joined: number }[] = [];
  let total = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    const x = new Date(t).toISOString().slice(0, 10);
    const joined = perDay.get(x) ?? 0;
    total += joined;
    out.push({ x, total, joined });
  }
  return out;
}

export interface SignInBucket {
  key: 'today' | 'week' | 'month' | 'earlier' | 'never';
  label: string;
  count: number;
}

/** Accounts by how recently they last signed in — a sign-in, not presence. */
export function signInBuckets(users: readonly Pick<AdminUser, 'last_sign_in_at'>[], now = Date.now()): SignInBucket[] {
  const b: Record<SignInBucket['key'], number> = { today: 0, week: 0, month: 0, earlier: 0, never: 0 };
  for (const u of users) {
    const h = hoursSince(u.last_sign_in_at, now);
    if (h === null) b.never += 1;
    else if (h < 24) b.today += 1;
    else if (h < 24 * 7) b.week += 1;
    else if (h < 24 * 30) b.month += 1;
    else b.earlier += 1;
  }
  return [
    { key: 'today', label: 'Today', count: b.today },
    { key: 'week', label: 'This week', count: b.week },
    { key: 'month', label: 'This month', count: b.month },
    { key: 'earlier', label: 'Earlier', count: b.earlier },
    { key: 'never', label: 'Never', count: b.never },
  ];
}

/* ── the console's sections ─────────────────────────────────────────────── */

/** The views in the console's sidebar, in their order there. */
export const CONSOLE_SECTIONS = ['overview', 'tracking', 'collection', 'storage', 'rollup', 'site', 'accounts'] as const;
export type ConsoleSection = (typeof CONSOLE_SECTIONS)[number];

/**
 * `#/admin/tracking` -> `tracking`. The bare route, and anything this console
 * does not know, is the overview. (`#/admin/coach` never reaches here: the app
 * routes the Coach Roster first, because it shares the prefix.)
 */
export function consoleSection(hash: string): ConsoleSection {
  const s = hash.replace(/^#\/admin\/?/, '').split(/[/?#]/)[0];
  return (CONSOLE_SECTIONS as readonly string[]).includes(s) ? (s as ConsoleSection) : 'overview';
}

/** The worse of several verdicts — the one a sidebar dot should show. Good
 *  and absent verdicts show nothing: a wall of green dots is a dashboard
 *  shouting, and the point of a signal is the one that is not fine. */
export function worst(...vs: (Verdict | null | undefined)[]): Verdict | null {
  const rank = (v: Verdict) => (v.tone === 'bad' ? 2 : v.tone === 'warn' ? 1 : 0);
  let out: Verdict | null = null;
  for (const v of vs) if (v && rank(v) > 0 && (!out || rank(v) > rank(out))) out = v;
  return out;
}
