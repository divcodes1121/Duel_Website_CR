import { useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
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
  const shake = useAnimationControls();

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
      shake.start({
        x: [0, -12, 12, -8, 8, -4, 4, 0],
        transition: { duration: 0.45, ease: 'easeInOut' },
      });
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

      <motion.div
        className={styles.scene}
        initial={{ opacity: 0, y: 32, filter: 'blur(10px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ type: 'spring', stiffness: 160, damping: 24 }}
      >
        <img src={getCardIconUrl('archer-queen')} alt="" aria-hidden="true" className={`${styles.floatCard} ${styles.floatA}`} />
        <img src={getCardIconUrl('golden-knight')} alt="" aria-hidden="true" className={`${styles.floatCard} ${styles.floatB}`} />

        <motion.div className={styles.card} animate={shake}>
          <span className={styles.cardBorder} aria-hidden="true" />

          <motion.span
            className={styles.logoMark}
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden="true"
          >
            <CrownIcon />
          </motion.span>

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

            {error && (
              <motion.p
                className={styles.error}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {error}
              </motion.p>
            )}

            <motion.button
              type="submit"
              className={styles.submit}
              disabled={busy}
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            >
              {busy ? 'Checking…' : 'Sign In'}
            </motion.button>
          </form>

          <p className={styles.hint}>Test access — use the account you were given.</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
