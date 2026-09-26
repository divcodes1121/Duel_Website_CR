import { useEffect, useId, useMemo, useState } from 'react';

import {
  fetchCardBoard,
  isLiveReport,
  type CardBoard,
  type CoachIntel,
  type PlayerReport,
} from '../../../state/analyticsClient';
import { battleTimeToIso, windowDays, type CoachWindow, type RosterPlayer } from '../../../state/coachRoster';
import { buildInsights } from '../../../state/coachInsights';
import { DECK_RATE_FLOOR } from '../../../state/coachScout';
import {
  DASH,
  cardMovers,
  coverage,
  windowsComparable,
  facedBars,
  facedRateBars,
  matchupEmpty,
  strengths,
  weaknesses,
  windowLine,
} from '../../../state/coachDashboard';
import { CARDS_BY_KEY } from '../../../data/cards';
import { ago } from '../../../utils/format';
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
  ReadoutList,
  ScoreDonut,
  type DashStat,
  type Trend,
} from '../../ui/bionis-dashboard';
import { CrownIcon, ShieldIcon, SwordsIcon, TrendIcon } from '../../Dashboard/icons';
import { DeckActions } from '../../DeckActions/DeckActions';
import { DailyChart, FormStrip, MIN_DAY_BATTLES } from './IntelCharts';
import { DeckStrip } from './PlayerOverview';
import styles from './CoachRoster.module.css';

const nf = new Intl.NumberFormat('en-US');

/**
 * ONE PLAYER, ON ONE SCREEN — the `bionis-dashboard` kit, filled from the
 * coach intelligence.
 *
 * WHAT IT ADDS OVER THE OLD OVERVIEW: the matchup cards. "What beats them" was
 * a bullet in a list of up to thirty; it is the most actionable thing the site
 * knows about a player, and it is now the block a coach reads first, with the
 * count and the gap beside each claim. The arithmetic is
 * `state/coachDashboard.ts` — pure, no imports, 28 tests.
 *
 * ONE POPULATION, EVERYWHERE. Every battle figure here comes from
 * `coach_intel`, which routes modes before the deck pipeline sees a row.
 * `/api/analytics/counter/<tag>` was the obvious source for the matchup cards
 * and was REJECTED: its query has no mode filter at all, and on one live
 * roster player it reports 872 battles at 62.0% where `coach_intel` reports
 * 710 at 60.3%. That gap is 2v2 and events — the exact fault Phase 2 of this
 * roster fixed. See the note at the top of `coachDashboard.ts`.
 *
 * THE ONE BORROWED FIGURE IS FOOTED WHERE IT IS DRAWN. Card movement comes
 * from `/api/analytics/cards/<tag>` because it computes the previous window
 * itself and nothing else on the site does. It is requested `mode=ranked`
 * (`ranked1v1*` / `ladder*`, so 2v2 cannot enter) and the block says so: a
 * narrower population than the rest of the screen, named in place.
 *
 * NOTHING HERE IS A SCORE. The ring is a fraction of a count with a required
 * caption, and it describes how much of the evidence can be judged — not the
 * player. The roster overview's contract applies unchanged.
 */
export function PlayerDashboard({
  player,
  report,
  intel,
  win,
}: {
  player: RosterPlayer;
  report: PlayerReport;
  intel: CoachIntel;
  win: CoachWindow;
}) {
  const tag = player.playerTag;
  const [cards, setCards] = useState<CardBoard | null>(null);
  const [faceTab, setFaceTab] = useState('share');
  const matchupsId = useId();

  useEffect(() => {
    let live = true;
    setCards(null);
    // RANKED ONLY, deliberately — see the note above. A failure is silent by
    // design: card movement is one block of a screen that must still render
    // without it, and every other figure comes from a read that already landed.
    fetchCardBoard(tag, { days: windowDays(win) }, 'ranked')
      .then((b) => live && setCards(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tag, win]);

  const s = intel.summary;
  const overall = s.battles ? (s.wins / s.battles) * 100 : 0;
  const cov = useMemo(() => coverage(intel.opponentArchetypes), [intel]);
  const weak = useMemo(() => weaknesses(intel.opponentArchetypes, overall), [intel, overall]);
  /* THE COUNT IS NOT THE CARDS. `weaknesses` stops at `DASH.matchupCards`
     (three) because that is how many cards the grid draws — so a metric
     reading `weak.length` could never say more than 3, however many matchups
     were losing. The figure counts them all; the grid still draws three. */
  const losingCount = useMemo(
    () => weaknesses(intel.opponentArchetypes, overall, Number.POSITIVE_INFINITY).length,
    [intel, overall],
  );
  const strong = useMemo(() => strengths(intel.opponentArchetypes, overall), [intel, overall]);
  /* Both windows must be comparable BEFORE any row is drawn — see
     `windowsComparable`. On real data an 11x imbalance produced eleven fallers
     and no risers, all of it regression to the mean. */
  const basis = useMemo(
    () => (cards ? windowsComparable(cards.totals.battles, cards.previous?.battles) : null),
    [cards],
  );
  const comparable = basis?.ok === true;
  const rising = useMemo(() => (cards && comparable ? cardMovers(cards.cards, 'up') : []), [cards, comparable]);
  const falling = useMemo(() => (cards && comparable ? cardMovers(cards.cards, 'down') : []), [cards, comparable]);
  const insights = useMemo(
    () =>
      buildInsights(
        intel,
        intel.decks.map((d) => ({
          key: d.key,
          name: d.deckName,
          battles: d.battles,
          wins: d.wins,
          lastSeen: battleTimeToIso(d.last),
        })),
      ),
    [intel],
  );

  const p = report.profile;
  const live = isLiveReport(report);
  const topDeck = intel.decks[0];
  const topLast = topDeck ? battleTimeToIso(topDeck.last) : null;
  /* THE NAMED FLOOR, NOT A BARE 5. `DECK_RATE_FLOOR` was already exported
     from `coachScout` and this screen wrote its value out again -- so the
     scout's floor and the dashboard's could drift apart while both claimed to
     be "too few to rate", on the same player, two tabs apart. */
  const rated = topDeck && topDeck.battles >= DECK_RATE_FLOOR;

  /* THE SPARKLINES ARE THE DAY CHART'S OWN SERIES, drawn small. The win-rate
     line takes the same floor `DailyChart` does — a day under
     `MIN_DAY_BATTLES` is a GAP, never a zero and never bridged — so the card
     and the chart below it cannot disagree about a day. */
  const days = intel.timeline;
  const dayLabels = days.map((d) => d.day);
  const battlesTrend: Trend | undefined =
    days.length > 1
      ? {
          values: days.map((d) => d.battles),
          labels: dayLabels,
          format: (v) => `${v} battle${v === 1 ? '' : 's'}`,
          min: 0,
          label: 'Battles per day',
        }
      : undefined;
  const rateTrend: Trend | undefined =
    days.length > 1 && days.some((d) => d.battles >= MIN_DAY_BATTLES)
      ? {
          values: days.map((d) => (d.battles >= MIN_DAY_BATTLES ? (d.wins / d.battles) * 100 : null)),
          labels: dayLabels,
          format: (v) => `${v.toFixed(0)}% won`,
          gapNote: `Under ${MIN_DAY_BATTLES} battles — no rate drawn`,
          min: 0,
          max: 100,
          label: 'Win rate per day, on days with 3 or more battles',
        }
      : undefined;

  /* Figures the rest of the screen does not print: how many of the window's
     days they played, how many decks, and when they last did. */
  const played = days.filter((d) => d.battles > 0).length;
  const heroStats: DashStat[] | undefined =
    !live && days.length > 0
      ? [
          { label: 'Days played', value: `${played} of ${days.length}` },
          { label: 'Decks played', value: nf.format(intel.decksTotal) },
          { label: 'Last battle', value: days[days.length - 1].day.slice(5).replace('-', '/') },
        ]
      : undefined;

  const toMatchups = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(matchupsId)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  /* The catalogue's own titles, so a mover reads "Hog Rider" and not the
     module's fallback title-casing of its key. */
  const title = (key: string, fallback: string) => CARDS_BY_KEY.get(key)?.name ?? fallback;

  return (
    <Dashboard className={styles.overview}>
      <DashHero
        heading={live ? 'Live battlelog' : 'Stored history'}
        badge={`Collection: ${report.tracking.state}`}
        badgeTone={report.tracking.state === 'tracked' ? 'good' : 'warn'}
        stats={heroStats}
        figure={
          cov && (
            <ScoreDonut
              value={cov.rated}
              max={Math.max(1, cov.total)}
              display={`${cov.rated}/${cov.total}`}
              tone={cov.tone}
              caption={cov.rated === 0 ? cov.caption : `${cov.rated} ${cov.caption}`}
            />
          )
        }
      >
        {live
          ? 'The collector has not stored this player yet — the figures below fill in once it has.'
          : windowLine(intel.window, s.battles, intel.hidden)}
      </DashHero>

      <MetricGrid>
        <KeyMetricCard
          label="1v1 battles"
          value={nf.format(s.battles)}
          note={`${nf.format(s.wins)}W · ${nf.format(s.losses)}L${s.draws ? ` · ${nf.format(s.draws)}D` : ''}`}
          icon={<SwordsIcon />}
          tone="info"
          trend={battlesTrend}
        />
        <KeyMetricCard
          label="Win rate"
          value={s.battles ? `${overall.toFixed(1)}%` : '—'}
          note="wins ÷ battles, this window"
          icon={<TrendIcon />}
          tone="good"
          trend={rateTrend}
        />
        <KeyMetricCard
          label="Path of Legends"
          value={p?.rankedTrophies != null ? nf.format(p.rankedTrophies) : '—'}
          note={p?.rankedRank != null ? `#${nf.format(p.rankedRank)} global` : 'below the leaderboard cut'}
          icon={<CrownIcon />}
        />
        <KeyMetricCard
          label="Losing matchups"
          value={String(losingCount)}
          note={`${DASH.matchupGap}+ points below their own rate`}
          tone={losingCount > 0 ? 'warn' : 'good'}
          icon={<ShieldIcon />}
          onClick={toMatchups}
          actionLabel={`${losingCount} losing matchups — go to the matchup cards`}
        />
      </MetricGrid>

      {/* THE BLOCK A COACH READS FIRST. */}
      <InsightGrid id={matchupsId}>
        {weak.length === 0 && strong.length === 0 ? (
          <InsightCard title="Matchups" icon={<ShieldIcon />} tone="neutral">
            <p className={styles.muted}>{matchupEmpty(intel.opponentArchetypes, overall)}</p>
          </InsightCard>
        ) : (
          <>
            {weak.map((m) => (
              <InsightCard key={m.id} title={`Losing to ${m.name}`} icon={<ShieldIcon />} tone={m.tone} badge="Work on this">
                <InsightRow title={m.headline} description={m.evidence} tone={m.tone} />
              </InsightCard>
            ))}
            {strong.map((m) => (
              <InsightCard key={m.id} title={`Holding ${m.name}`} icon={<CrownIcon />} tone="good" badge="Keep">
                <InsightRow title={m.headline} description={m.evidence} tone="good" />
              </InsightCard>
            ))}
          </>
        )}
      </InsightGrid>

      <ChartGrid>
        {/* The purpose-built chart, NOT the kit's ColumnChart: this one breaks
            its win-rate line across days under three battles rather than
            drawing movement that did not happen. */}
        <ChartCard title="Day by day" note="Win rate is drawn only on days with 3+ battles" badge={`${intel.timeline.length} days`}>
          <DailyChart timeline={intel.timeline} />
          <div className={styles.formLine}>
            <span className={styles.muted}>Last {intel.form.length}</span>
            <FormStrip form={intel.form} />
          </div>
        </ChartCard>

        {/* ONE LIST, TWO READINGS, SAME ROWS IN THE SAME ORDER — switching tab
            moves the bars, not the rows. The rate tab draws only archetypes
            past the matchup floor, so it can never state a rate the matchup
            cards withheld. */}
        <ChartCard
          title="What they face"
          note={
            faceTab === 'rate'
              ? `Their win rate against each, ${DASH.matchupBattles}+ battles only`
              : 'Share of their battles in this window'
          }
          tabs={[
            { id: 'share', label: 'Share' },
            { id: 'rate', label: 'Win rate' },
          ]}
          tab={faceTab}
          onTabChange={setFaceTab}
        >
          {(tab) =>
            tab === 'rate' ? (
              <BarRows
                bars={facedRateBars(intel.opponentArchetypes, overall)}
                max={100}
                empty={`None of the archetypes they face most has ${DASH.matchupBattles} battles behind it in this window.`}
              />
            ) : (
              <BarRows
                bars={facedBars(intel.opponentArchetypes, s.battles)}
                max={s.battles}
                empty="No opponents in this window."
              />
            )
          }
        </ChartCard>
      </ChartGrid>

      <ChartGrid>
        <ChartCard
          title="Most-played deck"
          note={
            topDeck && !rated
              ? `Across ${nf.format(intel.decksTotal)} decks — no deck has a settled record yet`
              : undefined
          }
        >
          {!topDeck ? (
            <p className={styles.muted}>No complete 1v1 deck in this window.</p>
          ) : (
            <div className={styles.deckRow}>
              <DeckStrip deck={topDeck} />
              <div className={styles.deckMeta}>
                <span className={styles.deckName}>{topDeck.deckName}</span>
                <span className={styles.muted}>
                  {nf.format(topDeck.battles)} battle{topDeck.battles === 1 ? '' : 's'} ·{' '}
                  {rated ? `${((topDeck.wins / topDeck.battles) * 100).toFixed(1)}% won` : 'too few to rate'}
                  {topLast ? ` · last ${ago(topLast)}` : ''}
                </span>
                <DeckActions cards={topDeck.cards} name={topDeck.deckName} />
              </div>
            </div>
          )}
        </ChartCard>

        {/* A SECOND FOOTING, NAMED WHERE IT IS DRAWN. */}
        <ChartCard
          title="Cards moving"
          note="Win rate against the window before this one"
          badge="Ranked 1v1 only"
        >
          {!cards ? (
            <p className={styles.muted}>Reading their cards…</p>
          ) : basis && !basis.ok ? (
            <p className={styles.muted}>{basis.reason}</p>
          ) : rising.length === 0 && falling.length === 0 ? (
            <p className={styles.muted}>
              No card has moved more than {DASH.cardGap} points on {DASH.cardBattles}+ battles in this window.
            </p>
          ) : (
            <ReadoutList
              rows={[
                ...rising.map((r) => ({ id: `up-${r.id}`, label: title(r.key, r.label), value: r.value, tone: r.tone })),
                ...falling.map((r) => ({ id: `dn-${r.id}`, label: title(r.key, r.label), value: r.value, tone: r.tone })),
              ]}
            />
          )}
        </ChartCard>
      </ChartGrid>

      <ChartCard title="Their own play" note="Their decks and form — what beats them is above" badge={`Top ${insights.length}`}>
        {insights.length === 0 ? (
          <p className={styles.muted}>
            Nothing clears the evidence floors in this window yet — an observation needs enough battles behind it to
            survive the next few.
          </p>
        ) : (
          <ul className={styles.insights}>
            {insights.map((x) => {
              const d = x.deckKey ? intel.decks.find((k) => k.key === x.deckKey) : undefined;
              return (
                <li key={x.id} className={styles.insight} data-kind={x.kind}>
                  <span className={styles.insightText}>{x.text}</span>
                  {d && <DeckStrip deck={d} />}
                  <span className={styles.insightEvidence}>{x.evidence}</span>
                </li>
              );
            })}
          </ul>
        )}
      </ChartCard>
    </Dashboard>
  );
}
