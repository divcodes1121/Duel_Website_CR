/**
 * A tab older than the latest deploy.
 *
 * 2026-09-26: every export failed in a tab opened two minutes before a
 * README-only deploy. The build id was compiled into the lazy report engine,
 * so the commit renamed its chunk and the old tab asked for a file Vercel no
 * longer served. These pin the three things that fixed it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELOAD_GUARD_MS, isStaleChunkError, mayReload } from '../src/state/staleBuild';

describe('isStaleChunkError', () => {
  it('recognises a missing lazy file in every browser’s wording', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://deckkies.com/assets/engine-CchoGdN4.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://deckkies.com/assets/x.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/TeamAnalysis-abc.css'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".'))).toBe(true);
  });

  it('does not mistake a real export error for a stale page', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'cards')"))).toBe(false);
    expect(isStaleChunkError(new Error('No section of the player report could be read'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('mayReload', () => {
  it('reloads the first time', () => {
    expect(mayReload(null, 1_000_000)).toBe(true);
  });

  it('never reloads twice inside the guard, so a missing file cannot loop the page', () => {
    expect(mayReload(1_000_000, 1_000_000 + RELOAD_GUARD_MS - 1)).toBe(false);
    expect(mayReload(1_000_000, 1_000_000 + RELOAD_GUARD_MS + 1)).toBe(true);
  });
});

describe('no per-commit value is compiled into the JavaScript', () => {
  /* A value that changes on every commit changes the content hash of every
     chunk that contains it, so a commit that touches no code still renames
     files and strands every open tab. The build id is written into
     index.html by vite.config.ts instead. */
  const root = path.resolve(__dirname, '../src');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  walk(root);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no __BUILD_ID__ or commit sha read anywhere in src/', () => {
    const hits = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /__BUILD_ID__|VERCEL_GIT_COMMIT_SHA|import\.meta\.env\.VITE_(COMMIT|BUILD|SHA)/.test(src);
    });
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('reads the build id from the page at export time instead', () => {
    const engine = fs.readFileSync(path.join(root, 'utils/report/engine.ts'), 'utf8');
    expect(engine).toMatch(/meta\[name="deckkies-build"\]/);
    const cfg = fs.readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/deckkies-build/);
    expect(cfg).not.toMatch(/define:\s*\{\s*__BUILD_ID__/);
  });
});
