import { useCallback, useEffect, useState } from 'react';

import { getCardIconUrl } from '../../../data/cards';
import {
  type DuoDeck,
  type DuoPair,
  type DuoReport,
  fetchDuoPairs,
} from '../../../state/analyticsClient';
import { DeckActions } from '../../DeckActions/DeckActions';
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

  const load = useCallback(
    async (page: number, cards: string[], s: string, n: number) => {
      setLoading(true);
      setError(null);
      try {
        setReport(await fetchDuoPairs(page, n, cards, s));
      } catch {
        setError('Could not reach the analytics service.');
      } finally {
        setLoading(false);
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

      {summary && (
        <div className={styles.stats}>
          <Stat label="Unique pairs" value={summary.uniquePairs.toLocaleString()} />
          <Stat label="Battles folded" value={summary.battlesFolded.toLocaleString()} />
          <Stat
            label="Battles per pair"
            value={
              summary.uniquePairs
                ? (summary.occurrences / summary.uniquePairs).toFixed(1)
                : '—'
            }
          />
        </div>
      )}

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
      {loading && (
        <ReadingState k="duo-pairs" hue="green">
          Reading the 2v2 partnerships…
        </ReadingState>
      )}

      {report && !loading && (
        <>
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
          <div className={styles.list}>
            {report.pairs.map((p) => (
              <Pair key={p.pairFingerprint} pair={p} />
            ))}
            {!report.pairs.length && (
              <p className={styles.empty}>
                No partnership runs all of those cards in one deck.
              </p>
            )}
          </div>
          {report.pages > 1 && (
            <div className={styles.pager}>
              <button
                type="button"
                disabled={report.page <= 1}
                onClick={() => void load(report.page - 1, picked, sort, per)}
              >
                Previous
              </button>
              <span>
                Page {report.page.toLocaleString()} of {report.pages.toLocaleString()}
              </span>
              <button
                type="button"
                disabled={report.page >= report.pages}
                onClick={() => void load(report.page + 1, picked, sort, per)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      <p className={styles.note}>
        Read from the raw battle payload, because a battle row stores one deck
        and one opponent deck — a teammate&rsquo;s deck is in no column of it.
        Each battle counts once however many of its four players are tracked,
        and card order does not affect a deck&rsquo;s identity.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export default DuoDecks;
