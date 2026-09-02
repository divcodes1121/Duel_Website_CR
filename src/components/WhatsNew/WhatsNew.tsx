import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RELEASES, type Release } from '../../content/releases';
import { useReleaseFeed } from '../../state/whatsNew';
import { BellIcon } from '../Dashboard/icons';
import styles from './WhatsNew.module.css';

/**
 * WHAT'S NEW — the bell in the top bar, and the panel it opens.
 *
 * The bell has been in the chrome since the shell was built and opened
 * nothing; `docs` recorded it as "the only item here that opens nothing yet".
 * It opens this.
 *
 * ── WHY A PANEL AND NOT A ROUTE ───────────────────────────────────────────
 *
 * A changelog is read in the middle of doing something else — you notice the
 * dot, you look, you carry on. A route would take the screen away from
 * whatever it was showing and then need a way back to it, which is three
 * interactions for a thing that is usually one line of interest. Every entry
 * that has somewhere to go carries its own link, so the panel hands you off to
 * the feature rather than describing it and leaving you to find it.
 *
 * ── THE PORTAL IS NOT OPTIONAL ────────────────────────────────────────────
 *
 * The header carries a `backdrop-filter`, which creates a stacking context and
 * traps anything positioned inside it. Every floating thing in this app —
 * ProfileMenu, SeasonMenu, WildVariantMenu, the export dialog — is portalled
 * to `document.body` for that reason, and this is the fifth.
 *
 * ── OPENING IT IS WHAT MARKS IT READ ──────────────────────────────────────
 *
 * Not scrolling to the bottom, not clicking each entry. The badge answers "is
 * there something I have not looked at", and opening the panel is the reader
 * saying they have looked. Anything stricter leaves a dot on screen that the
 * obvious action does not clear, which teaches people to ignore it.
 */

const KIND_LABEL: Record<Release['kind'], string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
};

function day(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Entry({ release, unread, onGo }: {
  release: Release;
  unread: boolean;
  onGo: (hash: string) => void;
}) {
  return (
    <li className={styles.entry} data-unread={unread || undefined}>
      <div className={styles.entryHead}>
        <span className={styles.kind} data-kind={release.kind}>
          {KIND_LABEL[release.kind]}
        </span>
        {/* WHAT A TIER LABEL IS FOR. Everybody sees every entry, including
            things their own tier cannot open — a feed that hid those would
            quietly shrink the product, and knowing what is behind the gate is
            the entire argument for subscribing. The badge is what keeps that
            honest rather than teasing. */}
        {release.needs && (
          <span className={styles.needs} data-needs={release.needs}>
            {release.needs === 'pro' ? 'Pro' : 'Trial and up'}
          </span>
        )}
        <time className={styles.date} dateTime={release.date}>
          {day(release.date)}
        </time>
      </div>

      <h4 className={styles.entryTitle}>{release.title}</h4>
      {release.body.map((p, i) => (
        <p key={i} className={styles.entryBody}>
          {p}
        </p>
      ))}

      {release.href && release.hrefLabel && (
        <button type="button" className={styles.entryGo} onClick={() => onGo(release.href!)}>
          {release.hrefLabel} →
        </button>
      )}
    </li>
  );
}

/** The feed itself: a heading and every entry. Shared by both presentations. */
function ReleaseList({ unreadAtOpen, onGo }: {
  unreadAtOpen: number;
  onGo: (hash: string) => void;
}) {
  return (
    <>
      <header className={styles.head}>
        <h3 className={styles.title}>What&apos;s new</h3>
        <p className={styles.lede}>
          Everything shipped, newest first. Each note goes out with the change it describes.
        </p>
      </header>

      {RELEASES.length === 0 ? (
        <p className={styles.empty}>Nothing shipped yet.</p>
      ) : (
        <ol className={styles.list}>
          {RELEASES.map((r, i) => (
            <Entry key={r.id} release={r} unread={i < unreadAtOpen} onGo={onGo} />
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * THE FEED AS A CENTRED DIALOG, for the profile menu's row.
 *
 * The bell is hidden below 860px because `.topActions` cannot hold it, so on a
 * phone this is the only way in — and there the anchored panel would be wrong
 * anyway: it hangs from a trigger that is not on screen. Same arrangement as
 * `ProContact` and `ChangePassword`, which the profile menu already hosts for
 * the same reason.
 */
export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const { unread, markRead } = useReleaseFeed();
  const [unreadAtOpen] = useState(unread);

  /* Marked read on mount rather than on a click, because opening it IS the
     reading — the same rule the anchored panel follows. In an effect, not in
     render, since it writes to a store and to `localStorage`. */
  useEffect(() => {
    markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function go(hash: string) {
    onClose();
    window.location.hash = hash;
  }

  return createPortal(
    <div className={styles.scrim} onPointerDown={onClose}>
      {/* The sheet stops the scrim's dismiss, so a click inside it — on a link,
          or dragging to select text — does not close the thing being read. */}
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
        <ReleaseList unreadAtOpen={unreadAtOpen} onGo={go} />
      </div>
    </div>,
    document.body,
  );
}

export function WhatsNew({ className }: { className: string }) {
  const { unread, markRead } = useReleaseFeed();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const open = pos !== null;

  /* HOW MANY WERE UNREAD WHEN IT WAS OPENED. Opening marks everything read, so
     without this the "new" rules on the entries would vanish in the same frame
     the panel appeared and the reader would never learn which ones they had
     not seen. Held for as long as the panel is open. */
  const [markedAt, setMarkedAt] = useState(0);

  function toggle() {
    if (open) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMarkedAt(unread);
    setPos({ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) });
    markRead();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setPos(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPos(null);
    }
    /* Closed on resize rather than repositioned, which is what ProfileMenu and
       SeasonMenu already do: the panel is anchored to a rect measured once, and
       a menu that drifts away from its trigger reads worse than one that shut. */
    function onResize() {
      setPos(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function go(hash: string) {
    setPos(null);
    window.location.hash = hash;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        data-metal
        data-open={open || undefined}
        /* A STABLE HOOK FOR CSS, because the label is not one. The phone rule
           that hides this control used to match `[aria-label='Notifications']`
           — and this label now carries the unread count, so a selector on it
           would stop matching the moment somebody had something to read. That
           is the quietest possible failure: the bell reappears on a top bar
           already measured as 43px too wide. */
        data-whats-new=""
        aria-label={
          unread > 0
            ? `What's new — ${unread} unread`
            : "What's new"
        }
        aria-expanded={open}
        onClick={toggle}
      >
        <BellIcon />
        {/* THE COUNT IS THE LABEL, and the dot is not on its own. A bare dot
            says something changed and nothing about how much; a number tells a
            reader whether this is one line or a fortnight of them. It is also
            in the `aria-label` above, because a badge drawn on a glyph is
            invisible to a screen reader. */}
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {createPortal(
        open && pos ? (
          <div
            className={styles.panel}
            style={{ top: pos.top, right: pos.right }}
            role="dialog"
            aria-label="What's new"
          >
            <div ref={panelRef}>
              <ReleaseList unreadAtOpen={markedAt} onGo={go} />
            </div>
          </div>
        ) : null,
        document.body,
      )}
    </>
  );
}
