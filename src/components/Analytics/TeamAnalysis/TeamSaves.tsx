import { useEffect, useRef, useState } from 'react';
import { saveMode, useTeamSaves, type SavedTeamAnalysis } from '../../../state/teamSaves';
import { ago } from '../../../utils/format';
import styles from './TeamAnalysis.module.css';

/**
 * The saved analyses, listed under the entry board.
 *
 * ── WHY IT SITS ABOVE THE RESULT AND NOT INSIDE IT ────────────────────────
 *
 * A saved board is something you come BACK for, so the list has to be visible
 * on the screen as you first find it — before anything has been pasted and
 * before anything has been run. Putting it beside the results would mean the
 * only way to reach last week's analysis is to perform this week's first.
 *
 * ── EVERY ROW STATES ITS AGE, AND THAT IS NOT DECORATION ──────────────────
 *
 * Every figure in a stored report was measured over a window that closed when
 * the analysis ran. Re-opening it shows what was true then. A row that read
 * only "vs Mohamed Light" would present a fortnight-old spread as the current
 * one, which is the single way this feature could mislead — so the age is part
 * of the row, not a tooltip on it.
 */

function Row({
  save,
  open,
  onOpen,
}: {
  save: SavedTeamAnalysis;
  open: boolean;
  onOpen: (save: SavedTeamAnalysis) => void;
}) {
  const rename = useTeamSaves((s) => s.rename);
  const remove = useTeamSaves((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(save.name);
  const [confirming, setConfirming] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  const commit = () => {
    rename(save.id, draft);
    setEditing(false);
  };

  const players = save.report.blue.length + save.report.red.length;
  const mode = saveMode(save);

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
            /* Escape restores the STORED name rather than the draft — a
               cancelled rename that leaves the typing behind has not been
               cancelled. */
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
      {/* THE WHOLE ROW OPENS IT. The two small controls beside it are the
          exceptions, which is why they are buttons in their own right and why
          this one is not a wrapper around them — a button inside a button is
          invalid HTML and the browser closes the outer one early, a trap this
          project has already hit once on the Duel Zone's series row. */}
      <button type="button" className={styles.saveOpen} onClick={() => onOpen(save)}>
        <span className={styles.saveTitle}>
          {/* WHICH TAB THIS CAME OUT OF. One list holds both, because twelve
              saves is twelve saves however they were made and splitting them
              would mean two short lists that each look empty. Opening a row
              switches to its own tab, so the badge is also the answer to "why
              did the screen just change under me". */}
          <span className={styles.saveMode} data-mode={mode}>
            {mode === 'scout' ? 'Scout' : 'Match'}
          </span>
          {save.name}
        </span>
        <span className={styles.saveMeta}>
          {players} player{players === 1 ? '' : 's'} · {save.report.folders.length} folder
          {save.report.folders.length === 1 ? '' : 's'} · saved {ago(save.savedAt)}
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
            sit at thumb height on a phone next to the row that OPENS them, and
            the thing being destroyed cannot be recovered by re-running: the
            window it measured has moved. */}
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
  onOpen: (save: SavedTeamAnalysis) => void;
}) {
  const saves = useTeamSaves((s) => s.saves);
  if (!saves.length) return null;

  return (
    <section className={styles.saves}>
      <h3 className={styles.savesTitle}>Saved analyses</h3>
      <ul className={styles.saveList}>
        {saves.map((s) => (
          <Row key={s.id} save={s} open={s.id === openId} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
