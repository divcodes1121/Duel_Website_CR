import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AnswerCache,
  asTag,
  countLabel,
  isTagIntent,
  minChars,
  queryOf,
  searchHash,
  seenLabel,
  splitMatch,
} from '../src/utils/nameSearch';
import { isUnknownRoute } from '../src/utils/routes';

describe('a tag or a name', () => {
  it('reads a tag in any case, with or without #', () => {
    expect(asTag('#yypcuuy0')).toBe('#YYPCUUY0');
    expect(asTag(' YYPCUUY0 ')).toBe('#YYPCUUY0');
    expect(asTag('sub')).toBeNull(); // S and B are not tag characters
    expect(asTag('')).toBeNull();
  });

  it('opens a tag only when the text says it is one', () => {
    expect(isTagIntent('#PLUGGY')).toBe(true);
    expect(isTagIntent('YYPCUUY0')).toBe(true); // has a digit
    expect(isTagIntent('PLUGGY')).toBe(false); // a name spelled in tag letters
    expect(isTagIntent('Sub')).toBe(false);
  });

  it('routes Enter to the player or to the results page', () => {
    expect(searchHash('#yypcuuy0')).toBe('#/player/%23YYPCUUY0');
    expect(searchHash('CAL Sub')).toBe('#/search?q=CAL%20Sub');
    expect(searchHash('ムギ')).toBe(`#/search?q=${encodeURIComponent('ムギ')}`);
    expect(searchHash('   ')).toBeNull();
  });

  it('reads the query back off the hash', () => {
    expect(queryOf('#/search?q=CAL%20Sub')).toBe('CAL Sub');
    expect(queryOf('#/search')).toBe('');
    expect(queryOf(searchHash('a&b=c')!)).toBe('a&b=c');
  });
});

describe('the dropdown', () => {
  it('waits for two Latin letters, one CJK character', () => {
    expect(minChars('a')).toBe(2);
    expect(minChars('ム')).toBe(1);
    expect(minChars('傳')).toBe(1);
    expect(minChars('é')).toBe(2);
  });

  it('marks the match whatever its case', () => {
    expect(splitMatch('CAL Sub Kun', 'sub')).toEqual(['CAL ', 'Sub', ' Kun']);
    expect(splitMatch('Kun', 'sub')).toEqual(['Kun', '', '']);
  });

  it('labels counts and days', () => {
    expect(countLabel(2655, false)).toBe('2,655');
    expect(countLabel(100000, true)).toBe('100,000+');
    expect(seenLabel('2026-10-12', new Date('2026-10-19T00:00:00Z'))).toBe('12 Oct');
    expect(seenLabel('2025-12-01', new Date('2026-10-19T00:00:00Z'))).toBe('1 Dec 2025');
    expect(seenLabel(null)).toBe('');
  });

  it('caches answers and forgets the oldest', () => {
    const c = new AnswerCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });
});

describe('the results page is a page', () => {
  it('is a known route and App resolves it', () => {
    expect(isUnknownRoute('#/search?q=sub')).toBe(false);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/startsWith\('#\/search'\)\) return 'search'/);
  });

  it('every search field goes through searchHash', () => {
    const dash = readFileSync('src/components/Dashboard/Dashboard.tsx', 'utf8');
    expect(dash.match(/searchHash\(/g)?.length).toBe(3);
    expect(dash).not.toMatch(/go\(`#\/player\/\$\{encodeURIComponent\((tag|topTag|t)\.trim\(\)\)/);
  });
});
