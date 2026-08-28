/* The top bar's player-tag search, as vengenceui's GooeySearch.
 *
 * The adapter between a tag lookup and a component built to filter a list.
 * `components/ui/gooey-search.tsx` is the registry file, untouched.
 *
 * ── THE ONE THING THE COMPONENT CANNOT DO ────────────────────────────────
 *
 * It has no submit. `onSelect` fires only for a result the component itself
 * produced, so a query matching nothing is a dead end — you type, results stay
 * empty, and there is nothing to press. That is fine for "filter six
 * frameworks" and fatal here: **the tag you are looking up is usually one this
 * site has never seen.** The whole point of the field is to reach a player who
 * is not in our database yet, which is what `basis: "live"` exists for.
 *
 * So Enter on the raw value submits, and it is wired by listening on the
 * component's own input rather than by forking it — the same shape as the
 * dock's morph. `.gooey-search-input` is the class the component puts there
 * itself, so this is not a private detail being reached into; it is the one
 * hook it offers.
 *
 * ── SEARCHING BY NAME ────────────────────────────────────────────────────
 *
 * Nobody remembers `#9GJ0Q0LGG`; they remember "Ninja Shoyo". `onSearch` asks
 * `/api/analytics/search`, which reads the bot's `player_names` table, and the
 * matches come back as pickable results.
 *
 * ONLY PLAYERS WE HAVE COLLECTED CAN BE FOUND THAT WAY. Supercell has no
 * search-by-name endpoint, so the only names that exist are ones the bot has
 * stored — which is the second reason Enter on the raw value has to work. A
 * name finds who we know; a tag reaches anyone.
 *
 * A query that already looks like a tag skips the request entirely. `#ABC123`
 * is not a name and never will be, and the field is chrome on every screen.
 *
 * ── AND THE TOKENS ───────────────────────────────────────────────────────
 *
 * The component paints from `var(--foreground)` / `var(--background)`, which
 * are shadcn's and do not exist here. They are mapped on the wrapper, scoped,
 * rather than declared globally: this project keeps every colour in
 * `index.css`, and two new global colour names would be a second source of
 * truth for the same two values.
 */
import { useCallback, useEffect, useRef } from 'react';
import { GooeySearch } from '../ui/gooey-search';
import { searchPlayers } from '../../state/analyticsClient';
import styles from './TopSearch.module.css';

/* STABLE IDENTITIES, AND THIS IS NOT A STYLE CHOICE.
 *
 * GooeySearch's search effect is
 * `useEffect(..., [debouncedQuery, items, onSearch, maxResults])`. `onSearch`
 * and `items` are both in it; an inline arrow is a new function every render,
 * and the component's own `items = []` default is a new ARRAY every render. So
 * the effect re-runs on every render, sets state, renders again — and the query
 * fires in a loop. Measured before this was fixed: **one query typed, ~180
 * requests to `/api/analytics/search`.**
 *
 * `EMPTY` is module-level and `onSearch` is a `useCallback` with no changing
 * dependency, so both identities are constant for the life of the component and
 * the effect runs exactly when the debounced query changes. */
const EMPTY: string[] = [];

/** Supercell's tag alphabet. Anything drawn only from it is a tag, not a name. */
const TAG_LIKE = /^#?[0289PYLQGRJCUV]{3,}$/i;

/** "Ninja Shoyo · #9GJ0Q0LGG" — the label a result shows. */
function label(name: string | null, tag: string) {
  return name ? `${name} · ${tag}` : tag;
}

/** The tag back out of a label. The component's contract is strings only. */
function tagOf(item: string) {
  const at = item.lastIndexOf('#');
  return at >= 0 ? item.slice(at) : item;
}

export function TopSearch({
  onGo,
  inputRef,
}: {
  onGo: (tag: string) => void;
  /** So ⌘K can still reach the field. It only exists once expanded. */
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  /* Enter submits whatever is typed, and ⌘K finds the input once it exists.
     Both are done on the DOM because the component owns its input and exposes
     neither a ref nor an onSubmit. A MutationObserver rather than a one-shot
     query because the input is not in the tree until the pill expands. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let bound: HTMLInputElement | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const value = (e.currentTarget as HTMLInputElement).value.trim();
      if (!value) return;
      e.preventDefault();
      onGo(value);
    };

    const bind = () => {
      const input = root.querySelector<HTMLInputElement>('.gooey-search-input');
      if (input === bound) return;
      bound?.removeEventListener('keydown', onKey);
      bound = input;
      if (inputRef) inputRef.current = input;
      input?.addEventListener('keydown', onKey);
    };

    bind();
    const mo = new MutationObserver(bind);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      bound?.removeEventListener('keydown', onKey);
      if (inputRef) inputRef.current = null;
    };
  }, [onGo, inputRef]);

  /* See the note on EMPTY: this identity must not change between renders. */
  const onSearch = useCallback(async (q: string) => {
    const needle = q.trim();
    /* Already a tag: there is nothing to look up, and this field is chrome on
       every screen. */
    if (TAG_LIKE.test(needle)) return EMPTY;
    try {
      const r = await searchPlayers(needle);
      return (r.players ?? []).map((t) => label(t.name, t.tag));
    } catch {
      /* A search that errors is worse than one that finds nothing — the typed
         value still submits on Enter. */
      return EMPTY;
    }
  }, []);

  return (
    <div ref={rootRef} className={styles.scope}>
      <GooeySearch
        placeholder="Enter player tag"
        buttonLabel="Search"
        maxResults={5}
        expandedWidth={280}
        debounceMs={220}
        items={EMPTY}
        onSearch={onSearch}
        onSelect={(item) => onGo(tagOf(item))}
      />
    </div>
  );
}
