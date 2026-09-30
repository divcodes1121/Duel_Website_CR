import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A SOURCE CONTRACT between `server/coach_daily.trend_threats` and the
 * freshness line every field plan draws.
 *
 * The server's trend state carries `daysApart`; the client type said `days`.
 * Nothing noticed while the trend was off, because the line only reads the
 * field when `applied` is true — and the day seven days of meta history
 * existed (2026-09-30) every roster board and practise tab printed
 * "trend undefinedd". TypeScript cannot see a Python dict, so this reads both.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the meta trend field name', () => {
  const server = read('../server/coach_daily.py');
  const client = read('../src/state/analyticsClient.ts');
  const line = read('../src/components/Admin/CoachRoster/FieldAnswers.tsx');

  it('the server sends daysApart', () => {
    const state = server.slice(server.indexOf('def trend_threats'), server.indexOf('def _overall'));
    expect(state).toMatch(/"daysApart":/);
    expect(state).not.toMatch(/"days":/);
  });

  it('the client type and the freshness line read daysApart, never days', () => {
    const trend = client.slice(client.indexOf('  trend?: {'), client.indexOf('  progress?: FieldProgress;'));
    expect(trend).toMatch(/daysApart: number \| null/);
    expect(trend).not.toMatch(/\n\s+days: /);
    expect(line).toMatch(/t\.daysApart/);
    expect(line).not.toMatch(/t\.days\b/);
  });
});
