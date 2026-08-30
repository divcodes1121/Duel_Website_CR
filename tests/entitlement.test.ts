import { describe, expect, it } from 'vitest';

/* IMPORTED FROM `tiers.ts`, NOT from `supabase.ts` or `gate.ts`, and that is
   the point of the extraction: both of those construct or pull in a Supabase
   client at module load, which wants a native WebSocket that Node 21 lacks. A
   test of a pure rule must not need a network stack. */
import {
  ADMIN_ONLY_SECTIONS,
  TIER_ADMIN_LABEL,
  TIER_LABEL,
  FREE_SECTIONS,
  PRO_ONLY_SECTIONS,
  canOpenSection,
  gateReason,
  isEntitled,
  isPaid,
  sectionAllowed,
  tierOf,
  trialDaysLeft,
} from '../src/state/tiers';
import type { Access, Profile, Tier } from '../src/state/tiers';
import { canExportDecks } from '../src/utils/deckExport';

/**
 * WHAT A TIER MAY OPEN — the whole matrix, asserted rather than assumed.
 *
 * This exists because "pro and admin should have everything unlocked" turned
 * out to be true of the routing gate and false of two other places that pre-
 * dated it: the Deck Counter's own ProLock over the counters past the third,
 * and the sidebar card asking a paying reader to Upgrade Now. Both consulted
 * nothing. A gate written before the tier system existed does not consult it,
 * and the only way to know is to enumerate.
 *
 * Every assertion below is over PURE functions — no store, no network, no
 * Supabase client — which is what makes the matrix cheap enough to be
 * exhaustive.
 */

const ALL_SECTIONS = [
  'Search Player',
  'Recent Battles',
  'Top Meta Decks',
  'Deck Analysis',
  'Duel Analysis',
  'Duel Zone',
  'Cards',
  'Deck Counter',
  'Coach Assist',
  /* Pro-only, alongside Coach Assist. Added 30 Aug 2026 with the Team
     Analysis screen — this list is a tripwire, so a new area has to be
     enumerated here before the matrix below can claim to be exhaustive. */
  'Team Analysis',
] as const;

const PAID: Access[] = ['trial', 'pro', 'admin'];
const UNPAID: Access[] = ['anon', 'free'];

const DAY = 86_400_000;

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    display_name: 'Test',
    country: null,
    player_tag: null,
    role: 'free',
    trial_ends_at: null,
    onboarded_at: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

describe('paid Pro and admin open everything except the admin shelf', () => {
  /* `pro` USED TO OPEN EVERYTHING, and this test used to say so. It stopped
     being true when `ADMIN_ONLY_SECTIONS` arrived — the staging shelf this
     project has no other way to provide, since `main` deploys to production.
     Stated as an exclusion rather than quietly narrowed, so the day something
     leaves that shelf this test is what notices. */
  it('admin opens literally every section', () => {
    for (const section of ALL_SECTIONS) {
      expect(sectionAllowed('admin', section), section).toBe(true);
    }
  });

  it('pro opens everything that is not on the admin shelf', () => {
    const rest = ALL_SECTIONS.filter(
      (x) => !(ADMIN_ONLY_SECTIONS as readonly string[]).includes(x),
    );
    for (const section of rest) {
      expect(sectionAllowed('pro', section), section).toBe(true);
    }
  });

  for (const access of PAID) {
    it(`${access} may export decks`, () => {
      expect(canExportDecks(access)).toBe(true);
    });
  }
});

describe('a trial opens everything EXCEPT the pro-only areas', () => {
  /* The carve-out. A trial is otherwise "everything for three days"; Coach
     Assist is the thing a subscription is FOR, and a trial that includes it has
     given away what it exists to sell.

     TEAM ANALYSIS IS DELIBERATELY NOT IN IT, and this comment is the record of
     that reversal — it used to be, on the argument that the squad-scale read
     should not be priced below the one-opponent one. What changed the decision
     is that a carve-out from the trial is a carve-out from the sales pitch:
     Coach Assist can be described in a sentence, so a trialist knows what they
     are missing, and Team Analysis cannot — it has to be used on a real roster
     before it is worth paying for. Withholding it for the three days hides the
     feature most likely to convert the trial. */
  it('Coach Assist is the pro-only area', () => {
    expect([...PRO_ONLY_SECTIONS]).toEqual(['Coach Assist']);
  });

  it('a trial is refused every pro-only area', () => {
    for (const section of PRO_ONLY_SECTIONS) {
      expect(sectionAllowed('trial', section), section).toBe(false);
    }
  });

  it('a trial still opens everything else', () => {
    const rest = ALL_SECTIONS.filter(
      (x) =>
        !(PRO_ONLY_SECTIONS as readonly string[]).includes(x) &&
        !(ADMIN_ONLY_SECTIONS as readonly string[]).includes(x),
    );
    for (const section of rest) {
      expect(sectionAllowed('trial', section), section).toBe(true);
    }
  });

  /* The two questions are different and must not be conflated: a trial HAS the
     product (full counter list, export, no upgrade nag) without having PAID. */
  it('a trial is entitled but not paid', () => {
    expect(isEntitled('trial')).toBe(true);
    expect(isPaid('trial')).toBe(false);
  });

  it('pro and admin are both', () => {
    for (const a of ['pro', 'admin'] as Access[]) {
      expect(isEntitled(a)).toBe(true);
      expect(isPaid(a)).toBe(true);
    }
  });

  it('anon and free are neither', () => {
    for (const a of UNPAID) {
      expect(isPaid(a)).toBe(false);
    }
  });

  /* A pro-only area is closed to the unpaid tiers too — the carve-out must not
     accidentally OPEN anything. */
  it('a pro-only area is still closed to anon and free', () => {
    for (const a of UNPAID) {
      for (const section of PRO_ONLY_SECTIONS) {
        expect(sectionAllowed(a, section), `${a}/${section}`).toBe(false);
      }
    }
  });
});

describe('the admin shelf is empty, and still closes what it holds', () => {
  /* A TRIPWIRE, exactly like FREE_SECTIONS below. It fired as designed: Team
     Analysis sat here while it was verified against real data, and the day it
     came off, this test failed and the decision was made in a commit rather
     than inherited. It is empty now and that is the shelf working, not the
     shelf being unused — anything added to it must be a deliberate act. */
  it('nothing is admin-only', () => {
    expect([...ADMIN_ONLY_SECTIONS]).toEqual([]);
  });

  /* WHAT AN EMPTY LIST CAN AND CANNOT BE TESTED FOR.
     It can be tested that nothing is on the shelf: no section any tier asks
     about takes the admin branch, so no screen is invisible by accident.
     It CANNOT be tested that the branch still refuses correctly — with the
     list empty that branch is unreachable, and a fabricated section name does
     not reach it either (it is not in the list, so the lookup misses and the
     ordinary rules answer instead). That was the first version of this test
     and it asserted nothing; the honest statement is that the mechanism's
     coverage comes back with the next screen that uses the shelf. */
  it('no section is admin-gated', () => {
    for (const section of ALL_SECTIONS) {
      const anyoneBelowAdmin = (['anon', 'free', 'trial', 'pro'] as Access[]).some((a) =>
        sectionAllowed(a, section),
      );
      const adminOnlyNow = sectionAllowed('admin', section) && !anyoneBelowAdmin;
      // Coach Assist is pro-only, not admin-only: `pro` opens it.
      expect(adminOnlyNow, section).toBe(false);
    }
  });

  /* TEAM ANALYSIS IS AN ORDINARY GATED AREA NOW: not free, open from the trial
     up. This is the state the previous three tests were the negative of. */
  it('Team Analysis is closed to anon and free', () => {
    expect(sectionAllowed('anon', 'Team Analysis')).toBe(false);
    expect(sectionAllowed('free', 'Team Analysis')).toBe(false);
  });

  it('a three-day trial opens Team Analysis', () => {
    expect(sectionAllowed('trial', 'Team Analysis')).toBe(true);
  });

  it('pro and admin open Team Analysis', () => {
    expect(isPaid('pro')).toBe(true);
    expect(sectionAllowed('pro', 'Team Analysis')).toBe(true);
    expect(sectionAllowed('admin', 'Team Analysis')).toBe(true);
  });

  /* THE TWO FUNCTIONS MUST AGREE. `canOpenSection` takes the raw tier and
     `sectionAllowed` the derived access level; the screens call the second and
     the store the first, so a section they disagree about is one that renders
     locked and answers anyway, or renders open and refuses. */
  it('canOpenSection agrees with sectionAllowed', () => {
    expect(canOpenSection('trial', 'Team Analysis')).toBe(true);
    expect(canOpenSection('pro', 'Team Analysis')).toBe(true);
    expect(canOpenSection('admin', 'Team Analysis')).toBe(true);
    expect(canOpenSection('free', 'Team Analysis')).toBe(false);
  });
});

describe('an unpaid tier opens exactly the free sections', () => {
  for (const access of UNPAID) {
    it(`${access} may open the free sections and no others`, () => {
      const allowed = ALL_SECTIONS.filter((s) => sectionAllowed(access, s));
      expect([...allowed].sort()).toEqual([...FREE_SECTIONS].sort());
    });

    it(`${access} may not export decks`, () => {
      expect(canExportDecks(access)).toBe(false);
    });
  }

  it('anon and free are deliberately identical', () => {
    for (const section of ALL_SECTIONS) {
      expect(sectionAllowed('anon', section)).toBe(sectionAllowed('free', section));
    }
  });

  /* Not an arbitrary set. Meta and Deck Counter are what the brief keeps for
     a lapsed account; Search Player is the landing page's own call to action,
     and gating it would hand a stranger a paywall for using the biggest control
     on a public page. Recent Battles joined them for the same reason: it is
     the rawest thing stored — a list of battles that happened — and a visitor
     who types a tag and is told the tag buys them nothing has been shown a
     paywall, not a product.

     THIS LIST IS A TRIPWIRE. It fails whenever an area changes tier, which is
     the point: that decision should be made in a commit, not inherited from
     whatever order someone appended a constant in. */
  it('the free sections are the ones that were chosen', () => {
    expect([...FREE_SECTIONS].sort()).toEqual(
      ['Deck Counter', 'Recent Battles', 'Search Player', 'Top Meta Decks'].sort(),
    );
  });
});

describe('canOpenSection agrees with sectionAllowed', () => {
  /* Two implementations of one rule, and they must not drift: `canOpenSection`
     takes a Tier and `sectionAllowed` takes an Access (a Tier plus `anon`). */
  const tiers: Tier[] = ['free', 'trial', 'pro', 'admin'];
  for (const tier of tiers) {
    it(`they agree for ${tier}`, () => {
      for (const section of ALL_SECTIONS) {
        expect(canOpenSection(tier, section), section).toBe(sectionAllowed(tier, section));
      }
    });
  }
});

describe('the trial expires on its own', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');

  it('is trial while the timestamp is in the future', () => {
    expect(tierOf(profile({ trial_ends_at: new Date(now + DAY).toISOString() }), now)).toBe(
      'trial',
    );
  });

  it('drops to free the moment it passes', () => {
    expect(tierOf(profile({ trial_ends_at: new Date(now - 1).toISOString() }), now)).toBe('free');
  });

  /* The boundary itself: `> now` is exclusive, so an expiry exactly on the
     clock is over. Stated so a future edit cannot quietly make it inclusive. */
  it('is over at exactly the expiry instant', () => {
    expect(tierOf(profile({ trial_ends_at: new Date(now).toISOString() }), now)).toBe('free');
  });

  it('no trial at all is free, not expired-trial', () => {
    expect(tierOf(profile({ trial_ends_at: null }), now)).toBe('free');
  });

  /* THE PART THAT MATTERS FOR AN OPEN TAB. The tier is a function of the clock,
     so the same profile answers differently before and after — which is what
     lets the heartbeat re-lock a session without re-reading the profile. */
  it('the same profile locks itself as the clock passes the expiry', () => {
    const p = profile({ trial_ends_at: new Date(now + 1000).toISOString() });
    expect(tierOf(p, now)).toBe('trial');
    expect(tierOf(p, now + 2000)).toBe('free');
  });
});

describe('a paid role outranks the trial clock', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  const expired = new Date(now - DAY).toISOString();

  /* A pro whose trial lapsed is still pro. The trial is a grant to a FREE
     account, not a component of a paid one, so an expired timestamp must never
     take a paying reader's access away. */
  it('pro survives an expired trial', () => {
    expect(tierOf(profile({ role: 'pro', trial_ends_at: expired }), now)).toBe('pro');
  });

  it('admin survives an expired trial', () => {
    expect(tierOf(profile({ role: 'admin', trial_ends_at: expired }), now)).toBe('admin');
  });

  it('pro is not downgraded by a live trial either', () => {
    const live = new Date(now + DAY).toISOString();
    expect(tierOf(profile({ role: 'pro', trial_ends_at: live }), now)).toBe('pro');
  });
});

describe('isEntitled is the one predicate the paid features share', () => {
  /* It exists because three places each decided for themselves what "has Pro"
     means and two of them did not decide at all. */
  for (const access of PAID) {
    it(`${access} is entitled`, () => expect(isEntitled(access)).toBe(true));
  }
  for (const access of UNPAID) {
    it(`${access} is not entitled`, () => expect(isEntitled(access)).toBe(false));
  }

  it('agrees with the export gate for every access level', () => {
    const all: Access[] = ['anon', 'free', 'trial', 'pro', 'admin'];
    for (const a of all) expect(canExportDecks(a), a).toBe(isEntitled(a));
  });
});

describe('the gate asks the right question', () => {
  it('a stranger is asked to sign up, not to upgrade', () => {
    expect(gateReason('anon')).toBe('signin');
  });

  it('a lapsed account is asked to upgrade, not to sign up', () => {
    expect(gateReason('free')).toBe('upgrade');
  });
});

describe('the trial countdown', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');

  /* CEIL, NOT FLOOR. A three-day trial floors to "2 days left" the instant it
     starts, which reads as though a day was taken on signup. */
  it('a fresh three-day trial reads as three days', () => {
    expect(trialDaysLeft(profile({ trial_ends_at: new Date(now + 3 * DAY - 1).toISOString() }), now))
      .toBe(3);
  });

  it('an expired trial has no days left', () => {
    expect(trialDaysLeft(profile({ trial_ends_at: new Date(now - DAY).toISOString() }), now)).toBe(0);
  });

  it('no trial has no days left', () => {
    expect(trialDaysLeft(profile(), now)).toBe(0);
  });
});


/**
 * WHAT SOMEBODY IS CALLED IS NOT WHAT THEY CAN OPEN, and these two maps are
 * where that separation lives. `free` and `trial` are the SAME PERSON to the
 * product and different rows to the operator, so the labels differ by audience
 * while the access rules key on the stored tier as they always did.
 */
describe('a member stays a member when the three days end', () => {
  it('free and trial are both called Member', () => {
    expect(TIER_LABEL.free).toBe('Member');
    expect(TIER_LABEL.trial).toBe('Member');
  });

  /* THE BADGE MUST NOT VANISH ON DAY FOUR. Before this, `free` read "Free" and
     rendered no badge at all — so signing up visibly TOOK SOMETHING AWAY three
     days later. The word is the same on both sides of the expiry; only the
     access changes. */
  it('the label does not change across the expiry', () => {
    expect(TIER_LABEL.free).toBe(TIER_LABEL.trial);
  });

  /* ...while the ACCESS does, which is the whole point of keeping the stored
     values distinct rather than renaming `free` to `trial`. */
  it('but what they can open still differs', () => {
    for (const section of PRO_ONLY_SECTIONS) {
      expect(sectionAllowed('trial', section), section).toBe(false);
      expect(sectionAllowed('free', section), section).toBe(false);
    }
    // Team Analysis is the case that separates them.
    expect(sectionAllowed('trial', 'Team Analysis')).toBe(true);
    expect(sectionAllowed('free', 'Team Analysis')).toBe(false);
  });

  /* The operator's view keeps them apart, because the reason to open the admin
     console is to see who is on a countdown and who has run out. */
  it('the admin console still tells free from trial', () => {
    expect(TIER_ADMIN_LABEL.free).toBe('Free');
    expect(TIER_ADMIN_LABEL.trial).toBe('Trial');
    expect(TIER_ADMIN_LABEL.free).not.toBe(TIER_ADMIN_LABEL.trial);
  });

  it('paid tiers are named for what they pay for', () => {
    expect(TIER_LABEL.pro).toBe('Pro');
    expect(TIER_LABEL.admin).toBe('Admin');
  });
});
