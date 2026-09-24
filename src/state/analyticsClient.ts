/**
 * Client for the analytics API.
 *
 * The API is local right now (server/app.py, proxied by Vite) and will be
 * hosted later. Nothing in this file knows which — it only ever calls
 * `/api/analytics/*`, so moving the service is a proxy or base-URL change
 * rather than a code change. `VITE_ANALYTICS_BASE` is the escape hatch for
 * pointing a build straight at a remote host.
 */

const BASE = import.meta.env.VITE_ANALYTICS_BASE ?? '';

export interface ApiPlayer {
  name: string;
  tag: string;
  verified: boolean;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  crownsFor: number;
  crownsAgainst: number;
  lastSeen: string;
}

export interface ApiDeck {
  rank: number;
  name: string;
  deckHash: string;
  cards: string[];
  useRate: number;
  winRate: number;
  matches: number;
  wins: number;
  losses: number;
  avgElixir: number | null;
  winCondition: string | null;
  lastSeen: string;
  /** Per-card art variant where this deck is fielded evolved or as a hero. */
  art?: Record<string, 'evolution' | 'hero'>;
  /** True when `art` was inferred from slot position rather than observed —
   *  `player_evo` only covers battles from 2026-08-05 onward. */
  artInferred?: boolean;
}

export interface ApiTrends {
  days: string[];
  series: { deckHash: string; use: number[]; win: number[] }[];
  archiveUsed: boolean;
}

export interface ApiSources {
  hot: { path: string | null; available: boolean; sizeBytes: number };
  archive: { path: string; available: boolean; sizeBytes: number };
}

export interface ApiCoverage {
  start: string | null;
  end: string | null;
  days: number;
}

export interface ApiProfile {
  name: string | null;
  trophies: number | null;
  bestTrophies: number | null;
  expLevel: number | null;
  arena: string | null;
  clan: string | null;
  /** Path of Legends — this season's standing. Null before they play a ranked
   *  match in a new season, which is why the trophy-road pair stays above. */
  rankedTrophies: number | null;
  /** Global placement, and null below the leaderboard cut EVEN WHEN
   *  `rankedTrophies` is set. Never assume one implies the other. */
  rankedRank: number | null;
  /** Best SEASON, not best trophies — it can be lower than `rankedTrophies`.
   *  Only print it as "best" when it actually exceeds the current figure. */
  rankedBest: number | null;
  rankedBestRank: number | null;
}

/** Where a tag stands with collection.
 *
 *  The three states mean different things to someone waiting for data and the
 *  UI must not merge them: `tracked` is being collected, `pending` is queued
 *  and NOT yet being collected, `unknown` is neither. */
export interface TrackingState {
  tag: string;
  tracked: boolean;
  requested: boolean;
  requestedAt: string | null;
  lastSeenAt: string | null;
  hits: number;
  state: 'tracked' | 'pending' | 'unknown';
}

/** One deck, as seen in a live battlelog. Deliberately a different shape from
 *  `ApiDeck` — there is no rank, no lifetime totals and no inferred art here,
 *  because the live payload states the form of every card in every battle. */
export interface LiveDeck {
  hash: string;
  name: string;
  archetype: string | null;
  cards: string[];
  art: Record<string, 'evolution' | 'hero'>;
  inferredArt: boolean;
  games: number;
  wins: number;
  winRate: number;
  useRate: number;
  lastSeen: string | null;
}

export interface LiveCard {
  key: string;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  useRate: number;
}

/** A player's most recent battles, straight from the Clash Royale API.
 *
 *  THIS IS WHAT A NEVER-TRACKED TAG GETS. The databases hold what the bot
 *  polled, so a tag searched for the first time has nothing stored — but the
 *  game has been keeping its last ~25 battles the whole time. Every figure here
 *  is computed over that fixed, non-paginated window, which is why the type is
 *  separate and why `basis` is on the wire: a screen must be able to say which
 *  kind of number it is showing. */
export interface LivePlayerReport {
  basis: 'live';
  tag: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  crownsFor: number;
  crownsAgainst: number;
  trophyChange: number;
  span: { from: string | null; to: string | null };
  modes: { mode: string; battles: number }[];
  decks: LiveDeck[];
  cards: LiveCard[];
  /** Battles dropped as 2v2 or a mode that hands you a deck. Printed, because
   *  "25 battles" on the tin and 19 in the figures needs explaining. */
  skipped: number;
  logSize: number;
  limits: { endpointCap: boolean; note: string };
  tracking: TrackingState;
  profile: ApiProfile | null;
  coverage?: ApiCoverage;
  sources?: ApiSources;
}

export interface StoredPlayerReport {
  basis: 'stored';
  player: ApiPlayer;
  decks: ApiDeck[];
  trends: ApiTrends;
  /** How much history exists for this player, whatever window is shown. */
  coverage: ApiCoverage;
  window: { from: string | null; to: string | null };
  /** Live CR API fields the databases do not carry. Null when unavailable. */
  profile: ApiProfile | null;
  tracking: TrackingState;
  sources: ApiSources;
}

/** The player endpoint answers with one of two shapes, discriminated on
 *  `basis`. A caller that does not care can narrow with `isLive` below. */
export type PlayerReport = StoredPlayerReport | LivePlayerReport;

export function isLiveReport(r: PlayerReport): r is LivePlayerReport {
  return r.basis === 'live';
}

/* ------------------------------------------------------ meta leaderboard */

export interface MetaDeck {
  rank: number;
  deckHash: string;
  name: string;
  cards: string[];
  /** How many DIFFERENT players ran it — the guard against one grinder. */
  players: number;
  /** Near-identical lists merged into this row (6-of-8 shared cards). */
  variants: number;
  /** Per-card art variant, where the deck is fielded evolved or as a hero. */
  art: Record<string, 'evolution' | 'hero'>;
  /** Share of all competitive battles in the window. */
  useRate: number;
  winRate: number;
  battles: number;
  wins: number;
  losses: number;
  avgElixir: number | null;
  winCondition: string | null;
  lastSeen: string;
}

export interface MetaBoard {
  decks: MetaDeck[];
  window: { from: string | null; to: string | null; days: number };
  totalBattles?: number;
  distinctDecks?: number;
  /** Which game modes counted as "the meta". */
  modes?: string[];
  /** Distinct-player floor a deck must clear, and how many it rejected. */
  minPlayers?: number;
  excludedByFloor?: number;
  /** Unix seconds. The rollup is a background snapshot, not a live query. */
  computedAt?: number;
  ageSeconds?: number;
  tookSeconds?: number;
  refreshSeconds?: number;
  /** True while the first snapshot is still being built — poll and retry. */
  building?: boolean;
  elapsedSeconds?: number;
  error?: string | null;
}

/**
 * The global meta board. Answers instantly from a background-computed
 * snapshot; `building: true` means no snapshot exists yet and the caller
 * should poll. See server/meta.py for why it cannot be queried live.
 */
export interface GlobalCardForm {
  battles: number;
  wins: number;
  winRate: number;
  /** Share of the MARKED battles this card appeared in — not of every battle. */
  share: number;
}

export interface GlobalCard {
  key: string;
  battles: number;
  wins: number;
  /** Distinct deck lists in the window that held this card. */
  decks: number;
  /** Share of every competitive battle in the window — the same denominator
   *  the deck board's use rate uses, so the two are comparable. */
  useRate: number;
  winRate: number;
  /** Present ONLY when the card was seen in a battle that recorded which form
   *  was fielded. Absent means "never observed in either form", which is a
   *  different claim from "observed, zero". */
  forms?: Partial<Record<CardForm, GlobalCardForm>>;
}

export interface GlobalCardBoard {
  cards: GlobalCard[];
  /** How thin the per-form half is. A form's win rate must not pass for the
   *  same kind of number as a card's, so the screen prints this. */
  formCoverage: { battles: number; from: string | null; to: string | null; days: number } | null;
  window: { from: string | null; to: string | null; days: number };
  totalBattles?: number;
  computedAt?: number;
  ageSeconds?: number;
  building?: boolean;
  elapsedSeconds?: number;
  error?: string | null;
}

/**
 * Use and win rate for every card across the WHOLE player base.
 *
 * Same background snapshot as the meta deck board — a deck hash is the sorted
 * card list, so the per-card tally falls out of the scan that board already
 * runs. Which means this is as cheap as `/meta` and can never describe a
 * different window from it.
 */
export function fetchGlobalCards(): Promise<GlobalCardBoard> {
  return get<GlobalCardBoard>('/api/analytics/meta/cards');
}

export function fetchMetaBoard(): Promise<MetaBoard> {
  return get<MetaBoard>('/api/analytics/meta');
}

/* ------------------------------------------------------- duel combinations */

export type TabId = 'win-conditions' | 'spells' | 'evolutions';

export interface ApiCombo {
  a: string;
  b: string;
  aName: string;
  bName: string;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  useRate: number;
  /** How many DIFFERENT decks the pairing survived into — its reach. */
  decks: number;
  /** Jaccard index: of decks holding either card, the share holding both. */
  lock: number;
  lockClass: 'shared' | 'frequent' | 'locked' | 'unknown';
  /** null means the sample cannot support a claim at all, not "low". */
  tier: 'high' | 'medium' | 'low' | null;
  interval: string | null;
  /** Decks carrying this pair, by loadout position: [G1, G2, G3]. */
  slots: [number, number, number];
  /** Each slot's own decks, as a share of every deck played in that slot. */
  slotShare: [number, number, number];
  /** How much of this pairing is really one deck. */
  topShare: number;
  /** Art variant each card is usually fielded with, when it is marked. */
  artA?: 'evolution' | 'hero';
  artB?: 'evolution' | 'hero';
}

export interface ApiComboTab {
  id: TabId;
  label: string;
  blurb: string;
  noun: string;
  eligible: number;
  mostUsed: ApiCombo | null;
  perSlot: (ApiCombo | null)[];
  rows: ApiCombo[];
}

export interface DuelReport {
  player: { name: string; tag: string };
  duels: {
    total: number;
    native: number;
    reconstructed: number;
    decks: number;
    uniqueDecks: number;
    slots: [number, number, number];
    evoCoverage: number;
    /** ISO days of the first and last duel read; `''` when there were none. */
    span?: { from: string; to: string };
  };
  pairs: { observed: number; eligible: number };
  floors: { minGames: number; minDecks: number };
  tabs: Record<TabId, ApiComboTab>;
  archiveUsed: boolean;
  /**
   * WHICH BATTLES THESE PAIRS CAME FROM.
   *
   * `'duel'` is the page's own question. `'all'` means the duel population
   * could not clear the evidence floor — a player with two duels yields dozens
   * of observed pairings and zero eligible ones — so the same question was
   * asked of their other battles instead. The screen MUST say so: an unlabelled
   * widening is the same class of mistake as card metadata silently defaulting
   * to "not a win condition".
   *
   * Optional because an older deployment does not send it; absent reads as
   * `'duel'`, which is what every previous response meant.
   */
  basis?: 'duel' | 'all';
  /**
   * False when the rows carry no loadout position. A ladder battle has no G1,
   * G2 or G3, so the split is withheld rather than zeroed — the server sets
   * `slot: -1` and every slot total legitimately stays 0.
   */
  hasSlots?: boolean;
  /** Decks behind the figures when `basis` is `'all'`. */
  battles?: number;
  coverage: ApiCoverage;
  window: { from: string | null; to: string | null };
  sources: ApiSources;
}

/* ------------------------------------------------------------- duel zone */

/** One deck as it was actually fielded in a duel game. */
export interface DuelGame {
  /** Position in the loadout: 0 = G1, 1 = G2, 2 = G3. */
  slot: number;
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  artInferred?: boolean;
  avgElixir: number;
  /** Empty on a native duel row: it stores the DUEL's result, not each game's. */
  result: 'win' | 'loss' | 'draw' | '' | null;
  playerCrowns?: number;
  opponentCrowns?: number;
  archetype: string;
  deckName: string;
  /** The deck they were facing, arranged and art-resolved by the same server
   *  function as the player's — `opponent_evo` carries the same marks. Null on
   *  a native duel row, which stores a loadout and no per-game opponent. */
  opponent: {
    cards: string[];
    archetype: string;
    deckName: string;
    avgElixir?: number;
    art?: Record<string, 'evolution' | 'hero'>;
    artInferred?: boolean;
  } | null;
}

export interface DuelSeries {
  id: string;
  startTime: string;
  endTime?: string;
  opponentTag: string;
  opponentName: string;
  /** 'native' = one stored row carrying the whole loadout; 'reconstructed' =
   *  rebuilt from consecutive friendly games with the bot's measured rules. */
  source: 'native' | 'reconstructed';
  /** Decided only by a 4th game — a played-out 2-0 reaches 3-0 and is a Bo3. */
  format: 'bo3' | 'bo5';
  games: DuelGame[];
  playerWins: number | null;
  opponentWins: number | null;
  /** Short phrase for the shape of the result; '' when the score is unverified. */
  caption: string;
  won: boolean;
  scoreKnown: boolean;
}

export interface SequenceDeck {
  /** Arranged into the three special slots by the server, exactly like a deck
   *  in the series log — the order and the art come from one function. */
  cards: string[];
  archetype: string;
  deckName: string;
  avgElixir: number;
  art?: Record<string, 'evolution' | 'hero'>;
  artInferred?: boolean;
  /** Times this exact loadout was actually played (observed rows only). */
  seen?: number;
  count?: number;
  prob?: number;
  /** Series where this deck appeared alongside the opener — what drives the
   *  ranking, so the UI has to show it or the list looks mis-sorted. */
  coRevealed?: number;
}

export interface SequenceEntry {
  opener: SequenceDeck & { count: number; prob: number };
  /** 'observed' = a real series shows this exact loadout; 'predicted' = the
   *  companions were inferred and filtered for card-legality. */
  source: 'observed' | 'predicted';
  seen?: number;
  next: SequenceDeck[];
}

export interface DuelZoneReport {
  series: DuelSeries[];
  sequence: {
    entries: SequenceEntry[];
    nGames: number;
    observed: number;
    lowConfidence: boolean;
  };
  summary: {
    duels: number;
    native: number;
    reconstructed: number;
    games: number;
    wins: number;
    shown: number;
    archiveUsed: boolean;
  };
  coverage: ApiCoverage;
  window: { from: string | null; to: string | null };
  sources: ApiSources;
}

/* ----------------------------------------------------------- card board */

export type CardMode = 'all' | 'ranked' | 'duel' | 'tournament';

export interface ApiCardRow {
  key: string;
  rank: number;
  battles: number;
  wins: number;
  losses: number;
  /** Share of the player's battles in the window that fielded this card. */
  useRate: number;
  winRate: number;
  /** Share of its own play where it was fielded EVOLVED. A floor, not a count:
   *  `player_evo` only covers battles from 2026-08-05 onward. */
  evoRate: number;
  /** Share of its own play where it was fielded as a HERO. Counted separately
   *  from `evoRate` — they are two different special forms, and four cards
   *  (knight, valkyrie, musketeer, wizard) have both. Same coverage caveat. */
  heroRate: number;
  /** Enough battles behind the win rate to be ranked on it. */
  tiered: boolean;
  /** null means the sample cannot support a claim at all, not "low". */
  tier: 'high' | 'medium' | 'low' | null;
  interval: string | null;
  /** Movement against the equally long window immediately before this one.
   *  `winDelta` is absent when either window has no games to compare. */
  useDelta?: number;
  winDelta?: number;
  /** Battles behind the PREVIOUS window's rate. One is arithmetically a
   *  baseline and is not a meaningful one — a card played once and lost, then
   *  47 times at 59.6%, reports `winDelta: +59.6`. Optional: an older server
   *  does not send it, and a reader that needs a floor must treat its absence
   *  as unknown rather than as zero. */
  prevBattles?: number;
  /** The same card scored once per FORM it was seen in — an evolved Skeletons
   *  has its own use rate and its own win rate, separate from the plain one.
   *
   *  Counted over a DIFFERENT population: only battles whose payload recorded
   *  which form was fielded, which is `CardBoard.formCoverage`. Absent when the
   *  card was never seen in a battle that recorded a form, which is distinct
   *  from being seen and scoring zero. */
  forms?: Partial<Record<CardForm, ApiCardForm>>;
}

export type CardForm = 'base' | 'evolution' | 'hero';

export interface ApiCardForm {
  battles: number;
  wins: number;
  /** Share of the FORM-RECORDING battles, not of every battle — see above. */
  useRate: number;
  winRate: number;
  tiered: boolean;
  tier: 'high' | 'medium' | 'low' | null;
  interval: string | null;
}

export interface CardBoard {
  cards: ApiCardRow[];
  totals: {
    battles: number;
    wins: number;
    played: number;
    ranked: number;
    cards: number;
    minBattles: number;
    archiveUsed: boolean;
  };
  mode: CardMode;
  previous: { from: string; to: string; battles: number } | null;
  /** What the per-form split is built on. The form is only known for battles
   *  whose payload carried marks — a minority of the window, over a narrower
   *  date range than the one requested. The screen states this rather than
   *  presenting a form's win rate as the same kind of number as a card's. */
  formCoverage: { battles: number; share: number; from: string | null; to: string | null };
  coverage: ApiCoverage;
  window: { from: string | null; to: string | null };
  sources: ApiSources;
}

/* --------------------------------------------------------- deck counter */

export interface CounterStatus {
  /** The archetype matrix is a background snapshot; poll while it builds. */
  building: boolean;
  error: string | null;
  elapsedSeconds: number;
  ageSeconds: number | null;
  /** How often the tracked player wins in the raw table — the bias that the
   *  symmetrised numbers correct for. Shown so the correction is visible. */
  rawBias: number | null;
  battles: number;
}

export interface Matchup {
  a: string;
  b: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgCrownsFor: number;
  avgCrownsAgainst: number;
  crownDiff: number;
  threeCrownFor: number;
  threeCrownAgainst: number;
  tier: 'high' | 'medium' | 'low' | null;
  interval: string | null;
}

/** A real deck of an archetype, taken from the current meta board so the rows
 *  can show cards rather than only a label. Absent while that snapshot builds. */
export interface RepDeck {
  cards: string[];
  art: Record<string, 'evolution' | 'hero'>;
  /** The art was derived from slot rules rather than observed. */
  inferredArt?: boolean;
  name: string;
  useRate: number | null;
  winRate: number | null;
  avgElixir: number | null;
}

export interface CounterDeckSide {
  archetype: string;
  name: string;
  /** Stored battles for this EXACT list, both directions. */
  battles?: number;
  /** Ordered into slots by the server's `arrange_deck`, not link order. */
  cards: string[];
  /** Which slots draw evolution or hero art.
   *
   *  A Clash Royale copy-deck link carries eight card IDs and nothing else, so
   *  this is DERIVED from what the cards are — see `inferredArt`. Without it a
   *  pasted deck rendered eight plain cards next to a meta deck that had its
   *  evolutions drawn, on the same screen. */
  art?: Record<string, 'evolution' | 'hero'>;
  /** True when `art` was inferred from slot rules rather than observed in a
   *  stored battle. Passed to `CardArt`, which says so in the tooltip. */
  inferredArt?: boolean;
  avgElixir: number;
  /** The archetype's current meta deck, for context beside a pasted list. */
  meta?: RepDeck | null;
}

/** Where a matchup number came from, best first.
 *
 *  `exact`     these two card-for-card lists have actually met
 *  `deck`      this exact list, against every deck of that archetype
 *  `archetype` archetype vs archetype — the deck itself has too few battles
 *
 *  Printed on screen. "62.4% from this deck's own 4,000 battles" and "62.4%
 *  from the archetype average" are different claims and the reader is owed the
 *  difference. */
export type MatchupSource = 'exact' | 'deck' | 'cluster7' | 'cluster6' | 'archetype';

export interface MatchupReport {
  a: CounterDeckSide;
  b: CounterDeckSide;
  /** The two pasted lists are the same eight cards. */
  mirror: boolean;
  /** Different lists, same archetype — no longer the same thing as a mirror. */
  sameArchetype?: boolean;
  matchup: Matchup | null;
  source: MatchupSource | null;
  /** Every reading with evidence behind it, narrowest first: this exact list,
   *  then lists one card different, then two, then the archetype. Shown in
   *  full so a thin exact record can be weighed against a wide approximate
   *  one — and so a disagreement between them is visible. */
  ladder?: MatchupRung[];
  status: CounterStatus;
}

export interface MatchupRung extends Matchup {
  source: MatchupSource;
  /** How many distinct decks were pooled. 1 for the exact list, null for the
   *  archetype rung. */
  decks: number | null;
}

export interface CounterRow {
  archetype: string;
  name: string;
  style: string;
  winRate: number;
  games: number;
  crownDiff: number;
  /** How much better than the field this archetype does against the target. */
  advantage: number | null;
  tier: 'high' | 'medium' | 'low' | null;
  interval: string | null;
  deck?: RepDeck | null;
  /** Whether this row is the pasted deck's own record, a widened one, or the
   *  archetype's. */
  source?: MatchupSource;
  /** Decks pooled for that reading. */
  pooledDecks?: number | null;
}

export interface CountersReport {
  target: CounterDeckSide;
  counters: CounterRow[];
  /** EVERY archetype weighed, not only the ones that beat the deck. `counters`
   *  is deliberately a short list — "what do I have to fear" — and a spread of
   *  the deck across the whole field cannot be rebuilt from it once everything
   *  under 50% has been dropped. Each row's `winRate` is the ARCHETYPE's, so
   *  the deck's own is its complement. */
  field?: CounterRow[];
  /** Archetypes weighed to produce that list — a short list is a real answer. */
  considered?: number;
  styles: { style: string; share: number; games: number }[];
  overall: { winRate: number | null; games: number } | null;
  /** Whether `overall` is the pasted deck's own baseline or the archetype's. */
  source?: MatchupSource;
  /** The decks this exact list has ACTUALLY played, with no evidence floor.
   *  A win rate needs a sample; "you lost to this deck" needs only a record,
   *  and the floor was hiding real games. Reported as W–L, never as a %. */
  played?: PlayedDeck[];
  status: CounterStatus;
}

export interface PlayedDeck {
  archetype: string;
  name: string;
  style: string;
  cards: string[];
  art: Record<string, WildForm>;
  inferredArt?: boolean;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  avgElixir: number;
  /** It has a losing record against you. */
  beatsYou: boolean;
}

export interface PlayerMatchup {
  archetype: string;
  name: string;
  style: string;
  battles: number;
  wins: number;
  winRate: number;
  /** Against this player's own average — what makes it a weakness. */
  diff: number;
  avgCrownsFor: number;
  avgCrownsAgainst: number;
  tier: 'high' | 'medium' | 'low' | null;
  interval: string | null;
  yourWinRate?: number;
  deck?: RepDeck | null;
  /**
   * WHOSE DECK `deck` IS.
   *
   * `'faced'` — this player has personally met this exact eight-card list,
   * `deckSeen` times. It is the deck the win rate above it was measured on.
   *
   * `'typical'` — they have not met any one list often enough to name, so the
   * archetype's most-observed deck across the whole database stands in. That
   * was the ONLY behaviour before, which is why these rows looked identical
   * between accounts: every player was shown the same eight cards for "X-Bow".
   *
   * Optional; absent reads as `'typical'`, which is what older responses were.
   */
  deckBasis?: 'faced' | 'typical';
  /** How many times they met that exact list. 0 when `deckBasis` is typical. */
  deckSeen?: number;
}

export interface PlayerCounterReport {
  player: { tag: string; winRate: number; battles: number; wins: number; archiveUsed: boolean };
  worst: PlayerMatchup[];
  best: PlayerMatchup[];
  recommended: PlayerMatchup[];
  analyzed: number;
  minBattles: number;
  coverage: ApiCoverage;
  window: { from: string | null; to: string | null };
  status: CounterStatus;
}

export interface DateWindow {
  from?: string;
  to?: string;
  days?: number;
}

/** Distinguishes "no data for this player" from "the service is not running". */
export class AnalyticsError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'not_found' | 'invalid_tag' | 'server',
  ) {
    super(message);
  }
}

async function get<T>(path: string, headers?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, headers ? { headers } : undefined);
  } catch {
    // Nothing listening — the local API is not running.
    throw new AnalyticsError(
      'The analytics service is not running. Start it with: python server/app.py',
      'offline',
    );
  }
  if (res.ok) return (await res.json()) as T;

  const body = await res.json().catch(() => ({}) as { error?: string });
  const err = (body as { error?: string }).error;
  if (res.status === 404) throw new AnalyticsError('No stored battles for that tag yet.', 'not_found');
  if (res.status === 400) throw new AnalyticsError('That is not a valid Clash Royale tag.', 'invalid_tag');
  throw new AnalyticsError(err || `Request failed (${res.status})`, 'server');
}

function windowQuery(win: DateWindow): string {
  const q = new URLSearchParams();
  if (win.from && win.to) {
    q.set('from', win.from);
    q.set('to', win.to);
  } else {
    q.set('days', String(win.days ?? 30));
  }
  return q.toString();
}

/** The analysis screen's data.
 *
 * Searching a tag is also what ENROLS it: the server queues any tag it is not
 * already collecting, and answers from the live Clash Royale battlelog when
 * there is no stored history yet. So this can come back as either shape — see
 * `PlayerReport` — and callers narrow on `basis`. A 404 now means the tag is
 * real but BOTH sources are empty, which is a much rarer thing than it was. */
export function fetchPlayerReport(tag: string, win: DateWindow = {}): Promise<PlayerReport> {
  return get<PlayerReport>(
    `/api/analytics/player/${encodeURIComponent(tag)}?${windowQuery(win)}`,
  );
}

/** The live battlelog on its own, for a screen that wants "right now" even
 *  where stored history exists. */
export function fetchLivePlayer(tag: string): Promise<LivePlayerReport> {
  return get<LivePlayerReport>(`/api/analytics/live/${encodeURIComponent(tag)}`);
}

/* ── Coach Roster, Phase 2 ──────────────────────────────────────────────── */

export interface CoachTally {
  battles: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface CoachIntel {
  player: { tag: string; name: string | null };
  window: { from: string | null; to: string | null };
  archiveUsed: boolean;
  summary: CoachTally;
  /** Newest first, at most 10: 'win' | 'loss' | 'draw'. */
  form: string[];
  /** One entry per day from the first battle to the last, ZERO-FILLED. */
  timeline: (CoachTally & { day: string })[];
  modes: (CoachTally & { key: string; name: string })[];
  /** The player's own win conditions, most-played first. */
  archetypes: (CoachTally & { key: string; name: string })[];
  /** What they were up against. */
  opponentArchetypes: (CoachTally & { key: string; name: string })[];
  /** OWN-DECK 1v1 decks, most-played first, capped at 25 — counted from the
   *  same battles as everything else here, NOT the player report's decks,
   *  which include 2v2. Drawn by the battle log's own helper. */
  decks: (CoachTally & {
    key: string;
    cards: string[];
    art?: Record<string, 'evolution' | 'hero'>;
    artInferred?: boolean;
    avgElixir: number | null;
    deckName: string;
    archetype: string;
    last: string;
  })[];
  decksTotal: number;
  /** Most-met first, capped at 50; `last` is battle-log format. */
  opponents: (CoachTally & { tag: string; name: string | null; last: string })[];
  opponentsTotal: number;
  opponentsRepeat: number;
  hidden: number;
  hiddenByMode: Record<string, number>;
}

/** ADMIN-ONLY. The Supabase access token goes in `X-Coach-Token`; the server
 *  asks Supabase whether it belongs to an admin (see `server/admin_auth.py`)
 *  and refuses otherwise — 401 no/expired token, 403 not an admin, 503 when
 *  it cannot check. Those arrive here as `server` errors carrying the code. */
export function fetchCoachIntel(tag: string, win: DateWindow, token: string | null): Promise<CoachIntel> {
  return get<CoachIntel>(
    `/api/analytics/admin/coach/intel/${encodeURIComponent(tag)}?${windowQuery(win)}`,
    token ? { 'X-Coach-Token': token } : undefined,
  );
}

/** Where a tag stands with collection, enrolling it if it is new. */
export function fetchTracking(tag: string): Promise<TrackingState> {
  return get<TrackingState>(`/api/analytics/track/${encodeURIComponent(tag)}`);
}

/** Card combinations in duel play — the Duel Analysis screen. */
export function fetchDuelReport(tag: string, win: DateWindow = {}): Promise<DuelReport> {
  return get<DuelReport>(`/api/analytics/duels/${encodeURIComponent(tag)}?${windowQuery(win)}`);
}

/**
 * The Duel Zone: this player's duel series log and their deck sequence.
 *
 * Both halves come from one server-side read, so the series on screen and the
 * sequence computed from them can never describe different duels.
 */
export function fetchDuelZone(
  tag: string,
  win: DateWindow = {},
  /** Omit for every duel in the window, which is the default. */
  limit?: number,
): Promise<DuelZoneReport> {
  const cap = limit ? `&limit=${limit}` : '';
  return get<DuelZoneReport>(
    `/api/analytics/duelzone/${encodeURIComponent(tag)}?${windowQuery(win)}${cap}`,
  );
}

/* --------------------------------------------------------- recent battles */

/** One side of a battle, drawn the way every other deck on the site is. */
export interface BattleSide {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  artInferred?: boolean;
  avgElixir: number;
  archetype: string;
  deckName: string;
}

export interface RecentBattle {
  id: string;
  /** Supercell's stamp: `20260824T104652.000Z`. */
  battleTime: string;
  /** The raw stored mode string, kept so a reader can check the label. */
  mode: string;
  /** Ladder / Duel / Friendly / Tournament / Challenge / Battle.
   *  NO 2v2 — `battle_modes.classify` routes those rows to the duo-deck
   *  collection before this screen sees them, because a 2v2 battle had four
   *  players and this row draws one deck against one. */
  modeLabel: string;
  result: 'win' | 'loss' | 'draw';
  crowns: number;
  opponentCrowns: number;
  player: BattleSide;
  opponent: BattleSide & { tag: string; name: string };
}

export interface RecentBattlesReport {
  battles: RecentBattle[];
  /** Who the log belongs to. `name` is null when no name has ever been seen
   *  for the tag — the caller decides what to show, so that "unknown player"
   *  and "player called #ABC123" stay distinguishable. */
  player: { tag: string; name: string | null };
  page: number;
  pages: number;
  perPage: number;
  total: number;
  summary: {
    battles: number;
    wins: number;
    losses: number;
    draws: number;
    crowns: number;
    opponentCrowns: number;
    archiveUsed: boolean;
    /** Battles that were in the window and are not on the screen: 2v2, and
     *  the draft, preset and event modes where the deck was not the player's
     *  own. REPORTED RATHER THAN DROPPED — the failure mode of an allowlist is
     *  a correct battle silently missing, and the only defence is making the
     *  omission visible where the reader already is.
     *
     *  Optional: an analytics API that has not been redeployed does not send
     *  it, and the two halves of this project ship separately. */
    hidden?: number;
    /** The same figure broken down by raw mode string, biggest first, so a
     *  mode Supercell ships tomorrow announces itself by name. */
    hiddenByMode?: Record<string, number>;
  };
  coverage: ApiCoverage;
  window: { from: string | null; to: string | null };
  sources: ApiSources;
}

/**
 * One page of a player's battle log.
 *
 * PAGED ON THE SERVER, unlike every other screen here, because this one does
 * not aggregate: an active player has hundreds of battles in a thirty-day
 * window and each row carries two decks. The window decides the pool, the page
 * decides what crosses the wire.
 */
export function fetchRecentBattles(
  tag: string,
  win: DateWindow = {},
  page = 1,
  per = 10,
): Promise<RecentBattlesReport> {
  return get<RecentBattlesReport>(
    `/api/analytics/battles/${encodeURIComponent(tag)}?${windowQuery(win)}&page=${page}&per=${per}`,
  );
}

/** Every card, as one player actually plays it — the Cards screen. */
export function fetchCardBoard(
  tag: string,
  win: DateWindow = {},
  mode: CardMode = 'all',
): Promise<CardBoard> {
  return get<CardBoard>(
    `/api/analytics/cards/${encodeURIComponent(tag)}?${windowQuery(win)}&mode=${mode}`,
  );
}

/** How a player is beaten, and by which archetypes. */
export function fetchPlayerCounter(tag: string, win: DateWindow = {}): Promise<PlayerCounterReport> {
  return get<PlayerCounterReport>(
    `/api/analytics/counter/${encodeURIComponent(tag)}?${windowQuery(win)}`,
  );
}

/** Head-to-head for two decks, at archetype level — see server/deck_counter.py
 *  for why exact deck pairings cannot answer this. */
export function fetchMatchup(
  a: string[], b: string[], wildA?: WildForm | null, wildB?: WildForm | null,
): Promise<MatchupReport> {
  // `wild` only decides how slot 3 is drawn; it changes no figure. Passed so
  // the result renders the deck the way the paste box does.
  const w = `${wildA ? `&wildA=${wildA}` : ''}${wildB ? `&wildB=${wildB}` : ''}`;
  return get<MatchupReport>(
    `/api/analytics/matchup?a=${encodeURIComponent(a.join(','))}&b=${encodeURIComponent(b.join(','))}${w}`,
  );
}

/** What beats a pasted deck. */
export function fetchCounters(deck: string[], wild?: WildForm | null): Promise<CountersReport> {
  const w = wild ? `&wild=${wild}` : '';
  return get<CountersReport>(
    `/api/analytics/counters?deck=${encodeURIComponent(deck.join(','))}${w}`);
}

/** How a pasted deck DRAWS — slot order plus evolution/hero art, nothing else.
 *
 *  Called the moment a link parses so the preview lands in its real slots
 *  immediately. The alternative was re-implementing `arrange_deck` in
 *  TypeScript, which is a second copy of a decision that has to match the meta
 *  board, the player screens and the PDF exactly. This costs one request that
 *  touches no database. */
export function fetchDrawnDeck(deck: string[], wild?: WildForm): Promise<DrawnDeck> {
  const w = wild ? `&wild=${wild}` : '';
  return get<DrawnDeck>(`/api/analytics/deck?cards=${encodeURIComponent(deck.join(','))}${w}`);
}

export type WildForm = 'evolution' | 'hero';

export interface DrawnDeck {
  /** In the link's own order — a copyDeck link writes the three special slots
   *  first, so that order is the answer rather than something to rebuild. */
  cards: string[];
  art: Record<string, WildForm>;
  inferredArt: boolean;
  avgElixir: number;
  /** The card in slot 3. */
  wildSlot: string | null;
  /** True when that card has BOTH forms, so only the player knows which was
   *  meant — knight, valkyrie, musketeer and wizard. */
  wildChoosable: boolean;
  /** Which form slot 3 is currently drawn as. */
  wild: WildForm | null;
}

export function fetchCoverage(tag?: string): Promise<{
  global: ApiCoverage;
  player: ApiCoverage | null;
}> {
  return get(`/api/analytics/coverage${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`);
}

export function fetchSuggestedTags(): Promise<{
  tags: { tag: string; name: string | null; battles: number }[];
}> {
  return get('/api/analytics/suggest');
}

export function fetchSources(): Promise<ApiSources> {
  return get<ApiSources>('/api/analytics/status');
}

/* ── Coach Assist ─────────────────────────────────────────────────────────
 *
 * Two windows over `server/coach.py`. Both are STEPWISE — the user answers a
 * question, pastes a deck, answers the next — so each step is its own request
 * and the flow state lives in the component. The server holds nothing between
 * calls, which is why a reload lands on question one rather than in a
 * half-finished duel that no longer exists. */

/** A deck the coach is talking about, ready to draw.
 *
 *  `cards` is already in slot order and `art` already says which slots wear
 *  evolution or hero art — same `arrange_deck` every other screen goes
 *  through, so a deck here renders identically to the same deck on the meta
 *  board. */
export interface CoachDeck {
  cards: string[];
  art: Record<string, WildForm>;
  inferredArt?: boolean;
  archetype: string;
  deckName: string;
  avgElixir?: number | null;
  /** Times this deck was seen in the observations being ranked. */
  count?: number;
  /** Share of the candidates — already renormalised over what is shown. */
  prob?: number;
  /** How often it appeared in the same series as the revealed deck. The
   *  ranking is driven by this, so the UI has to show it or the list reads as
   *  mis-sorted against the raw usage figures. */
  coRevealed?: number;
  /** A meta deck used to top up a thin personal list, not one of theirs. */
  fill?: boolean;
  /** Only on recommendations. */
  expected?: CoachExpected | null;
}

export interface CoachMatchup {
  winRate: number;
  games: number;
  /** Which rung of the evidence ladder answered — 'exact' | 'deck' |
   *  'cluster7' | 'cluster6' | 'archetype'. Shown, never hidden: "62%" from
   *  this exact list and "62%" from its archetype are different claims. */
  source: string;
  tier?: string | null;
  decks?: number | null;
}

export interface CoachExpected {
  winRate: number;
  /** Probability mass that actually had evidence behind it. Below 1 means some
   *  of their candidate decks could not be scored and were dropped rather than
   *  guessed at 50%. */
  weight: number;
  per: { cards: string[]; prob: number; matchup: CoachMatchup | null }[];
}

/** One deck inside a recorded duel loadout. */
export interface CoachLoadoutDeck extends CoachDeck {
  /** 1-based position in the loadout. Meaningless unless the group is ordered. */
  game: number;
  result: string;
  /** This is the deck that was pasted — context, not the answer. */
  revealed: boolean;
}

/** A three-deck loadout this player has really run, containing the pasted deck. */
export interface CoachLoadout {
  /** How many recorded duels used this same loadout. */
  times: number;
  wins: number;
  losses: number;
  lastSeen: string;
  seenOn: string[];
  /** The paste matched card-for-card rather than at the 6-of-8 rule. */
  exact: boolean;
  /** Whether the game ORDER is known. False for native duel rows, which store
   *  the loadout in one row without proving the sequence. */
  ordered: boolean;
  /** Which game the pasted deck was, when the order is known. */
  position: number | null;
  games: CoachLoadoutDeck[];
}

/** Their real duel log for the decks shown — not a ranking, a record. */
export interface CoachHistory {
  /** Whole loadouts, most-run first. The answer to "what else does he bring". */
  loadouts: CoachLoadout[];
  /** The decks that travel with it, merged so a tech swap counts once. */
  nextDecks: CoachDeck[];
  matched: number;
  /** How many of the matches have a usable game order. */
  ordered: number;
  /** Duels examined. */
  searched: number;
  searchedFor: number;
}

export interface CoachPrediction {
  tag: string;
  name: string;
  stage: number;
  summary: { series: number; games: number; orderedSeries: number; archiveUsed: boolean };
  /** What the figures were computed over. Absent on an older deployment. */
  window?: { from: string | null; to: string | null };
  decks: CoachDeck[];
  /** Opening only: whether the ranking is game-1 history or overall play rate. */
  basis?: string | null;
  nObs?: number;
  nSeries?: number;
  nGames?: number;
  orderedSeries?: number;
  lowConfidence: boolean;
  /** Games 2 and 3 only. */
  cards?: { card: string; prob: number }[];
  archetypes?: { archetype: string; name: string; prob: number }[];
  observedLoadout?: { times: number; decks: CoachDeck[] } | null;
  history?: CoachHistory | null;
  nCandidates?: number;
  revealed?: CoachDeck[];
}

export interface CoachSuggestion {
  stage: number;
  myTag: string;
  oppTag: string;
  myName: string;
  oppName: string;
  /** Two spans, because each is counted from that player's own last battle. */
  window?: {
    mine: { from: string | null; to: string | null };
    opponent: { from: string | null; to: string | null };
  };
  /** How much play each window actually held — a thin cap must look thin. */
  evidence?: { mySeries: number; myGames: number; oppSeries: number; oppGames: number };
  opponent: { decks: CoachDeck[]; source: string; nCandidates: number };
  recommendations: CoachDeck[];
  best: CoachDeck | null;
  /** 'expected win rate' | 'how much you play it' — which ranking was used. */
  basis: string;
  observedLoadout: { times: number; decks: CoachDeck[] } | null;
  history?: CoachHistory | null;
  myPlayed: CoachDeck[];
  oppPlayed: CoachDeck[];
  notes: string[];
  caveats: string[];
  /** Card-level swaps for the recommended deck. ADMIN-ONLY AND OPT-IN — see
   *  `DECK_TUNER.md`. Absent (not null) unless `swaps=1` was sent, because a
   *  null would read as "no swaps found" where the truth is "nobody asked". */
  tuner?: DeckTuner | null;
}

/** A deck arranged into its slots with its evolution/hero art resolved —
 *  the same shape every other screen draws a deck from. Without it a deck
 *  hash renders in ALPHABETICAL order (a hash IS the sorted card list) with
 *  no evolutions or heroes, which is mis-slotted and identical-looking at
 *  once. */
export interface DeckView {
  cards: string[];
  art: Record<string, WildForm>;
  /** The art was inferred from slot position, not observed on the board. */
  inferredArt: boolean;
}

/** One swap: which card leaves, which arrives, and what the database says. */
export interface TunerSwap {
  /** Already arranged — do not re-sort. */
  deck: string[];
  view: DeckView;
  hash: string;
  /** 7 = one card different, 6 = two. */
  overlap: number;
  out: string[];
  in: string[];
  cards: number;
  /** This deck's own worst matchup across everything it has been measured on. */
  floor: number;
  floorGames: number;
  floorArchetype: string | null;
  /** THE HEADLINE. Measured on `comparedOn` only — see the note below. */
  floorDelta: number | null;
  /** The archetypes BOTH this deck and the base were measured on. A delta
   *  between floors taken over different subsets is not a comparison: a swap
   *  measured on one archetype once scored +36.7 against a base whose worst
   *  matchup was an archetype it had never faced. */
  comparedOn: string[];
  covered: number;
  /** `covered` as a fraction of the archetypes asked about. Discount a
   *  confident number measured on a third of the field. */
  coverage: number;
  baseFloorHere: number | null;
  expected: number | null;
  expectedDelta: number | null;
  weight: number;
  games: number;
  /** True only when every incoming card is one the player has piloted. */
  comfortable: boolean;
  /** The archetype the delta rests on has too few games to act on. Shown
   *  anyway — withholding a real option is worse — but sorted after
   *  everything better evidenced, and labelled. */
  thin: boolean;
  /** Games behind the DELTA specifically, not the deck's lifetime total. */
  deltaGames: number;
}

/** The structural checklist for a deck — what is missing, never a score. */
export interface DeckHarmony {
  ok: boolean;
  /** Hard failures. */
  problems: string[];
  /** Real costs a real deck may accept on purpose. Not failures. */
  notes: string[];
  /** Cards that cannot be classified from a deck list at all — Spirit
   *  Empress, whose form is chosen by the Elixir bar at deployment, and
   *  Mirror. A deck holding one is INCOMPLETELY CHECKED, never passed. */
  unknowns: string[];
  checked: boolean;
  counts: {
    airAnswers: number; air: string[];
    antiSwarm: number; antiSwarmCards: string[];
    splash: number; splashCards: string[];
    winConditions: number; winConditionCards: string[];
    spells: number; smallSpells: number;
    cheap: number; avgElixir: number;
  };
}

/** A whole deck the composer offers, chosen from real played lists. */
export interface ComposedDeck {
  /** Already arranged — do not re-sort. */
  deck: string[];
  view: DeckView;
  hash: string;
  archetype: string;
  /** Its worst matchup across the archetypes it was measured on. */
  floor: number;
  floorGames: number;
  floorArchetype: string | null;
  expected: number | null;
  weight: number;
  covered: number;
  coverage: number;
  games: number;
  /** How many of its eight cards the player has piloted. A count the reader
   *  weighs, never a score — being handed eight unfamiliar cards mid-duel is
   *  a real cost. */
  familiar: number;
}

export interface Composed {
  archetypes: string[];
  decks: ComposedDeck[];
  considered: number;
  skipped: { illegal: number; vetoed: number; no_floor: number; excluded: number };
  vetoed: boolean;
  poolSize: number;
  /** False means the SNAPSHOT has no seeds yet — which is a different thing
   *  from "no good decks", and the two must not look alike on screen. */
  poolReady: boolean;
}

/** Three decks sharing no card, chosen to cover the field BETWEEN them. */
export interface Loadout {
  archetypes: string[];
  decks: ComposedDeck[];
  coverage: {
    archetype: string;
    /** The best of the three against this archetype. */
    best: number | null;
    /** Which deck that was. */
    by: string | null;
    measured: boolean;
  }[];
  /** min over archetype of (max over the three decks). Null when nothing was
   *  measured — never 50%. */
  loadoutFloor: number | null;
  /** Archetypes none of the three has been measured against. A gap in the
   *  EVIDENCE, not a bad matchup. */
  uncovered: string[];
  poolSize: number;
  poolReady: boolean;
  vetoed: boolean;
}

export interface DeckTuner {
  base: {
    hash: string; cards: string[]; view: DeckView;
    floor: number | null; floorGames: number; floorArchetype: string | null;
    expected: number | null; weight: number; games: number;
    /** False when nobody has played this exact list enough to measure it, in
     *  which case every delta above is null rather than a comparison against
     *  nothing. */
    measured: boolean;
  };
  archetypes: string[];
  weights: Record<string, number>;
  swaps: TunerSwap[];
  considered: number;
  siblings: number;
  scanned: number;
  skipped: { swap_too_big: number; illegal: number; vetoed: number; no_floor: number };
  /** Whether the composition checklist ran at all. */
  vetoed: boolean;
  minGames: number;
  swapMinGames: number;
  /** How many of the swaps shown are thin. */
  thin: number;
  maxSwap: number;
  harmony: DeckHarmony;
  /** Mode B — whole decks, chosen from real played lists rather than swapped
   *  into. Null when the composer failed; check `poolReady` for "the snapshot
   *  has no seeds yet". */
  compose?: Composed | null;
  loadout?: Loadout | null;
}

/** Window 1 — which decks this player will bring. No revealed decks asks about
 *  the opening; one or two asks what is left for game 2 or 3. */
export function fetchCoachPrediction(
  tag: string, revealed: string[][], win?: DateWindow,
): Promise<CoachPrediction> {
  /* WINDOWED. This read the player's whole stored history, which answers a
     different question from the one a duel asks: what someone ran daily six
     weeks ago counted exactly as much as what they ran this morning. The
     window is optional so the signature stays compatible; the server defaults
     to 30 days, the same as every other player screen. */
  const q = new URLSearchParams(win ? windowQuery(win) : undefined);
  revealed.forEach((d, i) => q.set(`r${i + 1}`, d.join(',')));
  const qs = q.toString();
  return get<CoachPrediction>(
    `/api/analytics/coach/predict/${encodeURIComponent(tag)}${qs ? `?${qs}` : ''}`,
  );
}

/** Window 2 — what to play next. `opp` may be empty: the read then falls back
 *  to meta decks and says so, which is a weaker answer rather than none. */
export function fetchCoachSuggestion(
  me: string, opp: string, myPlayed: string[][], oppPlayed: string[][],
  win?: DateWindow, swaps?: boolean,
): Promise<CoachSuggestion> {
  /* ONE `days` covers BOTH players, and the server resolves it separately
     against each one's own coverage — so this is thirty days of each player's
     play, not one calendar range that may be empty for whichever of them
     stopped sooner. */
  const q = new URLSearchParams(win ? windowQuery(win) : undefined);
  q.set('me', me);
  if (opp) q.set('opp', opp);
  myPlayed.forEach((d, i) => q.set(`m${i + 1}`, d.join(',')));
  oppPlayed.forEach((d, i) => q.set(`o${i + 1}`, d.join(',')));
  /* OPT-IN, AND ONLY EVER FOR AN ADMIN. The swap scan walks every stored deck
     hash, so sending this by default would put a multi-second cost on the one
     screen people use mid-duel. The caller decides; nothing here infers it. */
  if (swaps) q.set('swaps', '1');
  return get<CoachSuggestion>(`/api/analytics/coach/suggest?${q.toString()}`);
}

/* ────────────────────────────────────────────────────────────────────────
   OPPONENT READ — Phase 19B
   ────────────────────────────────────────────────────────────────────────
   A SEPARATE request on purpose. This used to ride along on /coach/predict,
   which made the whole screen wait on a cold spinning-disk read (~2.5s p95
   under bot write load) for a purely additive enhancement.

   Eighteen phases of measurement produced one shippable claim: the most
   recent deck is the prediction, and a confidence band on it carries real
   information (duel 92.1% high vs 47.3% low, held out). The alternatives are
   NOT forecasts and the UI must never present them as such.

   This never rejects. Disabled, slow, failed, offline — the caller gets
   `null` and renders nothing, because the Coach is already complete without
   it. */

export interface OpponentAlternative {
  cards: string[];
  out: string[];
  in: string[];
  confidence: string;
  evidence: string[];
}

/** PHASE 23. `changeProbability` used to be here and is gone (FIX 1): it is a
 *  logistic score, i.e. a model internal, and it is the same score measured at
 *  ECE 0.2806 competitive / 0.6097 practice — both internal and wrong.
 *
 *  `confidence` is now OPTIONAL and `bandShown` says whether it is present
 *  (FIX 3). A band is only sent for a domain whose ordering has been validated
 *  against real outcomes; the practice population's does not hold, so it
 *  arrives without one and the panel must render without one. */
export interface OpponentRead {
  primary: { cards: string[]; confidence?: string; basis: string };
  alternatives: OpponentAlternative[];
  note: string;
  degraded: boolean;
  bandShown: boolean;
}

/** How long the client waits before giving up. Chosen from the measured cold
 *  read (Phase 19A: p95 ~2.5s under write load), with headroom — long enough
 *  that a slow disk still lands, short enough that a hung request does not
 *  leave a skeleton on screen forever. */
export const OPPONENT_READ_TIMEOUT_MS = 6000;

export type OpponentReadOutcome =
  | { kind: 'read'; read: OpponentRead }
  | { kind: 'disabled' }
  | { kind: 'timeout' }
  | { kind: 'error' };

/**
 * PHASE 24C, STEP 3. This is the one analytics call that does NOT use `BASE`.
 *
 * Every other endpoint may be pointed straight at a remote host with
 * `VITE_ANALYTICS_BASE`. This one must not be: it goes through the same-origin
 * Vercel function at `api/analytics/opponent-read/[tag].ts`, which is what
 * attaches the upstream key server-side. Honouring `BASE` here would ask the
 * browser to authenticate to the analytics service itself, and the browser is
 * precisely who must never hold that key.
 *
 * The `credential` is a **Supabase access token** — `CoachAssist` reads it from
 * `supabase.auth.getSession()`. It used to be the `sha256(username:password)`
 * the deck sync used, and that scheme is gone from the whole project: it could
 * not describe anyone who signed themselves up, and a password derivative used
 * as a bearer credential never expires and cannot be revoked without changing
 * the password. The proxy verifies the token, maps it to an account and checks
 * the OIE allowlist. Without one the proxy answers 401 and the panel renders
 * nothing, which is the correct state for a signed-out reader.
 */
export async function fetchOpponentRead(
  tag: string,
  credential: string | null = null,
  timeoutMs = OPPONENT_READ_TIMEOUT_MS,
): Promise<OpponentReadOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `/api/analytics/opponent-read/${encodeURIComponent(tag)}`,
      {
        signal: ctrl.signal,
        ...(credential ? { headers: { Authorization: `Bearer ${credential}` } } : {}),
      },
    );
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json()) as { enabled: boolean; read: OpponentRead | null };
    if (!body?.enabled || !body.read) return { kind: 'disabled' };
    return { kind: 'read', read: body.read };
  } catch (e) {
    return (e as Error)?.name === 'AbortError' ? { kind: 'timeout' } : { kind: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────────────────────────────────────────────────────
   TEAM ANALYSIS — two rosters in, a folder per opponent out.
   server/team_analysis.py is the shape below; see its docstring for what the
   scoring rule is and, more importantly, what it refuses to claim.
   ──────────────────────────────────────────────────────────────────────── */

/** How well a roster member could be read at all.
 *
 *  `stored` — the bot has been collecting them; the real thing.
 *  `live`   — never tracked, so the ~25-battle CR API log answered and the tag
 *             was queued. Thin, and the screen must say so.
 *  `unknown`— not tracked and the live API could not be reached either. No
 *             decks, and the reason stated rather than an empty folder.
 */
export type TeamBasis = 'stored' | 'live' | 'unknown';

export interface TeamMember {
  tag: string;
  name: string;
  basis: TeamBasis;
  battles: number;
  winRate: number;
  decks: number;
  tracking: TrackingState;
  window: { from: string | null; to: string | null };
}

/** One archetype in an opponent's spread, weighted by how much they play it. */
export interface TeamSpreadRow {
  archetype: string;
  name: string;
  style: string;
  games: number;
  weight: number;
  /** Percentage of the decks considered — the weight, as it is displayed. */
  share: number;
}

/**
 * WHY A PROJECTED THREAT IS IN THE LIST.
 *
 * These three never convert into one another, and that is the single most
 * important property of the whole payload. `OBSERVED` is a deck the opponent
 * was actually seen playing; `VARIANT` is a real deck close enough to one of
 * those to be a version of it; `INFERRED` is an archetype their behaviour
 * implies. An inferred deck carries `observedCount: 0` and no `lastSeen`, so
 * it cannot present itself as something that was watched happening.
 */
export type ThreatEvidence = 'OBSERVED' | 'VARIANT' | 'INFERRED';

/** How much is actually known, in the order of how much that is. */
export type ScoutConfidence = 'known' | 'likely' | 'possible' | 'speculative';

/** Why one of OUR decks is on the list. */
export type RecommendationType = 'COUNTER' | 'ROBUST' | 'CONTINGENCY';

/**
 * ONE DECK THE OPPONENT MIGHT BRING.
 *
 * The projection, not the history — `TeamFolder.theirDecks` and `spread` are
 * still the history. Likelihoods across a folder's `threats` sum to 1.0.
 */
export interface TeamThreat {
  /** Order-free deck identity, matching the server's deck hash. */
  key: string;
  /** SEATED: evolution, hero, wild first (`arrange_deck`). */
  cards: string[];
  art: Record<string, WildForm>;
  artInferred?: boolean;
  archetype: string;
  name: string;
  evidence: ThreatEvidence;
  /** Share of the projected pool. The `threats` array sums to 1.0. */
  likelihood: number;
  /** Battles this deck was actually seen in. ZERO for anything generated. */
  observedCount: number;
  wins: number;
  winRate: number | null;
  /** NULL for anything generated — never a guessed date. */
  lastSeen: string | null;
  /** 1.0 for an observed deck, the card overlap for a variant, 0 for inferred. */
  similarityToObserved: number;
  /** For a VARIANT: the key of the observed deck it is a version of. */
  basis: string | null;
  basisName?: string;
  /** For a VARIANT: shared cards out of eight. */
  overlap?: number;
  /** For an INFERRED entry: `own_archetype` or `meta`. */
  why?: string;
  confidence: ScoutConfidence;
}

/** How much this opponent deviates from their own most-played decks. */
export interface TeamChurn {
  /** Share of the projection that is NOT their observed decks. */
  switch: number;
  /** 1 - Herfindahl over their deck shares. Null with no history. */
  diversity: number | null;
  decks: number;
  games: number;
  /** `measured` once there is enough play; `thin` while the prior dominates;
   *  `none` with nothing at all. A thin read produces a WIDER projection. */
  evidence: 'measured' | 'thin' | 'none';
}

/** One candidate deck against one archetype of the opponent's spread. */
export interface TeamMatchupRow {
  archetype: string;
  name: string;
  share: number;
  /** The projected threat this row answers, and how much of the pool it is.
   *  Absent only on a payload from a server that predates the coaching brain. */
  threat?: string;
  evidence?: ThreatEvidence;
  likelihood?: number;
  /** NULL when no rung of the ladder had evidence. Withheld, never 50. */
  winRate: number | null;
  source: string | null;
  sourceText?: string;
  /** The denominator behind `winRate`. Named `games` because that is what
   *  every rung of the matchup ladder publishes — see the note in
   *  `team_analysis._score`. */
  games: number;
  tier: 'high' | 'medium' | 'low' | null;
  interval?: string | null;
  decks?: number | null;
}

/**
 * A deck to bring, and — in a match plan — who on the squad already plays it.
 *
 * `owner` AND `comfort` ARE NULL IN A SCOUTING REPORT, and that is a state
 * rather than a gap: the candidate there is an archetype representative, which
 * is nobody's deck. A zero games-piloted figure would read as "somebody on the
 * team has played this none of the time", which is a claim about a roster that
 * was never pasted. Anything rendering a recommendation has to handle both.
 */
export interface TeamRecommendation {
  /** SEATED: evolution, hero, wild first (`arrange_deck`). */
  cards: string[];
  art: Record<string, WildForm>;
  /** The forms were read from the cards' capability, not observed — every
   *  seed-pool deck ("Deckkies pick", scouting rows) unless the meta board
   *  holds the exact list. */
  artInferred?: boolean;
  archetype: string;
  name: string;
  avgElixir: number;
  /** NULL in a scouting report — see above. */
  owner: { tag: string; name: string } | null;
  /** NULL in a scouting report. With no owner there is nothing to be practised at. */
  comfort: {
    games: number;
    wins: number;
    winRate: number;
    useRate: number;
    /** What the practice tiebreak was worth here, in points. */
    bonus: number;
  } | null;
  /** Spread-weighted expected win rate against this opponent. The headline.
   *  IDENTICAL to `matchupValue`; kept under both names so a reader written
   *  against the old payload is not broken by a rename carrying no new
   *  information. */
  expectedWinRate: number;
  /** How much of their play that figure actually covers, as a percentage. */
  spreadCovered: number;
  score: number;
  /** The per-threat evidence. ONLY ON A FOLDER'S TOP PICK now — the PDF is
   *  its one reader, and every other copy was 80% of a match plan's payload
   *  (`_evidence_on_top` in `server/team_analysis.py`). Absent everywhere else,
   *  and on saves compacted by `compactReport`. */
  matchups?: TeamMatchupRow[];

  /* ── THE COACHING BRAIN'S SEPARATED SIGNALS ──────────────────────────────
   *
   * All optional, because a deployment can be mid-upgrade: the frontend ships
   * from a git push in a minute and `server/` is copied by hand, so there is
   * always a window where the two halves disagree. A reader that requires
   * these would blank the screen during it.
   *
   * THE POINT OF THEM IS THAT THEY STAY APART. One scalar could not express
   * "they will probably bring this, and you should prepare something else" —
   * likelihood was multiplied into the win rate and the two could never be
   * read separately again. */

  /** How well it does against the projection. Same number as `expectedWinRate`. */
  matchupValue?: number;
  /** Share of the projected threat mass this figure was measured over, 0..1.
   *  `spreadCovered` is the same quantity as a percentage. */
  threatCovered?: number;
  /** What rungs of the evidence ladder those measurements came off, 0..1.
   *  1.0 is exact pair records; 0.25 is the archetype matrix. */
  evidenceStrength?: number;
  /** How practised our player is on it, 0..1. NULL when nobody owns it —
   *  a scouting row has no owner, and a zero would claim somebody has piloted
   *  it none of the time. */
  playerFit?: number | null;
  /** The composite the list is ranked on, before the diversity penalty. */
  recommendationScore?: number;
  /** Similarity to the highest-ranked deck already chosen, 0..1. */
  redundancy?: number;
  /** `recommendationScore` after the redundancy penalty. What decided the order. */
  adjustedScore?: number;
  /** Why this deck is on the list — read from which KINDS of threat it beats. */
  type?: RecommendationType;
  confidence?: ScoutConfidence;
  /** One sentence, assembled from the evidence fields above and nothing else. */
  explanation?: string;
  /** The brain that produced it. */
  brain?: string;
  /**
   * A TOP-UP, NOT ONE OF THE SQUAD'S OWN DECKS.
   *
   * Set only on the per-teammate board, when that teammate's own qualifying
   * decks could not fill the list. It is the same device `coach._fills`
   * marks a population deck with, and it means something narrower than a
   * missing `owner`: a scouting report's rows are ownerless too and are NOT
   * fills. "Nobody plays this" and "nobody on YOUR SQUAD plays this" are
   * different claims and the screen has to be able to tell them apart.
   *
   * A fill is always appended, never ranked above an owned deck.
   */
  fill?: boolean;
  /**
   * SCOUT ONLY: this deck's own win rate across the whole field.
   *
   * The denominator the headline is missing on its own. A deck expected to win
   * 58% here while winning 57% against everybody is barely a counter; the same
   * 58% against a 49% baseline is a real answer. Shipped as two numbers rather
   * than a subtraction so each can be read on its own terms.
   */
  overallWinRate?: number | null;
  overallGames?: number | null;
}

/** One blue player's options against one opponent. */
export interface TeamPlayerOptions {
  owner: { tag: string; name: string };
  basis: TeamBasis;
  /** Their own best decks against this opponent, best first, diversified,
   *  at most `limits.perPlayerTopN`. */
  decks: TeamRecommendation[];
  /** How many of their decks could be scored at all. */
  considered: number;
  /**
   * `no_history` — nothing stored for them.
   * `no_comfort` — nothing played often enough to count as a deck they run.
   * `no_evidence` — decks, but no measured record against what this opponent
   *                 brings. Three different problems, so the row says which.
   */
  reason: 'no_history' | 'no_comfort' | 'no_evidence' | null;
}

/** One opponent's folder: what they play, and what to bring against them. */
export interface TeamFolder {
  player: {
    tag: string;
    name: string;
    basis: TeamBasis;
    battles: number;
    winRate: number;
    tracking: TrackingState;
    coverage: ApiCoverage;
    window: { from: string | null; to: string | null };
  };
  /** LEFT side of an opened folder: the decks they actually play. */
  theirDecks: ApiDeck[];
  /** Their archetype breakdown — what they HAVE played. Still the history. */
  spread: TeamSpreadRow[];
  /**
   * THE PROJECTION — what they are likely to BRING.
   *
   * Their observed decks, real variants of them, and the archetypes their
   * behaviour implies, as a distribution summing to 1.0. This is what
   * `recommended` was scored against, published so the reasoning can be
   * checked rather than taken on faith.
   *
   * Optional: a server predating the coaching brain sends no `threats`, and
   * the screen falls back to drawing `spread` alone.
   */
  threats?: TeamThreat[];
  /** How much this opponent deviates from their own most-played decks. */
  churn?: TeamChurn;
  /** The projection's split by evidence kind. Sums to 1.0. */
  mass?: { observed: number; variant: number; inferred: number };
  /** The squad-wide portfolio, deduplicated by deck — 5 to 7, diversified so
   *  it covers the threat space rather than repeating its best answer. It may
   *  be SHORTER than five rather than pad the list with weak options. */
  recommended: TeamRecommendation[];
  /** The brain that produced this folder. */
  brain?: string;
  /**
   * RIGHT side of the board: one row per blue player, in roster order, each
   * holding THAT player's own diversified portfolio against this opponent.
   *
   * Every teammate appears even when they have nothing to offer — a roster of
   * five must not render as a roster of three — and `reason` says which of the
   * three empty states it is.
   */
  perPlayer: TeamPlayerOptions[];
  considered: number;
  /** Why there is nothing to show, when there is nothing to show. */
  reason: 'no_history' | 'no_evidence' | null;
}

/**
 * Which of the screen's two modes produced a report.
 *
 * `squads` — Match Plan. Both rosters; every recommendation has an owner.
 * `scout`  — Scouting Report. One roster; the pool is the archetype
 *            representatives, so no recommendation has an owner.
 *
 * READ THIS, NEVER INFER IT from an empty `blue`, which is also what a failed
 * roster resolution produces.
 */
export type TeamMode = 'scout' | 'squads';

/**
 * SCOUT ONLY: the opposing roster taken as one spread.
 *
 * The question a scouting report can ask and a match plan cannot — *we play
 * this clan next week, what should we be practising* — because a match plan
 * assigns a person to each opponent and a squad-wide answer would be advice
 * with nobody to take it.
 */
export interface TeamOverall {
  players: number;
  spread: TeamSpreadRow[];
  /** The whole roster pooled into ONE projection. Same shape as a folder's. */
  threats?: TeamThreat[];
  churn?: TeamChurn;
  mass?: { observed: number; variant: number; inferred: number };
  recommended: TeamRecommendation[];
  reason: 'no_history' | 'no_evidence' | null;
  brain?: string;
}

export interface TeamReport {
  /** Absent on a report from a server that predates the two modes. */
  mode?: TeamMode;
  blue: TeamMember[];
  red: TeamMember[];
  folders: TeamFolder[];
  /** Present in scout mode only. */
  overall?: TeamOverall;
  pool: {
    decks: number;
    /** `no_matchup_data` is the scout mode failure: the server's matchup
     *  snapshot is still building. Nothing the reader did, and fixed by
     *  waiting rather than by pasting more. */
    reason: 'no_blue_history' | 'no_blue_comfort' | 'no_matchup_data' | null;
    minGames: number;
  };
  days: number;
  limits: {
    maxSquad: number;
    topN: number;
    /** Absent on a server that predates the two modes. */
    scoutTopN?: number;
    /** The per-teammate board's cap. Smaller than `topN` on purpose — the
     *  squad-wide list answers "what should be practised", this answers "what
     *  should Ravi bring", and ten teammates at seven rows each is a wall. */
    perPlayerTopN?: number;
    /** The floor a portfolio aims for. A folder may still return FEWER, and
     *  that is the list refusing to pad itself rather than a fault. */
    minRecommendations?: number;
    minComfortGames: number;
    minOpponentDeckGames: number;
  };
  /** The coaching brain that produced this report. Absent on a server that
   *  predates it, which is how a client tells the two payload shapes apart. */
  brain?: string;
  /** Tags the server could not read, per side. Named so a paste can be fixed. */
  rejected: { blue: string[]; red: string[] };
  status: CounterStatus;
  sources: ApiSources;
}

/**
 * Analyse two squads against each other, or scout one roster on its own.
 *
 * THE MOST EXPENSIVE CALL THIS CLIENT MAKES — up to twenty player resolutions
 * and a profile of every deck the blue squad plays — so it is fired by a
 * button, never by typing. The tags are sent already normalised, and the server
 * normalises them again: the client copy is what makes chips appear before the
 * call is spent, not a boundary.
 *
 * AN EMPTY `blue` IS THE SCOUTING REPORT, and it is the same endpoint. The two
 * modes take the same inputs minus one and return the same shape plus one
 * field, so a second route would have been a second thing to deploy by hand to
 * the VPS and a bump of the route-count tripwire, for one optional parameter.
 * `blue` is omitted from the query string entirely rather than sent empty —
 * `blue=` and no `blue` at all parse identically server-side, and sending the
 * key would imply a roster that was cleared rather than never given.
 */
export function fetchTeamAnalysis(
  blue: string[], red: string[], days = 30,
): Promise<TeamReport> {
  const q = new URLSearchParams({ red: red.join(','), days: String(days) });
  if (blue.length) q.set('blue', blue.join(','));
  return get<TeamReport>(`/api/analytics/teams?${q.toString()}`);
}

/* ── 2v2 teammate deck pairs ──────────────────────────────────────────────
 *
 * THESE TYPES MOVED HERE FROM `adminStore.ts` WHEN THE BOARD STOPPED BEING AN
 * ADMIN SECTION. The data was never operator-only — it is what people play in
 * 2v2 — and leaving its vocabulary in the console's store would have meant the
 * public screen importing from a module that constructs a Supabase client and
 * lists every account.
 */

/** One deck inside a 2v2 partnership. */
export interface DuoDeck {
  /** `2v2d:<sha1 of the sorted card keys>`. Order-free by construction. */
  fingerprint: string;
  /** SEATED ORDER — evolution, hero, wild first, by `arrange_deck`. The
   *  fingerprint is still taken over the sorted keys; only the drawing order
   *  is seated. */
  cards: { key: string; id: number; name: string; elixir: number }[];
  cardKeys: string[];
  cardIds: number[];
  avgElixir: number;
  /** Which of the three special slots draws evolution or hero art. Optional:
   *  an API that predates seating sends neither this nor `artInferred`. */
  art?: Record<string, 'evolution' | 'hero'>;
  /** The forms were read from what the cards can be, not observed — the
   *  collection keeps no per-battle marks, so this is set unless the meta
   *  board happens to hold the exact list. */
  artInferred?: boolean;
}

/**
 * One unique 2v2 PARTNERSHIP — two teammate decks played together.
 *
 * THE UNIT IS THE PAIR, NOT THE DECK. A 2v2 battle is four players and four
 * decks, and what a 2v2 player actually chooses is a partnership. The identity
 * is order-free at both levels: the eight cards of a deck sort, and the two
 * deck fingerprints sort, so `A + B` and `B + A` are one record.
 */
export interface DuoPair {
  /** `2v2:<sha1 of mode + the two sorted deck fingerprints>`. */
  pairFingerprint: string;
  mode: string;
  deckA: DuoDeck;
  deckB: DuoDeck;
  /** How many REAL battles used this partnership. One battle is one
   *  occurrence even when several tracked participants each stored it. */
  occurrences: number;
  /** Exact count of distinct participants. */
  players: number;
  /** A capped SAMPLE for reconciliation, not the roster — `players` is the
   *  count. */
  playerTags: string[];
  firstSeen: string;
  lastSeen: string;
  sourceModes: string[];
  /** Both teammates on the same list. A real pairing, not an error. */
  mirror: boolean;
}

export interface DuoReport {
  pairs: DuoPair[];
  page: number;
  pages: number;
  perPage: number;
  total: number;
  query: string;
  /** Which ordering produced this page. Echoed back because the server may
   *  refuse an unrecognised key and fall back — the control must show what it
   *  actually got, not what it asked for. */
  sort: string;
  /** Which card keys the server accepted and filtered by. Echoed back for the
   *  same reason `sort` is: an unknown key is dropped rather than refused, so a
   *  control drawing its chips from what it SENT could show a card the board is
   *  not actually filtered by. */
  cards?: string[];
  /** The closed vocabulary of orderings the server will accept. */
  sorts: string[];
  summary: {
    mode: string;
    uniquePairs: number;
    occurrences: number;
    battlesFolded: number;
    firstSeen: string;
    lastSeen: string;
    sourceModes: string[];
    builtAt: string;
    /** NEVER BUILT is not the same as BUILT AND EMPTY. */
    built: boolean;
    /** Every 2v2 row still in `battles` — phase 1 deletes nothing. */
    rows2v2: number;
    /** How many of those have a surviving raw payload, so their partnership
     *  could be recovered at all. */
    reconstructable: number;
    /** ...and how many do not. Their second deck is gone for good and is NOT
     *  represented on this board. Reported, never fabricated. */
    unreconstructable: number;
    /** 1 while `battles` still holds 2v2. */
    phase: number;
    /** Every 2v2 participant ever seen — the lightweight tier, kept for all. */
    participants: number;
    /** ...and the bounded set whose expensive per-battle detail is retained.
     *  The board shows partnerships from the whole collection; this says which
     *  players it keeps a history for, so the page cannot be mistaken for a
     *  complete census of 2v2. */
    population: number;
    populationLimit: number;
    /** Distinct-battle count at the population boundary. "Top 1,000" says how
     *  many; this says how good you had to be. */
    populationCut: number;
  };
}

/**
 * One page of the unique 2v2 partnerships.
 *
 * EVERY CONTROL IS A SERVER PARAMETER. There are over a million pairs, so
 * paging, ordering and filtering all happen in SQL — filtering what one page
 * returned would silently answer for 25 rows while appearing to answer for the
 * collection. `sort` goes through a closed vocabulary on the server and every
 * card key is checked against the catalog there, which is why the response
 * echoes back both.
 *
 * `cards` means EVERY card in ONE deck of the pair, not "somewhere in the
 * partnership" — asking for Hog Rider and Fireball is a question about a deck,
 * and satisfying it with one card in each teammate's list would match almost
 * everything.
 */
export function fetchDuoPairs(
  page = 1, per = 25, cards: readonly string[] = [], sort = 'played',
): Promise<DuoReport> {
  const q = new URLSearchParams({
    page: String(page), per: String(per), sort,
  });
  if (cards.length) q.set('cards', cards.join(','));
  return get<DuoReport>(`/api/analytics/duo-pairs?${q.toString()}`);
}

/* ── The field plan: what to play with no opponent ────────────────────────
 *
 * `server/coach_daily.py`. The meta board becomes a threat projection, that
 * projection is reweighted by where this player measurably loses, and
 * `team_scout.score()` — the SAME engine Team Analysis uses — ranks ~204 real
 * decks against it. No model, no second scorer.
 *
 * `basis` is the load-bearing field: 'weighted' when their own record moved
 * the projection, 'unweighted' when they have history but nothing clears the
 * evidence floor, 'no_history' when there is none, and 'none' when the meta
 * snapshot is still building. A client that renders all four the same way is
 * claiming a plan was tailored when it was not.
 */
export interface FieldThreat {
  key: string;
  cards: string[];
  art?: Record<string, WildForm>;
  artInferred?: boolean;
  archetype: string;
  name: string;
  evidence: string;
  confidence: string;
  likelihood: number;
  useRate?: number;
  players?: number;
  /** 1.0 when this player's record did not move it. Never absent. */
  boost: number;
  /** Their own record against this archetype, or null when it is below the
   *  evidence floor — which is NOT the same as an even record. */
  playerRecord: { battles: number; winRate: number; deficit: number } | null;
}

export interface FieldPick {
  key: string;
  cards: string[];
  art?: Record<string, WildForm>;
  artInferred?: boolean;
  archetype: string;
  name: string;
  expectedWinRate: number;
  matchupValue: number;
  spreadCovered: number;
  threatCovered: number;
  evidenceStrength: number;
  confidence: string;
  /** True when this deck is in the plan BECAUSE of the weighting — absent
   *  from the ranking the unweighted field produces. */
  fromWeighting: boolean;
}

/** One window's record against one archetype, beside the window before it.
 *
 *  `direction` is the honest part. 'flat' means the two records are
 *  INDISTINGUISHABLE at these sample sizes, not that nothing changed —
 *  `change` survives it and is shown. 'thin' and 'unseen' are not movements
 *  at all: they say the player stopped meeting this deck often enough to be
 *  judged against it, which is a fact about the field and not about them. */
export interface ProgressMatchup {
  archetype: string;
  name: string;
  now: { battles: number; winRate: number | null };
  before: { battles: number; winRate: number | null };
  /** Points below their own overall rate. Positive means worse here. */
  deficitNow: number | null;
  deficitBefore: number | null;
  /** Points, raw. Null when a window is under the floor. */
  change: number | null;
  /** The width below which a difference this size is noise. Grows as the
   *  evidence thins, which is why a fixed threshold is not used. */
  band: number | null;
  direction: 'up' | 'down' | 'flat' | 'thin' | 'unseen';
  /** The gap closed AND the record itself measurably rose. Both, because a
   *  deficit also closes when everything else gets worse. */
  resolved: boolean;
}

/** This window measured against the one before it.
 *
 *  RECOMPUTED FROM THE BATTLES, not read from a stored daily snapshot — so it
 *  answers for history that predates the feature and cannot drift from its own
 *  window. Opt-in via `compare`, because it costs a second battle pass and the
 *  roster-wide read fetches one plan per player. */
export interface FieldProgress {
  window: { from: string | null; to: string | null };
  previous: { from: string | null; to: string | null };
  /** Battles needed in EACH window before anything is compared. */
  floor: number;
  comparable: boolean;
  /** Why not, when it is not: 'no_window' | 'thin_now' | 'thin_before'. Which
   *  side is short matters — "you have not played enough yet" and "there is
   *  nothing before this" read completely differently. */
  reason: string | null;
  overall: {
    now: { battles: number; winRate: number | null };
    before: { battles: number; winRate: number | null };
    change: number | null;
    band: number | null;
    direction: 'up' | 'down' | 'flat' | null;
  } | null;
  /** The union of both windows' weaknesses, worst standing deficit first —
   *  so one that has CLOSED is still listed, which is the best thing this can
   *  report. */
  matchups: ProgressMatchup[];
}

export interface FieldPlan {
  tag: string;
  brain: string;
  basis: 'weighted' | 'unweighted' | 'no_history' | 'none';
  reason: string | null;
  window: { from: string | null; to: string | null };
  battles: number;
  winRate: number | null;
  threats: FieldThreat[];
  /** The deficits that moved the projection, worst first. Empty is a real
   *  answer: nothing cleared the floor. */
  weighted: { archetype: string; name: string; battles: number; winRate: number; deficit: number }[];
  recommendations: FieldPick[];
  /** How many picks the weighting actually put there, measured by ranking the
   *  UNWEIGHTED projection as well. Live it is 0-1 of 7, which is why the
   *  screen reports it rather than implying more. */
  tailoredPicks: number;
  /** Absent in `brief` mode — it is only the evidence for `tailoredPicks`. */
  baselinePicks?: string[];
  brief?: boolean;
  /** What the meta's own direction did to the projection. `applied` is false
   *  under the history floor, and `reason` says so — it switches itself on
   *  once enough days are stored. */
  trend?: {
    applied: boolean;
    reason: string | null;
    days: number | null;
    moved: number;
  };
  /** Present only when the call asked to `compare`. */
  progress?: FieldProgress;
  pool: number;
  meta: { decks: number; window: unknown; computedAt: number | null };
}

/** What this player should practise against the field. No opponent.
 *
 *  `brief` trims the payload for a roster-wide read — the threats keep their
 *  names and shares but lose their card lists, and only the top pick keeps its
 *  cards. Measured live: 38.9 kB -> 8.8 kB, with identical picks, order, rates
 *  and likelihoods. It is a PROJECTION of the same answer, so a brief row can
 *  never disagree with the full screen. */
export function fetchFieldPlan(
  tag: string,
  win: DateWindow & { brief?: boolean; compare?: boolean } = {},
): Promise<FieldPlan> {
  const { brief, compare, ...window } = win;
  const q = new URLSearchParams(windowQuery(window));
  if (brief) q.set('brief', '1');
  // A SECOND BATTLE PASS, so it is asked for rather than assumed. A
  // roster-wide read fetches one plan per player and would double every one
  // of them to draw a figure it does not show.
  if (compare) q.set('compare', '1');
  return get<FieldPlan>(`/api/analytics/coach/field/${encodeURIComponent(tag)}?${q.toString()}`);
}
