import { useEffect, useState } from 'react';
import { getCardIconUrl } from '../../data/cards';
import {
  AnalyticsError,
  fetchDuelReport,
  type ApiCombo,
  type DuelReport,
  type TabId,
} from '../../state/analyticsClient';
import { RANGE_PRESETS, useDateWindow, type Season } from './playerData';
import styles from './DuelAnalysis.module.css';

/* Duel Analysis — card COMBINATIONS in duel play.
 *
 * The logic is the Discord bot's Pair Board, ported in server/duel_combos.py;
 * this file only draws it. Two things worth knowing before changing anything:
 *
 *   * There is no synergy score, and its absence is a measured result rather
 *     than a gap. See the note at the top of server/duel_combos.py.
 *   * G1/G2/G3 is a duel deck's position in the loadout. A native duel is
 *     stored as one row carrying all three decks, so this is read out of the
 *     data rather than inferred.
 */

const TAB_ORDER: TabId[] = ['win-conditions', 'spells', 'evolutions'];

const TAB_ICONS: Record<TabId, JSX.Element> = {
  'win-conditions': (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  ),
  spells: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6v5l3 8a4 4 0 0 1-3.7 5.5H9.7A4 4 0 0 1 6 16l3-8z" />
      <path d="M9 3h6M7 16h10" />
    </svg>
  ),
  evolutions: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21V6" />
      <path d="M6 12l6-7 6 7" />
      <path d="M7 17h10" />
    </svg>
  ),
};

const ICONS = {
  swords: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6M16 16l4 4M9.5 6.5 21 18v3h-3L6.5 9.5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
};

const nf = new Intl.NumberFormat('en-US');
const pct = (v: number) => `${v.toFixed(1)}%`;

/** How many rows the table shows before "view all". */
const PAGE = 8;

const SLOT_NAMES = ['G1', 'G2', 'G3'] as const;

/** '2026-08-10' -> '10 Aug'. */
function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function CardPair({ combo, size = 'md' }: { combo: ApiCombo; size?: 'md' | 'lg' }) {
  const cls = size === 'lg' ? styles.pairArtLg : styles.pairArt;
  return (
    <span className={cls}>
      <img src={getCardIconUrl(combo.a)} alt={combo.aName} title={combo.aName} draggable={false} />
      <span className={styles.plus}>+</span>
      <img src={getCardIconUrl(combo.b)} alt={combo.bName} title={combo.bName} draggable={false} />
    </span>
  );
}

/**
 * One loadout slot, as its own bar under its own column heading.
 *
 * The value is the share of every deck played in THAT slot which carried this
 * pair — "how much of my G2 is this combo". Not a share of the pair's own
 * games: the three slots do not hold equal numbers of decks, because a duel
 * decided 2-0 never fields its third.
 *
 * A SEQUENTIAL ramp, not three categorical hues. G1/G2/G3 are ordered
 * positions, so one hue running light-to-dark says "first, second, third"
 * where three unrelated colours would only say "three of something".
 *
 * `scale` is the largest share anywhere in the tab, shared by every bar so the
 * three columns and all the rows are read against one ruler.
 */
function SlotCell({ slot, share, decks, scale }: { slot: number; share: number; decks: number; scale: number }) {
  return (
    <span
      className={styles.slotBar}
      title={`${SLOT_NAMES[slot]} · ${nf.format(decks)} decks · ${share.toFixed(1)}% of ${SLOT_NAMES[slot]}`}
    >
      <span
        className={styles.slotFill}
        data-slot={slot + 1}
        style={{ width: `${scale > 0 ? Math.min(100, (share / scale) * 100) : 0}%` }}
      />
    </span>
  );
}

function TileCombo({
  label,
  combo,
  caption,
}: {
  label: string;
  combo: ApiCombo | null;
  caption: (c: ApiCombo) => string;
}) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      {combo ? (
        <>
          <CardPair combo={combo} size="lg" />
          <span className={styles.tileName}>{combo.name}</span>
          <span className={styles.tileFig}>{caption(combo)}</span>
        </>
      ) : (
        <span className={styles.tileEmpty}>Not enough duels yet</span>
      )}
    </div>
  );
}

export function DuelAnalysis({ tag, season = 'Current Season' }: { tag: string; season?: Season }) {
  const [tab, setTab] = useState<TabId>('win-conditions');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [report, setReport] = useState<DuelReport | null>(null);
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
    fetchDuelReport(tag, win)
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
  }, [tag, preset, custom.from, custom.to]);

  // Switching tabs is switching questions — the open row and the expanded list
  // belong to the tab that was answering the previous one.
  useEffect(() => {
    setExpanded(null);
    setShowAll(false);
  }, [tab]);

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
              : `Nothing in ${tag}'s stored history is a duel or a friendly practice series in this window. Widen the date range, or try a player who plays clan wars.`}
          </p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </section>
      </div>
    );
  }

  const t = report.tabs[tab];
  const rows = showAll ? t.rows : t.rows.slice(0, PAGE);
  const { duels } = report;

  // One ruler for every G1/G2/G3 bar in the tab. Taken from the whole tab, not
  // the visible page, so "view all" cannot rescale the rows already on screen.
  const slotScale = Math.max(1, ...t.rows.flatMap((c) => c.slotShare));

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.headIcon}>{ICONS.swords}</span>
          <div className={styles.headText}>
            <h1 className={styles.title}>Duel Analysis</h1>
            <p className={styles.blurb}>Analyze combinations used in duels.</p>
          </div>

          <div className={styles.headTools}>
            <div className={styles.rangeWrap}>
              <button
                type="button"
                className={styles.rangeButton}
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((o) => !o)}
              >
                {ICONS.calendar}
                {shortDay(report.window.from)} – {shortDay(report.window.to)}
              </button>

              {pickerOpen && (
                <div className={styles.rangePop}>
                  <span className={styles.rangePopLabel}>Preset</span>
                  <div className={styles.rangePresets}>
                    {RANGE_PRESETS.map((r) => (
                      <button
                        key={r.label}
                        type="button"
                        className={`${styles.rangeChip} ${preset === r.days ? styles.rangeChipOn : ''}`}
                        title={
                          r.days > 0 && r.days > report.coverage.days
                            ? `Only ${report.coverage.days} days stored for this player`
                            : undefined
                        }
                        data-beyond={r.days > 0 && r.days > report.coverage.days ? '' : undefined}
                        onClick={() => {
                          setPreset(r.days);
                          if (r.days !== -1) setPickerOpen(false);
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>

                  <span className={styles.rangePopLabel}>Custom range</span>
                  <div className={styles.rangeDates}>
                    <label className={styles.rangeField}>
                      <span>From</span>
                      <input
                        type="date"
                        value={custom.from || report.window.from || ''}
                        min={report.coverage.start ?? undefined}
                        max={custom.to || report.coverage.end || undefined}
                        onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                      />
                    </label>
                    <label className={styles.rangeField}>
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
                      className={styles.rangeApply}
                      disabled={!custom.from || !custom.to}
                      onClick={() => {
                        setPreset(-1);
                        setPickerOpen(false);
                      }}
                    >
                      Apply
                    </button>
                  </div>

                  <p className={styles.rangeNote}>
                    Stored: {report.coverage.start} to {report.coverage.end}
                  </p>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className={styles.tabs} role="tablist">
          {TAB_ORDER.map((id) => {
            const meta = report.tabs[id];
            const on = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`${styles.tab} ${on ? styles.tabOn : ''}`}
                onClick={() => setTab(id)}
              >
                <span className={styles.tabIcon}>{TAB_ICONS[id]}</span>
                {meta.label} (Combo)
                <span className={styles.tabCount}>{meta.eligible}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Total {t.noun} Combos</span>
            <span className={styles.tileBig}>{nf.format(t.eligible)}</span>
            <span className={styles.tileFig}>
              Unique combinations
              <span className={styles.tileSub}>
                from {nf.format(duels.total)} duels · {nf.format(duels.decks)} decks
              </span>
            </span>
          </div>

          <TileCombo
            label="Most Used Combo"
            combo={t.mostUsed}
            caption={(c) => `Use Rate ${pct(c.useRate)}`}
          />
          <TileCombo
            label="Top G2 Combo"
            combo={t.perSlot[1] ?? null}
            caption={(c) => `Use Rate ${pct(c.slotShare[1])}`}
          />
          <TileCombo
            label="Top G3 Combo"
            combo={t.perSlot[2] ?? null}
            caption={(c) => `Use Rate ${pct(c.slotShare[2])}`}
          />
        </div>

        <section className={styles.tablePanel}>
          <header className={styles.tableHead}>
            {/* `noun` is the singular — "Top Win Condition Combos", not
                "Top Win Conditions Combos". */}
            <h2 className={styles.tableTitle}>Top {t.noun} Combos</h2>
            {/* A legend is always present: identity is never colour alone. */}
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <i className={styles.legendDot} data-key="use" /> Use Rate
              </span>
              <span className={styles.legendItem}>
                <i className={styles.legendDot} data-key="win" /> Win Rate
              </span>
              {SLOT_NAMES.map((n, i) => (
                <span key={n} className={styles.legendItem}>
                  <i className={styles.legendDot} data-slot={i + 1} /> {n}
                </span>
              ))}
              <span className={styles.legendNote} title={`Full bar = ${slotScale.toFixed(1)}%`}>
                G-bars share one scale
              </span>
            </div>
          </header>

          {rows.length === 0 ? (
            <p className={styles.empty}>
              No {t.label.toLowerCase()} combination clears the evidence floor yet — a pairing
              needs {report.floors.minGames}+ duel decks and has to appear in at least{' '}
              {report.floors.minDecks} different decks before it is worth a percentage.
              {tab === 'evolutions' && duels.evoCoverage < 60 && (
                <>
                  {' '}
                  Evolution slots are recorded for only {duels.evoCoverage}% of this player&rsquo;s
                  duel decks, so this tab sees less than the other two.
                </>
              )}
            </p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thRank}>Rank</th>
                    <th>Combo</th>
                    <th className={styles.thMeter}>Use Rate</th>
                    <th className={styles.thMeter}>Win Rate</th>
                    {SLOT_NAMES.map((n) => (
                      <th key={n} className={styles.thSlot}>
                        {n}
                      </th>
                    ))}
                    <th className={styles.thChev} aria-label="Details" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => {
                    const key = `${c.a}|${c.b}`;
                    const open = expanded === key;
                    const rank = i + 1;
                    return [
                      <tr
                        key={key}
                        className={`${styles.row} ${open ? styles.rowOpen : ''}`}
                        onClick={() => setExpanded(open ? null : key)}
                      >
                        <td>
                          <span className={styles.rank} data-medal={rank <= 3 ? rank : undefined}>
                            {rank}
                          </span>
                        </td>
                        <td>
                          <span className={styles.combo}>
                            <CardPair combo={c} />
                            <span className={styles.comboName}>{c.name}</span>
                          </span>
                        </td>
                        <td>
                          <span className={styles.meterValue} data-key="use">
                            {pct(c.useRate)}
                          </span>
                          <span className={styles.meter}>
                            <span
                              className={styles.meterFill}
                              data-key="use"
                              style={{ width: `${Math.min(100, c.useRate * 5)}%` }}
                            />
                          </span>
                        </td>
                        <td>
                          <span className={styles.meterValue} data-key="win">
                            {pct(c.winRate)}
                          </span>
                          <span className={styles.meter}>
                            <span
                              className={styles.meterFill}
                              data-key="win"
                              style={{ width: `${c.winRate}%` }}
                            />
                          </span>
                        </td>
                        {c.slotShare.map((share, s) => (
                          <td key={s}>
                            <SlotCell slot={s} share={share} decks={c.slots[s]} scale={slotScale} />
                          </td>
                        ))}
                        <td className={styles.chevCell}>
                          <span className={styles.chev} data-open={open || undefined}>
                            {ICONS.chevron}
                          </span>
                        </td>
                      </tr>,
                      open ? (
                        <tr key={`${key}-d`} className={styles.detailRow}>
                          <td colSpan={8}>
                            <div className={styles.detail}>
                              <Fact
                                label="Duel decks together"
                                value={nf.format(c.games)}
                                note={`${nf.format(c.wins)} won`}
                              />
                              <Fact
                                label="Reach"
                                value={`${c.decks} ${c.decks === 1 ? 'deck' : 'decks'}`}
                                note="different shells it survived into"
                              />
                              <Fact
                                label="Lockstep"
                                value={pct(c.lock)}
                                note={`of decks with either card hold both — ${c.lockClass}`}
                              />
                              <Fact
                                label="Confidence"
                                value={c.tier ? `${c.tier} ${c.interval ?? ''}` : 'not claimed'}
                                note={
                                  c.tier
                                    ? 'Wilson interval on the win rate'
                                    : 'the sample cannot support a win rate'
                                }
                              />
                              <Fact
                                label="Biggest single deck"
                                value={pct(c.topShare)}
                                note="of this pairing's games come from one deck"
                              />
                              <Fact
                                label="By loadout slot"
                                value={c.slots.map((n, s) => `${SLOT_NAMES[s]} ${n}`).join(' · ')}
                                note={c.slotShare
                                  .map((s, n) => `${pct(s)} of ${SLOT_NAMES[n]}`)
                                  .join(' · ')}
                              />
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}

          {t.rows.length > PAGE && (
            <button
              type="button"
              className={styles.viewAll}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? `Show top ${PAGE}` : `View All ${t.noun} Combos (${t.rows.length})`}
              {ICONS.arrow}
            </button>
          )}
        </section>

        <footer className={styles.foot}>
          <p>
            A combo is two cards fielded in the same deck in a duel.{' '}
            <strong>G1/G2/G3</strong> is the deck&rsquo;s position in the loadout, so a combo that
            leans on G3 is one you hold back.
          </p>
          <p>
            {nf.format(duels.total)} duels in this window
            {duels.native > 0 && duels.reconstructed > 0
              ? ` — ${nf.format(duels.native)} native duel rows plus ${nf.format(duels.reconstructed)} rebuilt from friendly series`
              : duels.native > 0
                ? ` — all native duel rows`
                : ` — all rebuilt from consecutive friendly matches, since this player has no clan-war duels stored`}
            . {nf.format(report.pairs.observed)} pairings observed,{' '}
            {nf.format(report.pairs.eligible)} clear the {report.floors.minGames}-deck and{' '}
            {report.floors.minDecks}-shell floors.
          </p>
          <p className={styles.footNote}>
            No synergy score is shown, and that is deliberate: a pair inherits the record of whole
            decks, so a &ldquo;lift over each card apart&rdquo; figure measures deck clustering
            rather than the two cards. Tested against a permutation null and indistinguishable from
            chance. This page reports what it can count.
          </p>
        </footer>
      </section>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{value}</span>
      <span className={styles.factNote}>{note}</span>
    </div>
  );
}
