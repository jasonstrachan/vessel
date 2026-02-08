import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { BrushSettings, CanvasSnapshot, Layer, Tool } from '@/types';

export type FinalizeRasterFallbackArgs = {
  commitSkipped: boolean;
  skipSave: boolean;
  layerBeforeImage: ImageData | null;
  isColorCycleLayer: boolean;
  activeSettings: BrushSettings;
  activeLayer: Layer;
  currentTool: Tool | 'eraser';
  resolvedHistoryAction: CanvasSnapshot['actionType'];
  resolvedHistoryDescription: string;
  coalescePayload: unknown;
  captureRoi: CaptureRegion | undefined;
  layerBeforeColorState: ColorCycleSerializedState | null;
};

export type FinalizeRasterFallbackDeps = {
  logError: (message: string) => void;
  applyFinalizePolygonLostEdge: (args: {
    isColorCycleLayer: boolean;
    activeSettings: BrushSettings;
    logDevStats?: boolean;
  }) => void;
  commitRasterOverlay: (args: {
    layer: Layer;
    overlayCanvas: HTMLCanvasElement | null;
    beforeImage: ImageData | null;
    beforeColorState: ColorCycleSerializedState | null;
    historyAction: CanvasSnapshot['actionType'];
    historyDescription: string;
    tool: string;
    coalesce?: unknown;
    bitmapRoi?: CaptureRegion;
    skipHistory: boolean;
    deferHistory: boolean;
  }) => Promise<void>;
  getOverlayCanvas: () => HTMLCanvasElement | null;
  isDev: boolean;
};

export const handleFinalizeRasterFallback = async (
  {
    commitSkipped,
    skipSave,
    layerBeforeImage,
    isColorCycleLayer,
    activeSettings,
    activeLayer,
    currentTool,
    resolvedHistoryAction,
    resolvedHistoryDescription,
    coalescePayload,
    captureRoi,
    layerBeforeColorState,
  }: FinalizeRasterFallbackArgs,
  deps: FinalizeRasterFallbackDeps
): Promise<boolean> => {
  if (commitSkipped) {
    return false;
  }

  if (!skipSave && !layerBeforeImage) {
    deps.logError('[finalize] brush beforeImage missing; skipping history to avoid destructive undo.');
    return true;
  }

  deps.applyFinalizePolygonLostEdge({
    isColorCycleLayer,
    activeSettings,
    logDevStats: deps.isDev,
  });

  await deps.commitRasterOverlay({
    layer: activeLayer,
    overlayCanvas: deps.getOverlayCanvas(),
    beforeImage: layerBeforeImage,
    beforeColorState: layerBeforeColorState,
    historyAction: resolvedHistoryAction,
    historyDescription: resolvedHistoryDescription,
    tool: currentTool,
    coalesce: skipSave ? undefined : coalescePayload,
    bitmapRoi: captureRoi ?? undefined,
    skipHistory: skipSave,
    deferHistory: !skipSave,
  });

  return !skipSave;
};
