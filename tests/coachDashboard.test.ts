import { describe, expect, it } from 'vitest';

import {
  DASH,
  cardLabel,
  cardMovers,
  coverage,
  facedBars,
  matchupEmpty,
  strengths,
  weaknesses,
  windowLine,
  type DashArchetype,
  type DashCard,
} from '../src/state/coachDashboard';
import { FLOORS, buildInsights } from '../src/state/coachInsights';

/** One archetype as `coach_intel.opponentArchetypes` ships it. */
const a = (name: string, battles: number, wins: number, draws = 0): DashArchetype => ({
  name,
  battles,
  wins,
  losses: battles - wins - draws,
  draws,
});

describe('coverage ring', () => {
  it('describes the EVIDENCE, and its caption is never a verdict on the player', () => {
    const c = coverage([a('Hog', 40, 20), a('Golem', 4, 1), a('Bait', 30, 15), a('Lava', 2, 0)]);
    expect(c?.rated).toBe(2);
    expect(c?.total).toBe(4);
    for (const w of ['score', 'readiness', 'grade', 'rating', 'rank']) {
      expect(c?.caption.toLowerCase()).not.toContain(w);
    }
  });

  it('an archetype under the floor is counted as unjudged, not dropped', () => {
    const c = coverage([a('Hog', 4, 2), a('Golem', 3, 1)]);
    expect(c?.rated).toBe(0);
    expect(c?.total).toBe(2);
    expect(c?.tone).toBe('bad');
    expect(c?.caption).toContain('nothing below is judged');
  });

  it('the fraction can never exceed one', () => {
    const c = coverage([a('Hog', 40, 20), a('Golem', 40, 20)]);
    expect(c!.rated).toBeLessThanOrEqual(c!.total);
  });

  it('says so plainly when nothing was faced', () => {
    const c = coverage([]);
    expect(c?.total).toBe(0);
    expect(c?.caption).toContain('No archetypes faced');
  });

  it('is null with no payload, rather than a zero ring', () => {
    expect(coverage(null)).toBeNull();
  });
});

describe('matchup cards', () => {
  it('an archetype under the battle floor is never a claim, however bad it looks', () => {
    const faced = [a('Drill', 4, 0)]; // 0% — but four battles
    expect(weaknesses(faced, 60)).toEqual([]);
    expect(matchupEmpty(faced, 60)).toContain('10 battles it needs');
  });

  it('only names a matchup past the gap, and worst first', () => {
    const faced = [a('Golem', 20, 10), a('Drill', 18, 4), a('Near', 30, 17)];
    const out = weaknesses(faced, 60);
    // Drill 22.2% (-37.8), Golem 50% (-10), Near 56.7% (inside the gap)
    expect(out.map((x) => x.id)).toEqual(['Drill', 'Golem']);
    expect(out[0].tone).toBe('bad'); // past severeGap
    expect(out[1].tone).toBe('warn');
  });

  it('carries the figures behind the claim', () => {
    const [w] = weaknesses([a('Drill', 18, 4)], 60.3);
    expect(w.headline).toContain('22.2%');
    expect(w.headline).toContain('60.3%');
    expect(w.evidence).toContain('18 battles');
    expect(w.evidence).toContain('4W 14L');
    expect(w.evidence).toContain('-38.1 points');
  });

  it('counts a draw as neither, and prints it', () => {
    const [w] = weaknesses([a('Drill', 20, 5, 1)], 60);
    expect(w.evidence).toContain('5W 14L 1D');
  });

  it('strengths are the mirror, best first', () => {
    const out = strengths([a('Bait', 20, 15), a('Lava', 16, 14)], 60);
    // Lava 87.5% (+27.5), Bait 75% (+15)
    expect(out.map((x) => x.id)).toEqual(['Lava', 'Bait']);
    expect(out.every((x) => x.tone === 'good')).toBe(true);
  });

  it('says why an empty grid is empty, and the two reasons differ', () => {
    const noEvidence = matchupEmpty([a('Hog', 3, 1)], 60);
    const allClose = matchupEmpty([a('Hog', 40, 24)], 60);
    expect(noEvidence).toContain('battles it needs');
    expect(allClose).toContain('10 points');
    expect(allClose).toContain('60.0%');
    expect(noEvidence).not.toEqual(allClose);
  });

  it('never uses an adjective the numbers cannot carry', () => {
    const text = [...weaknesses([a('Drill', 30, 3)], 60), ...strengths([a('Bait', 30, 27)], 60)]
      .map((x) => `${x.headline} ${x.evidence}`)
      .join(' ')
      .toLowerCase();
    for (const w of ['terrible', 'dominant', 'weak', 'excellent', 'struggles', 'always', 'never']) {
      expect(text).not.toContain(w);
    }
  });
});

describe('charts', () => {
  it('faced bars print a share of the real total', () => {
    expect(facedBars([a('Hog', 25, 10)], 100)[0].display).toBe('25%');
  });

  it('a zero total does not divide by zero', () => {
    expect(facedBars([a('Hog', 3, 1)], 0)[0].display).toBe('3');
  });
});

describe('card movement', () => {
  const c = (over: Partial<DashCard> & { key: string }): DashCard => ({
    battles: 40,
    useRate: 20,
    winRate: 60,
    tiered: true,
    tier: 'medium',
    ...over,
  });

  /* `winDelta` is ABSENT, not zero, when either window had nothing to compare.
     `?? 0` would turn "we cannot say" into "no change". */
  it('drops a card with no delta rather than defaulting it to zero', () => {
    expect(cardMovers([c({ key: 'hog-rider' })], 'up')).toEqual([]);
  });

  it('needs real battles behind it', () => {
    expect(cardMovers([c({ key: 'hog-rider', battles: 3, winDelta: 40 })], 'up')).toEqual([]);
  });

  it('needs the payload to call it rateable', () => {
    expect(cardMovers([c({ key: 'hog-rider', winDelta: 40, tiered: false })], 'up')).toEqual([]);
  });

  it('ignores movement inside the noise floor', () => {
    expect(cardMovers([c({ key: 'hog-rider', winDelta: 2 })], 'up')).toEqual([]);
  });

  it('sorts each direction by size and signs the figure', () => {
    const rows = cardMovers(
      [
        c({ key: 'hog-rider', winDelta: 8, winRate: 62 }),
        c({ key: 'the-log', winDelta: 20, winRate: 70 }),
        c({ key: 'zap', winDelta: -30 }),
      ],
      'up',
    );
    expect(rows.map((r) => r.key)).toEqual(['the-log', 'hog-rider']);
    expect(rows[0].value).toBe('70.0% (+20.0)');
    expect(rows[0].tone).toBe('good');
  });

  it('the falling list is its own direction, not a reversed one', () => {
    const rows = cardMovers([c({ key: 'zap', winDelta: -30 }), c({ key: 'the-log', winDelta: 20 })], 'down');
    expect(rows.map((r) => r.key)).toEqual(['zap']);
    expect(rows[0].tone).toBe('warn');
    expect(rows[0].value).toContain('(-30.0)');
  });

  it('titles a card key readably', () => {
    expect(cardLabel('hog-rider')).toBe('Hog Rider');
    expect(cardLabel('pekka')).toBe('Pekka');
    expect(cardLabel('x-bow')).toBe('X Bow');
  });
});

describe('the window sentence', () => {
  it('states what every figure is counted over', () => {
    expect(windowLine({ from: '2026-08-25', to: '2026-09-23' }, 710, 162)).toBe(
      '710 own-deck 1v1 battles, 2026-08-25 to 2026-09-23. 162 in other modes are not counted.',
    );
  });

  it('drops the hidden clause when there is nothing hidden', () => {
    expect(windowLine({ from: '2026-08-25', to: '2026-09-23' }, 1, 0)).toBe(
      '1 own-deck 1v1 battle, 2026-08-25 to 2026-09-23.',
    );
  });

  it('degrades without a window rather than printing null', () => {
    expect(windowLine({ from: null, to: null }, 5, 0)).toContain('the stored window');
  });
});

/* ONE SCREEN, ONE ANSWER. "What beats them" used to be a bullet in the
   insights list AND is now a matchup card; both read `opponentArchetypes`, so
   the fact would have been printed twice. The rule moved here and its floors
   moved with it — these values are the ones the bullet used. */
describe('what beats them is answered in exactly one place', () => {
  it('keeps the floors the insights rule used before it moved', () => {
    expect(DASH.matchupBattles).toBe(10);
    expect(DASH.matchupGap).toBe(10);
    // The insights module no longer owns them, so it cannot drift from this.
    expect('matchup' in FLOORS).toBe(false);
    expect('matchupGap' in FLOORS).toBe(false);
  });

  it('and the insights list no longer emits a matchup bullet at all', () => {
    const out = buildInsights(
      {
        summary: { battles: 100, wins: 60, losses: 40, draws: 0 },
        form: [],
        archetypes: [],
        opponentArchetypes: [{ name: 'Golem', battles: 40, wins: 4, losses: 36, draws: 0 }],
        opponents: [],
        window: { from: '2026-08-20', to: '2026-09-19' },
      },
      [],
    );
    expect(out).toEqual([]);
  });
});
