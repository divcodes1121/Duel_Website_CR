import type {
  TeamFolder,
  TeamMember,
  TeamRecommendation,
  TeamReport,
} from '../state/analyticsClient';
import {
  frac,
  int,
  pct,
  type DeckLine,
  type ReportBlock,
  type ReportDoc,
  type ReportHue,
  type TableRow,
} from './analyticsReport';

/**
 * A whole team analysis as a printable dossier.
 *
 * ── WHAT THIS IS FOR, AND WHY IT IS LONG ──────────────────────────────────
 *
 * The screen is a tool: you open one opponent, you decide, you close it. The
 * PDF is the other thing — the document a coach takes to a match, annotates,
 * and hands to five people who were not at the computer. That is a different
 * job, and it is the reason this is not "the screen, printed". The screen can
 * afford to hide the second-best option behind a click; a sheet of paper in
 * somebody's hand cannot ask for one.
 *
 * So EVERY player gets a section, on both sides, whether or not the analysis
 * found them anything. The length follows the rosters rather than a target:
 * ten against ten is a long document because ten against ten is a lot of
 * preparation, and a two-a-side scrim prints a short one.
 *
 * ── THE TWO PASSES THROUGH THE SAME DATA, ON PURPOSE ──────────────────────
 *
 * Opponent by opponent, then teammate by teammate. That is a duplication of
 * the underlying numbers and it is the point: they answer different questions
 * on different days. "We are playing this person on Saturday, what do we
 * bring" is the first. "What am *I* responsible for across the whole match"
 * is the second, and it is the one a player reads about themselves. Printing
 * only the first makes every player reconstruct their own half by flicking
 * through ten sections.
 *
 * ── NO LAYOUT HERE ────────────────────────────────────────────────────────
 *
 * Pure, like every other adapter: no millimetres, no pagination, no jsPDF.
 * What it decides is editorial — which figures lead, what each column is
 * called, and which qualification has to travel with which number. The
 * renderer owns everything else.
 */

/* ------------------------------------------------------------------ util */

/** A deck's identity, order-insensitive — the same rule `duelImport` uses. */
function deckKey(cards: string[]): string {
  return [...cards].sort().join('|');
}

const DAY = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');

function windowLabel(w: { from: string | null; to: string | null }): string {
  if (!w.from && !w.to) return 'All stored history';
  return `${DAY(w.from)} – ${DAY(w.to)}`;
}

/** A member's name, falling back to the tag the way every screen does. */
function who(m: { name: string; tag: string }): string {
  return m.name && m.name !== m.tag ? m.name : m.tag;
}

/**
 * The teammate who flies a recommendation.
 *
 * EVERY CALLER OF THIS IS A MATCH-PLAN PATH, where an owner always exists —
 * they are all inside a loop over `report.blue`, which is empty in a scouting
 * report. The fallback is therefore unreachable today, and it is written out
 * rather than asserted away with `!` because the alternative is a document
 * that would crash on a shape the types now permit. A dash prints; a
 * `TypeError` inside a PDF build hands the reader a failed export with no
 * indication of which section broke.
 */
function pilot(r: TeamRecommendation): string {
  return r.owner ? who(r.owner) : '—';
}

/**
 * The second figure on a recommendation: practice if it is owned, the deck's
 * own record against the field if it is not. Same split as `recLine`.
 */
function comfortText(r: TeamRecommendation): string {
  if (r.comfort) return `${int(r.comfort.games)} games at ${pct(r.comfort.winRate)}`;
  if (r.overallWinRate !== null && r.overallWinRate !== undefined) {
    return `${pct(r.overallWinRate)} vs the field`;
  }
  return '—';
}

/**
 * Colour for an expected win rate.
 *
 * ONLY THREE OUTCOMES, and the middle one is neutral rather than amber. A
 * duel win rate near 50 is not a warning, it is the normal case — colouring it
 * would put a caution on most of the document and spend the reader's attention
 * before the two figures that deserve it.
 */
function rateHue(v: number | null | undefined): ReportHue {
  if (v === null || v === undefined) return 'neutral';
  if (v >= 55) return 'green';
  if (v < 45) return 'red';
  return 'neutral';
}

/** What the basis chip says on screen, said the same way in print. */
function basisText(m: { basis: string; battles: number }): string {
  if (m.basis === 'stored') return `${int(m.battles)} battles stored`;
  if (m.basis === 'live') return 'live battlelog only (~25 battles)';
  return 'no history';
}

/**
 * A recommendation as a printable deck line.
 *
 * `spreadCovered` rides in the meta and is NOT optional garnish: an expected
 * win rate computed over 60% of what somebody plays is a different claim from
 * one computed over 95%, and the number alone cannot tell them apart. The
 * screen puts it in an evidence column; a printed sheet has to carry it on the
 * deck itself or it is lost the moment the page is photocopied.
 */
function recLine(r: TeamRecommendation, opts: { showOwner?: boolean } = {}): DeckLine {
  /* OWNED OR NOT. A match plan's recommendation belongs to a teammate and its
     second figure is how much they have piloted it; a scouting report's is an
     archetype representative belonging to nobody, and the honest second figure
     there is the deck's own record against the field — which is what says
     whether it beats THEM or simply beats everybody. `showOwner` cannot be
     used to decide this: a caller may ask for an owner that is not there. */
  const owned = !!r.owner && !!r.comfort;
  const bits: string[] = [r.name];
  if (r.comfort) {
    bits.push(`${int(r.comfort.games)} games at ${pct(r.comfort.winRate)}`);
  } else if (r.overallWinRate !== null && r.overallWinRate !== undefined) {
    bits.push(`${pct(r.overallWinRate)} vs the field`);
  }
  bits.push(`covers ${pct(r.spreadCovered, 0)} of their play`);
  return {
    name: opts.showOwner && owned && r.owner ? who(r.owner) : r.name,
    meta: bits.slice(1).join(' · '),
    value: pct(r.expectedWinRate),
    valueNote: 'expected',
    cards: r.cards,
    art: r.art,
  };
}

/** An opponent's own deck as a printable line. */
function theirLine(d: {
  name: string;
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  matches: number;
  winRate: number;
  useRate: number;
  avgElixir: number | null;
}): DeckLine {
  return {
    name: d.name,
    meta: `${int(d.matches)} games · ${pct(d.winRate)} win · ${pct(d.useRate)} of their play${
      d.avgElixir != null ? ` · ${d.avgElixir.toFixed(1)} elixir` : ''
    }`,
    value: pct(d.useRate),
    valueNote: 'use rate',
    cards: d.cards,
    art: d.art,
  };
}

/** The best option a given teammate has against a given opponent, or null. */
function bestFor(folder: TeamFolder, tag: string): TeamRecommendation | null {
  const row = folder.perPlayer.find((r) => r.owner.tag === tag);
  return row?.decks[0] ?? null;
}

/** Why a teammate has nothing, in the reader's words rather than the API's. */
const NO_OPTION: Record<string, string> = {
  no_history: 'Nothing stored for them yet',
  no_comfort: 'No deck played often enough to count',
  no_evidence: 'Decks, but no measured record against this spread',
};

/* -------------------------------------------------------------- sections */

/**
 * SCOUT ONLY: the roster taken as one spread, and the decks that answer it.
 *
 * IT LEADS THE DOCUMENT, above the player-by-player sections, because it is
 * the coarser reading and the only page most readers need. A coach printing a
 * scouting report before a clan war wants one sheet saying *this is what they
 * bring and this is what to practise*; the sections after it are for the
 * person preparing an individual match.
 */
function overallBlocks(report: TeamReport): ReportBlock[] {
  const o = report.overall;
  if (!o) return [];

  const blocks: ReportBlock[] = [
    {
      kind: 'divider',
      title: 'The roster as a whole',
      subtitle: 'Everything they play, pooled — and what answers it',
      hue: 'violet',
      contents: 'The roster as a whole',
      stats: [
        { label: 'Players read', value: String(o.players), note: 'one section each below' },
        { label: 'Archetypes', value: String(o.spread.length), note: 'across the roster' },
        {
          label: 'Decks weighed',
          value: int(report.pool.decks),
          note: 'one per archetype, most-played list',
        },
        { label: 'Window', value: `${report.days}d`, note: 'every figure in this report' },
      ],
    },
  ];

  if (o.spread.length) {
    blocks.push({
      kind: 'spread',
      heading: 'What you will meet',
      note:
        'Every considered deck on the roster pooled into one spread, weighted by GAMES rather ' +
        'than by player — so the busiest member of a roster counts for more than its quietest, ' +
        'which is what actually decides what turns up across a match.',
      segments: o.spread.map((s) => ({
        label: s.name,
        share: s.share,
        note: `${int(s.games)} games`,
      })),
    });
  }

  if (o.recommended.length) {
    blocks.push({
      kind: 'decks',
      heading: 'What to practise',
      note:
        'Ranked against the pooled spread above. Each is the most-played real list of its ' +
        'archetype — nothing here is generated, and every one has a record of its own to be ' +
        'scored on. The second figure is that record against the whole field, which is what ' +
        'separates a deck that beats THEM from a deck that beats everybody.',
      decks: o.recommended.map((r) => recLine(r)),
    });
  } else if (o.reason) {
    blocks.push({
      kind: 'note',
      heading: 'Nothing is ranked against this roster',
      body:
        o.reason === 'no_history'
          ? 'Nothing is stored for anybody on this roster inside the window, so there is no ' +
            'combined spread to answer.'
          : 'No deck has a measured record against what this roster brings, so nothing is ' +
            'ranked. A recommendation here would be a guess wearing a percentage.',
    });
  }

  return blocks;
}

/** SCOUT ONLY: the one roster, every tag, and how well each was read. */
function scoutRosterBlocks(report: TeamReport): ReportBlock[] {
  return [
    {
      kind: 'table',
      heading: 'The roster',
      note:
        'Each of these gets a section below, in this order. A player read from the live ' +
        'battlelog has never been collected before — everything printed about them rests on ' +
        'roughly their last twenty-five battles.',
      columns: [
        { key: 'n', label: '#', width: 10 },
        { key: 'name', label: 'Player', flex: true },
        { key: 'tag', label: 'Tag', width: 32 },
        { key: 'basis', label: 'Read from', width: 46 },
        { key: 'battles', label: 'Battles', width: 24, align: 'right' },
        { key: 'win', label: 'Win rate', width: 26, align: 'right' },
        { key: 'decks', label: 'Decks', width: 20, align: 'right' },
        { key: 'window', label: 'Window', width: 46 },
      ],
      rows: report.red.map((m, i): TableRow => ({
        n: String(i + 1),
        name: { text: who(m), hue: 'red' },
        tag: m.tag,
        basis: { text: basisText(m), thin: m.basis !== 'stored' },
        battles: int(m.battles),
        win: { text: pct(m.winRate), bar: frac(m.winRate), hue: rateHue(m.winRate) },
        decks: int(m.decks),
        window: { text: windowLabel(m.window), thin: true },
      })),
    },
  ];
}

/** Both rosters, every tag, and how well each one could be read. */
function rosterBlocks(report: TeamReport): ReportBlock[] {
  const table = (
    members: TeamMember[],
    hue: ReportHue,
    heading: string,
    note: string,
  ): ReportBlock => ({
    kind: 'table',
    heading,
    note,
    columns: [
      { key: 'n', label: '#', width: 10 },
      { key: 'name', label: 'Player', flex: true },
      { key: 'tag', label: 'Tag', width: 32 },
      { key: 'basis', label: 'Read from', width: 46 },
      { key: 'battles', label: 'Battles', width: 24, align: 'right' },
      { key: 'win', label: 'Win rate', width: 26, align: 'right' },
      { key: 'decks', label: 'Decks', width: 20, align: 'right' },
      { key: 'window', label: 'Window', width: 46 },
    ],
    rows: members.map((m, i): TableRow => ({
      n: String(i + 1),
      name: { text: who(m), hue },
      tag: m.tag,
      // A tag nobody has ever collected is the thing the reader most needs to
      // notice: everything printed about that player rests on ~25 battles.
      basis: { text: basisText(m), thin: m.basis !== 'stored' },
      battles: int(m.battles),
      win: { text: pct(m.winRate), bar: frac(m.winRate), hue: rateHue(m.winRate) },
      decks: int(m.decks),
      window: { text: windowLabel(m.window), thin: true },
    })),
  });

  return [
    {
      kind: 'divider',
      title: 'Both squads',
      subtitle: 'The rosters as the service read them',
      hue: 'violet',
      contents: 'Both squads',
      stats: [
        { label: 'Your squad', value: String(report.blue.length), note: 'players' },
        { label: 'Opponents', value: String(report.red.length), note: 'one folder each' },
        {
          label: 'Candidate decks',
          value: int(report.pool.decks),
          note: `at least ${report.limits.minComfortGames} games each`,
        },
        { label: 'Window', value: `${report.days}d`, note: 'every figure in this report' },
      ],
    },
    table(
      report.blue,
      'blue',
      'Your squad',
      'The candidate pool is built only from decks these players have actually piloted. A ' +
        'recommendation nobody on the team can fly is worth nothing on the day.',
    ),
    table(
      report.red,
      'red',
      'Opponent squad',
      'Each of these gets a section below, in this order.',
    ),
  ];
}

/** The grid, plus the squad-wide pick for every opponent. */
function boardBlocks(report: TeamReport): ReportBlock[] {
  const blocks: ReportBlock[] = [
    {
      kind: 'divider',
      title: 'The board at a glance',
      subtitle: 'Every teammate against every opponent',
      hue: 'violet',
      contents: 'The board at a glance',
    },
  ];

  if (report.blue.length && report.folders.length) {
    blocks.push({
      kind: 'matrix',
      heading: 'Expected win rate, best deck each',
      note:
        'One cell per pairing: the expected win rate of the best deck that teammate already ' +
        'plays, against that opponent’s spread. It is a ranking aid, not a prediction of a match.',
      columns: report.folders.map((f) => ({
        label: who(f.player),
        sub: f.player.tag,
      })),
      rows: report.blue.map((m) => ({
        label: who(m),
        sub: m.tag,
        cells: report.folders.map((f) => {
          const best = bestFor(f, m.tag);
          if (!best) return { text: '—', fraction: null };
          return {
            text: pct(best.expectedWinRate, 0),
            fraction: best.expectedWinRate,
            // Under half their play measured is a figure worth keeping and
            // not worth ranking on.
            thin: best.spreadCovered < 50,
          };
        }),
      })),
      legend:
        'Green is the strongest pairing on this board and red the weakest — the scale is ' +
        'stretched across the range actually present, so the colours compare pairings with ' +
        'each other and not against 50%. A struck cell is no evidence, which is not the same ' +
        'as a bad matchup. Pale figures cover under half of what that opponent plays.',
    });
  }

  const picks = report.folders
    .map((f) => ({ f, r: f.recommended[0] }))
    .filter((x): x is { f: TeamFolder; r: TeamRecommendation } => !!x.r);

  if (picks.length) {
    blocks.push({
      kind: 'table',
      heading: 'The squad’s single best answer to each opponent',
      note:
        'Deduplicated by deck, so the same list can appear against two opponents — that is a ' +
        'real answer, not a repeat, and the owner column says who would fly it.',
      columns: [
        { key: 'opp', label: 'Opponent', width: 44 },
        { key: 'tag', label: 'Tag', width: 30 },
        { key: 'deck', label: 'Deck to bring', flex: true },
        { key: 'owner', label: 'Piloted by', width: 40 },
        { key: 'exp', label: 'Expected', width: 26, align: 'right' },
        { key: 'cov', label: 'Covers', width: 22, align: 'right' },
        { key: 'games', label: 'Their games', width: 26, align: 'right' },
      ],
      rows: picks.map(({ f, r }): TableRow => ({
        opp: { text: who(f.player), hue: 'red' },
        tag: { text: f.player.tag, thin: true },
        deck: r.name,
        owner: { text: pilot(r), hue: 'blue' },
        exp: {
          text: pct(r.expectedWinRate),
          bar: frac(r.expectedWinRate),
          hue: rateHue(r.expectedWinRate),
        },
        cov: { text: pct(r.spreadCovered, 0), thin: r.spreadCovered < 50 },
        games: r.comfort ? int(r.comfort.games) : { text: '—', thin: true },
      })),
    });
  }

  return blocks;
}

/** One opponent: what they play, and what the squad answers with. */
function folderBlocks(
  folder: TeamFolder,
  index: number,
  total: number,
  report: TeamReport,
): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const name = who(folder.player);

  blocks.push({
    kind: 'divider',
    title: name,
    subtitle: `Opponent ${index + 1} of ${total}`,
    tag: folder.player.tag,
    hue: 'red',
    /* THE SIDE IS PART OF THE LABEL. Every name in this report appears twice —
       once as an opponent and once as a teammate, unless the rosters are
       disjoint — so a contents listing "Kito King 15" and "Kito King 52" with
       nothing between them sends the reader to the wrong half of the document.
       The sheets themselves say which they are in the subtitle; the contents
       has only this line. */
    contents: `${name} — opponent`,
    depth: 1,
    stats: [
      { label: 'Battles', value: int(folder.player.battles), note: basisText(folder.player) },
      { label: 'Their win rate', value: pct(folder.player.winRate), note: 'over the window' },
      {
        label: 'Decks seen',
        value: String(folder.theirDecks.length),
        note: `${folder.spread.length} archetypes`,
      },
      {
        label: 'Answers weighed',
        value: int(folder.considered),
        note: 'decks from your squad',
      },
    ],
  });

  if (folder.reason) {
    blocks.push({
      kind: 'note',
      body:
        folder.reason === 'no_history'
          ? `Nothing is stored for ${name} in this window, so there is no spread to answer. ` +
            'A newly searched tag is queued for collection and fills in within a couple of hours.'
          : `${name} has stored decks, but no rung of the matchup ladder had evidence against ` +
            'them, so no recommendation would be more than a guess. The decks below are still ' +
            'what they play, and are worth reading on their own.',
    });
  }

  /* ── What they play ─────────────────────────────────────────────────── */

  if (folder.spread.length) {
    blocks.push({
      kind: 'spread',
      heading: 'What they play',
      note:
        'Their archetype spread over the window, weighted by how much of their play each one ' +
        'is. This is the thing every recommendation below is scored against.',
      segments: folder.spread.map((s) => ({
        label: s.name,
        share: s.share,
        note: `${pct(s.share, 1)} · ${int(s.games)} games`,
      })),
    });
  }

  if (folder.theirDecks.length) {
    blocks.push({
      kind: 'decks',
      heading: `${name}’s decks`,
      note: `Ordered by how often they bring it. Only decks over ${report.limits.minOpponentDeckGames} games are listed — their long tail says nothing about what they will bring on the day.`,
      decks: folder.theirDecks.map(theirLine),
    });
  }

  /* ── What the squad brings ──────────────────────────────────────────── */

  if (folder.recommended.length) {
    blocks.push({
      kind: 'decks',
      heading: 'What your squad should bring',
      note:
        'The squad-wide top three, deduplicated by deck. Every one is a list somebody on your ' +
        'side already flies, with the games behind it printed beside the name.',
      decks: folder.recommended.map((r) => recLine(r, { showOwner: true })),
    });

    // The relationship, drawn. Their most-played deck against the answer, so
    // the reader can see both eight-card lists at once rather than holding one
    // in their head while reading the other.
    const pairs = folder.theirDecks.slice(0, 3).map((d, i) => ({
      left: theirLine(d),
      right: folder.recommended[i] ? recLine(folder.recommended[i], { showOwner: true }) : null,
      note: folder.recommended[i]
        ? `${pilot(folder.recommended[i])} flies ${folder.recommended[i].name} — expected ` +
          `${pct(folder.recommended[i].expectedWinRate)} across ${name}’s whole spread, not ` +
          'against this one deck.'
        : undefined,
    }));
    if (pairs.length) {
      blocks.push({
        kind: 'break',
      });
      blocks.push({
        kind: 'versus',
        heading: `${name}: head to head`,
        note:
          'Their most-played decks on the left, your squad’s answers on the right. The pairing ' +
          'is by rank, not by matchup — each recommendation is scored against their whole ' +
          'spread rather than against the deck it is printed beside.',
        leftLabel: `${name} plays`,
        rightLabel: 'Your squad answers',
        pairs,
      });
    }

    // The evidence behind the top pick. This is the part a sceptical reader
    // goes to, and the part a screenshot of the screen loses.
    const top = folder.recommended[0];
    if (top.matchups.length) {
      blocks.push({
        kind: 'table',
        heading: `Why ${top.name} — the rung behind every archetype`,
        note:
          'Each row is one archetype of their play, what this deck does against it, and which ' +
          'rung of the ladder that came from. An archetype no rung can answer is left out of ' +
          'the average rather than counted as even, which is why "covers" is below 100%.',
        columns: [
          { key: 'arch', label: 'Their archetype', flex: true },
          { key: 'share', label: 'Share of play', width: 30, align: 'right' },
          { key: 'wr', label: 'This deck', width: 28, align: 'right' },
          { key: 'games', label: 'Games', width: 24, align: 'right' },
          { key: 'src', label: 'Measured on', width: 60 },
          { key: 'tier', label: 'Evidence', width: 26 },
        ],
        rows: top.matchups.map((m): TableRow => ({
          arch: m.name,
          share: pct(m.share, 1),
          wr:
            m.winRate === null
              ? { text: 'no evidence', thin: true }
              : { text: pct(m.winRate), bar: frac(m.winRate), hue: rateHue(m.winRate) },
          games: { text: int(m.games), thin: m.winRate === null },
          src: { text: m.sourceText ?? m.source ?? '—', thin: true },
          tier: { text: m.tier ?? '—', thin: m.tier !== 'high' },
        })),
      });
    }
  }

  /* ── Every teammate, including the ones with nothing ────────────────── */

  if (folder.perPlayer.length) {
    blocks.push({
      kind: 'table',
      heading: `Every teammate against ${name}`,
      note:
        'In roster order, and everyone appears. A player with nothing to offer is a different ' +
        'fact from a player who is not on the team, and a roster of five must not print as ' +
        'a roster of three.',
      columns: [
        { key: 'who', label: 'Teammate', width: 42 },
        { key: 'tag', label: 'Tag', width: 30 },
        { key: 'deck', label: 'Their best deck here', flex: true },
        { key: 'exp', label: 'Expected', width: 26, align: 'right' },
        { key: 'cov', label: 'Covers', width: 22, align: 'right' },
        { key: 'comfort', label: 'Their record on it', width: 40, align: 'right' },
        { key: 'n', label: 'Weighed', width: 22, align: 'right' },
      ],
      rows: report.blue.map((m): TableRow => {
        const row = folder.perPlayer.find((r) => r.owner.tag === m.tag);
        const best = row?.decks[0];
        if (!best) {
          const reason = row?.reason ? NO_OPTION[row.reason] : 'Not analysed';
          return {
            who: { text: who(m), hue: 'blue' },
            tag: { text: m.tag, thin: true },
            deck: { text: reason ?? 'Nothing to offer', thin: true },
            exp: { text: '—', thin: true },
            cov: { text: '—', thin: true },
            comfort: { text: '—', thin: true },
            n: { text: int(row?.considered ?? 0), thin: true },
          };
        }
        return {
          who: { text: who(m), hue: 'blue' },
          tag: { text: m.tag, thin: true },
          deck: best.name,
          exp: {
            text: pct(best.expectedWinRate),
            bar: frac(best.expectedWinRate),
            hue: rateHue(best.expectedWinRate),
          },
          cov: { text: pct(best.spreadCovered, 0), thin: best.spreadCovered < 50 },
          comfort: comfortText(best),
          n: int(row?.considered ?? 0),
        };
      }),
    });
  }

  return blocks;
}

/** One teammate: what they fly, and their whole assignment board. */
function teammateBlocks(
  member: TeamMember,
  index: number,
  total: number,
  report: TeamReport,
): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const name = who(member);

  // Their decks, gathered across every folder and deduplicated. The report has
  // no per-player deck list of its own — a candidate only exists inside the
  // folder it was scored for — so this is assembled rather than read.
  const seen = new Set<string>();
  const own: TeamRecommendation[] = [];
  for (const f of report.folders) {
    for (const r of f.perPlayer.find((x) => x.owner.tag === member.tag)?.decks ?? []) {
      const k = deckKey(r.cards);
      if (seen.has(k)) continue;
      seen.add(k);
      own.push(r);
    }
  }

  const assignments = report.folders.map((f) => ({ f, best: bestFor(f, member.tag) }));
  const rated = assignments.filter((a) => a.best).map((a) => a.best!.expectedWinRate);
  const bestOverall = rated.length ? Math.max(...rated) : null;

  blocks.push({
    kind: 'divider',
    title: name,
    subtitle: `Your squad — player ${index + 1} of ${total}`,
    tag: member.tag,
    hue: 'blue',
    contents: `${name} — your squad`,
    depth: 1,
    stats: [
      { label: 'Battles', value: int(member.battles), note: basisText(member) },
      { label: 'Their win rate', value: pct(member.winRate), note: 'over the window' },
      {
        label: 'Decks in pool',
        value: String(own.length),
        note: `of ${int(member.decks)} seen`,
      },
      {
        label: 'Best pairing',
        value: bestOverall === null ? '—' : pct(bestOverall),
        note: bestOverall === null ? 'nothing measurable' : 'against any opponent',
      },
    ],
  });

  if (!own.length) {
    blocks.push({
      kind: 'note',
      body:
        `${name} has no deck in the candidate pool. Either nothing is stored for them in this ` +
        `window, or no single deck clears the ${report.limits.minComfortGames}-game floor that ` +
        'separates a deck somebody plays from a deck somebody tried. They still appear in every ' +
        'table above, because a player with nothing to offer is a fact worth printing.',
    });
    return blocks;
  }

  blocks.push({
    kind: 'decks',
    heading: `What ${name} flies`,
    note:
      'Every deck of theirs that entered the pool, with their own record on it. This is the ' +
      'comfort half of the score — the tiebreak, never the ranking.',
    /* The value column is 22 mm. "their own record, 14 games" does not fit in
       it, and a right-aligned overflow grows leftwards over the card art —
       the renderer clips it now, but the honest fix is to say it in the width
       available and leave the sentence to the meta line. */
    decks: own.map((r) => ({
      ...recLine(r),
      value: r.comfort ? pct(r.comfort.winRate) : pct(r.overallWinRate),
      valueNote: r.comfort ? `${int(r.comfort.games)} games` : 'vs the field',
    })),
  });

  blocks.push({
    kind: 'table',
    heading: `${name}’s assignment board`,
    note:
      'Every opponent, and the best deck this player has against them. Read down the Expected ' +
      'column to see where they are the right pick and where somebody else is.',
    columns: [
      { key: 'opp', label: 'Opponent', width: 42 },
      { key: 'tag', label: 'Tag', width: 30 },
      { key: 'deck', label: 'Bring', flex: true },
      { key: 'exp', label: 'Expected', width: 26, align: 'right' },
      { key: 'cov', label: 'Covers', width: 22, align: 'right' },
      { key: 'squad', label: 'Squad’s best', width: 28, align: 'right' },
      { key: 'lead', label: 'Who leads', width: 40 },
    ],
    rows: assignments.map(({ f, best }): TableRow => {
      const squadBest = f.recommended[0];
      const isLead = !!squadBest?.owner && !!best && squadBest.owner.tag === member.tag;
      if (!best) {
        const row = f.perPlayer.find((r) => r.owner.tag === member.tag);
        return {
          opp: { text: who(f.player), hue: 'red' },
          tag: { text: f.player.tag, thin: true },
          deck: { text: (row?.reason && NO_OPTION[row.reason]) || 'Nothing to offer', thin: true },
          exp: { text: '—', thin: true },
          cov: { text: '—', thin: true },
          squad: squadBest ? pct(squadBest.expectedWinRate) : { text: '—', thin: true },
          lead: squadBest ? { text: pilot(squadBest), thin: true } : { text: '—', thin: true },
        };
      }
      return {
        opp: { text: who(f.player), hue: 'red' },
        tag: { text: f.player.tag, thin: true },
        deck: best.name,
        exp: {
          text: pct(best.expectedWinRate),
          bar: frac(best.expectedWinRate),
          hue: rateHue(best.expectedWinRate),
        },
        cov: { text: pct(best.spreadCovered, 0), thin: best.spreadCovered < 50 },
        squad: squadBest ? pct(squadBest.expectedWinRate) : { text: '—', thin: true },
        // Naming the leader on every row is what turns this from a table of
        // one player's numbers into a table they can act on: it says "this one
        // is yours" or "this one is somebody else's" without cross-referencing.
        lead: isLead
          ? { text: `${who(member)} — this is yours`, hue: 'green' }
          : squadBest
            ? { text: pilot(squadBest), thin: true }
            : { text: '—', thin: true },
      };
    }),
  });

  return blocks;
}

/* ------------------------------------------------------------------ main */

/**
 * The whole dossier.
 *
 * `days`, the floors and the snapshot age all come off the report rather than
 * being restated here, so a change on the server reaches the printed page
 * without an edit.
 */
export function teamAnalysisReport(
  report: TeamReport,
  opts: { savedAt?: string | null } = {},
): ReportDoc {
  const blue = report.blue.length;
  const red = report.red.length;
  /* AN UNSTAMPED REPORT IS A MATCH PLAN. Only a server that predates the two
     modes omits `mode`, and that server could produce nothing else. Do not
     infer from `blue.length` — a match plan whose roster failed to resolve has
     an empty one too, and would print here as a scouting report with a method
     section describing a squad it never had. */
  const scout = report.mode === 'scout';

  /* THE TWO DOCUMENTS DIVERGE HERE, and only here. A scouting report has no
     squad, so the four blue-side passes have nothing to iterate: the
     both-squads divider would print "Your squad: 0", the assignment matrix is
     blue x folders, and the teammate sections are one per blue player. They
     are skipped rather than left to render empty, because an empty section
     with a confident heading reads as a fault in the analysis rather than as
     a section that does not apply. */
  const blocks: ReportBlock[] = scout
    ? [
        ...overallBlocks(report),
        ...scoutRosterBlocks(report),
        ...report.folders.flatMap((f, i) => folderBlocks(f, i, report.folders.length, report)),
      ]
    : [
        ...rosterBlocks(report),
        ...boardBlocks(report),
        ...report.folders.flatMap((f, i) => folderBlocks(f, i, report.folders.length, report)),
        ...report.blue.flatMap((m, i) => teammateBlocks(m, i, blue, report)),
      ];

  blocks.push(
    {
      kind: 'divider',
      title: 'Method, and what it does not say',
      subtitle: 'How every number above was produced',
      hue: 'violet',
      contents: 'Method, and what it does not say',
    },
    {
      kind: 'note',
      heading: 'How a recommendation is scored',
      body:
        'An opponent’s decks give an archetype spread, each archetype weighted by how much of ' +
        'their play it is. Every candidate deck is then scored as the sum over those ' +
        'archetypes of weight × win rate against that archetype. The win rate comes from the ' +
        'same matchup ladder the Deck Counter uses, unchanged: exact deck-versus-archetype ' +
        'first, then a seven-card cluster, then six, then the archetype matrix. Every rung is ' +
        'symmetrised, which is what removes the house edge that tracked players otherwise show.',
    },
    scout
      ? {
          kind: 'note',
          heading: 'Where the candidate decks come from',
          body:
            'One deck per archetype: the most-played real list of that archetype across the ' +
            'matchup population. They are not generated, not picked from a leaderboard, and ' +
            'not decks anybody in particular owns — which is why no row here names a pilot or ' +
            'quotes games played. The population is deliberately the same one the win rates ' +
            'come from, so the deck printed and the figure beside it describe the same games. ' +
            'Each row also carries that deck’s own record against the whole field, because the ' +
            'expected rate alone cannot separate a deck that beats this roster from a deck ' +
            'that beats everybody.',
        }
      : {
          kind: 'note',
          heading: 'Comfort is a tiebreak, not a model',
          body:
            `A deck played forty times gains at most a point and a half of expected win rate ` +
            `over one played ${report.limits.minComfortGames} times, and nothing below ` +
            `${report.limits.minComfortGames} games enters the pool at all. That ordering is ` +
            'deliberate: the matchup comes first because it is what was asked, and practice ' +
            'breaks the tie between two decks that are inside the noise of each other. It is ' +
            'not a claim that repetition is worth a point and a half of win rate.',
        },
    {
      kind: 'note',
      heading: 'An archetype nobody can answer is left out, not scored as even',
      body:
        'Where no rung of the ladder has evidence for a deck against an archetype, that ' +
        'archetype is removed from the denominator rather than counted at 50%. Averaging over ' +
        'an empty set flattens the ranking exactly where the evidence is thinnest. The cost is ' +
        'that an expected win rate can describe less than all of an opponent’s play, which is ' +
        'what the "covers" column reports on every table in this report.',
    },
  );

  const caveats = [
    'Every figure is a snapshot of stored history over the stated window, not a prediction of ' +
      'a match. Two decks of one archetype can print identical numbers and both be correct: ' +
      'different lists that neither clear the deck-level floor both fall back to the archetype ' +
      'matrix, which cannot tell them apart.',
    scout
      ? 'The candidate pool is one deck per archetype, and nothing here checks whether anybody ' +
        'on your side can pilot it. A deck at the top of these tables may be one your team has ' +
        'never played; run a Match Plan with your own roster pasted to see what your players ' +
        'can actually bring.'
      : 'The candidate pool is only decks your squad has actually played. This report will ' +
        'never suggest the best deck in the game if nobody on the roster flies it, and that is ' +
        'the design rather than a limitation of the data.',
    'A player marked "live battlelog only" has never been collected before. Everything printed ' +
      'about them rests on roughly the last twenty-five battles, and a fuller read appears once ' +
      'the collector has reached them — usually within a couple of hours of the first search.',
    'Pairings are scored independently. Nothing here models a draft, a ban, or the order decks ' +
      'are played in, so the board cannot tell you how to assign a squad against a squad — only ' +
      'what each pairing is worth if it happens.',
  ];
  if (report.pool.reason) {
    caveats.unshift(
      report.pool.reason === 'no_matchup_data'
        ? 'The matchup snapshot on the analytics service had not finished building when this ' +
          'ran, so no section recommends anything. The roster halves are still complete, and ' +
          're-running in a minute or two fills the rest in.'
        : report.pool.reason === 'no_blue_history'
          ? 'Nothing is stored for your side at all, so no section of this report recommends ' +
            'anything. The opponent halves are still complete.'
          : `No deck on your side clears the ${report.limits.minComfortGames}-game floor, so ` +
            'there is nothing anyone has demonstrably piloted to recommend.',
    );
  }
  if (report.rejected.blue.length || report.rejected.red.length) {
    caveats.unshift(
      `Tags the service refused and which are therefore absent from every page: ${[
        ...report.rejected.blue,
        ...report.rejected.red,
      ].join(', ')}.`,
    );
  }
  if (opts.savedAt) {
    caveats.unshift(
      `This is a SAVED analysis, run on ${new Date(opts.savedAt).toLocaleString('en-GB')}. ` +
        'Nothing in it has been recomputed since — the window it measured has moved on.',
    );
  }

  const meta: { label: string; value: string }[] = [
    ...(scout
      ? [{ label: 'Roster scouted', value: `${red} player${red === 1 ? '' : 's'}` }]
      : [
          { label: 'Your squad', value: `${blue} player${blue === 1 ? '' : 's'}` },
          { label: 'Opponents', value: `${red} player${red === 1 ? '' : 's'}` },
        ]),
    { label: 'Window', value: `${report.days} days` },
    { label: 'Candidate decks', value: int(report.pool.decks) },
    ...(scout
      ? []
      : [{ label: 'Comfort floor', value: `${report.limits.minComfortGames} games` }]),
    {
      label: 'Matchup table',
      value:
        report.status.ageSeconds === null
          ? 'building'
          : `${int(report.status.battles)} battles, ${Math.round(report.status.ageSeconds / 60)}m old`,
    },
    {
      label: 'Analysis run',
      value: opts.savedAt ? new Date(opts.savedAt).toLocaleString('en-GB') : 'just now',
    },
  ];

  return {
    screen: scout ? 'Scouting Report' : 'Match Plan',
    /* THE COVER NAMES WHAT THE DOCUMENT IS. A scouting report has no "v" in
       it — printing "0 v 5" would put a squad on the cover of a document that
       contains none, and the first thing a reader does with a printed sheet is
       check it is the right one. */
    subject: `${scout ? `${red} player${red === 1 ? '' : 's'}` : `${blue} v ${red}`} — ${report.folders
      .map((f) => who(f.player))
      .slice(0, 3)
      .join(', ')}${report.folders.length > 3 ? ` +${report.folders.length - 3}` : ''}`,
    hue: 'pink',
    summary: scout
      ? 'What one roster plays, and the decks that beat it.'
      : 'A section for every player on both sides.',
    meta,
    blocks,
    caveats,
    contents: true,
  };
}
