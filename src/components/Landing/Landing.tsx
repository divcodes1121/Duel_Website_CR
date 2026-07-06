import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { useCardTilt } from '../../hooks/useCardTilt';
import styles from './Landing.module.css';

/* ================================================================ helpers */

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================================== icons */

function CrownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  );
}

function SwordsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M9.5 6.5 21 18v3h-3L6.5 9.5" opacity="0.55" />
    </svg>
  );
}

/* ====================================================== cinematic intro */

function CinematicIntro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 2050);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      className={styles.intro}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.7, ease: [0.4, 0, 0.2, 1] } }}
    >
      <motion.div
        className={styles.introMark}
        initial={{ opacity: 0, scale: 0.6, filter: 'blur(12px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      >
        <span className={styles.introRing} aria-hidden="true" />
        <span className={styles.introCrown}>
          <CrownIcon size={34} />
        </span>
      </motion.div>
      <motion.span
        className={styles.introWord}
        initial={{ opacity: 0, y: 14, letterSpacing: '0.6em' }}
        animate={{ opacity: 1, y: 0, letterSpacing: '0.34em' }}
        transition={{ duration: 0.9, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        ROYAL ARENA
      </motion.span>
      <motion.span
        className={styles.introBar}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.15, delay: 0.55, ease: [0.65, 0, 0.35, 1] }}
        aria-hidden="true"
      />
    </motion.div>
  );
}

/* ==================================================== living environment */

const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 137.5) % 100,
  size: 2 + ((i * 7) % 4),
  duration: 18 + ((i * 13) % 20),
  delay: -((i * 17) % 36),
  drift: ((i * 29) % 60) - 30,
}));

const BOKEH = Array.from({ length: 6 }, (_, i) => ({
  left: 8 + ((i * 61) % 84),
  top: 10 + ((i * 37) % 70),
  size: 60 + ((i * 43) % 90),
  duration: 26 + ((i * 11) % 18),
  delay: -((i * 7) % 22),
}));

const ENV_CROWNS = Array.from({ length: 5 }, (_, i) => ({
  left: 6 + ((i * 53) % 88),
  top: 8 + ((i * 41) % 74),
  size: i % 2 ? 13 : 19,
  duration: 30 + ((i * 9) % 20),
  delay: -((i * 13) % 26),
}));

function CastleSilhouette() {
  return (
    <svg viewBox="0 0 1440 300" preserveAspectRatio="none" className={styles.envCastle} aria-hidden="true">
      <path d="M0 300 L0 235 L190 170 L400 250 L570 195 L720 240 L900 185 L1090 250 L1260 190 L1440 240 L1440 300 Z" />
      <path d="M560 240 L560 130 L555 130 L555 112 L568 112 L568 122 L580 122 L580 112 L593 112 L593 130 L588 130 L588 240 Z" />
      <path d="M847 240 L847 130 L842 130 L842 112 L855 112 L855 122 L867 122 L867 112 L880 112 L880 130 L875 130 L875 240 Z" />
      <path d="M630 250 L630 105 L622 105 L622 82 L640 82 L640 94 L658 94 L658 82 L676 82 L676 94 L694 94 L694 82 L712 82 L712 94 L730 94 L730 82 L748 82 L748 94 L766 94 L766 82 L784 82 L784 94 L802 94 L802 82 L818 82 L818 105 L810 105 L810 250 Z" />
      <path d="M700 82 L720 34 L740 82 Z" />
      <rect x="717" y="20" width="4" height="20" />
    </svg>
  );
}

function Environment({ mx, my }: { mx: MotionValue<number>; my: MotionValue<number> }) {
  const xSlow = useTransform(mx, (v) => v * -18);
  const ySlow = useTransform(my, (v) => v * -12);
  const xMid = useTransform(mx, (v) => v * -34);
  const yMid = useTransform(my, (v) => v * -20);

  return (
    <div className={styles.env} aria-hidden="true">
      {/* animated mesh gradient */}
      <div className={`${styles.envBlob} ${styles.envBlobA}`} />
      <div className={`${styles.envBlob} ${styles.envBlobB}`} />
      <div className={`${styles.envBlob} ${styles.envBlobC}`} />

      {/* aurora band */}
      <div className={styles.envAurora} />

      {/* sweeping light rays */}
      <div className={`${styles.envRay} ${styles.envRayA}`} />
      <div className={`${styles.envRay} ${styles.envRayB}`} />

      {/* atmospheric fog */}
      <motion.div style={{ x: xSlow }} className={styles.envLayer}>
        <div className={`${styles.envFog} ${styles.envFogA}`} />
        <div className={`${styles.envFog} ${styles.envFogB}`} />
      </motion.div>

      {/* glowing dust + particles */}
      <div className={styles.envLayer}>
        {BOKEH.map((b, i) => (
          <span
            key={`b${i}`}
            className={styles.envBokeh}
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: b.size,
              height: b.size,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
            }}
          />
        ))}
        {PARTICLES.map((p, i) => (
          <span
            key={`p${i}`}
            className={styles.envParticle}
            style={
              {
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                animationDuration: `${p.duration}s`,
                animationDelay: `${p.delay}s`,
                '--drift': `${p.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* drifting crowns */}
      <motion.div style={{ x: xMid, y: yMid }} className={styles.envLayer}>
        {ENV_CROWNS.map((c, i) => (
          <span
            key={`c${i}`}
            className={styles.envCrown}
            style={{
              left: `${c.left}%`,
              top: `${c.top}%`,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
            }}
          >
            <CrownIcon size={c.size} />
          </span>
        ))}
      </motion.div>

      {/* castle silhouette, deepest layer */}
      <motion.div style={{ x: xSlow, y: ySlow }} className={styles.envCastleWrap}>
        <CastleSilhouette />
      </motion.div>

      {/* film grain */}
      <div className={styles.envNoise} />
    </div>
  );
}

/* ======================================================= mouse spotlight */

function MouseSpotlight({ px, py }: { px: MotionValue<number>; py: MotionValue<number> }) {
  const x = useSpring(px, { stiffness: 90, damping: 24 });
  const y = useSpring(py, { stiffness: 90, damping: 24 });
  return <motion.div className={styles.spotlight} style={{ x, y }} aria-hidden="true" />;
}

/* ============================================================ navigation */

const NAV_LINKS = [
  { label: 'Home', target: 'home' },
  { label: 'Features', target: 'features' },
  { label: 'About', target: 'about' },
] as const;

function Nav({ introDone }: { introDone: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <motion.nav
      className={styles.nav}
      initial={{ opacity: 0, y: -26 }}
      animate={introDone ? { opacity: 1, y: 0 } : {}}
      transition={{ type: 'spring', stiffness: 180, damping: 22, delay: 0.1 }}
    >
      <motion.button
        type="button"
        className={styles.navBrand}
        onClick={() => scrollToSection('home')}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
      >
        <motion.span
          className={styles.navLogo}
          whileHover={{ rotate: [0, -12, 10, 0], transition: { duration: 0.5 } }}
        >
          <CrownIcon size={15} />
        </motion.span>
        Royal Arena
      </motion.button>

      <div className={styles.navLinks}>
        {NAV_LINKS.map((l) => (
          <button
            key={l.target}
            type="button"
            className={styles.navLink}
            onClick={() => scrollToSection(l.target)}
          >
            {l.label}
            <span className={styles.navLinkGlow} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className={styles.navActions}>
        <motion.button
          type="button"
          className={styles.navIcon}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
          whileHover={{ y: -2, scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
        >
          {theme === 'dark' ? '☾' : '☀'}
        </motion.button>
        <ProfileMenu triggerClassName={styles.navIcon} />
      </div>
    </motion.nav>
  );
}

/* ================================================================== hero */

const TITLE_LINES = [
  { text: 'MASTER', className: 'titleLinePlain' },
  { text: 'CLASH ROYALE', className: 'titleLineGradient' },
  { text: 'DUELS', className: 'titleLinePlain' },
] as const;

const titleContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.15 } },
};

const titleLetter = {
  hidden: { opacity: 0, y: 46, rotateX: 55 },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: { type: 'spring' as const, stiffness: 240, damping: 22 },
  },
};

function HeroTitle({ introDone }: { introDone: boolean }) {
  return (
    <motion.h1
      className={styles.heroTitle}
      variants={titleContainer}
      initial="hidden"
      animate={introDone ? 'visible' : 'hidden'}
      aria-label="Master Clash Royale Duels"
    >
      {TITLE_LINES.map((line) => (
        <span key={line.text} className={`${styles.titleLine} ${styles[line.className]}`} aria-hidden="true">
          {line.text.split('').map((ch, i) =>
            ch === ' ' ? (
              <span key={i} className={styles.titleSpace} />
            ) : (
              <motion.span
                key={i}
                className={styles.titleLetter}
                variants={titleLetter}
                whileHover={{
                  y: -10,
                  scale: 1.1,
                  transition: { type: 'spring', stiffness: 480, damping: 12 },
                }}
              >
                {ch}
              </motion.span>
            ),
          )}
        </span>
      ))}
    </motion.h1>
  );
}

/** Button that leans toward the cursor and ripples on press. */
function MagneticButton({
  className,
  onClick,
  children,
}: {
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const dxRaw = useMotionValue(0);
  const dyRaw = useMotionValue(0);
  const dx = useSpring(dxRaw, { stiffness: 240, damping: 16 });
  const dy = useSpring(dyRaw, { stiffness: 240, damping: 16 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  function handleMove(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    dxRaw.set((e.clientX - (rect.left + rect.width / 2)) * 0.26);
    dyRaw.set((e.clientY - (rect.top + rect.height / 2)) * 0.32);
  }

  function handleLeave() {
    dxRaw.set(0);
    dyRaw.set(0);
  }

  function handlePointerDown(e: React.PointerEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const id = Date.now();
    setRipples((r) => [...r, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    window.setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 700);
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      className={className}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onPointerDown={handlePointerDown}
      style={{ x: dx, y: dy }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.93 }}
      transition={{ type: 'spring', stiffness: 420, damping: 17 }}
    >
      {children}
      <span className={styles.buttonShine} aria-hidden="true" />
      {ripples.map((r) => (
        <span key={r.id} className={styles.ripple} style={{ left: r.x, top: r.y }} aria-hidden="true" />
      ))}
    </motion.button>
  );
}

const HERO_FLOATERS = [
  { key: 'mega-knight', className: 'heroCardA' },
  { key: 'archer-queen', className: 'heroCardB' },
  { key: 'hog-rider', className: 'heroCardC' },
  { key: 'golden-knight', className: 'heroCardD' },
] as const;

function Hero({
  introDone,
  onEnter,
  mx,
  my,
  containerRef,
}: {
  introDone: boolean;
  onEnter: () => void;
  mx: MotionValue<number>;
  my: MotionValue<number>;
  containerRef: React.RefObject<HTMLDivElement>;
}) {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    container: containerRef,
    target: heroRef,
    offset: ['start start', 'end start'],
  });

  const yContent = useTransform(scrollYProgress, [0, 1], [0, -160]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const yCards = useTransform(scrollYProgress, [0, 1], [0, 300]);
  const hintOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0]);

  const xCards = useTransform(mx, (v) => v * -52);
  const yCardsMouse = useTransform(my, (v) => v * -24);

  return (
    <section ref={heroRef} id="home" className={styles.hero}>
      <motion.div className={styles.heroContent} style={{ y: yContent, opacity: contentOpacity }}>
        <motion.span
          className={styles.heroEyebrow}
          initial={{ opacity: 0, y: 18 }}
          animate={introDone ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className={styles.eyebrowDot} aria-hidden="true" />
          The Clash Royale duels companion
        </motion.span>

        <HeroTitle introDone={introDone} />

        <motion.p
          className={styles.heroSub}
          initial={{ opacity: 0, y: 26 }}
          animate={introDone ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.85, ease: [0.16, 1, 0.3, 1] }}
        >
          Four decks. Thirty-two unique cards. One arena.
          <br />
          Craft the perfect duel lineup before your opponent does.
        </motion.p>

        <motion.div
          className={styles.heroCtas}
          initial={{ opacity: 0, y: 30 }}
          animate={introDone ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 1.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <MagneticButton className={styles.primaryCta} onClick={onEnter}>
            <span className={styles.ctaSword} aria-hidden="true">
              ⚔
            </span>
            Enter Royal Duels
          </MagneticButton>
          <motion.button
            type="button"
            className={styles.ghostCta}
            onClick={() => scrollToSection('features')}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.95 }}
          >
            Explore the arena
            <motion.span
              aria-hidden="true"
              animate={{ y: [0, 4, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            >
              ↓
            </motion.span>
          </motion.button>
        </motion.div>
      </motion.div>

      <motion.div className={styles.heroCards} style={{ y: yCards, x: xCards }} aria-hidden="true">
        <motion.div style={{ y: yCardsMouse }}>
          {HERO_FLOATERS.map(({ key, className }, i) => (
            <motion.img
              key={key}
              src={getCardIconUrl(key)}
              alt=""
              draggable={false}
              className={`${styles.heroCard} ${styles[className]}`}
              initial={{ opacity: 0, scale: 0.7, y: 60 }}
              animate={introDone ? { opacity: 1, scale: 1, y: 0 } : {}}
              transition={{ type: 'spring', stiffness: 140, damping: 20, delay: 1.1 + i * 0.12 }}
            />
          ))}
        </motion.div>
      </motion.div>

      <motion.div className={styles.scrollHint} style={{ opacity: hintOpacity }} aria-hidden="true">
        <span>scroll</span>
        <span className={styles.scrollChevron}>⌄</span>
      </motion.div>
    </section>
  );
}

/* ====================================================== crystal centerpieces */

interface CrystalContent {
  kickerIcon: string;
  kicker: string;
  title: string;
  desc: string;
  chips: readonly string[];
  ctaIcon: string;
  ctaLabel: string;
  artKeys: readonly [string, string, string];
  flip?: boolean;
}

const DUELS_CRYSTAL: CrystalContent = {
  kickerIcon: '⚔',
  kicker: 'Royal Duels',
  title: 'The duel deck forge',
  desc: 'Build all four battle decks side by side. Evolution, Hero and Wild slots enforced by position — an illegal lineup is impossible.',
  chips: ['4 decks · 32 cards', 'Evo · Hero · Wild', 'Live elixir stats'],
  ctaIcon: '⚔',
  ctaLabel: 'Enter Royal Duels',
  artKeys: ['knight', 'archer-queen', 'golden-knight'],
};

const HOME_CRYSTAL: CrystalContent = {
  kickerIcon: '🏰',
  kicker: "Deck's Home",
  title: 'Your collection hall',
  desc: 'A home for every deck you dream up — build and save unlimited single decks, each with the same Evolution, Hero and Wild slot rules.',
  chips: ['Unlimited decks', 'Auto-saving', 'No duel restrictions'],
  ctaIcon: '🏰',
  ctaLabel: "Open Deck's Home",
  artKeys: ['mega-knight', 'golden-knight', 'bandit'],
  flip: true,
};

function CrystalCard({ content, onEnter }: { content: CrystalContent; onEnter: () => void }) {
  const tilt = useCardTilt<HTMLDivElement>(10, 0.2);
  const artX = useTransform(tilt.rotateY, (v) => v * 2.2);
  const artY = useTransform(tilt.rotateX, (v) => v * -2.2);

  return (
    <motion.section
      className={styles.crystalSection}
      initial={{ opacity: 0, scale: 0.92, filter: 'blur(10px)' }}
      whileInView={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-120px' }}
      transition={{ type: 'spring', stiffness: 110, damping: 22 }}
    >
      <div className={styles.crystalGlow} aria-hidden="true" />

      <motion.div
        className={styles.crystalFloat}
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          ref={tilt.ref}
          className={styles.crystal}
          style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY }}
          onMouseMove={tilt.onMouseMove}
          onMouseLeave={tilt.onMouseLeave}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.975 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        >
          <span className={styles.crystalBorder} aria-hidden="true" />
          <motion.div className={styles.crystalSpot} style={{ background: tilt.spotlight }} aria-hidden="true" />
          <span className={styles.crystalReflection} aria-hidden="true" />

          <div className={`${styles.crystalInner} ${content.flip ? styles.crystalFlip : ''}`}>
            <div className={styles.crystalText}>
              <span className={styles.crystalKicker}>
                <span aria-hidden="true">{content.kickerIcon}</span> {content.kicker}
              </span>
              <h2 className={styles.crystalTitle}>{content.title}</h2>
              <p className={styles.crystalDesc}>{content.desc}</p>
              <ul className={styles.crystalChips}>
                {content.chips.map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
              </ul>
              <MagneticButton className={styles.primaryCta} onClick={onEnter}>
                <span className={styles.ctaSword} aria-hidden="true">
                  {content.ctaIcon}
                </span>
                {content.ctaLabel}
              </MagneticButton>
            </div>

            <motion.div className={styles.crystalArt} style={{ x: artX, y: artY }} aria-hidden="true">
              <motion.img
                src={getCardIconUrl(content.artKeys[0])}
                alt=""
                draggable={false}
                className={styles.crystalArtA}
                animate={{ y: [0, -10, 0], rotate: [-6, -4, -6] }}
                transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.img
                src={getCardIconUrl(content.artKeys[1])}
                alt=""
                draggable={false}
                className={styles.crystalArtB}
                animate={{ y: [0, -14, 0], rotate: [7, 5, 7] }}
                transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }}
              />
              <motion.img
                src={getCardIconUrl(content.artKeys[2])}
                alt=""
                draggable={false}
                className={styles.crystalArtC}
                animate={{ y: [0, -8, 0], rotate: [-2, 1, -2] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1.7 }}
              />
            </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </motion.section>
  );
}

/* ============================================================== features */

function CastleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 21V9l2-1V5h2v2h2V5h2v2h2V5h2v2h2V5h2v3l2 1v12" />
      <path d="M4 21h16" />
      <path d="M10 21v-5a2 2 0 0 1 4 0v5" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: SwordsIcon,
    title: 'Royal Duels',
    body: 'Solo and Versus duel building with drag & drop, positional special slots and instant validation.',
    status: 'Live',
    live: true,
    target: '#/builder',
  },
  {
    icon: CastleIcon,
    title: "Deck's Home",
    body: 'Your personal collection — build and save unlimited single decks that store themselves automatically.',
    status: 'Live',
    live: true,
    target: '#/decks',
  },
] as const;

function FeatureCard({
  feature,
  index,
  onEnter,
}: {
  feature: (typeof FEATURES)[number];
  index: number;
  onEnter: () => void;
}) {
  const tilt = useCardTilt<HTMLDivElement>(7, 0.12);
  const Icon = feature.icon;

  return (
    <motion.div
      className={styles.featurePerspective}
      initial={{ opacity: 0, y: 70, rotateX: 14, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ type: 'spring', stiffness: 130, damping: 21, delay: index * 0.12 }}
    >
      <motion.div
        ref={tilt.ref}
        className={`${styles.featureCard} ${feature.live ? styles.featureLive : ''}`}
        style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY }}
        onMouseMove={tilt.onMouseMove}
        onMouseLeave={tilt.onMouseLeave}
        onClick={feature.live ? onEnter : undefined}
        whileHover={{ y: -10 }}
        transition={{ type: 'spring', stiffness: 240, damping: 20 }}
        role={feature.live ? 'button' : undefined}
        tabIndex={feature.live ? 0 : undefined}
        onKeyDown={
          feature.live
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') onEnter();
              }
            : undefined
        }
      >
        <span className={styles.featureBorder} aria-hidden="true" />
        <motion.div className={styles.featureSpot} style={{ background: tilt.spotlight }} aria-hidden="true" />

        <div className={styles.featureHead}>
          <motion.span
            className={styles.featureIcon}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 5 + index, repeat: Infinity, ease: 'easeInOut', delay: index * 0.7 }}
          >
            <Icon />
          </motion.span>
          <span className={`${styles.featureStatus} ${feature.live ? styles.statusLive : ''}`}>
            {feature.live && <span className={styles.statusDot} aria-hidden="true" />}
            {feature.status}
          </span>
        </div>

        <h3 className={styles.featureTitle}>{feature.title}</h3>
        <p className={styles.featureBody}>{feature.body}</p>

        {feature.live && (
          <span className={styles.featureGo} aria-hidden="true">
            Open <span className={styles.featureGoArrow}>→</span>
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ============================================================ launch fx */

function LaunchOverlay() {
  return (
    <motion.div className={styles.launch} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.span
        className={styles.launchFlash}
        initial={{ scale: 0.1, opacity: 0 }}
        animate={{ scale: 4, opacity: [0, 1, 1] }}
        transition={{ duration: 0.75, ease: [0.3, 0, 0.4, 1] }}
      />
    </motion.div>
  );
}

/* ================================================================== page */

export function Landing() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [introDone, setIntroDone] = useState(() => {
    if (REDUCED_MOTION) return true;
    try {
      return sessionStorage.getItem('ra-intro-seen') === '1';
    } catch {
      return true;
    }
  });
  const [launching, setLaunching] = useState(false);

  // global mouse -> normalized (-0.5..0.5) for parallax + raw px for spotlight
  const mxRaw = useMotionValue(0);
  const myRaw = useMotionValue(0);
  const mx = useSpring(mxRaw, { stiffness: 50, damping: 18 });
  const my = useSpring(myRaw, { stiffness: 50, damping: 18 });
  const spotXRaw = useMotionValue(-600);
  const spotYRaw = useMotionValue(-600);

  function handleMouseMove(e: React.MouseEvent) {
    mxRaw.set(e.clientX / window.innerWidth - 0.5);
    myRaw.set(e.clientY / window.innerHeight - 0.5);
    spotXRaw.set(e.clientX - 340);
    spotYRaw.set(e.clientY - 340);
  }

  function finishIntro() {
    try {
      sessionStorage.setItem('ra-intro-seen', '1');
    } catch {
      /* private mode */
    }
    setIntroDone(true);
  }

  function launch(target = '#/builder') {
    if (launching) return;
    setLaunching(true);
    window.setTimeout(() => {
      window.location.hash = target;
    }, 780);
  }

  return (
    <div className={styles.landing} ref={scrollRef} onMouseMove={handleMouseMove}>
      <Environment mx={mx} my={my} />
      <MouseSpotlight px={spotXRaw} py={spotYRaw} />

      <motion.div
        className={styles.page}
        animate={
          launching
            ? { scale: 1.08, filter: 'blur(10px)', opacity: 0.85 }
            : { scale: 1, filter: 'blur(0px)', opacity: 1 }
        }
        transition={{ duration: 0.75, ease: [0.4, 0, 0.2, 1] }}
      >
        <Nav introDone={introDone} />

        <Hero introDone={introDone} onEnter={() => launch('#/builder')} mx={mx} my={my} containerRef={scrollRef} />

        <CrystalCard content={DUELS_CRYSTAL} onEnter={() => launch('#/builder')} />
        <CrystalCard content={HOME_CRYSTAL} onEnter={() => launch('#/decks')} />

        <section id="features" className={styles.featuresSection}>
          <motion.h2
            className={styles.sectionTitle}
            initial={{ opacity: 0, y: 34, filter: 'blur(6px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ type: 'spring', stiffness: 150, damping: 22 }}
          >
            Forged for duelists
          </motion.h2>
          <div className={styles.featureGrid}>
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} feature={f} index={i} onEnter={() => launch(f.target)} />
            ))}
          </div>
        </section>

        <motion.section
          id="about"
          className={styles.about}
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ type: 'spring', stiffness: 140, damping: 22 }}
        >
          <span className={styles.aboutCrown} aria-hidden="true">
            <CrownIcon size={22} />
          </span>
          <h2 className={styles.aboutTitle}>Built for the arena</h2>
          <p className={styles.aboutBody}>
            Royal Arena is a premium companion for Clash Royale duels. Everything runs in your
            browser and saves locally — no uploads, no waiting, just you and the perfect lineup.
          </p>
        </motion.section>

        <footer className={styles.footer}>
          <span className={styles.footerBrand}>
            <CrownIcon size={13} /> Royal Arena
          </span>
          <span className={styles.footerFine}>
            Unofficial fan content. Not affiliated with, endorsed, sponsored, or specifically
            approved by Supercell.
          </span>
        </footer>
      </motion.div>

      <AnimatePresence>{!introDone && <CinematicIntro onDone={finishIntro} />}</AnimatePresence>
      <AnimatePresence>{launching && <LaunchOverlay />}</AnimatePresence>
    </div>
  );
}
