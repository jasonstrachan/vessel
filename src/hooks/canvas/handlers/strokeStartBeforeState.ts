import type React from 'react';
import type { Layer } from '@/types';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { isColorCycleLayerWithData } from '@/hooks/canvas/utils/layerGuards';

export const captureStrokeStartBeforeColorState = ({
  activeLayerForCapture,
  captureColorCycleBrushState,
  strokeBeforeColorStateRef,
  debugVerbose,
}: {
  activeLayerForCapture: Layer | undefined;
  captureColorCycleBrushState: (layerId: string) => ColorCycleSerializedState | null;
  strokeBeforeColorStateRef: React.MutableRefObject<ColorCycleSerializedState | null>;
  debugVerbose: (...args: unknown[]) => void;
}): void => {
  if (activeLayerForCapture && isColorCycleLayerWithData(activeLayerForCapture)) {
    const beforeState = captureColorCycleBrushState(activeLayerForCapture.id);
    debugVerbose(
      '[cc-before-capture] layerId:',
      activeLayerForCapture.id,
      'serializedCounter:',
      beforeState?.layers?.[0]?.strokeData?.strokeCounter ?? -1
    );
    strokeBeforeColorStateRef.current = beforeState;
    return;
  }

  strokeBeforeColorStateRef.current = null;
};
