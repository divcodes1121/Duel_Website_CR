import { useEffect, useState } from 'react';

import {
  AnalyticsError,
  fetchFieldPlan,
  type FieldPlan,
} from '../../../state/analyticsClient';
import { playerLabel, windowDays, type CoachWindow, type RosterPlayer } from '../../../state/coachRoster';
import { ReadingState } from '../../Analytics/ReadingState';
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
} from '../../ui/bionis-dashboard';
import { CardsIcon, ShieldIcon, SwordsIcon, TrendIcon } from '../../Dashboard/icons';
import { ClosestCard, FamiliesCard, LearnCard } from './FieldAnswers';
import { ProgressCard } from './ProgressCard';
import styles from './CoachRoster.module.css';

const nf = new Intl.NumberFormat('en-US');

/**
 * WHAT TO PLAY — against the field, with no opponent named.
 *
 * `server/coach_daily.py` does all of it: the meta board becomes a threat
 * projection, that projection is reweighted by where this player measurably
 * loses, and `team_scout.score()` — the SAME engine Team Analysis and the
 * public Coach Assist use — ranks ~204 real decks against it. **This screen
 * ranks nothing.** A second opinion here would eventually disagree with the
 * first about the same player.
 *
 * `basis` IS THE LOAD-BEARING FIELD AND EACH VALUE IS SAID DIFFERENTLY.
 * Rendering all four the same way would claim a plan was tailored to this
 * player when it was not:
 *
 *   weighted     their record moved the projection — the deficits are listed
 *   unweighted   they have history, none of it clears the evidence floor
 *   no_history   nothing stored for them yet
 *   none         the meta snapshot is still building; this is not their fault
 *
 * HOW MUCH OF THIS PLAN IS ABOUT THIS PLAYER IS MEASURED, NOT ASSERTED. The
 * server ranks the UNWEIGHTED projection as well and reports `tailoredPicks` —
 * how many picks the weighting actually put there. Live across five real
 * roster players that is **0 to 1 of 7**, because a rare archetype cannot
 * matter much in a projection weighted by how often it is FACED, however badly
 * the player loses to it. That is the correct answer, not a weak one: you
 * prepare for what you meet. The weighting moves the ORDER and names the
 * matchups; it rarely changes the deck set, and the badge says which happened
 * rather than letting "weighted by 7 matchups" imply a bespoke plan.
 *
 * NO PROSE UNDER THE PICKS. Team Scout's explanatory text was removed on
 * request by name, and the server's own `explain()` speaks about an OPPONENT
 * ("what they play") — which a field projection does not have. The first live
 * run printed one identical sentence under all seven picks.
 */
export function TodayTab({ player, win }: { player: RosterPlayer; win: CoachWindow }) {
  const tag = player.playerTag;
  const [plan, setPlan] = useState<FieldPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPlan(null);
    setError(null);
    // `compare` measures this window against the one before it. One extra
    // pass over the battle rows, and this is a single-player screen -- the
    // roster-wide read deliberately does not ask for it.
    fetchFieldPlan(tag, { days: windowDays(win), compare: true })
      .then((p) => live && setPlan(p))
      .catch((e) =>
        live &&
        setError(
          e instanceof AnalyticsError && e.kind === 'offline'
            ? e.message
            : 'Their plan could not be worked out.',
        ),
      );
    return () => {
      live = false;
    };
  }, [tag, win]);

  if (error) {
    return (
      <section className={styles.notice}>
        <h3>No plan yet</h3>
        <p>{error}</p>
      </section>
    );
  }
  if (!plan) {
    return (
      <ReadingState k="coach-field" hue="green">
        Working out what {playerLabel(player)} should practise…
      </ReadingState>
    );
  }

  if (plan.basis === 'none') {
    return (
      <section className={styles.notice}>
        <h3>The meta board is still being computed</h3>
        <p>
          The plan is built against what the field is actually playing, and that reading is rebuilt periodically.
          Try again in a few minutes — nothing is wrong with this player.
        </p>
      </section>
    );
  }

  const tailored = plan.basis === 'weighted';
  const boosted = plan.threats.filter((t) => t.boost > 1);
  const near = (plan.closest ?? []).length;
  const fams = (plan.families ?? []).length;

  return (
    <Dashboard className={styles.overview}>
      <DashHero
        heading="What to practise"
        badge={
          near > 0
            ? `${near} they could pilot today`
            : fams > 0
              ? 'Nothing of theirs answers this field'
              : 'The field, unweighted'
        }
        badgeTone={near > 0 ? 'good' : 'warn'}
      >
        {/* IT NO LONGER ADVERTISES THE WEIGHTING AS THE PERSONAL PART. That
            claim was measured and it was 0 of 7 picks on five of six real
            accounts — the weighting moves the ORDER, and saying more than
            that was the screen promising a tailoring it had not done. What is
            actually personal is the two blocks below: decks built from cards
            they already play, and the one archetype worth taking up. */}
        {fams > 0
          ? `${nf.format(plan.pool)} real decks ranked against what the field is playing right now, grouped by win condition. ${
              near > 0
                ? `${near} of them are built from cards ${playerLabel(player)} already plays.`
                : `None of them is built from cards ${playerLabel(player)} already plays, so the place to start is a new win condition.`
            }`
          : plan.basis === 'unweighted'
            ? `Ranked against what the field plays. None of their ${nf.format(plan.battles)} battles gives an archetype enough evidence to weight yet.`
            : 'Ranked against what the field plays. Nothing is stored for this player yet, so nothing is weighted to them.'}
      </DashHero>

      <MetricGrid>
        <KeyMetricCard
          label="Decks ranked"
          value={nf.format(plan.pool)}
          note="real lists, not generated"
          icon={<CardsIcon />}
        />
        <KeyMetricCard
          label="Field projection"
          value={String(plan.threats.length)}
          note={`from the top ${nf.format(plan.meta.decks)} meta decks`}
          icon={<SwordsIcon />}
        />
        {/* THIS CARD USED TO REPORT `tailoredPicks`, and it was the wrong
            figure to make prominent: measured across six real accounts it was
            0 for five of them, so the screen's headline personal number was
            almost always zero. What is personal is how many of the field's
            answers they could actually pick up. */}
        <KeyMetricCard
          label="Could pilot today"
          value={String(near)}
          note={
            plan.repertoire
              ? `${plan.repertoire.sharedFloor}+ cards shared with one of their ${plan.repertoire.decks} decks`
              : 'decks built from cards they already play'
          }
          tone={near > 0 ? 'good' : 'warn'}
          icon={<ShieldIcon />}
        />
        <KeyMetricCard
          label="Best expected"
          value={plan.families?.length ? `${plan.families[0].best.toFixed(1)}%` : '—'}
          note={plan.families?.length ? `${plan.families[0].name}, the field's best answer` : 'against this projection'}
          icon={<TrendIcon />}
        />
      </MetricGrid>

      {/* WHY THIS PLAN IS THIS PLAN. Without it the picks are a tier list. */}
      {tailored && (
        <InsightGrid>
          {plan.weighted.slice(0, 3).map((w) => (
            <InsightCard key={w.archetype} title={`More ${w.name}`} icon={<ShieldIcon />} tone="warn" badge="Weighted up">
              <InsightRow
                title={`They win ${w.winRate.toFixed(1)}% against ${w.name}, ${w.deficit.toFixed(1)} points below their own rate.`}
                description={`${w.battles} battles · the field's ${w.name} decks carry more weight in the ranking below`}
                tone="warn"
              />
            </InsightCard>
          ))}
        </InsightGrid>
      )}

      {/* AND WHETHER ANY OF IT IS WORKING. It sits with the weakness cards
          rather than at the foot of the screen: those say what they lose to,
          this says whether that is moving, and separating them leaves a coach
          reading the same three names every week with no record of progress. */}
      <ProgressCard progress={plan.progress} />

      {/* THE TWO PERSONAL BLOCKS FIRST, then the field's whole answer.
          The seven-deck "What to play" list that used to sit here is GONE
          from this screen: measured across the six busiest real accounts it
          drew on ten distinct decks for forty-two slots and three decks
          appeared in every single plan, because `diversify()` returns the
          best deck of each of seven archetypes — a tier list. It is still in
          the payload (`recommendations`) because the roster's Today board
          draws one row per player from it. */}
      <ChartGrid>
        <ClosestCard plan={plan} />
        <LearnCard learn={plan.learn} />
      </ChartGrid>

      <FamiliesCard plan={plan} />

      <ChartCard
        title="What the field plays"
        note="Share of the projection this plan was ranked against"
        badge={`${plan.threats.length} decks`}
      >
        <BarRows
          bars={plan.threats.map((t) => ({
            label: t.boost > 1 ? `${t.name} ↑` : t.name,
            value: Math.round(t.likelihood * 1000),
            tone: t.boost > 1 ? ('warn' as const) : ('info' as const),
            display: `${(t.likelihood * 100).toFixed(1)}%`,
          }))}
          empty="The meta board has nothing in it yet."
        />
        {boosted.length > 0 && (
          <p className={styles.muted}>
            ↑ carries extra weight because {playerLabel(player)} loses to it more than they usually do.
          </p>
        )}
      </ChartCard>
    </Dashboard>
  );
}
