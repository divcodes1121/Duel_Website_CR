/* The tier badge in the top bar, drawn as the Nexus tactile button.
 *
 * THREE TIERS, THREE COLOURS, ONE SHADER. The authored liquid is cyan and the
 * recolour channel is ThreeUI's own — `hue`/`saturation`/`brightness`, applied
 * as a CSS filter over the canvas exactly as `NeuformIsolatedEffects` does it.
 * Nothing in the shader is edited: the fill, the caustics, the meniscus flare
 * and the slosh are the authored ones, rotated.
 *
 * The hue numbers below are MEASURED, not guessed. `hue-rotate` is a fixed
 * luminance-preserving matrix and not a true HSL rotation, so the angle that
 * lands on a given colour is not the angle the colour wheel would predict —
 * each one here was sampled off the rendered canvas and adjusted until the
 * liquid read as the intended colour.
 *
 * MEMBER, NOT TRIAL. "Trial" describes what the account is to us — a countdown
 * we are running — and "Member" describes what the person is, which is the only
 * one of the two they have any reason to care about. The countdown still exists
 * and is still shown, in the title, where someone can go looking for it.
 */

import { TactileButton } from './TactileButton';
import type { Tier } from '../../state/tiers';

/* Each tier's liquid: THE AUTHORED PALETTE WITH ITS HUE MOVED, and nothing else.
 *
 * THREE ATTEMPTS, AND WHY THE FIRST TWO WERE WRONG.
 *
 *   1. CSS `hue-rotate` + `brightness`, ThreeUI's own channel. A filter treats
 *      the meniscus flare and the body as the same pixels, so reaching a dark
 *      colour meant `brightness: 0.5`, which flattened the water.
 *   2. Colour stops derived from this project's `--solid-*` fill tokens. That
 *      fixed the hue and killed the vividness instead — those tokens are DARK
 *      FLAT FILLS graded to hold white text, so `--solid-green` (#047857) has
 *      roughly half the value and much less saturation than the authored cyan.
 *      Building a liquid around one produces a muted liquid.
 *
 * The authored cyan looks the way it does because of its SATURATION and VALUE,
 * not its hue: shallow is S 1.00 / V 1.00, deep is S 0.956 / V 0.45. So the
 * palette below keeps both numbers exactly and substitutes only the hue. Every
 * tier therefore has the same brightness structure as the button the author
 * drew — it is the same water, dyed.
 *
 *   authored   shallow H 186  ->  deep H 222   (+36deg: deeper reads bluer)
 *
 * That +36 spread is part of the look and is preserved per tier, which is why
 * each row names two hues rather than one:
 *
 *   role     shallow            deep               S/V
 *   pro      H 205  #0095ff     H 238  #050973     identical to authored
 *   member   H 142  #00ff5e     H 170  #057360     identical to authored
 *   admin    H 345  #ff0040     H 318  #730552     identical to authored
 *
 * The site's `--solid-*` tokens are no longer used here. They are the right
 * colours for a flat chip that must hold white text at 4.5:1; they are the
 * wrong ones to build a lit liquid out of, and trying cost two rounds.
 */
type RGB = [number, number, number];

/** Saturation and value taken from the authored liquid, hue supplied. */
function hsv(hDeg: number, s: number, v: number): RGB {
  const h = ((hDeg % 360) + 360) % 360 / 60;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const table: RGB[] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
  return table[i % 6];
}

/* The authored liquid's own S and V — the two numbers that make it read as lit. */
const SHALLOW_S = 1.0, SHALLOW_V = 1.0;
const DEEP_S = 0.956, DEEP_V = 0.45;

/** toward white by t — the author's own rule for both highlight stops; his
 *  glowB, vec3(0.8,0.98,1.0), IS mix(shallow, white, 0.8) exactly. */
const glow = (c: RGB, t: number): RGB =>
  [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t];
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function liquidAtHue(shallowHue: number, deepHue: number) {
  const shallow = hsv(shallowHue, SHALLOW_S, SHALLOW_V);
  return {
    shallow,
    deep: hsv(deepHue, DEEP_S, DEEP_V),
    sloshTint: scale(shallow, 0.3),
    glowA: glow(shallow, 0.4),
    glowB: glow(shallow, 0.8),
  };
}

const LOOK: Record<'admin' | 'pro' | 'trial', {
  label: string;
  shallowHue: number;
  deepHue: number;
}> = {
  admin: { label: 'ADMIN', shallowHue: 345, deepHue: 318 },
  pro: { label: 'PRO', shallowHue: 205, deepHue: 238 },
  trial: { label: 'MEMBER', shallowHue: 142, deepHue: 170 },
};

export function TierBadge({
  tier,
  trialDaysLeft,
  width = 104,
  height = 30,
  onClick,
}: {
  tier: Tier | 'anon';
  trialDaysLeft?: number;
  width?: number;
  height?: number;
  onClick?: () => void;
}) {
  if (tier !== 'admin' && tier !== 'pro' && tier !== 'trial') return null;
  const look = LOOK[tier];

  /* The countdown moves into the tooltip rather than the face. A number that
     changes every day is not a status, and the badge is read as one. */
  const title =
    tier === 'trial'
      ? trialDaysLeft && trialDaysLeft > 0
        ? `Deckkies Member — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
        : 'Deckkies Member'
      : tier === 'pro'
        ? 'Deckkies Pro'
        : 'Administrator';

  return (
    <TactileButton
      label={look.label}
      title={title}
      liquid={liquidAtHue(look.shallowHue, look.deepHue)}
      width={width}
      height={height}
      onClick={onClick}
    />
  );
}
