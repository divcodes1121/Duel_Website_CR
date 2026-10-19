/* Players by name, under a search field, as you type.
 *
 * It ATTACHES to an input it is handed rather than rendering one, because the
 * three fields it serves are three different things: the top bar's gooey pill
 * (a vendored component that owns its own input), the player screen's query
 * row and the landing hero's form. Each keeps its own look and its own submit;
 * this adds the list.
 *
 * The rows are: "Open #TAG" when the text can be a tag, then up to seven
 * players by name, then "View all N results" -> `#/search?q=`. Arrow keys move,
 * Enter opens the highlighted row; with nothing highlighted Enter is the
 * field's own (or `onSubmit` for the pill, which has none).
 *
 * FAST BY CONSTRUCTION: a 160 ms pause after the last key, one request at a
 * time with older answers dropped by sequence number, and every answer cached
 * so backspacing asks nothing. The server answers from its own trigram index
 * in milliseconds (`server/name_index.py`).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { searchPlayers, type NameSearch } from '../../state/analyticsClient';
import {
  AnswerCache,
  DEBOUNCE_MS,
  MAX_QUERY,
  SUGGEST_LIMIT,
  asTag,
  countLabel,
  minChars,
} from '../../utils/nameSearch';
import styles from './NameSuggest.module.css';

/** Shared by every field and the results page's first screenful. */
export const suggestCache = new AnswerCache<NameSearch>(300);

type Row =
  | { kind: 'tag'; tag: string }
  | { kind: 'player'; tag: string; name: string; tracked: boolean }
  | { kind: 'all'; query: string; total: number; capped: boolean };

function go(hash: string) {
  if (window.location.hash !== hash) window.location.hash = hash;
}

export function NameSuggest({
  input,
  anchor,
  onSubmit,
  minWidth = 340,
}: {
  /** The field to listen to. Null while it does not exist (the pill). */
  input: HTMLInputElement | null;
  /** What to measure the panel against; the input when absent. */
  anchor?: HTMLElement | null;
  /** Enter with no row highlighted. Absent = the field's own form submits. */
  onSubmit?: (text: string) => void;
  minWidth?: number;
}) {
  const listId = `ns-${useId().replace(/:/g, '')}`;
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<NameSearch | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const seq = useRef(0);

  const query = text.trim().slice(0, MAX_QUERY);
  const asked = query.length >= minChars(query) ? query : '';
  const tag = query.length >= 3 ? asTag(query) : null;
  const shown = answer && answer.query === asked ? answer : null;

  const rows: Row[] = [];
  if (tag) rows.push({ kind: 'tag', tag });
  for (const r of shown?.results ?? []) rows.push({ kind: 'player', ...r });
  if (shown && shown.total > shown.results.length)
    rows.push({ kind: 'all', query: asked, total: shown.total, capped: shown.capped });

  /* Ask, after a pause, unless the answer is already in hand. */
  useEffect(() => {
    if (!asked) {
      setAnswer(null);
      return;
    }
    const key = `${asked}|${SUGGEST_LIMIT}`;
    const hit = suggestCache.get(key);
    if (hit) {
      setAnswer(hit);
      return;
    }
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      searchPlayers(asked, SUGGEST_LIMIT)
        .then((a) => {
          suggestCache.set(key, a);
          if (mine === seq.current) setAnswer(a);
        })
        .catch(() => {
          /* A type-ahead that fails says nothing; the field still takes a tag. */
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [asked]);

  useEffect(() => setActive(-1), [asked]);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  const pick = useCallback(
    (row: Row) => {
      close();
      input?.blur();
      if (row.kind === 'all') go(`#/search?q=${encodeURIComponent(row.query)}`);
      else go(`#/player/${encodeURIComponent(row.tag)}`);
    },
    [close, input],
  );

  /* The field's own events. Read through refs so the listeners are bound once
     per input, not once per keystroke. */
  const live = useRef({ rows, active, open, onSubmit, pick });
  useLayoutEffect(() => {
    live.current = { rows, active, open, onSubmit, pick };
  });

  useEffect(() => {
    if (!input) return;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('autocomplete', 'off');
    const onInput = () => {
      setText(input.value);
      setOpen(true);
    };
    const onFocus = () => {
      setText(input.value);
      setOpen(true);
    };
    const onBlur = () => window.setTimeout(close, 0);
    const onKey = (e: KeyboardEvent) => {
      const { rows: rs, active: a, open: o, onSubmit: submit, pick: choose } = live.current;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!rs.length) return;
        e.preventDefault();
        setOpen(true);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(o && a !== -1 ? (a + step + rs.length) % rs.length : step === 1 ? 0 : rs.length - 1);
      } else if (e.key === 'Enter') {
        if (o && a >= 0 && rs[a]) {
          e.preventDefault();
          e.stopPropagation();
          choose(rs[a]);
        } else if (submit && input.value.trim()) {
          e.preventDefault();
          close();
          submit(input.value);
        } else {
          close();
        }
      } else if (e.key === 'Escape' && o) {
        e.stopPropagation();
        close();
      }
    };
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKey);
    if (document.activeElement === input) onFocus();
    return () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKey);
    };
  }, [input, listId, close]);

  const visible = open && !!input && rows.length + (shown && !shown.results.length ? 1 : 0) > 0;

  useEffect(() => {
    if (!input) return;
    input.setAttribute('aria-expanded', String(visible));
    if (visible && active >= 0) input.setAttribute('aria-activedescendant', `${listId}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }, [input, visible, active, listId]);

  /* Hang the panel under the field, kept on screen. */
  useLayoutEffect(() => {
    if (!visible) return;
    const el = anchor ?? input;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const width = Math.min(Math.max(r.width, minWidth), vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      setBox({ left, top: r.bottom + 6, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [visible, anchor, input, minWidth, rows.length]);

  if (!visible || !box) return null;

  return createPortal(
    <div
      className={styles.panel}
      style={{ left: box.left, top: box.top, width: box.width }}
      onMouseDown={(e) => e.preventDefault()}
      data-name-suggest
    >
      <ul id={listId} role="listbox" aria-label="Players" className={styles.list}>
        {rows.map((row, i) => {
          const on = i === active;
          const common = {
            id: `${listId}-${i}`,
            role: 'option' as const,
            'aria-selected': on,
            className: styles.row,
            'data-active': on || undefined,
            onMouseEnter: () => setActive(i),
            onClick: () => pick(row),
          };
          if (row.kind === 'tag')
            return (
              <li key="tag" {...common} data-kind="tag">
                <span className={styles.name}>Open {row.tag}</span>
              </li>
            );
          if (row.kind === 'all')
            return (
              <li key="all" {...common} data-kind="all">
                View all {countLabel(row.total, row.capped)} results
              </li>
            );
          return (
            <li key={row.tag} {...common}>
              <span className={styles.who}>
                <span className={styles.name}>{row.name}</span>
                <span className={styles.tag}>{row.tag}</span>
              </span>
              {row.tracked && (
                <span className={styles.tracked} title="Deckkies stores this player's battles">
                  Tracked
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {shown && !shown.results.length && (
        <p className={styles.empty}>
          {shown.available ? 'No stored player has this name.' : 'Name search is unavailable. Use a tag.'}
        </p>
      )}
    </div>,
    document.body,
  );
}
