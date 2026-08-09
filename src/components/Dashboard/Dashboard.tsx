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
  PieIcon,
  SearchIcon,
  ShieldIcon,
  StarIcon,
  SunIcon,
  SwordsIcon,
  TargetIcon,
  TrendIcon,
} from './icons';
import styles from './Dashboard.module.css';

/* The post-login home: a top bar, a sidebar of analytics sections, and a hero
 * panel. This is layout and navigation only — the sections do not have pages
 * behind them yet, so selecting one just moves the highlight. */

const TOP_NAV = [
  { label: 'Home', icon: HomeIcon, hash: '#/' },
  { label: 'Analytics', icon: AnalyticsIcon, hash: '#/' },
  { label: 'Deck Builder', icon: DeckIcon, hash: '#/decks' },
  { label: 'Duel Builder', icon: SwordsIcon, hash: '#/builder' },
  { label: 'About', icon: InfoIcon, hash: '#/' },
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

const POPULAR_TAGS = ['#QJ2L8VR', '#8G9UCG', '#LYPR9LQC', '#2P8R88', '#UVC8GJ'] as const;

const HIGHLIGHTS = [
  {
    icon: TrendIcon,
    title: 'Deep Insights',
    body: 'Detailed stats and trends tailored for every player.',
  },
  {
    icon: SwordsIcon,
    title: 'Meta Aware',
    body: 'Stay ahead with meta usage and win rates.',
  },
  {
    icon: ShieldIcon,
    title: 'Duel Optimized',
    body: 'Built for Royal Duels. 5 decks. No repeats.',
  },
] as const;

const HERO_CARDS = ['knight', 'archer-queen', 'golden-knight'] as const;

export function Dashboard() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [section, setSection] = useState<string>(SIDE_NAV[0].label);
  const [topNav, setTopNav] = useState<string>('Analytics');
  const [tag, setTag] = useState('');

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => {
            window.location.hash = '';
          }}
        >
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
                  if (item.hash !== '#/') window.location.hash = item.hash;
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
          <section className={styles.hero}>
            <div className={styles.heroInner}>
              <div className={styles.heroText}>
                <span className={styles.heroBadge}>
                  <AnalyticsIcon size={13} />
                  Analysis
                </span>

                <h1 className={styles.heroTitle}>
                  Search. Analyze.
                  <br />
                  <span className={styles.heroTitleAccent}>Dominate.</span>
                </h1>

                <p className={styles.heroSub}>
                  Search any player and uncover powerful insights.
                  <br />
                  Deck stats, win rates, counters and more.
                </p>

                <form
                  className={styles.searchRow}
                  onSubmit={(e) => {
                    e.preventDefault();
                  }}
                >
                  <span className={styles.searchIcon}>
                    <SearchIcon />
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

              <div className={styles.heroArt} aria-hidden="true">
                {HERO_CARDS.map((key, i) => (
                  <img
                    key={key}
                    src={getCardIconUrl(key)}
                    alt=""
                    draggable={false}
                    className={`${styles.heroCard} ${styles[`heroCard${i + 1}`]}`}
                  />
                ))}
              </div>
            </div>

            <div className={styles.highlights}>
              {HIGHLIGHTS.map((h) => {
                const Icon = h.icon;
                return (
                  <div key={h.title} className={styles.highlight}>
                    <span className={styles.highlightIcon}>
                      <Icon />
                    </span>
                    <div className={styles.highlightText}>
                      <span className={styles.highlightTitle}>{h.title}</span>
                      <p className={styles.highlightBody}>{h.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
