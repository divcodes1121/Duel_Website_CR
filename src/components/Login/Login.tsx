import { useState } from 'react';
import { useAuthStore } from '../../state/authStore';
import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import styles from './Login.module.css';

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

export function Login() {
  const login = useAuthStore((s) => s.login);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!username.trim() || !password.trim()) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    const ok = await login(username, password);
    setBusy(false);
    if (!ok) {
      setError('Invalid username or password.');
      // Re-arm first: without dropping the class the animation would not replay
      // on a second failed attempt.
      setShaking(false);
      requestAnimationFrame(() => setShaking(true));
    }
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.themeToggle}
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? '☾' : '☀'}
      </button>

      <div className={styles.scene}>
        <img src={getCardIconUrl('archer-queen')} alt="" aria-hidden="true" className={`${styles.floatCard} ${styles.floatA}`} />
        <img src={getCardIconUrl('golden-knight')} alt="" aria-hidden="true" className={`${styles.floatCard} ${styles.floatB}`} />

        <div
          className={`${styles.card} ${shaking ? styles.shake : styles.cardEnter}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setShaking(false);
          }}
        >
          <span className={styles.cardBorder} aria-hidden="true" />

          <span className={styles.logoMark} aria-hidden="true">
            <CrownIcon />
          </span>

          <h1 className={styles.title}>Royal Arena</h1>
          <p className={styles.subtitle}>Sign in to enter the arena</p>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Username</span>
              <input
                className={styles.input}
                value={username}
                autoFocus
                autoComplete="username"
                spellCheck={false}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                placeholder="royal01"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Password</span>
              <input
                className={styles.input}
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="••••••••"
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? 'Checking…' : 'Sign In'}
            </button>
          </form>

          <p className={styles.hint}>Test access — use the account you were given.</p>
        </div>
      </div>
    </div>
  );
}
