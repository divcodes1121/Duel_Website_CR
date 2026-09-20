import { useEffect, useState } from 'react';

import { playerLabel, type RosterPlayer } from '../../../state/coachRoster';
import { deckLabel, type ArsenalDeck } from '../../../state/coachArsenal';
import { useCoachArsenal } from '../../../state/coachArsenalStore';
import {
  PLAN_SLOTS,
  PLAN_SOURCE_LABEL,
  PlanError,
  SLOT_HELP,
  SLOT_LABEL,
  STATUS_LABEL,
  canConfirm,
  deckInSlot,
  planGap,
  planLabel,
  type MatchPlan,
  type PlanCandidate,
  type PlanSlot,
} from '../../../state/coachPlans';
import { useCoachPlans } from '../../../state/coachPlansStore';
import { ago } from '../../../utils/format';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../../Analytics/ReadingState';
import styles from './CoachRoster.module.css';

/**
 * MATCH PLANS — the decision, with its reasoning frozen beside it.
 *
 * Phases 2 to 5 answer questions. This is where the coach commits: against
 * this opponent, this player LEADS with one deck, falls back to a second and
 * keeps a third in reserve. One deck per slot, which the table enforces.
 *
 * WHAT MAKES IT A PLAN RATHER THAN A NOTE is the snapshot. Every plan carries
 * what the screen was showing when it was drawn up — each candidate, its
 * source, its evidence — and which engine and window produced it. The engines
 * move on: the matchup snapshot is rebuilt, the window rolls, a deck's
 * expected rate changes. Without the freeze, "why did we bring this" is
 * unanswerable within a week, and phase 7 would have nothing to compare an
 * outcome against.
 *
 * SOURCE IS CARRIED, NEVER INFERRED. A slot filled from the engine's picks
 * says so; one taken from the arsenal says so. A deck the coach invents is
 * added to the arsenal first — where its own source records that it was
 * manual — so there is exactly one place decks are built, and the plan still
 * records where its choice came from.
 */

export function PlansTab({ player }: { player: RosterPlayer }) {
  const plans = useCoachPlans((s) => s.byPlayer[player.id]);
  const loading = useCoachPlans((s) => s.loading[player.id]);
  const storeError = useCoachPlans((s) => s.error);
  const repoKind = useCoachPlans((s) => s.repoKind);
  const load = useCoachPlans((s) => s.load);
  const arsenal = useCoachArsenal((s) => s.byPlayer[player.id]);
  const loadArsenal = useCoachArsenal((s) => s.load);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void load(player.id);
    void loadArsenal(player.id);
  }, [player.id, load, loadArsenal]);

  if (plans === undefined && loading) {
    return (
      <ReadingState k="coach-plans" hue="violet">
        Reading {playerLabel(player)}’s match plans…
      </ReadingState>
    );
  }

  const rows = plans ?? [];

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Match plans</h3>
          <span className={styles.muted}>
            {rows.length} plan{rows.length === 1 ? '' : 's'} for {playerLabel(player)}
          </span>
        </div>
        <p className={styles.muted}>
          A plan is one preparation against one opponent: what they lead with, what they fall back to, and what is held
          in reserve — with everything the screen was showing at the time frozen beside it.
        </p>
        <p className={styles.muted}>
          Plans are made from <strong>What to play</strong>, which is where the ranking and the arsenal are both on
          screen.
        </p>
        {repoKind === 'memory' && (
          <p className={styles.hint}>
            Local preview: Supabase is not configured in this checkout, so these plans live in memory and are gone on
            reload.
          </p>
        )}
        {storeError && <p className={styles.formError}>{storeError}</p>}
      </section>

      {rows.length === 0 ? (
        <section className={styles.notice}>
          <h3>No match plans yet</h3>
          <p>
            Open <strong>What to play</strong>, choose an opponent, and save the preparation as a plan. Nothing is
            recorded until you do.
          </p>
        </section>
      ) : (
        <ul className={styles.arsenalList}>
          {rows.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              player={player}
              arsenal={arsenal ?? []}
              open={open === plan.id}
              onToggle={() => setOpen(open === plan.id ? null : plan.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanRow({
  plan,
  player,
  arsenal,
  open,
  onToggle,
}: {
  plan: MatchPlan;
  player: RosterPlayer;
  arsenal: ArsenalDeck[];
  open: boolean;
  onToggle: () => void;
}) {
  const update = useCoachPlans((s) => s.update);
  const remove = useCoachPlans((s) => s.remove);
  const setDeck = useCoachPlans((s) => s.setDeck);
  const clearDeck = useCoachPlans((s) => s.clearDeck);
  const [picking, setPicking] = useState<PlanSlot | null>(null);
  const [notes, setNotes] = useState(plan.notes ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof PlanError ? e.message : 'Could not save that change.');
    }
  }

  const gap = planGap(plan);

  return (
    <li className={styles.arsenalItem} data-archived={plan.status === 'closed' || undefined}>
      <button type="button" className={styles.planHead} aria-expanded={open} onClick={onToggle}>
        <span className={styles.arsenalMeta}>
          <span className={styles.deckName}>
            {playerLabel(player)} against {planLabel(plan)}
          </span>
          <span className={styles.muted}>
            {STATUS_LABEL[plan.status]} · made {ago(plan.createdAt)}
            {plan.engine ? ` · ranked over ${plan.engine.days} days` : ''}
            {plan.recommendations.length ? ` · ${plan.recommendations.length} candidates frozen` : ''}
          </span>
        </span>
        <span className={styles.tagRow}>
          {plan.testMode && <span className={styles.tagChip}>Test</span>}
          {PLAN_SLOTS.map((slot) => {
            const d = deckInSlot(plan, slot);
            return (
              <span key={slot} className={styles.tagChip} data-role={slot === 'primary' && d ? true : undefined}>
                {SLOT_LABEL[slot]}: {d ? (d.name ?? 'set') : '—'}
              </span>
            );
          })}
        </span>
      </button>

      {open && (
        <div className={styles.arsenalDetail}>
          {/* THE THREE SLOTS. Each says what it is for: three unexplained
              boxes are three guesses. */}
          {PLAN_SLOTS.map((slot) => {
            const deck = deckInSlot(plan, slot);
            return (
              <div key={slot} className={styles.slotBlock}>
                <div className={styles.blockHead}>
                  <h4 className={styles.blockTitle}>{SLOT_LABEL[slot]}</h4>
                  <span className={styles.muted}>{SLOT_HELP[slot]}</span>
                </div>
                {deck ? (
                  <div className={styles.scoutDeck}>
                    <div className={styles.deckCards}>
                      {deck.cards.map((c) => (
                        <CardArt key={c} card={c} className={styles.deckCard} />
                      ))}
                    </div>
                    <div className={styles.arsenalMeta}>
                      <span className={styles.deckName}>{deck.name ?? 'Deck'}</span>
                      <span className={styles.muted}>{PLAN_SOURCE_LABEL[deck.source]}</span>
                      <span className={styles.controlRow}>
                        <DeckActions cards={deck.cards} name={deck.name ?? 'Deck'} />
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => setPicking(picking === slot ? null : slot)}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => void run(() => clearDeck(player.id, plan.id, slot))}
                        >
                          Clear
                        </button>
                      </span>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setPicking(picking === slot ? null : slot)}
                  >
                    Choose the {SLOT_LABEL[slot].toLowerCase()} deck
                  </button>
                )}

                {picking === slot && (
                  <DeckPicker
                    plan={plan}
                    arsenal={arsenal}
                    onPick={(cards, name, source, sourceRef) =>
                      void run(async () => {
                        await setDeck(player.id, plan.id, { slot, cards, source, sourceRef, name });
                        setPicking(null);
                      })
                    }
                    onCancel={() => setPicking(null)}
                  />
                )}
              </div>
            );
          })}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Plan notes</span>
            <textarea
              className={styles.textarea}
              value={notes}
              rows={3}
              placeholder="What to watch for, when to switch…"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (plan.notes ?? '') && void run(() => update(player.id, plan.id, { notes }))}
            />
          </label>

          {gap && <p className={styles.hint}>{gap}</p>}
          {error && <p className={styles.formError}>{error}</p>}

          <div className={styles.controlRow}>
            {canConfirm(plan) && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void run(() => update(player.id, plan.id, { status: 'confirmed' }))}
              >
                Confirm plan
              </button>
            )}
            {plan.status === 'confirmed' && (
              <span className={styles.muted}>
                Confirmed {plan.confirmedAt ? ago(plan.confirmedAt) : ''} — the result belongs to a later phase.
              </span>
            )}
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void run(() => update(player.id, plan.id, { testMode: !plan.testMode }))}
            >
              {plan.testMode ? 'Mark as real coaching' : 'Mark as a test'}
            </button>
            {!confirmRemove ? (
              <button type="button" className={styles.dangerGhost} onClick={() => setConfirmRemove(true)}>
                Delete plan…
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void run(() => remove(player.id, plan.id))}
                >
                  Confirm delete plan
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </>
            )}
          </div>

          <FrozenSnapshot plan={plan} />
        </div>
      )}
    </li>
  );
}

/** Choose what goes in a slot: one of the frozen candidates, or a deck from
 *  the arsenal as it stands today. Both carry their source into the plan. */
function DeckPicker({
  plan,
  arsenal,
  onPick,
  onCancel,
}: {
  plan: MatchPlan;
  arsenal: ArsenalDeck[];
  onPick: (cards: string[], name: string, source: PlanCandidate['source'], sourceRef: unknown) => void;
  onCancel: () => void;
}) {
  const active = arsenal.filter((d) => d.status === 'active');
  return (
    <div className={styles.pickerBox}>
      <div className={styles.blockHead}>
        <h4 className={styles.blockTitle}>Pick a deck</h4>
        <button type="button" className={styles.ghostButton} onClick={onCancel}>
          Cancel
        </button>
      </div>

      {plan.recommendations.length > 0 && (
        <>
          <p className={styles.muted}>From what was on screen when this plan was made:</p>
          <ul className={styles.metList}>
            {plan.recommendations.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <button
                  type="button"
                  className={styles.metRow}
                  onClick={() =>
                    onPick(c.cards, c.name, c.source, {
                      kind: 'plan_snapshot',
                      expectedWinRate: c.expectedWinRate,
                      spreadCovered: c.spreadCovered,
                    })
                  }
                >
                  <span className={styles.metName}>{c.name}</span>
                  <span className={styles.muted}>
                    {PLAN_SOURCE_LABEL[c.source]}
                    {c.expectedWinRate !== null ? ` · expected ${c.expectedWinRate.toFixed(1)}%` : ' · never scored'}
                  </span>
                  <span className={styles.rowLink}>Use →</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={styles.muted}>From their arsenal as it stands now:</p>
      {active.length === 0 ? (
        <p className={styles.muted}>Nothing is approved for them yet.</p>
      ) : (
        <ul className={styles.metList}>
          {active.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={styles.metRow}
                onClick={() => onPick(d.cards, deckLabel(d), 'arsenal', { kind: 'arsenal_deck', deckId: d.id })}
              >
                <span className={styles.metName}>{deckLabel(d)}</span>
                <span className={styles.muted}>
                  {d.comfort ? `comfort ${d.comfort}/5` : 'comfort not rated'}
                  {d.tags.length ? ` · ${d.tags.join(', ')}` : ''}
                </span>
                <span className={styles.rowLink}>Use →</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the screen was showing when the plan was made — the reason the plan
 *  is still readable in a month. */
function FrozenSnapshot({ plan }: { plan: MatchPlan }) {
  const [show, setShow] = useState(false);
  if (!plan.recommendations.length) return null;
  return (
    <div className={styles.slotBlock}>
      <button type="button" className={styles.ghostButton} aria-expanded={show} onClick={() => setShow(!show)}>
        {show ? 'Hide' : 'Show'} what was recommended when this plan was made ({plan.recommendations.length})
      </button>
      {show && (
        <>
          {plan.engine && (
            <p className={styles.muted}>
              Ranked by <code>{plan.engine.name}</code> over {plan.engine.days} days against{' '}
              {plan.engine.opponentTag}, {ago(plan.engine.at)}. Figures below are as they were then — the engines move
              on.
            </p>
          )}
          <ul className={styles.metList}>
            {plan.recommendations.map((c, i) => (
              <li key={`${c.name}-${i}`} className={styles.metRow}>
                <span className={styles.metName}>{c.name}</span>
                <span className={styles.muted}>
                  {PLAN_SOURCE_LABEL[c.source]}
                  {c.expectedWinRate !== null ? ` · expected ${c.expectedWinRate.toFixed(1)}%` : ' · never scored'}
                  {c.spreadCovered !== null ? ` · covered ${c.spreadCovered.toFixed(0)}%` : ''}
                  {c.played !== null ? ` · played ${c.played}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
