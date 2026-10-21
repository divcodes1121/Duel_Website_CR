/* THE COACH DUEL (2026-10-20, rebuilt 2026-10-21; `server/coach_duel.py`).
 *
 * You coach Blue; an AI coach plays Red. You name the two players and choose
 * the format (best of 3 or 5) and whether the duel stops once someone has won
 * or plays every game. Then it goes ONE GAME AT A TIME: you paste the deck for
 * the next game, lock it in, the AI's deck flips over — chosen on the server
 * WITHOUT seeing yours — and the game is decided by its chance. No card twice
 * in a duel. Each rematch the AI loads a different set from its player's own
 * rotation, now and then with a real one-card switch, and remembers your decks.
 *
 * The two coaches are the Blue King and the Red King — Supercell's own art,
 * built by `scripts/build-king-art.py` — and they react the way the game's
 * Kings do: a laugh on a won game, tears on a lost one, GG at the end.
 *
 * The rules are `utils/coachDuel.ts`; this file only draws.
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
  fetchCoachDuelPrep,
  fetchCoachDuelTurn,
  type CoachDuelDeck,
  type CoachDuelPrep,
  type CoachDuelSide,
  type CoachDuelTurn,
} from '../../../state/analyticsClient';
import { positionalArt } from '../../../utils/deckSeating';
import { coachToken } from '../../../state/coachToken';
import { DAY_PRESETS } from '../../../utils/datePresets';
import { asTag } from '../../../utils/nameSearch';
import {
  addFaced,
  addSeen,
  clashWith,
  decide,
  deckKey,
  findDeckLinks,
  isFinished,
  MU_DECIDES,
  nextFresh,
  pctLabel,
  scoreOf,
  winnerOf,
  winsNeeded,
  type Format,
  type Luck,
} from '../../../utils/coachDuel';
import styles from './CoachDuel.module.css';

type Seat = 'blue' | 'red';
type Pose = 'idle' | 'laugh' | 'nervous' | 'cheer';
type Emote = 'laugh' | 'cry' | 'grrr' | 'think' | 'sweat' | 'gg' | 'yeah' | 'thumbsdown';

/** How long the needle takes to land, unless motion is reduced. */
const ROLL_MS = 1400;

const ART = `${import.meta.env.BASE_URL}assets/kings/`;
/** The Blue King has no fists-up pose (see the art script): he laughs. */
const kingArt = (seat: Seat, pose: Pose) =>
  `${ART}${seat}-${seat === 'blue' && pose === 'cheer' ? 'laugh' : pose}.webp`;
const emoteArt = (e: Emote) => `${ART}emote-${e}.webp`;
const PRELOAD = [
  ...(['blue', 'red'] as Seat[]).flatMap((s) => (['idle', 'laugh', 'nervous', 'cheer'] as Pose[]).map((p) => kingArt(s, p))),
  ...(['laugh', 'cry', 'grrr', 'think', 'sweat', 'gg', 'yeah'] as Emote[]).map(emoteArt),
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
  games: Format;
  playAll: boolean;
  luck: Luck;
}

function readHash(): Partial<Players> {
  const h = window.location.hash;
  const q = h.indexOf('?');
  if (q === -1) return {};
  const p = new URLSearchParams(h.slice(q + 1));
  const days = Number(p.get('d'));
  return {
    you: asTag(p.get('a') ?? '') ?? undefined,
    ai: asTag(p.get('b') ?? '') ?? undefined,
    days: (DAY_PRESETS as readonly number[]).includes(days) ? days : undefined,
    games: p.get('bo') === '5' ? 5 : p.get('bo') === '3' ? 3 : undefined,
    playAll: p.has('all') ? p.get('all') === '1' : undefined,
    luck: p.get('o') === 'roll' ? 'roll' : p.has('o') ? 'mu' : undefined,
  };
}

function writeHash(s: Players) {
  const p = new URLSearchParams({ a: s.you, b: s.ai, d: String(s.days), bo: String(s.games) });
  if (s.playAll) p.set('all', '1');
  if (s.luck === 'roll') p.set('o', 'roll');
  const next = `#/coach-duel?${p.toString()}`;
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}

function explain(e: unknown): string {
  if (e instanceof AnalyticsError && e.kind === 'offline') return 'The analytics service is not answering.';
  if (e instanceof AnalyticsError && e.kind === 'invalid_tag') return 'One of those is not a player tag.';
  if (e instanceof Error && /unauthorized|forbidden/.test(e.message)) return 'Coach Duel is for admins only.';
  return 'Something went wrong. Try again.';
}

/* ── pieces ────────────────────────────────────────────────────────────── */

type DrawDeck = { cards: string[]; art?: CoachDuelDeck['art']; artFilled?: string[]; deckName?: string };

function Strip({ deck }: { deck: DrawDeck }) {
  return (
    <span className={styles.stripGrid}>
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

function King({ seat, pose, emote, line, beat, label }: {
  seat: Seat; pose: Pose; emote: Emote | null; line?: string; beat: string; label: string;
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

function Plate({ seat, side, role, children, crowns, need }: {
  seat: Seat; side: CoachDuelSide | null; role: string; children?: React.ReactNode; crowns: number; need: number;
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
        {Array.from({ length: Math.max(need, crowns) }, (_, i) => (
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

function DeckTile({ deck, seat, badge, children }: {
  deck: DrawDeck; seat: Seat; badge?: React.ReactNode; children?: React.ReactNode;
}) {
  const name = deck.deckName || 'Your deck';
  return (
    <div className={styles.tile} data-seat={seat}>
      <span className={styles.tileHead}>
        <span className={styles.tileName} title={name}>
          {name}
        </span>
        {badge}
      </span>
      <Strip deck={deck} />
      {children}
    </div>
  );
}

function CardBack({ busy }: { busy: boolean }) {
  return (
    <div className={styles.cardBack} aria-label="The AI coach's deck, face down">
      <img src={`${ART}badge-red.webp`} alt="" />
      <span>{busy ? 'The AI coach is choosing…' : 'Face down until you lock in'}</span>
    </div>
  );
}

function FormatControls({ games, playAll, luck, onChange }: {
  games: Format; playAll: boolean; luck: Luck;
  onChange: (p: Partial<{ games: Format; playAll: boolean; luck: Luck }>) => void;
}) {
  return (
    <>
      <div className={styles.chipRow} role="group" aria-label="Format">
        {([3, 5] as Format[]).map((g) => (
          <button key={g} type="button" className={styles.bigChip} aria-pressed={games === g} onClick={() => onChange({ games: g })}>
            Best of {g}
          </button>
        ))}
      </div>
      <div className={styles.chipRow} role="group" aria-label="How many games">
        <button type="button" className={styles.chip} aria-pressed={!playAll} onClick={() => onChange({ playAll: false })}>
          Stop when someone wins
        </button>
        <button type="button" className={styles.chip} aria-pressed={playAll} onClick={() => onChange({ playAll: true })}>
          Play all {games} games
        </button>
      </div>
      <div className={styles.chipRow} role="group" aria-label="How a game is decided">
        <button
          type="button"
          className={styles.chip}
          aria-pressed={luck === 'mu'}
          title={`A matchup over ${MU_DECIDES}% wins the game; a close one (${100 - MU_DECIDES}–${MU_DECIDES}%) is rolled`}
          onClick={() => onChange({ luck: 'mu' })}
        >
          Matchup over {MU_DECIDES}% wins
        </button>
        <button
          type="button"
          className={styles.chip}
          aria-pressed={luck === 'roll'}
          title="Every game is drawn from its win chance: at 60% you win 60 of 100 such games"
          onClick={() => onChange({ luck: 'roll' })}
        >
          Roll every game
        </button>
      </div>
    </>
  );
}

/* ── the screen ────────────────────────────────────────────────────────── */

interface Played {
  deck: string[];
  /** Your deck's forms as you brought it (a pasted link is in slot order). */
  art?: CoachDuelDeck['art'];
  ans: CoachDuelTurn;
  draw: number;
  result: 'w' | 'l';
  /** The needle decided it (a close matchup, or "roll every game"). */
  rolled: boolean;
}

interface Pending {
  deck: string[];
  art?: CoachDuelDeck['art'];
  ans: CoachDuelTurn | null;
  result?: 'w' | 'l';
  rolled?: boolean;
}

interface Pasted {
  cards: string[];
  name?: string;
  art?: CoachDuelDeck['art'];
}

export function CoachDuel() {
  const start = useMemo(readHash, []);
  const [youText, setYouText] = useState(start.you ?? '');
  const [aiText, setAiText] = useState(start.ai ?? '');
  const [days, setDays] = useState<number>(start.days ?? 30);
  const [games, setGames] = useState<Format>(start.games ?? 3);
  const [playAll, setPlayAll] = useState<boolean>(start.playAll ?? false);
  const [luck, setLuck] = useState<Luck>(start.luck ?? 'mu');
  const [youInput, setYouInput] = useState<HTMLInputElement | null>(null);
  const [aiInput, setAiInput] = useState<HTMLInputElement | null>(null);

  const [players, setPlayers] = useState<Players | null>(null);
  const [prep, setPrep] = useState<CoachDuelPrep | null>(null);
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState<string[][]>([]);
  /* What a rematch must not bring back, on either side: the AI decks faced in
     earlier duels (sent to the server) and the decks offered to you (kept
     here). Reported 2026-10-21: "the decks repeat on a rematch, neither side
     should". */
  const [faced, setFaced] = useState<string[][]>([]);
  const [offered, setOffered] = useState<Set<string>>(() => new Set());
  const [played, setPlayed] = useState<Played[]>([]);
  const [pasted, setPasted] = useState<Pasted | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [needle, setNeedle] = useState<number | null>(null);
  const [showLast, setShowLast] = useState(false);
  const [loading, setLoading] = useState<'prep' | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const resetDuel = () => {
    setPlayed([]);
    setPasted(null);
    setPaste('');
    setPasteNote(null);
    setPending(null);
    setNeedle(null);
    setShowLast(false);
  };

  const loadPrep = useCallback((p: Players) => {
    const mine = ++seq.current;
    setPlayers(p);
    setPrep(null);
    setError(null);
    setRound(0);
    setSeen([]);
    setFaced([]);
    setOffered(new Set());
    resetDuel();
    setLoading('prep');
    writeHash(p);
    coachToken()
      .then((token) => fetchCoachDuelPrep(p.you, p.ai, { days: p.days }, undefined, token))
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
      loadPrep({
        you: start.you, ai: start.ai, days: start.days ?? 30,
        games: start.games ?? 3, playAll: start.playAll ?? false, luck: start.luck ?? 'mu',
      });
  }, [start, loadPrep]);

  const youTag = asTag(youText);
  const aiTag = asTag(aiText);
  const ready = !!youTag && !!aiTag && youTag !== aiTag;

  /* ── the duel so far ── */
  const fmt: Format = players?.games ?? games;
  const all = players?.playAll ?? playAll;
  const luckNow: Luck = players?.luck ?? luck;
  /* THE FORMAT STAYS EDITABLE UNTIL GAME 1 IS LOCKED IN (2026-10-21, reported:
     "I cannot see the option to switch best of 3 / 5, all games / till you
     win"). A duel link opens straight into the arena and skipped the setup
     where these lived; they are on the arena now until the first game. */
  const setFormat = (patch: Partial<Pick<Players, 'games' | 'playAll' | 'luck'>>) => {
    if (patch.games !== undefined) setGames(patch.games);
    if (patch.playAll !== undefined) setPlayAll(patch.playAll);
    if (patch.luck !== undefined) setLuck(patch.luck);
    if (players) {
      const next = { ...players, ...patch };
      setPlayers(next);
      writeHash(next);
    }
  };
  const path = played.map((p) => p.result).join('');
  const [youWon, aiWon] = scoreOf(path);
  const finished = played.length > 0 && isFinished(path, fmt, all);
  const champ = finished ? winnerOf(path, fmt, all) : null;
  const need = winsNeeded(fmt);
  const lastAns = pending?.ans ?? (played.length ? played[played.length - 1].ans : null);
  const earlier = played.map((p) => p.deck);
  const clash = pasted ? clashWith(pasted.cards, earlier) : [];
  const rolling = pending !== null;
  const gameNo = played.length + 1;
  const deadRubber = !finished && all && played.length > 0 && winnerOf(path, fmt, false) !== null;

  /* ── pasting this game's deck ── */
  const takePaste = (text: string) => {
    const links = findDeckLinks(text);
    if (!links.length) {
      setPasteNote(text.trim() ? 'No deck link found. Copy a deck in the game and paste its link.' : null);
      return;
    }
    const cards = parseClashRoyaleDeckLink(links[0]);
    if (!cards) {
      setPasteNote('That link could not be read.');
      return;
    }
    // A deck link is in slot order: slot 1 the evolution, 2 the hero, 3 either.
    setPasted({ cards, art: positionalArt(cards) });
    setPaste('');
    setPasteNote(links.length > 1 ? 'One deck a game: the first link was taken.' : null);
  };
  const pasteFromClipboard = () => {
    if (!navigator.clipboard?.readText) {
      setPasteNote('Paste the link into the box below.');
      return;
    }
    navigator.clipboard
      .readText()
      .then((text) => takePaste(text))
      .catch(() => setPasteNote('The browser did not allow reading the clipboard. Paste the link into the box below.'));
  };
  const suggested = prep?.you.pool?.length ? prep.you.pool : prep?.you.set ?? [];
  const useSuggested = () => {
    const n = nextFresh(suggested.map((d) => d.cards), earlier, offered, pasted?.cards ?? null);
    if (n === null) {
      setPasteNote("No Coach Assist deck is left that shares no card with the ones you've played.");
      return;
    }
    const d = suggested[n.index];
    setOffered((o) => {
      const next = new Set(n.fresh ? o : []);
      next.add(deckKey(d.cards));
      return next;
    });
    setPasted({ cards: d.cards, name: d.deckName, art: d.art });
    setPasteNote(null);
  };

  /* ── playing a game ── */
  const lockIn = () => {
    if (!players || !pasted || clash.length || rolling || finished) return;
    const mine = ++seq.current;
    const deck = pasted.cards;
    const art = pasted.art ?? positionalArt(deck);
    setPending({ deck, art, ans: null });
    setShowLast(false);
    setError(null);
    coachToken()
      .then((token) =>
        fetchCoachDuelTurn(players.you, players.ai, [...earlier, deck], path, players.games, players.playAll,
          round, seen, { days: players.days }, undefined, token, faced),
      )
      .then((ans) => {
        if (mine !== seq.current) return;
        if (ans.error) {
          setPending(null);
          setError(
            ans.error === 'short_set'
              ? `${ans.name ?? 'The AI player'} cannot field ${players.games} decks that share no card in this window. Try a longer history${players.games === 5 ? ' or a best of 3' : ''}.`
              : ans.error === 'no_brain'
                ? 'The duel model is not available right now.'
                : 'That deck cannot be played in this duel.',
          );
          return;
        }
        const d = Math.random() * 100;
        const { result, rolled } = decide(players.luck, ans.matchup, ans.chance, d / 100);
        const finish = () => {
          setPlayed((xs) => [...xs, { deck, art, ans, draw: d, result, rolled }]);
          setPending(null);
          setNeedle(null);
          setPasted(null);
          setShowLast(true);
        };
        setPending({ deck, art, ans, result, rolled });
        if (reducedMotion()) {
          finish();
          return;
        }
        if (!rolled) {
          timer.current = window.setTimeout(finish, 700);
          return;
        }
        setNeedle(50);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setNeedle(d)));
        timer.current = window.setTimeout(finish, ROLL_MS);
      })
      .catch((e) => {
        if (mine !== seq.current) return;
        setPending(null);
        setError(explain(e));
      });
  };

  const rematch = () => {
    setSeen((s) => addSeen(s, earlier));
    setFaced((f) => addFaced(f, (lastAns?.ai.set ?? []).map((d) => d.cards)));
    setRound((r) => r + 1);
    resetDuel();
  };
  const newPlayers = () => {
    seq.current += 1;
    setPlayers(null);
    setPrep(null);
    setError(null);
    setRound(0);
    setSeen([]);
    setFaced([]);
    setOffered(new Set());
    resetDuel();
  };

  /* ── what the Kings do ── */
  const you = lastAns?.you ?? prep?.you ?? null;
  const ai = lastAns?.ai ?? prep?.ai ?? null;
  const lastPlayed = played.length ? played[played.length - 1] : null;
  const readTop = (a: CoachDuelTurn | null | undefined) => (a && a.expected.length ? a.expected[0].hit : null);

  let blue: { pose: Pose; emote: Emote | null; line?: string } = { pose: 'idle', emote: null };
  let red: { pose: Pose; emote: Emote | null; line?: string } = { pose: 'idle', emote: null };
  if (loading === 'prep') red = { pose: 'idle', emote: 'think', line: 'Scouting both players…' };
  else if (rolling && !pending?.ans) red = { pose: 'idle', emote: 'think', line: 'Choosing my deck…' };
  else if (rolling) {
    blue = { pose: 'nervous', emote: 'sweat' };
    red = { pose: 'nervous', emote: 'sweat' };
  } else if (champ && lastPlayed) {
    const read = readTop(lastPlayed.ans);
    if (champ === 'you') {
      blue = { pose: 'laugh', emote: 'yeah', line: `${youWon}–${aiWon}!` };
      red = { pose: 'nervous', emote: 'gg', line: read === false ? "Didn't see that coming." : 'GG. Rematch?' };
    } else {
      blue = { pose: 'nervous', emote: 'gg', line: `${youWon}–${aiWon}` };
      red = { pose: 'cheer', emote: 'yeah', line: read ? 'Read you right.' : 'GG!' };
    }
  } else if (lastPlayed && showLast) {
    const read = readTop(lastPlayed.ans);
    if (lastPlayed.result === 'w') {
      blue = { pose: 'laugh', emote: 'laugh' };
      red = { pose: 'nervous', emote: 'grrr', line: read === false ? 'You surprised me.' : 'Saw it. Lost it.' };
    } else {
      blue = { pose: 'nervous', emote: 'cry' };
      red = { pose: 'laugh', emote: 'laugh', line: read ? 'Read you right.' : 'Lucky one.' };
    }
  } else if (prep) {
    red = {
      pose: 'idle', emote: 'think',
      line: played.length === 0
        ? round > 0 ? 'New decks. I remember yours.' : `I know ${prep.ai.name}. Show me your first deck.`
        : deadRubber ? 'The duel is decided. Still playing.' : 'Your move.',
    };
  }
  const beat = `${path}|${rolling}|${!!pending?.ans}|${loading}|${!!prep}|${showLast}|${round}`;

  const shownGame: Pending | null = rolling
    ? pending
    : lastPlayed && showLast
      ? { deck: lastPlayed.deck, art: lastPlayed.art, ans: lastPlayed.ans, result: lastPlayed.result, rolled: lastPlayed.rolled }
      : null;
  const switchDeck = lastAns?.switch ? lastAns.ai.set[lastAns.switch.deck] : null;

  /* ── layout ── */
  return (
    <section className={styles.page}>
      <div className={styles.arena} data-phase={played.length || rolling ? (champ ? 'over' : 'battle') : prep ? 'ready' : 'setup'}>
        <span className={styles.seam} aria-hidden="true" />
        <div className={styles.side} data-seat="blue">
          <King seat="blue" pose={blue.pose} emote={blue.emote} line={blue.line} beat={`b|${beat}`} label="The Blue King: your coach" />
          <Plate seat="blue" side={you} role="You · Blue coach" crowns={youWon} need={need}>
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
          {prep ? (
            <>
              <span className={styles.round}>
                {champ ? (champ === 'you' ? 'Victory' : 'Defeat') : `Game ${Math.min(gameNo, fmt)} · Best of ${fmt}`}
              </span>
              <div className={styles.score} aria-label={`Score ${youWon} to ${aiWon}`}>
                <span data-seat="blue">{youWon}</span>
                <span className={styles.scoreDash}>–</span>
                <span data-seat="red">{aiWon}</span>
              </div>
              {played.length === 0 && !rolling ? (
                <div className={styles.setup}>
                  <FormatControls games={fmt} playAll={all} luck={luckNow} onChange={setFormat} />
                  {round > 0 && <span className={styles.roundNo}>Rematch {round}</span>}
                </div>
              ) : (
                <span className={styles.roundNo}>
                  {all ? 'Every game played' : 'Ends when someone wins'}
                  {luckNow === 'mu' ? ` · over ${MU_DECIDES}% wins` : ' · every game rolled'}
                  {round > 0 ? ` · Rematch ${round}` : ''}
                </span>
              )}
            </>
          ) : (
            <form
              className={styles.setup}
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) loadPrep({ you: youTag!, ai: aiTag!, days, games, playAll, luck });
              }}
            >
              <FormatControls games={games} playAll={playAll} luck={luck} onChange={setFormat} />
              <div className={styles.chipRow} role="group" aria-label="History window">
                {DAY_PRESETS.map((d) => (
                  <button key={d} type="button" className={styles.chip} aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d}d
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
          <Plate seat="red" side={ai} role="AI coach · Red" crowns={aiWon} need={need}>
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
        {['Players & format', 'Paste a deck', 'Play the game'].map((s, i) => {
          const at = !prep ? 0 : rolling || (showLast && !finished) || finished ? 2 : 1;
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
      {error && <p className={styles.error}>{error}</p>}

      {prep && (
        <section className={styles.panel} aria-label="The duel">
          <ol className={styles.track} data-games={fmt} aria-label="Games">
            {Array.from({ length: fmt }, (_, g) => {
              const gm = played[g];
              const ans = gm?.ans;
              const aiDeck = ans && ans.aiDeck !== null ? ans.ai.set[ans.aiDeck] : null;
              return (
                <li key={g} className={styles.trackGame} data-result={gm ? (gm.result === 'w' ? 'you' : 'ai') : undefined}>
                  <span className={styles.trackNo}>G{g + 1}</span>
                  {gm ? (
                    <span className={styles.trackDecks}>
                      <span data-seat="blue">{ans?.you.deck.deckName}</span>
                      <span className={styles.trackVs}>vs</span>
                      <span data-seat="red">{aiDeck?.deckName ?? '—'}</span>
                    </span>
                  ) : (
                    <span className={styles.trackDecks}>{g === played.length && !finished ? 'Now' : finished ? 'Not played' : '—'}</span>
                  )}
                  {gm && <Crown on />}
                </li>
              );
            })}
          </ol>

          {finished && (
            <div className={styles.result} data-winner={champ ?? undefined}>
              <p className={styles.resultWord}>{champ === 'you' ? 'Victory' : 'Defeat'}</p>
              <p className={styles.resultScore}>
                {youWon}–{aiWon}
              </p>
              <div className={styles.resultActions}>
                <button type="button" className={styles.cta} onClick={rematch}>
                  Rematch
                </button>
                <button type="button" className={styles.ghost} onClick={newPlayers}>
                  New players
                </button>
              </div>
              <p className={styles.resultNote}>On a rematch the AI coach changes its decks and remembers yours.</p>
            </div>
          )}

          {/* The game being played, or the one just finished. */}
          {shownGame && (() => {
            const ans = shownGame.ans;
            const g = rolling ? gameNo : lastPlayed!.ans.game;
            const aiDeck = ans && ans.aiDeck !== null ? ans.ai.set[ans.aiDeck] : null;
            /* YOUR DECK IS DRAWN AS YOU BROUGHT IT (reported 2026-10-21: evolutions
               and heroes drawn wrong after Lock in). The server re-seats a deck
               by what each card CAN be; a pasted link already says which form
               sits in which slot. */
            const youDeck: DrawDeck = {
              cards: shownGame.deck,
              art: shownGame.art ?? positionalArt(shownGame.deck),
              deckName: ans?.you.deck.deckName ?? pasted?.name,
            };
            const shownRolled = shownGame.rolled !== false;
            const exp = ans?.expected[0];
            /* AN UPSET IS A RESULT AGAINST THE CHANCE (reported: "why does it say
               AI wins when I have more matchup?"). The game is DRAWN from its
               chance, so a 53% favourite loses 47 times in 100 — said where it
               happens, not left to look like a bug. */
            const upset = !rolling && lastPlayed && ans ? lastPlayed.rolled && (lastPlayed.result === 'w') !== (ans.chance >= 50) : false;
            return (
              <div className={styles.faceoff} data-result={!rolling && lastPlayed ? lastPlayed.result : undefined}>
                <h2 className={styles.gameTitle}>
                  Game {g}
                  {!rolling && lastPlayed && (
                    <span className={styles.gameWinner} data-seat={lastPlayed.result === 'w' ? 'blue' : 'red'}>
                      {lastPlayed.result === 'w' ? 'You win' : 'AI wins'}
                    </span>
                  )}
                  {upset && <span className={styles.upset}>Upset!</span>}
                </h2>
                {ans && (
                  <>
                    <ChanceBar
                      you={ans.chance}
                      needle={!shownRolled ? null : rolling ? needle : lastPlayed!.draw}
                      rolling={rolling}
                    />
                    <p className={styles.howLine}>
                      {!shownRolled
                        ? shownGame.result === 'w'
                          ? `Your matchup is over ${MU_DECIDES}%: you win the game outright.`
                          : `Their matchup is over ${MU_DECIDES}%: the AI wins the game outright.`
                        : luckNow === 'mu' && !upset
                          ? `A close matchup (${100 - MU_DECIDES}–${MU_DECIDES}%) is decided by the needle — inside your blue, you win.`
                          : upset
                          ? `The needle lands at random: at ${pctLabel(Math.max(ans.chance, 100 - ans.chance))} the favourite still loses ${pctLabel(Math.min(ans.chance, 100 - ans.chance))} of the time.`
                          : 'The needle lands at random — inside your blue, you win.'}
                    </p>
                    <p className={styles.matchLine}>
                      Matchup {pctLabel(ans.matchup)}
                      {Math.abs(ans.chance - ans.matchup) >= 0.05 && (
                        <span data-up={ans.chance > ans.matchup ? '' : undefined}>
                          {' '}· {ans.chance > ans.matchup ? '+' : '−'}
                          {Math.abs(Math.round((ans.chance - ans.matchup) * 10) / 10)} momentum
                        </span>
                      )}
                      {ans.yourOdds && (
                        <span title="Your coach's figure for your deck against the decks it expected them to bring, before the AI's deck was shown">
                          {' '}· your coach expected {pctLabel(ans.yourOdds.game)} against their likely decks
                        </span>
                      )}
                    </p>
                  </>
                )}
                <div className={styles.faceRow}>
                  <DeckTile deck={youDeck} seat="blue">
                    <DeckActions cards={youDeck.cards} name={youDeck.deckName} />
                  </DeckTile>
                  <span className={styles.vs} aria-hidden="true">
                    VS
                  </span>
                  {aiDeck ? (
                    <div className={styles.flip}>
                      <DeckTile
                        deck={aiDeck}
                        seat="red"
                        badge={aiDeck.switched ? <span className={styles.tag}>Switched</span> : aiDeck.counter ? <span className={styles.tag}>Counter</span> : undefined}
                      >
                        {exp && (
                          <p className={styles.readLine}>
                            Expected {exp.name} · {pctLabel(exp.p)}{' '}
                            <span className={exp.hit ? styles.readHit : styles.readMiss}>{exp.hit ? 'Read you' : 'Surprised'}</span>
                          </p>
                        )}
                      </DeckTile>
                    </div>
                  ) : ans ? (
                    <div className={styles.cardBack}>No legal deck left</div>
                  ) : (
                    <CardBack busy />
                  )}
                </div>
                {!rolling && !finished && (
                  <button type="button" className={styles.cta} onClick={() => setShowLast(false)}>
                    {deadRubber ? `Game ${gameNo} — keep playing` : `Next: game ${gameNo}`}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Your move: the deck for the next game, facing the AI's face-down
              card, the way the result faces off below. */}
          {!shownGame && !finished && (
            <div className={styles.turn}>
              <h2 className={styles.turnTitle}>
                <span>Game {gameNo}</span>
                <span className={styles.turnSub}>{deadRubber ? 'The duel is decided — played for the record' : 'Your move'}</span>
              </h2>
              <div className={styles.faceRow}>
                {pasted ? (
                  <DeckTile
                    deck={{ ...pasted, deckName: pasted.name }}
                    seat="blue"
                    badge={
                      <button type="button" className={styles.slotClear} aria-label="Remove this deck" onClick={() => setPasted(null)}>
                        ×
                      </button>
                    }
                  >
                    {clash.length > 0 ? (
                      <p className={styles.clash}>
                        {clash.map(cardName).join(', ')} {clash.length === 1 ? 'was' : 'were'} already played this duel
                      </p>
                    ) : (
                      <p className={styles.readyLine}>Ready</p>
                    )}
                  </DeckTile>
                ) : (
                  <div className={styles.drop}>
                    <svg viewBox="0 0 24 24" className={styles.dropIcon} aria-hidden="true">
                      <path d="M9 4h6a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1V6a2 2 0 0 1 2-2Zm0 2v3h6V6H9Z" />
                    </svg>
                    <p className={styles.dropTitle}>Your deck for game {gameNo}</p>
                    <div className={styles.dropActions}>
                      <button type="button" className={styles.dropBtn} onClick={pasteFromClipboard}>
                        Paste deck link
                      </button>
                      <button type="button" className={styles.dropBtn} onClick={useSuggested} disabled={!suggested.length}>
                        Coach Assist deck
                      </button>
                    </div>
                    <textarea
                      className={styles.dropInput}
                      value={paste}
                      aria-label="Deck link"
                      placeholder="…or paste the link here"
                      onChange={(e) => {
                        setPaste(e.target.value);
                        if (findDeckLinks(e.target.value).length) takePaste(e.target.value);
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        takePaste(e.clipboardData.getData('text'));
                      }}
                      rows={1}
                    />
                  </div>
                )}
                <span className={styles.vs} aria-hidden="true">
                  VS
                </span>
                <CardBack busy={false} />
              </div>
              {pasteNote && <p className={styles.turnNote}>{pasteNote}</p>}
              <div className={styles.turnActions}>
                {pasted && (
                  <button type="button" className={styles.ghost} onClick={useSuggested} disabled={!suggested.length}>
                    Another Coach Assist deck
                  </button>
                )}
                <button type="button" className={styles.cta} disabled={!pasted || clash.length > 0 || rolling} onClick={lockIn}>
                  Lock in &amp; battle
                </button>
              </div>
              {earlier.length > 0 && (
                <p className={styles.turnNote}>
                  {earlier.length * 8} cards already played this duel — none of them can come back.
                </p>
              )}
            </div>
          )}

          {finished && lastAns && (
            <div className={styles.reveal}>
              <h3 className={styles.revealTitle}>The AI coach's decks this duel</h3>
              {lastAns.switch && switchDeck && (
                <p className={styles.switchLine}>
                  Switched {cardName(lastAns.switch.out)} → {cardName(lastAns.switch.in)} in {switchDeck.deckName}
                  {lastAns.switch.games ? ` · a change seen in ${lastAns.switch.games.toLocaleString()} real duels` : ''}
                </p>
              )}
              <div className={styles.revealGrid}>
                {lastAns.ai.set.map((d, i) => {
                  const g = lastAns.aiPicks.indexOf(i);
                  return (
                    <DeckTile
                      key={i}
                      deck={d}
                      seat="red"
                      badge={
                        g >= 0 ? <span className={styles.tag}>G{g + 1}</span>
                          : d.switched ? <span className={styles.tag}>Switched</span>
                            : d.counter ? <span className={styles.tag}>Counter</span> : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {prep && !finished && (
        <div className={styles.footActions}>
          <button type="button" className={styles.link} onClick={newPlayers}>
            New players
          </button>
        </div>
      )}
    </section>
  );
}
