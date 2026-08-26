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

/* THE ENTITLEMENT RULES LIVE IN `tiers.ts`, NOT HERE, and re-export from it
   so every existing import keeps working.

   They were moved because this module constructs a Supabase client at load, so
   importing a pure rule to check it dragged in a client that wants a native
   WebSocket -- which Node 21 does not have. The tier matrix is the single thing
   most worth testing exhaustively, and it could not be imported by a test at
   all. Same extraction, and the same reason, as `utils/format.ts`. */
export {
  FREE_SECTIONS,
  PRO_ONLY_SECTIONS,
  canOpenSection,
  gateReason,
  isEntitled,
  isPaid,
  sectionAllowed,
  tierOf,
  trialDaysLeft,
} from './tiers';
export type { Access, Profile, Tier } from './tiers';
