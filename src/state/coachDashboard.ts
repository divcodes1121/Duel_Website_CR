/**
 * COACH ROSTER — THE PLAYER DASHBOARD: the pure half.
 *
 * NO IMPORTS, the `tiers.ts` / `coachInsights.ts` rule. What a coach is shown
 * about a player is the part most worth testing, and it has to be testable
 * without a store, a client or React.
 *
 * ── `/api/analytics/counter/<tag>` IS NOT USED HERE, AND THAT WAS THE WHOLE
 *    DESIGN DECISION OF THIS PHASE ────────────────────────────────────────
 *
 * It looked like the biggest unrealised asset in the project: it already
 * answers "what beats this player" with a `diff` against their own average, a
 * confidence `tier`, an `interval` and average crowns both ways — none of
 * which the Coach Roster has ever shown. Then its query was read:
 *
 *     SELECT ... FROM battles
 *     WHERE player_tag = ? AND battle_time >= ? AND battle_time <= ?
 *
 * **No mode filter at all.** Measured live on one roster player over the same
 * window: `/counter` reports 872 battles at 62.0%, `coach_intel` reports 710
 * at 60.3%. The difference is 2v2, drafts and events.
 *
 * That is EXACTLY the fault Phase 2 of this roster fixed — "the report counts
 * 2v2, so Phase 1's live tiles were mostly 2v2" — and the fix was the rule
 * that every battle figure on this screen comes from `coach_intel`, which
 * routes modes before the deck pipeline touches a row. Putting a `/counter`
 * card reading "62.0% overall" beside a metric card reading "60.3%" would
 * reintroduce it in a form that looks like a rounding bug rather than two
 * populations.
 *
 * So the matchup cards below are computed from `coach_intel`'s OWN
 * `opponentArchetypes`, and the whole screen counts one set of battles.
 * Fixing `player_counter` to route modes would change the PUBLIC Deck Counter
 * screen's numbers too, which is a separate decision and not this phase's.
 *
 * ── WHAT IS STILL BORROWED, AND HOW IT IS FOOTED ───────────────────────────
 *
 * `/api/analytics/cards/<tag>` is used for card movement, because it computes
 * `winDelta` against the equally long window before this one and nothing else
 * on the site does. It is requested with `mode=ranked` (`ranked1v1*`/`ladder*`
 * prefixes, so 2v2 cannot enter) and the block SAYS it is ranked-only —
 * a narrower population than the rest of the screen, named where it is drawn,
 * which is this project's standing rule for a second footing.
 *
 * ── THE RING IS ABOUT THE EVIDENCE, NOT THE PLAYER ─────────────────────────
 *
 * `ScoreDonut` requires a caption precisely because a bare number in a ring
 * reads as a mark out of a hundred, and the roster's contract forbids a
 * readiness score by name. Two candidates were rejected before the one that
 * ships:
 *
 *   - "matchups they win more often than average" — roughly half of them, by
 *     construction. A figure that cannot vary is decoration, which this
 *     project has already recorded twice (`type`/`confidence` in Team Scout).
 *   - "weaknesses outstanding" — a ring that is FULLER when things are WORSE.
 *
 * What ships is EVIDENCE COVERAGE: how many of the archetypes this player
 * actually faces have enough battles behind them to be judged at all. It is a
 * count over a count, it describes the DATA rather than the person, and it
 * varies enormously across a real roster — measured live, one player was 0 of
 * 15 and another 12 of 17. On a 17-battle player it is also the single most
 * important thing on the screen: nothing below it can be trusted yet, and the
 * ring says so before the coach reads a percentage.
 */

/* ── inputs, declared structurally so this file imports nothing ─────────── */

/** One archetype they faced, straight out of `coach_intel.opponentArchetypes`. */
export interface DashArchetype {
  name: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface DashCard {
  key: string;
  battles: number;
  useRate: number;
  winRate: number;
  tiered: boolean;
  tier: 'high' | 'medium' | 'low' | null;
  useDelta?: number;
  winDelta?: number;
  /** Battles behind the PREVIOUS window's rate. See `cardMovers`. */
  prevBattles?: number;
}

export type DashTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

/* ── floors, named so a reader can see what a figure needed to exist ────── */

export const DASH = {
  /** Battles behind an archetype before it is judged. Matches
   *  `coachInsights.FLOORS.matchup`, deliberately: two blocks on one screen
   *  must not disagree about what counts as enough. */
  matchupBattles: 10,
  /** Points from their own average before a matchup is named. Matches
   *  `coachInsights.FLOORS.matchupGap` for the same reason. */
  matchupGap: 10,
  /** Below this the tone is warn; at or past it, bad. Presentation only. */
  severeGap: 20,
  /** Battles behind a card before its movement is shown. A card played twice
   *  can swing its win rate fifty points and mean nothing. */
  cardBattles: 12,
  /** Points of card movement worth printing. */
  cardGap: 5,
  /** Cards listed as movers, each direction. */
  cardRows: 5,
  /** Matchup cards drawn, each direction. */
  matchupCards: 3,
} as const;

const pct1 = (x: number) => `${x.toFixed(1)}%`;
const signed = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;
const rate = (w: number, n: number) => (n ? (w / n) * 100 : 0);

/** An archetype is only a claim if enough battles sit behind it. */
const judged = (a: DashArchetype) => a.battles >= DASH.matchupBattles;

/* ── the ring ──────────────────────────────────────────────────────────── */

export interface Coverage {
  rated: number;
  total: number;
  caption: string;
  tone: DashTone;
}

/** How much of what this player faces can be judged at all. */
export function coverage(faced: DashArchetype[] | null): Coverage | null {
  if (!faced) return null;
  const total = faced.length;
  if (total === 0) {
    return { rated: 0, total: 0, tone: 'neutral', caption: 'No archetypes faced in this window yet.' };
  }
  const n = faced.filter(judged).length;
  const share = n / total;
  return {
    rated: n,
    total,
    tone: share >= 0.6 ? 'good' : share > 0 ? 'warn' : 'bad',
    caption:
      n === 0
        ? `None of the ${total} archetypes they face has ${DASH.matchupBattles} battles behind it yet, so nothing below is judged.`
        : `of ${total} archetypes they face have ${DASH.matchupBattles}+ battles behind them. The rest are shown without a verdict.`,
  };
}

/* ── the matchup cards: what beats them, what they hold ────────────────── */

export interface MatchupCard {
  id: string;
  name: string;
  tone: DashTone;
  /** The one-line claim. Never an adjective the figures cannot carry. */
  headline: string;
  /** The figures behind it, printed under the claim. */
  evidence: string;
  diff: number;
}

function card(a: DashArchetype, overall: number, kind: 'weak' | 'strong'): MatchupCard {
  const r = rate(a.wins, a.battles);
  const diff = r - overall;
  return {
    id: a.name,
    name: a.name,
    tone: kind === 'weak' ? (diff <= -DASH.severeGap ? 'bad' : 'warn') : 'good',
    headline: `${pct1(r)} against ${a.name}, versus ${pct1(overall)} overall.`,
    evidence: `${a.battles} battles · ${a.wins}W ${a.losses}L${a.draws ? ` ${a.draws}D` : ''} · ${signed(diff)} points`,
    diff,
  };
}

/** What beats them — the most actionable thing on the screen, and something
 *  the Coach Roster only ever said in a bullet before. */
export function weaknesses(
  faced: DashArchetype[] | null,
  overall: number,
  limit = DASH.matchupCards,
): MatchupCard[] {
  if (!faced) return [];
  return faced
    .filter((a) => judged(a) && rate(a.wins, a.battles) - overall <= -DASH.matchupGap)
    .map((a) => card(a, overall, 'weak'))
    .sort((x, y) => x.diff - y.diff)
    .slice(0, limit);
}

export function strengths(
  faced: DashArchetype[] | null,
  overall: number,
  limit = DASH.matchupCards,
): MatchupCard[] {
  if (!faced) return [];
  return faced
    .filter((a) => judged(a) && rate(a.wins, a.battles) - overall >= DASH.matchupGap)
    .map((a) => card(a, overall, 'strong'))
    .sort((x, y) => y.diff - x.diff)
    .slice(0, limit);
}

/** Said when there is nothing to draw, so an empty grid is never silent — and
 *  it distinguishes "no evidence yet" from "nothing stands out", which look
 *  identical on screen and mean opposite things. */
export function matchupEmpty(faced: DashArchetype[] | null, overall: number): string {
  if (!faced || faced.length === 0) return 'No archetypes faced in this window yet.';
  if (!faced.some(judged)) {
    return `No archetype has the ${DASH.matchupBattles} battles it needs to be judged in this window. Widen the window, or wait for more stored battles.`;
  }
  return `Nothing they face often enough is more than ${DASH.matchupGap} points from their own ${pct1(overall)}.`;
}

/* ── the charts ────────────────────────────────────────────────────────── */

export interface DashBar {
  label: string;
  value: number;
  tone?: DashTone;
  display?: string;
}

/* `dayColumns` LIVED HERE AND WAS DELETED before it ever shipped a screen.
   The dashboard draws `IntelCharts.DailyChart` instead, which breaks its
   win-rate line across days under three battles rather than drawing movement
   that did not happen — a purpose-built chart beating a generic one. Keeping
   an unused exporter with its own tests would have been dead code that looks
   maintained. */

/** What they face, as a share of their battles. */
export function facedBars(rows: DashArchetype[], total: number, limit = 6): DashBar[] {
  return rows.slice(0, limit).map((r) => ({
    label: r.name,
    value: r.battles,
    tone: 'info' as DashTone,
    display: total ? `${((r.battles / total) * 100).toFixed(0)}%` : String(r.battles),
  }));
}

/* ── card movement ─────────────────────────────────────────────────────── */

export interface CardMove {
  id: string;
  key: string;
  label: string;
  value: string;
  tone: DashTone;
  delta: number;
}

/**
 * Cards whose win rate has moved against the equally long window before this
 * one — the only progress signal the site can already answer, because
 * `/cards` computes `previous` itself.
 *
 * `winDelta` is ABSENT, not zero, when either window had nothing to compare;
 * `?? 0` would turn "we cannot say" into "no change", so a row without one is
 * dropped rather than defaulted.
 *
 * BOTH WINDOWS NEED A REAL SAMPLE, and the second one is what this screen got
 * wrong first. The server withholds a delta only when the previous window had
 * ZERO battles with that card, so ONE is enough for it to publish a figure —
 * and measured live, a card played once and lost, then 47 times at 59.6%,
 * came back as `+59.6`: the delta equal to the rate, because the baseline was
 * 0% off a single game. True, and it says nothing. `prevBattles` is required
 * here and must clear the same floor as the current window.
 *
 * An older server does not send `prevBattles` at all. That is UNKNOWN, not
 * zero, and an unknown baseline is exactly what this filter exists to reject,
 * so the row is dropped.
 */
export function cardMovers(
  cards: DashCard[],
  direction: 'up' | 'down',
  limit = DASH.cardRows,
): CardMove[] {
  return cards
    .filter(
      (c) =>
        c.battles >= DASH.cardBattles &&
        c.tiered &&
        typeof c.winDelta === 'number' &&
        typeof c.prevBattles === 'number' &&
        c.prevBattles >= DASH.cardBattles &&
        (direction === 'up' ? c.winDelta >= DASH.cardGap : c.winDelta <= -DASH.cardGap),
    )
    .sort((a, b) =>
      direction === 'up' ? (b.winDelta as number) - (a.winDelta as number) : (a.winDelta as number) - (b.winDelta as number),
    )
    .slice(0, limit)
    .map((c) => ({
      id: c.key,
      key: c.key,
      label: cardLabel(c.key),
      value: `${pct1(c.winRate)} (${signed(c.winDelta as number)})`,
      tone: direction === 'up' ? ('good' as DashTone) : ('warn' as DashTone),
      delta: c.winDelta as number,
    }));
}

/** `hog-rider` -> `Hog Rider`. The catalogue's own titles live in
 *  `src/data/cards.ts`, which this file may not import; the screen passes the
 *  real name in when it has one. */
export function cardLabel(key: string): string {
  return key
    .split('-')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/* ── the window sentence ───────────────────────────────────────────────── */

/** One line stating what every figure on the screen is counted over, because
 *  a dashboard with no stated window invites the reader to assume "always". */
export function windowLine(
  win: { from: string | null; to: string | null },
  battles: number,
  hidden: number,
): string {
  const span = win.from && win.to ? `${win.from} to ${win.to}` : 'the stored window';
  const base = `${battles.toLocaleString('en-US')} own-deck 1v1 battle${battles === 1 ? '' : 's'}, ${span}`;
  return hidden > 0
    ? `${base}. ${hidden.toLocaleString('en-US')} in other modes are not counted.`
    : `${base}.`;
}
