import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CoachIntel, TeamRecommendation } from '../src/state/analyticsClient';
import { deckKey, type ArsenalDeck } from '../src/state/coachArsenal';
import {
  assistRows,
  assistSourceRef,
  coverNote,
  FILL_NOTE,
  fillNote,
  REC_TYPE_NOTE,
  suggestionMix,
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

    /* THE SENTENCE FOLLOWS WHAT THE FIGURE IS MEASURED OVER.
     *
     * With the coaching brain the coverage is over the opponent's PROJECTED
     * pool — their decks, real variants of them, and archetypes their play
     * implies — and calling that "what they actually play" would present
     * inference as observation, which is the one thing this feature exists
     * not to do. `threatCovered` is the tell: a server predating the brain
     * does not send it, and the original sentence is still exactly right. */
    expect(coverNote(rec(HOG, { spreadCovered: 80, threatCovered: 0.8 }))).toBe(
      'Covers 80% of their likely pool.',
    );
    expect(coverNote(rec(HOG, { spreadCovered: 21, threatCovered: 0.21 }))).toMatch(
      /only 21% of their likely pool/,
    );
    expect(coverNote(rec(HOG, { spreadCovered: 80 }))).not.toMatch(/likely pool/);
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

describe('the coaching brain row labels', () => {
  it('names every recommendation type the server can send', () => {
    /* A TRIPWIRE, deliberately. `team_scout.REC_*` is the vocabulary and this
     * is the only place it is turned into words a coach reads; a type the
     * server starts sending and this map has never heard of would render as
     * the raw enum on screen. Bump both in the same change. */
    expect(Object.keys(REC_TYPE_NOTE).sort()).toEqual(['CONTINGENCY', 'COUNTER', 'ROBUST']);
  });

  it('says what the deck is for without claiming an unmeasured tendency', () => {
    for (const note of Object.values(REC_TYPE_NOTE)) {
      expect(note).not.toMatch(/\b(always|never|prefers|tends to|likes|favou?rs)\b/i);
      expect(note.length).toBeLessThan(60);
    }
  });

  it('a row from a server without the brain carries neither type nor confidence', () => {
    /* The two halves deploy separately — Vercel builds from a push in a
     * minute and `server/` is copied by hand — so there is always a window
     * where the client is ahead. A reader that REQUIRED these would blank the
     * screen during it, which is why every one of them is optional. */
    const old = rec(HOG);
    expect(old.type).toBeUndefined();
    expect(old.confidence).toBeUndefined();
    expect(old.threatCovered).toBeUndefined();
    expect(coverNote(old)).toContain('what they actually play');
  });
});

describe('Deckkies picks on the What-to-play tab', () => {
  /* The engine now ranks the player's own decks and the wider player base's
   * TOGETHER, the way `coach.suggest` sorts Coach Assist's list, and marks
   * each outside deck `fill`. This tab owes the coach the difference. */
  const own = rec(HOG);
  const pick = rec(GOLEM, { owner: null, comfort: null, fill: true, expectedWinRate: 71.7 });

  it('counts the two kinds apart', () => {
    expect(suggestionMix([own, pick])).toEqual({ own: 1, fill: 1 });
    expect(suggestionMix([])).toEqual({ own: 0, fill: 0 });
  });

  it('says nothing when every row is their own', () => {
    expect(fillNote('no_history', { own: 3, fill: 0 }, 'Rahul')).toBeNull();
  });

  it('with nothing of theirs, leads with WHY and then says what the list is', () => {
    const note = fillNote('no_history', { own: 0, fill: 7 }, 'Rahul')!;
    expect(note).toMatch(/^Nothing is stored for Rahul yet\./);
    expect(note).toMatch(/7 decks come from the wider player base/);
    // The old sentence — "there is nothing to rank" — sat above seven ranked
    // decks and contradicted them.
    expect(note).not.toMatch(/nothing to rank/);
  });

  it('OUTRANKED IS NOT ABSENT — scored decks that all lost are not "nothing"', () => {
    // Measured live: a player's own best 56.8% against picks from 71.7% down.
    // `reason` is null there — nothing is missing — and five decks WERE ranked.
    const note = fillNote(null, { own: 0, fill: 7 }, 'Dora', 5)!;
    expect(note).toMatch(/Dora's own 5 decks all score below these/);
    expect(note).not.toMatch(/could be ranked/);
    expect(note).not.toMatch(/Nothing is stored/);
  });

  it('with a mix, says they are ranked on one scale — not "always below"', () => {
    const note = fillNote(null, { own: 4, fill: 3 }, 'Rahul')!;
    expect(note).toMatch(/4 of these are Rahul's own/);
    expect(note).toMatch(/same scale/);
    expect(note).not.toMatch(/always ranked below/);
  });

  it('one of their own is "is", not "are" — the screenshot caught it', () => {
    expect(fillNote(null, { own: 1, fill: 6 }, 'Xethol')).toMatch(/^1 of these is Xethol's own/);
    expect(fillNote(null, { own: 2, fill: 5 }, 'Xethol')).toMatch(/^2 of these are Xethol's own/);
  });

  it('the row label names it a Deckkies pick', () => {
    expect(FILL_NOTE).toMatch(/Deckkies pick/);
  });

  it('approving a pick records it as one in the arsenal', () => {
    expect(assistSourceRef(pick, '#OPP', 30)).toMatchObject({ fill: true });
    expect(assistSourceRef(own, '#OPP', 30)).not.toHaveProperty('fill');
  });
});

describe('the highlighted heading', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

  it('reads exactly as the account holder asked for it', () => {
    expect(read('src/components/Analytics/TeamAnalysis/SuggestHeading.tsx')).toContain(
      "export const DECKKIES_SUGGEST = 'What Deckkies Suggest To Play';",
    );
  });

  it('is mounted on both screens that rank decks against an opponent', () => {
    expect(read('src/components/Analytics/TeamAnalysis/TeamFolders.tsx')).toMatch(/<SuggestHeading/);
    expect(read('src/components/Admin/CoachRoster/AssistTab.tsx')).toMatch(/<SuggestHeading/);
  });

  it('the roster tab shows what the opponent is likely to bring beside it', () => {
    // The other half of Coach Assist's mechanism — what they will bring —
    // which this tab was missing.
    expect(read('src/components/Admin/CoachRoster/AssistTab.tsx')).toMatch(/<Threats/);
  });
});
