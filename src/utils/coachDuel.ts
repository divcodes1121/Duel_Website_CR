/* THE COACH DUEL'S GAME RULES (`server/coach_duel.py`).
 *
 * You coach Blue; an AI coach plays Red. Before the duel you choose the format
 * (best of 3 or 5) and whether it stops once someone has won or every game is
 * played. Then it goes one game at a time: you paste one deck, the server
 * answers the AI's deck (chosen without seeing yours) and the game's chance,
 * and a draw decides it (`roll`). No card may be played twice in a duel.
 * All of it lives here so the screen holds no arithmetic and the rules are
 * tested on their own (`tests/coachDuel.test.ts`).
 *
 * No imports.
 */

export type Format = 3 | 5;

/** Decks you showed that a rematch tells the AI about, at most. */
export const MAX_SEEN = 8;

/** Games won by each side along `path` ('w' / 'l' from your side). */
export function scoreOf(path: string): [number, number] {
  let a = 0;
  let b = 0;
  for (const c of path) {
    if (c === 'w') a += 1;
    else if (c === 'l') b += 1;
  }
  return [a, b];
}

/** Two wins of three, three of five. */
export function winsNeeded(games: Format): number {
  return Math.floor(games / 2) + 1;
}

/** Someone has won the duel along `path`. */
export function isDecided(path: string, games: Format): boolean {
  const need = winsNeeded(games);
  const [a, b] = scoreOf(path);
  return a >= need || b >= need;
}

/** No game is left to play: decided (when stopping on a win), or every game
 *  of the format played (when playing them all). */
export function isFinished(path: string, games: Format, playAll: boolean): boolean {
  return playAll ? path.length >= games : isDecided(path, games);
}

/** Who won the duel once it is finished: more games won. Null while it is on. */
export function winnerOf(path: string, games: Format, playAll = false): 'you' | 'ai' | null {
  if (!isFinished(path, games, playAll)) return null;
  const [a, b] = scoreOf(path);
  return a > b ? 'you' : 'ai';
}

/** The result of a game played at `chance` percent for you, from one uniform
 *  draw `r` in [0, 1): a win when it falls inside the chance. */
export function roll(chance: number, r: number): 'w' | 'l' {
  return r * 100 < chance ? 'w' : 'l';
}

/** A small seeded generator (mulberry32), for tests and replays. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `61.2%`, one decimal at most, a dash for nothing. */
export function pctLabel(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

/** Cards two decks share. */
export function overlap(a: readonly string[], b: readonly string[]): number {
  const s = new Set(a);
  return b.filter((c) => s.has(c)).length;
}

/** The cards of `deck` already played in an earlier game of this duel —
 *  the duel rule: no card twice. */
export function clashWith(deck: readonly string[], earlier: readonly (readonly string[])[]): string[] {
  const used = new Set(earlier.flat());
  return deck.filter((c) => used.has(c));
}

/** Every `deck=` link in pasted text, in order. */
export function findDeckLinks(text: string): string[] {
  let t = text;
  try {
    t = decodeURIComponent(text);
  } catch {
    /* keep raw */
  }
  return [...t.matchAll(/deck=([0-9;]+)/gi)].map((m) => `deck=${m[1]}`);
}

/** The first deck of `decks` that shares no card with the duel so far and is
 *  not `skip` — "use a Coach Assist deck" steps through them. */
export function nextLegal(
  decks: readonly (readonly string[])[], earlier: readonly (readonly string[])[], skip?: readonly string[] | null,
): number | null {
  const skipKey = skip ? [...skip].sort().join(',') : null;
  const ok = decks
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => clashWith(d, earlier).length === 0);
  if (!ok.length) return null;
  const at = skipKey ? ok.findIndex(({ d }) => [...d].sort().join(',') === skipKey) : -1;
  return ok[(at + 1) % ok.length].i;
}

/** The decks you have shown so far in the session, for the AI's next read:
 *  newest first, each deck once (order of cards ignored), at most `MAX_SEEN`. */
export function addSeen(seen: readonly string[][], shown: readonly string[][]): string[][] {
  const out: string[][] = [];
  const keys = new Set<string>();
  for (const d of [...shown].reverse().concat(seen)) {
    const k = [...d].sort().join(',');
    if (!keys.has(k)) {
      keys.add(k);
      out.push([...d]);
    }
  }
  return out.slice(0, MAX_SEEN);
}

/** A deck's identity: its cards, order ignored. */
export function deckKey(deck: readonly string[]): string {
  return [...deck].sort().join(',');
}

/** The next deck to offer from `decks` (best first): legal in this duel, not
 *  the one on screen, and not offered before in the session (`offered`, deck
 *  keys). When every legal deck has been offered, the round starts again
 *  (`fresh: false`). Reported 2026-10-21: "the Coach Assist pick is always
 *  the same, it needs to differ every time" — and not repeat on a rematch. */
export function nextFresh(
  decks: readonly (readonly string[])[], earlier: readonly (readonly string[])[],
  offered: ReadonlySet<string>, current?: readonly string[] | null,
): { index: number; fresh: boolean } | null {
  const cur = current ? deckKey(current) : null;
  const legal = decks
    .map((d, i) => ({ k: deckKey(d), i, d }))
    .filter(({ d, k }) => k !== cur && clashWith(d, earlier).length === 0);
  if (!legal.length) return null;
  const unseen = legal.find(({ k }) => !offered.has(k));
  return unseen ? { index: unseen.i, fresh: true } : { index: legal[0].i, fresh: false };
}

/** AI decks faced in earlier duels of the session, sent so a rematch brings
 *  new ones; newest first, each once, at most this many. */
export const MAX_FACED = 30;

export function addFaced(faced: readonly string[][], set: readonly (readonly string[])[]): string[][] {
  const out: string[][] = [];
  const keys = new Set<string>();
  for (const d of [...set].map((x) => [...x]).concat(faced)) {
    const k = deckKey(d);
    if (d.length === 8 && !keys.has(k)) {
      keys.add(k);
      out.push(d);
    }
  }
  return out.slice(0, MAX_FACED);
}

/** "For winning, the matchup must be over 55%" (asked 2026-10-21). Over this
 *  a side wins the game outright; inside the band around 50 the game is
 *  close and the needle decides it. */
export const MU_DECIDES = 55;

/** How a game is decided: by the matchup (over `MU_DECIDES` wins, a close one
 *  is rolled), or always rolled on the chance. */
export type Luck = 'mu' | 'roll';

/** The game's result: `rolled` says the needle decided it. `matchup` and
 *  `chance` are your percents; `r` one uniform draw in [0, 1). */
export function decide(luck: Luck, matchup: number, chance: number, r: number): { result: 'w' | 'l'; rolled: boolean } {
  if (luck === 'mu') {
    if (matchup > MU_DECIDES) return { result: 'w', rolled: false };
    if (matchup < 100 - MU_DECIDES) return { result: 'l', rolled: false };
  }
  return { result: roll(chance, r), rolled: true };
}

/** A new start's session seed (`ss`): twelve letters and digits from `rand`. */
export function newSessionId(rand: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i += 1) s += abc[Math.floor(rand() * abc.length) % abc.length];
  return s;
}

/** Decks offered to you that a later start still remembers, at most. */
export const MAX_OFFERED = 120;

/** What a pair of players has already been shown, kept across refreshes
 *  (reported 2026-10-21: after a refresh both sides opened on the same decks
 *  again). `offered` = your Coach Assist decks (keys), `faced` = the AI's. */
export interface DuelHistory {
  offered: string[];
  faced: string[][];
}

export function historyKey(you: string, ai: string): string {
  return `coach-duel-seen:${you}|${ai}`;
}

/** Read a stored history; anything malformed is an empty one. */
export function readHistory(raw: string | null | undefined): DuelHistory {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const offered = Array.isArray(v?.offered) ? v.offered.filter((k: unknown) => typeof k === 'string') : [];
    const faced = Array.isArray(v?.faced)
      ? v.faced.filter((d: unknown) => Array.isArray(d) && d.length === 8 && d.every((c) => typeof c === 'string'))
      : [];
    return { offered: offered.slice(-MAX_OFFERED), faced: faced.slice(0, MAX_FACED) };
  } catch {
    return { offered: [], faced: [] };
  }
}

export function writeHistory(offered: Iterable<string>, faced: readonly string[][]): string {
  return JSON.stringify({ offered: [...offered].slice(-MAX_OFFERED), faced: faced.slice(0, MAX_FACED) });
}
