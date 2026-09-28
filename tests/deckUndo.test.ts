import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The store imports the account store (which builds a Supabase client) and the
   sync client. Neither is under test here, and neither can load in plain node,
   so both are replaced with inert stand-ins. The store then runs for real. */
vi.mock('../src/state/accountStore', () => ({
  useAccountStore: {
    getState: () => ({ userId: null, ready: true }),
    subscribe: () => () => {},
  },
}));
vi.mock('../src/state/syncClient', () => ({
  pushRemoteDecks: async () => true,
  readRemoteDecks: async () => ({ status: 'missing' }),
}));

import { HISTORY_LIMIT, emptyStack, record, redoStep, scopeOfOwner, undoStep } from '../src/state/deckHistory';
import { useBuilderStore } from '../src/state/store';

const initial = useBuilderStore.getState();
const S = () => useBuilderStore.getState();
const slots = (owner: 'solo' | 'home' | 'palette', deck = 0) => S().sets[owner].decks[deck].slots;

beforeEach(() => {
  useBuilderStore.setState(initial, true);
});

describe('deckHistory', () => {
  it('records, undoes and redoes a snapshot', () => {
    let st = record(emptyStack<number>(), { label: 'Add', snapshot: 1 });
    const u = undoStep(st, 2);
    expect(u).toEqual({ stack: { past: [], future: [{ label: 'Add', snapshot: 2 }] }, restore: 1, label: 'Add' });
    st = u!.stack;
    const r = redoStep(st, 1);
    expect(r?.restore).toBe(2);
    expect(r?.label).toBe('Add');
  });

  it('a new action after an undo drops the future', () => {
    const st = undoStep(record(emptyStack<number>(), { label: 'a', snapshot: 1 }), 2)!.stack;
    expect(st.future).toHaveLength(1);
    expect(record(st, { label: 'b', snapshot: 2 }).future).toEqual([]);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    let st = emptyStack<number>();
    for (let i = 0; i < HISTORY_LIMIT + 7; i++) st = record(st, { label: String(i), snapshot: i });
    expect(st.past).toHaveLength(HISTORY_LIMIT);
    expect(st.past[0].snapshot).toBe(7);
  });

  it('answers null with nothing to undo or redo', () => {
    expect(undoStep(emptyStack<number>(), 0)).toBeNull();
    expect(redoStep(emptyStack<number>(), 0)).toBeNull();
  });

  it('maps owners to the three tools', () => {
    expect(['solo', 'blue', 'red', 'home', 'palette'].map(scopeOfOwner)).toEqual([
      'duels', 'duels', 'duels', 'home', 'palette',
    ]);
  });
});

describe('undo in the store', () => {
  it('undoes and redoes a card placed in the duel builder, with a label', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    expect(slots('solo')[3]).toBe('hog-rider');
    expect(S().undo('duels')).toBe('Add Hog Rider');
    expect(slots('solo')[3]).toBeNull();
    expect(S().redo('duels')).toBe('Add Hog Rider');
    expect(slots('solo')[3]).toBe('hog-rider');
  });

  it('keeps the three tools apart: undo on one never touches another', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().assignCardAt('home', 0, 3, 'golem');
    expect(S().undo('duels')).toBe('Add Hog Rider');
    expect(slots('home')[3]).toBe('golem');
    expect(S().undo('home')).toBe('Add Golem');
    expect(S().undo('home')).toBeNull();
  });

  it('records nothing for an action that changed nothing', () => {
    S().clearSlot('solo', 0, 4);
    S().renameDeck('solo', 0, S().sets.solo.decks[0].name);
    expect(S().history.duels.past).toHaveLength(0);
  });

  it('brings back a cleared deck, and a Reset', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().assignCardAt('solo', 0, 4, 'musketeer');
    S().clearDeck('solo', 0);
    expect(slots('solo').filter(Boolean)).toHaveLength(0);
    expect(S().undo('duels')).toMatch(/^Clear /);
    expect(slots('solo').filter(Boolean)).toEqual(['hog-rider', 'musketeer']);
    S().resetAll();
    expect(S().undo('duels')).toBe('Reset');
    expect(slots('solo').filter(Boolean)).toEqual(['hog-rider', 'musketeer']);
  });

  it('brings back a deleted Counter Palette folder and every deck in it', () => {
    S().addPaletteFolder();
    const id = S().activePaletteFolderId!;
    S().assignCardAt('palette', 0, 3, 'x-bow');
    S().deletePaletteFolder(id);
    expect(S().paletteFolders).toHaveLength(0);
    expect(S().undo('palette')).toMatch(/^Delete /);
    expect(S().paletteFolders).toHaveLength(1);
    expect(S().paletteFolders[0].decks[0].slots[3]).toBe('x-bow');
  });

  it('brings back a removed Deck’s Home deck', () => {
    S().addHomeDeck();
    S().assignCardAt('home', 1, 3, 'miner');
    S().removeHomeDeck(1);
    expect(S().sets.home.decks).toHaveLength(1);
    expect(S().undo('home')).toMatch(/^Remove /);
    expect(S().sets.home.decks[1].slots[3]).toBe('miner');
  });

  it('drops the selection when it steps, so it cannot point at a vanished slot', () => {
    S().assignCardAt('solo', 0, 3, 'hog-rider');
    S().selectSlot('solo', 0, 3);
    S().undo('duels');
    expect(S().selectedSlot).toBeNull();
  });

  it('is not persisted', () => {
    const src = readFileSync('src/state/store.ts', 'utf8');
    const partialize = src.slice(src.indexOf('partialize:'), src.indexOf('migrate:'));
    expect(partialize).not.toContain('history');
  });
});
