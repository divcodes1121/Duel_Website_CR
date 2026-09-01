/**
 * WHICH DEVICE THIS BROWSER IS, and nothing else.
 *
 * NO SUPABASE IMPORT, deliberately, and that is why this file exists separately
 * from `accountStore.ts`. The device rules are what enforce "one computer and
 * one phone per account" — the single most user-visible rule in the auth system,
 * and the one that had a bug capable of signing people out at random — and they
 * could not be tested at all while they lived beside a module that constructs a
 * Supabase client at load, because that client wants a native WebSocket.
 *
 * Third time this lesson has been applied: `tiers.ts` and `utils/format.ts` were
 * both extracted for exactly this reason. `accountStore.ts` re-exports both
 * functions, so every existing call site is unchanged.
 *
 * It is not import-free like those two — it needs `window` and `localStorage` —
 * but it needs nothing a jsdom test cannot give it.
 */

export type DeviceKind = 'desktop' | 'mobile';

// NOT renamed with the brand. This key is how a browser proves it is a device
// this account already registered; changing it makes every signed-in device
// look new and burns a slot against the device limit. Same reasoning as the
// `royal-` persistence keys.
const DEVICE_KEY = 'dekkies-device-id';

// The device's KIND, stored beside its id. See `deviceKind` for why this has to
// be remembered rather than recomputed.
const KIND_KEY = 'dekkies-device-kind';

/**
 * A stable id for THIS browser, so the device rules can tell "the same laptop
 * again" from "a second laptop".
 *
 * localStorage, not a cookie or a fingerprint: it survives a refresh, it is
 * per-browser-profile, and clearing site data resets it — which is the honest
 * behaviour. Fingerprinting would be harder to shake off and is not something
 * to build into a deck site.
 */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    /* Private mode, or storage disabled. A per-session id still enforces the
       limit for as long as the tab lives; it just cannot recognise the device
       on a later visit, which fails towards asking someone to sign in again
       rather than towards letting an extra device in. */
    return crypto.randomUUID();
  }
}

/** The raw test: what this browser looks like RIGHT NOW. */
export function measureKind(): DeviceKind {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  return coarse || narrow ? 'mobile' : 'desktop';
}

/**
 * Desktop or mobile, decided once AND REMEMBERED.
 *
 * Coarse on purpose. The rule wants one of each, and the line only has to be
 * stable for a given device — a tablet counting as "mobile" is a judgement
 * call, not a bug, and `pointer: coarse` is the closest thing to what a person
 * means by "my phone".
 *
 * **IT SAID "DECIDED ONCE" AND WAS RECOMPUTED ON EVERY CALL, WHICH SIGNED
 * DESKTOP USERS OUT AT RANDOM.** `max-width: 900px` is a live media query, so
 * narrowing a desktop window — a docked browser, a split screen, dev tools
 * opened wide — flipped this from 'desktop' to 'mobile' mid-session. Everything
 * keys on it: the next `checkDevice()` heartbeat then looked up the MOBILE row,
 * found the phone's `device_id` there instead of its own, concluded it had been
 * evicted, and signed the person out saying they had signed in on another phone.
 * Resizing a window is not signing in on a phone.
 *
 * It is worse than a spurious sign-out, because `claimDevice()` reads the same
 * value: a narrowed desktop would TAKE the phone's slot and evict the actual
 * phone. Two devices are allowed, and one of them could evict the other by
 * being resized.
 *
 * So the fix is persistence, not a better breakpoint — no threshold can be
 * right, because the quantity being measured is not supposed to change. The
 * kind is measured the first time this browser is asked and written next to the
 * device id; from then on the stored value is returned whatever the window is
 * doing. A phone cannot become a desktop, and a desktop cannot stop being one
 * because somebody dragged its edge.
 */
export function deviceKind(): DeviceKind {
  try {
    const saved = localStorage.getItem(KIND_KEY);
    if (saved === 'desktop' || saved === 'mobile') return saved;
    const fresh = measureKind();
    localStorage.setItem(KIND_KEY, fresh);
    return fresh;
  } catch {
    /* Private mode, or storage disabled — the same fallback `deviceId()` takes,
       and the same trade: the kind can then flip within a session, but such a
       browser also gets a fresh device id every time and cannot hold a slot
       across visits anyway. */
    return measureKind();
  }
}

/**
 * How many devices one account may hold at once.
 *
 * NOT A COUNTER, AND NOTHING READS THIS TO DECIDE ANYTHING. The limit is a
 * consequence of the schema — `device_sessions` has `primary key (user_id,
 * kind)` and `kind` is checked against exactly these two values, so the table
 * physically cannot hold three rows for one account. That is why there is no
 * "how many devices are signed in" query anywhere: counting races, and two
 * simultaneous logins would both read "one device" and both insert.
 *
 * This exists so the number can be stated in copy and asserted in a test
 * without either of them hardcoding a 2 that nothing keeps honest.
 */
export const DEVICE_KINDS: readonly DeviceKind[] = ['desktop', 'mobile'];
export const MAX_DEVICES_PER_ACCOUNT = DEVICE_KINDS.length;
