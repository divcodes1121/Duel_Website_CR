import { useEffect, useMemo, useState } from 'react';

import { playerLabel, type RosterPlayer } from '../../../state/coachRoster';
import { deckLabel, type ArsenalDeck } from '../../../state/coachArsenal';
import { useCoachArsenal } from '../../../state/coachArsenalStore';
import { PLAN_SLOTS, SLOT_LABEL, deckInSlot, planLabel, type MatchPlan } from '../../../state/coachPlans';
import { useCoachPlans } from '../../../state/coachPlansStore';
import {
  LEARNING_FLOOR,
  OUTCOME_LABEL,
  PLAYED_SLOT_LABEL,
  ResultError,
  SOURCE_FLOOR,
  SOURCE_RECORD_LABEL,
  inferSlot,
  learn,
  tallyOf,
  type MatchOutcome,
  type MatchResult,
} from '../../../state/coachResults';
import { useCoachResults } from '../../../state/coachResultsStore';
import { ago } from '../../../utils/format';
import { CardArt } from '../../Analytics/CardArt';
import { positionalArt } from '../../../utils/deckSeating';
import { ReadingState } from '../../Analytics/ReadingState';
import { Dropdown } from '../../ui/dropdown-menu-14';
import { Tile } from './PlayerOverview';
import styles from './CoachRoster.module.css';

/**
 * WHAT ACTUALLY HAPPENED — the end of the chain.
 *
 * recommendation → decision → deck played → result. Phases 5 and 6 recorded
 * the first two and froze the reasoning; this is the only phase that can say
 * whether any of it helped.
 *
 * THE CARDS DECIDE WHICH SLOT WAS PLAYED. Recording a loss is the least
 * reliable moment to ask a coach "was that the backup or the alternative?",
 * so the deck they pick is matched against the plan's own slots by the
 * order-free key. Off-plan is a real answer and is recorded as one.
 *
 * NOTHING IS CLAIMED UNDER A FLOOR. Under ten recorded matches the screen
 * prints the count and no rate at all — not a percentage with a caveat
 * beside it, because a percentage with a caveat is read as a percentage. The
 * same rule applies per source: five matches before that source's rate
 * appears.
 *
 * TEST PLANS AND TEST RESULTS ARE EXCLUDED FROM EVERY FIGURE. Trying the
 * tool out must not become evidence about the advice.
 */

export function ResultsTab({ player }: { player: RosterPlayer }) {
  const results = useCoachResults((s) => s.byPlayer[player.id]);
  const loading = useCoachResults((s) => s.loading[player.id]);
  const storeError = useCoachResults((s) => s.error);
  const repoKind = useCoachResults((s) => s.repoKind);
  const load = useCoachResults((s) => s.load);
  const remove = useCoachResults((s) => s.remove);
  const plans = useCoachPlans((s) => s.byPlayer[player.id]);
  const loadPlans = useCoachPlans((s) => s.load);
  const arsenal = useCoachArsenal((s) => s.byPlayer[player.id]);
  const loadArsenal = useCoachArsenal((s) => s.load);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load(player.id);
    void loadPlans(player.id);
    void loadArsenal(player.id);
  }, [player.id, load, loadPlans, loadArsenal]);

  const rows = useMemo(() => results ?? [], [results]);
  const planList = useMemo(() => plans ?? [], [plans]);
  const learning = useMemo(() => learn(rows, planList), [rows, planList]);

  if (results === undefined && loading) {
    return (
      <ReadingState k="coach-results" hue="violet">
        Reading {playerLabel(player)}’s recorded matches…
      </ReadingState>
    );
  }

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Recorded matches</h3>
          <span className={styles.muted}>
            {rows.length} recorded{rows.length ? ` · ${tallyOf(rows).text}` : ''}
          </span>
        </div>
        <p className={styles.muted}>
          What {playerLabel(player)} actually played and how it went. This is the only thing that can say whether the
          preparation helped — and it is only as good as what is entered, so it is entered by hand and never inferred.
        </p>
        {repoKind === 'memory' && (
          <p className={styles.hint}>
            Local preview: Supabase is not configured in this checkout, so these results live in memory and are gone on
            reload.
          </p>
        )}
        <div className={styles.controlRow}>
          <button type="button" className={styles.primaryButton} onClick={() => setRecording(true)}>
            + Record a match
          </button>
        </div>
        {(error || storeError) && <p className={styles.formError}>{error ?? storeError}</p>}
      </section>

      <LearningBlock learning={learning} player={player} />

      {rows.length === 0 ? (
        <section className={styles.notice}>
          <h3>Nothing recorded yet</h3>
          <p>
            Record a match after it is played. With a plan attached, the deck they brought is matched against the
            plan’s own slots, so "did they follow it" is answered by the cards rather than by memory.
          </p>
        </section>
      ) : (
        <ul className={styles.arsenalList}>
          {rows.map((r) => (
            <ResultRow
              key={r.id}
              result={r}
              plan={planList.find((p) => p.id === r.planId) ?? null}
              onRemove={() =>
                void (async () => {
                  setError(null);
                  try {
                    await remove(player.id, r.id);
                  } catch (e) {
                    setError(e instanceof ResultError ? e.message : 'Could not delete that result.');
                  }
                })()
              }
            />
          ))}
        </ul>
      )}

      {recording && (
        <RecordDialog
          player={player}
          plans={planList}
          arsenal={arsenal ?? []}
          onClose={() => setRecording(false)}
        />
      )}
    </div>
  );
}

function LearningBlock({ learning, player }: { learning: ReturnType<typeof learn>; player: RosterPlayer }) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>Is the preparation working?</h3>
        <span className={styles.muted}>test plans and test results are left out</span>
      </div>

      {/* THE WITHHELD SENTENCE IS THE FEATURE. Under the floor there is no
          rate at all — not a rate with a warning next to it. */}
      {learning.withheld ? (
        <p className={styles.hint}>{learning.withheld}</p>
      ) : (
        <div className={styles.tiles}>
          <Tile
            label="Matches recorded"
            value={String(learning.recorded)}
            note={`${learning.wins} won`}
          />
          <Tile
            label="Win rate"
            value={learning.winRate === null ? '—' : `${learning.winRate.toFixed(1)}%`}
            note="across every recorded match"
          />
          <Tile
            label="Plan followed"
            value={learning.followRate === null ? '—' : `${learning.followRate.toFixed(0)}%`}
            note={
              learning.followRate === null
                ? `${learning.followed} of ${learning.withPlan} — too few to rate`
                : `${learning.followed} of ${learning.withPlan} matches with a plan`
            }
          />
        </div>
      )}

      {learning.bySource.length > 0 && (
        <>
          <h4 className={styles.blockTitle}>By where the deck came from</h4>
          <ul className={styles.metList}>
            {learning.bySource.map((s) => (
              <li key={s.source} className={styles.metRow}>
                <span className={styles.metName}>{SOURCE_RECORD_LABEL[s.source]}</span>
                <span className={styles.muted}>
                  {s.played} played · {s.wins} won
                  {s.winRate === null
                    ? ` · under ${SOURCE_FLOOR} matches, so no rate yet`
                    : ` · ${s.winRate.toFixed(0)}%`}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>
            These are counts of what {playerLabel(player)} played, not a verdict on the engine: a deck is only ever
            here because somebody chose it. Rates appear per source at {SOURCE_FLOOR} matches and overall at{' '}
            {LEARNING_FLOOR}.
          </p>
        </>
      )}
    </section>
  );
}

function ResultRow({ result, plan, onRemove }: { result: MatchResult; plan: MatchPlan | null; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const slot = result.playedSlot ?? inferSlot(plan, result.deckPlayed);
  const playedArt = positionalArt(result.deckPlayed);

  return (
    <li className={styles.arsenalItem}>
      <button type="button" className={styles.planHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.arsenalMeta}>
          <span className={styles.deckName}>
            {OUTCOME_LABEL[result.result]} against {plan ? planLabel(plan) : result.opponentTag}
            {result.playerCrowns !== null && result.opponentCrowns !== null
              ? ` · ${result.playerCrowns}–${result.opponentCrowns}`
              : ''}
          </span>
          <span className={styles.muted}>
            {ago(result.playedAt)} · {PLAYED_SLOT_LABEL[slot]}
            {plan ? '' : ' · no plan attached'}
          </span>
        </span>
        <span className={styles.deckCards}>
          {result.deckPlayed.map((c) => (
            <CardArt key={c} card={c} variant={playedArt[c]} className={styles.deckCard} />
          ))}
        </span>
      </button>

      {open && (
        <div className={styles.arsenalDetail}>
          {result.notes && <p className={styles.notes}>{result.notes}</p>}
          <p className={styles.muted}>
            {plan
              ? `Recorded against the plan made ${ago(plan.createdAt)}. The deck was matched to ${PLAYED_SLOT_LABEL[slot].toLowerCase()} by its cards.`
              : 'Recorded without a plan, so there is nothing to have followed.'}
            {result.testMode ? ' Marked as a test, so it is left out of every figure.' : ''}
          </p>
          <div className={styles.controlRow}>
            {!confirm ? (
              <button type="button" className={styles.dangerGhost} onClick={() => setConfirm(true)}>
                Delete result…
              </button>
            ) : (
              <>
                <button type="button" className={styles.dangerButton} onClick={onRemove}>
                  Confirm delete result
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Record what happened. The deck decides the slot, so the coach is never
 *  asked to remember which box it was in. */
function RecordDialog({
  player,
  plans,
  arsenal,
  onClose,
}: {
  player: RosterPlayer;
  plans: MatchPlan[];
  arsenal: ArsenalDeck[];
  onClose: () => void;
}) {
  const add = useCoachResults((s) => s.add);
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? '');
  const [cards, setCards] = useState<string[] | null>(null);
  const [deckName, setDeckName] = useState('');
  const [outcome, setOutcome] = useState<MatchOutcome>('win');
  const [mine, setMine] = useState('');
  const [theirs, setTheirs] = useState('');
  const [notes, setNotes] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const slot = cards ? inferSlot(plan, cards) : null;

  const choices: { cards: string[]; name: string; from: string }[] = [
    ...(plan
      ? PLAN_SLOTS.flatMap((s) => {
          const d = deckInSlot(plan, s);
          return d ? [{ cards: d.cards, name: d.name ?? SLOT_LABEL[s], from: SLOT_LABEL[s] }] : [];
        })
      : []),
    ...arsenal
      .filter((d) => d.status === 'active')
      .map((d) => ({ cards: d.cards, name: deckLabel(d), from: 'Arsenal' })),
  ];

  async function submit() {
    if (!cards) {
      setError('Pick the deck that was actually played.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await add(player.id, {
        planId: plan?.id ?? null,
        opponentTag: plan?.opponentTag ?? '',
        deckPlayed: cards,
        playedSlot: inferSlot(plan, cards),
        result: outcome,
        playerCrowns: mine === '' ? null : Number(mine),
        opponentCrowns: theirs === '' ? null : Number(theirs),
        notes,
        testMode,
      });
      onClose();
    } catch (e) {
      setError(e instanceof ResultError ? e.message : 'Could not save that result.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${styles.pickerDialog}`} role="dialog" aria-modal="true" aria-label="Record a match">
        <h2 className={styles.dialogTitle}>Record a match</h2>

        {plans.length === 0 ? (
          <p className={styles.muted}>
            No match plans yet. A result can still be recorded once there is a plan to attach it to — that link is what
            makes "did they follow it" answerable.
          </p>
        ) : (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Against which plan</span>
            <Dropdown
              value={planId}
              onChange={setPlanId}
              caption="Match plan"
              options={plans.map((p) => ({
                value: p.id,
                label: planLabel(p),
                description: `made ${ago(p.createdAt)}`,
              }))}
            />
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Which deck was played</span>
          {choices.length === 0 ? (
            <p className={styles.muted}>Nothing to choose from yet — fill a plan slot or approve an arsenal deck.</p>
          ) : (
            <ul className={styles.metList}>
              {choices.map((c, i) => {
                const chosen = cards ? cards.join(',') === c.cards.join(',') : false;
                return (
                  <li key={`${c.name}-${i}`}>
                    <button
                      type="button"
                      className={styles.metRow}
                      data-on={chosen || undefined}
                      onClick={() => {
                        setCards(c.cards);
                        setDeckName(c.name);
                      }}
                    >
                      <span className={styles.metName}>{c.name}</span>
                      <span className={styles.muted}>{c.from}</span>
                      <span className={styles.rowLink}>{chosen ? 'Chosen' : 'Pick →'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* THE CARDS DECIDE THE SLOT, and the screen says which it landed
              on before anything is saved. */}
          {cards && (
            <p className={styles.hint}>
              {deckName} — recorded as {PLAYED_SLOT_LABEL[slot ?? 'other'].toLowerCase()}
              {slot === 'other' ? ', because this plan does not name it.' : '.'}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>How it went</span>
          <div className={styles.tagRow}>
            {(['win', 'loss', 'draw'] as const).map((o) => (
              <button
                key={o}
                type="button"
                className={styles.tagChip}
                data-on={outcome === o || undefined}
                aria-pressed={outcome === o}
                onClick={() => setOutcome(o)}
              >
                {OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.crownRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Their crowns</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={3}
              value={mine}
              placeholder="—"
              onChange={(e) => setMine(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Opponent crowns</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={3}
              value={theirs}
              placeholder="—"
              onChange={(e) => setTheirs(e.target.value)}
            />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Notes</span>
          <textarea
            className={styles.textarea}
            rows={3}
            value={notes}
            placeholder="What decided it…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <label className={styles.checkRow}>
          <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
          <span>Mark as a test — left out of every figure above</span>
        </label>

        {error && <p className={styles.formError}>{error}</p>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primaryButton} disabled={busy || !cards || !plan} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Record it'}
          </button>
        </div>
      </div>
    </div>
  );
}
