/* THE TWO COACHES, drawn (2026-10-20).
 *
 * Two hand-built vector busts, one per seat, so the Coach Duel reads as two
 * beings facing each other rather than two tables. Blue is a coach with a
 * headset and a bun; red wears a cap and a beard. Both are front-facing; they
 * look at each other with their eyes (`look`), so neither drawing is mirrored
 * and the faces stay the right way round.
 *
 * MOOD IS STATE, NOT A LOOP. The project has one infinite animation and this
 * is not going to be the second: every movement here is a transition from one
 * mood to the next (brows, mouth, pupils, head tilt) or a one-shot keyframe
 * keyed on the moment it marks (a cheer on a win, a blink on any change). A
 * coach standing still is still.
 *
 * Colours are the drawing's own (skin, hair, kit) and do not follow the theme:
 * the coaches stand on the arena backdrop, which is dark-scrimmed in both.
 */
import styles from './CoachAvatar.module.css';

export type CoachMood = 'idle' | 'think' | 'happy' | 'sad' | 'win';
export type CoachLook = 'in' | 'down' | 'ahead';

const INK = '#1b1220';

/* The five mouths, all drawn, one shown — so a change of mood cross-fades
   instead of jumping. Centred under the nose at (110, 150). */
function Mouths({ lip, inside }: { lip: string; inside: string }) {
  return (
    <g className={styles.mouths}>
      <path data-m="idle" d="M98 149 Q110 155 122 149" fill="none" stroke={lip} strokeWidth="3.2" strokeLinecap="round" />
      <g data-m="think">
        <path d="M101 152 Q108 149 118 151" fill="none" stroke={lip} strokeWidth="3.2" strokeLinecap="round" />
      </g>
      <g data-m="happy">
        <path d="M96 146 Q110 163 124 146 Q110 151 96 146 Z" fill={inside} stroke={lip} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M99 147.2 Q110 151.5 121 147.2 L119.5 150 Q110 153 100.5 150 Z" fill="#fff" />
      </g>
      <g data-m="win">
        <path d="M92 143 Q110 172 128 143 Q110 149 92 143 Z" fill={inside} stroke={lip} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M95.5 144.4 Q110 150 124.5 144.4 L122.5 148.6 Q110 152.5 97.5 148.6 Z" fill="#fff" />
        <path d="M101 160 Q110 165 119 160 Q110 158 101 160 Z" fill="#e2566b" />
      </g>
      <path data-m="sad" d="M99 155 Q110 146 121 155" fill="none" stroke={lip} strokeWidth="3.2" strokeLinecap="round" />
    </g>
  );
}

function Eyes({ brow, iris }: { brow: string; iris: string }) {
  return (
    <g>
      {[92, 128].map((cx, i) => (
        <g key={cx} className={styles.eye}>
          <ellipse cx={cx} cy="117" rx="9" ry="7" fill="#fff" />
          <g className={styles.pupil}>
            <circle cx={cx} cy="117.5" r="4.6" fill={iris} />
            <circle cx={cx} cy="117.5" r="2.3" fill={INK} />
            <circle cx={cx + 1.6} cy="115.6" r="1.3" fill="#fff" />
          </g>
          {/* The lid: closed for a blink, half down when disappointed. */}
          <rect className={styles.lid} x={cx - 10} y="109" width="20" height="9" rx="4" />
          <path
            className={i === 0 ? styles.browL : styles.browR}
            d={i === 0 ? 'M81 102 Q91 96 102 100' : 'M118 100 Q129 96 139 102'}
            fill="none"
            stroke={brow}
            strokeWidth="4.2"
            strokeLinecap="round"
          />
        </g>
      ))}
    </g>
  );
}

function BlueCoach() {
  const skin = '#b5774b';
  const shade = '#94603a';
  const hair = '#22150f';
  return (
    <>
      {/* kit: a blue team jacket over a white collar */}
      <path d="M14 262 C18 214 56 194 110 194 C164 194 202 214 206 262 Z" fill="#1d4ed8" />
      <path d="M14 262 C18 222 44 204 76 198 L92 262 Z" fill="#2563eb" />
      <path d="M206 262 C202 222 176 204 144 198 L128 262 Z" fill="#2563eb" />
      <path d="M90 196 L110 232 L130 196 Z" fill="#f1f5f9" />
      <path d="M110 232 L110 262" stroke="#1e3a8a" strokeWidth="2.5" />
      <circle cx="152" cy="226" r="7" fill="#fbbf24" stroke="#b45309" strokeWidth="1.5" />
      <path d="M148.5 227 L150.5 223.5 L152 226 L153.5 223.5 L155.5 227 Z" fill="#b45309" />
      {/* neck */}
      <path d="M95 160 L95 198 Q110 208 125 198 L125 160 Z" fill={shade} />
      <g className={styles.head}>
        {/* hair behind */}
        <path d="M60 112 C56 66 84 50 110 50 C136 50 164 66 160 112 C162 140 154 150 150 152 L70 152 C66 150 58 140 60 112 Z" fill={hair} />
        <circle cx="110" cy="40" r="19" fill={hair} />
        <ellipse cx="62" cy="122" rx="7" ry="10" fill={shade} />
        <ellipse cx="158" cy="122" rx="7" ry="10" fill={shade} />
        <ellipse cx="110" cy="118" rx="47" ry="55" fill={skin} />
        {/* front hair, swept */}
        <path d="M63 108 C62 74 86 62 110 62 C136 62 158 74 157 108 C150 90 134 80 112 82 C96 83 80 90 63 108 Z" fill={hair} />
        <Eyes brow={hair} iris="#5b3a1e" />
        <path d="M110 121 C108 131 106 135 111 137" fill="none" stroke={shade} strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="82" cy="136" rx="8" ry="4.5" fill="#e07a6b" opacity="0.35" />
        <ellipse cx="138" cy="136" rx="8" ry="4.5" fill="#e07a6b" opacity="0.35" />
        <Mouths lip="#5a2a1c" inside="#4a1414" />
        {/* headset */}
        <path d="M56 118 C52 56 168 56 164 118" fill="none" stroke="#0f172a" strokeWidth="6" strokeLinecap="round" />
        <rect x="48" y="104" width="15" height="30" rx="7" fill="#0f172a" />
        <rect x="157" y="104" width="15" height="30" rx="7" fill="#0f172a" />
        <rect x="51" y="110" width="9" height="18" rx="4" fill="#3b82f6" />
        <path d="M58 134 C62 158 78 166 94 164" fill="none" stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="96" cy="164" r="4.5" fill="#0f172a" />
        <circle cx="160" cy="146" r="2.6" fill="#fbbf24" />
      </g>
    </>
  );
}

function RedCoach() {
  const skin = '#efc3a0';
  const shade = '#d39c78';
  const hair = '#7a2e12';
  return (
    <>
      {/* kit: a red hoodie, drawstrings, a whistle on a lanyard */}
      <path d="M14 262 C18 214 56 194 110 194 C164 194 202 214 206 262 Z" fill="#b91c1c" />
      <path d="M64 200 C76 214 144 214 156 200 C150 192 70 192 64 200 Z" fill="#991b1b" />
      <path d="M98 208 L96 240 M122 208 L124 240" stroke="#fde2e2" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M80 204 Q110 252 140 204" fill="none" stroke="#111827" strokeWidth="2.5" />
      <rect x="103" y="226" width="16" height="9" rx="3" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
      {/* neck */}
      <path d="M95 160 L95 198 Q110 208 125 198 L125 160 Z" fill={shade} />
      <g className={styles.head}>
        <ellipse cx="62" cy="122" rx="7" ry="10" fill={shade} />
        <ellipse cx="158" cy="122" rx="7" ry="10" fill={shade} />
        <ellipse cx="110" cy="118" rx="47" ry="55" fill={skin} />
        {/* beard along the jaw, sideburns into the cap */}
        <path d="M63 112 C62 160 86 178 110 178 C134 178 158 160 157 112 C152 142 138 156 110 157 C82 156 68 142 63 112 Z" fill={hair} />
        <Eyes brow={hair} iris="#2f6b3f" />
        <path d="M110 121 C108 131 106 135 111 137" fill="none" stroke={shade} strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="82" cy="134" rx="8" ry="4.5" fill="#e8806b" opacity="0.32" />
        <ellipse cx="138" cy="134" rx="8" ry="4.5" fill="#e8806b" opacity="0.32" />
        {/* moustache */}
        <path d="M96 143 Q103 138 110 142 Q117 138 124 143 Q117 146 110 144 Q103 146 96 143 Z" fill={hair} />
        <Mouths lip="#6b2410" inside="#3d0c0c" />
        {/* cap, worn forward */}
        <path d="M60 100 C58 58 86 46 110 46 C134 46 162 58 160 100 Z" fill="#b91c1c" />
        <path d="M110 46 L110 100" stroke="#991b1b" strokeWidth="2" />
        <path d="M56 100 C80 90 140 90 164 100 C152 110 68 110 56 100 Z" fill="#7f1d1d" />
        {/* a small gold crown sewn on the front */}
        <path d="M100 81 L102.5 68 L107.5 75 L110 64 L112.5 75 L117.5 68 L120 81 Z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="102.5" cy="67" r="1.8" fill="#fde68a" />
        <circle cx="110" cy="63" r="1.8" fill="#fde68a" />
        <circle cx="117.5" cy="67" r="1.8" fill="#fde68a" />
        <circle cx="110" cy="46" r="3" fill="#7f1d1d" />
      </g>
    </>
  );
}

export function CoachAvatar({
  seat,
  mood,
  look = 'in',
  label,
  beat,
}: {
  seat: 'blue' | 'red';
  mood: CoachMood;
  look?: CoachLook;
  label: string;
  /** Changes whenever something happens to this coach; replays the blink
   *  and, on a win, the cheer. */
  beat?: string | number;
}) {
  return (
    <svg
      key={beat}
      className={styles.coach}
      viewBox="0 0 220 262"
      role="img"
      aria-label={label}
      data-seat={seat}
      data-mood={mood}
      data-look={look}
    >
      <ellipse cx="110" cy="258" rx="92" ry="6" fill="rgba(0,0,0,0.28)" />
      <g className={styles.body}>{seat === 'blue' ? <BlueCoach /> : <RedCoach />}</g>
    </svg>
  );
}
