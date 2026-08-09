import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import { ProfileMenu } from '../Profile/ProfileMenu';
import styles from './Landing.module.css';

/* Static landing page.
 *
 * This was ~900 lines of framer-motion: a timed intro reveal, an animated
 * environment (mesh-gradient blobs, aurora band, light rays, fog, 22 particles,
 * bokeh, drifting crowns, a castle silhouette, film grain), a cursor-tracking
 * spotlight, per-letter title animation, magnetic buttons with ripples,
 * scroll-linked parallax, 3D card tilt, and a launch transition.
 *
 * None of that could be switched off from CSS — framer-motion writes inline
 * styles from JavaScript every frame, so `animation: none` never applied to it.
 * The machinery is gone rather than disabled, which is also what removes the
 * last framer-motion import in the app. */

function scrollToSection(id: string) {
  // Instant, not smooth: smooth scrolling is motion too.
  document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function go(hash: string) {
  window.location.hash = hash;
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

function CastleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 21V9l2-1V5h2v2h2V5h2v2h2V5h2v2h2V5h2v3l2 1v12" />
      <path d="M4 21h16" />
      <path d="M10 21v-5a2 2 0 0 1 4 0v5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M3 11h18" />
    </svg>
  );
}

/* ============================================================ navigation */

const NAV_LINKS = [
  { label: 'Home', target: 'home' },
  { label: 'Features', target: 'features' },
  { label: 'About', target: 'about' },
] as const;

function Nav() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <nav className={styles.nav}>
      <button type="button" className={styles.navBrand} onClick={() => scrollToSection('home')}>
        <span className={styles.navLogo}>
          <CrownIcon size={15} />
        </span>
        Royal Arena
      </button>

      <div className={styles.navLinks}>
        {NAV_LINKS.map((l) => (
          <button
            key={l.target}
            type="button"
            className={styles.navLink}
            onClick={() => scrollToSection(l.target)}
          >
            {l.label}
          </button>
        ))}
      </div>

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
        <ProfileMenu triggerClassName={styles.navIcon} />
      </div>
    </nav>
  );
}

/* ================================================================== hero */

const TITLE_LINES = [
  { text: 'MASTER', className: 'titleLinePlain' },
  { text: 'CLASH ROYALE', className: 'titleLineGradient' },
  { text: 'DUELS', className: 'titleLinePlain' },
] as const;

function Hero() {
  return (
    <section id="home" className={styles.hero}>
      <div className={styles.heroContent}>
        <span className={styles.heroEyebrow}>The Clash Royale duels companion</span>

        <h1 className={styles.heroTitle}>
          {TITLE_LINES.map((line) => (
            <span key={line.text} className={`${styles.titleLine} ${styles[line.className]}`}>
              {line.text}
            </span>
          ))}
        </h1>

        <p className={styles.heroSub}>
          Up to five decks. Forty unique cards. One arena.
          <br />
          Craft the perfect duel lineup before your opponent does.
        </p>

        <div className={styles.heroCtas}>
          <button type="button" className={styles.primaryCta} onClick={() => go('#/builder')}>
            Enter Royal Duels
          </button>
          <button
            type="button"
            className={styles.ghostCta}
            onClick={() => scrollToSection('features')}
          >
            Explore the arena
          </button>
        </div>
      </div>
    </section>
  );
}

/* ====================================================== section cards */

interface PanelContent {
  kicker: string;
  title: string;
  desc: string;
  chips: readonly string[];
  ctaLabel: string;
  target: string;
  artKeys: readonly [string, string, string];
  flip?: boolean;
}

const PANELS: readonly PanelContent[] = [
  {
    kicker: 'Royal Duels',
    title: 'The duel deck forge',
    desc: 'Build all five battle decks side by side. Evolution, Hero and Wild slots enforced by position — an illegal lineup is impossible.',
    chips: ['Up to 5 decks · 40 cards', 'Evo · Hero · Wild', 'Live elixir stats'],
    ctaLabel: 'Enter Royal Duels',
    target: '#/builder',
    artKeys: ['knight', 'archer-queen', 'golden-knight'],
  },
  {
    kicker: "Deck's Home",
    title: 'Your collection hall',
    desc: 'A home for every deck you dream up — build and save unlimited single decks, each with the same Evolution, Hero and Wild slot rules.',
    chips: ['Unlimited decks', 'Auto-saving', 'No duel restrictions'],
    ctaLabel: "Open Deck's Home",
    target: '#/decks',
    artKeys: ['mega-knight', 'golden-knight', 'bandit'],
    flip: true,
  },
  {
    kicker: 'Counter Palette',
    title: 'The archetype armory',
    desc: 'Sort your arsenal into folders — one per archetype you face. Keep every counter deck filed, filterable and ready to deploy.',
    chips: ['Unlimited folders', 'Decks by archetype', 'Auto-saving'],
    ctaLabel: 'Open Counter Palette',
    target: '#/palette',
    artKeys: ['pekka', 'inferno-tower', 'skeleton-army'],
  },
];

function Panel({ content }: { content: PanelContent }) {
  return (
    <section className={styles.crystalSection}>
      <div className={styles.crystal}>
        <div className={`${styles.crystalInner} ${content.flip ? styles.crystalFlip : ''}`}>
          <div className={styles.crystalText}>
            <span className={styles.crystalKicker}>{content.kicker}</span>
            <h2 className={styles.crystalTitle}>{content.title}</h2>
            <p className={styles.crystalDesc}>{content.desc}</p>
            <ul className={styles.crystalChips}>
              {content.chips.map((chip) => (
                <li key={chip}>{chip}</li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.primaryCta}
              onClick={() => go(content.target)}
            >
              {content.ctaLabel}
            </button>
          </div>

          <div className={styles.crystalArt} aria-hidden="true">
            <img src={getCardIconUrl(content.artKeys[0])} alt="" draggable={false} className={styles.crystalArtA} />
            <img src={getCardIconUrl(content.artKeys[1])} alt="" draggable={false} className={styles.crystalArtB} />
            <img src={getCardIconUrl(content.artKeys[2])} alt="" draggable={false} className={styles.crystalArtC} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================== features */

const FEATURES = [
  {
    icon: SwordsIcon,
    title: 'Royal Duels',
    body: 'Solo and Versus duel building with drag & drop, positional special slots and instant validation.',
    target: '#/builder',
  },
  {
    icon: CastleIcon,
    title: "Deck's Home",
    body: 'Your personal collection — build and save unlimited single decks that store themselves automatically.',
    target: '#/decks',
  },
  {
    icon: FolderIcon,
    title: 'Counter Palette',
    body: 'Archetype folders that keep your counter decks segregated, filterable and always saved.',
    target: '#/palette',
  },
] as const;

/* ================================================================== page */

export function Landing() {
  return (
    <div className={styles.landing}>
      <div className={styles.page}>
        <Nav />
        <Hero />

        {PANELS.map((p) => (
          <Panel key={p.kicker} content={p} />
        ))}

        <section id="features" className={styles.featuresSection}>
          <h2 className={styles.sectionTitle}>Forged for duelists</h2>
          <div className={styles.featureGrid}>
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className={styles.featurePerspective}>
                  <button
                    type="button"
                    className={`${styles.featureCard} ${styles.featureLive}`}
                    onClick={() => go(f.target)}
                  >
                    <div className={styles.featureHead}>
                      <span className={styles.featureIcon}>
                        <Icon />
                      </span>
                      <span className={`${styles.featureStatus} ${styles.statusLive}`}>Live</span>
                    </div>
                    <h3 className={styles.featureTitle}>{f.title}</h3>
                    <p className={styles.featureBody}>{f.body}</p>
                    <span className={styles.featureGo} aria-hidden="true">
                      Open →
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section id="about" className={styles.about}>
          <span className={styles.aboutCrown} aria-hidden="true">
            <CrownIcon size={22} />
          </span>
          <h2 className={styles.aboutTitle}>Built for the arena</h2>
          <p className={styles.aboutBody}>
            Royal Arena is a premium companion for Clash Royale duels. Everything runs in your
            browser and saves locally — no uploads, no waiting, just you and the perfect lineup.
          </p>
        </section>

        <footer className={styles.footer}>
          <span className={styles.footerBrand}>
            <CrownIcon size={13} /> Royal Arena
          </span>
          <span className={styles.footerFine}>
            Unofficial fan content. Not affiliated with, endorsed, sponsored, or specifically
            approved by Supercell.
          </span>
        </footer>
      </div>
    </div>
  );
}
