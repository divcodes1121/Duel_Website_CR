import { describe, expect, it } from 'vitest';

import {
  FLAG_ACTION,
  FLAG_LABEL,
  sortOverview,
  summarise,
  totals,
  type AttentionFlag,
  type OverviewInput,
} from '../src/state/coachOverview';
import type { RosterPlayer } from '../src/state/coachRoster';

const player = (id: string, over: Partial<RosterPlayer> = {}): RosterPlayer => ({
  id,
  playerTag: `#${id.toUpperCase()}`,
  displayName: null,
  notes: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

const input = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  players: [player('a')],
  decks: [],
  ...over,
});

describe('what the roster screen counts', () => {
  it('counts only ACTIVE decks as an arsenal', () => {
    const [row] = summarise(
      input({
        decks: [
          { playerId: 'a', status: 'active' },
          { playerId: 'a', status: 'archived' },
          { playerId: 'b', status: 'active' },
        ],
      }),
    );
    expect(row.arsenal).toBe(1);
  });

  it('gives every player a row, including one with nothing', () => {
    const rows = summarise(input({ players: [player('a'), player('b')] }));
    expect(rows).toHaveLength(2);
    expect(rows[1].arsenal).toBe(0);
  });

  /* MATCH PLANS AND RESULTS WERE REMOVED FROM THE PRODUCT (2026-09-24), and
     the evidence agreed: the live roster read `0 plans · 0 matches · nothing
     recorded` for every player. Nothing here may grow a plan or result count
     back without the tables and screens coming back with it. */
  it('carries no plan or result figures at all', () => {
    const [row] = summarise(input({ decks: [{ playerId: 'a', status: 'active' }] }));
    expect(Object.keys(row).sort()).toEqual(['arsenal', 'flags', 'player']);
  });
});

describe('the attention flags', () => {
  const flags = (over: Partial<OverviewInput> = {}): AttentionFlag[] => summarise(input(over))[0].flags;

  it('names an empty arsenal', () => {
    expect(flags()).toContain('no_arsenal');
    expect(flags({ decks: [{ playerId: 'a', status: 'active' }] })).not.toContain('no_arsenal');
  });

  /* ABSENCE OF KNOWLEDGE IS NOT EVIDENCE. Without a tracked set the flag is
     withheld rather than raised against everybody. */
  it('withholds "not collected" when the tracked set is unknown', () => {
    expect(flags()).not.toContain('not_collected');
    expect(flags({ trackedTags: new Set<string>() })).toContain('not_collected');
    expect(flags({ trackedTags: new Set(['#A']) })).not.toContain('not_collected');
  });

  it('every flag has a label and an action — a flag with no action is a nag', () => {
    for (const f of Object.keys(FLAG_LABEL) as AttentionFlag[]) {
      expect(FLAG_LABEL[f]).toBeTruthy();
      expect(FLAG_ACTION[f]).toBeTruthy();
    }
  });

  /* The roster's standing contract: counts, never a judgement of the player. */
  it('never uses a word that judges the player', () => {
    const text = [...Object.values(FLAG_LABEL), ...Object.values(FLAG_ACTION)].join(' ').toLowerCase();
    /* NOT a bare "ready": "the decks they are ready to play" is ordinary
       English and not a readiness claim. What is banned is the SCORE. */
    for (const w of ['bad', 'poor', 'weak', 'lazy', 'behind', 'failing', 'readiness', 'score', 'grade', 'rank']) {
      expect(text).not.toContain(w);
    }
  });

  it('is down to the two flags that describe something real', () => {
    expect(Object.keys(FLAG_LABEL).sort()).toEqual(['no_arsenal', 'not_collected']);
  });
});

describe('roster order', () => {
  it('puts active players first, then alphabetically — the rail’s own order', () => {
    const rows = summarise(
      input({
        players: [
          player('c', { displayName: 'Zoe' }),
          player('b', { displayName: 'Amy', isActive: false }),
          player('a', { displayName: 'Bob' }),
        ],
      }),
    );
    expect(sortOverview(rows).map((r) => r.player.displayName)).toEqual(['Bob', 'Zoe', 'Amy']);
  });

  it('is not moved by how much is outstanding', () => {
    const rows = summarise(
      input({
        players: [player('a', { displayName: 'Amy' }), player('z', { displayName: 'Zoe' })],
        decks: [{ playerId: 'z', status: 'active' }],
      }),
    );
    // Amy has a flag and Zoe does not; Amy still sorts first.
    expect(sortOverview(rows).map((r) => r.player.displayName)).toEqual(['Amy', 'Zoe']);
  });
});

describe('the roster line', () => {
  const rows = summarise(
    input({
      players: [player('a'), player('b'), player('c', { isActive: false })],
      decks: [
        { playerId: 'a', status: 'active' },
        { playerId: 'a', status: 'active' },
      ],
    }),
  );

  it('counts only active players', () => {
    expect(totals(rows).players).toBe(2);
  });

  it('counts who has an arsenal, and how many decks in total', () => {
    const t = totals(rows);
    expect(t.withArsenal).toBe(1);
    expect(t.decks).toBe(2);
  });

  it('counts who needs something', () => {
    expect(totals(rows).needingAttention).toBe(1);
  });

  it('an archived player cannot contribute to any figure', () => {
    const t = totals(summarise(input({ players: [player('c', { isActive: false })] })));
    expect(t).toEqual({ players: 0, withArsenal: 0, decks: 0, needingAttention: 0 });
  });
});
