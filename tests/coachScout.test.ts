import { describe, expect, it } from 'vitest';

import type { CoachIntel, LiveDeck, LivePlayerReport, PlayerReport } from '../src/state/analyticsClient';
import { readFileSync } from 'node:fs';

import {
  DECK_RATE_FLOOR,
  H2H_FLOOR,
  SCOUT_THIN,
  deckRate,
  h2hRate,
  evidenceNote,
  headToHead,
  leadArchetype,
  liveDecks,
  scoutBasis,
  scoutCandidates,
  scoutDecks,
} from '../src/state/coachScout';

const tally = (battles: number, wins: number, draws = 0) => ({
  battles,
  wins,
  losses: battles - wins - draws,
  draws,
});

/* Built from the shapes the PRODUCERS emit — `coach_intel.report` and the
   live battlelog — not from what reads plausibly. A fixture that invents its
   own vocabulary has walked a bug through this project twice. */
const intel = (over: Partial<CoachIntel> = {}): CoachIntel =>
  ({
    player: { tag: '#RIVAL', name: 'Rival' },
    window: { from: '2026-08-21', to: '2026-09-19' },
    archiveUsed: false,
    summary: tally(40, 24),
    form: [],
    timeline: [],
    modes: [],
    archetypes: [],
    opponentArchetypes: [],
    decks: [],
    decksTotal: 0,
    opponents: [],
    opponentsTotal: 0,
    opponentsRepeat: 0,
    hidden: 0,
    hiddenByMode: {},
    ...over,
  }) as CoachIntel;

const live = (over: Partial<LivePlayerReport> = {}): PlayerReport =>
  ({
    basis: 'live',
    tag: '#RIVAL',
    battles: 22,
    wins: 12,
    losses: 10,
    draws: 0,
    winRate: 54.5,
    crownsFor: 0,
    crownsAgainst: 0,
    trophyChange: 0,
    span: { from: null, to: null },
    modes: [],
    decks: [],
    cards: [],
    skipped: 3,
    logSize: 25,
    limits: { endpointCap: true, note: '' },
    tracking: { tag: '#RIVAL', tracked: false, requested: false, requestedAt: null, lastSeenAt: null, hits: 0, state: 'unknown' },
    profile: null,
    ...over,
  }) as PlayerReport;

const liveDeck = (over: Partial<LiveDeck> = {}): LiveDeck => ({
  hash: 'h1',
  name: 'Hog Rider Musketeer',
  archetype: 'Hog Rider',
  cards: ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'],
  art: {},
  inferredArt: false,
  games: 9,
  wins: 5,
  winRate: 55.6,
  useRate: 40,
  lastSeen: '20260919T200000.000Z',
  ...over,
});

describe('which footing the scout is standing on', () => {
  it('prefers stored history whenever it holds battles', () => {
    expect(scoutBasis(intel(), live())).toBe('stored');
  });

  it('falls back to the live battlelog for a tag nobody has collected', () => {
    expect(scoutBasis(intel({ summary: tally(0, 0) }), live())).toBe('live');
    expect(scoutBasis(null, live())).toBe('live');
  });

  it('says none rather than pretending, when there is nothing at all', () => {
    expect(scoutBasis(null, live({ battles: 0 }))).toBe('none');
    expect(scoutBasis(null, null)).toBe('none');
  });
});

describe('the decks a scout draws', () => {
  const stored = intel({
    decks: [
      {
        key: 'k1',
        cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        avgElixir: 3.1,
        deckName: 'Golem Lightning',
        archetype: 'Golem',
        last: '20260918T120000.000Z',
        ...tally(30, 18),
      },
    ],
  } as Partial<CoachIntel>);

  it('come from the stored history when there is one', () => {
    const [d] = scoutDecks(stored, live({ decks: [liveDeck()] }));
    expect(d.basis).toBe('stored');
    expect(d.name).toBe('Golem Lightning');
  });

  it('come from the battlelog when there is not', () => {
    const [d] = scoutDecks(intel({ decks: [] }), live({ decks: [liveDeck()] }));
    expect(d.basis).toBe('live');
    // `games` on a live deck is `battles` here — the field rename is exactly
    // the kind of mismatch a fixture must catch.
    expect(d.battles).toBe(9);
    expect(d.wins).toBe(5);
  });

  it('are never mixed from both footings at once', () => {
    const out = scoutDecks(stored, live({ decks: [liveDeck()] }));
    expect(new Set(out.map((d) => d.basis)).size).toBe(1);
  });

  it('put the most-played live deck first, breaking ties on recency', () => {
    const out = liveDecks([
      liveDeck({ hash: 'a', games: 3, lastSeen: '20260901T000000.000Z' }),
      liveDeck({ hash: 'b', games: 9 }),
      liveDeck({ hash: 'c', games: 3, lastSeen: '20260919T000000.000Z' }),
    ]);
    expect(out.map((d) => d.key)).toEqual(['b', 'c', 'a']);
  });

  it('withhold a win rate under the floor rather than printing 100% of two', () => {
    expect(deckRate({ battles: DECK_RATE_FLOOR, wins: 3 })).toBeCloseTo(60);
    expect(deckRate({ battles: 2, wins: 2 })).toBeNull();
  });
});

describe('head to head', () => {
  const player = intel({
    opponents: [
      { tag: '#RIVAL', name: 'Rival', last: '20260918T090000.000Z', ...tally(7, 2) },
      { tag: '#OTHER', name: null, last: '20260910T090000.000Z', ...tally(3, 3) },
    ],
  } as Partial<CoachIntel>);

  it('reads the ROSTER PLAYER’s record, not the opponent’s', () => {
    const h = headToHead(player, '#RIVAL');
    expect(h).toMatchObject({ battles: 7, wins: 2, losses: 5 });
  });

  it('matches a tag whatever case it arrives in', () => {
    expect(headToHead(player, '#rival')?.battles).toBe(7);
  });

  it('is null when they have never met — which is not 0–0', () => {
    expect(headToHead(player, '#NEVER')).toBeNull();
    expect(headToHead(null, '#RIVAL')).toBeNull();
  });
});

describe('who to offer as a scout candidate', () => {
  it('offers repeat opponents only, most-met first', () => {
    const player = intel({
      opponents: [
        { tag: '#A', name: 'A', last: '1', ...tally(5, 2) },
        { tag: '#B', name: 'B', last: '2', ...tally(2, 1) },
        { tag: '#C', name: 'C', last: '3', ...tally(1, 1) },
      ],
    } as Partial<CoachIntel>);
    expect(scoutCandidates(player).map((o) => o.tag)).toEqual(['#A', '#B']);
  });

  it('is empty rather than throwing without intel', () => {
    expect(scoutCandidates(null)).toEqual([]);
  });
});

describe('what the evidence line says', () => {
  it('calls a live read a snapshot, not a record', () => {
    expect(evidenceNote('live', 22, 'the last 30 days')).toMatch(/this week, not a record/);
  });

  it('says outright when a stored window is too thin to read', () => {
    expect(evidenceNote('stored', SCOUT_THIN - 1, 'the last 7 days')).toMatch(/too few to read a habit/);
    expect(evidenceNote('stored', SCOUT_THIN, 'the last 30 days')).not.toMatch(/too few/);
  });

  it('refuses to describe an empty scout as data', () => {
    expect(evidenceNote('none', 0, 'the last 30 days')).toMatch(/Nothing below is a claim about how they play/);
  });

  it('never prints a confidence percentage', () => {
    for (const basis of ['stored', 'live', 'none'] as const) {
      expect(evidenceNote(basis, 20, 'the last 30 days')).not.toMatch(/\d+% (confident|confidence)/);
    }
  });
});

describe('naming what they lead with', () => {
  const withTop = (battles: number, top: number) =>
    intel({ summary: tally(battles, battles / 2), archetypes: [{ key: 'golem', name: 'Golem', ...tally(top, top / 2) }] } as Partial<CoachIntel>);

  it('names it only past a real share', () => {
    expect(leadArchetype(withTop(40, 20))?.name).toBe('Golem');
    expect(leadArchetype(withTop(40, 8))).toBeNull();
  });

  it('says nothing at all on thin evidence, however lopsided', () => {
    expect(leadArchetype(withTop(SCOUT_THIN - 1, SCOUT_THIN - 1))).toBeNull();
  });
});

/* EVERY FLOOR IS NAMED IN ONE PLACE, AND NO SCREEN MAY WRITE ITS VALUE OUT
   AGAIN. Found by a variance census over the live payloads: the head-to-head
   floor was a bare `3` repeated twice in `ScoutTab` while the docs called it
   `H2H_FLOOR`, and `PlayerDashboard` wrote `>= 5` for the deck-rate floor that
   this module already exports. Both said "too few to rate" about the same
   player two tabs apart and could have drifted without anything failing.

   This is the same tripwire shape `coachDashboard.test.ts` uses for `DASH` vs
   `FLOORS`: assert the VALUE so a change is deliberate, and sweep the screens
   so the literal cannot come back. */
describe('the evidence floors are named, not written out per screen', () => {
  it('holds the two scout floors at their stated values', () => {
    expect(DECK_RATE_FLOOR).toBe(5);
    expect(H2H_FLOOR).toBe(3);
  });

  it('withholds a head-to-head rate under the floor and gives one at it', () => {
    expect(h2hRate({ battles: H2H_FLOOR - 1, wins: 2 })).toBeNull();
    expect(h2hRate({ battles: H2H_FLOOR, wins: 3 })).toBe(100);
    // A rate is a rate, not a rounding of one.
    expect(h2hRate({ battles: 4, wins: 1 })).toBe(25);
  });

  it('and no coach screen compares a battle count to a bare floor literal', () => {
    const screens = [
      'src/components/Admin/CoachRoster/ScoutTab.tsx',
      'src/components/Admin/CoachRoster/PlayerDashboard.tsx',
    ];
    for (const f of screens) {
      const src = readFileSync(f, 'utf8');
      /* `battles >= 5` / `battles >= 3` are the two that were really there.
         Anything of that shape is a floor being restated, whatever its value. */
      expect(src).not.toMatch(/battles\s*>=\s*\d/);
    }
  });
});
