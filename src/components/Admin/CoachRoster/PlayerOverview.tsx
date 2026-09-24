import { useEffect, useState } from 'react';

import {
  playerLabel,
  NAME_MAX,
  NOTES_MAX,
  RosterError,
  type RosterPlayer,
} from '../../../state/coachRoster';
import { useCoachRoster } from '../../../state/coachRosterStore';
import { isLiveReport, type CoachIntel, type PlayerReport } from '../../../state/analyticsClient';
import { CardArt } from '../../Analytics/CardArt';
import styles from './CoachRoster.module.css';


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

/* `PlayerRecord` LIVED HERE AND IS GONE (2026-09-23). Its source row, six
   tiles, hidden-mode note and most-played deck are all drawn by
   `PlayerDashboard` now, from the same `coach_intel` payload. What survives in
   this file is the identity header, the coach's own fields, and the two small
   pieces other tabs share. */

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
  const link = useCoachRoster((s) => s.link);
  const unlink = useCoachRoster((s) => s.unlink);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.displayName ?? '');
  const [notes, setNotes] = useState(player.notes ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [linking, setLinking] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(false);
    setConfirmRemove(false);
    setLinking(false);
    setEmail('');
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
          {/* WHO SIGNS IN AS THIS PLAYER.
              THE LINK IS EXPLICIT AND THE COACH MAKES IT. The obvious design
              was to match `profiles.player_tag`, and it is SPOOFABLE: 001
              grants the profile owner update on that column, so any account
              could type a roster tag into their own profile and be handed
              this player's coaching data. Nothing else on the site cares what
              tag a profile claims, so it has never had to be trustworthy.
              `linked_user_id` is set through `coach_link_player`, which is
              the only door — the column is in no update grant. */}
          <div className={styles.linkRow}>
            <span className={styles.linkState} data-on={player.linkedUserId ? '' : undefined}>
              {player.linkedUserId ? 'Account linked' : 'No account linked'}
            </span>
            <span className={styles.muted}>
              {player.linkedUserId
                ? 'They can sign in and see their own dashboard.'
                : 'Link the account they sign in with to give them their dashboard.'}
            </span>
          </div>

          {linking ? (
            <form
              className={styles.linkForm}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await link(player.id, email.trim());
                  setLinking(false);
                  setEmail('');
                });
              }}
            >
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Their account email</span>
                <input
                  className={styles.input}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="they@example.com"
                />
              </label>
              <div className={styles.controlRow}>
                <button type="submit" className={styles.primaryButton} disabled={busy || !email.trim()}>
                  {busy ? 'Linking…' : 'Link account'}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setLinking(false)}>
                  Cancel
                </button>
              </div>
              <p className={styles.muted}>
                They must have signed up already — the database refuses an address no account uses.
              </p>
            </form>
          ) : null}

          <div className={styles.controlRow}>
            <button type="button" className={styles.ghostButton} onClick={() => setEditing(true)}>
              Edit name &amp; notes
            </button>
            {player.linkedUserId ? (
              <button
                type="button"
                className={styles.ghostButton}
                disabled={busy}
                onClick={() => void run(() => unlink(player.id))}
              >
                Unlink account
              </button>
            ) : (
              <button type="button" className={styles.ghostButton} onClick={() => setLinking(true)}>
                Link account…
              </button>
            )}
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
