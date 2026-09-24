import { useState } from 'react';

import { fetchFieldPlan, type FieldPlan } from '../../../state/analyticsClient';
import { coachHref, playerLabel, type RosterPlayer } from '../../../state/coachRoster';
import { todayRow, todaySummary, type TodayRow } from '../../../state/coachToday';
import { CardArt } from '../../Analytics/CardArt';
import { drawnDeck } from '../../../utils/deckSeating';
import { ChartCard, DashBadge } from '../../ui/bionis-dashboard';
import styles from './CoachRoster.module.css';

/**
 * THE ROSTER'S DAY — one line per active player, on demand.
 *
 * IT IS A BUTTON, NOT A LOAD, AND THAT IS THE ROSTER'S OWN CONTRACT.
 * `coachOverview.ts` states that nothing on this screen reads the analytics
 * API, because a summary that scans per player puts an expensive read behind a
 * screen nobody asked to be expensive. That still holds: a coach who wants the
 * day's plans presses for them. Measured live — five brief plans in parallel,
 * 2.4 s, 8.8 kB each against 38.9 kB full.
 *
 * EVERY ROW SAYS WHICH KIND OF PLAN IT IS. The weighting usually moves the
 * ORDER rather than the SET (0 to 1 of 7 picks, measured across this roster),
 * so 'weighted' is not 'tailored' and the two are counted apart. Rendering
 * them identically would turn an honest engine into a claim it never made.
 * The rules are `state/coachToday.ts`, pure, 12 tests.
 *
 * ROSTER ORDER, NEVER SORTED BY HOW TAILORED A PLAN IS. Attention is a flag on
 * a row; re-ordering players by a plan's shape invites exactly the comparison
 * this data cannot support.
 */
export function TodayBoard({ players }: { players: RosterPlayer[] }) {
  const active = players.filter((p) => p.isActive);
  const [rows, setRows] = useState<TodayRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  async function load() {
    setBusy(true);
    const started = Date.now();
    /* ALL AT ONCE. The server does no database work per candidate, so these
       parallelise; one at a time would be five times the wait for the same
       answer. A refusal is a row, not a thrown board — `allSettled`, and a
       failed plan becomes the 'failed' kind rather than vanishing. */
    const settled = await Promise.allSettled(
      active.map((p) => fetchFieldPlan(p.playerTag, { days: 30, brief: true })),
    );
    setRows(
      active.map((p, i) => {
        const r = settled[i];
        const plan = r.status === 'fulfilled' ? (r.value as FieldPlan) : null;
        return todayRow(p.playerTag, playerLabel(p), plan);
      }),
    );
    setMs(Date.now() - started);
    setBusy(false);
  }

  const sum = rows ? todaySummary(rows) : null;

  return (
    <ChartCard
      title="Today"
      note={
        sum
          ? sum.line
          : 'What each active player should practise against the current field. Not loaded until you ask — this reads the analytics service once per player.'
      }
      badge={rows ? `${active.length} player${active.length === 1 ? '' : 's'}${ms ? ` · ${(ms / 1000).toFixed(1)}s` : ''}` : undefined}
    >
      {!rows ? (
        <div className={styles.controlRow}>
          <button type="button" className={styles.primaryButton} disabled={busy || active.length === 0} onClick={() => void load()}>
            {busy ? 'Working out the day…' : `Work out today’s plans`}
          </button>
          {active.length === 0 && <span className={styles.muted}>No active players on the roster.</span>}
        </div>
      ) : (
        <>
          <ul className={styles.deckList}>
            {rows.map((r) => (
              <li key={r.tag} className={styles.deckItem}>
                <div className={styles.deckItemHead} style={{ cursor: 'default' }}>
                  {r.pick && r.pick.cards.length > 0 ? (
                    <div className={styles.deckCards}>
                      {/* `drawnDeck`, not a raw `art` lookup: the pick carries
                          the art the SERVER seated (`plan()` runs every row
                          through `deck_counter.seater()`) and this falls back
                          to the capability seating when it does not. Dropping
                          it entirely — which is what this did — drew every
                          card in its base form, so an evolution, a hero and a
                          champion in slots 0/1/2 rendered as plain cards. */}
                      {(() => {
                        const d = drawnDeck(r.pick.cards, r.pick.art, r.pick.artInferred);
                        return d.cards.map((c) => (
                          <CardArt
                            key={c}
                            card={c}
                            variant={d.art[c]}
                            inferred={d.inferred}
                            className={styles.deckCard}
                          />
                        ));
                      })()}
                    </div>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                  <span className={styles.deckFigures}>
                    <span className={styles.deckName}>
                      <a className={styles.rowLink} href={coachHref(r.tag, 'practise')}>
                        {r.label}
                      </a>{' '}
                      <DashBadge>{KIND_LABEL[r.kind]}</DashBadge>
                    </span>
                    <span>
                      {r.pick ? (
                        <>
                          <strong>{r.pick.name}</strong> · {r.pick.expectedWinRate.toFixed(1)}% expected
                        </>
                      ) : (
                        'No plan today'
                      )}
                    </span>
                    <span className={styles.muted}>{r.note}</span>
                    {r.workOn.length > 0 && (
                      <span className={styles.muted}>Weighted toward {r.workOn.join(', ')}</span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.controlRow}>
            <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => void load()}>
              {busy ? 'Working…' : 'Work them out again'}
            </button>
          </div>
        </>
      )}
    </ChartCard>
  );
}

/* Four words, and they are not interchangeable — see `coachToday.ts`. */
const KIND_LABEL = {
  tailored: 'From their record',
  ordered: 'Re-ordered by their record',
  field: 'The field alone',
  new: 'Not collected yet',
  failed: 'Could not read',
} as const;
