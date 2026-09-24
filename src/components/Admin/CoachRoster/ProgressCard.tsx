import { ChartCard, InsightRow } from '../../ui/bionis-dashboard';
import { ShieldIcon, TrendIcon } from '../../Dashboard/icons';
import type { FieldProgress, ProgressMatchup } from '../../../state/analyticsClient';
import styles from './CoachRoster.module.css';

/**
 * IS THE WEAKNESS CLOSING? — one component, both screens.
 *
 * The coach's What-to-practise tab and the player's own dashboard draw this
 * from the SAME payload, for the same reason `TodayTab` itself is shared: two
 * renderings of one player's progress would eventually disagree, and the
 * person being coached would be reading a different answer from the one
 * coaching them.
 *
 * ── IT PRINTS MOVEMENT ONLY, AND THAT WAS MEASURED, NOT ASSUMED ────────────
 *
 * The first cut drew a row per matchup. On the real account that is ELEVEN
 * rows and every one of them says "too close to call" — because it is true.
 * Over a 30-day window an archetype is worth 20–60 battles, and telling two
 * win rates apart at that size needs a gap of 16 to 39 points; measured live,
 * a 16.8-point slide against Golem (73.9% over 23, then 57.1% over 21) sits
 * inside a 27.4-point band. Eleven repetitions of one sentence is not honesty,
 * it is a wall, and a reader learns to skip it.
 *
 * So a matchup earns a row by MOVING, and everything else is one counted line
 * that names what it withheld — the Recent Battles footer's rule, where the
 * modes it drops are counted on screen and named in the `title`. An omission
 * the reader cannot see is the failure mode of every filter.
 *
 * THE OVERALL LINE IS ALWAYS DRAWN, because it is the one figure with enough
 * behind it to move: 437 battles against 489 gives a band of 6.2 points, where
 * a single archetype's is 16 to 39.
 *
 * ── THE STATES ARE NOT INTERCHANGEABLE ─────────────────────────────────────
 *
 *   'flat'   the two records CANNOT BE TOLD APART at these sample sizes. Not
 *            "no change" — the change is real and is shown beside the band
 *            that swallows it. A sparkline would draw a confident line.
 *   'thin'   they stopped meeting this deck often enough to be judged. A fact
 *            about the field, not about the player, and drawing it as a
 *            decline would be a lie about somebody's practice.
 *   'unseen' nothing before to compare against. Not a rise from zero.
 */

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

/** 'up' is good everywhere here — every figure is a win rate. */
function toneOf(d: ProgressMatchup['direction'] | 'up' | 'down' | 'flat' | null): 'good' | 'bad' | 'neutral' {
  if (d === 'up') return 'good';
  if (d === 'down') return 'bad';
  return 'neutral';
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function ProgressCard({
  progress,
  /** Second person on the player's own dashboard, third on the coach's. The
   *  figures are identical; only who is being addressed changes. */
  self = false,
}: {
  progress: FieldProgress | null | undefined;
  self?: boolean;
}) {
  if (!progress) return null;

  // TWO ISO RANGES IS NOT A LABEL. "2026-08-26 to 2026-09-24, against
  // 2026-07-27 to 2026-08-25" makes the reader do the subtraction to learn
  // the one thing it is saying: this window against the one before it, and
  // how long they are. The dates stay in the `title` for anyone reconciling.
  const days = (() => {
    const a = progress.window.from;
    const b = progress.window.to;
    if (!a || !b) return null;
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  })();
  const spanNote = days ? `Last ${days}d vs previous ${days}d` : 'vs the window before';
  const spanTitle =
    progress.previous.from && progress.window.from
      ? `${progress.window.from} to ${progress.window.to} against ${progress.previous.from} to ${progress.previous.to}`
      : undefined;

  if (!progress.comparable) {
    const why =
      progress.reason === 'thin_before'
        ? `${progress.overall?.before.battles ?? 0} games before · ${progress.floor} needed`
        : progress.reason === 'thin_now'
          ? `${progress.overall?.now.battles ?? 0} games this window · ${progress.floor} needed`
          : 'No earlier window';
    return (
      <ChartCard title="Is it closing?" note={<span title={spanTitle}>{spanNote}</span>} badge="Not yet">
        <p className={styles.muted}>{why}</p>
      </ChartCard>
    );
  }

  const o = progress.overall;
  const moved = progress.matchups.filter((m) => m.direction === 'up' || m.direction === 'down');
  const flat = progress.matchups.filter((m) => m.direction === 'flat');
  const short = progress.matchups.filter((m) => m.direction === 'thin' || m.direction === 'unseen');

  return (
    <ChartCard
      title="Is it closing?"
      note={<span title={spanTitle}>{spanNote}</span>}
      badge={moved.length > 0 ? `${moved.length} moved` : 'None moved'}
    >
      {o && (
        <InsightRow
          icon={<TrendIcon />}
          tone={toneOf(o.direction)}
          title={`Overall ${pct(o.before.winRate)} → ${pct(o.now.winRate)}${
            o.direction === 'flat' ? '' : ` · ${o.direction === 'up' ? '+' : '−'}${Math.abs(o.change ?? 0).toFixed(1)}`
          }`}
          description={[
            `${o.before.battles} → ${o.now.battles} games`,
            // THE BAND STILL PRINTS. It is the figure that stops a coach
            // acting on noise; only the sentence around it is gone.
            o.direction === 'flat' ? `within ±${o.band?.toFixed(1) ?? '—'} noise` : null,
          ].filter(Boolean).join(' · ')}
        />
      )}

      {moved.map((m) => (
        <InsightRow
          key={m.archetype}
          icon={<ShieldIcon />}
          tone={m.resolved ? 'good' : toneOf(m.direction)}
          title={`${m.name} ${pct(m.before.winRate)} → ${pct(m.now.winRate)} · ${
            m.direction === 'up' ? '+' : '−'
          }${Math.abs(m.change ?? 0).toFixed(1)}`}
          description={[
            `${m.before.battles} → ${m.now.battles} games`,
            m.resolved ? 'no longer a weakness' : null,
          ].filter(Boolean).join(' · ')}
        />
      ))}

      {/* WHAT WAS WITHHELD, COUNTED AND NAMED. The visible line carries the
          count and the reason; the `title` carries every name, so nothing is
          dropped silently — the rule the battle log's hidden-mode footer
          already follows. */}
      {flat.length > 0 && (
        <p
          className={styles.muted}
          title={flat
            .map((m) => `${m.name}: ${pct(m.before.winRate)} → ${pct(m.now.winRate)} (±${m.band?.toFixed(1)} pts, ${m.before.battles}/${m.now.battles} battles)`)
            .join('\n')}
        >
          {flat.length} within noise: {list(flat.map((m) => m.name))}
        </p>
      )}

      {short.length > 0 && (
        <p
          className={styles.muted}
          title={short.map((m) => `${m.name}: ${m.before.battles} before, ${m.now.battles} now`).join('\n')}
        >
          {short.length} under {progress.floor} games: {list(short.map((m) => m.name))}
        </p>
      )}

      {progress.matchups.length === 0 && (
        <p className={styles.muted}>No matchup below {self ? 'your' : 'their'} own rate.</p>
      )}
    </ChartCard>
  );
}
