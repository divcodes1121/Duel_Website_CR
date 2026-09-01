import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEVICE_KINDS,
  MAX_DEVICES_PER_ACCOUNT,
  deviceId,
  deviceKind,
  measureKind,
} from '../src/state/deviceIdentity';

/**
 * THE DEVICE LIMIT: one computer and one phone per account, so two.
 *
 * These tests exist because of a bug they would have caught. `deviceKind()`
 * documented itself as "decided once" and was in fact recomputed on every call
 * from a LIVE media query — so narrowing a desktop window past 900px flipped it
 * to 'mobile', at which point the heartbeat looked up the phone's row, saw a
 * different `device_id`, concluded it had been evicted and signed the person
 * out claiming they had signed in on another phone. Worse, `claimDevice()`
 * reads the same value, so a narrowed desktop would evict the actual phone.
 *
 * This file can exist because `deviceIdentity.ts` has no Supabase import; the
 * rules used to sit beside a module that constructs a client at load, which is
 * the third time that extraction has been needed here.
 *
 * ── WHY THE GLOBALS ARE STUBBED BY HAND RATHER THAN USING JSDOM ─────────────
 * The jsdom environment pragma was tried first and does not load on this
 * machine: jsdom 27 pulls `@asamuzakjp/css-color`, whose CJS entry `require()`s
 * an ESM-only `@csstools/css-calc`, and Node refuses it — `ERR_REQUIRE_ESM`,
 * before a single test runs. The suite has no `test` block in `vite.config.ts`
 * and therefore runs in `node`, which the other twelve files want anyway.
 *
 * AND THE PRAGMA MUST NOT BE SPELLED OUT EVEN IN PROSE. Vitest finds that
 * directive by scanning the file for the string, not by parsing the leading
 * docblock — so naming it here, in a comment about why it is NOT used, silently
 * switched this file to jsdom and reproduced the very error being described.
 * A comment configured the test. Hence the paraphrase.
 *
 * The module needs exactly three things, so all three are supplied directly.
 * That is a smaller and more honest dependency than a DOM implementation, and
 * it means these tests state precisely which browser APIs the device rules
 * rest on.
 */

/** The bits of `localStorage` this module uses, in memory. */
function makeStorage(): Storage & { throwOnRead: boolean } {
  const map = new Map<string, string>();
  return {
    throwOnRead: false,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem(k: string) {
      if ((this as unknown as { throwOnRead: boolean }).throwOnRead) {
        throw new Error('storage disabled');
      }
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage & { throwOnRead: boolean };
}

let store: ReturnType<typeof makeStorage>;

/** Point `matchMedia` at a mutable state object, so a "resize" is a mutation. */
function stubMedia(state: { coarse: boolean; narrow: boolean }) {
  const matchMedia = (q: string) => ({
    matches: q.includes('pointer: coarse') ? state.coarse : state.narrow,
    media: q,
  });
  vi.stubGlobal('window', { matchMedia });
  return state;
}

beforeEach(() => {
  store = makeStorage();
  vi.stubGlobal('localStorage', store);
  stubMedia({ coarse: false, narrow: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the limit itself', () => {
  it('is two, and is two BECAUSE there are two kinds', () => {
    // Not a hardcoded 2: the cap is a consequence of `kind` having exactly two
    // legal values while `device_sessions` is keyed on (user_id, kind). The
    // table physically cannot hold a third row for one account, which is why
    // nothing counts devices — counting races, and two simultaneous logins
    // would both read "one device" and both insert.
    expect(MAX_DEVICES_PER_ACCOUNT).toBe(2);
    expect(DEVICE_KINDS).toEqual(['desktop', 'mobile']);
    expect(new Set(DEVICE_KINDS).size).toBe(DEVICE_KINDS.length);
  });
});

describe('measureKind — the raw test', () => {
  it('calls a coarse pointer mobile however wide the window is', () => {
    stubMedia({ coarse: true, narrow: false });
    expect(measureKind()).toBe('mobile');
  });

  it('calls a narrow window mobile even with a fine pointer', () => {
    stubMedia({ coarse: false, narrow: true });
    expect(measureKind()).toBe('mobile');
  });

  it('calls a wide fine-pointer window desktop', () => {
    stubMedia({ coarse: false, narrow: false });
    expect(measureKind()).toBe('desktop');
  });
});

describe('deviceKind — REMEMBERED, not recomputed', () => {
  it('is stable when a desktop window is narrowed past the breakpoint', () => {
    // THE REGRESSION TEST FOR THE BUG. Before the fix the second call returned
    // 'mobile', which is what signed people out and let a resized desktop
    // evict their phone.
    const media = stubMedia({ coarse: false, narrow: false });
    expect(deviceKind()).toBe('desktop');

    media.narrow = true; // the window is dragged narrow
    expect(deviceKind()).toBe('desktop');

    media.narrow = false; // and back
    expect(deviceKind()).toBe('desktop');
  });

  it('does not flip a phone to desktop if it later reports a fine pointer', () => {
    // The mirror case: a phone that pairs a mouse, or a browser that changes
    // its mind about `pointer: coarse`. Once mobile, always mobile.
    const media = stubMedia({ coarse: true, narrow: true });
    expect(deviceKind()).toBe('mobile');

    media.coarse = false;
    media.narrow = false;
    expect(deviceKind()).toBe('mobile');
  });

  it('persists the decision so a later visit agrees', () => {
    const media = stubMedia({ coarse: false, narrow: false });
    expect(deviceKind()).toBe('desktop');

    media.narrow = true; // a new page load, in a narrow window
    expect(deviceKind()).toBe('desktop');
    expect(store.getItem('dekkies-device-kind')).toBe('desktop');
  });

  it('measures fresh when nothing is stored', () => {
    stubMedia({ coarse: true, narrow: true });
    expect(deviceKind()).toBe('mobile');
    expect(store.getItem('dekkies-device-kind')).toBe('mobile');
  });

  it('re-measures if the stored value is corrupt rather than trusting it', () => {
    // A junk value must not reach the database — `kind` is checked against
    // ('desktop','mobile') and the insert would simply fail.
    store.setItem('dekkies-device-kind', 'tablet');
    stubMedia({ coarse: false, narrow: false });
    expect(deviceKind()).toBe('desktop');
  });

  it('only ever returns a kind the schema accepts', () => {
    for (const media of [
      { coarse: false, narrow: false },
      { coarse: true, narrow: false },
      { coarse: false, narrow: true },
      { coarse: true, narrow: true },
    ]) {
      store.clear();
      stubMedia(media);
      expect(DEVICE_KINDS).toContain(deviceKind());
    }
  });

  it('falls back to measuring when storage is unavailable', () => {
    // Private mode, or site data blocked. It must degrade, not crash the app on
    // the way to the sign-in screen.
    stubMedia({ coarse: true, narrow: true });
    store.throwOnRead = true;
    expect(deviceKind()).toBe('mobile');
  });
});

describe('deviceId', () => {
  it('is stable across calls', () => {
    const first = deviceId();
    expect(deviceId()).toBe(first);
  });

  it('persists under the key that must not be renamed', () => {
    // Renaming this key makes every signed-in device look new and burns a slot
    // against the limit — which is why it still says `dekkies-` and not
    // `deckkies-`. The misspelling is load-bearing.
    const id = deviceId();
    expect(store.getItem('dekkies-device-id')).toBe(id);
  });

  it('is a distinct id for a browser with no stored one', () => {
    const first = deviceId();
    store.clear();
    expect(deviceId()).not.toBe(first);
  });

  it('still returns an id when storage throws', () => {
    store.throwOnRead = true;
    const id = deviceId();
    expect(id).toBeTruthy();
    // Per-session rather than persistent, which fails towards asking someone to
    // sign in again rather than towards letting an extra device in.
    expect(deviceId()).not.toBe(id);
  });

  it('is a UUID, so two browsers cannot collide', () => {
    expect(deviceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
