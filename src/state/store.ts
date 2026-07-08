import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DUEL_DECK_COUNT } from '../types/deck';
import type {
  BuilderMode,
  Deck,
  DeckOwner,
  DuelDeckSet,
  SavedDeckSet,
  SavedSingleDeck,
  SelectedSlot,
} from '../types/deck';
import type { SortDirection, SortKey } from '../utils/sort';
import type { CardTypeFilter } from '../utils/filter';
import {
  assignCard as assignCardUtil,
  canAssignCardToSlot,
  clearDeck as clearDeckUtil,
  clearSlot as clearSlotUtil,
  createEmptyDeck,
  createEmptyDuelDeckSet,
  getUsedCardKeys,
  moveCard as moveCardUtil,
  renameDeck as renameDeckUtil,
  validateImportedDeck,
  type SlotRef,
  type UniquenessScope,
} from './deckUtils';
import { CARDS_BY_KEY } from '../data/cards';
import { useAuthStore } from './authStore';
import { pullRemoteDecks, pushRemoteDecks, type SyncPayload } from './syncClient';

/** Duel collections (Deck's Home excluded — it manages its own deck list). */
export type DuelOwner = 'solo' | 'blue' | 'red';

/** Decks 1-3 are always shown; 4 and 5 unlock via the "Add deck slot" button. */
export const MIN_DECK_SLOTS = 3;

interface PersistedSlice {
  /**
   * Independent duel deck collections. `solo` backs the classic single-player
   * builder tab; `blue`/`red` back the Versus tab. Card-uniqueness rules apply
   * within one collection and never across collections.
   */
  sets: Record<DeckOwner, DuelDeckSet>;
  mode: BuilderMode;
  /** Named snapshots saved by the user, most recent first. */
  library: SavedDeckSet[];
  /** How many deck slots are revealed per duel collection (3..DUEL_DECK_COUNT). */
  deckSlotCount: Record<DuelOwner, number>;
}

interface BuilderState extends PersistedSlice {
  selectedSlot: SelectedSlot | null;
  /**
   * Set when the user removes the card from the currently-selected slot: the
   * next assignment refills that same slot without auto-advancing, preserving
   * the "replace in place" editing flow.
   */
  selectionPinned: boolean;
  filterType: CardTypeFilter;
  sortKey: SortKey;
  sortDirection: SortDirection;

  setMode: (mode: BuilderMode) => void;
  selectSlot: (owner: DeckOwner, deckIndex: number, slotIndex: number) => void;
  clearSelection: () => void;
  assignCard: (cardKey: string) => void;
  /** Direct assignment to an explicit slot (drag & drop) — never moves the selection. */
  assignCardAt: (owner: DeckOwner, deckIndex: number, slotIndex: number, cardKey: string) => void;
  /** Move/swap a card between two slots of the same owner (drag & drop). */
  moveCard: (owner: DeckOwner, from: SlotRef, to: SlotRef) => void;
  clearSlot: (owner: DeckOwner, deckIndex: number, slotIndex: number) => void;
  clearDeck: (owner: DeckOwner, deckIndex: number) => void;
  /**
   * Replace a deck with 8 imported card keys (from a pasted CR deck link).
   * Duplicates across the collection are allowed (shown desaturated in the UI).
   * Returns null on success or a human-readable error message.
   */
  importDeck: (owner: DeckOwner, deckIndex: number, keys: string[]) => string | null;
  renameDeck: (owner: DeckOwner, deckIndex: number, name: string) => void;
  setFilterType: (filter: CardTypeFilter) => void;
  setSort: (key: SortKey) => void;
  resetAll: () => void;
  /** Snapshot the current tab's decks into the library under the given name. */
  saveCurrent: (name: string) => void;
  /** Restore a library entry into its tab (switching tabs if needed). */
  loadSaved: (id: string) => void;
  renameSaved: (id: string, name: string) => void;
  deleteSaved: (id: string) => void;
  /** Reveal the next hidden duel deck slot (up to DUEL_DECK_COUNT). */
  addDeckSlot: (owner: DuelOwner) => void;
  /** Hide the last revealed duel deck slot (down to MIN_DECK_SLOTS), clearing its cards. */
  removeDeckSlot: (owner: DuelOwner) => void;
  /** Deck's Home: append another empty deck slot. */
  addHomeDeck: () => void;
  /** Deck's Home: remove a deck slot entirely. */
  removeHomeDeck: (deckIndex: number) => void;
}

/** Deck's Home is a growing list of independent decks; it starts with one. */
function createHomeSet(): DuelDeckSet {
  const set = createEmptyDuelDeckSet("Deck's Home");
  return { ...set, decks: [createEmptyDeck('My Deck')] };
}

function createDefaultSets(): Record<DeckOwner, DuelDeckSet> {
  return {
    solo: createEmptyDuelDeckSet('My Duel Deck'),
    blue: createEmptyDuelDeckSet('Blue Player'),
    red: createEmptyDuelDeckSet('Red Player'),
    home: createHomeSet(),
  };
}

/** Deck's Home decks are independent; duel collections share uniqueness. */
function scopeFor(owner: DeckOwner): UniquenessScope {
  return owner === 'home' ? 'deck' : 'collection';
}

/** Older versions stored 4-deck duel collections; pad them to the new count. */
function padDuelSet<T extends DuelDeckSet | undefined>(set: T): T {
  if (!set || set.decks.length >= DUEL_DECK_COUNT) return set;
  const decks = [...set.decks];
  while (decks.length < DUEL_DECK_COUNT) {
    decks.push(createEmptyDeck(`Deck ${decks.length + 1}`));
  }
  return { ...set, decks };
}

function padToCurrentDeckCount(slice: Omit<PersistedSlice, 'deckSlotCount'>): PersistedSlice {
  const padded = {
    ...slice,
    sets: {
      ...slice.sets,
      solo: padDuelSet(slice.sets.solo),
      blue: padDuelSet(slice.sets.blue),
      red: padDuelSet(slice.sets.red),
      // Deck's Home is an open-ended list — never padded.
    },
    library: slice.library.map((entry) => ({
      ...entry,
      solo: padDuelSet(entry.solo),
      blue: padDuelSet(entry.blue),
      red: padDuelSet(entry.red),
    })),
  };
  return { ...padded, deckSlotCount: deriveDeckSlotCounts(padded.sets) };
}

/** Reveal enough slots to show every deck that already holds cards. */
function deriveDeckSlotCount(set: DuelDeckSet | undefined): number {
  if (!set) return MIN_DECK_SLOTS;
  let lastUsed = -1;
  set.decks.forEach((deck, i) => {
    if (deck.slots.some((k) => k !== null)) lastUsed = i;
  });
  return Math.min(DUEL_DECK_COUNT, Math.max(MIN_DECK_SLOTS, lastUsed + 1));
}

function deriveDeckSlotCounts(sets: Record<DeckOwner, DuelDeckSet>): Record<DuelOwner, number> {
  return {
    solo: deriveDeckSlotCount(sets.solo),
    blue: deriveDeckSlotCount(sets.blue),
    red: deriveDeckSlotCount(sets.red),
  };
}

interface PersistedSliceV1 {
  duelDeckSet: DuelDeckSet;
}

interface PersistedSliceV2 {
  players: { blue: DuelDeckSet; red: DuelDeckSet };
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      sets: createDefaultSets(),
      mode: 'solo',
      library: [],
      deckSlotCount: { solo: MIN_DECK_SLOTS, blue: MIN_DECK_SLOTS, red: MIN_DECK_SLOTS },
      selectedSlot: null,
      selectionPinned: false,
      filterType: 'All',
      sortKey: 'elixir',
      sortDirection: 'asc',

      setMode: (mode) => set({ mode, selectedSlot: null, selectionPinned: false }),

      selectSlot: (owner, deckIndex, slotIndex) =>
        set({ selectedSlot: { owner, deckIndex, slotIndex }, selectionPinned: false }),

      clearSelection: () => set({ selectedSlot: null, selectionPinned: false }),

      assignCard: (cardKey) => {
        const { selectedSlot, sets, selectionPinned } = get();
        if (!selectedSlot) return;
        const { owner, deckIndex, slotIndex } = selectedSlot;
        const card = CARDS_BY_KEY.get(cardKey);
        const current = sets[owner];
        const scope = scopeFor(owner);
        // Positional champion rule, uniqueness, and champion cap in one check.
        if (!card || !canAssignCardToSlot(current, deckIndex, slotIndex, card, CARDS_BY_KEY, scope)) {
          return;
        }
        const wasEmpty = current.decks[deckIndex].slots[slotIndex] === null;
        const updated = assignCardUtil(current, deckIndex, slotIndex, cardKey, scope);
        if (updated === current) return; // assignment rejected (duplicate) — keep selection

        // Auto-advance only when sequentially filling empty slots. Replacing a
        // card (occupied slot, or a slot the user just cleared) keeps the
        // selection in place — the cursor only moves on a manual slot click.
        let nextSelected: SelectedSlot | null = selectedSlot;
        if (wasEmpty && !selectionPinned) {
          const slots = updated.decks[deckIndex].slots;
          let nextSlotIndex: number | null = null;
          for (let i = slotIndex + 1; i < slots.length; i++) {
            if (slots[i] === null) {
              nextSlotIndex = i;
              break;
            }
          }
          nextSelected =
            nextSlotIndex === null ? null : { owner, deckIndex, slotIndex: nextSlotIndex };
        }

        set({
          sets: { ...sets, [owner]: updated },
          selectedSlot: nextSelected,
          selectionPinned: false,
        });
      },

      assignCardAt: (owner, deckIndex, slotIndex, cardKey) =>
        set((state) => {
          const card = CARDS_BY_KEY.get(cardKey);
          const current = state.sets[owner];
          const scope = scopeFor(owner);
          if (!card || !canAssignCardToSlot(current, deckIndex, slotIndex, card, CARDS_BY_KEY, scope)) {
            return state;
          }
          return {
            sets: {
              ...state.sets,
              [owner]: assignCardUtil(current, deckIndex, slotIndex, cardKey, scope),
            },
          };
        }),

      moveCard: (owner, from, to) =>
        set((state) => ({
          sets: {
            ...state.sets,
            [owner]: moveCardUtil(state.sets[owner], from, to, CARDS_BY_KEY),
          },
        })),

      clearSlot: (owner, deckIndex, slotIndex) =>
        set((state) => {
          const isSelectedSlot =
            state.selectedSlot?.owner === owner &&
            state.selectedSlot?.deckIndex === deckIndex &&
            state.selectedSlot?.slotIndex === slotIndex;
          return {
            sets: {
              ...state.sets,
              [owner]: clearSlotUtil(state.sets[owner], deckIndex, slotIndex),
            },
            // Removing the selected slot's card pins the selection there so the
            // next pick refills it instead of advancing.
            selectionPinned: isSelectedSlot ? true : state.selectionPinned,
          };
        }),

      clearDeck: (owner, deckIndex) =>
        set((state) => ({
          sets: {
            ...state.sets,
            [owner]: clearDeckUtil(state.sets[owner], deckIndex),
          },
        })),

      importDeck: (owner, deckIndex, keys) => {
        const state = get();
        const current = state.sets[owner];
        const result = validateImportedDeck(keys, CARDS_BY_KEY);
        if ('error' in result) return result.error;
        // Cards other decks already own: only this freshly-pasted deck shows
        // them black & white; the original copies keep their color.
        const usedElsewhere = getUsedCardKeys(current, deckIndex);
        const importedDuplicates =
          owner === 'home' ? [] : result.slots.filter((k) => usedElsewhere.has(k));
        set({
          sets: {
            ...state.sets,
            [owner]: {
              ...current,
              decks: current.decks.map((d, i) =>
                i === deckIndex ? { ...d, slots: [...result.slots], importedDuplicates } : d,
              ),
              updatedAt: new Date().toISOString(),
            },
          },
          selectedSlot: null,
          selectionPinned: false,
        });
        return null;
      },

      renameDeck: (owner, deckIndex, name) =>
        set((state) => ({
          sets: {
            ...state.sets,
            [owner]: renameDeckUtil(state.sets[owner], deckIndex, name),
          },
        })),

      setFilterType: (filter) => set({ filterType: filter }),

      setSort: (key) =>
        set((state) =>
          state.sortKey === key
            ? { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' }
            : { sortKey: key, sortDirection: 'asc' },
        ),

      // Resets only the collections visible in the current mode.
      resetAll: () =>
        set((state) => ({
          sets:
            state.mode === 'solo'
              ? { ...state.sets, solo: createEmptyDuelDeckSet('My Duel Deck') }
              : {
                  ...state.sets,
                  blue: createEmptyDuelDeckSet('Blue Player'),
                  red: createEmptyDuelDeckSet('Red Player'),
                },
          deckSlotCount:
            state.mode === 'solo'
              ? { ...state.deckSlotCount, solo: MIN_DECK_SLOTS }
              : { ...state.deckSlotCount, blue: MIN_DECK_SLOTS, red: MIN_DECK_SLOTS },
          selectedSlot: null,
          selectionPinned: false,
        })),

      saveCurrent: (name) =>
        set((state) => {
          const entry: SavedDeckSet = {
            id: crypto.randomUUID(),
            name: name.trim() || `Saved Duel Deck ${state.library.length + 1}`,
            mode: state.mode,
            savedAt: new Date().toISOString(),
            ...(state.mode === 'solo'
              ? { solo: structuredClone(state.sets.solo) }
              : {
                  blue: structuredClone(state.sets.blue),
                  red: structuredClone(state.sets.red),
                }),
          };
          return { library: [entry, ...state.library] };
        }),

      loadSaved: (id) =>
        set((state) => {
          const entry = state.library.find((e) => e.id === id);
          if (!entry) return state;
          const sets = { ...state.sets };
          const deckSlotCount = { ...state.deckSlotCount };
          if (entry.mode === 'solo' && entry.solo) {
            sets.solo = padDuelSet(structuredClone(entry.solo));
            deckSlotCount.solo = deriveDeckSlotCount(sets.solo);
          } else if (entry.mode === 'versus' && entry.blue && entry.red) {
            sets.blue = padDuelSet(structuredClone(entry.blue));
            sets.red = padDuelSet(structuredClone(entry.red));
            deckSlotCount.blue = deriveDeckSlotCount(sets.blue);
            deckSlotCount.red = deriveDeckSlotCount(sets.red);
          } else {
            return state; // malformed entry — don't touch anything
          }
          return { sets, deckSlotCount, mode: entry.mode, selectedSlot: null, selectionPinned: false };
        }),

      renameSaved: (id, name) =>
        set((state) => ({
          library: state.library.map((e) =>
            e.id === id ? { ...e, name: name.trim() || e.name } : e,
          ),
        })),

      deleteSaved: (id) =>
        set((state) => ({ library: state.library.filter((e) => e.id !== id) })),

      addDeckSlot: (owner) =>
        set((state) => ({
          deckSlotCount: {
            ...state.deckSlotCount,
            [owner]: Math.min(DUEL_DECK_COUNT, state.deckSlotCount[owner] + 1),
          },
        })),

      removeDeckSlot: (owner) =>
        set((state) => {
          const count = state.deckSlotCount[owner];
          if (count <= MIN_DECK_SLOTS) return state;
          const lastIndex = count - 1;
          return {
            // The hidden deck must not keep holding cards (they'd still block
            // uniqueness invisibly) — clear it on the way out.
            sets: {
              ...state.sets,
              [owner]: clearDeckUtil(state.sets[owner], lastIndex),
            },
            deckSlotCount: { ...state.deckSlotCount, [owner]: lastIndex },
            selectedSlot:
              state.selectedSlot?.owner === owner && state.selectedSlot.deckIndex === lastIndex
                ? null
                : state.selectedSlot,
          };
        }),

      addHomeDeck: () =>
        set((state) => {
          const home = state.sets.home;
          const decks = [...home.decks, createEmptyDeck(`Deck ${home.decks.length + 1}`)];
          return {
            sets: {
              ...state.sets,
              home: { ...home, decks, updatedAt: new Date().toISOString() },
            },
          };
        }),

      removeHomeDeck: (deckIndex) =>
        set((state) => {
          const home = state.sets.home;
          const decks = home.decks.filter((_, i) => i !== deckIndex);
          return {
            sets: {
              ...state.sets,
              home: { ...home, decks, updatedAt: new Date().toISOString() },
            },
            // Indices shift after removal — drop any home selection.
            selectedSlot: state.selectedSlot?.owner === 'home' ? null : state.selectedSlot,
            selectionPinned: false,
          };
        }),
    }),
    {
      name: 'royal-duels-builder',
      version: 8,
      partialize: (state) => ({
        sets: state.sets,
        mode: state.mode,
        library: state.library,
        deckSlotCount: state.deckSlotCount,
      }),
      migrate: (persisted, version) => {
        // v7: duel collections grew from 4 to 5 decks; v8 added per-collection
        // revealed-slot counts. Older payloads funnel through their original
        // migration, then get padded + counted.
        if (version === 8) return persisted as PersistedSlice;
        if (version === 7) {
          const v7 = persisted as Omit<PersistedSlice, 'deckSlotCount'>;
          return { ...v7, deckSlotCount: deriveDeckSlotCounts(v7.sets) };
        }
        if (version === 6) {
          return padToCurrentDeckCount(persisted as Omit<PersistedSlice, 'deckSlotCount'>);
        }
        // v5: home was a 4-deck set (index 0 = workshop) + a separate homeLibrary.
        // Fold the working deck and every saved deck into the new open-ended list.
        if (version === 5) {
          const v5 = persisted as PersistedSlice & { homeLibrary?: SavedSingleDeck[] };
          const working = v5.sets.home?.decks?.[0];
          const decks: Deck[] = [];
          if (working && working.slots.some((k) => k !== null)) decks.push(working);
          for (const entry of v5.homeLibrary ?? []) {
            decks.push({ ...structuredClone(entry.deck), name: entry.name });
          }
          if (decks.length === 0) decks.push(createEmptyDeck('My Deck'));
          return padToCurrentDeckCount({
            sets: { ...v5.sets, home: { ...v5.sets.home, decks } },
            mode: v5.mode,
            library: v5.library,
          });
        }
        // v4 had solo/blue/red sets + duel library, but no home slice.
        if (version === 4) {
          const v4 = persisted as PersistedSlice;
          return padToCurrentDeckCount({ ...v4, sets: { ...v4.sets, home: createHomeSet() } });
        }
        // v3 had solo/blue/red sets + mode, but no libraries.
        if (version === 3) {
          const v3 = persisted as Omit<PersistedSlice, 'library'>;
          return padToCurrentDeckCount({
            ...v3,
            sets: { ...v3.sets, home: createEmptyDuelDeckSet("Deck's Home") },
            library: [],
          });
        }
        // v1 stored a single duelDeckSet — it becomes the solo collection.
        const v1 = persisted as Partial<PersistedSliceV1> | undefined;
        if (v1?.duelDeckSet) {
          return padToCurrentDeckCount({
            sets: { ...createDefaultSets(), solo: { ...v1.duelDeckSet, name: 'My Duel Deck' } },
            mode: 'solo' as BuilderMode,
            library: [],
          });
        }
        // v2 (short-lived dev shape) stored blue/red only; blue held the old solo decks.
        const v2 = persisted as Partial<PersistedSliceV2> | undefined;
        if (v2?.players) {
          return padToCurrentDeckCount({
            sets: {
              ...createDefaultSets(),
              solo: { ...v2.players.blue, name: 'My Duel Deck' },
              red: v2.players.red,
            },
            mode: 'solo' as BuilderMode,
            library: [],
          });
        }
        return {
          sets: createDefaultSets(),
          mode: 'solo' as BuilderMode,
          library: [],
          deckSlotCount: { solo: MIN_DECK_SLOTS, blue: MIN_DECK_SLOTS, red: MIN_DECK_SLOTS },
        };
      },
    },
  ),
);

/* ============================================================ cross-device sync
 * The same account (username + password) shows the same decks everywhere.
 * `credential` (sha256 of the login, see authStore.ts) doubles as the sync
 * key: on login, remote data replaces local state; on every subsequent
 * change, local state is debounced-pushed back up. Best-effort — sync
 * failures (offline, or /api unavailable in plain `vite dev`) never block
 * or corrupt the local experience, which keeps working exactly as before.
 * ========================================================================= */

function currentSyncPayload(): SyncPayload {
  const { sets, library, deckSlotCount } = useBuilderStore.getState();
  return { sets, library, deckSlotCount };
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let suppressNextPush = false;

function schedulePush() {
  if (suppressNextPush) {
    suppressNextPush = false;
    return;
  }
  const { credential } = useAuthStore.getState();
  if (!credential) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushRemoteDecks(credential, currentSyncPayload());
  }, 1500);
}

async function hydrateFromRemote(credential: string) {
  const remote = await pullRemoteDecks(credential);
  if (remote) {
    // A pull-driven update shouldn't immediately bounce back up as a push.
    suppressNextPush = true;
    useBuilderStore.setState({
      sets: remote.sets,
      library: remote.library,
      deckSlotCount: remote.deckSlotCount ?? deriveDeckSlotCounts(remote.sets),
    });
  } else {
    // First sync ever for this account — seed remote storage from local state.
    void pushRemoteDecks(credential, currentSyncPayload());
  }
}

// Pull whenever a login completes.
useAuthStore.subscribe((state, prevState) => {
  if (state.credential && state.credential !== prevState.credential) {
    void hydrateFromRemote(state.credential);
  }
});

// A session can already be active when this module loads (persisted login) —
// the subscribe above only sees *future* transitions, so pull once up front too.
const activeCredentialOnLoad = useAuthStore.getState().credential;
if (activeCredentialOnLoad) void hydrateFromRemote(activeCredentialOnLoad);

// Push whenever the synced slices change while signed in.
useBuilderStore.subscribe((state, prevState) => {
  if (
    state.sets !== prevState.sets ||
    state.library !== prevState.library ||
    state.deckSlotCount !== prevState.deckSlotCount
  ) {
    schedulePush();
  }
});
