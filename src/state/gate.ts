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

/**
 * MAY THIS ACCOUNT USE COACH ROSTER?
 *
 * Admin OR the `is_coach` flag, and the two are deliberately independent:
 * coaching is not administering, and an owner who wants somebody to coach
 * should not have to hand them the console to do it. An admin keeps it
 * unconditionally so the console's own link always works.
 *
 * `is_coach` is absent on a database still on 006 — read as false, because
 * nobody should gain access by a column failing to arrive.
 */
export function useIsCoach(): boolean {
  const ready = useAccountStore((s) => s.ready);
  const profile = useAccountStore((s) => s.profile);
  const access = useAccess();
  if (!isSupabaseConfigured) return true;
  if (!ready) return false;
  return access === 'admin' || profile?.is_coach === true;
}

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
