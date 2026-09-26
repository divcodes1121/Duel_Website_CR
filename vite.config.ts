import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* THE BUILD'S OWN IDENTITY — IN index.html, NEVER IN THE JAVASCRIPT.
 *
 * Every PDF names the commit that built it, so "the export is still the old
 * layout" can be settled from the file itself. It used to be compiled into
 * the bundle through `define`, and THAT WAS A BUG WITH A LONG FUSE: the sha
 * changes on every commit, so the lazy report-engine chunk that printed it got
 * a new content hash on every deploy — a README-only commit included. Vercel
 * serves only the newest deployment's files, so every tab opened before a
 * deploy asked for an engine file that no longer existed and every export in
 * it failed ("Export failed", reported 2026-09-26 minutes after a docs push).
 *
 * `index.html` is not a hashed asset and is served with `max-age=0`, so the
 * meta tag is always current and costs no chunk its name. The engine reads it
 * at export time. `tests/staleBuild.test.ts` fails if `__BUILD_ID__` or any
 * other per-commit value comes back into `src/`.
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
  plugins: [
    react(),
    {
      name: 'deckkies-build-meta',
      transformIndexHtml: (html) =>
        html.replace('</head>', `  <meta name="deckkies-build" content="${buildId}" />
  </head>`),
    },
  ],
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
