import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * What is wired up, as booleans.
 *
 * Item 6 wants to see "whatever is on off or etc". This is the honest half of
 * that: which integrations this deployment can actually reach, reported without
 * saying anything about them.
 *
 * NAMES AND BOOLEANS ONLY — never a value, never a length, never a prefix.
 * Whether a deployment has an API key configured is not a secret; the key is.
 * The same distinction is why `/api/analytics/status` on the VPS reports
 * `available: true` rather than the path and size it used to publish.
 *
 * This is also a diagnostic that pays for itself: deck sync was returning
 * "invalid credential" for a demonstrably valid token, and the difference
 * between "the JWT check is wrong" and "the function cannot see its
 * configuration" was invisible from outside. One boolean settles it.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const has = (...names: string[]) => names.some((n) => Boolean(process.env[n]));

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    region: process.env.VERCEL_REGION ?? null,
    env: process.env.VERCEL_ENV ?? 'development',
    /* The commit this deployment was built from, so "did my change ship" is a
       question with an answer rather than a guess about caching. */
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    configured: {
      supabaseUrl: has('SUPABASE_URL', 'VITE_SUPABASE_URL'),
      supabaseKey: has('VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY'),
      redis: has('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'),
      redisToken: has('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
      analyticsOrigin: has('ANALYTICS_ORIGIN'),
      analyticsKey: has('CLASH_API_KEY'),
      oieAllowlist: has('OIE_ALLOWLIST'),
    },
  });
}
