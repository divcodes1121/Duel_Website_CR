import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  MatchupReport,
  PlaysFamily,
  TeamRecommendation,
  TeamThreat,
} from '../../../state/analyticsClient';
import { fetchMatchup } from '../../../state/analyticsClient';
import { CardArt } from '../CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { drawnDeck, formInferred } from '../../../utils/deckSeating';
import { shareLabel } from '../../../utils/bringAgainst';
import {
  buildFlow,
  FLOW_MAX_DECKS,
  chainFor,
  firstLink,
  sourceWord,
  validFocus,
  wirePath,
  type FlowFocus,
  type FlowLink,
  type FlowList,
  type FlowModel,
  type FlowTone,
  type OurNode,
  type TheirNode,
} from '../../../utils/matchupFlow';
import styles from './MatchupFlow.module.css';

/**
 * THE MATCHUP MAP (2026-11-10): one of their decks, the matchup, and the decks
 * that answer it — drawn as a chain, the way a flow editor draws a pipeline.
 *
 * Centred on ONE thing at a time. Centred on one of THEIR decks, every deck we
 * suggest hangs off it through a matchup node carrying that deck's rate
 * against it. Centred on one of OURS, every deck of theirs feeds into it, each
 * through its matchup. Any other node on the map re-centres it; a matchup node
 * opens the comparison underneath: their lists, the rung of the evidence
 * ladder each rate came off (these two lists / one card different / two / the
 * archetype), and the pair's own record.
 *
 * Wide box: three columns with every deck on both sides, wires between them.
 * Narrow box: the centre, then one row per matchup, wires down a spine.
 */

const WIDE_AT = 860;

const TONE_WORD: Record<FlowTone, string> = {
  win: 'Favoured',
  even: 'Close',
  lose: 'Unfavoured',
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function games(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'game' : 'games'}`;
}

function linkKey(l: Pick<FlowLink, 'family' | 'deckId'>): string {
  return `${l.family}\u0000${l.deckId}`;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Eight cards, small. */
function Mini({
  cards,
  art,
  inferred,
  filled,
}: {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  inferred?: boolean;
  filled?: string[];
}) {
  const d = drawnDeck(cards, art, inferred, filled);
  return (
    <span className={styles.mini}>
      {d.cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={d.art[c]} inferred={formInferred(d, c)} />
      ))}
    </span>
  );
}

type PortSetter = (id: string) => (el: HTMLElement | null) => void;

function TheirCard({
  node,
  focused,
  dim,
  port,
  onPick,
}: {
  node: TheirNode;
  focused: boolean;
  dim: boolean;
  port: PortSetter;
  onPick: () => void;
}) {
  const lead = node.lists[0];
  return (
    <button
      type="button"
      ref={port(`t:${node.family}`)}
      className={styles.node}
      data-side="their"
      data-focused={focused || undefined}
      data-dim={dim || undefined}
      data-flow-their={node.family}
      aria-pressed={focused}
      onClick={onPick}
      title={`Their ${node.name}: the decks that answer it`}
    >
      <span className={styles.nodeHead}>
        <span className={styles.nodeName}>{node.name}</span>
        <span className={styles.likely} title="The chance they bring it">
          {shareLabel(node.share)}
        </span>
      </span>
      {lead && <Mini cards={lead.cards} art={lead.art} inferred={lead.artInferred} />}
      <span className={styles.nodeFoot}>
        {games(node.games)} · {node.decks} {node.decks === 1 ? 'list' : 'lists'}
      </span>
      <span className={styles.port} data-port="out" aria-hidden="true" />
    </button>
  );
}

function OurCard({
  node,
  focused,
  dim,
  port,
  onPick,
  note,
}: {
  node: OurNode;
  focused: boolean;
  dim: boolean;
  port: PortSetter;
  onPick: () => void;
  note?: string;
}) {
  const d = node.deck;
  return (
    <button
      type="button"
      ref={port(`o:${node.id}`)}
      className={styles.node}
      data-side="ours"
      data-focused={focused || undefined}
      data-dim={dim || undefined}
      data-flow-ours={node.rank}
      aria-pressed={focused}
      onClick={onPick}
      title={`${d.name}: its matchups against everything they play`}
    >
      <span className={styles.port} data-port="in" aria-hidden="true" />
      <span className={styles.nodeHead}>
        <span className={styles.rank}>{node.rank}</span>
        <span className={styles.nodeName}>{d.name}</span>
        <span className={styles.headline} title="Expected win rate against what they are likely to bring">
          {pct(d.expectedWinRate)}
        </span>
      </span>
      <Mini cards={d.cards} art={d.art} inferred={d.artInferred} filled={d.artFilled} />
      {note && <span className={styles.nodeFoot}>{note}</span>}
    </button>
  );
}

function MidNode({
  link,
  port,
  open,
  share,
  onOpen,
}: {
  link: FlowLink;
  port: PortSetter;
  open: boolean;
  /** Centred on our deck: the chance they bring this family, its weight. */
  share?: number;
  onOpen: () => void;
}) {
  const listed = link.lists.filter((l) => l.rate !== null).length;
  const label = link.source
    ? sourceWord(link.source)
    : link.lists.length > 1
      ? `${link.lists.length} of their lists`
      : 'Matchup';
  return (
    <button
      type="button"
      ref={port(`m:${linkKey(link)}`)}
      className={styles.mid}
      data-tone={link.tone}
      data-open={open || undefined}
      data-flow-mid={link.deckId}
      aria-pressed={open}
      onClick={onOpen}
      title={`${TONE_WORD[link.tone]} — open the comparison`}
    >
      <span className={styles.port} data-port="in" aria-hidden="true" />
      <span className={styles.midRate}>{pct(link.rate)}</span>
      <span className={styles.midLabel}>{label}</span>
      <span className={styles.midSub}>
        {share !== undefined ? `× ${shareLabel(share)} likely` : link.games ? games(link.games) : TONE_WORD[link.tone]}
        {listed > 1 && share === undefined ? ` · ${listed} lists` : ''}
      </span>
      <span className={styles.port} data-port="out" aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------ the detail */

function ListRow({ l, family }: { l: FlowList; family: string }) {
  return (
    <li className={styles.listRow}>
      <Mini cards={l.cards} art={l.art} inferred={l.artInferred} />
      <span className={styles.listFigs}>
        <span className={styles.listShare} title={`Share of their ${family}`}>
          {shareLabel(l.within)} of it
        </span>
        {l.rate !== null ? (
          <>
            <strong data-tone={l.rate >= 55 ? 'win' : l.rate >= 50 ? 'even' : 'lose'}>{pct(l.rate)}</strong>
            <span>{sourceWord(l.source)}</span>
            {l.evidence > 0 && <span>{games(l.evidence)}</span>}
          </>
        ) : (
          <span>{games(l.games)} played</span>
        )}
      </span>
    </li>
  );
}

const RUNG_WORD: Record<string, string> = {
  exact: 'These two exact lists',
  deck: 'Your exact list vs their archetype',
  cluster7: '1 card different',
  cluster6: '2 cards different',
  archetype: 'Archetype vs archetype',
};

function PairRecord({ ours, theirs }: { ours: string[]; theirs: string[] | undefined }) {
  const [report, setReport] = useState<MatchupReport | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const key = `${ours.join(',')}|${theirs?.join(',') ?? ''}`;

  useEffect(() => {
    if (!theirs || theirs.length !== 8 || ours.length !== 8) {
      setState('idle');
      setReport(null);
      return;
    }
    let live = true;
    setState('busy');
    fetchMatchup(ours, theirs)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setState('done');
      })
      .catch(() => live && setState('failed'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (state === 'idle' || state === 'failed') return null;
  /* The ladder is sent only when there is more than one reading; with one,
     the narrowest reading is `matchup` and its rung is `source`. */
  const rungs = report?.ladder?.length
    ? report.ladder
    : report?.matchup && report.source
      ? [{ ...report.matchup, source: report.source }]
      : [];
  return (
    <section className={styles.record} data-pair-record>
      <h4 className={styles.recordTitle}>Their most likely list vs yours, by how close the decks match</h4>
      {state === 'busy' ? (
        <p className={styles.recordNote}>Reading the record…</p>
      ) : rungs.length === 0 ? (
        <p className={styles.recordNote}>No stored games between decks this close.</p>
      ) : (
        <ol className={styles.rungs}>
          {rungs.map((r) => (
            <li key={r.source} className={styles.rung} data-rung={r.source}>
              <span className={styles.rungName}>{RUNG_WORD[r.source] ?? sourceWord(r.source)}</span>
              <span className={styles.rungBar} aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, r.winRate))}%` }} data-tone={r.winRate >= 55 ? 'win' : r.winRate >= 50 ? 'even' : 'lose'} />
              </span>
              <strong>{pct(r.winRate)}</strong>
              <span className={styles.rungGames}>{games(r.games)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className={styles.recordNote}>
        The map&rsquo;s figure joins these records with duel games and the card model.
      </p>
    </section>
  );
}

function Detail({ model, link }: { model: FlowModel; link: FlowLink }) {
  const t = model.their.find((n) => n.family === link.family);
  const o = model.ours.find((n) => n.id === link.deckId);
  if (!t || !o) return null;
  const d = o.deck;
  const lead = link.lists[0];
  return (
    <section className={styles.detail} data-tone={link.tone} data-flow-detail aria-live="polite">
      <div className={styles.detailHead}>
        <span className={styles.detailWho} data-side="their">Their {t.name}</span>
        <span className={styles.detailVs}>vs</span>
        <span className={styles.detailWho} data-side="ours">{d.name}</span>
        <span className={styles.detailRate}>
          <strong>{pct(link.rate)}</strong>
          <span>{TONE_WORD[link.tone]}</span>
        </span>
      </div>
      <div className={styles.detailBody}>
        <div className={styles.detailCol} data-side="their">
          <span className={styles.colLabel}>
            Their lists · {shareLabel(t.share)} likely
          </span>
          {link.lists.length ? (
            <ol className={styles.lists}>
              {link.lists.slice(0, 4).map((l) => (
                <ListRow key={l.key} l={l} family={t.name} />
              ))}
            </ol>
          ) : (
            <p className={styles.recordNote}>{games(t.games)} in this window.</p>
          )}
        </div>
        <div className={styles.detailCol} data-side="ours">
          <span className={styles.colLabel}>Your deck · {pct(d.expectedWinRate)} against all of it</span>
          <Mini cards={d.cards} art={d.art} inferred={d.artInferred} filled={d.artFilled} />
          <DeckActions cards={d.cards} name={d.name} size="sm" art={d.art} />
        </div>
      </div>
      <PairRecord ours={d.cards} theirs={lead?.cards} />
    </section>
  );
}

/* ------------------------------------------------------------ the map */

interface Wire {
  key: string;
  d: string;
  tone: FlowTone | 'feed';
  open: boolean;
}

export function MatchupFlow({
  plays,
  threats,
  decks,
  focus: asked,
  onFocus,
  onClose,
  toolbar,
}: {
  plays: PlaysFamily[];
  threats?: TeamThreat[];
  decks: TeamRecommendation[];
  focus: FlowFocus | null;
  onFocus: (f: FlowFocus) => void;
  onClose?: () => void;
  /** Drawn under the header: Team Analysis's choice of whose decks to map. */
  toolbar?: ReactNode;
}) {
  /* TEN DECKS ON THE RIGHT until asked for more, and back to ten whenever
     the list changes (another teammate). The deck it was opened on is always
     drawn, at its own rank. */
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [decks]);
  const keep = asked?.side === 'ours' ? asked.id : undefined;
  const model = useMemo(
    () => buildFlow(plays, threats, decks, showAll ? {} : { limit: FLOW_MAX_DECKS, keep }),
    [plays, threats, decks, showAll, keep],
  );
  const focus = validFocus(model, asked);
  const chain = useMemo(() => (focus ? chainFor(model, focus) : []), [model, focus?.side, focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusKey = focus ? `${focus.side}:${focus.id}` : '';

  const [openKey, setOpenKey] = useState<string | null>(null);
  useEffect(() => {
    const first = focus ? firstLink(model, focus) : null;
    setOpenKey(first ? linkKey(first) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, model]);
  const open = chain.find((l) => linkKey(l) === openKey) ?? null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const ports = useRef(new Map<string, HTMLElement>());
  const portSetters = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const port: PortSetter = (id) => {
    let fn = portSetters.current.get(id);
    if (!fn) {
      fn = (el) => {
        if (el) ports.current.set(id, el);
        else ports.current.delete(id);
      };
      portSetters.current.set(id, fn);
    }
    return fn;
  };

  const [width, setWidth] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [wires, setWires] = useState<Wire[]>([]);
  const wide = width >= WIDE_AT;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setWidth(root.clientWidth);
    const ro = new ResizeObserver(() => setWidth(root.clientWidth));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [wide]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !focus) {
      setWires([]);
      return;
    }
    const base = canvas.getBoundingClientRect();
    const box = (id: string) => {
      const el = ports.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        l: r.left - base.left,
        r: r.right - base.left,
        t: r.top - base.top,
        b: r.bottom - base.top,
        y: r.top - base.top + r.height / 2,
      };
    };
    const out: Wire[] = [];
    for (const l of chain) {
      const k = linkKey(l);
      const mid = box(`m:${k}`);
      if (!mid) continue;
      const isOpen = k === openKey;
      if (wide) {
        const a = box(`t:${l.family}`);
        const b = box(`o:${l.deckId}`);
        if (!a || !b) continue;
        out.push({ key: `${k}:in`, d: wirePath(a.r, a.y, mid.l, mid.y), tone: 'feed', open: isOpen });
        out.push({ key: `${k}:out`, d: wirePath(mid.r, mid.y, b.l, b.y), tone: l.tone, open: isOpen });
      } else {
        const c = box('centre');
        if (!c) continue;
        out.push({ key: `${k}:in`, d: wirePath(c.l + 22, c.b, mid.l, mid.y, 'v'), tone: l.tone, open: isOpen });
      }
    }
    setSize({ w: canvas.clientWidth, h: canvas.clientHeight });
    setWires(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, openKey, wide, tick, width]);

  /* ONE PACKET DOWN EACH WIRE when the centre changes — one-shot, never a
     loop, and not at all for a reader who asked for less motion. */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wireSig = `${focusKey}|${wires.map((w) => w.key).join(',')}`;
  useEffect(() => {
    if (reducedMotion()) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.querySelectorAll('animateMotion, animate').forEach((a) => {
      try {
        (a as SVGAnimationElement).beginElement();
      } catch {
        /* SMIL missing: the wires stand on their own */
      }
    });
  }, [wireSig]);

  if (!focus) return null;

  const focusedTheir = focus.side === 'their' ? model.their.find((t) => t.family === focus.id) : undefined;
  const focusedOurs = focus.side === 'ours' ? model.ours.find((o) => o.id === focus.id) : undefined;
  const linkFor = (otherId: string) =>
    chain.find((l) => (focus.side === 'their' ? l.deckId === otherId : l.family === otherId));
  const shareOf = (family: string) => model.their.find((t) => t.family === family)?.share;
  const rows = Math.max(model.their.length, model.ours.length, 1);

  const pickTheir = (family: string) => onFocus({ side: 'their', id: family });
  const pickOurs = (id: string) => onFocus({ side: 'ours', id });

  const centreTitle = focusedTheir
    ? `Against their ${focusedTheir.name}`
    : focusedOurs
      ? `${focusedOurs.deck.name}, against everything they play`
      : '';

  return (
    <div className={styles.root} ref={rootRef} data-flow data-layout={wide ? 'wide' : 'narrow'}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.kicker}>Matchup map</span>
          <h3 className={styles.title}>{centreTitle}</h3>
        </div>
        <ol className={styles.legend} aria-label="How to read the map">
          <li data-side="their">Their deck</li>
          <li data-side="mid">Matchup</li>
          <li data-side="ours">Your deck</li>
        </ol>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close the matchup map">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </header>

      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}

      {!wide && (
        <div className={styles.jump} role="group" aria-label="Their decks">
          {model.their.map((t) => (
            <button
              key={t.family}
              type="button"
              className={styles.jumpChip}
              aria-pressed={focus.side === 'their' && focus.id === t.family}
              onClick={() => pickTheir(t.family)}
            >
              {t.name} <strong>{shareLabel(t.share)}</strong>
            </button>
          ))}
        </div>
      )}

      <div className={styles.canvas} ref={canvasRef}>
        <svg
          ref={svgRef}
          className={styles.wires}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
          aria-hidden="true"
          key={focusKey}
        >
          {wires.map((w) => (
            <g key={w.key} data-tone={w.tone} data-open={w.open || undefined}>
              <path className={styles.wireGlow} d={w.d} />
              <path className={styles.wire} d={w.d} pathLength={1} />
              {w.tone !== 'feed' || !wide ? (
                <circle className={styles.packet} r={3.2} cx={0} cy={0} opacity={0}>
                  <animateMotion dur="0.9s" begin="indefinite" fill="remove" path={w.d} />
                  <animate attributeName="opacity" values="0;1;1;0" dur="0.9s" begin="indefinite" fill="remove" />
                </circle>
              ) : null}
            </g>
          ))}
        </svg>

        {wide ? (
          <div className={styles.grid} style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
            {model.their.map((t, i) => (
              <div key={t.family} className={styles.cell} style={{ gridColumn: 1, gridRow: i + 1 }}>
                <TheirCard
                  node={t}
                  focused={focus.side === 'their' && focus.id === t.family}
                  dim={focus.side === 'their' ? focus.id !== t.family : !linkFor(t.family)}
                  port={port}
                  onPick={() => pickTheir(t.family)}
                />
              </div>
            ))}
            {chain.map((l) => {
              const row =
                focus.side === 'their'
                  ? model.ours.findIndex((o) => o.id === l.deckId)
                  : model.their.findIndex((t) => t.family === l.family);
              return (
                <div key={linkKey(l)} className={styles.cell} style={{ gridColumn: 2, gridRow: row + 1 }}>
                  <MidNode
                    link={l}
                    port={port}
                    open={linkKey(l) === openKey}
                    share={focus.side === 'ours' ? shareOf(l.family) : undefined}
                    onOpen={() => setOpenKey(linkKey(l))}
                  />
                </div>
              );
            })}
            {model.ours.map((o, i) => (
              <div key={o.id} className={styles.cell} style={{ gridColumn: 3, gridRow: i + 1 }}>
                <OurCard
                  node={o}
                  focused={focus.side === 'ours' && focus.id === o.id}
                  dim={focus.side === 'ours' ? focus.id !== o.id : !linkFor(o.id)}
                  port={port}
                  onPick={() => pickOurs(o.id)}
                  note={
                    focus.side === 'ours' && focus.id === o.id
                      ? 'Each matchup × how likely they bring it'
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.stack}>
            <div className={styles.centre} ref={port('centre')}>
              {focusedTheir && (
                <TheirCard node={focusedTheir} focused dim={false} port={port} onPick={() => undefined} />
              )}
              {focusedOurs && (
                <OurCard
                  node={focusedOurs}
                  focused
                  dim={false}
                  port={port}
                  onPick={() => undefined}
                  note="Each matchup × how likely they bring it"
                />
              )}
            </div>
            <ol className={styles.rows}>
              {chain.map((l) => {
                const other =
                  focus.side === 'their'
                    ? model.ours.find((o) => o.id === l.deckId)
                    : model.their.find((t) => t.family === l.family);
                return (
                  <li key={linkKey(l)} className={styles.row}>
                    <MidNode
                      link={l}
                      port={port}
                      open={linkKey(l) === openKey}
                      share={focus.side === 'ours' ? shareOf(l.family) : undefined}
                      onOpen={() => setOpenKey(linkKey(l))}
                    />
                    {focus.side === 'their' && other && 'deck' in other ? (
                      <OurCard node={other} focused={false} dim={false} port={port} onPick={() => pickOurs(other.id)} />
                    ) : other && 'family' in other ? (
                      <TheirCard node={other} focused={false} dim={false} port={port} onPick={() => pickTheir(other.family)} />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      {(model.hidden > 0 || (showAll && decks.length > FLOW_MAX_DECKS)) && (
        <div className={styles.more}>
          <button
            type="button"
            className={styles.moreButton}
            onClick={() => setShowAll(!showAll)}
            data-flow-more
          >
            {showAll ? `Show the top ${FLOW_MAX_DECKS}` : `Show all ${decks.length} decks`}
          </button>
        </div>
      )}

      {chain.length === 0 && <p className={styles.empty}>No measured matchups here yet.</p>}
      {open && <Detail model={model} link={open} />}
    </div>
  );
}

/** The map's mark: one deck wired to two. Used by every button that opens it. */
export function MapGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="2.5" y="9" width="5" height="6" rx="1.5" />
      <rect x="16.5" y="3" width="5" height="6" rx="1.5" />
      <rect x="16.5" y="15" width="5" height="6" rx="1.5" />
      <path d="M7.5 12c4.5 0 4.5-6 9-6M7.5 12c4.5 0 4.5 6 9 6" />
    </svg>
  );
}
