import { useAccountStore } from './accountStore';
import { FREE_SECTIONS, isSupabaseConfigured, type Tier } from './supabase';

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

export type Access = 'anon' | Tier;

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

/** True when this access level may open the named analytics area. */
export function sectionAllowed(access: Access, section: string): boolean {
  if (access === 'anon' || access === 'free') {
    return (FREE_SECTIONS as readonly string[]).includes(section);
  }
  return true;
}

/**
 * Why a section is closed, which decides what the gate card offers.
 *
 * The two are genuinely different asks — one is "make an account, it is free
 * for three days", the other is "your three days are up". Showing a stranger an
 * upgrade prompt, or a lapsed user a sign-up prompt, is the kind of wrong-footed
 * message that reads as the site not knowing who you are.
 */
export function gateReason(access: Access): 'signin' | 'upgrade' {
  return access === 'anon' ? 'signin' : 'upgrade';
}

/** Sections everyone can open, for rendering a lock next to the rest. */
export { FREE_SECTIONS };
