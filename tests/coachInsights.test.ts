import { describe, expect, it } from 'vitest';

import { FLOORS, MAX_INSIGHTS, buildInsights, type InsightDeck, type InsightIntel } from '../src/state/coachInsights';

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

/** A deck fixture keyed the way the server keys one — sorted cards joined. */
const deck = (over: Partial<InsightDeck> & { name: string }): InsightDeck => ({
  key: over.key ?? over.name.toLowerCase().replace(/\s+/g, '-'),
  battles: 30,
  wins: 24,
  lastSeen: '2026-09-18T10:00:00Z',
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
      deck({ name: 'Hog 2.6', battles: 30, wins: 24 }), // 80% vs 60%
      deck({ name: 'Golem', battles: 20, wins: 8 }), // 40% vs 60%
      deck({ name: 'Close', battles: 40, wins: 25 }), // 62.5% — inside the gap
      deck({ name: 'Thin', battles: 4, wins: 4 }), // 100% on 4
    ];
    const out = buildInsights(base(), decks);
    const up = out.find((i) => i.id === 'deck-hog-2.6-up');
    const down = out.find((i) => i.id === 'deck-golem-down');
    expect(up?.kind).toBe('strength');
    expect(up?.text).toContain('80.0% against 60.0%');
    expect(down?.kind).toBe('weakness');
    expect(ids(out).some((x) => x.includes('close'))).toBe(false);
    expect(ids(out).some((x) => x.includes('thin'))).toBe(false);
  });

  /* THE BUG THIS PINS SHIPPED AND WAS MEASURED LIVE. `deckName` is generated
     and collides — one real player had NINE distinct decks called "Mortar
     Rascals" — so keying on the name produced one React key for two rows and
     printed opposite verdicts under one heading. */
  it('keys a deck by its cards, so two decks sharing a name stay apart', () => {
    const out = buildInsights(base(), [
      deck({ key: 'a,b,c,d,e,f,g,h', name: 'Mortar Rascals', battles: 40, wins: 32 }),
      deck({ key: 'a,b,c,d,e,f,g,z', name: 'Mortar Rascals', battles: 30, wins: 24 }),
    ]);
    const rows = out.filter((i) => i.text.startsWith('Mortar Rascals wins'));
    expect(rows).toHaveLength(2);
    expect(new Set(ids(rows)).size).toBe(2);
    // Each carries the key the screen looks the real deck up by, so the two
    // draw different strips rather than one repeated name.
    expect(new Set(rows.map((r) => r.deckKey)).size).toBe(2);
  });

  it('notices a deck with history that has dropped out of use', () => {
    const out = buildInsights(base(), [
      deck({ key: 'old', name: 'Old Faithful', battles: 30, wins: 18, lastSeen: '2026-08-25T12:00:00Z' }),
    ]);
    const stale = out.find((i) => i.id === 'deck-old-stale');
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

  /* Measured live: eight of one player's thirty bullets were "Has met
     <stranger> N times", and another player's most-met opponent was someone
     else on the SAME ROSTER. That ledger belongs to the Opponents tab. */
  it('never lists who they met — that is the Opponents tab, not an insight', () => {
    const out = buildInsights(
      base({
        opponents: [
          { tag: '#AAA', name: 'Rival', ...tally(5, 2) },
          { tag: '#BBB', name: null, ...tally(3, 3) },
        ],
      }),
      [],
    );
    expect(ids(out).some((x) => x.startsWith('opp-'))).toBe(false);
    expect(out.map((i) => i.text).join(' ')).not.toContain('Has met');
  });

  it('reads current form only from a full ten', () => {
    expect(ids(buildInsights(base({ form: ['win', 'win', 'loss'] }), []))).not.toContain('form');
    const form = ['win', 'win', 'win', 'win', 'win', 'win', 'win', 'win', 'loss', 'loss'];
    const i = buildInsights(base({ form }), []).find((x) => x.id === 'form');
    expect(i?.text).toBe('Won 8 of their last 10 battles, against 60.0% across the window.');
    expect(i?.kind).toBe('strength');
    expect(i?.evidence).toBe('last 10: WWWWWWWWLL');
  });

  /* A list of thirty is not read. Live, one roster player produced exactly
     that, which is what this ceiling exists to stop. */
  it('never prints more than the ceiling, and keeps the heaviest', () => {
    const decks = Array.from({ length: 12 }, (_, n) =>
      deck({ key: `d${n}`, name: `Deck ${n}`, battles: 20 + n, wins: 20 + n }), // all 100%
    );
    const out = buildInsights(
      base({
        archetypes: [{ name: 'Hog Rider', ...tally(42, 25) }],
        opponentArchetypes: [
          { name: 'Golem', ...tally(60, 6) }, // 10% vs 60% over 60 — the heaviest thing here
          { name: 'Bait', ...tally(30, 27) },
        ],
      }),
      decks,
    );
    expect(out).toHaveLength(MAX_INSIGHTS);
    // The worst matchup, measured over the most battles, must survive the cut.
    expect(ids(out)).toContain('vs-Golem');
    // Context loses to evidence: a bare share should not displace a real gap.
    expect(ids(out)).not.toContain('archetype-share');
  });

  it('orders by evidence times effect, not by the order the rules ran', () => {
    const out = buildInsights(
      base({
        opponentArchetypes: [
          { name: 'Thin', ...tally(10, 1) }, // 10% vs 60%, but only 10 battles
          { name: 'Solid', ...tally(200, 80) }, // 40% vs 60% over 200
        ],
      }),
      [],
    );
    expect(ids(out)[0]).toBe('vs-Solid');
  });

  it('never uses an adjective the numbers cannot carry', () => {
    const out = buildInsights(
      base({
        archetypes: [{ name: 'Hog Rider', ...tally(42, 25) }],
        opponentArchetypes: [{ name: 'Golem', ...tally(20, 6) }],
        opponents: [{ tag: '#AAA', name: 'Rival', ...tally(5, 2) }],
      }),
      [deck({ name: 'Hog 2.6', battles: 30, wins: 24 })],
    );
    const text = out.map((i) => i.text).join(' ').toLowerCase();
    for (const word of ['dominant', 'weak', 'best', 'worst', 'always', 'never', 'struggles', 'excellent']) {
      expect(text).not.toContain(word);
    }
  });
});
