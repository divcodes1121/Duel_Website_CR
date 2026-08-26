import { describe, expect, it } from 'vitest';
import { ago, bytes, until } from '../src/utils/format';

describe('until', () => {
  /* The bug this exists for: `ago()` fed a FUTURE date produces a negative
     difference, every threshold below 60 succeeds, and it answers "just now" —
     which is how every three-day trial in the console read "ends just now". */
  it('does not say "just now" about a date three days away', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(ago(future)).toBe('just now'); // the trap, pinned
    expect(until(future)).toBe('in 3d');
  });

  it('rounds UP, so a three-day trial never reads as two', () => {
    /* The floor version returned "in 2d" here, because 3 days minus the
       microseconds between constructing the date and reading the clock is
       2.999 days. Consistent with trialDaysLeft(), which drives the header. */
    expect(until(new Date(Date.now() + 3 * 86_400_000).toISOString())).toBe('in 3d');
    expect(until(new Date(Date.now() + 90 * 60_000).toISOString())).toBe('in 2h');
    expect(until(new Date(Date.now() + 20 * 60_000).toISOString())).toBe('in 20m');
  });

  it('never rounds a live trial down to zero minutes', () => {
    expect(until(new Date(Date.now() + 20_000).toISOString())).toBe('in 1m');
  });

  it('says expired rather than a negative number', () => {
    expect(until(new Date(Date.now() - 60_000).toISOString())).toBe('expired');
  });

  it('handles a missing date', () => {
    expect(until(null)).toBe('—');
    expect(ago(null)).toBe('never');
  });
});

describe('bytes', () => {
  it('scales to a readable unit', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(900)).toBe('900 B');
    expect(bytes(1536)).toBe('1.5 kB');
    expect(bytes(15_787_819_008)).toBe('14.7 GB');
  });
});
