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
    });
  });

  it('ignores the order the games were played in', () => {
    const first = buildDuelImport([game(0, 3), game(1, 4)], []);
    const reordered = buildDuelImport([game(1, 4), game(0, 3)], [first.entry!]);
    expect(reordered.outcome).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('does not confuse a duel with the same decks on the other side', () => {
    // Blue and red are different people; the same eight decks swapped over is
    // a different duel, not a re-save of this one.
    const first = buildDuelImport([game(0, 3)], []);
    const swapped = buildDuelImport([game(3, 0)], [first.entry!]);
    expect(swapped.outcome).toMatchObject({ ok: true, name: 'Duel Deck 2' });
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
  });

  it('reads padding as absent, so slot count cannot change the answer', () => {
    const r = buildDuelImport([game(0, 3)], []);
    const trimmed = { ...r.entry!.blue!, decks: r.entry!.blue!.decks.slice(0, 1) };
    expect(sideSignature(trimmed)).toBe(sideSignature(r.entry!.blue));
  });
});
