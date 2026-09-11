import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The 2v2 board's front door.
 *
 * The board itself is a COLLAPSED SECTION of the admin console, not a page, so
 * before this it could only be reached by knowing it existed and opening it by
 * hand. The profile menu now carries a row that asks for it.
 *
 * WHY THIS IS A SOURCE TEST RATHER THAN A RENDERED ONE. The admin console
 * needs a real admin Supabase session, which is the standing reason it has
 * never had a browser pass, and this repo's vitest suite runs in `node` with
 * no jsdom (jsdom 27 does not load on this machine at all — see CLAUDE.md).
 * So the things worth pinning are the ones a rename or a careless edit would
 * break silently: the exact label, the admin guard, the route, and the fact
 * that there is still only ONE board.
 *
 * Same argument as `shaders.test.ts`: cheap to check, expensive to find.
 */

const MENU = join(process.cwd(), 'src', 'components', 'Profile', 'ProfileMenu.tsx');
const CONSOLE = join(process.cwd(), 'src', 'components', 'Admin', 'AdminConsole.tsx');

const menu = readFileSync(MENU, 'utf8');
const admin = readFileSync(CONSOLE, 'utf8');

/** The menu rows that are wrapped in the admin-tier guard. */
function adminGuardedRows(source: string): string[] {
  const out: string[] = [];
  const re = /\{tier === 'admin' && \(([\s\S]*?)\n {16}\)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

describe('the 2v2 Decks entry in the profile menu', () => {
  const guarded = adminGuardedRows(menu);

  it('finds the admin-guarded rows (so a refactor cannot empty this suite)', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });

  it('offers a row labelled exactly "2v2 Decks"', () => {
    /* NOT "2v2 Battles", "2v2 Deck Pairs" or "2v2 Analytics". The sidebar says
       what a reader is looking for; the board says what it contains. */
    expect(menu).toContain('2v2 Decks');
    expect(menu).not.toContain('2v2 Battles');
    expect(menu).not.toContain('2v2 Analytics');
  });

  it('shows it only to admins', () => {
    const row = guarded.find((g) => g.includes('2v2 Decks'));
    expect(row, '2v2 Decks is not inside a tier === admin guard').toBeTruthy();
  });

  it('reads the tier from useAccess, never the raw store', () => {
    /* CLAUDE.md records the regression: accountStore initialises and resets to
       'free', and only useAccess knows 'anon' is not a tier. */
    expect(menu).toContain('const tier = useAccess()');
  });

  it('navigates to a sub-path of the console, not a new route', () => {
    const row = guarded.find((g) => g.includes('2v2 Decks')) ?? '';
    expect(row).toContain('href="#/admin/duo"');
    /* App.tsx routes on startsWith('#/admin'), so this needs no new branch. */
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    expect(app).toContain("route.startsWith('#/admin')");
  });

  it('does not invent a second API', () => {
    expect(menu).not.toContain('duo-battles');
    expect(admin).not.toContain('duo-battles');
  });

  it('uses its own glyph, not the single-card one', () => {
    /* The unit on that board is a PAIR of teammate decks. An icon showing one
       deck would misname it at a glance. */
    const row = guarded.find((g) => g.includes('2v2 Decks')) ?? '';
    expect(row).toContain('<Glyph d="duo" />');
    expect(menu).toMatch(/\bduo: \(/);
  });
});

describe('the console honours #/admin/duo', () => {
  it('opens the board when the route asks for it', () => {
    expect(admin).toContain("endsWith('/duo')");
    expect(admin).toContain('setDuoOpen(true)');
  });

  it('listens for hash changes, not just mount', () => {
    /* The common case is choosing the row while the console is ALREADY open:
       the hash changes, App.tsx re-routes to the same component, and nothing
       remounts — so a mount-only read would do nothing the second time. */
    expect(admin).toContain("addEventListener('hashchange'");
    expect(admin).toContain("removeEventListener('hashchange'");
  });

  it('keeps the address bar honest when the section is toggled by hand', () => {
    /* Closing the section while the hash still said /duo would mean a refresh
       silently reopened it, and the row would look like it had stopped
       working. */
    expect(admin).toContain('history.replaceState');
  });

  it('renders exactly one 2v2 board', () => {
    const boards = admin.match(/2v2 Deck Pairs/g) ?? [];
    expect(boards.length).toBe(1);
    const rows = admin.match(/function DuoPairRow/g) ?? [];
    expect(rows.length).toBe(1);
  });

  it('still calls the existing pair API', () => {
    const store = readFileSync(
      join(process.cwd(), 'src', 'state', 'adminStore.ts'), 'utf8');
    expect(store).toContain('/api/analytics/duo-pairs');
  });

  it('keeps the board labelled as pairs and the population bounded', () => {
    expect(admin).toContain('2v2 Deck Pairs');
    expect(admin).toContain('Unique teammate deck combinations');
    expect(admin).toContain('2v2 Players');
  });

  it('presents the two decks as teammates, never as opponents', () => {
    expect(admin).toContain('styles.duoVs');
    expect(admin).not.toMatch(/Deck A[\s\S]{0,80}\bVS\b[\s\S]{0,80}Deck B/);
  });
});
