import { useEffect, useMemo, useState } from 'react';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { parseClashRoyaleDeckLink } from '../../utils/deckLink';
import { CARDS_BY_KEY } from '../../data/cards';
import {
  AnalyticsError,
  fetchCounters,
  fetchDrawnDeck,
  fetchMatchup,
  fetchPlayerCounter,
  type CounterDeckSide,
  type DrawnDeck,
  type WildForm,
  type CountersReport,
  type MatchupReport,
  type MatchupSource,
  type PlayerCounterReport,
  type PlayerMatchup,
  type RepDeck,
} from '../../state/analyticsClient';
import { ReadingState } from './ReadingState';
import { RANGE_PRESETS, useDateWindow, type Season } from './playerData';
import styles from './DeckCounter.module.css';

/* Deck Counter — three questions about what beats what.
 *
 * WHAT THE DATA WOULD AND WOULD NOT SUPPORT, because the shape of this screen
 * is a consequence of it (the numbers are in server/deck_counter.py):
 *
 *   * Matchups are ARCHETYPE-level, not deck-level. Exact deck-vs-deck pairings
 *     are 99.4% singletons — only 0.59% of 1.96M stored pairings have even 8
 *     games — so a per-deck head-to-head would be invented for almost every
 *     input. Every archetype cell clears 50 games.
 *   * Every matchup is SYMMETRISED. The raw table is recorded from the tracked
 *     player's side and tracked players win 58.6% of everything, so read
 *     straight, every deck counters every deck. Mirrors land at exactly 50%
 *     once corrected, which is the proof it is right.
 *   * There is no "average match time" tile, because no match duration is
 *     stored anywhere — not in battles, not in the raw payload.
 */

type Tab = 'player' | 'versus' | 'find';

const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: 'player', label: 'Player Counter', blurb: 'What beats this player, and what they beat.' },
  { id: 'versus', label: 'Deck vs Deck', blurb: 'Paste two decks for the head-to-head.' },
  { id: 'find', label: 'Find Deck Counters', blurb: 'Paste a deck, see what answers it.' },
];

const ICONS = {
  shield: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
    </svg>
  ),
  crown: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M4 18h16l1.2-9-4.7 3.2L12 5l-4.5 7.2L2.8 9z" />
    </svg>
  ),
};

/* What a matchup number is a record OF. Printed beside it, because "62.4% over
   4,000 battles" means one thing when those are this deck's own battles and
   another when they are every deck of its archetype pooled together. */
const SOURCE_LABEL: Record<MatchupSource, string> = {
  exact: 'these two exact decks',
  deck: 'this exact deck',
  cluster7: '1 card different',
  cluster6: '2 cards different',
  archetype: 'archetype average',
};

const nf = new Intl.NumberFormat('en-US');
const pct = (v: number) => `${v.toFixed(1)}%`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function Strip({
  cards,
  art,
  inferred,
  name,
  size = 'md',
}: {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  /** The art was derived from slot rules rather than observed. `CardArt` puts
   *  that in the tooltip instead of presenting a guess as a fact. */
  inferred?: boolean;
  name?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={size === 'sm' ? styles.stripSm : styles.strip}>
      {cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={art?.[c]} inferred={inferred} />
      ))}
      {/* Renders nothing unless this is a whole 8-card deck, which is what
          keeps it off the three card-difference columns below — those are
          partial lists (only-in-A, shared, only-in-B), not decks you can open
          in the game. */}
      <DeckActions cards={cards} name={name} />
    </span>
  );
}

/** A deck the user pasted. Same rendering as every other deck on the screen —
 *  which is the entire fix: a copy-deck link carries only card IDs, so these
 *  used to draw eight plain cards beside a meta deck that had its evolutions
 *  and heroes drawn properly. */
function PastedDeck({ side, size = 'md' }: { side: CounterDeckSide; size?: 'sm' | 'md' }) {
  return (
    <Strip cards={side.cards} art={side.art} inferred={side.inferredArt} name={side.name} size={size} />
  );
}

/** The archetype's current meta deck, drawn inside a matchup row.
 *
 * A row that names "Graveyard" and shows nothing is a row you cannot act on,
 * which is why every table in the design carries the eight cards. Absent only
 * while the meta snapshot is still building. */
function RowDeck({ deck }: { deck?: RepDeck | null }) {
  if (!deck) return <span className={styles.rowDeckEmpty}>—</span>;
  return (
    <span className={styles.rowDeck} title={`${deck.name}${deck.avgElixir ? ` · ${deck.avgElixir} elixir` : ''}`}>
      <Strip cards={deck.cards} art={deck.art} inferred={deck.inferredArt} name={deck.name} size="sm" />
    </span>
  );
}

function Tier({ tier }: { tier: string | null }) {
  return (
    <span className={styles.tier} data-tier={tier ?? 'none'}>
      {tier ? tier[0].toUpperCase() + tier.slice(1) : 'Too few'}
    </span>
  );
}

/** A win rate as a bar plus its own figure — the figure is the encoding that
 *  lets the bar be a colour at all. */
function Meter({ value, kind }: { value: number; kind: 'good' | 'bad' | 'flat' }) {
  return (
    <span className={styles.meter} title={pct(value)}>
      <span className={styles.meterFill} data-kind={kind} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function MatchupRow({ m, showYours }: { m: PlayerMatchup; showYours?: boolean }) {
  // COLOUR THE NUMBER THAT IS ON SCREEN, not the one it was derived from. In
  // the "bring this against them" table the figures are YOUR win rate, so a
  // matchup the player is weak in is good news — it was being painted red
  // because the colour still followed the player's own diff.
  const shown = showYours ? -m.diff : m.diff;
  const kind = shown < -2 ? 'bad' : shown > 2 ? 'good' : 'flat';
  return (
    <li className={styles.row}>
      <span className={styles.rowName}>
        {m.name}
        <span className={styles.rowStyle}>{m.style}</span>
      </span>
      <RowDeck deck={m.deck} />
      <span className={styles.rowFig} data-kind={kind}>
        {pct(showYours ? (m.yourWinRate ?? 100 - m.winRate) : m.winRate)}
      </span>
      <Meter value={showYours ? (m.yourWinRate ?? 100 - m.winRate) : m.winRate} kind={kind} />
      <span className={styles.rowGames}>{nf.format(m.battles)}</span>
      <span className={styles.rowDiff} data-kind={kind}>
        {signed(showYours ? -m.diff : m.diff)}
      </span>
      <Tier tier={m.tier} />
    </li>
  );
}

/* ------------------------------------------------------------- paging */

/** How many rows a list shows before you ask for more. */
const PAGE = 5;

/**
 * A list of matchup rows that pages.
 *
 * Every one of these lists used to be cut to five by the server, while the
 * tile above them announced "16 matchups analyzed" — a number the page could
 * not honour, with no control anywhere to reach the other eleven. The server
 * now returns all of them and the paging lives here, where the component
 * knows how much room it has.
 *
 * State is per-list and resets when the underlying rows change, so switching
 * date range does not leave a list expanded to a length the new data may not
 * have.
 */
function MatchupList({
  rows,
  showYours,
  empty,
}: {
  rows: PlayerMatchup[];
  showYours?: boolean;
  empty: string;
}) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [rows]);

  if (rows.length === 0) return <p className={styles.empty}>{empty}</p>;
  const left = rows.length - shown;
  return (
    <>
      <ol className={styles.rows}>
        {rows.slice(0, shown).map((m) => (
          <MatchupRow key={m.archetype} m={m} showYours={showYours} />
        ))}
      </ol>
      {left > 0 && (
        <button type="button" className={styles.more} onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, left)} more · {left} left
        </button>
      )}
      {left <= 0 && shown > PAGE && (
        <button type="button" className={styles.more} onClick={() => setShown(PAGE)}>
          Show fewer
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------ deck input */

/**
 * The paste box, which draws the deck AS SOON AS THE LINK PARSES.
 *
 * It used to render the raw link order with plain art and only take on its real
 * slots and its evolution/hero frames when the Compare response came back —
 * seconds later, after the user had already looked at it, so the deck visibly
 * rearranged itself under them. The arrangement is a server decision (see
 * `arrange_deck`; a TypeScript copy of it would be a second version of a rule
 * the meta board, the player screens and the PDF all have to agree on), so the
 * box asks for it directly on paste. That request touches no database — it is a
 * dictionary hit on the meta snapshot plus the arrangement — so it lands within
 * a frame or two of the keystroke.
 *
 * The raw strip is still rendered while the answer is in flight, because a
 * blank box for one frame is worse than an unstyled one, and because the API
 * being down should degrade to "your eight cards" rather than to nothing.
 */
function DeckInput({
  label,
  cards,
  onCards,
  onWild,
}: {
  label: string;
  cards: string[];
  onCards: (c: string[]) => void;
  /** The slot-3 choice, reported up so the RESULT can be drawn the same way.
   *  Without this the preview honoured the pick and the result reverted to
   *  evolution the moment you pressed the button, which reads exactly like the
   *  control not working. */
  onWild?: (w: WildForm | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<DrawnDeck | null>(null);
  // Slot 3's form, when the player has said. Cleared with the deck.
  const [wild, setWild] = useState<WildForm | null>(null);

  useEffect(() => {
    if (cards.length === 0) {
      setDrawn(null);
      return;
    }
    let live = true;
    fetchDrawnDeck(cards, wild ?? undefined)
      .then((d) => live && setDrawn(d))
      .catch(() => live && setDrawn(null));
    return () => {
      live = false;
    };
    // The deck's identity is its cards, and the array is rebuilt on every
    // keystroke — so compare the contents, not the reference.
  }, [cards.join(','), wild]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = drawn && drawn.cards.length === cards.length;

  return (
    <div className={styles.deckBox}>
      <span className={styles.deckLabel}>{label}</span>
      <div className={styles.pasteRow}>
        <input
          className={styles.paste}
          value={text}
          placeholder="Paste deck link or deck code"
          spellCheck={false}
          aria-label={`${label} deck link`}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (!v.trim()) {
              setError(null);
              onCards([]);
              return;
            }
            const parsed = parseClashRoyaleDeckLink(v);
            if (parsed) {
              setError(null);
              setWild(null);
              onWild?.(null);
              onCards(parsed);
              // Empty the field the moment it parses: the strip below is the
              // state, and the box's job is now the NEXT link. Clearing the
              // deck moved to its own control, since emptying a box that
              // empties itself can no longer mean anything.
              setText('');
            } else {
              setError('Not a Clash Royale deck link');
              onCards([]);
            }
          }}
        />
        {cards.length > 0 && (
          <button
            type="button"
            className={styles.pasteClear}
            title="Remove this deck"
            aria-label={`Remove ${label}`}
            onClick={() => {
              setText('');
              setError(null);
              setWild(null);
              onWild?.(null);
              onCards([]);
            }}
          >
            ×
          </button>
        )}
      </div>
      {error && <p className={styles.deckError}>{error}</p>}
      {cards.length > 0 &&
        (ready ? (
          <Strip cards={drawn.cards} art={drawn.art} inferred={drawn.inferredArt} />
        ) : (
          <Strip cards={cards} />
        ))}

      {/* SLOT 3 IS THE AMBIGUOUS ONE. The link gives the three special slots in
          order, so slots 1 and 2 are decided — but four cards (knight,
          valkyrie, musketeer, wizard) can be either an evolution or a hero, and
          a link that puts one in the wild slot cannot say which. Nothing in the
          data can settle it, so the person who pasted the deck does. Same
          choice the builder offers on its own wild slot. */}
      {ready && drawn.wildChoosable && drawn.wildSlot && (
        <div className={styles.wildPick}>
          <span className={styles.wildLabel}>
            Slot 3 · {CARDS_BY_KEY.get(drawn.wildSlot)?.name ?? drawn.wildSlot}
          </span>
          {(['evolution', 'hero'] as const).map((form) => (
            <button
              key={form}
              type="button"
              className={`${styles.wildOption} ${drawn.wild === form ? styles.wildOn : ''}`}
              aria-pressed={drawn.wild === form}
              onClick={() => {
                setWild(form);
                onWild?.(form);
              }}
            >
              <CardArt card={drawn.wildSlot!} variant={form} />
              {form === 'hero' ? 'Hero' : 'Evolution'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the screen */

export function DeckCounter({ tag, season = 'Current Season' }: { tag: string; season?: Season }) {
  const [tab, setTab] = useState<Tab>('player');

  const [report, setReport] = useState<PlayerCounterReport | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);

  const [deckA, setDeckA] = useState<string[]>([]);
  const [deckB, setDeckB] = useState<string[]>([]);
  const [versus, setVersus] = useState<MatchupReport | null>(null);
  const [target, setTarget] = useState<string[]>([]);
  const [counters, setCounters] = useState<CountersReport | null>(null);
  // Paged the same way as the player lists; reset whenever a new deck is
  // analysed so an expanded view does not carry over to a shorter result.
  const [counterShown, setCounterShown] = useState(PAGE);
  // Slot-3 choices, held here because the RESULT requests need them too.
  const [wildA, setWildA] = useState<WildForm | null>(null);
  const [wildB, setWildB] = useState<WildForm | null>(null);
  const [wildTarget, setWildTarget] = useState<WildForm | null>(null);
  useEffect(() => setCounterShown(PAGE), [counters]);
  const [busy, setBusy] = useState(false);

  const { win, preset, setPreset } = useDateWindow(season, report?.coverage.end ?? null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchPlayerCounter(tag, win)
      .then((r) => live && (setReport(r), setError(null)))
      .catch((e) => live && (setReport(null), setError(e as AnalyticsError)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, preset, win.from, win.to]);

  /* The three columns keep each side's ART, so a card that is only in deck A
     and is A's evolution is drawn as that evolution. The shared column takes
     A's reading — a card can legally be the evolution in one deck and plain in
     the other, and picking a side is honest where merging them is not. */
  const cardDiff = useMemo(() => {
    const A = new Set(deckA);
    const B = new Set(deckB);
    return {
      onlyA: deckA.filter((c) => !B.has(c)),
      onlyB: deckB.filter((c) => !A.has(c)),
      both: deckA.filter((c) => B.has(c)),
    };
  }, [deckA, deckB]);

  if (loading) {
    return (
      <div className={styles.page}>
        <ReadingState className={styles.notice} hue="pink">
          Reading matchups…
        </ReadingState>
      </div>
    );
  }

  if (error || !report) {
    const offline = error?.kind === 'offline';
    return (
      <div className={styles.page}>
        <section className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'No stored battles for that tag'}
          </h2>
          <p className={styles.noticeBody}>{offline ? error?.message : `Nothing stored for ${tag}.`}</p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </section>
      </div>
    );
  }

  const st = report.status;
  const building = st.building;

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.headIcon}>{ICONS.shield}</span>
          <div className={styles.headText}>
            <h1 className={styles.title}>Deck Counter</h1>
            <p className={styles.blurb}>{TABS.find((t) => t.id === tab)?.blurb}</p>
          </div>
          {tab === 'player' && (
            <div className={styles.range}>
              {RANGE_PRESETS.filter((r) => r.days >= 0).map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className={`${styles.chip} ${preset === r.days ? styles.chipOn : ''}`}
                  onClick={() => setPreset(r.days)}
                >
                  {r.label.replace('Last ', '').replace(' Days', 'd').replace('All Data', 'All')}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabOn : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ------------------------------------------------- player counter */}
        {tab === 'player' && (
          <>
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Player win rate</span>
                <span className={styles.tileBig}>{pct(report.player.winRate)}</span>
                <span className={styles.tileSub}>across every stored battle in the window</span>
              </div>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Worst matchup</span>
                <span className={styles.tileBig} data-kind="bad">
                  {report.worst[0] ? signed(report.worst[0].diff) : '—'}
                </span>
                <span className={styles.tileSub}>
                  {report.worst[0] ? `vs ${report.worst[0].name}, against their own average` : 'not enough data'}
                </span>
              </div>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Matchups analyzed</span>
                <span className={styles.tileBig}>{report.analyzed}</span>
                <span className={styles.tileSub}>
                  archetypes with {report.minBattles}+ battles behind them
                </span>
              </div>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Battles</span>
                <span className={styles.tileBig}>{nf.format(report.player.battles)}</span>
                <span className={styles.tileSub}>
                  {shortDay(report.window.from)} – {shortDay(report.window.to)}
                </span>
              </div>
            </div>

            <div className={styles.two}>
              <section className={styles.block}>
                <h2 className={styles.blockTitle}>
                  Worst matchups
                  <span className={styles.blockCount}>{report.worst.length}</span>
                </h2>
                <p className={styles.blockNote}>Below this player&rsquo;s own average.</p>
                <MatchupList rows={report.worst} empty="Not enough battles yet." />
              </section>

              <section className={styles.block}>
                <h2 className={styles.blockTitle}>
                  Best matchups
                  <span className={styles.blockCount}>{report.best.length}</span>
                </h2>
                <p className={styles.blockNote}>At or above their own average.</p>
                <MatchupList rows={report.best} empty="Not enough battles yet." />
              </section>
            </div>

            <section className={styles.block}>
              <h2 className={styles.blockTitle}>
                Bring this against them
                <span className={styles.blockCount}>{report.recommended.length}</span>
              </h2>
              <p className={styles.blockNote}>
                The archetypes this player does worst against, stated from your side of the board.
              </p>
              <MatchupList rows={report.recommended} showYours empty="Not enough battles yet." />
            </section>
          </>
        )}

        {/* ---------------------------------------------------- deck vs deck */}
        {tab === 'versus' && (
          <>
            {/* Face to face. These two are a comparison and belong beside each
                other; the worst/best lists below are read one after the other
                and use the stacked `.two`. */}
            <div className={styles.facing}>
              <DeckInput label="Deck A" cards={deckA} onCards={setDeckA} onWild={setWildA} />
              <DeckInput label="Deck B" cards={deckB} onCards={setDeckB} onWild={setWildB} />
            </div>

            <button
              type="button"
              className={styles.action}
              disabled={deckA.length === 0 || deckB.length === 0 || busy}
              onClick={() => {
                setBusy(true);
                fetchMatchup(deckA, deckB, wildA, wildB)
                  .then(setVersus)
                  .catch(() => setVersus(null))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Comparing…' : 'Compare decks'}
            </button>

            {versus && (
              <>
                <div className={styles.versus}>
                  <div className={styles.side} data-side="a">
                    <span className={styles.sideName}>{versus.a.name}</span>
                    <span className={styles.sideBig}>
                      {versus.matchup ? pct(versus.matchup.winRate) : '—'}
                    </span>
                    <span className={styles.sideSub}>{versus.a.avgElixir} avg elixir</span>
                    <PastedDeck side={versus.a} size="sm" />
                  </div>
                  <div className={styles.mid}>
                    <span className={styles.midBig}>
                      {versus.matchup ? nf.format(versus.matchup.games) : '—'}
                    </span>
                    <span className={styles.midSub}>battles behind it</span>
                    {versus.matchup && <Tier tier={versus.matchup.tier} />}
                    {/* WHOSE record this is. A percentage from this exact list's
                        own battles and the same percentage from the archetype
                        average are different claims. */}
                    {versus.source && (
                      <span className={styles.source} data-source={versus.source}>
                        {SOURCE_LABEL[versus.source]}
                      </span>
                    )}
                  </div>
                  <div className={styles.side} data-side="b">
                    <span className={styles.sideName}>{versus.b.name}</span>
                    <span className={styles.sideBig}>
                      {versus.matchup ? pct(100 - versus.matchup.winRate) : '—'}
                    </span>
                    <span className={styles.sideSub}>{versus.b.avgElixir} avg elixir</span>
                    <PastedDeck side={versus.b} size="sm" />
                  </div>
                </div>

                {!versus.matchup && (
                  <p className={styles.empty}>
                    {building
                      ? 'The matchup matrix is still building — it takes about a minute on first start.'
                      : 'Too few stored battles between these archetypes to report a matchup.'}
                  </p>
                )}

                {versus.matchup && (
                  <>
                    <div className={styles.tiles}>
                      <div className={styles.tile}>
                        <span className={styles.tileLabel}>Crown difference</span>
                        <span className={styles.tileBig}>{signed(versus.matchup.crownDiff)}</span>
                        <span className={styles.tileSub}>
                          {versus.matchup.avgCrownsFor} vs {versus.matchup.avgCrownsAgainst} per battle
                        </span>
                      </div>
                      <div className={styles.tile}>
                        <span className={styles.tileLabel}>Three-crown wins</span>
                        <span className={styles.tileBig}>{pct(versus.matchup.threeCrownFor)}</span>
                        <span className={styles.tileSub}>
                          against {pct(versus.matchup.threeCrownAgainst)} the other way
                        </span>
                      </div>
                      <div className={styles.tile}>
                        <span className={styles.tileLabel}>Record</span>
                        <span className={styles.tileBig}>
                          {nf.format(versus.matchup.wins)}–{nf.format(versus.matchup.losses)}
                        </span>
                        <span className={styles.tileSub}>
                          {versus.matchup.interval ? `95% CI ${versus.matchup.interval}` : 'wins–losses'}
                        </span>
                      </div>
                      <div className={styles.tile}>
                        <span className={styles.tileLabel}>Mirror?</span>
                        <span className={styles.tileBig}>{versus.mirror ? 'Yes' : 'No'}</span>
                        <span className={styles.tileSub}>
                          {versus.mirror
                            ? 'the same eight cards — 50% by construction'
                            : versus.sameArchetype
                              ? 'same archetype, different lists'
                              : 'different archetypes'}
                        </span>
                      </div>
                    </div>

                    {/* THE LADDER. The headline above is the narrowest
                        reading; these are the wider ones. 104 battles from this
                        exact list and 70,000 from lists one card different are
                        both worth seeing, and so is the case where they
                        disagree. */}
                    {versus.ladder && versus.ladder.length > 1 && (
                      <section className={styles.block}>
                        <h2 className={styles.blockTitle}>
                          How much evidence, and how close a match
                        </h2>
                        <p className={styles.blockNote}>
                          The same matchup read from progressively wider sets of decks. The top
                          row is {versus.a.name} exactly as pasted; each row below relaxes how
                          many cards have to match.
                        </p>
                        <ol className={styles.rows}>
                          <li className={`${styles.rowHead} ${styles.ladderRow}`} aria-hidden="true">
                            <span>Measured on</span>
                            <span>Decks pooled</span>
                            <span>Win rate</span>
                            <span />
                            <span>Battles</span>
                            <span>Evidence</span>
                          </li>
                          {versus.ladder.map((r) => (
                            <li key={r.source} className={`${styles.row} ${styles.ladderRow}`}>
                              <span className={styles.rowName}>{SOURCE_LABEL[r.source]}</span>
                              <span className={styles.rowGames}>
                                {r.decks == null ? 'every deck' : nf.format(r.decks)}
                              </span>
                              <span
                                className={styles.rowFig}
                                data-kind={r.winRate > 52 ? 'good' : r.winRate < 48 ? 'bad' : 'flat'}
                              >
                                {pct(r.winRate)}
                              </span>
                              <Meter
                                value={r.winRate}
                                kind={r.winRate > 52 ? 'good' : r.winRate < 48 ? 'bad' : 'flat'}
                              />
                              <span className={styles.rowGames}>{nf.format(r.games)}</span>
                              <Tier tier={r.tier} />
                            </li>
                          ))}
                        </ol>
                      </section>
                    )}

                    <section className={styles.block}>
                      <h2 className={styles.blockTitle}>Card difference</h2>
                      <div className={styles.diffGrid}>
                        <div>
                          <span className={styles.diffLabel} data-side="a">
                            Only in {versus.a.name}
                          </span>
                          <Strip cards={cardDiff.onlyA} art={versus.a.art} inferred={versus.a.inferredArt} />
                        </div>
                        <div>
                          <span className={styles.diffLabel}>Shared ({cardDiff.both.length})</span>
                          <Strip cards={cardDiff.both} art={versus.a.art} inferred={versus.a.inferredArt} />
                        </div>
                        <div>
                          <span className={styles.diffLabel} data-side="b">
                            Only in {versus.b.name}
                          </span>
                          <Strip cards={cardDiff.onlyB} art={versus.b.art} inferred={versus.b.inferredArt} />
                        </div>
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ----------------------------------------------------- find counters */}
        {tab === 'find' && (
          <>
            <DeckInput label="Target deck" cards={target} onCards={setTarget} onWild={setWildTarget} />
            <button
              type="button"
              className={styles.action}
              disabled={target.length === 0 || busy}
              onClick={() => {
                setBusy(true);
                fetchCounters(target, wildTarget)
                  .then(setCounters)
                  .catch(() => setCounters(null))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Searching…' : 'Find counters'}
            </button>

            {counters && (
              <>
                <div className={styles.tiles}>
                  <div className={styles.tile}>
                    <span className={styles.tileLabel}>Target archetype</span>
                    <span className={styles.tileBig}>{counters.target.name}</span>
                    <span className={styles.tileSub}>{counters.target.avgElixir} avg elixir</span>
                    <PastedDeck side={counters.target} size="sm" />
                  </div>
                  <div className={styles.tile}>
                    <span className={styles.tileLabel}>Its win rate vs the field</span>
                    <span className={styles.tileBig}>
                      {counters.overall?.winRate != null ? pct(counters.overall.winRate) : '—'}
                    </span>
                    <span className={styles.tileSub}>
                      over {nf.format(counters.overall?.games ?? 0)} battles
                    </span>
                  </div>
                  <div className={styles.tile}>
                    <span className={styles.tileLabel}>Real counters found</span>
                    <span className={styles.tileBig}>{counters.counters.length}</span>
                    <span className={styles.tileSub}>
                      of {counters.considered ?? 0} archetypes weighed — only those over 50%
                    </span>
                  </div>
                </div>

                <section className={styles.block}>
                  <h2 className={styles.blockTitle}>
                    What beats it
                    <span className={styles.blockCount}>{counters.counters.length}</span>
                  </h2>
                  {counters.counters.length === 0 ? (
                    <p className={styles.empty}>
                      {building
                        ? 'The matchup matrix is still building — about a minute on first start.'
                        : 'No archetype has a winning record against this one.'}
                    </p>
                  ) : (
                    <>
                      <ol className={styles.rows}>
                        <li className={`${styles.rowHead} ${styles.withSource}`} aria-hidden="true">
                          <span>Archetype</span>
                          <span>Deck</span>
                          <span>Win rate</span>
                          <span />
                          <span>Battles</span>
                          <span>Adv.</span>
                          <span>Evidence</span>
                          <span>Measured on</span>
                        </li>
                        {counters.counters.slice(0, counterShown).map((c) => (
                          <li key={c.archetype} className={`${styles.row} ${styles.withSource}`}>
                            <span className={styles.rowName}>
                              {c.name}
                              <span className={styles.rowStyle}>{c.style}</span>
                            </span>
                            <RowDeck deck={c.deck} />
                            <span className={styles.rowFig} data-kind="good">
                              {pct(c.winRate)}
                            </span>
                            <Meter value={c.winRate} kind="good" />
                            <span className={styles.rowGames}>{nf.format(c.games)}</span>
                            <span className={styles.rowDiff} data-kind="good">
                              {c.advantage != null ? signed(c.advantage) : '—'}
                            </span>
                            <Tier tier={c.tier} />
                            {/* Per row, because a table can mix the two: an
                                archetype this deck has met often gets its own
                                record, a rare one falls back to the average. */}
                            <span className={styles.source} data-source={c.source ?? 'archetype'}>
                              {SOURCE_LABEL[c.source ?? 'archetype']}
                            </span>
                          </li>
                        ))}
                      </ol>
                      {counters.counters.length > counterShown && (
                        <button
                          type="button"
                          className={styles.more}
                          onClick={() => setCounterShown((n) => n + PAGE)}
                        >
                          Show {Math.min(PAGE, counters.counters.length - counterShown)} more ·{' '}
                          {counters.counters.length - counterShown} left
                        </button>
                      )}
                    </>
                  )}
                </section>

                {/* THE REAL GAMES. The table above needs 8 battles before it
                    will quote a percentage, which is right for a rate and
                    wrong as a reason to hide a match that actually happened —
                    a deck that lost 0-3 to a specific list was disappearing
                    behind archetype rows measured on other decks. Stated as a
                    record, never as a rate. */}
                {counters.played && counters.played.length > 0 && (
                  <section className={styles.block}>
                    <h2 className={styles.blockTitle}>
                      Decks this list has actually met
                      <span className={styles.blockCount}>{counters.played.length}</span>
                    </h2>
                    <p className={styles.blockNote}>
                      Real games, with no evidence floor — including one-offs. Shown as a
                      win–loss record rather than a percentage, because two games is not a
                      win rate. The table above is the estimate; this is the history.
                    </p>
                    <ol className={styles.rows}>
                      {counters.played.map((d) => (
                        <li key={d.cards.join(',')} className={`${styles.row} ${styles.playedRow}`}>
                          <span className={styles.rowName}>
                            {d.name}
                            <span className={styles.rowStyle}>{d.style}</span>
                          </span>
                          <span className={styles.rowDeck}>
                            <Strip
                              cards={d.cards}
                              art={d.art}
                              inferred={d.inferredArt}
                              name={d.name}
                              size="sm"
                            />
                          </span>
                          <span
                            className={styles.rowFig}
                            data-kind={d.beatsYou ? 'bad' : d.wins > d.losses ? 'good' : 'flat'}
                          >
                            {d.wins}&ndash;{d.losses}
                          </span>
                          <span className={styles.rowGames}>
                            {d.games === 1 ? '1 game' : `${nf.format(d.games)} games`}
                          </span>
                          <span className={styles.source} data-source={d.beatsYou ? 'archetype' : 'deck'}>
                            {d.beatsYou ? 'beat you' : d.wins > d.losses ? 'you beat it' : 'even'}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {counters.styles.length > 0 && (
                  <section className={styles.block}>
                    <h2 className={styles.blockTitle}>Counter styles</h2>
                    <p className={styles.blockNote}>
                      Share of the battles won against this archetype, by play style. The style
                      grouping is editorial — the database stores a win condition, not a play
                      style.
                    </p>
                    <div className={styles.styles}>
                      {counters.styles.map((s) => (
                        <span key={s.style} className={styles.styleRow}>
                          <span className={styles.styleName}>{s.style}</span>
                          <Meter value={s.share} kind="flat" />
                          <span className={styles.styleShare}>{pct(s.share)}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}

        <footer className={styles.foot}>
          {ICONS.crown} <strong>Duels and ladder both count.</strong> The stored matchup table
          carries no game-mode filter, so a deck&rsquo;s record here pools every 1v1 it has played
          — measured, duel battles are present at 72.7% against 61.3% for ladder ones. The one
          thing that cannot be counted is a native duel row: it stores a 16- or 24-card loadout
          and the series result, with no per-game scoreline to attribute to a deck.{' '}
          Every figure is <strong>symmetrised</strong> — the table is recorded from the tracked
          player&rsquo;s side and tracked players win{' '}
          {st.rawBias != null ? pct(st.rawBias) : '58.6%'} of everything, so read raw every deck
          counters every deck. Combining each pairing with its reverse cancels that, which is why
          a mirror comes out at exactly 50%. Two exact lists are only reported against each other
          when they have really met: 99.4% of the 1.98M stored pairings have fewer than 8 games,
          which is what the wider rungs are for.
          {st.ageSeconds != null && ` Matrix computed ${Math.round(st.ageSeconds / 60)} min ago.`}
        </footer>
      </section>
    </div>
  );
}
