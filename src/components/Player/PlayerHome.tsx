import { useEffect, useMemo, useState } from 'react';

import { useMyCoach, type MyRosterSeat } from '../../state/myCoach';
import { useAccountStore } from '../../state/accountStore';
import { DAY_PRESETS } from '../../utils/datePresets';
import { CardArt } from '../Analytics/CardArt';
import { drawnDeck, positionalArt } from '../../utils/deckSeating';
import { ReadingState } from '../Analytics/ReadingState';
import { RecentBattles } from '../Analytics/RecentBattles';
import { DeckActions } from '../DeckActions/DeckActions';
import { TodayTab } from '../Admin/CoachRoster/TodayTab';
import {
  BarRows,
  ChartCard,
  ChartGrid,
  Dashboard,
  DashHero,
  InsightCard,
  InsightGrid,
  InsightRow,
  KeyMetricCard,
  MetricGrid,
  ScoreDonut,
} from '../ui/bionis-dashboard';
import { CrownIcon, DeckIcon, HomeIcon, ShieldIcon, SwordsIcon, TargetIcon, TrendIcon } from '../Dashboard/icons';
import { DashShell, type ShellGroup } from '../ui/dash-shell';
import { GridIcon } from '../ui/dash-icons';
import { fetchFieldPlan, fetchPlayerReport, type FieldPlan, type PlayerReport } from '../../state/analyticsClient';
import { ProgressCard } from '../Admin/CoachRoster/ProgressCard';
import styles from '../Admin/CoachRoster/CoachRoster.module.css';
import own from './PlayerHome.module.css';

const SECTIONS = ['overview', 'practise', 'arsenal', 'battles'] as const;
type Section = (typeof SECTIONS)[number];

const ICON: Record<Section, JSX.Element> = {
  overview: <GridIcon />,
  practise: <TargetIcon size={18} />,
  arsenal: <DeckIcon size={18} />,
  battles: <SwordsIcon size={18} />,
};

/** `#/my/practise` -> `practise`; the bare route is the overview. The section
 *  is in the URL now, so a refresh keeps it and a coach can send the link. */
function sectionOf(hash: string): Section {
  const s = hash.replace(/^#\/my\/?/, '').split(/[/?#]/)[0];
  return (SECTIONS as readonly string[]).includes(s) ? (s as Section) : 'overview';
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const hrefOf = (s: Section) => (s === 'overview' ? '#/my' : `#/my/${s}`);
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
 *
 * IN THE DASHBOARD SHELL SINCE 2026-09-26, like the console and the roster:
 * the four sections are the sidebar (open, minimised to a rail, or closed; a
 * drawer on a phone) and each has its own URL, `#/my/practise` and so on. A
 * player with two coaches picks between them in the sidebar too.
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
  const section = sectionOf(useHash());
  const setSection = (s: Section) => {
    window.location.hash = hrefOf(s);
  };
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
    fetchFieldPlan(tag, { days: 30, brief: true, compare: true }).then((p) => live && setPlan(p)).catch(() => {});
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

  const groups: ShellGroup[] = [
    {
      id: 'me',
      label: 'My coaching',
      items: SECTIONS.map((sec) => ({ id: sec, label: LABEL[sec], icon: ICON[sec], href: hrefOf(sec), current: sec === section })),
    },
    ...(seats && seats.length > 1
      ? [
          {
            id: 'coaches',
            label: 'Your coaches',
            items: seats.map((st) => ({
              id: st.id,
              label: st.coachName,
              onSelect: () => setSeatId(st.id),
              current: st.id === seat.id,
            })),
          },
        ]
      : []),
    {
      id: 'site',
      label: 'Deckkies',
      items: [{ id: 'home', label: 'Back to Deckkies', icon: <HomeIcon size={18} />, href: '#/' }],
    },
  ];

  return (
    <DashShell
      id="my"
      product="My coaching"
      title={LABEL[section]}
      subtitle={`${seat.displayName || seat.playerTag} · set up for you by ${seat.coachName}`}
      groups={groups}
    >
      <Dashboard className={styles.overview}>
        {section === 'overview' && (
          <DashHero heading={seat.displayName || seat.playerTag} badge={seat.playerTag} badgeTone="neutral">
            Everything here is counted from your own 1v1 battles. Nothing on this page is a rating of you.
          </DashHero>
        )}

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
              <p className={styles.muted}>Your coach has not approved any decks for you yet.</p>
            ) : (
              <ul className={styles.deckList}>
                {myDecks.map((d) => {
                  /* AN ARSENAL DECK'S ORDER IS POSITIONAL — slot 0 evolution,
                     1 hero, 2 wild — so its art has to be seated from the
                     slots, exactly as `ArsenalTab` and `AssistTab` draw the
                     same rows. */
                  const art = positionalArt(d.cards);
                  return (
                    <li key={d.id} className={styles.deckItem}>
                      <div className={styles.deckItemHead} style={{ cursor: 'default' }}>
                        <div className={styles.deckCards}>
                          {d.cards.map((c) => (
                            <CardArt key={c} card={c} variant={art[c]} className={styles.deckCard} />
                          ))}
                        </div>
                        <span className={styles.deckFigures}>
                          <span className={styles.deckName}>{d.name || d.archetype || 'Deck'}</span>
                          {d.comfort != null && <span className={styles.muted}>Comfort {d.comfort} of 5</span>}
                          <DeckActions cards={d.cards} name={d.name || 'Deck'} />
                        </span>
                      </div>
                    </li>
                  );
                })}
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
    </DashShell>
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

  /* THIS WINDOW AGAINST THE ONE BEFORE IT, from the same `progress` block the
     card further down draws — so a pill here can never disagree with it. The
     win-rate pill says "within noise" when the server calls the two windows
     indistinguishable ('flat'): the change is real and printed, but an arrow
     on it would claim a movement the band swallows. Nothing is drawn when the
     windows are not comparable at all. */
  const o = plan.progress?.comparable ? plan.progress.overall : null;
  const moreBattles = o ? o.now.battles - o.before.battles : null;
  const rateChange = o?.change ?? null;

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
          tone="info"
          delta={moreBattles != null ? `${moreBattles >= 0 ? '+' : ''}${nf.format(moreBattles)} vs prior 30d` : undefined}
          deltaDir={moreBattles ? (moreBattles > 0 ? 'up' : 'down') : undefined}
          deltaTone="neutral"
        />
        <KeyMetricCard
          label="Win rate"
          value={plan.winRate == null ? '—' : `${plan.winRate.toFixed(1)}%`}
          note="wins ÷ battles"
          icon={<TrendIcon />}
          tone="good"
          delta={
            rateChange != null && o
              ? `${rateChange >= 0 ? '+' : ''}${rateChange.toFixed(1)} pts${o.direction === 'flat' ? ', within noise' : ''}`
              : undefined
          }
          deltaDir={o?.direction === 'up' ? 'up' : o?.direction === 'down' ? 'down' : undefined}
          deltaTone={o?.direction === 'up' ? 'good' : o?.direction === 'down' ? 'bad' : 'neutral'}
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

      {/* SECOND PERSON HERE, third on the coach's screen -- the same payload
          and the same component, so the two cannot disagree about whether a
          weakness is closing. */}
      <ProgressCard progress={plan.progress} self />

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
              detail: t.playerRecord
                ? `You: ${t.playerRecord.winRate.toFixed(1)}% over ${nf.format(t.playerRecord.battles)} battles`
                : 'Not met often enough to judge you against it',
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
                {/* `drawnDeck`, not a raw `art` lookup. This is an ENGINE deck,
                    and the rule from the seating fix is that engine decks go
                    through `drawnDeck` so a row the server could not seat still
                    falls back to the capability seating and says so, instead of
                    drawing an evolution, a hero or a champion as a plain card.
                    Reading `best.art?.[c]` directly is that bug one call site
                    further along than the three it was found in. */}
                {(() => {
                  const d = drawnDeck(best.cards ?? [], best.art, best.artInferred);
                  return d.cards.map((c) => (
                    <CardArt key={c} card={c} variant={d.art[c]} inferred={d.inferred} className={styles.deckCard} />
                  ));
                })()}
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
