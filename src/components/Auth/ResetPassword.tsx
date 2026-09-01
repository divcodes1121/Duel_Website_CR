import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Fireflies } from '../../three/Fireflies';
import { useAccountStore } from '../../state/accountStore';
import {
  MIN_PASSWORD,
  STRENGTH_LABEL,
  passwordMessage,
  passwordProblem,
  passwordStrength,
} from '../../state/passwordRules';
import { PasswordInput } from './PasswordInput';
import { ThemeToggle } from '../Theme/ThemeToggle';
import loginStyles from '../Login/Login.module.css';
import authStyles from './AuthScreen.module.css';
import styles from './ResetPassword.module.css';

/**
 * SET A NEW PASSWORD, at the end of a recovery link.
 *
 * THE OTHER HALF OF A FEATURE THAT SHIPPED WITHOUT ONE. "Forgot your password?"
 * has always sent the email; nothing ever consumed the link. `updateUser` — the
 * only Supabase call that can set a password — appeared nowhere in the repo, so
 * the link's real effect was to sign the reader in on the landing page with
 * their old password intact. The screen they were promised is this one.
 *
 * IT WEARS THE SIGN-IN CARD, deliberately, rather than being a panel inside the
 * app. Someone arriving here has just come out of their email client and needs
 * to recognise the site instantly; and they are only nominally signed in — the
 * one thing they may do is set a password, so showing them the shell with its
 * rail and seven areas would be offering navigation they must not use.
 */
export function ResetPassword() {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const email = useAccountStore((s) => s.email);
  const userId = useAccountStore((s) => s.userId);
  const ready = useAccountStore((s) => s.ready);
  const authError = useAccountStore((s) => s.authError);
  const changePassword = useAccountStore((s) => s.changePassword);
  const cancelRecovery = useAccountStore((s) => s.cancelRecovery);

  /* NO SESSION MEANS THE LINK DID NOT WORK, and this screen has to say so
     rather than offer a form that cannot submit. Three ways to arrive here
     without one, and they are all real:
       - the link has already been used, or has expired;
       - the URL was opened by hand, or bookmarked;
       - **it was opened in a different browser from the one that asked.** The
         client runs `flowType: 'pkce'`, so the code exchange needs the verifier
         stored when the reset was requested — request it on a laptop, open the
         mail on a phone, and there is nothing to exchange with. That case is
         invisible from here (the failure happens inside the client before we
         run), so the copy names it as a possibility instead of guessing.
     `ready` is what separates "no session" from "we have not looked yet", which
     would otherwise flash this over a link that is about to work. */
  const noSession = ready && !userId;

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  /* THE TOKEN IS SCRUBBED FROM THE ADDRESS BAR once the client has exchanged it.
     It is a bearer credential that grants this session, and leaving it sitting
     in the URL puts it in history, in a screenshot and in whatever the next
     `Referer` header goes to. Supabase clears its own hash parameters; the query
     string it arrives with is ours to tidy, and `replaceState` does it without a
     navigation that would re-mount this screen mid-typing. */
  useEffect(() => {
    const { search, origin, pathname } = window.location;
    if (!search) return;
    try {
      window.history.replaceState({}, '', `${origin}${pathname}#/reset`);
    } catch {
      /* Some embedded browsers refuse replaceState. Not worth failing over — the
         reset still works, the URL is just untidy. */
    }
  }, []);

  const strength = passwordStrength(next);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const problem = passwordProblem(next, confirm);
    if (problem) return setError(passwordMessage(problem));

    setBusy(true);
    try {
      const message = await changePassword(next);
      if (message) {
        setError(message);
        return;
      }
      /* A CONFIRMATION SCREEN RATHER THAN A SILENT REDIRECT. The password has
         changed — that is worth one sentence, because it is the only evidence
         the reader gets that the thing they came here to do actually happened.
         `recovering` is already false, so the button below just leaves. */
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={loginStyles.page}>
      <ThemeToggle size="1.95rem" className={loginStyles.themeToggle} />
      <Fireflies />

      <div className={loginStyles.scene}>
        <div className={`${loginStyles.card} ${loginStyles.cardEnter} ${authStyles.card}`}>
          <span className={loginStyles.cardBorder} aria-hidden="true" />

          <h1 className={loginStyles.title}>Deckkies</h1>

          {noSession ? (
            <>
              <p className={loginStyles.subtitle}>
                {/* "LINK", NOT "RESET LINK", WHEN SUPABASE TOLD US WHY. The same
                    error redirect carries a lapsed sign-up confirmation as well
                    as a lapsed recovery, and nothing in the URL distinguishes
                    them — so claiming it was a reset link would be a guess
                    printed as a fact. Without an error we DID arrive here on
                    the reset route, so the narrower word is safe. */}
                {authError ? 'This link cannot be used' : 'This reset link cannot be used'}
              </p>
              {/* SUPABASE'S OWN SENTENCE FIRST, because it is more specific than
                  anything written here: "Email link is invalid or has expired"
                  names the actual condition. Ours explains what to do about it. */}
              {authError && <p className={styles.linkError}>{authError}</p>}
              <p className={styles.blurb}>
                It may have expired, been used already, or been opened in a
                different browser from the one that requested it. Ask for a new
                link and open it in the same browser.
                {/* THE PREFETCH CASE IS NAMED, because it is the one that looks
                    like a bug in the site: a mail provider that scans links
                    spends the single-use token before the reader ever clicks,
                    so a brand-new link reports itself expired on first use. */}
                {' '}A link can also be spent by an email provider scanning it,
                in which case a fresh one usually works.
              </p>
              <button
                type="button"
                className={loginStyles.submit}
                onClick={() => {
                  window.location.hash = '#/signin';
                }}
              >
                Back to sign in
              </button>
            </>
          ) : done ? (
            <>
              <p className={loginStyles.subtitle}>Your password is set</p>
              <p className={styles.blurb}>
                You are signed in on this device. Use the new password next time.
              </p>
              <button
                type="button"
                className={loginStyles.submit}
                onClick={() => {
                  window.location.hash = '#/';
                }}
              >
                Continue to Deckkies
              </button>
            </>
          ) : (
            <>
              <p className={loginStyles.subtitle}>Choose a new password</p>
              {email && (
                <p className={styles.blurb}>
                  For <strong>{email}</strong>
                </p>
              )}

              <form className={loginStyles.form} onSubmit={onSubmit}>
                <label className={loginStyles.field}>
                  <span className={loginStyles.fieldLabel}>New password</span>
                  <PasswordInput
                    ref={firstRef}
                    className={loginStyles.input}
                    value={next}
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    onChange={(e) => {
                      setNext(e.target.value);
                      setError(null);
                    }}
                  />
                </label>

                {/* THE METER IS NOT A GATE and says so by never blocking the
                    button. It exists so a long passphrase is visibly worth more
                    than a short mangled word — the one thing a meter can
                    honestly encourage. See `passwordRules.ts`. */}
                {next.length > 0 && (
                  <div className={styles.meter} data-level={strength}>
                    <span className={styles.meterBar} aria-hidden="true">
                      <i style={{ width: `${(strength / 3) * 100}%` }} />
                    </span>
                    <span className={styles.meterLabel}>{STRENGTH_LABEL[strength]}</span>
                  </div>
                )}

                <label className={loginStyles.field}>
                  <span className={loginStyles.fieldLabel}>Repeat it</span>
                  <PasswordInput
                    className={loginStyles.input}
                    value={confirm}
                    autoComplete="new-password"
                    placeholder="The same password again"
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setError(null);
                    }}
                  />
                </label>

                {error && <p className={loginStyles.error}>{error}</p>}

                <button type="submit" className={loginStyles.submit} disabled={busy}>
                  {busy ? 'Setting it…' : 'Set new password'}
                </button>
              </form>

              <p className={authStyles.links}>
                <button
                  type="button"
                  className={authStyles.link}
                  onClick={() => {
                    /* A FULL SIGN-OUT, not just leaving. The link handed over a
                       real session; walking away while holding it would leave
                       somebody signed in to an account whose password they do
                       not know. */
                    void cancelRecovery();
                    window.location.hash = '#/signin';
                  }}
                >
                  Cancel and sign out
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
