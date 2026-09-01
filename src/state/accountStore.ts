import { create } from 'zustand';

import { type Profile, type Tier, supabase, tierOf } from './supabase';
/* THE DEVICE RULES MOVED OUT so they can be tested without constructing a
   Supabase client — the third time this extraction has been made here, after
   `tiers.ts` and `utils/format.ts`. Re-exported below, so every existing
   `import { deviceKind } from './accountStore'` keeps working. */
import { type DeviceKind, deviceId, deviceKind } from './deviceIdentity';

export { deviceId, deviceKind };
export type { DeviceKind };

/**
 * The signed-in account: session, profile, tier, and the device claim.
 *
 * THE ONLY ACCOUNT SYSTEM. `authStore` — the 20-account test gate keyed on
 * `sha256(username:password)` — is deleted, along with its bundled hashes and
 * the script that generated them. All three consumers it used to serve now
 * verify a Supabase JWT instead: `api/decks.ts`, the analytics proxy and the
 * OIE allowlist.
 */


interface AccountState {
  ready: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  tier: Tier;
  /** Set when this device lost its slot to a newer login of the same kind. */
  evicted: boolean;
  /**
   * The session came from a password-recovery link, so the ONLY thing this
   * person may do is set a new password.
   *
   * RUNTIME-ONLY, never persisted, like `activeSavedId` in the builder. It
   * describes how the CURRENT session started, and a flag restored from storage
   * would trap someone on a reset screen forever after a refresh — with no way
   * out, because the link that authorised it is single-use and already spent.
   */
  recovering: boolean;

  init: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  claimDevice: () => Promise<void>;
  checkDevice: () => Promise<void>;
  saveProfile: (patch: Partial<Profile>) => Promise<string | null>;
  /** Set a new password. Returns an error message, or null on success. */
  changePassword: (next: string) => Promise<string | null>;
  /** Confirm the CURRENT password. Returns an error message, or null if right. */
  verifyPassword: (current: string) => Promise<string | null>;
  /** Leave the reset screen without setting one. */
  cancelRecovery: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Does the URL we were opened with look like a password-recovery link?
 *
 * Supabase can deliver a recovery in three shapes and this has to read all
 * three, because which one arrives depends on the project's email template and
 * on the client's `flowType` — neither of which is decided in this file:
 *   - `?code=…`             the PKCE exchange, what `flowType: 'pkce'` asks for;
 *   - `#access_token=…&type=recovery`  the older implicit hash form;
 *   - `?token_hash=…&type=recovery`    a template using `{{ .TokenHash }}`.
 *
 * `?code=` ALONE IS NOT ENOUGH TO GO ON. An OAuth sign-in comes back with a
 * `code` too, and treating that as a recovery would trap anyone who signed in
 * with Google on a set-a-new-password screen. So a bare `code` is only read as
 * recovery when the link also says so — which is what `type=recovery` is for,
 * and why `redirectTo` below is given an explicit `#/reset`.
 *
 * The app routes on the hash, so a `#/reset` route is the signal we control and
 * the one that survives Supabase having already stripped its own parameters.
 */
function recoveryInUrl(): boolean {
  try {
    const { search, hash } = window.location;
    if (hash.startsWith('#/reset')) return true;
    if (/[?&]type=recovery\b/.test(search)) return true;
    /* The implicit form puts its parameters in the hash, after the `#`, which
       is also where our routes live — hence matching on the parameter rather
       than parsing the hash as a route. */
    if (/[#&]type=recovery\b/.test(hash)) return true;
    return false;
  } catch {
    return false;
  }
}

export const useAccountStore = create<AccountState>()((set, get) => ({
  ready: false,
  userId: null,
  email: null,
  profile: null,
  tier: 'free',
  evicted: false,
  recovering: false,

  async init() {
    if (!supabase) {
      set({ ready: true });
      return;
    }
    /* A RECOVERY LINK IS ALREADY IN THE URL BY THE TIME THIS RUNS, and that is
       why the flag is read here as well as from the event below. `createClient`
       has `detectSessionInUrl: true`, so the code is exchanged during module
       load — which can complete BEFORE `onAuthStateChange` is subscribed, and
       the `PASSWORD_RECOVERY` event is then delivered to nobody. Reading the URL
       ourselves closes that race; the listener catches the slower case. Neither
       alone was reliable. */
    if (recoveryInUrl()) set({ recovering: true });

    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    set({ userId: user?.id ?? null, email: user?.email ?? null, ready: true });
    if (user) await get().refreshProfile();

    if (user) await get().claimDevice();

    supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      set({ userId: u?.id ?? null, email: u?.email ?? null });
      /* THE EVENT NAME IS THE POINT, and it used to be discarded as `_event`.
         Supabase distinguishes a recovery session from an ordinary sign-in, and
         throwing that away is precisely why "Forgot your password?" used to
         send a link that silently logged people in and changed nothing. */
      if (event === 'PASSWORD_RECOVERY') set({ recovering: true });
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

  /**
   * Set a new password on the signed-in account.
   *
   * ONE CALL FOR BOTH DOORS — the recovery screen and the account dialog — for
   * the reason the codebase keeps re-learning: two copies of a rule become two
   * different rules. `updateUser` is the only Supabase call that can set a
   * password, and before this it appeared NOWHERE in the repo, which is why
   * neither door existed.
   *
   * It returns the message rather than storing it: the caller owns its own
   * error line, and a store field would leak one screen's failure onto another.
   */
  async changePassword(next) {
    if (!supabase) return 'Accounts are not configured.';
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) return error.message;
    /* The recovery link is spent and the password is set, so this is an
       ordinary session from here on. Clearing the flag is what releases the
       reader into the app — without it they would sit on the reset screen
       having just succeeded. */
    set({ recovering: false });
    /* A recovery session skipped this on the way in (see `App.tsx`): the device
       slot is claimed only once the account is actually in the person's hands. */
    await get().claimDevice();
    return null;
  },

  /**
   * Is this actually the current password?
   *
   * BY SIGNING IN WITH IT, because that is the only check a client can make —
   * there is no "verify my password" endpoint, and there could not be one that
   * a browser holding only the publishable key could trust.
   *
   * WHY BOTHER, given the caller already has a valid session: `updateUser` will
   * set a new password from nothing but that session, so without this an
   * unattended signed-in browser is enough to take an account over. The check
   * turns "has this laptop" into "knows the password".
   *
   * A FAILED ATTEMPT DOES NOT DISTURB THE LIVE SESSION — Supabase leaves the
   * existing tokens alone when `signInWithPassword` rejects — so a typo costs a
   * message and nothing else. A SUCCESSFUL one issues fresh tokens for the same
   * user, which is why `changePassword` can run straight afterwards.
   *
   * The message is passed through rather than rewritten: "Invalid login
   * credentials" is Supabase's deliberately vague wording, and it is the honest
   * thing to show for a wrong password here too.
   */
  async verifyPassword(current) {
    if (!supabase) return 'Accounts are not configured.';
    const email = get().email;
    if (!email) return 'Not signed in.';
    const { error } = await supabase.auth.signInWithPassword({ email, password: current });
    if (error) return /invalid/i.test(error.message)
      ? 'That is not your current password.'
      : error.message;
    return null;
  },

  /**
   * Give up on the reset and go back to being signed out.
   *
   * A FULL SIGN-OUT, not just clearing the flag. The recovery link grants a real
   * session, so a reader who abandons the screen while still holding it would be
   * quietly signed in on the strength of an email link they chose not to use —
   * and, worse, signed in to an account whose password they by definition do not
   * know. Dropping the session is the only honest exit.
   */
  async cancelRecovery() {
    set({ recovering: false });
    await get().signOut();
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
    set({ userId: null, email: null, profile: null, tier: 'free', evicted: false, recovering: false });
  },
}));
