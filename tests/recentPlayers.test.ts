import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { RECENT_MAX, parseRecent, pushRecent, type RecentPlayer } from '../src/state/recentPlayers';

const p = (tag: string, name: string | null = null, at = 1): RecentPlayer => ({ tag, name, at });

describe('pushRecent', () => {
  it('puts the newest first and normalises the tag', () => {
    const list = pushRecent([p('#2QLPGR8V')], p(' 9yj0ucpq ', 'Rook', 2));
    expect(list.map((x) => x.tag)).toEqual(['#9YJ0UCPQ', '#2QLPGR8V']);
  });

  it('keeps one row per player, moved to the front', () => {
    const list = pushRecent([p('#2QLPGR8V'), p('#9YJ0UCPQ')], p('#9YJ0UCPQ', null, 5));
    expect(list.map((x) => x.tag)).toEqual(['#9YJ0UCPQ', '#2QLPGR8V']);
    expect(list[0].at).toBe(5);
  });

  it('keeps a known name when the newer visit did not carry one', () => {
    const list = pushRecent([p('#2QLPGR8V', 'Rook')], p('#2QLPGR8V', null, 9));
    expect(list[0].name).toBe('Rook');
  });

  it('stops at the cap, dropping the oldest', () => {
    const tags = ['#2QLPGR8V', '#9YJ0UCPQ', '#L8GVPJ90', '#8CRPJ2RC', '#200QLJUY', '#RQ0J8GQR', '#YCRV9Y8U', '#YYPCUUY0'];
    let list: RecentPlayer[] = [];
    for (const t of tags) list = pushRecent(list, p(t));
    list = pushRecent(list, p('#Q2G8L0RP'));
    expect(RECENT_MAX).toBe(8);
    expect(list).toHaveLength(8);
    expect(list[0].tag).toBe('#Q2G8L0RP');
    expect(list.some((x) => x.tag === '#2QLPGR8V')).toBe(false);
  });

  it('ignores something that is not a tag', () => {
    const before = [p('#2QLPGR8V')];
    expect(pushRecent(before, p('hello world'))).toEqual(before);
  });
});

describe('parseRecent', () => {
  it('reads back what was written', () => {
    const list = [p('#2QLPGR8V', 'Rook', 3)];
    expect(parseRecent(JSON.stringify(list))).toEqual(list);
  });

  it('drops malformed rows and duplicates instead of trusting storage', () => {
    const raw = JSON.stringify([
      { tag: '#2QLPGR8V', name: 'Rook', at: 1 },
      { tag: 'not a tag' },
      null,
      { tag: '#2qlpgr8v', name: 'Again', at: 2 },
      { tag: '#9YJ0UCPQ', name: 42, at: 'soon' },
    ]);
    expect(parseRecent(raw)).toEqual([p('#2QLPGR8V', 'Rook', 1), p('#9YJ0UCPQ', null, 0)]);
  });

  it('answers empty for nothing, garbage or a non-list', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{not json')).toEqual([]);
    expect(parseRecent('{"tag":"#2QLPGR8V"}')).toEqual([]);
  });
});

describe('where a player is recorded', () => {
  it('only on a screen that got an answer, never on the route', () => {
    for (const file of ['src/components/Analytics/PlayerAnalysis.tsx', 'src/components/Analytics/RecentBattles.tsx']) {
      const src = readFileSync(file, 'utf8');
      const at = src.indexOf('rememberPlayer(');
      expect(at, file).toBeGreaterThan(-1);
      // Inside the fetch's success handler, after the report is set.
      expect(src.lastIndexOf('setReport(r)', at), file).toBeGreaterThan(-1);
      expect(src.slice(src.lastIndexOf('.then(', at), at)).toContain('setReport(r)');
    }
    const dash = readFileSync('src/components/Dashboard/Dashboard.tsx', 'utf8');
    expect(dash).not.toContain('rememberPlayer(');
  });
});
