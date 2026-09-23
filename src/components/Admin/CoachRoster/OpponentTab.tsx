import type { CoachIntel } from '../../../state/analyticsClient';
import { playerLabel, type CoachWindow, type RosterPlayer } from '../../../state/coachRoster';
import { AssistTab } from './AssistTab';
import { OpponentChooser } from './OpponentChooser';
import { ScoutTab } from './ScoutTab';
import styles from './CoachRoster.module.css';

/**
 * ONE OPPONENT, BOTH HALVES: what they play, then what to bring against it.
 *
 * SCOUT AND "AGAINST AN OPPONENT" WERE TWO TABS AND ARE ONE (2026-09-24). They
 * asked the same question of the same evidence, both needed the same opponent
 * tag, and both already rendered the SAME `OpponentChooser` — so a coach
 * picked an opponent, read what they play, and then picked the same opponent
 * again on the next tab to be told what to bring. The tag is chosen once now.
 *
 * NEITHER HALF WAS REWRITTEN. `ScoutTab` and `AssistTab` are mounted as they
 * are, only ever with an opponent already chosen, so their own "pick someone"
 * branches are simply never reached on this path. A rewrite of a working file
 * silently drops the fixes that file already carries — this project has paid
 * for that lesson once, in the console summary, and the only thing that caught
 * it was a bundle baseline.
 *
 * THE ORDER IS THE COACH'S ORDER. You read what the other player does before
 * you decide what to answer it with; a recommendation above the evidence it
 * rests on invites the reader to take the recommendation and skip the reason.
 */
export function OpponentTab({
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
  const windowLabel = win === 0 ? 'all stored battles' : `the last ${win} days`;

  if (!opponentTag) {
    return (
      <OpponentChooser
        player={player}
        playerIntel={playerIntel}
        section="opponent"
        windowLabel={windowLabel}
        title="Scout an opponent"
        blurb={`Type a tag, or take somebody ${playerLabel(player)} keeps meeting. You get what that player actually brings, and then what to put in front of it — both read from the same battles.`}
      />
    );
  }

  return (
    <div className={styles.opponentStack}>
      <ScoutTab player={player} playerIntel={playerIntel} win={win} opponentTag={opponentTag} />
      <AssistTab player={player} playerIntel={playerIntel} win={win} opponentTag={opponentTag} />
    </div>
  );
}
