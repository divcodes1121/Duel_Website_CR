import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* 7.2: every suggested deck carries its win-condition brain's top decks in a
   dropdown, in BOTH modes — the scouting list and each teammate's list. */
const src = readFileSync(
  resolve(__dirname, '../src/components/Analytics/TeamAnalysis/TeamFolders.tsx'),
  'utf8',
);

describe('the win-condition brains on a folder', () => {
  it('a suggested deck finds its brain by its win-condition family', () => {
    expect(src).toMatch(/r\.winFamily \? brains\.get\(r\.winFamily\)/);
  });
  it('the scouting list and the teammate lists both pass it on', () => {
    expect(src.match(/brain=\{brainOf\(r\)\}/g)?.length).toBe(1);
    expect(src).toMatch(/brain=\{brainOf\?\.\(r\)\}/);
    expect(src).toMatch(/brainOf=\{brainOf\}/);
  });
  it('the dropdown is a real disclosure: a button with aria-expanded over a list', () => {
    expect(src).toMatch(/aria-expanded=\{open\}\s+aria-controls=\{id\}/);
  });
  it('each deck in it carries the same Closest mark and chips as the rows', () => {
    expect(src).toMatch(/function BrainDeckRow[\s\S]*closestPill\(d,/);
  });
  it('both modes say how many win conditions and decks were rated', () => {
    expect(src.match(/<BrainsLine folder=\{folder\} \/>/g)?.length).toBe(2);
  });
});
