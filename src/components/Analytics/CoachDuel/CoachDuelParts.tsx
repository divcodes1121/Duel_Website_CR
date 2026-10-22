/* THE COACH DUEL ARENA'S PIECES (moved out of CoachDuel.tsx on 2026-10-22,
 * so the vs-AI screen and the two-coach room draw one arena): the Kings,
 * the name plates, the chance bar, the deck tiles and the face-down card.
 */
import { CardArt } from '../CardArt';
import { CARDS_BY_KEY } from '../../../data/cards';
import type { CoachDuelDeck } from '../../../state/analyticsClient';
import { MU_DECIDES, pctLabel, type Format, type Luck } from '../../../utils/coachDuel';
import styles from './CoachDuel.module.css';

export type Seat = 'blue' | 'red';
export type Pose = 'idle' | 'laugh' | 'nervous' | 'cheer';
export type Emote = 'laugh' | 'cry' | 'grrr' | 'think' | 'sweat' | 'gg' | 'yeah' | 'thumbsdown';

/** How long the needle takes to land, unless motion is reduced. */
export const ROLL_MS = 1400;

export const ART = `${import.meta.env.BASE_URL}assets/kings/`;
/** The Blue King has no fists-up pose (see the art script): he laughs. */
export const kingArt = (seat: Seat, pose: Pose) =>
  `${ART}${seat}-${seat === 'blue' && pose === 'cheer' ? 'laugh' : pose}.webp`;
export const emoteArt = (e: Emote) => `${ART}emote-${e}.webp`;
export const PRELOAD = [
  ...(['blue', 'red'] as Seat[]).flatMap((s) => (['idle', 'laugh', 'nervous', 'cheer'] as Pose[]).map((p) => kingArt(s, p))),
  ...(['laugh', 'cry', 'grrr', 'think', 'sweat', 'gg', 'yeah'] as Emote[]).map(emoteArt),
  `${ART}duel.webp`,
];

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export const cardName = (k: string) => CARDS_BY_KEY.get(k)?.name ?? k;

/* ── pieces ────────────────────────────────────────────────────────────── */

export type DrawDeck = { cards: string[]; art?: CoachDuelDeck['art']; artFilled?: string[]; deckName?: string };

export function Strip({ deck }: { deck: DrawDeck }) {
  return (
    <span className={styles.stripGrid}>
      {deck.cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={deck.art?.[c]} inferred={!!deck.artFilled?.includes(c)} />
      ))}
    </span>
  );
}

export function Crown({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 20" className={styles.crown} data-on={on ? '' : undefined} aria-hidden="true">
      <path d="M2 17 L4 5 L9 10 L12 2 L15 10 L20 5 L22 17 Z" />
    </svg>
  );
}

export function King({ seat, pose, emote, line, beat, label }: {
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

export function Plate({ seat, side, role, children, crowns, need }: {
  seat: Seat; side: { name: string; tag: string } | null; role: string; children?: React.ReactNode; crowns: number; need: number;
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

export function ChanceBar({ you, needle, rolling, names = ['you', 'AI'] }: {
  you: number; needle: number | null; rolling: boolean; names?: [string, string];
}) {
  return (
    <div className={styles.chance}>
      <div className={styles.chanceLegend}>
        <span data-seat="blue">{pctLabel(you)}</span>
        <span className={styles.chanceWord}>Win chance</span>
        <span data-seat="red">{pctLabel(100 - you)}</span>
      </div>
      <div className={styles.bar} role="img" aria-label={`Win chance: ${names[0]} ${pctLabel(you)}, ${names[1]} ${pctLabel(100 - you)}`}>
        <span className={styles.barBlue} style={{ width: `${you}%` }} />
        <span className={styles.barRed} style={{ width: `${100 - you}%` }} />
        {needle !== null && (
          <span className={styles.needle} data-rolling={rolling ? '' : undefined} style={{ left: `${needle}%` }} />
        )}
      </div>
    </div>
  );
}

export function DeckTile({ deck, seat, badge, children }: {
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

export function CardBack({ busy, seat = 'red', label = "The AI coach's deck, face down", text }: {
  busy: boolean; seat?: Seat; label?: string; text?: string;
}) {
  return (
    <div className={styles.cardBack} aria-label={label} data-seat={seat}>
      <img src={`${ART}badge-${seat}.webp`} alt="" />
      <span>{text ?? (busy ? 'The AI coach is choosing…' : 'Face down until you lock in')}</span>
    </div>
  );
}

export function FormatControls({ games, playAll, luck, onChange }: {
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

/** Against the AI coach, or against another coach in a room (2026-10-22). */
export function ModeNav({ mode }: { mode: 'ai' | 'room' }) {
  return (
    <nav className={styles.modeNav} aria-label="Who you play">
      <a className={styles.modeLink} href="#/coach-duel" aria-current={mode === 'ai' ? 'page' : undefined}>
        Against the AI coach
      </a>
      <a className={styles.modeLink} href="#/coach-duel/room" aria-current={mode === 'room' ? 'page' : undefined}>
        Against another coach
      </a>
    </nav>
  );
}
