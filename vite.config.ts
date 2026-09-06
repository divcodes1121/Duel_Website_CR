import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* THE BUILD'S OWN IDENTITY, COMPILED IN.
 *
 * "The export is still the old layout" has now been reported twice against a
 * deploy that was provably current, and settling it each time meant fetching
 * the served bundle and grepping it for a minified fragment. A PDF that names
 * the commit it came from answers the question by itself: if the stamp is not
 * the commit that shipped the change, the reader's browser is running JS from
 * before it, and nothing about the deploy is in question.
 *
 * Vercel does not run the build inside a git checkout with history, so the
 * environment variable is the primary source and `git` is the local fallback.
 * An unknown build says "dev" rather than inventing a plausible sha. */
const buildId = (() => {
  const env = process.env.VERCEL_GIT_COMMIT_SHA
  if (env) return env.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
})()

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react()],
  server: {
    proxy: {
      // The analytics API is a separate local process (server/app.py) reading
      // the Clash_Bot SQLite tiers. Proxying keeps the browser on one origin,
      // so the client calls the same /api/analytics/* paths it will call once
      // the service is hosted — migrating is a proxy/base-URL change, not a
      // code change.
      '/api/analytics': {
        target: process.env.CLASH_API_URL || 'http://127.0.0.1:8787',
        changeOrigin: true,
        // Phase 24C step 2 put the analytics API behind a key. This is read in
        // the Vite config, which runs in Node -- it is never part of the
        // bundle. Without a key set, the API serves only /status, so a dev who
        // has one configured needs it attached here too.
        ...(process.env.CLASH_API_KEY
          ? { headers: { 'X-Analytics-Key': process.env.CLASH_API_KEY } }
          : {}),
        // In production, /api/analytics/opponent-read/<tag> is a Vercel
        // function (api/analytics/opponent-read/[tag].ts) that adds the key
        // server-side. No such function exists under `vite dev`, so map the
        // path onto the Python route and the client can use one URL in both
        // places -- which is the point of the proxy path being same-origin.
        rewrite: (p) => p.replace(
          /^\/api\/analytics\/opponent-read\//,
          '/api/analytics/coach/opponent-read/',
        ),
      },
    },
  },
})
