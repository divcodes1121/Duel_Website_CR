import { CARDS_BY_KEY } from '../data/cards';
import { DECK_SIZE, DUEL_DECK_COUNT, MAX_CROWNS } from '../types/deck';
import type { Deck, DeckSlot, DuelDeckSet, SavedDeckSet } from '../types/deck';
import { createEmptyDeck } from './deckUtils';

/* Turning a duel that was actually played into a Versus set you can open in
 * the builder.
 *
 * The Duel Zone already knows both loadouts game by game — the player's and,
 * where the row stores it, the opponent's. That is exactly the shape of a
 * Versus save: blue is one player's three-to-five decks, red is the other's.
 * So the button on a series is a straight translation, not a new feature.
 *
 * All of it lives here rather than in the component because the two rules that
 * matter are rules about DATA, and they are the kind that go quietly wrong:
 * what counts as a real deck, and what counts as the same set twice.
 */

/** A game as the Duel Zone reports it — structural, so `DuelGame` satisfies it. */
export interface PlayedGame {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  playerCrowns?: number;
  opponentCrowns?: number;
  opponent: {
    cards: string[];
    art?: Record<string, 'evolution' | 'hero'>;
  } | null;
}

/** One game reduced to the two decks it was fought with. */
export interface DuelPair {
  mine: string[];
  theirs: string[];
  myArt?: Record<string, 'evolution' | 'hero'>;
  theirArt?: Record<string, 'evolution' | 'hero'>;
  myCrowns?: number;
  theirCrowns?: number;
}

export type DuelSaveOutcome =
  | { ok: true; name: string; games: number }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'duplicate'; name: string };

/**
 * Exactly eight cards, every one of them known.
 *
 * This is the same guard `DeckActions` uses, and it is what keeps native duel
 * rows out without this module having to know what a native duel row is: those
 * store the whole 16- or 24-card loadout in one row and no opponent at all, so
 * they fail the count and produce no pair. A deck built from a truncated
 * loadout would look real and be wrong.
 */
function isFieldable(cards: string[] | undefined): cards is string[] {
  return (
    !!cards && cards.length === DECK_SIZE && cards.every((k) => CARDS_BY_KEY.has(k))
  );
}

/** The games of a series that carry a real deck on BOTH sides. */
export function duelPairs(games: PlayedGame[]): DuelPair[] {
  const pairs: DuelPair[] = [];
  for (const g of games) {
    if (!isFieldable(g.cards) || !isFieldable(g.opponent?.cards)) continue;
    pairs.push({
      mine: g.cards,
      theirs: g.opponent!.cards,
      myArt: g.art,
      theirArt: g.opponent!.art,
      myCrowns: g.playerCrowns,
      theirCrowns: g.opponentCrowns,
    });
    // A duel collection holds at most five decks; a longer series cannot be
    // represented and truncating quietly is better than throwing the save away.
    if (pairs.length === DUEL_DECK_COUNT) break;
  }
  return pairs;
}

function crownsOf(n: number | undefined): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(MAX_CROWNS, Math.round(n)));
}

/**
 * One played deck as a builder deck.
 *
 * The server hands cards back already arranged by `arrange_deck`, and that
 * order IS the builder's positional order — evolution, hero, wild, then the
 * rest. So the cards drop straight into the slots and `getSlotVisualVariant`
 * draws the right frames on its own; nothing here re-derives the order.
 *
 * The one thing position cannot settle is the Wild slot when its card has both
 * forms (Knight, Valkyrie, Musketeer, Wizard) — the default is Evolution, so a
 * hero that was actually fielded has to be recorded.
 */
function deckFromCards(
  name: string,
  cards: string[],
  art: Record<string, 'evolution' | 'hero'> | undefined,
  crowns: number | undefined,
): Deck {
  const slots: DeckSlot[] = cards.slice(0, DECK_SIZE);
  while (slots.length < DECK_SIZE) slots.push(null);

  const deck: Deck = { ...createEmptyDeck(name), slots };

  const wildKey = slots[2];
  const wild = wildKey ? CARDS_BY_KEY.get(wildKey) : undefined;
  const bothForms = !!wild && wild.canEvolve && (wild.canBeHero || wild.isChampion);
  if (bothForms && wildKey && art?.[wildKey] === 'hero') deck.wildVariant = 'hero';

  const c = crownsOf(crowns);
  if (c !== undefined) deck.crowns = c;

  return deck;
}

/** A five-deck collection whose first `pairs.length` decks are the played ones. */
function sideFromPairs(
  name: string,
  pairs: DuelPair[],
  pick: (p: DuelPair) => { cards: string[]; art?: Record<string, 'evolution' | 'hero'>; crowns?: number },
): DuelDeckSet {
  const now = new Date().toISOString();
  const decks: Deck[] = pairs.map((p, i) => {
    const { cards, art, crowns } = pick(p);
    // Named for the game it was played in — "G2" says more in a duel than
    // "Deck 2", and it is what the Duel Zone row it came from is labelled.
    return deckFromCards(`G${i + 1}`, cards, art, crowns);
  });
  while (decks.length < DUEL_DECK_COUNT) decks.push(createEmptyDeck(`Deck ${decks.length + 1}`));

  return { id: crypto.randomUUID(), name, decks, createdAt: now, updatedAt: now };
}

/** A deck as a comparable string: its cards, order-insensitive. Empty decks vanish. */
function deckSignature(slots: readonly DeckSlot[]): string {
  return slots
    .filter((k): k is string => !!k)
    .slice()
    .sort()
    .join(',');
}

/**
 * A whole side as one string.
 *
 * Order-insensitive on purpose: the same duel saved twice is the same set of
 * decks, and whether G1 and G2 happen to be listed the other way round does
 * not make it a second thing worth keeping. Padded empty decks contribute
 * nothing, so a three-game duel and the same three decks in a five-slot
 * collection compare equal.
 */
export function sideSignature(set: DuelDeckSet | undefined): string {
  if (!set) return '';
  return set.decks
    .map((d) => deckSignature(d.slots))
    .filter(Boolean)
    .sort()
    .join('|');
}

/** The saved versus group holding exactly these decks, if one already does. */
export function findDuplicateSet(
  library: readonly SavedDeckSet[],
  blue: DuelDeckSet,
  red: DuelDeckSet,
): SavedDeckSet | null {
  const b = sideSignature(blue);
  const r = sideSignature(red);
  if (!b && !r) return null;
  return (
    library.find(
      (e) => e.mode === 'versus' && sideSignature(e.blue) === b && sideSignature(e.red) === r,
    ) ?? null
  );
}

/**
 * The next free "Duel Deck n".
 *
 * Counted from the names already in the library rather than from its length,
 * so deleting group 2 of three does not hand the next save a name that is
 * already taken. Anything named some other way is ignored — it is not part of
 * this sequence.
 */
export function nextDuelDeckName(library: readonly SavedDeckSet[]): string {
  let highest = 0;
  for (const entry of library) {
    const m = /^Duel Deck (\d+)$/i.exec(entry.name.trim());
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `Duel Deck ${highest + 1}`;
}

/**
 * Build the library entry for a played duel.
 *
 * Returns the outcome the UI reports and, on success, the entry to store. The
 * caller does the storing — this stays pure so the naming and the duplicate
 * rule can be tested without a store.
 */
export function buildDuelImport(
  games: PlayedGame[],
  library: readonly SavedDeckSet[],
): { outcome: DuelSaveOutcome; entry?: SavedDeckSet } {
  const pairs = duelPairs(games);
  if (pairs.length === 0) return { outcome: { ok: false, reason: 'empty' } };

  const blue = sideFromPairs('Blue Player', pairs, (p) => ({
    cards: p.mine,
    art: p.myArt,
    crowns: p.myCrowns,
  }));
  const red = sideFromPairs('Red Player', pairs, (p) => ({
    cards: p.theirs,
    art: p.theirArt,
    crowns: p.theirCrowns,
  }));

  const dup = findDuplicateSet(library, blue, red);
  if (dup) return { outcome: { ok: false, reason: 'duplicate', name: dup.name } };

  const name = nextDuelDeckName(library);
  return {
    outcome: { ok: true, name, games: pairs.length },
    entry: {
      id: crypto.randomUUID(),
      name,
      mode: 'versus',
      blue,
      red,
      savedAt: new Date().toISOString(),
    },
  };
}
