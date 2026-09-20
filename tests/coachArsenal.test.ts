import { describe, expect, it } from 'vitest';

import {
  ArsenalError,
  ARSENAL_DECK_SIZE,
  TAGS_MAX,
  TAG_MAX,
  averageElixir,
  cleanNewDeck,
  cleanTags,
  deckKey,
  deckLabel,
  deckProblem,
  filterArsenal,
  hasTag,
  memoryArsenalRepo,
  reorderDecks,
  sortArsenal,
  usedTags,
  type ArsenalDeck,
} from '../src/state/coachArsenal';

/* Real card keys throughout: a fixture that invents its own vocabulary pins
   nothing, and this module's whole job is agreeing with the catalogue. */
const HOG = ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];
const GOLEM = ['golem', 'night-witch', 'baby-dragon', 'lumberjack', 'tornado', 'lightning', 'mega-minion', 'barbarian-barrel'];

const deck = (over: Partial<ArsenalDeck> = {}): ArsenalDeck => ({
  id: 'd1',
  playerId: 'p1',
  cards: HOG,
  deckKey: deckKey(HOG),
  name: 'Hog 2.6',
  archetype: 'Hog Rider',
  comfort: 4,
  tags: ['Primary'],
  status: 'active',
  source: 'manual',
  sourceRef: null,
  notes: null,
  sortOrder: 0,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  ...over,
});

describe('a deck is eight distinct known cards', () => {
  it('accepts a real eight', () => {
    expect(deckProblem(HOG)).toBeNull();
    expect(HOG).toHaveLength(ARSENAL_DECK_SIZE);
  });

  it('names what is wrong rather than just refusing', () => {
    expect(deckProblem(HOG.slice(0, 7))).toContain('7');
    expect(deckProblem([...HOG.slice(0, 7), 'hog-rider'])).toContain('same card twice');
    expect(deckProblem([...HOG.slice(0, 7), 'not-a-card'])).toContain('not-a-card');
  });
});

describe('the deck key matches the table', () => {
  it('is order-free, so one list cannot be added twice', () => {
    expect(deckKey(HOG)).toBe(deckKey([...HOG].reverse()));
  });

  it('is the sorted keys joined by commas, exactly as coach_deck_key is', () => {
    expect(deckKey(['b', 'a', 'c'])).toBe('a,b,c');
  });

  it('separates decks that differ by one card', () => {
    expect(deckKey(HOG)).not.toBe(deckKey([...HOG.slice(0, 7), 'zap']));
  });
});

describe('cleaning a new deck', () => {
  it('trims the text fields and defaults the source to manual', () => {
    const v = cleanNewDeck({ cards: HOG, name: '  Hog 2.6  ', notes: '   ' });
    expect(v.name).toBe('Hog 2.6');
    expect(v.notes).toBeNull();
    expect(v.source).toBe('manual');
    expect(v.tags).toEqual([]);
  });

  it('refuses a deck already in the arsenal, and names it', () => {
    try {
      cleanNewDeck({ cards: [...HOG].reverse() }, [deck()]);
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(ArsenalError);
      expect((e as ArsenalError).code).toBe('duplicate');
      expect((e as ArsenalError).message).toContain('Hog 2.6');
    }
  });

  it('says to restore rather than re-add when the twin is archived', () => {
    expect(() => cleanNewDeck({ cards: HOG }, [deck({ status: 'archived' })])).toThrow(/restore it instead/);
  });

  it('holds comfort to whole stars in range', () => {
    expect(cleanNewDeck({ cards: HOG, comfort: 5 }).comfort).toBe(5);
    expect(cleanNewDeck({ cards: HOG }).comfort).toBeNull();
    expect(() => cleanNewDeck({ cards: HOG, comfort: 6 })).toThrow(/1 to 5/);
    expect(() => cleanNewDeck({ cards: HOG, comfort: 2.5 })).toThrow(/1 to 5/);
  });

  it('refuses an unknown card as its own kind of problem', () => {
    try {
      cleanNewDeck({ cards: [...HOG.slice(0, 7), 'minion-giantt'] });
      throw new Error('should have refused');
    } catch (e) {
      expect((e as ArsenalError).code).toBe('unknown_card');
    }
  });
});

describe('tags', () => {
  it('drops blanks and folds case-insensitive repeats, keeping the first spelling', () => {
    expect(cleanTags([' Primary ', 'primary', '', '  ', 'Backup'])).toEqual(['Primary', 'Backup']);
  });

  it('stops at the table’s cap', () => {
    const many = Array.from({ length: TAGS_MAX + 1 }, (_, i) => `t${i}`);
    expect(() => cleanTags(many)).toThrow(/at most 12 tags/);
  });

  it('refuses a note wearing a tag’s clothes', () => {
    expect(() => cleanTags(['x'.repeat(TAG_MAX + 1)])).toThrow(/at most 24 characters/);
  });

  it('matches a role regardless of how it was typed', () => {
    expect(hasTag(deck({ tags: ['primary'] }), 'Primary')).toBe(true);
    expect(hasTag(deck({ tags: ['Backup'] }), 'Primary')).toBe(false);
  });

  it('lists tags in use, most-used first', () => {
    const decks = [deck({ tags: ['Primary', 'Tournament'] }), deck({ id: 'd2', tags: ['Tournament'] })];
    expect(usedTags(decks)).toEqual(['Tournament', 'Primary']);
  });
});

describe('what a deck is called', () => {
  it('prefers the coach’s name, then the archetype, then the cards', () => {
    expect(deckLabel(deck())).toBe('Hog 2.6');
    expect(deckLabel(deck({ name: '  ' }))).toBe('Hog Rider');
    expect(deckLabel(deck({ name: null, archetype: null }))).toBe('Hog Rider + Musketeer');
  });
});

describe('average elixir', () => {
  it('is one decimal over the real catalogue', () => {
    expect(averageElixir(HOG)).toBeCloseTo(2.6, 1);
  });

  it('is null rather than wrong when a card is unknown', () => {
    expect(averageElixir([...HOG.slice(0, 7), 'not-a-card'])).toBeNull();
  });
});

describe('the coach’s order', () => {
  const a = deck({ id: 'a', sortOrder: 0, createdAt: '2026-09-01T00:00:00Z' });
  const b = deck({ id: 'b', sortOrder: 1, createdAt: '2026-09-02T00:00:00Z' });
  const c = deck({ id: 'c', sortOrder: 2, createdAt: '2026-09-03T00:00:00Z' });

  it('sorts by rank, breaking ties on age so a read is stable', () => {
    const tied = [deck({ id: 'y', sortOrder: 0, createdAt: '2026-09-05T00:00:00Z' }), a];
    expect(sortArsenal(tied).map((d) => d.id)).toEqual(['a', 'y']);
  });

  it('moves a deck one place', () => {
    expect(reorderDecks([a, b, c], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(reorderDecks([a, b, c], 'a', 1)).toEqual(['b', 'a', 'c']);
  });

  it('does NOT wrap around at either end', () => {
    expect(reorderDecks([a, b, c], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(reorderDecks([a, b, c], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('finding a deck', () => {
  const decks = [deck(), deck({ id: 'd2', name: 'Golem beatdown', archetype: 'Golem', cards: GOLEM, deckKey: deckKey(GOLEM), tags: ['Backup'] })];

  it('matches a card NAME, which is what a coach types', () => {
    expect(filterArsenal(decks, 'hog rider').map((d) => d.id)).toEqual(['d1']);
    expect(filterArsenal(decks, 'Night Witch').map((d) => d.id)).toEqual(['d2']);
  });

  it('matches the card key too', () => {
    expect(filterArsenal(decks, 'baby-dragon').map((d) => d.id)).toEqual(['d2']);
  });

  it('matches the name and the archetype', () => {
    expect(filterArsenal(decks, 'beatdown').map((d) => d.id)).toEqual(['d2']);
    expect(filterArsenal(decks, '2.6').map((d) => d.id)).toEqual(['d1']);
  });

  it('ANDs the tag filter, and combines it with the text', () => {
    expect(filterArsenal(decks, '', ['Backup']).map((d) => d.id)).toEqual(['d2']);
    expect(filterArsenal(decks, 'hog', ['Backup'])).toEqual([]);
  });
});

describe('the memory repository applies the table’s rules', () => {
  it('adds, lists per player, and ranks new decks last', async () => {
    const repo = memoryArsenalRepo();
    await repo.add('p1', { cards: HOG, name: 'Hog' });
    await repo.add('p1', { cards: GOLEM, name: 'Golem' });
    await repo.add('p2', { cards: HOG, name: 'Someone else’s hog' });
    const mine = await repo.list('p1');
    expect(mine.map((d) => d.name)).toEqual(['Hog', 'Golem']);
    expect(mine.map((d) => d.sortOrder)).toEqual([0, 1]);
    expect(await repo.list('p2')).toHaveLength(1);
  });

  it('refuses the same eight cards for one player, in any order', async () => {
    const repo = memoryArsenalRepo();
    await repo.add('p1', { cards: HOG });
    await expect(repo.add('p1', { cards: [...HOG].reverse() })).rejects.toThrow(/already in this arsenal/);
  });

  it('lets a DIFFERENT player hold the same deck', async () => {
    const repo = memoryArsenalRepo();
    await repo.add('p1', { cards: HOG });
    await expect(repo.add('p2', { cards: HOG })).resolves.toMatchObject({ playerId: 'p2' });
  });

  it('re-keys a deck whose cards were edited, and still refuses a collision', async () => {
    const repo = memoryArsenalRepo();
    const one = await repo.add('p1', { cards: HOG });
    await repo.add('p1', { cards: GOLEM });
    const swapped = [...HOG.slice(0, 7), 'zap'];
    const updated = await repo.update(one.id, { cards: swapped });
    expect(updated.deckKey).toBe(deckKey(swapped));
    await expect(repo.update(one.id, { cards: GOLEM })).rejects.toThrow(/already in this arsenal/);
  });

  it('persists a whole ordering at once', async () => {
    const repo = memoryArsenalRepo();
    const a = await repo.add('p1', { cards: HOG });
    const b = await repo.add('p1', { cards: GOLEM });
    await repo.reorder('p1', [b.id, a.id]);
    expect((await repo.list('p1')).map((d) => d.id)).toEqual([b.id, a.id]);
  });

  it('archives by status rather than deleting, when asked to', async () => {
    const repo = memoryArsenalRepo();
    const a = await repo.add('p1', { cards: HOG });
    await repo.update(a.id, { status: 'archived' });
    expect((await repo.list('p1'))[0].status).toBe('archived');
  });
});
