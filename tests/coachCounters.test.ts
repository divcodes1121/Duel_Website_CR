import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { counterHeading, counterLabel, counterNote, setCounterNote } from '../src/utils/coachCounters';

/* COUNTERS TO WHAT THEY BRING, ON THE COACH ASSIST SCREEN (2026-10-12).
 *
 * Until this, the only decks the Suggestion could tell a player to open with
 * were their own duel decks. The server now also rates the counter pool — the
 * CRL group's duel lists and the vetted ladder lists — against the read of the
 * opponent's next deck (`server/coach.py` `_counter_rows`), lets the best of
 * them into the set and the options, and sends the block.
 *
 * The few words are tested as code. The screen is a source contract, the
 * pattern `coachTunerGate.test.ts` uses: it cannot be mounted here without the
 * analytics service.
 */
const norm = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SCREEN = norm('src/components/Analytics/CoachAssist.tsx');
const CLIENT = norm('src/state/analyticsClient.ts');
const ADAPTER = norm('src/utils/screenAdapters.ts');
const UTIL = norm('src/utils/coachCounters.ts');
const SERVER = norm('server/coach.py');

describe('the words on the block', () => {
  it('names where a counter comes from', () => {
    expect(counterLabel('duel')).toBe('CRL duel list');
    expect(counterLabel('ladder')).toBe('Meta list');
    // An origin the client has never heard of is still a list from the pool.
    expect(counterLabel(null)).toBe('Meta list');
    expect(counterLabel(undefined)).toBe('Meta list');
  });

  it('says what the lists were rated against: the opener, then what is left', () => {
    expect(counterHeading(0)).toBe('Counters to their likely opener');
    expect(counterHeading(1)).toBe('Counters to what they have left');
    expect(counterHeading(2)).toBe('Counters to what they have left');
    expect(counterHeading(1)).not.toBe(counterHeading(0));
  });

  it('counts, and nothing else', () => {
    expect(counterNote({ rated: 552, against: 5 })).toBe('552 lists rated · against 5 of their decks');
    expect(counterNote({ rated: 1234, against: 1 })).toBe('1,234 lists rated · against 1 of their deck');
  });

  it('says how many of a set are counters, and nothing when none are', () => {
    expect(setCounterNote(0)).toBe('');
    expect(setCounterNote(undefined)).toBe('');
    expect(setCounterNote(null)).toBe('');
    expect(setCounterNote(1)).toBe(' · 1 counter');
    expect(setCounterNote(2)).toBe(' · 2 counters');
  });

  it('imports nothing', () => {
    expect(UTIL).not.toMatch(/^import /m);
  });
});

describe('the screen', () => {
  const panel = SCREEN.slice(SCREEN.indexOf('function CounterPanel('), SCREEN.indexOf('function ThenRow('));

  it('draws the block only when the server sent counters, directly under the pick', () => {
    expect(SCREEN).toContain('{data.counters && data.counters.decks.length > 0 && (');
    const verdict = SCREEN.indexOf('<span className={styles.verdictLabel}>Play this</span>');
    const block = SCREEN.indexOf('<CounterPanel counters={data.counters} stage={data.stage} />');
    const options = SCREEN.indexOf("{data.duelSet ? 'Your set for this duel' : 'Your options, ranked'}");
    expect(verdict).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(verdict);
    expect(options).toBeGreaterThan(block);
  });

  it('draws each counter as an option row, so the figures are the same figures', () => {
    expect(panel).toContain('<DeckRow key={d.cards.join(\',\')} deck={d} rank={i + 1} hue="green" />');
    expect(panel).toContain('{counterHeading(stage)}');
    expect(panel).toContain('{counterNote(counters)}');
  });

  it('adds no sentence: a heading, a count and the rows', () => {
    expect(panel).not.toMatch(/<p[\s>]/);
    // The only text nodes are the two helpers' output.
    expect(panel.match(/\{counter[A-Z]\w+\(/g)).toEqual(['{counterHeading(', '{counterNote(']);
  });

  it('tags a counter wherever it is drawn — in the block, the set or the options', () => {
    const row = SCREEN.slice(SCREEN.indexOf('function DeckRow('), SCREEN.indexOf("/** '2026-07-26T"));
    expect(row).toContain('{deck.counter && (');
    expect(row).toContain('{counterLabel(deck.origin)}');
    expect(row).toContain("data-counter={deck.origin ?? ''}");
    // ...and on "Play this" itself when the pick is one.
    expect(SCREEN).toContain('{best.counter && (');
    expect(SCREEN).toContain('{counterLabel(best.origin)}');
  });

  it('says how many of the set are counters', () => {
    expect(SCREEN).toContain('{data.duelSet.size} decks{setCounterNote(data.duelSet.counters)} · {data.duelSet.duel.toFixed(1)}%');
  });

  it('stops quoting the game-2 figure once the card model rates the list', () => {
    expect(SCREEN).toContain('<BrainLine model={data.brainModel} cards={!!data.fusion?.cardModel} />');
    expect(SCREEN).toContain("cards ? null : m && model.mode === 'combined'");
    expect(SCREEN).toContain("${cards ? ' + card-vs-card model' : ''}");
  });

  it('says a friendly duel is level-capped instead of "levels not read"', () => {
    expect(SCREEN).toContain("model.levelScale === 0 ? 'level-capped duel' : model.levels ? 'card levels read' : 'levels not read'");
    expect(CLIENT).toContain('levelScale?: number;');
    expect(SERVER).toContain('"levelScale": ctx.get("levelScale", 1.0),');
    // The kind reaches the level term: friendly off, clan war on.
    expect(SERVER).toMatch(/if kind is True:\n\s+return 0\.0\n\s+if kind is False:\n\s+return 1\.0/);
  });
});

describe('the contract with the server', () => {
  it('types the block, the flags on a row and the set', () => {
    expect(CLIENT).toContain('export interface CoachCounters {');
    expect(CLIENT).toContain('counters?: CoachCounters | null;');
    expect(CLIENT).toContain("origin?: 'duel' | 'ladder' | null;");
    expect(CLIENT).toMatch(/counter\?: boolean;/);
    const set = CLIENT.slice(CLIENT.indexOf('export interface CoachDuelSet {'), CLIENT.indexOf('export interface CoachDuelPlan {'));
    expect(set).toContain('counters?: number;');
  });

  it('reads the fields the server writes', () => {
    // The payload key, the row flags and the two origins.
    expect(SERVER).toContain('"counters": ({**counter_info, "decks": counters[:COUNTER_SHOW]}');
    expect(SERVER).toContain('"counter": True, "origin": c.origin}');
    expect(SERVER).toMatch(/"rated": len\(scored\)/);
    expect(SERVER).toMatch(/"against": len\(threats\)/);
    expect(SERVER).toContain('"counters": sum(1 for d in res["decks"] if d["index"] >= len(own))');
    expect(SERVER).toContain('if c.origin == "duel" and take(value, c):');
    // The pool marks its lists with exactly these two words.
    const POOL = norm('server/team_analysis.py');
    expect(POOL).toContain('"origin": "ladder"}');
    expect(POOL).toContain('"origin": "duel"}');
  });

  it('shows as many as the server sends, which is five', () => {
    expect(SERVER).toMatch(/^COUNTER_SHOW = 5$/m);
  });
});

describe('the PDF', () => {
  it('carries the block with the same words as the screen', () => {
    expect(ADAPTER).toContain("import { counterHeading, counterLabel, counterNote, setCounterNote } from './coachCounters';");
    expect(ADAPTER).toContain('...(sg.counters?.decks.length ? [{');
    expect(ADAPTER).toContain('heading: `${counterHeading(sg.stage)} · ${counterNote(sg.counters)}`');
    expect(ADAPTER).toContain('[counterLabel(d.origin), vs].filter(Boolean)');
  });
});
