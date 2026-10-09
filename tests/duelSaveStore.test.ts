import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The store imports the account store (which builds a Supabase client) and the
   sync client; neither can load in plain node. `deckUndo.test.ts`'s stand-ins,
   so the store itself runs for real. */
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

import { CARDS } from '../src/data/cards';
import type { PlayedGame } from '../src/state/duelImport';
import { useBuilderStore } from '../src/state/store';
import { SYNC_MAX_BYTES, payloadBytes } from '../src/state/syncPolicy';

/* SAVING A PLAYED DUEL, THROUGH THE REAL STORE ACTION.
 *
 * Reported 2026-10-09: "player A vs player B is saved; when I save player B vs
 * player A, same set, it should show that already saved and the duel set
 * number". Each player's Duel Zone lists the same duel with the decks on
 * opposite sides, and the second save used to add a second "Duel Deck n".
 * `duelImport.test.ts` covers the rule; this is the button's own path.
 */

const KEYS = CARDS.map((c) => c.key);
const deck = (n: number) => Array.from({ length: 8 }, (_, i) => KEYS[(n * 8 + i) % KEYS.length]);
const game = (mine: number, theirs: number): PlayedGame => ({
  cards: deck(mine),
  playerCrowns: 2,
  opponentCrowns: 1,
  opponent: { cards: deck(theirs) },
});

const aVsB = [game(0, 3), game(1, 4), game(2, 5)];
const bVsA = [game(3, 0), game(4, 1), game(5, 2)];

const initial = useBuilderStore.getState();
const S = () => useBuilderStore.getState();
/** Save with no limit — an admin's. The limit has its own block below. */
const save = (games: PlayedGame[], limit = Number.POSITIVE_INFINITY) =>
  S().saveDuelPlayed(games, limit);

beforeEach(() => {
  useBuilderStore.setState(initial, true);
});

describe('saveDuelPlayed', () => {
  it('saves a duel once, whichever player it is saved from', () => {
    expect(save(aVsB)).toEqual({ ok: true, name: 'Duel Deck 1', games: 3 });
    expect(S().library).toHaveLength(1);

    expect(save(bVsA)).toEqual({
      ok: false,
      reason: 'duplicate',
      name: 'Duel Deck 1',
      swapped: true,
    });
    expect(S().library).toHaveLength(1);
  });

  it('answers with the set’s number among other saved duels', () => {
    save([game(6, 7)]);
    save(aVsB);
    save([game(8, 9)]);
    expect(S().library.map((e) => e.name)).toEqual(['Duel Deck 3', 'Duel Deck 2', 'Duel Deck 1']);
    expect(save(bVsA)).toMatchObject({ reason: 'duplicate', name: 'Duel Deck 2' });
    expect(S().library).toHaveLength(3);
  });

  it('follows a rename, and offers the save again once the set is deleted', () => {
    save(aVsB);
    const id = S().library[0].id;
    S().renameSaved(id, 'Finals');
    expect(save(bVsA)).toMatchObject({ reason: 'duplicate', name: 'Finals' });

    S().deleteSaved(id);
    expect(save(bVsA)).toMatchObject({ ok: true, name: 'Duel Deck 1' });
    // Saved from B's side this time, so B's decks are Blue.
    expect(S().library[0].blue?.decks[0].slots).toEqual(deck(3));
  });

  it('leaves the builder’s own board and its loaded set alone', () => {
    const before = S().sets;
    save(aVsB);
    save(bVsA);
    expect(S().sets).toBe(before);
    expect(S().activeSavedId).toBeNull();
  });
});

describe('the saved-set limit', () => {
  /* Asked for 2026-10-09: "unlimited for my account, which is admin ... 1000
     saved decks for everyone". The screen passes the reader's limit in
     (`useSavedSetLimit`); the store refuses at it and says so, because a set
     saved past the limit is one the account would refuse to sync. */
  const fill = (n: number) => {
    for (let i = 0; i < n; i++) save([game(i + 10, i + 60)]);
  };

  it('a played duel is refused at the limit, and nothing is added', () => {
    fill(3);
    expect(save(aVsB, 3)).toEqual({ ok: false, reason: 'full', limit: 3 });
    expect(S().library).toHaveLength(3);
    // One under it still saves.
    expect(save(aVsB, 4)).toMatchObject({ ok: true });
    expect(S().library).toHaveLength(4);
  });

  it('a duel already saved still says so at the limit — that is the useful answer', () => {
    save(aVsB);
    fill(2);
    expect(save(bVsA, 3)).toMatchObject({ reason: 'duplicate', name: 'Duel Deck 1', swapped: true });
  });

  it('the builder’s own Save is refused at the limit too', () => {
    fill(2);
    expect(S().saveCurrent('Mine', 2)).toEqual({ ok: false, reason: 'full', limit: 2 });
    expect(S().library).toHaveLength(2);
    expect(S().saveCurrent('Mine', 3)).toEqual({ ok: true });
    expect(S().library[0].name).toBe('Mine');
  });

  it('updating a loaded set is not a new set, and is never refused', () => {
    S().saveCurrent('Mine', 5);
    const id = S().library[0].id;
    S().loadSaved(id);
    fill(4);
    expect(S().library).toHaveLength(5);
    S().updateSaved();
    expect(S().library).toHaveLength(5);
  });

  it('with no limit it just saves', () => {
    fill(12);
    expect(save(aVsB)).toMatchObject({ ok: true });
    expect(S().saveCurrent('x', Number.POSITIVE_INFINITY)).toEqual({ ok: true });
  });
});

describe('how big a saved duel is', () => {
  /* Measured 2026-10-09 with random real decks: a three-game duel saves as
     1,904-2,046 characters of JSON (mean 1,976) and a five-game one as
     2,171-2,338. These are the sizes everything else is worked out from — a
     part of 200 sets, a thousand sets in the browser — so they are held here,
     against the real store, and move if a saved set's shape does.

     UNTIL 2026-10-09 THEY WERE ALSO THE CEILING: the account's decks were one
     document capped at `SYNC_MAX_BYTES`, about 500 three-game duels. The
     library travels in parts now (`deckSyncV2.test.ts`); the last test here is
     what that used to mean, and what an old tab is still held to. */
  const sync = () => {
    const { sets, library, deckSlotCount, paletteFolders } = S();
    return { sets, library, deckSlotCount, paletteFolders };
  };

  it('a saved three-game duel costs about 2 kB', () => {
    save(aVsB);
    const one = JSON.stringify(S().library[0]).length;
    expect(one).toBeGreaterThan(1_800);
    expect(one).toBeLessThan(2_150);
  });

  it('a five-game duel costs about 2.3 kB', () => {
    save([0, 1, 2, 3, 4].map((i) => game(i, i + 5)));
    const one = JSON.stringify(S().library[0]).length;
    expect(one).toBeGreaterThan(2_100);
    expect(one).toBeLessThan(2_450);
  });

  it('as ONE document, about 500 three-game duels fitted and 520 did not', () => {
    const empty = payloadBytes(sync());
    expect(empty).toBeLessThan(4_000);

    save(aVsB);
    const entry = S().library[0];
    const filled = (n: number) => ({
      ...sync(),
      library: Array.from({ length: n }, (_, i) => ({ ...entry, name: `Duel Deck ${i + 1}` })),
    });
    expect(payloadBytes(filled(450))).toBeLessThan(SYNC_MAX_BYTES);
    expect(payloadBytes(filled(520))).toBeGreaterThan(SYNC_MAX_BYTES);
  });
});
