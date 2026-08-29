import { Suspense, lazy, useEffect, useState } from 'react';
import { Dashboard, type DashboardView } from './components/Dashboard/Dashboard';
import { AuthScreen } from './components/Auth/AuthScreen';
import { Onboarding } from './components/Auth/Onboarding';
import { useAccountStore } from './state/accountStore';
import { isSupabaseConfigured } from './state/supabase';
import styles from './App.module.css';
import { AdminConsole } from './components/Admin/AdminConsole';
/* SPLIT OUT, the same treatment jsPDF and three.js get and for the same reason:
   it is a side route most visitors never open, and everything it needs — the
   book, the leaf machinery, the magnifier, eight plates of copy — would
   otherwise be parsed by every single page load. `lazy` wants a default export
   and this is a named one, hence the shim. */
const Sketchbook = lazy(() =>
  import('./components/Sketchbook/Sketchbook').then((m) => ({ default: m.Sketchbook })),
);

/* One shell for every signed-in route. The builder, Deck's Home and Counter
 * Palette used to be separate full pages, each with its own nav bar; they now
 * open inside the dashboard as scrolling panels, so the top bar and sidebar
 * stay put while the content changes. The hash still drives which one is open,
 * so links and refreshes keep working. */

function viewFor(hash: string): DashboardView {
  if (hash.startsWith('#/builder')) return 'builder';
  if (hash.startsWith('#/decks')) return 'decks';
  if (hash.startsWith('#/palette')) return 'palette';
  if (hash.startsWith('#/teams')) return 'teams';
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

  /* ONE GATE. `accountStore` is the only account system — the twenty-account
     test gate that used to run alongside it is deleted, along with its store,
     its bundled hashes and the generator that wrote them. */
  const accountReady = useAccountStore((s) => s.ready);
  const accountId = useAccountStore((s) => s.userId);
  const profile = useAccountStore((s) => s.profile);
  const initAccount = useAccountStore((s) => s.init);
  const evicted = useAccountStore((s) => s.evicted);

  useEffect(() => {
    void initAccount();
  }, [initAccount]);

  /* THE FIELD BOOK is its own route and carries no shell. It is one object — a
     book on a desk with a glass lying on it — and a top bar, a rail and a panel
     border around that would be three frames around a thing that is already a
     frame.

     OUTSIDE the Supabase branch, deliberately. A page explaining what a Member
     and a Pro each get cannot itself depend on the account system being
     configured: on a checkout with no Supabase it would otherwise be the one
     public page that 404s into the dashboard. It reads the entitlement RULES,
     which are pure, never the session. */
  if (route.startsWith('#/guide')) {
    return (
      <div className={styles.app}>
        {/* No spinner. The chunk is small and local, and a flash of loading
            furniture before a book opens is worse than one quiet frame. */}
        <Suspense fallback={null}>
          <Sketchbook />
        </Suspense>
      </div>
    );
  }

  if (isSupabaseConfigured) {
    /* THE SITE IS PUBLIC. Signing in is a ROUTE, not a wall — a stranger lands
       on the actual product and only meets the auth card when they reach for
       something the free tier does not include. The first build of this gated
       everything, which asked people to commit before seeing anything. */
    /* AN EVICTED DEVICE IS SHOWN THE DOOR, not quietly demoted. The account is
       already signed out by the time this renders, so without this the person
       would simply find themselves anonymous mid-session with no explanation —
       which reads as the site logging them out at random. */
    if (evicted) {
      return (
        <div className={styles.app}>
          <AuthScreen />
        </div>
      );
    }

    /* The console is its own route, deliberately not a Dashboard section: it
       is not analytics, it does not belong in the sidebar of seven areas, and
       an admin reaches it by knowing the URL. The component refuses non-admins
       itself, and the database refuses them again underneath. */
    if (route.startsWith('#/admin')) {
      return (
        <div className={styles.app}>
          <AdminConsole />
        </div>
      );
    }

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
  }
  /* NO `else` BRANCH ANY MORE. A checkout without Supabase configured used to
     fall back to a wall over twenty bundled accounts; those are deleted, and
     the fallback is simply the public site — `useAccess()` already answers
     `admin` when there is nothing to gate against, so a local clone sees
     everything rather than a login it cannot pass. */

  const { tag, section } = playerRoute(route);

  return (
    <div className={styles.app}>
      <Dashboard view={viewFor(route)} playerTag={tag} playerSection={section} />
    </div>
  );
}

export default App;
