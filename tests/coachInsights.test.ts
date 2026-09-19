import { describe, expect, it } from 'vitest';

import { FLOORS, buildInsights, type InsightDeck, type InsightIntel } from '../src/state/coachInsights';

const tally = (battles: number, wins: number, draws = 0) => ({
  battles,
  wins,
  losses: battles - wins - draws,
  draws,
});

const base = (over: Partial<InsightIntel> = {}): InsightIntel => ({
  summary: tally(100, 60),
  form: [],
  archetypes: [],
  opponentArchetypes: [],
  opponents: [],
  window: { from: '2026-08-20', to: '2026-09-19' },
  ...over,
});

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('insights', () => {
  it('says nothing at all below the window floor', () => {
    const intel = base({ summary: tally(FLOORS.window - 1, 5), archetypes: [{ name: 'Hog Rider', ...tally(9, 5) }] });
    expect(buildInsights(intel, [])).toEqual([]);
  });

  it('names the most-played win condition with its share and count', () => {
    const [i] = buildInsights(base({ archetypes: [{ name: 'Hog Rider', ...tally(42, 25) }] }), []);
    expect(i.id).toBe('archetype-share');
    expect(i.text).toContain('Hog Rider');
    expect(i.text).toContain('42.0%');
    expect(i.evidence).toBe('42 of 100 battles');
  });

  it('does not name an archetype with too few battles behind it', () => {
    expect(ids(buildInsights(base({ archetypes: [{ name: 'Hog Rider', ...tally(19, 19) }] }), []))).not.toContain(
      'archetype-share',
    );
  });

  it('compares a deck to the player’s OWN rate, and only past the floor and the gap', () => {
    const decks: InsightDeck[] = [
      { name: 'Hog 2.6', battles: 30, wins: 24, lastSeen: '2026-09-18T10:00:00Z' }, // 80% vs 60%
      { name: 'Golem', battles: 20, wins: 8, lastSeen: '2026-09-18T10:00:00Z' }, // 40% vs 60%
      { name: 'Close', battles: 40, wins: 25, lastSeen: '2026-09-18T10:00:00Z' }, // 62.5% — inside the gap
      { name: 'Thin', battles: 4, wins: 4, lastSeen: '2026-09-18T10:00:00Z' }, // 100% on 4
    ];
    const out = buildInsights(base(), decks);
    const up = out.find((i) => i.id === 'deck-Hog 2.6-up');
    const down = out.find((i) => i.id === 'deck-Golem-down');
    expect(up?.kind).toBe('strength');
    expect(up?.text).toContain('80.0% against 60.0%');
    expect(down?.kind).toBe('weakness');
    expect(ids(out).some((x) => x.startsWith('deck-Close'))).toBe(false);
    expect(ids(out).some((x) => x.startsWith('deck-Thin'))).toBe(false);
  });

  it('notices a deck with history that has dropped out of use', () => {
    const out = buildInsights(base(), [{ name: 'Old Faithful', battles: 30, wins: 18, lastSeen: '2026-08-25T12:00:00Z' }]);
    const stale = out.find((i) => i.id === 'deck-Old Faithful-stale');
    expect(stale?.text).toContain('last 25 days');
    expect(stale?.evidence).toContain('2026-08-25');
  });

  it('calls out a matchup only when it is well past their usual rate', () => {
    const out = buildInsights(
      base({
        opponentArchetypes: [
          { name: 'Golem', ...tally(20, 6) }, // 30% vs 60%
          { name: 'Bait', ...tally(20, 11) }, // 55% — inside the gap
          { name: 'X-Bow', ...tally(5, 0) }, // too few
        ],
      }),
      [],
    );
    expect(ids(out)).toContain('vs-Golem');
    expect(ids(out)).not.toContain('vs-Bait');
    expect(ids(out)).not.toContain('vs-X-Bow');
    expect(out.find((i) => i.id === 'vs-Golem')?.evidence).toBe('20 battles vs Golem · 6W 14L');
  });

  it('lists repeat opponents, stopping at the floor', () => {
    const out = buildInsights(
      base({
        opponents: [
          { tag: '#AAA', name: 'Rival', ...tally(5, 2) },
          { tag: '#BBB', name: null, ...tally(3, 3) },
          { tag: '#CCC', name: 'Once', ...tally(2, 1) },
        ],
      }),
      [],
    );
    expect(ids(out)).toEqual(['opp-#AAA', 'opp-#BBB']);
    expect(out[0].text).toBe('Has met Rival (#AAA) 5 times in this window.');
    expect(out[1].text).toBe('Has met #BBB 3 times in this window.');
  });

  it('reads current form only from a full ten', () => {
    expect(ids(buildInsights(base({ form: ['win', 'win', 'loss'] }), []))).not.toContain('form');
    const form = ['win', 'win', 'win', 'win', 'win', 'win', 'win', 'win', 'loss', 'loss'];
    const i = buildInsights(base({ form }), []).find((x) => x.id === 'form');
    expect(i?.text).toBe('Won 8 of their last 10 battles, against 60.0% across the window.');
    expect(i?.kind).toBe('strength');
    expect(i?.evidence).toBe('last 10: WWWWWWWWLL');
  });

  it('never uses an adjective the numbers cannot carry', () => {
    const out = buildInsights(
      base({
        archetypes: [{ name: 'Hog Rider', ...tally(42, 25) }],
        opponentArchetypes: [{ name: 'Golem', ...tally(20, 6) }],
        opponents: [{ tag: '#AAA', name: 'Rival', ...tally(5, 2) }],
      }),
      [{ name: 'Hog 2.6', battles: 30, wins: 24, lastSeen: '2026-09-18T10:00:00Z' }],
    );
    const text = out.map((i) => i.text).join(' ').toLowerCase();
    for (const word of ['dominant', 'weak', 'best', 'worst', 'always', 'never', 'struggles', 'excellent']) {
      expect(text).not.toContain(word);
    }
  });
});
