import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Header } from './components/Header/Header';
import { DuelDeckBuilder } from './components/DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from './components/DecksHome/DecksHome';
import { CounterPalette } from './components/CounterPalette/CounterPalette';
import { Landing } from './components/Landing/Landing';
import { Login } from './components/Login/Login';
import { useAuthStore } from './state/authStore';
import styles from './App.module.css';

function useHashRoute(): string {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

const pageMotion = {
  initial: { opacity: 0, scale: 0.985, filter: 'blur(8px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 1.015, filter: 'blur(8px)' },
  transition: { duration: 0.4, ease: [0.2, 0.8, 0.3, 1] as const },
};

function App() {
  const route = useHashRoute();
  const user = useAuthStore((s) => s.user);
  const page = route.startsWith('#/builder')
    ? 'builder'
    : route.startsWith('#/decks')
      ? 'decks'
      : route.startsWith('#/palette')
        ? 'palette'
        : 'landing';

  return (
    <AnimatePresence mode="wait">
      {!user ? (
        <motion.div key="login" className={styles.app} {...pageMotion}>
          <Login />
        </motion.div>
      ) : page === 'builder' ? (
        <motion.div key="builder" className={styles.app} {...pageMotion}>
          <Header />
          <DuelDeckBuilder />
        </motion.div>
      ) : page === 'decks' ? (
        <motion.div key="decks" className={styles.app} {...pageMotion}>
          <DecksHome />
        </motion.div>
      ) : page === 'palette' ? (
        <motion.div key="palette" className={styles.app} {...pageMotion}>
          <CounterPalette />
        </motion.div>
      ) : (
        <motion.div key="landing" className={styles.app} {...pageMotion}>
          <Landing />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
