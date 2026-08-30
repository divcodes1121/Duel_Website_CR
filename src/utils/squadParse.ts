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

/**
 * A token that was meant to be a tag, with the punctuation a paste leaves on it.
 *
 * `[#V20U0YRCY](https://…)` is markdown, and markdown puts a `]` immediately
 * after the tag with no space — so the token handed here is `V20U0YRCY]`.
 * TRIED VERBATIM FIRST and only then trimmed, because a trim that runs
 * unconditionally would also "fix" input that was never a tag: it is a repair
 * for known wrappers, not a second, laxer alphabet.
 */
function readTagToken(body: string): string | null {
  const direct = normalizeTag(body);
  if (direct) return direct;
  const trimmed = body.replace(/[^0-9A-Za-z]+$/u, '');
  return trimmed && trimmed !== body ? normalizeTag(trimmed) : null;
}

/** Punctuation and markup people leave on either end of a pasted name. */
const NAME_LEAD = /^[\s,;|\-–—:()[\]{}"'`*_~•·‣>+]+/u;
const NAME_TAIL = /[\s,;|\-–—:()[\]{}"'`*_~•·‣>+]+$/u;
/** `1.` / `2)` / `3:` — the numbering on a ranked roster. */
const NAME_ORDINAL = /^\d{1,3}\s*[.)\]:]\s*/u;

/**
 * Trailing punctuation people leave behind when they paste a roster table.
 *
 * THE LOOP IS NOT DECORATION. A Discord roster line reads
 * `*1.* 🇵🇪 WR I Clisman™✨ — [#V20U0YRCY](…)`, where the ordinal sits INSIDE
 * the emphasis marks: one pass strips the leading `*`, which is what first
 * exposes the `1.`, and stripping that exposes the second `*`. A single pass of
 * either rule leaves the other's marker behind and the chip reads `*1.* …`.
 * Four passes is well past what any real prefix needs and it terminates on its
 * own the moment a pass changes nothing.
 */
function cleanName(raw: string): string | null {
  let name = raw.trim();
  for (let i = 0; i < 4; i += 1) {
    const before = name;
    name = name.replace(NAME_LEAD, '').replace(NAME_TAIL, '').replace(NAME_ORDINAL, '').trim();
    if (name === before) break;
  }
  if (!name) return null;
  /* NO "is this actually a tag?" GUARD HERE, and that was a real bug: in hashed
     mode a bare token is never a tag, so rejecting a name for being
     tag-SHAPED threw away 'QUURY' — a legal name and a legal tag body at the
     same time. The `#` is the only thing that makes a tag in this mode, which
     is the whole reason the two modes are separated. */
  return name.slice(0, 40);
}

/**
 * A URL anywhere in the line, with or without a scheme.
 *
 * The bare-host alternative exists because a paste that has been through a
 * plain-text conversion loses `https://` and keeps `royaleapi.com/player/…`.
 * It requires a dot AND a slash, so it cannot fire on `Ravi/Aditya`.
 *
 * Closing brackets are excluded from the body: in `[#TAG](url)` the URL is
 * followed immediately by `)`, and swallowing it would leave the path segment
 * unreadable in exactly the format this was added for.
 */
const URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>()[\]{}"'`]+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+\/[^\s<>()[\]{}"'`]+/gi;

/**
 * Path segments that say the tag after them is NOT a player.
 *
 * A clan link and a player link differ by one word and are otherwise identical
 * — `royaleapi.com/clan/2PP0PYLQ` — and a clan tag is a syntactically perfect
 * player tag. Reading one would put a player in the roster who is not on the
 * team, silently, which is the exact failure this whole file is built to avoid.
 * Checked only in the segments BEFORE the tag, so `/player/<tag>/decks` still
 * reads: the marker has to be what INTRODUCES the tag to disqualify it.
 */
const NOT_A_PLAYER = new Set([
  'clan', 'clans', 'clanwar', 'tournament', 'tournaments', 'war', 'wars',
  'deck', 'decks', 'card', 'cards', 'battle', 'battles',
  'season', 'seasons', 'leaderboard', 'leaderboards', 'esports',
]);

/**
 * The player tag inside a URL, or null.
 *
 * Site-agnostic on purpose. RoyaleAPI, Deck Shop, StatsRoyale and Supercell's
 * own invite links all put the tag in a path segment or a query value, and
 * hard-coding a host list would mean the fifth site nobody thought of silently
 * produces a shorter roster. The alphabet is the filter; the marker list above
 * is the one place a guess would be dangerous.
 */
function tagFromUrl(url: string): string | null {
  // Scheme, then everything up to the first slash — the host is never scanned.
  const path = url.replace(/^(?:https?:\/\/)?[^/]*/iu, '');
  if (!path) return null;
  const segments = path.replace(/%23/giu, '#').split(/[/?&=#]+/u).filter(Boolean);
  for (const seg of segments) {
    if (NOT_A_PLAYER.has(seg.toLowerCase())) return null;
    const tag = readTagToken(seg);
    if (tag) return tag;
  }
  return null;
}

/** One tag-shaped thing found on a line, and where it sat. */
interface Hit {
  start: number;
  end: number;
  /** null = it announced itself as a tag and is not one. */
  tag: string | null;
  /** What to show back if it is not one. */
  raw: string;
  kind: 'hash' | 'url';
}

/** Replace each span with spaces, so indices still line up. */
function blankSpans(line: string, spans: Array<[number, number]>): string {
  let out = line;
  for (const [a, b] of spans) out = out.slice(0, a) + ' '.repeat(b - a) + out.slice(b);
  return out;
}

/**
 * Everything on one line that claims to be a tag, in the order it appears.
 *
 * THE URLS ARE READ FIRST AND THEN BLANKED, AND THE `#` WALK RUNS ON THE BLANK
 * COPY. This is the whole reason the markdown case failed: a hash token runs to
 * the next whitespace, and in `[#V20U0YRCY](https://…/V20U0YRCY)` there is no
 * whitespace between the tag and the link, so the token was the tag AND the
 * entire URL glued to it — unreadable, and reported as a broken tag on every
 * row of a paste that was perfectly well formed. Blanking first leaves
 * `[#V20U0YRCY]`, which is a wrapper `readTagToken` already knows how to
 * unwrap. It also disposes of a link's own fragment (`…/player/X#decks`)
 * producing a second, bogus hash token out of a URL that was already read.
 *
 * The blanking is length-preserving, so every index here indexes both strings.
 */
function lineHits(line: string): { hits: Hit[]; nameSource: string; spoke: boolean } {
  const hits: Hit[] = [];
  const spans: Array<[number, number]> = [];
  let spoke = false;
  let m: RegExpExecArray | null;

  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    spans.push([start, end]);
    /* A URL is never REJECTED for holding no tag. Rosters carry team pages,
       spreadsheets and VOD links, and calling those broken tags would bury the
       one message that matters under noise. It still counts as having spoken,
       so a line that is only a link is not then re-reported as a stray `#`. */
    spoke = true;
    const tag = tagFromUrl(m[0]);
    if (tag) hits.push({ start, end, tag, raw: m[0].slice(0, 24), kind: 'url' });
  }

  const nameSource = blankSpans(line, spans);

  const hashRe = /#([^\s,;|]+)/gu;
  while ((m = hashRe.exec(nameSource)) !== null) {
    spoke = true;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      tag: readTagToken(m[1]),
      raw: m[0].slice(0, 24),
      kind: 'hash',
    });
  }

  hits.sort((a, b) => a.start - b.start);
  return { hits, nameSource, spoke };
}

/**
 * Extract a squad from pasted text.
 *
 * TWO MODES, and which one applies is decided by the text rather than by a
 * setting, because asking someone to declare the format of what they are about
 * to paste is asking them to do the parser's job.
 *
 *   1. MARKED — the text holds a `#` or a URL. Only `#`-prefixed tokens and
 *      tags inside links are tags; everything else on the line is name context.
 *      This is "Mohamed Light #Y022GRCJQ", and it is also the Discord roster
 *      `*1.* 🇵🇪 WR I Clisman™✨ — [#V20U0YRCY](https://royaleapi.com/player/V20U0YRCY)`.
 *   2. BARE — no `#` and no link anywhere. Every whitespace/comma-separated
 *      token is tried as a tag. This is the "column of tags out of a
 *      spreadsheet" case.
 *
 * The split exists because the alphabet is 14 letters and digits, so a real
 * name CAN be a syntactically valid tag body — 'QUURY' parses cleanly. In mode
 * 1 the `#` or the link disambiguates and names are safe; in mode 2 there is
 * nothing to disambiguate with, and anything that fails simply lands in
 * `rejected` where the UI can show it back rather than silently dropping it.
 *
 * A URL EARNS MODE 1 EXACTLY AS A `#` DOES. It is the same property — a marker
 * the writer put there that says "a tag follows" — and the alternative is that
 * a roster of pure links falls into bare mode, where every word of every name
 * is tried as a tag and reported back as junk.
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

  URL_RE.lastIndex = 0;
  const marked = raw.includes('#') || URL_RE.test(raw);
  URL_RE.lastIndex = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    if (marked) {
      const { hits, nameSource, spoke } = lineHits(line);

      /* THE SAME TAG WRITTEN TWO WAYS ON ONE LINE IS ONE PLAYER, NOT A
         DUPLICATE. `[#V20U0YRCY](https://royaleapi.com/player/V20U0YRCY)` says
         it once in markdown and once in the href, so reporting the second
         would put "listed twice, counted once" under every single row of a
         perfectly ordinary paste.

         Tracked per KIND rather than as one set, because a tag repeated in the
         SAME form is still a real duplicate — `#T #T #T` on one line must keep
         reporting, and there is a test that says so. */
      const fromHash = new Set<string>();
      const fromUrl = new Set<string>();

      /* The name for each hit is whatever sat between the previous one on this
         line and this one — which is why a line holding two players still
         labels both correctly. Sliced from `nameSource`, where the URLs have
         been blanked out, so a link that carried no tag does not end up inside
         somebody's name. */
      let cursor = 0;
      for (const hit of hits) {
        if (!hit.tag) {
          rejected.push(hit.raw);
          cursor = hit.end;
          continue;
        }
        const mirrored = hit.kind === 'url' ? fromHash.has(hit.tag) : fromUrl.has(hit.tag);
        (hit.kind === 'url' ? fromUrl : fromHash).add(hit.tag);
        if (!mirrored) add(hit.tag, cleanName(nameSource.slice(cursor, hit.start)));
        cursor = hit.end;
      }

      /* A line whose only `#` is stranded — 'Ravi # ' — still said something
         and gets reported. A line with no marker at all is a header, a team
         name or a stray note, and is silently ignored: reporting it would flag
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
 * TEN, BECAUSE TEN IS WHAT PEOPLE PASTE. Five is a Clash Royale League roster
 * and eight was that plus a bench — but the thing that actually arrives in this
 * box is a ranked list off a Discord channel, and those come numbered 1 to 10.
 * A cap that refuses the most common real input is not protecting anything; it
 * is asking the person to decide which two of their opponents do not matter,
 * which is the question they opened this screen to answer.
 *
 * WHAT IT COSTS, since the number is a cost decision and nothing else. Every
 * player on the RED side is another folder, and every one on the BLUE side
 * widens the candidate pool each of those folders scores against, at up to
 * `CANDIDATES_PER_PLAYER` (8) decks apiece. So the scoring loop is
 * `blue x red`: 8v8 is 64 candidate-folder pairs, 10v10 is 100 — about 1.6x.
 * That loop reads memory only (every profile is built once, up front), so the
 * real bill is the 20 player resolutions rather than the scoring, and that half
 * grows by a quarter, not by 1.6x.
 *
 * REFUSED, NOT TRUNCATED. Quietly analysing the first ten of a pasted thirteen
 * produces a report that answers a question nobody asked, and the three missing
 * players are invisible in the output.
 *
 * MIRRORED IN `server/team_analysis.py`, AND THE MIRROR IS LOAD-BEARING. The
 * server SLICES where this refuses, so a client that permits more than the
 * server does sends a roster whose tail is dropped in silence. The two must
 * move in the same change — and because the server ships separately to the VPS,
 * the screen also checks `limits.maxSquad` off the response and says so if the
 * deployed API disagrees with this file.
 */
export const MAX_SQUAD = 10;

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
