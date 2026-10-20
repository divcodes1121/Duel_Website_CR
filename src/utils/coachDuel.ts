/* THE COACH DUEL'S GAME RULES (`server/coach_duel.py`).
 *
 * You coach Blue; an AI coach plays Red. The server sends the AI's pick for
 * every state the duel can reach — keyed by who won each game from YOUR side
 * and which of your decks you brought (`keyOf`) — and the win chance of every
 * pairing. Playing the duel is reading those tables: you pick a deck, the AI's
 * deck for that state is looked up, the game's chance is the pairing's chance
 * moved by the result before it (`shifted`), and a draw decides it (`roll`).
 * All of it lives here so the screen holds no arithmetic and the rules are
 * tested on their own (`tests/coachDuel.test.ts`).
 *
 * No imports.
 */

/** A best of 3: two wins take it. */
export const GAMES = 3;
/** Decks a duel set holds at most, and the fewest that can play a best of 3. */
export const MAX_DECKS = 4;
export const MIN_DECKS = 3;
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

/** A best of `games` is over once a side has won more than half. */
export function isOver(path: string, games = GAMES): boolean {
  const need = Math.floor(games / 2) + 1;
  const [a, b] = scoreOf(path);
  return a >= need || b >= need;
}

/** Who won the duel along a finished `path`: 'you', 'ai', or null while it is on. */
export function winnerOf(path: string, games = GAMES): 'you' | 'ai' | null {
  if (!isOver(path, games)) return null;
  const [a, b] = scoreOf(path);
  return a > b ? 'you' : 'ai';
}

/** The server's key for a decision state: the path, then your deck indices. */
export function keyOf(path: string, mine: readonly number[]): string {
  return `${path}:${mine.join(',')}`;
}

function logit(p: number): number {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(q / (1 - q));
}

/** The chance (percent) of a game, moved by the result of the game before it
 *  — `duel_plan.shifted` on the server. `last` is 'w' / 'l' from your side,
 *  null for game 1. */
export function shifted(
  chance: number, last: 'w' | 'l' | null, game: number, shift: Record<string, number>,
): number {
  const d = shift[String(game)] ?? 0;
  if (!d || !last) return chance;
  const z = logit(chance / 100) + (last === 'w' ? d : -d);
  return 100 / (1 + Math.exp(-z));
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

/** Every `deck=` link in pasted text, in order — so four links pasted at once
 *  fill four slots. Each comes back as the link text a parser can read. */
export function findDeckLinks(text: string): string[] {
  let t = text;
  try {
    t = decodeURIComponent(text);
  } catch {
    /* keep raw */
  }
  return [...t.matchAll(/deck=([0-9;]+)/gi)].map((m) => `deck=${m[1]}`);
}

export interface LoadoutCheck {
  /** Three or four decks, none sharing a card: ready to play. */
  ok: boolean;
  /** Decks (by index) holding a card another deck also holds. */
  clashes: number[];
  /** The cards held twice. */
  shared: string[];
  count: number;
}

/** A duel is played from decks that share no card. */
export function checkLoadout(decks: readonly (readonly string[] | null)[]): LoadoutCheck {
  const real = decks.map((d, i) => ({ d, i })).filter((x): x is { d: readonly string[]; i: number } => !!x.d && x.d.length === 8);
  const holders = new Map<string, number[]>();
  for (const { d, i } of real) for (const c of d) holders.set(c, [...(holders.get(c) ?? []), i]);
  const shared = [...holders.entries()].filter(([, h]) => h.length > 1).map(([c]) => c);
  const clashes = [...new Set(shared.flatMap((c) => holders.get(c) ?? []))].sort((x, y) => x - y);
  return {
    ok: real.length >= MIN_DECKS && real.length <= MAX_DECKS && shared.length === 0,
    clashes,
    shared: shared.sort(),
    count: real.length,
  };
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

/** One game of the duel as it was played. */
export interface PlayedGame {
  game: number;
  /** Your deck and the AI's deck, by index into each set. */
  you: number;
  ai: number | null;
  /** Your chance before and after the momentum of the game before, percent. */
  matchup: number;
  chance: number;
  draw: number;
  result: 'w' | 'l';
}

/** The duel so far, from your picks and the draws: every game played, the
 *  path of results, and the key of the state you are deciding in now. */
export function walk(
  picks: readonly number[],
  draws: readonly number[],
  aiDeck: (key: string) => number | null,
  pairChance: (you: number, ai: number) => number,
  shift: Record<string, number>,
): { games: PlayedGame[]; path: string; key: string } {
  const games: PlayedGame[] = [];
  let path = '';
  for (let g = 0; g < draws.length && g < picks.length && !isOver(path); g += 1) {
    const ai = aiDeck(keyOf(path, picks.slice(0, g)));
    const matchup = ai === null ? 100 : pairChance(picks[g], ai);
    const last = path ? (path[path.length - 1] as 'w' | 'l') : null;
    const chance = ai === null ? 100 : shifted(matchup, last, g + 1, shift);
    const result = roll(chance, draws[g] / 100);
    games.push({ game: g + 1, you: picks[g], ai, matchup, chance, draw: draws[g], result });
    path += result;
  }
  return { games, path, key: keyOf(path, picks.slice(0, games.length)) };
}
