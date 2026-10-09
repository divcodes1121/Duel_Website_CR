import { describe, expect, it } from 'vitest';

import {
  buildDuelImport,
  duelPairs,
  findDuplicateSet,
  nextDuelDeckName,
  sideSignature,
  type PlayedGame,
} from '../src/state/duelImport';
import { CARDS } from '../src/data/cards';
import { DUEL_DECK_COUNT } from '../src/types/deck';
import type { SavedDeckSet } from '../src/types/deck';

/* Saving a played duel into the Versus builder.
 *
 * Two rules carry the whole feature and both fail quietly if they are wrong:
 * what counts as a real deck (get it wrong and a native 16-card loadout
 * becomes a "deck" of its first eight cards, which looks entirely plausible),
 * and what counts as the same duel twice (get it wrong and every press adds
 * another copy, or the first press refuses).
 */

const KEYS = CARDS.map((c) => c.key);

/** Eight distinct real cards starting at `n` — deterministic, no fixtures. */
function deck(n: number): string[] {
  return Array.from({ length: 8 }, (_, i) => KEYS[(n * 8 + i) % KEYS.length]);
}

function game(mine: number, theirs: number | null, extra: Partial<PlayedGame> = {}): PlayedGame {
  return {
    cards: deck(mine),
    opponent: theirs === null ? null : { cards: deck(theirs) },
    ...extra,
  };
}

describe('duelPairs — what is a real deck', () => {
  it('takes a game with eight known cards on both sides', () => {
    expect(duelPairs([game(0, 1)])).toHaveLength(1);
  });

  it('drops a game with no stored opponent', () => {
    // This is the native duel row: one row, the player's whole loadout, no
    // per-game opponent at all.
    expect(duelPairs([game(0, null)])).toEqual([]);
  });

  it('drops a 16-card native loadout rather than truncating it', () => {
    const native: PlayedGame = {
      cards: [...deck(0), ...deck(1)],
      opponent: { cards: deck(2) },
    };
    expect(duelPairs([native])).toEqual([]);
  });

  it('drops a deck holding a card that is not in the game', () => {
    const bogus: PlayedGame = {
      cards: [...deck(0).slice(0, 7), 'not-a-card'],
      opponent: { cards: deck(1) },
    };
    expect(duelPairs([bogus])).toEqual([]);
  });

  it('never returns more pairs than a duel collection can hold', () => {
    const six = [0, 1, 2, 3, 4, 5].map((i) => game(i, i + 6));
    expect(duelPairs(six)).toHaveLength(DUEL_DECK_COUNT);
  });
});

describe('buildDuelImport — the set it builds', () => {
  it('gives each side one deck per game, padded to a full collection', () => {
    const r = buildDuelImport([game(0, 3), game(1, 4), game(2, 5)], []);
    expect(r.outcome).toMatchObject({ ok: true, games: 3 });
    expect(r.entry?.mode).toBe('versus');
    // Three games is six decks — three a side — and the user counts them that
    // way: 3 sets -> 6 decks, 4 -> 8, 5 -> 10.
    const filled = (s?: { decks: { slots: (string | null)[] }[] }) =>
      s?.decks.filter((d) => d.slots.some(Boolean)).length ?? 0;
    expect(filled(r.entry?.blue)).toBe(3);
    expect(filled(r.entry?.red)).toBe(3);
    expect(r.entry?.blue?.decks).toHaveLength(DUEL_DECK_COUNT);
  });

  it('puts the player on blue and the opponent on red', () => {
    const r = buildDuelImport([game(0, 3)], []);
    expect(r.entry?.blue?.decks[0].slots).toEqual(deck(0));
    expect(r.entry?.red?.decks[0].slots).toEqual(deck(3));
  });

  it('carries the crowns the duel was actually won by', () => {
    const r = buildDuelImport(
      [game(0, 3, { playerCrowns: 3, opponentCrowns: 1 })],
      [],
    );
    expect(r.entry?.blue?.decks[0].crowns).toBe(3);
    expect(r.entry?.red?.decks[0].crowns).toBe(1);
  });

  it('refuses a duel with nothing to build from', () => {
    expect(buildDuelImport([game(0, null)], []).outcome).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('naming', () => {
  const named = (name: string): SavedDeckSet => ({
    id: name,
    name,
    mode: 'versus',
    savedAt: '2026-08-26T00:00:00Z',
  });

  it('starts at 1', () => {
    expect(nextDuelDeckName([])).toBe('Duel Deck 1');
  });

  it('succeeds the highest, not the count', () => {
    // Deleting group 2 of three must not hand the next save a taken name.
    expect(nextDuelDeckName([named('Duel Deck 3'), named('Duel Deck 1')])).toBe('Duel Deck 4');
  });

  it('ignores groups named some other way', () => {
    expect(nextDuelDeckName([named('My best decks'), named('Duel Deck 2')])).toBe('Duel Deck 3');
  });
});

describe('the duplicate rule', () => {
  it('refuses the same duel saved twice', () => {
    const games = [game(0, 3), game(1, 4), game(2, 5)];
    const first = buildDuelImport(games, []);
    const library = [first.entry!];
    expect(buildDuelImport(games, library).outcome).toEqual({
      ok: false,
      reason: 'duplicate',
      name: 'Duel Deck 1',
      swapped: false,
    });
  });

  it('ignores the order the games were played in', () => {
    const first = buildDuelImport([game(0, 3), game(1, 4)], []);
    const reordered = buildDuelImport([game(1, 4), game(0, 3)], [first.entry!]);
    expect(reordered.outcome).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  describe('the same duel from the other player’s side', () => {
    /* Reported 2026-10-09: "player A vs player B is saved; when I save player B
       vs player A, same set, it should show that already saved and the duel
       set number". The same duel is listed from each player's Duel Zone with
       the decks on opposite sides, and each used to be saved as its own
       "Duel Deck n". A saved set holds decks, not people. */
    const aVsB = [game(0, 3), game(1, 4), game(2, 5)];
    const bVsA = [game(3, 0), game(4, 1), game(5, 2)];

    it('is the set already saved, and names it', () => {
      const first = buildDuelImport(aVsB, []);
      const again = buildDuelImport(bVsA, [first.entry!]);
      expect(again.outcome).toEqual({
        ok: false,
        reason: 'duplicate',
        name: 'Duel Deck 1',
        swapped: true,
      });
      expect(again.entry).toBeUndefined();
    });

    it('names the set by what it is called now, not by its number', () => {
      const first = buildDuelImport(aVsB, []);
      const renamed: SavedDeckSet = { ...first.entry!, name: 'Finals vs B' };
      expect(buildDuelImport(bVsA, [renamed]).outcome).toMatchObject({
        reason: 'duplicate',
        name: 'Finals vs B',
      });
    });

    it('holds whatever order the games come in', () => {
      const first = buildDuelImport(aVsB, []);
      const shuffled = [bVsA[2], bVsA[0], bVsA[1]];
      expect(buildDuelImport(shuffled, [first.entry!]).outcome).toMatchObject({
        reason: 'duplicate',
        swapped: true,
      });
    });

    it('finds it among other saved sets', () => {
      const other = buildDuelImport([game(6, 7)], []);
      const first = buildDuelImport(aVsB, [other.entry!]);
      const library = [first.entry!, other.entry!];
      expect(first.outcome).toMatchObject({ ok: true, name: 'Duel Deck 2' });
      expect(buildDuelImport(bVsA, library).outcome).toMatchObject({
        reason: 'duplicate',
        name: 'Duel Deck 2',
        swapped: true,
      });
    });

    it('prefers a set saved the same way round when the library holds both', () => {
      /* A library from before this rule can hold a duel twice, once from each
         side. Each row then names its own copy, whichever comes first. */
      const first = buildDuelImport(aVsB, []);
      const mirror: SavedDeckSet = {
        ...first.entry!,
        id: 'mirror',
        name: 'Duel Deck 2',
        blue: first.entry!.red,
        red: first.entry!.blue,
      };
      for (const library of [[mirror, first.entry!], [first.entry!, mirror]]) {
        expect(buildDuelImport(aVsB, library).outcome).toMatchObject({
          name: 'Duel Deck 1',
          swapped: false,
        });
        expect(buildDuelImport(bVsA, library).outcome).toMatchObject({
          name: 'Duel Deck 2',
          swapped: false,
        });
      }
    });

    it('still saves a duel whose sides only partly cross over', () => {
      /* One side equal to the other side of a saved set is not that set: both
         sides have to match, the other way round. */
      const first = buildDuelImport(aVsB, []);
      const half = [game(3, 0), game(4, 1), game(5, 6)];
      expect(buildDuelImport(half, [first.entry!]).outcome).toMatchObject({
        ok: true,
        name: 'Duel Deck 2',
      });
    });

    it('is not swapped when both players fielded the same decks', () => {
      const same = [game(0, 0), game(1, 1)];
      const first = buildDuelImport(same, []);
      expect(buildDuelImport(same, [first.entry!]).outcome).toMatchObject({
        reason: 'duplicate',
        swapped: false,
      });
    });
  });

  describe('at the saved-set limit', () => {
    const three = [0, 1, 2].map((i) => buildDuelImport([game(i + 10, i + 20)], []).entry!);

    it('refuses a new duel, with the limit it hit', () => {
      const r = buildDuelImport([game(0, 3)], three, 3);
      expect(r.outcome).toEqual({ ok: false, reason: 'full', limit: 3 });
      expect(r.entry).toBeUndefined();
    });

    it('saves while there is room', () => {
      expect(buildDuelImport([game(0, 3)], three, 4).outcome).toMatchObject({ ok: true });
    });

    it('has no limit unless it is given one', () => {
      expect(buildDuelImport([game(0, 3)], three).outcome).toMatchObject({ ok: true });
    });

    it('still names a duel that is already saved', () => {
      const saved = buildDuelImport([game(0, 3)], []).entry!;
      const library = [saved, ...three];
      expect(buildDuelImport([game(3, 0)], library, 2).outcome).toMatchObject({
        reason: 'duplicate',
        name: saved.name,
      });
    });

    it('a duel with nothing to build is still `empty`, not `full`', () => {
      expect(buildDuelImport([game(0, null)], three, 1).outcome).toEqual({ ok: false, reason: 'empty' });
    });
  });

  it('saves a duel that shares only some decks', () => {
    const first = buildDuelImport([game(0, 3), game(1, 4)], []);
    const overlapping = buildDuelImport([game(0, 3), game(2, 5)], [first.entry!]);
    expect(overlapping.outcome).toMatchObject({ ok: true });
  });

  it('never matches a solo group', () => {
    const r = buildDuelImport([game(0, 3)], []);
    const solo: SavedDeckSet = { ...r.entry!, id: 'solo', mode: 'solo' };
    expect(findDuplicateSet([solo], r.entry!.blue!, r.entry!.red!)).toBeNull();
    // Not the other way round either.
    expect(findDuplicateSet([solo], r.entry!.red!, r.entry!.blue!)).toBeNull();
  });

  it('hands back the saved set itself, and which way round it matched', () => {
    const r = buildDuelImport([game(0, 3)], []);
    expect(findDuplicateSet([r.entry!], r.entry!.blue!, r.entry!.red!)).toEqual({
      entry: r.entry,
      swapped: false,
    });
    expect(findDuplicateSet([r.entry!], r.entry!.red!, r.entry!.blue!)).toEqual({
      entry: r.entry,
      swapped: true,
    });
  });

  it('reads padding as absent, so slot count cannot change the answer', () => {
    const r = buildDuelImport([game(0, 3)], []);
    const trimmed = { ...r.entry!.blue!, decks: r.entry!.blue!.decks.slice(0, 1) };
    expect(sideSignature(trimmed)).toBe(sideSignature(r.entry!.blue));
  });
});
