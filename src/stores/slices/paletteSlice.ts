import type { StateCreator } from 'zustand';
import type { PaletteState } from '@/types';
import { createDefaultPalette } from '@/utils/layoutDefaults';

type AppState = import('../useAppStore').AppState;

export interface PaletteSlice {
  palette: PaletteState;
  paletteDirty: boolean;
  setPaletteColor: (slot: 'foreground' | 'background', color: string) => void;
  setActiveColor: (color: string) => void;
  swapPaletteColors: () => void;
  setActivePaletteSlot: (slot: 'foreground' | 'background') => void;
  syncPaletteFromTool: (color: string, slot?: 'foreground' | 'background') => void;
}

export const createPaletteSlice: StateCreator<AppState, [], [], PaletteSlice> = (set, get, _store) => ({
  palette: createDefaultPalette(),
  paletteDirty: false,

  setPaletteColor: (slot, color) =>
    set((state) => {
      const currentColor =
        slot === 'background'
          ? state.palette.backgroundColor
          : state.palette.foregroundColor;
      if (currentColor === color) {
        return state;
      }

      const nextPalette: PaletteState =
        slot === 'background'
          ? { ...state.palette, backgroundColor: color }
          : { ...state.palette, foregroundColor: color };

      const partial: Partial<AppState> = {
        palette: nextPalette,
        paletteDirty: true,
      };

      if (state.project) {
        partial.project = { ...state.project, palette: nextPalette };
      }

      if (slot === 'foreground') {
        partial.tools = {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            color,
          },
        };
      }

      return partial;
    }),

  setActiveColor: (color) => {
    const slot = get().palette.activeSlot ?? 'foreground';
    get().setPaletteColor(slot, color);
  },

  swapPaletteColors: () =>
    set((state) => {
      const nextPalette: PaletteState = {
        ...state.palette,
        foregroundColor: state.palette.backgroundColor,
        backgroundColor: state.palette.foregroundColor,
      };
      if (
        state.palette.foregroundColor === nextPalette.foregroundColor &&
        state.palette.backgroundColor === nextPalette.backgroundColor
      ) {
        return state;
      }
      return {
        palette: nextPalette,
        paletteDirty: true,
      };
    }),

  setActivePaletteSlot: (slot) =>
    set((state) => {
      if (state.palette.activeSlot === slot) {
        return state;
      }
      return {
        palette: {
          ...state.palette,
          activeSlot: slot,
        },
      };
    }),

  syncPaletteFromTool: (color, slot = 'foreground') =>
    set((state) => {
      const nextPalette: PaletteState =
        slot === 'background'
          ? { ...state.palette, backgroundColor: color }
          : { ...state.palette, foregroundColor: color };
      if (
        state.palette.foregroundColor === nextPalette.foregroundColor &&
        state.palette.backgroundColor === nextPalette.backgroundColor
      ) {
        return state;
      }
      return {
        palette: nextPalette,
        paletteDirty: true,
      };
    }),
});
