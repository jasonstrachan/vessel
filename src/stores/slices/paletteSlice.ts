import type { StateCreator } from 'zustand';
import type { PaletteState } from '@/types';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { applyPaletteSnapshot } from '@/stores/helpers/paletteState';

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

export const createPaletteSlice: StateCreator<AppState, [], [], PaletteSlice> = (set, get) => ({
  palette: createDefaultPalette(),
  paletteDirty: false,

  setPaletteColor: (slot, color) => {
    const palette = get().palette;
    const currentColor =
      slot === 'background' ? palette.backgroundColor : palette.foregroundColor;

    if (currentColor === color) {
      return;
    }

    const nextPalette: PaletteState =
      slot === 'background'
        ? { ...palette, backgroundColor: color }
        : { ...palette, foregroundColor: color };

    applyPaletteSnapshot(set, get, nextPalette, { paletteDirty: true });
  },

  setActiveColor: (color) => {
    const slot = get().palette.activeSlot ?? 'foreground';
    get().setPaletteColor(slot, color);
  },

  swapPaletteColors: () => {
    const palette = get().palette;
    const nextPalette: PaletteState = {
      ...palette,
      foregroundColor: palette.backgroundColor,
      backgroundColor: palette.foregroundColor,
    };

    if (
      palette.foregroundColor === nextPalette.foregroundColor &&
      palette.backgroundColor === nextPalette.backgroundColor
    ) {
      return;
    }

    applyPaletteSnapshot(set, get, nextPalette, { paletteDirty: true });
  },

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

  syncPaletteFromTool: (color, slot = 'foreground') => {
    const palette = get().palette;
    const nextPalette: PaletteState =
      slot === 'background'
        ? { ...palette, backgroundColor: color }
        : { ...palette, foregroundColor: color };

    if (
      palette.foregroundColor === nextPalette.foregroundColor &&
      palette.backgroundColor === nextPalette.backgroundColor
    ) {
      return;
    }

    applyPaletteSnapshot(set, get, nextPalette, { paletteDirty: true });
  },
});
