import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { createBoundingBox } from '@/hooks/canvas/utils/captureRegions';
import { computeStrokeCapturePadding } from '@/hooks/canvas/utils/strokeCapturePadding';

const resolveCaptureSettings = (
  state: AppState,
  tool: AppState['tools']['currentTool']
): AppState['tools']['brushSettings'] => {
  if (tool !== 'eraser') {
    return state.tools.brushSettings;
  }
  const brushSize = state.tools.brushSettings.size ?? state.globalBrushSize;
  const eraserSettings = state.tools.eraserSettings;
  const effectiveSize =
    eraserSettings.linkSizeToBrush === false
      ? eraserSettings.size ?? brushSize
      : brushSize;
  return {
    ...eraserSettings,
    size: effectiveSize,
  };
};

export const initializeStrokeStartCaptureBounds = ({
  currentState,
  currentTool,
  worldPos,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  resolveCustomBrushData,
  resamplerBrushDataRef,
}: {
  currentState: AppState;
  currentTool: AppState['tools']['currentTool'];
  worldPos: { x: number; y: number };
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  resolveCustomBrushData: (state: AppState) => CustomBrushStrokeData | undefined;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
}): void => {
  if (currentTool === 'brush' || currentTool === 'eraser') {
    strokeBoundingBoxRef.current = createBoundingBox(worldPos);
    const activeCustomBrush = resolveCustomBrushData(currentState) ?? resamplerBrushDataRef.current;
    const captureSettings = resolveCaptureSettings(currentState, currentTool);
    strokeCapturePaddingRef.current = computeStrokeCapturePadding(
      captureSettings,
      activeCustomBrush ?? null
    );
    return;
  }

  strokeBoundingBoxRef.current = null;
  strokeCapturePaddingRef.current = 0;
};
