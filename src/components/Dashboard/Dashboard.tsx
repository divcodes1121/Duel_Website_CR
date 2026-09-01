import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getCardIconUrl } from '../../data/cards';
import { ProfileMenu } from '../Profile/ProfileMenu';
import { TierBadge } from '../TierBadge/TierBadge';
import { GlassDockNav } from './GlassDockNav';
import { TopSearch } from './TopSearch';
import { Header } from '../Header/Header';
import { DuelDeckBuilder } from '../DuelDeckBuilder/DuelDeckBuilder';
import { DecksHome } from '../DecksHome/DecksHome';
import { CounterPalette } from '../CounterPalette/CounterPalette';
/* EAGER, AND NOT BY CHOICE — `React.lazy` DOES NOT WORK INSIDE THIS SHELL.
 *
 * This screen is the obvious candidate for a split: it is Pro-only, so most
 * visitors literally cannot open it, and it costs 5.4 kB gzip. It was built
 * that way and it did not render — in dev OR in a production build, where the
 * chunk was fetched (both the .js and the .css) and then never committed.
 *
 * The cause is `TopSearch` -> vengenceui's `GooeySearch`, which is in an
 * INFINITE RENDER LOOP: its `items = []` default is a new array on every
 * render and sits in the effect's dependency array
 * (`ui/gooey-search.tsx`), so the effect re-runs, calls `setResults([])`
 * with another new array, and re-renders forever. React logs "Maximum update
 * depth exceeded" continuously. A tree that never settles never commits a
 * resolved Suspense boundary, so any lazy child of the Dashboard hangs at its
 * fallback for good.
 *
 * Proved by removing `<TopSearch>` and rebuilding: `#/teams` rendered
 * immediately with the lazy import untouched. `#/guide` is lazy too and works,
 * because the field book renders OUTSIDE this shell.
 *
 * THE LOOP IS FIXED (see `ui/gooey-search.tsx` deviation 5) AND THIS IS LAZY
 * AGAIN. Measured after the fix: 0 "Maximum update depth" warnings on `#/`,
 * `#/builder`, `#/decks` and `#/teams`, against 130-180 before. The screen is
 * gated, so most visitors cannot open it and should not download it.
 *
 * If it ever goes blank at its fallback again, THAT is the symptom of this
 * loop returning — the boundary never resolving is the tell, not a fault in
 * the screen behind it. */
const TeamAnalysis = lazy(() =>
  import('../Analytics/TeamAnalysis/TeamAnalysis').then((m) => ({ default: m.TeamAnalysis })),
);
import { ReadingState } from '../Analytics/ReadingState';
import { PlayerAnalysis } from '../Analytics/PlayerAnalysis';
import { DuelAnalysis } from '../Analytics/DuelAnalysis';
import { DuelZone } from '../Analytics/DuelZone';
import { MetaDecks } from '../Analytics/MetaDecks';
import { NeedsTag } from '../Analytics/NeedsTag';
import { CoachAssist } from '../Analytics/CoachAssist';
import { PlayerCards } from '../Analytics/PlayerCards';
import { DeckCounter } from '../Analytics/DeckCounter';
import { DeckLab } from '../Analytics/DeckLab';
import { CounterLab } from '../Analytics/CounterLab';
import { GlobalCards } from '../Analytics/GlobalCards';
import { PrintButton } from '../Export/PrintButton';
import { ProContact } from '../Analytics/ProContact';
import { SEASONS, type Season } from '../Analytics/playerData';
import { SeasonMenu } from '../Analytics/SeasonMenu';
import { fetchSuggestedTags } from '../../state/analyticsClient';
import { useReveal } from '../../hooks/useReveal';
import { ClosingBand } from './ClosingBand';
import { RecentBattles } from '../Analytics/RecentBattles';
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
  LogIcon,
  PaletteIcon,
  PieIcon,
  SearchIcon,
  ShieldIcon,
  CoachIcon,
  StarIcon,
  SwordsIcon,
  TeamIcon,
} from './icons';
import styles from './Dashboard.module.css';
import { Fireflies, type FireflyHue } from '../../three/Fireflies';
import { LiquidMetal } from '../../three/LiquidMetal';
import { ThemeToggle } from '../Theme/ThemeToggle';
import { FieldBookButton } from './FieldBookButton';
import { Filmstrip } from '../Filmstrip/Filmstrip';
import { GateCard } from '../Auth/GateCard';
import { sectionAllowed, useAccess } from '../../state/gate';
import { useAccountStore } from '../../state/accountStore';
import { trialDaysLeft } from '../../state/supabase';

/* The post-login shell: top bar, a sidebar of analytics sections, and a panel
 * that swaps with whatever is open.
 *
 * The three built tools open inside this panel rather than navigating away to
 * their own pages, so the chrome stays put and only the content scrolls. Each
 * is rendered `embedded`, which drops the page nav it used to carry — the top
 * bar already provides the brand, theme toggle and profile menu. */

export type DashboardView =
  | 'home'
  | 'builder'
  | 'decks'
  | 'palette'
  | 'teams'
  | 'player';

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
  /* A TOOL, NOT AN ANALYTICS AREA, which is why it is here rather than in
     SIDE_NAV: the rail lists the sections of ONE loaded player, and this screen
     has no single subject — it takes two rosters and has nothing to say until
     both are pasted. */
  { label: 'Team Analysis', icon: TeamIcon, hash: '#/teams', home: false },
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
  /* Directly under the search, because it is what a search is FOR: the rawest
     answer to "what has this player been doing", and the rows every screen
     below it aggregates. */
  { label: 'Recent Battles', icon: LogIcon, slug: 'battles', hue: 'green' },
  { label: 'Top Meta Decks', icon: BarsIcon, slug: 'meta', hue: 'blue' },
  { label: 'Deck Analysis', icon: PieIcon, slug: 'decks', hue: 'pink' },
  { label: 'Duel Analysis', icon: SwordsIcon, slug: 'duels', hue: 'green' },
  { label: 'Duel Zone', icon: LoadoutIcon, slug: 'duelzone', hue: 'violet' },
  { label: 'Cards', icon: CardsIcon, slug: 'cards', hue: 'blue' },
  { label: 'Deck Counter', icon: ShieldIcon, slug: 'counter', hue: 'pink' },
  { label: 'Coach Assist', icon: CoachIcon, slug: 'coach', hue: 'green' },
] as const;

/* The eight analytics areas as the landing screen lists them — SIDE_NAV minus
   Search Player, which is the search itself rather than an area. Hoisted so the
   filmstrip's start index and its items are computed from ONE list; deriving
   them from two copies of the same filter is how an index drifts off the item
   it was meant to name. */
const AREAS = SIDE_NAV.filter((s) => s.label !== 'Search Player');

/* Win Conditions, Champions and Evolutions were sidebar sections and are now
   TABS on the Cards screen. They were never separate screens — each is a way of
   looking at the same card list, and three shells that would have rendered the
   same board with one filter pre-applied is three places to keep in step. */

const SECTION_BLURB: Record<string, string> = {
  'Recent Battles': 'Every stored battle, newest first — their deck against the one they faced.',
  'Top Meta Decks': 'What the whole player base is running, ranked by use rate.',
  'Deck Analysis': 'Break a deck down: elixir curve, cycle, role coverage and matchups.',
  'Duel Analysis': 'How a five-deck duel collection holds up across the field.',
  'Duel Zone': 'Recent Bo3 and Bo5 series, and which decks follow each opener.',
  'Deck Counter': 'What beats this player, a head-to-head between two decks, and what answers a given deck.',
  'Coach Assist': 'Mid-duel help: what they will bring next, and which of your decks answers it.',
  Cards: 'Use rate and win rate for all 122 cards, filtered how you like — win conditions, champions, evolutions, rarity, elixir.',
  'Team Analysis': 'Paste two rosters. Every opponent gets a folder holding the decks they play and the decks your squad answers them with.',
};

/* THE GALLERY'S NINTH CARD, and it is not in `AREAS` because it is not one.
 *
 * `AREAS` is `SIDE_NAV` minus the search — the sections of ONE loaded player.
 * Team Analysis has no single subject: it takes two rosters and says nothing
 * until both are pasted, which is exactly why it was kept out of the rail. But
 * the strip under the hero is not the rail. It is the answer to "what is on
 * this site", and leaving the newest tool out of that list to preserve a
 * distinction the reader cannot see is tidiness at the reader's expense.
 *
 * So it is appended to the strip's items rather than added to `SIDE_NAV`: the
 * gallery gains a card, the rail stays a player's own sections, and neither
 * has to know about the other. It opens a ROUTE rather than picking a section,
 * which is the one thing that makes it different from its eight neighbours. */
const TEAM_CARD = {
  label: 'Team Analysis',
  hue: 'pink',
  icon: TeamIcon,
  hash: '#/teams',
} as const;

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
    title: 'The duel',
    titleAccent: 'deck forge',
    body: 'Build all five battle decks side by side. Evolution, Hero and Wild slots are enforced by position, so an illegal lineup is impossible.',
    chips: ['Up to 5 decks · 40 cards', 'Evo · Hero · Wild', 'Live elixir stats'],
    cta: 'Open Duel Builder',
    hash: '#/builder',
    art: ['knight', 'archer-queen', 'golden-knight'],
    banner: 'royal-duels',
  },
  {
    hue: 'green',
    icon: DeckIcon,
    kicker: "Deck's Home",
    title: 'Collection',
    titleAccent: 'Hall',
    body: 'A home for every deck you dream up — unlimited single decks that save themselves, each with the same slot rules as a duel deck.',
    chips: ['Unlimited decks', 'Auto-saving', 'Win-condition filter'],
    cta: 'Open Deck Builder',
    hash: '#/decks',
    art: ['mega-knight', 'golden-knight', 'bandit'],
    banner: 'decks-home',
  },
  {
    hue: 'blue',
    icon: PaletteIcon,
    kicker: 'Counter Palette',
    title: 'The archetype',
    titleAccent: 'armory',
    body: 'Sort your arsenal into folders, one per archetype you face. Every counter deck stays filed, filterable and ready to deploy.',
    chips: ['Unlimited folders', 'Decks by archetype', 'Auto-saving'],
    cta: 'Open Counter Palette',
    hash: '#/palette',
    art: ['pekka', 'inferno-tower', 'skeleton-army'],
    banner: 'counter-palette',
  },
  /* THE FOURTH PANEL, and the only one that is not a deck editor. It is here
     rather than in the analytics grid above because it takes an INPUT — two
     rosters — the way the three tools do, and the grid's blocks all open a
     screen that is already about the loaded player. Pink is the action hue and
     this is the one tool that performs a read rather than editing a deck. */
  {
    hue: 'pink',
    icon: TeamIcon,
    kicker: 'Team Analysis',
    /* SPLIT, so the last word can take the banner's own red the way the hero's
       "Dominate." does. A banner panel drops the solid pill behind its title —
       a painted slab on top of a painted image is two grounds fighting — and
       the accent word is what replaces it as the mark. */
    title: 'Scout',
    titleAccent: 'a whole roster',
    /* TRIMMED TO THE LENGTH OF ITS THREE NEIGHBOURS (2026-09-01), and the
       length is the point rather than the wording. At 183 characters against
       their ~125 this wrapped to a THIRD line, and because a banner's copy
       block is vertically centred a taller block starts higher — so this
       panel's title sat 29px above the other three and the row stopped
       reading as a set. Nothing was cut that the panel was carrying alone:
       both squads, a folder per opponent, their real decks and the teammate
       who answers are all still here, in 120 characters. */
    body: 'Paste both squads. Every opponent gets a folder: the decks they actually play, and which teammate should answer each one.',
    /* THE THIRD CHIP WAS 23 CHARACTERS AND OVERFLOWED BY EIGHTEEN PIXELS.
       Measured: 159 + 176 + 197 = 532 plus two 7.2px gaps = 546, in a 528px
       track — so it wrapped alone onto a second row while the other three
       panels kept all three chips on one line. "Real" is kept deliberately;
       it is the word doing the work on a screen whose whole argument is that
       its numbers are measured rather than invented. */
    chips: ['Two squads at once', 'A folder per opponent', 'Real matchup data'],
    cta: 'Open Team Analysis',
    hash: '#/teams',
    art: ['archer-queen', 'pekka', 'goblin-barrel'],
    /* A PAINTED BANNER INSTEAD OF THREE FLOATING CARDS.
       THE FILENAME IS THE WHOLE WIRING — the same arrangement the field book's
       plates use. Nothing here imports the image and no manifest lists it: the
       slot asks for this path, and until the file exists it falls back to the
       card trio above, so the panel is complete and shippable before any art
       arrives and improves the moment it does. Drop a file at
       `public/assets/panels/<name>.webp` and it appears.
       The other three keep `art` only, and adopt a banner by gaining this one
       line each. */
    banner: 'team-analysis',
  },
] as const;

function go(hash: string) {
  const next = hash || HOME;
  if (window.location.hash !== next) window.location.hash = next;
}

/* The three deck tools are not analytics areas, so they are not in SIDE_NAV —
   but they own identity hues too, on their landing-page panels. Same colours,
   so the backdrop keeps meaning something on all eleven screens rather than
   falling back to ambient on three of them. */
const TOOL_HUE: Record<'builder' | 'decks' | 'palette' | 'teams', FireflyHue> = {
  builder: 'violet',
  decks: 'green',
  palette: 'blue',
  teams: 'pink',
};

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
  /* Anon, free, trial, pro or admin — decides which areas open. */
  const access = useAccess();
  const trialLeft = trialDaysLeft(useAccountStore((st) => st.profile));
  const [tag, setTag] = useState('');
  // The analysis screen carries the query in the top bar, seeded from the URL.
  const [topTag, setTopTag] = useState(playerTag);
  const [season, setSeason] = useState<string>(SEASONS[0]);
  /* ⌘K / Ctrl-K focuses the tag search from anywhere. Registered here rather
     than on the input because the point is to reach it without finding it. */
  /* Null until the search pill is expanded — GooeySearch does not render an
     input at all in its collapsed state, so ⌘K has to open it first. */
  const findRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (findRef.current) {
          findRef.current.focus();
          findRef.current.select();
          return;
        }
        /* Collapsed: click the pill to expand it, then focus once the input
           has mounted. The component focuses it itself on expand, so this only
           has to open it. */
        document
          .querySelector<HTMLElement>('[aria-label="Open search"]')
          ?.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /* The sidebar's Upgrade Now and the gate's Subscribe are the same intent, so
     they open the same thing. This one had no handler at all — a button that
     does nothing is worse than no button. */
  const [proContact, setProContact] = useState(false);
  /* Which panels asked for a banner and did not get one. Keyed by kicker
     because that is what identifies a FEATURES entry. */
  const [bannerFailed, setBannerFailed] = useState<Record<string, boolean>>({});

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

  /* LOCKED, NOT HIDDEN — and that is the change, not a relaxation of it.
   *
   * Team Analysis was filtered out of the nav and the landing while it was
   * admin-only, because there is no point drawing an entry that opens a card
   * saying "become an admin": nobody reading it can act on it. It is an
   * ordinary gated area now (`tiers.ts`), so the opposite applies — an area
   * somebody could subscribe to and cannot see is a feature that does not
   * exist as far as the person paying is concerned.
   *
   * Every surface therefore lists it unconditionally, and the ROUTE is what
   * refuses: `#/teams` renders `GateCard` for anon and free. One decision, made
   * in one place, instead of a visibility rule and an access rule that can
   * disagree about who gets what. */
  const topNavItems = TOP_NAV;
  const featureItems = FEATURES;

  /* THE BACKDROP WEARS THE OPEN AREA'S HUE — the same one the sidebar row and
   * the area's block already carry, so the whole page agrees about where you
   * are instead of only a 26px icon tile saying so.
   *
   * The landing screen is the deliberate exception and stays on the ambient
   * gold/green pair. It has no subject — no section is open and no player is
   * loaded — so there is no identity for it to wear, and it is the one screen
   * where the motes sit over painted art that the warm gold was chosen for.
   *
   * `--hue-*` is the INK step, which is the right one here: a mote is a bare
   * graphic mark on the page, not a fill carrying text, so it needs to be seen
   * against the ground rather than to hold white on top of itself. The solid
   * ramp would make them darker than the dark page. */
  const backdropHue: FireflyHue | undefined = landing
    ? undefined
    : view === 'player'
      ? // A bare `#/player/<tag>` is the Search Player area, whose slug is ''.
        SIDE_NAV.find((s) => s.slug === playerSection)?.hue
      : view === 'home'
        ? SIDE_NAV.find((s) => s.label === section)?.hue
        : TOOL_HUE[view];

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
  /* ONE navigation action for both rails. The sidebar and the phone strip must
     not drift about what tapping an area does — the sidebar had this inline,
     and a second copy in the phone rail is exactly how two navigations end up
     disagreeing about whether a tag is loaded. */
  const openArea = (item: { label: string; slug: string | null }) => {
    // With a tag loaded a rail is navigation, so it moves the URL; without one
    // it just picks which area the home screen shows.
    if (view === 'player' && item.slug !== null) {
      const base = `#/player/${encodeURIComponent(playerTag)}`;
      go(item.slug ? `${base}/${item.slug}` : base);
    } else {
      setSection(item.label);
      if (view !== 'home') go(HOME);
    }
  };

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
      {/* The app-wide backdrop, both themes. It paints on the page at
          z-index 0; the panel fills are 90% in both ladders, so it reads
          through them rather than only in the gutters.

          On the landing screen it is the ambient pair -- gold on the true-black
          dark page, brand green on the light one, see PALETTE in Fireflies.tsx,
          which switches blend mode as well as colour. Everywhere else it takes
          the open area's identity hue and eases into it; the swap is a uniform,
          so nothing is rebuilt on navigation. */}
      {/* 240 was tuned for a mote band that covered rather less than the
          viewport. The band is 2.33x taller now so that it reaches the foot
          of the page, and the count rises with it or the same motes would
          simply be spread thinner over more of the screen. Still one draw
          call — points are the cheapest thing a GPU does. */}
      <Fireflies fixed count={520} hue={backdropHue} />

      {/* ONE canvas for every circular control on the page, not one per button.
          The reference gives each button its own iframe and its own WebGL2
          context; a browser allows about 16 per document, and the builder alone
          puts dozens of circles on screen. Same reason DeckFx is one canvas.
          It draws nothing and runs no frames until something is hovered. */}
      <LiquidMetal />

      {/* The bar carried `data-landing` too, back when only the landing screen's
          bar dropped to the page colour — the header is a SIBLING BEFORE
          `.body`, so no selector on `.body` could reach back to it. Every
          screen's bar is the page colour now, so the flag has one reader left
          and it is `.body`, for the rail. */}
      <header className={styles.topbar}>
        {/* THE BRAND AND THE NAV ARE ONE CLUSTER. The dock used to sit in the
            middle of the bar as its own glass pill, which read as a third
            object floating between the wordmark and the actions. The nav
            belongs to the brand — it is what DECKKIES *is* — so the two share a
            row and the pill is gone. See the note at the foot of
            `ui/glass-dock.css`. */}
        <div className={styles.brandCluster}>
        <button
          type="button"
          className={styles.brand}
          onClick={goHome}
          title="Back to the home screen"
        >
          {/* The logo, on the same dark tile the favicon uses, so the tab
              icon and the mark in the chrome are the same object. It was a
              violet tile with a generic crown; there is a real mark now. */}
          <span className={styles.brandMark}>
            <img src={`${import.meta.env.BASE_URL}assets/brand/logo-dark.png`} alt="" draggable={false} />
          </span>
          DECKKIES
        </button>

        {/* The nav NEVER goes away. It used to be swapped out for the player
            query row, which left every analysis screen with no way to reach
            Deck Vault, Duel Builder or Counter Hub without going home first —
            the same half-wired navigation the Home button was caught by. The
            query row moved into the panel, where the thing it queries is. */}
        <GlassDockNav
          className={styles.topDock}
          items={topNavItems.map((item) => ({
            label: item.label,
            icon: item.icon,
            active: topNav === item.label,
            onSelect: () => {
              if ('scrollTo' in item) return goAnalytics();
              if ('section' in item) {
                setSection(item.section);
                return go(HOME);
              }
              return item.home ? goHome() : go(item.hash);
            },
          }))}
        />
        </div>

        <div className={styles.topActions}>
          {/* The tag search lives in the CHROME now, not only on the landing
              section. It was reachable from two places — the hero, and a row
              that replaced the whole nav once a player was open — so from a
              deck screen there was no way to look someone up without going
              home first. Here it is on every screen, and ⌘K focuses it.

              It is vengenceui's GooeySearch now rather than a form. The one
              thing that component cannot do is submit what you typed, which is
              the only thing this field is for — see `TopSearch`. */}
          <TopSearch
            inputRef={findRef}
            onGo={(t) => go(`#/player/${encodeURIComponent(t.trim())}`)}
          />

          {/* Was a 2.15rem circular icon button. It kept `data-metal` while it
              was a circle; as a 3:1 track that no longer applies, so the
              attribute went with the shape. */}
          {/* THE FIELD BOOK. It sits in the actions rather than in the dock
              because the dock is a row of destinations inside the product and
              this is the book ABOUT it — and because a control meant to tempt
              cannot be the seventh item in a list of six that all look alike. */}
          <FieldBookButton onOpen={() => go('#/guide')} />
          <ThemeToggle size="1.85rem" />
          <button type="button" className={styles.iconButton} data-metal aria-label="Notifications">
            <BellIcon />
          </button>
          {/* A SIGNED-OUT VISITOR NEEDS A WAY IN that is not a gate card. The
              profile menu assumes an account exists, so it would be a menu of
              things a stranger cannot do. */}
          {access === 'anon' ? (
            <a className={styles.signIn} href="#/signin">
              Sign in
            </a>
          ) : (
            <>
              {/* ADMIN IS ITS OWN TAG, not a PRO badge worn by an admin.
                  An admin does have everything Pro has, which is why one badge
                  covered both at first — but the badge answers "what am I",
                  and "the owner" and "a subscriber" are not the same answer.
                  Maroon, which is this palette's pink SOLID step and already
                  what the admin tier wears in the console's accounts table. */}
              {/* One badge, three colours, drawn as the tactile shader button.
                  It replaced three separate pill spans — the tier is one idea
                  and it now has one component. `trial` renders as MEMBER; see
                  the note in TierBadge. */}
              <TierBadge tier={access} trialDaysLeft={trialLeft} />
              <ProfileMenu triggerClassName={styles.avatar} />
            </>
          )}
        </div>
      </header>

      <div
        className={styles.body}
        data-rail={railOpen ? 'open' : 'closed'}
        data-landing={landing || undefined}
      >
        {/* THE RAIL IS NOT PART OF THE LANDING SCREEN.
            A sidebar of a player's analytics areas before there is a player is
            navigation to eight screens that all say "search for someone first",
            and it costs the hero a quarter of its width. The same eight areas
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
              className={styles.railToggle} data-metal
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
                  onClick={() => openArea(item)}
                >
                  <span className={styles.sideIcon}>
                    <Icon />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* DO NOT ASK A PAYING READER TO UPGRADE. This card sat in the rail
              on every screen, unconditionally, so a pro or admin account was
              shown "Unlock exclusive analytics" and an Upgrade Now button for
              features it already had — the same fault as the ProLock over the
              counters, in the one place it is visible on every single page.

              Pro and admin get a status line instead: the crown they have
              earned, and nothing to buy. A trial keeps the CTA, because there
              IS something to do — the countdown is the reason to do it. */}
          <div className={styles.proCard} data-state={access}>
            <span className={styles.proTitle}>
              <span className={styles.proMark}>
                <CrownIcon size={14} />
              </span>
              Deckkies Pro
            </span>
            {access === 'pro' || access === 'admin' ? (
              <p className={styles.proBody}>
                {access === 'admin' ? 'Admin — everything unlocked.' : 'Active. Everything unlocked.'}
              </p>
            ) : (
              <>
                <p className={styles.proBody}>
                  {/* NOT "everything unlocked" any more. Coach Assist is
                      pro-only, so a trial that claimed everything would be
                      contradicted by the gate card the moment they opened it —
                      and a promise the product breaks is worse than a smaller
                      promise it keeps. */}
                  {access === 'trial'
                    ? `Trial — ${trialLeft} day${trialLeft === 1 ? '' : 's'} left. Coach Assist needs Pro.`
                    : 'Unlock exclusive analytics & advanced features.'}
                </p>
                <button
                  type="button"
                  className={styles.proButton}
                  onClick={() => setProContact(true)}
                >
                  {access === 'trial' ? 'Keep Pro' : 'Upgrade Now'}
                  <StarIcon />
                </button>
              </>
            )}
          </div>
            </aside>
          </>
        )}

        <main className={styles.main}>
          {/* THE PHONE'S ONLY WAY BETWEEN AREAS.
              Below 860px the sidebar AND the top nav are both `display: none`
              with nothing replacing them, so once you were inside an analytics
              area on a phone the only way to another was the browser's back
              button. Measured on an iPhone 13 against production: one `.sidebar`
              in the DOM, `display: none`, and no substitute anywhere.

              A SCROLLING STRIP RATHER THAN A DRAWER. A drawer needs a trigger,
              an overlay, a focus trap and an escape key — four things to get
              right so that a tap can reach every link. A strip is always
              visible, needs none of them, and shows you where you are without
              being opened. It carries the same items through the same
              `openArea`, so it cannot disagree with the sidebar. */}
          {!landing && (
            <nav className={styles.phoneNav} aria-label="Analytics areas">
              {sideNav.map((item) => {
                const Icon = item.icon;
                const active =
                  view === 'player' ? item.slug === playerSection : section === item.label;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`${styles.phoneNavItem} ${active ? styles.phoneNavItemOn : ''}`}
                    data-hue={item.hue}
                    aria-current={active || undefined}
                    onClick={() => openArea(item)}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
              {/* LAST, AND ON EVERY PHONE SCREEN THIS STRIP APPEARS ON.
                  Below 860px this strip IS the navigation — the sidebar and the
                  top nav are both `display: none` — so a tool missing from it
                  is a tool with no way in on a phone at all. It goes at the end
                  rather than in `sideNav` for the same reason it is not in the
                  rail: those entries are the loaded player's sections and this
                  one is a route, which is why it calls `go` rather than
                  `openArea`. */}
              <button
                type="button"
                className={`${styles.phoneNavItem} ${view === 'teams' ? styles.phoneNavItemOn : ''}`}
                data-hue={TEAM_CARD.hue}
                aria-current={view === 'teams' || undefined}
                onClick={() => go(TEAM_CARD.hash)}
              >
                <TeamIcon size={14} />
                {TEAM_CARD.label}
              </button>
            </nav>
          )}

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
            /* The same eight areas, reached by tag instead of by the sidebar.
               Gating one route and not the other is not a gate — anyone who
               noticed the URL shape would walk straight past it. The slug is
               mapped back to the label so both paths consult one rule. */
            !sectionAllowed(
              access,
              SIDE_NAV.find((n) => n.slug === playerSection)?.label ?? 'Search Player',
            ) ? (
              <GateCard
                access={access}
                section={SIDE_NAV.find((n) => n.slug === playerSection)?.label ?? 'This area'}
              />
            ) : playerSection === 'battles' ? (
              <RecentBattles tag={playerTag} season={season as Season} />
            ) : playerSection === 'duels' ? (
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
            /* THE GATE, in place of the content rather than over it. A modal
               would have to be dismissed before anything else could be reached,
               which turns "this one needs an account" into "you are stuck". */
            sectionAllowed(access, section) ? (
              <HomeSection name={section} suggestions={popular} />
            ) : (
              <GateCard access={access} section={section} />
            )
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
              {/* THE ONE TOOL ROUTE THAT CONSULTS THE GATE. The other three
                  are deck editors that touch no player data; this one reads the
                  analytics service for up to sixteen players, so it is a
                  Pro-only SECTION that happens to live on a tool route.
                  `sectionAllowed` is asked here for exactly the same reason it
                  is asked for a sidebar area — one predicate, never a second
                  opinion about what Pro means. */}
              <div data-probe-view={view} data-probe-allowed={String(sectionAllowed(access, 'Team Analysis'))} />
              {view === 'teams' &&
                (sectionAllowed(access, 'Team Analysis') ? (
                  /* `ReadingState` is what every slow screen here shows, so a
                     chunk arriving looks like data arriving rather than like a
                     second kind of waiting. */
                  <Suspense
                    fallback={
                      <ReadingState k="teams" hue="pink">
                        <p>Opening Team Analysis…</p>
                      </ReadingState>
                    }
                  >
                    <TeamAnalysis />
                  </Suspense>
                ) : (
                  <GateCard access={access} section="Team Analysis" />
                ))}
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
              {/* NO HEADING. The blocks below each carry their own name on
                  a painted tile and a sentence saying what they do, so a heading
                  reading "Analytics" above them and a line telling the reader to
                  pick one restated what the grid already showed.

                  `id` moved onto the grid itself — it is the scroll target for
                  the top bar's Analytics item, and deleting the element that
                  carried it would have quietly turned that control back into
                  the no-op it used to be. */}
              {/* THE ANALYTICS AREAS ARE A FILMSTRIP.
                  They were a seven-across grid, which on a wide screen made
                  each block a narrow column of truncated blurb and on a narrow
                  one stacked into a long scroll. As a strip each area is one
                  card at readable size, and browsing between them is the
                  gesture rather than the scroll.

                  Each card keeps its OWN hue — the same one its sidebar row
                  and its section wear — through the per-item `hue`, so the
                  strip does not flatten eight identities into one. */}
              <div className={styles.areaGrid} id="analytics-areas">
                <Filmstrip
                  label="Analytics areas"
                  /* OPENS ON DUEL ZONE, which is the middle of them — so
                     the strip has cards fanning to BOTH sides and reads as
                     something you are standing in. Opening on the first one
                     piled every other card off to the right. Found by label
                     rather than a literal index, so reordering SIDE_NAV cannot
                     silently move it to an end. */
                  start={AREAS.findIndex((a) => a.label === 'Duel Zone')}
                  /* No `n / 8` here — the dot rail underneath already says
                     where you are, and two readouts of the same thing is one
                     too many on a landing screen. */
                  counter={false}
                  items={[...AREAS, TEAM_CARD].map(
                    (item, i) => {
                      const Icon = item.icon;
                      /* The only card in the strip that is a route rather than
                         a section of the loaded player — see `TEAM_CARD`. */
                      const isRoute = 'hash' in item;
                      return {
                        key: item.label,
                        index: i + 1,
                        title: item.label,
                        hue: item.hue,
                        onOpen: () => (isRoute ? go(item.hash) : setSection(item.label)),
                        media: (
                          <span className={styles.areaFace} data-hue={item.hue}>
                            <span className={styles.areaFaceIcon}>
                              <Icon size={26} />
                            </span>
                            {/* The blurb is the content, so it lives in the
                                face where it has room to wrap. The footer's
                                subtitle is one nowrap line and would have
                                clipped every one of these to an ellipsis. */}
                            <span className={styles.areaFaceBody}>
                              {SECTION_BLURB[item.label]}
                            </span>
                          </span>
                        ),
                      };
                    },
                  )}
                />
              </div>
              </div>

              {/* Also unheaded, for the same reason: each tool panel already
                  carries its own kicker, title and description. */}
              <div className={styles.band} ref={toolsReveal}>
              {featureItems.map((f, i) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.kicker}
                    type="button"
                    className={`${styles.toolPanel} ${i % 2 === 1 ? styles.toolPanelFlip : ''}`}
                    data-hue={f.hue}
                    /* THE NAME, NOT AN EMPTY FLAG. Framing is a property of the
                       PICTURE — which side of it may be cropped depends on where
                       its subject stands — so the stylesheet has to be able to
                       address one banner rather than all of them. */
                    data-banner={
                      'banner' in f && !bannerFailed[f.kicker] ? f.banner : undefined
                    }
                    onClick={() => go(f.hash)}
                  >
                    {/* THE ART IS THE PANEL, not a child of one half of it. An
                        absolutely-positioned layer ignores the panel's padding,
                        which is what lets it reach all four edges without four
                        negative margins that have to agree with that padding.
                        The scrim above it is what keeps the copy readable on a
                        painted ground. */}
                    {'banner' in f && !bannerFailed[f.kicker] && (
                      <span className={styles.toolBannerLayer} aria-hidden="true">
                        <img
                          src={`${import.meta.env.BASE_URL}assets/panels/${f.banner}.webp`}
                          alt=""
                          draggable={false}
                          className={styles.toolBanner}
                          /* A NAMED FILE THAT IS NOT THERE YET FALLS BACK to the
                             card trio, so a panel can be given a banner before
                             the art exists and looks exactly as it did until it
                             does. State rather than DOM poking: the previous
                             version hid nodes by hand and left the panel in a
                             half-converted state React did not know about. */
                          onError={() => setBannerFailed((m) => ({ ...m, [f.kicker]: true }))}
                        />
                        <span className={styles.toolBannerScrim} />
                      </span>
                    )}
                    <span className={styles.toolText}>
                      <span className={styles.toolKicker}>
                        <Icon size={14} />
                        {f.kicker}
                      </span>
                      <span className={styles.toolTitle}>
                        {f.title}
                        {'titleAccent' in f && (
                          <>
                            {' '}
                            <span className={styles.toolTitleAccent}>{f.titleAccent}</span>
                          </>
                        )}
                      </span>
                      <span className={styles.toolBody}>{f.body}</span>
                      {/* THE CHIPS AND THE BUTTON SHARE A LINE on a banner
                          panel: the chips run from the left and the CTA is
                          pushed to the far end of the same row, which is what
                          turns a tall stack into a strip. On the card panels
                          they stay in their own rows, so this wrapper is inert
                          there — it is a single flex row either way, and the
                          difference is entirely in the CSS. */}
                      <span className={styles.toolFoot}>
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

/* The three areas that need a loaded player to say anything at all: a duel
 * series log, a combination board and a mid-duel coach.
 *
 * They used to be described here as "the three behind the Royal Pro gate", and
 * that is no longer true of this constant — entitlement is decided by
 * `sectionAllowed()` before any of this runs. What these three share now is
 * that they need a TAG, which is a different problem with a different answer.
 *
 * WAS `PRO_SECTIONS`. Same three areas, different question: these are the ones
   that need a player tag, not the ones that need a subscription. The blurbs are
   unchanged — they always described what the area does, which is exactly what
   someone deciding whose tag to type needs to read. */
const TAG_SECTIONS: Record<string, { blurb: string; perks: string[] }> = {
  'Recent Battles': {
    blurb:
      'Every battle we hold for a player, newest first — the deck they brought beside the one they faced, with the crowns and the mode, ten to a page.',
    perks: ['Both decks, side by side', 'Ladder, duels, friendlies and challenges', 'Any date range you like'],
  },
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

/**
 * What a home-screen analytics area renders.
 *
 * THE PRO WALL THAT USED TO BE HERE WAS UNREACHABLE BY ANYONE IT WAS FOR.
 * `sectionAllowed()` above sends an anonymous or free visitor to `GateCard`
 * before this function is ever called, so the only people who reached the
 * "subscribe to Royal Pro" gate were the ones who already had it — a trial, pro
 * or admin account, pressing a landing block it had paid for and being asked to
 * pay again. The gate was written before the gate existed, and the real gate
 * overtook it.
 *
 * What those three areas actually lack on this route is a PLAYER TAG. They read
 * one player's history and the home route has no player, so they are asked for
 * one, wearing the area's own hue — the colour you pressed is the colour you
 * land on.
 */
function HomeSection({ name, suggestions }: { name: string; suggestions: string[] }) {
  if (name === 'Top Meta Decks') return <MetaDecks />;
  if (name === 'Deck Analysis') return <DeckLab />;
  if (name === 'Deck Counter') return <CounterLab />;
  if (name === 'Cards') return <GlobalCards />;

  const needs = TAG_SECTIONS[name];
  if (needs) {
    const item = SIDE_NAV.find((s) => s.label === name);
    return (
      <NeedsTag
        name={name}
        blurb={needs.blurb}
        perks={needs.perks}
        slug={item?.slug ?? ''}
        hue={item?.hue}
        suggestions={suggestions}
      />
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
