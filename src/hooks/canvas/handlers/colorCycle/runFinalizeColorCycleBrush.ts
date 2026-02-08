import type { BrushSettings } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  finalizeColorCycleBrush,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalize';
import {
  createFinalizeColorCycleBrushDeps,
  type FinalizeColorCycleBrushBaseDeps,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeDeps';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';

export const runFinalizeColorCycleBrush = async ({
  activeSettings,
  currentState,
  drawingCanvas,
  drawingCtx,
  baseDeps,
}: {
  activeSettings: BrushSettings;
  currentState: AppState;
  drawingCanvas: HTMLCanvasElement | null;
  drawingCtx: CanvasRenderingContext2D | null;
  baseDeps: FinalizeColorCycleBrushBaseDeps;
}): Promise<{ shouldReturn: boolean }> => {
  const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
  if (activeLayer?.layerType !== 'color-cycle') {
    return { shouldReturn: false };
  }

  return finalizeColorCycleBrush(
    {
      activeFlags: getColorCycleBrushFlags(activeSettings),
      activeSettings,
      currentState,
    },
    createFinalizeColorCycleBrushDeps({
      base: baseDeps,
      drawingCanvas,
      drawingCtx,
    })
  );
};
