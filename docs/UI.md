# UI — the WebGL layer

What `src/three/` is, what it deliberately is not, and the ten things that had
to be measured in a browser rather than reasoned about.

Everything else about the interface — colour, motion tokens, the display face,
the surface ladder — lives in the main `README.md`. This file covers the three.js
work, plus two layout behaviours that are not WebGL and have nowhere better to
live: how a filtered deck list closes, and how a route owns its own scroll.

---

## What ships

| | where | when |
|---|---|---|
| **Fireflies, hero** | landing hero, over the castle art | both themes |
| **Fireflies, app-wide** | fixed behind the whole signed-in shell, in the open area's hue | both themes |
| **Fireflies, gated** | drifting over the Royal Pro gate's blurred preview | both themes |
| **Login backdrop** | the painted castle pair behind the sign-in card | both themes |
| **Slot aura** | empty special slots and the selected slot, on all three deck screens | both themes |
| **Placement burst** | a card landing in a slot; a crown pip being taken | one-shot |
| **Completion sweep** | a deck reaching 8/8 | one-shot |
| **Card ring** | both paste screens, the empty palette gallery | both themes |
| **Liquid metal** | every circular icon control, app-wide | on hover / press only |

```
src/three/
  runtime.ts      lazy loader, motion gating, DPR cap, resize, loop control,
                  and readToken() — a shader resolves a CSS token instead of
                  carrying a hex, so the palette stays in index.css
  Fireflies.tsx   drifting motes, three depth bands, pointer parallax, an
                  optional identity hue it eases into without remounting, and
                  a vertical span that widens for the app-wide layer
  DeckFx.tsx      the deck column: aura + burst + sweep, three meshes, ONE canvas
  DeckOrbit.tsx   card outlines orbiting a tilted ellipse, behind an empty ask
  LiquidMetal.tsx a chromatic rim and press ripple on the circular controls.
                  RAW WebGL2, not three.js — one canvas draws all of them
src/state/
  deckFx.ts       the event channel DeckFx listens on. A plain module emitter,
                  not a store — these are events, and routing them through
                  zustand would re-render 40 slots per card drop
```

**One canvas per screen, plus the backdrop.** That is the budget, and it is why
`DeckFx` is one component with three behaviours rather than three components: a
browser allows about 16 WebGL contexts — the same ceiling that forced the
removed card foil onto a single shared renderer — and the three already want the
same renderer, resize observer, rAF gate and slot-rect scan. Verified on the
builder: exactly two canvases.

---

## Three rules the whole directory inherits

These are in `runtime.ts` and every component gets them for free.

**1. three.js is never in the main bundle.** It is ~190 kB gzipped, which would
be more than a third of the app. `loadThree()` is a dynamic import, so it lands
in its own chunk and arrives only when something actually renders — exactly the
treatment `jspdf` already gets.

```
dist/assets/index-*.js          543 kB  │ gzip 166 kB   ← main, no three.js in it
dist/assets/three.module-*.js   734 kB  │ gzip 190 kB   ← on demand
```

The main bundle was 518 kB before any of this and 523 kB after the first two
components. The +25 kB is the five components, not the library — the
`three.module` chunk is byte-identical across every one of them. Verified by
grepping the built main chunk for three-internal strings (`ShaderChunk`,
`shadowmap_pars_fragment`): **0 occurrences.**

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
| `fixed` | `false` | pins to the viewport instead of the parent box, and widens **both** spreads — x to 4.2 and the vertical span to 5.6 — for the shell backdrop |
| `hue` | — | a section's identity colour, resolved from `--hue-<name>`. Absent = the ambient gold/green pair. See below |
| `intensity` | `1` | scales the palette's opacity; the Pro gate asks for `0.75`, sitting over blurred content |

### The palette is per theme, and so is the blend mode

```ts
const PALETTE = {
  dark:  { color: '#ffdd94', opacity: 0.78 },   // additive
  light: { color: '#047857', opacity: 0.95 },   // normal — the brand green
};
```

Light is `--hue-green` / `--solid-green` in light theme: the same deep forest
"Dominate." is set in. Amber read as warm dust; green reads as the site.

**Additive blending is only correct on black.** Adding warm gold to `#000` reads
as light. Adding it to near-white clamps to white, so a light-mode mote is
invisible *however far the opacity is turned up* — which is why turning it up
was the wrong knob and the first light-mode attempt failed. Light paints green
with `NormalBlending` instead. The blend mode therefore lives in the palette and
switches with the theme, rather than being a fixed material property.

The theme can change while the layer is mounted, so a `MutationObserver` on
`<html data-theme>` re-applies colour, opacity *and* blending — and so does a
hue change, through the same one function, because both alter the same three
things and neither should have its own copy of that.

### The vertical span, and the bug the footer had

The `fixed` layer widened its **horizontal** spread from the start — 4.2 against
a hero panel's 2.4 — because it covers a whole viewport rather than a banner. Its
**vertical** span was left at the panel's value, hardcoded in two places that had
to agree and did not have to be kept in step: the position buffer in JS, and the
shader's `mod`.

So motes lived in `y ±1.2`, and the edge fade `smoothstep(1.2, 0.75, …)` reached
zero at exactly `±1.2`. The camera sees `±1.41` at the near depth band and
`±1.99` at the far one. The bottom of every page was outside the field entirely.

Measured by diffing consecutive frames per fifth of the viewport, averaged over
five pairs — changed pixels per 10,000:

| band | before | after |
|---|---:|---:|
| 1 (top) | 26.6 | 21.3 |
| 2 | 36.0 | 38.1 |
| 3 | 50.8 | 30.0 |
| 4 | 21.3 | 38.3 |
| **5 (foot)** | **8.9** | **42.2** |
| foot ÷ page mean | **0.31×** | **1.24×** |

The fix is one value, `fixed ? 5.6 : 2.4`, feeding both the buffer and the
shader — and the fade expressed as a *fraction* of it
(`smoothstep(hSpan, hSpan * 0.62, …)`) rather than two literals, so widening the
band can never leave the fade behind again. 5.6 covers the far band's ±1.99 with
the fade still ~86% open at the very edge.

The count rose 240 → 520 with it. Density scales with the span, so the same motes
over 2.33× the height would simply be a thinner field everywhere. It is still one
draw call; points are the cheapest thing a GPU does.

**Non-fixed layers were not touched.** The hero, the login backdrop and the Pro
gate sit in bounded panels where 2.4 was tuned and is correct.

### The hue follows the open section

Everywhere but the landing screen, the app-wide layer takes the open area's
identity colour — the same one its sidebar row and its home block wear. Measured
off the live page by diffing two frames ~450 ms apart (the only thing moving in
the box is the motes, and a WebGL canvas without `preserveDrawingBuffer` reads
back blank, so it cannot simply be sampled):

| area | token | measured | gap |
|---|---|---|---:|
| Deck Analysis, Deck Counter | `--hue-pink` 329° | 335–337° | 6–8° |
| Cards, Top Meta Decks | `--hue-blue` 220° | 228° | 8° |
| Duel Analysis, Coach Assist | `--hue-green` 158° | 147–149° | 9–11° |
| Duel Zone | `--hue-violet` 255° | 251° | 4° |
| **landing** | ambient gold | 37° | unchanged |

**The landing keeps the ambient pair on purpose.** It is the one screen with no
subject — no section open, no player loaded — so there is nothing for it to
express, and it is where the motes sit over painted art the warm gold was
chosen for.

Three things make this work rather than merely function:

* **`hue` is read through a ref and is NOT an effect dependency.** As a
  dependency it would dispose the context and build a new one on every
  navigation — restarting the whole mote field and spending one of the sixteen
  contexts to change what is a single uniform.
* **The colour eases** toward its target in the existing loop, over ~500 ms. A
  full field cutting from green to maroon in one frame reads as a glitch.
* **It resolves `--hue-<name>` at runtime** rather than taking a hex, so callers
  name a role and the theme picks the value. That also keeps this layer honest
  about the project's rule that no component defines a colour of its own — a
  rule the first two shaders were quietly breaking, because a shader cannot read
  a CSS variable.

It takes the **ink** step, never the solid one. A mote is a bare graphic mark
that has to be seen *against* the ground; the solid ramp is graded to carry
white *on* itself, which on the dark page would make the motes darker than the
page they sit on.

---

## The reading deck, and why it is gone

`ReadingDeck.tsx` is **deleted**. It drew eight card plates riffling in a
travelling wave — one instanced draw call, rounded corners from an SDF rather
than a texture — behind all twelve slow loading states.

It was not removed for being wrong. It did what it was built to do: a
thirty-second wait with no feedback reads as hung, and the fan proved the tab was
alive. What it could never do is answer the question a reader actually has at
second forty, which is *how much longer*. A sign of life is a lower bar than a
progress readout, and once the readout existed there was no argument for keeping
both.

Its replacement, `UplinkLoader`, is **DOM and CSS**, so it is documented in the
main `README.md` rather than here — this file covers only the three.js work. Two
consequences belong on this page though:

* **The loading screens now pull no three.js at all.** They spend none of the
  ~16 WebGL contexts a document is allowed, which puts the budget back where the
  card foil once exhausted it.
* **The rule about reduced motion flipped for that one piece.** Every component
  in this directory keeps the flat markup it decorates and mounts no canvas
  under `prefers-reduced-motion`. That was right for the fan, which was
  decoration. A progress readout is information, so its replacement renders
  under reduced motion and drops only its flashes.

Recoverable from `e183bdb`, along with the `ReadingState` that wrapped it.

## The deck column, and the sweep that would not draw

`DeckFx` puts three effects on one canvas over the deck column: the slot
**aura**, a placement **burst**, and a completion **sweep**.

**Roles get no hue.** The obvious design is violet Evolution / gold Hero / green
Wild, and `index.css` forbids it outright — *"if it were violet you could not
tell the Evolution slot from the SELECTED slot, because violet is what selection
means."* Empty specials breathe in neutral ink, selection is violet, completion
is `--success` green, and a crown burst is gold, the one place gold is earned.

**The burst is the only placement feedback that exists.**
`useFlightStore.launch` is a no-op, so no card ever flew from library to slot.
It also confirms legality — an illegal drop is silently rejected and otherwise
looks identical to a legal one.

Slots are located by **data attributes**, never class names: CSS modules hash
those, and `[class*="slot"]` also catches `slotIcon`, `slotClear`, `slotStub`
and `slotSelected`.

### The sweep, in full, because the diagnosis was expensive

It began as an instanced quad and never drew a pixel. Bisected all the way down:

| checked | result |
|---|---|
| the event fired | ✅ with one live listener |
| the union rect | ✅ 8 nodes, correct centre and half-size |
| the program linked | ✅ no console error |
| `renderer.info` | ✅ **draw call issued, triangles counted** |
| a hardcoded 400 px quad, flat opaque fragment | ❌ invisible |
| its own `PlaneGeometry` instead of a shared one | ❌ no change |
| `frustumCulled = false` | ❌ no change |
| re-uploading attributes every frame | ❌ no change |

The only reading left is that neither `aRect` nor `uv` reached that geometry's
shader, so every quad rasterised at zero size. **Why was never established.**

It was rebuilt on the burst pipeline, which was already measured working at
27,046 changed pixels against a 26 px baseline. The sweep is now a line of
points with **staggered births** — each born at `clock + its share of the width
× spread`, with the shader parking anything whose birth is still in the future,
so the row lights up left to right with no travelling geometry and no per-frame
work. It measures 272 changed pixels left of the burst's reach, where the quad
measured none.

**`renderer.info` distinguishes "not drawn" from "drawn and invisible", and it
should be the first probe rather than the last.** It would have ruled out half
the hypotheses immediately.

### The sweep material threw on every theme change

`applyPalette` runs from a `MutationObserver` on `data-theme` and wrote
`sweepMat.uniforms.uColor.value`. **There is no `uColor` on that material** —
the sweep is drawn with the burst's shaders, which take their colour from the
per-point `aTint` attribute, so the uniform was never declared. Every theme
toggle threw `Cannot read properties of undefined (reading 'value')` inside the
observer, which aborted the rest of the function and took the blend-mode update
below it down too.

One dead line, deleted. Worth recording for two reasons: an exception inside a
`MutationObserver` callback does **not** unmount React or show anything on
screen, so it survived until a browser probe happened to toggle the theme with
`pageerror` wired up; and the actual visible symptom was the wrong blend mode
after a theme switch, which looks like a colour bug rather than a crash.

The rest of `src/three/` was swept for the same shape — every `ShaderMaterial`
cross-checked against every `<mat>.uniforms.<name>` read in its file. 5
materials across 3 files, no other undeclared reads.

---

## Lightning on the mark

The VS between two decks — in Recent Battles and on the builder's Versus board
— is the word itself with lightning crawling the letters. Adapted from
ThreeUI's `ElementsCollection` / Lightning; the technique that came across is
rasterise a logo, chamfer it into a signed distance field, then walk
fBm-displaced arcs along the `|d| = 0` contour so the bolts trace the shape
rather than sit near it.

**One canvas, not one per mark.** The reference gives each panel its own
context. A page of Recent Battles has ten VS marks and a browser allows about
sixteen WebGL contexts per document. `LightningMarks` finds every `[data-bolt]`
element and draws them instanced — the same shape `LiquidMetal` and `DeckFx`
already use, for the same reason.

**The field is two letters, not a logo.** It drew the brand mark for one
build, and that was the wrong object: the space between two decks is where a
reader looks to find out what happened between them, and a logo there says
whose site it is. The field is rasterised from the word with Canvas 2D at load
— the display face is Arial, a system font, so there is no webfont to wait on
and no PNG to keep in step with the CSS.

**No storm backdrop.** The reference paints an opaque near-black sky and lights
the mark inside it; dropped into a battle row that is a black rectangle. Only
the bolts are drawn, premultiplied over a transparent clear, with the letters
underneath as real text — crisper than an SDF fill, and still there when WebGL
is refused or `prefers-reduced-motion` is set.

**The tint is a token, which is what makes light mode work.** Additive light on
white is white. `readToken` resolves `--hue-blue` on dark (pale, reads as
emission) and `--hue-blue-deep` on light (deep, reads as a drawn bolt).

**Arcs, not an outline.** Straight from the reference the bolts scribbled
across the D and through the crown. Two changes fixed it, and only the second
one mattered:

| attempt | result |
|---|---|
| gate the bolts to `d > 0` | halved every arc; the effect nearly vanished |
| displace by `abs(n)` instead of `n` | the zero crossing lands OUTSIDE by construction, so nothing needs gating away |
| one flash per layer per frame | lit the whole contour at once — a second jagged D |
| a low-frequency mask along the contour | only stretches light, so the arcs have ends |

### Four ways it was invisible while working

Worth writing down because none of them produced an error.

**`patch` is a reserved word in GLSL ES 3.0** (a tessellation qualifier).
Naming a float that made the fragment shader fail to compile, which made the
component's `catch` remove its canvas, which made the effect not exist — no
console error, no missing element, nothing to notice.

**The canvas at `z-index: auto` painted under every glass panel.** The panel
body is `z-index: 1` and the panels carry `backdrop-filter`, so the shader ran,
found its marks, and drew every bolt behind the content. It sits at 20 now:
above the content, below the popovers (the range picker is 60, the profile menu
300).

**The field was sampled upside down.** The vertex shader negates `clip.y` so
`vUv.y = 0` is the top of the element, and `texImage2D` uploads the canvas top
row first, so `v = 0` is the top of the field too — and `sdf()` flipped it
again. With the logo, whose silhouette is a blob, an upside-down field looked
entirely plausible and the bolts traced something reasonable. The moment the
field became two letters it rendered a clear upside-down "VS" and the bug was
obvious. **A probe that paints the field is worth writing before a shader
misbehaves, not after**: one temporary `frag = mix(red, green, inside)` showed
in a single screenshot what an hour of reading the maths had not.

**Backticks inside the GLSL, three times** — twice inside the comment warning
about backticks. The shaders are template literals, so one ends the string and
the parse error is reported dozens of lines away in whatever the rest of the
file then looks like as code.

`tests/shaders.test.ts` fails on the first two, and both checks were verified by
injecting the bug and watching them catch it. A guard that has never been seen
to fail is not a guard.

### And one measurement that lied

The first "does it animate" check compared two PNG screenshots by byte length
and reported **210,175 differing bytes** for a shader that was drawing
absolutely nothing. PNG encoding shifts wholesale for a one-pixel change and
also shifts for none at all. Decode and diff pixels, or do not claim motion.

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

## Five more, from the motion pass

**6. A backtick inside a GLSL comment ends the shader string.** *(This has
now happened FOUR times — the fourth inside `LiquidMetal.tsx`, in the very
comment written to explain a different fix, three lines under a warning about
this exact trap. Its verification now asserts both shader sources contain no
backtick at all, which is the only thing that has actually stopped it. The third was a comment reading ``NOT `half` `` —
`half` being reserved in GLSL ES, hence `hSpan` — while widening the mote
span. `tsc` reported a missing comma dozens of lines away, as it always does.
The comment now spells the word out and states why it carries no backticks.)* These shaders
are JS template literals, so a comment reading ``the `uv` attribute`` terminates
it and Babel reports a missing semicolon dozens of lines away. It cost two
rounds, because the second time it looked like the fix had failed rather than
never having compiled. Both files now carry a warning beside the comment block.

**7. A probe that clicks disabled tiles reports the product broken.** Cards
already used in a duel collection carry `aria-disabled="true"` and their handler
returns early. Filling a deck by clicking `[data-card-key]` blind places
nothing, `filledCount` never moves 7 → 8, no effect is ever requested — and the
probe concludes the effect does not render. Use
`[data-card-key][aria-disabled="false"]`, and assert the state transition
*before* measuring.

**8. A one-shot effect needs the right axis of separation.** Diffing consecutive
frames catches a burst, but the burst and the sweep overlap almost exactly, and
card art appearing underneath changes far more pixels than a translucent band.
Separating them in TIME does not fit either: the burst dies at 550 ms and the
band leaves at 740 ms, a window narrower than a Playwright screenshot. What
worked was SPACE — the burst is thrown from the slot just filled, so anything
changing in the left half of the row is the sweep and nothing else.

**9. A uniform promoted out of a hardcoded constant must reach every material
that shares the shader.** `uLife` was hardcoded until the sweep needed a
different lifetime. Adding it to the sweep and forgetting the burst left the
burst dividing its age by an undefined uniform — by zero. `tsc` caught it only
indirectly, as an unused constant.

**10. Sizing a flourish by reading the code is guesswork.** The card ring's
first pass drew each outline ~200 px tall, which made it the loudest thing on a
panel whose whole job is to be an empty invitation. Both it and the reading
deck's fan needed a second look and a second set of constants after seeing them
at real size.

---

## Making it visible on tool screens

The app-wide layer was originally invisible everywhere but the landing page:
the panels are opaque and cover almost the whole viewport, so the fireflies
only showed in the ~16 px gutters.

The fix is the same three tokens in `index.css`, in **both** ladders:

```css
/* dark */                                   /* light */
--surface:        rgba(44, 44, 44, 0.9);     rgba(255, 255, 255, 0.85)
--surface-nested: rgba(33, 33, 33, 0.9);     rgba(248, 248, 250, 0.85)
--glass-fill:     rgba(44, 44, 44, 0.9);     rgba(255, 255, 255, 0.85)
```

**Light needs a lower number than dark.** A green mote on a near-white page is
a far smaller colour difference than a gold one on true black, so a tenth of it
was not enough to see — the first attempt at 90% was effectively invisible.

**The dark literals are higher than the rungs they produce.** A translucent
panel over the true-black page lands *darker* than its own colour (90% of
`#202020` composites to `#1D1D1D`), so making the panels lighter meant raising
the literal until the composite sat where the rung should be:

```
page    #000000               0
panel   rgba(44,44,44,.9)    40   over the page
nested  rgba(33,33,33,.9)    34   over the PANEL, not the page
raised  #2E2E2E              46   opaque
sunken  #1C1C1C              28   opaque
border  #3A3A3A              58
```

`--surface-strong` had to move with them. It was `#262626` (38), above the old
panel and *below* the new one — the raised rung would have read as a dent.
`--border` was `#2E2E2E`, which became exactly `--surface-strong`, so a border
on a raised surface would have vanished.

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

85% of `#FFF` over the `#F4F4F6` page composites to about `#FDFDFD`, so light
panels still read as white and only the motes come through.

---

## Filtering a deck list — the rows close, they do not vanish

`WinConFilter` already picked cards and matched decks; what it did with the
non-matching ones was drop them out of the rendered array. That unmounts them,
so they disappeared between two frames and everything below jumped up the page.
Nothing said which decks had left or where the survivors went — the list simply
became a different list.

`WinConFilter/FilterSlot.tsx` wraps each row and collapses it instead. Every
deck stays mounted with a `matches` flag; the slot animates `max-height`,
`margin-bottom`, `opacity` and `transform` together.

**The height is MEASURED, and it has to be.** A CSS transition needs two
lengths and `auto` is not one — `max-height: 0 -> auto` does not animate at all,
and the usual bodge of a large fixed `max-height` makes the close look stalled
because most of the duration is spent crossing empty space. The inner element's
real height goes into `--h`, and a `ResizeObserver` keeps it current because
deck panels change height on their own. Measure the INNER element: the outer one
is what is being collapsed, so reading it while closed returns zero and the row
could never reopen.

**The gap moved onto the row.** A flex `gap` is charged for every child,
including one collapsed to zero height, so a filtered-out deck would leave its
gap behind and the list would close to a ladder of blank rungs. `.deckGrid` has
no `gap`; each row carries `margin-bottom` and animates it away with its height.

**The duel builder deliberately does NOT do this.** It dims non-matching decks
instead, because a duel collection is a run of POSITIONAL slots — deck 2 is
deck 2, and collapsing one would renumber the rest and change what the layout
means. Its transition lives on `.deckWrap` rather than on `.deckDim` so it runs
in both directions; on the dim class alone there is nothing to animate on the
way back and a deck snaps to full strength when the filter clears.

**`inert` is set on the node, not passed as a prop.** It only entered React's
DOM typings in React 19; on React 18 it falls through as an unrecognised
attribute and warns on every render. `toggleAttribute` in an effect keeps a
collapsed row out of the tab order without the warning.

### The trap this one cost

The class is `filterRow`, not `slot`. CSS modules hash to `_name_hash`, and this
project already has `DeckSlot`'s `.slot` and `DecksHome`'s `.filterSlot` — so
the verification's `[class*="_slot_"]` matched all three, reported "1 of 9 rows
measured a height", and sent me looking for a bug in a component that was
working perfectly. Same shape as the `[class*="bar"]` trap already recorded
below: **match the hashed prefix, never a bare substring.**

---

## Water under the closing band

Adapted from ThreeUI's `ElementsCollection` / Water. What came across is the
technique: a ping-pong wave equation on a float target, then a pass that reads
the height field's gradient to refract, shade crests and strike a specular
glint. Two things did not.

**Not an iframe.** The reference renders a whole HTML document into a sandboxed
`iframe` via `srcDoc`, string-patches its shader source, and drives it with
`postMessage`. That is a gallery's answer to running unrelated demos side by
side. Here it would mean a second document, a second WebGL context, and a
shader this project cannot typecheck, theme, or read a token from. This app
already writes raw WebGL2 directly — `LiquidMetal` does — so the effect is
written the same way, in one canvas, in this bundle.

**No mark, so no SDF.** The reference refracts a rasterised brand logo held in
a signed distance field. There is nothing to put there: the band's own text
sits above the canvas and has to stay legible. Dropping it removes the SDF
build, the chamfer pass and the contour extraction — most of the reference's
CPU work — and leaves the part that reads as water.

**It follows the house rules rather than the reference's.** `runLoop` keeps it
off screen and off hidden tabs; `reducedMotion` draws one still frame and
stops; the tint comes from `readToken` so it follows the theme, where the
reference is hard-coded to a near-black ground that would be a hole in the page
in light mode. Light mode also takes a much lower gain: on near-black a bright
crest is a highlight, on a pale card the same value is a smear.

**Additive over a transparent clear**, so the card's background shows through
and `.copy` / `.figure` only need `z-index: 1` to stay on top. A negative
z-index on the canvas would have put it behind the card's own background, where
it would not be seen at all.

Lazy-loaded like everything else in `src/three/` — 6.6 kB, 2.8 kB gzipped, in
its own chunk. It is at the very foot of the landing page and most visitors
never scroll to it.

### Verifying a WebGL effect: screenshots, not `readPixels`

The first probe read the canvas back with `gl.readPixels` and reported every
sampled pixel as zero, including straight after a swipe. That was the probe
lying, not the effect failing: without `preserveDrawingBuffer: true` the
drawing buffer is **undefined after compositing**, so reading it outside the
rAF proves nothing either way.

Comparing consecutive element screenshots is what actually settles it — the
compositor's output is what a screenshot captures. Rippling frames came back
70464 → 60134 → 49020 bytes; still water drifts a little from the periodic
auto-drops, which is the intended behaviour and not noise.

One more trap in the same probe: comparing two PNGs by byte LENGTH and calling
a length mismatch "inconclusive". Different content compresses differently, so
a differing length is evidence of change, not the absence of it.

---

## Every route owns its scroll, and that is a trap worth stating once

`body` is `overflow: hidden`. **The page never scrolls.** Each route mounts a
region that scrolls itself, which is what keeps the shell — top bar, rail, panel
chrome — fixed while content moves under it.

The consequence is that a new full-height screen has to opt in, and two ways of
getting it wrong both end with content that exists and cannot be reached. The
admin console shipped with both.

**`min-height: 100vh` inside a `height: 100%` shell overflows and clips.** It
does not scroll, because nothing in the chain was told to. The region needs:

```css
height: 100%;
min-height: 0;
overflow-y: auto;
overscroll-behavior: contain;   /* so a scroll at the end does not move a parent */
```

**`min-height: 0` is not decoration.** A flex item's automatic minimum size is
its content, so a column that contains a tall child grows to fit it and clips
again. Nearly every "my scroll container does not scroll" bug in a flex layout
is this line missing somewhere up the chain.

### The inverse, which is stranger and quieter

Inside such a column, **a child with any `overflow` other than `visible` has an
automatic minimum size of zero** — that is the exception in the spec, and it
means that child is the one the flexbox is free to crush. The admin console's
accounts table had `overflow-x: auto` for narrow screens, so it collapsed to the
~40px left over after the tiles above it: every row rendered, inside a box one
row tall, behind an inner scrollbar too short to grab. Every sibling kept full
height, which made it look deliberate.

`flex: none` on the child. And the corollary, which is the part that gets missed:
that same `overflow` makes the element a **scroll container**, so `position:
sticky` on a `<th>` inside it now pins to the table rather than to the page and
silently stops working. Put horizontal scroll behind a width media query when
the sticky header is worth more on wide screens than sideways scroll is.

### A future-dated timestamp run through an "ago" formatter says "just now"

Not a layout bug, but the same family — it renders confidently and it is wrong.
`ago()` computes `now − date`; a future date makes that negative, every
threshold below sixty seconds succeeds, and thirty accounts with three days left
all read "ends just now". Countdowns need their own function, and it must round
**up**: three days minus a microsecond floors to "in 2d", so a fresh trial reads
as two days the instant it starts.

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

**No login is needed for most of it any more.** The site is public: the landing
page, Search Player, Top Meta Decks and Deck Counter render for a signed-out
visitor, so a verify script can drive them directly. The twenty `royal01`–
`royal20` test accounts are **deleted** — there is no such login to fall back
on.

For a screen behind the gate, a script has to sign up a real Supabase account,
which then sits in the production accounts table until someone deletes it — about
thirty accumulated in one pass and had to be swept by email prefix. Prefer one
fixed reused account. The
admin console cannot be reached this way at all without promoting someone in the
live database, which is why it has had no browser pass.

Two selector notes that still apply to the auth form: it mounts after the intro
animation, so `networkidle` is not enough — wait for `input[type="password"]`.

Screenshots at `deviceScaleFactor: 4` for anything small; a 48 px card tile or a
50 px logo mark tells you nothing at 1×.
