import { useEffect, useState } from 'react';

import {
  AnalyticsError,
  fetchCoachIntel,
  fetchPlayerReport,
  isLiveReport,
  type CoachIntel,
  type PlayerReport,
} from '../../../state/analyticsClient';
import { coachHref, playerLabel, windowDays, type CoachWindow, type RosterPlayer } from '../../../state/coachRoster';
import { battleTimeToIso } from '../../../state/coachRoster';
import { coachToken } from '../../../state/coachToken';
import {
  deckRate,
  evidenceNote,
  h2hRate,
  headToHead,
  leadArchetype,
  scoutBasis,
  scoutDecks,
  type ScoutDeck,
} from '../../../state/coachScout';
import { ago } from '../../../utils/format';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../../Analytics/ReadingState';
import { FormStrip, ShareBars } from './IntelCharts';
import { OpponentChooser } from './OpponentChooser';
import { Tile } from './PlayerOverview';
import styles from './CoachRoster.module.css';

/**
 * THE OPPONENT SCOUT — what the person on the other side actually does.
 *
 * IT READS AND STORES NOTHING. No table, no migration: what a coach concludes
 * about an opponent belongs to the match plan they write next (phase 6), not
 * to a cache of other people's habits. Everything here is fetched when the
 * screen is opened and forgotten when it closes.
 *
 * TWO FOOTINGS, SAID OUT LOUD, because a scouted opponent is usually not on
 * the roster and the difference decides how much weight the coach should put
 * on any of it:
 *
 *   STORED  the collector has their history — the same own-deck 1v1 counting
 *           every other figure in this workspace uses.
 *   LIVE    nobody has collected them, so this is the ~25 battles the game
 *           will hand back right now. A snapshot of this week, not a record.
 *
 * `scoutBasis` decides which, and the badge and the evidence line both come
 * from it. An empty list is never allowed to imply "they play nothing".
 *
 * HEAD TO HEAD IS THE ROSTER PLAYER'S RECORD, and every label says whose. The
 * one misreading that would matter here is taking the opponent's overall win
 * rate for how they do against YOUR player, so the two figures are never
 * shown as a bare pair of percentages.
 */

export function ScoutTab({
  player,
  playerIntel,
  win,
  opponentTag,
}: {
  player: RosterPlayer;
  /** The roster player's own intelligence — the only thing that can say how
   *  they have done against this opponent. */
  playerIntel: CoachIntel | null;
  win: CoachWindow;
  opponentTag?: string | null;
}) {
  const [intel, setIntel] = useState<CoachIntel | null>(null);
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* TWO READS, TRACKED SEPARATELY. Waiting for both before drawing anything
     makes the scout as slow as its slower half — and for a tag nobody has
     collected, the profile read goes out to the game's own API and can take
     tens of seconds. The stored intelligence is what this screen is about, so
     whichever answers first is drawn and the other fills in behind it. */
  const [pending, setPending] = useState({ intel: false, report: false });

  const windowLabel = win === 0 ? 'all stored battles' : `the last ${win} days`;

  useEffect(() => {
    if (!opponentTag) {
      setIntel(null);
      setReport(null);
      setError(null);
      return;
    }
    let live = true;
    const days = windowDays(win);
    setError(null);
    setIntel(null);
    setReport(null);
    setPending({ intel: true, report: true });
    let intelFailed = false;
    let reportFailed = false;
    const settle = (which: 'intel' | 'report') => {
      if (!live) return;
      setPending((p) => {
        const next = { ...p, [which]: false };
        /* Only when BOTH have failed is there nothing to show. Either one
           alone is a scout: stored history without a profile, or a live
           battlelog for somebody the collector has never seen. */
        if (!next.intel && !next.report && intelFailed && reportFailed) {
          setError('Nothing could be read for that tag — neither stored history nor a live battlelog.');
        }
        return next;
      });
    };
    void (async () => {
      const token = await coachToken();
      fetchCoachIntel(opponentTag, { days }, token)
        .then((i) => live && setIntel(i))
        .catch((e) => {
          intelFailed = true;
          // A refusal from the admin gate is worth saying; a 404 for a tag
          // with no history is not an error, it is the answer.
          if (e instanceof AnalyticsError && e.kind !== 'not_found') setError(e.message);
        })
        .finally(() => settle('intel'));
      fetchPlayerReport(opponentTag, { days })
        .then((r) => live && setReport(r))
        .catch(() => {
          reportFailed = true;
        })
        .finally(() => settle('report'));
    })();
    return () => {
      live = false;
    };
  }, [opponentTag, win]);

  if (!opponentTag) {
    return (
      <OpponentChooser
        player={player}
        playerIntel={playerIntel}
        section="opponent"
        windowLabel={windowLabel}
        title="Scout an opponent"
        blurb="What the person on the other side actually plays, read from the same battles as everything else here. Nothing is saved — the preparation you write from it belongs to a match plan."
      />
    );
  }

  if (pending.intel && pending.report) {
    return (
      <ReadingState k="coach-scout" hue="violet">
        Scouting {opponentTag}…
      </ReadingState>
    );
  }

  const basis = scoutBasis(intel, report);
  const decks = scoutDecks(intel, report);
  const h2h = headToHead(playerIntel, opponentTag);
  const lead = leadArchetype(intel);
  const battles = basis === 'stored' ? (intel?.summary.battles ?? 0) : report && isLiveReport(report) ? report.battles : 0;
  const name = intel?.player.name ?? (report && !isLiveReport(report) ? report.player.name : null);
  const tracking = report?.tracking;

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <div className={styles.scoutHead}>
          <div>
            <h3 className={styles.blockTitle}>{name || opponentTag}</h3>
            <span className={styles.playerTag}>{opponentTag}</span>
          </div>
          <div className={styles.controlRow}>
            <a className={styles.linkButton} href={`#/player/${encodeURIComponent(opponentTag)}`}>
              Full analysis →
            </a>
            <a className={styles.ghostButton} href={coachHref(player.playerTag, 'opponent')}>
              Scout someone else
            </a>
          </div>
        </div>

        {/* The badge and the sentence under it are the whole honesty of this
            screen: a live read is this week, not a record. */}
        <div className={styles.sourceRow}>
          <span className={styles.sourceBadge} data-basis={basis === 'live' ? 'live' : undefined}>
            {basis === 'stored' ? 'Stored history' : basis === 'live' ? 'Live snapshot' : 'Nothing stored'}
          </span>
          <span className={styles.sourceNote}>{evidenceNote(basis, battles, windowLabel)}</span>
          {tracking && (
            <span className={styles.trackState} data-state={tracking.state}>
              Collection: {tracking.state}
            </span>
          )}
        </div>

        {error && <p className={styles.formError}>{error}</p>}

        {basis !== 'none' && (
          <div className={styles.tiles}>
            <Tile
              label={basis === 'stored' ? '1v1 battles' : 'Battles in their log'}
              value={String(battles)}
              note={recordNote(intel, report, basis)}
            />
            <Tile label="Their win rate" value={rateOf(intel, report, basis)} note="wins ÷ battles" />
            {lead && (
              <Tile label="Leads with" value={lead.name} note={`${lead.share.toFixed(0)}% of their battles`} />
            )}
          </div>
        )}
      </section>

      {/* HEAD TO HEAD — labelled by name on both sides, so the opponent's own
          win rate above can never be read as their record against us. */}
      <section className={styles.block}>
        <h3 className={styles.blockTitle}>Head to head</h3>
        {!h2h ? (
          <p className={styles.muted}>
            {playerIntel
              ? `${playerLabel(player)} has not met ${name || opponentTag} in ${windowLabel}. That is no record at all, not an even one.`
              : `${playerLabel(player)}’s battles have not been read, so there is no head to head to show.`}
          </p>
        ) : (
          <>
            <div className={styles.tiles}>
              <Tile label="Meetings" value={String(h2h.battles)} note={`in ${windowLabel}`} />
              <Tile
                label={`${playerLabel(player)} won`}
                value={String(h2h.wins)}
                note={`against ${name || opponentTag}`}
              />
              <Tile
                label={`${playerLabel(player)} lost`}
                value={String(h2h.losses)}
                note={h2h.draws ? `${h2h.draws} drawn` : 'no draws'}
              />
              <Tile
                label={`${playerLabel(player)}’s win rate here`}
                value={h2hRate(h2h) !== null ? `${h2hRate(h2h)!.toFixed(1)}%` : '—'}
                note={
                  h2hRate(h2h) !== null
                    ? 'against this opponent only'
                    : `only ${h2h.battles} meetings — too few to rate`
                }
              />
            </div>
            <p className={styles.muted}>Last met {battleTimeToIso(h2h.last) ? ago(battleTimeToIso(h2h.last)!) : '—'}.</p>
          </>
        )}
      </section>

      {basis !== 'none' && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <h3 className={styles.blockTitle}>What they play</h3>
            <span className={styles.muted}>
              {basis === 'stored'
                ? `most-played first · ${intel?.decksTotal ?? 0} deck${(intel?.decksTotal ?? 0) === 1 ? '' : 's'} in ${windowLabel}`
                : 'from their last ~25 battles'}
            </span>
          </div>
          {decks.length === 0 ? (
            <p className={styles.muted}>No complete deck could be read for them.</p>
          ) : (
            <ul className={styles.scoutDecks}>
              {decks.map((d) => (
                <ScoutDeckRow key={d.key} deck={d} />
              ))}
            </ul>
          )}
        </section>
      )}

      {basis === 'stored' && intel && intel.summary.battles > 0 && (
        <div className={styles.shareGrid}>
          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h3 className={styles.blockTitle}>Their win conditions</h3>
              <FormStrip form={intel.form} />
            </div>
            <ShareBars rows={intel.archetypes} total={intel.summary.battles} />
          </section>
          <section className={styles.block}>
            <h3 className={styles.blockTitle}>What they are up against</h3>
            <ShareBars rows={intel.opponentArchetypes} total={intel.summary.battles} />
          </section>
        </div>
      )}
    </div>
  );
}

function ScoutDeckRow({ deck }: { deck: ScoutDeck }) {
  const rate = deckRate(deck);
  const last = deck.last ? battleTimeToIso(deck.last) : null;
  return (
    <li className={styles.scoutDeck}>
      <div className={styles.deckCards}>
        {deck.cards.map((c) => (
          <CardArt key={c} card={c} variant={deck.art?.[c]} inferred={deck.artInferred} className={styles.deckCard} />
        ))}
      </div>
      <div className={styles.arsenalMeta}>
        <span className={styles.deckName}>{deck.name}</span>
        <span className={styles.muted}>
          {deck.battles} battle{deck.battles === 1 ? '' : 's'}
          {/* Withheld under the floor rather than printed off two games. */}
          {rate === null ? ' · too few to rate' : ` · ${rate.toFixed(0)}% won`}
          {last ? ` · last ${ago(last)}` : ''}
        </span>
        <DeckActions cards={deck.cards} name={deck.name} />
      </div>
    </li>
  );
}

/** Their W / L / D, from whichever footing the scout is on. */
function recordNote(intel: CoachIntel | null, report: PlayerReport | null, basis: string): string {
  if (basis === 'stored' && intel) {
    const s = intel.summary;
    return `${s.wins}W · ${s.losses}L${s.draws ? ` · ${s.draws}D` : ''}`;
  }
  if (report && isLiveReport(report)) {
    return `${report.wins}W · ${report.losses}L${report.draws ? ` · ${report.draws}D` : ''}`;
  }
  return '';
}

function rateOf(intel: CoachIntel | null, report: PlayerReport | null, basis: string): string {
  if (basis === 'stored' && intel && intel.summary.battles > 0) {
    return `${((intel.summary.wins / intel.summary.battles) * 100).toFixed(1)}%`;
  }
  if (report && isLiveReport(report) && report.battles > 0) return `${report.winRate.toFixed(1)}%`;
  return '—';
}
