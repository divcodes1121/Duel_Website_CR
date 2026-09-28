import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { fuzzy, markRuns, searchCommands, tagFromQuery } from '../src/utils/commandSearch';
import { SHORTCUTS, keysFor, shortcutFor } from '../src/utils/shortcuts';
import { isEditableTarget, undoKeyOf } from '../src/utils/keys';

const rows = [
  { group: 'Analytics', label: 'Duel Zone', sub: 'Bo3 and Bo5 series' },
  { group: 'Analytics', label: 'Duel Analysis', sub: 'Card combinations in duels' },
  { group: 'Analytics', label: 'Top Meta Decks', sub: 'The whole player base' },
  { group: 'Tools', label: 'Counter Palette', sub: 'Folders by archetype' },
  { group: 'Actions', label: 'Switch to the light theme', keywords: 'theme dark light mode' },
];
const ORDER = ['Analytics', 'Tools', 'Actions'];

describe('fuzzy', () => {
  it('finds letters in order and says where they are', () => {
    expect(fuzzy('dz', 'Duel Zone')?.idx).toEqual([0, 5]);
    expect(fuzzy('zd', 'Duel Zone')).toBeNull();
  });

  it('scores a contiguous run at a word start above a scattered match', () => {
    expect(fuzzy('meta', 'Top Meta Decks')!.score).toBeGreaterThan(fuzzy('mtd', 'Top Meta Decks')!.score);
  });

  it('ignores the spaces in what was typed', () => {
    expect(fuzzy('duel z', 'Duel Zone')).not.toBeNull();
  });
});

describe('searchCommands', () => {
  it('shows every row in order with no query', () => {
    expect(searchCommands(rows, '', ORDER).map((m) => m.item.label)).toEqual(rows.map((r) => r.label));
  });

  it('drops rows that do not match and ranks within a group', () => {
    const got = searchCommands(rows, 'duel', ORDER).map((m) => m.item.label);
    expect(got).toEqual(['Duel Zone', 'Duel Analysis']);
  });

  it('never lets a group jump above an earlier one', () => {
    const got = searchCommands(rows, 'a', ORDER).map((m) => m.item.group);
    const firstTools = got.indexOf('Tools');
    expect(got.slice(firstTools).includes('Analytics')).toBe(false);
  });

  it('matches the second line and hidden keywords, below the label', () => {
    expect(searchCommands(rows, 'archetype', ORDER).map((m) => m.item.label)).toEqual(['Counter Palette']);
    expect(searchCommands(rows, 'dark', ORDER).map((m) => m.item.label)).toEqual(['Switch to the light theme']);
  });

  it('does not match a description by letters scattered through it', () => {
    const decks = [{ group: 'Analytics', label: 'Deck Counter', sub: 'What beats this player' }];
    expect(searchCommands(decks, 'the', ORDER)).toEqual([]);
    expect(searchCommands(decks, 'beats', ORDER)).toHaveLength(1);
  });

  it('marks the matched letters for rendering', () => {
    expect(markRuns('Duel Zone', [0, 5])).toEqual([
      { text: 'D', mark: true },
      { text: 'uel ', mark: false },
      { text: 'Z', mark: true },
      { text: 'one', mark: false },
    ]);
  });
});

describe('tagFromQuery', () => {
  it('reads a tag with or without the hash, in any case', () => {
    expect(tagFromQuery('#y022grcjq')).toBe('#Y022GRCJQ');
    expect(tagFromQuery(' Y022GRCJQ ')).toBe('#Y022GRCJQ');
  });

  it('refuses a word that is not a tag', () => {
    expect(tagFromQuery('meta')).toBeNull();
    expect(tagFromQuery('#ABCDEFG')).toBeNull(); // A, B, D, E, F are not tag letters
  });
});

describe('shortcuts', () => {
  it('maps single keys and G pairs from the one table', () => {
    expect(shortcutFor('/', false)).toEqual({ kind: 'palette' });
    expect(shortcutFor('?', false)).toEqual({ kind: 'sheet' });
    expect(shortcutFor('t', false)).toEqual({ kind: 'theme' });
    expect(shortcutFor('g', false)).toBe('g');
    expect(shortcutFor('m', true)).toEqual({ kind: 'go', to: 'meta' });
    expect(shortcutFor('x', true)).toBeNull();
    expect(shortcutFor('m', false)).toBeNull();
  });

  it('has no key doing two things', () => {
    const seen = new Set<string>();
    for (const s of SHORTCUTS) {
      const k = s.keys.join('+');
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it('gives the palette its hints from the same table', () => {
    expect(keysFor('meta')).toEqual(['G', 'M']);
    expect(keysFor('builder')).toEqual(['G', 'B']);
  });
});

describe('keys', () => {
  it('reads undo and redo, and nothing without a modifier', () => {
    const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
      key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o,
    });
    expect(undoKeyOf(k('z', { ctrlKey: true }))).toBe('undo');
    expect(undoKeyOf(k('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(undoKeyOf(k('y', { ctrlKey: true }))).toBe('redo');
    expect(undoKeyOf(k('z'))).toBeNull();
    expect(undoKeyOf(k('z', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('knows a text field from a button', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('wiring', () => {
  it('the shell opens the palette on Mod-K instead of the tag pill', () => {
    const dash = readFileSync('src/components/Dashboard/Dashboard.tsx', 'utf8');
    expect(dash).toContain('useGlobalShortcuts(');
    expect(dash).toContain('<CommandPalette');
    expect(dash).not.toContain('[aria-label="Open search"]');
  });

  it('every export button can be found by the palette', () => {
    for (const f of ['src/components/Export/ExportButton.tsx', 'src/components/Header/Header.tsx', 'src/components/DecksHome/DecksHome.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('data-export=""');
    }
  });

  it('the shortcut sheet lists the table rather than its own copy', () => {
    const sheet = readFileSync('src/components/CommandPalette/ShortcutSheet.tsx', 'utf8');
    expect(sheet).toContain('SHORTCUTS.filter');
  });
});
