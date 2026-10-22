import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_MINUTES,
  clockLabel,
  currentGame,
  endLine,
  lastResult,
  newSeatToken,
  parseRoomHash,
  remainingMs,
  roomErrorText,
  roomHash,
  roomLink,
  settingsLine,
  spentBy,
  stageOf,
  type CoachRoom,
  type RoomGame,
} from '../src/utils/coachRoom';
import { MU_DECIDES } from '../src/utils/coachDuel';

const server = readFileSync('server/coach_room.py', 'utf8');
const source = readFileSync('src/utils/coachRoom.ts', 'utf8');

const D = (n: number) => Array.from({ length: 8 }, (_, i) => `c${n}${i}`);

function room(over: Partial<CoachRoom> = {}): CoachRoom {
  return {
    id: 'abcdefgh23', phase: 'playing', version: 3, now: 1_000_000, you: 'blue',
    settings: { bo: 3, all: false, luck: 'mu', clock: 180, days: 30 }, round: 0,
    blue: { tag: '#B', name: 'Bee' }, red: { tag: '#R', name: 'Arr' },
    games: [], score: { blue: 0, red: 0 }, need: 2, rematch: { blue: false, red: false },
    end: null, error: null, pool: [], next: [], joinable: false, revealS: 12,
    ...over,
  };
}

const open = (no: number, start = 0, blue: RoomGame['blue'] = null, red: RoomGame['red'] = null): RoomGame => ({
  no, start, deadline: start + 180_000, blue, red, result: null,
});
const done = (no: number, winner: 'blue' | 'red'): RoomGame => ({
  no, start: 0, deadline: 1, blue: { cards: D(no), locked: true }, red: { cards: D(no + 5), locked: true },
  result: { winner, timeout: null, matchup: 60, chance: 60, draw: 10, rolled: true, at: 1 },
});

describe('the room route and link', () => {
  it('reads a room id, an empty room route and nothing else', () => {
    expect(parseRoomHash('#/coach-duel/room/abcdefgh23')).toBe('abcdefgh23');
    expect(parseRoomHash('#/coach-duel/room/ABCDEFGH23')).toBe('abcdefgh23');
    expect(parseRoomHash('#/coach-duel/room')).toBe('');
    expect(parseRoomHash('#/coach-duel/room/')).toBe('');
    expect(parseRoomHash('#/coach-duel')).toBeNull();
    expect(parseRoomHash('#/coach-duel/room/short')).toBeNull();
    expect(parseRoomHash('#/coach-duel/room/abcdefgh20')).toBeNull(); // 0 is not in the alphabet
  });
  it('builds the link the host shares from the page without its hash', () => {
    expect(roomHash('abcdefgh23')).toBe('#/coach-duel/room/abcdefgh23');
    expect(roomLink('https://deckkies.com/#/coach-duel/room', 'abcdefgh23')).toBe(
      'https://deckkies.com/#/coach-duel/room/abcdefgh23',
    );
  });
  it('uses the server room-id alphabet and length', () => {
    expect(server).toContain('ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"');
    expect(server).toContain('ID_LEN = 10');
    expect(source).toContain('[23456789abcdefghjkmnpqrstuvwxyz]{10}');
  });
  it('makes seat tokens the server accepts', () => {
    const t = newSeatToken(() => 0.5);
    expect(t).toMatch(/^seat-[a-z0-9]{24}$/);
    expect(t.length).toBeGreaterThanOrEqual(16);
    expect(t.length).toBeLessThanOrEqual(64);
    expect(newSeatToken()).not.toBe(newSeatToken());
  });
});

describe('the deck clock', () => {
  it('offers 2, 3, 4 and 5 minutes, the same as the server', () => {
    expect([...CLOCK_MINUTES]).toEqual([2, 3, 4, 5]);
    expect(server).toContain('CLOCKS = (120, 180, 240, 300)');
  });
  it('has a no-time-limit choice the server takes as 0', () => {
    expect(server).toContain('NO_LIMIT = 0');
    expect(settingsLine({ bo: 3, all: false, luck: 'mu', clock: 0, days: 30 }, 55)).toBe(
      'Best of 3 · stop on a win · matchup over 55% wins · no time limit',
    );
  });
  it('prints minutes and seconds, never below zero', () => {
    expect(clockLabel(180_000)).toBe('3:00');
    expect(clockLabel(125_400)).toBe('2:06');
    expect(clockLabel(9_000)).toBe('0:09');
    expect(clockLabel(-5_000)).toBe('0:00');
  });
  it('counts down on the server clock', () => {
    // the server is 2 s ahead of this browser
    expect(remainingMs(100_000, 90_000, 2_000)).toBe(8_000);
  });
  it('decides by the same 55% rule as the vs-AI screen', () => {
    expect(server).toContain(`MU_DECIDES = ${MU_DECIDES}.0`);
  });
});

describe('which step a room is at', () => {
  it('the host waits; a stranger on the link joins', () => {
    expect(stageOf(room({ phase: 'waiting' }), 0)).toBe('waiting');
    expect(stageOf(room({ phase: 'waiting', you: null, joinable: true }), 0)).toBe('join');
  });
  it('a stranger on a full room is told so', () => {
    expect(stageOf(room({ you: null }), 0)).toBe('full');
  });
  it('reading, closed, error, done', () => {
    expect(stageOf(room({ phase: 'reading' }), 0)).toBe('reading');
    expect(stageOf(room({ phase: 'closed' }), 0)).toBe('closed');
    expect(stageOf(room({ phase: 'error' }), 0)).toBe('error');
    expect(stageOf(room({ phase: 'done' }), 0)).toBe('done');
  });
  it('your move, then locked in', () => {
    expect(stageOf(room({ games: [open(1)] }), 10)).toBe('pick');
    expect(stageOf(room({ games: [open(1, 0, { cards: D(1), locked: true })] }), 10)).toBe('locked');
    // the other coach locked in: still your move
    expect(stageOf(room({ games: [open(1, 0, null, { locked: true })] }), 10)).toBe('pick');
  });
  it('a finished game is shown until the next one opens', () => {
    const r = room({ games: [done(1, 'blue'), open(2, 5_000)] });
    expect(stageOf(r, 4_000)).toBe('reveal');
    expect(stageOf(r, 5_000)).toBe('pick');
  });
  it('finds the game being played, the last result and the cards spent', () => {
    const r = room({ games: [done(1, 'blue'), done(2, 'red'), open(3)] });
    expect(currentGame(r)?.no).toBe(3);
    expect(lastResult(r)?.no).toBe(2);
    expect(spentBy(r, 'blue')).toEqual([D(1), D(2)]);
    expect(spentBy(r, 'red')).toEqual([D(6), D(7)]);
  });
});

describe('the words', () => {
  it('has a sentence for every refusal the server can send', () => {
    const codes = [...server.matchAll(/RoomError\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(8);
    for (const c of new Set(codes)) expect(roomErrorText(c), c).not.toBe(roomErrorText('zzz'));
  });
  it('says the settings in one line', () => {
    expect(settingsLine({ bo: 5, all: true, luck: 'roll', clock: 240, days: 30 }, 55)).toBe(
      'Best of 5 · every game played · every game rolled · 4 min a deck',
    );
  });
  it('says why a duel ended from your side', () => {
    expect(endLine(room({ phase: 'done', end: { winner: 'blue', reason: 'left', at: 1, left: 'red' } }))).toBe(
      "Arr's coach left the duel.",
    );
    expect(endLine(room({ phase: 'done', end: { winner: 'red', reason: 'left', at: 1, left: 'blue' } }))).toBe(
      'You left the duel.',
    );
    expect(endLine(room({ phase: 'done', end: { winner: null, reason: 'abandoned', at: 1 } }))).toMatch(/abandoned/);
  });
});

describe('the module', () => {
  it('imports nothing, so it is tested on its own', () => {
    expect(source).not.toMatch(/^import /m);
  });
});
