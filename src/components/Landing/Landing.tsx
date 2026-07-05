import { useEffect, useRef, useState } from 'react';
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion';
import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import styles from './Landing.module.css';

function goToBuilder() {
  window.location.hash = '#/builder';
}

/* ---------------------------------------------------------------- icons */

function CrownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M19.27 5.33A16.94 16.94 0 0 0 15.06 4l-.2.41a15.6 15.6 0 0 1 3.9 1.96 15.9 15.9 0 0 0-13.5 0 15.6 15.6 0 0 1 3.9-1.96L8.96 4a16.94 16.94 0 0 0-4.23 1.33C2.05 9.29 1.32 13.16 1.68 16.98a17.1 17.1 0 0 0 5.18 2.62l.42-.58a11 11 0 0 1-1.71-.83l.14-.1a12.2 12.2 0 0 0 10.58 0l.14.1c-.55.32-1.12.6-1.71.83l.42.58a17.1 17.1 0 0 0 5.18-2.62c.43-4.42-.73-8.26-3.05-11.65zM8.68 14.63c-1 0-1.83-.93-1.83-2.06s.81-2.06 1.83-2.06 1.85.93 1.83 2.06c0 1.13-.81 2.06-1.83 2.06zm6.64 0c-1 0-1.83-.93-1.83-2.06s.81-2.06 1.83-2.06 1.84.93 1.83 2.06c0 1.13-.8 2.06-1.83 2.06z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2c-3.7 0-8 1.9-8 5v1h16v-1c0-3.1-4.3-5-8-5z" />
    </svg>
  );
}

/* ------------------------------------------------------- animated counter */

function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, target, {
      duration: 1.4,
      ease: [0.2, 0.8, 0.3, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, target]);

  return (
    <span ref={ref} className={styles.statValue}>
      {value}
      {suffix}
    </span>
  );
}

/* ---------------------------------------------------------- feature card */

const FLOATING_CARDS = [
  { key: 'archer-queen', className: 'floatCardA' },
  { key: 'golden-knight', className: 'floatCardB' },
  { key: 'knight', className: 'floatCardC' },
  { key: 'mega-knight', className: 'floatCardD' },
] as const;

function FeatureCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [launching, setLaunching] = useState(false);

  const rotateXRaw = useMotionValue(0);
  const rotateYRaw = useMotionValue(0);
  const rotateX = useSpring(rotateXRaw, { stiffness: 180, damping: 22 });
  const rotateY = useSpring(rotateYRaw, { stiffness: 180, damping: 22 });
  const spotX = useMotionValue(50);
  const spotY = useMotionValue(35);
  const spotlight = useTransform(
    [spotX, spotY],
    ([x, y]) =>
      `radial-gradient(420px circle at ${x}% ${y}%, rgba(183, 140, 255, 0.16), transparent 65%)`,
  );

  function handleMouseMove(e: React.MouseEvent) {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateYRaw.set(px * 9);
    rotateXRaw.set(-py * 9);
    spotX.set((px + 0.5) * 100);
    spotY.set((py + 0.5) * 100);
  }

  function handleMouseLeave() {
    rotateYRaw.set(0);
    rotateXRaw.set(0);
    spotX.set(50);
    spotY.set(35);
  }

  function handleLaunch() {
    if (launching) return;
    setLaunching(true);
    window.setTimeout(goToBuilder, 520);
  }

  return (
    <motion.div
      className={styles.featureScene}
      initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ type: 'spring', stiffness: 160, damping: 24, delay: 0.35 }}
    >
      {FLOATING_CARDS.map(({ key, className }) => (
        <img
          key={key}
          src={getCardIconUrl(key)}
          alt=""
          aria-hidden="true"
          className={`${styles.floatCard} ${styles[className]}`}
        />
      ))}

      <motion.div
        className={styles.floatWrap}
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      >
      <motion.div
        ref={cardRef}
        className={styles.featureCard}
        style={{ rotateX, rotateY }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        whileHover={{ y: -8, scale: 1.015 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      >
        <motion.div className={styles.featureSpotlight} style={{ background: spotlight }} />
        <span className={styles.featureBorder} aria-hidden="true" />

        <div className={styles.featureTop}>
          <motion.span
            className={styles.featureIcon}
            animate={{ y: [0, -5, 0], rotate: [0, -3, 0, 3, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden="true"
          >
            ⚔️
          </motion.span>
          <span className={styles.statusBadge}>
            <span className={styles.statusDot} />
            Live
          </span>
        </div>

        <h2 className={styles.featureTitle}>Royal Duels</h2>
        <p className={styles.featureDesc}>
          Create optimized Duel decks while ensuring every card is unique.
        </p>

        <ul className={styles.featureHighlights}>
          <li>4 decks · 32 unique cards</li>
          <li>Evolution, Hero &amp; Wild slots</li>
          <li>Live elixir &amp; cycle stats</li>
        </ul>

        <motion.button
          type="button"
          className={styles.cta}
          onClick={handleLaunch}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
        >
          Start Building
          <motion.span
            aria-hidden="true"
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            →
          </motion.span>
        </motion.button>

        {launching && (
          <motion.span
            className={styles.launchFlash}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 0.9], scale: 2.2 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden="true"
          />
        )}
      </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- page */

const SECONDARY_FEATURES = [
  {
    title: 'Unique-card guardrails',
    body: 'Cards already used in another deck grey out instantly — an illegal duel lineup is impossible to build.',
  },
  {
    title: 'True 2026 deck slots',
    body: 'Evolution, Hero and Wild slots are enforced by position, with rarity glows and champion limits built in.',
  },
  {
    title: 'Instant, private, yours',
    body: 'Everything runs in your browser and saves locally. No accounts, no uploads, no waiting.',
  },
];

export function Landing() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <div className={styles.landing}>
      {/* ambient FX layers */}
      <div className={styles.fxBeams} aria-hidden="true" />
      <div className={styles.fxParticles} aria-hidden="true" />
      <div className={styles.fxCrowns} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={styles[`crown${i + 1}`]}>
            <CrownIcon size={i % 2 ? 14 : 20} />
          </span>
        ))}
      </div>
      <div className={styles.fxNoise} aria-hidden="true" />

      <motion.nav
        className={styles.nav}
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        <span className={styles.navBrand}>
          <span className={styles.navLogo}>
            <CrownIcon size={16} />
          </span>
          Royal Arena
        </span>
        <div className={styles.navActions}>
          <button
            type="button"
            className={styles.navIcon}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <span className={styles.navIcon} title="GitHub (coming soon)">
            <GithubIcon />
          </span>
          <span className={styles.navIcon} title="Discord (coming soon)">
            <DiscordIcon />
          </span>
          <span className={styles.navIcon} title="Profile (coming soon)">
            <UserIcon />
          </span>
        </div>
      </motion.nav>

      <main className={styles.main}>
        <section className={styles.hero}>
          <motion.h1
            className={styles.title}
            initial={{ opacity: 0, y: 28, filter: 'blur(12px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ type: 'spring', stiffness: 140, damping: 22, delay: 0.08 }}
          >
            Royal Arena
          </motion.h1>
          <motion.p
            className={styles.subtitle}
            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ type: 'spring', stiffness: 140, damping: 22, delay: 0.2 }}
          >
            Build smarter. Win more. Master Clash Royale Duels.
          </motion.p>

          <FeatureCard />
        </section>

        <motion.section
          className={styles.stats}
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ type: 'spring', stiffness: 160, damping: 24 }}
        >
          <div className={styles.stat}>
            <Counter target={122} />
            <span className={styles.statLabel}>Cards</span>
          </div>
          <div className={styles.stat}>
            <Counter target={4} />
            <span className={styles.statLabel}>Duel decks</span>
          </div>
          <div className={styles.stat}>
            <Counter target={32} />
            <span className={styles.statLabel}>Unique slots</span>
          </div>
          <div className={styles.stat}>
            <Counter target={8} />
            <span className={styles.statLabel}>Champions</span>
          </div>
        </motion.section>

        <section className={styles.featureGrid}>
          {SECONDARY_FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              className={styles.miniFeature}
              initial={{ opacity: 0, y: 36, filter: 'blur(6px)' }}
              whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ type: 'spring', stiffness: 180, damping: 24, delay: i * 0.08 }}
              whileHover={{ y: -5 }}
            >
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </motion.article>
          ))}
        </section>
      </main>

      <motion.footer
        className={styles.footer}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <span>Royal Arena — a Clash Royale companion</span>
        <span className={styles.footerFine}>
          Unofficial fan content. Not affiliated with, endorsed, sponsored, or specifically
          approved by Supercell.
        </span>
      </motion.footer>
    </div>
  );
}
