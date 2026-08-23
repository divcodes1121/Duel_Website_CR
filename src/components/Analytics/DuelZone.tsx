import { useEffect, useState } from 'react';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import {
  AnalyticsError,
  fetchDuelZone,
  type DuelGame,
  type DuelSeries,
  type DuelZoneReport,
  type SequenceDeck,
  type SequenceEntry,
} from '../../state/analyticsClient';
import { RANGE_PRESETS, useDateWindow, type Season } from './playerData';
import styles from './DuelZone.module.css';

/* Duel Zone — two windows over the same duels.
 *
 * The logic is the Discord bot's, ported in server/duel_zone.py; this file only
 * draws it. Worth knowing before changing anything here:
 *
 *   * A series is Bo3 unless a FOURTH game exists. "Someone reached 3 wins" is
 *     not evidence — a Bo3 decided 2-0 whose dead third game is played out
 *     reaches 3-0 in three games and is still a Bo3.
 *   * A native duel row stores the DUEL's result, not each game's, so those
 *     series print no scoreline — an invented one would look exactly like a
 *     real one. The response still carries `source`, `scoreKnown` and the
 *     observed/predicted flag; the UI just does not badge them, by request.
 *   * A sequence row is OBSERVED when a real series shows that exact loadout
 *     (~85% of them) and PREDICTED otherwise. Either way the pair shown is
 *     card-legal — an impossible loadout is filtered out, never rendered.
 */

const WINDOWS = [
  {
    id: 'series' as const,
    label: 'Recent Duels',
    blurb: 'Every Bo3 and Bo5 this player has played, newest first.',
  },
  {
    id: 'sequence' as const,
    label: 'Deck Sequence',
    blurb: 'Which decks follow each opener, and how sure we are.',
  },
];

type WindowId = (typeof WINDOWS)[number]['id'];

const ICONS = {
  zone: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6M16 16l4 4M9.5 6.5 21 18v3h-3L6.5 9.5" />
    </svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 13h8M8 17h5" />
    </svg>
  ),
  crystal: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 5-2.5 11h-9L5 8z" />
      <path d="M9 8h6l-3 11z" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
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
  crown: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M4 18h16l1.2-9-4.7 3.2L12 5l-4.5 7.2L2.8 9z" />
    </svg>
  ),
};

const nf = new Intl.NumberFormat('en-US');
const SLOT_NAMES = ['G1', 'G2', 'G3', 'G4', 'G5'];

/** '2026-08-10T07:46:52Z' -> '10 Aug, 07:46'. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
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

/* Every deck on this screen goes through here, which is also why the copy /
 * open-in-game pair lives inside it rather than at each call site: the series
 * log, the opponent panel, the sequence board and the openers then all get it
 * from one edit.
 *
 * A native duel row carries the whole 16- or 24-card loadout in `cards`, and
 * DeckActions renders nothing unless there are exactly 8 — so those rows get no
 * buttons without this component having to know why. */
function DeckStrip({
  cards,
  art,
  inferred,
  name,
  actions,
  size = 'md',
}: {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  inferred?: boolean;
  name?: string;
  /** Off for the series-log row, whose strip lives inside the row's <button>. */
  actions?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={size === 'sm' ? styles.stripSm : styles.strip}>
      {cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={art?.[c]} inferred={inferred} />
      ))}
      {actions !== false && <DeckActions cards={cards} name={name} />}
    </span>
  );
}

/* ------------------------------------------------------------ window one */

/* One game of a duel, and what the player was up against.
 *
 * The row EXPANDS to show the opponent's eight cards. It used to name their
 * deck in the sub-line and stop there, which tells you the archetype but not
 * the list — and in a duel the list is the point, because card reuse is
 * forbidden and what they spent here cannot come back in the next game.
 *
 * Only rows that HAVE an opponent deck are interactive. A native duel row is
 * one stored row carrying the player's whole loadout and the series result; it
 * has no opponent deck at all, so those rows stay inert rather than opening
 * onto an empty panel. That is storage, not a gap — see duel_zone.py. */
function GameRow({ game, scoreKnown }: { game: DuelGame; scoreKnown: boolean }) {
  const [open, setOpen] = useState(false);
  const won = game.result === 'win';
  const lost = game.result === 'loss';
  const opp = game.opponent;
  const canOpen = !!opp && opp.cards.length > 0;

  return (
    <li className={styles.game} data-outcome={won ? 'win' : lost ? 'loss' : undefined}>
      {/* The row control and the deck actions are SIBLINGS, not nested. The
          whole row is a <button>, and a <button> inside a <button> is invalid
          HTML — the browser closes the outer one early, so the actions would
          land outside the row entirely and the row would stop expanding. */}
      <div className={styles.gameRow}>
      {/* The whole row is the control when there is something to reveal. A
          separate chevron button would put a 20px target inside a row that is
          already the obvious thing to click. */}
      <button
        type="button"
        className={styles.gameRowBtn}
        onClick={() => canOpen && setOpen((o) => !o)}
        aria-expanded={canOpen ? open : undefined}
        disabled={!canOpen}
        title={canOpen ? "Show the opponent's deck" : 'No opponent deck stored for this game'}
      >
        <span className={styles.gameSlot}>{SLOT_NAMES[game.slot] ?? `G${game.slot + 1}`}</span>

        <span className={styles.gameMeta}>
          <span className={styles.gameArch}>{game.deckName || 'Unknown Deck'}</span>
          <span className={styles.gameSub}>
            {game.avgElixir.toFixed(1)} elixir
            {opp?.deckName ? ` · vs ${opp.deckName}` : ''}
          </span>
        </span>

        <DeckStrip cards={game.cards} art={game.art} inferred={game.artInferred} actions={false} />

        {scoreKnown ? (
          <span className={styles.gameResult}>
            <span className={styles.gameBadge}>{won ? 'WIN' : lost ? 'LOSS' : 'DRAW'}</span>
            {typeof game.playerCrowns === 'number' && (
              <span className={styles.crowns} title="Crowns for / against">
                {ICONS.crown}
                {game.playerCrowns}–{game.opponentCrowns ?? 0}
              </span>
            )}
          </span>
        ) : (
          <span className={styles.gameResult}>
            {/* A native row stores the duel's result, not the game's. Saying
                nothing is the honest rendering. */}
            <span className={styles.gameBadgeMuted}>—</span>
          </span>
        )}

        {canOpen && (
          <span className={styles.gameChevron} data-open={open || undefined} aria-hidden="true">
            {ICONS.chevron}
          </span>
        )}
      </button>

        <DeckActions cards={game.cards} name={game.deckName} />
      </div>

      {canOpen && open && opp && (
        <div className={styles.oppPanel}>
          <span className={styles.oppSlot} aria-hidden="true" />
          <span className={styles.oppMeta}>
            <span className={styles.oppLabel}>Opponent</span>
            <span className={styles.oppName}>{opp.deckName || opp.archetype || 'Unknown Deck'}</span>
            {typeof opp.avgElixir === 'number' && (
              <span className={styles.gameSub}>{opp.avgElixir.toFixed(1)} elixir</span>
            )}
          </span>
          {/* Evolutions and heroes, from the opponent's OWN recorded marks —
              the server runs their deck through the same `arrange_deck` the
              player's goes through. `inferred` is carried so a guessed variant
              is flagged in the tooltip rather than passing for an observation. */}
          <DeckStrip
            cards={opp.cards}
            art={opp.art}
            inferred={opp.artInferred}
            name={opp.deckName || opp.archetype}
          />
        </div>
      )}
    </li>
  );
}

function SeriesCard({ series }: { series: DuelSeries }) {
  const score = series.scoreKnown ? `${series.playerWins}–${series.opponentWins}` : null;
  return (
    <article className={styles.series} data-outcome={series.won ? 'win' : 'loss'}>
      <header className={styles.seriesHead}>
        <span className={styles.format}>{series.format.toUpperCase()}</span>

        <span className={styles.seriesScore}>
          {score ?? 'Loadout only'}
          {series.caption && <span className={styles.caption}>{series.caption}</span>}
        </span>

        <span className={styles.seriesOpp}>
          vs <strong>{series.opponentName}</strong>
          <span className={styles.seriesTag}>{series.opponentTag}</span>
        </span>

        <span className={styles.seriesWhen}>{stamp(series.startTime)}</span>
      </header>

      <ol className={styles.games}>
        {series.games.map((g) => (
          <GameRow key={g.slot} game={g} scoreKnown={series.scoreKnown} />
        ))}
      </ol>
    </article>
  );
}

/* ------------------------------------------------------------ window two */

function NextDeck({ deck, index }: { deck: SequenceDeck; index: number }) {
  return (
    <div className={styles.next}>
      <span className={styles.nextHead}>
        <span className={styles.nextSlot}>{SLOT_NAMES[index + 1]}</span>
        <span className={styles.nextArch}>{deck.deckName}</span>
      </span>
      <DeckStrip
        cards={deck.cards}
        art={deck.art}
        inferred={deck.artInferred}
        name={deck.deckName}
        size="sm"
      />
    </div>
  );
}

function SequenceRow({ entry }: { entry: SequenceEntry }) {
  const { opener } = entry;
  return (
    <article className={styles.seq} data-source={entry.source}>
      <div className={styles.opener}>
        <span className={styles.openerHead}>
          <span className={styles.openerSlot}>G1</span>
          <span className={styles.openerArch}>{opener.deckName}</span>
          <span className={styles.openerFig}>
            {opener.count}× · {(opener.prob * 100).toFixed(0)}% of decks
          </span>
        </span>
        <DeckStrip cards={opener.cards} art={opener.art} inferred={opener.artInferred} size="sm" />
      </div>

      <span className={styles.seqArrow} aria-hidden="true">
        {ICONS.arrow}
      </span>

      <div className={styles.nexts}>
        {entry.next.map((d, i) => (
          <NextDeck key={d.cards.join(',')} deck={d} index={i} />
        ))}
        {entry.next.length < 2 && (
          <p className={styles.nextNote}>
            No legal second companion in their known decks — a real one beats an invented pair.
          </p>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------- the screen */

export function DuelZone({ tag, season = 'Current Season' }: { tag: string; season?: Season }) {
  const [pane, setPane] = useState<WindowId>('series');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [report, setReport] = useState<DuelZoneReport | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);

  const { win, preset, setPreset, custom, setCustom } = useDateWindow(
    season,
    report?.coverage.end ?? null,
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchDuelZone(tag, win)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
      })
      .catch((e) => {
        if (!live) return;
        setReport(null);
        setError(e as AnalyticsError);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, preset, win.from, win.to]);

  // Closing on Escape, because a popover that only closes by clicking its own
  // trigger traps a keyboard user.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  if (loading) {
    return (
      <div className={styles.page}>
        <section className={styles.notice}>Reading duel history…</section>
      </div>
    );
  }

  if (error || !report) {
    const offline = error?.kind === 'offline';
    return (
      <div className={styles.page}>
        <section className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'No duels stored for that tag'}
          </h2>
          <p className={styles.noticeBody}>
            {offline
              ? error?.message
              : `Nothing in ${tag}'s stored history is a duel or a friendly practice series.`}
          </p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </section>
      </div>
    );
  }

  const { summary, sequence, series } = report;
  const winRate = summary.games ? (summary.wins / summary.games) * 100 : 0;
  const counts: Record<WindowId, string> = {
    series: `${nf.format(summary.duels)} duels`,
    sequence: `${sequence.entries.length} openers`,
  };

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.headIcon}>{ICONS.zone}</span>
          <div className={styles.headText}>
            <h1 className={styles.title}>Duel Zone</h1>
            <p className={styles.blurb}>
              {nf.format(summary.duels)} duels · {nf.format(summary.games)} games ·{' '}
              {winRate.toFixed(1)}% won
              {summary.native > 0 && ` · ${nf.format(summary.native)} native`}
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

            {/* Any two dates, beside the presets. The popover lives in a
                positioned wrapper with its own stacking order: every panel below
                carries a backdrop-filter, which creates a stacking context, so a
                later panel paints over it whatever its own z-index says. */}
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

        {/* The two windows. Selection is violet, which is what selection means
            everywhere in this app — the panes carry no identity hue of their
            own so the chosen one is unambiguous. */}
        <div className={styles.panes} role="tablist" aria-label="Duel Zone view">
          {WINDOWS.map((w) => {
            const on = pane === w.id;
            return (
              <button
                key={w.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`${styles.pane} ${on ? styles.paneOn : ''}`}
                onClick={() => setPane(w.id)}
              >
                <span className={styles.paneIcon}>{w.id === 'series' ? ICONS.log : ICONS.crystal}</span>
                <span className={styles.paneText}>
                  <span className={styles.paneLabel}>
                    {w.label}
                    <span className={styles.paneCount}>{counts[w.id]}</span>
                  </span>
                  <span className={styles.paneBlurb}>{w.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>

        {pane === 'series' ? (
          <section className={styles.body}>
            {series.length === 0 ? (
              <p className={styles.empty}>
                No duels in this window. Widen the range, or try a player who plays clan wars.
              </p>
            ) : (
              <>
                {series.map((s) => (
                  <SeriesCard key={s.id} series={s} />
                ))}
                {summary.duels > summary.shown && (
                  <p className={styles.more}>
                    Showing the {summary.shown} most recent of {nf.format(summary.duels)} duels in
                    this window.
                  </p>
                )}
              </>
            )}
          </section>
        ) : (
          <section className={styles.body}>
            {sequence.entries.length === 0 ? (
              <p className={styles.empty}>
                Not enough duel series to read a deck sequence yet.
              </p>
            ) : (
              <>
                <p className={styles.legend}>
                  Openers ranked by how often this player brings them, each followed by the two
                  decks that come with it. A duel loadout cannot repeat a card, so a pair that
                  shares one is impossible and is never shown.
                  {sequence.lowConfidence && ' Thin history: read these as a hint, not a read.'}
                </p>
                {sequence.entries.map((e) => (
                  <SequenceRow key={e.opener.cards.join(',')} entry={e} />
                ))}
              </>
            )}
          </section>
        )}

        <footer className={styles.foot}>
          Window {shortDay(report.window.from)} – {shortDay(report.window.to)} ·{' '}
          {nf.format(summary.duels)} duels
          {summary.archiveUsed ? ' · archive tier included' : ''}
        </footer>
      </section>
    </div>
  );
}
