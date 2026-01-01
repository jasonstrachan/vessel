import type { BrushSettings, Layer } from '@/types';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { BoundingBox, CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import {
  commitColorCycleLayerStroke,
  type ManagedColorCycleBrush,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';

export type ColorCycleStrokeCommitArgs = {
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  activeLayer: Layer | null;
  brushSettings: BrushSettings;
  project: { width: number; height: number } | null;
  drawingCanvas: HTMLCanvasElement | null;
  strokeBoundingBox: BoundingBox | null;
  strokeCapturePadding: number;
  roiPadding: number;
  enableCaptureRoi: boolean;
};

export type ColorCycleStrokeCommitDeps = {
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  bindBrushToCanvas: (brush: ColorCycleBrushImplementation, canvas: HTMLCanvasElement) => void;
  markLayerHasContent: (layerId: string) => void;
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  startFinalizeVisibleTimer: () => void;
  endFinalizeVisibleTimer: () => void;
  dispatchFrameUpdate: (layerId: string) => void;
};

export type ColorCycleStrokeCommitResult = {
  handled: boolean;
  skipped: boolean;
  brushForCleanup?: ManagedColorCycleBrush;
  deferredLayerCanvas?: HTMLCanvasElement | null;
  strokeCaptureRoi?: CaptureRegion;
};

export const commitColorCycleStrokeIfNeeded = async (
  args: ColorCycleStrokeCommitArgs,
  deps: ColorCycleStrokeCommitDeps
): Promise<ColorCycleStrokeCommitResult> => {
  if (!args.isColorCycleLayer) {
    return { handled: false, skipped: false };
  }

  if (!args.isColorCycleBrush || !args.activeLayer?.colorCycleData?.canvas) {
    // CC layer without a valid CC canvas or CC brush: skip raster history to preserve CC undo semantics.
    return { handled: false, skipped: true };
  }

  const commitResult = await commitColorCycleLayerStroke({
    layer: args.activeLayer,
    drawingCanvas: args.drawingCanvas,
    brushSettings: args.brushSettings,
    project: args.project,
    strokeBoundingBox: args.strokeBoundingBox,
    strokeCapturePadding: args.strokeCapturePadding,
    roiPadding: args.roiPadding,
    enableCaptureRoi: args.enableCaptureRoi,
  }, {
    getBrushForLayer: deps.getBrushForLayer,
    bindBrushToCanvas: deps.bindBrushToCanvas,
    markLayerHasContent: deps.markLayerHasContent,
    perfMark: deps.perfMark,
    perfMeasure: deps.perfMeasure,
    startFinalizeVisibleTimer: deps.startFinalizeVisibleTimer,
    endFinalizeVisibleTimer: deps.endFinalizeVisibleTimer,
    dispatchFrameUpdate: deps.dispatchFrameUpdate,
  });

  return {
    handled: true,
    skipped: false,
    brushForCleanup: commitResult.brushForCleanup,
    deferredLayerCanvas: commitResult.deferredLayerCanvas,
    strokeCaptureRoi: commitResult.strokeCaptureRoi,
  };
};
