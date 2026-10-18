/* WHAT THE SITE DOES WHILE THE ANALYTICS SERVER IS DOWN — the fallback half of
 * the 2026-10-18 fix. `apiHealth` decides; this only draws.
 *
 *   down       the outage page (the game, the countdown, "Try now") over the
 *              whole site. "Keep building decks" folds it to a small pill,
 *              because the deck tools run on local data and should not be
 *              held hostage by a server they do not use.
 *   back       if the page was open, the site RELOADS: every screen behind it
 *              was showing an error or a spinner, and a reload re-asks all of
 *              them at once. Folded to the pill, it offers a reload instead —
 *              the reader may be mid-edit in the builder.
 *   degraded   the server answers but cannot read its stored database. Live
 *              data still works, so it is a pill, not a page; the server-side
 *              watchdog restarts the API and the pill clears itself.
 *
 * Mounted once in App.tsx beside every route. The page itself is lazy.
 */
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apiHealth } from '../../state/apiHealth';
import styles from './OutageHost.module.css';

const ErrorScene = lazy(() => import('./ErrorScene'));

export function OutageHost() {
  const snap = useSyncExternalStore(apiHealth.subscribe, apiHealth.getSnapshot);
  const [folded, setFolded] = useState(false);
  const [backAfterFold, setBackAfterFold] = useState(false);
  const shownFor = useRef(snap.recoveries);

  useEffect(() => {
    if (snap.recoveries === shownFor.current) return;
    shownFor.current = snap.recoveries;
    if (folded) {
      setBackAfterFold(true);
      setFolded(false);
    } else {
      window.location.reload();
    }
  }, [snap.recoveries, folded]);

  if (snap.state === 'down' && !folded) {
    return (
      <div className={styles.layer} role="alertdialog" aria-modal="true" aria-label="The analytics server is offline">
        <Suspense fallback={<Fallback />}>
          <ErrorScene
            kind="offline"
            health={snap}
            onRetry={() => void apiHealth.checkNow()}
            onDismiss={() => setFolded(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (snap.state === 'down') {
    return (
      <div className={styles.pill} role="status" data-outage-pill="down">
        <span className={styles.dot} data-tone="down" aria-hidden="true" />
        Analytics offline · retrying
        <button type="button" onClick={() => setFolded(false)}>Open</button>
      </div>
    );
  }

  if (backAfterFold) {
    return (
      <div className={styles.pill} role="status" data-outage-pill="back">
        <span className={styles.dot} data-tone="up" aria-hidden="true" />
        Analytics is back
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
        <button type="button" aria-label="Dismiss" onClick={() => setBackAfterFold(false)}>×</button>
      </div>
    );
  }

  if (snap.state === 'degraded') {
    return (
      <div className={styles.pill} role="status" data-outage-pill="degraded">
        <span className={styles.dot} data-tone="warn" aria-hidden="true" />
        Stored history is reconnecting · live battles only
      </div>
    );
  }

  return null;
}

/* If the page's own chunk cannot load (the outage may be the network itself),
   the reader still gets the facts and a button. */
function Fallback() {
  return (
    <div className={styles.fallback}>
      <p>The analytics server is not answering. The site keeps checking and reloads when it is back.</p>
      <button type="button" onClick={() => void apiHealth.checkNow()}>Try now</button>
    </div>
  );
}
