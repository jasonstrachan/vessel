import type React from 'react';
import type { Layer } from '@/types';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { isColorCycleLayerWithData } from '@/hooks/canvas/utils/layerGuards';

type DebugBrush = {
  layerStrokes?: Map<string, { strokeCounter?: number }>;
  strokeCounter?: number;
};

export const captureStrokeStartBeforeColorState = ({
  activeLayerForCapture,
  captureColorCycleBrushState,
  getBrushForLayer,
  strokeBeforeColorStateRef,
  debugVerbose,
}: {
  activeLayerForCapture: Layer | undefined;
  captureColorCycleBrushState: (layerId: string) => ColorCycleSerializedState | null;
  getBrushForLayer: (layerId: string) => DebugBrush | undefined;
  strokeBeforeColorStateRef: React.MutableRefObject<ColorCycleSerializedState | null>;
  debugVerbose: (...args: unknown[]) => void;
}): void => {
  if (activeLayerForCapture && isColorCycleLayerWithData(activeLayerForCapture)) {
    const beforeState = captureColorCycleBrushState(activeLayerForCapture.id);
    const brush = getBrushForLayer(activeLayerForCapture.id);
    const layerStrokeData = brush?.layerStrokes?.get(activeLayerForCapture.id);
    debugVerbose(
      '[cc-before-capture] brushCounter:',
      brush?.strokeCounter ?? -1,
      'layerDataCounter:',
      layerStrokeData?.strokeCounter ?? -1,
      'serializedCounter:',
      beforeState?.layers?.[0]?.strokeData?.strokeCounter ?? -1
    );
    strokeBeforeColorStateRef.current = beforeState;
    return;
  }

  strokeBeforeColorStateRef.current = null;
};
