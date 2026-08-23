import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { CARDS_BY_KEY } from '../../data/cards';
import { parseClashRoyaleDeckLink } from '../../utils/deckLink';
import {
  AnalyticsError,
  fetchCoachPrediction,
  fetchCoachSuggestion,
  fetchDrawnDeck,
  type CoachDeck,
  type CoachHistory,
  type CoachPrediction,
  type CoachSuggestion,
  type WildForm,
  fetchOpponentRead,
  type OpponentReadOutcome,
} from '../../state/analyticsClient';
import { pushMetric } from '../../state/oieMetrics';
import styles from './CoachAssist.module.css';

/* Coach Assist — two windows over `server/coach.py`.
 *
 *   Duel Prediction   what THEY will bring        (the bot's !predict/2/3)
 *   Suggestion        what YOU should answer with (the bot's !suggestion)
 *
 * BOTH ARE INTERVIEWS, NOT FORMS, and that is the whole design. A duel has a
 * state — nothing played, one deck shown, two decks shown — and the answer is a
 * different question at each one. Presenting every field at once would ask a
 * coach mid-duel to work out which boxes apply; asking one question at a time
 * cannot be got wrong, and the step you are on IS the state of the duel.
 *
 * The flow state lives here and nowhere else. The server holds nothing between
 * calls, so a reload lands on question one rather than resuming a duel that has
 * since finished.
 *
 * Every deck comes back already arranged into its slots with its evolution and
 * hero art resolved by the same `arrange_deck` the meta board uses — so a deck
 * drawn here is drawn identically to the same deck anywhere else in the app.
 */

const WINDOWS = [
  {
    id: 'predict' as const,
    label: 'Duel Prediction',
    blurb: 'What this player will bring, and what is left after each reveal.',
  },
  {
    id: 'suggest' as const,
    label: 'Suggestion',
    blurb: 'What to play next — your decks ranked against their likely deck.',
  },
];

/** Which rung of the evidence ladder a number came from. Shown rather than
 *  hidden: "62%" from this exact list and "62%" from its archetype are
 *  different claims and the reader is entitled to know which. */
const SOURCE_LABEL: Record<string, string> = {
  exact: 'these two exact decks have met',
  deck: 'this exact deck vs that archetype',
  cluster7: 'decks one card different',
  cluster6: 'decks two cards different',
  archetype: 'archetype vs archetype',
};

const ICONS = {
  coach: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3 7l9 4 9-4-9-4Z" />
      <path d="M7 9.5V15c0 1.7 2.2 3 5 3s5-1.3 5-3V9.5" />
      <path d="M21 7v6" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5 8 12l7 7" />
    </svg>
  ),
};

function pct(n: number | null | undefined, digits = 0): string {
  return n === null || n === undefined ? '—' : `${(n * 100).toFixed(digits)}%`;
}

/** One state-of-the-duel answer. The hue is the stage, not decoration, and it
 *  is the same in both windows — green nothing played, blue one game, violet
 *  two — so it is worth learning once. */
function Choice({
  hue,
  onClick,
  children,
}: {
  hue: 'green' | 'blue' | 'violet' | 'pink';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={styles.choice} data-hue={hue} onClick={onClick}>
      <span className={styles.choiceDot} />
      {children}
    </button>
  );
}

/** Eight cards, drawn the way every other screen draws them. */
function Strip({
  cards,
  art,
  inferred,
  name,
  size = 'md',
}: {
  cards: string[];
  art?: Record<string, WildForm>;
  inferred?: boolean;
  name?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={size === 'sm' ? styles.stripSm : styles.strip}>
      {cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={art?.[c]} inferred={inferred} />
      ))}
      {/* The whole point of this screen is "bring this next" — so the deck it
          recommends has to be one press from being in the game. */}
      <DeckActions cards={cards} name={name} />
    </span>
  );
}

/** One question, with its answer buttons. The interview's only shape. */
function Ask({
  step,
  question,
  hint,
  children,
  onBack,
}: {
  step: string;
  question: string;
  hint?: string;
  children: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className={styles.ask}>
      <div className={styles.askHead}>
        <span className={styles.askStep}>{step}</span>
        {onBack && (
          <button type="button" className={styles.back} onClick={onBack}>
            {ICONS.back} Back
          </button>
        )}
      </div>
      <h3 className={styles.askQuestion}>{question}</h3>
      {hint && <p className={styles.askHint}>{hint}</p>}
      <div className={styles.askActions}>{children}</div>
    </div>
  );
}

/**
 * A deck the user pastes into the interview.
 *
 * Draws on paste rather than on submit, for the reason the Deck Counter box
 * already does: a copy-deck link carries eight card IDs and nothing else, so
 * the slots and the evolution/hero art have to come from the server. Asking
 * for them immediately means the preview you confirm is the deck the answer is
 * computed from.
 */
function PasteDeck({
  label,
  hint,
  onConfirm,
  onBack,
}: {
  label: string;
  /** "Deck 1 of 2" — so a multi-deck question says how far through it is. */
  hint?: string;
  onConfirm: (cards: string[]) => void;
  onBack?: () => void;
}) {
  const [text, setText] = useState('');
  const [cards, setCards] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<{ cards: string[]; art: Record<string, WildForm>; inferredArt: boolean; wildSlot: string | null; wildChoosable: boolean; wild: WildForm | null } | null>(null);
  const [wild, setWild] = useState<WildForm | null>(null);

  useEffect(() => {
    if (!cards.length) {
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
    // The deck's identity is its cards; the array is rebuilt every keystroke.
  }, [cards.join(','), wild]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = drawn && drawn.cards.length === cards.length;

  return (
    <div className={styles.pasteBox}>
      <div className={styles.askHead}>
        <span className={styles.askStep}>{label}</span>
        {onBack && (
          <button type="button" className={styles.back} onClick={onBack}>
            {ICONS.back} Back
          </button>
        )}
      </div>
      {hint && <p className={styles.askHint}>{hint}</p>}
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
            setWild(null);
            if (!v.trim()) {
              setError(null);
              setCards([]);
              return;
            }
            const parsed = parseClashRoyaleDeckLink(v);
            if (parsed) {
              setError(null);
              setCards(parsed);
              // Empties on a successful parse — the strip below is the state,
              // and the interview asks for several decks in a row, so the box
              // has to be ready for the next one without being emptied by hand.
              setText('');
            } else {
              setError('Not a Clash Royale deck link');
              setCards([]);
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
              setCards([]);
            }}
          >
            ×
          </button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}

      {cards.length > 0 &&
        (ready ? (
          <Strip cards={drawn.cards} art={drawn.art} inferred={drawn.inferredArt} />
        ) : (
          <Strip cards={cards} />
        ))}

      {/* Slot 3 is the one a link cannot settle — knight, valkyrie, musketeer
          and wizard have both forms. Same picker as the Deck Counter. */}
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
              onClick={() => setWild(form)}
            >
              {form === 'evolution' ? 'Evolution' : 'Hero'}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className={styles.primary}
        disabled={cards.length !== 8}
        onClick={() => onConfirm(ready ? drawn.cards : cards)}
      >
        {cards.length === 8 ? 'Continue' : 'Paste a deck to continue'}
      </button>
    </div>
  );
}

/** A deck row inside a result list. */
function DeckRow({
  deck,
  rank,
  hue,
  showProb = true,
}: {
  deck: CoachDeck;
  rank?: number;
  hue: 'violet' | 'blue' | 'green' | 'pink';
  /** Whether the row carries a figure at all. The Duel Prediction lists set
   *  this false — a "6% likely" beside every deck was noise there: the list is
   *  already ordered, and the rank says the same thing without asking anyone to
   *  compare six small percentages. Where a number is the point (the
   *  Suggestion's expected win rate, the opponent distribution) it stays. */
  showProb?: boolean;
}) {
  const exp = deck.expected;
  const figure = exp || (showProb && deck.prob !== undefined);
  return (
    <li className={styles.deckRow} data-hue={hue} data-nofigure={figure ? undefined : ''}>
      {/* The rank cell is ALWAYS rendered, empty when there is no number.
          A grid places children in order, so omitting it shifted every later
          cell one track left: the cards landed in the 11rem name column and
          drew at 19.4px — (176px - 21px of gutters) / 8, exactly — while the
          wide deck track sat empty off the end of the row. */}
      {rank !== undefined ? (
        <span className={styles.rank}>{rank}</span>
      ) : (
        <span className={styles.rankEmpty} aria-hidden="true" />
      )}
      <div className={styles.deckIdent}>
        <span className={styles.deckName}>
          {deck.deckName || deck.archetype}
          {deck.fill && <span className={styles.fillTag}>meta deck</span>}
        </span>
        <span className={styles.deckMeta}>
          {deck.avgElixir ? `${deck.avgElixir.toFixed(1)} elixir` : ''}
          {deck.count ? `${deck.avgElixir ? ' · ' : ''}played ${deck.count}×` : ''}
          {/* The co-occurrence count DRIVES the ranking, so hiding it makes the
              list look mis-sorted against the usage figures. */}
          {deck.coRevealed ? ` · ${deck.coRevealed}× alongside the revealed deck` : ''}
        </span>
      </div>
      <Strip
        cards={deck.cards}
        art={deck.art}
        inferred={deck.inferredArt}
        name={deck.deckName}
        size="sm"
      />
      {exp ? (
        <div className={styles.figure} title={SOURCE_LABEL[exp.per[0]?.matchup?.source ?? ''] ?? ''}>
          <span className={styles.figureValue} data-good={exp.winRate >= 50 ? '' : undefined}>
            {exp.winRate.toFixed(1)}%
          </span>
          <span className={styles.figureLabel}>expected</span>
        </div>
      ) : showProb && deck.prob !== undefined ? (
        <div className={styles.figure}>
          <span className={styles.figureValue}>{pct(deck.prob)}</span>
          <span className={styles.figureLabel}>likely</span>
        </div>
      ) : showProb ? (
        <div className={styles.figure}>
          <span className={styles.figureValue}>—</span>
          <span className={styles.figureLabel}>no evidence</span>
        </div>
      ) : null}
    </li>
  );
}

/** '2026-07-26T…' -> '26 Jul'. */
function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * THEIR ACTUAL DUEL LOG for the decks shown — not a ranking, a record.
 *
 * Everything above this block reasons about what they *could* bring. This goes
 * back through the series that really began this way and reports what followed,
 * in game order, with the dates and the results. Where it finds anything it is
 * the strongest statement on the screen, because it is not a prediction.
 *
 * Ordered series only, and it says how many it searched: a native duel row
 * stores a loadout rather than a game sequence, so reading an order off one
 * would be an artefact of storage.
 */
function DuelLog({ history }: { history: CoachHistory }) {
  // Defensive, and it earned its place: an API process left running on the old
  // response shape returned `series` where this expects `loadouts`, and the
  // unguarded `.map` took the whole screen down rather than degrading one
  // block. A panel this far down the page must never be able to do that.
  const loadouts = history.loadouts ?? [];
  const companions = history.nextDecks ?? [];

  if (!history.matched || !loadouts.length) {
    return (
      <section className={styles.block} data-hue="green">
        <h4 className={styles.blockTitle}>
          Their duel loadouts with this deck
          <span className={styles.blockNote}>from their duel log</span>
        </h4>
        <p className={styles.empty}>
          Nothing on record — searched {history.searched} stored duel
          {history.searched === 1 ? '' : 's'} for a loadout containing{' '}
          {history.searchedFor === 1 ? 'this deck' : 'both decks'}. The ranking above is
          the read.
        </p>
      </section>
    );
  }

  const unordered = history.matched - history.ordered;

  return (
    <section className={styles.block} data-hue="green">
      <h4 className={styles.blockTitle}>
        Their duel loadouts with this deck
        <span className={styles.blockNote}>
          {history.matched} recorded duel{history.matched === 1 ? '' : 's'} of{' '}
          {history.searched} used {history.searchedFor === 1 ? 'this deck' : 'these decks'}
          {unordered ? ` · ${unordered} without a recorded game order` : ''}
        </span>
      </h4>

      {/* The single question "what else is in the bag", answered across every
          match before the individual loadouts are laid out. */}
      {!!companions.length && (
        <>
          <p className={styles.seqFoot}>Decks that travel with it, most often first:</p>
          <ul className={styles.deckList}>
            {companions.map((d, i) => (
              <DeckRow key={i} deck={d} rank={i + 1} hue="green" showProb={false} />
            ))}
          </ul>
        </>
      )}

      <p className={styles.seqFoot}>
        The full loadouts, most-run first. The dimmed deck is the one you pasted;
        the others are what came with it.
      </p>

      <ol className={styles.seqList}>
        {loadouts.map((L, i) => (
          <li key={i} className={styles.seq}>
            <div className={styles.seqHead}>
              <span className={styles.seqDate}>
                {L.times}× run
              </span>
              <span className={styles.seqOpp}>
                {L.wins}W–{L.losses}L
              </span>
              <span className={styles.seqScore}>last {shortDay(L.lastSeen)}</span>
              {/* Where in the duel they brought it, when that is known at all. */}
              <span className={styles.seqWhen}>
                {L.ordered
                  ? `played it as game ${L.position}`
                  : 'game order not recorded'}
              </span>
              <span className={styles.seqMatch} data-exact={L.exact ? '' : undefined}>
                {L.exact ? 'exact deck' : 'variant'}
              </span>
            </div>
            {L.games.map((g, j) => (
              <div key={j} className={styles.seqGame} data-shown={g.revealed ? '' : undefined}>
                <span className={styles.seqGameNo}>
                  {L.ordered ? `G${g.game}` : `#${g.game}`}
                </span>
                <span className={styles.seqGameName}>{g.deckName || g.archetype}</span>
                <Strip
                  cards={g.cards}
                  art={g.art}
                  inferred={g.inferredArt}
                  name={g.deckName || g.archetype}
                  size="sm"
                />
                {g.result ? (
                  <span
                    className={styles.seqResult}
                    data-win={g.result === 'win' ? '' : undefined}
                  >
                    {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : '–'}
                  </span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ─────────────────────────────────────────── window 1: Duel Prediction */

type PredictStep =
  | { kind: 'started' }
  /* `game` is the deck being asked for; `want` is how many are being collected
     before the prediction runs. They differ when the duel is already two games
     in — the answer for game 3 needs both reveals, so both are asked for up
     front rather than making the coach take a game-2 prediction they no longer
     need on the way past. */
  | { kind: 'paste'; game: 1 | 2; want: 1 | 2 }
  | { kind: 'result' };

function DuelPrediction({ tag }: { tag: string }) {
  const [step, setStep] = useState<PredictStep>({ kind: 'started' });
  const [revealed, setRevealed] = useState<string[][]>([]);
  const [data, setData] = useState<CoachPrediction | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    (decks: string[][]) => {
      setBusy(true);
      setError(null);
      fetchCoachPrediction(tag, decks)
        .then((d) => {
          setData(d);
          setRevealed(decks);
          setStep({ kind: 'result' });
        })
        .catch((e) => setError(e as AnalyticsError))
        .finally(() => setBusy(false));
    },
    [tag],
  );

  const reset = () => {
    setStep({ kind: 'started' });
    setRevealed([]);
    setData(null);
    setError(null);
  };

  if (error) {
    return (
      <div className={styles.notice}>
        <h3 className={styles.noticeTitle}>
          {error.kind === 'offline' ? 'Analytics service is not running' : 'Could not predict'}
        </h3>
        <p>{error.message}</p>
        {error.kind === 'offline' && <pre className={styles.noticeCode}>python server/app.py</pre>}
        <button type="button" className={styles.secondary} onClick={reset}>
          Start over
        </button>
      </div>
    );
  }

  if (busy) return <p className={styles.notice}>Reading their duel history…</p>;

  if (step.kind === 'started') {
    return (
      <Ask
        step="Question 1"
        question="Has the duel started?"
        hint="If a deck has already been played, paste it and the prediction narrows to what is still legal for them."
      >
        <Choice hue="green" onClick={() => run([])}>
          No — not started yet
        </Choice>
        <Choice hue="blue" onClick={() => setStep({ kind: 'paste', game: 1, want: 1 })}>
          Yes — one game played
        </Choice>
        <Choice hue="violet" onClick={() => setStep({ kind: 'paste', game: 1, want: 2 })}>
          Yes — two games played
        </Choice>
      </Ask>
    );
  }

  if (step.kind === 'paste') {
    const { game: n, want } = step;
    return (
      <PasteDeck
        key={`r${n}`}
        label={`Their game ${n} deck`}
        hint={want > 1 ? `Deck ${n} of ${want}` : undefined}
        onBack={() =>
          n === 1
            ? setStep({ kind: 'started' })
            : setStep({ kind: 'paste', game: 1, want })
        }
        onConfirm={(cards) => {
          const next = [...revealed.slice(0, n - 1), cards];
          if (n < want) {
            // Held, not run: the game-2 prediction is not the question when the
            // coach has already told us two games are in the books.
            setRevealed(next);
            return setStep({ kind: 'paste', game: 2, want });
          }
          run(next);
        }}
      />
    );
  }

  if (!data) return null;

  const stage = revealed.length;
  const nextGame = stage + 1;

  return (
    <div className={styles.result}>
      <div className={styles.resultHead}>
        <div>
          <h3 className={styles.resultTitle}>
            {stage === 0
              ? `What ${data.name} opens with`
              : `What ${data.name} can still bring — game ${nextGame}`}
          </h3>
          {/* No stats line. The series/games counts and the basis sentence were
              removed on request — they described the query rather than the
              answer. The one thing that still has to be said is when the
              ranking is NOT a read on their opening, and the warning below
              covers exactly that case. */}
          {stage > 0 && (
            <p className={styles.resultSub}>
              {data.nCandidates} decks share no cards with what they have shown — a duel
              loadout cannot repeat a card, so every deck revealed narrows this.
            </p>
          )}
        </div>
        <button type="button" className={styles.secondary} onClick={reset}>
          Start over
        </button>
      </div>

      {/* The one caveat that survives the stats line being removed, because it
          changes what the list MEANS rather than how strong it is: ranked by
          overall play rate, this is not a read on their opening at all. */}
      {data.lowConfidence && (
        <p className={styles.warn}>
          {stage === 0 && data.basis === 'overall play rate'
            ? 'Not enough ordered series to read their opening — this is their overall duel play rate, which is a weaker claim.'
            : 'Limited duel data for this player — treat this as a lean.'}
        </p>
      )}

      {!data.decks.length ? (
        <p className={styles.notice}>
          No duel history stored for this player, so there is nothing to predict from.
        </p>
      ) : (
        <>
          {/* The strongest thing this screen can say, so it goes first and is
              labelled as OBSERVED rather than ranked. */}
          {data.observedLoadout && (
            <section className={styles.block} data-hue="green">
              <h4 className={styles.blockTitle}>
                Seen before
                <span className={styles.blockNote}>
                  when they opened this way ({data.observedLoadout.times}×), the rest of
                  their loadout was
                </span>
              </h4>
              <ul className={styles.deckList}>
                {data.observedLoadout.decks.map((d, i) => (
                  <DeckRow key={i} deck={d} hue="green" showProb={false} />
                ))}
              </ul>
            </section>
          )}

          <section className={styles.block} data-hue="violet">
            <h4 className={styles.blockTitle}>
              {stage === 0 ? 'Likely opening decks' : `Likely game ${nextGame} decks`}
            </h4>
            <ul className={styles.deckList}>
              {/* No per-deck percentage. The list is already in order and the
                  rank says the same thing without asking anyone to compare six
                  small numbers mid-duel. The Suggestion window keeps its
                  figures, because there the number IS the answer. */}
              {data.decks.map((d, i) => (
                <DeckRow key={i} deck={d} rank={i + 1} hue="violet" showProb={false} />
              ))}
            </ul>
          </section>

          {!!data.cards?.length && (
            <div className={styles.two}>
              <section className={styles.block} data-hue="blue">
                <h4 className={styles.blockTitle}>
                  Cards to expect
                  <span className={styles.blockNote}>
                    weighted across those decks, not counted
                  </span>
                </h4>
                <ul className={styles.oddsGrid}>
                  {data.cards.map((c) => (
                    <li key={c.card} className={styles.oddsCard}>
                      <CardArt card={c.card} />
                      <span className={styles.oddsValue}>{pct(c.prob)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className={styles.block} data-hue="pink">
                <h4 className={styles.blockTitle}>Shape of the game</h4>
                <ul className={styles.barList}>
                  {data.archetypes?.map((a) => (
                    <li key={a.archetype} className={styles.barRow}>
                      <span className={styles.barName}>{a.name}</span>
                      <span className={styles.bar}>
                        <span className={styles.barFill} style={{ width: `${a.prob * 100}%` }} />
                      </span>
                      <span className={styles.barValue}>{pct(a.prob)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {/* Their real log, below the ranking rather than instead of it. */}
          {stage > 0 && data.history && <DuelLog history={data.history} />}

          {!!data.revealed?.length && (
            <section className={styles.block} data-hue="blue">
              <h4 className={styles.blockTitle}>Already shown</h4>
              <ul className={styles.deckList}>
                {data.revealed.map((d, i) => (
                  <DeckRow key={i} deck={d} rank={i + 1} hue="blue" showProb={false} />
                ))}
              </ul>
            </section>
          )}

          {/* Appended LAST on purpose. Everything above is already on screen
              and settled before this asks for anything, so a slow read cannot
              push the prediction around — layout shift above this point is
              zero by construction. */}
          <OpponentReadPanel tag={tag} />

          <div className={styles.nextRow}>
            {stage < 2 && (
              <button
                type="button"
                className={styles.primary}
                onClick={() =>
                  setStep({ kind: 'paste', game: (stage + 1) as 1 | 2, want: (stage + 1) as 1 | 2 })
                }
              >
                {stage === 0
                  ? 'They played game 1 — narrow it down'
                  : 'They played game 2 — predict game 3'}
              </button>
            )}
            <button type="button" className={styles.secondary} onClick={reset}>
              {stage >= 2 ? 'Done — start over' : 'Exit'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── the opponent read (Phase 19B)

   WHAT THIS IS ALLOWED TO CLAIM. Eighteen phases of measurement produced one
   shippable result: the most recent deck is the safest prediction, and the
   confidence band on it carries real information — held out on the production
   stack, duel high was 92.1% correct against low at 47.3%.

   WHAT IT IS NOT ALLOWED TO CLAIM. That it knows their next deck. Phase 17B
   measured that a switch usually goes to a deck the player has never played,
   and Phase 18 that such a deck usually cannot be built from what they have
   shown. So the extra rows are "plausible configurations", never predictions,
   and the word "predict" does not appear in this panel.

   IT LOADS ITSELF. The Coach's answer is already complete without it; this
   fetches after mount and renders nothing at all if the read is disabled,
   slow, or broken. */

const CONFIDENCE_COPY: Record<string, { label: string; hue: string; note: string }> = {
  high: { label: 'High', hue: 'green',
          note: 'They have been steady on this deck.' },
  medium: { label: 'Medium', hue: 'blue',
            note: 'They have been changing decks somewhat.' },
  low: { label: 'Low', hue: 'pink',
         note: 'This player has been changing decks frequently.' },
};

function recordOpponentReadMetric(o: OpponentReadOutcome, ms: number) {
  const read = o.kind === 'read' ? o.read : null;
  pushMetric({
    outcome: o.kind,
    requestMs: Math.round(ms),
    confidence: read && read.bandShown ? read.primary.confidence ?? null : null,
    alternativeCount: read ? read.alternatives.length : 0,
    degraded: !!read?.degraded,
    timedOut: o.kind === 'timeout',
    errored: o.kind === 'error',
  });
}

function OpponentReadPanel({ tag }: { tag: string }) {
  const [outcome, setOutcome] = useState<OpponentReadOutcome | null>(null);
  // The skeleton is DELAYED. When the engine is switched off the endpoint
  // answers instantly, so showing a skeleton immediately would flash
  // "Analyzing opponent…" at every user on the default configuration and then
  // rip it away. Waiting a beat means the disabled path renders nothing, ever.
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    let alive = true;
    const started = performance.now();
    const timer = window.setTimeout(() => alive && setShowSkeleton(true), 250);
    fetchOpponentRead(tag).then((o) => {
      if (!alive) return;
      window.clearTimeout(timer);
      setOutcome(o);
      setShowSkeleton(false);
      recordOpponentReadMetric(o, performance.now() - started);
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [tag]);

  // Disabled, timed out or failed — the Coach is complete without this, so it
  // says nothing rather than apologising for a feature the reader never saw.
  if (!outcome) {
    if (!showSkeleton) return null;
    return (
      <section className={styles.block} data-hue="violet" data-oie="loading">
        <h4 className={styles.blockTitle}>Opponent read</h4>
        <p className={styles.oieSkeleton} aria-live="polite">Analysing opponent…</p>
      </section>
    );
  }
  if (outcome.kind !== 'read') return null;

  const { read } = outcome;
  // PHASE 23, FIX 3. A band is only rendered where the server sent one.
  // Practice has no validated ordering, so it arrives without a band and
  // without alternatives, and the panel shows the deck alone rather than
  // inventing a confidence word for it.
  const conf = read.bandShown && read.primary.confidence
    ? CONFIDENCE_COPY[read.primary.confidence] ?? null
    : null;
  const alts = read.degraded || !read.bandShown ? [] : read.alternatives;

  return (
    <section className={styles.block} data-hue="violet" data-oie="ready">
      <h4 className={styles.blockTitle}>
        Opponent read
        <span className={styles.blockNote}>their current deck, and how settled they are</span>
      </h4>

      <div className={styles.oiePrimary}>
        <ul className={styles.oieCards}>
          {read.primary.cards.map((c) => (
            <li key={c}><CardArt card={c} /></li>
          ))}
        </ul>
        <div className={styles.oieMeta}>
          <span className={styles.oieLabel}>Current / most recent deck</span>
          {conf && (
            <>
              <span className={styles.oieConfidence} data-band={read.primary.confidence}>
                Confidence: {conf.label}
              </span>
              <span className={styles.oieNote}>{conf.note}</span>
            </>
          )}
        </div>
      </div>

      {alts.length > 0 && (
        <div className={styles.oieAlts}>
          {/* NOT predictions, and the heading has to say so. */}
          <h5 className={styles.oieAltsTitle}>
            Plausible configurations
            <span className={styles.blockNote}>
              other shapes seen in this player&rsquo;s own history — not forecasts
            </span>
          </h5>
          <ul className={styles.oieAltList}>
            {alts.map((a, i) => (
              <li key={i} className={styles.oieAlt}>
                <ul className={styles.oieCards} data-small>
                  {a.cards.map((c) => (
                    <li key={c}><CardArt card={c} /></li>
                  ))}
                </ul>
                {!!a.evidence.length && (
                  <span className={styles.oieEvidence}>{a.evidence[0]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────── window 2: Suggestion */

type SuggestStep =
  | { kind: 'tags' }
  | { kind: 'stage' }
  | { kind: 'paste'; side: 'mine' | 'theirs'; game: 1 | 2 }
  | { kind: 'result' };

function Suggestion({ tag }: { tag: string }) {
  // The tag already in the analysis IS the opponent — that is who the coach
  // has been studying. The player being coached is the one we still need.
  const [me, setMe] = useState('');
  const [opp, setOpp] = useState(tag);
  const [step, setStep] = useState<SuggestStep>({ kind: 'tags' });
  const [games, setGames] = useState(0);
  const [myPlayed, setMyPlayed] = useState<string[][]>([]);
  const [oppPlayed, setOppPlayed] = useState<string[][]>([]);
  const [data, setData] = useState<CoachSuggestion | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setOpp(tag), [tag]);

  const run = useCallback(
    (mine: string[][], theirs: string[][]) => {
      setBusy(true);
      setError(null);
      fetchCoachSuggestion(me.trim(), opp.trim(), mine, theirs)
        .then((d) => {
          setData(d);
          setStep({ kind: 'result' });
        })
        .catch((e) => setError(e as AnalyticsError))
        .finally(() => setBusy(false));
    },
    [me, opp],
  );

  const reset = () => {
    setStep({ kind: 'tags' });
    setGames(0);
    setMyPlayed([]);
    setOppPlayed([]);
    setData(null);
    setError(null);
  };

  if (error) {
    return (
      <div className={styles.notice}>
        <h3 className={styles.noticeTitle}>
          {error.kind === 'offline'
            ? 'Analytics service is not running'
            : error.kind === 'invalid_tag'
              ? 'That is not a valid Clash Royale tag'
              : 'Could not build a suggestion'}
        </h3>
        <p>{error.message}</p>
        <button type="button" className={styles.secondary} onClick={() => setStep({ kind: 'tags' })}>
          Change the tags
        </button>
      </div>
    );
  }

  if (busy) return <p className={styles.notice}>Reading both players and scoring the matchups…</p>;

  if (step.kind === 'tags') {
    return (
      <Ask
        step="Question 1"
        question="Who are you coaching?"
        hint="The opponent is the player this analysis is already open on — change it by searching a different tag."
      >
        <div className={styles.tagGrid}>
          <label className={styles.tagField}>
            <span className={styles.tagLabel}>Your player</span>
            <input
              className={styles.paste}
              value={me}
              placeholder="#TAG"
              spellCheck={false}
              autoFocus
              onChange={(e) => setMe(e.target.value)}
            />
          </label>
          {/* LOCKED. The opponent is whoever the analysis is open on — every
              other screen in this view is about them, and letting this one box
              disagree would put two different players on one screen with
              nothing saying which is which. Rendered as a field rather than a
              sentence so the pair still reads as "you vs them". */}
          <div className={styles.tagField}>
            <span className={styles.tagLabel}>Opponent · from this analysis</span>
            <output className={styles.tagLocked}>{opp || '—'}</output>
          </div>
        </div>
        <button
          type="button"
          className={styles.primary}
          disabled={!me.trim()}
          onClick={() => setStep({ kind: 'stage' })}
        >
          Continue
        </button>
      </Ask>
    );
  }

  if (step.kind === 'stage') {
    return (
      <Ask
        step="Question 2"
        question="How far into the duel are you?"
        hint="Each game already played burns eight cards for both sides, which is what makes the next pick predictable."
        onBack={() => setStep({ kind: 'tags' })}
      >
        <Choice
          hue="green"
          onClick={() => {
            setGames(0);
            run([], []);
          }}
        >
          Nothing played yet — pick game 1
        </Choice>
        <Choice
          hue="blue"
          onClick={() => {
            setGames(1);
            setStep({ kind: 'paste', side: 'mine', game: 1 });
          }}
        >
          One game played — pick game 2
        </Choice>
        <Choice
          hue="violet"
          onClick={() => {
            setGames(2);
            setStep({ kind: 'paste', side: 'mine', game: 1 });
          }}
        >
          Two games played — pick game 3
        </Choice>
      </Ask>
    );
  }

  if (step.kind === 'paste') {
    const { side, game } = step;
    const mineLabel = `Your game ${game} deck`;
    const theirsLabel = `Their game ${game} deck`;
    return (
      <PasteDeck
        /* KEYED PER QUESTION. Without this React reuses one PasteDeck instance
           down the whole interview — same element type in the same slot — so
           its pasted text survives into the next question. Asked for "their
           game 1 deck" you were looking at YOUR game 1 deck, already filled in,
           and Continue submitted it a second time. The four questions are four
           different questions and each needs its own box. */
        key={`${side}-${game}`}
        label={side === 'mine' ? mineLabel : theirsLabel}
        onBack={() => {
          if (side === 'theirs') return setStep({ kind: 'paste', side: 'mine', game });
          if (game === 2) return setStep({ kind: 'paste', side: 'theirs', game: 1 });
          return setStep({ kind: 'stage' });
        }}
        onConfirm={(cards) => {
          if (side === 'mine') {
            const mine = [...myPlayed.slice(0, game - 1), cards];
            setMyPlayed(mine);
            return setStep({ kind: 'paste', side: 'theirs', game });
          }
          const theirs = [...oppPlayed.slice(0, game - 1), cards];
          setOppPlayed(theirs);
          if (game < games) return setStep({ kind: 'paste', side: 'mine', game: 2 });
          return run(myPlayed, theirs);
        }}
      />
    );
  }

  if (!data) return null;
  const best = data.best;

  return (
    <div className={styles.result}>
      <div className={styles.resultHead}>
        <div>
          <h3 className={styles.resultTitle}>
            {data.myName} vs {data.oppName} · game {data.stage + 1}
          </h3>
          <p className={styles.resultSub}>
            Your still-legal decks ranked by {data.basis}. A duel loadout cannot repeat a
            card, so anything overlapping what you have played is excluded outright.
          </p>
        </div>
        <button type="button" className={styles.secondary} onClick={reset}>
          Start over
        </button>
      </div>

      {best && (
        <section className={styles.verdict} data-hue="green">
          <span className={styles.verdictLabel}>Play this</span>
          <div className={styles.verdictBody}>
            <span className={styles.verdictName}>{best.deckName || best.archetype}</span>
            {best.expected && (
              <span className={styles.verdictFigure}>
                {best.expected.winRate.toFixed(1)}%
                <span className={styles.verdictFigureLabel}>
                  expected · {SOURCE_LABEL[best.expected.per[0]?.matchup?.source ?? ''] ?? 'no matchup evidence'}
                </span>
              </span>
            )}
          </div>
          <Strip cards={best.cards} art={best.art} inferred={best.inferredArt} name={best.deckName} />
        </section>
      )}

      {!!data.notes.length && (
        <section className={styles.block} data-hue="violet">
          <h4 className={styles.blockTitle}>The read</h4>
          <ul className={styles.notes}>
            {data.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.block} data-hue="pink">
        <h4 className={styles.blockTitle}>
          What they are likely to bring
          <span className={styles.blockNote}>
            {data.opponent.source === 'population'
              ? 'no duel history for them — these are current meta decks'
              : data.opponent.source === 'opponent-history+population'
                ? 'their own decks, topped up with meta decks'
                : 'from their own duel history'}
          </span>
        </h4>
        <ul className={styles.deckList}>
          {data.opponent.decks.map((d, i) => (
            <DeckRow key={i} deck={d} rank={i + 1} hue="pink" />
          ))}
        </ul>
      </section>

      <section className={styles.block} data-hue="blue">
        <h4 className={styles.blockTitle}>Your options, ranked</h4>
        <ul className={styles.deckList}>
          {data.recommendations.map((d, i) => (
            <DeckRow key={i} deck={d} rank={i + 1} hue="blue" />
          ))}
        </ul>
      </section>

      {/* The same question, the same answer, in the window that also has to
          decide what YOU do about it. */}
      {!!data.oppPlayed.length && data.history && <DuelLog history={data.history} />}

      {(!!data.myPlayed.length || !!data.oppPlayed.length) && (
        <div className={styles.two}>
          {!!data.myPlayed.length && (
            <section className={styles.block} data-hue="blue">
              <h4 className={styles.blockTitle}>
                You have played
                <span className={styles.blockNote}>those cards are spent</span>
              </h4>
              <ul className={styles.deckList}>
                {data.myPlayed.map((d, i) => (
                  <DeckRow key={i} deck={d} rank={i + 1} hue="blue" showProb={false} />
                ))}
              </ul>
            </section>
          )}
          {!!data.oppPlayed.length && (
            <section className={styles.block} data-hue="pink">
              <h4 className={styles.blockTitle}>They have played</h4>
              <ul className={styles.deckList}>
                {data.oppPlayed.map((d, i) => (
                  <DeckRow key={i} deck={d} rank={i + 1} hue="pink" showProb={false} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Every reason the answer might be weaker than it looks, listed rather
          than folded into one flag nobody can interrogate. */}
      {!!data.caveats.length && (
        <ul className={styles.caveats}>
          {data.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── the shell */

export function CoachAssist({ tag }: { tag: string }) {
  const [win, setWin] = useState<'predict' | 'suggest'>('predict');
  const blurb = useMemo(() => WINDOWS.find((w) => w.id === win)?.blurb ?? '', [win]);

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.headIcon}>{ICONS.coach}</span>
        <div className={styles.headText}>
          <h1 className={styles.title}>Coach Assist</h1>
          <p className={styles.blurb}>{blurb}</p>
        </div>
      </header>

      <div className={styles.tabs} role="tablist">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={win === w.id}
            className={`${styles.tab} ${win === w.id ? styles.tabOn : ''}`}
            onClick={() => setWin(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Keyed on the window so switching tabs starts a clean interview rather
          than resuming the other one's half-answered questions. */}
      {win === 'predict' ? (
        <DuelPrediction key={`p-${tag}`} tag={tag} />
      ) : (
        <Suggestion key={`s-${tag}`} tag={tag} />
      )}
    </section>
  );
}
