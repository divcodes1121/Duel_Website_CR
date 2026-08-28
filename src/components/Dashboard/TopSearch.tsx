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
 * ── IT IS TAG-ONLY, AND THAT IS A DECISION ───────────────────────────────
 *
 * Search-by-name was built and removed. `/api/analytics/search` read the bot's
 * `player_names` and it worked, but the field is chrome on EVERY screen and the
 * component fires a request per debounced keystroke — so the cost of the
 * feature is a steady stream of authenticated queries against the analytics
 * host, paid on every page, to save typing a tag that the person pasting it
 * already has on their clipboard. It was not worth the traffic.
 *
 * So there is no `onSearch` and no `items`: nothing is fetched, no result list
 * is produced, and the field does exactly one thing — take a tag and open it.
 * Enter is the whole interface, which is why the listener below is not an
 * enhancement but the feature.
 *
 * ── AND THE TOKENS ───────────────────────────────────────────────────────
 *
 * The component paints from `var(--foreground)` / `var(--background)`, which
 * are shadcn's and do not exist here. They are mapped on the wrapper, scoped,
 * rather than declared globally: this project keeps every colour in
 * `index.css`, and two new global colour names would be a second source of
 * truth for the same two values.
 */
import { useEffect, useRef } from 'react';
import { GooeySearch } from '../ui/gooey-search';
import styles from './TopSearch.module.css';

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

  return (
    <div ref={rootRef} className={styles.scope}>
      <GooeySearch
        placeholder="Enter player tag"
        buttonLabel="Search"
        expandedWidth={280}
      />
    </div>
  );
}
