import { CARDS_BY_KEY } from '../data/cards';
import type {
  ApiCardRow,
  ApiProfile,
  CardBoard,
  LivePlayerReport,
  MetaBoard,
  StoredPlayerReport,
} from '../state/analyticsClient';
import { frac, int, pct, type ReportDoc } from './analyticsReport';

/**
 * One adapter per analytics screen: screen data in, `ReportDoc` out.
 *
 * These are PURE and hold no layout — no millimetres, no page breaks, no jsPDF.
 * The renderer owns all of that, so a change to how a table looks happens once
 * rather than once per screen. What an adapter decides is editorial: which
 * figures lead, what each column is called, which caveats have to travel with
 * the numbers.
 *
 * THE CAVEATS ARE NOT BOILERPLATE. A PDF outlives the screen it came from and
 * loses the footnotes, the tooltips and the greyed-out rows that carried the
 * qualifications — so a figure that was honest on screen becomes a bare claim
 * in a document someone forwards. Everything each screen says about the limits
 * of its own data is restated here on purpose.
 */

/** A date as YYYY-MM-DD, from either an ISO string or Supercell's battle
 *  stamp (`20260926T161011.000Z`) — slicing the stamp's first ten characters
 *  printed "20260926T0" under "Last played" in every player report. */
export const DAY = (s: string | null | undefined): string => {
  if (!s) return '—';
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
};

function windowLabel(w: { from: string | null; to: string | null }): string {
  if (!w.from && !w.to) return 'All stored history';
  return `${DAY(w.from)} – ${DAY(w.to)}`;
}

function tiersLabel(sources: { hot: { available: boolean }; archive: { available: boolean } }): string {
  const parts: string[] = [];
  if (sources.hot.available) parts.push('hot');
  if (sources.archive.available) parts.push('archive');
  return parts.length ? parts.join(' + ') : 'none readable';
}


/* ------------------------------------------------------- player (stored) */

/** The trophies row both player reports print, ranked first.
 *
 * `rankedBest` is the best SEASON and can sit BELOW the current season, so it
 * is only called "best" when it actually is one — the same rule the screen
 * follows. `rankedRank` is null below the leaderboard cut even with trophies
 * present, so it is guarded separately.
 */
function rankedMeta(p: ApiProfile | null | undefined): { label: string; value: string }[] {
  if (p?.rankedTrophies != null) {
    const parts = [int(p.rankedTrophies)];
    if (p.rankedRank != null) parts.push(`rank #${int(p.rankedRank)}`);
    if (p.rankedBest != null && p.rankedBest > p.rankedTrophies) {
      parts.push(`best ${int(p.rankedBest)}`);
    }
    return [{ label: 'Ranked', value: parts.join(' · ') }];
  }
  if (p?.trophies != null) {
    return [{ label: 'Trophies', value: int(p.trophies) }];
  }
  return [];
}

export function playerReportDoc(r: StoredPlayerReport, tag: string): ReportDoc {
  const decided = r.player.wins + r.player.losses;
  const decks = [...r.decks].sort((a, b) => a.rank - b.rank);
  const top = decks.slice(0, 10);
  // Bars are scaled to the LARGEST row rather than to 1. A use rate of 12% on
  // a 0..1 axis is a sliver, and the question this chart answers is "which of
  // these do they play most", which is a comparison between the rows.
  const maxUse = Math.max(...top.map((d) => d.useRate), 0.0001);

  // The two trend charts, exactly as the screen draws them: one line per deck,
  // the top eight by rank, keyed by hash so two decks sharing a name stay two.
  const byHash = new Map(r.trends.series.map((x) => [x.deckHash, x]));
  const ticks = r.trends.days.map((d) => DAY(d).slice(5));
  // A win rate on a day the deck was not played is NOT 0% — the server sends 0
  // there, and plotted as a value every line dives to the axis and back. It
  // is a gap. Six lines, not ten: past that a line chart is a tangle.
  const trend = (pick: 'use' | 'win') => decks.slice(0, 6)
    .filter((d) => byHash.has(d.deckHash))
    .map((d) => {
      const row = byHash.get(d.deckHash);
      const use = row?.use ?? [];
      return {
        label: d.name,
        points: (row?.[pick] ?? []).map((v, i) => (!Number.isFinite(v) || (pick === 'win' && !use[i]) ? null : v)),
      };
    });

  const last = decks.map((d) => d.lastSeen).filter(Boolean).sort().slice(-1)[0] ?? null;

  return {
    screen: 'Player Analysis',
    subject: tag,
    hue: 'violet',
    meta: [
      { label: 'Window', value: windowLabel(r.window) },
      { label: 'Stored history', value: `${DAY(r.coverage.start)} – ${DAY(r.coverage.end)}` },
      { label: 'Battles', value: int(r.player.battles) },
      // Mirrors the header tile, including its fallback order — a PDF that
      // quotes trophy road while the screen quotes ranked is two answers to
      // one question. See the note on the tile in PlayerAnalysis.tsx.
      ...rankedMeta(r.profile),
      { label: 'Databases', value: tiersLabel(r.sources) },
    ],
    blocks: [
      {
        kind: 'stats',
        tiles: [
          { label: 'Battles', value: int(r.player.battles), note: windowLabel(r.window) },
          {
            // Computed here, so it has to be scaled to the API's percent
            // convention by hand — `pct` formats, it does not convert.
            label: 'Win rate',
            value: decided ? pct((r.player.wins / decided) * 100) : '—',
            note: `${r.player.wins}W ${r.player.losses}L${r.player.draws ? ` ${r.player.draws}D` : ''}`,
            hue: 'green',
          },
          { label: 'Crowns', value: `${int(r.player.crownsFor)}–${int(r.player.crownsAgainst)}`, note: 'for and against' },
          { label: 'Decks', value: int(decks.length), note: 'in this window' },
          { label: 'Last played', value: DAY(last), note: 'most recent battle' },
        ],
      },
      {
        kind: 'decks',
        heading: 'Every deck played',
        note: `${int(decks.length)} decks · ranked by use rate inside the window`,
        decks: decks.map((d) => ({
          name: `${d.rank}. ${d.name}`,
          meta: `${int(d.matches)} battles · ${pct(d.useRate)} of play${
            d.avgElixir != null ? ` · ${d.avgElixir.toFixed(1)} elixir` : ''
          }`,
          value: pct(d.winRate),
          valueNote: `${d.wins}W ${d.losses}L`,
          cards: d.cards,
          art: d.art,
          inferredArt: d.artInferred,
        })),
      },
      {
        kind: 'bars',
        heading: 'Share of play',
        note: 'Top 10 · scaled to the most-played deck',
        bars: top.map((d) => ({
          label: d.name,
          value: pct(d.useRate),
          fraction: maxUse ? d.useRate / maxUse : 0,
          hue: 'blue',
        })),
      },
      ...(ticks.length >= 2
        ? ([
          { kind: 'trend', heading: 'Use rate trend', note: 'Top 6 decks · % of the day’s battles', ticks, series: trend('use'), format: 'pct' },
          { kind: 'trend', heading: 'Win rate trend', note: 'Top 6 decks · a day the deck was not played is a gap', ticks, series: trend('win'), format: 'pct' },
        ] as ReportDoc['blocks'])
        : []),
    ],
    caveats: [
      'Deck rows are aggregated from battles inside the window, so a different window gives a different ranking — these figures are not lifetime totals.',
      'Win rate excludes draws from its denominator.',
      r.sources.archive.available
        ? 'Both storage tiers answered this query.'
        : 'The archive drive was not connected, so this covers the hot tier only — history older than it holds is absent rather than zero.',
    ],
  };
}

/* --------------------------------------------------------- player (live) */

export function livePlayerReportDoc(r: LivePlayerReport, tag: string): ReportDoc {
  const decided = r.wins + r.losses;
  const maxUse = Math.max(...r.decks.map((d) => d.useRate), 0.0001);

  return {
    screen: 'Player Analysis (live)',
    subject: tag,
    hue: 'blue',
    meta: [
      { label: 'Source', value: 'Clash Royale API — live battlelog' },
      { label: 'Battles', value: `${r.battles} of ${r.logSize} in the log` },
      { label: 'Span', value: `${DAY(r.span.from)} – ${DAY(r.span.to)}` },
      { label: 'Collection', value: r.tracking.state },
      ...rankedMeta(r.profile),
    ],
    blocks: [
      {
        kind: 'note',
        body:
          `No stored history exists for ${tag} yet, so every figure in this report is computed over the ` +
          `${r.battles} most recent battles the Clash Royale API served. ${r.limits.note}`,
      },
      {
        kind: 'stats',
        tiles: [
          {
            label: 'Battles',
            value: int(r.battles),
            note: r.skipped ? `${r.skipped} skipped — 2v2 or a given deck` : `all ${r.logSize}`,
          },
          {
            label: 'Win rate',
            value: decided ? pct(r.winRate) : '—',
            note: `${r.wins}W ${r.losses}L — over ${decided}`,
            hue: 'green',
          },
          {
            label: 'Crowns',
            value: `${int(r.crownsFor)}–${int(r.crownsAgainst)}`,
            note: 'for and against',
          },
          {
            label: 'Trophies',
            value: `${r.trophyChange > 0 ? '+' : ''}${int(r.trophyChange)}`,
            note: 'across this log',
            hue: r.trophyChange >= 0 ? 'green' : 'red',
          },
        ],
      },
      {
        kind: 'decks',
        heading: 'Decks played',
        note: 'The live payload states the form of every card in every battle, so nothing here is inferred.',
        decks: r.decks.map((d) => ({
          name: d.name,
          meta: `${int(d.games)} battles · ${pct(d.useRate)} of play`,
          value: pct(d.winRate),
          valueNote: `${d.wins}W ${d.games - d.wins}L`,
          cards: d.cards,
          art: d.art,
        })),
      },
      {
        kind: 'bars',
        heading: 'Share of play',
        bars: r.decks.map((d) => ({
          label: d.name,
          value: pct(d.useRate),
          fraction: maxUse ? d.useRate / maxUse : 0,
          hue: 'blue',
        })),
      },
      {
        kind: 'table',
        heading: 'Cards',
        columns: [
          { key: 'card', label: 'Card', flex: true },
          { key: 'games', label: 'Battles', width: 24, align: 'right' },
          { key: 'use', label: 'Use rate', width: 34, align: 'right' },
          { key: 'win', label: 'Win rate', width: 34, align: 'right' },
        ],
        rows: r.cards.map((c) => ({
          card: c.name,
          games: int(c.games),
          use: { text: pct(c.useRate), bar: frac(c.useRate), hue: 'blue' as const },
          // Under this project's own evidence floor of 8 games a win rate is
          // not a claim, so it is drained rather than ranked on.
          win: { text: pct(c.winRate), bar: frac(c.winRate), hue: 'green' as const, thin: c.games < 8 },
        })),
      },
    ],
    caveats: [
      'This is a fixed window. Clash Royale serves only the most recent battles and does not paginate, so no date range reaches further back and none of these figures can be recomputed over a longer period.',
      'The sample is far below the 8-battle evidence floor this project applies elsewhere. Treat every rate here as an indication, not a measurement.',
      'There is no previous window to compare against, so there are no trends or movement figures.',
      r.tracking.state === 'pending'
        ? 'This player has been queued for collection. Once the collector picks them up, the full stored analysis replaces this report.'
        : 'This player is being collected; stored history will grow from here.',
    ],
  };
}

/* --------------------------------------------------------------- the meta */

export function metaBoardDoc(b: MetaBoard): ReportDoc {
  const maxUse = Math.max(...b.decks.map((d) => d.useRate), 0.0001);
  const age = b.ageSeconds != null ? `${Math.round(b.ageSeconds / 60)} min old` : 'unknown age';

  return {
    screen: 'Top Meta Decks',
    hue: 'blue',
    meta: [
      { label: 'Window', value: `${DAY(b.window.from)} – ${DAY(b.window.to)} (${b.window.days} days)` },
      { label: 'Snapshot', value: age },
      { label: 'Battles', value: b.totalBattles != null ? int(b.totalBattles) : '—' },
      { label: 'Distinct decks', value: b.distinctDecks != null ? int(b.distinctDecks) : '—' },
      { label: 'Player floor', value: b.minPlayers != null ? `${b.minPlayers} distinct players` : '—' },
      { label: 'Modes', value: b.modes?.join(', ') ?? 'competitive 1v1' },
    ],
    blocks: [
      {
        kind: 'stats',
        tiles: [
          { label: 'Decks ranked', value: int(b.decks.length), note: 'after merging variants' },
          {
            label: 'Top use rate',
            value: pct(b.decks[0]?.useRate ?? 0, 2),
            note: b.decks[0]?.name ?? '—',
            hue: 'blue',
          },
          {
            label: 'Coverage',
            value: pct(b.decks.reduce((a, d) => a + d.useRate, 0)),
            note: 'of all competitive play',
          },
          {
            label: 'Rejected',
            value: b.excludedByFloor != null ? int(b.excludedByFloor) : '—',
            note: 'below the player floor',
          },
        ],
      },
      {
        kind: 'decks',
        heading: 'The board',
        note: `${int(b.decks.length)} decks · ranked by share of every competitive battle in the window`,
        decks: b.decks.map((d) => ({
          name: `${d.rank}. ${d.name}`,
          meta: `${pct(d.useRate, 2)} use · ${int(d.players)} players · ${int(d.battles)} battles${
            d.variants > 1 ? ` · ${d.variants} variants` : ''
          }`,
          value: pct(d.winRate),
          valueNote: 'win rate',
          cards: d.cards,
          art: d.art,
        })),
      },
      {
        kind: 'bars',
        heading: 'Use rate',
        note: 'Scaled to the leading deck. Clash Royale’s meta is a long tail, so a leader at ~2% of all play is the real figure.',
        bars: b.decks.slice(0, 24).map((d) => ({
          label: `${d.rank}. ${d.name}`,
          value: pct(d.useRate, 2),
          fraction: maxUse ? d.useRate / maxUse : 0,
          hue: 'blue',
        })),
      },
    ],
    caveats: [
      'This is a background snapshot, not a live query. A GROUP BY over this date window takes ~48 seconds against a 12.9 GB table, so the rollup runs on a timer and requests read the finished result.',
      'Only competitive 1v1 counts — ladder, ranked, clan-war 1v1 and tournaments. 2v2 and event modes that hand you a deck would measure Supercell’s choices rather than the player base’s.',
      `A deck needs ${b.minPlayers ?? 25} distinct players to appear, which is what stops one account grinding one deck from injecting itself into a use-rate ranking.`,
      'Near-identical lists are merged at 6-of-8 shared cards, and names are qualified by a signature card, because an archetype label alone is too coarse to distinguish genuinely different decks.',
    ],
  };
}

/* ---------------------------------------------------------- the card board */

export function cardBoardDoc(b: CardBoard, tag: string): ReportDoc {
  const played = b.cards.filter((c) => c.battles > 0);
  const byUse = (rows: ApiCardRow[]) => [...rows].sort((a, c) => c.useRate - a.useRate || c.battles - a.battles);
  const meta = (key: string) => CARDS_BY_KEY.get(key);

  /* EVERY TAB, AS A GRID OF THE CARDS THEMSELVES. The export used to be one
     text table — 98 names and no art, on a screen whose subject is cards.
     Troops, Buildings and Spells partition the All tab, so printing those
     three IS the All tab with nothing repeated; Win Conditions and Champions
     are the screen's subset tabs; Evolutions and Heroes print each card in
     THAT form's art, with the figures counted over that form alone. */
  const grid = (rows: ApiCardRow[]) => rows.map((c) => ({
    key: c.key,
    stats: [
      { label: 'Battles', value: int(c.battles) },
      { label: 'Use', value: pct(c.useRate), fraction: frac(c.useRate), hue: 'blue' as const },
      { label: 'Win', value: pct(c.winRate), fraction: frac(c.winRate), hue: 'green' as const, thin: !c.tiered },
    ],
  }));
  const formGrid = (rows: ApiCardRow[], form: 'evolution' | 'hero') => rows
    .map((c) => ({ c, f: c.forms?.[form] }))
    .filter((x) => x.f && x.f.battles > 0)
    .sort((a, c) => (c.f!.useRate - a.f!.useRate) || (c.f!.battles - a.f!.battles))
    .map(({ c, f }) => ({
      key: c.key,
      form,
      stats: [
        { label: 'Battles', value: int(f!.battles) },
        { label: 'Use', value: pct(f!.useRate), fraction: frac(f!.useRate), hue: 'blue' as const },
        { label: 'Win', value: pct(f!.winRate), fraction: frac(f!.winRate), hue: 'green' as const, thin: !f!.tiered },
      ],
    }));

  const tab = (label: string, rows: ApiCardRow[]) => (rows.length
    ? [{ kind: 'cards' as const, heading: label, note: `${int(rows.length)} cards · sorted by use rate`, cards: grid(byUse(rows)) }]
    : []);
  const troops = played.filter((c) => meta(c.key)?.type === 'Troop');
  const buildings = played.filter((c) => meta(c.key)?.type === 'Building');
  const spells = played.filter((c) => meta(c.key)?.type === 'Spell');
  const wincons = played.filter((c) => meta(c.key)?.isWinCondition);
  const champions = played.filter((c) => meta(c.key)?.isChampion);
  const evo = formGrid(played.filter((c) => meta(c.key)?.canEvolve), 'evolution');
  const heroes = formGrid(played.filter((c) => meta(c.key)?.canBeHero), 'hero');

  return {
    screen: 'Cards',
    subject: tag,
    hue: 'blue',
    meta: [
      { label: 'Window', value: windowLabel(b.window) },
      { label: 'Mode', value: b.mode },
      { label: 'Battles', value: int(b.totals.battles) },
      { label: 'Cards played', value: `${played.length} of ${b.totals.cards}` },
      { label: 'Evidence floor', value: `${b.totals.minBattles} battles` },
    ],
    blocks: [
      {
        kind: 'stats',
        tiles: [
          { label: 'Battles', value: int(b.totals.battles), note: windowLabel(b.window) },
          {
            label: 'Win rate',
            value: b.totals.battles ? pct((b.totals.wins / b.totals.battles) * 100) : '—',
            note: `${int(b.totals.wins)} won`,
            hue: 'green',
          },
          { label: 'Cards played', value: int(played.length), note: `of ${b.totals.cards}` },
          { label: 'Ranked', value: int(b.totals.ranked), note: `clear ${b.totals.minBattles} battles` },
          { label: 'Form coverage', value: pct(b.formCoverage.share), note: `${int(b.formCoverage.battles)} battles record a form` },
        ],
      },
      ...tab('Troops', troops),
      ...tab('Buildings', buildings),
      ...tab('Spells', spells),
      ...tab('Win conditions', wincons),
      ...tab('Champions', champions),
      ...(evo.length ? [{ kind: 'cards' as const, heading: 'Evolutions', note: `${int(evo.length)} cards · figures for the evolved form only`, cards: evo }] : []),
      ...(heroes.length ? [{ kind: 'cards' as const, heading: 'Heroes', note: `${int(heroes.length)} cards · figures for the hero form only`, cards: heroes }] : []),
    ],
    caveats: [
      `A win rate is ranked only once ${b.totals.minBattles} battles sit behind it; under that it is greyed.`,
      'Use rate is a share of battles in the window that fielded the card, so the column does not sum to 100%.',
      `Evolution and hero figures rest on the ${pct(b.formCoverage.share)} of battles whose payload recorded the form (${DAY(b.formCoverage.from)} – ${DAY(b.formCoverage.to)}).`,
    ],
  };
}
