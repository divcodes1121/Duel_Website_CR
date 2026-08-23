import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { ReportButton } from '../Export/ReportButton';
import { livePlayerReportDoc } from '../../utils/reportAdapters';
import type { LivePlayerReport } from '../../state/analyticsClient';
import styles from './LivePlayer.module.css';

/* The analysis screen for a player nobody has tracked yet.
 *
 * WHY THIS SCREEN EXISTS. `battles.db` holds what the bot polled, so the first
 * time anyone searches a tag there is nothing stored and the screen used to
 * 404 — while the game had been keeping that player's recent battles the whole
 * time. The server now queues the tag for collection AND answers from the live
 * Clash Royale battlelog, so a first search lands on real data about the right
 * player instead of a dead end.
 *
 * WHY IT IS NOT THE STORED SCREEN WITH DIFFERENT NUMBERS IN IT. Everything the
 * stored view is built around is missing here and cannot be faked:
 *
 *   - The window is FIXED. Supercell serves the last ~25 battles and does not
 *     paginate, so a date control would be a control that changes nothing.
 *   - There is no PREVIOUS window, so no movement, no deltas, no trend lines.
 *   - The sample is far under this project's own evidence floor
 *     (`CONF_MIN_GAMES` = 8), so a win rate here is not the same kind of claim
 *     as a win rate on the stored screen.
 *
 * Rather than let those differences hide inside a familiar layout, the screen
 * states its basis at the top, prints the denominator beside every rate, and
 * says what happens next. The one thing it must never do is look like the
 * stored screen, because then the same figure would mean two different things
 * on two different days.
 */

/** The API reports rates on a 0-100 scale, the same as every other analytics
 *  endpoint — so this formats, it does not convert. */
function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** '20260814T092608.000Z' -> '14 Aug, 09:26'. The live API's compact form is
 *  not an ISO string Date can parse, so it is unpacked by hand. */
function stamp(raw: string | null): string {
  if (!raw || raw.length < 15) return '—';
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(
    9,
    11,
  )}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function LivePlayer({ report, tag }: { report: LivePlayerReport; tag: string }) {
  const { tracking, profile } = report;
  const decided = report.wins + report.losses;

  return (
    <div className={styles.page}>
      {/* THE BASIS, FIRST AND UNMISSABLE. Every number below it is computed over
          ~25 battles; a reader who misses that will read them as the stored
          screen's numbers, which are computed over months. */}
      <section className={styles.basis}>
        <span className={styles.basisTag}>Live</span>
        <div className={styles.basisText}>
          <h2 className={styles.basisTitle}>
            Straight from the Clash Royale API — {report.battles}{' '}
            {report.battles === 1 ? 'battle' : 'battles'}
          </h2>
          <p className={styles.basisBody}>
            No stored history for <strong>{tag}</strong> yet, so this is their most recent
            play as the game reports it. {report.limits.note}
          </p>
        </div>
      </section>

      {/* What searching actually started. The three states mean different
          things to someone waiting for data, so they are worded differently
          rather than collapsed into one reassuring sentence. */}
      <section className={styles.tracking} data-state={tracking.state}>
        <span className={styles.trackDot} aria-hidden="true" />
        <div>
          <strong className={styles.trackTitle}>
            {tracking.state === 'tracked'
              ? 'Collecting this player'
              : tracking.state === 'pending'
                ? 'Queued for collection'
                : 'Not queued'}
          </strong>
          <p className={styles.trackBody}>
            {tracking.state === 'tracked'
              ? 'Their history is being recorded. The full analysis appears here as it builds up.'
              : tracking.state === 'pending'
                ? `Added to the collection queue${
                    tracking.requestedAt ? ` on ${tracking.requestedAt.slice(0, 10)}` : ''
                  }. Nothing is being recorded yet — the collector picks up queued tags on its own schedule, and this screen switches to the full analysis once it has.`
                : 'This tag could not be queued. The analysis below is still live and correct.'}
          </p>
        </div>
      </section>

      <section className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{report.battles}</span>
          <span className={styles.statLabel}>Battles</span>
          <span className={styles.statNote}>
            {report.skipped > 0
              ? `${report.skipped} of ${report.logSize} skipped — 2v2 or a given deck`
              : `all ${report.logSize} in the log`}
          </span>
        </div>
        <div className={styles.stat}>
          {/* The denominator is printed because at this sample size it is the
              more informative half: 60% of 5 and 60% of 5,000 are not the same
              statement, and only one of them is worth acting on. */}
          <span className={styles.statValue}>{decided ? pct(report.winRate) : '—'}</span>
          <span className={styles.statLabel}>Win rate</span>
          <span className={styles.statNote}>
            {report.wins}W {report.losses}L{report.draws ? ` ${report.draws}D` : ''}
            {decided ? ` — over ${decided}` : ''}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {report.crownsFor}–{report.crownsAgainst}
          </span>
          <span className={styles.statLabel}>Crowns</span>
          <span className={styles.statNote}>for and against</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {report.trophyChange > 0 ? '+' : ''}
            {report.trophyChange}
          </span>
          <span className={styles.statLabel}>Trophies</span>
          <span className={styles.statNote}>
            {profile?.trophies != null ? `now ${profile.trophies}` : 'across this log'}
          </span>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Decks played</h3>
          <span className={styles.panelNote}>
            {stamp(report.span.from)} → {stamp(report.span.to)}
            <ReportButton build={() => livePlayerReportDoc(report, tag)} />
          </span>
        </header>

        {report.decks.length === 0 ? (
          <p className={styles.empty}>
            No complete 8-card deck in this log. Duel rows carry a whole loadout rather
            than one deck, so they are counted in the totals above but cannot be listed
            here.
          </p>
        ) : (
          <ul className={styles.deckList}>
            {report.decks.map((d) => (
              <li key={d.hash} className={styles.deckRow}>
                <div className={styles.deckIdent}>
                  <span className={styles.deckName}>{d.name}</span>
                  <span className={styles.deckMeta}>
                    {d.games} {d.games === 1 ? 'battle' : 'battles'} · {pct(d.useRate)} of
                    play · {d.wins}W {d.games - d.wins}L
                  </span>
                </div>
                {/* Art comes from the live payload's own `evolutionLevel`, so
                    unlike the stored path there is nothing inferred here — a
                    card with no mark was genuinely fielded plain. */}
                <div className={styles.deckStrip}>
                  {d.cards.map((c) => (
                    <CardArt key={c} card={c} variant={d.art[c]} className={styles.cardImg} />
                  ))}
                  <DeckActions cards={d.cards} name={d.name} />
                </div>
                <div className={styles.deckRate}>
                  <span className={styles.deckRateValue}>{pct(d.winRate)}</span>
                  <span className={styles.deckRateLabel}>win rate</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Cards</h3>
          <span className={styles.panelNote}>by battles played</span>
        </header>
        <div className={styles.cardGrid}>
          {report.cards.map((c) => (
            <div
              key={c.key}
              className={styles.cardTile}
              title={`${c.name} — ${c.games} battles, ${c.wins} won (${pct(c.winRate)})`}
            >
              <CardArt card={c.key} className={styles.cardImg} />
              <span className={styles.cardUse}>{c.games}</span>
            </div>
          ))}
        </div>
      </section>

      {report.modes.length > 1 && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <h3 className={styles.panelTitle}>Modes</h3>
          </header>
          <ul className={styles.modeList}>
            {report.modes.map((m) => (
              <li key={m.mode} className={styles.modeRow}>
                <span className={styles.modeName}>{m.mode.replace(/_/g, ' ')}</span>
                <span className={styles.modeCount}>{m.battles}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
