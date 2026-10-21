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
