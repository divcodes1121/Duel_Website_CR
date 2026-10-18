/* THE PAGE FOR WHEN SOMETHING IS NOT WHERE IT SHOULD BE — one layout, four
 * reasons, and a game in the middle of it.
 *
 *   not-found  a route nobody built (`#/buidler`), or a real path Vercel had
 *              no file for, forwarded by public/404.html as `#/lost?from=`.
 *   offline    the analytics server is not answering (2026-10-18: the VPS was
 *              powered off for half an hour and every search hung for 200+ s).
 *              The page says what still works, shows when it checks next, and
 *              `OutageHost` reloads the screen the moment the server is back.
 *   crash      a screen threw while rendering (`AppErrorBoundary`).
 *   stale      a crash that is really an old tab asking for files a newer
 *              deploy removed — a reload is the whole fix, so it says that.
 *
 * Lazy (its own chunk with the game and three.js behind it), so nothing about
 * it costs a visitor who never meets an error.
 */
import { useEffect, useState } from 'react';
import { ArenaGame } from '../../three/ArenaGame';
import type { ApiHealthSnapshot } from '../../state/apiHealth';
import '../../state/themeStore';
import styles from './ErrorScene.module.css';

export type ErrorKind = 'not-found' | 'offline' | 'crash' | 'stale';

interface Props {
  kind: ErrorKind;
  /** What the reader asked for (not-found). */
  path?: string;
  /** The thrown error (crash), shown folded for a bug report. */
  error?: unknown;
  /** The live outage state (offline). */
  health?: ApiHealthSnapshot;
  onRetry?: () => void;
  /** offline only: carry on without analytics (the deck tools work). */
  onDismiss?: () => void;
}

const COPY: Record<ErrorKind, { code: string; title: string; body: string }> = {
  'not-found': {
    code: '404',
    title: 'This page wandered off the arena',
    body: 'There is nothing at this address. Head back, or dodge a few fireballs first.',
  },
  offline: {
    code: 'Offline',
    title: 'The analytics server is not answering',
    body: 'Player search and stats will come back on their own; this page checks for you and reloads when it is back. Your decks and the deck builders still work.',
  },
  crash: {
    code: 'Oops',
    title: 'This screen hit a snag',
    body: 'Something went wrong while drawing it. Reloading usually fixes it.',
  },
  stale: {
    code: 'New version',
    title: 'Deckkies was updated while this tab was open',
    body: 'This tab is still running the old version. Reload to get the new one; your saved decks are kept.',
  },
};

function home() {
  window.location.hash = '#/';
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ErrorScene({ kind, path, error, health, onRetry, onDismiss }: Props) {
  const copy = COPY[kind];
  const [now, setNow] = useState(() => Date.now());

  // A one-second tick only while the countdown is on screen.
  useEffect(() => {
    if (kind !== 'offline') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [kind]);

  useEffect(() => {
    const before = document.title;
    document.title = `${copy.code} · Deckkies`;
    return () => {
      document.title = before;
    };
  }, [copy.code]);

  const wait = health?.nextCheckAt ? Math.max(0, Math.ceil((health.nextCheckAt - now) / 1000)) : null;
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;
  const reload = () => window.location.reload();

  return (
    <div className={styles.page} data-error-scene={kind}>
      <header className={styles.top}>
        <a className={styles.brand} href="#/" aria-label="Deckkies home">
          <span className={styles.brandMark}>
            <img src={`${import.meta.env.BASE_URL}assets/brand/logo-dark.png`} alt="" draggable={false} />
          </span>
          <span className={styles.wordmark}>DECKKIES</span>
        </a>
      </header>

      <main className={styles.body}>
        <section className={styles.copy}>
          <p className={styles.code} data-kind={kind}>{copy.code}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.text}>{copy.body}</p>

          {kind === 'not-found' && path && (
            <p className={styles.path}>
              <code>{path}</code>
            </p>
          )}

          {kind === 'offline' && health && (
            <p className={styles.status} data-outage-status="" aria-live="polite">
              <span className={styles.pulse} aria-hidden="true" />
              {health.state === 'down'
                ? wait !== null && wait > 0
                  ? `Checking again in ${wait} s`
                  : 'Checking now…'
                : 'Back — reloading'}
              {health.downSince ? ` · down since ${clockTime(health.downSince)}` : ''}
              {health.checks > 1 ? ` · ${health.checks} checks` : ''}
            </p>
          )}

          <div className={styles.actions}>
            {kind === 'not-found' && (
              <>
                <button type="button" className={styles.primary} onClick={home}>Back to home</button>
                {canGoBack && (
                  <button type="button" className={styles.ghost} onClick={() => window.history.back()}>
                    Go back
                  </button>
                )}
              </>
            )}
            {kind === 'offline' && (
              <>
                <button type="button" className={styles.primary} onClick={onRetry}>Try now</button>
                {onDismiss && (
                  <button type="button" className={styles.ghost} onClick={onDismiss}>
                    Keep building decks
                  </button>
                )}
              </>
            )}
            {(kind === 'crash' || kind === 'stale') && (
              <>
                <button type="button" className={styles.primary} onClick={reload}>Reload</button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    home();
                    reload();
                  }}
                >
                  Back to home
                </button>
              </>
            )}
          </div>

          {kind === 'crash' && error != null && (
            <details className={styles.details}>
              <summary>What went wrong</summary>
              <code>{String((error as Error)?.message ?? error)}</code>
            </details>
          )}
        </section>

        <section className={styles.game} aria-label="Dodge the Arena, a small game">
          <ArenaGame word={kind === 'not-found' ? '404' : kind === 'offline' ? 'OFF' : 'OOPS'} />
        </section>
      </main>
    </div>
  );
}

export default ErrorScene;
