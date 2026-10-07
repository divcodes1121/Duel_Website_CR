import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/* THE DUEL READ ON THE COACH ASSIST SCREEN (2026-10-07).
 *
 * The server's read (`server/duel_read.py`) answers with decks, the chance of a
 * deck not seen in the window, and what is spent and left by role. These are
 * source contracts on the client half: the kind of duel reaches the request,
 * the block prints figures and card art and nothing else, and an opponent
 * deck's likelihood is the read's own figure, not its share of the list.
 *
 * Source contracts, the pattern `coachTunerGate.test.ts` uses: the screen
 * cannot be mounted here without the analytics service.
 */
const norm = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SCREEN = norm('src/components/Analytics/CoachAssist.tsx');
const CLIENT = norm('src/state/analyticsClient.ts');
const ADAPTERS = norm('src/utils/screenAdapters.ts');

describe('the kind of duel', () => {
  it('is sent by both windows, and only when chosen', () => {
    expect(SCREEN).toMatch(/fetchCoachPrediction\(tag, decks, \{ days \}, kind\)/);
    expect(SCREEN).toMatch(/\{ days \}, tunerAllowed, kind\)/);
    expect(CLIENT.match(/if \(kind\) q\.set\('kind', kind\);/g)?.length).toBe(2);
  });

  it('refreshes the answer without restarting the interview', () => {
    // Both windows re-run on a change of `kind` exactly as they do for `days`.
    expect(SCREEN.match(/\}, \[days, kind\]\);/g)?.length).toBe(2);
    // `kind` is NOT in either window's key, or choosing it would remount them.
    expect(SCREEN).toMatch(/<DuelPrediction key=\{`p-\$\{tag\}`\}/);
    expect(SCREEN).toMatch(/<Suggestion key=\{`s-\$\{tag\}`\}/);
  });

  it('offers exactly the two kinds the server knows, and can be cleared', () => {
    expect(SCREEN).toMatch(/\{ id: 'war', label: 'Clan war' \}/);
    expect(SCREEN).toMatch(/\{ id: 'friendly', label: 'Friendly' \}/);
    expect(SCREEN).toMatch(/setKind\(kind === k\.id \? null : k\.id\)/);
    expect(CLIENT).toMatch(/export type DuelKind = 'friendly' \| 'war' \| null;/);
  });
});

describe('what they have left', () => {
  const start = SCREEN.indexOf('function LeftPanel(');
  const panel = SCREEN.slice(start, SCREEN.indexOf('\nfunction ', start + 1));

  it('is drawn in both windows, from the read', () => {
    expect(start).toBeGreaterThan(0);
    expect(SCREEN).toMatch(/\{data\.left && <LeftPanel left=\{data\.left\}/);
    expect(SCREEN).toMatch(/\{data\.opponent\.left && \(\s*<LeftPanel left=\{data\.opponent\.left\}/);
  });

  it('files the four roles, in the order a coach plays around them', () => {
    const ids = [...SCREEN.matchAll(/\{ id: '(wincon|spell|building|support)', label: '([^']+)' \}/g)].map((m) => m[1]);
    expect(ids).toEqual(['wincon', 'spell', 'building', 'support']);
  });

  it('prints figures and card art, not an explanation', () => {
    // The only words: the title, the role labels, "new deck" and "spent".
    expect(panel).toMatch(/>new deck \{pct\(newDeck\)\}</);
    expect(panel).toMatch(/<span className=\{styles\.oddsValue\}>spent<\/span>/);
    expect(panel).toMatch(/<span className=\{styles\.oddsValue\}>\{pct\(c\.prob\)\}<\/span>/);
    // No sentence: not a paragraph, and none of the words an explanation needs.
    expect(panel).not.toMatch(/<p[\s>]/);
    expect(panel.slice(panel.indexOf('return ('))).not.toMatch(/because|probability|weighted|based on|we think/i);
  });

  it('replaces the old cards table instead of sitting beside it', () => {
    expect(SCREEN).toMatch(/\{!!data\.cards\?\.length && !data\.left && \(/);
  });

  it('greys spent ART, never the type', () => {
    const css = norm('src/components/Analytics/CoachAssist.module.css');
    const rule = css.slice(css.indexOf('.leftSpent img'), css.indexOf('}', css.indexOf('.leftSpent img')));
    expect(rule).toMatch(/filter: grayscale\(1\)/);
    expect(css.slice(css.indexOf('.leftRows'))).not.toMatch(/opacity/);
  });
});

describe('how likely an opponent deck is', () => {
  it("is the read's own figure when there is one", () => {
    expect(SCREEN).toMatch(/\{pct\(deck\.p \?\? deck\.prob\)\}/);
    expect(ADAPTERS).toMatch(/const likely = d\.p \?\? d\.prob;/);
  });
});
