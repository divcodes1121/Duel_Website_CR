import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initialsOf } from '../src/utils/initials';

/* The Recent Battles row: the two letters in a player's disc, and the two
   things about the row that a restyle could break without anything looking
   wrong — the card order, and which stylesheet rules decide the layout. */

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Coach Mira')).toBe('CM');
    expect(initialsOf('sand box')).toBe('SB');
  });

  it('takes the first two letters of a single word', () => {
    expect(initialsOf('SandBox')).toBe('SA');
    expect(initialsOf('elman')).toBe('EL');
  });

  it('drops a tag’s hash', () => {
    expect(initialsOf('#YYPCUUY0')).toBe('YY');
  });

  it('does not count a separator or an emoji as a word', () => {
    // Was "傳|": the bare "|" is the second space-separated token.
    expect(initialsOf('傳奇 | Sir✨Jose✨')).toBe('傳S');
    expect(initialsOf('Mini❤Villa')).toBe('MI');
    expect(initialsOf('✨Jose✨ ⚔')).toBe('JO');
  });

  it('never returns nothing for a name with no letters in it', () => {
    expect(initialsOf('✨⚔')).toBe('✨⚔');
    expect(initialsOf('')).toBe('');
  });
});

describe('the Recent Battles row', () => {
  const tsx = readFileSync('src/components/Analytics/RecentBattles.tsx', 'utf8');
  const css = readFileSync('src/components/Analytics/RecentBattles.module.css', 'utf8').replace(/\r\n/g, '\n');

  it('draws the cards in the order the server sent them', () => {
    // `arrange_deck` decides the order and the forms. Slicing at four is all
    // the row may do; a sort here would put the special slots anywhere.
    expect(tsx).not.toMatch(/\.sort\(/);
    expect(tsx).not.toMatch(/\.reverse\(/);
    expect(tsx).toContain('side.cards.slice(0, 4)');
    expect(tsx).toContain('side.cards.slice(4)');
  });

  it('uses one panel component for both players', () => {
    expect(tsx.match(/<PlayerDeckPanel\b/g)?.length).toBe(2);
    expect(tsx).toContain('who="mine"');
    expect(tsx).toContain('who="theirs"');
  });

  it('lays out against the list and the panel, not the window', () => {
    expect(css).toContain('container: battles / inline-size');
    expect(css).toContain('container: side / inline-size');
    // The row's own layout has no viewport breakpoint left in it.
    const rows = css.slice(css.indexOf('rows */'), css.indexOf('pager */'));
    expect(rows).not.toMatch(/@media\s*\((max|min)-width/);
  });

  it('keeps the two rows of four the same size', () => {
    // One rule sizes every card; the featured row changes the slot, not the card.
    expect(css).toMatch(/\.cardRow \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    const featured = /\.cardRow\[data-row='featured'\] \.slot \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(featured).not.toBe('');
    expect(featured).not.toMatch(/width|height|padding|transform/);
  });
});
