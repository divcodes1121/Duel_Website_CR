/**
 * THE ART SLOT — where a plate's drawing goes, and what stands there until it
 * arrives.
 *
 * THE PLACEHOLDER IS THE POINT, not a courtesy. Half of building this was
 * getting the book, the turn and the glass right, and none of that could wait
 * on artwork. So an absent drawing renders a real object — a ruled ink frame
 * carrying the plate's own brief — which means the spread is composed, legible
 * and reviewable before a single image exists, and dropping the PNG in later
 * changes nothing about the layout around it.
 *
 * It also fails the RIGHT way. A missing `<img>` gives you a broken-image glyph
 * and a hole in the page; this gives you a frame that says what belongs there.
 *
 * The swap is one file: put `<file>.png` in `public/assets/guide/` and the
 * `onError` fallback stops firing.
 */
import { useState } from 'react';
import type { PlateArt } from './plates';

export function ArtSlot({ art, tall }: { art: PlateArt; tall?: boolean }) {
  /* Absence is discovered, not declared. There is no manifest of which files
     exist — the browser already knows, and a second list would be a thing to
     keep in step for no gain. */
  const [missing, setMissing] = useState(false);
  /* WEBP, not the master. The supplied plates are 3.2-3.9 MB PNGs — 13.5 MB
     for four — and `scripts/build-guide-art.py` re-encodes them to ~420 kB
     each. The masters live in `assets/guide/` and are never served; nothing
     here should ever point at them. */
  const src = `${import.meta.env.BASE_URL}assets/guide/${art.file}.webp`;

  if (missing) {
    return (
      <figure className="pl-art pl-art--empty" data-tall={tall ? '' : undefined}>
        <svg className="pl-artFrame" viewBox="0 0 400 260" preserveAspectRatio="none" aria-hidden="true">
          {/* Two passes at the rectangle, neither quite closing, so it reads as
              ruled by hand rather than as a border property. */}
          <path
            d="M14 10 L 388 13 L 385 249 L 11 245 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeDasharray="1 0"
          />
          <path
            d="M18 16 L 381 18 L 379 243 L 17 240"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            opacity=".5"
            strokeLinecap="round"
          />
          {/* the crossed guides a sketcher rules before drawing */}
          <path d="M14 10 L 385 249 M388 13 L 11 245" stroke="currentColor" strokeWidth="0.5" opacity=".18" />
        </svg>
        <figcaption className="pl-artBrief">
          <span className="pl-artMark">Plate art</span>
          <span className="pl-artFile">{art.file}.png</span>
          <span className="pl-artText">{art.brief}</span>
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="pl-art" data-tall={tall ? '' : undefined}>
      <img
        src={src}
        alt={art.alt}
        draggable={false}
        onError={() => setMissing(true)}
        /* Eager, not lazy. Every plate is cloned into the turning leaf and into
           the magnifier's copy, and a lazy image inside a clone that has never
           been on screen decodes mid-turn — which is a flicker on the one frame
           that must not have one. */
        loading="eager"
      />
      {/* A FIELD BOOK LABELS ITS PLATES, and this one has to: the drawings are
          3:2 landscape and a leaf is taller than it is wide, so a contained
          image leaves the bottom third of the page bare. A caption is what
          belongs in that space — it is what the space is FOR in a real book —
          rather than stretching the art to fill it and cropping off the spatter
          edges that are half of why it reads as watercolour. Absent on the
          spread plate, which carries its own title block instead. */}
      {art.caption && <figcaption className="pl-artCap">{art.caption}</figcaption>}
    </figure>
  );
}
