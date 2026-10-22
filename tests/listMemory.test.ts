import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  STORE_KEY,
  isCount,
  isPage,
  isStringList,
  oneOf,
  recall,
  remember,
  resetListMemoryForTests,
} from '../src/state/listMemory';

/* The suite runs in node, so the tab's sessionStorage is stubbed by hand. */
class FakeStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = store;
  resetListMemoryForTests();
});

describe('a list remembers where the reader was', () => {
  it('gives the fallback for a list never visited', () => {
    expect(recall('saved-groups:solo:', 1, isPage)).toBe(1);
  });

  it('keeps a page across leaving and coming back', () => {
    remember('saved-groups:versus:', 5);
    expect(recall('saved-groups:versus:', 1, isPage)).toBe(5);
  });

  it('keeps it across a reload of the page (same browser tab)', () => {
    remember('battles:#ABC:30::', 3);
    resetListMemoryForTests(); // a reload: the module starts empty and reads storage
    expect(recall('battles:#ABC:30::', 1, isPage)).toBe(3);
  });

  it('keeps each list apart: another mode or filter is another list', () => {
    remember('saved-groups:versus:', 5);
    remember('saved-groups:versus:hog-rider', 2);
    expect(recall('saved-groups:solo:', 1, isPage)).toBe(1);
    expect(recall('saved-groups:versus:', 1, isPage)).toBe(5);
    expect(recall('saved-groups:versus:hog-rider', 1, isPage)).toBe(2);
  });

  it('never trusts a stored value: a bad one reads as the fallback', () => {
    remember('duo:page', -3);
    remember('duo:per', 999);
    remember('duo:cards', 'not a list');
    expect(recall('duo:page', 1, isPage)).toBe(1);
    expect(recall('duo:per', 25, oneOf(25, 50, 100))).toBe(25);
    expect(recall('duo:cards', [] as string[], isStringList)).toEqual([]);
    store.setItem(STORE_KEY, '{not json');
    resetListMemoryForTests();
    expect(recall('duo:page', 1, isPage)).toBe(1);
  });

  it('stays bounded, dropping the least recently written first', () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) remember(`k${i}`, i);
    expect(recall('k0', -1, isCount)).toBe(-1);
    expect(recall(`k${MAX_ENTRIES + 24}`, -1, isCount)).toBe(MAX_ENTRIES + 24);
    expect(Object.keys(JSON.parse(store.getItem(STORE_KEY) as string)).length).toBe(MAX_ENTRIES);
  });

  it('still works for the page when storage is blocked', () => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    resetListMemoryForTests();
    remember('saved-groups:solo:', 4);
    expect(recall('saved-groups:solo:', 1, isPage)).toBe(4);
  });
});

describe('the lists use it instead of a reset-to-page-1 rule', () => {
  /* The bug was a component-state page plus an effect that set page 1 when the
     list opened. Source checks, so the reset cannot quietly come back. */
  const read = async (p: string) => (await import('node:fs')).readFileSync(p, 'utf8');

  it('the Saved tab keeps its page per mode and filter', async () => {
    const src = await read('src/components/DuelDeckBuilder/SavedGroups.tsx');
    expect(src).toMatch(/useRemembered\(`saved-groups:\$\{mode\}:\$\{filterKey\}`/);
    expect(src).not.toMatch(/useEffect\(\(\) => setPage\(1\)/);
  });

  it('Recent Battles, 2v2 Decks and All Duels keep their page', async () => {
    for (const p of [
      'src/components/Analytics/RecentBattles.tsx',
      'src/components/Analytics/DuoDecks/DuoDecks.tsx',
      'src/components/Analytics/AllDuels/AllDuels.tsx',
    ]) {
      const src = await read(p);
      expect(src, p).toMatch(/useRemembered\([^)]*page/i);
      expect(src, p).not.toMatch(/const \[page, setPage\] = useState/);
    }
  });
});
