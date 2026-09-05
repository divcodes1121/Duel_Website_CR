import { describe, expect, it } from 'vitest';
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

  it('prints every duel as VS pairs, one block per duel', () => {
    const vs = d.blocks.filter((b) => b.kind === 'versus');
    expect(vs).toHaveLength(2);
    // Three games, three pairs — a duel stays whole.
    expect((vs[0] as { pairs: unknown[] }).pairs).toHaveLength(3);
  });

  it('fits a whole duel on one sheet rather than one pair per sheet', () => {
    const vs = d.blocks.find((b) => b.kind === 'versus') as { compact?: boolean };
    expect(vs.compact).toBe(true);
  });

  it('prints the opponent deck beside the player deck', () => {
    const vs = d.blocks.find((b) => b.kind === 'versus') as {
      pairs: { left: { name: string }; right: { name: string; cards: string[] } | null }[];
      leftLabel?: string; rightLabel?: string;
    };
    expect(vs.leftLabel).toBe('You');
    expect(vs.rightLabel).toBe('Them');
    expect(vs.pairs[0].left.name).toBe('Hog 2.6');
    expect(vs.pairs[0].right?.name).toBe('Golem Beatdown');
    expect(vs.pairs[0].right?.cards).toHaveLength(8);
  });

  it('labels each pair with its game number', () => {
    const vs = d.blocks.find((b) => b.kind === 'versus') as {
      pairs: { left: { meta?: string } }[];
    };
    expect(vs.pairs[0].left.meta).toContain('G1');
    expect(vs.pairs[2].left.meta).toContain('G3');
  });

  it('states a missing opponent rather than drawing a blank half', () => {
    // A native row stores a loadout and no per-game opponent.
    const vs = d.blocks.filter((b) => b.kind === 'versus');
    const native = vs[1] as { pairs: { right: unknown }[]; note?: string };
    expect(native.pairs[0].right).toBeNull();
    expect(native.note).toContain('native row');
  });

  it('names the duel by date and opponent, with the score in the note', () => {
    const vs = d.blocks.filter((b) => b.kind === 'versus') as {
      heading?: string; note?: string;
    }[];
    expect(vs[0].heading).toBe('2026-09-01 · Sarac');
    expect(vs[0].note).toContain('2–1');
    // The tag when no name was ever stored.
    expect(vs[1].heading).toContain('#XYZ');
    // An unverified score is SAID, never printed as 0-0.
    expect(vs[1].note).toContain('score not stored');
    expect(vs[1].note).not.toContain('0–0');
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
          name: 'Hog Rider + Fireball', games: 120, wins: 74,
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
    const rows = (d.blocks[1] as { rows: Record<string, string>[] }).rows;
    expect(rows[0].win).toBe('61.7%');
    expect(rows[0].use).toBe('28.4%');
    // The classic failure: /100 gives '0.6%', *100 gives '6170.0%'.
    expect(rows[0].win).not.toBe('0.6%');
    expect(rows[0].win).not.toBe('6170.0%');
  });

  it('treats evoCoverage as the 0-100 the screen prints', () => {
    const tiles = (d.blocks[0] as { tiles: { value: string }[] }).tiles;
    expect(tiles[3].value).toBe('74%');
  });

  it('uses the pairing name the API supplies', () => {
    const rows = (d.blocks[1] as { rows: Record<string, string>[] }).rows;
    expect(rows[0].pair).toBe('Hog Rider + Fireball');
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
