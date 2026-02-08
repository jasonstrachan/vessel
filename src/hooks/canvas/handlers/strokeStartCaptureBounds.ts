import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { createBoundingBox } from '@/hooks/canvas/utils/captureRegions';
import { computeStrokeCapturePadding } from '@/hooks/canvas/utils/strokeCapturePadding';

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
  if (currentTool === 'brush') {
    strokeBoundingBoxRef.current = createBoundingBox(worldPos);
    const activeCustomBrush = resolveCustomBrushData(currentState) ?? resamplerBrushDataRef.current;
    strokeCapturePaddingRef.current = computeStrokeCapturePadding(
      currentState.tools.brushSettings,
      activeCustomBrush ?? null
    );
    return;
  }

  strokeBoundingBoxRef.current = null;
  strokeCapturePaddingRef.current = 0;
};
