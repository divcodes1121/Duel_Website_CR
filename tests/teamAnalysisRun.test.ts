import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A SOURCE CONTRACT, because this suite runs in `node` with no DOM.
 *
 * Team Analysis's `run` sends the day window with the request. It is a
 * `useCallback`, so every value it reads has to be in its dependency list or
 * the memoised function keeps the value from whenever it was last rebuilt.
 * `days` was missing: choosing a new window without touching either roster and
 * pressing Analyse sent the OLD window. The linter had flagged it as one warning
 * among eighteen. This pins it.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/components/Analytics/TeamAnalysis/TeamAnalysis.tsx', import.meta.url)),
  'utf-8',
);

function depsOf(name: string): string[] {
  const start = SOURCE.indexOf(`const ${name} = useCallback(`);
  if (start < 0) throw new Error(`no useCallback named ${name}`);
  // The dependency list is the first `}, [ ... ]);` after the callback opens.
  const tail = SOURCE.slice(start);
  const m = /\n\s*\}, \[([^\]]*)\]\);/.exec(tail);
  if (!m) throw new Error(`no dependency list for ${name}`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

describe('Team Analysis sends the window the reader picked', () => {
  it('reads the day window inside `run`', () => {
    const start = SOURCE.indexOf('const run = useCallback(');
    const end = SOURCE.indexOf('}, [', start);
    expect(SOURCE.slice(start, end)).toMatch(/\bdays\b/);
  });

  it('lists `days` among `run`’s dependencies, so a new window is a new request', () => {
    expect(depsOf('run')).toContain('days');
  });
});
