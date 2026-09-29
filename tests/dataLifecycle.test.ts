import { describe, expect, it } from 'vitest';

import { backupVerdict, botAgreementVerdict, consoleSection, retentionRunVerdict } from '../src/state/consoleHealth';
import {
  bytesPerBattle,
  expiryOf,
  expirySchedule,
  firstDeletion,
  intakePerDay,
  isoDay,
  projectAt,
  transactions,
  type LifecycleSnapshot,
  type PurgeDay,
} from '../src/state/dataLifecycle';

const snap = (over: Partial<LifecycleSnapshot>): LifecycleSnapshot => ({
  date: '2026-09-29',
  taken_at: '2026-09-29T10:00:00Z',
  battles_total: 21_366_792,
  max_id: 21_375_866,
  inserted: null,
  file_bytes: 57_161_908_224,
  page_size: 32768,
  page_count: 1_744_443,
  freelist_pages: 0,
  oldest_battle: '20260601T000058.000Z',
  newest_battle: '20260929T091938.000Z',
  tracked_players: 5446,
  retention_days: 304,
  watermark: '20260929T092017.000Z',
  next_purge_day: '2026-06-01',
  disk_total: 387 * 1024 ** 3,
  disk_free: 128 * 1024 ** 3,
  raw_rows: 1_894_365,
  raw_bytes: 13_390_000_000,
  by_month: { '2026-06': 16412, '2026-07': 2452256, '2026-08': 6736655, '2026-09': 12161469 },
  forecast: [['2026-06-01', 392], ['2026-06-02', 141]],
  ...over,
});

const purge = (over: Partial<PurgeDay>): PurgeDay => ({
  day: '2026-06-01',
  run_date: '2027-04-02',
  finished_at: '2027-04-02T01:40:00Z',
  battles: 392,
  duel_timeline: 3,
  raw: 0,
  tags: 40,
  tags_gone: 2,
  seconds: 4,
  retention_days: 304,
  complete: 1,
  ...over,
});

describe('the retention rule, as dates', () => {
  it('a battle played on day d is removed on d + window + 1', () => {
    expect(expiryOf('2026-06-01', 304)).toBe('2027-04-02');
    expect(expiryOf('2026-06-01', 365)).toBe('2027-06-02');
  });

  it('matches the job: the oldest battle 2026-06-01 goes on 2027-04-02', () => {
    expect(firstDeletion('20260601T000058.000Z', 304)).toBe('2027-04-02');
    expect(firstDeletion(null, 304)).toBeNull();
  });

  it('reads both stamp formats', () => {
    expect(isoDay('20260601T000058.000Z')).toBe('2026-06-01');
    expect(isoDay('2026-06-01T01:00:00Z')).toBe('2026-06-01');
    expect(isoDay('garbage')).toBeNull();
  });

  it('keys the forecast by the date each day is removed', () => {
    expect(expirySchedule([['2026-06-01', 392]], 304)).toEqual([{ x: '2027-04-02', day: '2026-06-01', battles: 392 }]);
  });
});

describe('data in and out', () => {
  it('fills every day of the window, oldest first', () => {
    const rows = transactions({ snapshots: [], purges: [] }, 5, '2027-04-05');
    expect(rows.map((r) => r.x)).toEqual(['2027-04-01', '2027-04-02', '2027-04-03', '2027-04-04', '2027-04-05']);
  });

  it('a day with no reading is a gap (null), not zero intake', () => {
    const rows = transactions({ snapshots: [snap({ date: '2027-04-05', inserted: 400_000 })], purges: [] }, 2, '2027-04-05');
    expect(rows[0].added).toBeNull();
    expect(rows[1].added).toBe(400_000);
  });

  it('sums every day removed in one run under the run date', () => {
    const rows = transactions(
      {
        snapshots: [],
        purges: [purge({ day: '2026-06-01', battles: 392, tags: 40 }), purge({ day: '2026-06-02', battles: 141, tags: 30, tags_gone: 1 })],
      },
      1,
      '2027-04-02',
    );
    expect(rows[0]).toMatchObject({ deleted: 533, tags: 70, tagsGone: 3 });
  });
});

describe('capacity', () => {
  it('uses the readings when there are some, per day between readings', () => {
    const s = [snap({ date: '2026-09-27', inserted: null }), snap({ date: '2026-09-28', inserted: 400_000 }), snap({ date: '2026-09-30', inserted: 900_000 })];
    const intake = intakePerDay({ snapshots: s, latest: s[2] });
    expect(intake?.basis).toBe('readings');
    expect(intake?.perDay).toBeCloseTo((400_000 + 450_000) / 2);
  });

  it('falls back to this month so far with no readings', () => {
    const s = [snap({})];
    const intake = intakePerDay({ snapshots: s, latest: s[0] });
    expect(intake?.basis).toBe('month');
    expect(intake?.perDay).toBeCloseTo(12_161_469 / 29);
  });

  it('excludes raw payloads from bytes per battle', () => {
    expect(Math.round(bytesPerBattle(snap({}))!)).toBe(Math.round((57_161_908_224 - 13_390_000_000) / 21_366_792));
  });

  it('projects the per-battle part and adds today’s raw on top', () => {
    const latest = snap({});
    const p = projectAt(latest, { perDay: 400_000, basis: 'readings', span: 7 }, 304)!;
    expect(p.battles).toBe(121_600_000);
    expect(p.totalBytes).toBeCloseTo(p.battles * bytesPerBattle(latest)! + 13_390_000_000);
    expect(p.diskPct).toBeGreaterThan(0);
  });

  it('refuses to project without an intake or a battle count', () => {
    expect(projectAt(snap({}), null, 304)).toBeNull();
    expect(projectAt(snap({ battles_total: 0 }), { perDay: 1, basis: 'month', span: 1 }, 304)).toBeNull();
  });
});

describe('the verdicts behind the sidebar dot', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');

  it('no backup at all is a fault', () => {
    expect(backupVerdict(null, null, now).tone).toBe('bad');
  });

  it('a copy that exists only on the VPS is a warning — a rollback, not a backup', () => {
    expect(backupVerdict('2026-09-30T03:00:00Z', null, now)).toEqual({ tone: 'warn', label: 'Not off the box yet' });
  });

  it('an off-box copy ages from warning to fault', () => {
    expect(backupVerdict('2026-09-30T03:00:00Z', '2026-09-26T12:00:00Z', now).label).toBe('Off-box copy is stale');
    expect(backupVerdict('2026-09-30T03:00:00Z', '2026-09-20T12:00:00Z', now).tone).toBe('bad');
    expect(backupVerdict('2026-09-30T03:00:00Z', '2026-09-30T05:00:00Z', now).tone).toBe('good');
  });

  it('retention: nothing due is healthy; refused and failed are faults; a dry run warns', () => {
    const at = '2026-09-30T02:00:00Z';
    expect(retentionRunVerdict({ status: 'nothing_due', finished_at: at }, now)?.tone).toBe('good');
    expect(retentionRunVerdict({ status: 'refused', finished_at: at }, now)?.tone).toBe('bad');
    expect(retentionRunVerdict({ status: 'error', finished_at: at }, now)?.tone).toBe('bad');
    expect(retentionRunVerdict({ status: 'dry_run', finished_at: at }, now)?.tone).toBe('warn');
    expect(retentionRunVerdict({ status: 'ok', finished_at: '2026-09-27T02:00:00Z' }, now)?.label).toBe('Retention late');
    expect(retentionRunVerdict(null, now)).toBeNull();
    expect(retentionRunVerdict({ status: 'error', finished_at: at }, now, 'Raw window')?.label).toBe('Raw window failed');
  });

  it('the bot must have handed deletion over, at the same window', () => {
    expect(botAgreementVerdict({ retentionDays: 304, bot: { retentionDays: 304, external: true } })?.tone).toBe('good');
    expect(botAgreementVerdict({ retentionDays: 304, bot: { retentionDays: 304, external: false } })?.tone).toBe('warn');
    expect(botAgreementVerdict({ retentionDays: 365, bot: { retentionDays: 304, external: true } })?.label).toBe('Windows disagree');
  });

  it('the view has its own URL', () => {
    expect(consoleSection('#/admin/lifecycle')).toBe('lifecycle');
  });
});
