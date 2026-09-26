/* A TAB OLDER THAN THE DEPLOY — recognising it, and getting out of it.
 *
 * Every lazily loaded part of the site (the report engine, jsPDF, every export
 * adapter, the Team Analysis / Coach / 2v2 / field book screens) is a file
 * whose name is a hash of its contents. Vercel serves only the NEWEST
 * deployment's files, so a tab opened before a deploy still runs the old main
 * bundle and asks for old file names — which now 404. Nothing is wrong with
 * the site; the tab is simply older than it.
 *
 * Found 2026-09-26: every export failed ("Export failed", on every screen) in
 * a tab opened two minutes before a README-only deploy, because the build id
 * compiled into the report engine renamed its chunk on every commit. That id
 * now lives in index.html (see `vite.config.ts`), so a commit that changes no
 * code renames nothing. A commit that DOES change code still renames chunks,
 * and this module is what makes that recoverable:
 *
 *   * a lazy SCREEN that fails to load reloads the page once — the reader was
 *     navigating anyway, and the reload lands on the same route with the new
 *     code (Vite's own recommendation for `vite:preloadError`);
 *   * an EXPORT that fails is left to the export button, which says the page
 *     is out of date and offers a reload instead of reloading by itself — an
 *     unsaved Team Analysis board is on that page.
 *
 * No React and no DOM at import time, so the rules are testable in node.
 */

/** True for the errors a browser throws when a lazily loaded file is gone.
 *  Chrome, Firefox and Safari each word it differently; Vite adds its own for
 *  CSS. A server answering a missing file with HTML surfaces as a MIME error. */
export function isStaleChunkError(e: unknown): boolean {
  const msg = String((e as { message?: unknown })?.message ?? e ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk .* failed|Expected a JavaScript(-or-Wasm)? module script/i
    .test(msg);
}

let exporting = 0;

/** Bracket an export, so a failed lazy load inside it is left to the button. */
export function beginExport(): void { exporting += 1; }
export function endExport(): void { exporting = Math.max(0, exporting - 1); }

const KEY = 'dk-stale-reload-at';
/** Never reload more than once in this window: if the fresh page still cannot
 *  load a file, something else is wrong and a reload loop would hide it. */
export const RELOAD_GUARD_MS = 30_000;

/** Whether a navigation-time failure may reload now, given the last reload. */
export function mayReload(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > RELOAD_GUARD_MS;
}

export function reloadPage(): void {
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
  window.location.reload();
}

/** Install once, at startup. */
export function installStaleBuildRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (exporting > 0) return;
    let last: number | null = null;
    try {
      const v = sessionStorage.getItem(KEY);
      last = v ? Number(v) : null;
    } catch { /* storage blocked: treat as never reloaded */ }
    if (!mayReload(last, Date.now())) return;
    event.preventDefault();
    reloadPage();
  });
}
