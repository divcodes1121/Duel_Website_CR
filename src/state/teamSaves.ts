import { create } from 'zustand';
import type { TeamMode, TeamReport } from './analyticsClient';

/**
 * SAVED TEAM ANALYSES — keep a finished board and open it again later.
 *
 * ── WHY THIS IS ITS OWN STORE, AND ITS OWN KEY ────────────────────────────
 *
 * NOT folded into `store.ts`. That store is the deck builder's, it persists
 * under `royal-duels-builder` at **version 9** with a migration chain behind
 * it, and it is the blob the cross-device sync pushes. Adding a payload of
 * this size to it would mean a version bump — and the README is explicit about
 * what a persistence key is worth here: a bad migration orphans every saved
 * deck in every browser. A separate key cannot take those with it if this
 * feature is ever removed.
 *
 * NOT the `persist` middleware either, which the builder does use. A saved
 * report is two or three orders of magnitude larger than anything else this
 * app writes to `localStorage`, so a write that FAILS is a real case rather
 * than a theoretical one, and `persist` swallows the throw. Here the write is
 * explicit, the `QuotaExceededError` is caught, and the caller is told — see
 * `SaveResult`.
 *
 * ── WHAT A SAVE IS ────────────────────────────────────────────────────────
 *
 * A SNAPSHOT, AND THE SCREEN MUST SAY SO. Every figure in a report is measured
 * over a window that ends when the analysis ran: the opponent's spread, the
 * win rates, which of your decks cleared the comfort floor. Re-opening it a
 * week later shows what was true a week ago, and a stored report that presents
 * itself as current is worse than no stored report at all — it is the same
 * argument the README makes for never repointing the site at `archive.db`.
 * `savedAt` is therefore not a housekeeping field; it is part of the reading.
 *
 * The pasted text is kept beside the report so a stale save can be RE-RUN
 * rather than retyped, which is the honest fix for staleness.
 */

const STORAGE_KEY = 'royal-team-saves';

/**
 * How many analyses may be kept.
 *
 * REFUSED, NOT EVICTED — the same call `MAX_SQUAD` makes in `squadParse.ts`.
 * Silently dropping the oldest save to make room for a new one destroys work
 * the person explicitly asked to keep, at the moment their attention is on the
 * thing they are saving rather than on the thing being deleted.
 */
export const MAX_SAVES = 12;

/**
 * The ceiling on the whole collection, in characters of serialised JSON.
 *
 * `localStorage` is ~5 MB per origin and this app already shares it with the
 * builder, the theme and the device id. 3 MB leaves room for those and still
 * holds a dozen reports comfortably — a full eight-versus-eight board measures
 * well under 200 kB. Checked BEFORE the write, so the refusal is a message
 * rather than an exception that loses the report that was already there.
 */
const MAX_BYTES = 3_000_000;

export interface SavedTeamAnalysis {
  id: string;
  name: string;
  /** ISO. When the figures below were true. */
  savedAt: string;
  /** What was in the two boxes, so the analysis can be re-run rather than retyped. */
  blueText: string;
  redText: string;
  report: TeamReport;
}

/**
 * Which mode a save came from.
 *
 * READ OFF THE REPORT, not stored as a second field. `report.mode` is already
 * in every save written by a current server, and duplicating it in the entry
 * would create a pair that can disagree — a save whose wrapper says one thing
 * and whose contents say another, with nothing to say which is right.
 *
 * A SAVE FROM BEFORE THE TWO MODES EXISTED HAS NO `mode` AT ALL, and every one
 * of those is a match plan, because that was the only thing the screen did.
 * Defaulting to `squads` is therefore not a guess; it is the fact. Do not
 * "improve" this by inferring from `blue.length` — a match plan whose roster
 * failed to resolve has an empty `blue` too, and would come back as a scouting
 * report holding a per-player board it cannot render.
 */
export function saveMode(save: SavedTeamAnalysis): TeamMode {
  return save.report.mode ?? 'squads';
}

/** Why a save did not happen, or `ok`. One shape so the button and the message agree. */
export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'full' | 'too-large' | 'unwritable' };

interface TeamSavesState {
  saves: SavedTeamAnalysis[];
  /** Save a new analysis, or overwrite `id` if one is given. */
  save: (entry: Omit<SavedTeamAnalysis, 'id' | 'savedAt'>, id?: string) => SaveResult;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

/** Newest first, which is the order they are read in. */
function load(): SavedTeamAnalysis[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /* Shape-checked rather than trusted. This is the one store whose contents
       can be years older than the code reading them, and a half-written entry
       would otherwise crash the screen on mount rather than at the point of
       use. Anything that fails the check is dropped, not repaired. */
    return parsed.filter(
      (e): e is SavedTeamAnalysis =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as SavedTeamAnalysis).id === 'string' &&
        typeof (e as SavedTeamAnalysis).name === 'string' &&
        typeof (e as SavedTeamAnalysis).savedAt === 'string' &&
        !!(e as SavedTeamAnalysis).report &&
        Array.isArray((e as SavedTeamAnalysis).report.folders),
    );
  } catch {
    return [];
  }
}

/** Write, or say why not. Never partially applied: the caller keeps the old list. */
function write(saves: SavedTeamAnalysis[]): boolean {
  try {
    const json = JSON.stringify(saves);
    if (json.length > MAX_BYTES) return false;
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const useTeamSaves = create<TeamSavesState>((set, get) => ({
  saves: load(),

  save: (entry, id) => {
    const saves = get().saves;
    const existing = id ? saves.findIndex((s) => s.id === id) : -1;
    if (existing < 0 && saves.length >= MAX_SAVES) return { ok: false, reason: 'full' };

    const record: SavedTeamAnalysis = {
      ...entry,
      id: existing >= 0 ? saves[existing].id : newId(),
      savedAt: new Date().toISOString(),
    };

    /* An UPDATE moves the entry to the front. It is the most recently touched
       thing in the list and the list is ordered by that, so leaving it in
       place would make a save the person just performed look like it went
       nowhere. */
    const next =
      existing >= 0
        ? [record, ...saves.slice(0, existing), ...saves.slice(existing + 1)]
        : [record, ...saves];

    if (!write(next)) {
      // Distinguished, because the two have different answers: delete
      // something versus this one board is simply too big to keep.
      const alone = JSON.stringify([record]).length;
      return { ok: false, reason: alone > MAX_BYTES ? 'too-large' : 'unwritable' };
    }
    set({ saves: next });
    return { ok: true, id: record.id };
  },

  rename: (id, name) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const next = get().saves.map((s) => (s.id === id ? { ...s, name: trimmed } : s));
    if (write(next)) set({ saves: next });
  },

  remove: (id) => {
    const next = get().saves.filter((s) => s.id !== id);
    // A shorter list cannot fail the size check, but it can still fail the
    // write; dropping it from memory anyway would resurrect it on reload.
    if (write(next)) set({ saves: next });
  },
}));

/**
 * A name for a board nobody has named yet.
 *
 * The opponent is what a coach is preparing for, so the opponent is what the
 * row is called. Names come from the SERVER's resolution rather than the
 * paste, and `_resolve` falls back to the tag when nothing knows a name — so
 * "vs #2PP0PYLQ" is the honest label, not a bug.
 */
export function defaultSaveName(report: TeamReport): string {
  const opponents = report.folders.map((f) => f.player.name || f.player.tag);
  /* THE PREPOSITION IS THE MODE. "vs Ravi" is a match — two sides — and a
     scouting report has only one, so calling it that would promise a squad the
     board does not contain. "Scouting Ravi" reads as the one-sided thing it
     is, and the two are distinguishable at a glance in a list that holds
     both. */
  const verb = report.mode === 'scout' ? 'Scouting' : 'vs';
  if (!opponents.length) return report.mode === 'scout' ? 'Scouting report' : 'Team analysis';
  if (opponents.length === 1) return `${verb} ${opponents[0]}`.slice(0, 60);
  return `${verb} ${opponents[0]} +${opponents.length - 1}`.slice(0, 60);
}
