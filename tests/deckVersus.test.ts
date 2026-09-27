import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A SOURCE CONTRACT, because this suite runs in `node` with no DOM.
 *
 * Deck vs Deck used to exist only on the player-scoped Deck Counter; the home
 * route's Deck Counter (`CounterLab`) had only "find a counter", although
 * neither question needs a player. Both now mount ONE `DeckVersus`, so the two
 * screens cannot answer the same two decks differently.
 */
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../src/components/Analytics/${p}`, import.meta.url)), 'utf-8');

const LAB = read('CounterLab.tsx');
const PLAYER = read('DeckCounter.tsx');

describe('both Deck Counters offer Deck vs Deck', () => {
  it('the home route mounts the shared panel behind a Deck vs Deck tab', () => {
    expect(LAB).toMatch(/import \{ DeckVersus \} from '\.\/DeckCounter'/);
    expect(LAB).toMatch(/<DeckVersus state=\{versusState\} \/>/);
    expect(LAB).toMatch(/label: 'Deck vs Deck'/);
    expect(LAB).toMatch(/label: 'Find counters'/);
  });

  it('the player screen mounts the same component and owns its state', () => {
    expect(PLAYER).toMatch(/export function DeckVersus\(/);
    expect(PLAYER).toMatch(/<DeckVersus state=\{versusState\} \/>/);
    expect(PLAYER).toMatch(/const versusState = useVersusState\(\);/);
  });

  it('the upsell no longer sells a head-to-head that is free on both screens', () => {
    expect(LAB).not.toMatch(/Head-to-head between any two lists/);
  });
});
