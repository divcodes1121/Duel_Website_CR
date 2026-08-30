import { useState } from 'react';
import { type Access, PRO_ONLY_SECTIONS, gateReason } from '../../state/gate';
import { useAccountStore } from '../../state/accountStore';
import { trialDaysLeft } from '../../state/supabase';
import { ProContact } from '../Analytics/ProContact';
import styles from './GateCard.module.css';

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * What stands in for a locked area, instead of the area.
 *
 * IN PLACE OF THE CONTENT, not over it. A modal would have to be dismissed
 * before someone could go anywhere else, which turns "this one needs an
 * account" into "you are stuck". Replacing the panel leaves the whole rest of
 * the site — the nav, the free areas, the tools — reachable behind it.
 */
export function GateCard({ access, section }: { access: Access; section: string }) {
  const [contact, setContact] = useState(false);
  const profile = useAccountStore((s) => s.profile);
  const reason = gateReason(access);
  const left = trialDaysLeft(profile);
  /* Whether the TRIAL would open this one. Coach Assist is pro-only, so telling
     a signed-out visitor that an account opens "every other area for three
     days" is a promise the product breaks the moment they take it. */
  const needsPaid = (PRO_ONLY_SECTIONS as readonly string[]).includes(section);

  return (
    <section className={styles.card}>
      <span className={styles.mark} aria-hidden="true">
        <LockIcon />
      </span>

      <h2 className={styles.title}>{section}</h2>

      {reason === 'signin' ? (
        <>
          <p className={styles.body}>
            {needsPaid ? (
              <>
                {section} needs Pro. A free account opens every other area for
                three days — no card, nothing to cancel.
              </>
            ) : (
              <>
                Create a free account to open {section} — and every other area —
                for three days. No card, nothing to cancel.
              </>
            )}
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="#/signin">
              Start the free trial
            </a>
            <a className={styles.secondary} href="#/signin">
              I already have an account
            </a>
          </div>
        </>
      ) : (
        <>
          <p className={styles.body}>
            {left > 0
              ? `Your trial has ${left} day${left === 1 ? '' : 's'} left, but this area needs Pro.`
              : 'Your three-day trial has ended. Top Meta Decks and Deck Counter stay free.'}
          </p>
          {/* THIS WENT TO `#/pro`, WHICH IS NOT A ROUTE. `App.tsx` has no
              branch for it, so the hash changed, nothing matched, and the
              reader was silently dropped on the home screen — the one CTA on a
              locked area, and it went nowhere. It opens the contact dialog
              now, which is the same place every other upgrade in the app ends
              up and, more to the point, the truth: there is no checkout, Pro
              is set up by hand. */}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setContact(true)}>
              See Pro
            </button>
          </div>
        </>
      )}

      <p className={styles.free}>
        Free for everyone, always: <strong>Top Meta Decks</strong> and{' '}
        <strong>Deck Counter</strong>.
      </p>

      {contact && <ProContact onClose={() => setContact(false)} />}
    </section>
  );
}
