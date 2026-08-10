import { useEffect, useState } from 'react';
import { Dashboard, type DashboardView } from './components/Dashboard/Dashboard';
import { Login } from './components/Login/Login';
import { useAuthStore } from './state/authStore';
import styles from './App.module.css';

/* One shell for every signed-in route. The builder, Deck's Home and Counter
 * Palette used to be separate full pages, each with its own nav bar; they now
 * open inside the dashboard as scrolling panels, so the top bar and sidebar
 * stay put while the content changes. The hash still drives which one is open,
 * so links and refreshes keep working. */

function viewFor(hash: string): DashboardView {
  if (hash.startsWith('#/builder')) return 'builder';
  if (hash.startsWith('#/decks')) return 'decks';
  if (hash.startsWith('#/palette')) return 'palette';
  if (hash.startsWith('#/player/')) return 'player';
  return 'home';
}

/* `#/player/%23QJ2L9V8R/duels` -> tag `#QJ2L9V8R`, section `duels`.
 *
 * The section lives in the URL rather than in component state so a analytics
 * screen is linkable and survives a refresh — the sidebar is navigation, not a
 * toggle. */
function playerRoute(hash: string): { tag: string; section: string } {
  if (!hash.startsWith('#/player/')) return { tag: '', section: '' };
  const rest = hash.slice('#/player/'.length);
  const cut = rest.indexOf('/');
  const rawTag = cut === -1 ? rest : rest.slice(0, cut);
  const section = cut === -1 ? '' : rest.slice(cut + 1);
  try {
    return { tag: decodeURIComponent(rawTag), section };
  } catch {
    return { tag: '', section };
  }
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

  if (!user) {
    return (
      <div className={styles.app}>
        <Login />
      </div>
    );
  }

  const { tag, section } = playerRoute(route);

  return (
    <div className={styles.app}>
      <Dashboard view={viewFor(route)} playerTag={tag} playerSection={section} />
    </div>
  );
}

export default App;
