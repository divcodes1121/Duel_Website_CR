import { describe, expect, it } from 'vitest';

import {
  battleVerdict,
  coverageVerdict,
  cumulativeAccounts,
  diskVerdict,
  hoursSince,
  pollFailureVerdict,
  rebuildVerdict,
  retentionVerdict,
  signInBuckets,
  siteVerdict,
} from '../src/state/consoleHealth';
import type { AnalyticsStatus, Health } from '../src/state/adminStore';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('the collection verdicts', () => {
  it('reads a gap under three hours as an ordinary trough between polls', () => {
    expect(battleVerdict(hoursAgo(1), NOW)).toEqual({ tone: 'good', label: 'Arriving' });
    expect(battleVerdict(hoursAgo(2.9), NOW)?.tone).toBe('good');
  });

  it('flags a missed poll past three hours and a stall past six', () => {
    expect(battleVerdict(hoursAgo(4), NOW)).toEqual({ tone: 'warn', label: 'Late' });
    expect(battleVerdict(hoursAgo(7), NOW)).toEqual({ tone: 'bad', label: 'Stalled' });
  });

  it('says nothing, rather than something reassuring, when nothing is stored', () => {
    expect(battleVerdict(null, NOW)).toBeNull();
    expect(battleVerdict('not a date', NOW)).toBeNull();
    expect(hoursSince(undefined, NOW)).toBeNull();
  });

  it('grades poll failures as a rate between polls', () => {
    expect(pollFailureVerdict(0.4)?.label).toBe('Normal');
    expect(pollFailureVerdict(5)?.label).toBe('Raised');
    expect(pollFailureVerdict(12)?.label).toBe('High');
    expect(pollFailureVerdict(null)).toBeNull();
  });
});

describe('the rollup and storage verdicts', () => {
  it('grades aggregate coverage', () => {
    expect(coverageVerdict(99.2)?.tone).toBe('good');
    expect(coverageVerdict(88)?.tone).toBe('warn');
    expect(coverageVerdict(52)?.tone).toBe('bad');
    expect(coverageVerdict(null)).toBeNull();
  });

  it('treats no rebuild record as worth a look, and a stale one as overdue', () => {
    expect(rebuildVerdict(null, NOW)).toEqual({ tone: 'warn', label: 'No record' });
    expect(rebuildVerdict(hoursAgo(24 * 3), NOW).tone).toBe('good');
    expect(rebuildVerdict(hoursAgo(24 * 9), NOW).tone).toBe('warn');
    expect(rebuildVerdict(hoursAgo(24 * 20), NOW).tone).toBe('bad');
  });

  it('makes the disk verdict a function of the fill', () => {
    expect(diskVerdict(50, 100).tone).toBe('good');
    expect(diskVerdict(80, 100).tone).toBe('warn');
    expect(diskVerdict(95, 100).tone).toBe('bad');
    expect(diskVerdict(5, 0).tone).toBe('good');
  });

  it('flags retention only when the first delete is close', () => {
    expect(retentionVerdict(null)).toBeNull();
    expect(retentionVerdict(200)?.tone).toBe('good');
    expect(retentionVerdict(9)?.tone).toBe('warn');
  });
});

describe('the site verdict', () => {
  const health: Health = {
    ok: true,
    time: '',
    region: 'fra1',
    env: 'production',
    commit: 'abc1234',
    configured: { supabase: true, upstash: true },
  };
  const analytics: AnalyticsStatus = {
    hot: { available: true, sizeBytes: 1 },
    archive: { available: false, sizeBytes: 0 },
    cardData: { loaded: true, count: 123, error: null },
  };

  it('is healthy when everything answers', () => {
    expect(siteVerdict(health, analytics)).toEqual({ tone: 'good', label: 'Healthy' });
  });

  it('calls a missing card catalogue a fault, because every screen still answers 200', () => {
    const v = siteVerdict(health, { ...analytics, cardData: { loaded: false, count: 0, error: 'missing' } });
    expect(v.tone).toBe('bad');
  });

  it('calls an unreachable deployment or a dead API a fault', () => {
    expect(siteVerdict(null, analytics).tone).toBe('bad');
    expect(siteVerdict(health, { ...analytics, hot: { available: false, sizeBytes: 0 } }).tone).toBe('bad');
  });

  it('names how many integrations are missing', () => {
    const v = siteVerdict({ ...health, configured: { supabase: true, upstash: false } }, analytics);
    expect(v).toEqual({ tone: 'warn', label: '1 integration missing' });
  });
});

describe('accounts over time', () => {
  it('is a running total per day, with the quiet days filled', () => {
    const rows = cumulativeAccounts(
      ['2026-09-20T10:00:00Z', '2026-09-20T18:00:00Z', '2026-09-23T09:00:00Z'],
      '2026-09-24',
    );
    expect(rows.map((r) => r.x)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
    expect(rows.map((r) => r.total)).toEqual([2, 2, 2, 3, 3]);
    expect(rows.map((r) => r.joined)).toEqual([2, 0, 0, 1, 0]);
  });

  it('ends on the last sign-up when the clock is behind it, and ignores junk', () => {
    const rows = cumulativeAccounts(['2026-09-20T10:00:00Z', 'garbage', ''], '2026-09-19');
    expect(rows).toEqual([{ x: '2026-09-20', total: 1, joined: 1 }]);
    expect(cumulativeAccounts([], '2026-09-19')).toEqual([]);
  });

  it('buckets last sign-in by recency, never as presence', () => {
    const b = signInBuckets(
      [
        { last_sign_in_at: hoursAgo(2) },
        { last_sign_in_at: hoursAgo(30) },
        { last_sign_in_at: hoursAgo(24 * 10) },
        { last_sign_in_at: hoursAgo(24 * 60) },
        { last_sign_in_at: null },
      ],
      NOW,
    );
    expect(b.map((x) => x.count)).toEqual([1, 1, 1, 1, 1]);
    expect(b.map((x) => x.label)).toEqual(['Today', 'This week', 'This month', 'Earlier', 'Never']);
  });
});

describe('the console route', () => {
  it('reads the section from the hash, and falls back to the overview', async () => {
    const { consoleSection } = await import('../src/state/consoleHealth');
    expect(consoleSection('#/admin')).toBe('overview');
    expect(consoleSection('#/admin/')).toBe('overview');
    expect(consoleSection('#/admin/tracking')).toBe('tracking');
    expect(consoleSection('#/admin/accounts?x=1')).toBe('accounts');
    expect(consoleSection('#/admin/nonsense')).toBe('overview');
  });

  it('shows only the worst of several verdicts, and nothing when all is well', async () => {
    const { worst } = await import('../src/state/consoleHealth');
    expect(worst({ tone: 'good', label: 'ok' }, null)).toBeNull();
    expect(worst({ tone: 'warn', label: 'a' }, { tone: 'bad', label: 'b' })).toEqual({ tone: 'bad', label: 'b' });
    expect(worst({ tone: 'warn', label: 'a' }, { tone: 'good', label: 'c' })).toEqual({ tone: 'warn', label: 'a' });
  });
});
