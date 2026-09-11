import { useCallback, useEffect, useState } from 'react';

import { getCardIconUrl } from '../../../data/cards';
import { type DuoDeck, type DuoPair, type DuoReport, fetchDuoPairs } from '../../../state/analyticsClient';
import { DeckActions } from '../../DeckActions/DeckActions';
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
            width={54}
            height={65}
          />
        ))}
      </div>
      {/* PASSED THROUGH UNTOUCHED, which is `DeckActions`'s standing rule. The
          order here is the canonical one rather than `arrange_deck`'s, so the
          game seats the deck alphabetically — a legal deck, and the same eight
          cards. Re-sorting it here would only make the link disagree with the
          strip above it. */}
      <DeckActions cards={deck.cardKeys} name={side} size="sm" />
    </div>
  );
}

function Pair({ pair }: { pair: DuoPair }) {
  return (
    <article className={styles.pair}>
      <div className={styles.decks}>
        <Deck deck={pair.deckA} side="Deck A" />
        <span className={styles.plus} aria-label="played together with">
          +
        </span>
        <Deck deck={pair.deckB} side="Deck B" />
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Played</dt>
          <dd className={styles.figure}>{pair.occurrences.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd className={styles.figure}>{pair.players.toLocaleString()}</dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{stamp(pair.firstSeen)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{stamp(pair.lastSeen)}</dd>
        </div>
        {pair.mirror && (
          <div>
            <dt>Note</dt>
            {/* Both teammates on the same list. A real pairing, and worth
                marking because it otherwise reads as a rendering fault. */}
            <dd className={styles.mirror}>Mirror pair</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

/** `20260911T095047.000Z` is Supercell's stamp, not something to show a reader. */
function stamp(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw || '');
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function DuoDecks() {
  const [report, setReport] = useState<DuoReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<string>('played');
  const [per, setPer] = useState<number>(25);
  const [query, setQuery] = useState('');
  /* The box you type in and the term the server answered for are different
     things: without the split, every keystroke would either fire a request or
     silently disagree with the result on screen. */
  const [applied, setApplied] = useState('');

  const load = useCallback(
    async (page: number, q: string, s: string, n: number) => {
      /* THE SERVER MATCHES CARD KEYS, and a reader types card names. Measured
         against production: `hog-rider` finds 434,265 pairs and `Hog Rider`
         finds none — which reads as "there are no hog rider decks" rather than
         as "that is not how the field is spelled". The normalised term is what
         the count line quotes back, so what was searched for is never in
         doubt. */
      const term = q.trim().toLowerCase().replace(/\s+/g, '-');
      setLoading(true);
      setError(null);
      try {
        setReport(await fetchDuoPairs(page, n, term, s));
        setApplied(term);
      } catch {
        setError('Could not reach the analytics service.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(1, '', 'played', 25);
  }, [load]);

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
        <label className={styles.control}>
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              void load(1, applied, e.target.value, per);
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
              void load(1, applied, sort, n);
            }}
          >
            {PER_PAGE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {/* SERVER-SIDE, because there are far more pairs than ever reach this
            browser — filtering what one page returned would quietly answer for
            25 rows while appearing to answer for the collection. */}
        <input
          className={styles.search}
          value={query}
          placeholder="Card, e.g. hog rider…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(1, query, sort, per);
          }}
        />
        <button
          type="button"
          className={styles.go}
          onClick={() => void load(1, query, sort, per)}
        >
          Search
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {summary && !summary.built && !error && (
        <p className={styles.empty}>
          The 2v2 collection has not been built yet.
        </p>
      )}

      {report && (
        <>
          <p className={styles.count}>
            {loading
              ? 'Loading…'
              : `${report.total.toLocaleString()} pair${report.total === 1 ? '' : 's'}`}
            {applied && ` matching “${applied}”`}
          </p>
          <div className={styles.list}>
            {report.pairs.map((p) => (
              <Pair key={p.pairFingerprint} pair={p} />
            ))}
            {!report.pairs.length && !loading && (
              <p className={styles.empty}>Nothing matches that.</p>
            )}
          </div>
          {report.pages > 1 && (
            <div className={styles.pager}>
              <button
                type="button"
                disabled={report.page <= 1 || loading}
                onClick={() => void load(report.page - 1, applied, sort, per)}
              >
                Previous
              </button>
              <span>
                Page {report.page.toLocaleString()} of {report.pages.toLocaleString()}
              </span>
              <button
                type="button"
                disabled={report.page >= report.pages || loading}
                onClick={() => void load(report.page + 1, applied, sort, per)}
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
