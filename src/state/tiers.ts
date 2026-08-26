/**
 * WHO MAY OPEN WHAT — the entitlement rules, and nothing else.
 *
 * NO IMPORTS, DELIBERATELY, and this file exists BECAUSE of that constraint.
 * These rules used to live in `supabase.ts`, which constructs a Supabase client
 * at module load; importing them to check a rule therefore dragged in a client
 * that wants a native WebSocket, and Node 21 does not have one. So the one
 * thing most worth testing exhaustively — the tier matrix — could not be tested
 * at all without the network stack of a browser.
 *
 * Same lesson as `utils/format.ts`, which was extracted from `adminStore.ts`
 * for the identical reason: **a pure rule must not sit behind a client
 * construction.** `supabase.ts` and `gate.ts` both re-export from here, so every
 * existing call site is unchanged.
 *
 * THE DATABASE IS THE REAL BOUNDARY. Everything here decides what to DRAW. A
 * client that lies to itself about its tier gets a nicer-looking screen and no
 * extra access, because `public.effective_tier()` guards the data and is the
 * copy that counts. These two must agree, and the SQL is the one that wins.
 */

/** Tiers, in the order they unlock things. Mirrors `effective_tier()`. */
export type Tier = 'free' | 'trial' | 'pro' | 'admin';

/** A tier, plus the state of never having signed in. */
export type Access = 'anon' | Tier;

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
 * DERIVED, NEVER STORED. The trial has to "switch automatically" when the three
 * days are up, and the way to make that reliable is to have nothing switch: the
 * answer is computed from `trial_ends_at` at the moment it is asked, so it
 * expires exactly on time even if no job ever runs — and so an open tab can
 * re-lock itself by asking again, without re-reading the profile.
 *
 * A PAID ROLE OUTRANKS THE CLOCK. `role` is checked before `trial_ends_at`,
 * because the trial is a grant to a FREE account rather than a component of a
 * paid one. A pro whose old trial timestamp has lapsed is still pro; reading
 * the clock first would take a paying reader's access away.
 */
export function tierOf(profile: Profile | null, now: number = Date.now()): Tier {
  if (!profile) return 'free';
  if (profile.role === 'admin') return 'admin';
  if (profile.role === 'pro') return 'pro';
  if (profile.trial_ends_at && Date.parse(profile.trial_ends_at) > now) return 'trial';
  return 'free';
}

/**
 * Whole days left on a trial, or 0.
 *
 * CEIL, NOT FLOOR. Three days minus a few microseconds floors to 2, so a fresh
 * trial would read "2 days left" the instant it started, as though a day had
 * been taken at signup.
 */
export function trialDaysLeft(profile: Profile | null, now: number = Date.now()): number {
  if (!profile?.trial_ends_at) return 0;
  const ms = Date.parse(profile.trial_ends_at) - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/**
 * What a lapsed or anonymous reader keeps.
 *
 * The brief: after the three-day trial an account drops to the normal version
 * and keeps "meta and Evo counter" — Top Meta Decks and Deck Counter.
 *
 * SEARCH PLAYER IS FREE TOO, and that is a judgement rather than a reading of
 * the brief. It is the tag overview behind the hero's search field, which is
 * the landing page's entire call to action. Gating it would mean a stranger
 * types their tag into the biggest control on a public page and is handed a
 * paywall — the search would be a tease rather than a demonstration. The five
 * deeper areas are what a trial is for.
 */
export const FREE_SECTIONS = ['Search Player', 'Top Meta Decks', 'Deck Counter'] as const;

/** True when this tier may open the named analytics area. */
export function canOpenSection(tier: Tier, section: string): boolean {
  if (tier !== 'free') return true;
  return (FREE_SECTIONS as readonly string[]).includes(section);
}

/**
 * True when this access level may open the named analytics area.
 *
 * `anon` and `free` get the SAME sections deliberately. A lapsed account keeps
 * meta and the counter; a visitor who has not signed up has no claim to more
 * than that, and giving them less would mean the public page is not public.
 */
export function sectionAllowed(access: Access, section: string): boolean {
  if (access === 'anon' || access === 'free') {
    return (FREE_SECTIONS as readonly string[]).includes(section);
  }
  return true;
}

/**
 * True when this access level has paid for — or been granted — everything.
 *
 * ONE PREDICATE, because the alternative is what actually shipped: three
 * separate places each deciding for themselves what "has Pro" means, and two of
 * them not deciding at all. The Deck Counter hid counters past the third from
 * every reader including admins, and the rail asked pro accounts to Upgrade
 * Now. Both were written before tiers existed and neither consulted one.
 */
export function isEntitled(access: Access): boolean {
  return access === 'trial' || access === 'pro' || access === 'admin';
}

/**
 * Why a section is closed, which decides what the gate card offers.
 *
 * The two are genuinely different asks — "make an account, it is free for three
 * days" versus "your three days are up". Showing a stranger an upgrade prompt,
 * or a lapsed user a sign-up prompt, reads as the site not knowing who you are.
 */
export function gateReason(access: Access): 'signin' | 'upgrade' {
  return access === 'anon' ? 'signin' : 'upgrade';
}
