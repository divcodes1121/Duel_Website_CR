import { useEffect, useState } from 'react';
import { Dashboard, type DashboardView } from './components/Dashboard/Dashboard';
import { Login } from './components/Login/Login';
import { AuthScreen } from './components/Auth/AuthScreen';
import { Onboarding } from './components/Auth/Onboarding';
import { useAuthStore } from './state/authStore';
import { useAccountStore } from './state/accountStore';
import { isSupabaseConfigured } from './state/supabase';
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

  /* TWO GATES, ONE AT A TIME.
     `accountStore` is real Supabase accounts; `authStore` is the 20-account
     test gate. Which one applies is decided by whether Supabase is configured
     at all, so a checkout without the environment variables — every clone, and
     the deployment until the variables were set — keeps the behaviour it had
     rather than failing to mount. */
  const accountReady = useAccountStore((s) => s.ready);
  const accountId = useAccountStore((s) => s.userId);
  const profile = useAccountStore((s) => s.profile);
  const initAccount = useAccountStore((s) => s.init);

  useEffect(() => {
    void initAccount();
  }, [initAccount]);

  if (isSupabaseConfigured) {
    /* THE SITE IS PUBLIC. Signing in is a ROUTE, not a wall — a stranger lands
       on the actual product and only meets the auth card when they reach for
       something the free tier does not include. The first build of this gated
       everything, which asked people to commit before seeing anything. */
    if (route.startsWith('#/signin')) {
      if (accountReady && accountId) {
        /* Already signed in and asking for the sign-in page: send them home
           rather than showing a form they do not need. */
        window.location.hash = '#/';
      } else {
        return (
          <div className={styles.app}>
            <AuthScreen />
          </div>
        );
      }
    }

    /* Asked once, on `onboarded_at` rather than on whether the fields are
       filled — skipping is allowed, and someone who skipped must not be asked
       again on every visit. A null profile means the row has not arrived yet,
       which is a moment rather than a state to route on. */
    if (accountReady && accountId && profile && !profile.onboarded_at) {
      return (
        <div className={styles.app}>
          <Onboarding />
        </div>
      );
    }
  } else if (!user) {
    /* No Supabase configured: the 20-account test gate still applies, and it
       is still a wall, because that build has no public tier to show. */
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
