import { useEffect, useState } from 'react';
import { parseClashRoyaleDeckLink } from '../../utils/deckLink';
import {
  fetchCounters,
  fetchDrawnDeck,
  type CounterRow,
  type CountersReport,
  type DrawnDeck,
} from '../../state/analyticsClient';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { ProLock } from './ProLock';
import { isEntitled, useAccess } from '../../state/gate';
import { ShieldIcon } from '../Dashboard/icons';
import { PasteIntro, PasteHeader } from './PasteIntro';
import { ReadingState } from './ReadingState';
import styles from './CounterLab.module.css';
import { useHeldLoading } from '../../hooks/useHeldLoading';

const pct = (v: number) => `${v.toFixed(1)}%`;
const num = (v: number) => v.toLocaleString();

/** How many counters a free account sees. The rest are behind the gate. */
const FREE_ROWS = 3;

const SOURCE_LABEL: Record<string, string> = {
  exact: 'these exact lists have met',
  deck: 'this exact list',
  cluster7: 'lists one card different',
  cluster6: 'lists two cards different',
  archetype: 'the archetype average',
};

function Row({ row, rank }: { row: CounterRow; rank: number }) {
  return (
    <div className={styles.row}>
      <span className={styles.rank}>{rank}</span>

      <span className={styles.rowText}>
        <span className={styles.rowName}>{row.name}</span>
        <span className={styles.rowStyle}>{row.style}</span>
      </span>

      {row.deck ? (
        <span className={styles.rowDeck}>
          {row.deck.cards.map((c, i) => (
            <CardArt
              key={`${c}-${i}`}
              card={c}
              variant={row.deck?.art?.[c]}
              inferred={row.deck?.inferredArt}
              className={styles.rowCard}
            />
          ))}
          <DeckActions cards={row.deck.cards} name={row.name} />
        </span>
      ) : (
        <span className={styles.rowDeck} />
      )}

      <span className={styles.rowMeter}>
        <span className={styles.rowMeterFill} style={{ width: `${Math.min(100, row.winRate)}%` }} />
      </span>

      <span className={styles.rowRate}>{pct(row.winRate)}</span>
      <span className={styles.rowGames}>{num(row.games)}</span>
      <span className={styles.rowTier} data-tier={row.tier ?? 'none'}>
        {row.tier ?? 'thin'}
      </span>
    </div>
  );
}

export function CounterLab() {
  const [link, setLink] = useState('');
  const [cards, setCards] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<DrawnDeck | null>(null);
  const [report, setReport] = useState<CountersReport | null>(null);
  const [loading, setLoading] = useState(false);
  const reading = useHeldLoading(loading);
  const [failed, setFailed] = useState(false);

  /** Paste, press Find counters, THEN the results — and the box empties as they
   *  land. See the note in DeckLab for why it does not fire off a keystroke. */
  function submit(text: string) {
    const keys = parseClashRoyaleDeckLink(text);
    if (!keys) {
      setError('That is not a Clash Royale deck link.');
      return;
    }
    setError(null);
    setCards(keys);
    setLink('');
  }

  useEffect(() => {
    if (!cards) return;
    let live = true;
    setLoading(true);
    setFailed(false);
    fetchDrawnDeck(cards)
      .then((d) => live && setDrawn(d))
      .catch(() => {});
    fetchCounters(cards)
      .then((r) => live && setReport(r))
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cards]);

  /* ENTITLEMENT IS CHECKED HERE, and it was not before.
     Deck Counter is a FREE section, so every tier reaches this screen — which
     means a trial, pro or admin account also reached the "Royal Pro shows the
     rest" wall over the counters beyond the third, and was asked to buy
     something it already had. Same fault as the home screen's ProLock, which
     was removed for the same reason: a gate written before the tier system
     existed does not consult it.
     `entitled` splits the list instead of a constant, so a paying reader sees
     every counter and a free one still sees three. */
  const access = useAccess();
  const entitled = isEntitled(access);
  const counters = report?.counters ?? [];
  const free = entitled ? counters : counters.slice(0, FREE_ROWS);
  const locked = entitled ? [] : counters.slice(FREE_ROWS);

  const form = (
    <>
      <form
        className={styles.paste}
        onSubmit={(e) => {
          e.preventDefault();
          submit(link);
        }}
      >
        <input
          className={`${styles.pasteInput} ${error ? styles.pasteInputError : ''}`}
          value={link}
          spellCheck={false}
          placeholder="Paste a Clash Royale deck link…"
          aria-label="Clash Royale deck link"
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className={styles.pasteButton} aria-disabled={!link.trim()}>
          Find counters
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </>
  );

  if (!cards) {
    return (
      <section className={styles.page}>
        <PasteIntro
          hue="pink"
          icon={ShieldIcon}
          kicker="Deck Counter"
          title={
            <>
              Paste a deck. Find out what <em>beats</em> it.
            </>
          }
          blurb="Every row is that exact list's own record where the evidence exists, so swapping a single card moves the whole table. Each counter comes with the deck people are actually running."
          chips={['Ranked by evidence', 'Real decks, not labels', 'Card-sensitive']}
        >
          {form}
        </PasteIntro>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.body}>
        <PasteHeader hue="pink" icon={ShieldIcon} title="Deck Counter">
          {form}
        </PasteHeader>

      <div className={styles.target}>
          {(drawn?.cards ?? cards).map((c, i) => (
            <CardArt
              key={`${c}-${i}`}
              card={c}
              variant={drawn?.art?.[c]}
              inferred={drawn?.inferredArt}
              className={styles.targetCard}
            />
        ))}
      </div>

      {reading && (
        <ReadingState k="counter-lab" hue="pink">
          Walking the evidence ladder…
        </ReadingState>
      )}
      {failed && (
        <p className={styles.error}>The analytics service is not running, so there is nothing to measure against.</p>
      )}

      {report && counters.length > 0 && (
        <>
          <div className={styles.listHead}>
            <h2 className={styles.listTitle}>
              What beats it
              <span className={styles.listCount}>
                {counters.length} of {report.considered ?? counters.length} archetypes
              </span>
            </h2>
            {report.overall?.winRate != null && (
              <span className={styles.baseline}>
                This deck wins {pct(report.overall.winRate)} against the field
                {report.source ? ` · ${SOURCE_LABEL[report.source]}` : ''}
              </span>
            )}
          </div>

          <div className={styles.list}>
            {free.map((row, i) => (
              <Row key={row.archetype} row={row} rank={i + 1} />
            ))}
          </div>

          {locked.length > 0 && (
            <ProLock
              variant="inline"
              /* Deck Counter's own hue, per SIDE_NAV. This call site never
                 passed one, so the gate fell back to the default violet and sat
                 on a pink screen wearing the wrong colour — badge, lock ring,
                 CTA and now its motes. That is the exact fault the `hue` prop
                 was added to fix ("the colour you pressed is the colour you land
                 on"); the sibling call site in Dashboard.tsx got it and this one
                 was missed. */
              hue="pink"
              title={`${locked.length} more counter${locked.length === 1 ? '' : 's'}`}
              blurb={`This deck has ${counters.length} archetypes that beat it. The top ${FREE_ROWS} are above — Royal Pro shows the rest, with the deck each one is actually running.`}
              perks={[
                'Every counter, not the first three',
                'The real deck behind each row',
                'Head-to-head between any two lists',
              ]}
            >
              {/* The real rows, blurred. A locked feature drawn as an empty box
                  says "nothing here"; drawn as its own content out of focus it
                  says "this exists", which is the only honest way to sell it. */}
              <div className={styles.list}>
                {locked.slice(0, 4).map((row, i) => (
                  <Row key={row.archetype} row={row} rank={FREE_ROWS + i + 1} />
                ))}
              </div>
            </ProLock>
          )}
        </>
      )}

      {report && counters.length === 0 && !loading && (
        <p className={styles.empty}>
          Nothing in the field beats this deck by more than an even matchup — which is a real
          answer, not an empty one. {report.considered ?? 0} archetypes were weighed.
        </p>
      )}
      </div>
    </section>
  );
}
