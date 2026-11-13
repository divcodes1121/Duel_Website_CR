import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RecentBattle } from '../../../state/analyticsClient';
import { findReplayFor, keepReplay, replayFits } from '../../../state/replayLibrary';
import { ReplayParseError, parseReplay, seenBy, stampToUnix, type Replay } from '../../../utils/replayParse';
import { ReplayViewer } from './ReplayViewer';
import styles from './Replay.module.css';

/**
 * "Watch the match" — one Recent Battles row, played back on the arena plan.
 * ADMIN ONLY: the row draws the button only for an admin (RecentBattles.tsx).
 *
 * NO PAGE OF ITS OWN, on request: the battle is already on screen, so the
 * replay opens over it and closes back to it.
 *
 * THE FIRST TIME, IT NEEDS THE BATTLE'S REPLAY PAGE. Our stored battles carry
 * no replay (see `state/replayLibrary.ts`); RoyaleAPI's replay page does, and
 * RoyaleAPI refuses automated reads. So the dialog links to the player's
 * battles there and takes the saved page by drop or file picker. It is read on
 * this machine, checked against the row (the same two players, and the same
 * moment when the page says), kept in this browser and tied to the row — the
 * next press of Watch plays at once.
 *
 * ALWAYS FROM THE ROW'S SEAT: the searched player is blue at the bottom, as in
 * the row, whichever player's page the replay was saved from.
 *
 * Lazy: the button's chunk loads on the first press, so nobody else's page
 * carries a line of it.
 */

const ACCEPT = '.html,.htm,.mhtml,.mht,text/html,multipart/related';

function royaleApiBattles(tag: string): string {
  return `https://royaleapi.com/player/${encodeURIComponent(tag.replace(/^#/, '').toUpperCase())}/battles`;
}

function day(unix: number): string {
  try {
    return new Date(unix * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function WatchMatch({
  battle,
  you,
  youTag,
  onClose,
}: {
  battle: RecentBattle;
  /** The searched player's name, as the row shows it. */
  you: string;
  youTag: string;
  onClose: () => void;
}) {
  const unix = stampToUnix(battle.battleTime);
  const tags: [string, string] = [youTag, battle.opponent.tag];
  const [replay, setReplay] = useState<Replay | null>(() => {
    const kept = findReplayFor({ id: battle.id, tags, unix });
    return kept ? seenBy(kept.replay, youTag) : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opponent = battle.opponent.name || battle.opponent.tag || 'Opponent';

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // The page under the dialog must not scroll with it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
      before?.focus?.();
    };
  }, [onClose]);

  const openFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setError(null);
      setNotice(null);
      setReading(true);
      try {
        const parsed = parseReplay(await file.text());
        const fit = replayFits(parsed, { tags, unix });
        if (fit === 'other-players') {
          setError(`That replay is ${parsed.players.blue.name} against ${parsed.players.red.name} — not this battle.`);
          return;
        }
        // Tie it to this row unless it is plainly another battle.
        keepReplay(parsed, Date.now(), fit === 'other-time' ? undefined : battle.id);
        if (fit === 'other-time' && parsed.battleTime != null) {
          setNotice(`This is another battle between the two of them, played ${day(parsed.battleTime)}.`);
        } else if (fit === 'unknown-players') {
          setNotice('The page did not name its players, so it could not be checked against this battle.');
        }
        setReplay(seenBy(parsed, youTag));
      } catch (e) {
        setError(e instanceof ReplayParseError ? e.message : 'That file could not be read.');
      } finally {
        setReading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    // `tags` is rebuilt each render from the same two strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [battle.id, youTag, battle.opponent.tag, unix],
  );

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-match-title"
        tabIndex={-1}
        data-over={over ? '' : undefined}
        data-empty={replay ? undefined : ''}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void openFile(e.dataTransfer.files?.[0]);
        }}
      >
        <header className={styles.dialogHead}>
          <div className={styles.headText}>
            <h2 className={styles.title} id="watch-match-title">
              Watch the match
              <span className={styles.titleVs}>
                <span data-side="blue">{you}</span>
                <span className={styles.titleScore}>
                  {battle.crowns}–{battle.opponentCrowns}
                </span>
                <span data-side="red">{opponent}</span>
              </span>
            </h2>
            <p className={styles.lede}>
              {replay
                ? 'Space plays · ← → move a second · 1–5 set the speed · press any card to jump to it.'
                : 'Open this battle on RoyaleAPI, press Replay, let it load, save the page (Ctrl+S) and drop it here.'}
            </p>
          </div>
          <div className={styles.headActions}>
            {replay && (
              <button type="button" className={styles.ghostBtn} onClick={() => fileRef.current?.click()}>
                Another file
              </button>
            )}
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => void openFile(e.target.files?.[0])}
          />
        </header>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && !error && <p className={styles.notice}>{notice}</p>}

        <div className={styles.dialogBody}>
          {replay ? (
            <ReplayViewer key={replay.id} replay={replay} />
          ) : (
            <div className={styles.fetchStep}>
              <a
                className={styles.primaryBtn}
                href={royaleApiBattles(youTag)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {you}’s battles on RoyaleAPI ↗
              </a>
              <button
                type="button"
                className={styles.drop}
                onClick={() => fileRef.current?.click()}
                disabled={reading}
              >
                <svg viewBox="0 0 48 48" aria-hidden="true" className={styles.dropIcon}>
                  <rect x="9" y="5" width="30" height="38" rx="5" />
                  <path d="M17 20h14M17 27h14M17 34h8" />
                  <circle cx="35" cy="35" r="8" className={styles.dropPlay} />
                  <path d="M33 31.5l5 3.5-5 3.5z" className={styles.dropPlayMark} />
                </svg>
                <strong>{reading ? 'Reading the replay…' : 'Drop the saved replay page'}</strong>
                <span>or press to choose the file</span>
              </button>
            </div>
          )}
        </div>

        {over && (
          <div className={styles.dropVeil} aria-hidden="true">
            <span>Drop to watch</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default WatchMatch;
