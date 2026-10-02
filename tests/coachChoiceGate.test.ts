import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPaid, sectionAllowed, type Access } from '../src/state/tiers';

/**
 * "BUILD AROUND YOUR CARDS" IS PRO, NOT MEMBERS (released 2026-10-02, asked
 * for: "make it available for pro also as it's shipped").
 *
 * It was admin-only for its first day ("initially do it admin only, then I
 * will see, then we release"). It is gated on `isPaid` now — paid Pro or
 * admin, never a trial — the same line the tuner and Coach Assist itself sit
 * behind.
 *
 * A source contract, like `coachTunerGate.test.ts`: this suite runs in `node`
 * with no DOM. What is pinned is who the block reaches, and that the request
 * is gated with the render. Moving the gate is a deliberate edit to this file.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf-8');
const SRC = read('../src/components/Analytics/CoachAssist.tsx');
const CLIENT = read('../src/state/analyticsClient.ts');
const RULES = read('../server/coach_choice.py');
const ALL: Access[] = ['anon', 'free', 'trial', 'pro', 'admin'];

describe('Coach Assist: build around your cards', () => {
  it('is gated on isPaid, read from useAccess (never the raw store, never admin alone)', () => {
    expect(SRC).toMatch(/const choiceAllowed = isPaid\(useAccess\(\)\);/);
    expect(SRC).not.toMatch(/choiceAllowed = [^;]*'admin'/);
    // The raw store says 'free' for a signed-out visitor; only a comment may
    // name it here.
    expect(SRC).not.toMatch(/^import .*useAccountStore/m);
  });

  it('opens for Pro and admin and never for a Member (trial), free or anonymous reader', () => {
    expect(ALL.filter((a) => isPaid(a))).toEqual(['pro', 'admin']);
  });

  it('reaches exactly the readers who can open Coach Assist', () => {
    for (const a of ALL) expect(isPaid(a), a).toBe(sectionAllowed(a, 'Coach Assist'));
  });

  it('renders only behind the gate', () => {
    const mounts = SRC.match(/<ChoicePanel\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(SRC).toMatch(/\{choiceAllowed && \(\s*<ChoicePanel\b/);
  });

  it('gates the REQUEST with the render: the panel is the only caller', () => {
    const calls = SRC.match(/fetchCoachChosen\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const panel = SRC.slice(SRC.indexOf('function ChoicePanel('), SRC.indexOf('window 2: Suggestion'));
    expect(panel).toContain('fetchCoachChosen(');
  });

  it('asks nothing until the reader presses the button', () => {
    expect(SRC).toMatch(/if \(asked && want\.length\) run\(want\);/);
  });

  it('keeps the named cards in the parent, so a reload mid-duel does not lose them', () => {
    expect(SRC).toMatch(/const \[choiceWant, setChoiceWant\] = useState<string\[\]>\(\[\]\);/);
    expect(SRC).toMatch(/setChoiceWant\(\[\]\);\s+setChoiceAsked\(false\);/);
  });

  it('caps the named cards at the server\'s own figure', () => {
    const client = Number(/export const COACH_CHOICE_MAX = (\d+);/.exec(CLIENT)?.[1]);
    const server = Number(/^MAX_WANT = (\d+)$/m.exec(RULES)?.[1]);
    expect(client).toBe(4);
    expect(client).toBe(server);
  });

  /* "TOO MANY TEXTS IN THAT FILTER — REMOVE, JUST TELL WHAT TO DO" (asked
     for 2026-10-02, with the screen pasted back). The block printed where
     each deck came from, the lists and games behind it, the shell a build
     rested on and the slots the opponent changed. All of it is still in the
     payload; none of it may come back onto the screen. */
  const BLOCK = SRC.slice(SRC.indexOf('function choiceMeta('), SRC.indexOf('window 2: Suggestion'));

  it('carries no explanatory prose: one step line, three section names, figures', () => {
    for (const gone of [
      'duel lists play it this way', 'chosen against this opponent', 'real deck pairs',
      'most duel-proven first', 'thin evidence', 'cards you play', 'every deck holds all of them',
      'the picks most of its pilots make', 'fielded as listed', 'ladder games', 'Duel proven',
      "Deckkies' build", 'combined brain', 'held them', 'hold it',
    ]) {
      expect(BLOCK, gone).not.toContain(gone);
    }
    expect(BLOCK).not.toMatch(/deck\.architect|duelChip\(|styles\.fillTag|styles\.duelTag/);
  });

  it('names its three sections plainly, with no note beside them', () => {
    expect(BLOCK).toMatch(/\['Duel decks', duel, 0\]/);
    expect(BLOCK).toMatch(/\['Your decks and meta', own, duel\.length\]/);
    expect(BLOCK).toMatch(/\['Built by Deckkies', built, duel\.length \+ own\.length\]/);
    expect(BLOCK).toMatch(/<h4 className=\{styles\.blockTitle\}>\{title\}<\/h4>/);
    expect(BLOCK).toMatch(/<h4 className=\{styles\.blockTitle\}>Build around your cards<\/h4>/);
  });

  it('says what to do NOW in one line that follows the state', () => {
    expect(BLOCK).toMatch(/step = `Pick the cards you want in the deck \(up to \$\{COACH_CHOICE_MAX\}\)\.`/);
    expect(BLOCK).toMatch(/step = 'Press Find decks\.'/);
    expect(BLOCK).toMatch(/was already played this duel\. Pick other cards\./);
    expect(BLOCK).toMatch(/No deck has \$\{named\} together\. Pick fewer or other cards\./);
    expect(BLOCK).toMatch(/% = your win chance vs this opponent\. Green \+ = a swap that raises it\./);
    // One step paragraph; nothing else in the block is a sentence.
    expect((BLOCK.match(/data-choice-step/g) ?? [])).toHaveLength(1);
    expect((BLOCK.match(/styles\.askHint/g) ?? [])).toHaveLength(1);
  });

  it('keeps what a reader acts on: the win chance, each matchup, and the swap', () => {
    expect(BLOCK).toMatch(/deck\.win\.toFixed\(1\)\}%/);
    expect(BLOCK).toMatch(/<VsChips vs=\{choiceVs\(deck\.vs\)\}/);
    expect(BLOCK).toMatch(/<Delta n=\{im\.gain\} \/>/);
    expect(BLOCK).toMatch(/\{im\.win\.toFixed\(1\)\}%/);
    expect(BLOCK).toMatch(/<DeckActions cards=\{im\.cards\}/);
  });

  it('rides on the suggest route as a parameter, not a route of its own', () => {
    const fn = CLIENT.slice(CLIENT.indexOf('export function fetchCoachChosen('));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/\/api\/analytics\/coach\/suggest\?/);
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/q\.set\('want', want\.join\(','\)\)/);
  });
});
