import { describe, expect, it } from 'vitest';
import { reportFilename } from '../src/utils/analyticsReport';
import { duelAnalysisDoc, duelZoneDoc } from '../src/utils/duelAdapters';

/* The two duel screens' report models.
 *
 * WHAT IS WORTH PINNING is the half that would be quietly wrong rather than
 * broken — a report that renders perfectly and states the wrong number:
 *
 *   * API RATES ARE PERCENT (0-100) AND `pct()` DOES NOT CONVERT. Dividing by
 *     100 prints 62.1% as "0.6%"; multiplying a rate that was already a
 *     percentage printed 73.5% as "7350.0%" in a shipped report once. Both
 *     sides are `number`, so only a test that knows which kind of quantity is
 *     in hand can catch it.
 *   * A SCORE THE SERVER COULD NOT VERIFY MUST NOT PRINT AS 0-0. A native duel
 *     row carries no per-game result, so the crowns are unknown, not nil.
 *   * `basis: 'all'` MUST REACH THE COVER. It means the duel population could
 *     not clear the evidence floor and the question was asked of every battle
 *     instead — an unlabelled widening in a PDF outlives the caveat that came
 *     with it on screen.
 *
 * Fixtures are written from the PRODUCER's shape: `ApiCombo` really does carry
 * `aName`/`bName`/`lockClass`, and `SequenceEntry.opener` really is a
 * `SequenceDeck & {count, prob}`. A fixture that invents its own vocabulary
 * pins nothing — this project has a suite that passed 59/59 against a field
 * that exists on no real record.
 */

const game = (slot: number, name: string, withOpponent = true) => ({
  slot,
  cards: ['hog-rider', 'musketeer', 'cannon', 'ice-golem',
    'skeletons', 'the-log', 'fireball', 'baby-dragon'],
  art: { 'baby-dragon': 'evolution' as const },
  artInferred: false,
  avgElixir: 3.2,
  result: 'win' as const,
  playerCrowns: 2,
  opponentCrowns: 1,
  archetype: 'hog',
  deckName: name,
  /* Null on a native row: it stores a loadout and no per-game opponent. */
  opponent: withOpponent
    ? {
        cards: ['golem', 'night-witch', 'mega-minion', 'tombstone',
          'lightning', 'barbarian-barrel', 'electro-dragon', 'bats'],
        archetype: 'golem',
        deckName: 'Golem Beatdown',
        avgElixir: 4.1,
        art: {},
        artInferred: true,
      }
    : null,
});

const deck = (name: string) => ({
  cards: ['hog-rider', 'musketeer', 'cannon', 'ice-golem',
    'skeletons', 'the-log', 'fireball', 'baby-dragon'],
  archetype: 'hog',
  deckName: name,
  avgElixir: 3.2,
});

function zone(over: Record<string, unknown> = {}) {
  return {
    series: [
      {
        id: 's1', startTime: '2026-09-01T10:00:00Z', opponentTag: '#ABC',
        opponentName: 'Sarac', source: 'reconstructed', format: 'bo3',
        games: [game(0, 'Hog 2.6'), game(1, 'Golem'), game(2, 'XBow')],
        playerWins: 2, opponentWins: 1, caption: 'came back', won: true,
      },
      {
        id: 's2', startTime: '2026-09-02T10:00:00Z', opponentTag: '#XYZ',
        opponentName: '#XYZ', source: 'native', format: 'bo5',
        games: [game(0, 'Loadout A', false)],
        playerWins: null, opponentWins: null, caption: '', won: false,
      },
    ],
    sequence: {
      entries: [{
        opener: { ...deck('Hog 2.6'), count: 12, prob: 0.4 },
        source: 'observed', seen: 7, next: [deck('Golem'), deck('XBow')],
      }],
      nGames: 40, observed: 7, lowConfidence: false,
    },
    summary: {
      duels: 20, native: 5, reconstructed: 15,
      games: 50, wins: 30, shown: 2, archiveUsed: false,
    },
    coverage: {}, window: { from: '2026-08-01', to: '2026-09-01' }, sources: {},
    ...over,
  } as never;
}

describe('duelZoneDoc', () => {
  const d = duelZoneDoc(zone(), '2PP0PYLQ');

  it('names the screen and the subject', () => {
    expect(d.screen).toBe('Duel Zone');
    expect(d.subject).toBe('#2PP0PYLQ');
  });

  it('states the win rate as a percentage, not a fraction', () => {
    // 30 of 50 games. `pct` FORMATS, so the adapter must scale it itself.
    const tiles = (d.blocks[0] as { tiles: { note?: string }[] }).tiles;
    expect(tiles[1].note).toBe('60.0% won');
  });

  it('reports native and reconstructed as a count and a share', () => {
    const tiles = (d.blocks[0] as { tiles: { value: string }[] }).tiles;
    expect(tiles[2].value).toBe('5 (25%)');
    expect(tiles[3].value).toBe('15 (75%)');
  });

  it('prints every duel as ONE ROW: your loadout, the score, theirs', () => {
    /* THE LAYOUT UNIT WAS WRONG TWICE. First a text table with no art; then
       each GAME as a full-width versus pair, which stacked three plates to a
       sheet and made a 113-duel history a 113-page document — while splitting
       the comparison a duel invites across three pages. A series is one row. */
    const s = d.blocks.find((b) => b.kind === 'series') as { rows: unknown[] };
    expect(s.rows).toHaveLength(2);
  });

  it('puts your three decks and theirs on the same row', () => {
    const s = d.blocks.find((b) => b.kind === 'series') as {
      rows: { left: { name: string }[]; right: { name: string }[];
              leftLabel: string; rightLabel: string }[];
    };
    expect(s.rows[0].left).toHaveLength(3);
    expect(s.rows[0].right).toHaveLength(3);
    expect(s.rows[0].leftLabel).toBe('You');
    expect(s.rows[0].rightLabel).toBe('Sarac');
    expect(s.rows[0].right[0].name).toBe('Golem Beatdown');
  });

  it('carries the per-game score under each deck', () => {
    const s = d.blocks.find((b) => b.kind === 'series') as {
      rows: { left: { value?: string }[] }[];
    };
    expect(s.rows[0].left[0].value).toBe('2-1');
  });

  it('leaves the right side empty and SAYS WHY when nothing was stored', () => {
    const s = d.blocks.find((b) => b.kind === 'series') as {
      rows: { right: unknown[]; rightNote?: string; score: string }[];
    };
    expect(s.rows[1].right).toHaveLength(0);
    expect(s.rows[1].rightNote).toContain('never recorded');
    // An unverified score is EMPTY, never printed as 0-0.
    expect(s.rows[1].score).toBe('');
  });

  it('names the opponent, or falls back to their tag', () => {
    const s = d.blocks.find((b) => b.kind === 'series') as {
      rows: { rightLabel: string }[];
    };
    expect(s.rows[0].rightLabel).toBe('Sarac');
    expect(s.rows[1].rightLabel).toBe('#XYZ');
  });

  it('caps the log and counts what it left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`, startTime: '2026-09-02T10:00:00Z', opponentTag: '#XYZ',
      opponentName: '#XYZ', source: 'native', format: 'bo3',
      games: [game(0, 'Loadout', false)],
      playerWins: null, opponentWins: null, caption: '', won: false,
    }));
    const big = duelZoneDoc(zone({ series: many }), 'X');
    const s = big.blocks.find((b) => b.kind === 'series') as { rows: unknown[] };
    expect(s.rows).toHaveLength(24);
    expect(big.blocks.some(
      (b) => b.kind === 'note' && (b as { body?: string }).body?.includes('older duels'),
    )).toBe(true);
  });

  /* THE MISSING-OPPONENT SENTENCE IS SAID ONCE OR NOT AT ALL. It used to be
     stamped inside every right-hand plate, and on a real account nine duels in
     ten are native rows — so the renderer pairs those two to a line and this
     note is the only place the reader is told why they have no right-hand
     side. Said unconditionally it would be a disclaimer about something the
     document does not contain. */
  it('says once that opponent-less duels print two to a line', () => {
    const s = d.blocks.find((b) => b.kind === 'series') as { note?: string };
    expect(s.note).toContain('two to a line');
    expect(s.note!.match(/two to a line/g)).toHaveLength(1);
  });

  it('does not say it when every duel stored an opponent', () => {
    const paired = duelZoneDoc(zone({
      series: [{
        id: 's1', startTime: '2026-09-01T10:00:00Z', opponentTag: '#ABC',
        opponentName: 'Sarac', source: 'reconstructed', format: 'bo3',
        games: [game(0, 'Hog 2.6'), game(1, 'Golem'), game(2, 'XBow')],
        playerWins: 2, opponentWins: 1, caption: 'came back', won: true,
      }],
    }), 'X');
    const s = paired.blocks.find((b) => b.kind === 'series') as { note?: string };
    expect(s.note).not.toContain('two to a line');
    expect(s.note).toContain('your loadout against theirs');
  });

  it('distinguishes an observed sequence from a predicted one', () => {
    const seq = d.blocks.find(
      (b) => b.kind === 'table' && (b as { heading?: string }).heading === 'What follows what',
    ) as { rows: Record<string, string>[] };
    const rows = seq.rows;
    expect(rows[0].opener).toBe('Hog 2.6');
    expect(rows[0].then).toBe('Golem → XBow');
    expect(rows[0].basis).toBe('observed');
  });

  it('labels thin sequence evidence', () => {
    const thin = duelZoneDoc(
      zone({ sequence: { ...(zone() as unknown as { sequence: object }).sequence, lowConfidence: true } }),
      'X',
    );
    const seq = thin.blocks.find(
      (b) => (b as { heading?: string }).heading === 'What follows what',
    ) as { note?: string };
    expect(seq.note).toContain('Thin evidence');
  });
});

/* TWO EXPORTS ON ONE DAY USED TO SHARE A FILENAME, so the browser saved the
   second as "… (1).pdf" and a reader opening the obvious entry in their
   downloads list got the older layout back — indistinguishable from a deploy
   that never landed, and read as exactly that. */
describe('reportFilename', () => {
  it('carries the minute, so two exports on one day differ', () => {
    const name = reportFilename(duelZoneDoc(zone(), '2PP0PYLQ'));
    expect(name).toMatch(/^deckkies-duel-zone-2pp0pylq-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
  });

  it('names the screen it came from', () => {
    expect(reportFilename(duelAnalysisDoc(analysis(), 'X'))).toContain('duel-analysis');
  });
});

function analysis(over: Record<string, unknown> = {}) {
  return {
    player: { name: 'Me', tag: '#2PP0PYLQ' },
    duels: {
      total: 20, native: 5, reconstructed: 15, decks: 60, uniqueDecks: 14,
      slots: [20, 20, 20], evoCoverage: 73.5,
      span: { from: '2026-08-01', to: '2026-09-01' },
    },
    pairs: { observed: 900, eligible: 120 },
    floors: { minGames: 8, minDecks: 3 },
    tabs: {
      'win-conditions': {
        id: 'win-conditions', label: 'Win Conditions',
        blurb: 'Pairs that carry the deck.', noun: 'pairings', eligible: 40,
        mostUsed: null, perSlot: [],
        rows: [{
          a: 'hog-rider', b: 'fireball', aName: 'Hog Rider', bName: 'Fireball',
          name: 'Hog Rider + Fireball', games: 120, wins: 74, artB: 'evolution',
          winRate: 61.7, useRate: 28.4, decks: 9, lock: 0.4, lockClass: 'frequent',
        }],
      },
    },
    archiveUsed: false,
    ...over,
  } as never;
}

describe('duelAnalysisDoc', () => {
  const d = duelAnalysisDoc(analysis(), '2PP0PYLQ');

  it('passes API percentages straight through — pct() does not convert', () => {
    const pr = (d.blocks[1] as { pairs: Record<string, string>[] }).pairs[0];
    expect(pr.value).toBe('61.7%');
    expect(pr.meta).toContain('28.4% of play');
    // The classic failure: /100 gives '0.6%', *100 gives '6170.0%'.
    expect(pr.value).not.toBe('0.6%');
    expect(pr.value).not.toBe('6170.0%');
  });

  it('draws the two CARDS, so a pairing is never truncated to its first half', () => {
    /* This was a five-column table whose PAIRING column was 40 mm, so every
       entry printed as "Battle Ram + M..." on a report whose subject is which
       two cards go together. */
    const b = d.blocks[1] as {
      kind: string; pairs: { a: string; b: string; artB?: string; name: string }[];
    };
    expect(b.kind).toBe('pairs');
    expect(b.pairs[0].a).toBe('hog-rider');
    expect(b.pairs[0].b).toBe('fireball');
    expect(b.pairs[0].name).toBe('Hog Rider + Fireball');
  });

  it('carries each card evolution or hero form through to the art', () => {
    const b = d.blocks[1] as { pairs: { artA?: string; artB?: string }[] };
    expect(b.pairs[0].artB).toBe('evolution');
  });

  it('treats evoCoverage as the 0-100 the screen prints', () => {
    const tiles = (d.blocks[0] as { tiles: { value: string }[] }).tiles;
    expect(tiles[3].value).toBe('74%');
  });

  it('states the per-tab cap rather than truncating silently', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      a: 'hog-rider', b: 'fireball', aName: 'Hog Rider', bName: 'Fireball',
      name: `Pair ${i}`, games: 120, wins: 74,
      winRate: 61.7, useRate: 28.4, decks: 9, lock: 0.4, lockClass: 'frequent',
    }));
    const big = duelAnalysisDoc(
      analysis({ tabs: { t: { id: 't', label: 'T', blurb: 'B.', noun: 'pairings',
        eligible: 40, mostUsed: null, perSlot: [], rows: many } } }), 'X');
    const b = big.blocks[1] as { pairs: unknown[]; note?: string };
    expect(b.pairs).toHaveLength(24);
    expect(b.note).toContain('most-played are shown');
  });

  it('puts the evidence basis on the cover', () => {
    const label = d.meta.find((m) => m.label === 'Counted from');
    expect(label?.value).toBe('duels only');
    const widened = duelAnalysisDoc(analysis({ basis: 'all' }), 'X');
    expect(widened.meta.find((m) => m.label === 'Counted from')?.value)
      .toContain('all battles');
  });

  it('carries every tab that has rows, and skips empty ones', () => {
    const empty = duelAnalysisDoc(
      analysis({ tabs: { x: { id: 'x', label: 'X', blurb: '', noun: 'n', eligible: 0, mostUsed: null, perSlot: [], rows: [] } } }),
      'X',
    );
    expect(empty.blocks).toHaveLength(1); // stats only
  });
});
