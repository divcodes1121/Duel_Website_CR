import type { DuelReport, DuelZoneReport } from '../state/analyticsClient';
import { int, pct, type ReportBlock, type ReportDoc } from './analyticsReport';
import { printableName } from './report/text';

/* Report models for the two duel screens.
 *
 * WHY THESE ARE HERE AT ALL: Duel Zone and Duel Analysis were the only
 * analytics screens with no Export PDF at all — not hidden on a phone, never
 * wired. `reportAdapters.ts` covers Player Analysis, Live Player, Meta and
 * Cards, and these two were simply never added.
 *
 * SEPARATE FILE, reached only by pressing Export: the screens' export thunks
 * (`useScreenExport`) import it dynamically, like every adapter since the
 * 2026-09-26 rebuild, so none of it is in the chunk everyone loads.
 *
 * THE MODEL IS THE SCREEN'S OWN NUMBERS, NEVER A NEW READING. Nothing here
 * recomputes anything: every figure is one the screen was already showing, so
 * an export cannot disagree with the page it came from. Where the screen
 * withholds a figure the report withholds it too — a duel population that
 * could not clear its evidence floor says so rather than printing a widened
 * number as if it answered the question asked.
 */

const DAY = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10) : '—';

/** A count and its share, or an em dash — never a bare 0 that reads as measured.
 *
 *  `* 100` because `pct()` FORMATS and does not convert — the API's own rates
 *  are already 0-100 and pass straight through, while a share computed here is
 *  a fraction and must be scaled. Getting this backwards is what once printed
 *  73.5% as "7350.0%" in a shipped report; both sides are `number`, so nothing
 *  catches it but knowing which kind of quantity is in hand. */
function share(n: number, of: number): string {
  if (!of) return '—';
  return `${int(n)} (${pct((100 * n) / of, 0)})`;
}

/** The opponent's name, or their tag when none was ever stored. */
function oppName(s: { opponentName: string; opponentTag: string }): string {
  return s.opponentName && s.opponentName !== s.opponentTag
    ? printableName(s.opponentName, s.opponentTag)
    : s.opponentTag;
}

/* ------------------------------------------------------------- Duel Zone */

export function duelZoneDoc(r: DuelZoneReport, tag: string): ReportDoc {
  const s = r.summary;
  const blocks: ReportBlock[] = [
    {
      kind: 'stats',
      tiles: [
        { label: 'Duels', value: int(s.duels), note: 'in the window' },
        {
          label: 'Games',
          value: int(s.games),
          note: s.games ? `${pct((100 * s.wins) / s.games, 1)} won` : 'none stored',
          hue: 'blue',
        },
        {
          label: 'Native',
          value: share(s.native, s.duels),
          note: 'one row, whole loadout',
        },
        {
          label: 'Reconstructed',
          value: share(s.reconstructed, s.duels),
          note: 'rebuilt from consecutive games',
        },
      ],
    },
  ];

  /* EVERY DUEL AS ONE ROW: your loadout, the score, theirs.
     
     THE LAYOUT UNIT WAS WRONG TWICE BEFORE THIS. First a five-column text
     table with no card art at all; then each GAME as a full-width versus
     pair, which stacked three plates to a sheet and turned a 113-duel history
     into a 113-page document — while splitting the very comparison a duel
     invites, one loadout against the other, across three pages.
     
     A series is one row. Three deck grids left, the score in the middle,
     three right, three series to a sheet. That is what the screen does and
     what the Discord report has always done.
     
     THE SCORE IS PER GAME AND IT PRINTS UNDER EACH DECK, because "which deck
     took which game" is the question a loadout comparison is actually asking.
     
     MEASURED ON PRODUCTION: 104 of a real player's 113 duels are native rows,
     which store a loadout and NO per-game opponent — so the right-hand side
     is genuinely absent nine times in ten, and it says why rather than
     drawing an empty grid. */
  const CAP = 60;
  const shown = r.series.slice(0, CAP);
  if (shown.length) {
    blocks.push({
      kind: 'series',
      heading: 'The series log',
      /* THE MISSING-OPPONENT SENTENCE IS SAID ONCE, HERE. It used to be
         stamped inside every right-hand plate, and on a real account nine
         duels in ten are native rows — so the reader got the same disclaimer
         twenty-odd times, each one costing half a row. The renderer pairs
         those duels two to a line instead, which leaves this note as the only
         place it is said. */
      note: `${shown.length === r.series.length
        ? `All ${int(r.series.length)}`
        : `The ${int(shown.length)} most recent of ${int(r.series.length)}`}`
        + ' · your loadout against theirs'
        + (shown.some((s) => !s.games.some((g) => g.opponent))
          ? `. A duel stored as one loadout row keeps no per-game opponent, so those`
            + ` print two to a line with no right-hand side.`
          : ''),
      rows: shown.map((s) => ({
        leftLabel: 'You',
        rightLabel: oppName(s),
        score: s.playerWins === null || s.opponentWins === null
          ? ''
          : `${s.playerWins}-${s.opponentWins}`,
        caption: s.caption || '',
        date: DAY(s.startTime),
        format: s.format === 'bo5' ? 'Bo5' : 'Bo3',
        won: s.won,
        left: s.games.map((g) => ({
          name: g.deckName || g.archetype,
          value: g.playerCrowns !== undefined && g.opponentCrowns !== undefined
            ? `${g.playerCrowns}-${g.opponentCrowns}`
            : undefined,
          cards: g.cards,
          art: g.art,
          inferredArt: g.artInferred,
        })),
        right: s.games
          .filter((g) => g.opponent)
          .map((g) => ({
            name: g.opponent!.deckName || g.opponent!.archetype,
            cards: g.opponent!.cards,
            art: g.opponent!.art,
            inferredArt: g.opponent!.artInferred,
          })),
        rightNote: 'Stored as one loadout row, so the opponent decks were never recorded.',
      })),
    });
    if (r.series.length > CAP) {
      blocks.push({
        kind: 'note',
        body: `${int(r.series.length - CAP)} older duels are not printed here.`,
      });
    }
  }

  /* The opener→companion sequence, only when the screen is willing to show
     it. `lowConfidence` is the server saying the sample is too thin to read,
     and a PDF is exactly where an unlabelled thin figure would outlive the
     caveat that came with it. */
  const seq = r.sequence;
  if (seq?.entries?.length) {
    blocks.push({
      kind: 'table',
      heading: 'What follows what',
      note: seq.lowConfidence
        ? `Thin evidence — ${int(seq.observed)} observed sequences over ${int(seq.nGames)} games.`
        : `${int(seq.observed)} observed sequences over ${int(seq.nGames)} games.`,
      columns: [
        { key: 'opener', label: 'Opener' },
        { key: 'then', label: 'Then' },
        { key: 'basis', label: 'Basis' },
        { key: 'n', label: 'Seen', align: 'right' },
      ],
      rows: seq.entries.slice(0, 20).map((e) => ({
        opener: e.opener.deckName || e.opener.archetype,
        then: e.next.map((d) => d.deckName || d.archetype).join(' → ') || '—',
        /* OBSERVED AND PREDICTED ARE NOT THE SAME CLAIM. One is a loadout
           somebody actually fielded; the other was inferred and filtered for
           card legality. The screen distinguishes them and so must this. */
        basis: e.source === 'observed' ? 'observed' : 'predicted',
        n: int(e.seen ?? e.opener.count ?? 0),
      })),
    });
  }

  /* COUNTED, never asserted. Every clause below is arithmetic over the same
     rows the pages above print, so a reader can check it from the document
     itself — the rule the closing band and the release feed follow. */
  const decided = r.series.filter((s) => s.playerWins !== null).length;
  const swept = r.series.filter(
    (s) => s.playerWins !== null && s.opponentWins === 0,
  ).length;
  const read = s.duels
    ? `${int(s.native)} of your ${int(s.duels)} duels are stored as one loadout row`
      + `${decided ? `; ${int(swept)} of the ${int(decided)} with a recorded score were sweeps` : ''}.`
    : undefined;

  return {
    read,
    screen: 'Duel Zone',
    subject: `#${tag.replace(/^#/, '')}`,
    hue: 'violet',
    meta: [
      { label: 'Window', value: `${DAY(r.window?.from)} – ${DAY(r.window?.to)}` },
      { label: 'Duels read', value: int(s.duels) },
      { label: 'Series listed', value: int(r.series.length) },
      /* Said on the cover, because a report built partly from the archive
         covers a different span from one that was not. */
      { label: 'Archive used', value: s.archiveUsed ? 'yes' : 'no' },
    ],
    blocks,
  };
}

/* --------------------------------------------------------- Duel Analysis */

export function duelAnalysisDoc(r: DuelReport, tag: string, insights: ReportBlock[] = []): ReportDoc {
  const d = r.duels;
  const blocks: ReportBlock[] = [
    {
      kind: 'stats',
      tiles: [
        { label: 'Duels', value: int(d.total), note: 'in the window' },
        { label: 'Decks seen', value: int(d.decks), note: `${int(d.uniqueDecks)} distinct` },
        {
          label: 'Pairs eligible',
          value: `${int(r.pairs.eligible)} / ${int(r.pairs.observed)}`,
          note: `floor ${r.floors.minGames} games`,
          hue: 'violet',
        },
        /* Already 0-100 — the screen prints `{duels.evoCoverage}%` directly. */
        { label: 'Evolution coverage', value: pct(d.evoCoverage, 0), note: 'of decks read' },
      ],
    },
  ];

  /* EVERY TAB THE SCREEN HAS, in the order the screen has them — a reader who
     exported "the page" should get the page, not the tab that happened to be
     open when the button was pressed.

     AS CARD PAIRS, NOT AS A TABLE. This was five text columns and the PAIRING
     column was 40 mm, so every entry printed truncated: "Electro Spirit + ...",
     "Battle Ram + M...", "Hog Rider + Th...". On a report whose whole subject
     is WHICH TWO CARDS go together, naming only the first of the two is not a
     cosmetic problem — the document stopped answering its own question. The
     screen draws both cards for exactly this reason and now so does the PDF.

     Capped at 24 a tab. The tail of a ranked list is where the figures are
     thinnest and the sheets are heaviest, and the cap is STATED below rather
     than silently applied. */
  const PER_TAB = 24;
  for (const tab of Object.values(r.tabs ?? {})) {
    if (!tab?.rows?.length) continue;
    const shown = tab.rows.slice(0, PER_TAB);
    blocks.push({
      kind: 'pairs',
      heading: tab.label,
      note: `${tab.blurb} ${int(tab.eligible)} cleared the ${r.floors.minGames}-game floor`
        + (tab.rows.length > PER_TAB
          ? `; the ${int(shown.length)} most-played are shown.`
          : '.'),
      /* API RATES ARE PERCENT (0-100). `pct()` FORMATS and does not convert —
         dividing here prints 56.5% as "0.6%", and the mirror error once
         shipped "7350.0%". */
      pairs: shown.map((x) => ({
        a: x.a,
        b: x.b,
        artA: x.artA,
        artB: x.artB,
        name: x.name || `${x.aName} + ${x.bName}`,
        meta: `${int(x.games)} games · ${pct(x.useRate, 1)} of play · ${int(x.decks)} decks`
          + (x.lockClass && x.lockClass !== 'unknown' ? ` · ${x.lockClass}` : ''),
        value: pct(x.winRate, 1),
      })),
    });
  }

  /* THE INSIGHTS PANEL AT THE FOOT OF THE SCREEN. It reads the Duel Zone
     payload (the pair board above it has no series), so the caller fetches
     that and passes the blocks in; absent, the report simply ends with the
     tabs. */
  blocks.push(...insights);

  const tabs = Object.values(r.tabs ?? {});
  const best = tabs
    .flatMap((x) => x?.rows ?? [])
    .filter((x) => x.games >= r.floors.minGames)
    .sort((a2, b2) => b2.winRate - a2.winRate)[0];
  const read = best
    ? `Your strongest pairing is ${best.name || `${best.aName} + ${best.bName}`}`
      + ` at ${pct(best.winRate, 1)} over ${int(best.games)} games.`
    : undefined;

  return {
    read,
    screen: 'Duel Analysis',
    subject: `#${tag.replace(/^#/, '')}`,
    hue: 'violet',
    meta: [
      {
        label: 'Window',
        value: d.span?.from ? `${DAY(d.span.from)} – ${DAY(d.span.to)}` : '—',
      },
      { label: 'Duels', value: int(d.total) },
      {
        label: 'Slots read',
        value: d.slots ? d.slots.map((n) => int(n)).join(' / ') : '—',
      },
      /* THE BASIS IS ON THE COVER AND IT IS NOT DECORATION. `'all'` means the
         duel population could not clear the evidence floor, so the same
         question was asked of every battle instead. An unlabelled widening is
         the same class of mistake as card metadata silently defaulting. */
      {
        label: 'Counted from',
        value: r.basis === 'all' ? 'all battles (duels too thin)' : 'duels only',
      },
      { label: 'Archive used', value: r.archiveUsed ? 'yes' : 'no' },
    ],
    blocks,
  };
}
