import { useEffect, useMemo, useState } from 'react';
import {
  fetchCoachAnswers,
  type AnalyticsError,
  type CoachAnswers,
  type CoachDeck,
} from '../../state/analyticsClient';
import { CARDS_BY_KEY } from '../../data/cards';
import { distinctDeckLabels } from '../../utils/trendSeries';
import {
  ORIGIN_PILL,
  ORIGIN_WORD,
  answerInputs,
  answersKey,
  columnFor,
  decksFor,
  deckKeyOf,
  otherRates,
  theirSide,
  winConCard,
  type CoachFlowDeck,
} from '../../utils/coachFlow';
import { flowTone, sourceWord, type FlowDeck, type FlowFocus } from '../../utils/matchupFlow';
import { MatchupFlow } from './MatchupFlow/MatchupFlow';
import { CardArt } from './CardArt';
import { ReadingState } from './ReadingState';
import styles from './CoachFlow.module.css';

/**
 * COACH ASSIST'S MATCHUP MAP (2026-11-14) — Team Analysis's map, centred on
 * ONE DECK of theirs at a time, with the decks on the right worked out for
 * that deck: the best list of every win condition against it (the CRL group's
 * duel lists, the top 1,000's lists and the coached player's own duel decks),
 * each with its rate against their other decks underneath. Picking another of
 * their decks changes the right-hand column; picking one of ours draws it
 * against every deck of theirs.
 */

/** Where the map opens: one of their decks (its index on the screen), or one
 *  of the decks on the player's own list (its cards). */
export type CoachMapOpen = { side: 'their'; at: number } | { side: 'ours'; cards: string[] };

/* ONE REQUEST PER QUESTION, kept for the visit: re-opening the map on another
   deck, or closing and opening it again, costs nothing. */
const CACHE = new Map<string, Promise<CoachAnswers>>();
const CACHE_MAX = 24;

function load(key: string, run: () => Promise<CoachAnswers>): Promise<CoachAnswers> {
  let hit = CACHE.get(key);
  if (!hit) {
    if (CACHE.size >= CACHE_MAX) CACHE.clear();
    hit = run();
    hit.catch(() => CACHE.delete(key));
    CACHE.set(key, hit);
  }
  return hit;
}

const cardInfo = (k: string) => CARDS_BY_KEY.get(k);
const cardName = (k: string) => CARDS_BY_KEY.get(k)?.name ?? k;

export function CoachFlow({
  decks,
  open,
  me = '',
  myPlayed = [],
  keep = [],
  days,
  onClose,
}: {
  /** Their decks as the screen lists them. */
  decks: CoachDeck[];
  open: CoachMapOpen;
  /** The coached player (the Suggestion): adds their own duel decks. */
  me?: string;
  /** Decks the coached player has played this duel: no answer may share a card. */
  myPlayed?: string[][];
  /** The options on screen, kept on the map. */
  keep?: string[][];
  days: number;
  onClose: () => void;
}) {
  const inputs = useMemo(() => answerInputs(decks), [decks]);
  const key = answersKey(inputs, me, myPlayed, keep, days);
  const [ans, setAns] = useState<CoachAnswers | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    load(key, () => fetchCoachAnswers(inputs, { me, myPlayed, keep, days }))
      .then((a) => live && setAns(a))
      .catch((e) => live && setError(e as AnalyticsError));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const labels = useMemo(
    () => distinctDeckLabels(decks.map((d) => ({ name: d.deckName || d.archetype, cards: d.cards })), cardName),
    [decks],
  );
  const side = useMemo(() => (ans ? theirSide(decks, ans, labels) : null), [ans, decks, labels]);

  /* WHICH OF THEIR DECKS FILLS THE RIGHT-HAND COLUMN. Centred on theirs, that
     deck; centred on one of ours, the column stays what it was (or, opened on
     our deck, the deck of theirs it plays worst against). */
  const [focus, setFocus] = useState<FlowFocus | null>(null);
  const [column, setColumn] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const openKey = open.side === 'their' ? `t${open.at}` : `o${deckKeyOf(open.cards)}`;
  useEffect(() => {
    if (!ans || !side) return;
    if (open.side === 'their') {
      const t = ans.their.find((x) => x.at === open.at) ?? ans.their[0];
      if (!t) return;
      setColumn(t.key);
      setOpened(null);
      setFocus({ side: 'their', id: t.key });
    } else {
      const k = deckKeyOf(open.cards);
      setColumn(columnFor(ans, side.keys, k));
      setOpened(k);
      setFocus({ side: 'ours', id: k });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ans, openKey]);

  const right = useMemo(
    () => (ans && side && column ? decksFor(ans, side.keys, column, opened ?? undefined) : []),
    [ans, side, column, opened],
  );

  const onFocus = (f: FlowFocus) => {
    if (f.side === 'their') {
      setColumn(f.id);
      setOpened(null);
    }
    setFocus(f);
  };

  if (error) {
    return (
      <div className={styles.shell} data-coach-map="error">
        <p className={styles.note}>Could not read the matchups: {error.message}</p>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (!ans || !side) {
    return (
      <div className={styles.shell} data-coach-map="loading">
        <ReadingState k="coach-map" hue="violet">
          Rating every win condition against each of their decks…
        </ReadingState>
      </div>
    );
  }
  if (!ans.decks.length || !side.plays.length) {
    return (
      <div className={styles.shell} data-coach-map="empty">
        <p className={styles.note}>No measured matchups against these decks yet.</p>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  const columnName = side.plays.find((p) => p.family === column)?.name;

  const extra = (deck: FlowDeck, f: FlowFocus) => {
    const d = deck as CoachFlowDeck;
    const pill = ORIGIN_PILL[d.origin];
    const others = f.side === 'their' ? otherRates(deck, side.keys, f.id) : [];
    if (!pill && !others.length) return null;
    return (
      <span className={styles.extra} data-coach-extra>
        {pill && (
          <span className={styles.origin} data-origin={d.origin} title={ORIGIN_WORD[d.origin]}>
            {pill}
          </span>
        )}
        {others.map(({ key: k, rate }) => {
          const their = side.source.get(k);
          const name = side.plays.find((p) => p.family === k)?.name ?? '';
          const card = their ? winConCard(their.cards, cardInfo) : null;
          const v = deck.vsLists?.[k];
          return (
            <span
              key={k}
              className={styles.vs}
              data-tone={flowTone(rate)}
              data-vs-their={k}
              title={`Against their ${name}: ${rate.toFixed(1)}%${v ? ` · ${sourceWord(v[1])}${v[2] ? ` · ${v[2].toLocaleString('en-US')} games` : ''}` : ''}`}
            >
              {card && <CardArt card={card} />}
              {rate.toFixed(0)}%
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className={styles.shell} data-coach-map="ready">
      <MatchupFlow
        plays={side.plays}
        threats={side.threats}
        decks={right}
        focus={focus}
        onFocus={onFocus}
        onClose={onClose}
        oursExtra={extra}
        kicker="Matchup map · every win condition"
        theirFoot={(n) => {
          const d = side.source.get(n.family);
          return d?.fill ? 'Meta deck' : d?.count ? `Played ${d.count}×` : 'Their deck';
        }}
        toolbar={
          <p className={styles.step} data-coach-step>
            {focus?.side === 'ours'
              ? 'Each of their decks against this one. Pick one of theirs to see what else answers it.'
              : `The best deck of each win condition against their ${columnName ?? 'deck'}, with its rate against their other decks. Pick another of theirs and the decks change.`}
          </p>
        }
      />
    </div>
  );
}
