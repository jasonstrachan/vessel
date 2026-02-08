import type React from 'react';
import type { AppState } from '@/stores/useAppStore';

const POLYGON_GRADIENT_IDLE_STATE: Partial<AppState['polygonGradientState']> = {
  drawingState: 'idle',
  points: [],
  previewPath: undefined,
  vertices: undefined,
  fillColor: undefined,
  mode: undefined,
  tempRotation: undefined,
  tempSpacing: undefined,
  tempMaxSteps: undefined,
  tempOrientation: undefined,
  tempNoiseStrength: undefined,
  tempSize: undefined,
  adjustmentStartPos: undefined,
  rotationReferenceAngle: undefined,
  rotationInitialRotation: undefined,
  sizeReferenceDistance: undefined,
  sizeInitialSize: undefined,
  spacingReferenceDistance: undefined,
  spacingReferenceSpacing: undefined,
  flowRandomSeed: undefined,
  gpuJobId: undefined,
};

export const resetPolygonGradientState = (
  setPolygonGradientState: AppState['setPolygonGradientState']
): void => {
  setPolygonGradientState(POLYGON_GRADIENT_IDLE_STATE);
};

export const createResetPolygonGradientStateDispatcher = (
  storeRef: React.MutableRefObject<AppState>
): (() => void) => () => {
  resetPolygonGradientState(storeRef.current.setPolygonGradientState);
};
