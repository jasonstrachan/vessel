import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, Layer } from '@/types';
import type { BoundingBox, CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import { getMaskManager } from '@/layers/MaskManager';
import {
  commitColorCycleLayerStroke,
  type ManagedColorCycleBrush,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import type { ColorCyclePaintMask } from '@/lib/colorCycle/document';
import type { ColorCycleSurfaceBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';

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
  transparencyLockPaintMask?: Uint8Array | null;
};

export type ColorCycleStrokeCommitDeps = {
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  bindBrushToCanvas: (brush: ColorCycleSurfaceBrush, canvas: HTMLCanvasElement) => void;
  markLayerHasContent: (layerId: string) => void;
  clearEraseMaskInRegion: (
    layerId: string,
    roi: CaptureRegion,
    options?: ClearColorCycleEraseMaskOptions
  ) => void;
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
  bindBrushToCanvas: (brush: ColorCycleSurfaceBrush, canvas: HTMLCanvasElement) => void;
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
  clearEraseMaskInRegion: (layerId, roi, options) => clearColorCycleEraseMaskInRegion(storeRef, layerId, roi, options),
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

export type ColorCycleEraseMaskAlphaSource = HTMLCanvasElement | OffscreenCanvas;

export type ClearColorCycleEraseMaskOptions = {
  alphaSource?: ColorCycleEraseMaskAlphaSource | null;
  alphaSourceBounds?: CaptureRegion | null;
  paintMask?: ColorCyclePaintMask | null;
};

const getSourceSize = (
  source: ColorCycleEraseMaskAlphaSource
): { width: number; height: number } => ({
  width: Math.max(0, Math.floor(source.width)),
  height: Math.max(0, Math.floor(source.height)),
});

const clearEraseMaskWithAlphaSource = (
  eraseMaskCtx: CanvasRenderingContext2D,
  clamped: CaptureRegion,
  options?: ClearColorCycleEraseMaskOptions
): boolean => {
  const alphaSource = options?.alphaSource;
  if (!alphaSource) {
    return false;
  }

  const sourceCtx = alphaSource.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx || !('getImageData' in sourceCtx)) {
    return false;
  }

  const sourceSize = getSourceSize(alphaSource);
  const sourceBounds = options?.alphaSourceBounds
    ? clampCaptureRegionToBounds(options.alphaSourceBounds, sourceSize)
    : { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
  if (!sourceBounds) {
    return false;
  }

  const sourceRight = sourceBounds.x + sourceBounds.width;
  const sourceBottom = sourceBounds.y + sourceBounds.height;
  const targetRight = clamped.x + clamped.width;
  const targetBottom = clamped.y + clamped.height;
  const overlapX = Math.max(clamped.x, sourceBounds.x);
  const overlapY = Math.max(clamped.y, sourceBounds.y);
  const overlapRight = Math.min(targetRight, sourceRight);
  const overlapBottom = Math.min(targetBottom, sourceBottom);
  if (overlapRight <= overlapX || overlapBottom <= overlapY) {
    return false;
  }

  const overlapWidth = overlapRight - overlapX;
  const overlapHeight = overlapBottom - overlapY;

  try {
    const sourceImageData = sourceCtx.getImageData(
      overlapX - sourceBounds.x,
      overlapY - sourceBounds.y,
      overlapWidth,
      overlapHeight
    );
    const eraseImageData = eraseMaskCtx.getImageData(overlapX, overlapY, overlapWidth, overlapHeight);
    let changed = false;
    for (let index = 3; index < sourceImageData.data.length; index += 4) {
      if (sourceImageData.data[index] === 0) {
        continue;
      }
      const redIndex = index - 3;
      if (
        eraseImageData.data[redIndex] !== 0 ||
        eraseImageData.data[redIndex + 1] !== 0 ||
        eraseImageData.data[redIndex + 2] !== 0 ||
        eraseImageData.data[index] !== 0
      ) {
        eraseImageData.data[redIndex] = 0;
        eraseImageData.data[redIndex + 1] = 0;
        eraseImageData.data[redIndex + 2] = 0;
        eraseImageData.data[index] = 0;
        changed = true;
      }
    }
    if (!changed) {
      return true;
    }
    eraseMaskCtx.putImageData(eraseImageData, overlapX, overlapY);
  } catch {
    return false;
  }
  return true;
};

const clearEraseMaskWithPaintMask = (
  eraseMaskCtx: CanvasRenderingContext2D,
  clamped: CaptureRegion,
  paintMask: ColorCyclePaintMask | null | undefined
): boolean => {
  if (!paintMask || paintMask.width <= 0 || paintMask.height <= 0) {
    return false;
  }

  const maskBounds = paintMask.bounds;
  const maskRight = maskBounds.x + maskBounds.width;
  const maskBottom = maskBounds.y + maskBounds.height;
  const targetRight = clamped.x + clamped.width;
  const targetBottom = clamped.y + clamped.height;
  const overlapX = Math.max(clamped.x, maskBounds.x);
  const overlapY = Math.max(clamped.y, maskBounds.y);
  const overlapRight = Math.min(targetRight, maskRight);
  const overlapBottom = Math.min(targetBottom, maskBottom);
  if (overlapRight <= overlapX || overlapBottom <= overlapY) {
    return false;
  }

  const overlapWidth = overlapRight - overlapX;
  const overlapHeight = overlapBottom - overlapY;
  try {
    const eraseImageData = eraseMaskCtx.getImageData(overlapX, overlapY, overlapWidth, overlapHeight);
    let changed = false;
    for (let row = 0; row < overlapHeight; row += 1) {
      const maskRowOffset = (overlapY - maskBounds.y + row) * paintMask.width;
      const eraseRowOffset = row * overlapWidth * 4;
      for (let col = 0; col < overlapWidth; col += 1) {
        const maskIndex = maskRowOffset + (overlapX - maskBounds.x + col);
        if (paintMask.data[maskIndex] === 0) {
          continue;
        }
        const eraseIndex = eraseRowOffset + col * 4;
        if (
          eraseImageData.data[eraseIndex] !== 0 ||
          eraseImageData.data[eraseIndex + 1] !== 0 ||
          eraseImageData.data[eraseIndex + 2] !== 0 ||
          eraseImageData.data[eraseIndex + 3] !== 0
        ) {
          eraseImageData.data[eraseIndex] = 0;
          eraseImageData.data[eraseIndex + 1] = 0;
          eraseImageData.data[eraseIndex + 2] = 0;
          eraseImageData.data[eraseIndex + 3] = 0;
          changed = true;
        }
      }
    }
    if (changed) {
      eraseMaskCtx.putImageData(eraseImageData, overlapX, overlapY);
    }
  } catch {
    return false;
  }
  return true;
};

export const clearColorCycleEraseMaskInRegion = (
  storeRef: React.MutableRefObject<AppState>,
  layerId: string,
  roi: CaptureRegion,
  options?: ClearColorCycleEraseMaskOptions
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
    const clearedWithMask = clearEraseMaskWithPaintMask(eraseMaskCtx, clamped, options?.paintMask);
    const clearedWithAlpha = clearedWithMask
      ? true
      : clearEraseMaskWithAlphaSource(eraseMaskCtx, clamped, options);
    if (!clearedWithAlpha) {
      eraseMaskCtx.clearRect(clamped.x, clamped.y, clamped.width, clamped.height);
    }
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
  } catch {
  } finally {
    try {
      getMaskManager().clearPendingHealMask(layerId);
    } catch {}
  }
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

  const colorCycleData = args.activeLayer.colorCycleData;
  const shouldHealEraseMask = Boolean(
    colorCycleData?.eraseMask &&
    ((colorCycleData.eraseMaskVersion ?? 0) > 0 || colorCycleData.eraseMaskImageData)
  );

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
    shouldBuildEraseMask: shouldHealEraseMask,
    transparencyLockPaintMask: args.transparencyLockPaintMask,
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
  if (resolvedStrokeCaptureRoi && shouldHealEraseMask) {
    deps.clearEraseMaskInRegion(args.activeLayer.id, resolvedStrokeCaptureRoi, {
      paintMask: commitResult.eraseMaskPaintMask,
    });
  }

  return {
    handled: true,
    skipped: false,
    brushForCleanup: commitResult.brushForCleanup,
    deferredLayerCanvas: commitResult.deferredLayerCanvas,
    strokeCaptureRoi: resolvedStrokeCaptureRoi,
  };
};
