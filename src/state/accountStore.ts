import { create } from 'zustand';

import { type Profile, type Tier, supabase, tierOf } from './supabase';

/**
 * The signed-in account: session, profile, tier, and the device claim.
 *
 * THE ONLY ACCOUNT SYSTEM. `authStore` — the 20-account test gate keyed on
 * `sha256(username:password)` — is deleted, along with its bundled hashes and
 * the script that generated them. All three consumers it used to serve now
 * verify a Supabase JWT instead: `api/decks.ts`, the analytics proxy and the
 * OIE allowlist.
 */

export type DeviceKind = 'desktop' | 'mobile';

interface AccountState {
  ready: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  tier: Tier;
  /** Set when this device lost its slot to a newer login of the same kind. */
  evicted: boolean;

  init: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  claimDevice: () => Promise<void>;
  checkDevice: () => Promise<void>;
  saveProfile: (patch: Partial<Profile>) => Promise<string | null>;
  signOut: () => Promise<void>;
}

/**
 * A stable id for THIS browser, so the device rules can tell "the same laptop
 * again" from "a second laptop".
 *
 * localStorage, not a cookie or a fingerprint: it survives a refresh, it is
 * per-browser-profile, and clearing site data resets it — which is the honest
 * behaviour. Fingerprinting would be harder to shake off and is not something
 * to build into a deck site.
 */
const DEVICE_KEY = 'dekkies-device-id';

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

/**
 * Desktop or mobile, decided once.
 *
 * Coarse on purpose. Item 7 wants one of each, and the line only has to be
 * stable for a given device — a tablet counting as "mobile" is a judgement
 * call, not a bug, and `pointer: coarse` is the closest thing to what a person
 * means by "my phone".
 */
export function deviceKind(): DeviceKind {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  return coarse || narrow ? 'mobile' : 'desktop';
}

export const useAccountStore = create<AccountState>()((set, get) => ({
  ready: false,
  userId: null,
  email: null,
  profile: null,
  tier: 'free',
  evicted: false,

  async init() {
    if (!supabase) {
      set({ ready: true });
      return;
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    set({ userId: user?.id ?? null, email: user?.email ?? null, ready: true });
    if (user) await get().refreshProfile();

    if (user) await get().claimDevice();

    supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      set({ userId: u?.id ?? null, email: u?.email ?? null });
      if (u) {
        set({ evicted: false });
        void get().refreshProfile();
        void get().claimDevice();
      } else {
        set({ profile: null, tier: 'free' });
      }
    });

    /* ITEM 7, THE OTHER HALF. The database enforces one row per (user, kind);
       this is how the LOSER of that contest finds out. A minute is short enough
       that a shared account is unusable and long enough to be free, and the
       focus listener means the common case — someone comes back to a tab —
       is checked immediately rather than up to a minute later. */
    const beat = () => {
      void get().checkDevice();
      /* A TRIAL HAS TO EXPIRE WHILE YOU ARE LOOKING AT THE PAGE.
         `tier` is derived from `trial_ends_at`, but it was derived ONCE, when
         the profile loaded — so a tab left open across the expiry kept every
         paid screen until someone happened to refresh. Recomputing it on the
         beat costs nothing and needs no network: the timestamp is already in
         hand, and `tierOf` is a comparison against the clock.
         Only written when it actually changes, so this does not re-render the
         app every sixty seconds. */
      const { profile, tier } = get();
      const now = tierOf(profile);
      if (now !== tier) set({ tier: now });
    };
    setInterval(beat, 60_000);
    window.addEventListener('focus', beat);
  },

  /**
   * Take this device's slot, evicting whatever held it.
   *
   * An upsert on the primary key `(user_id, kind)`: there is no "how many
   * devices are signed in" query and no counting, because counting races. The
   * table simply cannot hold two desktops for one account.
   */
  async claimDevice() {
    const id = get().userId;
    if (!supabase || !id) return;
    await supabase.from('device_sessions').upsert(
      {
        user_id: id,
        kind: deviceKind(),
        device_id: deviceId(),
        /* Truncated: it is for showing "Chrome on Windows" in the admin list,
           not for fingerprinting, and a full UA string is 200+ characters of
           noise in every row. */
        user_agent: navigator.userAgent.slice(0, 180),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,kind' },
    );
  },

  /**
   * Have we been evicted by a newer login of the same kind?
   *
   * Reads the row rather than trusting local state: the eviction happened on
   * ANOTHER device, so nothing here could know about it otherwise.
   */
  async checkDevice() {
    const id = get().userId;
    if (!supabase || !id || get().evicted) return;
    const { data, error } = await supabase
      .from('device_sessions')
      .select('device_id')
      .eq('user_id', id)
      .eq('kind', deviceKind())
      .maybeSingle();
    /* A network failure must NOT sign anyone out. Being offline is not the
       same as having lost your slot, and treating it as such would log people
       out of a working app every time their connection blinked. */
    if (error || !data) return;
    if (data.device_id !== deviceId()) {
      set({ evicted: true });
      await supabase.auth.signOut();
      set({ userId: null, email: null, profile: null, tier: 'free' });
    }
  },

  async refreshProfile() {
    const id = get().userId;
    if (!supabase || !id) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, country, player_tag, role, trial_ends_at, onboarded_at, created_at')
      .eq('id', id)
      .maybeSingle();
    const profile = (data as Profile | null) ?? null;
    set({ profile, tier: tierOf(profile) });
  },

  async saveProfile(patch) {
    const id = get().userId;
    if (!supabase || !id) return 'Not signed in.';
    /* `role` and `trial_ends_at` are NOT in this list, and must never be. The
       update policy lets someone write their own row, so anything reachable
       here is something they can set — a client that could patch `role` could
       make itself Pro, or admin, for free. Those two move only through
       `admin_set_role`, which checks the caller. */
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: patch.display_name,
        country: patch.country,
        player_tag: patch.player_tag,
        onboarded_at: patch.onboarded_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) return error.message;
    await get().refreshProfile();
    return null;
  },

  async signOut() {
    if (!supabase) return;
    const id = get().userId;
    if (id) {
      /* Release the slot rather than leaving it held. Otherwise signing out on
         a laptop and back in on another would look like an eviction to a user
         who only has one laptop. */
      await supabase
        .from('device_sessions')
        .delete()
        .eq('user_id', id)
        .eq('kind', deviceKind());
    }
    await supabase.auth.signOut();
    set({ userId: null, email: null, profile: null, tier: 'free', evicted: false });
  },
}));
