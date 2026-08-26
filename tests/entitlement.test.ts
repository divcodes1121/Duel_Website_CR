import { describe, expect, it } from 'vitest';

/* IMPORTED FROM `tiers.ts`, NOT from `supabase.ts` or `gate.ts`, and that is
   the point of the extraction: both of those construct or pull in a Supabase
   client at module load, which wants a native WebSocket that Node 21 lacks. A
   test of a pure rule must not need a network stack. */
import {
  FREE_SECTIONS,
  canOpenSection,
  gateReason,
  isEntitled,
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
  'Top Meta Decks',
  'Deck Analysis',
  'Duel Analysis',
  'Duel Zone',
  'Cards',
  'Deck Counter',
  'Coach Assist',
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

describe('a paid tier opens everything', () => {
  for (const access of PAID) {
    it(`${access} may open all ${ALL_SECTIONS.length} sections`, () => {
      for (const section of ALL_SECTIONS) {
        expect(sectionAllowed(access, section), section).toBe(true);
      }
    });

    it(`${access} may export decks`, () => {
      expect(canExportDecks(access)).toBe(true);
    });
  }
});

describe('an unpaid tier opens exactly the free three', () => {
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

  /* Not an arbitrary three. Meta and Deck Counter are what the brief keeps for
     a lapsed account; Search Player is the landing page's own call to action,
     and gating it would hand a stranger a paywall for using the biggest control
     on a public page. */
  it('the free sections are the three that were chosen', () => {
    expect([...FREE_SECTIONS].sort()).toEqual(
      ['Deck Counter', 'Search Player', 'Top Meta Decks'].sort(),
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
