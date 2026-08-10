import { useEffect, useState } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { Header } from '../Header/Header';
import { DuelDeckBuilder } from '../DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from '../DecksHome/DecksHome';
import { CounterPalette } from '../CounterPalette/CounterPalette';
import { PlayerAnalysis } from '../Analytics/PlayerAnalysis';
import { SEASONS } from '../Analytics/playerData';
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

/* The post-login shell: top bar, a sidebar of analytics sections, and a panel
 * that swaps with whatever is open.
 *
 * The three built tools open inside this panel rather than navigating away to
 * their own pages, so the chrome stays put and only the content scrolls. Each
 * is rendered `embedded`, which drops the page nav it used to carry — the top
 * bar already provides the brand, theme toggle and profile menu. */

export type DashboardView = 'home' | 'builder' | 'decks' | 'palette' | 'player';

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

/* The three built tools, as full panels down the home screen. */
const FEATURES = [
  {
    icon: SwordsIcon,
    kicker: 'Royal Duels',
    title: 'The duel deck forge',
    body: 'Build all five battle decks side by side. Evolution, Hero and Wild slots are enforced by position, so an illegal lineup is impossible.',
    chips: ['Up to 5 decks · 40 cards', 'Evo · Hero · Wild', 'Live elixir stats'],
    cta: 'Open Duel Builder',
    hash: '#/builder',
    art: ['knight', 'archer-queen', 'golden-knight'],
  },
  {
    icon: DeckIcon,
    kicker: "Deck's Home",
    title: 'Your collection hall',
    body: 'A home for every deck you dream up — unlimited single decks that save themselves, each with the same slot rules as a duel deck.',
    chips: ['Unlimited decks', 'Auto-saving', 'Win-condition filter'],
    cta: 'Open Deck Builder',
    hash: '#/decks',
    art: ['mega-knight', 'golden-knight', 'bandit'],
  },
  {
    icon: PaletteIcon,
    kicker: 'Counter Palette',
    title: 'The archetype armory',
    body: 'Sort your arsenal into folders, one per archetype you face. Every counter deck stays filed, filterable and ready to deploy.',
    chips: ['Unlimited folders', 'Decks by archetype', 'Auto-saving'],
    cta: 'Open Counter Palette',
    hash: '#/palette',
    art: ['pekka', 'inferno-tower', 'skeleton-army'],
  },
] as const;

/* Scattered into the panel's four corners rather than stacked on one side. */
const CORNER_CARDS = ['knight', 'archer-queen', 'golden-knight', 'mega-knight'] as const;

function go(hash: string) {
  window.location.hash = hash;
}

export function Dashboard({
  view = 'home',
  playerTag = '',
}: {
  view?: DashboardView;
  playerTag?: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [section, setSection] = useState<string>(SIDE_NAV[0].label);
  const [tag, setTag] = useState('');
  // The analysis screen carries the query in the top bar, seeded from the URL.
  const [topTag, setTopTag] = useState(playerTag);
  const [season, setSeason] = useState<string>(SEASONS[0]);

  // Navigating to another tag (a popular chip, a fresh search) has to move the
  // field with it — the component does not remount on a hash change.
  useEffect(() => {
    if (playerTag) setTopTag(playerTag);
  }, [playerTag]);

  // The open tool decides which top-bar item is lit; on the home view it is
  // whichever analytics area the sidebar has selected.
  const topNav =
    view === 'builder'
      ? 'Duel Builder'
      : view === 'decks'
        ? 'Deck Builder'
        : view === 'palette'
          ? 'Counter Palette'
          : 'Analytics';

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button type="button" className={styles.brand} onClick={() => go('')}>
          <span className={styles.brandMark}>
            <CrownIcon size={17} />
          </span>
          Royal Arena
        </button>

        {view === 'player' ? (
          <div className={styles.topQuery}>
            <span className={styles.topScope}>
              <AnalyticsIcon size={15} />
              Analytics
            </span>
            <form
              className={styles.topSearch}
              onSubmit={(e) => {
                e.preventDefault();
                if (topTag.trim()) go(`#/player/${encodeURIComponent(topTag.trim())}`);
              }}
            >
              <span className={styles.topSearchIcon}>
                <SearchIcon size={16} />
              </span>
              <input
                className={styles.topSearchInput}
                value={topTag}
                onChange={(e) => setTopTag(e.target.value)}
                placeholder="Enter player tag..."
                aria-label="Player tag"
                spellCheck={false}
              />
              <button type="submit" className={styles.topSearchButton}>
                Search
              </button>
            </form>
            <label className={styles.topSeason}>
              <span className="sr-only">Season</span>
              <select
                className={styles.topSeasonSelect}
                value={season}
                onChange={(e) => setSeason(e.target.value)}
              >
                {SEASONS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
        <nav className={styles.topNav}>
          {TOP_NAV.map((item) => {
            const Icon = item.icon;
            const active = topNav === item.label;
            return (
              <button
                key={item.label}
                type="button"
                className={`${styles.topNavItem} ${active ? styles.topNavItemActive : ''}`}
                onClick={() => go(item.hash ?? '')}
              >
                <Icon />
                {item.label}
              </button>
            );
          })}
        </nav>
        )}

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
              const active =
                view === 'player' ? item.label === 'Top 10 Decks' : section === item.label;
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
          {view === 'player' ? (
            <PlayerAnalysis tag={playerTag} />
          ) : view !== 'home' ? (
            /* A built tool, hosted in the panel. `.tool` gives it the same
               raised surface as everything else and clips its own scrolling
               region to the rounded corners. */
            <section className={styles.tool}>
              {view === 'builder' && (
                <>
                  <Header embedded />
                  <DuelDeckBuilder />
                </>
              )}
              {view === 'decks' && <DecksHome embedded />}
              {view === 'palette' && <CounterPalette embedded />}
            </section>
          ) : section === 'Search Player' ? (
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

                  <form
                    className={styles.searchRow}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const t = tag.trim();
                      if (t) go(`#/player/${encodeURIComponent(t)}`);
                    }}
                  >
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
                          onClick={() => go(`#/player/${encodeURIComponent(t)}`)}
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

            </section>
          ) : (
            <SectionPanel name={section} />
          )}

          {/* Full-size panels for the built tools, and a grid for the analytics
              areas. They live below the hero so the home screen scrolls, which
              is where the one-line strip fell short. */}
          {view === 'home' && section === 'Search Player' && (
            <>
              <section className={styles.blockHead}>
                <h2 className={styles.blockTitle}>Your tools</h2>
                <p className={styles.blockSub}>Everything built so far — open any of them.</p>
              </section>

              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.kicker}
                    type="button"
                    className={`${styles.toolPanel} ${i % 2 === 1 ? styles.toolPanelFlip : ''}`}
                    onClick={() => go(f.hash)}
                  >
                    <span className={styles.toolText}>
                      <span className={styles.toolKicker}>
                        <Icon size={14} />
                        {f.kicker}
                      </span>
                      <span className={styles.toolTitle}>{f.title}</span>
                      <span className={styles.toolBody}>{f.body}</span>
                      <span className={styles.toolChips}>
                        {f.chips.map((c) => (
                          <span key={c} className={styles.toolChip}>
                            {c}
                          </span>
                        ))}
                      </span>
                      <span className={styles.toolCta}>
                        {f.cta}
                        <ArrowRightIcon size={15} />
                      </span>
                    </span>

                    <span className={styles.toolArt} aria-hidden="true">
                      {f.art.map((key, n) => (
                        <img
                          key={key}
                          src={getCardIconUrl(key)}
                          alt=""
                          draggable={false}
                          className={`${styles.toolArtCard} ${styles[`toolArt${n + 1}`]}`}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}

              <section className={styles.blockHead}>
                <h2 className={styles.blockTitle}>Analytics</h2>
                <p className={styles.blockSub}>
                  Every area from the sidebar — pick one to open it here.
                </p>
              </section>

              <div className={styles.areaGrid}>
                {SIDE_NAV.filter((s) => s.label !== 'Search Player').map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className={styles.areaCard}
                      onClick={() => setSection(item.label)}
                    >
                      <span className={styles.areaIcon}>
                        <Icon size={19} />
                      </span>
                      <span className={styles.areaTitle}>
                        {item.label}
                        <ArrowRightIcon size={14} />
                      </span>
                      <span className={styles.areaBody}>{SECTION_BLURB[item.label]}</span>
                    </button>
                  );
                })}
              </div>
            </>
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
