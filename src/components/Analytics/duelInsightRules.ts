import type { DuelSeries } from '../../state/analyticsClient';

/**
 * Duel Insights — interpretation of the duel series log, not more statistics.
 *
 * THE ONE FACT THAT SHAPES EVERY FUNCTION HERE. A duel reaches this app in two
 * forms and they carry different amounts of information:
 *
 *   - a NATIVE row is one stored row holding the whole 16/24-card loadout and
 *     the SERIES result. It has no per-game scoreline and no opponent deck —
 *     measured on a 96-duel player, all 114 of its games came back with an
 *     empty `result` and a null `opponent`.
 *   - a RECONSTRUCTED series is rebuilt from consecutive friendly games, so
 *     every game has its own result and its own opponent deck.
 *
 * That is a property of how Supercell stores a duel, not a gap to be patched.
 * So anything about a GAME — game 1, deciders, adaptation, opponents, position
 * win rates — is computed over reconstructed series only, and every result
 * carries the sample it was computed from so the UI can print it. Anything
 * about a SERIES outcome can use both.
 *
 * NO INSIGHT IS EMITTED BELOW ITS THRESHOLD. `null` means "not enough to say",
 * which the UI renders as an explicit not-enough-data state rather than as a
 * percentage with a small number beside it. A 100% win rate over 2 series is
 * the exact failure this project's evidence floors exist to prevent.
 */

/** Series needed before a rate about series is worth printing. */
export const MIN_SERIES = 5;
/** Games needed before a rate about games is worth printing. */
export const MIN_GAMES = 5;
/** Times a deck must appear in a position before it can be "best" there. */
export const MIN_DECK_USES = 3;
/** A share this high in a position is worth calling predictable. */
export const PREDICTABLE_SHARE = 50;

export interface Rate {
  wins: number;
  total: number;
  /** 0-100, matching every rate in this API. */
  pct: number;
}

/** A rate that did not clear its floor is `null`, never a small-sample number. */
function rate(wins: number, total: number, floor: number): Rate | null {
  if (total < floor) return null;
  return { wins, total, pct: total ? (wins / total) * 100 : 0 };
}

/** Always returns the counts, even under the floor — a record is not an
 *  estimate, so "2-1" can be shown where "67%" cannot. */
function record(wins: number, total: number): Rate {
  return { wins, total, pct: total ? (wins / total) * 100 : 0 };
}

const decided = (s: DuelSeries) =>
  s.games.filter((g) => g.result === 'win' || g.result === 'loss');

/** Reconstructed series are the only ones with per-game detail. */
export const withGames = (all: DuelSeries[]) =>
  all.filter((s) => s.source === 'reconstructed' && decided(s).length > 0);

function gameAt(s: DuelSeries, slot: number) {
  return s.games.find((g) => g.slot === slot && (g.result === 'win' || g.result === 'loss'));
}

/** The decider is the LAST decided game of a series that actually went the
 *  distance. A 2-0 whose dead third game gets played out is not a decider, so
 *  it is required that both sides had a chance — i.e. the loser has at least
 *  one win. */
function deciderOf(s: DuelSeries) {
  const d = decided(s);
  if (d.length < 3) return null;
  const losses = d.filter((g) => g.result === 'loss').length;
  const wins = d.length - losses;
  if (wins === 0 || losses === 0) return null;
  return d[d.length - 1];
}

/* ------------------------------------------------------------- performance */

export interface Performance {
  seriesRecord: Rate;
  seriesRate: Rate | null;
  gameRate: Rate | null;
  game1Rate: Rate | null;
  deciderRate: Rate | null;
  /** Keyed "2-0", "2-1", "1-2", "0-2", … Only from series with a known score. */
  scorelines: { label: string; count: number; won: boolean }[];
  scoredSeries: number;
  nativeSeries: number;
  detailSeries: number;
}

export function performance(all: DuelSeries[]): Performance {
  const detail = withGames(all);

  const seriesWins = all.filter((s) => s.won).length;
  const games = detail.flatMap(decided);
  const gameWins = games.filter((g) => g.result === 'win').length;

  const g1 = detail.map((s) => gameAt(s, 0)).filter(Boolean) as NonNullable<
    ReturnType<typeof gameAt>
  >[];
  const deciders = detail.map(deciderOf).filter(Boolean) as NonNullable<
    ReturnType<typeof deciderOf>
  >[];

  const scoreMap = new Map<string, { count: number; won: boolean }>();
  for (const s of all) {
    if (!s.scoreKnown || s.playerWins === null || s.opponentWins === null) continue;
    const label = `${s.playerWins}-${s.opponentWins}`;
    const hit = scoreMap.get(label);
    if (hit) hit.count += 1;
    else scoreMap.set(label, { count: 1, won: s.playerWins > s.opponentWins });
  }

  return {
    seriesRecord: record(seriesWins, all.length),
    seriesRate: rate(seriesWins, all.length, MIN_SERIES),
    gameRate: rate(gameWins, games.length, MIN_GAMES),
    game1Rate: rate(g1.filter((g) => g.result === 'win').length, g1.length, MIN_GAMES),
    deciderRate: rate(
      deciders.filter((g) => g.result === 'win').length,
      deciders.length,
      MIN_GAMES,
    ),
    scorelines: [...scoreMap.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    scoredSeries: all.filter((s) => s.scoreKnown).length,
    nativeSeries: all.filter((s) => s.source === 'native').length,
    detailSeries: detail.length,
  };
}

/* ------------------------------------------------------------------ lineup */

export interface DeckSlotRow {
  deckName: string;
  archetype: string;
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  slot: number;
  uses: number;
  wins: number;
  pct: number;
}

export interface LineupInsights {
  /** Every deck seen in each position, ranked by uses. */
  perSlot: DeckSlotRow[][];
  bestOpener: DeckSlotRow | null;
  bestDecider: DeckSlotRow | null;
  bestLineup: { order: string[]; uses: number; wins: number; pct: number } | null;
  /** Share of series opened with the single most-used opener, 0-100. */
  topOpenerShare: number | null;
  topOpenerName: string | null;
  distinctOpeners: number;
}

export function lineup(all: DuelSeries[]): LineupInsights {
  const detail = withGames(all);

  const bySlot: Map<string, DeckSlotRow>[] = [new Map(), new Map(), new Map()];
  for (const s of detail) {
    for (const g of s.games) {
      if (g.slot < 0 || g.slot > 2) continue;
      if (g.result !== 'win' && g.result !== 'loss') continue;
      const key = g.deckName || g.archetype || g.cards.join(',');
      const m = bySlot[g.slot];
      const row =
        m.get(key) ??
        {
          deckName: g.deckName || g.archetype || 'Unnamed deck',
          archetype: g.archetype,
          cards: g.cards,
          art: g.art,
          slot: g.slot,
          uses: 0,
          wins: 0,
          pct: 0,
        };
      row.uses += 1;
      row.wins += g.result === 'win' ? 1 : 0;
      row.pct = (row.wins / row.uses) * 100;
      m.set(key, row);
    }
  }

  const perSlot = bySlot.map((m) =>
    [...m.values()].sort((a, b) => b.uses - a.uses || a.deckName.localeCompare(b.deckName)),
  );

  // "Best" ranks on win rate but only among decks with a real record, and ties
  // break on uses so the better-evidenced deck wins.
  const best = (rows: DeckSlotRow[]) => {
    const eligible = rows.filter((r) => r.uses >= MIN_DECK_USES);
    if (!eligible.length) return null;
    return [...eligible].sort((a, b) => b.pct - a.pct || b.uses - a.uses)[0];
  };

  // A decider deck is whatever was played in the last game of a series that
  // went the distance — which is not necessarily slot 2.
  const decMap = new Map<string, DeckSlotRow>();
  for (const s of detail) {
    const d = deciderOf(s);
    if (!d) continue;
    const key = d.deckName || d.archetype || d.cards.join(',');
    const row =
      decMap.get(key) ??
      {
        deckName: d.deckName || d.archetype || 'Unnamed deck',
        archetype: d.archetype,
        cards: d.cards,
        art: d.art,
        slot: d.slot,
        uses: 0,
        wins: 0,
        pct: 0,
      };
    row.uses += 1;
    row.wins += d.result === 'win' ? 1 : 0;
    row.pct = (row.wins / row.uses) * 100;
    decMap.set(key, row);
  }

  // A full lineup is the ordered deck names of a 3-game series.
  const lineMap = new Map<string, { order: string[]; uses: number; wins: number; pct: number }>();
  for (const s of detail) {
    const d = decided(s);
    if (d.length < 3) continue;
    const order = d.slice(0, 3).map((g) => g.deckName || g.archetype || 'Unnamed');
    const key = order.join(' > ');
    const row = lineMap.get(key) ?? { order, uses: 0, wins: 0, pct: 0 };
    row.uses += 1;
    row.wins += s.won ? 1 : 0;
    row.pct = (row.wins / row.uses) * 100;
    lineMap.set(key, row);
  }
  const lineups = [...lineMap.values()].filter((l) => l.uses >= MIN_DECK_USES);
  const bestLineup = lineups.length
    ? [...lineups].sort((a, b) => b.pct - a.pct || b.uses - a.uses)[0]
    : null;

  const openers = perSlot[0];
  const openerUses = openers.reduce((a, r) => a + r.uses, 0);

  return {
    perSlot,
    bestOpener: best(openers),
    bestDecider: best([...decMap.values()]),
    bestLineup,
    topOpenerShare:
      openerUses >= MIN_SERIES && openers.length ? (openers[0].uses / openerUses) * 100 : null,
    topOpenerName: openers.length ? openers[0].deckName : null,
    distinctOpeners: openers.length,
  };
}

/* -------------------------------------------------------------- adaptation */

export interface Adaptation {
  afterG1Win: Rate | null;
  afterG1Loss: Rate | null;
  g2AfterG1Win: Rate | null;
  g2AfterG1Loss: Rate | null;
}

export function adaptation(all: DuelSeries[]): Adaptation {
  const detail = withGames(all);
  const won = detail.filter((s) => gameAt(s, 0)?.result === 'win');
  const lost = detail.filter((s) => gameAt(s, 0)?.result === 'loss');

  const g2 = (list: DuelSeries[]) => {
    const games = list.map((s) => gameAt(s, 1)).filter(Boolean) as NonNullable<
      ReturnType<typeof gameAt>
    >[];
    return rate(games.filter((g) => g.result === 'win').length, games.length, MIN_GAMES);
  };

  return {
    afterG1Win: rate(won.filter((s) => s.won).length, won.length, MIN_SERIES),
    afterG1Loss: rate(lost.filter((s) => s.won).length, lost.length, MIN_SERIES),
    g2AfterG1Win: g2(won),
    g2AfterG1Loss: g2(lost),
  };
}

/* ---------------------------------------------------------------- opponents */

export interface OpponentInsights {
  /** Opposing archetypes faced, with the player's record against each. */
  archetypes: { archetype: string; games: number; wins: number; pct: number }[];
  best: { archetype: string; games: number; wins: number; pct: number } | null;
  worst: { archetype: string; games: number; wins: number; pct: number } | null;
  /** What they most often answer the opener with. */
  vsOpener: { archetype: string; count: number; share: number } | null;
  /** Games that carried an opponent deck at all. */
  known: number;
  total: number;
}

export function opponents(all: DuelSeries[]): OpponentInsights {
  const detail = withGames(all);
  const map = new Map<string, { games: number; wins: number }>();
  let known = 0;
  let total = 0;

  for (const s of detail) {
    for (const g of s.games) {
      if (g.result !== 'win' && g.result !== 'loss') continue;
      total += 1;
      const arch = g.opponent?.archetype;
      if (!arch) continue;
      known += 1;
      const row = map.get(arch) ?? { games: 0, wins: 0 };
      row.games += 1;
      row.wins += g.result === 'win' ? 1 : 0;
      map.set(arch, row);
    }
  }

  const archetypes = [...map.entries()]
    .map(([archetype, v]) => ({ archetype, ...v, pct: (v.wins / v.games) * 100 }))
    .sort((a, b) => b.games - a.games || a.archetype.localeCompare(b.archetype));

  const ranked = archetypes.filter((a) => a.games >= MIN_GAMES);

  // What the opponent brings against the player's OPENER — game 1 only.
  const openerAnswers = new Map<string, number>();
  let answered = 0;
  for (const s of detail) {
    const g = gameAt(s, 0);
    const arch = g?.opponent?.archetype;
    if (!arch) continue;
    answered += 1;
    openerAnswers.set(arch, (openerAnswers.get(arch) ?? 0) + 1);
  }
  const topAnswer = [...openerAnswers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  return {
    archetypes,
    best: ranked.length ? [...ranked].sort((a, b) => b.pct - a.pct)[0] : null,
    worst: ranked.length ? [...ranked].sort((a, b) => a.pct - b.pct)[0] : null,
    vsOpener:
      topAnswer && answered >= MIN_SERIES
        ? { archetype: topAnswer[0], count: topAnswer[1], share: (topAnswer[1] / answered) * 100 }
        : null,
    known,
    total,
  };
}

/* ------------------------------------------------------------ card reveal */

export interface RevealInsights {
  /** Distinct cards the player showed across a full series, averaged. */
  avgPlayerRevealed: number | null;
  avgOpponentRevealed: number | null;
  /** Series where all three decks were seen — the whole 24-card pool. */
  fullLoadouts: number;
  seriesCounted: number;
}

/**
 * A duel forbids card reuse across the three decks, so every game shown is
 * information: the cards spent cannot come back. This counts DISTINCT cards
 * revealed per series, which is the only reveal figure the stored data
 * supports — it does not attempt to say what is left in an unseen deck, since
 * a deck that was never played was never recorded.
 */
export function reveals(all: DuelSeries[]): RevealInsights {
  const detail = withGames(all);
  const mine: number[] = [];
  const theirs: number[] = [];
  let full = 0;

  for (const s of detail) {
    const d = decided(s);
    if (!d.length) continue;
    const p = new Set<string>();
    const o = new Set<string>();
    for (const g of d) {
      g.cards.forEach((c) => p.add(c));
      g.opponent?.cards.forEach((c) => o.add(c));
    }
    mine.push(p.size);
    if (o.size) theirs.push(o.size);
    if (d.length >= 3) full += 1;
  }

  const avg = (xs: number[]) =>
    xs.length >= MIN_SERIES ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  return {
    avgPlayerRevealed: avg(mine),
    avgOpponentRevealed: avg(theirs),
    fullLoadouts: full,
    seriesCounted: detail.length,
  };
}

/* --------------------------------------------------------------- verdicts */

export type Tone = 'good' | 'bad' | 'neutral';

export interface Verdict {
  id: string;
  title: string;
  body: string;
  tone: Tone;
  /** How strongly this stood out — used to pick the key insights. */
  weight: number;
}

const one = (n: number) => n.toFixed(0);

/**
 * Turn the measured rates into statements, and ONLY where the numbers carry
 * them. Every threshold here is a claim about what is worth remarking on —
 * a 52% win rate is not "a strength", it is a coin flip, so nothing is said.
 */
export function verdicts(
  perf: Performance,
  adapt: Adaptation,
  line: LineupInsights,
  opp: OpponentInsights,
): Verdict[] {
  const out: Verdict[] = [];

  if (perf.seriesRate && perf.seriesRate.pct >= 60) {
    out.push({
      id: 'closer',
      title: 'Strong series closer',
      body: `You win ${one(perf.seriesRate.pct)}% of your duel series (${perf.seriesRate.wins} of ${perf.seriesRate.total}).`,
      tone: 'good',
      weight: perf.seriesRate.pct - 50,
    });
  } else if (perf.seriesRate && perf.seriesRate.pct <= 40) {
    out.push({
      id: 'closer-weak',
      title: 'Series are getting away',
      body: `You win ${one(perf.seriesRate.pct)}% of your duel series (${perf.seriesRate.wins} of ${perf.seriesRate.total}).`,
      tone: 'bad',
      weight: 50 - perf.seriesRate.pct,
    });
  }

  if (perf.deciderRate && perf.gameRate && perf.deciderRate.pct - perf.gameRate.pct >= 8) {
    out.push({
      id: 'decider',
      title: 'Decider specialist',
      body: `You win ${one(perf.deciderRate.pct)}% of deciding games against ${one(perf.gameRate.pct)}% of games overall (${perf.deciderRate.total} deciders).`,
      tone: 'good',
      weight: perf.deciderRate.pct - perf.gameRate.pct,
    });
  } else if (perf.deciderRate && perf.gameRate && perf.gameRate.pct - perf.deciderRate.pct >= 8) {
    out.push({
      id: 'decider-weak',
      title: 'Deciders slip away',
      body: `You win ${one(perf.deciderRate.pct)}% of deciding games against ${one(perf.gameRate.pct)}% overall (${perf.deciderRate.total} deciders).`,
      tone: 'bad',
      weight: perf.gameRate.pct - perf.deciderRate.pct,
    });
  }

  if (adapt.afterG1Loss && adapt.afterG1Loss.pct >= 50) {
    out.push({
      id: 'adapt',
      title: 'Strong adaptation',
      body: `You still win ${one(adapt.afterG1Loss.pct)}% of series after losing game 1 (${adapt.afterG1Loss.wins} of ${adapt.afterG1Loss.total}).`,
      tone: 'good',
      weight: adapt.afterG1Loss.pct,
    });
  } else if (adapt.afterG1Loss && adapt.afterG1Loss.pct <= 25) {
    out.push({
      id: 'adapt-weak',
      title: 'A lost opener is hard to recover',
      body: `You win only ${one(adapt.afterG1Loss.pct)}% of series after losing game 1 (${adapt.afterG1Loss.wins} of ${adapt.afterG1Loss.total}).`,
      tone: 'bad',
      weight: 60 - adapt.afterG1Loss.pct,
    });
  }

  if (adapt.afterG1Win && adapt.afterG1Win.pct >= 70) {
    out.push({
      id: 'convert',
      title: 'Game 1 advantage',
      body: `You convert ${one(adapt.afterG1Win.pct)}% of game 1 wins into series victories (${adapt.afterG1Win.wins} of ${adapt.afterG1Win.total}).`,
      tone: 'good',
      weight: adapt.afterG1Win.pct - 50,
    });
  }

  // Predictability is only a finding if it is actually true — on a player with
  // thirty different openers the honest statement is the opposite one.
  if (line.topOpenerShare !== null && line.topOpenerName) {
    if (line.topOpenerShare >= PREDICTABLE_SHARE) {
      out.push({
        id: 'predictable',
        title: 'A readable opener',
        body: `${line.topOpenerName} opens ${one(line.topOpenerShare)}% of your duels. Opponents who have seen you before can prepare for it.`,
        tone: 'bad',
        weight: line.topOpenerShare,
      });
    } else if (line.distinctOpeners >= 5 && line.topOpenerShare <= 25) {
      out.push({
        id: 'varied',
        title: 'Hard to prepare for',
        body: `You open with ${line.distinctOpeners} different decks and none takes more than ${one(line.topOpenerShare)}% of your duels.`,
        tone: 'good',
        weight: 40 - line.topOpenerShare,
      });
    }
  }

  if (opp.worst && opp.worst.pct <= 40) {
    out.push({
      id: 'matchup-weak',
      title: 'Matchup weakness',
      body: `You win ${one(opp.worst.pct)}% against ${opp.worst.archetype} decks (${opp.worst.wins} of ${opp.worst.games} games).`,
      tone: 'bad',
      weight: 50 - opp.worst.pct,
    });
  }
  if (opp.best && opp.best.pct >= 65) {
    out.push({
      id: 'matchup-good',
      title: 'Favourite matchup',
      body: `You win ${one(opp.best.pct)}% against ${opp.best.archetype} decks (${opp.best.wins} of ${opp.best.games} games).`,
      tone: 'good',
      weight: opp.best.pct - 50,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** The one to three strongest findings, preferring a mix of good and bad —
 *  three consecutive compliments is not a read of anyone's play. */
export function keyInsights(all: Verdict[]): Verdict[] {
  if (!all.length) return [];
  const picked: Verdict[] = [all[0]];
  const opposite = all.find((v) => v.tone !== all[0].tone && v.id !== all[0].id);
  if (opposite) picked.push(opposite);
  const third = all.find((v) => !picked.includes(v));
  if (third && picked.length < 3) picked.push(third);
  return picked;
}
