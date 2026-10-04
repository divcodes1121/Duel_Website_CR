/**
 * The Decks screen: its three windows, its place in the rail, and its report.
 *
 * `fixtures/report-decks.json` is THE PRODUCER'S OWN OUTPUT — `server/
 * player_decks.report` run over a temporary database of invented battles — so
 * the shape under test is the one the server sends, not one a test imagined.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import decks from './fixtures/report-decks.json';
import type { PlayerDecksReport } from '../src/state/analyticsClient';
import { sectionAllowed } from '../src/state/tiers';
import type { DecksBlock, StatsBlock } from '../src/utils/analyticsReport';
import { DAY_PRESETS, DECK_DAY_PRESETS, DECK_DEFAULT_DAYS } from '../src/utils/datePresets';
import { deckDays } from '../src/utils/playerDossier';
import { playerDecksDoc } from '../src/utils/screenAdapters';

const R = decks as unknown as PlayerDecksReport;
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the three windows', () => {
  it('are 7, 14 and 30 days, opening on 7', () => {
    expect([...DECK_DAY_PRESETS]).toEqual([7, 14, 30]);
    expect(DECK_DEFAULT_DAYS).toBe(7);
  });

  it('are the ones the server accepts — two projects, one list', () => {
    const py = read('server/player_decks.py');
    const days = /^DAYS = \(([^)]*)\)/m.exec(py)?.[1].split(',').map((x) => Number(x.trim()));
    expect(days).toEqual([...DECK_DAY_PRESETS]);
    expect(Number(/^DEFAULT_DAYS = (\d+)/m.exec(py)?.[1])).toBe(DECK_DEFAULT_DAYS);
  });

  it('leave the shared six alone', () => {
    expect([...DAY_PRESETS]).toEqual([7, 15, 30, 45, 60, 90]);
  });

  it('the screen reads the list instead of carrying its own', () => {
    const src = read('src/components/Analytics/PlayerDecks.tsx');
    expect(src).toMatch(/DECK_DAY_PRESETS\.map/);
    expect(src).toMatch(/useState<DeckDayPreset>\(DECK_DEFAULT_DAYS\)/);
    expect(src).not.toMatch(/\[\s*7\s*,\s*14\s*,\s*30\s*\]/);
  });

  it('the full player report asks for a window the screen offers', () => {
    expect(deckDays({ days: 7 })).toBe(7);
    expect(deckDays({ days: 14 })).toBe(14);
    expect(deckDays({ days: 30 })).toBe(30);
    // Anything else — 60 days, all data, a custom range — is the longest of the three.
    expect(deckDays({ days: 60 })).toBe(30);
    expect(deckDays({ days: 0 })).toBe(30);
    expect(deckDays({ from: '2026-09-01', to: '2026-09-30' })).toBe(30);
    expect(deckDays({})).toBe(30);
  });
});

describe('its place in the shell', () => {
  const dash = read('src/components/Dashboard/Dashboard.tsx');
  const nav = dash.slice(dash.indexOf('const SIDE_NAV = ['), dash.indexOf('const AREAS = '));

  it('is a rail row with the `decks` slug', () => {
    expect(nav).toMatch(/\{ label: 'Decks', icon: DeckRankIcon, slug: 'decks', hue: 'pink' \}/);
  });

  it('no two rail rows share a slug', () => {
    /* The route maps a slug back to its label to ask the gate, with `find` —
       so a second row on one slug is a section gated by another's rule. */
    const slugs = [...nav.matchAll(/slug: '([^']*)'/g)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThan(8);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('sits directly under Recent Battles', () => {
    const labels = [...nav.matchAll(/label: '([^']*)'/g)].map((m) => m[1]);
    expect(labels[labels.indexOf('Recent Battles') + 1]).toBe('Decks');
  });

  it('the player route draws it', () => {
    expect(dash).toMatch(/playerSection === 'decks' \? \(\s*<PlayerDecks tag=\{playerTag\} \/>/);
  });

  it('the paste-a-deck lab stays off a loaded player’s rail', () => {
    expect(dash).toContain("s.slug !== 'meta' && s.slug !== 'deck-analysis'");
  });

  it('asks for a tag on the home route, like the other player screens', () => {
    const tagSections = dash.slice(dash.indexOf('const TAG_SECTIONS'), dash.indexOf('function HomeSection'));
    expect(tagSections).toMatch(/\n {2}Decks: \{/);
  });

  it('is open to everyone', () => {
    for (const access of ['anon', 'free', 'trial', 'pro', 'admin'] as const) {
      expect(sectionAllowed(access, 'Decks'), access).toBe(true);
    }
  });
});

describe('playerDecksDoc', () => {
  const doc = playerDecksDoc(R, '#ABC002');
  const stats = doc.blocks[0] as StatsBlock;
  const list = doc.blocks[1] as DecksBlock;

  it('is the Decks report for that player', () => {
    expect(doc.screen).toBe('Decks');
    expect(doc.subject).toBe('#ABC002');
    expect(doc.hue).toBe('pink');
    expect(doc.meta.find((m) => m.label === 'Window')?.value).toBe('2026-09-01 – 2026-09-30');
  });

  it('opens on the counts', () => {
    expect(stats.kind).toBe('stats');
    expect(stats.tiles.map((t) => t.label)).toEqual(['Games', 'Decks', 'Win rate', 'Most played']);
    expect(stats.tiles[0].value).toBe(String(R.total));
    expect(stats.tiles[1].value).toBe(String(R.decks.length));
  });

  it('lists every deck in the server’s order, one line each', () => {
    expect(list.kind).toBe('decks');
    expect(list.layout).toBe('rows');
    expect(list.decks.map((d) => d.name)).toEqual(R.decks.map((d) => d.deckName));
    expect(list.decks.map((d) => d.rank)).toEqual(R.decks.map((_, i) => i + 1));
    // Most played first is the server's order; the report must not re-sort it.
    const played = R.decks.map((d) => d.battles);
    expect([...played].sort((a, b) => b - a)).toEqual(played);
  });

  it('prints the share of play, never coloured as a result', () => {
    const first = list.decks[0];
    expect(first.value).toBe(`${R.decks[0].useRate.toFixed(1)}%`);
    expect(first.valueNote).toBe(`${R.decks[0].battles} of ${R.total} games`);
    expect(first.valueHue).toBe('neutral');
  });

  it('carries the cards and the forms they were seen in', () => {
    const first = list.decks[0];
    expect(first.cards).toHaveLength(8);
    expect(first.art).toEqual(R.decks[0].art);
    expect(first.meta).toMatch(/elixir · \d+ cycle/);
  });

  it('prints both records, and no community figure where there is none', () => {
    const [first] = list.decks;
    const labels = (first.chips ?? []).map((c) => c.label);
    expect(labels).toContain('Won');
    expect(labels).toContain('Lost');
    expect(labels).toContain('Community');
    const without = list.decks.find((_, i) => R.decks[i].community === null);
    expect(without).toBeDefined();
    expect((without?.chips ?? []).map((c) => c.label)).not.toContain('Community');
  });

  it('a draw is printed only for a deck that has one', () => {
    list.decks.forEach((d, i) => {
      const has = (d.chips ?? []).some((c) => c.label === 'Drawn');
      expect(has, R.decks[i].deckName).toBe(R.decks[i].draws > 0);
    });
  });

  it('an empty window is a report with no deck list, not a crash', () => {
    const empty = playerDecksDoc(
      { ...R, decks: [], total: 0, summary: { ...R.summary, battles: 0, wins: 0, losses: 0, draws: 0, decks: 0, winRate: 0 } },
      '#ABC002',
    );
    expect(empty.blocks).toHaveLength(1);
    expect((empty.blocks[0] as StatsBlock).tiles[2].value).toBe('—');
  });
});
