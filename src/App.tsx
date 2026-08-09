import { Suspense, lazy, useEffect, useState } from 'react';
import { Header } from './components/Header/Header';
import { DuelDeckBuilder } from './components/DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from './components/DecksHome/DecksHome';
import { CounterPalette } from './components/CounterPalette/CounterPalette';
import { Login } from './components/Login/Login';
import { useAuthStore } from './state/authStore';
import styles from './App.module.css';

/**
 * The landing page is the app's one remaining framer-motion consumer (it and
 * the `useCardTilt` hook only it uses). Loading it lazily keeps the animation
 * library — ~66 kB gzip, roughly half the JS budget — out of the main bundle
 * entirely, so the builder, Deck's Home and Counter Palette never pay for it.
 */
const Landing = lazy(() =>
  import('./components/Landing/Landing').then((m) => ({ default: m.Landing })),
);

type Page = 'builder' | 'decks' | 'palette' | 'landing';

function pageFor(hash: string): Page {
  if (hash.startsWith('#/builder')) return 'builder';
  if (hash.startsWith('#/decks')) return 'decks';
  if (hash.startsWith('#/palette')) return 'palette';
  return 'landing';
}

function useHashRoute(): string {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

function App() {
  const route = useHashRoute();
  const user = useAuthStore((s) => s.user);
  const page = pageFor(route);

  if (!user) {
    return (
      <div className={`${styles.app} ${styles.enter}`}>
        <Login />
      </div>
    );
  }

  // Keyed so a route change restarts the enter animation, which is what the old
  // AnimatePresence `mode="wait"` bought — minus the exit pass and its blur.
  return (
    <div key={page} className={`${styles.app} ${styles.enter}`}>
      {page === 'builder' ? (
        <>
          <Header />
          <DuelDeckBuilder />
        </>
      ) : page === 'decks' ? (
        <DecksHome />
      ) : page === 'palette' ? (
        <CounterPalette />
      ) : (
        <Suspense fallback={<div className={styles.routeFallback} />}>
          <Landing />
        </Suspense>
      )}
    </div>
  );
}

export default App;
