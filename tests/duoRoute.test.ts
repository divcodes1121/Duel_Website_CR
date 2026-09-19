import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The 2v2 board's front door.
 *
 * IT USED TO BE A COLLAPSED SECTION OF THE ADMIN CONSOLE. That put the one
 * screen built entirely out of 2v2 behind a door only an operator opens, and
 * nothing on it is operational — it is what people play. It is a route now,
 * reached from the gallery strip like Team Analysis.
 *
 * WHY THIS IS A SOURCE TEST RATHER THAN A RENDERED ONE. This repo's vitest
 * suite runs in `node` with no jsdom (jsdom 27 does not load on this machine at
 * all — see CLAUDE.md), so what is worth pinning is the set of facts a rename
 * or a careless edit would break silently: the label, the route, the gate, the
 * fact that the console no longer carries a copy, and that the board is a PAIR
 * board rather than a list of single decks.
 *
 * Same argument as `shaders.test.ts`: cheap to check, expensive to find.
 */

const R = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

const dash = R('src', 'components', 'Dashboard', 'Dashboard.tsx');
const app = R('src', 'App.tsx');
const page = R('src', 'components', 'Analytics', 'DuoDecks', 'DuoDecks.tsx');
const client = R('src', 'state', 'analyticsClient.ts');

describe('the 2v2 board left the admin console', () => {
  it('is gone from the console itself', () => {
    const admin = R('src', 'components', 'Admin', 'AdminConsole.tsx');
    expect(admin).not.toContain('2v2 Deck Pairs');
    expect(admin).not.toContain('DuoPairRow');
    expect(admin).not.toContain('loadDuo');
  });

  it('is gone from the profile menu', () => {
    const menu = R('src', 'components', 'Profile', 'ProfileMenu.tsx');
    expect(menu).not.toContain('2v2 Decks');
    expect(menu).not.toContain('#/admin/duo');
  });

  it('took its data layer with it, off the admin store', () => {
    /* The public screen must not import from a module that constructs a
       Supabase client and lists every account. */
    const store = R('src', 'state', 'adminStore.ts');
    expect(store).not.toContain('DuoReport');
    expect(page).not.toContain('adminStore');
  });

  it('renders exactly one board', () => {
    expect((page.match(/function Pair\b/g) ?? []).length).toBe(1);
  });
});

describe('the landing strip carries the card', () => {
  it('offers a card labelled exactly "2v2 Decks"', () => {
    /* NOT "2v2", "2v2 Battles" or "2v2 Deck Pairs". The strip says what a
       reader is looking for; the page says what it contains. */
    expect(dash).toContain("label: '2v2 Decks'");
    expect(dash).not.toContain('2v2 Battles');
  });

  it('appends it to the gallery rather than adding it to the rail', () => {
    /* `AREAS` is the sections of ONE loaded player. This screen's subject is
       the whole 2v2 population, so it has no place in the rail — the same
       argument `TEAM_CARD` already records. */
    expect(dash).toContain('items={[...AREAS, TEAM_CARD, DUO_CARD].map(');
    /* Sliced rather than regexed across the whole file: a lazy match runs
       straight past the end of SIDE_NAV and finds the next `] as const;`, so it
       passes on any file that mentions the label anywhere at all. */
    const sideNav = dash.slice(dash.indexOf('const SIDE_NAV = ['));
    expect(sideNav.slice(0, sideNav.indexOf('] as const;'))).not.toContain('2v2 Decks');
  });

  it('gives it a blurb, so the card is not blank', () => {
    expect(dash).toMatch(/'2v2 Decks': '[^']{40,}'/);
  });

  it('is reachable on a phone, through the dock rather than the strip', () => {
    /* THIS USED TO ASSERT `go(DUO_CARD.hash)` IN `.phoneNav`, and the reason
       has moved rather than gone. Below 860px the strip was the whole of a
       phone's navigation, because `.topDock` was `display: none` there — so a
       destination missing from the strip had no way in at all, and Team
       Analysis and 2v2 Decks were appended to it for exactly that reason.
       The dock renders on phones now (2026-09-12), on a row of its own, and it
       carries both. Keeping them in the strip as well would put one
       destination on screen twice in two different navigation levels.
       So the property to pin is unchanged — 2v2 has a door on a phone — and
       only the door moved. Both halves are checked, because either one alone
       passes against a dock that is hidden again. */
    expect(dash).toContain("label: '2v2 Decks'");
    const css = R('src', 'components', 'Dashboard', 'Dashboard.module.css');
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
    /* The dock must be PLACED at this width, not merely absent from a hide
       list: `grid-area: dock` is what says the row exists for it. */
    expect(phone).toContain('grid-area: dock');
    /* And the dock itself must not be hidden at this width. `\s*\{` and not
       `[^{]*\{` deliberately: the loose form also matches
       `.topDock::-webkit-scrollbar { display: none }`, which is the correct
       way to hide a scrollbar and has nothing to do with hiding the dock. It
       failed on exactly that. */
    expect(phone).not.toMatch(/\.topDock\s*\{[^}]*display:\s*none/);
  });

  it('uses its own glyph, not the deck or roster one', () => {
    /* The unit on the board is a PAIR of teammate decks: one card would
       misname it, and two people would name the players instead. */
    expect(dash).toContain('icon: DuoIcon');
    const icons = R('src', 'components', 'Dashboard', 'icons.tsx');
    expect(icons).toContain('export function DuoIcon');
  });
});

describe('the route', () => {
  it('is #/duo, and App.tsx resolves it', () => {
    expect(dash).toContain("hash: '#/duo'");
    expect(app).toContain("if (hash.startsWith('#/duo')) return 'duo';");
  });

  it('is a member of the view union, so a typo cannot compile', () => {
    expect(dash).toMatch(/\|\s*'duo'/);
  });

  it('is lazy, like the other gated tool route', () => {
    expect(dash).toContain("import('../Analytics/DuoDecks/DuoDecks')");
  });

  it('consults the gate under exactly the section name the matrix pins', () => {
    /* One predicate, never a second opinion about what a tier means — and the
       string has to match `ALL_SECTIONS` in `entitlement.test.ts` or the
       matrix is claiming to be exhaustive about a section nobody checks. */
    expect(dash).toContain("sectionAllowed(access, '2v2 Decks')");
    expect(dash).toContain('<GateCard access={access} section="2v2 Decks" />');
  });
});

describe('the page itself', () => {
  it('calls the existing pair API and invents no second one', () => {
    expect(client).toContain('/api/analytics/duo-pairs');
    expect(page).not.toContain('duo-battles');
    expect(page).toContain('fetchDuoPairs');
  });

  it('gives BOTH decks their own copy-link actions', () => {
    /* A 2v2 battle is four players; what is worth recording is which two decks
       were brought together. You take ONE of them into the game, so a single
       action on the pair would have nothing to copy. */
    expect(page).toContain('<DeckActions cards={deck.cardKeys}');
    expect(page).toContain('<Deck deck={pair.deckA}');
    expect(page).toContain('<Deck deck={pair.deckB}');
  });

  it('passes server order through untouched', () => {
    /* `getDeckLinkFromKeys` takes card keys in the order the server arranged
       them, and that order IS the copyDeck slot order. Re-deriving it here
       would hand the game a different deck from the one on screen. */
    expect(page).not.toMatch(/cardKeys[\s.]*(sort|reverse|slice)\(/);
  });

  it('separates the teammates with a plus, never a VS', () => {
    /* Every other VS mark in this project means two sides of a fight, and
       reusing it here would state the opposite of what the row says. */
    expect(page).toContain('styles.plus');
    expect(page).not.toMatch(/deckA[\s\S]{0,200}\bVS\b[\s\S]{0,200}deckB/);
  });

  it('says which population it speaks for', () => {
    /* Per-player detail is kept for a bounded top slice, so a board that did
       not say so reads as a complete census of 2v2, which it is not. */
    expect(page).toContain('populationLimit');
    expect(page).toContain('Population: Top');
  });

  it('sorts, pages and FILTERS on the server', () => {
    /* There are over a million pairs. Filtering what one page returned would
       quietly answer for 25 rows while appearing to answer for the
       collection. */
    expect(page).not.toMatch(/report\.pairs[\s.]*(filter|sort)\(/);
    expect(page).toContain('void load(1, next, sort, per)');
    expect(client).toContain("q.set('cards', cards.join(','))");
  });

  it('filters by picked cards, not by a typed string', () => {
    /* A typed string had to be spelled the way the database spells it —
       `hog-rider` finds 434,265 pairs and `Hog Rider` finds none, which reads
       as "there are no hog rider decks". A picked card cannot be misspelled. */
    expect(page).toContain('<WinConFilter');
    expect(page).not.toContain('placeholder=');
    expect(page).not.toMatch(/type="text"|styles\.search/);
  });

  it('reads the filter back off the response, never off what it sent', () => {
    /* The server drops an unknown key rather than refusing it — the catalog
       moves — so a count line quoting the PICKED list could name a card the
       board is not actually filtered by. */
    expect(page).toContain('report.cards');
    expect(page).not.toMatch(/picked\.length\} picked card/);
  });

  it('shows the measured loading readout while it fetches', () => {
    /* `ReadingState` counts elapsed time against how long this screen took the
       last few times on this browser. Its key is its own: a page of pairs is
       not paced like the Coach's matchup scoring. */
    expect(page).toContain('<ReadingState k="duo-pairs"');
    /* On the FIRST read only. After that a page turn, a pick or a sort dims
       the board in place: the loader replacing it would unmount the pager
       under the pointer that just pressed it. */
    expect(page).toMatch(/\{loading && !report && \(/);
    expect(page).toContain('data-busy={loading || undefined}');
  });

  it('pages with the shared ContinuousPagination, driven by its own page state', () => {
    expect(page).toContain('<ContinuousPagination');
    expect(page).toContain('page={Math.min(page, report.pages)}');
    /* An older, slower answer must not overwrite a newer page. */
    expect(page).toMatch(/if \(id !== seq\.current\) return;/);
  });

  it('does not share a timing key with the chunk that loads it', () => {
    /* `UplinkLoader` records how long it was mounted as a sample under its key
       and the store medians the last five, so a sub-second chunk download and a
       multi-second read sharing a key make both readouts wrong. Team Analysis
       shipped that way — `teams` for both — and its 45s bar was being paced by
       a 13 kB download. */
    expect(dash).toContain('<ReadingState k="duo-chunk"');
    expect(dash).not.toContain('<ReadingState k="duo"');
    const timing = R('src', 'state', 'loadTiming.ts');
    for (const k of ["'duo-chunk'", "'duo-pairs'", "'teams-chunk'"]) {
      expect(timing, `${k} has no seed`).toContain(`${k}:`);
    }
  });

  it('gives every loading state its own key', () => {
    /* One shared key silently averages two different waits. Swept across the
       whole app rather than asserted for this screen alone, because the bug
       that prompted it was in Team Analysis. */
    const files = [
      ['src', 'components', 'Dashboard', 'Dashboard.tsx'],
      ['src', 'components', 'Analytics', 'TeamAnalysis', 'TeamAnalysis.tsx'],
      ['src', 'components', 'Analytics', 'DuoDecks', 'DuoDecks.tsx'],
    ].map((f) => R(...f));
    const keys = files.flatMap((f) =>
      [...f.matchAll(/<ReadingState k="([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(keys).size, keys.join(',')).toBe(keys.length);
  });

  it('spends the whole row on the two decks', () => {
    /* The played / players / first seen / last seen list took about a third of
       the width to restate what the row's POSITION in a ranking already says. */
    expect(page).not.toContain('<dl');
    expect(page).not.toContain('<dt>');
    /* "First seen" survives as a SORT option, which is the ordering and not a
       figure printed against every row — so match the figure, not the words. */
    expect(page).not.toContain('Last seen');
    expect(page).not.toContain('pair.occurrences');
    expect(page).not.toContain('pair.players');
    const css = R('src', 'components', 'Analytics', 'DuoDecks', 'DuoDecks.module.css');
    /* Deck A pinned left, deck B pinned right, the plus between — never a
       bare `1fr`, which a wide child could blow out. */
    expect(css).toMatch(/\.pair \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.deck\[data-align='end'\] \{[^}]*justify-self: end/s);
    /* Eight to a line, so a pair is a strip and many fit on a screen. */
    expect(css).toMatch(/\.cards \{[^}]*repeat\(8, minmax\(0, 1fr\)\)/s);
  });

  it('owns its scroll on a desktop and gives it back on a phone', () => {
    /* `.tool` is `flex: 1; min-height: 0; overflow: hidden` — it CLIPS and
       expects its child to scroll. Team Analysis shipped without this and
       could not be scrolled at all on a desktop. `min-height: 0` is as
       load-bearing as the height. */
    const css = R('src', 'components', 'Analytics', 'DuoDecks', 'DuoDecks.module.css');
    expect(css).toMatch(/\.page \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
    expect(css).toMatch(/@media \(max-width: 62rem\)[\s\S]*\.page \{[^}]*overflow: visible;/);
  });
});
