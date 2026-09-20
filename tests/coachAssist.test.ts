import { describe, expect, it } from 'vitest';

import type { CoachIntel, TeamRecommendation } from '../src/state/analyticsClient';
import { deckKey, type ArsenalDeck } from '../src/state/coachArsenal';
import {
  assistRows,
  assistSourceRef,
  coverNote,
  emptyReason,
  suggestedDecks,
  unapproved,
} from '../src/state/coachAssist';

const HOG = ['hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];
const GOLEM = ['golem', 'night-witch', 'baby-dragon', 'lumberjack', 'tornado', 'lightning', 'mega-minion', 'barbarian-barrel'];
const XBOW = ['x-bow', 'tesla', 'archers', 'knight', 'skeletons', 'ice-spirit', 'fireball', 'the-log'];

/* Shaped like `team_analysis.analyze` really emits, not like it reads. */
const rec = (cards: string[], over: Partial<TeamRecommendation> = {}): TeamRecommendation =>
  ({
    cards,
    art: {},
    archetype: 'Hog Rider',
    name: 'Hog 2.6',
    avgElixir: 2.6,
    owner: { tag: '#P1', name: 'Rahul' },
    comfort: { games: 30, wins: 18, winRate: 60, useRate: 40, bonus: 1.2 },
    expectedWinRate: 58.4,
    spreadCovered: 72,
    score: 59.6,
    matchups: [],
    ...over,
  }) as TeamRecommendation;

const arsenalDeck = (cards: string[], over: Partial<ArsenalDeck> = {}): ArsenalDeck => ({
  id: `d-${cards[0]}`,
  playerId: 'p1',
  cards,
  deckKey: deckKey(cards),
  name: `${cards[0]} deck`,
  archetype: null,
  comfort: 3,
  tags: [],
  status: 'active',
  source: 'manual',
  sourceRef: null,
  notes: null,
  sortOrder: 0,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

const intelWith = (decks: { cards: string[]; battles: number }[]): CoachIntel =>
  ({
    decks: decks.map((d) => ({
      key: d.cards.join(','),
      cards: d.cards,
      avgElixir: 3,
      deckName: 'x',
      archetype: 'y',
      last: '20260919T200000.000Z',
      battles: d.battles,
      wins: Math.round(d.battles / 2),
      losses: d.battles - Math.round(d.battles / 2),
      draws: 0,
    })),
  }) as CoachIntel;

describe('marking which suggestions are already approved', () => {
  it('matches on the order-free deck key, not on the order the engine sent', () => {
    const [s] = suggestedDecks([rec([...HOG].reverse())], [arsenalDeck(HOG, { name: 'Hog 2.6' })]);
    expect(s.arsenal?.name).toBe('Hog 2.6');
  });

  it('leaves a suggestion the coach has not approved unmarked', () => {
    const out = suggestedDecks([rec(HOG), rec(GOLEM)], [arsenalDeck(HOG)]);
    expect(out.map((s) => Boolean(s.arsenal))).toEqual([true, false]);
    expect(unapproved(out).map((s) => s.rec.cards)).toEqual([GOLEM]);
  });
});

describe('the arsenal against this opponent', () => {
  it('keeps the COACH’s order, never the engine’s ranking', () => {
    const arsenal = [
      arsenalDeck(GOLEM, { sortOrder: 0 }),
      arsenalDeck(HOG, { sortOrder: 1 }),
    ];
    const rows = assistRows(arsenal, [rec(HOG)], intelWith([{ cards: HOG, battles: 30 }]));
    expect(rows.map((r) => r.deck.deckKey)).toEqual([deckKey(GOLEM), deckKey(HOG)]);
    expect(rows[1].rec).not.toBeNull();
  });

  it('separates "scored lower" from "never played" — opposite meanings', () => {
    const arsenal = [arsenalDeck(GOLEM), arsenalDeck(XBOW)];
    const intel = intelWith([
      { cards: HOG, battles: 30 },
      { cards: GOLEM, battles: 12 }, // played, but the engine did not pick it
      // X-Bow is absent: never played, so the engine could not see it at all
    ]);
    const rows = assistRows(arsenal, [rec(HOG)], intel);
    expect(rows.find((r) => r.deck.deckKey === deckKey(GOLEM))?.reason).toBe('scored_lower');
    expect(rows.find((r) => r.deck.deckKey === deckKey(XBOW))?.reason).toBe('never_played');
  });

  it('claims neither when the player’s battles have not been read', () => {
    const rows = assistRows([arsenalDeck(GOLEM)], [], null);
    expect(rows[0].reason).toBeNull();
    expect(rows[0].played).toBeNull();
  });

  it('carries the stored battle count so the row can show its evidence', () => {
    const rows = assistRows([arsenalDeck(HOG)], [], intelWith([{ cards: HOG, battles: 41 }]));
    expect(rows[0].played).toBe(41);
  });

  it('leaves archived decks out', () => {
    const rows = assistRows([arsenalDeck(HOG, { status: 'archived' })], [], null);
    expect(rows).toEqual([]);
  });
});

describe('what gets stored when a suggestion is approved', () => {
  it('records the opponent, the window and the engine’s own figures', () => {
    const ref = assistSourceRef(rec(HOG), '#RIVAL', 30) as Record<string, unknown>;
    expect(ref.kind).toBe('coach_assist');
    expect(ref.opponentTag).toBe('#RIVAL');
    expect(ref.days).toBe(30);
    expect(ref.expectedWinRate).toBe(58.4);
    expect(ref.spreadCovered).toBe(72);
    expect(typeof ref.at).toBe('string');
  });

  it('stores the field-wide rate only when the server sent one', () => {
    expect(assistSourceRef(rec(HOG), '#R', 30)).not.toHaveProperty('overallWinRate');
    expect(assistSourceRef(rec(HOG, { overallWinRate: 51.2 }), '#R', 30)).toHaveProperty('overallWinRate', 51.2);
  });
});

describe('how much of the opponent a figure covers', () => {
  it('says so plainly, and says when it is thin', () => {
    expect(coverNote(rec(HOG, { spreadCovered: 80 }))).toBe('Covers 80% of what they actually play.');
    expect(coverNote(rec(HOG, { spreadCovered: 21 }))).toMatch(/only 21%.*unmeasured, not lost/);
  });

  it('is never phrased as a confidence', () => {
    for (const cover of [5, 49, 50, 99]) {
      // WORD BOUNDARIES: a bare /sure/ also matches "unmeasured", which is in
      // the honest half of this very sentence. Same substring trap as
      // [class*="bar"] matching barWrap.
      expect(coverNote(rec(HOG, { spreadCovered: cover }))).not.toMatch(/\b(confiden\w*|certain\w*|sure)\b/i);
    }
  });
});

describe('the engine’s empty states', () => {
  it('says something different for each, because they need different actions', () => {
    const said = ['no_history', 'no_comfort', 'no_evidence', 'no_matchup_data'].map((r) => emptyReason(r, 'Rahul'));
    expect(new Set(said).size).toBe(4);
    expect(said.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('blames the reader for none of them', () => {
    expect(emptyReason('no_matchup_data', 'Rahul')).toMatch(/Nothing you did/);
    expect(emptyReason('no_evidence', 'Rahul')).toMatch(/missing evidence, not a bad matchup/);
  });

  it('has nothing to say when there is no problem', () => {
    expect(emptyReason(null, 'Rahul')).toBeNull();
    expect(emptyReason(undefined, 'Rahul')).toBeNull();
  });
});
