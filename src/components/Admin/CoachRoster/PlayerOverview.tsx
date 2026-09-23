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
import { isLiveReport, type CoachIntel, type PlayerReport } from '../../../state/analyticsClient';
import { ago } from '../../../utils/format';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import styles from './CoachRoster.module.css';

const nf = new Intl.NumberFormat('en-US');

/** Battles before the most-played deck's win rate is printed. `ShareBars`
 *  already withholds a rate under the same count, and this block had no floor
 *  at all — live, it printed "1 battles · 100.0% won" as a player's headline
 *  deck at 7d, 30d, 90d AND All. A rate off one battle is not a rate. */
const DECK_RATE_FLOOR = 5;

/* The parts of a roster player's page that are about WHO they are — header,
   record tiles, the coach's own fields. `PlayerWorkspace` composes them with
   the Phase 2 tabs and owns the reads.

   NOTHING HERE IS COMPUTED THAT THE REPORT DOES NOT ALREADY CARRY. The win
   rate is `wins / battles`, the same definition Player Analysis prints, so the
   two screens cannot disagree about one player. STORED OR LIVE, AND IT SAYS
   WHICH: a tag the collector has not picked up yet answers from its live
   battlelog (~25 battles), and a badge stops that passing for a record. */

export function PlayerHeader({ player, report }: { player: RosterPlayer; report: PlayerReport | null }) {
  const inGame = report?.profile?.name ?? (report && !isLiveReport(report) ? report.player.name : null);
  const label = playerLabel(player);
  return (
    <header className={styles.playerHead}>
      <div className={styles.playerIdentity}>
        <h2 className={styles.playerName}>{label}</h2>
        {/* With no display name the heading IS the tag — once is enough. */}
        {label !== player.playerTag && <span className={styles.playerTag}>{player.playerTag}</span>}
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

/* WHO THEY ARE comes from the player report — rank, trophies, clan, whether
   they are being collected. WHAT THEY DID comes from the coach intelligence,
   which counts OWN-DECK 1v1 battles only: the report's own battle count and
   win rate include 2v2 (measured on one player, most of their battles), and
   the tiles here must agree with the Battles, Decks and Opponents tabs beside
   them. Until the intelligence arrives, or if it cannot, those tiles are left
   out rather than filled from the all-mode figures. */
export function PlayerRecord({ report, intel }: { report: PlayerReport; intel: CoachIntel | null }) {
  const p = report.profile;
  const live = isLiveReport(report);
  const s = intel?.summary;
  const winRate = s && s.battles ? (s.wins / s.battles) * 100 : null;
  const lastDay = intel?.timeline.length ? intel.timeline[intel.timeline.length - 1].day : null;
  const topDeck = intel?.decks[0];
  const topLast = topDeck ? battleTimeToIso(topDeck.last) : null;

  return (
    <>
      <div className={styles.sourceRow}>
        <span className={styles.sourceBadge} data-basis={report.basis}>
          {live ? 'Live battlelog' : 'Stored history'}
        </span>
        <span className={styles.sourceNote}>
          {live
            ? 'The collector has not stored this player yet — the figures below fill in once it has.'
            : intel
              ? `Own-deck 1v1 battles, ${intel.window.from ?? '—'} to ${intel.window.to ?? '—'}.`
              : 'Reading their battles…'}
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
        {s && (
          <>
            <Tile
              label="1v1 battles"
              value={nf.format(s.battles)}
              note={`${nf.format(s.wins)}W · ${nf.format(s.losses)}L${s.draws ? ` · ${nf.format(s.draws)}D` : ''}`}
            />
            <Tile label="Win rate" value={winRate == null ? '—' : `${winRate.toFixed(1)}%`} note="wins ÷ battles" />
            <Tile label="Last battle" value={lastDay ?? '—'} note="in this window" />
          </>
        )}
      </div>

      {intel && intel.hidden > 0 && (
        <p className={styles.hiddenNote} title={Object.entries(intel.hiddenByMode).map(([m, n]) => `${m}: ${n}`).join('\n')}>
          {nf.format(intel.hidden)} battles in other modes (2v2, drafts, events) are not counted here — the same
          ones the battle log leaves out.
        </p>
      )}

      {intel && (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>Most-played deck</h3>
          {!topDeck ? (
            <p className={styles.muted}>No complete 1v1 deck in this window.</p>
          ) : (
            <div className={styles.deckRow}>
              <DeckStrip deck={topDeck} />
              <div className={styles.deckMeta}>
                <span className={styles.deckName}>{topDeck.deckName}</span>
                <span className={styles.muted}>
                  {nf.format(topDeck.battles)} battle{topDeck.battles === 1 ? '' : 's'} ·{' '}
                  {topDeck.battles >= DECK_RATE_FLOOR
                    ? `${((topDeck.wins / topDeck.battles) * 100).toFixed(1)}% won`
                    : 'too few to rate'}
                  {topLast ? ` · last ${ago(topLast)}` : ''}
                </span>
                {/* "Most-played" says very little when it leads by one battle
                    over fifteen others, so the spread is stated beside it. */}
                {intel.decksTotal > 1 && topDeck.battles < DECK_RATE_FLOOR && (
                  <span className={styles.muted}>
                    across {nf.format(intel.decksTotal)} decks in this window — no deck has a settled record yet
                  </span>
                )}
                <DeckActions cards={topDeck.cards} name={topDeck.deckName} />
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** Eight cards in one line, with the art the battle log would draw. */
export function DeckStrip({ deck }: { deck: CoachIntel['decks'][number] }) {
  return (
    <div className={styles.deckCards}>
      {deck.cards.map((c) => (
        <CardArt key={c} card={c} variant={deck.art?.[c]} inferred={deck.artInferred} className={styles.deckCard} />
      ))}
    </div>
  );
}

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
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
export function CoachControls({ player }: { player: RosterPlayer }) {
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
