import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * "BUILD AROUND YOUR CARDS" IS ADMIN-ONLY FOR NOW (2026-10-02, asked for:
 * "initially do it admin only, then I will see, then we release for all").
 *
 * A source contract, like `coachTunerGate.test.ts`: this suite runs in `node`
 * with no DOM. What is pinned is that the block cannot reach a reader the
 * account holder has not released it to, and that the request is gated with
 * the render. Releasing it is a deliberate edit to this file.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf-8');
const SRC = read('../src/components/Analytics/CoachAssist.tsx');
const CLIENT = read('../src/state/analyticsClient.ts');
const RULES = read('../server/coach_choice.py');

describe('Coach Assist: build around your cards', () => {
  it('is admin-only, read from useAccess (never the raw store)', () => {
    expect(SRC).toMatch(/const access = useAccess\(\);\s+const choiceAllowed = access === 'admin';/);
    // The raw store says 'free' for a signed-out visitor; only a comment may
    // name it here.
    expect(SRC).not.toMatch(/^import .*useAccountStore/m);
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

  it('rides on the suggest route as a parameter, not a route of its own', () => {
    const fn = CLIENT.slice(CLIENT.indexOf('export function fetchCoachChosen('));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/\/api\/analytics\/coach\/suggest\?/);
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/q\.set\('want', want\.join\(','\)\)/);
  });
});
