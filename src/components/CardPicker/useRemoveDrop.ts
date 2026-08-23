import { useState } from 'react';
import { useBuilderStore } from '../../state/store';
import { useFlightStore, rectOf } from '../../state/flightStore';
import { getDrag, endDrag } from '../../state/dragContext';
import { getCardIconUrl } from '../../data/cards';

/**
 * "Drag a card out of a deck and drop it back on the library to remove it."
 *
 * Lives here rather than in either surface because there are now two of them —
 * the builder's rail and the drawer that Deck's Home and the Counter Palette
 * still use — and a second copy is how the two would eventually disagree about
 * what a drop means. The card flies back to its own tile when that tile is on
 * screen, and to the library itself when the filters have hidden it.
 */
export function useRemoveDrop() {
  const clearSlot = useBuilderStore((s) => s.clearSlot);
  const launchFlight = useFlightStore((s) => s.launch);
  const [over, setOver] = useState(false);

  return {
    /** True while a deck card is hovering — the surface paints itself as a bin. */
    over,
    handlers: {
      onDragOver(e: React.DragEvent<HTMLElement>) {
        // Only a card already IN a deck can be removed; a drag from the library
        // itself is not a removal, so it must not claim the drop.
        if (getDrag()?.type !== 'slot') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave() {
        setOver(false);
      },
      onDrop(e: React.DragEvent<HTMLElement>) {
        e.preventDefault();
        setOver(false);
        const drag = getDrag();
        if (drag?.type !== 'slot') return;
        const target =
          document.querySelector(`[data-card-key="${drag.cardKey}"]`) ?? e.currentTarget;
        launchFlight(getCardIconUrl(drag.cardKey), drag.sourceRect, rectOf(target));
        clearSlot(drag.owner, drag.deckIndex, drag.slotIndex);
        endDrag();
      },
    },
  };
}
