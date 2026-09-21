import { useEffect, useRef, useState } from 'react';
import type { TeamReport } from '../../../state/analyticsClient';
import { saveCounts, useTeamSaves, type SavedTeamAnalysis } from '../../../state/teamSaves';
import { ago } from '../../../utils/format';
import styles from './TeamAnalysis.module.css';

type FullSave = SavedTeamAnalysis & { report: TeamReport };

/**
 * The saved analyses, listed under the entry board.
 *
 * ── WHY IT SITS ABOVE THE RESULT AND NOT INSIDE IT ────────────────────────
 *
 * A saved board is something you come BACK for, so the list has to be visible
 * on the screen as you first find it — before anything has been pasted and
 * before anything has been run.
 *
 * ── IT IS ALWAYS THERE, EVEN EMPTY ────────────────────────────────────────
 *
 * It used to render nothing with no saves, and on a phone — where every save
 * was on the desktop, because saves never left the browser that made them —
 * that meant no sign the feature existed ("in the mobile layout I can't see
 * saved analysis", 2026-09-21). Saves sync through the account now, and the
 * heading stays so an empty list reads as empty rather than missing.
 *
 * ── EVERY ROW STATES ITS AGE ──────────────────────────────────────────────
 *
 * Every figure in a stored report was measured over a window that closed when
 * the analysis ran, so the age is part of the row, not a tooltip on it.
 */

function Row({
  save,
  open,
  onOpen,
}: {
  save: SavedTeamAnalysis;
  open: boolean;
  onOpen: (save: FullSave) => void;
}) {
  const rename = useTeamSaves((s) => s.rename);
  const remove = useTeamSaves((s) => s.remove);
  const full = useTeamSaves((s) => s.full);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(save.name);
  const [confirming, setConfirming] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  const commit = () => {
    rename(save.id, draft);
    setEditing(false);
  };

  /* A SAVE FROM ANOTHER DEVICE IS FETCHED ON OPEN — the list carries only its
     name, date and counts until then. */
  const openIt = async () => {
    if (fetching) return;
    setFailed(false);
    setFetching(true);
    const got = await full(save.id);
    setFetching(false);
    if (got) onOpen(got);
    else setFailed(true);
  };

  const { mode, players, folders } = saveCounts(save);

  if (editing) {
    return (
      <li className={styles.saveRow}>
        <input
          ref={field}
          className={styles.saveName}
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            /* Escape restores the STORED name — a cancelled rename that leaves
               the typing behind has not been cancelled. */
            if (e.key === 'Escape') {
              setDraft(save.name);
              setEditing(false);
            }
          }}
          onBlur={commit}
          aria-label="Analysis name"
        />
      </li>
    );
  }

  return (
    <li className={styles.saveRow} data-open={open || undefined}>
      {/* THE WHOLE ROW OPENS IT. The two small controls beside it are buttons
          in their own right, not children of this one — a button inside a
          button is invalid HTML. */}
      <button
        type="button"
        className={styles.saveOpen}
        onClick={() => void openIt()}
        aria-busy={fetching || undefined}
      >
        <span className={styles.saveTitle}>
          {/* WHICH TAB THIS CAME OUT OF. Opening a row switches to its own tab,
              so the badge is also the answer to "why did the screen change". */}
          <span className={styles.saveMode} data-mode={mode}>
            {mode === 'scout' ? 'Scout' : 'Match'}
          </span>
          {save.name}
        </span>
        <span className={styles.saveMeta}>
          {fetching
            ? 'Opening…'
            : failed
              ? 'Could not load — try again'
              : `${players} player${players === 1 ? '' : 's'} · ${folders} folder${folders === 1 ? '' : 's'} · saved ${ago(save.savedAt)}`}
        </span>
      </button>

      <div className={styles.saveActions}>
        <button
          type="button"
          className={styles.saveChip}
          onClick={() => {
            setDraft(save.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
        {/* TWO TAPS TO DELETE, and the second one says what it does. These rows
            sit at thumb height on a phone next to the row that OPENS them. */}
        <button
          type="button"
          className={styles.saveChip}
          data-danger={confirming || undefined}
          onClick={() => (confirming ? remove(save.id) : setConfirming(true))}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? 'Delete?' : 'Delete'}
        </button>
      </div>
    </li>
  );
}

export function SavedAnalyses({
  openId,
  onOpen,
}: {
  openId: string | null;
  onOpen: (save: FullSave) => void;
}) {
  const saves = useTeamSaves((s) => s.saves);
  const sync = useTeamSaves((s) => s.sync);

  /* Reconcile with the account on arrival — this is what brings a save made
     on another device into the list. A no-op when the account is unreachable. */
  useEffect(() => {
    void sync();
  }, [sync]);

  return (
    <section className={styles.saves}>
      <h3 className={styles.savesTitle}>Saved analyses</h3>
      {saves.length === 0 ? (
        <p className={styles.savesEmpty}>None yet.</p>
      ) : (
        <ul className={styles.saveList}>
          {saves.map((s) => (
            <Row key={s.id} save={s} open={s.id === openId} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}
