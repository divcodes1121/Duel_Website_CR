/* WHICH HASHES ARE PAGES, and therefore which ones are a 404.
 *
 * Until 2026-10-18 there was no such thing as a missing page: `viewFor` in
 * App.tsx falls through to 'home', so `#/anything` quietly drew the landing
 * screen and a mistyped link looked like the link working. A wrong REAL path
 * (deckkies.com/anything) got Vercel's plain-text NOT_FOUND instead; the
 * static `public/404.html` now forwards that here as `#/lost?from=<path>`.
 *
 * ONLY `#/...` CAN BE A 404. Supabase lands auth redirects on the bare hash —
 * `#access_token=...`, `#error=access_denied...` — and those are read by the
 * account store. Calling them unknown would replace a password-reset link's
 * error message with a game.
 *
 * No imports, so the rule is tested on its own (`tests/routes.test.ts`).
 */

/** Every route App.tsx and the Dashboard actually render. A prefix matches
 *  itself exactly or followed by '/' or '?', so `#/decks` is a page and
 *  `#/decksxyz` is not. */
export const KNOWN_ROUTES = [
  '#/builder',
  '#/decks',
  '#/palette',
  '#/teams',
  '#/duo',
  '#/search',
  '#/all-duels',
  '#/player',
  '#/guide',
  '#/my',
  '#/admin',
  '#/signin',
  '#/reset',
] as const;

export function isUnknownRoute(hash: string): boolean {
  if (!hash.startsWith('#/')) return false;
  const rest = hash.slice(2);
  if (rest === '' || rest.startsWith('?')) return false; // the landing screen
  return !KNOWN_ROUTES.some((r) => {
    if (!hash.startsWith(r)) return false;
    const next = hash.charAt(r.length);
    return next === '' || next === '/' || next === '?';
  });
}

/** What the reader asked for, for the 404 page to show. `#/lost?from=/x`
 *  (forwarded by public/404.html) names the real path; otherwise the hash. */
export function missingPath(hash: string): string {
  const q = hash.indexOf('?');
  if (q !== -1) {
    try {
      const from = new URLSearchParams(hash.slice(q + 1)).get('from');
      if (from) return from;
    } catch {
      /* fall through */
    }
  }
  return hash.slice(1) || '/';
}
