import { describe, expect, it } from 'vitest';

import type {
  TeamFolder,
  TeamMember,
  TeamRecommendation,
  TeamReport,
} from '../src/state/analyticsClient';
import type { DividerBlock, ReportBlock } from '../src/utils/analyticsReport';
import { teamAnalysisReport } from '../src/utils/teamReport';

/**
 * THE DOSSIER IS THE ARTEFACT THAT LEAVES THE BUILDING.
 *
 * A screen that drops a player shows a short list somebody might notice. A PDF
 * that drops one is handed to five people as the complete preparation for a
 * match, and nothing in it says a name is missing. So what is tested here is
 * mostly COMPLETENESS — that every player on both sides gets a section however
 * little the analysis found for them — and that the qualifications travel with
 * the numbers rather than being left behind on the screen.
 */

const CARDS = ['knight', 'archers', 'goblins', 'fireball', 'zap', 'hog-rider', 'musketeer', 'cannon'];
const CARDS_B = ['giant', 'archers', 'goblins', 'fireball', 'zap', 'minions', 'musketeer', 'cannon'];

function member(tag: string, name: string, over: Partial<TeamMember> = {}): TeamMember {
  return {
    tag, name, basis: 'stored', battles: 300, winRate: 52, decks: 4,
    tracking: { tag, tracked: true, requested: false, requestedAt: null, lastSeenAt: null, hits: 1 },
    window: { from: '2026-07-30', to: '2026-08-29' },
    ...over,
  };
}

function rec(ownerTag: string, ownerName: string, cards = CARDS): TeamRecommendation {
  return {
    cards, art: {}, archetype: 'hog-cycle', name: 'Hog Cycle', avgElixir: 3.4,
    owner: { tag: ownerTag, name: ownerName },
    comfort: { games: 40, wins: 23, winRate: 57.5, useRate: 18.2, bonus: 1.5 },
    expectedWinRate: 56.3, spreadCovered: 82, score: 57.8,
    matchups: [
      { archetype: 'log-bait', name: 'Log Bait', share: 42, winRate: 58.1,
        source: 'deck', sourceText: 'this deck vs this archetype', games: 61, tier: 'high' },
      { archetype: 'x-bow', name: 'X-Bow', share: 18, winRate: null,
        source: null, games: 0, tier: null },
    ],
  };
}

function folder(tag: string, name: string, over: Partial<TeamFolder> = {}): TeamFolder {
  return {
    player: {
      tag, name, basis: 'stored', battles: 512, winRate: 53.3,
      tracking: { tag, tracked: true, requested: false, requestedAt: null, lastSeenAt: null, hits: 1 },
      coverage: { start: '2026-07-30', end: '2026-08-29', days: 30 },
      window: { from: '2026-07-30', to: '2026-08-29' },
    },
    theirDecks: [
      { rank: 1, name: 'Log Bait', deckHash: 'h1', cards: CARDS_B, useRate: 42, winRate: 54.2,
        matches: 88, wins: 48, losses: 40, avgElixir: 3.1, winCondition: 'goblin-barrel',
        lastSeen: '2026-08-29', art: {} },
    ],
    spread: [
      { archetype: 'log-bait', name: 'Log Bait', style: 'bait', games: 61, weight: 0.42, share: 42 },
      { archetype: 'x-bow', name: 'X-Bow', style: 'siege', games: 26, weight: 0.18, share: 18 },
    ],
    recommended: [rec('#B1', 'Ravi')],
    perPlayer: [
      { owner: { tag: '#B1', name: 'Ravi' }, basis: 'stored', decks: [rec('#B1', 'Ravi')], considered: 5, reason: null },
      { owner: { tag: '#B2', name: 'Aditya' }, basis: 'stored', decks: [], considered: 0, reason: 'no_comfort' },
    ],
    considered: 12, reason: null,
    ...over,
  };
}

function report(over: Partial<TeamReport> = {}): TeamReport {
  return {
    blue: [member('#B1', 'Ravi'), member('#B2', 'Aditya')],
    red: [folder('#R1', 'Mohamed').player.tag].map(() => member('#R1', 'Mohamed')),
    folders: [folder('#R1', 'Mohamed')],
    pool: { decks: 12, reason: null, minGames: 5 },
    days: 30,
    limits: { maxSquad: 10, topN: 3, minComfortGames: 5, minOpponentDeckGames: 3 },
    rejected: { blue: [], red: [] },
    status: { building: false, error: null, elapsedSeconds: 0, ageSeconds: 600, rawBias: 58.6, battles: 1_960_000 },
    sources: {
      hot: { path: null, available: true, sizeBytes: 1 },
      archive: { path: '', available: false, sizeBytes: 0 },
    },
    ...over,
  };
}

const dividers = (blocks: ReportBlock[]): DividerBlock[] =>
  blocks.filter((b): b is DividerBlock => b.kind === 'divider');

const allText = (doc: { blocks: ReportBlock[]; caveats?: string[] }): string =>
  JSON.stringify(doc.blocks) + JSON.stringify(doc.caveats ?? []);

describe('teamAnalysisReport — completeness', () => {
  it('gives every player on both sides their own section', () => {
    const doc = teamAnalysisReport(report());
    const titles = dividers(doc.blocks).map((d) => d.title);
    expect(titles).toContain('Ravi');
    expect(titles).toContain('Aditya');
    expect(titles).toContain('Mohamed');
  });

  it('SECTIONS A TEAMMATE WHO HAS NOTHING, rather than skipping them', () => {
    /* Aditya clears no comfort floor anywhere. Dropping him would print a
       roster of one as if it were the whole squad, and nothing in the document
       would say a name was missing. */
    const doc = teamAnalysisReport(report());
    const aditya = dividers(doc.blocks).find((d) => d.title === 'Aditya');
    expect(aditya).toBeDefined();
    expect(allText(doc)).toContain('no deck in the candidate pool');
  });

  it('names WHY a teammate has nothing, not just that they have nothing', () => {
    // no_history / no_comfort / no_evidence are three different problems.
    expect(allText(teamAnalysisReport(report()))).toContain('No deck played often enough');
  });

  it('grows with the rosters rather than to a fixed length', () => {
    const small = teamAnalysisReport(report());
    const big = teamAnalysisReport(
      report({
        blue: ['#B1', '#B2', '#B3', '#B4', '#B5'].map((t, i) => member(t, `Blue ${i}`)),
        red: ['#R1', '#R2', '#R3'].map((t, i) => member(t, `Red ${i}`)),
        folders: ['#R1', '#R2', '#R3'].map((t, i) => folder(t, `Red ${i}`)),
      }),
    );
    expect(dividers(big.blocks).length).toBeGreaterThan(dividers(small.blocks).length);
    // 5 teammates + 3 opponents + squads + board + method
    expect(dividers(big.blocks)).toHaveLength(5 + 3 + 3);
  });

  it('lists every tag, on both sides', () => {
    const text = allText(teamAnalysisReport(report()));
    for (const tag of ['#B1', '#B2', '#R1']) expect(text).toContain(tag);
  });
});

describe('teamAnalysisReport — the board', () => {
  it('builds a cell for every teammate against every opponent', () => {
    const doc = teamAnalysisReport(
      report({
        blue: [member('#B1', 'Ravi'), member('#B2', 'Aditya')],
        folders: [folder('#R1', 'Mohamed'), folder('#R2', 'Sergio')],
        red: [member('#R1', 'Mohamed'), member('#R2', 'Sergio')],
      }),
    );
    const matrix = doc.blocks.find((b) => b.kind === 'matrix');
    expect(matrix).toBeDefined();
    if (matrix?.kind !== 'matrix') throw new Error('not a matrix');
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows.every((r) => r.cells.length === 2)).toBe(true);
  });

  it('A CELL WITH NO EVIDENCE IS NULL, NOT ZERO', () => {
    /* Painting an unmeasured pairing at the bottom of the scale ranks it below
       a measured bad one, which is exactly backwards. */
    const doc = teamAnalysisReport(report());
    const matrix = doc.blocks.find((b) => b.kind === 'matrix');
    if (matrix?.kind !== 'matrix') throw new Error('not a matrix');
    const aditya = matrix.rows.find((r) => r.label === 'Aditya');
    expect(aditya?.cells[0].fraction).toBeNull();
    expect(aditya?.cells[0].text).toBe('—');
  });

  it('marks a cell thin when it covers under half of what they play', () => {
    const thinRec = { ...rec('#B1', 'Ravi'), spreadCovered: 31 };
    const f = folder('#R1', 'Mohamed', {
      perPlayer: [
        { owner: { tag: '#B1', name: 'Ravi' }, basis: 'stored', decks: [thinRec], considered: 2, reason: null },
      ],
    });
    const doc = teamAnalysisReport(report({ folders: [f], blue: [member('#B1', 'Ravi')] }));
    const matrix = doc.blocks.find((b) => b.kind === 'matrix');
    if (matrix?.kind !== 'matrix') throw new Error('not a matrix');
    expect(matrix.rows[0].cells[0].thin).toBe(true);
  });
});

describe('teamAnalysisReport — the qualifications travel', () => {
  it('prints how much of their play a figure actually covers', () => {
    // A rate over 60% of somebody's play is a different claim from one over
    // 95%, and the number alone cannot tell them apart.
    expect(allText(teamAnalysisReport(report()))).toContain('covers');
  });

  it('keeps an unanswerable archetype visible with a null rate', () => {
    const doc = teamAnalysisReport(report());
    const detail = doc.blocks.find(
      (b) => b.kind === 'table' && (b.heading ?? '').startsWith('Why '),
    );
    if (detail?.kind !== 'table') throw new Error('no evidence table');
    const xbow = detail.rows.find((r) => (r.arch as string) === 'X-Bow');
    expect(xbow).toBeDefined();
    expect(JSON.stringify(xbow)).toContain('no evidence');
  });

  it('says a saved report is a snapshot, with the date it was run', () => {
    const doc = teamAnalysisReport(report(), { savedAt: '2026-08-01T10:00:00.000Z' });
    expect(doc.caveats?.[0]).toContain('SAVED analysis');
    expect(doc.caveats?.[0]).toContain('2026');
  });

  it('does not claim a snapshot when the run is live', () => {
    const doc = teamAnalysisReport(report());
    expect(doc.caveats?.some((c) => c.includes('SAVED analysis'))).toBe(false);
    expect(doc.meta.find((m) => m.label === 'Analysis run')?.value).toBe('just now');
  });

  it('names tags the server refused, which are on no page', () => {
    const doc = teamAnalysisReport(report({ rejected: { blue: ['#NOPE'], red: [] } }));
    expect(doc.caveats?.[0]).toContain('#NOPE');
  });

  it('leads with the pool failure when the squad has nothing pilotable', () => {
    const doc = teamAnalysisReport(
      report({ pool: { decks: 0, reason: 'no_blue_comfort', minGames: 5 } }),
    );
    expect(doc.caveats?.[0]).toContain('5-game floor');
  });

  it('always states that the pool is only decks the squad already plays', () => {
    // The single most likely misreading: that this is "the best deck".
    expect(allText(teamAnalysisReport(report()))).toContain(
      'only decks your squad has actually played',
    );
  });
});

describe('teamAnalysisReport — shape', () => {
  it('asks for a contents sheet, because it is a long document', () => {
    expect(teamAnalysisReport(report()).contents).toBe(true);
  });

  it('indents player sections under the top-level ones', () => {
    const ds = dividers(teamAnalysisReport(report()).blocks);
    expect(ds.find((d) => d.title === 'Both squads')?.depth ?? 0).toBe(0);
    expect(ds.find((d) => d.title === 'Ravi')?.depth).toBe(1);
  });

  it('takes the window and the floors off the report, never restating them', () => {
    const doc = teamAnalysisReport(report({ days: 90, limits: { maxSquad: 10, topN: 3, minComfortGames: 9, minOpponentDeckGames: 3 } }));
    expect(doc.meta.find((m) => m.label === 'Window')?.value).toBe('90 days');
    expect(doc.meta.find((m) => m.label === 'Comfort floor')?.value).toBe('9 games');
    expect(allText(doc)).toContain('9-game floor');
  });

  it('survives a report with no folders at all', () => {
    const doc = teamAnalysisReport(report({ red: [], folders: [] }));
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(dividers(doc.blocks).map((d) => d.title)).toContain('Method, and what it does not say');
  });
});
