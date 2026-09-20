import { useEffect, useMemo, useState } from 'react';

import {
  AnalyticsError,
  fetchTeamAnalysis,
  type CoachIntel,
  type TeamRecommendation,
  type TeamReport,
} from '../../../state/analyticsClient';
import { coachHref, playerLabel, windowDays, type CoachWindow, type RosterPlayer } from '../../../state/coachRoster';
import { deckKey, deckLabel } from '../../../state/coachArsenal';
import { useCoachArsenal } from '../../../state/coachArsenalStore';
import { buildSnapshot } from '../../../state/coachPlans';
import { useCoachPlans } from '../../../state/coachPlansStore';
import {
  assistRows,
  assistSourceRef,
  coverNote,
  emptyReason,
  suggestedDecks,
  type ArsenalRow,
  type SuggestedDeck,
} from '../../../state/coachAssist';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../../Analytics/ReadingState';
import { DeckEditorDialog } from './DeckEditorDialog';
import { OpponentChooser } from './OpponentChooser';
import styles from './CoachRoster.module.css';

/**
 * WHAT TO PLAY — the engine's ranking, joined to the coach's arsenal.
 *
 * IT RANKS NOTHING ITSELF. `server/team_analysis.py` already answers this
 * question — spread-weighted expected win rate against what the opponent
 * actually brings, a practice tiebreak, and a named reason when it can say
 * nothing — and it is the same engine the public Team Analysis screen uses.
 * A second ranking here would be a second opinion that eventually disagrees
 * with the first about the same two players. This screen calls it with one
 * blue tag and one red tag and presents what comes back.
 *
 * WHAT IT ADDS IS THE JOIN, and the join is the whole point of the phase:
 *
 *   SUGGESTED AND APPROVED    the strongest thing this screen can say
 *   SUGGESTED, NOT APPROVED   worth approving — one click, source recorded
 *   APPROVED, NOT SUGGESTED   and WHY: it scored lower, or it has no stored
 *                             play at all and the engine could not see it
 *
 * THE LAST DISTINCTION IS THE ONE THAT MATTERS. "Not picked" and "could not
 * be scored" look the same on screen and mean opposite things — evidence
 * against a deck, versus no evidence at all.
 *
 * THE ARSENAL KEEPS THE COACH'S ORDER HERE. Re-sorting it by expected win
 * rate would quietly replace their judgement with a model's, which this
 * project has refused since phase 1. Suggestions are marked, never moved.
 */

export function AssistTab({
  player,
  playerIntel,
  win,
  opponentTag,
}: {
  player: RosterPlayer;
  playerIntel: CoachIntel | null;
  win: CoachWindow;
  opponentTag?: string | null;
}) {
  const decksByPlayer = useCoachArsenal((s) => s.byPlayer[player.id]);
  const loadArsenal = useCoachArsenal((s) => s.load);
  const [report, setReport] = useState<TeamReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<TeamRecommendation | null>(null);
  const createPlan = useCoachPlans((s) => s.create);
  const [saving, setSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const windowLabel = win === 0 ? 'all stored battles' : `the last ${win} days`;
  const days = windowDays(win);

  useEffect(() => {
    void loadArsenal(player.id);
  }, [player.id, loadArsenal]);

  useEffect(() => {
    if (!opponentTag) {
      setReport(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    setReport(null);
    fetchTeamAnalysis([player.playerTag], [opponentTag], days)
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e instanceof AnalyticsError ? e.message : 'Could not read the matchup.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [player.playerTag, opponentTag, days]);

  const arsenal = useMemo(() => decksByPlayer ?? [], [decksByPlayer]);
  const folder = report?.folders?.[0] ?? null;
  const mine = folder?.perPlayer?.[0] ?? null;
  const recs = useMemo(() => mine?.decks ?? [], [mine]);
  const suggested = useMemo(() => suggestedDecks(recs, arsenal), [recs, arsenal]);
  const rows = useMemo(() => assistRows(arsenal, recs, playerIntel), [arsenal, recs, playerIntel]);

  if (!opponentTag) {
    return (
      <OpponentChooser
        player={player}
        playerIntel={playerIntel}
        section="assist"
        windowLabel={windowLabel}
        title={`What should ${playerLabel(player)} play?`}
        blurb="Pick who they are up against. The ranking is the analytics engine's own — the same one Team Analysis uses — and this screen shows which of its picks you have already approved."
      />
    );
  }

  if (loading) {
    return (
      <ReadingState k="coach-assist" hue="violet">
        Working out what beats {opponentTag}…
      </ReadingState>
    );
  }

  const opponentName = folder?.player.name || opponentTag;

  /* FREEZING, NOT LINKING. The plan keeps its own copy of every candidate and
     of which engine and window produced the ranking — the engines move on,
     and a plan that pointed at today's numbers would quietly change its own
     reasoning. */
  async function saveAsPlan() {
    setSaving(true);
    setPlanError(null);
    try {
      const played = playerIntel ? new Map(playerIntel.decks.map((d) => [deckKey(d.cards), d.battles])) : null;
      await createPlan(player.id, {
        opponentTag: opponentTag!,
        opponentName: folder?.player.name ?? null,
        recommendations: buildSnapshot(recs, arsenal, played),
        engine: {
          name: 'team_analysis',
          route: '/api/analytics/teams',
          days,
          opponentTag: opponentTag!,
          at: new Date().toISOString(),
        },
        generatedAt: new Date().toISOString(),
      });
      window.location.hash = coachHref(player.playerTag, 'plans');
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : 'Could not save that plan.');
      setSaving(false);
    }
  }
  const why = emptyReason(mine?.reason ?? report?.pool?.reason, playerLabel(player));

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <div className={styles.scoutHead}>
          <div>
            <h3 className={styles.blockTitle}>
              {playerLabel(player)} against {opponentName}
            </h3>
            <span className={styles.muted}>
              Ranked by the analytics engine over {windowLabel}, against what this opponent actually brings.
            </span>
          </div>
          <div className={styles.controlRow}>
            <button type="button" className={styles.primaryButton} disabled={saving} onClick={() => void saveAsPlan()}>
              {saving ? 'Saving…' : 'Save as match plan'}
            </button>
            <a className={styles.linkButton} href={coachHref(player.playerTag, 'scout', opponentTag)}>
              Scout them →
            </a>
            <a className={styles.ghostButton} href={coachHref(player.playerTag, 'assist')}>
              Someone else
            </a>
          </div>
        </div>
        {error && <p className={styles.formError}>{error}</p>}
        {planError && <p className={styles.formError}>{planError}</p>}
        {why && <p className={styles.hint}>{why}</p>}
      </section>

      {/* THE ENGINE'S PICKS. Its candidate pool is the decks this player has
          actually played — which is why an approved deck they have never run
          cannot appear here, and why the arsenal block below says so. */}
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>What the engine suggests</h3>
          <span className={styles.muted}>
            from the {mine?.considered ?? 0} deck{(mine?.considered ?? 0) === 1 ? '' : 's'} of theirs it could score
          </span>
        </div>
        {suggested.length === 0 ? (
          <p className={styles.muted}>
            {why ?? 'The engine had nothing to rank for this pairing.'}
          </p>
        ) : (
          <ul className={styles.arsenalList}>
            {suggested.map((s) => (
              <SuggestionRow
                key={s.key}
                suggestion={s}
                onApprove={() => setAdding(s.rec)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* THE COACH'S OWN LIST, in the coach's order. */}
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Their arsenal against this opponent</h3>
          <span className={styles.muted}>your order, not the engine's</span>
        </div>
        {rows.length === 0 ? (
          <p className={styles.muted}>
            Nothing is approved for {playerLabel(player)} yet. The Arsenal tab is where that is decided.
          </p>
        ) : (
          <ul className={styles.arsenalList}>
            {rows.map((r) => (
              <ArsenalVerdictRow key={r.deck.id} row={r} />
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <DeckEditorDialog
          playerId={player.id}
          initialCards={adding.cards}
          initialName={adding.name}
          initialSource="coach_assist"
          initialSourceRef={assistSourceRef(adding, opponentTag, days)}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function SuggestionRow({ suggestion, onApprove }: { suggestion: SuggestedDeck; onApprove: () => void }) {
  const { rec, arsenal } = suggestion;
  return (
    <li className={styles.arsenalItem}>
      <div className={styles.arsenalHead}>
        <div className={styles.deckCards}>
          {rec.cards.map((c) => (
            <CardArt key={c} card={c} variant={rec.art?.[c]} className={styles.deckCard} />
          ))}
        </div>
        <div className={styles.arsenalMeta}>
          <span className={styles.deckName}>{arsenal ? deckLabel(arsenal) : rec.name}</span>
          <span className={styles.muted}>
            {/* The engine's two figures, printed as they arrive. Nothing here
                is combined into a score of our own. */}
            Expected <strong>{rec.expectedWinRate.toFixed(1)}%</strong> against them
            {typeof rec.overallWinRate === 'number' ? ` · ${rec.overallWinRate.toFixed(1)}% against the field` : ''}
            {rec.comfort ? ` · they have played it ${rec.comfort.games} times` : ''}
          </span>
          <span className={styles.muted}>{coverNote(rec)}</span>
          <span className={styles.tagRow}>
            {arsenal ? (
              <span className={styles.tagChip} data-role>
                In their arsenal
              </span>
            ) : (
              <button type="button" className={styles.ghostButton} onClick={onApprove}>
                Add to arsenal
              </button>
            )}
            <DeckActions cards={rec.cards} name={rec.name} />
          </span>
        </div>
      </div>
    </li>
  );
}

function ArsenalVerdictRow({ row }: { row: ArsenalRow }) {
  const { deck, rec, played, reason } = row;
  return (
    <li className={styles.arsenalItem}>
      <div className={styles.arsenalHead}>
        <div className={styles.deckCards}>
          {deck.cards.map((c) => (
            <CardArt key={c} card={c} className={styles.deckCard} />
          ))}
        </div>
        <div className={styles.arsenalMeta}>
          <span className={styles.deckName}>{deckLabel(deck)}</span>
          {rec ? (
            <span className={styles.muted}>
              The engine picked this: expected <strong>{rec.expectedWinRate.toFixed(1)}%</strong>. {coverNote(rec)}
            </span>
          ) : (
            <span className={styles.muted}>{verdict(reason, played)}</span>
          )}
          {deck.tags.length > 0 && (
            <span className={styles.tagRow}>
              {deck.tags.map((t) => (
                <span key={t} className={styles.tagChip}>
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Why an approved deck is not among the picks.
 *
 * TWO SENTENCES THAT MUST NEVER BE ONE. A deck the engine scored and ranked
 * below others has evidence against it; a deck it has never seen played has
 * no evidence either way, and telling a coach to drop that one would be
 * acting on an absence.
 */
function verdict(reason: ArsenalRow['reason'], played: number | null): string {
  if (reason === 'never_played') {
    return 'No stored battles on this deck, so the engine cannot score it — that is missing evidence, not a verdict.';
  }
  if (reason === 'scored_lower') {
    return `Scored, but not among the top picks here${played ? ` (${played} stored battles on it)` : ''}.`;
  }
  return 'Their battles have not been read, so there is nothing to compare this against.';
}
