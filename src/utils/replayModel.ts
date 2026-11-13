/**
 * THE REPLAY BOARD'S ARITHMETIC — everything the board draws that is worked
 * out from the plays rather than read off the page. Pure, so it is tested.
 *
 * EVERY FIGURE HERE IS COUNTED, NONE IS ESTIMATED. Elixir is what the cards
 * played cost (the catalogue's cost, the Mirror at one more than the card it
 * copies). It is NOT an elixir bar: regeneration depends on the game mode and
 * on overtime rules the page does not state, and a bar built on a guess at
 * them would be printed as if it were measured. Ability presses cost elixir
 * too, but the catalogue does not carry those costs, so they are not counted.
 *
 * THE CARD CYCLE IS EXACT, WITH ONE HONEST GAP. A Clash Royale hand is four
 * cards and the other four wait in a queue: a card played goes to the back of
 * the queue and the front of the queue comes into the hand. So once four cards
 * have been played, the queue IS the last four plays, oldest first, and the
 * hand is the other four — known exactly, and the next card in is the oldest
 * of those four. Before four plays only the cards already played are known to
 * be out of hand.
 *
 * THE GAP IS A CHAMPION. A champion leaves the cycle while it is on the field
 * and goes to the back of the queue when it dies — and the page does not
 * record when it died. From a champion's first play on, the hand is no longer
 * exact; what is still certain is that the last THREE plays are in the queue
 * (a returning champion can only push the fourth one out). The board says
 * "maybe" for the rest rather than guessing.
 */

import { CARDS_BY_KEY } from '../data/cards';
import { ARENA_H, ARENA_W, type Replay, type ReplayEvent, type ReplaySide } from './replayParse';

export const SIDES: readonly ReplaySide[] = ['blue', 'red'];

/** "1:05" from seconds. */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t + 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function cardName(key: string): string {
  return CARDS_BY_KEY.get(key)?.name ?? key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isChampion(key: string): boolean {
  return CARDS_BY_KEY.get(key)?.isChampion ?? false;
}

export function isSpell(key: string): boolean {
  return CARDS_BY_KEY.get(key)?.type === 'Spell';
}

/** Plays (not ability presses) by one side up to and including `t`. */
export function playsUpTo(replay: Replay, side: ReplaySide, t: number): ReplayEvent[] {
  return replay.events.filter((e) => e.side === side && e.kind === 'play' && e.t <= t);
}

/* ── The card cycle ─────────────────────────────────────────────────────── */

export type CycleSpot = 'hand' | 'next' | 'queue' | 'maybe';

export interface CycleState {
  /** True when the hand is known exactly. */
  exact: boolean;
  plays: number;
  /** A champion has been played, so the hand can no longer be exact. */
  championOut: boolean;
  /** Where each deck card stands right now. */
  spots: Record<string, CycleSpot>;
  /** For a card in the queue: how many plays before it is back in hand. */
  back: Record<string, number>;
  /** The four cards in hand, in deck order — only when exact. */
  hand: string[];
  next: string | null;
}

export function cycleAt(replay: Replay, side: ReplaySide, t: number): CycleState {
  const deck = replay.players[side].deck.map((c) => c.key);
  const plays = playsUpTo(replay, side, t).map((e) => e.key);
  const championOut = plays.some(isChampion);
  const spots: Record<string, CycleSpot> = {};
  const back: Record<string, number> = {};
  for (const k of deck) spots[k] = 'maybe';

  if (!championOut && plays.length >= 4) {
    const queue = plays.slice(-4);
    const distinct = new Set(queue).size === 4;
    const inDeck = queue.every((k) => deck.includes(k));
    if (distinct && inDeck && deck.length === 8) {
      queue.forEach((k, i) => {
        spots[k] = i === 0 ? 'next' : 'queue';
        back[k] = i + 1;
      });
      const hand = deck.filter((k) => !queue.includes(k));
      for (const k of hand) spots[k] = 'hand';
      return { exact: true, plays: plays.length, championOut, spots, back, hand, next: queue[0] };
    }
  }

  // Not exact: mark only what is certain to be out of hand.
  const sure = championOut ? 3 : 4;
  const recent: string[] = [];
  for (let i = plays.length - 1; i >= 0 && recent.length < sure; i -= 1) {
    if (!recent.includes(plays[i])) recent.push(plays[i]);
  }
  recent.reverse(); // oldest first
  recent.forEach((k, i) => {
    if (k in spots) {
      spots[k] = 'queue';
      // How many plays until it returns is only known when the queue is whole.
      if (!championOut && plays.length >= 4) back[k] = i + 1;
    }
  });
  return { exact: false, plays: plays.length, championOut, spots, back, hand: [], next: null };
}

/* ── Elixir on cards ────────────────────────────────────────────────────── */

export interface ElixirPoint {
  t: number;
  total: number;
}

/** Cumulative elixir each side put into cards, one step per play. */
export function elixirSeries(replay: Replay): Record<ReplaySide, ElixirPoint[]> {
  const out: Record<ReplaySide, ElixirPoint[]> = { blue: [{ t: 0, total: 0 }], red: [{ t: 0, total: 0 }] };
  const running: Record<ReplaySide, number> = { blue: 0, red: 0 };
  for (const e of replay.events) {
    if (e.kind !== 'play' || e.elixir == null) continue;
    running[e.side] += e.elixir;
    out[e.side].push({ t: e.t, total: running[e.side] });
  }
  return out;
}

export function elixirAt(series: ElixirPoint[], t: number): number {
  let v = 0;
  for (const p of series) {
    if (p.t > t) break;
    v = p.total;
  }
  return v;
}

/* ── Where on the arena ─────────────────────────────────────────────────── */

export type Lane = 'Left' | 'Centre' | 'Right';
export type Depth = 'Back' | 'Middle' | 'Bridge' | 'Across';

/**
 * Lane and depth of a play, from its OWNER's seat: "Left" is the left of the
 * screen for blue (bottom) and also for red, because the board is drawn from
 * blue's side and a reader names lanes by what they see. Depth is measured
 * from the owner's back edge, so a red Hog at the bridge is "Bridge" too.
 */
export function zoneOf(e: Pick<ReplayEvent, 'x' | 'y' | 'side'>): { lane: Lane; depth: Depth } | null {
  if (e.x == null || e.y == null) return null;
  const lane: Lane = Math.abs(e.x - ARENA_W / 2) < 1 ? 'Centre' : e.x < ARENA_W / 2 ? 'Left' : 'Right';
  const fromBack = e.side === 'blue' ? e.y : ARENA_H - e.y;
  const depth: Depth = fromBack >= 17 ? 'Across' : fromBack >= 11 ? 'Bridge' : fromBack >= 5 ? 'Middle' : 'Back';
  return { lane, depth };
}

export function zoneLabel(e: Pick<ReplayEvent, 'x' | 'y' | 'side'>): string {
  const z = zoneOf(e);
  if (!z) return '';
  if (z.depth === 'Across') return `${z.lane} · their side`;
  return `${z.lane} · ${z.depth.toLowerCase()}`;
}

/* ── One side, summed up ────────────────────────────────────────────────── */

export interface SideSummary {
  plays: number;
  abilities: number;
  elixir: number;
  /** Average elixir per play, one decimal. Null with no costed plays. */
  perPlay: number | null;
  /** Elixir per minute of battle so far. Null before the first minute's end. */
  perMinute: number | null;
  lanes: Record<Lane, number>;
  across: number;
  firstPlay: number | null;
  /** The card played most, ties to the one played first. */
  most: { key: string; count: number } | null;
}

export function summarise(replay: Replay, side: ReplaySide, t = Infinity): SideSummary {
  const evs = replay.events.filter((e) => e.side === side && e.t <= t);
  const plays = evs.filter((e) => e.kind === 'play');
  const costed = plays.filter((e) => e.elixir != null);
  const elixir = costed.reduce((s, e) => s + (e.elixir ?? 0), 0);
  const lanes: Record<Lane, number> = { Left: 0, Centre: 0, Right: 0 };
  let across = 0;
  const counts = new Map<string, number>();
  for (const e of plays) {
    const z = zoneOf(e);
    if (z) {
      lanes[z.lane] += 1;
      if (z.depth === 'Across') across += 1;
    }
    counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
  }
  let most: SideSummary['most'] = null;
  for (const [key, count] of counts) if (!most || count > most.count) most = { key, count };
  const span = Math.min(t, replay.duration);
  return {
    plays: plays.length,
    abilities: evs.length - plays.length,
    elixir,
    perPlay: costed.length ? Math.round((elixir / costed.length) * 10) / 10 : null,
    perMinute: span >= 60 ? Math.round((elixir / span) * 60 * 10) / 10 : null,
    lanes,
    across,
    firstPlay: plays.length ? plays[0].t : null,
    most,
  };
}

/** The most recent event at or before `t`, or null. */
export function currentEvent(replay: Replay, t: number): ReplayEvent | null {
  let found: ReplayEvent | null = null;
  for (const e of replay.events) {
    if (e.t > t) break;
    found = e;
  }
  return found;
}

/** Playback speeds, matching the keys 1-5. */
export const SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

/** Seconds a play stays drawn on the board in "Recent" view. */
export const TRAIL_SECONDS = 6;
