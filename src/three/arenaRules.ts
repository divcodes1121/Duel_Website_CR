/* THE RULES OF "DODGE THE ARENA", the little game on the error page.
 *
 * You are a knight on your half of a Clash Royale arena. The enemy towers lob
 * fireballs at you (a red ring on the ground says where each will land), from
 * level 3 a Log rolls across a lane (the lane lights up first), and pink elixir
 * drops appear — walk into them. Eight elixir is a level; three hits and the
 * game is over.
 *
 * Everything that decides difficulty, movement and collision is here, with no
 * three.js and no DOM, so it is tested on its own (`tests/arenaRules.test.ts`)
 * and the renderer in ArenaGame.tsx only draws what these functions say.
 *
 * World units: x across (left -, right +), z toward the camera. The river is at
 * z = 0; the player's half is z > 0.
 */

export const ARENA = {
  minX: -4.4,
  maxX: 4.4,
  minZ: 0.95,
  maxZ: 5.1,
} as const;

export const PLAYER_SPEED = 6.2; // units per second
export const PLAYER_RADIUS = 0.42;
export const BLAST_RADIUS = 0.95; // a fireball's splash on the ground
export const PICKUP_RADIUS = 0.72;
export const LOG_HALF_DEPTH = 0.55; // half the lane a Log covers, along z
export const LIVES = 3;
export const ELIXIR_PER_LEVEL = 8;
export const INVULNERABLE_S = 1.4;
export const MAX_DROPS = 3;
export const DROP_LIFETIME_S = 7.5;

export function levelFor(score: number): number {
  return 1 + Math.floor(Math.max(0, score) / ELIXIR_PER_LEVEL);
}

/** Seconds between fireball launches. */
export function spawnGap(level: number): number {
  return Math.max(0.48, 1.55 - (level - 1) * 0.13);
}

/** Seconds a fireball is in the air — i.e. how long its ring warns you. */
export function flightTime(level: number): number {
  return Math.max(0.8, 1.45 - (level - 1) * 0.07);
}

/** How many fireballs a launch sends; `r` is a uniform random in [0, 1). */
export function volley(level: number, r: number): number {
  if (level >= 7 && r < 0.18) return 3;
  if (level >= 4 && r < 0.3) return 2;
  return 1;
}

/** Seconds between Logs; none before level 3. */
export function logGap(level: number): number {
  return level < 3 ? Infinity : Math.max(3.6, 9 - (level - 3) * 0.9);
}

export const LOG_WARNING_S = 1.0;
export const LOG_CROSS_S = 1.25;

export function clampToArena(x: number, z: number): [number, number] {
  return [
    Math.min(ARENA.maxX, Math.max(ARENA.minX, x)),
    Math.min(ARENA.maxZ, Math.max(ARENA.minZ, z)),
  ];
}

export function within(ax: number, az: number, bx: number, bz: number, r: number): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= r * r;
}

/** Does a fireball landing at (tx, tz) catch a player at (px, pz)? The player
 *  counts as a circle, so grazing the edge of the splash is a hit. */
export function fireballHits(px: number, pz: number, tx: number, tz: number): boolean {
  return within(px, pz, tx, tz, BLAST_RADIUS + PLAYER_RADIUS * 0.6);
}

/** Does a Log crossing the lane centred on `laneZ`, now at `logX`, catch the
 *  player? The Log is a cylinder lying along z, ~0.8 wide along x. */
export function logHits(px: number, pz: number, laneZ: number, logX: number): boolean {
  return Math.abs(pz - laneZ) <= LOG_HALF_DEPTH + PLAYER_RADIUS * 0.5 &&
    Math.abs(px - logX) <= 0.4 + PLAYER_RADIUS * 0.6;
}

export interface Keys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * One movement step. Keys win over a pointer target; a pointer target is
 * walked towards and stopped on, never overshot.
 */
export function step(
  pos: [number, number],
  keys: Keys,
  target: [number, number] | null,
  dt: number,
  speed = PLAYER_SPEED,
): [number, number] {
  let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let dz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dx || dz) {
    const len = Math.hypot(dx, dz);
    return clampToArena(pos[0] + (dx / len) * speed * dt, pos[1] + (dz / len) * speed * dt);
  }
  if (!target) return pos;
  dx = target[0] - pos[0];
  dz = target[1] - pos[1];
  const dist = Math.hypot(dx, dz);
  const reach = speed * dt;
  if (dist <= reach || dist < 1e-4) return clampToArena(target[0], target[1]);
  return clampToArena(pos[0] + (dx / dist) * reach, pos[1] + (dz / dist) * reach);
}

/**
 * Where a fireball aims: at the player with a little lead and scatter, so
 * standing still is punished but moving steadily mostly is not. `r1`/`r2` are
 * uniform randoms.
 */
export function aimAt(
  pos: [number, number],
  vel: [number, number],
  flight: number,
  r1: number,
  r2: number,
): [number, number] {
  const lead = 0.55 * flight;
  const scatter = 1.1;
  return clampToArena(
    pos[0] + vel[0] * lead + (r1 - 0.5) * 2 * scatter,
    pos[1] + vel[1] * lead + (r2 - 0.5) * 2 * scatter,
  );
}

/** A spot for a new elixir drop at least `minGap` from the player. */
export function dropSpot(
  player: [number, number],
  rand: () => number,
  minGap = 2.2,
): [number, number] {
  let best: [number, number] = [0, (ARENA.minZ + ARENA.maxZ) / 2];
  let bestD = -1;
  for (let i = 0; i < 12; i += 1) {
    const x = ARENA.minX + 0.3 + rand() * (ARENA.maxX - ARENA.minX - 0.6);
    const z = ARENA.minZ + 0.2 + rand() * (ARENA.maxZ - ARENA.minZ - 0.4);
    const d = Math.hypot(x - player[0], z - player[1]);
    if (d >= minGap) return [x, z];
    if (d > bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  return best;
}

/* The best score, per browser. Storage can be missing or throw (private
   windows, blocked site data); a game with no memory is still a game. */
export const BEST_KEY = 'deckkies-arena-best';

export function readBest(storage: Pick<Storage, 'getItem'> | null | undefined): number {
  try {
    const n = Number(storage?.getItem(BEST_KEY) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function storeBest(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  score: number,
): number {
  const best = Math.max(readBest(storage), Math.floor(score));
  try {
    storage?.setItem(BEST_KEY, String(best));
  } catch {
    /* nothing to do */
  }
  return best;
}
