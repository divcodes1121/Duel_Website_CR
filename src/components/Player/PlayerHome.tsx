import { useEffect, useMemo, useState } from 'react';

import { useMyCoach, type MyRosterSeat } from '../../state/myCoach';
import { useAccountStore } from '../../state/accountStore';
import { DAY_PRESETS } from '../../utils/datePresets';
import { CardArt } from '../Analytics/CardArt';
import { ReadingState } from '../Analytics/ReadingState';
import { RecentBattles } from '../Analytics/RecentBattles';
import { DeckActions } from '../DeckActions/DeckActions';
import { TodayTab } from '../Admin/CoachRoster/TodayTab';
import { Dashboard, DashboardHeader, DashHero, ChartCard } from '../ui/bionis-dashboard';
import styles from '../Admin/CoachRoster/CoachRoster.module.css';
import own from './PlayerHome.module.css';

const SECTIONS = ['practise', 'arsenal', 'battles'] as const;
type Section = (typeof SECTIONS)[number];
const LABEL: Record<Section, string> = {
  practise: 'What to practise',
  arsenal: 'My decks',
  battles: 'My battles',
};

/**
 * A ROSTER PLAYER'S OWN DASHBOARD — `#/my`.
 *
 * WHO SEES IT. Only an account a coach has LINKED (migration 006). Not a tag
 * match: `profiles.player_tag` is written by the player, so matching on it
 * would let anyone claim a roster tag and be handed that player's coaching
 * data. Being on nobody's roster is a normal state with its own sentence, not
 * an error and not a locked door.
 *
 * THERE IS NO SCOUT HERE, DELIBERATELY. Reading another player's habits is
 * the coach's instrument, granted per account later. Its absence is silent —
 * an empty control saying "ask your coach" is worse than no control.
 *
 * WHERE THE FIGURES COME FROM. `/api/analytics/admin/coach/intel/` is the one
 * analytics route with an admin gate, so this screen cannot use it. It uses
 * `/api/analytics/coach/field/<tag>` instead, which computes the same
 * intelligence SERVER-SIDE from the same `coach_intel.report()` — so the
 * population is identical (own-deck 1v1 only) without the player ever holding
 * the coach's read. `TodayTab` is therefore reused exactly as the coach sees
 * it, which also means the two can never disagree about one player.
 *
 * A COACH WHO IS ALSO A PLAYER keeps the console and the roster; this is one
 * more screen they can open, not a mode the app switches into.
 */
export default function PlayerHome() {
  const seats = useMyCoach((s) => s.seats);
  const decks = useMyCoach((s) => s.decks);
  const loading = useMyCoach((s) => s.loading);
  const error = useMyCoach((s) => s.error);
  const load = useMyCoach((s) => s.load);
  const ready = useAccountStore((s) => s.ready);
  const userId = useAccountStore((s) => s.userId);

  const [seatId, setSeatId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('practise');
  const [win, setWin] = useState<(typeof DAY_PRESETS)[number] | 0>(30);

  useEffect(() => {
    if (ready && userId) void load();
  }, [ready, userId, load]);

  const seat: MyRosterSeat | null = useMemo(() => {
    if (!seats || seats.length === 0) return null;
    return seats.find((s) => s.id === seatId) ?? seats[0];
  }, [seats, seatId]);

  const myDecks = useMemo(
    () => (seat ? decks.filter((d) => d.playerId === seat.id) : []),
    [decks, seat],
  );

  if (!ready || (userId && seats === null && loading)) {
    return (
      <ReadingState k="my-coach" hue="green">
        Looking for your coach…
      </ReadingState>
    );
  }

  if (!userId) {
    return (
      <section className={own.notice}>
        <h2>Sign in to see your dashboard</h2>
        <p>This page shows what your coach has set up for you.</p>
        <a className={own.link} href="#/signin">Sign in</a>
      </section>
    );
  }

  if (error) {
    return (
      <section className={own.notice}>
        <h2>That could not be read</h2>
        <p>{error}</p>
      </section>
    );
  }

  /* NOT ON A ROSTER IS A NORMAL STATE. It is said plainly, without implying
     the person did something wrong or that something is broken. */
  if (!seat) {
    return (
      <section className={own.notice}>
        <h2>You are not on a coach’s roster</h2>
        <p>
          A coach can add you and link this account, and this page fills in. Until then nothing here applies to
          you — the rest of the site works as it always has.
        </p>
        <a className={own.link} href="#/">Back to Deckkies</a>
      </section>
    );
  }

  /* `TodayTab` takes the coach's own row shape. The fields it reads are the
     tag and the label, both of which a seat carries. */
  const asPlayer = {
    id: seat.id,
    playerTag: seat.playerTag,
    displayName: seat.displayName,
    notes: null,
    isActive: seat.isActive,
    createdAt: '',
    updatedAt: '',
  };

  return (
    <div className={own.page}>
      <Dashboard className={styles.overview}>
        <DashboardHeader
          title="My coaching"
          subtitle={`Set up for you by ${seat.coachName}.`}
          control={
            seats && seats.length > 1 ? (
              <div className={own.seatRow} role="group" aria-label="Your coaches">
                {seats.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={own.seatChip}
                    aria-pressed={s.id === seat.id}
                    onClick={() => setSeatId(s.id)}
                  >
                    {s.coachName}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />

        <DashHero heading={seat.displayName || seat.playerTag} badge={seat.playerTag} badgeTone="neutral">
          Everything here is counted from your own 1v1 battles. Nothing on this page is a rating of you.
        </DashHero>

        <nav className={styles.tabs} aria-label="Sections">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.tab}
              aria-current={s === section ? 'page' : undefined}
              onClick={() => setSection(s)}
            >
              {LABEL[s]}
            </button>
          ))}
          {section === 'practise' && (
            <div className={styles.windowChips} role="group" aria-label="Window">
              {[...DAY_PRESETS, 0].map((w) => (
                <button
                  key={w}
                  type="button"
                  className={styles.windowChip}
                  aria-pressed={w === win}
                  onClick={() => setWin(w as typeof win)}
                >
                  {w === 0 ? 'All' : `${w}d`}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* THE SAME COMPONENT THE COACH SEES, on the same route, so the two
            cannot disagree about one player. */}
        {section === 'practise' && <TodayTab player={asPlayer} win={win} />}

        {section === 'arsenal' && (
          <ChartCard
            title="Decks your coach approved"
            note="Read-only here — your coach keeps this list."
            badge={`${myDecks.length} deck${myDecks.length === 1 ? '' : 's'}`}
          >
            {myDecks.length === 0 ? (
              <p className={styles.muted}>
                Your coach has not approved any decks for you yet.
              </p>
            ) : (
              <ul className={styles.deckList}>
                {myDecks.map((d) => (
                  <li key={d.id} className={styles.deckItem}>
                    <div className={styles.deckItemHead} style={{ cursor: 'default' }}>
                      <div className={styles.deckCards}>
                        {d.cards.map((c) => (
                          <CardArt key={c} card={c} className={styles.deckCard} />
                        ))}
                      </div>
                      <span className={styles.deckFigures}>
                        <span className={styles.deckName}>{d.name || d.archetype || 'Deck'}</span>
                        {d.comfort != null && (
                          <span className={styles.muted}>Comfort {d.comfort} of 5</span>
                        )}
                        <DeckActions cards={d.cards} name={d.name || 'Deck'} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        )}

        {section === 'battles' && (
          <div className={styles.embed}>
            <RecentBattles tag={seat.playerTag} />
          </div>
        )}
      </Dashboard>
    </div>
  );
}
