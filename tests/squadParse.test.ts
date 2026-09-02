import { describe, expect, it } from 'vitest';

import {
  MAX_SQUAD,
  normalizeTag,
  overlappingTags,
  parseSquad,
  scoutProblem,
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

describe('parseSquad — links', () => {
  /* THE FORMAT THIS WAS ADDED FOR. A roster arrives as a Discord message, and
     a Discord message is markdown: the tag is wrapped in `[...]` and welded to
     an href with no whitespace anywhere between them. Before links were read,
     the hash token ran to the next space and came out as the tag PLUS the whole
     URL — so every one of these ten rows was reported as a broken tag and the
     squad was empty. */
  const DISCORD = [
    '*1.* 🇵🇪 WR I Clisman™✨ — [#V20U0YRCY](https://royaleapi.com/player/V20U0YRCY)',
    '*2.* 🇦🇷 ⚡Agustin⚡ — [#U8Q9CGYU](https://royaleapi.com/player/U8Q9CGYU)',
    '*3.* 🇳🇮 MarviToykoDrift — [#VUYV2G89Y](https://royaleapi.com/player/VUYV2G89Y)',
    '*4.* 🇨🇱 Kito King — [#2U0G9LGRG](https://royaleapi.com/player/2U0G9LGRG)',
  ].join('\n');

  it('reads a markdown roster where the tag is welded to its link', () => {
    const r = parseSquad(DISCORD);
    expect(r.members.map((m) => m.tag)).toEqual([
      '#V20U0YRCY', '#U8Q9CGYU', '#VUYV2G89Y', '#2U0G9LGRG',
    ]);
    expect(r.rejected).toEqual([]);
  });

  it('does not count the markdown tag and its own href as two players', () => {
    // Same tag, written twice on one line by the format itself.
    expect(parseSquad(DISCORD).duplicates).toEqual([]);
  });

  it('strips list numbering and emphasis marks off the name', () => {
    // `*1.*` — the ordinal is INSIDE the emphasis, so one pass of either rule
    // leaves the other's marker behind.
    const r = parseSquad(DISCORD);
    expect(r.members[2].name).toBe('🇳🇮 MarviToykoDrift');
    expect(r.members[3].name).toBe('🇨🇱 Kito King');
  });

  it('reads a bare link with no hash anywhere', () => {
    // No `#` in the text at all: the URL is what earns marked mode, and
    // without it every word of every name would be tried as a tag.
    const r = parseSquad(
      'Kito King https://royaleapi.com/player/2U0G9LGRG\nOker royaleapi.com/player/YLVV0JPQ',
    );
    expect(r.members).toEqual([
      { tag: '#2U0G9LGRG', name: 'Kito King' },
      { tag: '#YLVV0JPQ', name: 'Oker' },
    ]);
    expect(r.rejected).toEqual([]);
  });

  it('reads a tag out of a query string', () => {
    const r = parseSquad('https://link.clashroyale.com/invite/friend/en?tag=2PP0PYLQ&token=abc');
    expect(r.members.map((m) => m.tag)).toEqual(['#2PP0PYLQ']);
  });

  it('reads a tag under a sub-page', () => {
    // The marker only disqualifies when it INTRODUCES the tag, so a deck page
    // for a player is still that player.
    const r = parseSquad('https://royaleapi.com/player/2U0G9LGRG/decks');
    expect(r.members.map((m) => m.tag)).toEqual(['#2U0G9LGRG']);
  });

  it('REFUSES a clan link, which is otherwise indistinguishable', () => {
    /* A clan tag is a syntactically perfect player tag. Reading one would put
       a player in the roster who is not on the team, silently. */
    const r = parseSquad('Team https://royaleapi.com/clan/2PP0PYLQ');
    expect(r.members).toEqual([]);
  });

  it('does not report a link that simply holds no tag', () => {
    // A roster carrying a team page or a VOD is not a broken tag.
    const r = parseSquad('Roster: https://example.com/teams/spring\nRavi #Y022GRCJQ');
    expect(r.members.map((m) => m.tag)).toEqual(['#Y022GRCJQ']);
    expect(r.rejected).toEqual([]);
  });

  it('keeps a link out of the name beside it', () => {
    const r = parseSquad('Ravi (see https://example.com/notes) #Y022GRCJQ');
    expect(r.members[0].name).toBe('Ravi (see');
  });

  it('unwraps a bracketed tag with no link at all', () => {
    expect(parseSquad('Ravi [#Y022GRCJQ]').members[0]).toEqual({
      tag: '#Y022GRCJQ',
      name: 'Ravi',
    });
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

  it('takes a full ten-player roster, which is what people paste', () => {
    /* A ranked list off a Discord channel is numbered 1 to 10. The cap was 8,
       so the most common real input was refused and the person was asked to
       decide which two opponents did not matter. */
    expect(MAX_SQUAD).toBe(10);
    expect(squadProblem(squad(10), squad(10))).toBeNull();
  });

  it('MIRRORS THE SERVER, and a drift here is a silently shortened roster', () => {
    /* `server/team_analysis.py` holds the same constant and enforces it
       DIFFERENTLY: this side refuses, that side slices `blue_tags[:MAX_SQUAD]`.
       So a client cap above the server's does not error — it drops the tail of
       the roster without listing it in `rejected` or anywhere else.
       If this fails, the other half of the change was not made:
       `server/team_analysis.py` MAX_SQUAD, and a deploy to the API host. */
    expect(MAX_SQUAD).toBe(10);
  });

  it('names the side that is the problem', () => {
    expect(squadProblem(squad(0), squad(0))).toBe('Paste both squads to begin.');
    expect(squadProblem(squad(0), squad(1))).toContain('your team');
    expect(squadProblem(squad(1), squad(0))).toContain('opponent');
    expect(squadProblem(squad(3), squad(3))).toBeNull();
  });

  /* THE SCOUTING REPORT'S CHECK, which has only one roster to look at. It is a
     separate function rather than a mode argument because every message in
     `squadProblem` names a side, and a scouting report has no side to name. */
  describe('scoutProblem', () => {
    it('asks for the one roster it needs', () => {
      expect(scoutProblem(squad(0))).toBe('Paste the roster you want to scout.');
      expect(scoutProblem(squad(1))).toBeNull();
    });

    it('never mentions a squad the reader was not asked for', () => {
      /* The Scouting Report tab renders no blue box at all, so a message about
         "your team" would refuse a run for a reason nothing on screen
         explains. */
      expect(scoutProblem(squad(0))).not.toMatch(/your team|opponent|both/i);
    });

    it('shares MAX_SQUAD with the two-roster check', () => {
      /* Deliberately the same cap even though a scouting report does less work
         per player: this number is a mirror of the server's slice, and the
         server slices both modes with one constant. Two caps here would be two
         chances to drift from one number over there. */
      expect(scoutProblem(squad(MAX_SQUAD))).toBeNull();
      expect(scoutProblem(squad(MAX_SQUAD + 1))).toContain(String(MAX_SQUAD));
    });
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
