import { CARDS_BY_KEY } from '../data/cards';

/**
 * THE THREE SPECIAL SLOTS, ON THE CLIENT — for the two cases the server cannot
 * reach. The rule itself lives in `server/clash_data.arrange_deck` and every
 * analytics deck arrives already seated by it; this file exists only for:
 *
 *   1. DECKS WHOSE ORDER IS THE AUTHORITY — the Coach Roster's arsenal, plans
 *      and results are lists a coach saved from a suggestion, a battle or a
 *      game link, stored in Supabase with no art. Their order already says
 *      which card is the evolution, the hero and the wild, exactly as a link
 *      does, so `positionalArt` reads the forms off the positions. That is
 *      `arrange_deck(trust_order=True)` and the builder's
 *      `getSlotVisualVariant`, and it is what the game itself will field when
 *      the deck is opened from here.
 *
 *   2. ENGINE DECKS THAT CARRY NO ART AT ALL — a Team Analysis board saved
 *      before the server seated its seed decks holds them alphabetical and
 *      bare, and a saved board is a snapshot the server never sees again.
 *      `seatDeck` is `arrange_deck`'s no-evidence branch, champion rule
 *      included, and `tests/deckSeating.test.ts` pins it against the Python's
 *      own output so the two cannot drift apart unnoticed.
 *
 * The slots, numbered as a player sees them:
 *
 *     slot 1   evolution only
 *     slot 2   hero or champion — never an evolution
 *     slot 3   the wild slot: evolution, hero or champion
 *
 * and a champion always sits in slot 2 or 3 (measured on 16,615 real battles:
 * never lower).
 */

export type SlotForm = 'evolution' | 'hero';
export type SlotArt = Record<string, SlotForm>;

type Kind = 'champion' | 'both' | 'evolution' | 'hero' | '';

function kind(key: string): Kind {
  const c = CARDS_BY_KEY.get(key);
  if (!c) return '';
  if (c.isChampion) return 'champion';
  if (c.canEvolve && c.canBeHero) return 'both';
  if (c.canEvolve) return 'evolution';
  if (c.canBeHero) return 'hero';
  return '';
}

/** The art the first three slots draw when the ORDER is the authority. */
export function positionalArt(cards: readonly string[]): SlotArt {
  const art: SlotArt = {};
  const [a, b, c] = cards;
  if (a && (kind(a) === 'evolution' || kind(a) === 'both')) art[a] = 'evolution';
  if (b && (kind(b) === 'hero' || kind(b) === 'both')) art[b] = 'hero';
  if (c) {
    const k = kind(c);
    if (k === 'evolution' || k === 'both') art[c] = 'evolution';
    else if (k === 'hero') art[c] = 'hero';
  }
  return art;
}

/**
 * Seat a deck from what its cards can be. `arrange_deck(cards, {})`, line for
 * line: fill as many special slots as possible, a both-form card spent on the
 * hero slot only when two evolutions still remain, champions first into slots
 * 2 and 3, everything else in the order it arrived.
 */
export function seatDeck(cards: readonly string[]): { cards: string[]; art: SlotArt } {
  const evoOnly: string[] = [];
  const heroOnly: string[] = [];
  const both: string[] = [];
  const champions: string[] = [];
  for (const c of cards) {
    const k = kind(c);
    if (k === 'champion') champions.push(c);
    else if (k === 'both') both.push(c);
    else if (k === 'evolution') evoOnly.push(c);
    else if (k === 'hero') heroOnly.push(c);
  }

  let evos: string[];
  let hero: string | null = null;
  if (champions.length) {
    evos = cards.filter((c) => evoOnly.includes(c) || both.includes(c)).slice(0, 2);
    if (evos.length < 2 && champions.length < 2) {
      const spare = [...heroOnly, ...both.filter((c) => !evos.includes(c))];
      hero = spare[0] ?? null;
    }
  } else {
    hero = heroOnly[0] ?? null;
    if (hero === null && both.length && evoOnly.length + both.length - 1 >= 2) {
      // Python's max(both, key=(elixir, key)): priciest, ties to the LATER key.
      hero = both.reduce((best, c) => {
        const eb = CARDS_BY_KEY.get(best)?.elixir ?? 0;
        const ec = CARDS_BY_KEY.get(c)?.elixir ?? 0;
        return ec > eb || (ec === eb && c > best) ? c : best;
      });
    }
    evos = cards.filter((c) => (evoOnly.includes(c) || both.includes(c)) && c !== hero).slice(0, 2);
  }

  const slots: (string | null)[] = [null, null, null];
  const art: SlotArt = {};
  if (evos.length) {
    slots[0] = evos[0];
    art[evos[0]] = 'evolution';
  }

  const champs = champions.slice(0, 2);
  if (champs.length >= 2) {
    slots[1] = champs[0];
    slots[2] = champs[1];
  } else if (champs.length === 1) {
    if (evos.length > 1) {
      slots[1] = champs[0];
      slots[2] = evos[1];
      art[evos[1]] = 'evolution';
    } else if (hero) {
      slots[1] = hero;
      slots[2] = champs[0];
      art[hero] = 'hero';
    } else {
      slots[1] = champs[0];
    }
  } else {
    if (hero) {
      slots[1] = hero;
      art[hero] = 'hero';
    }
    if (evos.length > 1) {
      slots[2] = evos[1];
      art[evos[1]] = 'evolution';
    }
  }

  const placed = new Set(slots.filter((c): c is string => !!c));
  const rest = cards.filter((c) => !placed.has(c));
  for (let i = 0; i < 3; i++) {
    if (slots[i] === null && rest.length) slots[i] = rest.shift() as string;
  }
  return { cards: [...slots.filter((c): c is string => !!c), ...rest], art };
}

/**
 * What an ENGINE deck should draw: the server's seating when it sent one,
 * `seatDeck` when it sent none. `inferred` is true for the fallback, so
 * `CardArt`'s tooltip says the form came from slot position.
 */
export function drawnDeck(
  cards: readonly string[],
  art: SlotArt | undefined,
  inferred?: boolean,
): { cards: string[]; art: SlotArt; inferred: boolean } {
  if ((art && Object.keys(art).length) || cards.length !== 8) {
    return { cards: [...cards], art: art ?? {}, inferred: !!inferred };
  }
  const seated = seatDeck(cards);
  return { ...seated, inferred: Object.keys(seated.art).length > 0 };
}
