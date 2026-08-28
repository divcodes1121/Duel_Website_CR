import { CARDS_BY_KEY } from '../data/cards';
import type {
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

const DAY = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');

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

function cardName(key: string): string {
  return CARDS_BY_KEY.get(key)?.name ?? key.replace(/-/g, ' ');
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
  const top = r.decks.slice(0, 10);
  // Bars are scaled to the LARGEST row rather than to 1. A use rate of 12% on
  // a 0..1 axis is a sliver, and the question this chart answers is "which of
  // these do they play most", which is a comparison between the rows.
  const maxUse = Math.max(...top.map((d) => d.useRate), 0.0001);

  return {
    screen: 'Player Analysis',
    subject: tag,
    hue: 'violet',
    meta: [
      { label: 'Window', value: windowLabel(r.window) },
      { label: 'Stored history', value: `${DAY(r.coverage.start)} – ${DAY(r.coverage.end)}` },
      { label: 'Battles', value: int(r.player.battles) },
      { label: 'Databases', value: tiersLabel(r.sources) },
      // Mirrors the header tile, including its fallback order — a PDF that
      // quotes trophy road while the screen quotes ranked is two answers to
      // one question. See the note on the tile in PlayerAnalysis.tsx.
      ...rankedMeta(r.profile),
      { label: 'Collection', value: r.tracking?.state ?? 'unknown' },
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
          {
            label: 'Crowns',
            value: `${int(r.player.crownsFor)}–${int(r.player.crownsAgainst)}`,
            note: 'for and against',
          },
          { label: 'Decks', value: int(r.decks.length), note: 'in this window' },
          {
            // The most recent battle is on the DECK rows, not on `player` —
            // `ApiPlayer` declares a `lastSeen` the server has never sent, so
            // reading it printed an em dash. Taken from the deck rows instead,
            // which do carry it.
            label: 'Last played',
            // `.at()` is ES2022 and this project targets lower; index instead.
            value: DAY(
              r.decks
                .map((d) => d.lastSeen)
                .filter(Boolean)
                .sort()
                .slice(-1)[0] ?? null,
            ),
            note: 'most recent battle',
          },
        ],
      },
      {
        kind: 'decks',
        heading: 'Top decks',
        note: 'Ranked by use rate inside the window. Art is what the deck was observed being fielded with.',
        decks: top.map((d) => ({
          name: d.name,
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
        note: 'Bars are scaled to the most-played deck, not to 100%.',
        bars: top.map((d) => ({
          label: d.name,
          value: pct(d.useRate),
          fraction: maxUse ? d.useRate / maxUse : 0,
          hue: 'blue',
        })),
      },
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
        note: 'Ranked by share of every competitive battle in the window — a share of all play, not of the board.',
        decks: b.decks.slice(0, 24).map((d) => ({
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
      { kind: 'break' },
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
  const byUse = [...played].sort((a, b2) => b2.useRate - a.useRate);

  return {
    screen: 'Cards',
    subject: tag,
    hue: 'blue',
    meta: [
      { label: 'Window', value: windowLabel(b.window) },
      { label: 'Mode', value: b.mode },
      { label: 'Battles', value: int(b.totals.battles) },
      { label: 'Cards played', value: `${played.length} of ${b.totals.cards}` },
      { label: 'Evidence floor', value: `${b.totals.minBattles} battles to rank` },
      { label: 'Databases', value: tiersLabel(b.sources) },
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
          {
            label: 'Ranked',
            value: int(b.totals.ranked),
            note: `clear ${b.totals.minBattles} battles`,
          },
          {
            label: 'Form coverage',
            value: pct(b.formCoverage.share),
            note: `${int(b.formCoverage.battles)} battles record a form`,
          },
        ],
      },
      {
        kind: 'table',
        heading: 'Every card played',
        note: 'Sorted by use rate — a plain count that needs no evidence floor, which is why it is the default on screen too.',
        columns: [
          { key: 'rank', label: '#', width: 10, align: 'right' },
          { key: 'card', label: 'Card', flex: true },
          { key: 'battles', label: 'Battles', width: 22, align: 'right' },
          { key: 'use', label: 'Use rate', width: 40, align: 'right' },
          { key: 'win', label: 'Win rate', width: 40, align: 'right' },
          { key: 'tier', label: 'Evidence', width: 24 },
        ],
        rows: byUse.map((c, i) => ({
          rank: String(i + 1),
          card: cardName(c.key),
          battles: int(c.battles),
          use: { text: pct(c.useRate), bar: frac(c.useRate), hue: 'blue' as const },
          win: {
            text: pct(c.winRate),
            bar: c.winRate,
            hue: 'green' as const,
            thin: !c.tiered,
          },
          // `null` means the claim is not made at all, which is a different
          // statement from "low confidence" and must not print as one.
          tier: { text: c.tier ?? 'thin', thin: !c.tiered },
        })),
      },
    ],
    caveats: [
      `A win rate is only ranked once ${b.totals.minBattles} battles sit behind it. Below that the card still appears but is marked thin — without the floor, the top of a "best cards" board is whatever was played once and won once.`,
      'Use rate is a share of battles in the window that fielded the card, so the column does not sum to 100%.',
      b.formCoverage.share < 0.5
        ? `Per-form figures rest on the ${pct(b.formCoverage.share)} of battles whose payload recorded which form was fielded (${DAY(b.formCoverage.from)} – ${DAY(b.formCoverage.to)}). A card with no per-form record was not observed in that form, which is not the same as never having been played in it.`
        : 'Per-form figures are computed only over battles whose payload recorded the form.',
      b.previous
        ? `Movement, where shown on screen, is against ${DAY(b.previous.from)} – ${DAY(b.previous.to)} (${int(b.previous.battles)} battles).`
        : 'There is no preceding window of equal length, so no movement figures are available.',
    ],
  };
}
