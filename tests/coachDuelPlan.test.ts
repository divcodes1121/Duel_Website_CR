import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { duelResults, scoreLabel } from '../src/utils/duelResults';

/* PICK FOR THE DUEL, NOT THE GAME, ON THE COACH ASSIST SCREEN (2026-10-07).
 *
 * The server's look-ahead (`server/duel_plan.py`) needs to know who won each
 * finished game: it sets the score the plan starts from and moves the chance of
 * the next game. The screen asks ONE question for it and derives the rest,
 * then shows the duel's figure and the deck to bring next either way.
 *
 * `duelResults` is tested as code. The screen is a source contract, the
 * pattern `coachTunerGate.test.ts` uses: it cannot be mounted here without
 * the analytics service.
 */
const norm = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SCREEN = norm('src/components/Analytics/CoachAssist.tsx');
const CLIENT = norm('src/state/analyticsClient.ts');
const UTIL = norm('src/utils/duelResults.ts');

describe('who won each finished game', () => {
  it('is nothing before a game is finished, or when it was not told', () => {
    expect(duelResults('w', 0)).toBe('');
    expect(duelResults(null, 1)).toBe('');
    expect(duelResults(null, 2)).toBe('');
  });

  it('is game 1 as answered', () => {
    expect(duelResults('w', 1)).toBe('w');
    expect(duelResults('l', 1)).toBe('l');
  });

  it('gives game 2 the other result: a duel still being played is 1-1', () => {
    expect(duelResults('w', 2)).toBe('wl');
    expect(duelResults('l', 2)).toBe('lw');
  });

  it('never produces a decided duel', () => {
    for (const r of ['w', 'l'] as const)
      for (const n of [0, 1, 2]) expect(['', 'w', 'l', 'wl', 'lw']).toContain(duelResults(r, n));
  });

  it('writes a score with an en dash, and nothing when it is not known', () => {
    expect(scoreLabel([1, 0])).toBe('1–0');
    expect(scoreLabel([0, 1])).toBe('0–1');
    expect(scoreLabel(null)).toBe('');
    expect(scoreLabel(undefined)).toBe('');
  });

  it('imports nothing', () => {
    expect(UTIL).not.toMatch(/^import /m);
  });
});

describe('the question', () => {
  it('is asked once, about game 1, between its decks and whatever comes next', () => {
    expect(SCREEN.match(/question="Who won game 1\?"/g)?.length).toBe(1);
    expect(SCREEN).not.toMatch(/Who won game 2/);
    // Their game-1 deck leads to the question; their game-2 deck leads to the answer.
    expect(SCREEN).toMatch(/if \(game === 1\) return setStep\(\{ kind: 'won' \}\);\n\s+return run\(myPlayed, theirs, duelResults\(won1, 2\)\);/);
  });

  it('goes on to game 2 when two games were played, and answers when one was', () => {
    expect(SCREEN).toMatch(/setWon1\(r\);\n\s+if \(games >= 2\) return setStep\(\{ kind: 'paste', side: 'mine', game: 2 \}\);\n\s+return run\(myPlayed, oppPlayed, duelResults\(r, 1\)\);/);
  });

  it('is two plain answers from the coached player\'s side', () => {
    expect(SCREEN).toMatch(/onClick=\{\(\) => answer\('w'\)\}>\s+You won it/);
    expect(SCREEN).toMatch(/onClick=\{\(\) => answer\('l'\)\}>\s+They won it/);
  });

  it('can be backed out of, and backing out of game 2 returns to it', () => {
    expect(SCREEN).toMatch(/question="Who won game 1\?"\n\s+onBack=\{\(\) => setStep\(\{ kind: 'paste', side: 'theirs', game: 1 \}\)\}/);
    expect(SCREEN).toMatch(/if \(game === 2\) return setStep\(\{ kind: 'won' \}\);/);
  });

  it('is forgotten when the interview starts over, and when nothing has been played', () => {
    expect(SCREEN).toMatch(/setOppPlayed\(\[\]\);\n\s+setWon1\(null\);/);
    expect(SCREEN).toMatch(/setGames\(0\);\n\s+setWon1\(null\);\n\s+run\(\[\], \[\], ''\);/);
  });
});

describe('the request', () => {
  it('carries the results on every run, including the refresh on days or kind', () => {
    expect(SCREEN).toMatch(/\{ days \}, tunerAllowed, kind, results\)/);
    expect(SCREEN).toMatch(/if \(answered\) run\(myPlayed, oppPlayed, duelResults\(won1, myPlayed\.length\)\);/);
    // No call to `run` without a third argument is left behind.
    expect(SCREEN).not.toMatch(/\brun\(\s*[^,()]+,\s*[^,()]+\s*\)/);
  });

  it('sends `res` only when there is one', () => {
    expect(CLIENT).toMatch(/if \(results\) q\.set\('res', results\);/);
    expect(CLIENT).toMatch(/kind\?: DuelKind, results\?: string,\n\): Promise<CoachSuggestion>/);
  });
});

describe('the answer', () => {
  it('leads with the chance of winning the duel when the look-ahead ran', () => {
    expect(SCREEN).toMatch(/\{best\.plan \? \(/);
    expect(SCREEN).toMatch(/data-duel-figure>\n\s+\{best\.plan\.duel\.toFixed\(1\)\}%/);
    expect(SCREEN).toMatch(/to win the duel · this game \{best\.plan\.game\.toFixed\(1\)\}%/);
    // Without a plan the brain's figure stands exactly as before.
    expect(SCREEN).toMatch(/\) : best\.brain \? \(/);
  });

  it('shows what to bring next under the pick, one strip when both branches agree', () => {
    expect(SCREEN).toMatch(/\{best\.plan && <ThenRow then=\{best\.plan\.then\} \/>\}/);
    expect(SCREEN).toMatch(/if \(!won && !lost\) return null;/);
    expect(SCREEN).toMatch(/\[\{ label: 'Next game', branch: 'both', deck: won \}\]/);
    expect(SCREEN).toMatch(/label: 'If you win', branch: 'won'/);
    expect(SCREEN).toMatch(/label: 'If you lose', branch: 'lost'/);
    expect(SCREEN).toMatch(/className=\{styles\.thenRow\} data-then/);
  });

  it('puts the duel figure in each ranked row, this game in its tooltip', () => {
    expect(SCREEN).toMatch(/\{deck\.plan \? \(/);
    expect(SCREEN).toMatch(/\{deck\.plan\.duel\.toFixed\(1\)\}%/);
    expect(SCREEN).toMatch(/`this game \$\{deck\.plan\.game\.toFixed\(1\)\}%`/);
    expect(SCREEN).toMatch(/<span className=\{styles\.figureLabel\}>win the duel<\/span>/);
  });

  it('prints the score only when it was told and a game has been played', () => {
    expect(SCREEN).toMatch(/data\.duelPlan\?\.score && data\.stage > 0 && \(/);
    expect(SCREEN).toMatch(/\{scoreLabel\(data\.duelPlan\.score\)\}/);
  });

  it('adds no sentence of explanation to the block', () => {
    const then = SCREEN.slice(SCREEN.indexOf('function ThenRow('), SCREEN.indexOf('function Suggestion('));
    expect(then).not.toMatch(/<p[\s>]/);
    expect(then).not.toMatch(/blockNote/);
  });
});

describe('the types', () => {
  it('describe the plan row, the summary and where they ride', () => {
    expect(CLIENT).toMatch(/export interface CoachPlanRow \{/);
    expect(CLIENT).toMatch(/then: \{ won: CoachPlanDeck \| null; lost: CoachPlanDeck \| null \};/);
    expect(CLIENT).toMatch(/plan\?: CoachPlanRow;/);
    expect(CLIENT).toMatch(/duelPlan\?: CoachDuelPlan \| null;/);
    expect(CLIENT).toMatch(/score: \[number, number\] \| null;/);
  });
});
