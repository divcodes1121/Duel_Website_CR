import { create } from 'zustand';

import { type Profile, type Tier, supabase, tierOf } from './supabase';

/**
 * The signed-in account: session, profile, tier, and the device claim.
 *
 * SEPARATE FROM `authStore`, not a replacement for it — yet. `authStore` is the
 * 20-account test gate, and it is still what `api/decks.ts`, the analytics
 * proxy and the OIE allowlist authenticate against, because all three key on
 * `sha256(username:password)`. Ripping it out before those are migrated would
 * take deck sync and the Coach down with it. This store runs alongside until
 * the server side moves, and `App.tsx` prefers a real account when one exists.
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

    supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      set({ userId: u?.id ?? null, email: u?.email ?? null, evicted: false });
      if (u) void get().refreshProfile();
      else set({ profile: null, tier: 'free' });
    });
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
