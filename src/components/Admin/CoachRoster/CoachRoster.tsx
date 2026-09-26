import { useEffect, useMemo, useState } from 'react';

import { useIsCoach } from '../../../state/gate';
import { useAccountStore } from '../../../state/accountStore';
import { sectionAllowed, useAccess } from '../../../state/gate';
import { GateCard } from '../../Auth/GateCard';
import { isSupabaseConfigured } from '../../../state/supabase';
import {
  COACH_ROUTE,
  SECTION_LABEL,
  coachHref,
  parseCoachRoute,
  playerLabel,
  type CoachWindow,
  type RosterPlayer,
} from '../../../state/coachRoster';
import { useCoachRoster } from '../../../state/coachRosterStore';
import { DashShell, initialsOf, type ShellGroup, type ShellItem } from '../../ui/dash-shell';
import { GridIcon, PlusIcon } from '../../ui/dash-icons';
import { HomeIcon, ShieldIcon } from '../../Dashboard/icons';
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
 *
 * IN THE DASHBOARD SHELL SINCE 2026-09-26 (`ui/dash-shell.tsx`), like the
 * console and the player's own page: the roster IS the sidebar — Overview,
 * then every active player as an item with an avatar, the archived ones in a
 * folded group — and it opens, minimises to a rail of avatars, and closes.
 * On a phone it is the drawer, which is why the narrow-screen player
 * dropdown that stood in for the old side panel is gone.
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
  /* ADMIN **OR** THE COACH FLAG (007). Coaching is not administering: an
     owner who wants somebody to coach should not have to hand them the
     console to do it. An admin keeps access unconditionally, so the
     console's own link can never point at a screen that refuses them. */
  const mayCoach = useIsCoach();
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
  /* The window lives HERE, above the workspace, so it survives switching
     player: Rahul at 90 days, then Arjun, is still 90 days. */
  const [win, setWin] = useState<CoachWindow>(30);

  useEffect(() => {
    if (mayCoach) void load();
  }, [mayCoach, load]);

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

  /* THE TIER GATE COMES FIRST, and the order is the point. Coach Roster is on
     the top bar now, so anyone can arrive here — and the honest answer to a
     free account is "this is a pro area", not "an administrator has not marked
     you as a coach", which is true but tells them to ask for the wrong thing.
     `GateCard` is the same wall every other pro area shows, so the offer reads
     identically wherever it is met. */
  if (!sectionAllowed(access, 'Coach Roster')) {
    return (
      <section className={styles.page}>
        <GateCard access={access} section="Coach Roster" />
      </section>
    );
  }

  if (!mayCoach) {
    return (
      <section className={styles.denied}>
        <h2>Not your roster</h2>
        <p>
          Coach Roster is for accounts an administrator has marked as a coach. Hiding it is a
          courtesy — the roster itself is
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

  const playerItem = (p: RosterPlayer, dim = false): ShellItem => ({
    id: p.id,
    label: playerLabel(p),
    sub: p.displayName ? p.playerTag : undefined,
    avatar: initialsOf(playerLabel(p)),
    /* Switching player keeps the section, so a coach comparing arsenals
       moves down the roster without re-picking the tab each time. */
    href: coachHref(p.playerTag, section),
    current: p.playerTag === tag,
    dim,
  });

  const groups: ShellGroup[] = [
    {
      id: 'roster',
      label: 'Roster',
      items: [{ id: 'overview', label: 'Overview', icon: <GridIcon />, href: COACH_ROUTE, current: !tag }],
    },
    {
      id: 'players',
      label: `My players · ${active.length}`,
      items: active.map((p) => playerItem(p)),
      after: (
        <button type="button" className="dk-addBtn" onClick={() => setAdding(true)} aria-label="Add player">
          <PlusIcon />
          <span className="dk-addBtnText">Add player</span>
        </button>
      ),
    },
    ...(archived.length > 0
      ? [
          {
            id: 'archived',
            label: `Archived · ${archived.length}`,
            collapsible: true,
            defaultOpen: archived.some((p) => p.playerTag === tag),
            items: archived.map((p) => playerItem(p, true)),
          },
        ]
      : []),
    {
      id: 'tools',
      label: 'Tools',
      items: [
        /* The console is an ADMIN's screen; a coach who is not one would be
           sent to a refusal, so the link is only drawn for an admin. */
        ...(access === 'admin'
          ? [{ id: 'console', label: 'Console', icon: <ShieldIcon size={18} />, href: '#/admin' }]
          : []),
        { id: 'home', label: 'Back to Deckkies', icon: <HomeIcon size={18} />, href: '#/' },
      ],
    },
  ];

  return (
    <>
      <DashShell
        id="coach"
        product="Coach Roster"
        title={selected ? playerLabel(selected) : 'Roster overview'}
        subtitle={
          selected
            ? `${selected.playerTag} · ${SECTION_LABEL[section]}`
            : 'Counts of your own preparation. Nothing here is a rating of a player.'
        }
        badge="Experimental"
        groups={groups}
        banner={
          <>
            {repoKind === 'memory' && (
              <p className="dk-banner">
                Local preview: Supabase is not configured in this checkout, so this roster lives in memory and is gone on
                reload. In production it is saved to your account.
              </p>
            )}
            {error && (
              <p className="dk-banner" data-tone="bad">
                {error}
              </p>
            )}
          </>
        }
      >
        {loading && !loaded && <p className={styles.muted}>Loading the roster…</p>}

        {loaded && players.length === 0 && (
          <section className={styles.empty}>
            <h2>Your roster is empty</h2>
            <p>
              Add the players you coach by their Clash Royale tag. Each one gets their own profile here, built from the
              battles Deckkies already collects — and adding a player also asks the collector to start following them.
            </p>
            <button type="button" className={styles.primaryButton} onClick={() => setAdding(true)}>
              + Add your first player
            </button>
          </section>
        )}

        {loaded && tag && !selected && (
          <section className={styles.empty}>
            <h2>{tag} is not on your roster</h2>
            <p>Pick a player in the sidebar, or add this one.</p>
            <a className={styles.linkButton} href={COACH_ROUTE}>
              Back to the roster
            </a>
          </section>
        )}

        {/* No player in the URL: the whole roster, not an empty frame. */}
        {loaded && !tag && players.length > 0 && <RosterOverview players={players} />}

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
      </DashShell>

      {adding && (
        <AddPlayerDialog
          onClose={() => setAdding(false)}
          onAdded={(t) => {
            setAdding(false);
            go(t);
          }}
        />
      )}
    </>
  );
}

export default CoachRoster;
