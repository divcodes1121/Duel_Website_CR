/**
 * DUEL ANALYSIS: PAIRS ORDERED BY ONE GAME SLOT'S USAGE (2026-11-09).
 *
 * Asked for: "the pairs shown should be arranged by G1 most usage, and a switch
 * G1 / G2 / G3 to see the pairs of those games' usage". `slotShare[i]` is the
 * share of every deck played in that slot which carried the pair, so ordering
 * by it answers "what do they bring in game N". Ties go to the overall use
 * rate, so the order is stable.
 *
 * NO IMPORTS, so it is tested without a component.
 */
export function bySlot<T extends { slotShare: readonly number[]; useRate: number }>(
  rows: readonly T[],
  slot: number,
): T[] {
  return [...rows].sort(
    (x, y) => (y.slotShare[slot] ?? 0) - (x.slotShare[slot] ?? 0) || y.useRate - x.useRate,
  );
}
