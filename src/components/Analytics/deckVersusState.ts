import { useState } from 'react';
import type { MatchupReport, WildForm } from '../../state/analyticsClient';

/* Deck vs Deck's state, in its own module so `DeckCounter.tsx` exports only
   components (fast refresh). The player screen owns one of these so two
   pasted decks outlive its loading state; the home route's panel keeps its
   own. */

export interface VersusState {
  deckA: string[];
  setDeckA: (c: string[]) => void;
  deckB: string[];
  setDeckB: (c: string[]) => void;
  wildA: WildForm | null;
  setWildA: (w: WildForm | null) => void;
  wildB: WildForm | null;
  setWildB: (w: WildForm | null) => void;
  versus: MatchupReport | null;
  setVersus: (r: MatchupReport | null) => void;
}

export function useVersusState(): VersusState {
  const [deckA, setDeckA] = useState<string[]>([]);
  const [deckB, setDeckB] = useState<string[]>([]);
  // Slot-3 choices, held because the RESULT request needs them too.
  const [wildA, setWildA] = useState<WildForm | null>(null);
  const [wildB, setWildB] = useState<WildForm | null>(null);
  const [versus, setVersus] = useState<MatchupReport | null>(null);
  return { deckA, setDeckA, deckB, setDeckB, wildA, setWildA, wildB, setWildB, versus, setVersus };
}
