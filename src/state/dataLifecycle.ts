/**
 * THE DATA LIFECYCLE — the arithmetic behind the console's "Data lifecycle"
 * view, from the admin-gated `/api/analytics/admin/retention`.
 *
 * What the server keeps (`server/data_ledger.py`): one row per battle-day the
 * rolling retention job deleted, one snapshot of the database a day, and every
 * backup with when an off-box copy was confirmed. Everything here is a
 * re-shaping of those rows — no figure is invented, and a figure the ledger
 * cannot support (an intake with no two readings, a projection with no
 * battles) comes back null rather than as a plausible zero.
 *
 * No runtime imports, so it is testable without React or a network (the
 * `tiers.ts` rule).
 */

export interface PurgeDay {
  day: string;            // the battle day removed
  run_date: string;       // when the deletion ran
  finished_at: string;
  battles: number;
  duel_timeline: number;
  raw: number;
  tags: number;
  tags_gone: number;
  seconds: number;
  retention_days: number;
  complete: number;
}

export interface LifecycleSnapshot {
  date: string;
  taken_at: string;
  battles_total: number | null;
  max_id: number | null;
  inserted: number | null;
  file_bytes: number | null;
  page_size: number | null;
  page_count: number | null;
  freelist_pages: number | null;
  oldest_battle: string | null;
  newest_battle: string | null;
  tracked_players: number | null;
  retention_days: number | null;
  watermark: string | null;
  next_purge_day: string | null;
  disk_total: number | null;
  disk_free: number | null;
  raw_rows?: number | null;
  raw_bytes?: number | null;
  by_month?: Record<string, number>;
  forecast?: [string, number][];
}

export interface BackupRecord {
  name: string;
  created_at: string;
  finished_at: string | null;
  db_bytes: number | null;
  zst_bytes: number | null;
  sha256: string | null;
  mode?: string | null;
  check_kind: string | null;
  check_result: string | null;
  status: 'running' | 'verified' | 'failed' | 'deleted';
  pulled_at: string | null;
  pulled_host: string | null;
  deleted_at: string | null;
}

export interface LifecycleRun {
  id: number;
  job: 'retention' | 'backup' | string;
  started_at: string;
  finished_at: string;
  status: 'ok' | 'dry_run' | 'refused' | 'error' | 'nothing_due' | string;
  detail: Record<string, unknown>;
}

export interface LifecycleReport {
  snapshots: LifecycleSnapshot[];
  latest: LifecycleSnapshot | null;
  purges: PurgeDay[];
  runs: LifecycleRun[];
  backups: BackupRecord[];
  totals: { daysPurged: number; battlesPurged: number; tagDays: number };
  settings?: {
    retentionDays: number;
    minRetentionDays: number;
    maxDaysPerRun: number;
    bot: { retentionDays: number | null; external: boolean | null };
  };
}

const DAY_MS = 86_400_000;

/** `20260601T000058.000Z` or `2026-06-01…` -> `2026-06-01`; null if neither. */
export function isoDay(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  if (/^\d{8}T/.test(stamp)) return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(stamp)) return stamp.slice(0, 10);
  return null;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * THE RULE, as a date: a battle played on day d is kept for `retentionDays`
 * whole days and removed on d + retentionDays + 1. The same arithmetic as
 * `retention.plan()`'s `firstDeletion`, so the screen and the job agree.
 */
export function expiryOf(day: string, retentionDays: number): string {
  return addDays(day, retentionDays + 1);
}

/** When the oldest stored battle goes, or null with nothing stored. */
export function firstDeletion(oldestBattle: string | null | undefined, retentionDays: number): string | null {
  const d = isoDay(oldestBattle);
  return d ? expiryOf(d, retentionDays) : null;
}

export interface TransactionRow {
  x: string;
  /** Battles written since the previous reading, attributed to its date; null
   *  when there was no previous reading to measure from (not a zero). */
  added: number | null;
  deleted: number;
  tags: number;
  tagsGone: number;
  [key: string]: string | number | null;
}

/**
 * Every day of the window, oldest first: what came in and what went out. A
 * day with no deletion is a real zero (the job ran or had nothing due); a day
 * with no reading is `added: null`, drawn as a gap.
 */
export function transactions(report: Pick<LifecycleReport, 'snapshots' | 'purges'>, days: number, today: string): TransactionRow[] {
  const added = new Map<string, number | null>();
  for (const s of report.snapshots) added.set(s.date, s.inserted);
  const out = new Map<string, { deleted: number; tags: number; tagsGone: number }>();
  for (const p of report.purges) {
    const cur = out.get(p.run_date) ?? { deleted: 0, tags: 0, tagsGone: 0 };
    cur.deleted += p.battles;
    cur.tags += p.tags;
    cur.tagsGone += p.tags_gone;
    out.set(p.run_date, cur);
  }
  const rows: TransactionRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const x = addDays(today, -i);
    const o = out.get(x);
    rows.push({ x, added: added.get(x) ?? null, deleted: o?.deleted ?? 0, tags: o?.tags ?? 0, tagsGone: o?.tagsGone ?? 0 });
  }
  return rows;
}

/** The next battle-days to expire, keyed by the date each one goes. */
export function expirySchedule(
  forecast: readonly [string, number][] | undefined,
  retentionDays: number,
): { x: string; day: string; battles: number }[] {
  return (forecast ?? []).map(([day, battles]) => ({ x: expiryOf(day, retentionDays), day, battles }));
}

export interface Intake {
  perDay: number;
  basis: 'readings' | 'month';
  /** How many days the figure was measured over. */
  span: number;
}

/**
 * Battles written per day. From the daily readings when there are any (the
 * mean of up to the last seven, each divided by the days since the reading
 * before it); otherwise from the newest month in the histogram, divided by the
 * days of that month the newest battle reaches. Null with neither.
 */
export function intakePerDay(report: Pick<LifecycleReport, 'snapshots' | 'latest'>): Intake | null {
  const withValue = report.snapshots.filter((s) => s.inserted != null);
  if (withValue.length) {
    const recent = withValue.slice(-7);
    const perDay: number[] = [];
    for (const s of recent) {
      const i = report.snapshots.indexOf(s);
      const prev = report.snapshots[i - 1];
      const gap = prev ? Math.max(1, daysBetween(prev.date, s.date)) : 1;
      perDay.push((s.inserted as number) / gap);
    }
    return { perDay: perDay.reduce((a, b) => a + b, 0) / perDay.length, basis: 'readings', span: perDay.length };
  }
  const latest = report.latest;
  const months = latest?.by_month ? Object.keys(latest.by_month).sort() : [];
  const newest = isoDay(latest?.newest_battle);
  if (!months.length || !newest) return null;
  const month = months[months.length - 1];
  if (!newest.startsWith(month)) return null;
  const elapsed = Number(newest.slice(8, 10));
  if (!elapsed) return null;
  return { perDay: latest!.by_month![month] / elapsed, basis: 'month', span: elapsed };
}

export interface Projection {
  retentionDays: number;
  battles: number;
  /** Per-battle data at a full window (file minus raw, per battle, scaled). */
  battleBytes: number;
  /** The raw payloads as they stand now — they churn, they are not per-battle. */
  rawBytes: number;
  totalBytes: number;
  /** Share of the volume, 0..100; null without a disk figure. */
  diskPct: number | null;
}

/**
 * What the database would hold at a full window, at today's intake and today's
 * bytes per battle. An estimate, and labelled one on screen: intake scales with
 * the number of tracked players, which is a feature the site offers.
 */
export function projectAt(latest: LifecycleSnapshot | null, intake: Intake | null, retentionDays: number): Projection | null {
  if (!latest || !intake || !latest.battles_total || !latest.file_bytes) return null;
  const raw = latest.raw_bytes ?? 0;
  const perBattle = Math.max(0, latest.file_bytes - raw) / latest.battles_total;
  const battles = Math.round(intake.perDay * retentionDays);
  const battleBytes = battles * perBattle;
  const totalBytes = battleBytes + raw;
  return {
    retentionDays,
    battles,
    battleBytes,
    rawBytes: raw,
    totalBytes,
    diskPct: latest.disk_total ? (totalBytes / latest.disk_total) * 100 : null,
  };
}

/** Bytes per stored battle, raw payloads excluded; null when unknowable. */
export function bytesPerBattle(latest: LifecycleSnapshot | null): number | null {
  if (!latest?.battles_total || !latest.file_bytes) return null;
  return Math.max(0, latest.file_bytes - (latest.raw_bytes ?? 0)) / latest.battles_total;
}

/** The newest backup that passed its checks, or null. */
export function latestVerified(backups: readonly BackupRecord[]): BackupRecord | null {
  return backups.find((b) => b.status === 'verified') ?? null;
}

/** The newest backup an off-box machine has confirmed holding, or null. */
export function latestPulled(backups: readonly BackupRecord[]): BackupRecord | null {
  return backups.find((b) => b.pulled_at) ?? null;
}

/** The newest run of a job, or null. */
export function lastRun(runs: readonly LifecycleRun[], job: string): LifecycleRun | null {
  return runs.find((r) => r.job === job) ?? null;
}

/** `2026-09` -> `Sep 2026`. */
export function monthLabel(ym: string): string {
  const t = Date.parse(`${ym}-01T00:00:00Z`);
  return Number.isNaN(t) ? ym : new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** `2026-09-29` -> `29 Sep 2026`. */
export function longDay(day: string | null | undefined): string {
  if (!day) return '—';
  const t = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? day : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
