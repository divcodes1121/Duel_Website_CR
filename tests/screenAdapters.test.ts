/**
 * The report models for the screens that had no export before, and the full
 * player report that binds every section into one document.
 *
 * Fixtures are REAL production payloads (`tests/fixtures/report-*.json`) with
 * every player tag and name replaced — the producer's own shape, which is the
 * only kind of fixture that pins anything. This repo has already paid for a
 * suite that passed against a fixture speaking its own vocabulary.
 */

import { describe, expect, it } from 'vitest';
import battles from './fixtures/report-battles.json';
import counter from './fixtures/report-counter.json';
import duelzone from './fixtures/report-duelzone.json';
import duo from './fixtures/report-duo.json';
import type {
  DuelZoneReport, DuoReport, PlayerCounterReport, RecentBattlesReport,
} from '../src/state/analyticsClient';
import type { BattlesBlock, DecksBlock, DividerBlock, ReportDoc, VersusBlock } from '../src/utils/analyticsReport';
import {
  archetypeName, deckCounterDoc, duelInsightBlocks, duoPairsDoc, recentBattlesDoc, when,
} from '../src/utils/screenAdapters';
import { combineReports } from '../src/utils/playerDossier';
import { DAY } from '../src/utils/reportAdapters';

const B = battles as unknown as RecentBattlesReport;
const C = counter as unknown as PlayerCounterReport;
const Z = duelzone as unknown as DuelZoneReport;
const D = duo as unknown as DuoReport;

describe('dates', () => {
  it('reads Supercell’s battle stamp, which slicing printed as "20260926T0"', () => {
    expect(DAY('20260926T161011.000Z')).toBe('2026-09-26');
    expect(DAY('2026-09-26T10:00:00Z')).toBe('2026-09-26');
    expect(DAY(null)).toBe('—');
    expect(when('20260926T161011.000Z')).toBe('26 Sep 2026, 16:10');
  });
});

describe('recentBattlesDoc', () => {
  const doc = recentBattlesDoc(B, '#PQ2LLLLL');
  const log = doc.blocks.find((b) => b.kind === 'battles') as BattlesBlock;

  it('prints one row per battle the server sent, both decks drawn', () => {
    expect(log.rows).toHaveLength(B.battles.length);
    for (const r of log.rows) {
      expect(r.left.cards.length).toBe(8);
      expect(r.right.cards.length).toBe(8);
    }
  });

  it('carries the score and the result the screen shows', () => {
    const b0 = B.battles[0];
    expect(log.rows[0].result).toBe(b0.result);
    expect(log.rows[0].score).toBe(`${b0.crowns}–${b0.opponentCrowns}`);
  });

  it('counts the battles it could not show rather than dropping them silently', () => {
    const stats = doc.blocks[0];
    expect(stats.kind).toBe('stats');
    expect(JSON.stringify(stats)).toContain('Not shown');
  });
});

describe('deckCounterDoc', () => {
  const doc = deckCounterDoc(C, '#PQ2LLLLL');

  it('prints each matchup group the screen has, as decks with their cards', () => {
    const headings = doc.blocks.filter((b) => b.kind === 'decks').map((b) => (b as DecksBlock).heading);
    if (C.worst.length) expect(headings).toContain('Worst matchups');
    if (C.best.length) expect(headings).toContain('Best matchups');
  });

  it('colours a matchup by its gap to the player’s own average, not by the raw rate', () => {
    // A 63% "worst matchup" is under their 72%; printed green it reads as good.
    const worst = doc.blocks.find((b) => b.kind === 'decks' && (b as DecksBlock).heading === 'Worst matchups') as DecksBlock | undefined;
    if (!worst) return;
    C.worst.forEach((m, i) => {
      const want = m.diff <= -5 ? 'red' : m.diff >= 5 ? 'green' : 'neutral';
      expect(worst.decks[i].valueHue).toBe(want);
    });
  });

  it('adds the deck-vs-deck and find-a-counter tabs only when they have been run', () => {
    expect(doc.blocks.some((b) => b.kind === 'versus')).toBe(false);
  });
});

describe('deckCounterDoc — the list of what to bring', () => {
  /* The scouting engine's rows (`team_analysis.bring`). The figures have their
     own suites on the server; this pins what the PDF does with them. */
  const deck = (name: string, rate: number, vs: Record<string, number>, extra = {}) => ({
    key: name, name, archetype: 'hog', avgElixir: 3.1, owner: null, comfort: null,
    cards: ['hog-rider', 'musketeer', 'cannon', 'ice-golem', 'skeletons', 'the-log', 'fireball', 'ice-spirit'],
    art: {}, expectedWinRate: rate, matchupValue: rate, spreadCovered: 100, vs, ...extra,
  });
  const plays = [
    { family: 'giant', archetype: 'giant', name: 'Giant', share: 0.79, games: 900, decks: 4 },
    { family: 'bridge-spam', archetype: 'bridge-spam', name: 'Bridge Spam', share: 0.1, games: 110, decks: 2 },
  ];
  const bring = {
    basis: 'stored', battles: 1010, window: { from: null, to: null }, plays, reason: null,
    pool: { decks: 2341 }, brain: 'team-scout-3.0',
    decks: [deck('Log Bait', 66, { giant: 67.9, 'bridge-spam': 54.5 }, { origin: 'duel' }),
            deck('Lava Hound', 64.5, { giant: 65.1 })],
    byFamily: [
      { ...plays[0], decks: [{ ...deck('Log Bait', 66, { giant: 67.9, 'bridge-spam': 54.5 }), rate: 67.9 }] },
      { ...plays[1], decks: [] },
    ],
    byCard: {
      theirCards: [{ card: 'giant', share: 0.85 }],
      cards: [{ card: 'inferno-tower', why: 'answers', answers: [{ card: 'giant', share: 0.85 }], open: [],
                exposure: 0.2, lift: 5.2, lists: 132, decks: [deck('Log Bait', 60.3, { giant: 63 })] }],
    },
  };
  const doc = deckCounterDoc({ ...C, bring } as unknown as PlayerCounterReport, '#PQ2LLLLL');
  const lists = doc.blocks.filter((b): b is DecksBlock => b.kind === 'decks' && b.layout === 'rows');

  it('prints the list, then a block per archetype, then a block per counter card', () => {
    expect(lists.map((b) => b.heading)).toEqual([
      'Bring this against them', 'Against their Giant', 'Decks with Inferno Tower',
    ]);
  });
  it('says what they play, as shares', () => {
    expect(lists[0].note).toBe('Likely to bring Giant 79% · Bridge Spam 10%');
  });
  it('ranks the decks and prints each one’s rate against their archetypes', () => {
    const [first, second] = lists[0].decks;
    expect([first.rank, first.value, second.rank, second.value]).toEqual([1, '66.0%', 2, '64.5%']);
    expect(first.chips).toEqual([
      { label: 'Giant', value: '68%', good: true },
      { label: 'Bridge Spam', value: '55%', good: true },
    ]);
    // An unmeasured matchup is left out, never printed as 50.
    expect(second.chips).toEqual([{ label: 'Giant', value: '65%', good: true }]);
    expect(first.badge?.text).toBe('Duel deck');
  });
  it('a per-archetype block leads with the rate against THAT archetype', () => {
    expect(lists[1].decks[0].value).toBe('67.9%');
    expect(lists[1].decks[0].chips?.map((c) => c.label)).toEqual(['Bridge Spam']);
  });
  it('an archetype nothing beats prints no block rather than an empty one', () => {
    expect(lists.some((b) => b.heading === 'Against their Bridge Spam')).toBe(false);
  });
  it('a counter card’s block names what of theirs the card answers', () => {
    expect(lists[2].note).toBe('Answers their Giant');
  });
  it('a report from a server before the engine keeps the old list', () => {
    const old = deckCounterDoc(C, '#PQ2LLLLL');
    const h = old.blocks.filter((b): b is DecksBlock => b.kind === 'decks').map((b) => b.heading);
    expect(h).toContain('Bring this against them');
    expect(h.some((x) => x?.startsWith('Against their'))).toBe(false);
  });
});

describe('duelInsightBlocks', () => {
  const blocks = duelInsightBlocks(Z);

  it('carries the Duel Insights panel into the Duel Analysis report', () => {
    expect(blocks[0].kind).toBe('stats');
    expect((blocks[0] as { heading?: string }).heading).toBe('Duel insights');
  });

  it('prints archetypes as names, never as keys', () => {
    const t = JSON.stringify(blocks);
    expect(t).not.toMatch(/"bridge-spam"|"xbow"/);
    expect(archetypeName('bridge-spam')).toBe('Bridge Spam');
    expect(archetypeName('xbow')).toBe('X-Bow');
    expect(archetypeName('Royal Hogs')).toBe('Royal Hogs');
  });

  it('is empty for a player with no duels', () => {
    expect(duelInsightBlocks({ ...Z, series: [] })).toEqual([]);
  });
});

describe('duoPairsDoc', () => {
  const doc = duoPairsDoc(D);
  const v = doc.blocks.find((b) => b.kind === 'versus') as VersusBlock;

  it('draws teammates with a plus, never a VS', () => {
    expect(v.joiner).toBe('+');
  });

  it('prints every pair on the page with both decks', () => {
    expect(v.pairs).toHaveLength(D.pairs.length);
    expect(v.pairs[0].left.cards).toEqual(D.pairs[0].deckA.cardKeys);
    expect(v.pairs[0].right?.cards).toEqual(D.pairs[0].deckB.cardKeys);
  });
});

describe('combineReports — the full player report', () => {
  const a = recentBattlesDoc(B, '#PQ2LLLLL');
  const b = deckCounterDoc(C, '#PQ2LLLLL');
  const doc: ReportDoc = combineReports([a, b], { screen: 'Player Report', subject: '#PQ2LLLLL', missing: ['Cards: could not be read'] });

  it('opens on a cover with contents', () => {
    expect(doc.cover).toBe('full');
    expect(doc.contents).toBe(true);
  });

  it('gives every section its own opener, listed in the contents', () => {
    const dividers = doc.blocks.filter((x) => x.kind === 'divider') as DividerBlock[];
    expect(dividers.map((d) => d.title)).toEqual(['Recent Battles', 'Deck Counter']);
    expect(dividers.every((d) => d.contents)).toBe(true);
  });

  it('moves each section’s headline figures onto its opener', () => {
    const first = doc.blocks.find((x) => x.kind === 'divider') as DividerBlock;
    expect(first.stats?.length).toBeGreaterThan(0);
  });

  it('says which sections could not be read instead of leaving them out silently', () => {
    expect(JSON.stringify(doc.blocks)).toContain('Cards: could not be read');
  });
});
