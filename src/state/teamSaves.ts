import { create } from 'zustand';
import type { TeamReport } from './analyticsClient';
import {
  compactReport,
  isFullSave,
  isSave,
  MAX_SAVES,
  mergeSaves,
  newSaveId,
  SAVE_ID,
  stubOf,
  type SavedTeamAnalysis,
  type TeamSaveMeta,
} from './teamSaveRules';
import {
  deleteTeamSave,
  pullTeamSave,
  pullTeamSaveIndex,
  pushTeamSave,
  renameTeamSave,
} from './syncClient';

export { MAX_SAVES, saveMode, saveCounts, type SavedTeamAnalysis } from './teamSaveRules';

/**
 * SAVED TEAM ANALYSES — keep a finished board and open it again later, on any
 * device signed in to the same account.
 *
 * ── WHY THIS IS ITS OWN STORE, AND ITS OWN KEY ────────────────────────────
 *
 * NOT folded into `store.ts`. That store is the deck builder's, it persists
 * under `royal-duels-builder` at **version 9** with a migration chain behind
 * it, and a bad migration there orphans every saved deck in every browser. A
 * separate key cannot take those with it.
 *
 * NOT the `persist` middleware either. A saved report is orders of magnitude
 * larger than anything else this app writes to `localStorage`, so a write
 * that FAILS is a real case, and `persist` swallows the throw. Here the write
 * is explicit and the caller is told — see `SaveResult`.
 *
 * ── LOCAL IS A CACHE, THE ACCOUNT IS THE RECORD ───────────────────────────
 *
 * Saves used to live only in the browser that made them, which is why a phone
 * showed none (2026-09-21). Every save now goes to the account as well, and a
 * save made elsewhere arrives here as a stub whose report is fetched on open.
 * The rules — compaction, merging, what a stub is — are in `teamSaveRules.ts`.
 *
 * WITH NO ACCOUNT REACHABLE (signed out, offline, `vite dev`) NOTHING CHANGES:
 * saves stay local and upload on the next sync that can reach it.
 *
 * ── A SAVE IS A SNAPSHOT ──────────────────────────────────────────────────
 *
 * Every figure in a report is measured over a window that ends when the
 * analysis ran; `savedAt` is part of the reading, not housekeeping. The pasted
 * text is kept so a stale save can be RE-RUN rather than retyped.
 */

const STORAGE_KEY = 'royal-team-saves';
/** Deletes made while the account was unreachable, retried on the next sync. */
const DELETES_KEY = 'royal-team-saves-deleted';

/**
 * The ceiling on what this browser keeps, in characters of serialised JSON.
 *
 * `localStorage` is ~5 MB per origin, shared with the builder, the theme and
 * the device id. Past this, the reports of SYNCED saves are dropped from the
 * local copy oldest first — the account still has them, and they come back
 * when opened. Only unsynced reports can make a write fail.
 */
const MAX_BYTES = 3_000_000;

/** Why a save did not happen, or `ok`. One shape so the button and the message agree. */
export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'full' | 'too-large' | 'unwritable' };

interface TeamSavesState {
  saves: SavedTeamAnalysis[];
  /** Save a new analysis, or overwrite `id` if one is given. */
  save: (entry: Omit<SavedTeamAnalysis, 'id' | 'savedAt' | 'meta' | 'synced'> & { report: TeamReport }, id?: string) => SaveResult;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** Reconcile with the account. Safe to call often; a no-op when unreachable. */
  sync: () => Promise<void>;
  /** The save in full — from this browser, or fetched from the account. */
  full: (id: string) => Promise<(SavedTeamAnalysis & { report: TeamReport }) | null>;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load(): SavedTeamAnalysis[] {
  const parsed = readJson(STORAGE_KEY);
  /* Shape-checked rather than trusted. This store's contents can be months
     older than the code reading them; anything that fails is dropped. */
  return Array.isArray(parsed) ? parsed.filter(isSave) : [];
}

function loadDeletes(): string[] {
  const parsed = readJson(DELETES_KEY);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && SAVE_ID.test(x)) : [];
}

function writeDeletes(ids: string[]): void {
  try {
    if (ids.length) localStorage.setItem(DELETES_KEY, JSON.stringify(ids));
    else localStorage.removeItem(DELETES_KEY);
  } catch {
    /* A lost pending delete costs one save reappearing — not worth a message. */
  }
}

function tryWrite(list: SavedTeamAnalysis[]): boolean {
  try {
    const json = JSON.stringify(list);
    if (json.length > MAX_BYTES) return false;
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

/** Write, evicting synced reports (oldest first) if that is what it takes. */
function persist(saves: SavedTeamAnalysis[]): boolean {
  const list = [...saves];
  if (tryWrite(list)) return true;
  const evictable = list
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.synced && s.report)
    .sort((a, b) => (a.s.savedAt < b.s.savedAt ? -1 : 1));
  for (const { i } of evictable) {
    list[i] = stubOf(list[i]);
    if (tryWrite(list)) return true;
  }
  return false;
}

function asMeta(x: unknown): TeamSaveMeta | null {
  if (!x || typeof x !== 'object') return null;
  const m = x as TeamSaveMeta;
  if (typeof m.id !== 'string' || !SAVE_ID.test(m.id)) return null;
  if (typeof m.name !== 'string' || typeof m.savedAt !== 'string') return null;
  return {
    id: m.id,
    name: m.name,
    savedAt: m.savedAt,
    mode: m.mode === 'scout' ? 'scout' : 'squads',
    players: Number(m.players) || 0,
    folders: Number(m.folders) || 0,
  };
}

/** What goes over the wire: the whole record, minus the local-only flags. */
function wire(save: SavedTeamAnalysis): SavedTeamAnalysis {
  const { synced: _s, meta: _m, ...rest } = save;
  void _s;
  void _m;
  return rest;
}

let syncing: Promise<void> | null = null;

export const useTeamSaves = create<TeamSavesState>((set, get) => {
  /** Mark one entry synced (or not) without disturbing anything else. */
  const mark = (id: string, synced: boolean) => {
    const next = get().saves.map((s) => (s.id === id ? { ...s, synced } : s));
    set({ saves: next });
    persist(next);
  };

  const upload = async (id: string) => {
    const s = get().saves.find((x) => x.id === id);
    if (!s?.report) return;
    const savedAt = s.savedAt;
    if (await pushTeamSave(wire(s))) {
      // Only if nothing newer was written while the request was in flight.
      if (get().saves.find((x) => x.id === id)?.savedAt === savedAt) mark(id, true);
    }
  };

  return {
    saves: load(),

    save: (entry, id) => {
      const saves = get().saves;
      const existing = id ? saves.findIndex((s) => s.id === id) : -1;
      if (existing < 0 && saves.length >= MAX_SAVES) return { ok: false, reason: 'full' };

      const record: SavedTeamAnalysis = {
        ...entry,
        report: compactReport(entry.report),
        id: existing >= 0 ? saves[existing].id : newSaveId(),
        savedAt: new Date().toISOString(),
        synced: false,
      };

      /* An UPDATE moves the entry to the front — it is the most recently
         touched thing in a list ordered by that. */
      const next =
        existing >= 0
          ? [record, ...saves.slice(0, existing), ...saves.slice(existing + 1)]
          : [record, ...saves];

      if (!persist(next)) {
        const alone = JSON.stringify([record]).length;
        return { ok: false, reason: alone > MAX_BYTES ? 'too-large' : 'unwritable' };
      }
      set({ saves: next });
      void upload(record.id);
      return { ok: true, id: record.id };
    },

    rename: (id, name) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      const before = get().saves.find((s) => s.id === id);
      if (!before || before.name === trimmed) return;
      const next = get().saves.map((s) => (s.id === id ? { ...s, name: trimmed } : s));
      if (!persist(next)) return;
      set({ saves: next });
      if (before.synced) {
        void renameTeamSave(id, trimmed).then((ok) => {
          /* Could not reach the account: re-upload the whole record next sync
             if it is here; a stub's rename is simply lost to the account's. */
          if (!ok && get().saves.find((s) => s.id === id)?.report) mark(id, false);
        });
      }
    },

    remove: (id) => {
      const target = get().saves.find((s) => s.id === id);
      const next = get().saves.filter((s) => s.id !== id);
      // A shorter list can still fail the write; dropping it from memory
      // anyway would resurrect it on reload.
      if (!persist(next)) return;
      set({ saves: next });
      if (target?.synced) {
        writeDeletes([...loadDeletes().filter((x) => x !== id), id]);
        void deleteTeamSave(id).then((ok) => {
          if (ok) writeDeletes(loadDeletes().filter((x) => x !== id));
        });
      }
    },

    sync: () => {
      /* One at a time. Two tabs mounting at once would otherwise upload the
         same unsynced save twice — harmless, but it is two megabytes. */
      if (syncing) return syncing;
      syncing = (async () => {
        const pending = loadDeletes();
        for (const id of pending) {
          if (await deleteTeamSave(id)) writeDeletes(loadDeletes().filter((x) => x !== id));
        }
        const raw = await pullTeamSaveIndex();
        if (!raw) return; // unreachable is NOT empty — see syncClient
        const remote = raw.map(asMeta).filter((m): m is TeamSaveMeta => !!m);
        const { saves, upload: toUpload } = mergeSaves(get().saves, remote, loadDeletes());
        set({ saves });
        persist(saves);
        for (const id of toUpload) await upload(id);
      })().finally(() => {
        syncing = null;
      });
      return syncing;
    },

    full: async (id) => {
      const here = get().saves.find((s) => s.id === id);
      if (here && isFullSave(here)) return here;
      const got = await pullTeamSave(id);
      if (!isFullSave(got) || got.id !== id) return null;
      const record = { ...wire(got), synced: true } as SavedTeamAnalysis & { report: TeamReport };
      const next = get().saves.map((s) => (s.id === id ? record : s));
      set({ saves: next });
      persist(next);
      return record;
    },
  };
});

/**
 * A name for a board nobody has named yet.
 *
 * The opponent is what a coach is preparing for, so the opponent is what the
 * row is called. Names come from the SERVER's resolution, which falls back to
 * the tag when nothing knows a name — so "vs #2PP0PYLQ" is the honest label.
 */
export function defaultSaveName(report: TeamReport): string {
  const opponents = report.folders.map((f) => f.player.name || f.player.tag);
  /* THE PREPOSITION IS THE MODE. "vs Ravi" is a match — two sides; a
     scouting report has only one. */
  const verb = report.mode === 'scout' ? 'Scouting' : 'vs';
  if (!opponents.length) return report.mode === 'scout' ? 'Scouting report' : 'Team analysis';
  if (opponents.length === 1) return `${verb} ${opponents[0]}`.slice(0, 60);
  return `${verb} ${opponents[0]} +${opponents.length - 1}`.slice(0, 60);
}
