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

/** What each tier is CALLED to a person.
 *
 * **`free` AND `trial` ARE BOTH "Member", and that is the point of this map.**
 * Signing up is what makes somebody a member; the three-day trial is an ACCESS
 * window running on top of that, not a different kind of person. An account
 * whose trial has lapsed has not stopped being a member — it has stopped having
 * Pro reach — so the word does not change when the countdown ends. Only what
 * the account can open does.
 *
 * `free` used to read "Free" here, which produced an account that was called
 * one thing for three days and something worse afterwards, with no badge at
 * all once the trial ran out. The field book already disagreed with that: its
 * access plate has called a signed-in free account "Member" since it was
 * written.
 *
 * THE STORED VALUES ARE UNTOUCHED. `free` and `trial` are what the database,
 * `effective_tier()`, the entitlement matrix and `trial_ends_at` all key on;
 * renaming a stored value to change a word on screen is how those drift apart.
 * This map is a display concern and nothing reads it to make a decision.
 *
 * `anon` is not in here because it is not a tier — someone who has not signed
 * in is not a member of anything, and gets no badge.
 */
export const TIER_LABEL: Record<Tier, string> = {
  admin: 'Admin',
  pro: 'Pro',
  trial: 'Member',
  free: 'Member',
};

/**
 * What each tier is called TO AN OPERATOR, in the admin console.
 *
 * A SECOND MAP, because it answers a different question. `TIER_LABEL` says what
 * a person is; this says what state their row is in — and an admin scanning a
 * table of accounts needs "free" and "trial" to be two words, because the whole
 * reason to look is to see who is on a countdown and who has run out. Collapsing
 * them to "Member" there would make the console agree with the badge and stop
 * telling the operator anything.
 *
 * "Trial" is the honest word for that view: it is what the account is TO US,
 * a countdown we are running.
 */
export const TIER_ADMIN_LABEL: Record<Tier, string> = {
  admin: 'Admin',
  pro: 'Pro',
  trial: 'Trial',
  free: 'Free',
};

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
export const FREE_SECTIONS = [
  'Search Player',
  /* FREE, and it sits directly under the search for the same reason. This is
     the rawest thing the database holds — a list of battles that happened —
     and putting the plainest answer behind the gate would mean a visitor who
     types a tag is told the tag is worth nothing to them. What costs money is
     the reading of those rows, which is every other area. */
  'Recent Battles',
  'Top Meta Decks',
  'Deck Counter',
] as const;

/**
 * Areas a TRIAL does not open. Paid Pro or admin only.
 *
 * The trial is otherwise "everything, for three days", so this is a deliberate
 * carve-out rather than a tier: Coach Assist is the deep end — a mid-duel read
 * of an opponent's next deck, ranked against yours — and it is the reason to
 * subscribe rather than a sample of what subscribing is like. A three-day trial
 * that includes it has already given away the thing it exists to sell.
 *
 * THE GATE CARD ALREADY KNEW ABOUT THIS CASE before the rule did: it has
 * carried the sentence "Your trial has N days left, but this area needs Pro"
 * since it was written, and until now no combination of tier and section could
 * produce it. That copy is what this makes true.
 */
/**
 * TEAM ANALYSIS IS NOT HERE, AND THAT WAS ARGUED BOTH WAYS.
 *
 * The case for putting it here: it is the squad-scale version of Coach Assist,
 * and it is the most expensive thing the service does — one run resolves up to
 * twenty players, enrols the ones nobody is tracking, and profiles every deck
 * the blue squad plays.
 *
 * The case that won: a carve-out from the trial is a carve-out from the SALES
 * PITCH. Coach Assist is withheld because it is the thing being sold and can be
 * described in a sentence — a trialist knows what they are not getting. Team
 * Analysis cannot be described that way; it has to be USED, on a real roster,
 * before it is worth paying for. Withholding it during the three days means the
 * trial never shows the feature most likely to convert it.
 *
 * So it is an ordinary gated area: closed to anon and free, open to trial, pro
 * and admin. The cost objection is answered by the account requirement, which
 * is what actually stops an anonymous paste box from spending sixteen player
 * resolutions.
 */
export const PRO_ONLY_SECTIONS = ['Coach Assist'] as const;

/**
 * Areas only an ADMIN may open. Stricter than pro-only.
 *
 * NOT A TIER, and not a permanent home for anything — this is the staging shelf
 * this project does not otherwise have. `main` deploys straight to production
 * (see "Open on the accounts and hosting work"), so the only way to try a new
 * screen against real data is to ship it and then be the only person who can
 * reach it.
 *
 * **EMPTY, and that is the shelf working rather than the shelf being unused.**
 * Team Analysis sat here while it was verified against real data. It has been:
 * the parser, the saves, the dossier and the layout were all checked against a
 * live database and in a browser, so it has come off. The mechanism stays,
 * because the next screen will want it.
 *
 * A section listed here is HIDDEN rather than locked — there is no point
 * drawing a gate card that says "become an admin" — and that is the reason
 * this list is not a substitute for the pro carve-out. Anything here is
 * invisible, so nobody can want it.
 */
export const ADMIN_ONLY_SECTIONS = [] as const;

function adminOnly(section: string): boolean {
  return (ADMIN_ONLY_SECTIONS as readonly string[]).includes(section);
}

function proOnly(section: string): boolean {
  return (PRO_ONLY_SECTIONS as readonly string[]).includes(section);
}

/** True when this tier may open the named analytics area. */
export function canOpenSection(tier: Tier, section: string): boolean {
  // BEFORE the pro/admin short-circuit, or `pro` would open an admin-only area.
  if (adminOnly(section)) return tier === 'admin';
  if (tier === 'pro' || tier === 'admin') return true;
  if (tier === 'trial') return !proOnly(section);
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
  // FIRST, for the same reason as above: an admin-only area is closed to every
  // other access level including paid Pro, so no later branch may open it.
  if (adminOnly(section)) return access === 'admin';
  if (access === 'anon' || access === 'free') {
    return (FREE_SECTIONS as readonly string[]).includes(section);
  }
  // A trial opens everything EXCEPT the pro-only carve-out.
  if (access === 'trial') return !proOnly(section);
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
 * Paid Pro or admin — NOT a trial.
 *
 * Deliberately separate from `isEntitled`, which a trial does satisfy. The two
 * answer different questions: `isEntitled` is "has this reader got the product"
 * (the full counter list, the export, no upgrade nag), and this is "has this
 * reader PAID", which only the pro-only carve-out cares about.
 */
export function isPaid(access: Access): boolean {
  return access === 'pro' || access === 'admin';
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
