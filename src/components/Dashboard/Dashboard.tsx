import { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { getCardIconUrl } from '../../data/cards';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { Header } from '../Header/Header';
import { DuelDeckBuilder } from '../DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from '../DecksHome/DecksHome';
import { CounterPalette } from '../CounterPalette/CounterPalette';
import { PlayerAnalysis } from '../Analytics/PlayerAnalysis';
import { DuelAnalysis } from '../Analytics/DuelAnalysis';
import { DuelZone } from '../Analytics/DuelZone';
import { MetaDecks } from '../Analytics/MetaDecks';
import { CoachAssist } from '../Analytics/CoachAssist';
import { PlayerCards } from '../Analytics/PlayerCards';
import { DeckCounter } from '../Analytics/DeckCounter';
import { DeckLab } from '../Analytics/DeckLab';
import { CounterLab } from '../Analytics/CounterLab';
import { GlobalCards } from '../Analytics/GlobalCards';
import { ProLock } from '../Analytics/ProLock';
import { PrintButton } from '../Export/PrintButton';
import { ProContact } from '../Analytics/ProContact';
import { SEASONS, type Season } from '../Analytics/playerData';
import { SeasonMenu } from '../Analytics/SeasonMenu';
import { fetchSuggestedTags } from '../../state/analyticsClient';
import { useReveal } from '../../hooks/useReveal';
import { ClosingBand } from './ClosingBand';
import {
  AnalyticsIcon,
  ArrowRightIcon,
  BarsIcon,
  BellIcon,
  CardsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  DeckIcon,
  HomeIcon,
  LoadoutIcon,
  MoonIcon,
  PaletteIcon,
  PieIcon,
  SearchIcon,
  ShieldIcon,
  CoachIcon,
  StarIcon,
  SunIcon,
  SwordsIcon,
} from './icons';
import styles from './Dashboard.module.css';
import { Fireflies } from '../../three/Fireflies';

/* The post-login shell: top bar, a sidebar of analytics sections, and a panel
 * that swaps with whatever is open.
 *
 * The three built tools open inside this panel rather than navigating away to
 * their own pages, so the chrome stays put and only the content scrolls. Each
 * is rendered `embedded`, which drops the page nav it used to carry — the top
 * bar already provides the brand, theme toggle and profile menu. */

export type DashboardView = 'home' | 'builder' | 'decks' | 'palette' | 'player';

/* The home route is `#/`, not the empty string.
 *
 * `location.hash = ''` strips the fragment rather than setting one, which took
 * the URL from `#/decks` to a bare path — and then the NEXT attempt to go home
 * was a no-op, because assigning '' to an already-absent hash changes nothing
 * and fires no `hashchange`. An explicit `#/` matches none of the route
 * prefixes, so it still resolves to the home view, and it is a real value that
 * can be compared and navigated away from. */
const HOME = '#/';

/* `hash` is where the item navigates. `home: true` means the item does not just
 * move the URL — it also resets which analytics area is open, which is the
 * difference between "go to the home route" and "go home". See `goHome`. */
const TOP_NAV = [
  { label: 'Home', icon: HomeIcon, hash: HOME, home: true },
  /* Analytics does not navigate anywhere — every analytics area already lives
     on the home screen. It goes home and then SCROLLS to the Analytics block,
     which is what "take me to analytics" means from a tool page and, more
     importantly, from the home screen itself, where moving the URL to the route
     it is already on was a no-op that looked like a dead button. */
  { label: 'Analytics', icon: AnalyticsIcon, hash: HOME, home: false, scrollTo: 'analytics' },
  { label: 'Deck Vault', icon: DeckIcon, hash: '#/decks', home: false },
  { label: 'Duel Builder', icon: SwordsIcon, hash: '#/builder', home: false },
  { label: 'Counter Hub', icon: PaletteIcon, hash: '#/palette', home: false },
  /* Meta is a top-level destination now rather than a sidebar row. It is about
     the whole player base, so it never belonged among a player's own sections —
     it was already home-only, and this is the same rule stated in the nav. */
  { label: 'Meta', icon: BarsIcon, hash: HOME, home: false, section: 'Top Meta Decks' },
] as const;

/* `slug` is the section's place in the URL once a tag is loaded
   (`#/player/<tag>/duels`), so every analytics screen is linkable and survives
   a refresh. 'Top 10 Decks' is the landing section and owns the bare path.
 *
 * `hue` is the section's identity colour, worn only by its small icon tile.
 * It cycles violet → blue → pink → green in fixed order; because every tile
 * sits directly beside its own label, a repeat across nine sections carries no
 * ambiguity. This is decoration with a job — it makes an area recognisable at
 * a glance — and it is deliberately NOT the selected state, which is always
 * violet regardless of the row's identity hue. */
const SIDE_NAV = [
  { label: 'Search Player', icon: SearchIcon, slug: '', hue: 'violet' },
  { label: 'Top Meta Decks', icon: BarsIcon, slug: 'meta', hue: 'blue' },
  { label: 'Deck Analysis', icon: PieIcon, slug: 'decks', hue: 'pink' },
  { label: 'Duel Analysis', icon: SwordsIcon, slug: 'duels', hue: 'green' },
  { label: 'Duel Zone', icon: LoadoutIcon, slug: 'duelzone', hue: 'violet' },
  { label: 'Cards', icon: CardsIcon, slug: 'cards', hue: 'blue' },
  { label: 'Deck Counter', icon: ShieldIcon, slug: 'counter', hue: 'pink' },
  { label: 'Coach Assist', icon: CoachIcon, slug: 'coach', hue: 'green' },
] as const;

/* Win Conditions, Champions and Evolutions were sidebar sections and are now
   TABS on the Cards screen. They were never separate screens — each is a way of
   looking at the same card list, and three shells that would have rendered the
   same board with one filter pre-applied is three places to keep in step. */

const SECTION_BLURB: Record<string, string> = {
  'Top Meta Decks': 'What the whole player base is running, ranked by use rate.',
  'Deck Analysis': 'Break a deck down: elixir curve, cycle, role coverage and matchups.',
  'Duel Analysis': 'How a five-deck duel collection holds up across the field.',
  'Duel Zone': 'Recent Bo3 and Bo5 series, and which decks follow each opener.',
  'Deck Counter': 'What beats this player, a head-to-head between two decks, and what answers a given deck.',
  'Coach Assist': 'Mid-duel help: what they will bring next, and which of your decks answers it.',
  Cards: 'Use rate and win rate for all 122 cards, filtered how you like — win conditions, champions, evolutions, rarity, elixir.',
};

/* Filled from the database at runtime — hardcoded tags would 404 on click. */
const FALLBACK_TAGS = ['#9GJ0Q0LGG', '#U2YVYGGV2', '#L8GVPJ900'];

/* The three built tools, as full panels down the home screen.
 *
 * `hue` is the tool's identity, worn by its kicker chip and its CTA. Three
 * identical pink buttons stacked down one page said nothing about which tool
 * each opened; a hue per tool does. This is identity colour, not action colour
 * — Analyze stays pink because it is the one genuine primary action here. */
const FEATURES = [
  {
    hue: 'violet',
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
    hue: 'green',
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
    hue: 'blue',
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

function go(hash: string) {
  const next = hash || HOME;
  if (window.location.hash !== next) window.location.hash = next;
}

export function Dashboard({
  view = 'home',
  playerTag = '',
  playerSection = '',
}: {
  view?: DashboardView;
  playerTag?: string;
  /** Slug from the URL — which analytics screen is open for the loaded tag. */
  playerSection?: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  /* The analytics rail collapses.
   *
   * It costs 236px plus a gutter on every screen, and on the dense boards —
   * a 122-card grid, a matchup table carrying eight card images per row —
   * that is the difference between tiles you squint at and tiles you read.
   *
   * The state is mirrored onto `<html data-rail>` rather than kept private to
   * this component, on the same reasoning as `data-theme`: a screen that wants
   * to spend the reclaimed width on BIGGER elements rather than more of them
   * needs to know, and a CSS module cannot see a parent's class from another
   * file. See the card grid in PlayerCards.module.css for the one that does.
   *
   * Persisted, because a collapsed rail is a working preference and having it
   * spring back on every reload is the kind of thing that makes people stop
   * using the control. */
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem('royal-rail') !== 'closed';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    document.documentElement.dataset.rail = railOpen ? 'open' : 'closed';
    try {
      localStorage.setItem('royal-rail', railOpen ? 'open' : 'closed');
    } catch {
      /* private mode — the rail still works, it just will not be remembered */
    }
  }, [railOpen]);
  /* One per band down the home screen. Declared unconditionally — the home view
     is a branch further down this render, and a hook cannot live inside it. */
  const toolsReveal = useReveal<HTMLDivElement>();
  const areasReveal = useReveal<HTMLDivElement>();
  const [section, setSection] = useState<string>(SIDE_NAV[0].label);
  const [tag, setTag] = useState('');
  // The analysis screen carries the query in the top bar, seeded from the URL.
  const [topTag, setTopTag] = useState(playerTag);
  const [season, setSeason] = useState<string>(SEASONS[0]);
  /* ⌘K / Ctrl-K focuses the tag search from anywhere. Registered here rather
     than on the input because the point is to reach it without finding it. */
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        findRef.current?.focus();
        findRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /* The sidebar's Upgrade Now and the gate's Subscribe are the same intent, so
     they open the same thing. This one had no handler at all — a button that
     does nothing is worse than no button. */
  const [proContact, setProContact] = useState(false);

  // Navigating to another tag (a popular chip, a fresh search) has to move the
  // field with it — the component does not remount on a hash change.
  useEffect(() => {
    if (playerTag) setTopTag(playerTag);
  }, [playerTag]);

  // Real tags with the most stored battles, so a chip always resolves. Falls
  // back to a known-good handful if the service is not running.
  const [popular, setPopular] = useState<string[]>(FALLBACK_TAGS);
  useEffect(() => {
    let live = true;
    fetchSuggestedTags()
      .then((r) => live && r.tags.length && setPopular(r.tags.map((t) => t.tag)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /* The meta board is about the whole player base rather than one player, so it
   * needs no tag and belongs to the home sidebar only. Once a tag is loaded the
   * sidebar lists that player's own sections, and a board about everybody is
   * not one of them. The `#/player/<tag>/meta` route still renders it, so links
   * already out there keep working. */
  /* Two sections belong to the HOME sidebar only, for opposite reasons.
   *
   * Top Meta Decks is about the whole player base rather than the loaded
   * player, so once a tag is open it is not one of that player's sections.
   *
   * Deck Analysis is the other way round: the home version is a real screen —
   * paste a deck, get its curve and its matchups — while `#/player/<tag>/decks`
   * was only ever the placeholder shell, twelve grey bars and a note saying no
   * data was wired up. Offering it beside six screens that DO have data is
   * offering a dead end. Both routes still render, so existing links keep
   * working; neither is advertised any more. */
  const sideNav =
    view === 'player'
      ? SIDE_NAV.filter((s) => s.slug !== 'meta' && s.slug !== 'decks')
      : SIDE_NAV;

  /* THE LANDING STATE: home route, nothing picked, no player loaded.
   * It is the only state with no subject — every analytics area needs a tag
   * before it can say anything — which is why it is also the only state that
   * gets the full width and no rail. Opening an area, or loading a tag, is
   * leaving it. */
  const landing = view === 'home' && section === 'Search Player';

  /* "Go home" is two things, and only one of them was wired.
   *
   * Which screen the home view shows is `section`, a piece of component state
   * the sidebar and the area cards both write to. So after opening, say, Deck
   * Counter and then clicking Home or the brand, the URL went home and the
   * panel did not — `section` was still pointing at the area you had just left,
   * and you landed back on it. The route was never the broken half.
   *
   * Resetting the section is therefore part of going home, not a side effect of
   * it, and both the brand and the Home item call the same function. */
  const goHome = () => {
    setSection(SIDE_NAV[0].label);
    go(HOME);
  };

  /* "Take me to analytics" is TWO things, the same way going home was: the home
   * screen has to be showing, and the page has to be back at the top of it,
   * where the player-tag field and the Analyze button are. Only the first was
   * ever wired, and on the home screen even that was a no-op — `go(HOME)` when
   * the hash is already `#/` changes nothing and fires no `hashchange`, so the
   * button did nothing at all from the one place people press it most.
   *
   * It scrolls to the TOP rather than down to the area grid: the areas are
   * reachable from the rail on every screen, but the search field is the one
   * thing this button is pressed to get back to.
   *
   * The scroll waits two frames because from any other view the home screen is
   * not mounted yet when this runs — the first frame commits it, the second
   * finds a scroller with something in it. */
  const goAnalytics = () => {
    setSection(SIDE_NAV[0].label);
    go(HOME);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const main = document.querySelector('main');
        if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
        document
          .getElementById('player-search')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  // The open tool decides which top-bar item is lit; on the home view that is
  // Home when the landing search is showing and Analytics once an area is.
  const topNav =
    view === 'builder'
      ? 'Duel Builder'
      : view === 'decks'
        ? 'Deck Vault'
        : view === 'palette'
          ? 'Counter Hub'
          : view === 'player' || view !== 'home'
            ? 'Analytics'
            : section === 'Top Meta Decks'
              ? 'Meta'
              : section === SIDE_NAV[0].label
                ? 'Home'
                : 'Analytics';

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.brand}
          onClick={goHome}
          title="Back to the home screen"
        >
          <span className={styles.brandMark}>
            <CrownIcon size={17} />
          </span>
          DEKKIES
        </button>

        {/* The nav NEVER goes away. It used to be swapped out for the player
            query row, which left every analysis screen with no way to reach
            Deck Vault, Duel Builder or Counter Hub without going home first —
            the same half-wired navigation the Home button was caught by. The
            query row moved into the panel, where the thing it queries is. */}
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
                  if ('scrollTo' in item) return goAnalytics();
                  if ('section' in item) {
                    setSection(item.section);
                    return go(HOME);
                  }
                  return item.home ? goHome() : go(item.hash);
                }}
              >
                <Icon />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className={styles.topActions}>
          {/* The tag search lives in the CHROME now, not only on the landing
              section. It was reachable from two places — the hero, and a row
              that replaced the whole nav once a player was open — so from a
              deck screen there was no way to look someone up without going
              home first. Here it is on every screen, and ⌘K focuses it. */}
          <form
            className={styles.topFind}
            onSubmit={(e) => {
              e.preventDefault();
              const t = topTag.trim();
              if (t) go(`#/player/${encodeURIComponent(t)}`);
            }}
          >
            <input
              ref={findRef}
              className={styles.topFindInput}
              value={topTag}
              onChange={(e) => setTopTag(e.target.value)}
              placeholder="Search player tag..."
              aria-label="Search player tag"
              spellCheck={false}
            />
            {/* Was a `<kbd>⌘K</kbd>` hint, and a leading decorative magnifier.
                Now one magnifier that is the SUBMIT control — the form already
                went to `#/player/<tag>`, so pressing it opens the analysis for
                whatever is typed, the same as Enter. The leading icon went with
                the swap: two magnifiers on one field, only one of them
                pressable, is worse than none. The ⌘K shortcut still works and
                is named in the tooltip rather than printed in the field. */}
            <button
              type="submit"
              className={styles.topFindGo}
              aria-label="Analyze this player tag"
              title="Analyze this player tag  (⌘K / Ctrl-K to focus)"
            >
              <SearchIcon size={15} />
            </button>
          </form>

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

      <div
        className={styles.body}
        data-rail={railOpen ? 'open' : 'closed'}
        data-landing={landing || undefined}
      >
        {/* THE RAIL IS NOT PART OF THE LANDING SCREEN.
            A sidebar of a player's analytics areas before there is a player is
            navigation to seven screens that all say "search for someone first",
            and it costs the hero a quarter of its width. The same seven areas
            are on the landing as a grid of blocks under the search, which is
            where they can be sized and described; the rail comes back the
            moment a tag is loaded, where it is genuinely navigation. */}
        {!landing && (
          <>
            {/* Rides the rail's right edge, and stays put against the screen edge
                once the rail is gone — a control that hides itself along with the
                thing it hides is a control you cannot undo. */}
            <button
              type="button"
              className={styles.railToggle}
              onClick={() => setRailOpen((o) => !o)}
              aria-expanded={railOpen}
              aria-label={railOpen ? 'Hide the sidebar' : 'Show the sidebar'}
              title={railOpen ? 'Hide the sidebar' : 'Show the sidebar'}
            >
              {railOpen ? <ChevronLeftIcon size={15} /> : <ChevronRightIcon size={15} />}
            </button>

            <aside className={styles.sidebar} aria-hidden={!railOpen}>
          <span className={styles.sideLabel}>Analytics</span>

          <nav className={styles.sideNav}>
            {sideNav.map((item) => {
              const Icon = item.icon;
              const active =
                view === 'player' ? item.slug === playerSection : section === item.label;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`${styles.sideItem} ${active ? styles.sideItemActive : ''}`}
                  data-hue={item.hue}
                  aria-current={active || undefined}
                  onClick={() => {
                    // With a tag loaded the sidebar is navigation, so it moves
                    // the URL; without one it just picks which area the home
                    // screen shows.
                    if (view === 'player' && item.slug !== null) {
                      const base = `#/player/${encodeURIComponent(playerTag)}`;
                      go(item.slug ? `${base}/${item.slug}` : base);
                    } else {
                      setSection(item.label);
                      if (view !== 'home') go(HOME);
                    }
                  }}
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
              Dekkies Pro
            </span>
            <p className={styles.proBody}>Unlock exclusive analytics &amp; advanced features.</p>
            <button
              type="button"
              className={styles.proButton}
              onClick={() => setProContact(true)}
            >
              Upgrade Now
              <StarIcon />
            </button>
          </div>
            </aside>
          </>
        )}

        <main className={styles.main}>
          {/* The query row: the tag, the season and the panel actions, sitting
              directly above the screen they drive rather than up in the chrome. */}
          {view === 'player' && (
            <div className={styles.topQuery}>
              {/* The analysis screen swaps the whole nav out for this query row,
                  which left the player view with NO Home control at all — the
                  brand was the only way back and nothing said so. This chip used
                  to be a static "Analytics" label, decoration restating the
                  screen you were already looking at; it is now the way out. */}
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
              <div className={styles.topSeason}>
                <SeasonMenu value={season as Season} onChange={(s) => setSeason(s)} />
                {/* Export sits in the SHELL rather than in each analytics
                    component, so every section gets it — Duel Analysis, Duel
                    Zone, Cards, Deck Counter, Coach Assist, Meta and Player
                    Analysis alike — from one place, in one position, with no
                    chance of a screen being forgotten. It prints whatever the
                    section below has rendered. */}
                <PrintButton />
              </div>
            </div>
          )}

          {view === 'player' ? (
            playerSection === 'duels' ? (
              <DuelAnalysis tag={playerTag} season={season as Season} />
            ) : playerSection === 'duelzone' ? (
              <DuelZone tag={playerTag} season={season as Season} />
            ) : playerSection === 'cards' ? (
              <PlayerCards tag={playerTag} season={season as Season} />
            ) : playerSection === 'counter' ? (
              <DeckCounter tag={playerTag} season={season as Season} />
            ) : playerSection === 'coach' ? (
              <CoachAssist tag={playerTag} />
            ) : playerSection === 'meta' ? (
              <MetaDecks />
            ) : playerSection ? (
              <SectionPanel
                name={
                  SIDE_NAV.find((s) => s.slug === playerSection)?.label ?? 'Top Meta Decks'
                }
              />
            ) : (
              <PlayerAnalysis tag={playerTag} season={season as Season} />
            )
          ) : view === 'home' && section !== 'Search Player' ? (
            <HomeSection name={section} />
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
            /* The scroll target for the top bar's Analytics item — the field
               and the Analyze button are what it is pressed to get back to. */
            <section className={styles.hero} id="player-search">
              <div className={styles.heroBody}>
                <div className={styles.heroScroll}>
                  {/* Copy left, character right. The four corner cards that used
                      to sit behind this are gone: the panel now carries the
                      castle backdrop, which already supplies the depth they were
                      there for, and four opaque cards would compete with the one
                      figure the composition is built around. */}
                  <div className={styles.heroInner}>
                    <div className={styles.heroCopy}>
                      {/* The "Analysis" eyebrow badge is gone. It sat above a
                          headline that already reads "Search. Analyze.
                          Dominate." over a sub-line naming deck stats, win rates
                          and counters — a label restating the thing directly
                          under it, which is the same call the two removed grid
                          headings got. */}
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
                          {popular.map((t) => (
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

                    <Fireflies />

                    <div className={styles.heroFigure} aria-hidden="true">
                      <img
                        className={styles.heroKing}
                        src={`${import.meta.env.BASE_URL}assets/background/king.webp`}
                        alt=""
                        draggable={false}
                        /* Eager: it is the largest paint in the first screen, so
                           deferring it only guarantees the hero pops in late.
                           NOT `fetchPriority` — that prop landed in React 19 and
                           this is React 18, where it falls through to the DOM as
                           an unrecognised attribute and warns on every render. */
                        loading="eager"
                        decoding="async"
                      />
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
              {/* One reveal per BAND, not per card: the heading and the panels
                  it introduces are one thought and arrive together. `.band`
                  carries the same gap `.main` does, so wrapping changes the
                  grouping without changing the spacing. */}
              <div className={styles.band} ref={areasReveal}>
              {/* NO HEADING. The seven blocks below each carry their own name on
                  a painted tile and a sentence saying what they do, so a heading
                  reading "Analytics" above them and a line telling the reader to
                  pick one restated what the grid already showed.

                  `id` moved onto the grid itself — it is the scroll target for
                  the top bar's Analytics item, and deleting the element that
                  carried it would have quietly turned that control back into
                  the no-op it used to be. */}
              <div className={styles.areaGrid} id="analytics-areas">
                {SIDE_NAV.filter((s) => s.label !== 'Search Player').map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className={styles.areaCard}
                      data-hue={item.hue}
                      onClick={() => setSection(item.label)}
                    >
                      <span className={styles.areaIcon}>
                        <Icon size={19} />
                      </span>
                      <span className={styles.areaTitle}>{item.label}</span>
                      <span className={styles.areaBody}>{SECTION_BLURB[item.label]}</span>
                      {/* Its own row at the foot of the block rather than
                          trailing the title, so a row of blocks lands its
                          arrows on one baseline whatever the blurb runs to. */}
                      <span className={styles.areaArrow} aria-hidden="true">
                        <ArrowRightIcon size={15} />
                      </span>
                    </button>
                  );
                })}
              </div>
              </div>

              {/* Also unheaded, for the same reason: each tool panel already
                  carries its own kicker, title and description. */}
              <div className={styles.band} ref={toolsReveal}>
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.kicker}
                    type="button"
                    className={`${styles.toolPanel} ${i % 2 === 1 ? styles.toolPanelFlip : ''}`}
                    data-hue={f.hue}
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
              </div>

              {/* Ends the page: what the numbers rest on, and a real chart of
                  the card set — counted at render time, never asserted. */}
              <ClosingBand />
            </>
          )}
        </main>
      </div>

      {proContact && <ProContact onClose={() => setProContact(false)} />}
    </div>
  );
}

/* The three areas that need a loaded player to say anything at all. They are
 * ALSO the three behind the Royal Pro gate on the home screen, and that is not
 * a coincidence — a duel series log, a combination board and a mid-duel coach
 * are the deep end of this product, and they are what a subscription is for.
 *
 * The gate is on the home screen only. `#/player/<tag>/duels` and friends still
 * render in full, so nothing that already worked stopped working. */
const PRO_SECTIONS: Record<string, { blurb: string; perks: string[] }> = {
  'Duel Analysis': {
    blurb:
      'Which card pairings actually carry a player’s duel play, split by game 1, 2 and 3 — with the evidence floors that stop one heavily-played deck being sliced twenty-four ways.',
    perks: ['Pair board across every duel', 'G1 / G2 / G3 split', 'Wilson confidence on every row'],
  },
  'Duel Zone': {
    blurb:
      'Every Bo3 and Bo5 series a player has run, reconstructed game by game — and which decks follow each opener, ranked by how often they actually travel together.',
    perks: ['The full series log', 'Deck sequence prediction', 'Card-legal loadouts only'],
  },
  'Coach Assist': {
    blurb:
      'Mid-duel help: what they will bring next given what they have shown, and which of your decks answers it — scored on real matchup evidence, not a rating.',
    perks: ['Opening-deck prediction', 'Your best answer, ranked', 'Their real three-deck loadouts'],
  },
};

/** What a home-screen analytics area renders. */
function HomeSection({ name }: { name: string }) {
  if (name === 'Top Meta Decks') return <MetaDecks />;
  if (name === 'Deck Analysis') return <DeckLab />;
  if (name === 'Deck Counter') return <CounterLab />;
  if (name === 'Cards') return <GlobalCards />;

  const pro = PRO_SECTIONS[name];
  if (pro) {
    return (
      /* The gate wears the area's own hue — the same one its block on the home
         screen and its row in the sidebar wear — so the colour you pressed is
         the colour you land on. */
      <ProLock
        title={name}
        blurb={pro.blurb}
        perks={pro.perks}
        hue={SIDE_NAV.find((s) => s.label === name)?.hue}
      >
        <SectionPanel name={name} />
      </ProLock>
    );
  }
  return <SectionPanel name={name} />;
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
