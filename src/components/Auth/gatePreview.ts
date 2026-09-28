/* Its own module, not GateCard.tsx: a component file that also exports a
   constant breaks React fast refresh for the whole file. */

/**
 * A blurred picture of each gated screen, keyed by the section name the gate
 * is given. Built by `scripts/build-gate-art.py` into `public/assets/gate/`,
 * one per theme; the script's SLUGS list must match this map. A section with
 * no entry (Coach Roster) simply gets the plain card.
 */
export const GATE_PREVIEW: Record<string, string> = {
  Cards: 'cards',
  'Duel Analysis': 'duels',
  'Duel Zone': 'duelzone',
  'Coach Assist': 'coach',
  'Deck Analysis': 'deck-analysis',
  'Team Analysis': 'teams',
  '2v2 Decks': 'duo',
};
