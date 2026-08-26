import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * The one Supabase client, and the one place that knows whether it exists.
 *
 * WHY THIS CAN BE NULL. The 20-account test gate still works, and a build
 * without Supabase configured must keep working rather than crash on a missing
 * environment variable — `royal-duels.vercel.app` and every local checkout are
 * in exactly that state until the variables are set. `isSupabaseConfigured`
 * lets the auth store fall back instead of the whole app failing to mount.
 *
 * BOTH VALUES ARE PUBLIC. The publishable key ships inside the JavaScript
 * bundle; anyone can read it out of the network tab. That is by design, and it
 * is only safe because every table in `supabase/001_accounts.sql` has Row Level
 * Security on with policies keyed to `auth.uid()`, which comes from a verified
 * JWT and cannot be forged by a client holding this key. Nothing here is a
 * secret, and nothing that IS a secret may ever be given a `VITE_` prefix —
 * Vite inlines those at build time, so the prefix is the boundary.
 */

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /* The app routes on the hash (`#/builder`), and Supabase's OAuth
           callback also comes back in the hash. Detecting it here is what lets
           a Google sign-in land back on the site signed in; without it the
           tokens sit in the URL unread and the user bounces to the login
           screen having just logged in. */
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

/** Tiers, in the order they unlock things. See `effective_tier()` in the SQL. */
export type Tier = 'free' | 'trial' | 'pro' | 'admin';

export interface Profile {
  id: string;
  display_name: string | null;
  country: string | null;
  player_tag: string | null;
  role: 'free' | 'pro' | 'admin';
  trial_ends_at: string | null;
  onboarded_at: string | null;
  created_at: string;
}

/**
 * The tier a profile is actually on, right now.
 *
 * DERIVED, NEVER STORED. Item 1 wants the account to "switch automatically"
 * when the three days are up, and the way to make that reliable is to have
 * nothing switch: the answer is computed from `trial_ends_at` at the moment it
 * is asked, so it changes exactly on time even if no job ever runs.
 *
 * Mirrors `public.effective_tier()` in the database on purpose. The database
 * copy is the one that guards data; this one only decides what to draw, and a
 * client that lies to itself about the tier gets a nicer-looking screen and no
 * extra access.
 */
export function tierOf(profile: Profile | null, now: number = Date.now()): Tier {
  if (!profile) return 'free';
  if (profile.role === 'admin') return 'admin';
  if (profile.role === 'pro') return 'pro';
  if (profile.trial_ends_at && Date.parse(profile.trial_ends_at) > now) return 'trial';
  return 'free';
}

/** Whole days left on a trial, or 0. Used for the countdown in the header. */
export function trialDaysLeft(profile: Profile | null, now: number = Date.now()): number {
  if (!profile?.trial_ends_at) return 0;
  const ms = Date.parse(profile.trial_ends_at) - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/**
 * What a tier may open.
 *
 * Item 1: after the three-day trial an account drops to the normal version and
 * keeps "meta and Evo counter". Those are the two areas listed here; the other
 * five need a paid tier.
 */
export const FREE_SECTIONS = ['Top Meta Decks', 'Deck Counter'] as const;

export function canOpenSection(tier: Tier, section: string): boolean {
  if (tier !== 'free') return true;
  return (FREE_SECTIONS as readonly string[]).includes(section);
}
