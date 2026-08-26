/**
 * Small display formatters. No imports, deliberately.
 *
 * These lived in `adminStore.ts`, which constructs a Supabase client at module
 * load — so a unit test of "how do we print a byte count" pulled in the
 * realtime client and failed on Node 21 for want of a native WebSocket. Pure
 * formatting should never need a database connection to be exercised, and the
 * fact that it did was the signal to move it.
 */

/** Bytes as something a person can read. */
export function bytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** How long ago a PAST moment was: "3m ago", "2d ago", "never". */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * How long until a FUTURE moment: "in 2d", "in 5h", or "expired".
 *
 * A SEPARATE FUNCTION, because `ago()` cannot do this. Fed a future date its
 * difference goes negative, every threshold below 60 succeeds, and it answers
 * "just now" — which is how every three-day trial in the admin console came to
 * read "ends just now". Wrong, and alarming rather than merely wrong.
 */
export function until(iso: string | null): string {
  if (!iso) return '—';
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s <= 0) return 'expired';
  /* CEIL, not floor, and it matters. A trial with 2.999 days left floors to
     "in 2d", so a three-day trial reads as two the instant it starts. Rounding
     up also never says "in 0m" about time that has not run out yet, which
     would read as expired. Matches `trialDaysLeft` in state/supabase.ts, which
     drives the header countdown — the two must not disagree by a day. */
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.ceil(s / 3600)}h`;
  return `in ${Math.ceil(s / 86400)}d`;
}
