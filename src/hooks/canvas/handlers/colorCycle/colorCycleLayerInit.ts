import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

export type EnsureColorCycleLayerCanvasArgs = {
  isColorCycleLayer: boolean;
  activeLayer: Layer | null;
  project: { width: number; height: number } | null;
};

export type EnsureColorCycleLayerCanvasResult = {
  state: AppState;
  activeLayer: Layer | null;
};

export const ensureColorCycleLayerCanvas = (
  args: EnsureColorCycleLayerCanvasArgs,
  deps: { storeRef: React.MutableRefObject<AppState> }
): EnsureColorCycleLayerCanvasResult => {
  const { isColorCycleLayer, activeLayer, project } = args;
  const { storeRef } = deps;
  const state = storeRef.current;

  if (!isColorCycleLayer || !activeLayer || activeLayer.colorCycleData?.canvas || !project) {
    return { state, activeLayer };
  }

  try {
    storeRef.current.initColorCycleForLayer(
      activeLayer.id,
      project.width,
      project.height
    );
  } catch {
    // Suppressed debug warn for finalize init.
  }

  const refreshedState = storeRef.current;
  const refreshedLayer =
    refreshedState.layers.find(l => l.id === refreshedState.activeLayerId) ?? activeLayer;

  return { state: refreshedState, activeLayer: refreshedLayer };
};
