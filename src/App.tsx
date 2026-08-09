import { useEffect, useState } from 'react';
import { Header } from './components/Header/Header';
import { DuelDeckBuilder } from './components/DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from './components/DecksHome/DecksHome';
import { CounterPalette } from './components/CounterPalette/CounterPalette';
import { Dashboard } from './components/Dashboard/Dashboard';
import { Login } from './components/Login/Login';
import { useAuthStore } from './state/authStore';
import styles from './App.module.css';

/* The post-login home is the dashboard: top bar, analytics sidebar, hero panel.
 * It replaces the old cinematic landing, which is gone along with the animation
 * library it existed to show off. */

type Page = 'builder' | 'decks' | 'palette' | 'home';

function pageFor(hash: string): Page {
  if (hash.startsWith('#/builder')) return 'builder';
  if (hash.startsWith('#/decks')) return 'decks';
  if (hash.startsWith('#/palette')) return 'palette';
  return 'home';
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
        <Dashboard />
      )}
    </div>
  );
}

export default App;
