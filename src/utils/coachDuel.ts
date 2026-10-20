/* THE COACH DUEL'S GAME RULES (2026-10-20, `server/coach_duel.py`).
 *
 * The server sends every game a best-of-3 can reach — `path` is who won each
 * game before it, from the FIRST player's side ('' game 1, 'w', 'l', 'wl',
 * 'lw'). Playing the duel is walking that tree: draw a result from the game's
 * chance, append it to the path, look up the next game. All of it lives here
 * so the screen holds no arithmetic and the rules are tested on their own
 * (`tests/coachDuel.test.ts`).
 *
 * No imports.
 */

/** The fields of a game node these rules read. */
export interface DuelNode {
  path: string;
  game: number;
  chance: number;
  matchup: number;
  reach: number;
}

/** Games won by each side along `path`: `[first, second]`. */
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
export function isOver(path: string, games = 3): boolean {
  const need = Math.floor(games / 2) + 1;
  const [a, b] = scoreOf(path);
  return a >= need || b >= need;
}

/** Who won the duel along a finished `path`: 'a', 'b', or null while it is on. */
export function winnerOf(path: string, games = 3): 'a' | 'b' | null {
  if (!isOver(path, games)) return null;
  const [a, b] = scoreOf(path);
  return a > b ? 'a' : 'b';
}

/** The game to play next along `path`, or null when the duel is over or the
 *  server did not send it. */
export function nodeAt<T extends DuelNode>(tree: readonly T[], path: string, games = 3): T | null {
  if (isOver(path, games)) return null;
  return tree.find((n) => n.path === path) ?? null;
}

/** The games already played along `path`, in order (each with its result). */
export function playedAlong<T extends DuelNode>(
  tree: readonly T[], path: string,
): { node: T; result: 'w' | 'l' }[] {
  const out: { node: T; result: 'w' | 'l' }[] = [];
  for (let k = 0; k < path.length; k += 1) {
    const node = tree.find((n) => n.path === path.slice(0, k));
    const r = path[k];
    if (!node || (r !== 'w' && r !== 'l')) break;
    out.push({ node, result: r });
  }
  return out;
}

/** The result of a game played at `chance` percent for the first player, from
 *  one uniform draw `r` in [0, 1): 'w' when it falls inside the chance. */
export function roll(chance: number, r: number): 'w' | 'l' {
  return r * 100 < chance ? 'w' : 'l';
}

/** A small seeded generator (mulberry32), so a duel can be replayed exactly. */
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

/** How far the result of the game before moved this one, in points, for the
 *  first player (0 for game 1). */
export function momentum(node: DuelNode): number {
  return Math.round((node.chance - node.matchup) * 10) / 10;
}

/** `61.2%`, one decimal at most, a dash for nothing. */
export function pctLabel(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

/** The final scores in the order a reader expects them — the first player's
 *  wins first — with their chance. Scores the server did not send are 0. */
export function outcomeRows(outcomes: Record<string, number>): { score: string; chance: number; winner: 'a' | 'b' }[] {
  return ['2-0', '2-1', '1-2', '0-2'].map((score) => ({
    score,
    chance: outcomes[score] ?? 0,
    winner: score.startsWith('2') ? 'a' : 'b',
  }));
}

/** The game after this one if the first player wins it, and if they lose it. */
export function branchesOf<T extends DuelNode>(
  tree: readonly T[], path: string, games = 3,
): { won: T | null; lost: T | null } {
  return { won: nodeAt(tree, path + 'w', games), lost: nodeAt(tree, path + 'l', games) };
}
