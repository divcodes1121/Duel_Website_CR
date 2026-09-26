/**
 * THE DASHBOARD SHELL — a left sidebar that opens, minimises to an icon rail,
 * and closes, around a top bar and one scrolling content region. The console,
 * the coach roster and the player's own page (`#/my`) all sit in it, so the
 * three admin-side screens look and behave as one product.
 *
 * DESIGN: the collapsible sidebar that TailAdmin, shadcn/ui's `sidebar-07`
 * and Preline all converged on — a ~264px panel with grouped items, a 72px
 * rail that keeps the icons, and an off-canvas drawer on a phone. Surfaces
 * are the kit's `--dash-*` tokens (see `bionis-dashboard.css`), so the shell
 * and the cards in it are one palette in both themes.
 *
 * THREE STATES, AND THE PICK IS REMEMBERED PER SCREEN (`dk-shell:<id>` in
 * localStorage, read inside try/catch — a blocked store is a default, never an
 * error). Minimise and close are different requests: the rail keeps one-click
 * navigation for somebody who wants the width; closed gives the content the
 * whole window and leaves a single "open" button in the top bar. Below 64rem
 * there is no room for a rail beside a dashboard, so the sidebar is a drawer
 * there whatever the remembered state says.
 *
 * KEYBOARD. Ctrl/⌘+B toggles open ↔ rail (the shadcn convention), except
 * while typing in a field. Esc closes the drawer and puts focus back on the
 * button that opened it. A closed or off-canvas sidebar is `inert`, so its
 * links are not left in the tab order where nobody can see them.
 *
 * A RAIL ITEM'S LABEL IS STILL IN THE DOM — visually hidden, read by a screen
 * reader — and the visible tooltip is a portal, because the rail scrolls and
 * a tooltip inside a scroller is clipped by it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { ThemeToggle } from '../Theme/ThemeToggle';
import type { DashTone } from './bionis-dashboard';
import { MenuIcon, PanelCloseIcon, PanelOpenIcon, XIcon } from './dash-icons';
import './bionis-dashboard.css';
import './dash-shell.css';

export type ShellMode = 'open' | 'mini' | 'closed';

export interface ShellItem {
  id: string;
  label: string;
  /** Top-level destinations carry an icon; a player carries `avatar` instead. */
  icon?: ReactNode;
  /** Initials drawn in a tile when there is no icon. */
  avatar?: string;
  href?: string;
  onSelect?: () => void;
  current?: boolean;
  /** A count, drawn as a pill beside the label (a dot on the rail). */
  badge?: ReactNode;
  /** A state worth seeing from anywhere: a coloured dot, and the word for a
   *  screen reader — colour never carries it alone. */
  status?: { tone: DashTone; label: string };
  /** A second line under the label (a player's tag). */
  sub?: string;
  /** Archived and similar: listed, but quieter. */
  dim?: boolean;
}

export interface ShellGroup {
  id: string;
  label?: string;
  items: ShellItem[];
  /** Something under the list — an "Add player" button. Given `mini`, so it
   *  can draw itself as an icon on the rail. */
  after?: ReactNode | ((mini: boolean) => ReactNode);
  /** The label becomes a toggle; `defaultOpen` false starts it folded. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

const KEY = (id: string) => `dk-shell:${id}`;

function readMode(id: string): ShellMode {
  try {
    const v = window.localStorage.getItem(KEY(id));
    if (v === 'open' || v === 'mini' || v === 'closed') return v;
  } catch {
    /* A private window or blocked storage: the default is the answer. */
  }
  return 'open';
}

function writeMode(id: string, m: ShellMode) {
  try {
    window.localStorage.setItem(KEY(id), m);
  } catch {
    /* Not remembered this time; nothing else depends on it. */
  }
}

const NARROW = '(max-width: 63.99rem)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Two letters for an avatar: the first of each of the first two words, or
 *  the first two of a single word. A tag loses its `#`. "Coach Mira" is CM,
 *  not CO — the first two letters of a shared prefix say nothing. */
export function initialsOf(label: string): string {
  const clean = label.replace(/^#/, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const chars = words.length > 1 ? [words[0], words[1]].map((w) => [...w][0]) : [...clean].slice(0, 2);
  return chars.join('').toUpperCase();
}

/** A small deterministic hue for an avatar, so a player keeps their colour. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}

interface RailTip {
  label: string;
  x: number;
  y: number;
}

function Item({
  item,
  mini,
  onTip,
  onUntip,
  onNavigate,
}: {
  item: ShellItem;
  mini: boolean;
  onTip: (el: HTMLElement, label: string) => void;
  onUntip: () => void;
  onNavigate: () => void;
}) {
  const tipOn = mini
    ? {
        onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => onTip(e.currentTarget, item.label),
        onPointerLeave: onUntip,
        onFocus: (e: FocusEvent<HTMLElement>) => onTip(e.currentTarget, item.label),
        onBlur: onUntip,
      }
    : {};
  const body = (
    <>
      <span className="dk-itemIcon">
        {item.icon ?? (
          <span className="dk-avatar" data-hue={hueFor(item.id)} aria-hidden="true">
            {item.avatar ?? initialsOf(item.label)}
          </span>
        )}
      </span>
      <span className="dk-itemText">
        <span className="dk-itemLabel">{item.label}</span>
        {item.sub && <span className="dk-itemSub">{item.sub}</span>}
      </span>
      {item.badge != null && item.badge !== '' && <span className="dk-itemBadge">{item.badge}</span>}
      {item.status && (
        <>
          <span className="dk-itemDot" data-tone={item.status.tone} aria-hidden="true" />
          <span className="sr-only">, {item.status.label}</span>
        </>
      )}
    </>
  );
  const common = {
    className: 'dk-item',
    'aria-current': item.current ? ('page' as const) : undefined,
    'data-dim': item.dim || undefined,
    ...tipOn,
  };
  if (item.href) {
    return (
      <a href={item.href} {...common} onClick={onNavigate}>
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      {...common}
      onClick={() => {
        item.onSelect?.();
        onNavigate();
      }}
    >
      {body}
    </button>
  );
}

function Group({
  group,
  mini,
  onTip,
  onUntip,
  onNavigate,
}: {
  group: ShellGroup;
  mini: boolean;
  onTip: (el: HTMLElement, label: string) => void;
  onUntip: () => void;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? true);
  const listId = useId();
  /* On the rail there is no label to toggle, so a folded group shows. */
  const folded = Boolean(group.collapsible) && !mini && !open;
  const after = typeof group.after === 'function' ? group.after(mini) : group.after;
  return (
    <div className="dk-group">
      {group.label &&
        (group.collapsible && !mini ? (
          <button
            type="button"
            className="dk-groupLabel dk-groupToggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
          >
            <span>{group.label}</span>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-open={open || undefined}>
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <p className="dk-groupLabel">{group.label}</p>
        ))}
      {!folded && group.items.length > 0 && (
        <ul className="dk-list" id={listId}>
          {group.items.map((it) => (
            <li key={it.id}>
              <Item item={it} mini={mini} onTip={onTip} onUntip={onUntip} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
      {after}
    </div>
  );
}

export function DashShell({
  id,
  product,
  title,
  subtitle,
  badge,
  groups,
  actions,
  banner,
  children,
}: {
  /** Which screen, for the remembered state. */
  id: string;
  /** What the sidebar is the navigation OF — "Console", "Coach Roster". */
  product: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A short pill beside the title. */
  badge?: ReactNode;
  groups: (ShellGroup | null | false | undefined)[];
  /** Top bar controls, left of the theme switch. */
  actions?: ReactNode;
  /** Above the content: a preview notice, a load error. */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<ShellMode>(() => readMode(id));
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  const [tip, setTip] = useState<RailTip | null>(null);
  const sideRef = useRef<HTMLElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const sideId = useId();

  const setMode = useCallback(
    (m: ShellMode) => {
      setModeState(m);
      writeMode(id, m);
    },
    [id],
  );

  const mini = !narrow && mode === 'mini';
  const hidden = narrow ? !drawer : mode === 'closed';
  const state = narrow ? (drawer ? 'drawer' : 'drawer-closed') : mode;

  const showTip = useCallback((el: HTMLElement, label: string) => {
    const r = el.getBoundingClientRect();
    setTip({ label, x: r.right + 10, y: r.top + r.height / 2 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  /* THE INNER FACE. Inside the product headings are set in the body face
     (`index.css` swaps `--font-display` under this attribute); these routes
     render outside the Dashboard shell that normally sets it. */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-app-inner', '');
    return () => root.removeAttribute('data-app-inner');
  }, []);

  /* A closed or off-canvas sidebar leaves the tab order. */
  useEffect(() => {
    const el = sideRef.current as (HTMLElement & { inert?: boolean }) | null;
    if (el) el.inert = hidden;
  }, [hidden]);

  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);

  useEffect(() => setTip(null), [mode, narrow]);

  /* Navigating closes the drawer, whatever did the navigating. */
  useEffect(() => {
    const on = () => setDrawer(false);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    sideRef.current?.querySelector<HTMLElement>('[aria-current="page"], .dk-item')?.focus();
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false);
        openRef.current?.focus();
      }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [drawer]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (narrow) setDrawer((d) => !d);
      else setMode(mode === 'open' ? 'mini' : 'open');
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [narrow, mode, setMode]);

  const open = () => (narrow ? setDrawer(true) : setMode('open'));
  const close = () => {
    if (narrow) {
      setDrawer(false);
      openRef.current?.focus();
    } else {
      setMode('closed');
      /* The button that brings it back replaces the one just pressed. */
      requestAnimationFrame(() => openRef.current?.focus());
    }
  };
  const navigated = () => {
    if (narrow) setDrawer(false);
  };

  const shown = groups.filter(Boolean) as ShellGroup[];
  const logo = `${import.meta.env.BASE_URL}assets/brand/logo-dark.png`;

  return (
    <div className="dk-shell" data-state={state}>
      <aside ref={sideRef} id={sideId} className="dk-side" aria-label={`${product} navigation`}>
        <div className="dk-sideHead">
          <a className="dk-brand" href="#/" aria-label="Deckkies home">
            <span className="dk-brandMark">
              <img src={logo} alt="" draggable={false} />
            </span>
            <span className="dk-brandText">
              <strong>DECKKIES</strong>
              <small>{product}</small>
            </span>
          </a>
          <div className="dk-sideCtl">
            {!narrow &&
              (mini ? (
                <button type="button" className="dk-iconBtn" aria-label="Expand sidebar" title="Expand sidebar (Ctrl+B)" onClick={() => setMode('open')}>
                  <PanelOpenIcon />
                </button>
              ) : (
                <button type="button" className="dk-iconBtn" aria-label="Minimise sidebar" title="Minimise sidebar (Ctrl+B)" onClick={() => setMode('mini')}>
                  <PanelCloseIcon />
                </button>
              ))}
            <button type="button" className="dk-iconBtn" aria-label="Close sidebar" title="Close sidebar" onClick={close}>
              <XIcon size={17} />
            </button>
          </div>
        </div>

        <nav className="dk-nav" aria-label={product}>
          {shown.map((g) => (
            <Group key={g.id} group={g} mini={mini} onTip={showTip} onUntip={hideTip} onNavigate={navigated} />
          ))}
        </nav>
      </aside>

      {narrow && drawer && <div className="dk-scrim" onClick={close} aria-hidden="true" />}

      <div className="dk-main">
        <header className="dk-top">
          {(narrow || mode === 'closed') && (
            <button
              ref={openRef}
              type="button"
              className="dk-iconBtn dk-openBtn"
              aria-label="Open sidebar"
              title="Open sidebar"
              aria-controls={sideId}
              aria-expanded={!hidden}
              onClick={open}
            >
              <MenuIcon />
            </button>
          )}
          <div className="dk-topText">
            <div className="dk-titleRow">
              <h1 className="dk-title">{title}</h1>
              {badge && <span className="dk-titleBadge">{badge}</span>}
            </div>
            {subtitle && <p className="dk-subtitle">{subtitle}</p>}
          </div>
          <div className="dk-topActions">
            {actions}
            <ThemeToggle size="1.8rem" />
          </div>
        </header>
        <main className="dk-content">
          <div className="dk-contentInner">
            {banner}
            {children}
          </div>
        </main>
      </div>

      {tip &&
        createPortal(
          <div className="dk-railTip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.label}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A top-bar button in the shell's style — Refresh and the like. */
export function ShellButton({
  children,
  icon,
  onClick,
  disabled,
  busy,
  title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
}) {
  return (
    <button type="button" className="dk-button" onClick={onClick} disabled={disabled} data-busy={busy || undefined} title={title}>
      {icon && <span className="dk-buttonIcon">{icon}</span>}
      <span className="dk-buttonText">{children}</span>
    </button>
  );
}
