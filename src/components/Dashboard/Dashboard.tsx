import { useState } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import { ProfileMenu } from '../Profile/ProfileMenu';
import {
  AnalyticsIcon,
  ArrowRightIcon,
  BarsIcon,
  BellIcon,
  CardsIcon,
  CrownIcon,
  DeckIcon,
  EvolutionIcon,
  HomeIcon,
  InfoIcon,
  MoonIcon,
  PaletteIcon,
  PieIcon,
  SearchIcon,
  ShieldIcon,
  StarIcon,
  SunIcon,
  SwordsIcon,
  TargetIcon,
} from './icons';
import styles from './Dashboard.module.css';

/* The post-login home: top bar, a sidebar of analytics sections, and a panel
 * that swaps with the selected section. Only Search Player is built out; the
 * rest render a scrollable placeholder so the shell behaves like the finished
 * thing while the data work is still ahead. */

const TOP_NAV = [
  { label: 'Home', icon: HomeIcon, hash: null },
  { label: 'Analytics', icon: AnalyticsIcon, hash: null },
  { label: 'Deck Builder', icon: DeckIcon, hash: '#/decks' },
  { label: 'Duel Builder', icon: SwordsIcon, hash: '#/builder' },
  { label: 'Counter Palette', icon: PaletteIcon, hash: '#/palette' },
  { label: 'About', icon: InfoIcon, hash: null },
] as const;

const SIDE_NAV = [
  { label: 'Search Player', icon: SearchIcon },
  { label: 'Top 10 Decks', icon: BarsIcon },
  { label: 'Deck Analysis', icon: PieIcon },
  { label: 'Duel Analysis', icon: SwordsIcon },
  { label: 'Deck Counter', icon: ShieldIcon },
  { label: 'Win Conditions', icon: TargetIcon },
  { label: 'Cards', icon: CardsIcon },
  { label: 'Champions', icon: CrownIcon },
  { label: 'Evolutions', icon: EvolutionIcon },
] as const;

const SECTION_BLURB: Record<string, string> = {
  'Top 10 Decks': 'The decks winning most right now, ranked by usage and win rate.',
  'Deck Analysis': 'Break a deck down: elixir curve, cycle, role coverage and matchups.',
  'Duel Analysis': 'How a five-deck duel collection holds up across the field.',
  'Deck Counter': 'What beats a given deck, and what it beats in turn.',
  'Win Conditions': 'Every win condition, how often it shows up and how well it does.',
  Cards: 'Usage, win rate and pairings for all 122 cards.',
  Champions: 'The eight Champions and the decks built around them.',
  Evolutions: 'Every Evolution, its slot competition and its impact.',
};

const POPULAR_TAGS = ['#QJ2L8VR', '#8G9UCG', '#LYPR9LQC', '#2P8R88', '#UVC8GJ'] as const;

/* The three built pages, reachable from the panel as well as the top bar. */
const FEATURES = [
  {
    icon: SwordsIcon,
    title: 'Duel Builder',
    body: 'Five decks, forty unique cards, Evo / Hero / Wild slots enforced.',
    hash: '#/builder',
  },
  {
    icon: DeckIcon,
    title: 'Deck Builder',
    body: 'Your collection — unlimited single decks that save themselves.',
    hash: '#/decks',
  },
  {
    icon: PaletteIcon,
    title: 'Counter Palette',
    body: 'Archetype folders keeping every counter deck filed and filterable.',
    hash: '#/palette',
  },
] as const;

/* Scattered into the panel's four corners rather than stacked on one side. */
const CORNER_CARDS = ['knight', 'archer-queen', 'golden-knight', 'mega-knight'] as const;

function go(hash: string) {
  window.location.hash = hash;
}

export function Dashboard() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [section, setSection] = useState<string>(SIDE_NAV[0].label);
  const [topNav, setTopNav] = useState<string>('Analytics');
  const [tag, setTag] = useState('');

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button type="button" className={styles.brand} onClick={() => go('')}>
          <span className={styles.brandMark}>
            <CrownIcon size={17} />
          </span>
          Royal Arena
        </button>

        <nav className={styles.topNav}>
          {TOP_NAV.map((item) => {
            const Icon = item.icon;
            const active = topNav === item.label;
            return (
              <button
                key={item.label}
                type="button"
                className={`${styles.topNavItem} ${active ? styles.topNavItemActive : ''}`}
                onClick={() => {
                  setTopNav(item.label);
                  if (item.hash) go(item.hash);
                }}
              >
                <Icon />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
          <button type="button" className={styles.iconButton} aria-label="Notifications">
            <BellIcon />
          </button>
          <ProfileMenu triggerClassName={styles.avatar} />
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <span className={styles.sideLabel}>Analytics</span>

          <nav className={styles.sideNav}>
            {SIDE_NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.label;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`${styles.sideItem} ${active ? styles.sideItemActive : ''}`}
                  aria-current={active || undefined}
                  onClick={() => setSection(item.label)}
                >
                  <span className={styles.sideIcon}>
                    <Icon />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className={styles.proCard}>
            <span className={styles.proTitle}>
              <span className={styles.proMark}>
                <CrownIcon size={14} />
              </span>
              Royal Pro
            </span>
            <p className={styles.proBody}>Unlock exclusive analytics &amp; more.</p>
            <button type="button" className={styles.proButton}>
              Upgrade Now
              <StarIcon />
            </button>
          </div>
        </aside>

        <main className={styles.main}>
          {section === 'Search Player' ? (
            <section className={styles.hero}>
              {/* Wrapper so the corner cards are positioned against the search
                  area only — against the whole panel the bottom two were being
                  cut off by the features strip. */}
              <div className={styles.heroBody}>
                <div className={styles.corners} aria-hidden="true">
                  {CORNER_CARDS.map((key, i) => (
                    <img
                      key={key}
                      src={getCardIconUrl(key)}
                      alt=""
                      draggable={false}
                      className={`${styles.cornerCard} ${styles[`corner${i + 1}`]}`}
                    />
                  ))}
                </div>

                <div className={styles.heroScroll}>
                <div className={styles.heroInner}>
                  <span className={styles.heroBadge}>
                    <AnalyticsIcon size={13} />
                    Analysis
                  </span>

                  <h1 className={styles.heroTitle}>
                    Search. Analyze. <span className={styles.heroTitleAccent}>Dominate.</span>
                  </h1>

                  <p className={styles.heroSub}>
                    Search any player and uncover powerful insights.
                    <br />
                    Deck stats, win rates, counters and more.
                  </p>

                  <form className={styles.searchRow} onSubmit={(e) => e.preventDefault()}>
                    <span className={styles.searchIcon}>
                      <SearchIcon size={19} />
                    </span>
                    <input
                      className={styles.searchInput}
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder="Enter player tag..."
                      spellCheck={false}
                      aria-label="Player tag"
                    />
                    <button type="submit" className={styles.analyzeButton}>
                      Analyze
                      <ArrowRightIcon />
                    </button>
                  </form>

                  <div className={styles.popular}>
                    <span className={styles.popularLabel}>Popular players</span>
                    <div className={styles.popularTags}>
                      {POPULAR_TAGS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={styles.tagChip}
                          onClick={() => setTag(t)}
                        >
                          <SearchIcon size={13} />
                          {t}
                        </button>
                      ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.features}>
                {FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.title}
                      type="button"
                      className={styles.feature}
                      onClick={() => go(f.hash)}
                    >
                      <span className={styles.featureIcon}>
                        <Icon />
                      </span>
                      <span className={styles.featureText}>
                        <span className={styles.featureTitle}>
                          {f.title}
                          <ArrowRightIcon size={14} />
                        </span>
                        <span className={styles.featureBody}>{f.body}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <SectionPanel name={section} />
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Placeholder for a section that has no data behind it yet. It is a real
 * scrolling panel rather than an empty div so the shell's behaviour — header
 * stays, body scrolls — is already correct when the content arrives.
 */
function SectionPanel({ name }: { name: string }) {
  const item = SIDE_NAV.find((s) => s.label === name);
  const Icon = item?.icon ?? BarsIcon;

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <span className={styles.panelIcon}>
          <Icon size={19} />
        </span>
        <div className={styles.panelHeadText}>
          <h1 className={styles.panelTitle}>{name}</h1>
          <p className={styles.panelBlurb}>{SECTION_BLURB[name]}</p>
        </div>
      </header>

      <div className={styles.panelScroll}>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className={styles.placeholderRow}>
            <span className={styles.placeholderRank}>{i + 1}</span>
            <span className={styles.placeholderBar} data-w={i % 4} />
          </div>
        ))}
        <p className={styles.panelNote}>
          No data wired up yet — this is the scrolling shell for {name}.
        </p>
      </div>
    </section>
  );
}
