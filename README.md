# Royal Duels — Clash Royale Duel Deck Builder

A client-side deck builder for Clash Royale's **Duels** game mode: build 4 decks of 8 cards
each, drawn from a pool of 32 unique cards (no card may appear in more than one of the 4 decks).
Shows elixir average and cycle cost per deck. No backend — everything is saved to your browser's
localStorage.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run test     # run unit tests for the deck logic
npm run build    # production build
```

## Project structure

- `src/data/cards.json` — vendored snapshot of Clash Royale card data (from
  [RoyaleAPI/cr-api-data](https://github.com/RoyaleAPI/cr-api-data)). Refresh with `npm run update:cards`.
- `public/assets/cards/` — card icon images, self-hosted (not hotlinked). See `ATTRIBUTION.md`.
- `src/state/deckUtils.ts` — pure deck logic (assignment, cross-deck uniqueness, elixir/cycle stats).
- `src/state/store.ts` — Zustand store with localStorage persistence.
- `src/components/DuelDeckBuilder/` — the 4 deck panels.
- `src/components/CardPicker/` — the card picker drawer (filter/sort/grid).

This is unofficial fan content, not affiliated with or endorsed by Supercell.
