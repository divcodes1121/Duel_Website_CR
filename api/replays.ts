import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * THE SHARED REPLAY LIBRARY — "Watch the match" for everyone.
 *
 * An admin imports a battle's replay once (from a saved RoyaleAPI replay page,
 * parsed in their browser); it is kept here, and from then on ANYONE who opens
 * that player's Recent Battles can watch it, signed in or not, with no visit
 * to RoyaleAPI and no file.
 *
 *   GET    /api/replays?player=TAG   -> { battles: [key, ...] }  (admin; see REPLAYS_READ_BY)
 *   GET    /api/replays?key=KEY      -> { replay }               (admin; see REPLAYS_READ_BY)
 *   PUT    /api/replays?key=KEY      { replay }                  (admin)
 *   DELETE /api/replays?key=KEY                                  (admin)
 *
 * A KEY IS A BATTLE: both players' tags (sorted, no '#') and Supercell's battle
 * stamp to the second — `2PP~9CVL2URG~20261113T082741`. It is built from the
 * Recent Battles row, so a row finds its replay exactly.
 *
 * WHAT IT COSTS, and why it cannot grow on its own (asked for in so many
 * words: "store past 25 per person"): each player keeps their 25 NEWEST
 * battles with a replay; an older one is dropped as a newer one arrives, and a
 * replay goes the moment neither of its two players keeps it. A stored replay
 * is the parsed battle, deflated: ~2-3 KB (measured on a 61-play battle:
 * 9.2 KB of JSON, 2.0 KB deflated). And a ceiling over everything,
 * `REPLAYS_MAX_TOTAL` (~10 MB), so it never crowds the saved decks in the same
 * Upstash database.
 *
 * WRITES ARE ADMIN ONLY, checked the way api/decks.ts checks them: the
 * caller's Supabase token, then `effective_tier` asked with that token. Fails
 * closed. Reads are public: the screen they serve is free.
 *
 * NOTHING FROM THE BODY IS STORED AS IT CAME. `cleanReplay` rebuilds the
 * replay field by field, with every string, number and list bounded, so the
 * library holds what a replay is and nothing else.
 *
 * The two helpers that verify a caller are copies of api/decks.ts's, not
 * imports from it, on purpose: deck sync is the code that must never break,
 * and this file should not be able to change it.
 */

export const REPLAYS_PER_PLAYER = 25;
export const REPLAYS_MAX_TOTAL = 4000;

/** WHO MAY READ. 'admin' since 2026-11-13 ("revert back to only admin"),
 *  the day it opened to everyone; 'everyone' opens the reads again. Same
 *  value as the client's `REPLAYS_FOR` (a test holds them equal). Writes
 *  are admin only either way. */
export const REPLAYS_READ_BY: 'admin' | 'everyone' = 'admin';
const MAX_JSON = 64_000;

const TAG = /^[0289PYLQGRJCUV]{3,14}$/;
const STAMP = /^\d{8}T\d{6}$/;
const CARD = /^[a-z0-9][a-z0-9-]{0,39}$/;

/* ── keys ───────────────────────────────────────────────────────────────── */

function bareTag(t: string): string | null {
  const s = String(t ?? '').trim().replace(/^%23/i, '').replace(/^#/, '').toUpperCase();
  return TAG.test(s) ? s : null;
}

/** The battle's key, or null. Same rule as the client's `battleKeyFor`. */
export function battleKey(a: string, b: string, battleTime: string): string | null {
  const x = bareTag(a);
  const y = bareTag(b);
  const stamp = String(battleTime ?? '').slice(0, 15);
  if (!x || !y || x === y || !STAMP.test(stamp)) return null;
  const [p, q] = x < y ? [x, y] : [y, x];
  return `${p}~${q}~${stamp}`;
}

export function parseKey(key: unknown): { tags: [string, string]; stamp: string } | null {
  if (typeof key !== 'string') return null;
  const parts = key.split('~');
  if (parts.length !== 3) return null;
  const [a, b, stamp] = parts;
  if (!TAG.test(a) || !TAG.test(b) || a >= b || !STAMP.test(stamp)) return null;
  return { tags: [a, b], stamp };
}

const indexKey = (tag: string) => `replays:p:${tag}`;
const replayKey = (key: string) => `replay:${key}`;
const TOTAL = 'replays:total';

/* ── the replay, rebuilt ────────────────────────────────────────────────── */

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v, lo, hi);
  return n != null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;
const form = (v: unknown): 'evolution' | 'hero' | null => (v === 'evolution' || v === 'hero' ? v : null);
const side = (v: unknown): 'blue' | 'red' | null => (v === 'blue' || v === 'red' ? v : null);

function cleanPlayer(p: unknown, s: 'blue' | 'red') {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const name = str(o.name, 60);
  if (name == null) return null;
  const tag = o.tag == null ? null : typeof o.tag === 'string' && TAG.test(o.tag.replace(/^#/, '')) ? `#${o.tag.replace(/^#/, '')}` : null;
  const deck = Array.isArray(o.deck)
    ? o.deck.slice(0, 8).flatMap((c) => {
        const r = (c ?? {}) as Record<string, unknown>;
        const key = typeof r.key === 'string' && CARD.test(r.key) ? r.key : null;
        return key ? [{ key, level: int(r.level, 1, 20), form: form(r.form) }] : [];
      })
    : [];
  const t = (o.tower ?? null) as Record<string, unknown> | null;
  const tower = t && typeof t.key === 'string' && CARD.test(t.key) ? { key: t.key, level: int(t.level, 1, 20) } : null;
  const h = (o.towersLeft ?? null) as Record<string, unknown> | null;
  const pr = Array.isArray(h?.princess) ? h!.princess : [];
  const king = int(h?.king, 0, 100_000);
  const p0 = int(pr[0], 0, 100_000);
  const p1 = int(pr[1], 0, 100_000);
  const towersLeft =
    king != null && p0 != null && p1 != null
      ? { king, princess: [p0, p1] as [number, number], total: int(h?.total, 0, 300_000) ?? king + p0 + p1 }
      : null;
  return { side: s, name, tag, crowns: int(o.crowns, 0, 3), deck, tower, towersLeft };
}

/** A replay as the board reads it, rebuilt from untrusted input; null if it is not one. */
export function cleanReplay(x: unknown) {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return null;
  const pl = (o.players ?? {}) as Record<string, unknown>;
  const blue = cleanPlayer(pl.blue, 'blue');
  const red = cleanPlayer(pl.red, 'red');
  if (!blue || !red || !Array.isArray(o.events) || o.events.length === 0 || o.events.length > 800) return null;
  const events = [];
  for (const [i, raw] of o.events.entries()) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const s = side(e.side);
    const kind = e.kind === 'play' || e.kind === 'ability' ? e.kind : null;
    const key = typeof e.key === 'string' && CARD.test(e.key) ? e.key : null;
    const tick = int(e.tick, 0, 40_000);
    if (!s || !kind || !key || tick == null) return null;
    events.push({
      n: i,
      tick,
      t: tick / 20,
      side: s,
      kind,
      key,
      form: form(e.form),
      x: kind === 'play' ? num(e.x, 0, 18) : null,
      y: kind === 'play' ? num(e.y, 0, 32) : null,
      elixir: kind === 'play' ? int(e.elixir, 0, 11) : null,
    });
  }
  events.sort((a, b) => a.tick - b.tick);
  events.forEach((e, i) => (e.n = i));
  const url = typeof o.url === 'string' && o.url.length <= 400 && /^https:\/\/(www\.)?royaleapi\.com\//.test(o.url) ? o.url : null;
  return {
    v: 1 as const,
    id: str(o.id, 24) ?? 'replay',
    battleTag: str(o.battleTag, 40),
    url,
    battleTime: int(o.battleTime, 0, 4_102_444_800),
    modeId: int(o.modeId, 0, 999_999_999),
    players: { blue, red },
    events,
    duration: Math.max(10, Math.min(900, Math.ceil(events[events.length - 1].t + 3))),
    flipped: o.flipped === true,
  };
}

/* ── storage ────────────────────────────────────────────────────────────── */

export interface ReplayKV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/* Stored as `{ z: <base64 of deflated JSON> }`, not a bare string: Upstash
   reads a stored string back through JSON.parse, and an object can never come
   back as something else. */
function pack(replay: unknown): { z: string } {
  return { z: deflateRawSync(Buffer.from(JSON.stringify(replay), 'utf8'), { level: 9 }).toString('base64') };
}

function unpack(stored: unknown): unknown {
  const z = (stored as { z?: unknown } | null)?.z;
  if (typeof z !== 'string') return null;
  try {
    return JSON.parse(inflateRawSync(Buffer.from(z, 'base64')).toString('utf8'));
  } catch {
    return null;
  }
}

async function listOf(kv: ReplayKV, tag: string): Promise<string[]> {
  const v = await kv.get(indexKey(tag));
  return Array.isArray(v) ? v.filter((k): k is string => parseKey(k) != null) : [];
}

/** Newest battle first; the stamp sorts as text. */
function newestFirst(keys: string[]): string[] {
  return [...new Set(keys)].sort((a, b) => (parseKey(b)!.stamp < parseKey(a)!.stamp ? -1 : 1));
}

async function total(kv: ReplayKV): Promise<number> {
  const v = await kv.get(TOTAL);
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ── the route ──────────────────────────────────────────────────────────── */

export interface ReplayResult {
  status: number;
  json: unknown;
  cache?: string;
  allow?: string;
}

export async function replayRoute(
  req: { method?: string; player?: unknown; key?: unknown; body?: unknown },
  caller: { signedIn: boolean; isAdmin: () => Promise<boolean> },
  kv: ReplayKV,
): Promise<ReplayResult> {
  const method = (req.method ?? 'GET').toUpperCase();

  // Reads are an admin's too while REPLAYS_READ_BY says so — and then never
  // cached at the edge, where a cached answer would skip this check.
  const openReads = REPLAYS_READ_BY === 'everyone';
  if (method === 'GET' && !openReads) {
    if (!caller.signedIn) return { status: 401, json: { error: 'sign_in' } };
    if (!(await caller.isAdmin())) return { status: 403, json: { error: 'admins_only' } };
  }
  const readCache = (edge: string) => (openReads ? edge : 'private, no-store');

  if (method === 'GET' && req.player != null) {
    const tag = bareTag(String(req.player));
    if (!tag) return { status: 400, json: { error: 'bad_player' } };
    return { status: 200, json: { battles: await listOf(kv, tag) }, cache: readCache('public, s-maxage=15, stale-while-revalidate=60') };
  }

  const parsed = parseKey(req.key);
  if (!parsed) return { status: 400, json: { error: 'bad_key' } };
  const key = req.key as string;

  if (method === 'GET') {
    const replay = unpack(await kv.get(replayKey(key)));
    if (!replay) return { status: 404, json: { found: false } };
    return { status: 200, json: { found: true, replay }, cache: readCache('public, s-maxage=300, stale-while-revalidate=600') };
  }

  if (method !== 'PUT' && method !== 'DELETE') return { status: 405, json: { error: 'method' }, allow: 'GET, PUT, DELETE' };
  if (!caller.signedIn) return { status: 401, json: { error: 'sign_in' } };
  if (!(await caller.isAdmin())) return { status: 403, json: { error: 'admins_only' } };

  if (method === 'DELETE') {
    const had = (await kv.get(replayKey(key))) != null;
    for (const tag of parsed.tags) {
      const list = await listOf(kv, tag);
      if (list.includes(key)) await kv.set(indexKey(tag), list.filter((k) => k !== key));
    }
    if (had) {
      await kv.del(replayKey(key));
      await kv.set(TOTAL, Math.max(0, (await total(kv)) - 1));
    }
    return { status: 200, json: { removed: had } };
  }

  // PUT
  const replay = cleanReplay((req.body as { replay?: unknown } | null)?.replay);
  if (!replay) return { status: 400, json: { error: 'bad_replay' } };
  const tags = [replay.players.blue.tag, replay.players.red.tag].map((t) => (t ? t.slice(1) : null));
  if (tags[0] && tags[1] && !(parsed.tags.includes(tags[0]) && parsed.tags.includes(tags[1]))) {
    return { status: 409, json: { error: 'other_players' } };
  }
  const packed = pack(replay);
  if (packed.z.length > MAX_JSON) return { status: 413, json: { error: 'too_big' } };

  const exists = (await kv.get(replayKey(key))) != null;
  let count = await total(kv);
  if (!exists && count >= REPLAYS_MAX_TOTAL) return { status: 507, json: { error: 'library_full' } };

  // Each player's 25 newest, with this battle among them — worked out before
  // anything is written, so a refusal changes nothing.
  const kept: Record<string, string[]> = {};
  const dropped = new Set<string>();
  for (const tag of parsed.tags) {
    const all = newestFirst([...(await listOf(kv, tag)), key]);
    kept[tag] = all.slice(0, REPLAYS_PER_PLAYER);
    for (const k of all.slice(REPLAYS_PER_PLAYER)) dropped.add(k);
  }
  if (!parsed.tags.some((t) => kept[t].includes(key))) {
    return { status: 409, json: { error: 'too_old' } };
  }

  await kv.set(replayKey(key), packed);
  for (const tag of parsed.tags) await kv.set(indexKey(tag), kept[tag]);
  if (!exists) count += 1;

  // A replay neither of its players keeps any more is deleted.
  for (const d of dropped) {
    if (d === key) continue;
    const dk = parseKey(d)!;
    let held = false;
    for (const t of dk.tags) {
      const list = kept[t] ?? (await listOf(kv, t));
      if (list.includes(d)) held = true;
    }
    if (!held) {
      await kv.del(replayKey(d));
      count = Math.max(0, count - 1);
    }
  }
  await kv.set(TOTAL, count);
  return { status: 200, json: { saved: true, key, total: count } };
}

/* ── who is calling (copies of api/decks.ts's — see the header) ─────────── */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)) : null;

async function userOf(token: string): Promise<string | null> {
  if (!jwks || !token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${SUPABASE_URL}/auth/v1`, audience: 'authenticated' });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/* Remembered per warm container, as api/decks.ts does: "yes" for five
   minutes, "no" for one — every Recent Battles view of an admin asks. */
const adminSeen = new Map<string, { admin: boolean; until: number }>();

async function isAdmin(userId: string, token: string): Promise<boolean> {
  const hit = adminSeen.get(userId);
  if (hit && hit.until > Date.now()) return hit.admin;
  const admin = await askAdmin(userId, token);
  adminSeen.set(userId, { admin, until: Date.now() + (admin ? 300_000 : 60_000) });
  return admin;
}

async function askAdmin(userId: string, token: string): Promise<boolean> {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return false;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/effective_tier`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: userId }),
    });
    return res.ok && (await res.json()) === 'admin';
  } catch {
    return false;
  }
}

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
let redis: Redis | null = null;

function redisKV(): ReplayKV {
  if (!redis) redis = new Redis({ url: redisUrl!, token: redisToken! });
  const r = redis;
  return {
    get: (k) => r.get(k),
    set: (k, v) => r.set(k, v as never),
    del: (k) => r.del(k),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!redisUrl || !redisToken) {
      res.status(503).json({ error: 'not_configured' });
      return;
    }
    const header = String(req.headers?.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const method = (req.method ?? 'GET').toUpperCase();
    // A read needs to know who is calling only while reads are an admin's.
    const userId = method === 'GET' && REPLAYS_READ_BY === 'everyone' ? null : await userOf(token);
    const out = await replayRoute(
      { method, player: req.query?.player, key: req.query?.key, body: req.body },
      { signedIn: userId != null, isAdmin: () => (userId ? isAdmin(userId, token) : Promise.resolve(false)) },
      redisKV(),
    );
    if (out.allow) res.setHeader('Allow', out.allow);
    res.setHeader('Cache-Control', out.cache ?? 'no-store');
    res.status(out.status).json(out.json);
  } catch {
    res.status(500).json({ error: 'replays_failed' });
  }
}
