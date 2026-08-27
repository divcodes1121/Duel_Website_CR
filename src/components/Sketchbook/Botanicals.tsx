/**
 * THE MARGINS — ferns, a sprig, and brush-stroke rules.
 *
 * The reference scatters photographed watercolour botanicals (`botany-left.png`,
 * `bloom.png`, `divider.png`) around its book. Those are another project's
 * binaries, and they are also Singapore rather than this — so these are drawn
 * instead, as inline SVG.
 *
 * DRAWN RATHER THAN DOWNLOADED, for three reasons that are not just licensing:
 * they cost no request, they inherit `currentColor` so the paper palette owns
 * them the way it owns everything else on the page, and they can be re-tinted
 * per theme without a second file. A photographed leaf can do none of that.
 *
 * Every one of these is decorative and carries `aria-hidden`.
 */

/** A single frond — the leaf shape both ferns are built from. */
function Frond({ n = 13 }: { n?: number }) {
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = 8 + t * 104;
    /* the frond tapers toward the tip, so the pinnae shorten with it */
    const len = 30 * (1 - t * 0.82) + 4;
    const droop = 6 + t * 10;
    leaves.push(
      <g key={i}>
        <path d={`M60 ${y} q ${-len * 0.55} ${-droop * 0.3} ${-len} ${droop}`} />
        <path d={`M60 ${y} q ${len * 0.55} ${-droop * 0.3} ${len} ${droop}`} />
      </g>,
    );
  }
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M60 118 C 60 80 60 40 60 6" strokeWidth="2.1" />
      {leaves}
    </g>
  );
}

export function FernCluster({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 130" aria-hidden="true">
      <g opacity=".55" transform="translate(-14 6) rotate(-16 60 65)"><Frond n={12} /></g>
      <g opacity=".75"><Frond n={14} /></g>
      <g opacity=".5" transform="translate(16 10) rotate(15 60 65)"><Frond n={11} /></g>
    </svg>
  );
}

/** A flowering sprig, for the opposite margin. */
export function Sprig({ className }: { className?: string }) {
  const petals = [0, 72, 144, 216, 288];
  const bloom = (cx: number, cy: number, r: number, o: number) => (
    <g transform={`translate(${cx} ${cy})`} opacity={o}>
      {petals.map((a) => (
        <ellipse key={a} rx={r * 0.42} ry={r} cy={-r * 0.72} transform={`rotate(${a})`} />
      ))}
      <circle r={r * 0.3} className="sk-bloom-eye" />
    </g>
  );
  return (
    <svg className={className} viewBox="0 0 120 150" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7">
        <path d="M62 148 C 58 110 56 84 60 56" />
        <path d="M60 112 C 44 106 34 96 30 82" />
        <path d="M61 96 C 78 92 88 84 92 70" />
        <path d="M60 130 C 46 126 38 118 34 106" />
      </g>
      {/* leaves along the stem */}
      <g fill="currentColor" opacity=".38">
        <ellipse cx="34" cy="86" rx="13" ry="6" transform="rotate(-28 34 86)" />
        <ellipse cx="90" cy="74" rx="14" ry="6.5" transform="rotate(24 90 74)" />
        <ellipse cx="38" cy="110" rx="11" ry="5.2" transform="rotate(-32 38 110)" />
      </g>
      <g fill="currentColor">
        {bloom(60, 44, 15, 0.62)}
        {bloom(88, 62, 11, 0.46)}
        {bloom(36, 66, 10, 0.4)}
      </g>
    </svg>
  );
}

/**
 * A brush stroke, as a rule between sections.
 *
 * The reference uses a scanned `divider.png`. This is one path with a ragged
 * top and bottom edge so it reads as a loaded brush dragged across the sheet
 * rather than as a rounded rectangle.
 */
export function BrushRule({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 900 34" preserveAspectRatio="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 19 C 60 9, 96 22, 150 15 C 214 7, 250 21, 312 16 C 372 11, 404 23, 466 17
           C 528 11, 566 22, 628 16 C 686 10, 726 21, 786 15 C 832 10, 868 18, 894 13
           L 894 22 C 862 27, 826 20, 782 25 C 722 32, 682 21, 626 27
           C 566 33, 528 22, 468 28 C 406 34, 372 22, 310 27
           C 250 32, 212 19, 150 26 C 96 32, 58 21, 6 27 Z"
      />
    </svg>
  );
}

/**
 * The date stamp: a hand-set date under a carved seal.
 *
 * The seal is the one place a saturated red is allowed on this page. It is a
 * chop mark, not a UI colour — nothing here means "error" — and it is the only
 * thing on the sheet that is not ink or paper, which is exactly why the eye
 * goes to it and reads the date beside it.
 */
export function DateStamp({ date }: { date: string }) {
  return (
    <span className="sk-stamp" aria-hidden="true">
      <svg className="sk-chop" viewBox="0 0 34 34">
        <rect x="1.4" y="1.4" width="31.2" height="31.2" rx="3.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <g fill="currentColor">
          <rect x="7" y="7" width="8.6" height="3.1" />
          <rect x="7" y="12.4" width="8.6" height="3.1" />
          <rect x="7" y="17.8" width="8.6" height="3.1" />
          <rect x="7" y="23.2" width="8.6" height="3.1" />
          <rect x="19.4" y="7" width="3.1" height="19.3" />
          <rect x="25.4" y="7" width="3.1" height="19.3" />
        </g>
      </svg>
      <span className="sk-stampDate">{date}</span>
    </span>
  );
}
