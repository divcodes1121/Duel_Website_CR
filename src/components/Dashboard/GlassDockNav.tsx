/* The top navigation, as vengenceui's GlassDock.
 *
 * This is the adapter between `Dashboard`'s nav model and the registry
 * component's `DockItem[]`. The component itself stays in
 * `components/ui/glass-dock.tsx`, so the next registry update is a file
 * replacement rather than a merge.
 *
 * WHY IT REPLACED THE LABELLED DOCK. Six labelled items, a tag field and four
 * actions did not fit one bar — the Meta label and the search field were
 * measurably overlapping at 1440px, and the tier badge then needed another
 * 104px. GlassDock is icon-only with the name on hover, which is the same trade
 * the old dock already made below 1000px, now made everywhere.
 *
 * ── WHY THE MORPH IS HERE AND NOT IN THE COMPONENT ──────────────────────
 *
 * The registry component only animates seven hardcoded names — home, blog,
 * marker, email, linkedin, x, github — matched on `title.toLowerCase()`. Of
 * this app's six destinations only "Home" hits, and it morphed the component's
 * OWN built-in house rather than ours; the other five fell through to the plain
 * `<Icon>` branch and never animated at all. That is exactly the "only Home
 * works" symptom.
 *
 * Rather than fork the component's seven-way `if` chain, each item is handed an
 * icon that morphs ITSELF. The icon finds the item cell it was rendered into,
 * listens for the same `mouseenter` the component uses to raise its tooltip,
 * and runs the source's own keyframe sequence against its own path. The
 * component stays untouched on that path, and every item gets the effect.
 *
 * THE SEQUENCE IS THE SOURCE'S, not a reinterpretation:
 *   1. scale to 0.25 and fade out over 0.1s
 *   2. morph through two droplet shapes (0.1s, 0.05s)
 *   3. morph back to the real icon over 0.75s on `elastic.out(1, .9)`,
 *      restoring scale on the same curve and opacity over 0.2s
 * It animates the <svg> directly rather than the `--tab-bar-*-scale` custom
 * properties the source drives, because those exist only to be read by a
 * stylesheet the registry does not ship. Same motion, one less indirection.
 */
import { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import GlassDock, { type DockItem } from '../ui/glass-dock';
import { DOCK_PATHS, DROPLET_A, DROPLET_B } from './dockIcons';
import '../ui/glass-dock.css';

/* Registered statically. The component registers it too, dynamically inside a
   `.catch` — written when MorphSVG was a paid Club plugin that most installs
   would not have. GSAP made every plugin free (it is in `gsap@3.15`), so the
   import resolves and a static registration is simply more reliable than one
   racing the first hover. Registering twice is a no-op. */
gsap.registerPlugin(MorphSVGPlugin);

export interface GlassDockNavItem {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  active: boolean;
  onSelect: () => void;
}

function MorphingNavIcon({
  label,
  active,
  className,
}: {
  label: string;
  active: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const d = DOCK_PATHS[label];

  useEffect(() => {
    const svg = svgRef.current;
    const path = pathRef.current;
    if (!svg || !path || !d) return;

    /* The component owns the hover handler — it is on the item cell, for the
       tooltip. Listening on that same element is what lets the morph share the
       gesture without the component knowing this exists. */
    const cell = svg.closest('[role="button"]');
    if (!cell) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let tl: gsap.core.Tween | null = null;
    const run = () => {
      tl?.kill();
      gsap.killTweensOf([svg, path]);
      tl = gsap.to(svg, {
        scale: 0.25,
        opacity: 0,
        duration: 0.1,
        onComplete: () => {
          gsap.to(path, {
            keyframes: [
              { morphSVG: DROPLET_A, duration: 0.1 },
              { morphSVG: DROPLET_B, duration: 0.05 },
              {
                morphSVG: d,
                duration: 0.75,
                ease: 'elastic.out(1, .9)',
                onStart: () => {
                  gsap.to(svg, { scale: 1, duration: 0.75, ease: 'elastic.out(1, .9)' });
                  gsap.to(svg, { opacity: 1, duration: 0.2 });
                },
              },
            ],
          });
        },
      });
    };

    cell.addEventListener('mouseenter', run);
    return () => {
      cell.removeEventListener('mouseenter', run);
      tl?.kill();
      gsap.killTweensOf([svg, path]);
    };
  }, [d]);

  return (
    <span
      className={className}
      aria-current={active ? 'page' : undefined}
      /* The open destination stays lit while the pointer is elsewhere. The
         source colours only on hover, because in its demo "active" IS hover. */
      style={active ? { color: 'var(--accent-select)' } : undefined}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 24 24"
        width={22}
        height={22}
        fill="currentColor"
        aria-hidden="true"
        /* The morph scales about the middle; the default 0 0 origin would
           swing the icon out of its cell on the way down. */
        style={{ transformOrigin: '50% 50%', display: 'block' }}
      >
        <path ref={pathRef} d={d} />
      </svg>
    </span>
  );
}

export function GlassDockNav({
  items,
  className,
}: {
  items: GlassDockNavItem[];
  className?: string;
}) {
  const dockItems = useMemo<DockItem[]>(
    () =>
      items.map((item) => ({
        title: item.label,
        onClick: item.onSelect,
        icon: ({ className }: { className?: string }) => (
          <MorphingNavIcon label={item.label} active={item.active} className={className} />
        ),
      })),
    [items],
  );

  return (
    <div className={['glass-dock-scope', className].filter(Boolean).join(' ')}>
      <GlassDock items={dockItems} aria-label="Primary" />
    </div>
  );
}
