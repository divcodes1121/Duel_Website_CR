/**
 * The shape every analytics screen exports itself as.
 *
 * WHY A MODEL RATHER THAN A RENDERER PER SCREEN. There are seven analytics
 * screens and they want the same six things drawn: a row of headline figures, a
 * ranked table, a bar chart, a deck with its art, a note, a page break. Writing
 * seven renderers means seven copies of pagination, seven copies of the colour
 * lookup and seven chances for one screen's PDF to drift from another's — which
 * is the failure this project keeps recording under a different name (two
 * copies of a date window, four copies of the evolution-mark test).
 *
 * So a screen's export is a pure data structure — no jsPDF, no measurement, no
 * layout — and `analyticsPdf.ts` is the only thing that can draw one. Adding a
 * screen is an adapter of about thirty lines, and a change to how tables look
 * happens once.
 *
 * The model is deliberately NOT a generic document tree. It has exactly the
 * blocks the screens need; anything richer would push layout decisions back
 * into the adapters, which is the thing being avoided.
 */

/** A hue name from the app's five-hue system. The renderer resolves it against
 *  the LIVE token values, so a report is drawn in the same colours the reader
 *  was just looking at, in whichever theme they have on. */
export type ReportHue = 'violet' | 'pink' | 'blue' | 'green' | 'red' | 'neutral';

/** A headline figure. `note` is the denominator or the caveat, and it is not
 *  optional decoration — this project's whole argument is that a rate without
 *  its sample size is not a claim. */
export interface StatTile {
  label: string;
  value: string;
  note?: string;
  hue?: ReportHue;
}

export interface TableColumn {
  key: string;
  label: string;
  /** Millimetres. The renderer distributes leftover width across `flex` columns
   *  and honours these exactly, because a table whose columns are computed from
   *  content does not line up between pages. */
  width?: number;
  flex?: boolean;
  align?: 'left' | 'right';
}

export interface TableCell {
  text: string;
  /** 0..1 — draws a proportional bar behind the cell. */
  bar?: number;
  hue?: ReportHue;
  /** Drained to neutral: a reading that is true but too thin to rank on. The
   *  renderer greys it rather than hiding it, matching the screens. */
  thin?: boolean;
}

export type TableRow = Record<string, TableCell | string>;

interface BlockBase {
  /** Printed above the block. */
  heading?: string;
  /** One line under the heading, for the caveat that belongs to this block. */
  note?: string;
}

export interface StatsBlock extends BlockBase {
  kind: 'stats';
  tiles: StatTile[];
}

export interface TableBlock extends BlockBase {
  kind: 'table';
  columns: TableColumn[];
  rows: TableRow[];
}

export interface BarsBlock extends BlockBase {
  kind: 'bars';
  /** `value` is what gets printed; `fraction` is what gets drawn. They are
   *  separate because a win rate's bar should run 0..1 while its label reads
   *  "63.3%", and a use rate's bar is often scaled to the largest row. */
  bars: { label: string; value: string; fraction: number; hue?: ReportHue; thin?: boolean }[];
}

/** A deck, drawn with the same evolution/hero art the screen showed. */
export interface DeckLine {
  name: string;
  meta?: string;
  value?: string;
  valueNote?: string;
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  /** Art was guessed from slot position rather than observed. Said out loud. */
  inferredArt?: boolean;
}

export interface DecksBlock extends BlockBase {
  kind: 'decks';
  decks: DeckLine[];
}

export interface NoteBlock extends BlockBase {
  kind: 'note';
  body: string;
}

/** Forces what follows onto a new sheet. Used where a section genuinely must
 *  not straddle a page break, not for spacing. */
export interface BreakBlock {
  kind: 'break';
}

/**
 * A full-page section title, and the thing that makes a long report navigable.
 *
 * A forty-page document that scrolls uniformly is not forty pages of report, it
 * is one page repeated — the reader cannot tell where they are or find their
 * way back. A divider gives every player their own opening sheet, and it is
 * also what the contents page is built from: `title` is recorded against the
 * sheet it lands on, so the numbers are real rather than estimated.
 */
export interface DividerBlock {
  kind: 'divider';
  title: string;
  subtitle?: string;
  /** Printed small under the title. Usually the tag. */
  tag?: string;
  hue?: ReportHue;
  /** Up to four figures on the title sheet, so it opens with substance. */
  stats?: { label: string; value: string; note?: string }[];
  /** How this section is listed in the contents. Defaults to `title`. */
  contents?: string;
  /** Indents the contents entry — a player under an opponent, say. */
  depth?: 0 | 1;
}

/**
 * The grid: every teammate against every opponent, one cell each.
 *
 * THIS IS THE ONE PICTURE THAT ANSWERS THE WHOLE DOCUMENT. Everything else is
 * one player at a time; this is the only place a coach can see the whole board
 * and find the pairing that is in trouble. Cells carry both a number and a
 * fraction because the fraction is what gets painted and the number is what
 * gets read — the same split `BarsBlock` makes, for the same reason.
 *
 * A null fraction is NOT zero. It means no rung of the ladder had evidence, and
 * it is drawn as an empty cell rather than a cold one: painting it at the
 * bottom of the scale would rank an unmeasured pairing below a measured bad
 * one, which is exactly backwards.
 */
export interface MatrixBlock extends BlockBase {
  kind: 'matrix';
  columns: { label: string; sub?: string }[];
  rows: {
    label: string;
    sub?: string;
    cells: { text: string; fraction: number | null; thin?: boolean }[];
  }[];
  /** Printed under the grid to say what the colour means. */
  legend?: string;
}

/**
 * A proportional band — an opponent's archetype spread, as one bar.
 *
 * Segments rather than a pie: at print size a pie's small slices are unreadable
 * and unlabelable, and the question here ("how much of their play is this?") is
 * a length comparison, which a bar answers directly and a wedge does not.
 */
export interface SpreadBlock extends BlockBase {
  kind: 'spread';
  /** `share` is a percentage, 0..100, matching every other rate in this model. */
  segments: { label: string; share: number; note?: string; hue?: ReportHue }[];
}

/**
 * Two decks facing each other, the way the screen draws a folder.
 *
 * The report's central claim is relational — *this* deck answers *that* one —
 * and a list cannot say that. Printed 4x2 a side so the art is large enough to
 * recognise a card from across a table, which is what these get used for.
 */
export interface VersusBlock extends BlockBase {
  kind: 'versus';
  leftLabel?: string;
  rightLabel?: string;
  pairs: {
    left: DeckLine;
    /** Null when nothing on the squad answers it — printed as a stated
     *  absence, never as a blank half. */
    right: DeckLine | null;
    note?: string;
  }[];
}

export type ReportBlock =
  | StatsBlock
  | TableBlock
  | BarsBlock
  | DecksBlock
  | NoteBlock
  | BreakBlock
  | DividerBlock
  | MatrixBlock
  | SpreadBlock
  | VersusBlock;


/**
 * Text jsPDF's built-in fonts can actually draw.
 *
 * Those fonts are **WinAnsi (Latin-1) only**. Hand one a character outside
 * that range and jsPDF encodes the string as UTF-16 and writes its raw BYTES,
 * which the standard fonts render one Latin-1 glyph each — so ONE emoji turns
 * a whole name into byte noise, not just itself.
 *
 * MEASURED on a shipped 10v10 dossier: every Clash Royale name carrying an
 * emoji or a symbol came out like this, and a contents page of them read as
 * line noise:
 *
 *     "WR I Clisman<emoji>"  ->   W R   I   C l...
 *
 * NFKD first, so an accented letter degrades to its base and a ™ becomes "TM"
 * instead of vanishing; combining marks go; anything still above U+00FF goes.
 *
 * IT LIVES HERE, in the pure model module, because it must be applied at THREE
 * different moments and a second copy would drift from the first:
 *
 *   * when MEASURING (`clip`), or the layout is computed for text that will
 *     not be the text drawn — which is what truncated "WR I Clisman" to
 *     "WR I Clisman..." in a column with room to spare;
 *   * when DRAWING, as the guard that cannot be bypassed;
 *   * when CHOOSING a name at all, so a caller holding a tag can fall back to
 *     it rather than print a blank.
 */
export function pdfSafe(s: string): string {
  if (!s) return '';
  let clean = true;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > 0xff) { clean = false; break; }
  }
  if (clean) return s;
  const flat = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of flat) {
    const c = ch.codePointAt(0) as number;
    if (c === 9 || c === 10 || (c >= 32 && c <= 0xff)) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export interface ReportDoc {
  /** The screen's own name — "Duel Zone", "Top Meta Decks". */
  screen: string;
  /** Usually the player tag; absent on the global screens, which are about
   *  everybody rather than one player. */
  subject?: string;
  /** The identity hue of the screen this came from, so the report is coloured
   *  like the area it belongs to. */
  hue: ReportHue;
  /** Facts about the query, printed on the cover: window, mode, tiers, how old
   *  a snapshot is. Every one of these is something the reader needs to know to
   *  interpret the numbers, which is why they are on the cover and not omitted
   *  for tidiness. */
  meta: { label: string; value: string }[];
  blocks: ReportBlock[];
  /** Printed at the foot of the last page. The place to say what the report
   *  cannot say. */
  caveats?: string[];
  /**
   * Emit a contents sheet listing every `divider`, with real page numbers.
   *
   * Reserved as page 2 and filled on the SECOND pass, because a page number
   * cannot be known until the thing it points at has been laid out. Worth
   * turning on past about ten pages and pointless below that.
   */
  contents?: boolean;
  /** A sentence under the cover title, when the subject line is not enough. */
  summary?: string;
}

/* ------------------------------------------------------------------ helpers */

/**
 * Format a rate the API already expressed on a 0-100 scale.
 *
 * THE UNITS ARE PERCENT, NOT A FRACTION, and this is worth stating because it
 * is not obvious and it has already been got wrong here: `/meta` sends
 * `useRate: 2.13`, `/cards` sends `winRate: 75.0`, `/player` sends
 * `useRate: 19.2`. A helper that multiplied by 100 turned a 73.5% win rate into
 * "7350.0%" in a printed report — a number wrong by two orders of magnitude
 * that still looked like a number, which is the kind of defect a type system
 * cannot catch because both sides are `number`.
 */
export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

/** The same 0-100 rate as a 0..1 bar length, clamped. Bars are drawn, not
 *  printed, so they are the one place the fraction is actually wanted. */
export function frac(n: number | null | undefined): number {
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n / 100));
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-GB');
}

/** A filename that sorts by date and says what it is. */
export function reportFilename(doc: ReportDoc): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const day = new Date().toISOString().slice(0, 10);
  const who = doc.subject ? `-${slug(doc.subject)}` : '';
  return `deckkies-${slug(doc.screen)}${who}-${day}.pdf`;
}
