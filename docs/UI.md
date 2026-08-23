# UI — the WebGL layer

What `src/three/` is, what it deliberately is not, and the five things that had
to be measured in a browser rather than reasoned about.

Everything else about the interface — colour, motion tokens, the display face,
the surface ladder — lives in the main `README.md`. This file covers only the
three.js work.

---

## What ships

| | where | when |
|---|---|---|
| **Fireflies, hero** | landing hero, over the castle art | both themes |
| **Fireflies, app-wide** | fixed behind the whole signed-in shell | **dark only** |
| **Login backdrop** | the painted castle pair behind the sign-in card | both themes |

That is the whole surface. Two components, one of them used twice:

```
src/three/
  runtime.ts      lazy loader, motion gating, DPR cap, resize, loop control
  Fireflies.tsx   drifting motes, three depth bands, pointer parallax
```

---

## Three rules the whole directory inherits

These are in `runtime.ts` and every component gets them for free.

**1. three.js is never in the main bundle.** It is ~190 kB gzipped, which would
be more than a third of the app. `loadThree()` is a dynamic import, so it lands
in its own chunk and arrives only when something actually renders — exactly the
treatment `jspdf` already gets.

```
dist/assets/index-*.js          523 kB  │ gzip 158 kB   ← main, no three.js in it
dist/assets/three.module-*.js   734 kB  │ gzip 190 kB   ← on demand
```

The main bundle was 518 kB before any of this. The +5 kB is the components.
Verified by grepping the built main chunk for three-internal strings
(`ShaderChunk`, `shadowmap_pars_fragment`): **0 occurrences.**

> A false positive worth knowing about: grepping for `WebGLRenderer` finds
> matches in the main chunk even when three is fully split, because
> `new THREE.WebGLRenderer(...)` compiles to that literal property name in *our*
> call sites. Grep for something only three's own source contains.

**2. Nothing loops off-screen.** `CLAUDE.md` bans infinite animation, and
rightly — the old CSS glow loops animated `box-shadow` and `filter`, which
thrashes repaint, and that is what made the app lag. A WebGL canvas is GPU-side
and does not touch layout, so the ban does not apply for the same reason. But a
loop nobody can see is still pure waste, so `runLoop()` gates every frame on an
`IntersectionObserver` *and* on `document.visibilitychange`, and a frame
callback can return `false` to tear its own rAF down permanently.

**3. `prefers-reduced-motion` mounts no canvas at all**, not a slower one. Every
component keeps the flat markup it decorates and simply never replaces it.
Verified in the browser: **0 canvases** under `reducedMotion: 'reduce'`.

Also: device pixel ratio is capped at 2. Uncapped, a 3× phone renders nine times
the pixels for a flourish nobody is looking closely at.

---

## Fireflies

Ninety to two hundred and forty points on three depth bands, drifting upward and
wrapping rather than respawning, with the camera shifting a few hundredths of a
unit under the pointer. Parallax is doing all the work — it reads as depth far
more cheaply than anything geometric.

One draw call. No texture: `gl_PointCoord` gives a round soft-edged sprite in
the fragment shader for free.

**The painted art underneath is never touched.** The castle backdrop and the
king stay exactly as they are; this is a transparent layer above them. Trying to
re-render painted art in WebGL would lose everything that makes it look painted.

### Props

| prop | default | why |
|---|---|---|
| `count` | `130` | the app-wide layer covers far more area, so it asks for `240` |
| `fixed` | `false` | pins to the viewport instead of the parent box, and widens the x spread, for the shell backdrop |

### The palette is per theme, and so is the blend mode

```ts
const PALETTE = {
  dark:  { color: '#ffdd94', opacity: 0.78 },   // additive
  light: { color: '#d98a1f', opacity: 0.60 },   // normal
};
```

**Additive blending is only correct on black.** Adding warm gold to `#000` reads
as light. Adding it to near-white clamps to white, so a light-mode mote is
invisible *however far the opacity is turned up* — which is why turning it up
was the wrong knob and the first light-mode attempt failed. Light paints amber
with `NormalBlending` instead. The blend mode therefore lives in the palette and
switches with the theme, rather than being a fixed material property.

The theme can change while the layer is mounted, so a `MutationObserver` on
`<html data-theme>` re-applies colour, opacity *and* blending.

---

## The login backdrop

The same castle pair the landing hero uses: `light_background.webp` and
`dark_background.webp` from `public/assets/background/`, swapped on
`data-theme`. **Two paintings, never one image filtered** — that is what
`scripts/build-hero-art.py` produces.

The scrim under the sign-in card is a **radial**, not a full-width wash. The
composition has a castle at *both* edges, and a wash at full opacity erases the
left one — a mistake this project already made once on the landing page. This
one fades out before it reaches either edge, so both castles survive.

---

## Tried, and removed

All three worked. None of them survived looking at them.

**Card foil** — the hovered card in the picker tilted toward the cursor with
real perspective and a holographic sheen swept the art. One renderer moved
between tiles rather than one per card, because the picker draws 122 and a
browser allows about 16 WebGL contexts. Removed: the card screen read worse with
it than without.

**Elixir orb** — the avg-elixir glyph as a glass teardrop that wobbled on hover.
Real refraction (`transmission`) needs a render target and something behind the
glass to bend, which on a 16 px transparent canvas costs a lot and reads as
grey; this faked it with fresnel and a moving specular, which is what the eye
uses anyway. Removed with the foil, being on the same screen.

**Login crown** — a crown built from primitives that tumbled in, glinted once,
and returned `false` from its frame callback so the rAF tore down for good.
After ~3 s it cost nothing. It looked fine on the old flat login page and wrong
the moment there was a painted castle behind it.

All three are recoverable from `a452525`.

---

## Five things the browser caught that reading could not

Each of these was written confidently and was wrong.

**1. A uniform declared in both shader stages at different precisions fails
validation outright.** three defaults vertex shaders to `highp`; the fragment
shader said `precision mediump float`. `uTime` was in both, so the program never
linked — `Precisions of uniform 'uTime' differ` — and the orb silently rendered
nothing. Declare the precision in *both* stages.

**2. `gl_PointSize` divides by view depth**, so mote sizes are pre-perspective
units, not pixels. Sizes around 26 with a scale around 68 produced ~600 px
points: giant glowing blobs that washed out the entire hero. Keep the attribute
near 1 and let the uniform scale do the work.

**3. Translucent 3D over a flat fallback reads as two overlapping objects.**
Both the crown and the orb had their flat glyph showing through from underneath.
The fallback has to stay mounted — it *is* the no-WebGL path — so it goes
`opacity: 0` once the canvas is actually drawing.

**4. A blanket `.page > *` clobbers an absolutely-positioned layer.** Forcing
`position: relative` onto the fireflies canvas collapsed it to zero height.
Target the specific children (`.scene`, `.topbar`, `.body`) with `z-index`
instead.

**5. Setting `data-theme` directly does not update the store.** A verify script
that flips the attribute leaves zustand on the old value, so a `theme === 'dark'`
guard stays false, the dark-only layer never mounts, and the canvas-count check
**passes against nothing**. Drive the real toggle. `CLAUDE.md` already warns that
the theme persists in `localStorage` and that toggle assertions pass or fail on
run order; this is the same trap from the other side.

---

## Making it visible on tool screens

The app-wide layer was originally invisible everywhere but the landing page:
the panels are opaque and cover almost the whole viewport, so the fireflies
only showed in the ~16 px gutters.

The fix is three tokens in `index.css`, **dark theme only**:

```css
--surface:        rgba(32, 32, 32, 0.9);   /* was #202020 */
--surface-nested: rgba(26, 26, 26, 0.9);   /* was #1a1a1a */
--glass-fill:     rgba(32, 32, 32, 0.9);   /* was #202020 */
```

Only those three, which are the large content fills. **`--surface-strong`,
`--surface-sunken`, `--glass-fill-strong` and `--slot-bg` stay opaque on
purpose** — they back the portal menus (ProfileMenu, SeasonMenu,
WildVariantMenu) and the export dialog, which float over arbitrary content and
have to be readable against it. A translucent dropdown is a bug, not an effect.

Nesting does not compound into mud: a nested box inside a translucent panel
composites over that panel, so the fireflies reach it at 0.1 × 0.1 ≈ 1% and
nested areas stay effectively solid. Only the top surface glints.

Elevation survives. `#202020` at 90% over `#000` composites to about `#1D1D1D`,
so panel-to-page is 29 points of 8-bit lightness instead of 32 — the README's
surface-ladder argument is intact.

**Light mode is untouched.** The page there is white, there is no backdrop
layer, and a translucent panel would only mean a paler panel.

---

## Working on this

```bash
npm run dev                     # port 5173
```

Browser verification follows the project convention, which exists because these
are visual changes and nothing else catches them:

```bash
npm i -D playwright             # NEVER committed as a dependency
npx playwright install chromium # WebKit is flaky on this machine
node verify-thing.mjs           # drive the real flow
rm verify-thing.mjs && npm uninstall playwright
```

Log in as `royal03`. The form mounts after the intro animation, so `networkidle`
is not enough — wait for `input[type="password"]`. The username input has **no
`type` attribute**, so `input:not([type="password"])` is the selector.

Screenshots at `deviceScaleFactor: 4` for anything small; a 48 px card tile or a
50 px logo mark tells you nothing at 1×.
