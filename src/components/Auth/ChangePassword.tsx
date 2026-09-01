import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAccountStore } from '../../state/accountStore';
import {
  MIN_PASSWORD,
  STRENGTH_LABEL,
  passwordMessage,
  passwordProblem,
  passwordStrength,
} from '../../state/passwordRules';
import { PasswordInput } from './PasswordInput';
import styles from './ChangePassword.module.css';

/**
 * CHANGE YOUR PASSWORD WHILE SIGNED IN.
 *
 * Until this existed there was no way to rotate a password at all — not from
 * the account menu, not from any route, and not through the reset email, whose
 * link only signed people in. An account that cannot change its password is an
 * account that cannot respond to being compromised, which is the one thing this
 * control is actually for.
 *
 * ONE `changePassword` IN THE STORE, shared with the recovery screen, and one
 * `passwordRules` module behind both — so the two doors cannot start disagreeing
 * about what an acceptable password is.
 *
 * THE CURRENT PASSWORD IS ASKED FOR, and it is not decoration. Supabase's
 * `updateUser` will happily set a new password from nothing but a live session,
 * so an unattended signed-in browser is enough to take an account over. Checking
 * the old one first — by signing in with it, which is the only way a client can
 * — makes that need the password rather than just the laptop. If the project
 * later turns on Supabase's "secure password change" reauthentication, this
 * field is already the thing it asks for.
 *
 * Portalled to `document.body` on the project's usual reasoning: the panels
 * carry `backdrop-filter`, and each of those creates a stacking context that
 * traps a dialog rendered inside it however high its z-index.
 */
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const email = useAccountStore((s) => s.email);
  const changePassword = useAccountStore((s) => s.changePassword);
  const verifyPassword = useAccountStore((s) => s.verifyPassword);

  useEffect(() => {
    firstRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        /* The deck screens listen for Escape to drop a slot selection; closing
           the dialog on top is the nearer meaning. Same call as ProContact. */
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const strength = passwordStrength(next);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!current) return setError('Enter your current password.');
    const problem = passwordProblem(next, confirm, current);
    if (problem) return setError(passwordMessage(problem));

    setBusy(true);
    try {
      /* THE OLD PASSWORD IS CHECKED FIRST, and the order matters: if this is
         skipped, a live session alone is enough to change the password. */
      const wrong = await verifyPassword(current);
      if (wrong) {
        setError(wrong);
        return;
      }
      const message = await changePassword(next);
      if (message) {
        setError(message);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <button
          type="button"
          className={styles.close}
          data-metal
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <h2 className={styles.title} id="change-password-title">
          {done ? 'Password changed' : 'Change password'}
        </h2>

        {done ? (
          <>
            <p className={styles.blurb}>
              Your new password is set{email ? ` for ${email}` : ''}. Other
              devices stay signed in — sign out there if you want them out.
            </p>
            <button type="button" className={styles.submit} onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <form className={styles.form} onSubmit={onSubmit}>
            <p className={styles.blurb}>
              {email ? (
                <>
                  For <strong>{email}</strong>
                </>
              ) : (
                'Set a new password for this account.'
              )}
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Current password</span>
              <PasswordInput
                ref={firstRef}
                className={styles.input}
                value={current}
                autoComplete="current-password"
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setError(null);
                }}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>New password</span>
              <PasswordInput
                className={styles.input}
                value={next}
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD} characters`}
                onChange={(e) => {
                  setNext(e.target.value);
                  setError(null);
                }}
              />
            </label>

            {/* Not a gate — see `passwordRules.ts`. The word is always shown
                beside the bar, so the reading does not depend on colour. */}
            {next.length > 0 && (
              <div className={styles.meter} data-level={strength}>
                <span className={styles.meterBar} aria-hidden="true">
                  <i style={{ width: `${(strength / 3) * 100}%` }} />
                </span>
                <span className={styles.meterLabel}>{STRENGTH_LABEL[strength]}</span>
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Repeat new password</span>
              <PasswordInput
                className={styles.input}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError(null);
                }}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? 'Changing…' : 'Change password'}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
