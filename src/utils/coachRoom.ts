/* COACH DUEL ROOMS — two coaches online (2026-10-22; `server/coach_room.py`).
 *
 * The host picks their player and the settings — best of 3 / 5, stop on a win
 * or play all, how a game is decided, and a 2 / 3 / 4 / 5 minute deck clock —
 * makes a room and shares its link. The other coach opens the link, picks
 * their player and joins. Each game both lock in blind; the server decides it
 * and rolls, so both screens see the same result.
 *
 * This file is the screen's arithmetic: the route, the seat token, the clock
 * and which step a room is at. No imports, so it is tested on its own
 * (`tests/coachRoom.test.ts`).
 */

export type RoomSeat = 'blue' | 'red';
export type RoomPhase = 'waiting' | 'reading' | 'playing' | 'done' | 'closed' | 'error';

export interface RoomDeck {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  deckName?: string | null;
  locked: true;
}

export interface RoomResult {
  winner: RoomSeat | null;
  timeout: RoomSeat | 'both' | null;
  matchup?: number | null;
  chance?: number | null;
  draw?: number | null;
  rolled?: boolean;
  at: number;
}

export interface RoomGame {
  no: number;
  /** ms since the epoch, on the SERVER's clock. */
  start: number;
  /** null when the room has no time limit. */
  deadline: number | null;
  /** The other coach's deck for the game being played is only `{locked}`. */
  blue: RoomDeck | { locked: true } | null;
  red: RoomDeck | { locked: true } | null;
  result: RoomResult | null;
}

export interface RoomSettings {
  bo: 3 | 5;
  all: boolean;
  luck: 'mu' | 'roll';
  /** Seconds; 0 = no time limit. */
  clock: number;
  days: number;
}

export interface RoomSide {
  tag: string;
  name: string;
}

export interface RoomPoolDeck {
  cards: string[];
  deckName?: string;
  art?: Record<string, 'evolution' | 'hero'>;
  origin?: string;
}

export interface CoachRoom {
  id: string;
  phase: RoomPhase;
  version: number;
  /** The server's clock when it answered, ms. */
  now: number;
  you: RoomSeat | null;
  settings: RoomSettings;
  round: number;
  blue: RoomSide | null;
  red: RoomSide | null;
  games: RoomGame[];
  score: Record<RoomSeat, number>;
  need: number;
  rematch: Record<RoomSeat, boolean>;
  end: { winner: RoomSeat | null; reason: string; at: number; left?: RoomSeat } | null;
  error: string | null;
  /** Your Coach Assist decks for this room (the other coach's are never sent). */
  pool: RoomPoolDeck[];
  /** Decks still legal for you, after a game. */
  next: RoomPoolDeck[];
  joinable: boolean;
  revealS: number;
}

/** The deck clock choices, minutes ("2 mins, 3 mins, 4 mins, 5 mins"). */
export const CLOCK_MINUTES = [2, 3, 4, 5] as const;
/** "Also add a no time option" (2026-10-22): a game waits for both coaches. */
export const NO_LIMIT = 0;
export type ClockMinutes = (typeof CLOCK_MINUTES)[number] | typeof NO_LIMIT;
export const DEFAULT_CLOCK: ClockMinutes = 3;

/** How often a screen asks for the room while something is happening. */
export const POLL_MS = 2000;
/** …and while it waits for somebody to open the link. */
export const POLL_WAITING_MS = 3000;

export const ROOM_ROUTE = '#/coach-duel/room';
const ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

/** `#/coach-duel/room/<id>` -> the id; `#/coach-duel/room` -> '' (make one);
 *  anything else -> null (not a room route). */
export function parseRoomHash(hash: string): string | null {
  const path = hash.split('?')[0];
  if (path === ROOM_ROUTE || path === `${ROOM_ROUTE}/`) return '';
  if (!path.startsWith(`${ROOM_ROUTE}/`)) return null;
  const id = path.slice(ROOM_ROUTE.length + 1).toLowerCase();
  return ID_RE.test(id) ? id : null;
}

export function roomHash(id: string): string {
  return `${ROOM_ROUTE}/${id}`;
}

/** The link the host shares. `base` is the page without its hash. */
export function roomLink(base: string, id: string): string {
  return `${base.split('#')[0]}${roomHash(id)}`;
}

/** This browser's token for its seat in one room (kept in localStorage). */
export function seatStorageKey(id: string): string {
  return `coach-room-seat:${id}`;
}

export function newSeatToken(rand: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'seat-';
  for (let i = 0; i < 24; i += 1) s += abc[Math.floor(rand() * abc.length) % abc.length];
  return s;
}

/** "2:05", "0:09"; never negative. */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Milliseconds left on a server deadline, given how far the server's clock
 *  is ahead of this one (`offset` = server now - local now). */
export function remainingMs(deadline: number, localNow: number, offset: number): number {
  return deadline - (localNow + offset);
}

export function other(seat: RoomSeat): RoomSeat {
  return seat === 'blue' ? 'red' : 'blue';
}

export function hasCards(d: RoomGame['blue']): d is RoomDeck {
  return !!d && Array.isArray((d as RoomDeck).cards);
}

/** The game being played (the last one, if it has no result). */
export function currentGame(room: CoachRoom): RoomGame | null {
  const g = room.games[room.games.length - 1];
  return g && !g.result ? g : null;
}

/** The last finished game. */
export function lastResult(room: CoachRoom): RoomGame | null {
  for (let i = room.games.length - 1; i >= 0; i -= 1) if (room.games[i].result) return room.games[i];
  return null;
}

/** Cards a seat played in finished games — none can come back. */
export function spentBy(room: CoachRoom, seat: RoomSeat): string[][] {
  return room.games.filter((g) => g.result && hasCards(g[seat])).map((g) => (g[seat] as RoomDeck).cards);
}

/** Which step the screen shows. */
export type RoomStage =
  | 'join' // a stranger opened the link
  | 'waiting' // the host, waiting for the link to be opened
  | 'reading' // both players being read
  | 'reveal' // a game just finished; the next opens shortly
  | 'pick' // your move
  | 'locked' // you locked in; waiting for the other coach
  | 'done'
  | 'closed'
  | 'full' // somebody opened a link to a room that has both coaches
  | 'error';

export function stageOf(room: CoachRoom, serverNow: number): RoomStage {
  if (room.phase === 'error') return 'error';
  if (room.phase === 'closed') return 'closed';
  if (room.phase === 'waiting') return room.you ? 'waiting' : room.joinable ? 'join' : 'closed';
  if (!room.you) return 'full';
  if (room.phase === 'reading') return 'reading';
  if (room.phase === 'done') return 'done';
  const g = currentGame(room);
  if (!g) return 'reveal';
  if (g[room.you]) return 'locked';
  if (lastResult(room) && serverNow < g.start) return 'reveal';
  return 'pick';
}

/** What a refusal code means, in words. */
export function roomErrorText(code: string): string {
  switch (code) {
    case 'no_room':
      return 'That room does not exist any more.';
    case 'room_full':
      return 'Both coaches are already in this room.';
    case 'room_closed':
      return 'This room is closed.';
    case 'own_room':
      return 'This is your room — send the link to the other coach.';
    case 'same_player':
      return 'Pick a different player from the other coach.';
    case 'too_late':
      return 'The clock ran out before your deck was locked in.';
    case 'card_played':
      return 'That deck holds a card you already played this duel.';
    case 'already_locked':
      return 'Your deck for this game is already locked in.';
    case 'bad_deck':
      return 'That is not an eight-card deck.';
    case 'not_seated':
      return 'You are not one of the two coaches in this room.';
    case 'not_playing':
      return 'That game is already decided.';
    case 'invalid_tag':
      return 'That is not a player tag.';
    case 'bad_seat':
      return 'This browser could not keep its seat. Reload the page and try again.';
    case 'busy':
      return 'Too many rooms are open right now. Try again in a minute.';
    case 'no_rematch':
      return 'A rematch is not possible in this room.';
    case 'no_brain':
      return 'The duel model is not available right now.';
    case 'read_failed':
      return 'The players could not be read. Make a new room and try again.';
    case 'unauthorized':
      return 'Sign in to play Coach Duel.';
    case 'forbidden':
      return 'Coach Duel is for Pro accounts and members on their three-day trial.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/** Why a finished duel ended, in words, from `you`'s side. */
export function endLine(room: CoachRoom): string {
  const e = room.end;
  if (!e) return '';
  const theirName = room.you ? room[other(room.you)]?.name ?? 'The other coach' : '';
  switch (e.reason) {
    case 'left':
      return e.left === room.you ? 'You left the duel.' : `${theirName}'s coach left the duel.`;
    case 'abandoned':
      return 'Neither coach locked in a deck in time. The duel was abandoned.';
    case 'expired':
      return 'Nobody opened the link in time. The room closed.';
    case 'closed':
      return 'The room was closed.';
    default:
      return '';
  }
}

/** The room's settings as one line: "Best of 3 · stop on a win · 3 min a deck". */
export function settingsLine(s: RoomSettings, mu: number): string {
  return [
    `Best of ${s.bo}`,
    s.all ? 'every game played' : 'stop on a win',
    s.luck === 'mu' ? `matchup over ${mu}% wins` : 'every game rolled',
    s.clock ? `${Math.round(s.clock / 60)} min a deck` : 'no time limit',
  ].join(' · ');
}
