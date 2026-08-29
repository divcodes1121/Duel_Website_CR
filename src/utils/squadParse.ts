/**
 * Pulling a squad out of whatever someone pastes into the box.
 *
 * NO IMPORTS, DELIBERATELY — the same rule `tiers.ts` and `format.ts` follow.
 * This is the one piece of Team Analysis that has to be exhaustively testable,
 * because it is the piece that decides WHO gets analysed, and a parser that
 * quietly drops a player produces a report that is wrong without looking wrong.
 *
 * THE SERVER RE-VALIDATES EVERY TAG. This is not the boundary; it is the
 * immediate feedback that lets someone see their five players appear as chips
 * before spending an expensive call. `clash_data.normalize_tag` is the copy
 * that counts, and the alphabet below is a mirror of it — if Supercell ever
 * changes it, both move together.
 */

/** Supercell's 14-symbol tag alphabet. Mirrors `clash_data.normalize_tag`. */
const TAG_CHARS = '0289PYLQGRJCUV';

/** Body length bounds, also from `normalize_tag`. */
const MIN_BODY = 5;
const MAX_BODY = 12;

export interface SquadMember {
  /** Normalised, always `#`-prefixed and upper case. */
  tag: string;
  /**
   * The text that sat beside the tag, if any. A LABEL AND NOTHING ELSE — this
   * project deleted search-by-name deliberately (see the README), so a name
   * can never resolve a player. It exists so a chip reads "Mohamed Light"
   * rather than "#Y022GRCJQ" while the squad is being checked over.
   */
  name: string | null;
}

export interface SquadParse {
  members: SquadMember[];
  /** Tokens that looked like they were meant to be tags and were not. */
  rejected: string[];
  /** Tags that appeared more than once. Kept once; reported so the UI can say so. */
  duplicates: string[];
}

/**
 * '  y022grcjq ' -> '#Y022GRCJQ', or null.
 *
 * Byte-for-byte the same rule as the Python. Note it accepts a bare body: that
 * is what lets someone paste a column of tags with no hashes at all, and it is
 * also why `parseSquad` will not go looking for bare bodies inside prose.
 */
export function normalizeTag(raw: string): string | null {
  if (!raw) return null;
  const body = String(raw).trim().replace(/^#+/, '').toUpperCase();
  if (body.length < MIN_BODY || body.length > MAX_BODY) return null;
  for (const c of body) {
    if (!TAG_CHARS.includes(c)) return null;
  }
  return `#${body}`;
}

/** Trailing punctuation people leave behind when they paste a roster table. */
function cleanName(raw: string): string | null {
  const name = raw
    .replace(/[\s,;|\-–—:()[\]{}"'`]+$/u, '')
    .replace(/^[\s,;|\-–—:()[\]{}"'`]+/u, '')
    .trim();
  if (!name) return null;
  /* NO "is this actually a tag?" GUARD HERE, and that was a real bug: in hashed
     mode a bare token is never a tag, so rejecting a name for being
     tag-SHAPED threw away 'QUURY' — a legal name and a legal tag body at the
     same time. The `#` is the only thing that makes a tag in this mode, which
     is the whole reason the two modes are separated. */
  return name.slice(0, 40);
}

/**
 * Extract a squad from pasted text.
 *
 * TWO MODES, and which one applies is decided by the text rather than by a
 * setting, because asking someone to declare the format of what they are about
 * to paste is asking them to do the parser's job.
 *
 *   1. ANY `#` PRESENT -> only `#`-prefixed tokens are tags. Everything else on
 *      the line is name context. This is the "Mohamed Light #Y022GRCJQ" case.
 *   2. NO `#` ANYWHERE -> every whitespace/comma-separated token is tried as a
 *      bare tag. This is the "column of tags out of a spreadsheet" case.
 *
 * The split exists because the alphabet is 14 letters and digits, so a real
 * name CAN be a syntactically valid tag body — 'QUURY' parses cleanly. In mode
 * 1 the `#` disambiguates and names are safe; in mode 2 there is nothing to
 * disambiguate with, and anything that fails simply lands in `rejected` where
 * the UI can show it back rather than silently dropping it.
 */
export function parseSquad(text: string): SquadParse {
  const members: SquadMember[] = [];
  const rejected: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  const add = (tag: string, name: string | null) => {
    if (seen.has(tag)) {
      if (!duplicates.includes(tag)) duplicates.push(tag);
      return;
    }
    seen.add(tag);
    members.push({ tag, name });
  };

  const raw = text ?? '';
  if (!raw.trim()) return { members, rejected, duplicates };

  const hashed = raw.includes('#');

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    if (hashed) {
      /* Walk the `#` occurrences. The name for each is whatever sat between the
         previous tag on this line and this one — which is why a line holding
         two players still labels both correctly. */
      let cursor = 0;
      /* SPOKE FOR ITSELF, tag or rejection either way. Testing only for a
         successful match double-reported a line like 'Ravi #NOTATAG!' — once
         as the bad token and again as the whole line. */
      let spoke = false;
      const re = /#([^\s,;|]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        spoke = true;
        const tag = normalizeTag(m[1]);
        if (!tag) {
          rejected.push(m[0].slice(0, 24));
          cursor = re.lastIndex;
          continue;
        }
        add(tag, cleanName(line.slice(cursor, m.index)));
        cursor = re.lastIndex;
      }
      /* A line whose only `#` is stranded — 'Ravi # ' — still said something
         and gets reported. A line with no `#` at all is a header, a team name
         or a stray note, and is silently ignored: reporting it would flag
         "Team Liquid" as a broken tag. */
      if (!spoke && line.includes('#')) rejected.push(line.trim().slice(0, 24));
      continue;
    }

    for (const token of line.split(/[\s,;|]+/)) {
      if (!token) continue;
      const tag = normalizeTag(token);
      if (tag) add(tag, null);
      else rejected.push(token.slice(0, 24));
    }
  }

  return { members, rejected, duplicates };
}

/**
 * The largest squad either side may hold.
 *
 * Five is a Clash Royale League roster. Eight is that with room for a bench and
 * a coach's shortlist, and it is also where the cost stops being polite: every
 * added player on the RED side is another folder, and every one on the BLUE
 * side widens the candidate pool that each of those folders scores against.
 *
 * REFUSED, NOT TRUNCATED. Quietly analysing the first eight of a pasted eleven
 * produces a report that answers a question nobody asked, and the three missing
 * players are invisible in the output.
 */
export const MAX_SQUAD = 8;

/** True when both squads are non-empty and within the cap. */
export function squadsReady(blue: SquadParse, red: SquadParse): boolean {
  return (
    blue.members.length > 0 &&
    red.members.length > 0 &&
    blue.members.length <= MAX_SQUAD &&
    red.members.length <= MAX_SQUAD
  );
}

/**
 * Why the Analyze button is not available yet, or null when it is.
 *
 * One function so the button's disabled state and the message under it cannot
 * disagree — they are the same answer asked twice.
 */
export function squadProblem(blue: SquadParse, red: SquadParse): string | null {
  if (!blue.members.length && !red.members.length) return 'Paste both squads to begin.';
  if (!blue.members.length) return 'Add at least one player to your team.';
  if (!red.members.length) return 'Add at least one opponent.';
  if (blue.members.length > MAX_SQUAD) {
    return `Your team has ${blue.members.length} players — the most that can be analysed at once is ${MAX_SQUAD}.`;
  }
  if (red.members.length > MAX_SQUAD) {
    return `The opponent has ${red.members.length} players — the most that can be analysed at once is ${MAX_SQUAD}.`;
  }
  return null;
}

/**
 * Tags that appear on BOTH sides.
 *
 * Not an error — a scrim between two rosters that share a stand-in is a real
 * thing — but the report would then recommend a player's own deck against
 * themselves, which reads as a bug unless the screen says why.
 */
export function overlappingTags(blue: SquadParse, red: SquadParse): string[] {
  const redTags = new Set(red.members.map((m) => m.tag));
  return blue.members.map((m) => m.tag).filter((t) => redTags.has(t));
}
