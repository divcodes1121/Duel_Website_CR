/* THE COACH DUEL (2026-10-20, `server/coach_duel.py`).
 *
 * Two players in, two AI coaches out — one for each — and a best-of-3 played
 * between them, game by game. Each coach is Coach Assist for its player: the
 * set it would load, its read of the other player, the look-ahead over the
 * three games. The server sends every game the duel can reach at once, so a
 * game here is decided on the spot from its chance (the needle lands where
 * the draw fell) and a rematch asks the server nothing.
 *
 * The rules of the walk are `utils/coachDuel.ts`; this file only draws.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardArt } from '../CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../ReadingState';
import { NameSuggest } from '../../NameSuggest/NameSuggest';
import { CoachAvatar, type CoachLook, type CoachMood } from './CoachAvatar';
import {
  AnalyticsError,
  fetchCoachDuel,
  type CoachDuel as Duel,
  type CoachDuelDeck,
  type CoachDuelGame,
  type CoachDuelPick,
  type CoachDuelSide,
  type DuelKind,
} from '../../../state/analyticsClient';
import { coachToken } from '../../../state/coachToken';
import { DAY_PRESETS } from '../../../utils/datePresets';
import { asTag } from '../../../utils/nameSearch';
import {
  branchesOf,
  isOver,
  momentum,
  nodeAt,
  outcomeRows,
  pctLabel,
  roll,
  scoreOf,
  winnerOf,
} from '../../../utils/coachDuel';
import styles from './CoachDuel.module.css';

type Seat = 'a' | 'b';
const SEAT_HUE: Record<Seat, 'blue' | 'red'> = { a: 'blue', b: 'red' };
const SEAT_LABEL: Record<Seat, string> = { a: 'Blue', b: 'Red' };

const KINDS: { id: Exclude<DuelKind, null>; label: string }[] = [
  { id: 'war', label: 'Clan war' },
  { id: 'friendly', label: 'Friendly' },
];

/** How long the needle takes to land, unless motion is reduced. */
const ROLL_MS = 1100;
/** The pause between games when the duel is played out on its own. */
const AUTO_GAP_MS = 700;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* ── the address bar ───────────────────────────────────────────────────── */

interface Setup {
  a: string;
  b: string;
  days: number;
  kind: DuelKind;
}

function readHash(): Partial<Setup> {
  const h = window.location.hash;
  const q = h.indexOf('?');
  if (q === -1) return {};
  const p = new URLSearchParams(h.slice(q + 1));
  const days = Number(p.get('d'));
  const k = p.get('k');
  return {
    a: asTag(p.get('a') ?? '') ?? undefined,
    b: asTag(p.get('b') ?? '') ?? undefined,
    days: (DAY_PRESETS as readonly number[]).includes(days) ? days : undefined,
    kind: k === 'friendly' || k === 'war' ? k : undefined,
  };
}

function writeHash(s: Setup) {
  const p = new URLSearchParams({ a: s.a, b: s.b, d: String(s.days) });
  if (s.kind) p.set('k', s.kind);
  const next = `#/coach-duel?${p.toString()}`;
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function Strip({ deck, size = 'md' }: { deck: CoachDuelDeck; size?: 'sm' | 'md' }) {
  return (
    <span className={size === 'sm' ? styles.stripSm : styles.strip}>
      {deck.cards.map((c, i) => (
        <CardArt
          key={`${c}-${i}`}
          card={c}
          variant={deck.art?.[c]}
          inferred={deck.inferredArt || !!deck.artFilled?.includes(c)}
        />
      ))}
    </span>
  );
}

function ChanceBar({
  a,
  needle,
  rolling,
  label,
}: {
  /** The first player's chance, percent. */
  a: number;
  /** Where the draw fell, percent from the left; null before the game. */
  needle: number | null;
  rolling?: boolean;
  label: string;
}) {
  /* The figures sit ABOVE the bar, not on it: the needle lands wherever the
     draw fell, and on the bar it would land on a figure as often as not. */
  return (
    <div className={styles.chance}>
      <div className={styles.barLegend} aria-hidden="true">
        <span data-hue="blue">{pctLabel(a)}</span>
        <span className={styles.barLegendWord}>Win chance</span>
        <span data-hue="red">{pctLabel(100 - a)}</span>
      </div>
      <div className={styles.bar} role="img" aria-label={label}>
        <span className={styles.barA} style={{ width: `${a}%` }} />
        <span className={styles.barB} style={{ width: `${100 - a}%` }} />
        {needle !== null && (
          <span
            className={styles.needle}
            data-rolling={rolling ? '' : undefined}
            style={{ left: `${needle}%` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

function BrainChips({ side }: { side: CoachDuelSide }) {
  const b = side.brain;
  const chips: { text: string; title: string }[] = [];
  if (b.read)
    chips.push({
      text: b.readFit === 'crl' ? 'Read: CRL fit' : 'Read: all duels',
      title: 'Its read of the other player’s next deck, fitted on duel play',
    });
  if (b.counters) chips.push({ text: `${b.counters} counters`, title: 'CRL duel lists and meta lists rated against its read' });
  if (b.cardModel) chips.push({ text: 'Card model', title: 'Card-vs-card matchups in every figure' });
  if (b.skill) chips.push({ text: 'Win-con skill', title: 'Each player’s record with each win condition' });
  if (b.levelScale === 0) chips.push({ text: 'Level-capped', title: 'A friendly duel: card levels do not count' });
  if (!chips.length) return null;
  return (
    <ul className={styles.chips} aria-label="What this coach reads">
      {chips.map((c) => (
        <li key={c.text} className={styles.chip} title={c.title}>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

function Profile({ side }: { side: CoachDuelSide }) {
  if (!side.profile.length) return null;
  return (
    <ul className={styles.profile} aria-label={`${side.name}'s win conditions`}>
      {side.profile.map((p) => (
        <li key={p.card} className={styles.profileRow} title={`${pctLabel(p.winRate)} won with it`}>
          <span className={styles.profileArt}>
            <CardArt card={p.card} />
          </span>
          <span className={styles.profileName}>{p.name}</span>
          <span className={styles.profileShare}>{pctLabel(100 * p.share)}</span>
          {p.tag === 'strong' && <span className={styles.tagUp}>Above expected</span>}
          {p.tag === 'weak' && <span className={styles.tagDown}>Below expected</span>}
        </li>
      ))}
    </ul>
  );
}

function CoachCard({
  seat,
  side,
  played,
}: {
  seat: Seat;
  side: CoachDuelSide;
  /** Deck index -> the game it was played in. */
  played: Map<number, number>;
}) {
  return (
    <section className={styles.coach} data-hue={SEAT_HUE[seat]} aria-label={`Coach for ${side.name}`}>
      <header className={styles.coachHead}>
        <span className={styles.seat}>{SEAT_LABEL[seat]}</span>
        <h2 className={styles.coachName} title={side.tag}>
          {side.name}
        </h2>
        {side.belief !== null && (
          <span
            className={styles.belief}
            title="This coach's chance of winning the duel with its set, against its read of the other player"
          >
            Coach thinks {pctLabel(side.belief)}
          </span>
        )}
      </header>
      <BrainChips side={side} />
      <ol className={styles.setList} aria-label="The decks this coach loads">
        {side.set.map((d, i) => {
          const g = played.get(i);
          return (
            <li key={d.cards.join(',')} className={styles.setRow} data-played={g ? '' : undefined}>
              <span className={styles.setName}>
                {g && <span className={styles.gameBadge}>G{g}</span>}
                {d.deckName}
                {d.counter && (
                  <span className={styles.counterTag} title="A counter from outside this player's own duel decks">
                    Counter
                  </span>
                )}
              </span>
              <Strip deck={d} size="sm" />
            </li>
          );
        })}
      </ol>
      <Profile side={side} />
    </section>
  );
}

function Expected({ pick }: { pick: CoachDuelPick }) {
  if (!pick.expected?.length) return null;
  const top = pick.expected[0];
  /* The badge says which guess it was, not just that one of three was right:
     "Read right" beside the top guess when the deck brought was a lower one
     read as a wrong claim about the top one. */
  const hit = pick.expected.findIndex((e) => e.hit);
  return (
    <p className={styles.expected} title={pick.expected.map((e) => `${e.name} ${pctLabel(e.p)}`).join(' · ')}>
      Expected <strong>{top.name}</strong> {pctLabel(top.p)}{' '}
      {hit === 0 ? (
        <span className={styles.hit}>Read right</span>
      ) : hit > 0 ? (
        <span className={styles.near} title={`${pick.expected[hit].name} ${pctLabel(pick.expected[hit].p)}`}>
          Its #{hit + 1} guess
        </span>
      ) : (
        <span className={styles.miss}>Surprised</span>
      )}
    </p>
  );
}

function GameCard({
  data,
  node,
  draw,
  rolling,
  result,
  onPlay,
  onAuto,
}: {
  data: Duel;
  node: CoachDuelGame;
  /** The draw, percent; null before it is played. */
  draw: number | null;
  rolling: boolean;
  result: 'w' | 'l' | null;
  onPlay?: () => void;
  onAuto?: () => void;
}) {
  const a = node.a.deck !== null ? data.a.set[node.a.deck] : null;
  const b = node.b.deck !== null ? data.b.set[node.b.deck] : null;
  const shift = momentum(node);
  const winner = result === 'w' ? data.a : result === 'l' ? data.b : null;
  return (
    <article className={styles.game} data-result={result ?? undefined} aria-label={`Game ${node.game}`}>
      <header className={styles.gameHead}>
        <h3 className={styles.gameTitle}>Game {node.game}</h3>
        <span className={styles.gameMeta} title="The decks and the two players alone, before the result of the game before">
          Matchup {pctLabel(node.matchup)} – {pctLabel(100 - node.matchup)}
          {shift !== 0 && (
            <span className={shift > 0 ? styles.up : styles.down} title="The result of the game before moves this one">
              {' '}
              {shift > 0 ? '+' : ''}
              {shift} momentum
            </span>
          )}
        </span>
        {winner && (
          <span className={styles.winner} data-hue={result === 'w' ? 'blue' : 'red'}>
            {winner.name} wins
          </span>
        )}
      </header>
      <div className={styles.face}>
        <div className={styles.faceSide} data-hue="blue">
          <span className={styles.faceName}>{a ? a.deckName : 'No deck left'}</span>
          {a && <Strip deck={a} />}
          {a && (
            <div className={styles.faceActions}>
              <DeckActions cards={a.cards} name={a.deckName} />
            </div>
          )}
          <Expected pick={node.a} />
        </div>
        <span className={styles.vs} aria-hidden="true">
          VS
        </span>
        <div className={styles.faceSide} data-hue="red">
          <span className={styles.faceName}>{b ? b.deckName : 'No deck left'}</span>
          {b && <Strip deck={b} />}
          {b && (
            <div className={styles.faceActions}>
              <DeckActions cards={b.cards} name={b.deckName} />
            </div>
          )}
          <Expected pick={node.b} />
        </div>
      </div>
      <ChanceBar
        a={node.chance}
        needle={draw}
        rolling={rolling}
        label={`Win chance: ${data.a.name} ${pctLabel(node.chance)}, ${data.b.name} ${pctLabel(100 - node.chance)}`}
      />
      {onPlay && (
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onPlay} disabled={rolling}>
            Play game {node.game}
          </button>
          {onAuto && (
            <button type="button" className={styles.ghost} onClick={onAuto} disabled={rolling}>
              Play it out
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function PlanNode({ data, path, depth }: { data: Duel; path: string; depth: number }) {
  const node = nodeAt(data.tree, path, data.games);
  if (!node) return null;
  const a = node.a.deck !== null ? data.a.set[node.a.deck] : null;
  const b = node.b.deck !== null ? data.b.set[node.b.deck] : null;
  const { won, lost } = branchesOf(data.tree, path, data.games);
  const [sa, sb] = scoreOf(path);
  return (
    <li className={styles.planNode}>
      <div className={styles.planRow}>
        <span className={styles.planGame}>
          G{node.game}
          {depth > 0 && (
            <span className={styles.planScore}>
              {sa}–{sb}
            </span>
          )}
        </span>
        <span className={styles.planDeck} data-hue="blue">
          {a?.deckName ?? '—'}
        </span>
        <span className={styles.planChance}>{pctLabel(node.chance)}</span>
        <span className={styles.planDeck} data-hue="red">
          {b?.deckName ?? '—'}
        </span>
        <span className={styles.planReach} title="Chance this game is played">
          {pctLabel(node.reach)}
        </span>
      </div>
      {(won || lost) && (
        <ul className={styles.planKids}>
          {won && (
            <li>
              <span className={styles.planIf} data-hue="blue">
                If {data.a.name} wins
              </span>
              <ul className={styles.planList}>
                <PlanNode data={data} path={path + 'w'} depth={depth + 1} />
              </ul>
            </li>
          )}
          {lost && (
            <li>
              <span className={styles.planIf} data-hue="red">
                If {data.b.name} wins
              </span>
              <ul className={styles.planList}>
                <PlanNode data={data} path={path + 'l'} depth={depth + 1} />
              </ul>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function Plan({ data }: { data: Duel }) {
  return (
    <details className={styles.plan}>
      <summary className={styles.planSummary}>The plan for every result</summary>
      <ul className={styles.planList}>
        <PlanNode data={data} path="" depth={0} />
      </ul>
      <table className={styles.outcomes}>
        <caption>Final score</caption>
        <tbody>
          <tr>
            {outcomeRows(data.outcomes).map((o) => (
              <td key={o.score} data-hue={o.winner === 'a' ? 'blue' : 'red'}>
                <span className={styles.outScore}>{o.score}</span>
                <span className={styles.outChance}>{pctLabel(o.chance)}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </details>
  );
}

/* ── the stage ─────────────────────────────────────────────────────────── */

interface Voice {
  mood: CoachMood;
  look: CoachLook;
  lines: React.ReactNode[];
}

function Bubble({ seat, lines, beat }: { seat: Seat; lines: React.ReactNode[]; beat: string }) {
  if (!lines.length) return null;
  return (
    <div key={beat} className={styles.bubble} data-hue={SEAT_HUE[seat]} role="status">
      {lines.map((l, i) => (
        <p key={i} className={i === 0 ? styles.bubbleLead : styles.bubbleLine}>
          {l}
        </p>
      ))}
    </div>
  );
}

function Crowns({ won, need, seat }: { won: number; need: number; seat: Seat }) {
  return (
    <span className={styles.crowns} data-hue={SEAT_HUE[seat]} aria-hidden="true">
      {Array.from({ length: need }, (_, i) => (
        <svg key={i} viewBox="0 0 24 20" className={styles.crown} data-on={i < won ? '' : undefined}>
          <path d="M2 17 L4 5 L9 10 L12 2 L15 10 L20 5 L22 17 Z" />
        </svg>
      ))}
    </span>
  );
}

function TimelineRow({ data, node, draw, result }: { data: Duel; node: CoachDuelGame; draw: number; result: 'w' | 'l' }) {
  const a = node.a.deck !== null ? data.a.set[node.a.deck] : null;
  const b = node.b.deck !== null ? data.b.set[node.b.deck] : null;
  const winner = result === 'w' ? data.a : data.b;
  return (
    <article className={styles.tl} aria-label={`Game ${node.game}`} data-result={result}>
      <span className={styles.tlGame}>G{node.game}</span>
      <div className={styles.tlSide} data-hue="blue" data-won={result === 'w' ? '' : undefined}>
        <span className={styles.tlName}>{a?.deckName ?? 'No deck left'}</span>
        {a && <Strip deck={a} size="sm" />}
      </div>
      <div className={styles.tlMid}>
        <ChanceBar
          a={node.chance}
          needle={draw}
          label={`Win chance: ${data.a.name} ${pctLabel(node.chance)}, ${data.b.name} ${pctLabel(100 - node.chance)}`}
        />
        <span className={styles.tlWinner} data-hue={result === 'w' ? 'blue' : 'red'}>
          {winner.name} wins
        </span>
      </div>
      <div className={styles.tlSide} data-hue="red" data-won={result === 'l' ? '' : undefined}>
        <span className={styles.tlName}>{b?.deckName ?? 'No deck left'}</span>
        {b && <Strip deck={b} size="sm" />}
      </div>
    </article>
  );
}

/* What each coach says, and how it looks, at this moment of the duel. Short
   lines in the coach's own voice; every figure in them is the server's. */
function voices(
  data: Duel | null,
  loading: boolean,
  rolling: boolean,
  played: { node: CoachDuelGame; result: 'w' | 'l' }[],
  current: CoachDuelGame | null,
  champ: Seat | null,
  score: [number, number],
): Record<Seat, Voice> {
  const idle = (lines: React.ReactNode[] = []): Voice => ({ mood: 'idle', look: 'in', lines });
  if (loading) {
    const v: Voice = { mood: 'think', look: 'down', lines: ['Reading the player…'] };
    return { a: v, b: v };
  }
  if (!data) return { a: idle(['Pick my player.']), b: idle(['And mine.']) };
  const sides: Record<Seat, CoachDuelSide> = { a: data.a, b: data.b };
  const mine = (seat: Seat): [number, number] => (seat === 'a' ? score : [score[1], score[0]]);
  if (rolling) {
    const v: Voice = { mood: 'think', look: 'down', lines: ['…'] };
    return { a: v, b: v };
  }
  if (champ) {
    const out = {} as Record<Seat, Voice>;
    for (const seat of ['a', 'b'] as Seat[]) {
      const [w, l] = mine(seat);
      out[seat] =
        seat === champ
          ? { mood: 'win', look: 'ahead', lines: [`GG — ${w}–${l}.`, `${sides[seat].name} takes the duel.`] }
          : { mood: 'sad', look: 'down', lines: ['GG.', `${w}–${l}. Rematch?`] };
    }
    return out;
  }
  const next = (seat: Seat): React.ReactNode[] => {
    if (!current) return [];
    const pick = current[seat];
    const deck = pick.deck !== null ? sides[seat].set[pick.deck] : null;
    const exp = pick.expected?.[0];
    return [
      deck ? (
        <>
          Game {current.game}: <strong>{deck.deckName}</strong>
        </>
      ) : (
        'Nothing legal left.'
      ),
      ...(exp ? [`Expecting ${exp.name} · ${pctLabel(exp.p)}`] : []),
    ];
  };
  if (!played.length) {
    const out = {} as Record<Seat, Voice>;
    for (const seat of ['a', 'b'] as Seat[]) {
      const belief = sides[seat].belief;
      out[seat] = idle([
        belief !== null ? `I give us ${pctLabel(belief)}.` : 'Ready.',
        ...next(seat).slice(0, 1),
      ]);
    }
    return out;
  }
  const last = played[played.length - 1];
  const out = {} as Record<Seat, Voice>;
  for (const seat of ['a', 'b'] as Seat[]) {
    const won = (last.result === 'w') === (seat === 'a');
    const read = last.node[seat].expected?.[0]?.hit;
    const [w, l] = mine(seat);
    out[seat] = {
      mood: won ? 'happy' : 'sad',
      look: 'in',
      lines: [
        won ? (read ? `Read it right. ${w}–${l}.` : `That's ours. ${w}–${l}.`) : read ? `Saw it, lost it. ${w}–${l}.` : `Didn't see that coming. ${w}–${l}.`,
        ...next(seat).slice(0, 1),
      ],
    };
  }
  return out;
}

/* ── the screen ────────────────────────────────────────────────────────── */

export function CoachDuel() {
  const start = useMemo(readHash, []);
  const [aText, setAText] = useState(start.a ?? '');
  const [bText, setBText] = useState(start.b ?? '');
  const [days, setDays] = useState<number>(start.days ?? 30);
  const [kind, setKind] = useState<DuelKind>(start.kind ?? null);
  const [aInput, setAInput] = useState<HTMLInputElement | null>(null);
  const [bInput, setBInput] = useState<HTMLInputElement | null>(null);

  const [data, setData] = useState<Duel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One uniform draw per game played, in percent — the duel's whole state. */
  const [draws, setDraws] = useState<number[]>([]);
  const [rolling, setRolling] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);

  const run = useCallback((s: Setup) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    setData(null);
    setDraws([]);
    setRolling(null);
    setAuto(false);
    writeHash(s);
    coachToken()
      .then((token) => fetchCoachDuel(s.a, s.b, { days: s.days }, s.kind, token))
      .then((d) => {
        if (mine !== seq.current) return;
        if (d.error === 'short_set') {
          setError(`${d.name ?? 'One player'} has fewer than three decks that fit together in this window. Try a longer history.`);
        } else if (d.error === 'no_brain') {
          setError('The duel model is not available right now.');
        } else {
          setData(d);
        }
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError(
          e instanceof AnalyticsError && e.kind === 'offline'
            ? 'The analytics service is not answering.'
            : e instanceof AnalyticsError && e.kind === 'invalid_tag'
              ? 'One of those is not a player tag.'
              : e instanceof Error && /unauthorized|forbidden/.test(e.message)
                ? 'Coach Duel is for admins only.'
                : 'The duel could not be set up.',
        );
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, []);

  // A link with both players opens straight into the duel.
  useEffect(() => {
    if (start.a && start.b && start.a !== start.b)
      run({ a: start.a, b: start.b, days: start.days ?? 30, kind: start.kind ?? null });
  }, [start, run]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const aTag = asTag(aText);
  const bTag = asTag(bText);
  const ready = !!aTag && !!bTag && aTag !== bTag;
  const submit = () => {
    if (ready) run({ a: aTag!, b: bTag!, days, kind });
  };

  /* The path is the draws read through the tree: who won each game. */
  const walk = useMemo(() => {
    const games: { node: CoachDuelGame; draw: number; result: 'w' | 'l' }[] = [];
    let path = '';
    if (data) {
      for (const d of draws) {
        const node = nodeAt(data.tree, path, data.games);
        if (!node) break;
        const r = roll(node.chance, d / 100);
        games.push({ node, draw: d, result: r });
        path += r;
      }
    }
    return { games, path };
  }, [data, draws]);

  const current = data ? nodeAt(data.tree, walk.path, data.games) : null;
  const over = data ? isOver(walk.path, data.games) : false;
  const champ = data ? winnerOf(walk.path, data.games) : null;
  const score = scoreOf(walk.path);
  const [sa, sb] = score;
  const need = Math.floor((data?.games ?? 3) / 2) + 1;

  const played = useMemo(() => {
    const out = { a: new Map<number, number>(), b: new Map<number, number>() };
    for (const g of walk.games) {
      if (g.node.a.deck !== null) out.a.set(g.node.a.deck, g.node.game);
      if (g.node.b.deck !== null) out.b.set(g.node.b.deck, g.node.game);
    }
    if (rolling !== null && current) {
      if (current.a.deck !== null) out.a.set(current.a.deck, current.game);
      if (current.b.deck !== null) out.b.set(current.b.deck, current.game);
    }
    return out;
  }, [walk.games, rolling, current]);

  const play = useCallback(() => {
    if (!current || rolling !== null) return;
    const d = Math.random() * 100;
    if (reducedMotion()) {
      setDraws((xs) => [...xs, d]);
      return;
    }
    setRolling(50);
    // Next frame: move the needle to where the draw fell; it eases there.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setRolling(d)));
    timer.current = window.setTimeout(() => {
      setDraws((xs) => [...xs, d]);
      setRolling(null);
    }, ROLL_MS);
  }, [current, rolling]);

  // Played out on its own: the next game starts a moment after the last ends.
  useEffect(() => {
    if (!auto) return;
    if (over || !current) {
      setAuto(false);
      return;
    }
    if (rolling !== null) return;
    const t = window.setTimeout(play, draws.length ? AUTO_GAP_MS : 0);
    return () => window.clearTimeout(t);
  }, [auto, over, current, rolling, draws.length, play]);

  const rematch = () => {
    setAuto(false);
    setRolling(null);
    setDraws([]);
  };
  const changePlayers = () => {
    seq.current += 1;
    setData(null);
    setError(null);
    setDraws([]);
    setRolling(null);
    setAuto(false);
  };

  const v = voices(data, loading, rolling !== null, walk.games, current, champ, score);
  const beat = `${walk.path}|${rolling !== null}|${loading}|${!!data}`;
  const sides: Record<Seat, CoachDuelSide | null> = { a: data?.a ?? null, b: data?.b ?? null };
  const seatInput: Record<Seat, { text: string; set: (s: string) => void; ref: (el: HTMLInputElement | null) => void; el: HTMLInputElement | null }> = {
    a: { text: aText, set: setAText, ref: setAInput, el: aInput },
    b: { text: bText, set: setBText, ref: setBInput, el: bInput },
  };

  return (
    <section className={styles.page} data-hue="violet">
      <header className={styles.head}>
        <h1 className={styles.title}>Coach Duel</h1>
        <p className={styles.blurb}>Two AI coaches play a best of 3 — one for each player.</p>
      </header>

      <form
        className={styles.stage}
        data-live={data ? '' : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {(['a', 'b'] as Seat[]).map((seat) => {
          const side = sides[seat];
          const inp = seatInput[seat];
          return (
            <div key={seat} className={styles.corner} data-hue={SEAT_HUE[seat]} data-seat={seat}>
              <Bubble seat={seat} lines={v[seat].lines} beat={`${seat}|${beat}`} />
              <div className={styles.figure}>
                <CoachAvatar
                  seat={SEAT_HUE[seat]}
                  mood={v[seat].mood}
                  look={v[seat].look}
                  beat={`${seat}|${walk.path}|${champ ?? ''}`}
                  label={`${SEAT_LABEL[seat]} coach${side ? ` for ${side.name}` : ''}`}
                />
              </div>
              {side ? (
                <div className={styles.plate}>
                  <span className={styles.plateSeat}>{SEAT_LABEL[seat]} coach</span>
                  <span className={styles.plateName}>{side.name}</span>
                  <span className={styles.plateTag}>{side.tag}</span>
                  <Crowns won={seat === 'a' ? sa : sb} need={need} seat={seat} />
                </div>
              ) : (
                <label className={styles.seatField}>
                  <span className={styles.seatLabel}>{SEAT_LABEL[seat]} player</span>
                  <input
                    ref={inp.ref}
                    className={styles.input}
                    value={inp.text}
                    onChange={(e) => inp.set(e.target.value)}
                    placeholder="Name or #TAG"
                    spellCheck={false}
                    autoCapitalize="characters"
                  />
                  <NameSuggest input={inp.el} onPick={(tag) => inp.set(tag)} />
                </label>
              )}
            </div>
          );
        })}

        <div className={styles.center}>
          {data ? (
            <>
              <span className={styles.round}>
                {champ ? 'Final' : current ? `Game ${current.game} of ${data.games}` : ''}
              </span>
              <div className={styles.score} aria-label={`Score ${sa} to ${sb}`}>
                <span data-hue="blue">{sa}</span>
                <span className={styles.scoreDash}>–</span>
                <span data-hue="red">{sb}</span>
              </div>
              <div className={styles.odds} title="The exact chance of each player winning the duel, over every way it can go">
                <span data-hue="blue">{pctLabel(data.duel.a)}</span>
                <span className={styles.oddsWord}>to win the duel</span>
                <span data-hue="red">{pctLabel(data.duel.b)}</span>
              </div>
              <div className={styles.oddsBar} aria-hidden="true">
                <span style={{ width: `${data.duel.a}%` }} />
              </div>
              {champ && (
                <p className={styles.champ} data-hue={champ === 'a' ? 'blue' : 'red'}>
                  {(champ === 'a' ? data.a : data.b).name} wins the duel{' '}
                  <span className={styles.nowrap}>
                    {Math.max(sa, sb)}–{Math.min(sa, sb)}
                  </span>
                </p>
              )}
              <div className={styles.centerActions}>
                {over && (
                  <button type="button" className={styles.primary} onClick={rematch}>
                    Rematch
                  </button>
                )}
                <button type="button" className={styles.ghost} onClick={changePlayers}>
                  Change players
                </button>
              </div>
            </>
          ) : (
            <>
              <span className={styles.bigVs} aria-hidden="true">
                VS
              </span>
              <div className={styles.chipRow} role="group" aria-label="History window">
                <span className={styles.chipLabel}>History</span>
                {DAY_PRESETS.map((d) => (
                  <button key={d} type="button" className={styles.dayChip} aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d}d
                  </button>
                ))}
              </div>
              <div className={styles.chipRow} role="group" aria-label="Kind of duel">
                <span className={styles.chipLabel}>Duel</span>
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className={styles.dayChip}
                    aria-pressed={kind === k.id}
                    onClick={() => setKind(kind === k.id ? null : k.id)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <button type="submit" className={styles.start} disabled={!ready || loading}>
                Start the duel
              </button>
              {aTag && bTag && aTag === bTag && <p className={styles.note}>Pick two different players.</p>}
            </>
          )}
        </div>
      </form>

      {loading && (
        <ReadingState k="coach-duel" hue="violet">
          <p>Both coaches are reading the players…</p>
        </ReadingState>
      )}
      {error && !loading && <p className={styles.error}>{error}</p>}

      {data && (
        <div className={styles.arena}>
          {walk.games.length > 0 && (
            <div className={styles.timeline} aria-label="Games played">
              {walk.games.map((g) => (
                <TimelineRow key={g.node.path} data={data} node={g.node} draw={g.draw} result={g.result} />
              ))}
            </div>
          )}
          {current && (
            <GameCard
              key={`now-${current.path}`}
              data={data}
              node={current}
              draw={rolling}
              rolling={rolling !== null}
              result={null}
              onPlay={play}
              onAuto={!auto ? () => setAuto(true) : undefined}
            />
          )}
          <div className={styles.coaches}>
            <CoachCard seat="a" side={data.a} played={played.a} />
            <CoachCard seat="b" side={data.b} played={played.b} />
          </div>
          <Plan data={data} />
        </div>
      )}
    </section>
  );
}
