import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { markRuns, searchCommands, tagFromQuery, type Searchable } from '../../utils/commandSearch';
import { modLabel } from '../../utils/keys';
import styles from './CommandPalette.module.css';

/**
 * THE COMMAND PALETTE — Ctrl/⌘ K or "/" from anywhere in the shell.
 *
 * Every screen, tool and action, and any player tag, one keystroke away. The
 * top bar's tag pill stays as the visible way in; this is the fast one.
 *
 * ── HOW IT BEHAVES, AND WHY ──────────────────────────────────────────────
 *
 * FOCUS NEVER LEAVES THE INPUT. Arrow keys move a highlighted row
 * (`aria-activedescendant`), so the reader can keep typing, correct a letter
 * and press Enter without ever tabbing into the list. A click on a row does
 * not steal focus either — the list cancels its own mousedown.
 *
 * GROUPS KEEP THEIR ORDER while rows re-rank inside them (utils/commandSearch),
 * so the eye learns where "Tools" lives. A tag-shaped query adds a first row
 * that opens it, whatever else matches.
 *
 * PORTALLED AND OPAQUE, like every floating panel here: the header's
 * backdrop-filter would trap it otherwise, and a translucent panel over a busy
 * board is unreadable.
 */

export interface PaletteCommand extends Searchable {
  id: string;
  icon: ReactNode;
  /** Identity hue for the icon tile: violet / blue / pink / green / red. */
  hue?: string;
  /** Printed key hints, e.g. ['G', 'M']. */
  keys?: string[];
  run: () => void;
}

const GROUPS = ['Player', 'Recent players', 'Analytics', 'Tools', 'Actions'];

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function Marked({ text, idx }: { text: string; idx: number[] }) {
  if (!idx.length) return <>{text}</>;
  return (
    <>
      {markRuns(text, idx).map((r, i) => (r.mark ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onTag,
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  /** Opens the analysis for a typed tag. */
  onTag: (tag: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const uid = useId().replace(/:/g, '');

  const rows = useMemo(() => {
    const tag = tagFromQuery(query);
    const found = searchCommands(commands, query, GROUPS);
    if (!tag) return found;
    const open: PaletteCommand = {
      id: `tag-${tag}`,
      group: 'Player',
      label: `Open the analysis for ${tag}`,
      sub: 'Any tag works, stored here or not',
      icon: <SearchGlyph />,
      hue: 'violet',
      run: () => onTag(tag),
    };
    return [{ item: open, idx: [], subIdx: [], score: 0 }, ...found];
  }, [commands, query, onTag]);

  /* Opening: remember who had focus, start clean, focus the field — in a
     LAYOUT effect, before the browser paints. It was a frame later at first,
     and a fast typist's first letters landed on the page instead, where "t"
     switched the theme and "e" asked for an export. Measured by a script that
     typed straight after Ctrl-K. */
  useLayoutEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    input.current?.focus();
  }, [open]);

  // Keep the highlighted row inside the list's view.
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`#${uid}-opt-${active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, uid]);

  if (!open) return null;

  const close = () => {
    onClose();
    // Back to wherever the reader was, unless an action moved them on.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) returnTo.current?.focus?.();
    });
  };

  const runAt = (i: number) => {
    const row = rows[i];
    if (!row) return;
    onClose();
    row.item.run();
  };

  const count = rows.length;
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (count) setActive((a) => (a + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) setActive((a) => (a - 1 + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // The palette is modal; focus stays in its one field.
      e.preventDefault();
    }
  };

  let lastGroup = '';
  const mod = modLabel();

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.inputRow}>
          <SearchGlyph />
          <input
            ref={input}
            className={styles.input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search a player tag, a screen or an action"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={count ? `${uid}-opt-${active}` : undefined}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <ul
          ref={list}
          id={`${uid}-list`}
          className={styles.list}
          role="listbox"
          aria-label="Results"
          onMouseDown={(e) => e.preventDefault()}
        >
          {count === 0 && (
            <li className={styles.empty} role="presentation">
              Nothing matches “{query.trim()}”. Try a screen name such as “meta”, or a player tag.
            </li>
          )}
          {rows.map((row, i) => {
            const head = row.item.group !== lastGroup ? row.item.group : null;
            lastGroup = row.item.group;
            return (
              <li key={row.item.id} role="presentation">
                {head && (
                  <div className={styles.group} role="presentation">
                    {head}
                  </div>
                )}
                <div
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={styles.option}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => runAt(i)}
                >
                  <span className={styles.icon} data-hue={row.item.hue}>
                    {row.item.icon}
                  </span>
                  <span className={styles.text}>
                    <span className={styles.label}>
                      <Marked text={row.item.label} idx={row.idx} />
                    </span>
                    {row.item.sub && (
                      <span className={styles.sub}>
                        <Marked text={row.item.sub} idx={row.subIdx} />
                      </span>
                    )}
                  </span>
                  {row.item.keys && (
                    <span className={styles.keys} aria-hidden="true">
                      {row.item.keys.map((k) => (
                        <kbd key={k} className={styles.kbd}>
                          {k === 'Mod' ? mod : k}
                        </kbd>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className={styles.foot} aria-hidden="true">
          <span><kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> move</span>
          <span><kbd className={styles.kbd}>↵</kbd> open</span>
          <span><kbd className={styles.kbd}>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
