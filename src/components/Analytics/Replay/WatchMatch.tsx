import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RecentBattle } from '../../../state/analyticsClient';
import { findReplayFor, keepReplay, replayFits } from '../../../state/replayLibrary';
import { SHARE_PROBLEM_TEXT, fetchSharedReplay, shareReplay, unshareReplay } from '../../../state/replayStore';
import { ReplayParseError, parseReplay, seenBy, stampToUnix, type Replay } from '../../../utils/replayParse';
import { ReplayViewer } from './ReplayViewer';
import styles from './Replay.module.css';

/**
 * "Watch the match" — one Recent Battles row, played back on the arena plan.
 *
 * FROM OUR SERVER. A battle with a replay in the shared library
 * (`api/replays.ts`) plays straight away — no RoyaleAPI, no file. ADMINS
 * ONLY for now (`REPLAYS_FOR` in state/replayStore.ts); set to 'everyone',
 * the row draws Watch for anybody on a battle that has a replay.
 *
 * AN ADMIN IMPORTS IT ONCE. Our stored battles carry no replay and RoyaleAPI
 * refuses automated reads, so for a battle with no replay yet an admin sees
 * "+ Replay": the dialog links to the player's battles on RoyaleAPI and takes
 * the saved replay page (drop or file picker). It is read on the admin's
 * machine, checked against the row, kept in this browser, and SHARED — from
 * then on it is in everyone's Recent Battles. A replay this browser already
 * held from before the library existed is shared the first time it is opened.
 *
 * ALWAYS FROM THE ROW'S SEAT: the searched player is blue at the bottom,
 * whichever player's page the replay came from (`seenBy`).
 *
 * Lazy: fetched on the first press of a Watch button.
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
  shareKey,
  shared,
  canImport,
  onShared,
  onUnshared,
  onClose,
}: {
  battle: RecentBattle;
  /** The searched player's name, as the row shows it. */
  you: string;
  youTag: string;
  /** The battle's key in the shared library (`battleKeyFor`). */
  shareKey: string | null;
  /** The shared library holds this battle. */
  shared: boolean;
  /** An admin: may import, share and remove. */
  canImport: boolean;
  onShared: (key: string) => void;
  onUnshared: (key: string) => void;
  onClose: () => void;
}) {
  const unix = stampToUnix(battle.battleTime);
  const tags: [string, string] = [youTag, battle.opponent.tag];
  const [kept] = useState(() => findReplayFor({ id: battle.id, tags, unix }));
  const [replay, setReplay] = useState<Replay | null>(() => (!shared && kept ? seenBy(kept.replay, youTag) : null));
  const [isShared, setIsShared] = useState(shared);
  const [loading, setLoading] = useState(shared);
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

  /* A shared replay: from our server. Kept in this browser too, so a second
     look costs nothing; the browser's copy stands in if the server fails. */
  useEffect(() => {
    if (!shared || !shareKey) return;
    let live = true;
    void fetchSharedReplay(shareKey).then((r) => {
      if (!live) return;
      if (r) {
        keepReplay(r, Date.now(), battle.id);
        setReplay(seenBy(r, youTag));
      } else if (kept) {
        setReplay(seenBy(kept.replay, youTag));
      } else {
        setError('This replay could not be loaded. Try again in a moment.');
      }
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [shared, shareKey, battle.id, youTag, kept]);

  const share = useCallback(
    async (r: Replay) => {
      if (!canImport || !shareKey) return;
      const out = await shareReplay(shareKey, r);
      if (out.ok) {
        setIsShared(true);
        onShared(shareKey);
      } else {
        setNotice(SHARE_PROBLEM_TEXT[out.reason]);
      }
    },
    [canImport, shareKey, onShared],
  );

  /* A replay this browser held before the shared library existed: an admin
     opening it shares it, so the import they already did counts for everyone. */
  useEffect(() => {
    if (!shared && kept && canImport) void share(kept.replay);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setReplay(seenBy(parsed, youTag));
        if (fit === 'other-time' && parsed.battleTime != null) {
          setNotice(`This is another battle between the two of them, played ${day(parsed.battleTime)} — not shared.`);
          return;
        }
        if (fit === 'unknown-players') {
          setNotice('The page did not name its players, so it could not be checked against this battle.');
        }
        await share(parsed);
      } catch (e) {
        setError(e instanceof ReplayParseError ? e.message : 'That file could not be read.');
      } finally {
        setReading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    // `tags` is rebuilt each render from the same two strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [battle.id, youTag, battle.opponent.tag, unix, share],
  );

  const remove = async () => {
    if (!shareKey) return;
    if (await unshareReplay(shareKey)) {
      onUnshared(shareKey);
      onClose();
    } else {
      setNotice('It could not be removed. Try again in a moment.');
    }
  };

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
          if (!canImport || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setOver(false);
        }}
        onDrop={(e) => {
          if (!canImport) return;
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
                : loading
                  ? 'Loading the replay…'
                  : canImport
                    ? 'Open this battle on RoyaleAPI, press Replay, let it load, save the page (Ctrl+S) and drop it here — it is then shared with everyone.'
                    : 'No replay for this battle yet.'}
            </p>
          </div>
          <div className={styles.headActions}>
            {replay?.url && (
              <a className={styles.source} href={replay.url} target="_blank" rel="noopener noreferrer">
                Replay data: RoyaleAPI
              </a>
            )}
            {canImport && isShared && replay && (
              <button type="button" className={styles.ghostBtn} onClick={() => void remove()} title="Remove this replay for everyone">
                Remove
              </button>
            )}
            {canImport && replay && (
              <button type="button" className={styles.ghostBtn} onClick={() => fileRef.current?.click()}>
                Another file
              </button>
            )}
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          {canImport && (
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => void openFile(e.target.files?.[0])}
            />
          )}
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
          ) : loading ? (
            <p className={styles.loadingLine}>Loading the replay…</p>
          ) : canImport ? (
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
          ) : null}
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
