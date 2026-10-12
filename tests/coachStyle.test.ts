import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PACKAGE_MIN_SHARE, packageLine, sharedLine, styleLine } from '../src/state/coachStyle';

/**
 * THE COACH'S FAMILIES BOARD IS BUILT THE PLAYER'S WAY (2026-10-12).
 *
 * Reported: "everyone should not have the same, as everyone's playstyle is
 * different". Measured on seven roster players: the lead list of a win
 * condition was the same deck for all seven in 11 of 17. The server now picks
 * a win condition's rows by how the player builds (`server/coach_style.py`);
 * these are the two lines the screen prints about it — figures a reader can
 * check on the card strip, never the server's ordering score.
 */
const fit = (over: Partial<Parameters<typeof styleLine>[0]['style'] & object> = {}) => ({
  spells: [2, 2] as [number, number],
  support: [3, 4] as [number, number],
  building: 'yours' as const,
  ...over,
});

describe('a row: how it is built against how they build', () => {
  it('prints the counts and the building', () => {
    expect(styleLine({ style: fit() })).toBe('spells 2/2 · support 3/4 · same building');
  });

  it('says no building for a player who runs none', () => {
    expect(styleLine({ style: fit({ building: 'none' }) })).toBe('spells 2/2 · support 3/4 · no building');
  });

  it('does not mention a building they do not run', () => {
    const line = styleLine({ style: fit({ building: 'other' }) });
    expect(line).toBe('spells 2/2 · support 3/4');
    expect(line).not.toMatch(/building/);
  });

  it('leaves out a part the list does not have', () => {
    expect(styleLine({ style: fit({ spells: [0, 0], building: 'other' }) })).toBe('support 3/4');
  });

  it('a zero is printed, not hidden — 0 of 2 is the honest figure', () => {
    expect(styleLine({ style: fit({ spells: [0, 2], support: [0, 4], building: 'other' }) }))
      .toBe('spells 0/2 · support 0/4');
  });

  it('leads with the deck it is close to when there is one', () => {
    const line = styleLine({
      style: fit(),
      affinity: { shared: 7, of: 8, known: 8, familiar: true, knowsCards: true, deckBattles: 41 },
    });
    expect(line).toBe('7/8 of one deck · spells 2/2 · support 3/4 · same building');
  });

  it('never prints the ordering score', () => {
    const row = { style: { ...fit(), score: 0.4321, package: 0.49 } };
    expect(styleLine(row)).not.toMatch(/0\.43|4321|49/);
  });

  it('an older server with no style read keeps the old line', () => {
    const row = { affinity: { shared: 3, of: 8, known: 6, familiar: false, knowsCards: true } };
    expect(styleLine(row)).toBe('6/8 your cards');
    expect(styleLine(row)).toBe(sharedLine(row));
    expect(styleLine({})).toBeNull();
  });
});

describe('the board: their spell packages in one line', () => {
  const style = {
    elixir: 3.21,
    noBuilding: 0.15,
    packages: [
      { names: ['Barbarian Barrel', 'Poison'], share: 0.49 },
      { names: ['Barbarian Barrel', 'Fireball'], share: 0.21 },
      { names: ['Zap'], share: 0.06 },
    ],
  };

  it('packages most used first, then cost and building', () => {
    expect(packageLine(style, false)).toBe(
      'Their spells · Barbarian Barrel + Poison 49% · Barbarian Barrel + Fireball 21% · Zap 6% · 3.2 elixir · building in 85%',
    );
  });

  it('speaks to the player on their own page', () => {
    expect(packageLine(style, true)).toMatch(/^Your spells · /);
  });

  it('a package under the floor is an experiment, not a habit', () => {
    const line = packageLine({ ...style, packages: [...style.packages, { names: ['Rocket'], share: 0.02 }] }, false);
    expect(line).not.toMatch(/Rocket/);
    expect(PACKAGE_MIN_SHARE).toBe(0.05);
  });

  it('a deck with no spell is named, not printed as an empty string', () => {
    expect(packageLine({ ...style, packages: [{ names: [], share: 0.4 }] }, false)).toMatch(/no spell 40%/);
  });

  it('no profile, or nothing above the floor, is no line', () => {
    expect(packageLine(null, false)).toBeNull();
    expect(packageLine(undefined, false)).toBeNull();
    expect(packageLine({ ...style, packages: [{ names: ['Zap'], share: 0.01 }] }, false)).toBeNull();
  });
});

/**
 * SOURCE CONTRACTS — the suite runs in node with no DOM, so what the screen
 * and the server agree on is read off the files.
 */
describe('the screen and the server', () => {
  const norm = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const screen = norm('src/components/Admin/CoachRoster/FieldAnswers.tsx');
  const tab = norm('src/components/Admin/CoachRoster/TodayTab.tsx');
  const server = norm('server/coach_style.py');
  const daily = norm('server/coach_daily.py');

  it('the families rows print the style line', () => {
    expect(screen).toMatch(/note=\{styleLine\(p\)\}/);
    expect(screen).toMatch(/packageLine\(plan\.style, self\)/);
  });

  it("what was passed over is said: the win condition's own best", () => {
    expect(screen).toMatch(/field best \$\{g\.fieldBest\.toFixed\(1\)\}%/);
  });

  it('the Best expected tile is the strongest answer in the pool, not the first chip', () => {
    expect(tab).toMatch(/bestFamily\.fieldBest \?\? bestFamily\.best/);
    expect(tab).not.toMatch(/plan\.families\[0\]\.best/);
  });

  it('the building words match the values the server sends', () => {
    for (const v of ['"yours"', '"none"', '"other"']) expect(server).toContain(v);
  });

  it('a list must still beat the field to be chosen for fitting', () => {
    const floor = Number(/^STYLE_FLOOR = ([\d.]+)/m.exec(server)?.[1]);
    const band = Number(/^STYLE_BAND = ([\d.]+)/m.exec(server)?.[1]);
    expect(floor).toBeGreaterThan(50);
    expect(band).toBeGreaterThan(0);
    expect(band).toBeLessThanOrEqual(12);
  });

  it('the board reads every vetted ladder list, and not in brief', () => {
    expect(daily).toMatch(/ta\._field_candidates\(\)/);
    expect(daily).toMatch(/if not brief:\s+try:\s+wide = ta\._field_candidates\(\)/);
  });
});
