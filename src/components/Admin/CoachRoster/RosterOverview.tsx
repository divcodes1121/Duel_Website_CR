import { useEffect, useMemo } from 'react';

import { coachHref, playerLabel, type RosterPlayer } from '../../../state/coachRoster';
import {
  FLAG_ACTION,
  FLAG_LABEL,
  ROSTER_RATE_FLOOR,
  sortOverview,
  totals,
  type OverviewRow,
} from '../../../state/coachOverview';
import { useCoachOverview } from '../../../state/coachOverviewStore';
import { ago } from '../../../utils/format';
import { ReadingState } from '../../Analytics/ReadingState';
import { Tile } from './PlayerOverview';
import styles from './CoachRoster.module.css';

/**
 * THE WHOLE ROSTER AT ONCE — what a coach opens first.
 *
 * A coach with eight players cannot open eight workspaces to find where the
 * work is. This looks across all of them and answers one question: what
 * should I do next?
 *
 * IT COUNTS; IT DOES NOT RANK. Every column is something the coach did or did
 * not do — decks approved, plans drafted, matches recorded — and the order is
 * the roster's own, so this screen and the rail never disagree about where
 * somebody is. A readiness score would invite comparing eight people with
 * eight different amounts of stored history, which is exactly the comparison
 * the data cannot support.
 *
 * EVERY FLAG IS A FACT WITH AN ACTION. "No deck approved yet" names a state
 * and says where to fix it; none of them is a remark about the player. A flag
 * with no action is a nag.
 *
 * IT READS NO ANALYTICS. Three queries over the coach's own tables, minimal
 * columns, no card art and no battle history — the workspace answers that
 * properly for one player, and doing it for eight behind a summary screen
 * would make the cheapest-looking page the most expensive.
 */

export function RosterOverview({ players }: { players: RosterPlayer[] }) {
  const rows = useCoachOverview((s) => s.rows);
  const loading = useCoachOverview((s) => s.loading);
  const error = useCoachOverview((s) => s.error);
  const load = useCoachOverview((s) => s.load);

  useEffect(() => {
    void load(players);
  }, [players, load]);

  const sorted = useMemo(() => (rows ? sortOverview(rows) : []), [rows]);
  const sum = useMemo(() => (rows ? totals(rows) : null), [rows]);

  if (!rows && loading) {
    return (
      <ReadingState k="coach-overview" hue="violet">
        Reading your roster…
      </ReadingState>
    );
  }

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>Your roster</h2>
          <span className={styles.muted}>counts of your own preparation — nothing here is a rating of a player</span>
        </div>
        {error && <p className={styles.formError}>{error}</p>}
        {sum && (
          <div className={styles.tiles}>
            <Tile label="Players" value={String(sum.players)} note="active on the roster" />
            <Tile label="With an arsenal" value={`${sum.withArsenal} of ${sum.players}`} note="have a deck approved" />
            <Tile label="Plans in draft" value={String(sum.openPlans)} note="not confirmed yet" />
            <Tile
              label="Needing something"
              value={String(sum.needingAttention)}
              note={sum.needingAttention === 0 ? 'nothing outstanding' : 'see the flags below'}
            />
          </div>
        )}
      </section>

      {sorted.length === 0 ? (
        <section className={styles.notice}>
          <h3>No players yet</h3>
          <p>Add a player on the left to start.</p>
        </section>
      ) : (
        <ul className={styles.arsenalList}>
          {sorted.map((row) => (
            <RosterRow key={row.player.id} row={row} />
          ))}
        </ul>
      )}

      <p className={styles.muted}>
        Win rates appear once a player has {ROSTER_RATE_FLOOR} recorded matches — the same floor the Results screen
        applies, so the two can never disagree. Test plans and test results are left out everywhere.
      </p>
    </div>
  );
}

function RosterRow({ row }: { row: OverviewRow }) {
  const { player } = row;
  return (
    <li className={styles.arsenalItem} data-archived={!player.isActive || undefined}>
      <div className={styles.rosterRow}>
        <a className={styles.rosterLink} href={coachHref(player.playerTag, 'overview')}>
          <span className={styles.deckName}>{playerLabel(player)}</span>
          <span className={styles.oppTag}>{player.playerTag}</span>
          {!player.isActive && <span className={styles.archivedBadge}>Archived</span>}
        </a>

        <span className={styles.rosterFigures}>
          <CountLink player={player} section="arsenal" n={row.arsenal} one="deck" many="decks" />
          <CountLink player={player} section="plans" n={row.plans} one="plan" many="plans" />
          <CountLink player={player} section="results" n={row.results} one="match" many="matches" />
          <span className={styles.muted}>
            {row.winRate === null
              ? row.results
                ? `${row.wins} won — too few to rate`
                : 'nothing recorded'
              : `${row.winRate.toFixed(0)}% won`}
          </span>
          <span className={styles.muted}>
            {row.lastActivity ? `last touched ${ago(row.lastActivity)}` : 'no activity yet'}
          </span>
        </span>
      </div>

      {row.flags.length > 0 && (
        <ul className={styles.flagList}>
          {row.flags.map((f) => (
            /* The flag names what is true; the action says where to fix it.
               Both, or neither. */
            <li key={f} className={styles.flagRow}>
              <span className={styles.flagLabel}>{FLAG_LABEL[f]}</span>
              <span className={styles.muted}>{FLAG_ACTION[f]}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* BOTH FORMS ARE PASSED IN. Appending an "s" produced "0 matchs" — English
   plurals are not a rule this component gets to invent. */
function CountLink({
  player,
  section,
  n,
  one,
  many,
}: {
  player: RosterPlayer;
  section: 'arsenal' | 'plans' | 'results';
  n: number;
  one: string;
  many: string;
}) {
  return (
    <a className={styles.rowLink} href={coachHref(player.playerTag, section)}>
      {n} {n === 1 ? one : many}
    </a>
  );
}
