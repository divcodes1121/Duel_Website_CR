/* `#/search?q=sub` — every stored player whose name matches, top 100.
 *
 * Reached from "View all N results" under any search field, or Enter on a
 * name. The field here searches as you type (the index answers in a few ms);
 * the query is kept in the URL with `replaceState`, so a reload or a shared
 * link opens the same list without stacking a history entry per letter.
 *
 * A name only finds players the bot has seen in a battle in the last ten
 * months. A tag reaches anyone, so a query that can be a tag offers it first.
 */
import { useEffect, useRef, useState } from 'react';
import { searchPlayers, type NameSearch } from '../../../state/analyticsClient';
import {
  DEBOUNCE_MS,
  MAX_QUERY,
  PAGE_LIMIT,
  asTag,
  countLabel,
  minChars,
  queryOf,
  seenLabel,
} from '../../../utils/nameSearch';
import { suggestCache } from '../../NameSuggest/NameSuggest';
import { SearchIcon } from '../../Dashboard/icons';
import styles from './PlayerSearch.module.css';

export function PlayerSearch() {
  const [text, setText] = useState(() => queryOf(window.location.hash));
  const [answer, setAnswer] = useState<NameSearch | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const field = useRef<HTMLInputElement>(null);

  const query = text.trim().slice(0, MAX_QUERY);
  const asked = query.length >= minChars(query) ? query : '';
  const tag = query.length >= 3 ? asTag(query) : null;
  const shown = answer && answer.query === asked ? answer : null;

  /* The hash can change under us (another "View all" while this page is open). */
  useEffect(() => {
    const onHash = () => {
      /* Leaving for a player fires this too; that is not a new query. */
      if (!window.location.hash.startsWith('#/search')) return;
      const q = queryOf(window.location.hash);
      setText((t) => (t.trim() === q.trim() ? t : q));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    /* Only while this IS the page: a click on a result has already moved the
       URL to the player, and rewriting it here would strand the reader on a
       player screen whose address says search. */
    if (!window.location.hash.startsWith('#/search')) return;
    const next = `#/search${query ? `?q=${encodeURIComponent(query)}` : ''}`;
    if (window.location.hash !== next) history.replaceState(null, '', next);
  }, [query]);

  useEffect(() => {
    setFailed(false);
    if (!asked) {
      setAnswer(null);
      return;
    }
    const key = `${asked}|${PAGE_LIMIT}`;
    const hit = suggestCache.get(key);
    if (hit) {
      setAnswer(hit);
      return;
    }
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      searchPlayers(asked, PAGE_LIMIT)
        .then((a) => {
          suggestCache.set(key, a);
          if (mine === seq.current) setAnswer(a);
        })
        .catch(() => {
          if (mine === seq.current) setFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [asked]);

  const open = (t: string) => {
    window.location.hash = `#/player/${encodeURIComponent(t)}`;
  };

  return (
    <div className={styles.page} data-player-search>
      <header className={styles.head}>
        <h1 className={styles.title}>Player Search</h1>
        <form
          className={styles.field}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const first = shown?.results[0];
            if (tag && (!first || first.name.toLowerCase() !== query.toLowerCase())) open(tag);
            else if (first) open(first.tag);
          }}
        >
          <SearchIcon size={18} />
          <input
            ref={field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Player name or tag"
            aria-label="Player name or tag"
            spellCheck={false}
            autoComplete="off"
            maxLength={MAX_QUERY + 8}
          />
        </form>
        <p className={styles.count} data-count aria-live="polite">
          {!asked
            ? 'Type a name.'
            : failed
              ? 'Search did not answer. Try again in a moment.'
              : !shown
                ? 'Searching…'
                : !shown.available
                  ? 'Name search is unavailable right now. A tag still works.'
                  : shown.total === 0
                    ? 'No stored player has this name.'
                    : `${countLabel(shown.total, shown.capped)} ${shown.total === 1 ? 'player' : 'players'}${
                        shown.total > shown.results.length ? ` · top ${shown.results.length}` : ''
                      }`}
        </p>
      </header>

      <ol className={styles.list}>
        {tag && (
          <li className={styles.row} data-kind="tag">
            <button type="button" className={styles.hit} onClick={() => open(tag)}>
              <span className={styles.rank} aria-hidden="true">#</span>
              <span className={styles.who}>
                <span className={styles.name}>Open {tag}</span>
                <span className={styles.meta}>By tag</span>
              </span>
            </button>
          </li>
        )}
        {(shown?.results ?? []).map((r, i) => {
          return (
            <li key={r.tag} className={styles.row}>
              <button type="button" className={styles.hit} onClick={() => open(r.tag)}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.who}>
                  <span className={styles.name}>{r.name}</span>
                  <span className={styles.meta}>
                    {r.tag}
                    {r.seen && <span className={styles.seen}>Seen {seenLabel(r.seen)}</span>}
                  </span>
                </span>
                {r.tracked && (
                  <span className={styles.tracked} title="Deckkies stores this player's battles">
                    Tracked
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
