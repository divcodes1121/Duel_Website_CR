import { useMemo } from 'react';
import { CardArt } from '../CardArt';
import { CrownIcon } from '../../Dashboard/icons';
import { CARDS_BY_KEY } from '../../../data/cards';
import { initialsOf } from '../../../utils/initials';
import type { Replay, ReplayEvent, ReplaySide } from '../../../utils/replayParse';
import {
  cardName,
  clock,
  elixirAt,
  zoneLabel,
  type CycleState,
  type ElixirPoint,
  type SideSummary,
} from '../../../utils/replayModel';
import styles from './Replay.module.css';

/* ── One player: who, the deck as it cycles, what they spent ─────────────── */

const SPOT_TITLE: Record<string, string> = {
  hand: 'In hand',
  next: 'Next into the hand',
  queue: 'Played — still cycling',
  maybe: 'Could be in hand',
};

export function SidePanel({
  replay,
  side,
  cycle,
  summary,
  flash,
  ability,
}: {
  replay: Replay;
  side: ReplaySide;
  cycle: CycleState;
  summary: SideSummary;
  /** The card this side played a moment ago, lit once. */
  flash: string | null;
  /** The champion or hero whose ability fired a moment ago. */
  ability: string | null;
}) {
  const p = replay.players[side];
  const note = cycle.exact
    ? 'Hand known'
    : cycle.championOut
      ? 'Champion out — hand not exact'
      : cycle.plays < 4
        ? `Hand known after ${4 - cycle.plays} more`
        : 'Deck not complete on the page';

  return (
    <section className={styles.side} data-side={side} aria-label={`${p.name}, ${side}`}>
      <header className={styles.sideHead}>
        <span className={styles.avatar} aria-hidden="true">
          {initialsOf(p.name)}
        </span>
        <div className={styles.who}>
          <strong title={p.name}>{p.name}</strong>
          <span>{p.tag ?? (side === 'blue' ? 'Blue side' : 'Red side')}</span>
        </div>
        <span className={styles.crowns} title={p.crowns == null ? 'Crowns not on the page' : `${p.crowns} crowns`}>
          <CrownIcon size={15} />
          {p.crowns ?? '–'}
        </span>
      </header>

      <div className={styles.cycleHead}>
        <span>Cycle</span>
        <span className={styles.cycleNote}>{note}</span>
      </div>
      <ul className={styles.deckGrid}>
        {p.deck.map((c) => {
          const spot = cycle.spots[c.key] ?? 'maybe';
          const back = cycle.back[c.key];
          const title =
            spot === 'queue' && back ? `Back in hand after ${back} more play${back === 1 ? '' : 's'}` : SPOT_TITLE[spot];
          return (
            <li
              key={c.key}
              className={styles.deckCard}
              data-spot={spot}
              data-flash={flash === c.key ? '' : undefined}
              data-ability={ability === c.key ? '' : undefined}
              title={`${cardName(c.key)} — ${title}`}
            >
              {CARDS_BY_KEY.has(c.key) ? (
                <CardArt card={c.key} variant={c.form ?? undefined} className={styles.deckArt} />
              ) : (
                <span className={styles.deckUnknown}>{cardName(c.key)}</span>
              )}
              {c.level != null && <span className={styles.deckLevel}>{c.level}</span>}
              {spot === 'next' && <span className={styles.nextTag}>Next</span>}
              {spot === 'queue' && back != null && <span className={styles.backTag}>{back}</span>}
            </li>
          );
        })}
      </ul>

      <dl className={styles.figures}>
        <div>
          <dt>Elixir on cards</dt>
          <dd>{summary.elixir}</dd>
        </div>
        <div>
          <dt>Per play</dt>
          <dd>{summary.perPlay ?? '–'}</dd>
        </div>
        <div>
          <dt>Plays</dt>
          <dd>{summary.plays}</dd>
        </div>
      </dl>

      {(p.tower || p.towersLeft) && (
        <div className={styles.towerRow}>
          {p.tower && (
            <span className={styles.chip}>
              {cardName(p.tower.key)}
              {p.tower.level != null && ` · ${p.tower.level}`}
            </span>
          )}
          {p.towersLeft && (
            <span
              className={styles.chip}
              title="Tower HP when the battle ended"
              data-tone={p.towersLeft.king === 0 ? 'lost' : undefined}
            >
              End · King {p.towersLeft.king.toLocaleString()} ·{' '}
              {p.towersLeft.princess.map((h) => h.toLocaleString()).join(' / ')}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Elixir on cards, both sides over time ─────────────────────────────── */

const W = 1000;
const H = 200;
const PAD_TOP = 14;

function stepPath(points: ElixirPoint[], d: number, max: number): string {
  const y = (v: number) => H - (v / max) * (H - PAD_TOP);
  let path = `M 0 ${y(0)}`;
  for (const p of points.slice(1)) {
    const x = (p.t / d) * W;
    path += ` H ${x.toFixed(1)} V ${y(p.total).toFixed(1)}`;
  }
  return `${path} H ${W}`;
}

export function ElixirRace({
  replay,
  series,
  t,
}: {
  replay: Replay;
  series: Record<ReplaySide, ElixirPoint[]>;
  t: number;
}) {
  const d = replay.duration;
  const max = useMemo(() => {
    const top = Math.max(1, ...series.blue.map((p) => p.total), ...series.red.map((p) => p.total));
    return Math.ceil(top / 10) * 10;
  }, [series]);
  const paths = useMemo(
    () => ({ blue: stepPath(series.blue, d, max), red: stepPath(series.red, d, max) }),
    [series, d, max],
  );
  const now = { blue: elixirAt(series.blue, t), red: elixirAt(series.red, t) };
  const minutes = [];
  for (let s = 60; s < d; s += 60) minutes.push(s);

  return (
    <section className={styles.card} aria-label="Elixir on cards">
      <header className={styles.cardHead}>
        <h3>Elixir on cards</h3>
        <div className={styles.legend}>
          {(['blue', 'red'] as const).map((s) => (
            <span key={s} data-side={s}>
              <i aria-hidden="true" />
              {replay.players[s].name}
              <strong>{now[s]}</strong>
            </span>
          ))}
        </div>
      </header>
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`At ${clock(t)}: ${replay.players.blue.name} ${now.blue}, ${replay.players.red.name} ${now.red}`}>
          {minutes.map((s) => (
            <line key={s} className={styles.chartGrid} x1={(s / d) * W} x2={(s / d) * W} y1="0" y2={H} />
          ))}
          <line className={styles.chartBase} x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} />
          {(['red', 'blue'] as const).map((s) => (
            <path key={s} className={styles.chartLine} data-side={s} d={paths[s]} />
          ))}
          <line className={styles.chartHead} x1={(t / d) * W} x2={(t / d) * W} y1="0" y2={H} />
        </svg>
        <span className={styles.chartMax}>{max}</span>
        {minutes.map((s) => (
          <span key={s} className={styles.chartTick} style={{ left: `${(s / d) * 100}%` }}>
            {clock(s)}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ── Where each side played, so far ─────────────────────────────────────── */

export function LaneSplit({ replay, summaries }: { replay: Replay; summaries: Record<ReplaySide, SideSummary> }) {
  return (
    <section className={styles.card} aria-label="Where they played">
      <header className={styles.cardHead}>
        <h3>Where they played</h3>
      </header>
      <div className={styles.lanes}>
        {(['red', 'blue'] as const).map((s) => {
          const sum = summaries[s];
          const placed = sum.lanes.Left + sum.lanes.Centre + sum.lanes.Right;
          return (
            <div key={s} className={styles.laneRow} data-side={s}>
              <span className={styles.laneName}>{replay.players[s].name}</span>
              <div className={styles.laneBar} aria-label={`Left ${sum.lanes.Left}, centre ${sum.lanes.Centre}, right ${sum.lanes.Right}`}>
                {(['Left', 'Centre', 'Right'] as const).map((lane) =>
                  sum.lanes[lane] > 0 ? (
                    <span key={lane} data-lane={lane} style={{ flexGrow: sum.lanes[lane] }} title={`${lane}: ${sum.lanes[lane]}`}>
                      {lane[0]} {sum.lanes[lane]}
                    </span>
                  ) : null,
                )}
                {placed === 0 && <span data-lane="none">No plays yet</span>}
              </div>
              <span className={styles.laneAcross} title="Plays dropped on the other player's half">
                Their side <strong>{sum.across}</strong>
              </span>
              {sum.most && (
                <span className={styles.laneMost} title="Played most so far">
                  <CardArt card={sum.most.key} className={styles.laneMostArt} />×{sum.most.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Every play, read as a conversation ─────────────────────────────────── */

export function PlayLog({
  replay,
  t,
  onSeek,
}: {
  replay: Replay;
  t: number;
  onSeek: (t: number, e: ReplayEvent) => void;
}) {
  let current = -1;
  for (const e of replay.events) {
    if (e.t > t) break;
    current = e.n;
  }
  return (
    <section className={styles.card} aria-label="Every play">
      <header className={styles.cardHead}>
        <h3>Every play</h3>
        <div className={styles.legend}>
          <span data-side="blue">
            <i aria-hidden="true" />
            {replay.players.blue.name}
          </span>
          <span data-side="red">
            <i aria-hidden="true" />
            {replay.players.red.name}
          </span>
        </div>
      </header>
      <ol className={styles.log}>
        {replay.events.map((e) => {
          const where = e.kind === 'ability' ? 'Ability' : zoneLabel(e);
          return (
            <li
              key={e.n}
              className={styles.logRow}
              data-side={e.side}
              data-past={e.t <= t ? '' : undefined}
              data-now={e.n === current ? '' : undefined}
            >
              <button type="button" onClick={() => onSeek(e.t, e)} aria-label={`${clock(e.t)}, ${replay.players[e.side].name}: ${cardName(e.key)}${where ? `, ${where}` : ''}`}>
                <span className={styles.logTime}>{clock(e.t)}</span>
                <span className={styles.logBody}>
                  {CARDS_BY_KEY.has(e.key) ? (
                    <CardArt card={e.key} variant={e.form ?? undefined} className={styles.logArt} />
                  ) : (
                    <span className={styles.logArtMissing} aria-hidden="true" />
                  )}
                  <span className={styles.logText}>
                    <strong>{cardName(e.key)}</strong>
                    {where && <span>{where}</span>}
                  </span>
                  {e.elixir != null && <span className={styles.logCost}>{e.elixir}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
