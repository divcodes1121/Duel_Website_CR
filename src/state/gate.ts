import { useAccountStore } from './accountStore';
import { isSupabaseConfigured } from './supabase';
import type { Access } from './tiers';

/**
 * Who may open what.
 *
 * THE SITE IS PUBLIC AND THE GATE IS PER-FEATURE. The first build of this put
 * a sign-in wall in front of the whole app, which was the wrong reading: the
 * main page is meant to be the main page, and signing in is what happens when
 * someone reaches for something the free tier does not include. A wall in front
 * of everything asks a stranger to commit before they have seen anything.
 *
 * `anon` and `free` get the SAME sections deliberately. Item 1 says a lapsed
 * account keeps "meta and Evo counter"; a visitor who has not signed up has no
 * claim to more than that, and giving them less would mean the public page is
 * not really public.
 */

export type { Access } from './tiers';

export function useAccess(): Access {
  const ready = useAccountStore((s) => s.ready);
  const userId = useAccountStore((s) => s.userId);
  const tier = useAccountStore((s) => s.tier);

  /* Without Supabase there is nothing to gate against, and gating anyway would
     lock every local checkout out of five screens. */
  if (!isSupabaseConfigured) return 'admin';
  if (!ready || !userId) return 'anon';
  return tier;
}

/* The pure rules live in `tiers.ts` and are re-exported so every call site
   here is unchanged. Only `useAccess` needs the store, which is the whole
   reason for the split: a component can ask "may this tier open X" without
   pulling a Supabase client into a test. */
export {
  FREE_SECTIONS,
  PRO_ONLY_SECTIONS,
  gateReason,
  isEntitled,
  isPaid,
  sectionAllowed,
} from './tiers';
