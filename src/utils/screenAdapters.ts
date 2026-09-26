import type {
  CoachDeck,
  CoachPrediction,
  CoachSuggestion,
  CountersReport,
  DuelZoneReport,
  DuoReport,
  GlobalCardBoard,
  MatchupReport,
  PlayerCounterReport,
  PlayerMatchup,
  RecentBattlesReport,
} from '../state/analyticsClient';
import { adaptation, lineup, opponents, performance, verdicts } from '../components/Analytics/duelInsightRules';
import { CARDS_BY_KEY } from '../data/cards';
import { frac, int, pct, type DeckLine, type ReportBlock, type ReportDoc } from './analyticsReport';
import { DAY } from './reportAdapters';
import { printableName } from './report/text';

/* Report models for the screens that had NO export before this module:
 * Recent Battles, Deck Counter, Coach Assist, 2v2 Decks and the global Cards
 * board — plus the Duel Insights panel that sits at the foot of Duel
 * Analysis, which the old export left off.
 *
 * Same contract as `reportAdapters.ts`: pure, no layout, every figure one the
 * screen already shows. Imported dynamically from each screen's export thunk,
 * so none of it is in the bundle a reader downloads until they press Export.
 *
 * NO EXPLANATORY PROSE. Headings, counts and figures; a note under a heading
 * says what the numbers are counted over, never what they "mean". */

const tag = (t: string) => `#${t.replace(/^#/, '').toUpperCase()}`;

/** `20260926T161011.000Z` -> "26 Sep, 16:10". */
export function when(stamp: string | null | undefined): string {
  if (!stamp) return '—';
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(stamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (m) return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`;
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? stamp : `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** An archetype KEY as a reader would write it — the duel rows carry keys
 *  ("bridge-spam", "xbow"), and a PDF printing them reads as a debug dump. */
const ARCHETYPE_NAMES: Record<string, string> = { xbow: 'X-Bow', pekka: 'P.E.K.K.A', 'mini-pekka': 'Mini P.E.K.K.A' };
export function archetypeName(key: string): string {
  if (!key) return '—';
  if (ARCHETYPE_NAMES[key]) return ARCHETYPE_NAMES[key];
  if (/[A-Z ]/.test(key)) return key;
  return key.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

const range = (w: { from: string | null; to: string | null } | undefined | null) =>
  (w?.from || w?.to ? `${DAY(w?.from)} – ${DAY(w?.to)}` : 'All stored history');

/* --------------------------------------------------------- recent battles */

export function recentBattlesDoc(r: RecentBattlesReport, playerTag: string): ReportDoc {
  const s = r.summary;
  const decided = s.wins + s.losses;
  const you = printableName(r.player.name, tag(playerTag));
  const hiddenModes = Object.entries(s.hiddenByMode ?? {}).sort((a, b) => b[1] - a[1]);
  const blocks: ReportBlock[] = [
    {
      kind: 'stats',
      tiles: [
        { label: 'Battles', value: int(s.battles), note: range(r.window) },
        { label: 'Win rate', value: decided ? pct((100 * s.wins) / decided) : '—', note: `${s.wins}W ${s.losses}L${s.draws ? ` ${s.draws}D` : ''}`, hue: 'green' },
        { label: 'Crowns', value: `${int(s.crowns)}–${int(s.opponentCrowns)}`, note: 'for and against' },
        { label: 'Not shown', value: int(s.hidden ?? 0), note: '2v2 and preset-deck modes' },
      ],
    },
    {
      kind: 'battles',
      heading: 'Battle log',
      note: `The ${int(r.battles.length)} most recent of ${int(r.total)} in the window`,
      rows: r.battles.map((b) => ({
        result: b.result,
        score: `${b.crowns}–${b.opponentCrowns}`,
        when: when(b.battleTime),
        mode: b.modeLabel,
        leftLabel: you,
        rightLabel: printableName(b.opponent.name, tag(b.opponent.tag)),
        left: { name: b.player.deckName || b.player.archetype, cards: b.player.cards, art: b.player.art, inferredArt: b.player.artInferred },
        right: { name: b.opponent.deckName || b.opponent.archetype, cards: b.opponent.cards, art: b.opponent.art, inferredArt: b.opponent.artInferred },
      })),
    },
  ];
  if (hiddenModes.length) {
    blocks.push({
      kind: 'table',
      heading: 'Modes not shown',
      columns: [
        { key: 'mode', label: 'Mode', flex: true },
        { key: 'n', label: 'Battles', width: 30, align: 'right' },
      ],
      rows: hiddenModes.map(([mode, n]) => ({ mode, n: int(n) })),
    });
  }
  return {
    screen: 'Recent Battles',
    subject: playerTag,
    summary: r.player.name ? printableName(r.player.name, '') || undefined : undefined,
    hue: 'green',
    meta: [
      { label: 'Window', value: range(r.window) },
      { label: 'Battles', value: int(r.total) },
      { label: 'Archive used', value: s.archiveUsed ? 'yes' : 'no' },
    ],
    blocks,
  };
}

/* ----------------------------------------------------------- deck counter */

function matchupDeck(m: PlayerMatchup, yours = false, playerRate?: number): DeckLine {
  const rate = yours && m.yourWinRate != null ? m.yourWinRate : m.winRate;
  const gap = m.diff;
  const basis = m.deckBasis === 'faced' && m.deckSeen ? `faced ${int(m.deckSeen)}×` : 'typical list';
  return {
    name: m.name,
    meta: [m.style, `${int(m.battles)} battles`, m.tier ?? 'thin', m.deck ? basis : ''].filter(Boolean).join(' · '),
    value: pct(rate),
    valueNote: yours
      ? 'your expected rate'
      : `${gap >= 0 ? '+' : ''}${gap.toFixed(1)} vs ${playerRate != null ? pct(playerRate) : 'their average'}`,
    cards: m.deck?.cards ?? [],
    art: m.deck?.art,
    inferredArt: m.deck?.inferredArt,
    // Coloured by the gap to their own average — what makes a row a weakness.
    valueHue: yours ? 'green' : gap <= -5 ? 'red' : gap >= 5 ? 'green' : 'neutral',
  };
}

function counterSide(d: { name: string; cards: string[]; art?: Record<string, 'evolution' | 'hero'>; inferredArt?: boolean; avgElixir: number; archetype: string }): DeckLine {
  return { name: d.name || d.archetype, meta: `${d.avgElixir.toFixed(1)} elixir`, cards: d.cards, art: d.art, inferredArt: d.inferredArt };
}

export function deckCounterDoc(
  r: PlayerCounterReport | null,
  playerTag: string,
  extra: { versus?: MatchupReport | null; counters?: CountersReport | null } = {},
): ReportDoc {
  const blocks: ReportBlock[] = [];
  if (r) {
    blocks.push(
      {
        kind: 'stats',
        tiles: [
          { label: 'Battles', value: int(r.player.battles), note: range(r.window) },
          { label: 'Win rate', value: pct(r.player.winRate), note: `${int(r.player.wins)} won`, hue: 'green' },
          { label: 'Archetypes', value: int(r.analyzed), note: `floor ${r.minBattles} battles` },
          { label: 'Weak spots', value: int(r.worst.length), note: 'below their average', hue: 'red' },
        ],
      },
      ...(r.worst.length ? [{ kind: 'decks' as const, heading: 'Worst matchups', note: 'Below this player’s own average', decks: r.worst.map((m) => matchupDeck(m, false, r.player.winRate)) }] : []),
      ...(r.best.length ? [{ kind: 'decks' as const, heading: 'Best matchups', note: 'At or above their own average', decks: r.best.map((m) => matchupDeck(m, false, r.player.winRate)) }] : []),
      ...(r.recommended.length ? [{ kind: 'decks' as const, heading: 'Bring this against them', note: 'Their worst archetypes, stated from your side', decks: r.recommended.map((m) => matchupDeck(m, true)) }] : []),
    );
  }
  const v = extra.versus;
  if (v) {
    const m = v.matchup;
    blocks.push({ kind: 'break' }, {
      kind: 'versus',
      heading: 'Deck vs deck',
      note: m ? `${pct(m.winRate)} for deck A over ${int(m.games)} games · source ${v.source ?? '—'}` : 'No evidence for this pairing',
      leftLabel: 'Deck A',
      rightLabel: 'Deck B',
      pairs: [{ left: { ...counterSide(v.a), value: m ? pct(m.winRate) : undefined }, right: { ...counterSide(v.b), value: m ? pct(100 - m.winRate) : undefined } }],
    });
    if (v.ladder?.length) {
      blocks.push({
        kind: 'table',
        heading: 'Evidence ladder',
        columns: [
          { key: 'source', label: 'Reading', flex: true },
          { key: 'decks', label: 'Decks pooled', width: 30, align: 'right' },
          { key: 'games', label: 'Games', width: 26, align: 'right' },
          { key: 'win', label: 'Deck A win rate', width: 60, align: 'right' },
          { key: 'crowns', label: 'Crown diff', width: 28, align: 'right' },
        ],
        rows: v.ladder.map((g) => ({
          source: g.source,
          decks: g.decks == null ? '—' : int(g.decks),
          games: int(g.games),
          win: { text: pct(g.winRate), bar: frac(g.winRate), hue: 'green' as const },
          crowns: `${g.crownDiff >= 0 ? '+' : ''}${g.crownDiff.toFixed(2)}`,
        })),
      });
    }
  }
  const c = extra.counters;
  if (c) {
    blocks.push(
      { kind: 'break' },
      {
        kind: 'decks',
        heading: 'Find a counter — target deck',
        note: c.overall?.winRate != null ? `${pct(c.overall.winRate)} overall over ${int(c.overall.games)} games` : undefined,
        decks: [counterSide(c.target)],
      },
      ...(c.counters.length ? [{
        kind: 'decks' as const,
        heading: 'What beats it',
        note: `${int(c.counters.length)} of ${int(c.considered ?? c.counters.length)} archetypes weighed`,
        decks: c.counters.map((x) => ({
          name: x.name,
          meta: [x.style, `${int(x.games)} games`, x.tier ?? 'thin'].join(' · '),
          value: pct(x.winRate),
          valueNote: x.advantage != null ? `${x.advantage >= 0 ? '+' : ''}${x.advantage.toFixed(1)} vs the field` : undefined,
          cards: x.deck?.cards ?? [],
          art: x.deck?.art,
          inferredArt: x.deck?.inferredArt,
        })),
      }] : []),
      ...(c.played?.length ? [{
        kind: 'table' as const,
        heading: 'Decks this list has played',
        columns: [
          { key: 'name', label: 'Deck', flex: true },
          { key: 'style', label: 'Style', width: 34 },
          { key: 'rec', label: 'Record', width: 30, align: 'right' as const },
          { key: 'games', label: 'Games', width: 22, align: 'right' as const },
        ],
        rows: c.played.map((p) => ({
          name: p.name,
          style: p.style,
          rec: { text: `${p.wins}–${p.losses}${p.draws ? `–${p.draws}` : ''}`, hue: p.beatsYou ? ('red' as const) : ('green' as const) },
          games: int(p.games),
        })),
      }] : []),
    );
  }
  return {
    screen: 'Deck Counter',
    subject: playerTag,
    hue: 'pink',
    meta: r
      ? [
        { label: 'Window', value: range(r.window) },
        { label: 'Battles', value: int(r.player.battles) },
        { label: 'Evidence floor', value: `${r.minBattles} battles` },
      ]
      : [],
    blocks,
  };
}

/* ----------------------------------------------------------- coach assist */

function coachDeck(d: CoachDeck, value?: string, valueNote?: string): DeckLine {
  return {
    name: d.deckName || d.archetype,
    meta: [d.avgElixir != null ? `${d.avgElixir.toFixed(1)} elixir` : '', d.count != null ? `seen ${int(d.count)}×` : '', d.fill ? 'Deckkies pick' : '']
      .filter(Boolean).join(' · '),
    value,
    valueNote,
    cards: d.cards,
    art: d.art,
    inferredArt: d.inferredArt,
  };
}

export function coachPredictionDoc(p: CoachPrediction): ReportDoc {
  const stage = p.stage + 1;
  return {
    screen: 'Coach Assist',
    subject: p.tag,
    summary: `What ${printableName(p.name, tag(p.tag))} brings to game ${stage}`,
    hue: 'green',
    meta: [
      { label: 'Window', value: range(p.window) },
      { label: 'Series', value: int(p.summary.series) },
      { label: 'Games', value: int(p.summary.games) },
    ],
    blocks: [
      ...(p.revealed?.length ? [{ kind: 'decks' as const, heading: 'Already revealed', decks: p.revealed.map((d) => coachDeck(d)) }] : []),
      {
        kind: 'decks',
        heading: `Likely for game ${stage}`,
        note: p.lowConfidence ? 'Thin evidence' : undefined,
        decks: p.decks.map((d) => coachDeck(d, d.prob != null ? pct(d.prob * 100, 0) : undefined, 'likelihood')),
      },
      ...(p.archetypes?.length ? [{
        kind: 'bars' as const,
        heading: 'Archetypes',
        bars: p.archetypes.map((a) => ({ label: a.name, value: pct(a.prob * 100, 0), fraction: a.prob, hue: 'green' as const })),
      }] : []),
    ],
  };
}

export function coachSuggestionDoc(sg: CoachSuggestion): ReportDoc {
  const stage = sg.stage + 1;
  return {
    screen: 'Coach Assist',
    subject: sg.myTag,
    summary: `Game ${stage} against ${printableName(sg.oppName, tag(sg.oppTag))}`,
    hue: 'green',
    meta: [
      { label: 'You', value: printableName(sg.myName, tag(sg.myTag)) },
      { label: 'Opponent', value: printableName(sg.oppName, tag(sg.oppTag)) },
      { label: 'Ranked by', value: sg.basis },
    ],
    blocks: [
      {
        kind: 'decks',
        heading: 'Play this',
        decks: sg.recommendations.map((d) => coachDeck(d, d.expected ? pct(d.expected.winRate) : undefined,
          d.expected?.vs?.length ? d.expected.vs.slice(0, 3).map((v) => `${v.name} ${Math.round(v.winRate)}%`).join(' · ') : 'expected')),
      },
      ...(sg.opponent.decks.length ? [{
        kind: 'decks' as const,
        heading: 'What they are likely to bring',
        decks: sg.opponent.decks.map((d) => coachDeck(d, d.prob != null ? pct(d.prob * 100, 0) : undefined, 'likelihood')),
      }] : []),
      ...(sg.myPlayed.length || sg.oppPlayed.length ? [{
        kind: 'versus' as const,
        heading: 'Played so far',
        leftLabel: 'You',
        rightLabel: printableName(sg.oppName, 'Opponent'),
        emptyNote: 'Not revealed',
        pairs: Array.from({ length: Math.max(sg.myPlayed.length, sg.oppPlayed.length) }, (_, i) => ({
          left: coachDeck(sg.myPlayed[i] ?? sg.oppPlayed[i]),
          right: sg.oppPlayed[i] ? coachDeck(sg.oppPlayed[i]) : null,
          note: `Game ${i + 1}`,
        })),
      }] : []),
    ],
    caveats: sg.caveats,
  };
}

/* ------------------------------------------------------------- 2v2 pairs */

export function duoPairsDoc(r: DuoReport): ReportDoc {
  const s = r.summary;
  return {
    screen: '2v2 Decks',
    hue: 'blue',
    meta: [
      { label: 'Pairs', value: int(r.total) },
      { label: 'Sort', value: r.sort },
      { label: 'Page', value: `${int(r.page)} of ${int(r.pages)}` },
      ...(r.cards?.length ? [{ label: 'Cards', value: r.cards.map((k) => CARDS_BY_KEY.get(k)?.name ?? k).join(', ') }] : []),
    ],
    blocks: [
      {
        kind: 'stats',
        tiles: [
          { label: 'Unique pairs', value: int(r.total), note: r.cards?.length ? 'matching the card filter' : 'teammate partnerships' },
          { label: 'Battles folded', value: int(s.battlesFolded), note: 'real 2v2 battles' },
          { label: 'On this page', value: int(r.pairs.length), note: `page ${r.page} of ${r.pages}` },
        ],
      },
      {
        kind: 'versus',
        heading: 'Teammate pairs',
        note: `Sorted by ${r.sort}`,
        joiner: '+',
        pairs: r.pairs.map((p, i) => ({
          left: {
            name: `Deck A`,
            value: `#${(r.page - 1) * r.perPage + i + 1}`,
            cards: p.deckA.cardKeys,
            art: p.deckA.art,
          },
          right: {
            name: 'Deck B',
            cards: p.deckB.cardKeys,
            art: p.deckB.art,
          },
          note: `${int(p.occurrences)} battles · ${int(p.players)} players · last ${DAY(p.lastSeen)}${p.mirror ? ' · mirror' : ''}`,
        })),
      },
    ],
  };
}

/* ------------------------------------------------------ global card board */

export function globalCardsDoc(b: GlobalCardBoard): ReportDoc {
  const rows = [...b.cards].filter((c) => c.battles > 0).sort((a, c) => c.useRate - a.useRate);
  const byType = (t: string) => rows.filter((c) => CARDS_BY_KEY.get(c.key)?.type === t);
  const grid = (list: typeof rows) => list.map((c) => ({
    key: c.key,
    stats: [
      { label: 'Battles', value: int(c.battles) },
      { label: 'Use', value: pct(c.useRate), fraction: frac(c.useRate * 3), hue: 'blue' as const },
      { label: 'Win', value: pct(c.winRate), fraction: frac(c.winRate), hue: 'green' as const },
    ],
  }));
  const section = (heading: string, list: typeof rows) => (list.length
    ? [{ kind: 'cards' as const, heading, note: `${int(list.length)} cards · sorted by use rate`, cards: grid(list) }]
    : []);
  return {
    screen: 'Global Cards',
    hue: 'blue',
    meta: [
      { label: 'Window', value: `${range(b.window)} (${b.window.days} days)` },
      ...(b.totalBattles != null ? [{ label: 'Battles', value: int(b.totalBattles) }] : []),
      { label: 'Cards', value: int(rows.length) },
    ],
    blocks: [
      ...section('Troops', byType('Troop')),
      ...section('Buildings', byType('Building')),
      ...section('Spells', byType('Spell')),
    ],
  };
}

/* ------------------------------------------------------ duel insights */

/** The Duel Insights panel, as blocks for the Duel Analysis report. */
export function duelInsightBlocks(zone: DuelZoneReport): ReportBlock[] {
  const all = zone.series;
  if (!all.length) return [];
  const perf = performance(all);
  const line = lineup(all);
  const adapt = adaptation(all);
  const opp = opponents(all);
  const found = verdicts(perf, adapt, line, opp);
  const rate = (r: { pct: number; wins: number; total: number } | null) => (r ? pct(r.pct) : '—');
  const count = (r: { wins: number; total: number } | null) => (r ? `${r.wins} of ${r.total}` : 'under the floor');
  const blocks: ReportBlock[] = [
    {
      kind: 'stats',
      heading: 'Duel insights',
      note: `${int(all.length)} series · ${int(perf.detailSeries)} with per-game detail`,
      tiles: [
        { label: 'Series record', value: `${perf.seriesRecord.wins}–${perf.seriesRecord.total - perf.seriesRecord.wins}`, note: rate(perf.seriesRate) },
        { label: 'Game win rate', value: rate(perf.gameRate), note: count(perf.gameRate), hue: 'green' },
        { label: 'Game 1', value: rate(perf.game1Rate), note: count(perf.game1Rate) },
        { label: 'Deciders', value: rate(perf.deciderRate), note: count(perf.deciderRate) },
      ],
    },
  ];
  if (found.length) {
    blocks.push({
      kind: 'table',
      heading: 'What stands out',
      columns: [
        { key: 'title', label: 'Finding', width: 70 },
        { key: 'body', label: 'Counted', flex: true },
      ],
      rows: found.map((v) => ({
        title: { text: v.title, hue: v.tone === 'good' ? ('green' as const) : v.tone === 'bad' ? ('red' as const) : undefined },
        body: v.body,
      })),
    });
  }
  const lineupDecks: DeckLine[] = [];
  if (line.bestOpener) lineupDecks.push({ name: `Best opener · ${line.bestOpener.deckName || archetypeName(line.bestOpener.archetype)}`, meta: `${line.bestOpener.uses} uses`, value: pct(line.bestOpener.pct), valueNote: `${line.bestOpener.wins} won`, cards: line.bestOpener.cards, art: line.bestOpener.art });
  if (line.bestDecider) lineupDecks.push({ name: `Best decider · ${line.bestDecider.deckName || archetypeName(line.bestDecider.archetype)}`, meta: `${line.bestDecider.uses} uses`, value: pct(line.bestDecider.pct), valueNote: `${line.bestDecider.wins} won`, cards: line.bestDecider.cards, art: line.bestDecider.art });
  if (lineupDecks.length) blocks.push({ kind: 'decks', heading: 'Lineup', decks: lineupDecks });
  if (perf.scorelines.length) {
    blocks.push({
      kind: 'bars',
      heading: 'Scorelines',
      bars: perf.scorelines.map((sl) => ({
        label: sl.label,
        value: int(sl.count),
        fraction: sl.count / Math.max(...perf.scorelines.map((x) => x.count)),
        hue: sl.won ? ('green' as const) : ('red' as const),
      })),
    });
  }
  if (opp.archetypes.length) {
    blocks.push({
      kind: 'table',
      heading: 'Opponent archetypes',
      columns: [
        { key: 'a', label: 'Archetype', flex: true },
        { key: 'g', label: 'Games', width: 22, align: 'right' },
        { key: 'w', label: 'Won', width: 52, align: 'right' },
      ],
      rows: opp.archetypes.map((a) => ({
        a: archetypeName(a.archetype),
        g: int(a.games),
        w: { text: pct(a.pct), bar: frac(a.pct), hue: 'green' as const, thin: a.games < 5 },
      })),
    });
  }
  return blocks;
}
