import { useEffect, useMemo, useState } from 'react';

import {
  AnalyticsError,
  fetchCoachIntel,
  fetchPlayerReport,
  type CoachIntel,
  type PlayerReport,
} from '../../../state/analyticsClient';
import {
  COACH_SECTIONS,
  COACH_WINDOWS,
  SECTION_LABEL,
  battleTimeToIso,
  coachHref,
  playerLabel,
  windowDays,
  type CoachSection,
  type CoachWindow,
  type RosterPlayer,
} from '../../../state/coachRoster';
import { buildInsights } from '../../../state/coachInsights';
import { coachToken } from '../../../state/coachToken';
import { ago } from '../../../utils/format';
import { ReadingState } from '../../Analytics/ReadingState';
import { RecentBattles } from '../../Analytics/RecentBattles';
import { PlayerCards } from '../../Analytics/PlayerCards';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ArsenalTab } from './ArsenalTab';
import { AssistTab } from './AssistTab';
import { PlansTab } from './PlansTab';
import { ScoutTab } from './ScoutTab';
import { DailyChart, FormStrip, ShareBars } from './IntelCharts';
import { CoachControls, DeckStrip, PlayerHeader, PlayerRecord } from './PlayerOverview';
import styles from './CoachRoster.module.css';

const nf = new Intl.NumberFormat('en-US');

/**
 * One roster player's workspace — Phase 2's tabs over two reads.
 *
 *   the PLAYER REPORT  → who they are: rank, trophies, clan, collection state
 *   the COACH INTEL    → what they did: own-deck 1v1 battles by day, mode,
 *                        archetype, deck and opponent (admin-only route)
 *
 * Both reads share ONE window (7 / 30 / 90 days / all), so every figure on the
 * Overview, Decks and Opponents tabs describes the same battles. Battles and
 * Cards embed the existing screens, which keep their own date controls.
 *
 * WHY THE INTEL SENDS A TOKEN. `/api/analytics/admin/coach/intel` is the one
 * analytics route that asks Supabase whether the caller is an admin; the
 * session's access token goes in `X-Coach-Token` (`coachToken()`, shared with
 * the scout). Every refusal is worded below rather than shown as a status
 * code.
 */

function intelProblem(e: AnalyticsError): string {
  if (e.kind === 'offline') return e.message;
  if (e.kind === 'not_found') {
    return 'The analytics server does not have the Coach Roster route yet — its server half has not been deployed.';
  }
  switch (e.message) {
    case 'unauthorized':
      return 'The analytics server could not verify your session. Sign out and in again.';
    case 'forbidden':
      return 'The analytics server says this account is not an admin.';
    case 'not_configured':
      return 'The analytics server is not configured to check admin access yet (SUPABASE_URL / SUPABASE_ANON_KEY).';
    case 'unavailable':
      return 'The analytics server could not reach Supabase to check admin access. Try again in a moment.';
    default:
      return e.message;
  }
}

export function PlayerWorkspace({
  player,
  section,
  win,
  onWindow,
  opponent,
}: {
  player: RosterPlayer;
  section: CoachSection;
  win: CoachWindow;
  onWindow: (w: CoachWindow) => void;
  /** The scouted opponent, from the route's third segment. */
  opponent?: string | null;
}) {
  const tag = player.playerTag;
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [reportError, setReportError] = useState<AnalyticsError | null>(null);
  const [intel, setIntel] = useState<CoachIntel | null>(null);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [intelLoading, setIntelLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const days = windowDays(win);
    setReportError(null);
    setIntelError(null);
    setIntelLoading(true);
    setIntel(null);
    fetchPlayerReport(tag, { days })
      .then((r) => live && setReport(r))
      .catch((e) => live && setReportError(e as AnalyticsError));
    void (async () => {
      try {
        const r = await fetchCoachIntel(tag, { days }, await coachToken());
        if (live) setIntel(r);
      } catch (e) {
        if (live) setIntelError(e instanceof AnalyticsError ? intelProblem(e) : 'Could not read their battles.');
      } finally {
        if (live) setIntelLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [tag, win]);

  const windowed =
    section === 'overview' || section === 'decks' || section === 'opponents' || section === 'scout' || section === 'assist';

  return (
    <div className={styles.overview}>
      <PlayerHeader player={player} report={report} />
      <CoachControls player={player} />

      <nav className={styles.tabs} aria-label={`${playerLabel(player)} sections`}>
        {COACH_SECTIONS.map((s) => (
          <a
            key={s}
            href={coachHref(tag, s)}
            className={styles.tab}
            aria-current={s === section ? 'page' : undefined}
          >
            {SECTION_LABEL[s]}
          </a>
        ))}
        {windowed && (
          <div className={styles.windowChips} role="group" aria-label="Window">
            {COACH_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                className={styles.windowChip}
                aria-pressed={w === win}
                onClick={() => onWindow(w)}
              >
                {w === 0 ? 'All' : `${w}d`}
              </button>
            ))}
          </div>
        )}
      </nav>

      {section === 'overview' && (
        <OverviewTab report={report} reportError={reportError} intel={intel} intelError={intelError} loading={intelLoading} player={player} />
      )}
      {/* The arsenal is the coach's own list and does not depend on the
          intelligence read — it renders whether or not the battles answered.
          The intel is passed only so a deck can be taken FROM their history. */}
      {section === 'arsenal' && <ArsenalTab player={player} intel={intel} />}
      {/* The scout reads a DIFFERENT player through the same admin route. The
          roster player's own intel is passed because head to head is their
          record against that opponent, which only their battles can say. */}
      {section === 'scout' && (
        <ScoutTab player={player} playerIntel={intel} win={win} opponentTag={opponent} />
      )}
      {/* The engine's ranking joined to the arsenal. It reads the PLAYER's
          intel for "have they ever played this", and the team-analysis route
          for the ranking itself — no scoring happens in the client. */}
      {section === 'assist' && (
        <AssistTab player={player} playerIntel={intel} win={win} opponentTag={opponent} />
      )}
      {/* A plan is the coach's own record; it needs no analytics read of its
          own, because everything it shows was frozen when it was made. */}
      {section === 'plans' && <PlansTab player={player} />}
      {section === 'battles' && (
        <div className={styles.embed}>
          <RecentBattles tag={tag} />
        </div>
      )}
      {section === 'cards' && (
        <div className={styles.embed}>
          <PlayerCards tag={tag} />
        </div>
      )}
      {section === 'decks' && <IntelGate intel={intel} error={intelError} loading={intelLoading}>{(i) => <DecksTab intel={i} />}</IntelGate>}
      {section === 'opponents' && (
        <IntelGate intel={intel} error={intelError} loading={intelLoading}>
          {(i) => <OpponentsTab intel={i} playerTag={tag} />}
        </IntelGate>
      )}
    </div>
  );
}

function IntelGate({
  intel,
  error,
  loading,
  children,
}: {
  intel: CoachIntel | null;
  error: string | null;
  loading: boolean;
  children: (i: CoachIntel) => React.ReactNode;
}) {
  if (error) {
    return (
      <section className={styles.notice}>
        <h3>Their battles could not be read</h3>
        <p>{error}</p>
      </section>
    );
  }
  if (loading || !intel) {
    return (
      <ReadingState k="coach-intel" hue="violet">
        Reading their 1v1 battles…
      </ReadingState>
    );
  }
  return <>{children(intel)}</>;
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function OverviewTab({
  report,
  reportError,
  intel,
  intelError,
  loading,
  player,
}: {
  report: PlayerReport | null;
  reportError: AnalyticsError | null;
  intel: CoachIntel | null;
  intelError: string | null;
  loading: boolean;
  player: RosterPlayer;
}) {
  const insights = useMemo(() => {
    if (!intel) return [];
    return buildInsights(
      intel,
      intel.decks.map((d) => ({ name: d.deckName, battles: d.battles, wins: d.wins, lastSeen: battleTimeToIso(d.last) })),
    );
  }, [intel]);

  if (reportError) {
    return (
      <section className={styles.notice}>
        <h3>{reportError.kind === 'offline' ? 'Analytics service is not running' : 'No data for this tag yet'}</h3>
        <p>
          {reportError.kind === 'offline'
            ? reportError.message
            : 'Neither stored history nor the live battlelog has anything for this tag. If it was just added, collection has been requested — stored battles appear after the collector’s next pass.'}
        </p>
      </section>
    );
  }
  if (!report) {
    return (
      <ReadingState k="player" hue="violet">
        Reading {playerLabel(player)}’s record…
      </ReadingState>
    );
  }

  return (
    <>
      <PlayerRecord report={report} intel={intel} />
      <IntelGate intel={intel} error={intelError} loading={loading}>
        {(i) =>
          i.summary.battles === 0 ? (
            <section className={styles.notice}>
              <h3>No 1v1 battles in this window</h3>
              <p>Widen the window, or check back once the collector has stored some.</p>
            </section>
          ) : (
            <>
              <section className={styles.block}>
                <div className={styles.blockHead}>
                  <h3 className={styles.blockTitle}>Day by day</h3>
                  <FormStrip form={i.form} />
                </div>
                <DailyChart timeline={i.timeline} />
              </section>

              <div className={styles.shareGrid}>
                <section className={styles.block}>
                  <h3 className={styles.blockTitle}>Modes</h3>
                  <ShareBars rows={i.modes} total={i.summary.battles} />
                </section>
                <section className={styles.block}>
                  <h3 className={styles.blockTitle}>Their win conditions</h3>
                  <ShareBars rows={i.archetypes} total={i.summary.battles} />
                </section>
                <section className={styles.block}>
                  <h3 className={styles.blockTitle}>What they face</h3>
                  <ShareBars rows={i.opponentArchetypes} total={i.summary.battles} />
                </section>
              </div>

              <section className={styles.block}>
                <h3 className={styles.blockTitle}>Insights</h3>
                {insights.length === 0 ? (
                  <p className={styles.muted}>
                    Nothing clears the evidence floors in this window yet — an insight needs enough battles behind it
                    to survive the next few.
                  </p>
                ) : (
                  <ul className={styles.insights}>
                    {insights.map((x) => (
                      <li key={x.id} className={styles.insight} data-kind={x.kind}>
                        <span className={styles.insightText}>{x.text}</span>
                        <span className={styles.insightEvidence}>{x.evidence}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )
        }
      </IntelGate>
    </>
  );
}

/* ── Decks ───────────────────────────────────────────────────────────────── */

function DecksTab({ intel }: { intel: CoachIntel }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!intel.decks.length) {
    return (
      <section className={styles.notice}>
        <h3>No complete 1v1 decks in this window</h3>
        <p>Widen the window, or check back once more battles are stored.</p>
      </section>
    );
  }
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>Decks played</h3>
        <span className={styles.muted}>
          {intel.decks.length < intel.decksTotal
            ? `the ${intel.decks.length} most-played of ${intel.decksTotal}`
            : `${intel.decksTotal} deck${intel.decksTotal === 1 ? '' : 's'}`}{' '}
          · own-deck 1v1 only
        </span>
      </div>
      <ul className={styles.deckList}>
        {intel.decks.map((d) => {
          const on = open === d.key;
          const last = battleTimeToIso(d.last);
          return (
            <li key={d.key} className={styles.deckItem} data-open={on || undefined}>
              <button type="button" className={styles.deckItemHead} aria-expanded={on} onClick={() => setOpen(on ? null : d.key)}>
                <DeckStrip deck={d} />
                <span className={styles.deckFigures}>
                  <span className={styles.deckName}>{d.deckName}</span>
                  <span>
                    {nf.format(d.battles)} battles · {d.wins}W {d.losses}L{d.draws ? ` ${d.draws}D` : ''} ·{' '}
                    <strong>{((d.wins / d.battles) * 100).toFixed(1)}%</strong>
                  </span>
                  <span className={styles.muted}>last {last ? ago(last) : '—'}</span>
                </span>
              </button>
              {on && (
                <div className={styles.deckDetail}>
                  <span>Average elixir {d.avgElixir?.toFixed(1) ?? '—'}</span>
                  <span>Share of their 1v1 battles {((d.battles / intel.summary.battles) * 100).toFixed(1)}%</span>
                  <DeckActions cards={d.cards} name={d.deckName} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Opponents ───────────────────────────────────────────────────────────── */

/** Meetings before a head-to-head win rate is printed. */
const H2H_FLOOR = 3;

function OpponentsTab({ intel, playerTag }: { intel: CoachIntel; playerTag: string }) {
  if (!intel.opponents.length) {
    return (
      <section className={styles.notice}>
        <h3>No opponents in this window</h3>
        <p>Widen the window, or check back once more battles are stored.</p>
      </section>
    );
  }
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>Opponents faced</h3>
        <span className={styles.muted}>
          {nf.format(intel.opponentsTotal)} distinct · {nf.format(intel.opponentsRepeat)} met more than once
          {intel.opponents.length < intel.opponentsTotal ? ` · showing the ${intel.opponents.length} most-met` : ''}
        </span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Opponent</th>
              <th>Met</th>
              <th>Record</th>
              <th>Win rate</th>
              <th>Last met</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {intel.opponents.map((o) => {
              const last = battleTimeToIso(o.last);
              return (
                <tr key={o.tag}>
                  <td>
                    <span className={styles.oppName}>{o.name || o.tag}</span>
                    {o.name && <span className={styles.oppTag}>{o.tag}</span>}
                  </td>
                  <td>{o.battles}</td>
                  <td>
                    {o.wins}W {o.losses}L{o.draws ? ` ${o.draws}D` : ''}
                  </td>
                  <td>{o.battles >= H2H_FLOOR ? `${((o.wins / o.battles) * 100).toFixed(0)}%` : <span className={styles.muted}>n={o.battles}</span>}</td>
                  <td>{last ? ago(last) : '—'}</td>
                  <td>
                    {/* Into the scout, which is this workspace's own reading
                        of them and carries the head to head; the full public
                        analysis is one link further on from there. */}
                    <a className={styles.rowLink} href={coachHref(playerTag, 'scout', o.tag)}>
                      Scout →
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
