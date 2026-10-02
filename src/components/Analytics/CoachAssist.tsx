import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardArt } from './CardArt';
import { drawnDeck } from '../../utils/deckSeating';
import { duelChip, duelPickLabel, duelTitle } from '../../utils/duelFigures';
import { DeckActions } from '../DeckActions/DeckActions';
import { CARDS_BY_KEY } from '../../data/cards';
import { parseClashRoyaleDeckLink } from '../../utils/deckLink';
import {
  AnalyticsError,
  fetchCoachPrediction,
  fetchCoachSuggestion,
  fetchCoachChosen,
  COACH_CHOICE_MAX,
  fetchDrawnDeck,
  type CoachChosen,
  type CoachChoiceDeck,
  type CoachChoiceSource,
  type CoachDeck,
  type CoachVs,
  type CoachHistory,
  type CoachPrediction,
  type CoachSuggestion,
  type CoachBrainModel,
  type CoachBrainSwap,
  type CoachBuilt,
  type CoachBuiltDeck,
  type DeckTuner,
  type WildForm,
  fetchOpponentRead,
  type OpponentReadOutcome,
} from '../../state/analyticsClient';
import { ReadingState } from './ReadingState';
import { Tabs } from '../ui/tabs';
import { supabase } from '../../state/supabase';
import { pushMetric } from '../../state/oieMetrics';
import styles from './CoachAssist.module.css';
import { useHeldLoading } from '../../hooks/useHeldLoading';
import { useReportRegistration } from '../../state/reportExport';
import { isPaid, useAccess } from '../../state/gate';
import { DAY_PRESETS } from '../../utils/datePresets';
import { WinConFilter, filterCardName } from '../WinConFilter/WinConFilter';

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
  // The fused rate's list-level reading (2026-09-27): this deck and its
  // one-card variants against that exact list and its variants.
  version: 'these lists and their variants — ladder and duels',
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
  filled,
  name,
  size = 'md',
}: {
  cards: string[];
  art?: Record<string, WildForm>;
  inferred?: boolean;
  /** Forms filled in because the deck can field them, not observed. */
  filled?: string[];
  name?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={size === 'sm' ? styles.stripSm : styles.strip}>
      {cards.map((c, i) => (
        <CardArt
          key={`${c}-${i}`}
          card={c}
          variant={art?.[c]}
          inferred={inferred || !!filled?.includes(c)}
        />
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

/**
 * THIS DECK AGAINST EACH OF THEIR ARCHETYPES — Team Scout's chips, asked for
 * by name ("bridge spam 58%, lava 47%"). The headline is one weighted
 * average; this is what it averages, so a deck strong overall that loses to
 * one of their archetypes shows as that. Figures only: green at 50%+, red
 * under. Renders nothing when the server sent none (an older server, or a
 * deck with no record against anything they bring).
 */
/** Why a chip is there — a tooltip, so the row itself stays figures only. */
const KIND_TITLE: Record<string, string> = {
  likely: 'In the decks they are likely to bring',
  theirs: 'Another win condition they play',
  meta: 'One of the most-played archetypes right now',
};

function VsChips({ vs, className, label = 'Win rate against each of their archetypes' }: {
  vs?: CoachVs[]; className?: string; label?: string;
}) {
  if (!vs?.length) return null;
  return (
    <ul className={`${styles.vsChips} ${className ?? ''}`} aria-label={label}>
      {vs.map((v) => (
        <li
          key={v.archetype}
          className={styles.vsChip}
          data-ok={v.winRate >= 50 || undefined}
          data-extra={v.kind && v.kind !== 'likely' ? '' : undefined}
          title={KIND_TITLE[v.kind ?? 'likely']}
        >
          <span>{v.name}</span>
          <strong>{v.winRate.toFixed(0)}%</strong>
        </li>
      ))}
    </ul>
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
          {duelPickLabel(deck) && <span className={styles.duelTag}>{duelPickLabel(deck)}</span>}
        </span>
        <span className={styles.deckMeta}>
          {deck.avgElixir ? `${deck.avgElixir.toFixed(1)} elixir` : ''}
          {deck.count ? `${deck.avgElixir ? ' · ' : ''}played ${deck.count}×` : ''}
          {/* The co-occurrence count DRIVES the ranking, so hiding it makes the
              list look mis-sorted against the usage figures. */}
          {deck.coRevealed ? ` · ${deck.coRevealed}× alongside the revealed deck` : ''}
        </span>
        {/* The same deck in real DUELS against what they bring, when the duels
            have enough games on it — green only when it clears the gate. */}
        {deck.duel && (
          <span
            className={styles.duelRate}
            data-strong={deck.duel.strong || undefined}
            title={duelTitle(deck.duel)}
          >
            {duelChip(deck.duel)}
          </span>
        )}
      </div>
      <Strip
        cards={deck.cards}
        art={deck.art}
        inferred={deck.inferredArt}
        filled={deck.artFilled}
        name={deck.deckName}
        size="sm"
      />
      {deck.brain ? (
        /* THE DUEL BRAIN'S WIN CHANCE LEADS when it exists: on held-out
           duels its choices won 55.8% against 43.0%. The ladder+duel rate it
           replaced stays in the tooltip, so nothing is hidden. */
        <div
          className={styles.figure}
          title={[
            ...deck.brain.vs.map((v) => `${v.name}: ${v.winRate.toFixed(1)}%`),
            exp ? `ladder+duel rate ${exp.winRate.toFixed(1)}%` : '',
          ].filter(Boolean).join(' · ')}
        >
          <span className={styles.figureValue} data-good={deck.brain.winRate >= 50 ? '' : undefined}>
            {deck.brain.winRate.toFixed(1)}%
          </span>
          <span className={styles.figureLabel}>win chance</span>
        </div>
      ) : exp ? (
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
      {/* ITS OWN LINE UNDER THE CARDS, not inside the 11rem name cell, where
          three chips wrapped to two lines and made these rows taller than the
          rest. The last child of the grid, spanning from the name column on. */}
      <VsChips vs={exp?.vs} className={styles.deckRowVs} />
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
/** Exact first. The order is the point, so it lives outside the component. */
const GROUPS = [
  {
    exact: true,
    label: 'This exact deck',
    note: 'the list you pasted, card for card',
  },
  {
    exact: false,
    label: 'Close variants',
    note: 'same archetype, a card or two different',
  },
] as const;

function DuelLog({ history }: { history: CoachHistory }) {
  // Defensive, and it earned its place: an API process left running on the old
  // response shape returned `series` where this expects `loadouts`, and the
  // unguarded `.map` took the whole screen down rather than degrading one
  // block. A panel this far down the page must never be able to do that.
  const loadouts = history.loadouts ?? [];
  const companions = history.nextDecks ?? [];

  /* THE EVIDENCE IS COLLAPSED BY DEFAULT.
     Every loadout below is one duel's worth of three eight-card decks. With a
     handful of runs that is fifty-odd card tiles between the reader and the
     answer, and the answer -- which decks travel with this one -- is the short
     list ABOVE. The runs are what backs it up, so they are one tap away rather
     than in the way.
     ABOVE THE EARLY RETURN (2026-09-27): it sat below it, so a history that
     went from matched to unmatched between renders changed the hook count and
     React threw — the one error `npm run lint` reported in this file. */
  const [showRuns, setShowRuns] = useState(false);

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

  /* "Most-run first" is only true when the runs differ in count. On thin
     history every loadout is a single occurrence, the sort does nothing, and
     the list is really in date order -- so the caption says so instead of
     claiming a ranking that is not there. */
  const ranked = loadouts.some((L) => L.times > 1);

  /* Only label the groups when there is something to tell apart. */
  const both = loadouts.some((L) => L.exact) && loadouts.some((L) => !L.exact);

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
        The dimmed deck is the one you pasted; the others are what came with it.
        {ranked ? ' Most-run first.' : ' One duel each, most recent first.'}
      </p>

      {/* EXACT MATCHES FIRST, THEN NEAR ONES.
          The list was one pile in date order, so a run of the deck you actually
          pasted could sit fourth behind three that merely share its archetype —
          and the two answer different questions. "They have brought THIS list,
          and here is what came with it" is evidence; "they have brought
          something like it" is context for when there is not enough of the
          first. Ordering by date put them in a blender.
          The groups only appear when both exist, so a reader with only exact
          matches is not made to read a heading explaining an absent section. */}
      {GROUPS.map(({ exact, label, note }) => {
        const rows = loadouts.filter((L) => Boolean(L.exact) === exact);
        if (!rows.length) return null;
        /* THE EXACT DECK IS ALWAYS OPEN. It is the thing being asked about —
           "they brought THIS list, and here is what came with it" — so hiding
           it behind a control would be hiding the answer. The variants are
           context for when the exact runs are thin, so they fold away. */
        const collapsible = !exact && both;
        return (
          <div key={label} className={styles.seqGroup}>
            {both && (
              <p className={styles.seqGroupHead}>
                {label}
                <span className={styles.seqGroupNote}>{note}</span>
              </p>
            )}
            {collapsible && (
              <button
                type="button"
                className={styles.runsToggle}
                aria-expanded={showRuns}
                onClick={() => setShowRuns((o) => !o)}
              >
                {showRuns ? 'Hide' : 'Show'} {rows.length} other deck
                {rows.length === 1 ? '' : 's'} they have run
              </button>
            )}
            {collapsible && !showRuns ? null : (
      <ol className={styles.seqList}>
        {rows.map((L, i) => (
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
            )}
          </div>
        );
      })}
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

function DuelPrediction({ tag, days }: { tag: string; days: number }) {
  const [step, setStep] = useState<PredictStep>({ kind: 'started' });
  const [revealed, setRevealed] = useState<string[][]>([]);
  const [data, setData] = useState<CoachPrediction | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [busy, setBusy] = useState(false);
  const reading = useHeldLoading(busy);
  useReportRegistration({
    id: 'coach-predict',
    ready: Boolean(data),
    build: async () => (await import('../../utils/screenAdapters')).coachPredictionDoc(data as CoachPrediction),
  });

  const run = useCallback(
    (decks: string[][]) => {
      setBusy(true);
      setError(null);
      fetchCoachPrediction(tag, decks, { days })
        .then((d) => {
          setData(d);
          setRevealed(decks);
          setStep({ kind: 'result' });
        })
        .catch((e) => setError(e as AnalyticsError))
        .finally(() => setBusy(false));
    },
    [tag, days],
  );

  /* CHANGING THE WINDOW REFRESHES THE ANSWER, it does not restart the
     interview. The reader has already told us which decks were revealed;
     asking again because they widened the history would be punishing them for
     using the control. Only fires once there is something to refresh. */
  const shown = step.kind === 'result';
  useEffect(() => {
    if (shown) run(revealed);
    // `revealed` is deliberately absent: it changes only via `run`, and
    // including it would re-fetch immediately after every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

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

  if (reading)
    return (
      <ReadingState k="coach-history" hue="green">
        Reading their duel history…
      </ReadingState>
    );

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
  /* The proxy needs to know WHICH account is asking, to check the allowlist.
     A SUPABASE ACCESS TOKEN now, not the retired sha256(username:password).
     Read at fetch time rather than held in state, because the token is
     short-lived and refreshed in the background — a copy captured on mount
     would be the one thing here that goes stale. */
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
    void (async () => {
      const token =
        (await supabase?.auth.getSession())?.data.session?.access_token ?? null;
      const o = await fetchOpponentRead(tag, token);
      if (!alive) return;
      window.clearTimeout(timer);
      setOutcome(o);
      setShowSkeleton(false);
      recordOpponentReadMetric(o, performance.now() - started);
    })();
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
        {/* THE PROXY STRIPS THE SEATING. `api/analytics/opponent-read` rebuilds
            its response field by field and `primary` is `{cards, confidence,
            basis}` — no art — so these decks arrive unseated and every card
            drew its base form. `drawnDeck` falls back to the capability
            seating and marks it `inferred`, so the tooltip says the form came
            from slot position rather than from an observation. */}
        <ul className={styles.oieCards}>
          {(() => {
            const d = drawnDeck(read.primary.cards, undefined);
            return d.cards.map((c) => (
              <li key={c}><CardArt card={c} variant={d.art[c]} inferred={d.inferred} /></li>
            ));
          })()}
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
                  {(() => {
                    const d = drawnDeck(a.cards, undefined);
                    return d.cards.map((c) => (
                      <li key={c}><CardArt card={c} variant={d.art[c]} inferred={d.inferred} /></li>
                    ));
                  })()}
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

/* ──────────────────────────────────────────────────── the swap brain */

/** A signed change, coloured. The only number in a swap row. */
function Delta({ n }: { n: number | null }) {
  if (n === null) return <span style={{ opacity: 0.5 }}>—</span>;
  return (
    <span
      style={{
        color: n > 0 ? 'var(--hue-green)' : n < 0 ? 'var(--hue-red)' : 'inherit',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {n > 0 ? '+' : ''}
      {n.toFixed(1)}
    </span>
  );
}

/**
 * The tuner, as three lists and nothing else.
 *
 * IT USED TO CARRY ITS OWN REASONING and that was the wrong call. Every figure
 * here still has a justification — the like-for-like delta, the coverage, how
 * many decks were scanned, which swaps the checklist dropped — and all of it
 * was printed on screen, under a screen that already carries a recommendation,
 * an opponent distribution and a caveat list. The reader said it was
 * confusing, and they were right: this is a mid-duel screen and the question
 * is "what do I switch", not "how was that worked out".
 *
 * So the working lives in `DECK_TUNER.md` and in the module docstrings, and
 * what survives on screen is the part a person acts on: what to change, what
 * else to bring, ordered best first.
 *
 * TWO THINGS STAY, because dropping them would make the screen dishonest
 * rather than merely quiet:
 *
 *   thin      a swap whose deciding archetype has too few games to act on.
 *             It sorts last already; the dot is what says why it is down
 *             there. A 14-game +34.5 led the first production board.
 *   unknowns  a card the checklist cannot classify from a deck list at all
 *             (Spirit Empress). Silence there would assert something nothing
 *             verified.
 */
/** What ranked this list, in figures: the head-to-head it won, when the model
 *  was last retrained and on how much, and the two players' duel strengths.
 *  One line, no explanation. */
function BrainLine({ model }: { model: CoachBrainModel }) {
  const m = model.measured;
  const h = model.holdout;
  return (
    <p className={styles.askHint}>
      {[
        model.mode === 'combined' ? 'Combined brain: ladder+duel rate + player strength + card levels' : 'Duel brain',
        m && model.mode === 'combined'
          ? `picks matching it won ${m.agree.toFixed(1)}% vs ${m.disagree.toFixed(1)}% on ${m.choices.toLocaleString('en-US')} unseen game-2 choices`
          : h?.accuracy != null ? `${h.accuracy.toFixed(1)}% right on ${h.n.toLocaleString('en-US')} unseen` : null,
        model.games ? `retrained ${model.trainedAt ? model.trainedAt.slice(0, 10) : ''} on ${model.games.toLocaleString('en-US')} duel games` : null,
        /* A player with no native duel games is read at 50% — neutral, and
           said as such rather than as "50% over 0 games". */
        model.strength.mineGames
          ? `you ${model.strength.mine.toFixed(0)}% over ${model.strength.mineGames} duel games`
          : 'no duel record for you',
        model.strength.theirsGames
          ? `them ${model.strength.theirs.toFixed(0)}% over ${model.strength.theirsGames}`
          : 'none for them',
        model.levels ? 'card levels read' : 'levels not read',
      ].filter(Boolean).join(' · ')}
    </p>
  );
}

/** One-card changes REAL DUEL PLAYERS made to "Play this", that raise its win
 *  chance against this opponent (`duel_model.swaps` over
 *  `duel_index.near_variants`). Every row is a list people actually played. */
function BrainSwaps({ swaps, base }: { swaps: CoachBrainSwap[]; base: CoachDeck }) {
  return (
    <section className={styles.block} data-hue="green">
      <h4 className={styles.blockTitle}>
        What duel players change{' '}
        <span className={styles.blockNote}>one card, win chance vs these decks</span>
      </h4>
      <ul className={styles.notes}>
        {swaps.map((s) => (
          <li key={s.in} className={styles.swapRow}>
            <Delta n={s.gain} />
            <span className={styles.swapSide}>
              <CardArt card={s.out} variant={base.art[s.out]} inferred={base.inferredArt} />
            </span>
            <span className={styles.swapArrow} aria-label="becomes">→</span>
            <span className={styles.swapSide}>
              <CardArt card={s.in} variant={s.art[s.in]} inferred={s.inferredArt} />
            </span>
            <span className={styles.blockNote}>
              {s.winRate.toFixed(1)}% · {s.games.toLocaleString('en-US')} duel games · {s.players} players
            </span>
            <DeckActions cards={s.cards} name={`${base.deckName} (${s.in})`} size="sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Win chance against each of their likely decks, as chips. */
function BuiltVs({ vs }: { vs: CoachBuiltDeck['vs'] }) {
  return (
    <span className={styles.blockNote}>
      {vs.map((v) => `${v.name} ${v.winRate.toFixed(0)}%`).join(' · ')}
    </span>
  );
}

const SEED_LABEL = { option: 'your option', bring: 'from your list', yours: 'your deck' } as const;

/** Decks Deckkies BUILT for this duel (`deck_builder.py`). Every built deck
 *  is a real deck plus one or two swaps real players make; the number beside
 *  each swap is how many real deck pairs made it. The whole-duel plan that
 *  used to sit under it was removed on request (2026-09-30). */
function BuiltPanel({ built }: { built: CoachBuilt }) {
  return (
    <>
      {built.decks.length > 0 && (
        <section className={styles.block} data-hue="violet">
          <h4 className={styles.blockTitle}>
            Deckkies built for this duel{' '}
            <span className={styles.blockNote}>real decks + swaps real players make</span>
          </h4>
          {built.decks.map((d) => (
            <div key={d.cards.join(',')} style={{ marginBottom: '.75rem' }}>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {d.seedWin != null ? `${d.seedWin.toFixed(1)}% → ` : ''}{d.win.toFixed(1)}%
              </strong>{' '}
              {d.name}
              {d.seedName && (
                <span className={styles.blockNote}>
                  {' '}· from {d.seedName}{d.seedSource ? ` (${SEED_LABEL[d.seedSource]})` : ''}
                </span>
              )}
              <ul className={styles.notes}>
                {(d.swaps ?? []).map((s) => (
                  <li key={s.out + s.in} className={styles.swapRow}>
                    <span className={styles.swapSide}><CardArt card={s.out} /></span>
                    <span className={styles.swapArrow} aria-label="becomes">→</span>
                    <span className={styles.swapSide}><CardArt card={s.in} variant={d.art[s.in]} /></span>
                    <span className={styles.blockNote}>{s.pairs.toLocaleString('en-US')} real deck pairs make this swap</span>
                  </li>
                ))}
              </ul>
              <Strip cards={d.cards} art={d.art} inferred={d.inferredArt} name={d.name} size="sm" />
              <BuiltVs vs={d.vs} />{' '}
              <DeckActions cards={d.cards} name={d.name} size="sm" />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function TunerPanel({ tuner }: { tuner: DeckTuner }) {
  const swaps = tuner.swaps;
  const others = tuner.compose?.decks ?? [];

  return (
    <section className={styles.block}>
      <h4 className={styles.blockTitle}>
        Switch a card{' '}
        <span className={styles.blockNote}>
          how much your WORST matchup moves, in points
        </span>
      </h4>
      {swaps.length ? (
        <ul className={styles.notes}>
          {swaps.map((s) => (
            <li key={s.hash} className={styles.swapRow}>
              <Delta n={s.floorDelta} />
              {/* THE ART COMES FROM EACH SIDE'S OWN ARRANGEMENT. The outgoing
                  card is drawn as it was fielded in the deck it is LEAVING,
                  the incoming one as it will be fielded in the deck it JOINS —
                  the same card can be an evolution in one and plain in the
                  other, and drawing both from one map would be a guess. */}
              <span className={styles.swapSide}>
                {s.out.map((c) => (
                  <CardArt key={c} card={c} variant={tuner.base.view.art[c]}
                           inferred={tuner.base.view.inferredArt} />
                ))}
              </span>
              <span className={styles.swapArrow} aria-label="becomes">→</span>
              <span className={styles.swapSide}>
                {s.in.map((c) => (
                  <CardArt key={c} card={c} variant={s.view.art[c]}
                           inferred={s.view.inferredArt || !!s.view.artFilled?.includes(c)} />
                ))}
              </span>
              {s.thin && (
                <span className={styles.blockNote} title="too few games to trust">
                  thin evidence
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.askHint}>Nothing to change — no swap improves this deck here.</p>
      )}

      {others.length > 0 && (
        <>
          <h4 className={styles.blockTitle}>
            Or bring one of these{' '}
            <span className={styles.blockNote}>
              win rate against their BEST matchup for you
              {tuner.compose?.synergyGate ? ' · only decks whose cards duel players pair' : ''}
            </span>
          </h4>
          {others.map((d) => (
            <div key={d.hash} style={{ marginBottom: '.5rem' }}>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {d.floor.toFixed(1)}
              </strong>{' '}
              {d.name ?? d.archetype}
              {/* WHY THIS DECK IS ON *THEIR* LIST. Labels and counts only —
                  the list is chosen per player now (`deck_tuner.personalise`),
                  so a reader comparing two players' lists is owed the reason
                  they differ. */}
              {d.yours && <span className={styles.composeYours}> · your win con</span>}
              {d.newToYou && <span className={styles.blockNote}> · new to you</span>}
              {d.familiar > 0 && (
                <span className={styles.blockNote}> · {d.familiar}/8 cards you play</span>
              )}
              {/* PROVEN IN DUELS: fielded 30+ times in the window, so its own
                  duel record is the evidence. Otherwise HOW WELL ITS CARDS GO
                  TOGETHER, as duel players pair them (`deck_synergy`): the share
                  of decks they repeatedly field that this one out-pairs. A
                  position, never a score. */}
              {d.duelRecord ? (
                <span className={styles.blockNote}>
                  {' '}· {d.duelRecord[0].toLocaleString('en-US')} duels
                  {d.duelRecord[1] != null
                    ? `, ${((100 * d.duelRecord[1]) / d.duelRecord[0]).toFixed(0)}% won`
                    : ''}
                </span>
              ) : d.synergy != null && (
                <span className={styles.blockNote}
                      title="Share of the decks duel players repeatedly field whose cards go together less often than this deck's">
                  {' '}· pairs better than {d.synergy}% of duel decks
                </span>
              )}
              <Strip cards={d.view.cards} art={d.view.art}
                     inferred={d.view.inferredArt} filled={d.view.artFilled} size="sm" />
              <VsChips vs={d.vs} />
            </div>
          ))}
        </>
      )}

      {/* THE REST OF THE DUEL, not always three decks: the server sizes it to
          the games left and keeps every card already spent out of it (it once
          did not, and offered game 1's cards back). Drawn only when complete —
          a loadout one deck short does not cover what it claims to. */}
      {tuner.loadout && tuner.loadout.decks.length >= 2
        && tuner.loadout.decks.length === (tuner.loadout.size ?? 3) && (
        <>
          <h4 className={styles.blockTitle}>
            {tuner.loadout.decks.length === 3 ? 'A full loadout' : 'The rest of your duel'}
            {tuner.loadout.loadoutFloor !== null && (
              <>
                {' '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {tuner.loadout.loadoutFloor.toFixed(1)}
                </span>
              </>
            )}{' '}
            <span className={styles.blockNote}>
              {tuner.loadout.decks.length === 3
                ? 'three decks, no shared cards — nothing they bring is unanswered'
                : `${tuner.loadout.decks.length} decks, no card you have already played`}
            </span>
          </h4>
          {tuner.loadout.decks.map((d) => (
            <div key={d.hash} style={{ marginBottom: '.5rem' }}>
              <strong>{d.name ?? d.archetype}</strong>
              <Strip cards={d.view.cards} art={d.view.art}
                     inferred={d.view.inferredArt} filled={d.view.artFilled} size="sm" />
              <VsChips vs={d.vs} />
            </div>
          ))}
        </>
      )}

      {/* The two things that cannot be dropped without making the rest a
          claim nobody checked. */}
      {!!tuner.harmony.unknowns.length && (
        <ul className={styles.caveats}>
          {tuner.harmony.unknowns.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      )}
      {tuner.compose && !tuner.compose.poolReady && (
        <p className={styles.askHint}>Deck pool still building — it rebuilds hourly.</p>
      )}
    </section>
  );
}


/* ─────────────────────────────── decks around the cards the reader names */

const CHOICE_SOURCE: Record<CoachChoiceSource, string> = {
  yours: 'your deck',
  duel: 'duel deck',
  meta: 'meta deck',
  built: 'built',
};

const CHOICE_ENGINE: Record<string, string> = {
  combined: 'combined brain',
  model: 'duel model',
  fused: 'ladder+duel rate',
  ladder: 'ladder rate',
};

/** What stands behind one deck, as counts: the player's own plays, its real
 *  duel record, its ladder games, and how much of it they already play. */
function choiceMeta(d: CoachChoiceDeck): string {
  const parts: string[] = [];
  if (d.yours) parts.push(`you played it ${d.yours.toLocaleString('en-US')}×`);
  if (d.duelRecord) {
    const [g, w] = d.duelRecord;
    /* THE POPULATION'S record with this exact list, not the player's — said,
       because beside "you played it 86×" a bare "660 duel games" reads as
       theirs. */
    const who = d.players ? ` by ${d.players.toLocaleString('en-US')} players` : '';
    parts.push(`${g.toLocaleString('en-US')} duel games${who}, ${((100 * w) / Math.max(1, g)).toFixed(0)}% won`);
  } else if (d.source === 'meta' && d.plays) {
    parts.push(`${d.plays.toLocaleString('en-US')} ladder games`);
  }
  if (d.source !== 'yours' && d.familiar > 0) parts.push(`${d.familiar}/8 cards you play`);
  return parts.join(' · ');
}

function choiceVs(vs: CoachChoiceDeck['vs']): CoachVs[] {
  return vs.map((v, i) => ({ archetype: `${i}-${v.name}`, name: v.name, winRate: v.winRate, share: v.likelihood, kind: 'likely' }));
}

/** One deck holding the named cards: its win chance, the same figure against
 *  each of their likely decks, what stands behind it, and — where the builder
 *  found one — the change that raises it. */
function ChoiceRow({ deck, rank }: { deck: CoachChoiceDeck; rank: number }) {
  const meta = choiceMeta(deck);
  const im = deck.improve;
  return (
    <li className={styles.deckRow} data-hue="blue" data-choice={deck.source}>
      <span className={styles.rank}>{rank}</span>
      <div className={styles.deckIdent}>
        <span className={styles.deckName}>
          {deck.deckName || deck.archetype}
          <span className={styles.fillTag}>{CHOICE_SOURCE[deck.source]}</span>
          {deck.duel?.strong && <span className={styles.duelTag}>Duel proven</span>}
        </span>
        {meta && <span className={styles.deckMeta}>{meta}</span>}
        {deck.duel && (
          <span className={styles.duelRate} data-strong={deck.duel.strong || undefined} title={duelTitle(deck.duel)}>
            {duelChip(deck.duel)}
          </span>
        )}
      </div>
      <Strip cards={deck.cards} art={deck.art} inferred={deck.inferredArt} filled={deck.artFilled}
             name={deck.deckName} size="sm" />
      {deck.win !== null ? (
        <div
          className={styles.figure}
          title={[
            deck.engine ? CHOICE_ENGINE[deck.engine] : '',
            deck.fused !== null && deck.engine !== 'fused' ? `ladder+duel rate ${deck.fused.toFixed(1)}%` : '',
          ].filter(Boolean).join(' · ')}
        >
          <span className={styles.figureValue} data-good={deck.win >= 50 ? '' : undefined}>
            {deck.win.toFixed(1)}%
          </span>
          <span className={styles.figureLabel}>win chance</span>
        </div>
      ) : (
        <div className={styles.figure}>
          <span className={styles.figureValue}>—</span>
          <span className={styles.figureLabel}>no evidence</span>
        </div>
      )}
      <VsChips vs={choiceVs(deck.vs)} className={styles.deckRowVs}
               label="Win chance against each of their likely decks" />
      {/* A BUILT deck says what was changed and from which real deck: the
          swap in card art, and how many real deck pairs differ by it. */}
      {deck.source === 'built' && !!deck.swaps?.length && (
        <div className={`${styles.deckRowVs} ${styles.swapRow}`} data-choice-swap="">
          {deck.swaps.map((s) => (
            <span key={s.out + s.in} className={styles.swapRow}>
              <span className={styles.swapSide}><CardArt card={s.out} /></span>
              <span className={styles.swapArrow} aria-label="becomes">→</span>
              <span className={styles.swapSide}><CardArt card={s.in} variant={deck.art[s.in]} /></span>
              <span className={styles.blockNote}>{s.pairs.toLocaleString('en-US')} real deck pairs make this swap</span>
            </span>
          ))}
          {deck.seedName && <span className={styles.blockNote}>from {deck.seedName}</span>}
        </div>
      )}
      {/* THE BUILDER'S CHANGE TO THIS DECK, on the deck it changes. Both
          rates are the same engine against the same decks, so the gain is a
          like-for-like difference. The named cards and the deck's own win
          condition are never the ones swapped out. */}
      {im && (
        <div className={`${styles.deckRowVs} ${styles.swapRow}`} data-choice-improve="">
          <Delta n={im.gain} />
          {im.swaps.map((s, i) => (
            <span key={s.out + s.in} className={styles.swapRow}>
              {/* Two swaps are two changes, not a chain: without the mark
                  "A → B C → D" read as A becoming B and C. */}
              {i > 0 && <span className={styles.swapArrow} aria-hidden="true">+</span>}
              <span className={styles.swapSide}><CardArt card={s.out} variant={deck.art[s.out]} /></span>
              <span className={styles.swapArrow} aria-label="becomes">→</span>
              <span className={styles.swapSide}><CardArt card={s.in} variant={im.art[s.in]} /></span>
            </span>
          ))}
          <span className={styles.blockNote}>
            {im.seedWin.toFixed(1)}% → {im.win.toFixed(1)}% · {im.swaps.map((s) => s.pairs.toLocaleString('en-US')).join(' + ')} real deck pairs
          </span>
          <DeckActions cards={im.cards} name={`${deck.deckName} (${im.swaps.map((s) => filterCardName(s.in)).join(', ')})`} size="sm" />
        </div>
      )}
    </li>
  );
}

/**
 * "The decks it gave, the player might not play" — so the reader NAMES the
 * cards: up to four win conditions or cards, and every deck returned holds all
 * of them, rated against this opponent's likely decks on the brain that ranks
 * "Play this" (`server/coach.py` `chosen`, rules in `coach_choice.py`).
 *
 * REAL DECKS LEAD, BUILT DECKS FOLLOW, under their own heading. A built deck
 * has never been played as listed — its rate is inherited from the real deck
 * it came from — so the two are not ranked against each other.
 *
 * The named cards and "was this asked" live in the PARENT. The result view
 * unmounts whenever the Suggestion reloads (a game was played, the window
 * changed), and a panel that forgot the cards each time would ask the reader
 * to pick them again in the middle of a duel.
 */
function ChoicePanel({
  me, opp, myPlayed, oppPlayed, days, want, onWant, asked, onAsked,
}: {
  me: string;
  opp: string;
  myPlayed: string[][];
  oppPlayed: string[][];
  days: number;
  want: string[];
  onWant: (cards: string[]) => void;
  asked: boolean;
  onAsked: () => void;
}) {
  const [res, setRes] = useState<CoachChosen | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    (cards: string[]) => {
      if (!cards.length) return;
      const id = ++seq.current;
      setBusy(true);
      setError(null);
      fetchCoachChosen(me, opp, myPlayed, oppPlayed, { days }, cards)
        .then((r) => {
          /* A server that predates this feature ignores `want` and answers
             with an ordinary suggestion. That is not a list of decks, and
             drawing it as one would throw. */
          if (!Array.isArray(r?.decks) || !r.counts) {
            throw new Error('The analytics server does not have this yet.');
          }
          if (id === seq.current) setRes(r);
        })
        .catch((e) => {
          if (id !== seq.current) return;
          setRes(null);
          setError((e as AnalyticsError).message || 'Could not build decks for those cards.');
        })
        .finally(() => {
          if (id === seq.current) setBusy(false);
        });
    },
    [me, opp, myPlayed, oppPlayed, days],
  );

  /* The duel moved on, or the window changed: an answer already asked for is
     asked again for the new state, with the same cards. Nothing runs until
     the reader has pressed the button once. */
  const state = `${me}|${opp}|${days}|${myPlayed.map((d) => d.join(',')).join(';')}|${oppPlayed.map((d) => d.join(',')).join(';')}`;
  useEffect(() => {
    if (asked && want.length) run(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const toggle = (key: string) =>
    onWant(
      want.includes(key)
        ? want.filter((k) => k !== key)
        : want.length >= COACH_CHOICE_MAX ? want : [...want, key],
    );

  const real = res?.decks.filter((d) => d.source !== 'built') ?? [];
  const built = res?.decks.filter((d) => d.source === 'built') ?? [];
  const named = (res?.want ?? []).map(filterCardName).join(' + ');

  return (
    <section className={styles.block} data-hue="blue" data-choice-panel="">
      <h4 className={styles.blockTitle}>
        Build around your cards{' '}
        <span className={styles.blockNote}>
          up to {COACH_CHOICE_MAX} win conditions or cards · every deck holds all of them
        </span>
      </h4>
      <div className={styles.choiceBar}>
        <WinConFilter
          selected={want}
          onToggle={toggle}
          onClear={() => onWant([])}
          label="Pick cards"
          title="Name the win conditions or cards the deck must hold"
        />
        <button
          type="button"
          className={styles.primary}
          disabled={!want.length || busy}
          onClick={() => {
            onAsked();
            run(want);
          }}
        >
          Find decks
        </button>
      </div>

      {busy && (
        <ReadingState k="coach-choice" hue="blue">
          Finding and building decks with those cards…
        </ReadingState>
      )}
      {error && !busy && <p className={styles.askHint}>{error}</p>}

      {res && !busy && (
        <>
          {res.reason === 'spent' && (
            <p className={styles.askHint}>
              {res.spent.map(filterCardName).join(', ')} already played this duel — a duel cannot repeat a card.
            </p>
          )}
          {res.reason === 'none' && (
            <p className={styles.askHint}>
              No real deck holds {named} together, and no swap real players make builds one.
            </p>
          )}
          {real.length > 0 && (
            <>
              <h4 className={styles.blockTitle}>
                Decks with {named}{' '}
                <span className={styles.blockNote}>
                  {[
                    res.engine ? `win chance · ${CHOICE_ENGINE[res.engine]}` : '',
                    `${res.counts.yours} yours`,
                    `${res.counts.duel.toLocaleString('en-US')} duel`,
                    `${res.counts.meta} meta held them`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </h4>
              <ul className={styles.deckList}>
                {real.map((d, i) => (
                  <ChoiceRow key={d.cards.join(',')} deck={d} rank={i + 1} />
                ))}
              </ul>
            </>
          )}
          {built.length > 0 && (
            <>
              <h4 className={styles.blockTitle}>
                Built for {named}{' '}
                <span className={styles.blockNote}>
                  a real deck + one swap real players make · not played as listed
                </span>
              </h4>
              <ul className={styles.deckList}>
                {built.map((d, i) => (
                  <ChoiceRow key={d.cards.join(',')} deck={d} rank={real.length + i + 1} />
                ))}
              </ul>
            </>
          )}
        </>
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

function Suggestion({ tag, days }: { tag: string; days: number }) {
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
  const reading = useHeldLoading(busy);
  useReportRegistration({
    id: 'coach-suggest',
    ready: Boolean(data),
    build: async () => (await import('../../utils/screenAdapters')).coachSuggestionDoc(data as CoachSuggestion),
  });

  /* THE TUNER IS PRO, NOT MEMBERS (2026-09-27, asked for). It sat on the admin
     staging shelf while it was unmeasured; it has been measured, and it follows
     the three-slot rule now. `isPaid` is the project's ONE predicate for "paid
     Pro or admin, not a trial" — the line Coach Assist itself sits behind
     (`PRO_ONLY_SECTIONS`), stated again here so the block cannot outlive a
     change to the section gate. Measured before opening it: the swap scan adds
     1.4–2.4 s to the first suggestion for a deck, and nothing once warm.

     `useAccess()`, NEVER `useAccountStore(s => s.tier)`. The raw store
     initialises to 'free' and RESETS to 'free' on sign-out, so reading it
     would hand a signed-out visitor whatever 'free' happens to unlock. Only
     `useAccess` knows 'anon' is not a tier. */
  const tunerAllowed = isPaid(useAccess());

  /* "BUILD AROUND YOUR CARDS" IS ADMIN-ONLY FOR NOW (2026-10-02, asked for:
     "initially do it admin only, then I will see, then we release for all").
     The same staging shelf the tuner sat on before it was measured. The flag
     gates the REQUEST too: the block is the only caller of `fetchCoachChosen`,
     so a reader who cannot see it never sends `want`. */
  const access = useAccess();
  const choiceAllowed = access === 'admin';
  const [choiceWant, setChoiceWant] = useState<string[]>([]);
  const [choiceAsked, setChoiceAsked] = useState(false);

  useEffect(() => setOpp(tag), [tag]);

  const run = useCallback(
    (mine: string[][], theirs: string[][]) => {
      setBusy(true);
      setError(null);
      /* The flag gates the REQUEST, not just the render. A reader who will
         never be shown the block must not pay the sibling scan for it. */
      fetchCoachSuggestion(me.trim(), opp.trim(), mine, theirs, { days }, tunerAllowed)
        .then((d) => {
          setData(d);
          setStep({ kind: 'result' });
        })
        .catch((e) => setError(e as AnalyticsError))
        .finally(() => setBusy(false));
    },
    [me, opp, days, tunerAllowed],
  );

  /* As in Window 1: refresh the answer, keep the interview. */
  const answered = step.kind === 'result';
  useEffect(() => {
    if (answered) run(myPlayed, oppPlayed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const reset = () => {
    setStep({ kind: 'tags' });
    setGames(0);
    setMyPlayed([]);
    setOppPlayed([]);
    setData(null);
    setError(null);
    setChoiceWant([]);
    setChoiceAsked(false);
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

  if (reading)
    return (
      <ReadingState k="coach-matchups" hue="green">
        Reading both players and scoring the matchups…
      </ReadingState>
    );

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
          /* BACKING OUT OF A NARROW-IT-DOWN RETURNS TO THE ANSWER IT CAME FROM.
             `data` still holds the previous stage's result while these two
             questions are being asked, so `game === data.stage + 1` is exactly
             "this paste came from the button below the result, not from the
             opening interview". Without it Back either re-asks a question
             already answered (game 2) or drops the reader at question 2
             (game 1) — both discarding a result that is still in hand, which
             is the thing the button exists to avoid. */
          if (data && game === data.stage + 1) return setStep({ kind: 'result' });
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
            {best.brain ? (
              <span className={styles.verdictFigure}>
                {best.brain.winRate.toFixed(1)}%
                <span className={styles.verdictFigureLabel}>
                  win chance · combined brain
                  {best.expected ? ` · ladder+duel alone ${best.expected.winRate.toFixed(1)}%` : ''}
                </span>
              </span>
            ) : best.expected && (
              <span className={styles.verdictFigure}>
                {best.expected.winRate.toFixed(1)}%
                <span className={styles.verdictFigureLabel}>
                  expected · {SOURCE_LABEL[best.expected.per[0]?.matchup?.source ?? ''] ?? 'no matchup evidence'}
                </span>
              </span>
            )}
            {best.duel && (
              <span
                className={styles.duelRate}
                data-strong={best.duel.strong || undefined}
                title={duelTitle(best.duel)}
              >
                {duelChip(best.duel)}
              </span>
            )}
          </div>
          <Strip
            cards={best.cards}
            art={best.art}
            inferred={best.inferredArt}
            filled={best.artFilled}
            name={best.deckName}
          />
          <VsChips vs={best.expected?.vs} />
        </section>
      )}

      {data.brainModel && <BrainLine model={data.brainModel} />}

      {/* ADMIN-ONLY FOR NOW. Directly under the pick, because it is the
          answer to "the player will not play that". */}
      {choiceAllowed && (
        <ChoicePanel
          me={me.trim()}
          opp={opp.trim()}
          myPlayed={myPlayed}
          oppPlayed={oppPlayed}
          days={days}
          want={choiceWant}
          onWant={setChoiceWant}
          asked={choiceAsked}
          onAsked={() => setChoiceAsked(true)}
        />
      )}
      {!!data.brainSwaps?.length && best && <BrainSwaps swaps={data.brainSwaps} base={best} />}
      {data.built && data.built.decks.length > 0 && <BuiltPanel built={data.built} />}

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

      {/* PRO AND ADMIN, AND OPT-IN AT THE REQUEST. Absent for everyone else —
          the server was never asked, so there is nothing to hide here. */}
      {tunerAllowed && data.tuner && <TunerPanel tuner={data.tuner} />}

      {/* Every reason the answer might be weaker than it looks, listed rather
          than folded into one flag nobody can interrogate. */}
      {!!data.caveats.length && (
        <ul className={styles.caveats}>
          {data.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      {/* THE DUEL ADVANCES FROM HERE, IT DOES NOT RESTART. Window 1 has had
          this row since it shipped; this window did not, so the only way on
          from an answer was "Start over" — which throws away both tags and
          every deck already pasted to ask the same questions again, in the
          middle of a duel with a clock on it. The interview is unchanged: this
          re-enters it at the game the reader has just finished, so each round
          costs the two decks that are actually new.

          Both sides get asked, unlike Window 1's single reveal — a suggestion
          has to know what YOU spent as well as what they did, since that is
          what makes a deck illegal for you next game.

          Capped at stage 2 because a duel is three games and the server takes
          `m1,m2` / `o1,o2` — there is no game 4 to narrow to. */}
      <div className={styles.nextRow}>
        {data.stage < 2 && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              const next = (data.stage + 1) as 1 | 2;
              setGames(next);
              setStep({ kind: 'paste', side: 'mine', game: next });
            }}
          >
            {data.stage === 0
              ? 'Game 1 finished — narrow it down'
              : 'Game 2 finished — pick game 3'}
          </button>
        )}
        <button type="button" className={styles.secondary} onClick={reset}>
          {data.stage >= 2 ? 'Done — start over' : 'Exit'}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── the shell */

/* HOW FAR BACK THE DUEL HISTORY IS READ.
 *
 * Both windows used to read EVERYTHING stored for a player, which quietly
 * answers a different question from the one a duel asks: a deck they ran daily
 * six weeks ago counted exactly as much as the one they ran this morning.
 *
 * `days` counts back from that player's LAST STORED BATTLE, not from today —
 * the site-wide convention, and the reason someone who stopped playing a month
 * ago still gets a populated screen. In Window 2 it is resolved separately for
 * each of the two tags, so this is thirty days of EACH player's play rather
 * than one calendar range that may be empty for whichever stopped sooner. */
/* The shared list — see `utils/datePresets.ts`. It was 15/30/45/60 here alone,
   so moving from this screen into the Coach Roster (7/30/90) dropped the two
   windows a coach had just been using. The server clamps `days` to 1..4000, so
   7 and 90 need nothing on its side. */
const HISTORY_DAYS = DAY_PRESETS;

export function CoachAssist({ tag }: { tag: string }) {
  const [win, setWin] = useState<'predict' | 'suggest'>('predict');
  const [days, setDays] = useState<number>(30);
  const blurb = useMemo(() => WINDOWS.find((w) => w.id === win)?.blurb ?? '', [win]);

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.headIcon}>{ICONS.coach}</span>
        <div className={styles.headText}>
          <h1 className={styles.title}>Coach Assist</h1>
          <p className={styles.blurb}>{blurb}</p>
        </div>

        {/* ONE CONTROL FOR BOTH WINDOWS. The prediction and the suggestion read
            the same history, so letting them disagree about how far back it
            goes would mean the screen contradicted itself. */}
        <div className={styles.daysRow} role="group" aria-label="History window">
          <span className={styles.daysLabel}>History</span>
          {HISTORY_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              className={`${styles.dayChip} ${days === d ? styles.dayChipOn : ''}`}
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      <Tabs label="Coach Assist" items={WINDOWS.map((w) => ({ id: w.id, label: w.label, title: w.blurb }))} value={win} onChange={setWin} />

      {/* Keyed on the window so switching tabs starts a clean interview rather
          than resuming the other one's half-answered questions. */}
      {/* `days` is NOT in the key. Changing the window must refresh the answer,
          not throw away the interview the reader has already sat through —
          each child re-runs its own fetch instead. */}
      {win === 'predict' ? (
        <DuelPrediction key={`p-${tag}`} tag={tag} days={days} />
      ) : (
        <Suggestion key={`s-${tag}`} tag={tag} days={days} />
      )}
    </section>
  );
}
