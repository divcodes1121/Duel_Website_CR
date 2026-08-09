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

  if (!user) {
    return (
      <div className={styles.app}>
        <Login />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <Dashboard view={viewFor(route)} />
    </div>
  );
}

export default App;
