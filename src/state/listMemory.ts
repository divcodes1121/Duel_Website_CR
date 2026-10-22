/**
 * WHERE YOU WERE IN A LIST (2026-10-22). Asked: "in Royal Duels I load a set,
 * go back to Saved, and it starts from page 1 again — it should be where I
 * was; check everywhere for this".
 *
 * Every paged or "show more" list held its place in component state, so it
 * was thrown away the moment the list left the screen (a tab switch, another
 * route) and came back at page 1. This is one small memory they all share:
 * a key per list (and per subject — the player, the filter), a value, kept
 * for the life of the browser TAB in sessionStorage, so a reload keeps it and
 * a new tab starts clean.
 *
 * NO IMPORTS (the `tiers.ts` rule), so it is testable without a browser.
 * Bounded: past `MAX_ENTRIES` the least recently written go first. Every read
 * and write is guarded — a private window or full storage only means the
 * memory lasts until the page closes.
 */

export const STORE_KEY = 'deckkies-list-memory';
export const MAX_ENTRIES = 200;

type Entry = { v: unknown; t: number };

let mem: Map<string, Entry> | null = null;
let clock = 0;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function load(): Map<string, Entry> {
  if (mem) return mem;
  mem = new Map();
  try {
    const raw = storage()?.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [k, e] of Object.entries(parsed as Record<string, unknown>)) {
        if (e && typeof e === 'object' && typeof (e as Entry).t === 'number' && 'v' in e) {
          mem.set(k, e as Entry);
          clock = Math.max(clock, (e as Entry).t);
        }
      }
    }
  } catch {
    /* unreadable: start empty */
  }
  return mem;
}

function save(m: Map<string, Entry>): void {
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* full or blocked: the in-memory copy still holds for this page */
  }
}

/** The remembered value for `key`, or `fallback` when there is none or it
 *  fails `valid` (a stored value is data, never trusted). */
export function recall<T>(key: string, fallback: T, valid?: (v: unknown) => v is T): T {
  const hit = load().get(key);
  if (!hit) return fallback;
  if (valid && !valid(hit.v)) return fallback;
  return hit.v as T;
}

export function remember(key: string, value: unknown): void {
  const m = load();
  m.set(key, { v: value, t: ++clock });
  if (m.size > MAX_ENTRIES) {
    const oldest = [...m.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, m.size - MAX_ENTRIES);
    for (const [k] of oldest) m.delete(k);
  }
  save(m);
}

/** Tests only: drop the in-memory copy so the next read loads storage again. */
export function resetListMemoryForTests(): void {
  mem = null;
  clock = 0;
}

/* Guards for what lists remember. */
export const isPage = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;
export const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
export const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 64);
export const oneOf =
  <T extends string | number>(...allowed: readonly T[]) =>
  (v: unknown): v is T =>
    (allowed as readonly unknown[]).includes(v);
