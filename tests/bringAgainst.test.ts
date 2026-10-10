import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRING_VIEWS,
  CHIP_OK,
  MAX_CHIPS,
  chipLabels,
  familyChips,
  shareLabel,
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

  it('are at most six, their six most played', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ family: `f${i}`, name: `F${i}` }));
    const vs = Object.fromEntries(many.map((p) => [p.family, 60]));
    const chips = familyChips({ vs }, many);
    expect(chips).toHaveLength(MAX_CHIPS);
    expect(chips.map((c) => c.family)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5']);
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
