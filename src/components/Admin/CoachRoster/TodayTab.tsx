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
    fetchFieldPlan(tag, { days: windowDays(win) })
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

  return (
    <Dashboard className={styles.overview}>
      <DashHero
        heading="What to practise"
        badge={tailored ? `Weighted by ${plan.weighted.length} matchup${plan.weighted.length === 1 ? '' : 's'}` : 'The field, unweighted'}
        badgeTone={tailored ? 'good' : 'neutral'}
      >
        {tailored
          ? `Ranked against what the field plays, with extra weight on the matchups ${playerLabel(player)} measurably loses.`
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
          label="Weighted toward"
          value={String(boosted.length)}
          note={tailored ? 'matchups they lose more than usual' : 'nothing clears the evidence floor'}
          tone={boosted.length > 0 ? 'warn' : 'neutral'}
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
                    <span className={styles.deckName}>{p.name}</span>
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
