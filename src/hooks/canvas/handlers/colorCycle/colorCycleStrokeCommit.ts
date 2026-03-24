import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
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
  captureRoi?: CaptureRegion;
  strokeCapturePadding: number;
  roiPadding: number;
  enableCaptureRoi: boolean;
};

export type ColorCycleStrokeCommitDeps = {
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  bindBrushToCanvas: (brush: ColorCycleBrushImplementation, canvas: HTMLCanvasElement) => void;
  markLayerHasContent: (layerId: string) => void;
  clearEraseMaskInRegion: (layerId: string, roi: CaptureRegion) => void;
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

export const createColorCycleStrokeCommitDeps = ({
  storeRef,
  getBrushForLayer,
  bindBrushToCanvas,
  perfMark,
  perfMeasure,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  dispatchColorCycleFrameUpdate,
  ccLog,
}: {
  storeRef: React.MutableRefObject<AppState>;
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  bindBrushToCanvas: (brush: ColorCycleBrushImplementation, canvas: HTMLCanvasElement) => void;
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  startFinalizeVisibleTimer: () => void;
  endFinalizeVisibleTimer: () => void;
  dispatchColorCycleFrameUpdate: () => void;
  ccLog: (label: string, payload: Record<string, unknown>) => void;
}): ColorCycleStrokeCommitDeps => ({
  getBrushForLayer,
  bindBrushToCanvas,
  markLayerHasContent: (layerId) => markColorCycleLayerHasContent(storeRef, layerId),
  clearEraseMaskInRegion: (layerId, roi) => clearColorCycleEraseMaskInRegion(storeRef, layerId, roi),
  perfMark,
  perfMeasure,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  dispatchFrameUpdate: (layerId) => {
    dispatchColorCycleFrameUpdate();
    ccLog('stroke: frameUpdate dispatched', { layerId: layerId.slice(-6) });
  },
});

export const markColorCycleLayerHasContent = (
  storeRef: React.MutableRefObject<AppState>,
  layerId: string
): void => {
  try {
    const st = storeRef.current;
    const freshLayer = st.layers.find((l) => l.id === layerId);
    if (freshLayer?.colorCycleData) {
      st.updateLayer(layerId, {
        colorCycleData: {
          ...freshLayer.colorCycleData,
          hasContent: true,
        }
      });
    }
  } catch {}
};

const clampCaptureRegionToBounds = (
  roi: CaptureRegion,
  bounds: { width: number; height: number }
): CaptureRegion | null => {
  const maxWidth = Math.max(1, Math.floor(bounds.width));
  const maxHeight = Math.max(1, Math.floor(bounds.height));
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const right = Math.min(maxWidth, Math.ceil(roi.x + roi.width));
  const bottom = Math.min(maxHeight, Math.ceil(roi.y + roi.height));
  if (right <= x || bottom <= y) {
    return null;
  }
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};

export const clearColorCycleEraseMaskInRegion = (
  storeRef: React.MutableRefObject<AppState>,
  layerId: string,
  roi: CaptureRegion
): void => {
  try {
    const st = storeRef.current;
    const freshLayer = st.layers.find((layer) => layer.id === layerId);
    const eraseMask = freshLayer?.colorCycleData?.eraseMask;
    const eraseMaskCtx = eraseMask?.getContext('2d', { willReadFrequently: true });
    if (!eraseMask || !eraseMaskCtx) {
      return;
    }
    const clamped = clampCaptureRegionToBounds(roi, {
      width: eraseMask.width,
      height: eraseMask.height,
    });
    if (!clamped) {
      return;
    }
    eraseMaskCtx.clearRect(clamped.x, clamped.y, clamped.width, clamped.height);
    const nextVersion = (freshLayer?.colorCycleData?.eraseMaskVersion ?? 0) + 1;
    st.updateLayer(
      layerId,
      {
        colorCycleData: {
          eraseMaskVersion: nextVersion,
        },
      },
      { skipColorCycleSync: true }
    );
  } catch {}
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
    captureRoi: args.captureRoi,
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

  const resolvedStrokeCaptureRoi = commitResult.strokeCaptureRoi ?? args.captureRoi;
  if (resolvedStrokeCaptureRoi) {
    deps.clearEraseMaskInRegion(args.activeLayer.id, resolvedStrokeCaptureRoi);
  }

  return {
    handled: true,
    skipped: false,
    brushForCleanup: commitResult.brushForCleanup,
    deferredLayerCanvas: commitResult.deferredLayerCanvas,
    strokeCaptureRoi: resolvedStrokeCaptureRoi,
  };
};
