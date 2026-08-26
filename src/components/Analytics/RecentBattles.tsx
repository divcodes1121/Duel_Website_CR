import { useEffect, useState } from 'react';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { ReadingState } from './ReadingState';
import { VsMark } from '../VsMark/VsMark';
import { RANGE_PRESETS, useDateWindow, type Season } from './playerData';
import {
  AnalyticsError,
  fetchRecentBattles,
  type BattleSide,
  type RecentBattle,
  type RecentBattlesReport,
} from '../../state/analyticsClient';
import styles from './RecentBattles.module.css';
import { useHeldLoading } from '../../hooks/useHeldLoading';

/* Recent Battles — the raw log, newest first.
 *
 * Every other analytics screen aggregates. This one lists, and that is the
 * point: a reader who does not yet trust the pair board or the meta ranking
 * wants to see the rows those were computed from.
 *
 * THE TWO DECKS SIT SIDE BY SIDE, not stacked. A battle is a comparison — what
 * they brought against what you brought — and a comparison you have to scroll
 * between is not one you can make. Each side is a 4x2 block of eight cards, so
 * the pair reads as two objects of equal weight with the score between them.
 * Below 900px there is no room for two blocks abreast and they stack, with the
 * VS becoming a divider rather than a centrepiece.
 *
 * PAGED BY THE SERVER, ten at a time. The date range picks the pool; the pager
 * walks it. The summary always describes the WHOLE window, never the page —
 * a win rate that changed as you turned pages would be describing ten battles
 * while sitting under a control that says thirty days.
 */

const nf = new Intl.NumberFormat('en-US');

const ICONS = {
  log: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16M4 12h16M4 19h10" />
      <circle cx="19" cy="19" r="2.5" />
    </svg>
  ),
  crown: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M4 18h16l1.2-9-4.7 3.2L12 5l-4.5 7.2L2.8 9z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  prev: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
};

/** '20260824T104652.000Z' -> '24 Aug, 10:46'. */
function stamp(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(raw || '');
  if (!m) return raw || '—';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  if (Number.isNaN(d.getTime())) return raw;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(
    'en-GB',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

/** '2026-08-10' -> '10 Aug'. */
function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/* One player's eight cards as a 4x2 block, with their NAME above and their
 * deck below. The two of these in a row are deliberately identical components:
 * rendering the opponent plainer than the player would make the two strips
 * incomparable, which is the one thing the row exists to let you do.
 *
 * THE NAME, NOT THE TAG. A tag identifies a player to the API; it does not
 * tell a reader who they played. The tag is still on the element as a
 * tooltip, so it can be read off and searched, but it is not what the row
 * says. When no name has ever been stored the tag is the fallback — it is the
 * only identifier that always exists. */
function Side({
  side,
  name,
  tag,
  align,
}: {
  side: BattleSide;
  name: string;
  tag?: string;
  align: 'left' | 'right';
}) {
  return (
    <div className={styles.side} data-align={align}>
      <div className={styles.sideHead}>
        <span className={styles.sideName} title={tag ? `${name} · ${tag}` : name}>
          {name}
        </span>
      </div>

      <div className={styles.grid}>
        {side.cards.map((c, i) => (
          <CardArt
            key={`${c}-${i}`}
            card={c}
            variant={side.art?.[c]}
            inferred={side.artInferred}
            className={styles.card}
          />
        ))}
      </div>

      <div className={styles.sideFoot}>
        <span className={styles.deckName} title={side.deckName}>
          {side.deckName}
        </span>
        <span className={styles.elixir}>{side.avgElixir.toFixed(1)} elixir</span>
        {/* Renders nothing unless the side really is eight known cards, which
            is what keeps it off a native duel row's 16-card loadout. */}
        <DeckActions cards={side.cards} name={side.deckName} />
      </div>
    </div>
  );
}

function BattleRow({ battle, you, youTag }: { battle: RecentBattle; you: string; youTag: string }) {
  const won = battle.result === 'win';
  const lost = battle.result === 'loss';
  return (
    <article className={styles.battle} data-outcome={battle.result}>
      <header className={styles.head}>
        <span className={styles.mode}>{battle.modeLabel}</span>

        <span className={styles.score}>
          <span className={styles.crown} data-side="mine">
            {ICONS.crown}
            {battle.crowns}
          </span>
          <span className={styles.dash}>–</span>
          <span className={styles.crown} data-side="theirs">
            {battle.opponentCrowns}
            {ICONS.crown}
          </span>
        </span>

        <span className={styles.outcome} data-outcome={battle.result}>
          {won ? 'Victory' : lost ? 'Defeat' : 'Draw'}
        </span>

        <span className={styles.when}>{stamp(battle.battleTime)}</span>
      </header>

      {/* The comparison itself. `vs` is a separate cell rather than a border so
          it can carry the divider on a narrow screen without the two blocks
          having to know which of them is on top. */}
      <div className={styles.versus}>
        <Side side={battle.player} name={you} tag={youTag} align="left" />
        <span className={styles.vs}>
          <VsMark size="lg" />
        </span>
        <Side
          side={battle.opponent}
          name={battle.opponent.name || battle.opponent.tag || 'Unknown'}
          tag={battle.opponent.tag}
          align="right"
        />
      </div>
    </article>
  );
}

/* The pager. Numbered rather than "load more": the log is ordered by time, and
 * a reader looking for a battle from last Tuesday wants to jump, not to press
 * a button eleven times. Windows around the current page so the control does
 * not grow with the history. */
function Pager({
  page,
  pages,
  onGo,
  busy,
}: {
  page: number;
  pages: number;
  onGo: (p: number) => void;
  busy: boolean;
}) {
  if (pages <= 1) return null;

  const span = 2;
  const nums: (number | 'gap')[] = [];
  let last = 0;
  for (let i = 1; i <= pages; i++) {
    const near = Math.abs(i - page) <= span;
    if (i === 1 || i === pages || near) {
      if (last && i - last > 1) nums.push('gap');
      nums.push(i);
      last = i;
    }
  }

  return (
    <nav className={styles.pager} aria-label="Battle log pages">
      <button
        type="button"
        className={styles.pageStep}
        disabled={page <= 1 || busy}
        onClick={() => onGo(page - 1)}
        aria-label="Previous page"
      >
        {ICONS.prev}
      </button>

      {nums.map((n, i) =>
        n === 'gap' ? (
          <span key={`gap-${i}`} className={styles.pageGap}>
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={`${styles.pageNum} ${n === page ? styles.pageNumOn : ''}`}
            aria-current={n === page ? 'page' : undefined}
            disabled={busy}
            onClick={() => onGo(n)}
          >
            {n}
          </button>
        ),
      )}

      <button
        type="button"
        className={styles.pageStep}
        disabled={page >= pages || busy}
        onClick={() => onGo(page + 1)}
        aria-label="Next page"
      >
        {ICONS.next}
      </button>
    </nav>
  );
}

export function RecentBattles({ tag, season = 'Current Season' }: { tag: string; season?: Season }) {
  const [report, setReport] = useState<RecentBattlesReport | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  /* HELD ONLY ON THE FIRST READ. Turning a page is a fetch too, but replacing
     the whole panel with a loader every time would make the pager feel like a
     navigation instead of a control — the rows dim in place instead. */
  const reading = useHeldLoading(loading && !report);

  const { win, preset, setPreset, custom, setCustom } = useDateWindow(
    season,
    report?.coverage.end ?? null,
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchRecentBattles(tag, win, page)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
        // The server CLAMPS a page past the end rather than erroring, so the
        // page it answered with is the truth — adopt it, or the pager would
        // keep highlighting a page that does not exist.
        if (r.page !== page) setPage(r.page);
      })
      .catch((e) => {
        if (!live) return;
        setReport(null);
        setError(e as AnalyticsError);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, preset, win.from, win.to, page]);

  // A new window is a new pool, so it starts at the top rather than at
  // whatever page number happened to be showing.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, preset, win.from, win.to]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  if (reading) {
    return (
      <div className={styles.page}>
        <ReadingState k="recent-battles" hue="violet">
          Reading the battle log…
        </ReadingState>
      </div>
    );
  }

  if (error || !report) {
    const offline = error?.kind === 'offline';
    return (
      <div className={styles.page}>
        <section className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'No battles stored for that tag'}
          </h2>
          <p className={styles.noticeBody}>
            {offline ? error?.message : `Nothing is stored for ${tag} yet.`}
          </p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </section>
      </div>
    );
  }

  const { summary } = report;
  const decided = summary.wins + summary.losses;
  const winRate = decided ? (summary.wins / decided) * 100 : 0;
  /* The searched player's own name, from the report. Falls back to the tag
     when we have never seen one — better a tag than an empty label. */
  const you = report.player?.name || tag;

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.panelIcon}>{ICONS.log}</span>
          <div className={styles.panelHeadText}>
            <h1 className={styles.title}>Recent Battles</h1>
            <p className={styles.blurb}>
              {nf.format(summary.battles)} battles · {summary.wins}W {summary.losses}L
              {summary.draws ? ` ${summary.draws}D` : ''} · {winRate.toFixed(1)}% won
            </p>
          </div>

          <div className={styles.range}>
            {RANGE_PRESETS.filter((r) => r.days >= 0).map((r) => (
              <button
                key={r.label}
                type="button"
                className={`${styles.rangeChip} ${preset === r.days ? styles.rangeChipOn : ''}`}
                data-beyond={r.days > 0 && r.days > report.coverage.days ? '' : undefined}
                title={
                  r.days > 0 && r.days > report.coverage.days
                    ? `Only ${report.coverage.days} days stored for this player`
                    : undefined
                }
                onClick={() => {
                  setPreset(r.days);
                  setPickerOpen(false);
                }}
              >
                {r.label.replace('Last ', '').replace(' Days', 'd').replace('All Data', 'All')}
              </button>
            ))}

            <span className={styles.customWrap}>
              <button
                type="button"
                className={`${styles.rangeChip} ${preset === -1 ? styles.rangeChipOn : ''}`}
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((o) => !o)}
              >
                {ICONS.calendar}
                {preset === -1 && custom.from && custom.to
                  ? `${shortDay(custom.from)} – ${shortDay(custom.to)}`
                  : 'Custom'}
                {ICONS.chevron}
              </button>

              {pickerOpen && (
                <div className={styles.customPop}>
                  <span className={styles.customLabel}>Custom range</span>
                  <label className={styles.customField}>
                    <span>From</span>
                    <input
                      type="date"
                      value={custom.from || report.window.from || ''}
                      min={report.coverage.start ?? undefined}
                      max={custom.to || report.coverage.end || undefined}
                      onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                    />
                  </label>
                  <label className={styles.customField}>
                    <span>To</span>
                    <input
                      type="date"
                      value={custom.to || report.window.to || ''}
                      min={custom.from || report.coverage.start || undefined}
                      max={report.coverage.end ?? undefined}
                      onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.customApply}
                    disabled={!custom.from || !custom.to}
                    onClick={() => {
                      setPreset(-1);
                      setPickerOpen(false);
                    }}
                  >
                    Apply
                  </button>
                  <p className={styles.customNote}>
                    Stored: {report.coverage.start} to {report.coverage.end}
                  </p>
                </div>
              )}
            </span>
          </div>
        </header>

        <section className={styles.body} data-busy={loading || undefined}>
          {report.battles.length === 0 ? (
            <p className={styles.empty}>
              No battles stored in this window. Widen the range, or check back after the next
              collection pass.
            </p>
          ) : (
            report.battles.map((b) => <BattleRow key={b.id} battle={b} you={you} youTag={tag} />)
          )}
        </section>

        <footer className={styles.foot}>
          <Pager page={report.page} pages={report.pages} onGo={setPage} busy={loading} />
          <span className={styles.count}>
            {report.total > 0 && (
              <>
                {(report.page - 1) * report.perPage + 1}–
                {Math.min(report.page * report.perPage, report.total)} of{' '}
                {nf.format(report.total)}
              </>
            )}
            {summary.archiveUsed ? ' · archive tier included' : ''}
          </span>
        </footer>
      </section>
    </div>
  );
}
