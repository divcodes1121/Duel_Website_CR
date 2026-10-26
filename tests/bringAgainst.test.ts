import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRING_VIEWS,
  CHIP_OK,
  MAX_BALANCE_MARKS,
  MAX_CHIPS,
  balanceChips,
  chipLabels,
  closestPill,
  familyChips,
  patchDay,
  playsTitle,
  recentTitle,
  shareLabel,
  windowLabel,
  windowTitle,
} from '../src/utils/bringAgainst';

/* "Bring this against them" (the Deck Counter) and the per-archetype chips
   Team Analysis draws under every suggested deck.

   The figures come from the server (`team_analysis.bring`, brain 3.0) and have
   their own suites there. What is pinned here is what the client decides: the
   order and the limit of the chips, that an unmeasured matchup is left out
   rather than drawn as 50, and — by reading the sources — that both screens
   draw the same engine's rows and add no prose to them. */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

const PLAYS = [
  { family: 'giant', name: 'Giant' },
  { family: 'bridge-spam', name: 'Bridge Spam' },
  { family: 'other:minion-giant', name: 'Minion Giant' },
];

describe('a share of their games', () => {
  it('is a whole percentage', () => {
    expect(shareLabel(0.786)).toBe('79%');
    expect(shareLabel(1)).toBe('100%');
  });
  it('is never 0% for something they do play', () => {
    expect(shareLabel(0.004)).toBe('<1%');
    expect(shareLabel(0)).toBe('0%');
  });
});

describe('what they are likely to bring (brain 4.0)', () => {
  it('a family’s tooltip is the history its chance was read from', () => {
    expect(playsTitle({ games: 400, decks: 3, played: 0.94, duelGames: 0 })).toBe(
      '94% of their games · 400 games · 3 lists',
    );
    expect(playsTitle({ games: 20, decks: 1, played: 0.047, duelGames: 6 })).toBe(
      '5% of their games · 20 games · 1 list · 6 duel games',
    );
  });

  it('a duel deck from before the window is none of their games, and says so', () => {
    expect(playsTitle({ games: 0, decks: 1, played: 0, duelGames: 1 })).toBe(
      '0% of their games · 0 games · 1 list · 1 duel game',
    );
  });

  it('a server before 4.0 sends no history share and the tooltip still reads', () => {
    expect(playsTitle({ games: 80, decks: 2 })).toBe('80 games · 2 lists');
  });
});

describe('the balance marks on a deck', () => {
  const nameOf = (k: string) => ({ 'royal-ghost': 'Royal Ghost', wizard: 'Wizard' })[k] ?? k;

  it('a patch day is short and human', () => {
    expect(patchDay('2026-10-06')).toBe('6 Oct');
    expect(patchDay('2026-01-31')).toBe('31 Jan');
    expect(patchDay('soon')).toBe('soon');
    expect(patchDay('2026-13-01')).toBe('2026-13-01');
  });

  it('a deck with nothing changed draws nothing', () => {
    expect(balanceChips({}, nameOf)).toEqual([]);
    expect(balanceChips({ balance: [] }, nameOf)).toEqual([]);
  });

  it('a nerf says what, and when', () => {
    const [m] = balanceChips(
      { balance: [{ card: 'royal-ghost', kind: 'nerf', form: 'base', date: '2026-10-06' }] },
      nameOf,
    );
    expect(m).toEqual({
      card: 'royal-ghost',
      kind: 'nerf',
      glyph: '▼',
      title: 'Royal Ghost — Nerfed 6 Oct',
    });
  });

  it('a form that is not the base card is named', () => {
    const [m] = balanceChips(
      { balance: [{ card: 'wizard', kind: 'buff', form: 'evolution', date: '2026-09-08' }] },
      nameOf,
    );
    expect(m.title).toBe('Wizard (evolution) — Buffed 8 Sep');
    expect(m.glyph).toBe('▲');
  });

  it('nerfs lead (they are in the figure), and the row is capped', () => {
    const marks = balanceChips(
      {
        balance: [
          { card: 'a', kind: 'buff', form: 'base', date: '2026-10-06' },
          { card: 'b', kind: 'nerf', form: 'base', date: '2026-09-16' },
          { card: 'c', kind: 'rework', form: 'base', date: '2026-10-06' },
          { card: 'd', kind: 'nerf', form: 'base', date: '2026-10-06' },
        ],
      },
      nameOf,
    );
    expect(marks).toHaveLength(MAX_BALANCE_MARKS);
    expect(marks.map((m) => m.card)).toEqual(['d', 'b']);
  });

  it('the caller’s list is not reordered', () => {
    const balance = [
      { card: 'a', kind: 'buff' as const, form: 'base' as const, date: '2026-10-06' },
      { card: 'b', kind: 'nerf' as const, form: 'base' as const, date: '2026-10-06' },
    ];
    balanceChips({ balance }, nameOf);
    expect(balance.map((m) => m.card)).toEqual(['a', 'b']);
  });
});

describe('the chips under a deck', () => {
  it('run in THEIR order of play, not the deck’s', () => {
    const chips = familyChips({ vs: { 'bridge-spam': 44, giant: 71.4, 'other:minion-giant': 60 } }, PLAYS);
    expect(chips.map((c) => c.name)).toEqual(['Giant', 'Bridge Spam', 'Minion Giant']);
    expect(chips.map((c) => c.rate)).toEqual([71.4, 44, 60]);
  });

  it('a matchup with no measured rate is left out, never drawn as 50', () => {
    const chips = familyChips({ vs: { giant: 71 } }, PLAYS);
    expect(chips).toHaveLength(1);
    expect(chips[0].family).toBe('giant');
    expect(familyChips({}, PLAYS)).toEqual([]);
  });

  it('a matchup won and a matchup lost are told apart at 50', () => {
    const chips = familyChips({ vs: { giant: CHIP_OK, 'bridge-spam': CHIP_OK - 0.1 } }, PLAYS);
    expect(chips.map((c) => c.ok)).toEqual([true, false]);
  });

  it('the family a deck is the list’s answer to is marked', () => {
    const chips = familyChips({ vs: { giant: 70, 'bridge-spam': 80 }, answers: ['bridge-spam'] }, PLAYS);
    expect(chips.map((c) => c.answer)).toEqual([false, true]);
  });

  it('a per-archetype list skips the family its figure already is', () => {
    const chips = familyChips({ vs: { giant: 70, 'bridge-spam': 80 } }, PLAYS, 'giant');
    expect(chips.map((c) => c.family)).toEqual(['bridge-spam']);
  });

  it('are at most MAX_CHIPS, the most played first (ten since brain 7.0)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ family: `f${i}`, name: `F${i}` }));
    const vs = Object.fromEntries(many.map((p) => [p.family, 60]));
    const chips = familyChips({ vs }, many);
    expect(MAX_CHIPS).toBe(10);
    expect(chips).toHaveLength(MAX_CHIPS);
    expect(chips.map((c) => c.family)).toEqual(many.slice(0, 10).map((p) => p.family));
  });
});

describe('which archetypes a Team Analysis folder labels', () => {
  it('what they play, by family, when the server sends it', () => {
    expect(chipLabels({ plays: PLAYS, squadCover: [{ archetype: 'x', name: 'X' }] })).toEqual([
      ['giant', 'Giant'],
      ['bridge-spam', 'Bridge Spam'],
      ['other:minion-giant', 'Minion Giant'],
    ]);
  });
  it('a squad plan’s cover from a server before brain 3.0', () => {
    expect(chipLabels({ squadCover: [{ archetype: 'hog', name: 'Hog Rider' }] })).toEqual([['hog', 'Hog Rider']]);
  });
  it('nothing when the server sent neither', () => {
    expect(chipLabels({})).toBeUndefined();
    expect(chipLabels({ plays: [], squadCover: [] })).toBeUndefined();
  });
});

describe('the Deck Counter’s list is the scouting engine’s', () => {
  const counter = read('src/components/Analytics/DeckCounter.tsx');
  const block = read('src/components/Analytics/BringAgainst.tsx');
  const folders = read('src/components/Analytics/TeamAnalysis/TeamFolders.tsx');

  it('three readings of one pool, in this order', () => {
    expect(BRING_VIEWS.map((v) => v.id)).toEqual(['best', 'family', 'card']);
  });

  it('the screen draws `bring` and keeps the old list only for an older server', () => {
    expect(counter).toMatch(/report\.bring \? \(\s*<BringAgainst bring=\{report\.bring\} \/>/);
    expect(counter).toMatch(/<MatchupList rows=\{report\.recommended\} showYours/);
  });

  it('the card view is offered only when the server sent one', () => {
    expect(block).toMatch(/BRING_VIEWS\.filter\(\(v\) => v\.id !== 'card' \|\| bring\.byCard\)/);
  });

  it('the strip says what they are LIKELY TO BRING, with the history as its tooltip', () => {
    expect(block).toContain('<li className={styles.playsLabel}>Likely to bring</li>');
    expect(block).toMatch(/title=\{playsTitle\(p\)\}/);
    expect(block).not.toContain('>They play<');
    // Team Analysis heads the bars the right-hand side was scored against.
    expect(folders).toContain('<h4 className={styles.boardTitle}>Likely to bring</h4>');
  });

  it('a balance change is the figure’s tooltip on both screens, never a mark on the row', () => {
    expect(block).toMatch(/balanceChips\(deck, cardName\)/);
    expect(folders).toMatch(/balanceChips\(rec, /);
    expect(block).toMatch(/\[figureTitle, recentTitle\(deck\.recent\), \.\.\.changed\.map\(\(m\) => m\.title\)\]/);
    expect(block).not.toContain('styles.balance');
    expect(folders).not.toContain('styles.recBalance');
  });

  it('a group with no counter says so instead of padding the list', () => {
    expect(block).toContain('Nothing in the pool beats it at 55%.');
  });

  it('every deck is drawn seated, by the rule the server seats with', () => {
    expect(block).toMatch(/drawnDeck\(deck\.cards, deck\.art, deck\.artInferred, deck\.artFilled\)/);
  });

  it('Team Analysis labels its chips from what they play, in BOTH modes', () => {
    expect(folders).toMatch(/const labels: \[string, string\]\[\] \| undefined = chipLabels\(folder\);/);
    // The scouting list and the roster-wide list pass them too — they drew no
    // chips at all before, so a scouting row showed one weighted figure only.
    expect(folders).toMatch(/<Recommendation key=\{`\$\{r\.archetype\}-\$\{i\}`\} rec=\{r\} rank=\{i \+ 1\} labels=\{labels\} \/>/);
    expect(folders).toMatch(/labels=\{chipLabels\(overall\)\}/);
  });

  it('adds no prose: no provenance, no "how this was ranked"', () => {
    for (const banned of [
      'because',
      'ranked by',
      'Ranked from',
      'pilots',
      'held-out',
      'evidence',
      'confidence',
      'the engine',
      'measured on',
    ]) {
      // Comments explain; the strings a reader sees must not.
      const visible = block
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(visible.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe('the day window reaches the suggestions (2026-10-11)', () => {
  const block = read('src/components/Analytics/BringAgainst.tsx');
  const folders = read('src/components/Analytics/TeamAnalysis/TeamFolders.tsx');
  const screen = read('src/components/Analytics/TeamAnalysis/TeamAnalysis.tsx');
  const WINDOW = {
    days: 7,
    applied: true,
    reason: null,
    pool: 786,
    kept: 543,
    minGames: 5,
    previousDays: 60,
    notPlayed: 30,
    fading: 213,
  } as const;

  it('says how many of the pool were played in the days picked', () => {
    expect(windowLabel(WINDOW)).toBe('543 of 786 decks in play · last 7 days');
    expect(windowLabel({ ...WINDOW, pool: 2341, kept: 1602 })).toBe(
      '1,602 of 2,341 decks in play · last 7 days',
    );
  });

  it('brain 5.0: the pool line says what the pool holds and over which days', () => {
    const POOL = {
      days: 30, from: '2026-09-15', to: '2026-10-14', group: 'crl',
      crlLists: 462, crlGames: 2693, metaLists: 40,
    } as unknown as Parameters<typeof windowLabel>[0];
    expect(windowLabel(POOL)).toBe('462 CRL duel lists + 40 meta lists · last 30 days');
    expect(windowTitle(POOL)).toBe(
      'Suggestions come from the decks CRL players brought to duels from 2026-09-15 to ' +
        '2026-10-14 (two games or more), and the 40 most played decks of those days. ' +
        'No deck expected to lose is listed.',
    );
  });

  it('6.1: the pool line names the top 1,000 lists beside the CRL ones', () => {
    const POOL = {
      days: 30, from: '2026-09-24', to: '2026-10-23', group: 'crl',
      crlLists: 132, crlGames: 1398, metaLists: 0, topLists: 206,
    } as unknown as Parameters<typeof windowLabel>[0];
    expect(windowLabel(POOL)).toBe('206 top 1k lists + 132 CRL duel lists · last 30 days');
    expect(windowTitle(POOL)).toContain('top 1,000 ranked players used from 2026-09-24 to 2026-10-23');
  });

  it('says nothing when the window was not applied: the whole pool was used', () => {
    expect(windowLabel({ ...WINDOW, applied: false, reason: 'stale' })).toBeUndefined();
    expect(windowLabel({ ...WINDOW, days: null })).toBeUndefined();
    expect(windowLabel(undefined)).toBeUndefined();
    expect(windowLabel(null)).toBeUndefined();
    expect(windowTitle({ ...WINDOW, applied: false, reason: 'thin' })).toBeUndefined();
  });

  it('the count’s tooltip names what was left out, in figures', () => {
    expect(windowTitle(WINDOW)).toBe(
      'Suggestions come from decks played in the last 7 days. 30 had under 5 games in them. ' +
        '213 hold under half the share of play they had in the 60 days before.',
    );
    // No previous days to compare with: nothing is claimed about a share.
    expect(windowTitle({ ...WINDOW, notPlayed: 0, fading: 0, previousDays: 0 })).toBe(
      'Suggestions come from decks played in the last 7 days.',
    );
    expect(windowTitle({ ...WINDOW, fading: 12, previousDays: 0 })).not.toContain('share');
  });

  it('a row’s play in the window is a tooltip line, with which way its share moved', () => {
    expect(recentTitle({ days: 7, games: 429, trend: 'rising' })).toBe(
      'Played 429 times in the last 7 days · share of play rising',
    );
    expect(recentTitle({ days: 30, games: 1485, trend: 'easing' })).toBe(
      'Played 1,485 times in the last 30 days · share of play easing',
    );
    expect(recentTitle({ days: 7, games: 1, trend: 'new' })).toBe(
      'Played 1 time in the last 7 days · new in these days',
    );
    // Too little before the window to compare with: the count alone.
    expect(recentTitle({ days: 7, games: 9, trend: 'played' })).toBe(
      'Played 9 times in the last 7 days',
    );
    expect(recentTitle(undefined)).toBeUndefined();
  });

  it('both screens put it in the figure’s tooltip, never a mark on the row', () => {
    expect(block).toMatch(/\[figureTitle, recentTitle\(deck\.recent\), \.\.\.changed\.map/);
    expect(folders).toMatch(/recentTitle\(rec\.recent\),/);
    expect(block).not.toContain('styles.recent');
    expect(folders).not.toContain('styles.recRecent');
  });

  it('each screen draws the count once, from what the SERVER said it did', () => {
    expect(block).toMatch(/windowLabel\(bring\.pool\.window\) && \(/);
    expect(screen).toMatch(/windowLabel\(report\.pool\.window\) && \(/);
    expect(screen).toMatch(/data-window title=\{windowTitle\(report\.pool\.window\)\}/);
    // Not from the chip the reader has pressed: a board on screen was made
    // with ITS days, and the chip may have moved since.
    expect(screen).not.toMatch(/windowLabel\([^)]*days/);
  });
});

describe('brain 7.0: every archetype they play', () => {
  const names = (k: string) => ({ bait: 'Log Bait', hog: 'Hog' } as Record<string, string>)[k];

  it('draws a chip for every archetype a real opponent plays (nine seen)', () => {
    const plays = Array.from({ length: 9 }, (_, i) => ({ family: `f${i}`, name: `F${i}` }));
    const vs = Object.fromEntries(plays.map((p) => [p.family, 55]));
    expect(MAX_CHIPS).toBeGreaterThanOrEqual(9);
    expect(familyChips({ vs }, plays)).toHaveLength(9);
  });

  it('marks only a row that does NOT win every matchup', () => {
    expect(closestPill({ allArchetypes: true }, names)).toBeNull();
    expect(closestPill({}, names)).toBeNull();
    const p = closestPill({ allArchetypes: false, eachWorst: { family: 'bait', rate: 47.4 } }, names);
    expect(p?.label).toBe('Closest');
    expect(p?.title).toContain('Worst: Log Bait 47%');
  });

  it('says when the worst is a matchup it has no rate for', () => {
    const p = closestPill({ allArchetypes: false, eachWorst: { family: 'hog', rate: null } }, names);
    expect(p?.title).toContain('No rate against Hog');
  });

  it('both screens draw the pill', () => {
    for (const f of [
      'src/components/Analytics/TeamAnalysis/TeamFolders.tsx',
      'src/components/Analytics/BringAgainst.tsx',
    ]) {
      expect(readFileSync(resolve(__dirname, '..', f), 'utf8')).toMatch(/closestPill\(/);
    }
  });
});
