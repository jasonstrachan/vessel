import type { StateCreator } from 'zustand';
import type { CanvasState, DisplayFilterConfig, DisplayFilterId } from '@/types';
import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM } from '@/constants/canvas';
import { createDefaultDisplayFilters, disableDisplayFilters, sanitizeDisplayFilters } from '@/lib/displayFilters';
import { mergeLocalSettings, readLocalSettings } from '@/utils/localSettings';

type AppState = import('../useAppStore').AppState;

export interface CanvasSlice {
  canvas: CanvasState;
  canvasViewport: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  setZoom: (zoom: number) => void;
  setRotation: (rotation: number) => void;
  setGridSize: (size: number) => void;
  setCanvasOffset: (offsetX: number, offsetY: number) => void;
  setCanvasViewport: (viewport: { left: number; top: number; width: number; height: number }) => void;
  toggleRulers: () => void;
  setShowFPSMeter: (visible: boolean) => void;
  setTransparencyBackgroundMode: (mode: CanvasState['transparencyBackgroundMode']) => void;
  setDisplayMode: (mode: 'pixelated' | 'smooth') => void;
  setDisplayFilters: (filters: CanvasState['displayFilters']) => void;
  setDisplayFilterEnabled: (id: DisplayFilterId, enabled: boolean) => void;
  updateDisplayFilter: (id: DisplayFilterId, settings: Partial<Record<string, number>>) => void;
  setCanvasDimensions: (width: number, height: number) => void;
  resizeCanvas: (width: number, height: number) => Promise<void>;
  setSelection: (selection: CanvasState['selection']) => void;
  setCursor: (cursor: CanvasState['cursor']) => void;
}

const createDefaultSelection = (): CanvasState['selection'] => ({
  active: false,
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  pixels: typeof ImageData !== 'undefined' ? new ImageData(1, 1) : ({} as ImageData),
});

export const getStoredDisplayFilterDefaults = (): DisplayFilterConfig[] =>
  disableDisplayFilters(
    readLocalSettings().canvas?.displayFilterDefaults ?? createDefaultDisplayFilters(),
  );

export const getStoredTransparencyBackgroundMode = (): CanvasState['transparencyBackgroundMode'] => {
  const storedMode = readLocalSettings().canvas?.transparencyBackgroundMode;
  return storedMode === 'gray' || storedMode === 'checker' ? storedMode : 'checker';
};

const persistDisplayFilterDefaults = (filters: DisplayFilterConfig[]): void => {
  mergeLocalSettings({
    canvas: {
      displayFilterDefaults: disableDisplayFilters(filters),
    },
  });
};

export const defaultCanvasState: CanvasState = {
  zoom: 1,
  rotation: 0,
  gridSize: 16,
  showRulers: false,
  showFPSMeter: true,
  transparencyBackgroundMode: getStoredTransparencyBackgroundMode(),
  displayMode: 'pixelated',
  displayFilters: getStoredDisplayFilterDefaults(),
  canvasWidth: 2000,
  canvasHeight: 2000,
  offsetX: 0,
  offsetY: 0,
  selection: createDefaultSelection(),
  cursor: {
    x: 0,
    y: 0,
    pressure: 0,
  },
};

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  canvas: defaultCanvasState,
  canvasViewport: {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  },
  setZoom: (zoom) =>
    set((state) => ({
      canvas: {
        ...state.canvas,
        zoom: Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom)),
      },
    })),
  setRotation: (rotation) =>
    set((state) => ({
      canvas: { ...state.canvas, rotation },
    })),
  setGridSize: (gridSize) =>
    set((state) => ({
      canvas: { ...state.canvas, gridSize },
    })),
  setCanvasOffset: (offsetX, offsetY) =>
    set((state) => {
      if (state.canvas.offsetX === offsetX && state.canvas.offsetY === offsetY) {
        return state;
      }
      return {
        canvas: { ...state.canvas, offsetX, offsetY },
      };
    }),
  setCanvasViewport: (viewport) =>
    set((state) => {
      const { left, top, width, height } = state.canvasViewport;
      if (
        left === viewport.left &&
        top === viewport.top &&
        width === viewport.width &&
        height === viewport.height
      ) {
        return state;
      }
      return {
        canvasViewport: viewport,
      };
    }),
  toggleRulers: () =>
    set((state) => ({
      canvas: { ...state.canvas, showRulers: !state.canvas.showRulers },
    })),
  setShowFPSMeter: (visible) =>
    set((state) => {
      if (state.canvas.showFPSMeter === visible) {
        return state;
      }
      return {
        canvas: { ...state.canvas, showFPSMeter: visible },
      };
    }),
  setTransparencyBackgroundMode: (mode) =>
    set((state) => {
      if (state.canvas.transparencyBackgroundMode === mode) {
        return state;
      }
      mergeLocalSettings({
        canvas: {
          transparencyBackgroundMode: mode,
        },
      });
      return {
        canvas: { ...state.canvas, transparencyBackgroundMode: mode },
      };
    }),
  setDisplayMode: (mode) =>
    set((state) => ({
      canvas: { ...state.canvas, displayMode: mode },
    })),
  setDisplayFilters: (filters) =>
    set((state) => ({
      canvas: { ...state.canvas, displayFilters: sanitizeDisplayFilters(filters) },
    })),
  setDisplayFilterEnabled: (id, enabled) =>
    set((state) => ({
      canvas: {
        ...state.canvas,
        displayFilters: state.canvas.displayFilters.map((filter) => (
          filter.id === id ? { ...filter, enabled } : filter
        )),
      },
    })),
  updateDisplayFilter: (id, settings) =>
    set((state) => {
      const nextDisplayFilters = sanitizeDisplayFilters(
        state.canvas.displayFilters.map((filter) => (
          filter.id === id
            ? ({
                ...filter,
                settings: {
                  ...filter.settings,
                  ...(settings as object),
                },
              } as DisplayFilterConfig)
            : filter
        ))
      );
      persistDisplayFilterDefaults(nextDisplayFilters);
      return {
        canvas: {
          ...state.canvas,
          displayFilters: nextDisplayFilters,
        },
      };
    }),
  setCanvasDimensions: (width, height) =>
    set((state) => ({
      canvas: { ...state.canvas, canvasWidth: width, canvasHeight: height },
    })),
  resizeCanvas: async (width, height) => {
    await get().resizeProjectCanvas(width, height);
  },
  setSelection: (selection) =>
    set((state) => ({
      canvas: { ...state.canvas, selection },
    })),
  setCursor: (cursor) =>
    set((state) => ({
      canvas: { ...state.canvas, cursor },
    })),
});
