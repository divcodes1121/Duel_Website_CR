import { useCallback, useEffect, useRef, useState } from 'react';

import { getCardIconUrl } from '../../../data/cards';
import {
  type DuoDeck,
  type DuoPair,
  type DuoReport,
  fetchDuoPairs,
} from '../../../state/analyticsClient';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ContinuousPagination } from '../../ui/continuous-pagination';
import { revealListTop } from '../../../utils/revealListTop';
import { WinConFilter } from '../../WinConFilter/WinConFilter';
import { ReadingState } from '../ReadingState';
import styles from './DuoDecks.module.css';

/**
 * 2v2 Decks — the unique teammate deck pairs, as a screen of its own.
 *
 * IT WAS A COLLAPSED SECTION OF THE ADMIN CONSOLE AND IS NOT ANY MORE. That
 * put the one board built entirely out of 2v2 behind a door only an operator
 * opens, and made the site's answer to "what do people play in 2v2" invisible
 * to the people who play it. It is a route now, reached from the gallery strip
 * like Team Analysis, and there is exactly ONE board — the console's copy was
 * removed rather than duplicated.
 *
 * THE UNIT IS A PAIR, WHICH IS WHY BOTH DECKS GET THEIR OWN ACTIONS. A 2v2
 * battle is four players; what is worth recording is which two decks were
 * brought together. So each half carries its own Copy link / Open in Game —
 * you take ONE of them into the game, and the pairing is the thing you were
 * reading. A single action on the pair would have nothing to copy.
 *
 * A "+" SEPARATES THEM, NEVER A "VS". They are teammates. Every other VS mark
 * in this project means two sides of a fight, and reusing it here would state
 * the opposite of what the row says.
 *
 * ── THE ROW IS TWO DECKS AND NOTHING ELSE ─────────────────────────────────
 *
 * It used to carry a five-item list beside them — played, players, first seen,
 * last seen — which spent a third of the width on figures nobody came for. The
 * board is a RANKING, so the order is what those counts were for and the sort
 * control already names it. The decks take the whole row now and are drawn
 * large, one left and one right: they are the only thing on this screen anybody
 * reads card by card.
 */

const SORTS = [
  { key: 'played', label: 'Most played' },
  { key: 'recent', label: 'Recently seen' },
  { key: 'first', label: 'First seen' },
] as const;

const PER_PAGE = [25, 50, 100] as const;

function Deck({ deck, side }: { deck: DuoDeck; side: string }) {
  return (
    <div className={styles.deck}>
      <div className={styles.deckHead}>
        <span className={styles.deckSide}>{side}</span>
        <span className={styles.deckElixir} title="Average elixir">
          {deck.avgElixir}
        </span>
      </div>
      <div className={styles.cards}>
        {/* CANONICAL ORDER, which is the order the fingerprint is taken over.
            `arrange_deck`'s evolution and hero slotting needs the per-battle
            art marks a deduplicated deck does not have, so a play order here
            would be invented — and this row exists to state an identity. */}
        {deck.cards.map((c) => (
          <img
            key={c.key}
            className={styles.card}
            src={getCardIconUrl(c.key)}
            alt={c.name}
            title={`${c.name} · ${c.elixir} elixir`}
            loading="lazy"
            width={302}
            height={363}
          />
        ))}
      </div>
      {/* PASSED THROUGH UNTOUCHED, which is `DeckActions`'s standing rule. The
          order here is the canonical one rather than `arrange_deck`'s, so the
          game seats the deck alphabetically — a legal deck, and the same eight
          cards. Re-sorting it here would only make the link disagree with the
          strip above it. `md` now the decks are large; `sm` chips under a
          170px-wide card strip read as leftovers. */}
      <DeckActions cards={deck.cardKeys} name={side} size="md" />
    </div>
  );
}

function Pair({ pair }: { pair: DuoPair }) {
  return (
    <article className={styles.pair}>
      <Deck deck={pair.deckA} side="Deck A" />
      <span className={styles.plus} aria-label="played together with">
        +
      </span>
      <Deck deck={pair.deckB} side="Deck B" />
      {/* Both teammates on the same list. A real pairing, and worth marking
          because it otherwise reads as a rendering fault. */}
      {pair.mirror && <span className={styles.mirror}>Mirror pair</span>}
    </article>
  );
}

export function DuoDecks() {
  const [report, setReport] = useState<DuoReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<string>('played');
  const [per, setPer] = useState<number>(25);
  /* The cards the reader has picked. The SERVER decides which of them it
     accepted — an unknown key is dropped rather than refused — so what the
     board says it filtered by is read from the response, never from this. */
  const [picked, setPicked] = useState<string[]>([]);
  /* The page ASKED FOR, set on the click, so the pager's slab moves at once
     rather than a round trip later. The server clamps a page past the end,
     so the answer's own page replaces it when it lands. */
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  /* Only the newest request may write. Clicking through pages faster than
     they arrive used to be impossible — the loader covered the pager — and
     now it is not, so an older, slower answer must not land on top of a
     newer one and leave the board showing a page the pager is not on. */
  const seq = useRef(0);

  const load = useCallback(
    async (p: number, cards: string[], s: string, n: number) => {
      const id = ++seq.current;
      setPage(p);
      setLoading(true);
      setError(null);
      try {
        const r = await fetchDuoPairs(p, n, cards, s);
        if (id !== seq.current) return;
        setReport(r);
        setPage(r.page);
      } catch {
        if (id !== seq.current) return;
        setError('Could not reach the analytics service.');
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(1, [], 'played', 25);
  }, [load]);

  function toggle(key: string) {
    const next = picked.includes(key)
      ? picked.filter((k) => k !== key)
      : [...picked, key];
    setPicked(next);
    /* A pick is a new question about 1.4M rows, so it goes back to page 1.
       Staying on page 900 of a board that now has four would clamp to the end
       and read as the filter having scrolled somewhere at random. */
    void load(1, next, sort, per);
  }

  function clear() {
    setPicked([]);
    void load(1, [], sort, per);
  }

  const summary = report?.summary;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>2v2 Decks</h1>
        <p className={styles.lede}>
          Unique teammate deck combinations — the two decks a pair of players
          actually brought together, not one deck against another.
        </p>
        {summary && (
          <span className={styles.population}>
            Population: Top {summary.populationLimit.toLocaleString()} 2v2 players
          </span>
        )}
      </header>

      <div className={styles.controls}>
        {/* THE CONTROL META AND DUEL ZONE ALREADY USE, and it replaced a text
            box. A typed string had to be spelled the way the database spells
            it — measured against production, `hog-rider` found 434,265 pairs
            and `Hog Rider` found none, which reads as "there are no hog rider
            decks". A picked card cannot be misspelled, shows its art, and the
            panel reaches all 123 of them.

            `start`, AND `end` WAS TRIED AND IS WRONG HERE. The panel is 30rem
            and `align` says which of ITS edges is pinned to the trigger's — so
            `end` pins the panel's right edge to the trigger's right edge and it
            grows LEFTWARDS. This trigger leads the control row at x 290, which
            put the panel's left edge at -115 and half the cards off the screen.
            Meta and Duel Zone need `end` because their triggers sit at the far
            right of a header; this one does not. Measured, not reasoned: the
            first attempt shipped `end` on the strength of the component's own
            note and the screenshot showed the panel hanging off the page. */}
        <WinConFilter
          selected={picked}
          onToggle={toggle}
          onClear={clear}
          align="start"
        />
        <label className={styles.control}>
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              void load(1, picked, e.target.value, per);
            }}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          Per page
          <select
            value={per}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPer(n);
              void load(1, picked, sort, n);
            }}
          >
            {PER_PAGE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {summary && !summary.built && !error && (
        <p className={styles.empty}>
          The 2v2 collection has not been built yet.
        </p>
      )}

      {/* THE SHARED LOADING STATE, NOT A WORD. `ReadingState` counts elapsed
          time against how long THIS screen has taken the last few times on this
          browser, so the number is measured rather than scripted. Its key is
          its own: a page of 2v2 pairs is not paced like the Coach's matchup
          scoring, and a shared key would make both readouts wrong. */}
      {/* THE FIRST READ ONLY. A page turn, a pick or a new sort keeps the
          board on screen dimmed instead, the way Recent Battles does: swapping
          the whole board for a loader on every click would unmount the pager
          under the pointer that just pressed it, and read as navigating away
          rather than as using a control. */}
      {loading && !report && (
        <ReadingState k="duo-pairs" hue="green">
          Reading the 2v2 partnerships…
        </ReadingState>
      )}

      {report && (
        <>
          <div className={styles.results} data-busy={loading || undefined}>
            <p className={styles.count}>
              {report.total.toLocaleString()} pair
              {report.total === 1 ? '' : 's'}
              {/* THE SERVER'S LIST, NOT THE PICKED ONE. An unknown key is dropped
                  rather than refused, so quoting what was SENT could name a card
                  the board is not actually filtered by. */}
              {!!report.cards?.length && (
                <> running all {report.cards.length} picked card
                  {report.cards.length === 1 ? '' : 's'} in one deck</>
              )}
            </p>
            <div ref={listRef} className={styles.list}>
              {report.pairs.map((p) => (
                <Pair key={p.pairFingerprint} pair={p} />
              ))}
              {!report.pairs.length && (
                <p className={styles.empty}>
                  No partnership runs all of those cards in one deck.
                </p>
              )}
            </div>
          </div>
          {/* A WINDOW, NOT EVERY PAGE: the board runs to tens of thousands of
              pages at 25 a page, and the pager draws first, last and the pages
              around this one in a fixed number of slots. It used to be
              Previous / Next only, so page 40 was forty clicks away. */}
          {report.pages > 1 && (
            <ContinuousPagination
              className={styles.pager}
              totalPages={report.pages}
              page={Math.min(page, report.pages)}
              onPageChange={(p) => {
                void load(p, picked, sort, per);
                revealListTop(listRef.current);
              }}
              label="2v2 pair pages"
            />
          )}
        </>
      )}

    </div>
  );
}

export default DuoDecks;
