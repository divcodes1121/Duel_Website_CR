import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DuelDeckSet, SelectedSlot } from '../types/deck';
import type { SortDirection, SortKey } from '../utils/sort';
import type { CardTypeFilter } from '../utils/filter';
import {
  assignCard as assignCardUtil,
  clearDeck as clearDeckUtil,
  clearSlot as clearSlotUtil,
  createEmptyDuelDeckSet,
  renameDeck as renameDeckUtil,
} from './deckUtils';

interface PersistedSlice {
  duelDeckSet: DuelDeckSet;
}

interface BuilderState extends PersistedSlice {
  selectedSlot: SelectedSlot | null;
  filterType: CardTypeFilter;
  sortKey: SortKey;
  sortDirection: SortDirection;

  selectSlot: (deckIndex: number, slotIndex: number) => void;
  clearSelection: () => void;
  assignCard: (cardKey: string) => void;
  clearSlot: (deckIndex: number, slotIndex: number) => void;
  clearDeck: (deckIndex: number) => void;
  renameDeck: (deckIndex: number, name: string) => void;
  setFilterType: (filter: CardTypeFilter) => void;
  setSort: (key: SortKey) => void;
  resetAll: () => void;
}

function createDefaultState(): PersistedSlice {
  return { duelDeckSet: createEmptyDuelDeckSet('My Duel Deck') };
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      ...createDefaultState(),
      selectedSlot: null,
      filterType: 'All',
      sortKey: 'elixir',
      sortDirection: 'asc',

      selectSlot: (deckIndex, slotIndex) => set({ selectedSlot: { deckIndex, slotIndex } }),

      clearSelection: () => set({ selectedSlot: null }),

      assignCard: (cardKey) => {
        const { selectedSlot, duelDeckSet } = get();
        if (!selectedSlot) return;
        const { deckIndex, slotIndex } = selectedSlot;
        const updated = assignCardUtil(duelDeckSet, deckIndex, slotIndex, cardKey);
        if (updated === duelDeckSet) return; // assignment rejected (duplicate) — keep selection
        // Auto-advance to the deck's next empty slot so the user can keep picking
        // without re-clicking "+"; deselect once no empty slot remains after this one.
        const slots = updated.decks[deckIndex].slots;
        let nextSlotIndex: number | null = null;
        for (let i = slotIndex + 1; i < slots.length; i++) {
          if (slots[i] === null) {
            nextSlotIndex = i;
            break;
          }
        }
        set({
          duelDeckSet: updated,
          selectedSlot: nextSlotIndex === null ? null : { deckIndex, slotIndex: nextSlotIndex },
        });
      },

      clearSlot: (deckIndex, slotIndex) =>
        set((state) => ({ duelDeckSet: clearSlotUtil(state.duelDeckSet, deckIndex, slotIndex) })),

      clearDeck: (deckIndex) =>
        set((state) => ({ duelDeckSet: clearDeckUtil(state.duelDeckSet, deckIndex) })),

      renameDeck: (deckIndex, name) =>
        set((state) => ({ duelDeckSet: renameDeckUtil(state.duelDeckSet, deckIndex, name) })),

      setFilterType: (filter) => set({ filterType: filter }),

      setSort: (key) =>
        set((state) =>
          state.sortKey === key
            ? { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' }
            : { sortKey: key, sortDirection: 'asc' },
        ),

      resetAll: () =>
        set({ duelDeckSet: createEmptyDuelDeckSet('My Duel Deck'), selectedSlot: null }),
    }),
    {
      name: 'royal-duels-builder',
      version: 1,
      partialize: (state) => ({ duelDeckSet: state.duelDeckSet }),
      migrate: (persisted, version) => {
        if (version !== 1) return createDefaultState();
        return persisted as PersistedSlice;
      },
    },
  ),
);
