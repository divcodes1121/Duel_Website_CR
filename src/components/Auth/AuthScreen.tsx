import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Fireflies } from '../../three/Fireflies';
import { supabase } from '../../state/supabase';
import { deviceKind, useAccountStore } from '../../state/accountStore';
import { PasswordInput } from './PasswordInput';
import { ThemeToggle } from '../Theme/ThemeToggle';
import loginStyles from '../Login/Login.module.css';
import styles from './AuthScreen.module.css';

type Mode = 'signin' | 'signup' | 'reset';

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/**
 * Sign in, sign up, and password reset for real accounts.
 *
 * Replaces nothing — `Login` (the 20-account test gate) is still mounted when
 * Supabase is not configured, so a build without the environment variables set
 * keeps working exactly as it did.
 *
 * THE GOOGLE BUTTON IS ONLY DRAWN IF GOOGLE IS ACTUALLY ENABLED. Supabase
 * publishes which providers a project has turned on at `/auth/v1/settings`, and
 * asking costs one request at mount. A permanently visible button that returns
 * "provider is not enabled" is worse than no button: it reads as the site being
 * broken rather than as a feature not being set up yet.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  /* Item 7: this device lost its slot to a newer login of the same kind. Being
     silently signed out reads as a bug; saying so reads as the rule working. */
  const evicted = useAccountStore((s) => s.evicted);

  useEffect(() => {
    let live = true;
    if (!supabase) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`${base}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (live) setGoogle(Boolean(s?.external?.google));
      })
      .catch(() => {
        /* Offline or blocked: leave the button hidden. Email still works, and
           a hidden optional button is a smaller failure than a broken one. */
      });
    return () => {
      live = false;
    };
  }, []);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    emailRef.current?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !supabase) return;
    setError(null);
    setNotice(null);

    if (!email.trim()) return setError('Enter your email address.');
    if (mode !== 'reset' && password.length < 8) {
      return setError('Passwords need at least 8 characters.');
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        /* Supabase says "Invalid login credentials" for a wrong password AND
           for an address that has never signed up, deliberately — telling them
           apart is how an attacker enumerates who has an account. Passing the
           message through unchanged keeps that property. */
        if (err) setError(err.message);
      } else if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (err) setError(err.message);
        else if (data.session) setNotice(null); // confirmation off: straight in
        else setNotice(`Check ${email.trim()} for a confirmation link.`);
      } else {
        /* `#/reset`, NOT the bare origin, and this is what makes the link do
           something. It used to land on `/`, where `detectSessionInUrl` quietly
           exchanged the token for a real session and dropped the reader on the
           landing page — signed in, with the old password still in force and no
           screen anywhere able to change it. Naming the route means the app can
           recognise a recovery even if the event is missed, and it is the one
           part of the URL Supabase passes through untouched. */
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/#/reset`,
        });
        /* Always the same answer, error or not — see the enumeration note
           above. Whether an address is registered is not ours to publish. */
        if (err && !/rate/i.test(err.message)) setError(err.message);
        else setNotice('If that address has an account, a reset link is on its way.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function withGoogle() {
    if (!supabase) return;
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (err) setError(err.message);
  }

  const cta = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link';

  return (
    <div className={loginStyles.page}>
      <ThemeToggle size="1.95rem" className={loginStyles.themeToggle} />
      <Fireflies />

      <div className={loginStyles.scene}>
        <div className={`${loginStyles.card} ${loginStyles.cardEnter} ${styles.card}`}>
          <span className={loginStyles.cardBorder} aria-hidden="true" />

          <span className={loginStyles.logoMark} aria-hidden="true">
            <CrownIcon />
          </span>

          <h1 className={loginStyles.title}>Deckkies</h1>
          <p className={loginStyles.subtitle}>
            {mode === 'reset'
              ? 'We will email you a link to set a new password'
              : mode === 'signup'
                ? 'Three days of everything, free'
                : 'Sign in to your account'}
          </p>

          {mode !== 'reset' && (
            <div className={styles.tabs} role="tablist" aria-label="Sign in or create an account">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`${styles.tab} ${mode === m ? styles.tabOn : ''}`}
                  onClick={() => switchTo(m)}
                >
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          <form className={loginStyles.form} onSubmit={onSubmit}>
            <label className={loginStyles.field}>
              <span className={loginStyles.fieldLabel}>Email</span>
              <input
                ref={emailRef}
                className={loginStyles.input}
                type="email"
                value={email}
                autoFocus
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </label>

            {mode !== 'reset' && (
              <label className={loginStyles.field}>
                <span className={loginStyles.fieldLabel}>Password</span>
                <PasswordInput
                  className={loginStyles.input}
                  value={password}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="At least 8 characters"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                />
              </label>
            )}

            {evicted && (
              <p className={styles.evicted}>
                You were signed out because this account signed in on another{' '}
                {deviceKind() === 'mobile' ? 'phone' : 'computer'}. One computer
                and one phone at a time.
              </p>
            )}
            {error && <p className={loginStyles.error}>{error}</p>}
            {notice && <p className={styles.notice}>{notice}</p>}

            <button type="submit" className={loginStyles.submit} disabled={busy}>
              {busy ? 'Working…' : cta}
            </button>
          </form>

          {google && mode !== 'reset' && (
            <>
              <div className={styles.or} aria-hidden="true">
                <span>or</span>
              </div>
              <button type="button" className={styles.google} onClick={withGoogle}>
                <GoogleMark />
                Continue with Google
              </button>
            </>
          )}

          <p className={styles.links}>
            {mode === 'reset' ? (
              <button type="button" className={styles.link} onClick={() => switchTo('signin')}>
                Back to sign in
              </button>
            ) : (
              <button type="button" className={styles.link} onClick={() => switchTo('reset')}>
                Forgot your password?
              </button>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
