import { useEffect, useMemo, useState } from 'react';

import { useAccess } from '../../../state/gate';
import { useAccountStore } from '../../../state/accountStore';
import { isSupabaseConfigured } from '../../../state/supabase';
import {
  COACH_ROUTE,
  coachHref,
  parseCoachRoute,
  playerLabel,
  type CoachWindow,
} from '../../../state/coachRoster';
import { useCoachRoster } from '../../../state/coachRosterStore';
import { ThemeToggle } from '../../Theme/ThemeToggle';
import { Dropdown } from '../../ui/dropdown-menu-14';
import { TeamIcon } from '../../Dashboard/icons';
import { AddPlayerDialog } from './AddPlayerDialog';
import { PlayerWorkspace } from './PlayerWorkspace';
import { RosterOverview } from './RosterOverview';
import styles from './CoachRoster.module.css';

/**
 * COACH ROSTER — `#/admin/coach`. Phase 1: the roster, the switcher, and a
 * basic profile for the selected player.
 *
 * ADMIN-ONLY, AND THE DATABASE IS WHAT MAKES IT SO. The refusal below is a
 * courtesy — the roster lives in `coach_players`, whose Row Level Security
 * answers only an admin and only with that admin's own rows (verified row by
 * row in `supabase/004_coach_roster_verify.sql`). Everything else on the page
 * is the existing public analytics, which answers for any tag anyway.
 *
 * A ROUTE OF ITS OWN, LIKE THE CONSOLE, not a Dashboard section: it is not one
 * player's analytics, and it has no place in the public rail. Lazy, so the
 * public bundle never carries it.
 *
 * THE URL IS THE SELECTION. `#/admin/coach/<TAG>/<section>` — a refresh keeps
 * the player and the section, and switching player keeps the section. There
 * are only the sections that exist: Phase 2 adds Battles, Decks, Cards and
 * Opponents, and later phases add theirs rather than shipping placeholders
 * that promise screens which do not exist yet.
 */

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function CoachRoster() {
  const access = useAccess();
  /* WAIT FOR THE ACCOUNT TO RESOLVE BEFORE JUDGING IT. `ready` turns true as
     soon as the session is read — BEFORE the profile arrives — and `tier`
     defaults to 'free' until it does, so an admin would otherwise be told
     "not your roster" for a beat on every load. Resolved means: signed out,
     or signed in with the profile loaded. */
  const accountReady = useAccountStore((s) => s.ready);
  const userId = useAccountStore((s) => s.userId);
  const profile = useAccountStore((s) => s.profile);
  const resolved = !isSupabaseConfigured || (accountReady && (!userId || profile !== null));
  const hash = useHash();
  const { players, loaded, loading, error, repoKind, load } = useCoachRoster();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  /* The window lives HERE, above the workspace, so it survives switching
     player: Rahul at 90 days, then Arjun, is still 90 days. */
  const [win, setWin] = useState<CoachWindow>(30);

  useEffect(() => {
    if (access === 'admin') void load();
  }, [access, load]);

  const { tag, section, arg } = parseCoachRoute(hash);
  const active = useMemo(() => players.filter((p) => p.isActive), [players]);
  const archived = useMemo(() => players.filter((p) => !p.isActive), [players]);
  const selected = players.find((p) => p.playerTag === tag) ?? null;

  /* THE BARE ROUTE IS THE ROSTER OVERVIEW NOW. It used to jump to the first
     active player, because an empty frame was the only alternative; there is
     a real screen there since phase 8, and jumping past it would hide the one
     view that answers "where is the work". */

  if (!resolved) {
    return (
      <section className={styles.page}>
        <p className={styles.muted}>Checking your account…</p>
      </section>
    );
  }

  if (access !== 'admin') {
    return (
      <section className={styles.denied}>
        <h2>Not your roster</h2>
        <p>
          Coach Roster is an administrator’s tool. Hiding it is a courtesy — the roster itself is
          refused by the database to anyone else, so there is nothing here to find.
        </p>
        <a className={styles.linkButton} href="#/">
          Back to Deckkies
        </a>
      </section>
    );
  }

  const go = (t: string) => {
    window.location.hash = coachHref(t, section);
  };

  return (
    <section className={styles.page}>
      <header className={styles.top}>
        <a className={styles.back} href="#/admin">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Console
        </a>
        <h1 className={styles.title}>Coach Roster</h1>
        {/* Admin-only, so only admins ever see it: this is a working tool on
            real players, still being built phase by phase. */}
        <span className={styles.experimental}>🧪 Experimental</span>
        <div className={styles.topActions}>
          <ThemeToggle size="1.8rem" />
        </div>
      </header>

      {repoKind === 'memory' && (
        <p className={styles.previewBanner}>
          Local preview: Supabase is not configured in this checkout, so this roster lives in memory
          and is gone on reload. In production it is saved to your account.
        </p>
      )}
      {error && <p className={styles.formError}>{error}</p>}

      <div className={styles.body}>
        <aside className={styles.roster} aria-label="My players">
          <div className={styles.rosterHead}>
            {/* The way back to the whole roster. Without it, opening a player
                is a one-way door: the sidebar lists players and nothing on
                the screen points at the overview. */}
            <a className={styles.rosterTitle} href={COACH_ROUTE} aria-current={!tag ? 'page' : undefined}>
              My players
            </a>
            <span className={styles.rosterCount}>{active.length}</span>
          </div>

          {loading && !loaded && <p className={styles.muted}>Loading the roster…</p>}

          <ul className={styles.rosterList}>
            {active.map((p) => (
              <RosterItem key={p.id} label={playerLabel(p)} tag={p.playerTag} on={p.playerTag === tag} onPick={() => go(p.playerTag)} />
            ))}
          </ul>

          <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
            + Add player
          </button>

          {archived.length > 0 && (
            <div className={styles.archivedWrap}>
              <button
                type="button"
                className={styles.archivedToggle}
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
              </button>
              {showArchived && (
                <ul className={styles.rosterList}>
                  {archived.map((p) => (
                    <RosterItem key={p.id} label={playerLabel(p)} tag={p.playerTag} on={p.playerTag === tag} onPick={() => go(p.playerTag)} dim />
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>

        <main className={styles.main}>
          {/* THE SWITCHER ON A NARROW SCREEN, where the sidebar goes. The
              shared Dropdown, searchable once the roster is long enough to
              want finding in. */}
          {players.length > 0 && (
            <div className={styles.switcher}>
              <Dropdown
                className={styles.switcherDropdown}
                caption="Current player"
                icon={<TeamIcon />}
                heading="My players"
                searchable={players.length > 8}
                value={selected?.playerTag ?? ''}
                onChange={(t) => t && go(t)}
                options={[
                  ...(selected ? [] : [{ value: '', label: 'Choose a player' }]),
                  ...players.map((p) => ({
                    value: p.playerTag,
                    label: playerLabel(p),
                    description: p.displayName ? p.playerTag : undefined,
                    group: p.isActive ? 'Active' : 'Archived',
                  })),
                ]}
              />
              <button type="button" className={styles.ghostButton} onClick={() => setAdding(true)}>
                + Add
              </button>
            </div>
          )}

          {loaded && players.length === 0 && (
            <section className={styles.empty}>
              <h2>Your roster is empty</h2>
              <p>
                Add the players you coach by their Clash Royale tag. Each one gets their own profile
                here, built from the battles Deckkies already collects — and adding a player also asks
                the collector to start following them.
              </p>
              <button type="button" className={styles.primaryButton} onClick={() => setAdding(true)}>
                + Add your first player
              </button>
            </section>
          )}

          {loaded && tag && !selected && (
            <section className={styles.empty}>
              <h2>{tag} is not on your roster</h2>
              <p>Pick a player on the left, or add this one.</p>
              <a className={styles.linkButton} href={COACH_ROUTE}>
                Back to the roster
              </a>
            </section>
          )}

          {/* No player in the URL: the whole roster, not an empty frame. */}
          {loaded && !tag && <RosterOverview players={players} />}

          {selected && (
            <PlayerWorkspace
              key={selected.id}
              player={selected}
              section={section}
              win={win}
              onWindow={setWin}
              opponent={arg}
            />
          )}
        </main>
      </div>

      {adding && (
        <AddPlayerDialog
          onClose={() => setAdding(false)}
          onAdded={(t) => {
            setAdding(false);
            go(t);
          }}
        />
      )}
    </section>
  );
}

function RosterItem({
  label,
  tag,
  on,
  onPick,
  dim,
}: {
  label: string;
  tag: string;
  on: boolean;
  onPick: () => void;
  dim?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        className={styles.rosterItem}
        data-on={on || undefined}
        data-dim={dim || undefined}
        aria-current={on ? 'true' : undefined}
        onClick={onPick}
      >
        <span className={styles.rosterName}>{label}</span>
        <span className={styles.rosterTag}>{tag}</span>
      </button>
    </li>
  );
}

export default CoachRoster;
