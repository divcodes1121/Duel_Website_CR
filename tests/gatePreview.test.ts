import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GATE_PREVIEW } from '../src/components/Auth/gatePreview';
import { FREE_SECTIONS } from '../src/state/tiers';

describe('gate previews', () => {
  it('every preview has both theme files on disk', () => {
    for (const slug of Object.values(GATE_PREVIEW)) {
      for (const theme of ['dark', 'light']) {
        expect(existsSync(`public/assets/gate/${slug}-${theme}.webp`), `${slug}-${theme}`).toBe(true);
      }
    }
  });

  it('the build script makes exactly the previews the gate asks for', () => {
    const py = readFileSync('scripts/build-gate-art.py', 'utf8');
    const m = /^SLUGS = \[([^\]]*)\]/m.exec(py);
    expect(m).not.toBeNull();
    const slugs = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(new Set(slugs)).toEqual(new Set(Object.values(GATE_PREVIEW)));
  });

  it('no free section carries a preview it would never show', () => {
    for (const section of FREE_SECTIONS) {
      expect(GATE_PREVIEW[section], section).toBeUndefined();
    }
  });

  it('the sharp masters are not in the repository', () => {
    // They show real players; only the blurred output is committed.
    const ignored = readFileSync('scripts/build-gate-art.py', 'utf8');
    expect(ignored).toContain('THE MASTERS ARE NOT IN THE REPOSITORY');
    expect(existsSync('assets/gate')).toBe(false);
  });
});
