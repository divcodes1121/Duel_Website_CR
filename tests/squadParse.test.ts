import { describe, expect, it } from 'vitest';

import {
  MAX_SQUAD,
  normalizeTag,
  overlappingTags,
  parseSquad,
  squadProblem,
  squadsReady,
} from '../src/utils/squadParse';

/**
 * THE PARSER DECIDES WHO GETS ANALYSED, which is why it is tested this hard.
 * A dropped player does not produce an error — it produces a shorter report
 * that looks exactly as correct as a complete one.
 */

describe('normalizeTag', () => {
  it('upper-cases, adds the hash and tolerates whitespace', () => {
    expect(normalizeTag('y022grcjq')).toBe('#Y022GRCJQ');
    expect(normalizeTag('  #y022grcjq  ')).toBe('#Y022GRCJQ');
    expect(normalizeTag('##Y022GRCJQ')).toBe('#Y022GRCJQ');
  });

  it('rejects letters outside the 14-symbol alphabet', () => {
    // A, B, D, E... are not Supercell tag symbols. This is the guard that keeps
    // junk out of a SQL query, mirrored from clash_data.normalize_tag.
    expect(normalizeTag('#ABCDEF')).toBeNull();
    expect(normalizeTag('#Y022GRCJX')).toBeNull();
    expect(normalizeTag('#Y022-GRCJQ')).toBeNull();
  });

  it('enforces the 5..12 body length', () => {
    expect(normalizeTag('#2P90')).toBeNull();
    expect(normalizeTag('#29LP0')).toBe('#29LP0');
    expect(normalizeTag('#222222222222')).toBe('#222222222222');
    expect(normalizeTag('#2222222222222')).toBeNull();
  });

  it('rejects empty and junk', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('#')).toBeNull();
  });
});

describe('parseSquad — hashed mode', () => {
  it('takes the name from the text before the tag', () => {
    const r = parseSquad('Mohamed Light #Y022GRCJQ');
    expect(r.members).toEqual([{ tag: '#Y022GRCJQ', name: 'Mohamed Light' }]);
  });

  it('reads a whole pasted roster', () => {
    const r = parseSquad(
      ['Mohamed Light #Y022GRCJQ', 'Sergio  #2PP0PYLQ', '#L8GVPJ900'].join('\n'),
    );
    expect(r.members.map((m) => m.tag)).toEqual(['#Y022GRCJQ', '#2PP0PYLQ', '#L8GVPJ900']);
    expect(r.members.map((m) => m.name)).toEqual(['Mohamed Light', 'Sergio', null]);
  });

  it('handles two players on one line', () => {
    const r = parseSquad('Ravi #Y022GRCJQ, Aditya #L8GVPJ900');
    expect(r.members).toEqual([
      { tag: '#Y022GRCJQ', name: 'Ravi' },
      { tag: '#L8GVPJ900', name: 'Aditya' },
    ]);
  });

  it('does NOT treat a bare name as a tag when hashes are present', () => {
    /* 'QUURY' is a syntactically valid tag body. In hashed mode the `#` is what
       disambiguates, so it stays a name and never becomes a player. */
    const r = parseSquad('QUURY #Y022GRCJQ');
    expect(r.members).toHaveLength(1);
    expect(r.members[0]).toEqual({ tag: '#Y022GRCJQ', name: 'QUURY' });
  });

  it('ignores lines with no hash rather than rejecting them', () => {
    // 'Team Liquid' is a heading, not a broken tag.
    const r = parseSquad('Team Liquid\nRavi #Y022GRCJQ');
    expect(r.members).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('reports a hashed token that is not a valid tag', () => {
    const r = parseSquad('Ravi #NOTATAG!');
    expect(r.members).toEqual([]);
    expect(r.rejected).toEqual(['#NOTATAG!']);
  });

  it('strips trailing punctuation from a name', () => {
    expect(parseSquad('Ravi - #Y022GRCJQ').members[0].name).toBe('Ravi');
    expect(parseSquad('Ravi: #Y022GRCJQ').members[0].name).toBe('Ravi');
    expect(parseSquad('"Ravi" | #Y022GRCJQ').members[0].name).toBe('Ravi');
  });
});

describe('parseSquad — bare mode', () => {
  it('accepts a column of tags with no hashes at all', () => {
    const r = parseSquad('y022grcjq\n2pp0pylq\nl8gvpj900');
    expect(r.members.map((m) => m.tag)).toEqual(['#Y022GRCJQ', '#2PP0PYLQ', '#L8GVPJ900']);
    expect(r.members.every((m) => m.name === null)).toBe(true);
  });

  it('accepts comma-separated tags', () => {
    const r = parseSquad('Y022GRCJQ, 2PP0PYLQ');
    expect(r.members.map((m) => m.tag)).toEqual(['#Y022GRCJQ', '#2PP0PYLQ']);
  });

  it('surfaces what it could not read instead of dropping it', () => {
    const r = parseSquad('Y022GRCJQ notatag');
    expect(r.members.map((m) => m.tag)).toEqual(['#Y022GRCJQ']);
    expect(r.rejected).toEqual(['notatag']);
  });
});

describe('parseSquad — duplicates', () => {
  it('keeps a repeated tag once and reports it', () => {
    const r = parseSquad('Ravi #Y022GRCJQ\nRavi again #Y022GRCJQ');
    expect(r.members).toHaveLength(1);
    expect(r.duplicates).toEqual(['#Y022GRCJQ']);
  });

  it('reports a duplicate only once however often it repeats', () => {
    const r = parseSquad('#Y022GRCJQ #Y022GRCJQ #Y022GRCJQ');
    expect(r.duplicates).toEqual(['#Y022GRCJQ']);
  });

  it('normalises before comparing, so case is not a second player', () => {
    const r = parseSquad('#y022grcjq\n#Y022GRCJQ');
    expect(r.members).toHaveLength(1);
    expect(r.duplicates).toEqual(['#Y022GRCJQ']);
  });
});

describe('parseSquad — empty', () => {
  it('is empty for empty input', () => {
    for (const raw of ['', '   ', '\n\n']) {
      const r = parseSquad(raw);
      expect(r.members).toEqual([]);
      expect(r.rejected).toEqual([]);
    }
  });
});

describe('readiness', () => {
  const squad = (n: number) =>
    parseSquad(
      Array.from({ length: n }, (_, i) => `#${'Y022GRCJQ'.slice(0, 8)}${'0289PYLQGRJC'[i]}`).join(
        '\n',
      ),
    );

  it('needs both sides', () => {
    expect(squadsReady(squad(1), squad(0))).toBe(false);
    expect(squadsReady(squad(0), squad(1))).toBe(false);
    expect(squadsReady(squad(1), squad(1))).toBe(true);
  });

  it('refuses a squad over the cap rather than truncating it', () => {
    const over = squad(MAX_SQUAD + 1);
    expect(over.members).toHaveLength(MAX_SQUAD + 1);
    expect(squadsReady(over, squad(1))).toBe(false);
    expect(squadProblem(over, squad(1))).toContain(String(MAX_SQUAD));
  });

  it('names the side that is the problem', () => {
    expect(squadProblem(squad(0), squad(0))).toBe('Paste both squads to begin.');
    expect(squadProblem(squad(0), squad(1))).toContain('your team');
    expect(squadProblem(squad(1), squad(0))).toContain('opponent');
    expect(squadProblem(squad(3), squad(3))).toBeNull();
  });
});

describe('overlappingTags', () => {
  it('finds a player listed on both sides', () => {
    const blue = parseSquad('#Y022GRCJQ\n#2PP0PYLQ');
    const red = parseSquad('#2PP0PYLQ\n#L8GVPJ900');
    expect(overlappingTags(blue, red)).toEqual(['#2PP0PYLQ']);
  });

  it('is empty for two distinct rosters', () => {
    expect(overlappingTags(parseSquad('#Y022GRCJQ'), parseSquad('#L8GVPJ900'))).toEqual([]);
  });
});
