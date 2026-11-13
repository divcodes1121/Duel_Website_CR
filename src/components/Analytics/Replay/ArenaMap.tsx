import { useId, useMemo } from 'react';
import { CARDS_BY_KEY, getCardIconUrl, getEvolutionIconUrl, getHeroIconUrl } from '../../../data/cards';
import { ARENA_H, ARENA_W, type Replay, type ReplayEvent, type ReplayForm } from '../../../utils/replayParse';
import { TRAIL_SECONDS, cardName, clock, isSpell } from '../../../utils/replayModel';
import styles from './Replay.module.css';

/**
 * THE ARENA, AS A DIAGRAM — Deckkies' drawing, not the game's.
 *
 * Clashback re-renders a replay in the game's own engine and art. This board
 * does the opposite on purpose: a flat plan of the 18 x 32 tile grid in the
 * site's colours, with each play pinned where it landed. It answers what a
 * coach asks of a replay — where did they drop it, when, and how often there —
 * which the game's camera, busy with the fight, is worst at showing.
 *
 * GEOMETRY. Tiles, blue at the bottom (arena y 0). The svg's y runs down, so
 * every arena y is drawn at 32 - y. Towers and bridges sit on the public
 * arena grid: princess towers 3 x 3 centred on the bridges (x 3.5 and 14.5),
 * the king 4 x 4 in the middle, the river across rows 15-17.
 *
 * TWO VIEWS. "Recent" pins the plays of the last few seconds, fading with age
 * — what is on the field now. "All" adds a dot for every play so far, the
 * placement map a coach reads for habits (always the same bridge, always
 * behind the king).
 */

const SVG_Y = (y: number) => ARENA_H - y;

function artUrl(key: string, form: ReplayForm): string {
  const card = CARDS_BY_KEY.get(key);
  if (form === 'evolution' && card?.canEvolve) return getEvolutionIconUrl(key);
  if (form === 'hero' && card?.canBeHero) return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

function initials(key: string): string {
  return cardName(key)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface Tower {
  side: 'blue' | 'red';
  kind: 'king' | 'princess';
  x: number;
  y: number;
  size: number;
}

/* Bottom (blue) half; the red half is the same turned round. */
const BLUE_TOWERS: Tower[] = [
  { side: 'blue', kind: 'king', x: 9, y: 3, size: 4 },
  { side: 'blue', kind: 'princess', x: 3.5, y: 6.5, size: 3 },
  { side: 'blue', kind: 'princess', x: 14.5, y: 6.5, size: 3 },
];
const TOWERS: Tower[] = [
  ...BLUE_TOWERS,
  ...BLUE_TOWERS.map((t) => ({ ...t, side: 'red' as const, x: ARENA_W - t.x, y: ARENA_H - t.y })),
];

const RIVER = { from: 15, to: 17 };
const BRIDGES = [3.5, 14.5];

export function ArenaMap({
  replay,
  t,
  view,
  onPick,
}: {
  replay: Replay;
  t: number;
  view: 'recent' | 'all';
  /** Seek to a play when its pin is pressed. */
  onPick: (e: ReplayEvent) => void;
}) {
  const uid = useId().replace(/[:]/g, '');
  const clipId = `${uid}-clip`;
  const gridId = `${uid}-grid`;

  const placed = useMemo(() => replay.events.filter((e) => e.kind === 'play' && e.x != null && e.y != null), [replay]);
  const sofar = placed.filter((e) => e.t <= t);
  const recent = sofar.filter((e) => t - e.t <= TRAIL_SECONDS);
  const ended = t >= replay.duration - 0.05;
  const lastN = sofar.length ? sofar[sofar.length - 1].n : -1;

  return (
    <figure className={styles.arena} data-view={view} aria-label="Arena with every play pinned where it landed">
      <svg
        className={styles.arenaSvg}
        viewBox={`-0.6 -0.6 ${ARENA_W + 1.2} ${ARENA_H + 1.2}`}
        role="img"
        aria-label={`Arena at ${clock(t)}: ${recent.length} recent play${recent.length === 1 ? '' : 's'}`}
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
          <pattern id={gridId} width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" className={styles.gridLine} />
          </pattern>
        </defs>

        {/* The two halves, each in its owner's hue. */}
        <rect className={styles.halfRed} x="0" y="0" width={ARENA_W} height={ARENA_H / 2} rx="0.7" />
        <rect className={styles.halfBlue} x="0" y={ARENA_H / 2} width={ARENA_W} height={ARENA_H / 2} rx="0.7" />
        <rect x="0" y="0" width={ARENA_W} height={ARENA_H} fill={`url(#${gridId})`} />

        {/* The river and its two bridges. */}
        <rect className={styles.river} x="0" y={SVG_Y(RIVER.to)} width={ARENA_W} height={RIVER.to - RIVER.from} />
        <path
          className={styles.riverWave}
          d={`M 0 ${SVG_Y(16) - 0.3} q 1.5 -0.35 3 0 t 3 0 t 3 0 t 3 0 t 3 0 t 3 0 M 0 ${SVG_Y(16) + 0.35} q 1.5 -0.35 3 0 t 3 0 t 3 0 t 3 0 t 3 0 t 3 0`}
        />
        {BRIDGES.map((bx) => {
          const top = SVG_Y(RIVER.to) - 0.35;
          const h = RIVER.to - RIVER.from + 0.7;
          return (
            <g key={bx} className={styles.bridge}>
              <rect x={bx - 1.5} y={top} width="3" height={h} rx="0.3" />
              {/* Planks across, rails along: a bridge, not a box. */}
              <path
                className={styles.bridgePlanks}
                d={[0.55, 1.1, 1.65, 2.2].map((dy) => `M ${bx - 1.3} ${top + dy} H ${bx + 1.3}`).join(' ')}
              />
              <path className={styles.bridgeRails} d={`M ${bx - 1.5} ${top} V ${top + h} M ${bx + 1.5} ${top} V ${top + h}`} />
            </g>
          );
        })}
        <rect className={styles.arenaEdge} x="0" y="0" width={ARENA_W} height={ARENA_H} rx="0.7" />

        {TOWERS.map((tw) => (
          <g key={`${tw.side}-${tw.kind}-${tw.x}`} className={styles.tower} data-side={tw.side} data-kind={tw.kind}>
            <rect
              x={tw.x - tw.size / 2}
              y={SVG_Y(tw.y) - tw.size / 2}
              width={tw.size}
              height={tw.size}
              rx={tw.kind === 'king' ? 0.7 : 0.55}
            />
            {tw.kind === 'king' ? (
              <path
                className={styles.towerMark}
                transform={`translate(${tw.x} ${SVG_Y(tw.y)})`}
                d="M -1 0.55 L -1 -0.35 L -0.5 0.05 L 0 -0.6 L 0.5 0.05 L 1 -0.35 L 1 0.55 Z"
              />
            ) : (
              <circle className={styles.towerMark} cx={tw.x} cy={SVG_Y(tw.y)} r="0.42" />
            )}
          </g>
        ))}

        {/* Every play so far, as a dot — the "All" view's placement map. */}
        {view === 'all' &&
          sofar.map((e) => (
            <circle
              key={`dot-${e.n}`}
              className={styles.dot}
              data-side={e.side}
              cx={e.x!}
              cy={SVG_Y(e.y!)}
              r={isSpell(e.key) ? 0.42 : 0.32}
            />
          ))}

        {/* The plays of the last few seconds, newest on top. */}
        {recent.map((e) => {
          const age = t - e.t;
          const fade = age < TRAIL_SECONDS * 0.45 ? 1 : Math.max(0.28, 1 - (age - TRAIL_SECONDS * 0.45) / (TRAIL_SECONDS * 0.55));
          const known = CARDS_BY_KEY.has(e.key);
          const cx = e.x!;
          const cy = SVG_Y(e.y!);
          const label = `${cardName(e.key)} · ${clock(e.t)}`;
          return (
            <g
              key={`pin-${e.n}`}
              className={styles.pin}
              data-side={e.side}
              data-spell={isSpell(e.key) ? '' : undefined}
              data-latest={e.n === lastN ? '' : undefined}
              style={{ opacity: fade }}
              /* A pointer shortcut only: the play log and the timeline are the
                 keyboard path to the same seek. */
              onClick={() => onPick(e)}
            >
              <title>{label}</title>
              <circle className={styles.pinRipple} cx={cx} cy={cy} r="1" />
              <circle className={styles.pinRing} cx={cx} cy={cy} r="1.02" />
              {known ? (
                <image
                  href={artUrl(e.key, e.form)}
                  x={cx - 0.9}
                  y={cy - 0.9}
                  width="1.8"
                  height="1.8"
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${clipId})`}
                />
              ) : (
                <text className={styles.pinInitials} x={cx} y={cy + 0.27} textAnchor="middle">
                  {initials(e.key)}
                </text>
              )}
              {e.elixir != null && (
                <g className={styles.pinCost} transform={`translate(${cx + 0.82} ${cy - 0.82})`}>
                  <circle r="0.42" />
                  <text y="0.17" textAnchor="middle">
                    {e.elixir}
                  </text>
                </g>
              )}
              {age < 2.4 && (
                <text className={styles.pinName} x={cx} y={cy + 1.75} textAnchor="middle">
                  {cardName(e.key)}
                </text>
              )}
            </g>
          );
        })}

        {/* The clock rides on the river, where nothing is ever placed. */}
        <g className={styles.clockChip} transform={`translate(${ARENA_W / 2} ${SVG_Y(16)})`}>
          <rect x="-1.9" y="-0.62" width="3.8" height="1.24" rx="0.62" />
          <text y="0.26" textAnchor="middle">
            {ended ? 'End' : clock(t)}
          </text>
        </g>
      </svg>
    </figure>
  );
}
