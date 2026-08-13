import type { StateCreator } from 'zustand';
import type {
  ColorCycleGradientSwatch,
  GradientSeamProfile,
  PaletteState,
} from '@/types';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { applyPaletteSnapshot } from '@/stores/helpers/paletteState';

type AppState = import('../useAppStore').AppState;

export interface PaletteSlice {
  palette: PaletteState;
  paletteDirty: boolean;
  colorPickerPreferReferenceLayer: boolean;
  setPaletteColor: (slot: 'foreground' | 'background', color: string) => void;
  setActiveColor: (color: string) => void;
  swapPaletteColors: () => void;
  setActivePaletteSlot: (slot: 'foreground' | 'background') => void;
  syncPaletteFromTool: (color: string, slot?: 'foreground' | 'background') => void;
  setColorPickerPreferReferenceLayer: (prefer: boolean) => void;
  selectColorCycleGradient: (id: string) => void;
  rememberColorCycleGradient: (gradient: {
    stops: ColorCycleGradientSwatch['stops'];
    seamProfile: GradientSeamProfile;
    name?: string;
    isRuntimePalette?: boolean;
  }) => string | null;
  updateActiveColorCycleGradient: (
    stops: ColorCycleGradientSwatch['stops'],
    seamProfile?: GradientSeamProfile,
  ) => void;
}

const MAX_COLOR_CYCLE_GRADIENT_SWATCHES = 10;

const cloneColorCycleStops = (
  stops: ColorCycleGradientSwatch['stops'],
): ColorCycleGradientSwatch['stops'] => stops.map((stop) => ({ ...stop }));

const colorCycleGradientSignature = (
  stops: ColorCycleGradientSwatch['stops'],
  seamProfile: GradientSeamProfile,
  isRuntimePalette = false,
): string => `${seamProfile}:${isRuntimePalette ? 'runtime' : 'source'}:${stops.map((stop) => (
  `${stop.position.toFixed(4)}|${stop.color.toLowerCase()}|${(stop.opacity ?? 1).toFixed(3)}`
)).join(',')}`;

let colorCycleGradientSequence = 0;

const createColorCycleGradientId = (): string => {
  colorCycleGradientSequence += 1;
  return `cc-gradient-${Date.now()}-${colorCycleGradientSequence.toString(36)}`;
};

export const createPaletteSlice: StateCreator<AppState, [], [], PaletteSlice> = (set, get) => ({
  palette: createDefaultPalette(),
  paletteDirty: false,
  colorPickerPreferReferenceLayer: true,

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

  setColorPickerPreferReferenceLayer: (prefer) =>
    set(() => ({
      colorPickerPreferReferenceLayer: Boolean(prefer),
    })),
  selectColorCycleGradient: (id) => {
    const palette = get().palette;
    const gradient = palette.colorCycleGradients?.find((entry) => entry.id === id);
    if (!gradient) return;
    const nextPalette: PaletteState = {
      ...palette,
      activeColorCycleGradientId: gradient.id,
    };
    applyPaletteSnapshot(set, get, nextPalette, {
      paletteDirty: true,
      syncColorCycleGradient: true,
    });
  },
  rememberColorCycleGradient: ({ stops, seamProfile, name, isRuntimePalette = false }) => {
    if (!Array.isArray(stops) || stops.length < 2) return null;
    const palette = get().palette;
    const gradients = palette.colorCycleGradients ?? [];
    const signature = colorCycleGradientSignature(stops, seamProfile, isRuntimePalette);
    const existing = gradients.find(
      (gradient) => colorCycleGradientSignature(
        gradient.stops,
        gradient.seamProfile,
        gradient.isRuntimePalette === true,
      ) === signature,
    );
    const gradient: ColorCycleGradientSwatch = existing ?? {
      id: createColorCycleGradientId(),
      ...(name ? { name } : {}),
      stops: cloneColorCycleStops(stops),
      seamProfile,
      ...(isRuntimePalette ? { isRuntimePalette: true } : {}),
    };
    const nextGradients = [
      gradient,
      ...gradients.filter((entry) => entry.id !== gradient.id),
    ].slice(0, MAX_COLOR_CYCLE_GRADIENT_SWATCHES);
    const nextPalette: PaletteState = {
      ...palette,
      colorCycleGradients: nextGradients,
      activeColorCycleGradientId: gradient.id,
    };
    applyPaletteSnapshot(set, get, nextPalette, {
      paletteDirty: true,
      syncColorCycleGradient: true,
    });
    return gradient.id;
  },
  updateActiveColorCycleGradient: (stops, seamProfile) => {
    if (!Array.isArray(stops) || stops.length < 2) return;
    const palette = get().palette;
    const activeId = palette.activeColorCycleGradientId;
    if (!activeId) return;
    const gradients = palette.colorCycleGradients ?? [];
    const activeGradient = gradients.find((gradient) => gradient.id === activeId);
    if (!activeGradient) return;
    const nextPalette: PaletteState = {
      ...palette,
      colorCycleGradients: gradients.map((gradient) => (
        gradient.id === activeId
          ? {
              ...gradient,
              stops: cloneColorCycleStops(stops),
              seamProfile: seamProfile ?? gradient.seamProfile,
              isRuntimePalette: false,
            }
          : gradient
      )),
    };
    applyPaletteSnapshot(set, get, nextPalette, {
      paletteDirty: true,
      syncColorCycleGradient: true,
    });
  },
});
