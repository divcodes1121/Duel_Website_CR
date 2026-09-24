import { useEffect, useMemo, useState } from 'react';

import { useMyCoach, type MyRosterSeat } from '../../state/myCoach';
import { useAccountStore } from '../../state/accountStore';
import { DAY_PRESETS } from '../../utils/datePresets';
import { CardArt } from '../Analytics/CardArt';
import { ReadingState } from '../Analytics/ReadingState';
import { RecentBattles } from '../Analytics/RecentBattles';
import { DeckActions } from '../DeckActions/DeckActions';
import { TodayTab } from '../Admin/CoachRoster/TodayTab';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  Dashboard,
  DashboardHeader,
  DashHero,
  InsightCard,
  InsightGrid,
  InsightRow,
  KeyMetricCard,
  MetricGrid,
  ScoreDonut,
} from '../ui/bionis-dashboard';
import { CrownIcon, ShieldIcon, SwordsIcon, TrendIcon } from '../Dashboard/icons';
import { fetchFieldPlan, fetchPlayerReport, type FieldPlan, type PlayerReport } from '../../state/analyticsClient';
import styles from '../Admin/CoachRoster/CoachRoster.module.css';
import own from './PlayerHome.module.css';

const SECTIONS = ['overview', 'practise', 'arsenal', 'battles'] as const;
type Section = (typeof SECTIONS)[number];
const LABEL: Record<Section, string> = {
  overview: 'Overview',
  practise: 'What to practise',
  arsenal: 'My decks',
  battles: 'My battles',
};

const nf = new Intl.NumberFormat('en-US');

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
  const [section, setSection] = useState<Section>('overview');
  /* THE BRIEF PLAN, for the overview's figures. It is the SAME answer the
     practise tab draws in full — a projection of it, proven identical on
     picks, order, rates and likelihoods — so the two tabs cannot disagree
     about this player. 8.8 kB against 38.9. */
  const [plan, setPlan] = useState<FieldPlan | null>(null);
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [win, setWin] = useState<(typeof DAY_PRESETS)[number] | 0>(30);

  useEffect(() => {
    if (ready && userId) void load();
  }, [ready, userId, load]);

  const seat: MyRosterSeat | null = useMemo(() => {
    if (!seats || seats.length === 0) return null;
    return seats.find((s) => s.id === seatId) ?? seats[0];
  }, [seats, seatId]);

  const tag = seat?.playerTag ?? null;
  useEffect(() => {
    if (!tag) return;
    let live = true;
    setPlan(null);
    setReport(null);
    /* Each lands on its own. The profile read can go to the CR API for a tag
       the collector has not stored, which takes tens of seconds, and making
       the figures wait on it would leave the screen empty with the answer
       already in hand — the fault the scout had. */
    fetchFieldPlan(tag, { days: 30, brief: true }).then((p) => live && setPlan(p)).catch(() => {});
    fetchPlayerReport(tag, { days: 30 }).then((r) => live && setReport(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, [tag]);

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
        <a className={own.link} href="#/">Back to Deckkies</a>
      </section>
    );
  }

  if (error) {
    return (
      <section className={own.notice}>
        <h2>That could not be read</h2>
        <p>{error}</p>
        <a className={own.link} href="#/">Back to Deckkies</a>
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
      {/* A WAY BACK. `#/my` is its own route outside the Dashboard shell, so
          it inherits none of the app's navigation — without this the only exit
          is the browser's back button, and there is none at all for somebody
          who arrived by typing the URL or following a link. The console had
          exactly this gap and carries the same control. */}
      <a className={own.back} href="#/">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Home
      </a>

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

        {section === 'overview' && <Overview plan={plan} report={report} onPractise={() => setSection('practise')} />}

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

/**
 * WHAT THIS PLAYER SHOULD KNOW ABOUT THEMSELVES, in figures.
 *
 * EVERY NUMBER COMES OFF THE FIELD PLAN, which the server computed from
 * `coach_intel.report()` — so the population is own-deck 1v1 only, the same
 * one the coach's screens count, and this page cannot quietly disagree with
 * them. Nothing is recomputed here.
 *
 * THE RING IS NOT A SCORE. `ScoreDonut`'s caption is a required prop for
 * exactly this reason. It shows how much of the field this player has
 * actually met enough times to be judged against — a fraction of a count,
 * about the EVIDENCE rather than about them. A player-facing screen is the
 * last place a rating belongs.
 */
function Overview({
  plan,
  report,
  onPractise,
}: {
  plan: FieldPlan | null;
  report: PlayerReport | null;
  onPractise: () => void;
}) {
  if (!plan) {
    return (
      <ReadingState k="my-overview" hue="green">
        Reading your battles…
      </ReadingState>
    );
  }

  const known = plan.threats.filter((t) => t.playerRecord).length;
  const total = plan.threats.length;
  const work = plan.weighted.slice(0, 3);
  const p = report && 'profile' in report ? report.profile : null;
  const best = plan.recommendations[0];

  return (
    <>
      <DashHero
        heading="Where you stand"
        badge={plan.basis === 'weighted' ? `${plan.weighted.length} to work on` : 'Not enough battles yet'}
        badgeTone={plan.weighted.length > 0 ? 'warn' : 'good'}
        figure={
          total > 0 ? (
            <ScoreDonut
              value={known}
              max={Math.max(1, total)}
              display={`${known}/${total}`}
              tone={known / Math.max(1, total) >= 0.6 ? 'good' : 'warn'}
              caption={`${known} of the ${total} decks the field is playing are ones you have met enough times to judge. The rest are shown without a verdict.`}
            />
          ) : undefined
        }
      >
        {plan.battles > 0
          ? `Counted from your ${nf.format(plan.battles)} own-deck 1v1 battles.`
          : 'Nothing is stored for you yet — this fills in once the collector reaches you.'}
      </DashHero>

      <MetricGrid>
        <KeyMetricCard
          label="1v1 battles"
          value={nf.format(plan.battles)}
          note="in the last 30 days"
          icon={<SwordsIcon />}
        />
        <KeyMetricCard
          label="Win rate"
          value={plan.winRate == null ? '—' : `${plan.winRate.toFixed(1)}%`}
          note="wins ÷ battles"
          icon={<TrendIcon />}
        />
        {/* A RANKED SEASON RESETS TO ZERO, and printing that zero reads as
            either "no data" or "they are terrible" — it is neither. Measured
            on this very roster: rankedTrophies 0 with a rankedBest of 2,171,
            because the season had turned and they had not queued yet. The
            degradation is the one PlayerAnalysis already documents: no ranked
            season this time -> trophy road and arena, which are real figures
            about the same player. `rankedRank` is guarded SEPARATELY because
            it is null below the leaderboard cut while trophies are set. */}
        {p?.rankedTrophies ? (
          <KeyMetricCard
            label="Path of Legends"
            value={nf.format(p.rankedTrophies)}
            note={p.rankedRank != null ? `#${nf.format(p.rankedRank)} global` : 'below the leaderboard cut'}
            icon={<CrownIcon />}
          />
        ) : (
          <KeyMetricCard
            label="Trophy road"
            value={p?.trophies != null ? nf.format(p.trophies) : '—'}
            note={
              p?.rankedBest
                ? `${p.arena ?? 'arena'} · ranked best ${nf.format(p.rankedBest)}`
                : (p?.arena ?? 'no ranked season yet')
            }
            icon={<CrownIcon />}
          />
        )}
        <KeyMetricCard
          label="To work on"
          value={String(plan.weighted.length)}
          note="matchups you lose more than usual"
          tone={plan.weighted.length > 0 ? 'warn' : 'good'}
          icon={<ShieldIcon />}
        />
      </MetricGrid>

      {/* THE PART A PLAYER CAN ACT ON. Each card is their own record against
          one archetype, with the count behind it — never an adjective. */}
      <InsightGrid>
        {work.length === 0 ? (
          <InsightCard title="Your matchups" icon={<ShieldIcon />} tone="neutral">
            <p className={styles.muted}>
              Nothing you face often enough is far from your own {plan.winRate?.toFixed(1) ?? '—'}%. Keep playing
              and this fills in.
            </p>
          </InsightCard>
        ) : (
          work.map((w) => (
            <InsightCard key={w.archetype} title={`Losing to ${w.name}`} icon={<ShieldIcon />} tone={w.deficit >= 20 ? 'bad' : 'warn'} badge="Work on this">
              <InsightRow
                title={`You win ${w.winRate.toFixed(1)}% against ${w.name}, ${w.deficit.toFixed(1)} points below your own rate.`}
                description={`${w.battles} battles`}
                tone={w.deficit >= 20 ? 'bad' : 'warn'}
              />
            </InsightCard>
          ))
        )}
      </InsightGrid>

      <ChartGrid>
        <ChartCard
          title="What the field is playing"
          note="The decks you are most likely to meet right now"
          badge={`${total} decks`}
        >
          <BarRows
            bars={plan.threats.slice(0, 6).map((t) => ({
              label: t.name,
              value: Math.round(t.likelihood * 1000),
              tone: t.boost > 1 ? ('warn' as const) : ('info' as const),
              display: `${(t.likelihood * 100).toFixed(1)}%`,
            }))}
            empty="The meta board is still being computed."
          />
        </ChartCard>

        <ChartCard title="Your next practice deck" note="Ranked against that field, weighted to what you lose to">
          {!best ? (
            <p className={styles.muted}>No deck could be ranked yet.</p>
          ) : (
            <>
              <div className={styles.deckCards}>
                {(best.cards ?? []).map((c) => (
                  <CardArt key={c} card={c} variant={best.art?.[c]} inferred={best.artInferred} className={styles.deckCard} />
                ))}
              </div>
              <p className={styles.deckName}>{best.name}</p>
              <p className={styles.muted}>
                {best.expectedWinRate.toFixed(1)}% expected against what the field is playing.
              </p>
              <div className={styles.controlRow}>
                <DeckActions cards={best.cards ?? []} name={best.name} />
                <button type="button" className={styles.ghostButton} onClick={onPractise}>
                  See all {plan.recommendations.length} →
                </button>
              </div>
            </>
          )}
        </ChartCard>
      </ChartGrid>
    </>
  );
}
