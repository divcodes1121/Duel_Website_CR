/* THE COACH DUEL (2026-10-20, rebuilt 2026-10-21; `server/coach_duel.py`).
 *
 * You coach Blue; an AI coach plays Red. You name the two players, paste the
 * decks you want your player to bring, and pick one each game. The AI coach is
 * Coach Assist for its player: it loads a set, reads YOUR player (and, after a
 * rematch, the decks you showed it), and picks every game by the look-ahead.
 * Each rematch it loads a different set from its player's own rotation, now
 * and then with a real one-card switch.
 *
 * The two coaches are the Blue King and the Red King — Supercell's own art,
 * built by `scripts/build-king-art.py` — and they react the way the game's
 * Kings do: a laugh on a won game, tears on a lost one, GG at the end.
 *
 * One request answers the AI's pick for every state of the duel (`policy`),
 * so a game is decided on the spot: your deck, the AI's deck for that state,
 * the pairing's chance moved by the game before, and a draw. The rules are
 * `utils/coachDuel.ts`; this file only draws.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardArt } from '../CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../ReadingState';
import { NameSuggest } from '../../NameSuggest/NameSuggest';
import { CARDS_BY_KEY } from '../../../data/cards';
import { parseClashRoyaleDeckLink } from '../../../utils/deckLink';
import {
  AnalyticsError,
  fetchCoachDuelHuman,
  fetchCoachDuelPrep,
  type CoachDuelDeck,
  type CoachDuelHuman,
  type CoachDuelPrep,
  type CoachDuelSide,
  type DuelKind,
} from '../../../state/analyticsClient';
import { coachToken } from '../../../state/coachToken';
import { DAY_PRESETS } from '../../../utils/datePresets';
import { asTag } from '../../../utils/nameSearch';
import {
  GAMES,
  MAX_DECKS,
  MIN_DECKS,
  addSeen,
  checkLoadout,
  findDeckLinks,
  isOver,
  overlap,
  pctLabel,
  scoreOf,
  walk,
  winnerOf,
  type PlayedGame,
} from '../../../utils/coachDuel';
import styles from './CoachDuel.module.css';

type Seat = 'blue' | 'red';
type Pose = 'idle' | 'laugh' | 'nervous' | 'cheer';
type Emote = 'laugh' | 'cry' | 'grrr' | 'think' | 'sweat' | 'gg' | 'yeah' | 'thumbsdown';

const KINDS: { id: Exclude<DuelKind, null>; label: string }[] = [
  { id: 'war', label: 'Clan war' },
  { id: 'friendly', label: 'Friendly' },
];

/** How long the needle takes to land, unless motion is reduced. */
const ROLL_MS = 1400;

const ART = `${import.meta.env.BASE_URL}assets/kings/`;
/** The Blue King has no fists-up pose (see the art script): he laughs. */
const kingArt = (seat: Seat, pose: Pose) =>
  `${ART}${seat}-${seat === 'blue' && pose === 'cheer' ? 'laugh' : pose}.webp`;
const emoteArt = (e: Emote) => `${ART}emote-${e}.webp`;
const PRELOAD = [
  ...(['blue', 'red'] as Seat[]).flatMap((s) => (['idle', 'laugh', 'nervous', 'cheer'] as Pose[]).map((p) => kingArt(s, p))),
  ...(['laugh', 'cry', 'grrr', 'think', 'sweat', 'gg', 'yeah', 'thumbsdown'] as Emote[]).map(emoteArt),
  `${ART}duel.webp`,
];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const cardName = (k: string) => CARDS_BY_KEY.get(k)?.name ?? k;

/* ── the address bar ───────────────────────────────────────────────────── */

interface Players {
  you: string;
  ai: string;
  days: number;
  kind: DuelKind;
}

function readHash(): Partial<Players> {
  const h = window.location.hash;
  const q = h.indexOf('?');
  if (q === -1) return {};
  const p = new URLSearchParams(h.slice(q + 1));
  const days = Number(p.get('d'));
  const k = p.get('k');
  return {
    you: asTag(p.get('a') ?? '') ?? undefined,
    ai: asTag(p.get('b') ?? '') ?? undefined,
    days: (DAY_PRESETS as readonly number[]).includes(days) ? days : undefined,
    kind: k === 'friendly' || k === 'war' ? k : undefined,
  };
}

function writeHash(s: Players) {
  const p = new URLSearchParams({ a: s.you, b: s.ai, d: String(s.days) });
  if (s.kind) p.set('k', s.kind);
  const next = `#/coach-duel?${p.toString()}`;
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}

function explain(e: unknown): string {
  if (e instanceof AnalyticsError && e.kind === 'offline') return 'The analytics service is not answering.';
  if (e instanceof AnalyticsError && e.kind === 'invalid_tag') return 'One of those is not a player tag.';
  if (e instanceof Error && /unauthorized|forbidden/.test(e.message)) return 'Coach Duel is for admins only.';
  return 'The duel could not be set up.';
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function Strip({ deck, size = 'md' }: { deck: { cards: string[]; art?: CoachDuelDeck['art']; artFilled?: string[] }; size?: 'sm' | 'md' | 'grid' }) {
  return (
    <span className={size === 'sm' ? styles.stripSm : size === 'grid' ? styles.stripGrid : styles.strip}>
      {deck.cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={deck.art?.[c]} inferred={!!deck.artFilled?.includes(c)} />
      ))}
    </span>
  );
}

function Crown({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 20" className={styles.crown} data-on={on ? '' : undefined} aria-hidden="true">
      <path d="M2 17 L4 5 L9 10 L12 2 L15 10 L20 5 L22 17 Z" />
    </svg>
  );
}

function King({
  seat,
  pose,
  emote,
  line,
  beat,
  label,
}: {
  seat: Seat;
  pose: Pose;
  emote: Emote | null;
  line?: string;
  beat: string;
  label: string;
}) {
  return (
    <div className={styles.king} data-seat={seat}>
      <div className={styles.emoteSlot} aria-live="polite">
        {emote && (
          <div key={beat} className={styles.emote} data-seat={seat}>
            <img src={emoteArt(emote)} alt="" className={styles.emoteImg} />
            {line && <p className={styles.emoteLine}>{line}</p>}
          </div>
        )}
      </div>
      <div className={styles.kingStage}>
        <span className={styles.platform} aria-hidden="true" />
        <div className={styles.kingMirror}>
          <img key={pose} src={kingArt(seat, pose)} alt={label} className={styles.kingImg} data-pose={pose} />
        </div>
      </div>
    </div>
  );
}

function Plate({
  seat,
  side,
  role,
  children,
  crowns,
}: {
  seat: Seat;
  side: CoachDuelSide | null;
  role: string;
  children?: React.ReactNode;
  crowns: number;
}) {
  return (
    <div className={styles.plate} data-seat={seat}>
      <img src={`${ART}badge-${seat}.webp`} alt="" className={styles.plateBadge} />
      <div className={styles.plateBody}>
        <span className={styles.plateRole}>{role}</span>
        {side ? (
          <>
            <span className={styles.plateName}>{side.name}</span>
            <span className={styles.plateTag}>{side.tag}</span>
          </>
        ) : (
          children
        )}
      </div>
      <span className={styles.plateCrowns} aria-label={`${crowns} won`}>
        {Array.from({ length: Math.floor(GAMES / 2) + 1 }, (_, i) => (
          <Crown key={i} on={i < crowns} />
        ))}
      </span>
    </div>
  );
}

function ChanceBar({ you, needle, rolling }: { you: number; needle: number | null; rolling: boolean }) {
  return (
    <div className={styles.chance}>
      <div className={styles.chanceLegend}>
        <span data-seat="blue">{pctLabel(you)}</span>
        <span className={styles.chanceWord}>Win chance</span>
        <span data-seat="red">{pctLabel(100 - you)}</span>
      </div>
      <div className={styles.bar} role="img" aria-label={`Win chance: you ${pctLabel(you)}, AI ${pctLabel(100 - you)}`}>
        <span className={styles.barBlue} style={{ width: `${you}%` }} />
        <span className={styles.barRed} style={{ width: `${100 - you}%` }} />
        {needle !== null && (
          <span className={styles.needle} data-rolling={rolling ? '' : undefined} style={{ left: `${needle}%` }} />
        )}
      </div>
    </div>
  );
}

function DeckTile({
  deck,
  seat,
  title,
  badge,
  children,
  selected,
  disabled,
  onSelect,
}: {
  deck: CoachDuelDeck | { cards: string[]; deckName?: string; art?: CoachDuelDeck['art'] };
  seat: Seat;
  title?: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <span className={styles.tileHead}>
        <span className={styles.tileName} title={title ?? (('deckName' in deck && deck.deckName) || undefined)}>
          {title ?? (('deckName' in deck && deck.deckName) || 'Deck')}
        </span>
        {badge}
      </span>
      <Strip deck={deck} size="grid" />
      {children}
    </>
  );
  if (onSelect)
    return (
      <button
        type="button"
        className={styles.tile}
        data-seat={seat}
        data-selected={selected ? '' : undefined}
        disabled={disabled}
        aria-pressed={selected}
        onClick={onSelect}
      >
        {body}
      </button>
    );
  return (
    <div className={styles.tile} data-seat={seat} data-static="">
      {body}
    </div>
  );
}

function CardBack() {
  return (
    <div className={styles.cardBack} aria-label="The AI coach has chosen its deck">
      <img src={`${ART}badge-red.webp`} alt="" />
      <span>AI coach has chosen</span>
    </div>
  );
}

/* ── the screen ────────────────────────────────────────────────────────── */

interface Slot {
  cards: string[];
  name?: string;
  art?: CoachDuelDeck['art'];
}

export function CoachDuel() {
  const start = useMemo(readHash, []);
  const [youText, setYouText] = useState(start.you ?? '');
  const [aiText, setAiText] = useState(start.ai ?? '');
  const [days, setDays] = useState<number>(start.days ?? 30);
  const [kind, setKind] = useState<DuelKind>(start.kind ?? null);
  const [youInput, setYouInput] = useState<HTMLInputElement | null>(null);
  const [aiInput, setAiInput] = useState<HTMLInputElement | null>(null);

  const [players, setPlayers] = useState<Players | null>(null);
  const [prep, setPrep] = useState<CoachDuelPrep | null>(null);
  const [slots, setSlots] = useState<(Slot | null)[]>([null, null, null, null]);
  const [paste, setPaste] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [duel, setDuel] = useState<CoachDuelHuman | null>(null);
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState<string[][]>([]);
  const [loading, setLoading] = useState<'prep' | 'duel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [picks, setPicks] = useState<number[]>([]);
  const [draws, setDraws] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [needle, setNeedle] = useState<number | null>(null);
  const [showLast, setShowLast] = useState(false);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    for (const src of PRELOAD) {
      const i = new Image();
      i.src = src;
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const resetBattle = () => {
    setPicks([]);
    setDraws([]);
    setSelected(null);
    setNeedle(null);
    setShowLast(false);
  };

  const loadPrep = useCallback((p: Players) => {
    const mine = ++seq.current;
    setPlayers(p);
    setPrep(null);
    setDuel(null);
    setError(null);
    setRound(0);
    setSeen([]);
    resetBattle();
    setLoading('prep');
    writeHash(p);
    coachToken()
      .then((token) => fetchCoachDuelPrep(p.you, p.ai, { days: p.days }, p.kind, token))
      .then((d) => {
        if (mine === seq.current) setPrep(d);
      })
      .catch((e) => {
        if (mine === seq.current) setError(explain(e));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(null);
      });
  }, []);

  useEffect(() => {
    if (start.you && start.ai && start.you !== start.ai)
      loadPrep({ you: start.you, ai: start.ai, days: start.days ?? 30, kind: start.kind ?? null });
  }, [start, loadPrep]);

  const youTag = asTag(youText);
  const aiTag = asTag(aiText);
  const ready = !!youTag && !!aiTag && youTag !== aiTag;

  const loadout = slots.filter((s): s is Slot => !!s);
  const check = checkLoadout(slots.map((s) => s?.cards ?? null));

  const startDuel = (nextRound: number, nextSeen: string[][]) => {
    if (!players || !check.ok) return;
    const mine = ++seq.current;
    setError(null);
    setLoading('duel');
    resetBattle();
    coachToken()
      .then((token) =>
        fetchCoachDuelHuman(players.you, players.ai, loadout.map((s) => s.cards), nextRound, nextSeen,
          { days: players.days }, players.kind, token),
      )
      .then((d) => {
        if (mine !== seq.current) return;
        if (d.error === 'bad_decks') setError('Those decks cannot be played together: three or four decks, no card twice.');
        else if (d.error === 'short_set') setError(`${d.name ?? 'The AI player'} has fewer than three decks that fit together in this window. Try a longer history.`);
        else if (d.error === 'no_brain') setError('The duel model is not available right now.');
        else {
          setDuel(d);
          setRound(nextRound);
          setSeen(nextSeen);
        }
      })
      .catch((e) => {
        if (mine === seq.current) setError(explain(e));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(null);
      });
  };

  /* ── your loadout ── */
  const takePaste = (text: string) => {
    const links = findDeckLinks(text);
    if (!links.length) {
      setPasteNote(text.trim() ? 'No deck link found. Copy a deck in the game and paste its link.' : null);
      return;
    }
    const decks = links.map((l) => parseClashRoyaleDeckLink(l)).filter((d): d is string[] => !!d);
    const bad = links.length - decks.length;
    setSlots((cur) => {
      const next = [...cur];
      for (const d of decks) {
        const free = next.findIndex((s) => !s);
        if (free === -1) break;
        next[free] = { cards: d };
      }
      return next;
    });
    setPaste('');
    setPasteNote(bad ? `${bad} link${bad === 1 ? '' : 's'} could not be read.` : null);
  };
  const useSuggested = () => {
    const sug = prep?.you.set ?? [];
    setSlots(Array.from({ length: MAX_DECKS }, (_, i) => (sug[i] ? { cards: sug[i].cards, name: sug[i].deckName, art: sug[i].art } : null)));
    setPasteNote(null);
  };

  /* ── the battle ── */
  const aiDeck = useCallback((key: string) => duel?.policy[key]?.deck ?? null, [duel]);
  const pair = useCallback((y: number, a: number) => duel?.matrix[y]?.[a] ?? 50, [duel]);
  const state = useMemo(
    () => walk(picks, draws, aiDeck, pair, duel?.shift ?? {}),
    [picks, draws, aiDeck, pair, duel],
  );
  const over = duel ? isOver(state.path) : false;
  const champ = duel ? winnerOf(state.path) : null;
  const [youWon, aiWon] = scoreOf(state.path);
  const rolling = needle !== null && picks.length > draws.length;
  const usedByYou = new Set(state.games.map((g) => g.you));
  const usedByAi = new Set(state.games.map((g) => g.ai).filter((x): x is number => x !== null));
  const pendingAi = rolling ? aiDeck(state.key) : null;
  const lastGame: PlayedGame | null = state.games.length ? state.games[state.games.length - 1] : null;
  const hints = duel?.hints[state.key];

  const battle = () => {
    if (!duel || selected === null || rolling || over) return;
    const d = Math.random() * 100;
    setPicks((p) => [...p, selected]);
    setSelected(null);
    setShowLast(false);
    if (reducedMotion()) {
      setDraws((x) => [...x, d]);
      setShowLast(true);
      return;
    }
    setNeedle(50);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setNeedle(d)));
    timer.current = window.setTimeout(() => {
      setDraws((x) => [...x, d]);
      setNeedle(null);
      setShowLast(true);
    }, ROLL_MS);
  };

  const rematch = () => {
    if (!duel) return;
    const shown = state.games.map((g) => duel.you.set[g.you].cards);
    startDuel(round + 1, addSeen(seen, shown));
  };
  const changeDecks = () => {
    if (duel) {
      const shown = state.games.map((g) => duel.you.set[g.you].cards);
      setSeen((s) => addSeen(s, shown));
      setRound((r) => r + 1);
    }
    setDuel(null);
    resetBattle();
  };
  const newPlayers = () => {
    seq.current += 1;
    setPlayers(null);
    setPrep(null);
    setDuel(null);
    setSlots([null, null, null, null]);
    setError(null);
    setRound(0);
    setSeen([]);
    resetBattle();
  };

  /* ── what the Kings do ── */
  const you = duel?.you ?? prep?.you ?? null;
  const ai = duel?.ai ?? prep?.ai ?? null;
  const lastAiPick = lastGame ? duel?.policy[`${state.path.slice(0, lastGame.game - 1)}:${picks.slice(0, lastGame.game - 1).join(',')}`] : null;
  const aiRead = (pick: typeof lastAiPick, mineCards: string[] | undefined) =>
    pick && mineCards && pick.expected.length ? overlap(pick.expected[0].cards, mineCards) >= 6 : null;

  let blue: { pose: Pose; emote: Emote | null; line?: string } = { pose: 'idle', emote: null };
  let red: { pose: Pose; emote: Emote | null; line?: string } = { pose: 'idle', emote: null };
  if (loading === 'prep') red = { pose: 'idle', emote: 'think', line: 'Scouting both players…' };
  else if (loading === 'duel') red = { pose: 'idle', emote: 'think', line: round > 0 || duel ? 'Changing my decks…' : 'Loading my decks…' };
  else if (prep && !duel) {
    red = { pose: 'idle', emote: 'think', line: `I know ${prep.ai.name}. I'm reading ${prep.you.name}.` };
  } else if (duel && rolling) {
    blue = { pose: 'nervous', emote: 'sweat' };
    red = { pose: 'nervous', emote: 'sweat' };
  } else if (duel && champ) {
    const read = aiRead(lastAiPick, lastGame ? duel.you.set[lastGame.you].cards : undefined);
    if (champ === 'you') {
      blue = { pose: 'laugh', emote: 'yeah', line: `${youWon}–${aiWon}!` };
      red = { pose: 'nervous', emote: 'gg', line: read === false ? "Didn't see that coming." : 'GG. Rematch?' };
    } else {
      blue = { pose: 'nervous', emote: 'gg', line: `${youWon}–${aiWon}` };
      red = { pose: 'cheer', emote: 'yeah', line: read ? 'Read you right.' : 'GG!' };
    }
  } else if (duel && lastGame && showLast) {
    const read = aiRead(lastAiPick, duel.you.set[lastGame.you].cards);
    if (lastGame.result === 'w') {
      blue = { pose: 'laugh', emote: 'laugh' };
      red = { pose: 'nervous', emote: 'grrr', line: read === false ? 'You surprised me.' : 'Saw it. Lost it.' };
    } else {
      blue = { pose: 'nervous', emote: 'cry' };
      red = { pose: 'laugh', emote: 'laugh', line: read ? 'Read you right.' : 'Lucky one.' };
    }
  } else if (duel) {
    const believed = duel.policy[state.key]?.believed;
    red = { pose: 'idle', emote: 'think', line: believed ? `My pick is in. I give us ${pctLabel(believed.duel)}.` : 'My pick is in.' };
  }
  const beat = `${state.path}|${rolling}|${loading}|${!!prep}|${!!duel}|${showLast}|${round}`;

  /* ── layout ── */
  return (
    <section className={styles.page}>
      <div className={styles.arena} data-phase={duel ? (champ ? 'over' : 'battle') : prep ? 'loadout' : 'setup'}>
        <span className={styles.seam} aria-hidden="true" />
        <div className={styles.side} data-seat="blue">
          <King seat="blue" pose={blue.pose} emote={blue.emote} line={blue.line} beat={`b|${beat}`} label="The Blue King: your coach" />
          <Plate seat="blue" side={you} role="You · Blue coach" crowns={youWon}>
            <label className={styles.seatField}>
              <span className="sr-only">Your player</span>
              <input
                ref={setYouInput}
                className={styles.input}
                value={youText}
                onChange={(e) => setYouText(e.target.value)}
                placeholder="Your player: name or #TAG"
                spellCheck={false}
                autoCapitalize="characters"
              />
              <NameSuggest input={youInput} onPick={(tag) => setYouText(tag)} />
            </label>
          </Plate>
        </div>

        <div className={styles.mid}>
          <h1 className={styles.title}>Coach Duel</h1>
          <img src={`${ART}duel.webp`} alt="" className={styles.emblem} />
          {duel ? (
            <>
              <span className={styles.round}>
                {champ ? (champ === 'you' ? 'Victory' : 'Defeat') : `Game ${Math.min(state.games.length + 1, GAMES)} · Best of ${GAMES}`}
              </span>
              <div className={styles.score} aria-label={`Score ${youWon} to ${aiWon}`}>
                <span data-seat="blue">{youWon}</span>
                <span className={styles.scoreDash}>–</span>
                <span data-seat="red">{aiWon}</span>
              </div>
              {round > 0 && <span className={styles.roundNo}>Rematch {round}</span>}
            </>
          ) : prep ? (
            <span className={styles.round}>Load your decks</span>
          ) : (
            <form
              className={styles.setup}
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) loadPrep({ you: youTag!, ai: aiTag!, days, kind });
              }}
            >
              <div className={styles.chipRow} role="group" aria-label="History window">
                {DAY_PRESETS.map((d) => (
                  <button key={d} type="button" className={styles.chip} aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d}d
                  </button>
                ))}
              </div>
              <div className={styles.chipRow} role="group" aria-label="Kind of duel">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" className={styles.chip} aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)}>
                    {k.label}
                  </button>
                ))}
              </div>
              <button type="submit" className={styles.cta} disabled={!ready || loading !== null}>
                Enter the arena
              </button>
              {youTag && aiTag && youTag === aiTag && <p className={styles.setupNote}>Pick two different players.</p>}
            </form>
          )}
        </div>

        <div className={styles.side} data-seat="red">
          <King seat="red" pose={red.pose} emote={red.emote} line={red.line} beat={`r|${beat}`} label="The Red King: the AI coach" />
          <Plate seat="red" side={ai} role="AI coach · Red" crowns={aiWon}>
            <label className={styles.seatField}>
              <span className="sr-only">Opponent player</span>
              <input
                ref={setAiInput}
                className={styles.input}
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="Opponent: name or #TAG"
                spellCheck={false}
                autoCapitalize="characters"
              />
              <NameSuggest input={aiInput} onPick={(tag) => setAiText(tag)} />
            </label>
          </Plate>
        </div>
      </div>

      <ol className={styles.steps} aria-label="Steps">
        {['Pick both players', 'Load your decks', 'Battle the AI coach'].map((s, i) => {
          const at = duel ? 2 : prep ? 1 : 0;
          return (
            <li key={s} className={styles.step} data-on={i === at ? '' : undefined} data-done={i < at ? '' : undefined}>
              <span className={styles.stepNo}>{i < at ? '✓' : i + 1}</span>
              {s}
            </li>
          );
        })}
      </ol>

      {loading === 'prep' && (
        <ReadingState k="coach-duel" hue="violet">
          <p>The AI coach is scouting both players…</p>
        </ReadingState>
      )}
      {error && !loading && <p className={styles.error}>{error}</p>}

      {/* ── your loadout ── */}
      {prep && !duel && loading !== 'prep' && (
        <section className={styles.panel} aria-label="Your loadout">
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Your loadout</h2>
              <p className={styles.panelSub}>
                The decks you want {prep.you.name} to bring: {MIN_DECKS} or {MAX_DECKS}, no card twice.
              </p>
            </div>
            <button type="button" className={styles.ghost} onClick={useSuggested} disabled={!prep.you.set?.length}>
              Use Coach Assist's set
            </button>
          </header>
          <textarea
            className={styles.paste}
            value={paste}
            placeholder="Paste deck links here — one at a time, or all four at once"
            onChange={(e) => {
              setPaste(e.target.value);
              if (findDeckLinks(e.target.value).length) takePaste(e.target.value);
            }}
            onPaste={(e) => {
              e.preventDefault();
              takePaste(e.clipboardData.getData('text'));
            }}
            rows={2}
          />
          {pasteNote && <p className={styles.note}>{pasteNote}</p>}
          <div className={styles.slots}>
            {slots.map((s, i) => (
              <div key={i} className={styles.slot} data-empty={s ? undefined : ''} data-clash={check.clashes.includes(i) ? '' : undefined}>
                <span className={styles.slotNo}>Deck {i + 1}</span>
                {s ? (
                  <>
                    {s.name && <span className={styles.slotName}>{s.name}</span>}
                    <Strip deck={s} size="grid" />
                    <button
                      type="button"
                      className={styles.slotClear}
                      aria-label={`Remove deck ${i + 1}`}
                      onClick={() => setSlots((cur) => cur.map((x, j) => (j === i ? null : x)))}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span className={styles.slotEmpty}>{i < MIN_DECKS ? 'Paste a deck link' : 'Optional fourth deck'}</span>
                )}
              </div>
            ))}
          </div>
          <footer className={styles.panelFoot}>
            <span className={styles.status} data-ok={check.ok ? '' : undefined}>
              {check.shared.length
                ? `${check.shared.map(cardName).join(', ')} ${check.shared.length === 1 ? 'is' : 'are'} in two decks`
                : `${check.count} of ${MAX_DECKS} decks${check.count < MIN_DECKS ? ` · ${MIN_DECKS - check.count} more to play` : ''}`}
            </span>
            <button type="button" className={styles.cta} disabled={!check.ok || loading !== null} onClick={() => startDuel(round, seen)}>
              {round > 0 ? 'Back to the arena' : 'Start the duel'}
            </button>
          </footer>
        </section>
      )}

      {loading === 'duel' && (
        <ReadingState k="coach-duel-round" hue="violet">
          <p>{round > 0 || duel ? 'The AI coach is changing its decks…' : 'The AI coach is loading its decks…'}</p>
        </ReadingState>
      )}

      {/* ── the battle ── */}
      {duel && loading !== 'duel' && (
        <section className={styles.panel} aria-label="The battle">
          <ol className={styles.track} aria-label="Games">
            {Array.from({ length: GAMES }, (_, g) => {
              const gm = state.games[g];
              return (
                <li key={g} className={styles.trackGame} data-result={gm ? (gm.result === 'w' ? 'you' : 'ai') : undefined}>
                  <span className={styles.trackNo}>G{g + 1}</span>
                  {gm ? (
                    <span className={styles.trackDecks}>
                      <span data-seat="blue">{duel.you.set[gm.you].deckName}</span>
                      <span className={styles.trackVs}>vs</span>
                      <span data-seat="red">{gm.ai !== null ? duel.ai.set[gm.ai].deckName : '—'}</span>
                    </span>
                  ) : (
                    <span className={styles.trackDecks}>{g === state.games.length && !over ? 'Now' : over ? 'Not needed' : '—'}</span>
                  )}
                  {gm && <Crown on />}
                </li>
              );
            })}
          </ol>

          {over && (
            <div className={styles.result} data-winner={champ ?? undefined}>
              <p className={styles.resultWord}>{champ === 'you' ? 'Victory' : 'Defeat'}</p>
              <p className={styles.resultScore}>
                {youWon}–{aiWon}
              </p>
              <div className={styles.resultActions}>
                <button type="button" className={styles.cta} onClick={rematch}>
                  Rematch
                </button>
                <button type="button" className={styles.ghost} onClick={changeDecks}>
                  Change my decks
                </button>
                <button type="button" className={styles.ghost} onClick={newPlayers}>
                  New players
                </button>
              </div>
              <p className={styles.resultNote}>On a rematch the AI coach changes its decks and remembers yours.</p>
            </div>
          )}

          {/* A game being played, or the one just finished. */}
          {(rolling || (showLast && lastGame)) && (() => {
            const yi = rolling ? picks[picks.length - 1] : lastGame!.you;
            const ai_i = rolling ? pendingAi : lastGame!.ai;
            const g = rolling ? state.games.length + 1 : lastGame!.game;
            const lastPath = rolling ? state.path : state.path.slice(0, -1);
            const base = ai_i === null ? 100 : pair(yi, ai_i);
            const chance = rolling
              ? walk([...picks], [...draws, 0], aiDeck, pair, duel.shift).games[draws.length]?.chance ?? base
              : lastGame!.chance;
            const pick = duel.policy[`${lastPath}:${picks.slice(0, g - 1).join(',')}`];
            const read = pick && pick.expected.length ? overlap(pick.expected[0].cards, duel.you.set[yi].cards) >= 6 : null;
            return (
              <div className={styles.faceoff} data-result={!rolling && lastGame ? lastGame.result : undefined}>
                <h2 className={styles.gameTitle}>
                  Game {g}
                  {!rolling && lastGame && (
                    <span className={styles.gameWinner} data-seat={lastGame.result === 'w' ? 'blue' : 'red'}>
                      {lastGame.result === 'w' ? 'You win' : 'AI wins'}
                    </span>
                  )}
                </h2>
                <ChanceBar you={chance} needle={rolling ? needle : lastGame!.draw} rolling={rolling} />
                <p className={styles.matchLine}>
                  Matchup {pctLabel(base)}
                  {Math.abs(chance - base) >= 0.05 && (
                    <span data-up={chance > base ? '' : undefined}>
                      {' '}
                      · {chance > base ? '+' : '−'}
                      {Math.abs(Math.round((chance - base) * 10) / 10)} momentum
                    </span>
                  )}
                </p>
                <div className={styles.faceRow}>
                  <DeckTile deck={duel.you.set[yi]} seat="blue">
                    <DeckActions cards={duel.you.set[yi].cards} name={duel.you.set[yi].deckName} />
                  </DeckTile>
                  <span className={styles.vs} aria-hidden="true">
                    VS
                  </span>
                  {ai_i !== null ? (
                    <div className={styles.flip}>
                      <DeckTile
                        deck={duel.ai.set[ai_i]}
                        seat="red"
                        badge={duel.ai.set[ai_i].switched ? <span className={styles.tag}>Switched</span> : duel.ai.set[ai_i].counter ? <span className={styles.tag}>Counter</span> : undefined}
                      >
                        {pick?.expected[0] && (
                          <p className={styles.readLine}>
                            Expected {pick.expected[0].name} · {pctLabel(pick.expected[0].p)}{' '}
                            <span className={read ? styles.readHit : styles.readMiss}>{read ? 'Read you' : 'Surprised'}</span>
                          </p>
                        )}
                      </DeckTile>
                    </div>
                  ) : (
                    <div className={styles.cardBack}>No legal deck left</div>
                  )}
                </div>
                {!rolling && !over && (
                  <button type="button" className={styles.cta} onClick={() => setShowLast(false)}>
                    Next game
                  </button>
                )}
              </div>
            );
          })()}

          {/* Your pick for the next game. */}
          {!rolling && !showLast && !over && (
            <div className={styles.choose}>
              <h2 className={styles.gameTitle}>Game {state.games.length + 1} · pick your deck</h2>
              <div className={styles.chooseRow}>
                <div className={styles.tiles}>
                  {duel.you.set.map((d, i) => {
                    const h = hints?.[String(i)];
                    const used = usedByYou.has(i);
                    const best =
                      hints &&
                      Object.entries(hints).sort((a, b) => b[1].duel - a[1].duel)[0]?.[0] === String(i);
                    return (
                      <DeckTile
                        key={i}
                        deck={d}
                        seat="blue"
                        selected={selected === i}
                        disabled={used}
                        onSelect={() => setSelected(i)}
                        badge={used ? <span className={styles.tag}>Played G{state.games.find((g) => g.you === i)?.game}</span> : best ? <span className={styles.tagGold}>Coach pick</span> : undefined}
                      >
                        {h && !used && (
                          <span className={styles.odds}>
                            <span>This game {pctLabel(h.game)}</span>
                            <span>Duel {pctLabel(h.duel)}</span>
                          </span>
                        )}
                      </DeckTile>
                    );
                  })}
                </div>
                <CardBack />
              </div>
              <button type="button" className={styles.cta} disabled={selected === null} onClick={battle}>
                Battle!
              </button>
            </div>
          )}

          {over && (
            <div className={styles.reveal}>
              <h3 className={styles.revealTitle}>The AI coach's loadout</h3>
              {duel.switch && (
                <p className={styles.switchLine}>
                  Switched {cardName(duel.switch.out)} → {cardName(duel.switch.in)} in {duel.ai.set[duel.switch.deck]?.deckName}
                  {duel.switch.games ? ` · a change seen in ${duel.switch.games.toLocaleString()} real duels` : ''}
                </p>
              )}
              <div className={styles.revealGrid}>
                {duel.ai.set.map((d, i) => (
                  <DeckTile
                    key={i}
                    deck={d}
                    seat="red"
                    badge={
                      usedByAi.has(i) ? (
                        <span className={styles.tag}>G{state.games.find((g) => g.ai === i)?.game}</span>
                      ) : d.switched ? (
                        <span className={styles.tag}>Switched</span>
                      ) : d.counter ? (
                        <span className={styles.tag}>Counter</span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {(prep || duel) && !loading && !over && (
        <div className={styles.footActions}>
          {duel && (
            <button type="button" className={styles.link} onClick={changeDecks}>
              Change my decks
            </button>
          )}
          <button type="button" className={styles.link} onClick={newPlayers}>
            New players
          </button>
        </div>
      )}
    </section>
  );
}
