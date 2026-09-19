import { useEffect, useState } from 'react';

import {
  battleTimeToIso,
  playerLabel,
  NAME_MAX,
  NOTES_MAX,
  RosterError,
  type RosterPlayer,
} from '../../../state/coachRoster';
import { useCoachRoster } from '../../../state/coachRosterStore';
import {
  fetchPlayerReport,
  isLiveReport,
  type AnalyticsError,
  type PlayerReport,
} from '../../../state/analyticsClient';
import { ago } from '../../../utils/format';
import { CardArt } from '../../Analytics/CardArt';
import { ReadingState } from '../../Analytics/ReadingState';
import { DeckActions } from '../../DeckActions/DeckActions';
import styles from './CoachRoster.module.css';

const nf = new Intl.NumberFormat('en-US');

/**
 * Phase 1's player view: who they are, where their data stands, their record,
 * and the deck they play most — all read from the existing player report.
 *
 * NOTHING HERE IS COMPUTED THAT THE REPORT DOES NOT ALREADY CARRY. The win
 * rate is `wins / battles`, the same definition Player Analysis prints, so the
 * two screens cannot disagree about one player. A figure the report does not
 * have is left out rather than estimated.
 *
 * STORED OR LIVE, AND IT SAYS WHICH. A tag the collector has not picked up yet
 * answers from the live battlelog (at most ~25 battles), which is a much
 * thinner reading than months of stored history; the badge makes that visible
 * rather than letting 25 battles pass for a record.
 */
export function PlayerOverview({ player }: { player: RosterPlayer }) {
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    fetchPlayerReport(player.playerTag)
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e as AnalyticsError));
    return () => {
      live = false;
    };
  }, [player.playerTag]);

  return (
    <div className={styles.overview}>
      <PlayerHeader player={player} report={report} />
      <CoachControls player={player} />

      {!report && !error && (
        <ReadingState k="player" hue="violet">
          Reading {playerLabel(player)}’s record…
        </ReadingState>
      )}

      {error && (
        <section className={styles.notice}>
          <h3>{error.kind === 'offline' ? 'Analytics service is not running' : 'No data for this tag yet'}</h3>
          <p>
            {error.kind === 'offline'
              ? error.message
              : 'Neither stored history nor the live battlelog has anything for this tag. If it was just added, collection has been requested — stored battles appear after the collector’s next pass.'}
          </p>
        </section>
      )}

      {report && <PlayerRecord report={report} />}
    </div>
  );
}

function PlayerHeader({ player, report }: { player: RosterPlayer; report: PlayerReport | null }) {
  const inGame = report?.profile?.name ?? (report && !isLiveReport(report) ? report.player.name : null);
  const label = playerLabel(player);
  return (
    <header className={styles.playerHead}>
      <div className={styles.playerIdentity}>
        <h2 className={styles.playerName}>{label}</h2>
        <span className={styles.playerTag}>{player.playerTag}</span>
        {/* The in-game name, when the coach calls them something else — the
            one place both names are side by side. */}
        {inGame && inGame !== label && <span className={styles.inGame}>in game: {inGame}</span>}
        {!player.isActive && <span className={styles.archivedBadge}>Archived</span>}
      </div>
      <a className={styles.linkButton} href={`#/player/${encodeURIComponent(player.playerTag)}`}>
        Full player analysis →
      </a>
    </header>
  );
}

function PlayerRecord({ report }: { report: PlayerReport }) {
  const p = report.profile;
  const live = isLiveReport(report);

  const battles = live ? report.battles : report.player.battles;
  const wins = live ? report.wins : report.player.wins;
  const losses = live ? report.losses : report.player.losses;
  const draws = live ? report.draws : report.player.draws;
  const winRate = battles ? (wins / battles) * 100 : null;
  const lastDay = live ? report.span.to : report.coverage.end;
  const firstDay = live ? report.span.from : report.coverage.start;
  const topDeck = report.decks[0];
  const topLast = topDeck ? battleTimeToIso(topDeck.lastSeen) ?? topDeck.lastSeen : null;

  return (
    <>
      <div className={styles.sourceRow}>
        <span className={styles.sourceBadge} data-basis={report.basis}>
          {live ? 'Live battlelog' : 'Stored history'}
        </span>
        <span className={styles.sourceNote}>
          {live
            ? `The collector has not stored this player yet, so this is their last ${nf.format(battles)} battles from Clash Royale directly.`
            : `${nf.format(battles)} battles stored, ${firstDay ?? '—'} to ${lastDay ?? '—'}.`}
        </span>
        <span className={styles.trackState} data-state={report.tracking.state}>
          Collection: {report.tracking.state}
        </span>
      </div>

      <div className={styles.tiles}>
        {p?.rankedTrophies != null && (
          <Tile
            label="Path of Legends"
            value={nf.format(p.rankedTrophies)}
            note={p.rankedRank != null ? `#${nf.format(p.rankedRank)} global` : 'below the leaderboard cut'}
          />
        )}
        {p?.trophies != null && (
          <Tile
            label="Trophy road"
            value={nf.format(p.trophies)}
            note={p.bestTrophies != null ? `best ${nf.format(p.bestTrophies)}` : undefined}
          />
        )}
        <Tile
          label={live ? 'Battles in the log' : 'Battles stored'}
          value={nf.format(battles)}
          note={`${nf.format(wins)}W · ${nf.format(losses)}L${draws ? ` · ${nf.format(draws)}D` : ''}`}
        />
        <Tile label="Win rate" value={winRate == null ? '—' : `${winRate.toFixed(1)}%`} note="wins ÷ battles" />
        <Tile label="Last battle" value={lastDay ?? '—'} note={live ? 'in the live log' : 'latest stored'} />
        {(p?.arena || p?.clan) && <Tile label="Arena · clan" value={p?.arena ?? '—'} note={p?.clan ?? 'no clan'} />}
      </div>

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>Most-played deck</h3>
        {!topDeck ? (
          <p className={styles.muted}>No complete deck in the data yet.</p>
        ) : (
          <div className={styles.deckRow}>
            <div className={styles.deckCards}>
              {topDeck.cards.map((c) => (
                <CardArt key={c} card={c} variant={topDeck.art?.[c]} className={styles.deckCard} />
              ))}
            </div>
            <div className={styles.deckMeta}>
              <span className={styles.deckName}>{topDeck.name}</span>
              <span className={styles.muted}>
                {nf.format(live ? (topDeck as { games: number }).games : (topDeck as { matches: number }).matches)} battles ·{' '}
                {topDeck.winRate.toFixed(1)}% won
                {topLast ? ` · last ${ago(topLast)}` : ''}
              </span>
              <DeckActions cards={topDeck.cards} name={topDeck.name} />
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {note && <span className={styles.tileNote}>{note}</span>}
    </div>
  );
}

/* The coach's own fields — name and notes — plus archive and remove. The
   database refuses anything a non-admin sends; these controls only decide
   what an admin is offered. */
function CoachControls({ player }: { player: RosterPlayer }) {
  const update = useCoachRoster((s) => s.update);
  const remove = useCoachRoster((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.displayName ?? '');
  const [notes, setNotes] = useState(player.notes ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(false);
    setConfirmRemove(false);
    setMessage(null);
    setName(player.displayName ?? '');
    setNotes(player.notes ?? '');
  }, [player.id, player.displayName, player.notes]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof RosterError ? e.message : 'Could not save that change.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.controls}>
      {!editing ? (
        <>
          {player.notes ? (
            <p className={styles.notes}>{player.notes}</p>
          ) : (
            <p className={styles.muted}>No coach notes yet.</p>
          )}
          <div className={styles.controlRow}>
            <button type="button" className={styles.ghostButton} onClick={() => setEditing(true)}>
              Edit name &amp; notes
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={busy}
              onClick={() => void run(() => update(player.id, { isActive: !player.isActive }))}
            >
              {player.isActive ? 'Archive' : 'Restore to roster'}
            </button>
            {!confirmRemove ? (
              <button type="button" className={styles.dangerGhost} onClick={() => setConfirmRemove(true)}>
                Remove…
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.dangerButton}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const outcome = await remove(player.id);
                      setMessage(
                        outcome === 'archived'
                          ? 'This player has match history, so they were archived instead of deleted.'
                          : null,
                      );
                      if (outcome === 'deleted') window.location.hash = '#/admin/coach';
                    })
                  }
                >
                  Confirm remove
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <form
          className={styles.editForm}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await update(player.id, { displayName: name.trim() || null, notes: notes.trim() || null });
              setEditing(false);
            });
          }}
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Display name</span>
            <input
              className={styles.input}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={player.playerTag}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Coach notes</span>
            <textarea
              className={styles.textarea}
              value={notes}
              maxLength={NOTES_MAX}
              rows={4}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className={styles.controlRow}>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && <p className={styles.formError}>{message}</p>}
    </section>
  );
}
