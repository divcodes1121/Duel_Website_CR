import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from './cn';
import './dropdown-menu-14.css';

/**
 * VENDORED from watermelon.sh — `dropdown-menu-14`, the workspace switcher.
 * https://registry.watermelon.sh/r/dropdown-menu-14.json
 *
 * EVERY SELECT-STYLE DROPDOWN IN THE APP IS THIS NOW. The trigger is the
 * template's: an icon tile, the chosen value over a caption, and an up/down
 * chevron. The panel is the template's too: a heading and a line under it, a
 * rule, labelled groups, rows with a tile and a check on the chosen one.
 *
 * NOT INSTALLED WITH `shadcn add`, for the reasons on the other vendored
 * components here: no `components.json`, no Tailwind, and the demo pulls in
 * `react-icons` plus base-ui's `DropdownMenu` primitives for what is one
 * anchored panel. Ported by hand onto the anchoring this app already uses
 * (`SeasonMenu`, `ProfileMenu`, `WildVariantMenu`: measured off the trigger,
 * portalled to <body> so a `backdrop-filter` ancestor cannot trap it).
 *
 * ── DEVIATIONS, ALL DELIBERATE ────────────────────────────────────────────
 *
 * 1. **A SELECT, NOT A MENU OF ACTIONS.** Upstream is a menu whose items are
 *    clicks; every call site here is choosing ONE value from a set, which is
 *    `role="listbox"` / `role="option"` with `aria-selected`. So: `value`,
 *    `onChange`, `options` — and the template's "Create / Manage workspace"
 *    action rows and its "Recent" group (the current value listed twice) are
 *    not reproduced, because a select has no actions.
 *
 * 2. **IT HAS TO BE AS GOOD AS THE NATIVE SELECTS IT REPLACED, AT THE THINGS
 *    THEY WERE KEPT FOR.** Two call sites were native on purpose — the card
 *    library (keyboard, type-ahead) and onboarding's 200 countries (type-ahead,
 *    screen readers). So: ArrowUp/Down, Home/End, Enter/Space to pick, Esc to
 *    close and hand focus back to the trigger, Tab to close, and type-ahead on
 *    the option labels. `searchable` adds a filter field for long lists.
 *
 * 3. **IT FITS THE WINDOW.** It opens below the trigger, flips above when
 *    there is not room, caps its height to what is left, and clamps its left
 *    edge to the viewport — so a trigger at the edge of a phone does not open a
 *    panel half off the screen.
 *
 * 4. **A COMPACT SIZE.** Upstream's trigger is 260px with a 36px tile, right
 *    for one workspace switcher and far too big for a toolbar of four filters.
 *    `size="sm"` keeps the anatomy — tile, value, caption, chevron — at the
 *    height of the controls around it.
 *
 * 5. **EVERY COLOUR IS A TOKEN.** The trigger's `bg-primary` tile is the
 *    violet SOLID step (selection is violet everywhere here), the panel is an
 *    opaque surface (a translucent dropdown over arbitrary content is a bug),
 *    and the check is `--accent-select`.
 *
 * 6. **THE OPEN IS ONE-SHOT, AND OFF UNDER REDUCED MOTION.**
 */

export interface DropdownOption<V extends string = string> {
  value: V;
  label: string;
  /** Second line in the row. */
  description?: string;
  /** A glyph or a short string for the row's tile. */
  icon?: ReactNode;
  /** Right-aligned note, like upstream's member count. */
  meta?: ReactNode;
  /** Options with the same group are listed under one label, in order. */
  group?: string;
}

export interface DropdownProps<V extends string = string> {
  value: V;
  options: DropdownOption<V>[];
  onChange: (value: V) => void;
  /** Under the value in the trigger, and the control's accessible name. */
  caption: string;
  /** The trigger's tile. Absent: the chosen option's icon, if it has one. */
  icon?: ReactNode;
  /** The panel's own heading and the line under it. */
  heading?: string;
  subheading?: string;
  /** A glyph beside a group's label. */
  groupIcons?: Record<string, ReactNode>;
  size?: 'md' | 'sm';
  align?: 'start' | 'end';
  /** A filter field at the top of the panel, for long lists. */
  searchable?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Panel width in px; defaults to the trigger's width, at least 240. */
  panelWidth?: number;
}

interface Pos {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

const GAP = 6;
const EDGE = 8;

function ChevronUpDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function Dropdown<V extends string = string>({
  value,
  options,
  onChange,
  caption,
  icon,
  heading,
  subheading,
  groupIcons,
  size = 'md',
  align = 'start',
  searchable = false,
  disabled = false,
  title,
  className,
  panelWidth,
}: DropdownProps<V>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const typed = useRef({ text: '', at: 0 });
  const open = pos !== null;

  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const width = Math.min(window.innerWidth - EDGE * 2, panelWidth ?? Math.max(240, r.width));
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - width));
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    /* Below unless it is cramped there and roomier above. */
    if (below >= 260 || below >= above) {
      return { left, top: r.bottom + GAP, width, maxHeight: Math.max(160, below) };
    }
    return { left, bottom: window.innerHeight - r.top + GAP, width, maxHeight: Math.max(160, above) };
  }

  function openPanel() {
    if (disabled) return;
    const p = place();
    if (!p) return;
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setPos(p);
  }

  function close(refocus = true) {
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(v: V) {
    if (v !== value) onChange(v);
    close();
  }

  /* Focus into the panel on open; keep the active row in view. */
  useLayoutEffect(() => {
    if (!open) return;
    (searchable ? searchRef.current : listRef.current)?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, shown]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    }
    /* Anchored to a rect measured at open time, so anything that moves the
       trigger closes the panel — except scrolling INSIDE the panel, which is
       how a long list is read. */
    function onScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      close(false);
    }
    function onResize() {
      close(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function onKey(e: KeyboardEvent) {
    const last = shown.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      case 'Home':
        if (e.target === searchRef.current) return;
        e.preventDefault();
        setActive(0);
        return;
      case 'End':
        if (e.target === searchRef.current) return;
        e.preventDefault();
        setActive(last);
        return;
      case 'Enter':
        e.preventDefault();
        if (shown[active]) pick(shown[active].value);
        return;
      case ' ':
        if (e.target === searchRef.current) return;
        e.preventDefault();
        if (shown[active]) pick(shown[active].value);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Tab':
        close(false);
        return;
    }
    /* Type-ahead, as a native select does: letters typed within half a second
       build one prefix. Not in the search field, which filters instead. */
    if (e.target !== searchRef.current && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      const t = typed.current;
      t.text = now - t.at < 500 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
      t.at = now;
      const hit = shown.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
      if (hit >= 0) setActive(hit);
    }
  }

  /* Rows in order, with a label wherever the group changes. */
  let lastGroup: string | undefined;
  const rows: ReactNode[] = [];
  shown.forEach((o, i) => {
    if (o.group && o.group !== lastGroup) {
      if (lastGroup !== undefined) rows.push(<hr key={`sep-${o.group}`} className="dd14-sep" />);
      rows.push(
        <div key={`g-${o.group}`} className="dd14-label" role="presentation">
          {groupIcons?.[o.group]}
          {o.group}
        </div>,
      );
    }
    lastGroup = o.group ?? lastGroup;
    const isSel = o.value === value;
    rows.push(
      <div
        key={o.value}
        id={`${id}-o${i}`}
        role="option"
        aria-selected={isSel}
        data-index={i}
        data-active={i === active || undefined}
        className="dd14-item"
        onPointerMove={() => setActive(i)}
        onClick={() => pick(o.value)}
      >
        {o.icon !== undefined && <span className="dd14-item-tile">{o.icon}</span>}
        <span className="dd14-item-text">
          <span className="dd14-item-label">{o.label}</span>
          {o.description && <span className="dd14-item-desc">{o.description}</span>}
        </span>
        {o.meta !== undefined && <span className="dd14-item-meta">{o.meta}</span>}
        {isSel && (
          <span className="dd14-check">
            <Check />
          </span>
        )}
      </div>,
    );
  });

  const tile = icon ?? selected?.icon;
  const style: CSSProperties | undefined = pos
    ? { left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn('dd14-trigger', className)}
        data-size={size}
        data-open={open || undefined}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${caption}: ${selected?.label ?? value}`}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openPanel();
          }
        }}
      >
        {tile !== undefined && <span className="dd14-tile">{tile}</span>}
        <span className="dd14-text">
          <span className="dd14-value">{selected?.label ?? value}</span>
          <span className="dd14-caption">{caption}</span>
        </span>
        <span className="dd14-chevron">
          <ChevronUpDown />
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="dd14-panel"
            data-flip={pos?.bottom !== undefined || undefined}
            style={style}
            onKeyDown={onKey}
          >
            {(heading || subheading) && (
              <>
                <div className="dd14-head">
                  {heading && <p className="dd14-heading">{heading}</p>}
                  {subheading && <p className="dd14-sub">{subheading}</p>}
                </div>
                <hr className="dd14-sep" />
              </>
            )}
            {searchable && (
              <input
                ref={searchRef}
                className="dd14-search"
                type="search"
                value={query}
                placeholder={`Search ${caption.toLowerCase()}…`}
                aria-label={`Search ${caption}`}
                aria-controls={`${id}-list`}
                aria-activedescendant={shown[active] ? `${id}-o${active}` : undefined}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            )}
            <div
              ref={listRef}
              id={`${id}-list`}
              className="dd14-list"
              role="listbox"
              aria-label={caption}
              tabIndex={-1}
              aria-activedescendant={shown[active] ? `${id}-o${active}` : undefined}
            >
              {rows}
              {!shown.length && <p className="dd14-empty">Nothing matches “{query}”.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
