import { type Access, gateReason } from '../../state/gate';
import { useAccountStore } from '../../state/accountStore';
import { trialDaysLeft } from '../../state/supabase';
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
  const profile = useAccountStore((s) => s.profile);
  const reason = gateReason(access);
  const left = trialDaysLeft(profile);

  return (
    <section className={styles.card}>
      <span className={styles.mark} aria-hidden="true">
        <LockIcon />
      </span>

      <h2 className={styles.title}>{section}</h2>

      {reason === 'signin' ? (
        <>
          <p className={styles.body}>
            Create a free account to open {section} — and every other area — for
            three days. No card, nothing to cancel.
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
          <div className={styles.actions}>
            <a className={styles.primary} href="#/pro">
              See Pro
            </a>
          </div>
        </>
      )}

      <p className={styles.free}>
        Free for everyone, always: <strong>Top Meta Decks</strong> and{' '}
        <strong>Deck Counter</strong>.
      </p>
    </section>
  );
}
