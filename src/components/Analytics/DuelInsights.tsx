import { useEffect, useMemo, useState } from 'react';
import { CardArt } from './CardArt';
import { ReadingState } from './ReadingState';
import { DeckActions } from '../DeckActions/DeckActions';
import {
  fetchDuelZone,
  type DateWindow,
  type DuelZoneReport,
} from '../../state/analyticsClient';
import {
  MIN_DECK_USES,
  MIN_SERIES,
  adaptation,
  keyInsights,
  lineup,
  opponents,
  performance,
  reveals,
  verdicts,
  withGames,
  type DeckSlotRow,
  type Rate,
  type Verdict,
} from './duelInsightRules';
import styles from './DuelInsights.module.css';
import { useHeldLoading } from '../../hooks/useHeldLoading';

/* Duel Insights — the interpretation layer at the foot of Duel Analysis.
 *
 * IT FETCHES ITS OWN DATA, and that is the design rather than an oversight.
 * The page above is the Pair Board: `DuelReport` is card COMBINATIONS and holds
 * no series, no games, no results and no opponents. None of the questions this
 * section answers can be asked of it. The series log lives behind a different
 * endpoint, so this component loads that one itself, in its own effect, with
 * its own loading and error state — the existing fetch, tabs, filters and table
 * are untouched, and if this request fails the page above loses nothing.
 *
 * IT IS HONEST ABOUT WHICH DUELS IT CAN SEE. A native duel row stores the whole
 * loadout and the SERIES result, with no per-game scoreline and no opponent
 * deck — measured, all 114 native games on a 96-duel player came back empty on
 * both. So every game-level figure here is computed over reconstructed series
 * only, and the footer says how many that was. Nothing is inferred to fill the
 * gap.
 */

const ICONS = {
  insight: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
    </svg>
  ),
};

const pct = (n: number) => `${n.toFixed(0)}%`;

function Fact({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | null;
  note: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      {value === null ? (
        <span className={styles.thin}>Not enough data</span>
      ) : (
        <span className={styles.factValue} data-tone={tone}>
          {value}
        </span>
      )}
      <span className={styles.factNote}>{note}</span>
    </div>
  );
}

/** A rate tile: the percentage where the floor is cleared, the record either
 *  way. A record is a count of things that happened and needs no sample size;
 *  a percentage is an estimate and does. */
function RateFact({
  label,
  rate,
  note,
  goodAbove = 55,
}: {
  label: string;
  rate: Rate | null;
  note?: string;
  goodAbove?: number;
}) {
  return (
    <Fact
      label={label}
      value={rate ? pct(rate.pct) : null}
      note={rate ? `${rate.wins} of ${rate.total}` : (note ?? `needs ${MIN_SERIES}`)}
      tone={rate ? (rate.pct >= goodAbove ? 'good' : rate.pct <= 45 ? 'bad' : undefined) : undefined}
    />
  );
}

function DeckPick({ label, row }: { label: string; row: DeckSlotRow | null }) {
  if (!row) {
    return <Fact label={label} value={null} note={`needs ${MIN_DECK_USES} uses`} />;
  }
  return (
    <div className={styles.deckPick}>
      <span className={styles.factLabel}>{label}</span>
      <div className={styles.deckPickHead}>
        <span className={styles.deckName}>{row.deckName}</span>
        <span className={styles.deckRate}>{pct(row.pct)}</span>
      </div>
      <div className={styles.strip}>
        {row.cards.map((c) => (
          <CardArt key={c} card={c} variant={row.art?.[c]} />
        ))}
        <DeckActions cards={row.cards} name={row.deckName} />
      </div>
      <span className={styles.factNote}>
        {row.wins} of {row.uses} games won
      </span>
    </div>
  );
}

function VerdictRow({ v }: { v: Verdict }) {
  return (
    <div className={styles.verdict} data-tone={v.tone}>
      <span className={styles.dot} aria-hidden="true" />
      <div>
        <span className={styles.verdictTitle}>{v.title}</span>
        <p className={styles.verdictBody}>{v.body}</p>
      </div>
    </div>
  );
}

export function DuelInsights({ tag, win }: { tag: string; win: DateWindow }) {
  const [report, setReport] = useState<DuelZoneReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const reading = useHeldLoading(loading);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetchDuelZone(tag, win)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        // Silent by design: this is an extra section under a page that already
        // works. A second error banner for a panel the reader did not ask for
        // would make the page look broken when it is not.
        if (alive) {
          setReport(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, win.days, win.from, win.to]);

  const calc = useMemo(() => {
    const all = report?.series ?? [];
    const perf = performance(all);
    const line = lineup(all);
    const adapt = adaptation(all);
    const opp = opponents(all);
    const rev = reveals(all);
    const found = verdicts(perf, adapt, line, opp);
    return { all, perf, line, adapt, opp, rev, verdicts: found, key: keyInsights(found) };
  }, [report]);

  if (failed) return null;

  if (reading) {
    return (
      <ReadingState k="duel-insights" hue="green">
        Reading the duel series log…
      </ReadingState>
    );
  }

  const { all, perf, line, adapt, opp, rev } = calc;
  const detail = withGames(all).length;

  if (!all.length) return null;

  return (
    <section className={styles.section} aria-labelledby="duel-insights">
      <header className={styles.sectionHead}>
        <span className={styles.headIcon}>{ICONS.insight}</span>
        <div>
          <h2 className={styles.title} id="duel-insights">
            Duel Insights
          </h2>
          <p className={styles.blurb}>Strategic patterns discovered from your duel history.</p>
        </div>
      </header>

      <div className={styles.row}>
        {/* 1 — performance */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Duel performance</h3>
          <div className={styles.facts}>
            <Fact
              label="Series record"
              value={`${perf.seriesRecord.wins}–${perf.seriesRecord.total - perf.seriesRecord.wins}`}
              note={`${perf.seriesRecord.total} duels`}
            />
            <RateFact label="Series win rate" rate={perf.seriesRate} />
            <RateFact label="Game win rate" rate={perf.gameRate} />
            <RateFact label="Game 1 win rate" rate={perf.game1Rate} />
            <RateFact label="Decider win rate" rate={perf.deciderRate} />
          </div>
          {perf.scorelines.length > 0 && (
            <div className={styles.scorelines}>
              {perf.scorelines.map((s) => (
                <span key={s.label} className={styles.score} data-won={s.won}>
                  <span className={styles.scoreLabel}>{s.label}</span>
                  {'×'}
                  {s.count}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 3 — adaptation */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Adaptation</h3>
          <div className={styles.facts}>
            <RateFact label="Series after winning G1" rate={adapt.afterG1Win} goodAbove={70} />
            <RateFact label="Series after losing G1" rate={adapt.afterG1Loss} goodAbove={45} />
            <RateFact label="G2 after winning G1" rate={adapt.g2AfterG1Win} />
            <RateFact label="G2 after losing G1" rate={adapt.g2AfterG1Loss} />
          </div>
          {calc.verdicts
            .filter((v) => v.id.startsWith('adapt') || v.id === 'convert')
            .map((v) => (
              <VerdictRow key={v.id} v={v} />
            ))}
        </div>
      </div>

      {/* 2 — lineup */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Lineup insights</h3>
        <div className={styles.row}>
          <DeckPick label="Best opener" row={line.bestOpener} />
          <DeckPick label="Best decider" row={line.bestDecider} />
        </div>
        {line.bestLineup ? (
          <div className={styles.deckPick}>
            <span className={styles.factLabel}>Best full lineup</span>
            <div className={styles.lineupOrder}>
              {line.bestLineup.order.map((name, i) => (
                <span key={`${name}-${i}`}>
                  {i > 0 && <span className={styles.arrow}> {'→'} </span>}
                  {name}
                </span>
              ))}
            </div>
            <span className={styles.factNote}>
              {pct(line.bestLineup.pct)} series win rate — {line.bestLineup.wins} of{' '}
              {line.bestLineup.uses}
            </span>
          </div>
        ) : (
          <Fact
            label="Best full lineup"
            value={null}
            note={`no order repeated ${MIN_DECK_USES} times`}
          />
        )}

        {/* Per-position win rates, which is the "which deck works where"
            question the three picks above only answer at the top. */}
        {line.perSlot.some((s) => s.length > 0) && (
          <div className={styles.row}>
            {line.perSlot.map((rows, slot) =>
              rows.length === 0 ? null : (
                <div key={slot}>
                  <span className={styles.factLabel}>Game {slot + 1} decks</span>
                  <div className={styles.list}>
                    {rows.slice(0, 5).map((r) => (
                      <div key={r.deckName} className={styles.listRow}>
                        <span className={styles.listName}>{r.deckName}</span>
                        <span className={styles.listMeta}>
                          {r.wins}/{r.uses}
                        </span>
                        <span className={styles.listPct}>
                          {r.uses >= MIN_DECK_USES ? pct(r.pct) : '—'}
                        </span>
                        <span className={styles.meter}>
                          <span
                            className={styles.meterFill}
                            style={{ width: `${Math.max(2, r.pct)}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className={styles.row}>
        {/* 5 — opponents */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Opponent patterns</h3>
          {opp.known === 0 ? (
            <p className={styles.empty}>
              No opponent decks are recorded for these duels. A native duel row stores your loadout
              and the result, not what you were facing.
            </p>
          ) : (
            <>
              <div className={styles.facts}>
                <Fact
                  label="Usual answer to your opener"
                  value={opp.vsOpener ? opp.vsOpener.archetype : null}
                  note={
                    opp.vsOpener
                      ? `${pct(opp.vsOpener.share)} of tracked openers`
                      : `needs ${MIN_SERIES} series`
                  }
                />
                <Fact
                  label="Best matchup"
                  value={opp.best ? `${opp.best.archetype} ${pct(opp.best.pct)}` : null}
                  note={opp.best ? `${opp.best.wins} of ${opp.best.games} games` : 'no ranked matchup'}
                  tone={opp.best ? 'good' : undefined}
                />
                <Fact
                  label="Worst matchup"
                  value={opp.worst ? `${opp.worst.archetype} ${pct(opp.worst.pct)}` : null}
                  note={
                    opp.worst ? `${opp.worst.wins} of ${opp.worst.games} games` : 'no ranked matchup'
                  }
                  tone={opp.worst ? 'bad' : undefined}
                />
              </div>
              <div className={styles.list}>
                {opp.archetypes.slice(0, 5).map((a) => (
                  <div key={a.archetype} className={styles.listRow}>
                    <span className={styles.listName}>{a.archetype}</span>
                    <span className={styles.listMeta}>
                      {a.wins}/{a.games}
                    </span>
                    <span className={styles.listPct}>{a.games >= 5 ? pct(a.pct) : '—'}</span>
                  </div>
                ))}
              </div>
              {/* Only worth saying when something IS missing. "95 of 95 games —
                  the rest carried no opponent deck" describes an empty set. */}
              {opp.known < opp.total && (
                <p className={styles.foot}>
                  Measured over {opp.known} of {opp.total} games — the rest carried no opponent
                  deck.
                </p>
              )}
            </>
          )}
        </div>

        {/* 4 — predictability */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Lineup weakness</h3>
          <div className={styles.facts}>
            <Fact
              label="Most-used opener"
              value={line.topOpenerShare !== null ? line.topOpenerName : null}
              note={
                line.topOpenerShare !== null
                  ? `${pct(line.topOpenerShare)} of your duels`
                  : `needs ${MIN_SERIES} series`
              }
            />
            <Fact
              label="Different openers"
              value={line.distinctOpeners ? String(line.distinctOpeners) : null}
              note="decks seen in game 1"
            />
          </div>
          {calc.verdicts
            .filter((v) => v.id === 'predictable' || v.id === 'varied' || v.id === 'matchup-weak')
            .map((v) => (
              <VerdictRow key={v.id} v={v} />
            ))}
          {!calc.verdicts.some((v) => ['predictable', 'varied', 'matchup-weak'].includes(v.id)) && (
            <p className={styles.empty}>
              Nothing in this window stands out as exploitable, which is not the same as nothing
              being there — it is what {detail} series can support.
            </p>
          )}
        </div>
      </div>

      {/* 6 — information */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Card &amp; information</h3>
        <div className={styles.facts}>
          <Fact
            label="Cards you reveal"
            value={rev.avgPlayerRevealed !== null ? rev.avgPlayerRevealed.toFixed(1) : null}
            note="distinct, per series"
          />
          <Fact
            label="Cards they reveal"
            value={rev.avgOpponentRevealed !== null ? rev.avgOpponentRevealed.toFixed(1) : null}
            note="distinct, per series"
          />
          <Fact
            label="Full three-deck series"
            value={String(rev.fullLoadouts)}
            note={`of ${rev.seriesCounted} with game detail`}
          />
        </div>
        <p className={styles.foot}>
          A duel forbids card reuse across the three decks, so every game played narrows what can
          still appear. These are the cards actually recorded as played — a deck that was never
          reached was never stored, so nothing here guesses at an unseen loadout.
        </p>
      </div>

      {/* 8 — the key insight */}
      {calc.key.length > 0 && (
        <div className={styles.key}>
          <h3 className={styles.keyTitle}>Key insight</h3>
          {calc.key.map((v) => (
            <VerdictRow key={v.id} v={v} />
          ))}
        </div>
      )}

    </section>
  );
}
