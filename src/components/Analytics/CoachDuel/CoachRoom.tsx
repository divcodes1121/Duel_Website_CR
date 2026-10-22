/* COACH DUEL ROOMS — two coaches online, against each other (2026-10-22;
 * `server/coach_room.py`, rules in `utils/coachRoom.ts`).
 *
 * Asked for: settings first — best of 3 / 5, stop on a win or play all, how a
 * game is decided, and a 2 / 3 / 4 / 5 minute clock for picking a deck — then
 * make a room, share its link, and the other coach opens it and joins with
 * their player. Each game both coaches lock in BLIND before the clock runs
 * out; the server decides the game and rolls, so both screens agree. A coach
 * whose clock runs out loses that game.
 *
 * The host is the Blue King, whoever joined the Red King, on both screens.
 * The screen asks for the room every two seconds while something can change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../ReadingState';
import { NameSuggest } from '../../NameSuggest/NameSuggest';
import { parseClashRoyaleDeckLink } from '../../../utils/deckLink';
import { AnalyticsError, fetchCoachRoom } from '../../../state/analyticsClient';
import { coachToken } from '../../../state/coachToken';
import { supabase } from '../../../state/supabase';
import { positionalArt } from '../../../utils/deckSeating';
import { DAY_PRESETS } from '../../../utils/datePresets';
import { asTag } from '../../../utils/nameSearch';
import { clashWith, deckKey, findDeckLinks, MU_DECIDES, nextFresh, pctLabel, type Format, type Luck } from '../../../utils/coachDuel';
import {
  CLOCK_MINUTES,
  DEFAULT_CLOCK,
  NO_LIMIT,
  POLL_MS,
  POLL_WAITING_MS,
  clockLabel,
  currentGame,
  endLine,
  hasCards,
  lastResult,
  newSeatToken,
  other,
  parseRoomHash,
  remainingMs,
  roomErrorText,
  roomHash,
  roomLink,
  seatStorageKey,
  settingsLine,
  spentBy,
  stageOf,
  type ClockMinutes,
  type CoachRoom as Room,
  type RoomDeck,
  type RoomGame,
  type RoomSeat,
} from '../../../utils/coachRoom';
import {
  ART,
  CardBack,
  ChanceBar,
  Crown,
  DeckTile,
  FormatControls,
  King,
  ModeNav,
  Plate,
  PRELOAD,
  ROLL_MS,
  cardName,
  reducedMotion,
  type DrawDeck,
  type Emote,
  type Pose,
} from './CoachDuelParts';
import styles from './CoachDuel.module.css';

/* A LOCAL CHECKOUT HAS NO SUPABASE, so no token to say who is asking. In a
   dev build only, each tab names itself (the staged server used for checks
   reads this as the account); a production build never sends it, and the
   real server refuses anything that is not a Supabase token. */
function devToken(): string {
  const k = 'coach-room-dev-token';
  try {
    const got = window.sessionStorage.getItem(k);
    if (got) return got;
    const t = `dev-${newSeatToken().slice(5, 17)}`;
    window.sessionStorage.setItem(k, t);
    return t;
  } catch {
    return 'dev-anonymous';
  }
}

async function roomToken(): Promise<string | null> {
  const t = await coachToken();
  if (t) return t;
  return import.meta.env.DEV && !supabase ? devToken() : null;
}

function readSeat(id: string): string {
  try {
    return window.localStorage.getItem(seatStorageKey(id)) ?? '';
  } catch {
    return '';
  }
}

function keepSeat(id: string, token: string) {
  try {
    window.localStorage.setItem(seatStorageKey(id), token);
  } catch {
    /* no storage: this tab still holds the seat by its account */
  }
}

function errorOf(e: unknown): string {
  if (e instanceof AnalyticsError && e.kind === 'offline') return 'The analytics service is not answering.';
  if (e instanceof AnalyticsError && e.kind === 'not_found') return roomErrorText('no_room');
  if (e instanceof AnalyticsError && e.kind === 'invalid_tag') return 'That is not a player tag.';
  if (e instanceof Error) return roomErrorText(e.message);
  return roomErrorText('');
}

const artParam = (art?: Record<string, string>) =>
  Object.entries(art ?? {})
    .map(([k, f]) => `${k}:${f}`)
    .join(',');

const asDraw = (d: RoomDeck): DrawDeck => ({
  cards: d.cards,
  art: d.art && Object.keys(d.art).length ? d.art : positionalArt(d.cards),
  deckName: d.deckName ?? undefined,
});

interface Pasted {
  cards: string[];
  name?: string;
  origin?: string;
  art?: Record<string, 'evolution' | 'hero'>;
}

/* ── the setup: make a room ─────────────────────────────────────────────── */

function CreateRoom({ onCreated }: { onCreated: (room: Room, seat: string) => void }) {
  const [youText, setYouText] = useState('');
  const [youInput, setYouInput] = useState<HTMLInputElement | null>(null);
  const [games, setGames] = useState<Format>(3);
  const [playAll, setPlayAll] = useState(false);
  const [luck, setLuck] = useState<Luck>('mu');
  const [clock, setClock] = useState<ClockMinutes>(DEFAULT_CLOCK);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tag = asTag(youText);

  const create = () => {
    if (!tag || busy) return;
    const seat = newSeatToken();
    setBusy(true);
    setError(null);
    roomToken()
      .then((token) =>
        fetchCoachRoom(
          { act: 'create', tag, seat, bo: String(games), all: playAll ? '1' : '0', o: luck, clock: String(clock), d: String(days) },
          token,
        ),
      )
      .then((room) => {
        keepSeat(room.id, seat);
        onCreated(room, seat);
      })
      .catch((e) => setError(errorOf(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className={styles.arena} data-phase="setup">
        <span className={styles.seam} aria-hidden="true" />
        <div className={styles.side} data-seat="blue">
          <King seat="blue" pose="idle" emote={null} beat="b-setup" label="The Blue King: you" />
          <Plate seat="blue" side={null} role="You · Blue coach" crowns={0} need={0}>
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
              <NameSuggest input={youInput} onPick={(t) => setYouText(t)} />
            </label>
          </Plate>
        </div>

        <div className={styles.mid}>
          <h1 className={styles.title}>Coach Duel</h1>
          <img src={`${ART}duel.webp`} alt="" className={styles.emblem} />
          <span className={styles.round}>Against another coach</span>
          <form
            className={styles.setup}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <FormatControls
              games={games}
              playAll={playAll}
              luck={luck}
              onChange={(p) => {
                if (p.games !== undefined) setGames(p.games);
                if (p.playAll !== undefined) setPlayAll(p.playAll);
                if (p.luck !== undefined) setLuck(p.luck);
              }}
            />
            <div className={styles.chipRow} role="group" aria-label="Time to pick a deck">
              {CLOCK_MINUTES.map((m) => (
                <button key={m} type="button" className={styles.chip} aria-pressed={clock === m} onClick={() => setClock(m)}>
                  {m} min a deck
                </button>
              ))}
              <button type="button" className={styles.chip} aria-pressed={clock === NO_LIMIT} onClick={() => setClock(NO_LIMIT)}>
                No time limit
              </button>
            </div>
            <div className={styles.chipRow} role="group" aria-label="History window">
              {DAY_PRESETS.map((d) => (
                <button key={d} type="button" className={styles.chip} aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d}d
                </button>
              ))}
            </div>
            <button type="submit" className={styles.cta} disabled={!tag || busy}>
              {busy ? 'Making the room…' : 'Create room'}
            </button>
            {error && <p className={styles.setupNote}>{error}</p>}
          </form>
        </div>

        <div className={styles.side} data-seat="red">
          <King seat="red" pose="idle" emote={null} beat="r-setup" label="The Red King: the other coach" />
          <Plate seat="red" side={null} role="Red coach" crowns={0} need={0}>
            <span className={styles.plateWait}>Invited by link</span>
          </Plate>
        </div>
      </div>
      <ol className={styles.steps} aria-label="Steps">
        {['Settings', 'Share the link', 'Battle the other coach'].map((s, i) => (
          <li key={s} className={styles.step} data-on={i === 0 ? '' : undefined}>
            <span className={styles.stepNo}>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </>
  );
}

/* ── the room ───────────────────────────────────────────────────────────── */

function Countdown({ deadline, offset, onZero }: { deadline: number; offset: number; onZero: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [deadline]);
  const left = remainingMs(deadline, now, offset);
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      onZero();
    }
  }, [left, onZero]);
  return (
    <span className={styles.clock} data-low={left < 30_000 ? '' : undefined} role="timer" aria-label={`${clockLabel(left)} left to lock in`}>
      {clockLabel(left)}
    </span>
  );
}

function RoomScreen({ id }: { id: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinText, setJoinText] = useState('');
  const [joinInput, setJoinInput] = useState<HTMLInputElement | null>(null);
  const [pasted, setPasted] = useState<Pasted | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [offered, setOffered] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const [early, setEarly] = useState<number | null>(null);
  const [needle, setNeedle] = useState<number | null>(null);
  const [rolling, setRolling] = useState<number | null>(null);
  const seen = useRef<number>(-1);
  const primed = useRef(false);
  const seat = useRef(readSeat(id));
  const poll = useRef<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    for (const src of PRELOAD) {
      const i = new Image();
      i.src = src;
    }
  }, []);

  const take = useCallback((r: Room) => {
    setRoom(r);
    setOffset(r.now - Date.now());
  }, []);

  const call = useCallback(
    (params: Record<string, string>) =>
      roomToken().then((token) => fetchCoachRoom({ id, seat: seat.current, ...params }, token)),
    [id],
  );

  const refresh = useCallback(() => {
    call({})
      .then((r) => {
        if (!alive.current) return;
        take(r);
        setGone(false);
      })
      .catch((e) => {
        if (!alive.current) return;
        if (e instanceof AnalyticsError && e.kind === 'not_found') setGone(true);
        else setError(errorOf(e));
      });
  }, [call, take]);

  // The poll: every two seconds while the room can change (three while it
  // waits for the link to be opened); a finished room keeps asking, slower,
  // in case the other coach wants a rematch.
  const phase = room?.phase;
  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (gone || phase === 'closed' || phase === 'error') return;
    const ms = phase === 'waiting' ? POLL_WAITING_MS : phase === 'done' ? POLL_WAITING_MS : POLL_MS;
    poll.current = window.setInterval(refresh, ms);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, [phase, gone, refresh]);

  const act = (params: Record<string, string>, after?: () => void) => {
    setBusy(true);
    setError(null);
    call(params)
      .then((r) => {
        take(r);
        after?.();
      })
      .catch((e) => {
        setError(errorOf(e));
        refresh();
      })
      .finally(() => setBusy(false));
  };

  /* ── a finished game: the needle lands where the server's draw fell ── */
  const last = room ? lastResult(room) : null;
  // Which result was last shown: the round and the game, so a rematch's game 1
  // counts as new. The first answer only sets it (a room opened mid-duel has
  // nothing to animate).
  const lastKey = room ? room.round * 100 + (last?.no ?? 0) : -1;
  useEffect(() => {
    if (lastKey < 0) return;
    if (!primed.current) {
      primed.current = true;
      seen.current = lastKey;
      return;
    }
    if (!last?.result || lastKey === seen.current) return;
    seen.current = lastKey;
    setPasted(null);
    setEarly(null);
    const r = last.result;
    if (!r.rolled || r.draw == null || reducedMotion()) return;
    setRolling(last!.no);
    setNeedle(50);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setNeedle(r.draw ?? 50)));
    const t = window.setTimeout(() => setRolling(null), ROLL_MS);
    return () => window.clearTimeout(t);
  }, [lastKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const you: RoomSeat | null = room?.you ?? null;
  const serverNow = Date.now() + offset;
  const stage = room ? stageOf(room, serverNow) : null;
  const shownStage = stage === 'reveal' && room && early === currentGame(room)?.no ? 'pick' : stage;
  const game = room ? currentGame(room) : null;
  const myEarlier = room && you ? spentBy(room, you) : [];
  const clash = pasted ? clashWith(pasted.cards, myEarlier) : [];

  const suggestions = useMemo(() => {
    if (!room) return [];
    const keys = new Set(room.pool.map((d) => deckKey(d.cards)));
    return [...room.pool, ...room.next.filter((d) => !keys.has(deckKey(d.cards)))];
  }, [room]);

  /* ── pasting this game's deck (the vs-AI screen's paste, unchanged) ── */
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
      .then(takePaste)
      .catch(() => setPasteNote('The browser did not allow reading the clipboard. Paste the link into the box below.'));
  };
  const useSuggested = () => {
    const n = nextFresh(suggestions.map((d) => d.cards), myEarlier, offered, pasted?.cards ?? null);
    if (n === null) {
      setPasteNote("No Coach Assist deck is left that shares no card with the ones you've played.");
      return;
    }
    const d = suggestions[n.index];
    setOffered((o) => {
      const next = new Set(n.fresh ? o : []);
      next.add(deckKey(d.cards));
      return next;
    });
    setPasted({ cards: d.cards, name: d.deckName, art: d.art, origin: d.origin });
    setPasteNote(null);
  };

  const lockIn = () => {
    if (!game || !pasted || clash.length || busy) return;
    act({ act: 'lock', g: String(game.no), deck: pasted.cards.join(','), art: artParam(pasted.art) });
  };

  const join = () => {
    const tag = asTag(joinText);
    if (!tag || busy) return;
    const token = newSeatToken();
    seat.current = token;
    act({ act: 'join', tag, seat: token }, () => keepSeat(id, token));
  };

  const link = roomLink(window.location.href, id);
  const copyLink = () => {
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setCopied(false));
  };
  const share = () => {
    void navigator.share?.({ title: 'Coach Duel', text: 'Join my Coach Duel room', url: link }).catch(() => undefined);
  };

  /* ── what can't be played ── */
  if (gone) {
    return (
      <div className={styles.roomNotice}>
        <p>{roomErrorText('no_room')}</p>
        <a className={styles.cta} href="#/coach-duel/room">
          Make a new room
        </a>
      </div>
    );
  }
  if (!room) {
    return error ? (
      <div className={styles.roomNotice}>
        <p>{error}</p>
      </div>
    ) : (
      <ReadingState k="coach-room" hue="violet">
        <p>Opening the room…</p>
      </ReadingState>
    );
  }

  const blue = room.blue;
  const red = room.red;
  const nameOf = (s: RoomSeat) => (s === you ? 'You' : (room[s]?.name ?? (s === 'blue' ? 'Blue' : 'Red')));
  const theirSeat = you ? other(you) : null;
  const lastGame = last;
  const lastR = lastGame?.result ?? null;
  const isRolling = rolling !== null && lastGame?.no === rolling;
  const showResult = !!lastGame && (shownStage === 'reveal' || shownStage === 'done' || isRolling);
  const myGameDeck = game && you && hasCards(game[you]) ? (game[you] as RoomDeck) : null;
  const theirLocked = !!(game && theirSeat && game[theirSeat]);
  const champ = room.phase === 'done' ? (room.end?.winner ?? null) : null;

  /* ── the Kings ── */
  const king = (s: RoomSeat): { pose: Pose; emote: Emote | null; line?: string } => {
    if (stage === 'waiting' || stage === 'join') {
      return s === 'blue' ? { pose: 'idle', emote: 'think', line: stage === 'join' ? 'Join me.' : 'Waiting for a coach…' } : { pose: 'idle', emote: null };
    }
    if (stage === 'reading') return { pose: 'idle', emote: 'think', line: 'Scouting…' };
    if (isRolling) return { pose: 'nervous', emote: 'sweat' };
    if (room.phase === 'done') {
      if (!champ) return { pose: 'idle', emote: null };
      return champ === s
        ? { pose: 'cheer', emote: 'yeah', line: `${room.score[s]}–${room.score[other(s)]}!` }
        : { pose: 'nervous', emote: 'gg' };
    }
    if (shownStage === 'reveal' && lastR?.winner) {
      return lastR.winner === s ? { pose: 'laugh', emote: 'laugh' } : { pose: 'nervous', emote: lastR.timeout === s ? 'cry' : 'grrr' };
    }
    if (game) {
      return game[s] ? { pose: 'idle', emote: 'think', line: 'Locked in.' } : { pose: 'idle', emote: 'think', line: 'Choosing…' };
    }
    return { pose: 'idle', emote: null };
  };
  const kb = king('blue');
  const kr = king('red');
  const beat = `${room.version}|${stage}|${isRolling}`;

  const resultLine = (g: RoomGame) => {
    const r = g.result!;
    if (r.timeout === 'both') return 'Neither coach locked in.';
    if (r.timeout) return `${nameOf(r.timeout)} ${r.timeout === you ? 'were' : 'was'} out of time — the game goes to ${nameOf(other(r.timeout)).toLowerCase() === 'you' ? 'you' : nameOf(other(r.timeout))}.`;
    const blueName = room.blue?.name ?? 'Blue';
    if (!r.rolled && r.winner && r.matchup != null) {
      const theirs = r.winner === 'blue' ? r.matchup : 100 - r.matchup;
      return `${nameOf(r.winner)} won outright: a ${pctLabel(theirs)} matchup, over ${MU_DECIDES}%.`;
    }
    return `${room.settings.luck === 'mu' ? `Matchup ${pctLabel(r.matchup)} is close, so the needle decided. ` : ''}It landed at ${Math.round(r.draw ?? 0)} — ${r.winner === 'blue' ? `inside ${blueName}'s ${pctLabel(r.chance)}` : `past ${blueName}'s ${pctLabel(r.chance)}`}.`;
  };

  return (
    <>
      <div className={styles.arena} data-phase={room.phase === 'playing' ? 'battle' : room.phase === 'done' ? 'over' : 'ready'}>
        <span className={styles.seam} aria-hidden="true" />
        <div className={styles.side} data-seat="blue">
          <King seat="blue" pose={kb.pose} emote={kb.emote} line={kb.line} beat={`b|${beat}`} label="The Blue King: the host's coach" />
          <Plate seat="blue" side={blue} role={you === 'blue' ? 'You · Blue coach' : 'Blue coach'} crowns={room.score.blue} need={room.need} />
        </div>

        <div className={styles.mid}>
          <h1 className={styles.title}>Coach Duel</h1>
          <img src={`${ART}duel.webp`} alt="" className={styles.emblem} />
          {room.phase === 'playing' || room.phase === 'done' ? (
            <>
              <span className={styles.round}>
                {champ ? (champ === you ? 'Victory' : you ? 'Defeat' : `${nameOf(champ)} wins`) : room.phase === 'done' ? 'Duel over' : `Game ${game?.no ?? room.games.length} · Best of ${room.settings.bo}`}
              </span>
              <div className={styles.score} aria-label={`Score ${room.score.blue} to ${room.score.red}`}>
                <span data-seat="blue">{room.score.blue}</span>
                <span className={styles.scoreDash}>–</span>
                <span data-seat="red">{room.score.red}</span>
              </div>
            </>
          ) : (
            <span className={styles.round}>{stage === 'join' ? 'You are invited' : 'Room ready'}</span>
          )}
          <span className={styles.roundNo}>
            {settingsLine(room.settings, MU_DECIDES)}
            {room.round > 0 ? ` · Rematch ${room.round}` : ''}
          </span>

          {stage === 'waiting' && (
            <div className={styles.setup}>
              <div className={styles.linkBox}>
                <input className={styles.linkInput} value={link} readOnly aria-label="Room link" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className={styles.chip} aria-pressed={copied} onClick={copyLink}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                {typeof navigator.share === 'function' && (
                  <button type="button" className={styles.chip} onClick={share}>
                    Share
                  </button>
                )}
              </div>
              <p className={styles.setupNote}>Send this link to the other coach. The duel starts when they join.</p>
              <button type="button" className={styles.link} onClick={() => act({ act: 'leave' })} disabled={busy}>
                Close room
              </button>
            </div>
          )}

          {stage === 'join' && (
            <form
              className={styles.setup}
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
            >
              <button type="submit" className={styles.cta} disabled={!asTag(joinText) || busy}>
                {busy ? 'Joining…' : 'Join the duel'}
              </button>
              <p className={styles.setupNote}>Pick your player on the red side, then join.</p>
            </form>
          )}
        </div>

        <div className={styles.side} data-seat="red">
          <King seat="red" pose={kr.pose} emote={kr.emote} line={kr.line} beat={`r|${beat}`} label="The Red King: the other coach" />
          <Plate seat="red" side={red} role={you === 'red' ? 'You · Red coach' : 'Red coach'} crowns={room.score.red} need={room.need}>
            {stage === 'join' ? (
              <label className={styles.seatField}>
                <span className="sr-only">Your player</span>
                <input
                  ref={setJoinInput}
                  className={styles.input}
                  value={joinText}
                  onChange={(e) => {
                    setJoinText(e.target.value);
                    setError(null);
                  }}
                  placeholder="Your player: name or #TAG"
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <NameSuggest input={joinInput} onPick={(t) => setJoinText(t)} />
              </label>
            ) : (
              <span className={styles.plateWait}>Waiting for a coach…</span>
            )}
          </Plate>
        </div>
      </div>

      <ol className={styles.steps} aria-label="Steps">
        {['Settings', 'Share the link', 'Battle the other coach'].map((s, i) => {
          const at = room.phase === 'waiting' ? 1 : 2;
          return (
            <li key={s} className={styles.step} data-on={i === at ? '' : undefined} data-done={i < at ? '' : undefined}>
              <span className={styles.stepNo}>{i < at ? '✓' : i + 1}</span>
              {s}
            </li>
          );
        })}
      </ol>

      {error && <p className={styles.error}>{error}</p>}

      {stage === 'reading' && (
        <ReadingState k="coach-room" hue="violet">
          <p>Both coaches are in. Reading both players…</p>
        </ReadingState>
      )}
      {(stage === 'closed' || stage === 'full' || stage === 'error') && (
        <div className={styles.roomNotice}>
          <p>
            {stage === 'full'
              ? roomErrorText('room_full')
              : stage === 'error'
                ? roomErrorText(room.error ?? '')
                : endLine(room) || roomErrorText('room_closed')}
          </p>
          <a className={styles.cta} href="#/coach-duel/room">
            Make a new room
          </a>
        </div>
      )}

      {(room.phase === 'playing' || room.phase === 'done') && you && (
        <section className={styles.panel} aria-label="The duel">
          <ol className={styles.track} data-games={room.settings.bo} aria-label="Games">
            {Array.from({ length: room.settings.bo }, (_, i) => {
              const g = room.games[i];
              const r = g?.result;
              const bd = g && hasCards(g.blue) ? g.blue : null;
              const rd = g && hasCards(g.red) ? g.red : null;
              return (
                <li key={i} className={styles.trackGame} data-result={r?.winner ? (r.winner === you ? 'you' : 'ai') : undefined}>
                  <span className={styles.trackNo}>G{i + 1}</span>
                  {r ? (
                    <span className={styles.trackDecks}>
                      <span data-seat="blue">{bd?.deckName ?? (r.timeout === 'blue' ? 'Out of time' : '—')}</span>
                      <span className={styles.trackVs}>vs</span>
                      <span data-seat="red">{rd?.deckName ?? (r.timeout === 'red' ? 'Out of time' : '—')}</span>
                    </span>
                  ) : (
                    <span className={styles.trackDecks}>{g ? 'Now' : room.phase === 'done' ? 'Not played' : '—'}</span>
                  )}
                  {r?.winner && <Crown on />}
                </li>
              );
            })}
          </ol>

          {room.phase === 'done' && (
            <div className={styles.result} data-winner={champ === you ? 'you' : champ ? 'ai' : undefined}>
              <p className={styles.resultWord}>{champ ? (champ === you ? 'Victory' : 'Defeat') : 'No result'}</p>
              <p className={styles.resultScore}>
                {room.score[you]}–{room.score[other(you)]}
              </p>
              {endLine(room) && <p className={styles.resultNote}>{endLine(room)}</p>}
              <div className={styles.resultActions}>
                {room.end?.reason !== 'left' && room.end?.reason !== 'abandoned' ? (
                  <button type="button" className={styles.cta} onClick={() => act({ act: 'rematch' })} disabled={busy || room.rematch[you]}>
                    {room.rematch[you] ? 'Waiting for their answer…' : room.rematch[other(you)] ? 'Accept the rematch' : 'Rematch'}
                  </button>
                ) : null}
                <a className={styles.ghost} href="#/coach-duel/room">
                  New room
                </a>
              </div>
              {room.rematch[other(you)] && !room.rematch[you] && (
                <p className={styles.resultNote}>{nameOf(other(you))}'s coach wants a rematch.</p>
              )}
            </div>
          )}

          {/* The game just played: both decks, the chance, the needle. */}
          {showResult && lastGame && lastR && (
            <div className={styles.faceoff} data-result={lastR.winner === you ? 'w' : 'l'}>
              <h2 className={styles.gameTitle}>
                Game {lastGame.no}
                {!isRolling && lastR.winner && (
                  <span className={styles.gameWinner} data-seat={lastR.winner}>
                    {lastR.winner === you ? 'You win' : `${nameOf(lastR.winner)} wins`}
                  </span>
                )}
              </h2>
              {lastR.chance != null && (
                <ChanceBar
                  you={lastR.chance}
                  needle={lastR.rolled ? (isRolling ? needle : (lastR.draw ?? null)) : null}
                  rolling={isRolling}
                  names={[nameOf('blue'), nameOf('red')]}
                />
              )}
              {!isRolling && <p className={styles.howLine}>{resultLine(lastGame)}</p>}
              <div className={styles.faceRow}>
                {hasCards(lastGame.blue) ? (
                  <DeckTile deck={asDraw(lastGame.blue)} seat="blue">
                    <DeckActions cards={lastGame.blue.cards} name={lastGame.blue.deckName ?? undefined} />
                  </DeckTile>
                ) : (
                  <CardBack busy={false} seat="blue" label="No deck" text="Out of time" />
                )}
                <span className={styles.vs} aria-hidden="true">
                  VS
                </span>
                {hasCards(lastGame.red) ? (
                  <div className={styles.flip}>
                    <DeckTile deck={asDraw(lastGame.red)} seat="red">
                      <DeckActions cards={lastGame.red.cards} name={lastGame.red.deckName ?? undefined} />
                    </DeckTile>
                  </div>
                ) : (
                  <CardBack busy={false} seat="red" label="No deck" text="Out of time" />
                )}
              </div>
              {shownStage === 'reveal' && game && !isRolling && (
                <div className={styles.turnActions}>
                  <span className={styles.waitLine}>
                    Game {game.no} opens in <Countdown deadline={game.start} offset={offset} onZero={refresh} />
                  </span>
                  <button type="button" className={styles.cta} onClick={() => setEarly(game.no)}>
                    Pick my game {game.no} deck
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Your move: your deck for this game, facing the other coach's
              face-down card, and the clock. */}
          {game && (shownStage === 'pick' || shownStage === 'locked') && !isRolling && (
            <div className={styles.turn}>
              <h2 className={styles.turnTitle}>
                <span>Game {game.no}</span>
                <span className={styles.turnSub}>
                  {shownStage === 'locked' ? `Locked in — waiting for ${nameOf(theirSeat!)}` : 'Your move'}
                  {game.deadline !== null && (
                    <>
                      {' · '}
                      <Countdown deadline={game.deadline} offset={offset} onZero={refresh} />
                    </>
                  )}
                </span>
              </h2>
              {lastGame && lastR && shownStage === 'pick' && (
                <p className={styles.turnNote}>
                  Game {lastGame.no}: {lastR.winner ? (lastR.winner === you ? 'you won' : `${nameOf(lastR.winner)} won`) : 'no result'}
                </p>
              )}
              <div className={styles.faceRow}>
                {myGameDeck ? (
                  <DeckTile deck={asDraw(myGameDeck)} seat={you}>
                    <p className={styles.readyLine}>Locked in</p>
                  </DeckTile>
                ) : pasted ? (
                  <DeckTile
                    deck={{ ...pasted, deckName: pasted.name }}
                    seat={you}
                    badge={
                      <span className={styles.tileBadges}>
                        {pasted.origin === 'crl' && <span className={styles.tag}>CRL list</span>}
                        <button type="button" className={styles.slotClear} aria-label="Remove this deck" onClick={() => setPasted(null)}>
                          ×
                        </button>
                      </span>
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
                  <div className={styles.drop} data-seat={you}>
                    <svg viewBox="0 0 24 24" className={styles.dropIcon} aria-hidden="true">
                      <path d="M9 4h6a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1V6a2 2 0 0 1 2-2Zm0 2v3h6V6H9Z" />
                    </svg>
                    <p className={styles.dropTitle}>Your deck for game {game.no}</p>
                    <div className={styles.dropActions}>
                      <button type="button" className={styles.dropBtn} onClick={pasteFromClipboard}>
                        Paste deck link
                      </button>
                      <button type="button" className={styles.dropBtn} onClick={useSuggested} disabled={!suggestions.length}>
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
                <CardBack
                  busy={!theirLocked}
                  seat={theirSeat!}
                  label={`${nameOf(theirSeat!)}'s deck, face down`}
                  text={theirLocked ? 'Locked in · face down' : `${nameOf(theirSeat!)}'s coach is choosing…`}
                />
              </div>
              {pasteNote && <p className={styles.turnNote}>{pasteNote}</p>}
              {!myGameDeck && (
                <div className={styles.turnActions}>
                  {pasted && (
                    <button type="button" className={styles.ghost} onClick={useSuggested} disabled={!suggestions.length}>
                      Another Coach Assist deck
                    </button>
                  )}
                  <button type="button" className={styles.cta} disabled={!pasted || clash.length > 0 || busy} onClick={lockIn}>
                    Lock in
                  </button>
                </div>
              )}
              <p className={styles.turnNote}>
                Both decks flip when both coaches lock in.{game.deadline !== null ? ' Out of time loses the game.' : ''}
                {myEarlier.length > 0 ? ` ${myEarlier.length * 8} of your cards are spent this duel.` : ''}
              </p>
            </div>
          )}

          {room.phase === 'done' && (
            <div className={styles.reveal}>
              <h3 className={styles.revealTitle}>The decks this duel</h3>
              {room.games
                .filter((g) => g.result)
                .map((g) => (
                  <div key={g.no} className={styles.roomGameRow}>
                    <span className={styles.trackNo}>G{g.no}</span>
                    {hasCards(g.blue) ? <DeckTile deck={asDraw(g.blue)} seat="blue" /> : <CardBack busy={false} seat="blue" label="No deck" text="Out of time" />}
                    {hasCards(g.red) ? <DeckTile deck={asDraw(g.red)} seat="red" /> : <CardBack busy={false} seat="red" label="No deck" text="Out of time" />}
                  </div>
                ))}
            </div>
          )}
        </section>
      )}

      {(room.phase === 'playing' || room.phase === 'reading') && you && (
        <div className={styles.footActions}>
          <button
            type="button"
            className={styles.link}
            disabled={busy}
            onClick={() => {
              if (window.confirm('Leave the duel? The other coach wins it.')) act({ act: 'leave' });
            }}
          >
            Leave the duel
          </button>
        </div>
      )}
    </>
  );
}

/** `#/coach-duel/room` makes a room; `#/coach-duel/room/<id>` is one. */
export function CoachRoom({ hash }: { hash: string }) {
  const id = parseRoomHash(hash);
  const go = (room: Room) => {
    window.location.hash = roomHash(room.id);
  };
  return (
    <section className={styles.page}>
      <ModeNav mode="room" />
      {id === '' ? (
        <CreateRoom onCreated={go} />
      ) : id ? (
        <RoomScreen key={id} id={id} />
      ) : (
        <div className={styles.roomNotice}>
          <p>That room link is not complete. Ask for the link again, or make a new room.</p>
          <a className={styles.cta} href="#/coach-duel/room">
            Make a new room
          </a>
        </div>
      )}
    </section>
  );
}
