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
 * ── IT FINDS PLAYERS BY NAME (2026-10-19), AND THAT WAS A DECISION TWICE ──
 *
 * Search-by-name was built and removed on 28 Aug 2026: it scanned the bot's
 * `player_names` with LIKE, and this field is chrome on every screen, so every
 * debounced keystroke paid for a table scan. That table is 5.9M names now and
 * the scan would cost 0.6-4.6 s. It is back because the server reads its own
 * trigram index instead (`server/name_index.py`, milliseconds a query).
 *
 * The list is NOT the component's own result pills (a slow staggered spring,
 * strings only). `NameSuggest` attaches to the component's input and draws an
 * ordinary dropdown under the pill; the component's `items`/`onSearch` stay
 * unset, so its own effect never fetches. Enter with no row highlighted goes
 * through `onGo`: a tag opens the player, a name opens the results page.
 *
 * ── AND THE TOKENS ───────────────────────────────────────────────────────
 *
 * The component paints from `var(--foreground)` / `var(--background)`, which
 * are shadcn's and do not exist here. They are mapped on the wrapper, scoped,
 * rather than declared globally: this project keeps every colour in
 * `index.css`, and two new global colour names would be a second source of
 * truth for the same two values.
 */
import { useEffect, useRef, useState } from 'react';
import { GooeySearch } from '../ui/gooey-search';
import { NameSuggest } from '../NameSuggest/NameSuggest';
import styles from './TopSearch.module.css';

export function TopSearch({
  onGo,
  inputRef,
}: {
  onGo: (tag: string) => void;
  /** A handle on the field, which only exists once expanded. The shell no
   *  longer passes one: ⌘K opens the command palette now (2026-09-28). */
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<HTMLInputElement | null>(null);

  /* The component owns its input and exposes no ref, and the input is not in
     the tree until the pill expands — so it is found by watching the DOM.
     `.gooey-search-input` is the class the component puts there itself. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const bind = () => {
      const el = root.querySelector<HTMLInputElement>('.gooey-search-input');
      if (inputRef) inputRef.current = el;
      setInput((prev) => (prev === el ? prev : el));
    };
    bind();
    const mo = new MutationObserver(bind);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (inputRef) inputRef.current = null;
    };
  }, [inputRef]);

  return (
    <div ref={rootRef} className={styles.scope}>
      <GooeySearch
        placeholder="Player name or tag"
        buttonLabel="Search"
        expandedWidth={280}
      />
      <NameSuggest input={input} anchor={rootRef.current} onSubmit={onGo} />
    </div>
  );
}
