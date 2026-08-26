import { type ReactNode, useEffect, useRef } from 'react';

import styles from './FilterSlot.module.css';

/**
 * One filterable row that collapses instead of vanishing.
 *
 * The card filter used to drop non-matching decks out of the rendered array,
 * so they disappeared between two frames and everything below them jumped up
 * the page. Nothing told you which decks left or where the survivors went —
 * the list simply became a different list.
 *
 * WHY THE HEIGHT IS MEASURED RATHER THAN ANIMATED FROM `auto`. A CSS
 * transition needs two lengths, and `auto` is not one — `max-height: 0 -> auto`
 * does not animate at all, and the usual bodge of a large fixed `max-height`
 * makes the collapse look like it stalls, because most of the duration is
 * spent travelling through empty space nobody can see. So the inner element's
 * real height goes into `--h` and the transition runs between two real values.
 *
 * The measurement is on the INNER element on purpose: the outer one is the
 * thing being collapsed, so measuring it while closed would read zero and the
 * row could never reopen.
 *
 * THE GAP LIVES HERE, NOT ON THE CONTAINER. A flex `gap` is charged for every
 * child, including one collapsed to zero height, so a filtered-out row would
 * still leave its gap behind and the list would keep a ladder of blank rungs.
 * Each row carries its own bottom margin and animates that to zero with the
 * height, which is what lets the list close completely.
 */
export function FilterSlot({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = inner.current;
    const box = outer.current;
    if (!el || !box) return;
    const measure = () => {
      box.style.setProperty('--h', `${el.offsetHeight}px`);
    };
    measure();
    /* Deck panels change height on their own — a name is renamed, a card is
       added, the actions row wraps. Without this the row would keep the height
       it happened to have when the filter last ran and clip its own content. */
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* `inert` is set on the NODE, not passed as a prop: it only entered React's
     DOM typings in React 19 and this is React 18, where it falls through as an
     unrecognised attribute and warns on every render. Reflecting it here keeps
     a collapsed row out of the tab order and out of a screen reader's way. */
  useEffect(() => {
    outer.current?.toggleAttribute('inert', !show);
  }, [show]);

  return (
    <div
      ref={outer}
      className={styles.filterRow}
      data-out={show ? undefined : ''}
      /* Hidden from the reading order as well as from view. A collapsed row is
         still in the DOM, and a screen reader walking a filtered list should
         not be read decks the filter removed. */
      aria-hidden={show ? undefined : true}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
