import { useEffect, useState } from 'react';

import {
  AnalyticsError,
  fetchFieldPlan,
  type FieldPlan,
} from '../../../state/analyticsClient';
import { playerLabel, windowDays, type CoachWindow, type RosterPlayer } from '../../../state/coachRoster';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../../Analytics/ReadingState';
import {
  BarRows,
  ChartCard,
  Dashboard,
  DashHero,
  InsightCard,
  InsightGrid,
  InsightRow,
  KeyMetricCard,
  MetricGrid,
} from '../../ui/bionis-dashboard';
import { CardsIcon, ShieldIcon, SwordsIcon, TrendIcon } from '../../Dashboard/icons';
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
  const changed = plan.tailoredPicks ?? 0;

  return (
    <Dashboard className={styles.overview}>
      <DashHero
        heading="What to practise"
        badge={
          !tailored
            ? 'The field, unweighted'
            : changed > 0
              ? `${changed} of ${plan.recommendations.length} from their own record`
              : 'Same picks as the field alone'
        }
        badgeTone={tailored && changed > 0 ? 'good' : 'neutral'}
      >
        {tailored
          ? `Ranked against what the field plays, weighted toward the ${plan.weighted.length} matchup${plan.weighted.length === 1 ? '' : 's'} ${playerLabel(player)} measurably loses. ${
              changed > 0
                ? `${changed} of these ${plan.recommendations.length} ${changed === 1 ? 'is here' : 'are here'} because of that weighting; the rest are what the field alone would suggest.`
                : `That moved the order but not the set — these are the decks the field alone suggests, which is what you should expect when the matchups they lose to are ones they rarely meet.`
            }`
          : plan.basis === 'unweighted'
            ? `Ranked against what the field plays. None of their ${nf.format(plan.battles)} battles gives an archetype enough evidence to weight yet, so this is the same plan the field alone produces.`
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
        <KeyMetricCard
          label="From their record"
          value={tailored ? `${changed} of ${plan.recommendations.length}` : '—'}
          note={
            !tailored
              ? 'nothing clears the evidence floor'
              : changed > 0
                ? 'picks the weighting put here'
                : 'the weighting moved the order only'
          }
          tone={changed > 0 ? 'good' : 'neutral'}
          icon={<ShieldIcon />}
        />
        <KeyMetricCard
          label="Best expected"
          value={plan.recommendations.length ? `${plan.recommendations[0].expectedWinRate.toFixed(1)}%` : '—'}
          note="against this projection"
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

      <ChartCard
        title="What to play"
        note={`Expected win rate against the projection · ${plan.recommendations.length} of ${nf.format(plan.pool)} ranked`}
        badge={plan.brain}
      >
        {plan.recommendations.length === 0 ? (
          <p className={styles.muted}>Nothing in the pool could be scored against this projection.</p>
        ) : (
          <ul className={styles.deckList}>
            {plan.recommendations.map((p) => (
              <li key={p.key} className={styles.deckItem}>
                <div className={styles.deckItemHead} style={{ cursor: 'default' }}>
                  <div className={styles.deckCards}>
                    {p.cards.map((c) => (
                      <CardArt key={c} card={c} variant={p.art?.[c]} inferred={p.artInferred} className={styles.deckCard} />
                    ))}
                  </div>
                  <span className={styles.deckFigures}>
                    <span className={styles.deckName}>
                      {p.name}
                      {p.fromWeighting && <span className={styles.oppTag}> · from their record</span>}
                    </span>
                    <span>
                      <strong>{p.expectedWinRate.toFixed(1)}%</strong> expected · {p.spreadCovered.toFixed(0)}% of the
                      projection answered
                    </span>
                    <DeckActions cards={p.cards} name={p.name} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>

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
