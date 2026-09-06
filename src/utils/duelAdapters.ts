import type { DuelReport, DuelZoneReport } from '../state/analyticsClient';
import { int, pct, type ReportBlock, type ReportDoc } from './analyticsReport';

/* Report models for the two duel screens.
 *
 * WHY THESE ARE HERE AT ALL: Duel Zone and Duel Analysis were the only
 * analytics screens with no Export PDF at all — not hidden on a phone, never
 * wired. `reportAdapters.ts` covers Player Analysis, Live Player, Meta and
 * Cards, and these two were simply never added.
 *
 * SEPARATE FILE, NOT APPENDED TO `reportAdapters.ts`. That module is imported
 * eagerly by four screens; these two are reached only by pressing a button, so
 * `ReportButton`'s thunk may import them dynamically and keep them out of the
 * chunk everyone loads. The same arrangement `teamReport.ts` uses, and for the
 * same reason.
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
    ? s.opponentName
    : s.opponentTag;
}

/** Format, score and shape — and an unverified score is SAID, never 0-0. */
function seriesNote(s: {
  format: string; playerWins: number | null; opponentWins: number | null;
  caption: string; source: string;
}): string {
  const score = s.playerWins === null || s.opponentWins === null
    ? 'score not stored'
    : `${s.playerWins}-${s.opponentWins}`;
  return `${s.format === 'bo5' ? 'Bo5' : 'Bo3'} · ${score}`
    + (s.caption ? ` · ${s.caption}` : '');
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

  /* TWO KINDS OF DUEL, AND THE DIFFERENCE IS THE DATA, NOT A PREFERENCE.
     
     MEASURED on a real player with 113 duels: 104 of them are NATIVE rows,
     and a native row stores the whole loadout in one record with NO per-game
     opponent. Only 25 of 277 games — 9% — have an opponent deck at all.
     
     So a blanket "print every duel as VS" draws an empty right-hand plate on
     nine games in ten, which is not a versus and reads as broken. Worse, the
     empty plate was captioned with a sentence written for the team dossier
     ("nothing on the squad clears the floor"), which is meaningless here.
     
     The two cases are therefore separated:
     
       BOTH SIDES STORED  -> a VS sheet, all its games, player against
                             opponent, which is what was asked for and what
                             the data can actually support.
       LOADOUT ONLY       -> the three decks as rows, with the reason the
                             other half is missing stated once. Printing an
                             empty plate three times per duel says nothing
                             the sentence does not say better.
     
     It also fixes the page count. 113 duels each owning a sheet is a 113-page
     PDF; VS sheets go to the duels that can fill them and the rest are rows. */
  const withOpp = r.series.filter((s) => s.games.some((g) => g.opponent));
  const loadoutOnly = r.series.filter((s) => !s.games.some((g) => g.opponent));

  for (const s of withOpp) {
    const pairs = s.games.map((g) => ({
      left: {
        name: g.deckName || g.archetype,
        meta: `G${g.slot + 1} · ${g.avgElixir.toFixed(1)} elixir`,
        value: g.playerCrowns !== undefined && g.opponentCrowns !== undefined
          ? `${g.playerCrowns}-${g.opponentCrowns}`
          : undefined,
        valueNote: g.result || undefined,
        cards: g.cards,
        art: g.art,
        inferredArt: g.artInferred,
      },
      right: g.opponent
        ? {
            name: g.opponent.deckName || g.opponent.archetype,
            meta: g.opponent.avgElixir != null
              ? `${g.opponent.avgElixir.toFixed(1)} elixir`
              : undefined,
            cards: g.opponent.cards,
            art: g.opponent.art,
            inferredArt: g.opponent.artInferred,
          }
        : null,
    }));
    if (!pairs.length) continue;
    /* A DUEL OWNS ITS SHEET — three games are one duel and splitting them is
       the thing `compact` exists to stop. */
    blocks.push({ kind: 'break' });
    blocks.push({
      kind: 'versus',
      compact: true,
      heading: `${DAY(s.startTime)} · ${oppName(s)}`,
      note: seriesNote(s),
      leftLabel: 'You',
      rightLabel: 'Them',
      emptyNote: 'This game was stored without the opponent deck.',
      pairs,
    });
  }

  /* The rest, as loadouts. Capped, because the tail of a long duel history is
     the part nobody reads and every sheet of it is weight in a file that has
     to open on a phone. The cap is STATED, never silent. */
  const LOADOUT_CAP = 12;
  const shownLoadouts = loadoutOnly.slice(0, LOADOUT_CAP);
  if (shownLoadouts.length) {
    blocks.push({ kind: 'break' });
    for (const [i, s] of shownLoadouts.entries()) {
      blocks.push({
        kind: 'decks',
        heading: `${DAY(s.startTime)} · ${oppName(s)}`,
        note: i === 0
          ? `${seriesNote(s)} — these duels are stored as one loadout row, so the opponent's decks were never recorded.`
          : seriesNote(s),
        decks: s.games.map((g) => ({
          name: g.deckName || g.archetype,
          meta: `G${g.slot + 1} · ${g.avgElixir.toFixed(1)} elixir`,
          cards: g.cards,
          art: g.art,
          inferredArt: g.artInferred,
        })),
      });
    }
    if (loadoutOnly.length > LOADOUT_CAP) {
      blocks.push({
        kind: 'note',
        body: `${int(loadoutOnly.length - LOADOUT_CAP)} further duels are stored the same way and are not printed here.`,
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

  return {
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

export function duelAnalysisDoc(r: DuelReport, tag: string): ReportDoc {
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
     open when they pressed the button. */
  for (const tab of Object.values(r.tabs ?? {})) {
    if (!tab?.rows?.length) continue;
    blocks.push({
      kind: 'table',
      heading: tab.label,
      note: `${tab.blurb} ${int(tab.eligible)} ${tab.noun} cleared the floor.`,
      columns: [
        { key: 'pair', label: 'Pairing' },
        { key: 'games', label: 'Games', align: 'right' },
        { key: 'win', label: 'Win rate', align: 'right' },
        { key: 'use', label: 'Use rate', align: 'right' },
        { key: 'decks', label: 'Decks', align: 'right' },
        { key: 'lock', label: 'Lock' },
      ],
      /* API RATES ARE PERCENT (0-100), NOT FRACTIONS. `pct()` FORMATS; it does
         not convert. Multiplying by 100 here is what once printed 73.5% as
         "7350.0%" in a shipped report, and both sides are `number` so nothing
         catches it but reading the payload. */
      rows: tab.rows.slice(0, 40).map((x) => ({
        pair: x.name || `${x.aName} + ${x.bName}`,
        games: int(x.games),
        win: pct(x.winRate, 1),
        use: pct(x.useRate, 1),
        decks: int(x.decks),
        lock: x.lockClass === 'unknown' ? '—' : x.lockClass,
      })),
    });
  }

  return {
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
