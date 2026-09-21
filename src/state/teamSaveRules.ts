import type { TeamMode, TeamRecommendation, TeamReport } from './analyticsClient';

/**
 * SAVED TEAM ANALYSES — the rules, with no storage, no network and no React.
 *
 * Split out of `teamSaves.ts` for the reason `tiers.ts` and `deviceIdentity.ts`
 * were: the store beside it talks to `localStorage` and to the account's sync
 * endpoint, and nothing that decides what a save IS can be tested while it
 * sits next to either.
 *
 * ── WHY SAVES SYNC NOW (2026-09-21) ───────────────────────────────────────
 *
 * They lived in the one browser that made them. Reported as "in the mobile
 * layout I can't see saved analysis": the list was fine on a phone — it simply
 * had nothing in it, because every save was on the desktop. They go to the
 * account now (`/api/decks?doc=team-saves`), ONE RECORD PER SAVE plus an
 * index, because twelve boards do not fit in the one 1 MB document the deck
 * sync uses. The local copy is a cache: a save made on another device arrives
 * as a STUB (name, date, counts) and its report is fetched when it is opened.
 */

/** How many analyses may be kept. Mirrored as `TEAM_SAVE_MAX` in `api/decks.ts`. */
export const MAX_SAVES = 12;

/** The id shape `newSaveId()` produces, and the only one the endpoint accepts —
 *  an id becomes part of a storage key, so it is never free text. */
export const SAVE_ID = /^t[a-z0-9]{6,24}$/;

export function newSaveId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** What a list row shows. Carried on a stub, read off the report otherwise. */
export interface SaveCounts {
  mode: TeamMode;
  players: number;
  folders: number;
}

/** One entry in the account's index. */
export interface TeamSaveMeta extends SaveCounts {
  id: string;
  name: string;
  savedAt: string;
}

export interface SavedTeamAnalysis {
  id: string;
  name: string;
  /** ISO. When the figures below were true. */
  savedAt: string;
  /** What was in the two boxes, so the analysis can be re-run rather than retyped. */
  blueText: string;
  redText: string;
  /** ABSENT ON A STUB — a save made on another device, or a cached report
   *  evicted to make room. Fetched from the account when opened. */
  report?: TeamReport;
  /** The row's figures for a stub, which has no report to read them from. */
  meta?: SaveCounts;
  /** The account holds THIS version. False/absent: not uploaded yet. */
  synced?: boolean;
}

/**
 * Which mode a save came from.
 *
 * A SAVE FROM BEFORE THE TWO MODES EXISTED HAS NO `mode` AT ALL, and every one
 * of those is a match plan, because that was the only thing the screen did.
 * Do not infer from `blue.length` — a match plan whose roster failed to
 * resolve has an empty `blue` too.
 */
export function saveCounts(save: SavedTeamAnalysis): SaveCounts {
  if (save.report) {
    return {
      mode: save.report.mode ?? 'squads',
      players: save.report.blue.length + save.report.red.length,
      folders: save.report.folders.length,
    };
  }
  return save.meta ?? { mode: 'squads', players: 0, folders: 0 };
}

export function saveMode(save: SavedTeamAnalysis): TeamMode {
  return saveCounts(save).mode;
}

export function metaOf(save: SavedTeamAnalysis): TeamSaveMeta {
  return { id: save.id, name: save.name, savedAt: save.savedAt, ...saveCounts(save) };
}

/** A save without its report — what another device's save looks like here. */
export function stubOf(save: SavedTeamAnalysis): SavedTeamAnalysis {
  const { report: _drop, ...rest } = save;
  void _drop;
  return { ...rest, meta: saveCounts(save) };
}

function lean(rec: TeamRecommendation, keepEvidence: boolean): TeamRecommendation {
  const { matchups, explanation: _say, brain: _brain, ...rest } = rec;
  void _say;
  void _brain;
  return keepEvidence && matchups ? { ...rest, matchups } : rest;
}

/**
 * The report as it is stored: everything the screen and the PDF draw, and
 * nothing else.
 *
 * THE PER-THREAT TABLE IS KEPT ON EACH FOLDER'S TOP PICK ONLY — the PDF's one
 * reader — and dropped everywhere else, with the per-row `explanation` the
 * screen no longer prints and the per-row `brain` the report carries once.
 * Measured on a real 5v5 match plan: 1.08 MB -> 0.24 MB. Uncompacted, a 10v10
 * board was ~4.6 MB — past the browser's whole allowance, which is what
 * "This board is too large to store in the browser" was. Compacted it is
 * ~0.7 MB, inside one sync request.
 *
 * The server now sends the table on the top pick only as well
 * (`_evidence_on_top`); this is still applied, so a board run against an
 * older server saves just as small.
 */
export function compactReport(report: TeamReport): TeamReport {
  return {
    ...report,
    folders: report.folders.map((f) => ({
      ...f,
      recommended: f.recommended.map((r, i) => lean(r, i === 0)),
      perPlayer: (f.perPlayer ?? []).map((p) => ({ ...p, decks: p.decks.map((d) => lean(d, false)) })),
    })),
    ...(report.overall
      ? { overall: { ...report.overall, recommended: report.overall.recommended.map((r) => lean(r, false)) } }
      : {}),
  };
}

/** Newest first — the order the list is read in. */
export function newestFirst<T extends { savedAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
}

/**
 * This browser's list, reconciled with the account's.
 *
 *   ON BOTH, SAME VERSION      kept; the account's NAME wins (renamed elsewhere)
 *   ON BOTH, ACCOUNT NEWER     becomes a stub — the report here is stale
 *   ON BOTH, LOCAL NEWER       kept and re-uploaded (an update that never landed)
 *   ONLY HERE, SYNCED BEFORE   dropped — it was deleted on another device
 *   ONLY HERE, NEVER SYNCED    kept and uploaded
 *   ONLY ON THE ACCOUNT        added as a stub
 *
 * `synced` IS WHAT TELLS "deleted elsewhere" FROM "never uploaded". Without it
 * a save made offline would be deleted by the first sync that could not find
 * it, or a save deleted on the phone would come back from the desktop's copy.
 *
 * `pendingDeletes` are deletes that have not reached the account yet; they
 * stay deleted here even while the account still lists them.
 */
export function mergeSaves(
  local: SavedTeamAnalysis[],
  remote: TeamSaveMeta[],
  pendingDeletes: readonly string[] = [],
): { saves: SavedTeamAnalysis[]; upload: string[] } {
  const gone = new Set(pendingDeletes);
  const byId = new Map(remote.filter((m) => !gone.has(m.id)).map((m) => [m.id, m]));
  const out: SavedTeamAnalysis[] = [];
  const upload: string[] = [];

  for (const s of local) {
    if (gone.has(s.id)) continue;
    const r = byId.get(s.id);
    if (!r) {
      if (s.synced) continue;
      out.push(s);
      if (s.report) upload.push(s.id);
      continue;
    }
    byId.delete(s.id);
    if (r.savedAt > s.savedAt) {
      out.push({
        id: r.id,
        name: r.name,
        savedAt: r.savedAt,
        blueText: '',
        redText: '',
        meta: { mode: r.mode, players: r.players, folders: r.folders },
        synced: true,
      });
    } else if (r.savedAt < s.savedAt && s.report) {
      out.push({ ...s, synced: false });
      upload.push(s.id);
    } else {
      out.push({ ...s, name: r.name, synced: true });
    }
  }
  for (const r of byId.values()) {
    out.push({
      id: r.id,
      name: r.name,
      savedAt: r.savedAt,
      blueText: '',
      redText: '',
      meta: { mode: r.mode, players: r.players, folders: r.folders },
      synced: true,
    });
  }
  return { saves: newestFirst(out), upload };
}

/** Shape-check an entry read from storage or from the account. Anything that
 *  fails is dropped, not repaired. A stub passes with `meta` in place of a
 *  report. */
export function isSave(e: unknown): e is SavedTeamAnalysis {
  if (!e || typeof e !== 'object') return false;
  const s = e as SavedTeamAnalysis;
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.savedAt !== 'string') return false;
  if (s.report) return Array.isArray(s.report.folders);
  return !!s.meta && typeof s.meta === 'object';
}

/** A save the account returned in full. */
export function isFullSave(e: unknown): e is SavedTeamAnalysis & { report: TeamReport } {
  return isSave(e) && !!(e as SavedTeamAnalysis).report;
}
