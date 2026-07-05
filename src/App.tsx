import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Header } from './components/Header/Header';
import { DuelDeckBuilder } from './components/DuelDeckBuilder/DuelDeckBuilder';
import { Landing } from './components/Landing/Landing';
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

function App() {
  const route = useHashRoute();
  const isBuilder = route.startsWith('#/builder');

  return (
    <AnimatePresence mode="wait">
      {isBuilder ? (
        <motion.div
          key="builder"
          className={styles.app}
          initial={{ opacity: 0, scale: 0.985, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 1.015, filter: 'blur(8px)' }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.3, 1] }}
        >
          <Header />
          <DuelDeckBuilder />
        </motion.div>
      ) : (
        <motion.div
          key="landing"
          className={styles.app}
          initial={{ opacity: 0, scale: 0.985, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 1.015, filter: 'blur(8px)' }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.3, 1] }}
        >
          <Landing />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
