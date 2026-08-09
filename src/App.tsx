import { useEffect, useState } from 'react';
import { Header } from './components/Header/Header';
import { DuelDeckBuilder } from './components/DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from './components/DecksHome/DecksHome';
import { CounterPalette } from './components/CounterPalette/CounterPalette';
import { Landing } from './components/Landing/Landing';
import { Login } from './components/Login/Login';
import { useAuthStore } from './state/authStore';
import styles from './App.module.css';

/* The landing used to be lazily imported purely to keep framer-motion, its only
 * consumer, out of the main bundle. The library is gone from the project, so
 * the split bought nothing but a blank frame on first paint. */

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
      <div className={styles.app}>
        <Login />
      </div>
    );
  }

  // Keyed so a route change remounts cleanly rather than reconciling one page's
  // tree into another's.
  return (
    <div key={page} className={styles.app}>
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
        <Landing />
      )}
    </div>
  );
}

export default App;
