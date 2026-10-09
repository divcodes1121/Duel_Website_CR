import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The Saved tab of Royal Duels, read off its source — this suite runs in node
 * with no DOM, the arrangement `allDuels.test.ts` uses.
 *
 * It drew every saved group at once. Measured in a browser on 2026-10-09 with
 * a thousand five-deck sets: 6.3 seconds to open. The saved-set limit went to
 * 1,000 the same day (none for an admin), so the list is paged — twenty at a
 * time, 0.4 seconds — and these are the three ways that could quietly stop
 * being true.
 */

const R = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n');
const src = R('src', 'components', 'DuelDeckBuilder', 'SavedGroups.tsx');
const css = R('src', 'components', 'DuelDeckBuilder', 'SavedGroups.module.css');

describe('the Saved tab', () => {
  it('draws twenty groups a page, not the whole library', () => {
    expect(src).toContain('export const SAVED_GROUPS_PER_PAGE = 20;');
    expect(src).toContain('shown.map((entry) => (');
    expect(src).not.toContain('entries.map((entry) => (');
  });

  it('filters the whole library first and pages what is left', () => {
    /* Paged first, the card filter would search twenty groups and report the
       rest of the library as holding nothing. */
    const filter = src.indexOf('all.filter((e) => groupDecks(e)');
    const page = src.indexOf('entries.slice(');
    expect(filter).toBeGreaterThan(0);
    expect(page).toBeGreaterThan(filter);
  });

  it('goes back to page 1 when the mode or the filter changes, and never past the end', () => {
    expect(src).toContain('useEffect(() => setPage(1), [mode, filterKey]);');
    expect(src).toContain('const current = Math.min(page, pages);');
  });

  it('counts every saved set in the pill, whatever page is drawn', () => {
    expect(src).toContain('{filtering ? `${entries.length} of ${all.length}` : all.length}');
  });

  it('says how much of the limit is used, over Solo and Versus together', () => {
    expect(src).toContain('const limit = useSavedSetLimit();');
    expect(src).toContain('{library.length.toLocaleString(\'en-US\')} of {limit.toLocaleString(\'en-US\')} saved');
    // Only for a reader who has a limit.
    expect(src).toContain('{Number.isFinite(limit) && (');
  });

  it('uses only classes its stylesheet defines', () => {
    const used = new Set([...src.matchAll(/styles\.([A-Za-z0-9]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
    expect(missing).toEqual([]);
  });
});
