import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KNOWN_ROUTES, isUnknownRoute, missingPath } from '../src/utils/routes';

describe('isUnknownRoute', () => {
  it('the landing screen is a page', () => {
    for (const h of ['', '#', '#/', '#/?x=1']) expect(isUnknownRoute(h)).toBe(false);
  });

  it('every real route is a page, with or without more path', () => {
    for (const h of [
      '#/builder', '#/decks', '#/palette', '#/teams', '#/duo', '#/all-duels',
      '#/player/%23YYPCUUY0/duels', '#/guide', '#/my/practise', '#/admin/lifecycle',
      '#/admin/coach/%23ABC/overview', '#/signin', '#/reset', '#/teams?x=1',
    ]) expect(isUnknownRoute(h), h).toBe(false);
  });

  it('a mistyped route is a 404', () => {
    for (const h of ['#/buidler', '#/decksxyz', '#/lost?from=/x', '#/404', '#/pro', '#/x'])
      expect(isUnknownRoute(h), h).toBe(true);
  });

  it('Supabase auth redirects are NEVER a 404', () => {
    for (const h of [
      '#access_token=abc&type=recovery',
      '#error=access_denied&error_code=otp_expired',
    ]) expect(isUnknownRoute(h)).toBe(false);
  });

  it('every route App.tsx routes on is in the list', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const used = new Set(
      [...app.matchAll(/startsWith\('(#\/[a-z-]+)/g)].map((m) => m[1].replace(/\/$/, '')),
    );
    for (const r of used) {
      if (r === '#/admin/coach') continue; // covered by '#/admin'
      expect(KNOWN_ROUTES as readonly string[], r).toContain(r);
    }
  });
});

describe('missingPath', () => {
  it('prefers the real path the static 404 forwarded', () => {
    expect(missingPath('#/lost?from=%2Fsome%2Fpage')).toBe('/some/page');
  });
  it('otherwise names the hash route', () => {
    expect(missingPath('#/buidler')).toBe('/buidler');
  });
});
