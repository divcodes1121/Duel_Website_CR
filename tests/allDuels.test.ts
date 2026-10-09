import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CARDS } from '../src/data/cards';
import { buildDuelImport, duelPairs } from '../src/state/duelImport';
import { ADMIN_ONLY_SECTIONS, sectionAllowed } from '../src/state/tiers';
import type { SavedDeckSet } from '../src/types/deck';
import { DUEL_FEED_DAY_PRESETS, DUEL_FEED_DEFAULT_DAYS } from '../src/utils/datePresets';
import {
  DUEL_FEED_DEFAULT_PER_PAGE,
  DUEL_FEED_MAX_CARDS,
  DUEL_FEED_PER_PAGE,
  deckHolds,
  duelAsPlayed,
  duelFeedProblem,
  duelStamp,
  feedCount,
  pageRange,
  parseBattleTime,
  playerLabel,
  shownTag,
  windowDay,
} from '../src/utils/duelFeed';

/* All Duels — every stored duel, newest first, for admins.
 *
 * TWO HALVES. The helpers in `utils/duelFeed.ts` are pure, so they are tested
 * directly. Everything else worth pinning is a fact a careless edit would break
 * without anything failing: that the page is admin-only at every layer, where
 * its one door is, that it offers three windows and the server agrees, and
 * that the heavy lifting stays on the server. This suite runs in `node` with
 * no DOM, so those are read off the source — `duoRoute.test.ts`'s arrangement.
 *
 * Every name and tag below is invented.
 */

/* LINE ENDINGS ARE NORMALISED. Half this tree is CRLF on a Windows checkout,
   and a slice that ends at `indexOf('\n}\n')` finds nothing there, returns -1
   and quietly becomes "the rest of the file" — which contains everything, so
   every `toContain` on it passes. Two checks here were doing exactly that. */
const R = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n');

/** One exported declaration out of a module, from its header to its close. */
function block(src: string, header: string): string {
  const a = src.indexOf(header);
  const b = src.indexOf('\n}\n', a);
  if (a < 0 || b < 0) throw new Error(`block not found: ${header}`);
  return src.slice(a, b + 2);
}

const dash = R('src', 'components', 'Dashboard', 'Dashboard.tsx');
const app = R('src', 'App.tsx');
const menu = R('src', 'components', 'Profile', 'ProfileMenu.tsx');
const page = R('src', 'components', 'Analytics', 'AllDuels', 'AllDuels.tsx');
const css = R('src', 'components', 'Analytics', 'AllDuels', 'AllDuels.module.css');
const client = R('src', 'state', 'analyticsClient.ts');
const feedPy = R('server', 'duel_feed.py');
const appPy = R('server', 'app.py');

describe('the windows', () => {
  it('are 30, 60 and 90 days, and nothing else', () => {
    expect([...DUEL_FEED_DAY_PRESETS]).toEqual([30, 60, 90]);
    expect(DUEL_FEED_DEFAULT_DAYS).toBe(30);
  });

  it('are the ones the server accepts', () => {
    /* The server answers any other value with its default, so a fourth chip
       here would silently show the 30-day list under a different label. */
    const days = /^DAYS = \(([^)]*)\)/m.exec(feedPy)?.[1].split(',').map((s) => Number(s.trim()));
    expect(days).toEqual([...DUEL_FEED_DAY_PRESETS]);
    expect(Number(/^DEFAULT_DAYS = (\d+)/m.exec(feedPy)?.[1])).toBe(DUEL_FEED_DEFAULT_DAYS);
  });

  it('are drawn from the shared list, one chip each', () => {
    expect(page).toContain('DUEL_FEED_DAY_PRESETS.map');
    expect(page).not.toMatch(/\[\s*30\s*,\s*60\s*,\s*90\s*\]/);
    expect(page).toContain('aria-pressed={days === d}');
  });
});

describe('page sizes', () => {
  it('open on ten, and none is past the server cap', () => {
    const cap = Number(/^MAX_PER_PAGE = (\d+)/m.exec(feedPy)?.[1]);
    expect(DUEL_FEED_PER_PAGE).toContain(DUEL_FEED_DEFAULT_PER_PAGE);
    expect(Math.max(...DUEL_FEED_PER_PAGE)).toBeLessThanOrEqual(cap);
    expect(Number(/^PER_PAGE = (\d+)/m.exec(feedPy)?.[1])).toBe(DUEL_FEED_DEFAULT_PER_PAGE);
  });

  it('the filter takes as many cards as the server will read', () => {
    const duo = R('server', 'duo_pairs.py');
    expect(Number(/^MAX_FILTER_CARDS = (\d+)/m.exec(duo)?.[1])).toBe(DUEL_FEED_MAX_CARDS);
    expect(feedPy).toContain('from duo_pairs import valid_cards');
  });
});

describe('battle times', () => {
  it('parse Supercell stamps as UTC', () => {
    expect(parseBattleTime('20261005T024430.000Z')?.toISOString()).toBe('2026-10-05T02:44:30.000Z');
  });

  it('refuse anything else rather than guess', () => {
    for (const bad of ['', null, undefined, '2026-10-05', 'yesterday', '20261305T000000.000Z'.slice(0, 7)]) {
      expect(parseBattleTime(bad as string)).toBeNull();
    }
  });

  it('print with the year, and fall back to the raw text', () => {
    expect(duelStamp('20261005T024430.000Z')).toMatch(/\b2026\b/);
    expect(duelStamp('20261005T024430.000Z')).toMatch(/\d{2}:\d{2}$/);
    expect(duelStamp('not a stamp')).toBe('not a stamp');
    expect(duelStamp(null)).toBe('—');
  });

  it('print a window day in UTC, whatever the reader’s zone', () => {
    // ICU spells September "Sep" or "Sept" depending on its version.
    expect(windowDay('2026-09-06')).toMatch(/^6 Sept? 2026$/);
    expect(windowDay('2026-01-01')).toMatch(/^1 Jan 2026$/);
    expect(windowDay(null)).toBe('—');
  });
});

describe('who a player is called', () => {
  it('their name when one is stored', () => {
    expect(playerLabel({ tag: '#ABC001', name: 'Ada' })).toBe('Ada');
  });

  it('their tag when none is — and a blank name is none', () => {
    expect(playerLabel({ tag: '#ABC001', name: null })).toBe('#ABC001');
    expect(playerLabel({ tag: 'ABC001', name: '   ' })).toBe('#ABC001');
  });

  it('tags are shown the way a player types them', () => {
    expect(shownTag('ABC001')).toBe('#ABC001');
    expect(shownTag('#ABC001')).toBe('#ABC001');
    expect(shownTag('')).toBe('');
  });

  it('the screen prints the tag under a NAME only, never twice', () => {
    expect(page).toContain('{player.name && tag && <span className={styles.tag}>{tag}</span>}');
  });
});

describe('marking the deck that matched', () => {
  const deck = ['hog-rider', 'musketeer', 'cannon', 'fireball', 'the-log', 'ice-spirit', 'skeletons', 'valkyrie'];

  it('a deck holding every picked card is the match', () => {
    expect(deckHolds(deck, ['hog-rider'])).toBe(true);
    expect(deckHolds(deck, ['hog-rider', 'fireball'])).toBe(true);
  });

  it('one missing card is not', () => {
    expect(deckHolds(deck, ['hog-rider', 'golem'])).toBe(false);
  });

  it('whole keys only', () => {
    expect(deckHolds(['royal-giant'], ['giant'])).toBe(false);
  });

  it('nothing picked marks nothing', () => {
    expect(deckHolds(deck, [])).toBe(false);
  });

  it('is asked about what the SERVER filtered by', () => {
    /* An unknown key is dropped by the server, so marking by the picked list
       could ring decks for a card the page is not filtered by. */
    expect(page).toContain('const accepted = report?.cards ?? [];');
    expect(page).toContain('picked={accepted}');
  });
});

describe('which duels: friendly ones that went to three games', () => {
  /* Asked for after the first build went live with every native duel on it:
     "war duels we don't need, only friendly ones, that too which are played
     all 3 battles". The rule is the SERVER's — two constants in
     `duel_feed.py` — and the screen's only job is to say it truthfully. */
  it('the server lists friendly duels of three games, and nothing else can be asked for', () => {
    expect(/^MODE = "([^"]+)"/m.exec(feedPy)?.[1]).toBe('duel_1v1_friendly');
    expect(Number(/^GAMES = (\d+)/m.exec(feedPy)?.[1])).toBe(3);
    expect(feedPy).toContain('mode=MODE, games=GAMES');
    // Neither is a query parameter: the client could not widen the list.
    expect(block(client, 'export function fetchDuelFeed')).not.toMatch(/mode|games/);
  });

  it('the count line says so, in the words the rule is in', () => {
    const line = feedCount({ total: 1169, windowDuels: 1169, cards: [] });
    expect(line).toBe('1,169 friendly duels played to three games');
    // Held to the constants: change the rule and this wording is wrong.
    expect(line).toContain('friendly');
    expect(line).toContain('three games');
  });

  it('a row carries no mode label — they are all the same kind', () => {
    expect(page).not.toContain('modeLabel');
    expect(page).not.toContain('styles.mode');
    expect(css).not.toMatch(/^\.mode \{/m);
    // Scoped to this screen's type: the battle log has a `modeLabel` of its own.
    expect(block(client, 'export interface DuelFeedDuel')).not.toContain('modeLabel');
  });

  it('and no figure that is always three times another', () => {
    expect(block(client, 'export interface DuelFeedReport')).not.toContain('windowGames');
    expect(block(client, 'export interface DuelFeedReport')).toContain('windowDuels');
    expect(feedPy).not.toContain('windowGames');
  });
});

describe('the count line', () => {
  it('filtered: how many of the window', () => {
    expect(feedCount({ total: 37, windowDuels: 3046, cards: ['minion-giant'] })).toBe(
      '37 of 3,046 friendly duels played to three games',
    );
  });

  it('counts one as one', () => {
    expect(feedCount({ total: 1, windowDuels: 1, cards: [] })).toBe('1 friendly duel played to three games');
    expect(feedCount({ total: 0, windowDuels: 1, cards: ['x-bow'] })).toBe(
      '0 of 1 friendly duel played to three games',
    );
  });

  it('the footer says which rows these are', () => {
    expect(pageRange({ page: 1, perPage: 10, total: 1169 })).toBe('1–10 of 1,169');
    expect(pageRange({ page: 117, perPage: 10, total: 1169 })).toBe('1,161–1,169 of 1,169');
    expect(pageRange({ page: 1, perPage: 10, total: 0 })).toBe('');
  });
});

describe('a refusal is worded', () => {
  it('each of the admin gate’s answers gets its own sentence', () => {
    const said = ['unauthorized', 'forbidden', 'not_configured', 'unavailable'].map((c) =>
      duelFeedProblem('server', c),
    );
    expect(new Set(said).size).toBe(4);
    expect(duelFeedProblem('server', 'forbidden')).toMatch(/not an admin/);
  });

  it('an undeployed server half says so', () => {
    expect(duelFeedProblem('not_found', '')).toMatch(/not been deployed/);
  });

  it('never prints a raw reason code or a status', () => {
    expect(duelFeedProblem('server', 'Request failed (500)')).not.toMatch(/500|Request failed/);
    expect(duelFeedProblem('server', 'server_error')).not.toContain('server_error');
  });
});

describe('admin only, at every layer', () => {
  it('sits on the admin shelf', () => {
    expect([...ADMIN_ONLY_SECTIONS]).toContain('All Duels');
    expect(sectionAllowed('admin', 'All Duels')).toBe(true);
    expect(sectionAllowed('pro', 'All Duels')).toBe(false);
  });

  it('the shell asks the gate under exactly that name', () => {
    expect(dash).toContain("sectionAllowed(access, 'All Duels')");
  });

  it('a non-admin is refused, not offered a subscription', () => {
    /* Every other closed area draws a GateCard, because signing in or paying
       opens it. Nothing opens this one. */
    expect(dash).not.toContain('section="All Duels"');
    expect(dash).toContain('<h2>Admins only</h2>');
  });

  it('nobody is judged before their account has arrived', () => {
    /* `ready` is true before the profile lands and the tier is `free` until
       it does, so an admin would be told the page is not theirs for a beat. */
    const block = dash.slice(dash.indexOf("{view === 'allduels' &&"));
    expect(block.indexOf('!accountResolved')).toBeGreaterThan(-1);
    expect(block.indexOf('!accountResolved')).toBeLessThan(block.indexOf("sectionAllowed(access, 'All Duels')"));
  });

  it('the data is asked for with the admin token', () => {
    expect(client).toContain('/api/analytics/admin/duels?');
    expect(page).toContain('const token = await coachToken();');
    expect(block(client, 'export function fetchDuelFeed')).toContain("'X-Coach-Token': token");
  });

  it('the server route is behind the admin gate and enrols nobody', () => {
    const a = appPy.indexOf('if path == "/api/analytics/admin/duels":');
    const block = appPy.slice(a, appPy.indexOf('if path', a + 10));
    expect(block.indexOf('admin_auth.verify(')).toBeGreaterThan(-1);
    expect(block.indexOf('admin_auth.verify(')).toBeLessThan(block.indexOf('duel_feed.report('));
    expect(block).not.toContain('_note_tag');
  });

  it('is its own lazy chunk, so no other visitor downloads it', () => {
    expect(dash).toContain("import('../Analytics/AllDuels/AllDuels')");
    expect(dash).not.toMatch(/^import \{[^}]*AllDuels[^}]*\} from/m);
  });
});

describe('the one door', () => {
  it('is the profile menu, drawn for an admin only', () => {
    const row = menu.slice(menu.indexOf('href="#/all-duels"') - 400, menu.indexOf('href="#/all-duels"') + 200);
    expect(row).toContain("{tier === 'admin' && (");
    expect(row).toContain('All Duels');
  });

  it('App.tsx resolves the route into the shell', () => {
    expect(app).toContain("if (hash.startsWith('#/all-duels')) return 'allduels';");
    expect(dash).toMatch(/\|\s*'allduels'/);
  });

  it('is not in the dock, the rail or the landing strip', () => {
    /* Those are what every visitor sees. */
    const topNav = dash.slice(dash.indexOf('const TOP_NAV = ['));
    expect(topNav.slice(0, topNav.indexOf('] as const;'))).not.toContain('All Duels');
    const sideNav = dash.slice(dash.indexOf('const SIDE_NAV = ['));
    expect(sideNav.slice(0, sideNav.indexOf('] as const;'))).not.toContain('All Duels');
    expect(dash).toContain('items={[...AREAS, TEAM_CARD, DUO_CARD].map(');
  });

  it('the palette offers it to admins only', () => {
    const cmd = dash.indexOf("id: 'tool-all-duels'");
    expect(cmd).toBeGreaterThan(-1);
    expect(dash.slice(dash.lastIndexOf('...(access ===', cmd), cmd)).toContain("access === 'admin'");
  });
});

describe('the screen', () => {
  it('filters, pages and windows on the SERVER', () => {
    /* There are thousands of duels in a window. Filtering what one page
       returned would answer for ten of them while looking like an answer for
       all. */
    expect(page).not.toMatch(/report\.duels[\s.]*(filter|sort|slice)\(/);
    expect(page).toContain('void load(1, next, days, per)');
    expect(page).toContain('void load(1, picked, d, per)');
  });

  it('every control goes back to page 1', () => {
    const calls = [...page.matchAll(/void load\(([^,]+),/g)].map((m) => m[1].trim());
    // Only the pager's own call carries a page other than 1.
    expect(calls.filter((c) => c !== '1')).toEqual(['p']);
  });

  it('picks cards rather than typing them', () => {
    expect(page).toContain('<WinConFilter');
    expect(page).not.toContain('placeholder=');
    expect(page).not.toContain('<select');
    expect(page).not.toContain('<input');
  });

  it('draws both players through one component, and each game’s crowns for both', () => {
    expect(page).toContain('<Player player={duel.a} side="a"');
    expect(page).toContain('<Player player={duel.b} side="b"');
    expect(page).toContain('<Crowns n={game.a.crowns} side="a"');
    expect(page).toContain('<Crowns n={game.b.crowns} side="b"');
  });

  it('marks the winner instead of leaving it to which side is on the left', () => {
    /* Side `a` is the lexically first tag — nobody in particular. */
    expect(page).toContain("won={duel.winner === 'a'}");
    expect(page).toContain("won={duel.winner === 'b'}");
    expect(page).toContain('{won && <span className={styles.winner}>Winner</span>}');
  });

  it('passes the server’s card order and forms through untouched', () => {
    expect(page).not.toMatch(/deck\.cards[\s.]*(sort|reverse|slice)\(/);
    expect(page).toContain('variant={deck.art?.[c]}');
    expect(page).toContain('inferred={deck.artInferred}');
    expect(page).toContain('<DeckActions');
  });

  it('keeps the list on screen while a newer page is read', () => {
    expect(page).toContain('<ReadingState k="all-duels"');
    expect(page).toMatch(/\{loading && !report && !error && \(/);
    expect(page).toContain('data-busy={loading || undefined}');
    expect(page).toMatch(/if \(id !== seq\.current\) return;/);
    expect(page).toContain('page={Math.min(page, report.pages)}');
  });

  it('does not share a timing key with the chunk that loads it', () => {
    expect(dash).toContain('<ReadingState k="all-duels-chunk"');
    const timing = R('src', 'state', 'loadTiming.ts');
    for (const k of ["'all-duels-chunk'", "'all-duels'"]) expect(timing, k).toContain(`${k}:`);
    const keys = [dash, page].flatMap((f) => [...f.matchAll(/<ReadingState k="([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(keys).size, keys.join(',')).toBe(keys.length);
  });

  it('prints figures and names, not an explanation of them', () => {
    /* The standing rule: a screen shows the result. Where the duels come
       from, which side is which and how the forms were read are in the README
       and the module docstrings. */
    const jsx = page.slice(page.indexOf('export function AllDuels'));
    const prose = [...jsx.matchAll(/>\s*([A-Z][^<>{}]{60,})\s*</g)].map((m) => m[1]);
    expect(prose).toEqual([]);
  });
});

describe('the layout', () => {
  it('never uses a bare 1fr for the two sides', () => {
    /* `1fr` is `minmax(auto, 1fr)`: a long name or a wide strip pushes the
       grid past its card without anything inside appearing to overflow. */
    expect(css).toMatch(/\.players \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
    expect(css).toMatch(/@container duels \(min-width: 46rem\) \{\s*\.game \{[^}]*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
    expect(css).not.toMatch(/grid-template-columns:\s*1fr/);
  });

  it('stacks a game on a narrow list and puts it abreast on a wide one', () => {
    expect(css).toMatch(/\.game \{[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
    expect(css).toMatch(/\.list \{[^}]*container: duels \/ inline-size;/s);
  });

  it('draws eight cards to a line', () => {
    expect(css).toMatch(/\.cards \{[^}]*repeat\(8, minmax\(0, 1fr\)\)/s);
  });

  it('pins each deck to its own player’s edge when abreast', () => {
    expect(css).toMatch(/\.deck\[data-side='a'\] \{[^}]*justify-self: start/s);
    expect(css).toMatch(/\.deck\[data-side='b'\] \{[^}]*justify-self: end/s);
  });

  it('owns its scroll on a desktop and gives it back on a phone', () => {
    expect(css).toMatch(/\.page \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
    expect(css).toMatch(/@media \(max-width: 62rem\)[\s\S]*\.page \{[^}]*overflow: visible;/);
  });

  it('greys nothing: the loser’s score is lighter in weight, not in colour', () => {
    expect(css).toMatch(/\.scoreNum \{[^}]*color: var\(--text\)/s);
    expect(css).not.toMatch(/opacity:\s*0\.[5-8]\d*;/);
    expect(css).not.toContain('scrollbar-color');
    expect(css).not.toMatch(/scrollbar-width:\s*thin/);
  });

  it('uses only classes its stylesheet defines', () => {
    /* `styles.x` for a class that does not exist is `undefined`: the element
       renders class-less and nothing errors. */
    const used = new Set([...page.matchAll(/styles\.([A-Za-z0-9]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
    expect(missing).toEqual([]);
  });
});

describe('saving a duel into the builder', () => {
  /* Asked for after the list went live: "also add save duel option so I can
     directly save it". It is the Duel Zone's Save duel — the same store
     action, the same duplicate rule — and the one thing this screen has to
     decide for itself is WHO IS BLUE, because the Duel Zone's save assumes a
     searched player and this list has none. */
  const KEYS = CARDS.map((c) => c.key);
  /** Eight distinct real cards starting at `n`. */
  const deck = (n: number) => Array.from({ length: 8 }, (_, i) => KEYS[(n * 8 + i) % KEYS.length]);
  const side = (n: number, crowns: number, art?: Record<string, 'evolution' | 'hero'>) => ({
    cards: deck(n),
    art,
    crowns,
  });
  const duel = {
    games: [
      { a: side(0, 1), b: side(3, 3) },
      { a: side(1, 2), b: side(4, 0) },
      { a: side(2, 0), b: side(5, 1) },
    ],
  };
  const filled = (s?: { decks: { slots: (string | null)[] }[] }) =>
    s?.decks.filter((d) => d.slots.some(Boolean)) ?? [];

  it('the left player becomes Blue and the right one Red, as they are drawn', () => {
    const played = duelAsPlayed(duel);
    expect(played.map((g) => g.cards)).toEqual([deck(0), deck(1), deck(2)]);
    expect(played.map((g) => g.opponent.cards)).toEqual([deck(3), deck(4), deck(5)]);
    const { entry } = buildDuelImport(played, []);
    expect(entry?.mode).toBe('versus');
    expect(filled(entry?.blue).map((d) => d.slots)).toEqual([deck(0), deck(1), deck(2)]);
    expect(filled(entry?.red).map((d) => d.slots)).toEqual([deck(3), deck(4), deck(5)]);
  });

  it('a three-game duel is three decks a side, in game order, named for their games', () => {
    const { outcome, entry } = buildDuelImport(duelAsPlayed(duel), []);
    expect(outcome).toMatchObject({ ok: true, games: 3, name: 'Duel Deck 1' });
    expect(filled(entry?.blue).map((d) => d.name)).toEqual(['G1', 'G2', 'G3']);
    expect(filled(entry?.red)).toHaveLength(3);
  });

  it('each deck keeps the crowns its player took in that game', () => {
    const { entry } = buildDuelImport(duelAsPlayed(duel), []);
    expect(filled(entry?.blue).map((d) => d.crowns)).toEqual([1, 2, 0]);
    expect(filled(entry?.red).map((d) => d.crowns)).toEqual([3, 0, 1]);
  });

  it('the cards go in the order the server seated them — nothing is re-sorted', () => {
    const seated = [...deck(7)].reverse();
    const { entry } = buildDuelImport(
      duelAsPlayed({ games: [{ a: { cards: seated, crowns: 0 }, b: side(8, 1) }] }),
      [],
    );
    expect(filled(entry?.blue)[0].slots).toEqual(seated);
  });

  it('a hero fielded in the wild slot is saved as a hero, for either player', () => {
    /* Four cards have both forms and the builder draws the wild slot as an
       evolution unless told otherwise. */
    const rest = KEYS.filter((k) => k !== 'knight');
    const withKnight = [rest[0], rest[1], 'knight', ...rest.slice(2, 7)];
    const art = { knight: 'hero' as const };
    const { entry } = buildDuelImport(
      duelAsPlayed({
        games: [{ a: { cards: withKnight, art, crowns: 0 }, b: { cards: withKnight, art, crowns: 1 } }],
      }),
      [],
    );
    expect(filled(entry?.blue)[0].wildVariant).toBe('hero');
    expect(filled(entry?.red)[0].wildVariant).toBe('hero');
  });

  it('the same duel is not saved twice, and says what it was saved as', () => {
    const first = buildDuelImport(duelAsPlayed(duel), []);
    const library = [first.entry as SavedDeckSet];
    expect(buildDuelImport(duelAsPlayed(duel), library).outcome).toEqual({
      ok: false,
      reason: 'duplicate',
      name: 'Duel Deck 1',
      swapped: false,
    });
    // A different duel takes the next name.
    const other = { games: [{ a: side(9, 2), b: side(10, 1) }] };
    expect(buildDuelImport(duelAsPlayed(other), library).outcome).toMatchObject({
      ok: true,
      name: 'Duel Deck 2',
    });
  });

  it('a duel saved from the right-hand player’s Duel Zone is already saved here', () => {
    /* The Duel Zone puts the SEARCHED player on blue; this list puts side `a`
       there. Searching the right-hand player and saving writes the same decks
       the other way round, and that is the same set. */
    const fromTheirZone = duel.games.map((g) => ({
      cards: g.b.cards,
      playerCrowns: g.b.crowns,
      opponentCrowns: g.a.crowns,
      opponent: { cards: g.a.cards },
    }));
    const first = buildDuelImport(fromTheirZone, []);
    expect(buildDuelImport(duelAsPlayed(duel), [first.entry as SavedDeckSet]).outcome).toEqual({
      ok: false,
      reason: 'duplicate',
      name: 'Duel Deck 1',
      swapped: true,
    });
  });

  it('every game of a listed duel can be built', () => {
    expect(duelPairs(duelAsPlayed(duel))).toHaveLength(3);
  });

  it('a deck holding a card this build does not know leaves the duel short', () => {
    const odd = { games: [...duel.games, { a: { cards: [...deck(6).slice(0, 7), 'not-a-card'], crowns: 0 }, b: side(11, 1) }] };
    expect(duelPairs(duelAsPlayed(odd))).toHaveLength(3);
    expect(odd.games).toHaveLength(4);
  });

  const save = block(page, 'function SaveDuel(');

  it('the screen saves through the store action the Duel Zone uses', () => {
    expect(save).toContain('useBuilderStore((s) => s.saveDuelPlayed)');
    expect(save).toContain('onClick={() => saveDuelPlayed(games, limit)}');
    expect(R('src', 'components', 'Analytics', 'DuelZone.tsx')).toContain('saveDuelPlayed(series.games, limit)');
  });

  it('every duel carries the button, in its head', () => {
    expect(page).toMatch(/<time className=\{styles\.when\}>[^\n]*\n\s*<SaveDuel duel=\{duel\} \/>/);
  });

  it('whether a duel is saved is read from the library, not remembered by the row', () => {
    /* A flag in the component forgets on the next page turn and the row then
       offers to save a duel that is already in the builder. */
    expect(save).toContain('useBuilderStore((s) => s.library)');
    expect(save).toContain('buildDuelImport(games, library, limit)');
    expect(save).not.toContain('useState');
  });

  it('the Duel Zone asks the library too, so a duel saved elsewhere says so before a press', () => {
    /* It used to remember only its own press: a duel saved yesterday, or from
       the other player's Duel Zone, still offered the button. */
    const zone = block(R('src', 'components', 'Analytics', 'DuelZone.tsx'), 'function SaveDuelButton(');
    expect(zone).toContain('useBuilderStore((s) => s.library)');
    expect(zone).toContain('buildDuelImport(series.games, library, limit)');
    expect(zone).toContain('as {saved.name}');
  });

  it('both screens pass the reader’s saved-set limit, and say when it is reached', () => {
    /* 1,000 for everyone, none for an admin (`savedSetLimit`). The limit comes
       from one hook, and a screen that forgot it would save a set the account
       then refuses to sync. */
    const zone = block(R('src', 'components', 'Analytics', 'DuelZone.tsx'), 'function SaveDuelButton(');
    for (const src of [save, zone]) {
      expect(src).toContain('const limit = useSavedSetLimit();');
      expect(src).toContain('savedSetsFull(limit)');
    }
    const dialog = R('src', 'components', 'Library', 'SaveDialog.tsx');
    expect(dialog).toContain('const limit = useSavedSetLimit();');
    expect(dialog).toContain('saveCurrent(name, limit)');
    expect(dialog).toContain('disabled={full}');
  });

  it('both screens say when the saved set is the other way round', () => {
    const zone = block(R('src', 'components', 'Analytics', 'DuelZone.tsx'), 'function SaveDuelButton(');
    for (const src of [save, zone]) {
      expect(src).toContain('title={saved.swapped ? SWAPPED_NOTE : undefined}');
    }
  });

  it('it will not save part of a duel', () => {
    expect(save).toContain('duelPairs(games).length === duel.games.length');
    expect(save).toContain('disabled={!whole || full}');
  });
});
