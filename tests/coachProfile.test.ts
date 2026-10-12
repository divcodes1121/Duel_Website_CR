import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  profileNote, rowWinCon, skillLabel, useLabel, winConLine, winConTitle, type WinConFigures,
} from '../src/utils/coachProfile';

/* HOW EACH PLAYER PLAYS, ON THE COACH ASSIST SCREEN (2026-10-12).
 *
 * Asked for: rate players by the decks they play — how much, and their win
 * rate across every win condition, inside the 7D / 14D / 30D window — and make
 * the recommendation the player's own. The server sends a profile for both
 * players (`coach._win_con_profile`) and adds each player's skill with the win
 * condition they bring to every figure (`player_skill.py`).
 *
 * The words are tested as code; the screen is a source contract (it cannot be
 * mounted here without the analytics service).
 */
const norm = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SCREEN = norm('src/components/Analytics/CoachAssist.tsx');
const CLIENT = norm('src/state/analyticsClient.ts');
const ADAPTER = norm('src/utils/screenAdapters.ts');
const UTIL = norm('src/utils/coachProfile.ts');
const SERVER = norm('server/coach.py');
const SKILL = norm('server/player_skill.py');

const HOG: WinConFigures = {
  name: 'Hog Rider', games: 60, wins: 36, share: 0.6818, winRate: 60, decks: 2, duelGames: 20,
  use: 'main', skill: { games: 40, wins: 30, expected: 20, perGame: 16.7, tag: 'strong' },
};

describe('the words of a profile', () => {
  it('names how much a win condition is played', () => {
    expect(useLabel('main')).toBe('Main');
    expect(useLabel('regular')).toBe('Regular');
    expect(useLabel('rare')).toBe('Rare');
  });

  it('words the tag as what was measured, and says nothing for "even" or no tag', () => {
    expect(skillLabel('strong')).toBe('Above expected');
    expect(skillLabel('weak')).toBe('Below expected');
    expect(skillLabel('even')).toBeNull();
    expect(skillLabel(null)).toBeNull();
    expect(skillLabel(undefined)).toBeNull();
    // A record under expectation is not a bad win rate: never "Weak".
    expect(skillLabel('weak')).not.toMatch(/weak/i);
  });

  it('prints use rate and win rate', () => {
    expect(winConLine(HOG)).toBe('68% of games · 60.0% won');
    expect(winConLine({ share: 0.004, winRate: 100 })).toBe('0% of games · 100.0% won');
  });

  it('keeps the counts, and the duel record behind the tag, in the tooltip', () => {
    expect(winConTitle(HOG)).toBe('36 won of 60 games · 2 decks · duels: 30 won of 40, 20.0 expected');
    expect(winConTitle({ ...HOG, decks: 1, skill: null })).toBe('36 won of 60 games · 1 deck');
  });

  it('heads a column with the player\'s own totals', () => {
    expect(profileNote({ games: 1288, winRate: 53.42 })).toBe('1,288 games · 53.4% won');
  });

  it('says on a deck row what its win condition is to the coached player', () => {
    expect(rowWinCon({ name: 'Hog Rider', share: 0.6818, winRate: 60, use: 'main', tag: 'strong' }))
      .toBe('your Hog Rider · 60.0% won · 68% of games · above expected');
    expect(rowWinCon({ name: 'Golem', share: 0.2, winRate: 40, use: 'regular', tag: 'weak' }))
      .toBe('your Golem · 40.0% won · 20% of games · below expected');
    expect(rowWinCon({ name: 'Miner', share: 0.05, winRate: 50, use: 'rare', tag: 'even' }))
      .toBe('your Miner · 50.0% won · 5% of games');
    expect(rowWinCon({ name: 'Mortar', new: true })).toBe('Mortar: new for you');
    expect(rowWinCon(null)).toBe('');
    expect(rowWinCon(undefined)).toBe('');
  });

  it('imports nothing', () => {
    expect(UTIL).not.toMatch(/^import /m);
  });
});

describe('the screen', () => {
  const col = SCREEN.slice(SCREEN.indexOf('function ProfileColumn('), SCREEN.indexOf('function CounterPanel('));

  it('draws a column for each player the server sent a profile for, under the counters', () => {
    expect(SCREEN).toContain('{(data.profiles?.mine || data.profiles?.opponent) && (');
    expect(SCREEN).toContain('profile={data.profiles.mine} hue="blue"');
    expect(SCREEN).toContain('profile={data.profiles.opponent} hue="pink"');
    const counters = SCREEN.indexOf('<CounterPanel counters={data.counters} stage={data.stage} />');
    const profiles = SCREEN.indexOf('data-profiles=""');
    const options = SCREEN.indexOf("{data.duelSet ? 'Your set for this duel' : 'Your options, ranked'}");
    expect(counters).toBeGreaterThan(0);
    expect(profiles).toBeGreaterThan(counters);
    expect(options).toBeGreaterThan(profiles);
  });

  it('a row is the card, its name with the two tags, and the two figures', () => {
    expect(col).toContain('<CardArt card={w.card} />');
    expect(col).toContain('{useLabel(w.use)}');
    expect(col).toContain('{skillLabel(w.skill?.tag) && (');
    expect(col).toContain('{winConLine(w)}');
    expect(col).toContain('title={winConTitle(w)}');
    expect(col).toContain('{profileNote(profile)}');
  });

  it('adds no sentence', () => {
    expect(col).not.toMatch(/<p[\s>]/);
  });

  it('says on every option and counter which of the player\'s win conditions it is', () => {
    const row = SCREEN.slice(SCREEN.indexOf('function DeckRow('), SCREEN.indexOf("/** '2026-07-26T"));
    expect(row).toContain('{deck.winCon && (');
    expect(row).toContain('{rowWinCon(deck.winCon)}');
  });

  it('says on the brain line when the skill table moved the figures', () => {
    expect(SCREEN).toContain("model.skill ? 'each player\\'s win-condition skill read' : null,");
  });
});

describe('the contract with the server', () => {
  it('types the profile, the row mark and the brain\'s flag', () => {
    expect(CLIENT).toContain('export interface CoachWinCon {');
    expect(CLIENT).toContain('export interface CoachProfile {');
    expect(CLIENT).toContain('profiles?: { mine: CoachProfile | null; opponent: CoachProfile | null };');
    expect(CLIENT).toMatch(/winCon\?: \{\n\s+card: string; name: string;/);
    expect(CLIENT).toContain('skill?: { brain: string; k: number; weight: number; mine: boolean; theirs: boolean } | null;');
  });

  it('reads the fields the server writes', () => {
    expect(SERVER).toContain('"profiles": profiles,');
    expect(SERVER).toContain('"winCons": rows[:PROFILE_ROWS], "winConsPlayed": len(rows),');
    for (const f of ['"card": fam', '"share": round(share, 4)', '"winRate": round(100.0 * e["wins"] / e["games"], 1)',
      '"decks": e["decks"]', '"duelGames": e["duelGames"]', '"perGame":', '"tag": _ps.tag(rec, k)'])
      expect(SERVER).toContain(f);
    expect(SERVER).toContain('row["winCon"] = {"card": fam, "name": _card_name(fam), "new": True}');
  });

  it('uses the server\'s three words for use and three for the tag', () => {
    expect(SERVER).toMatch(/"main" if share >= PROFILE_MAIN else\n\s+"regular" if share >= PROFILE_REGULAR else "rare"/);
    expect(SKILL).toContain('return "strong" if s >= STRONG else "weak" if s <= WEAK else "even"');
  });
});

describe('the PDF', () => {
  it('carries a block for each player with the same words', () => {
    expect(ADAPTER).toContain("import { profileNote, skillLabel, useLabel, winConLine } from './coachProfile';");
    expect(ADAPTER).toContain('heading: `How ${who} plays · ${profileNote(p)}`');
    expect(ADAPTER).toContain('value: winConLine(w),');
    expect(ADAPTER).toContain('fraction: w.share,');
  });
});
