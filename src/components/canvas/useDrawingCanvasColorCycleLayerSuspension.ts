import { useEffect } from 'react';
import type { Layer } from '@/types';

interface UseDrawingCanvasColorCycleLayerSuspensionOptions {
  activeLayerId: string | null;
  layers: Layer[];
  suspendedForNonCCActiveLayerRef: React.MutableRefObject<boolean>;
}

export const useDrawingCanvasColorCycleLayerSuspension = ({
  activeLayerId,
  layers,
  suspendedForNonCCActiveLayerRef,
}: UseDrawingCanvasColorCycleLayerSuspensionOptions) => {
  useEffect(() => {
    void activeLayerId;
    void layers;
    // Playback should not depend on which layer is selected.
    // Actual interaction-driven pauses are handled by dedicated pan/shape/brush guards.
    if (suspendedForNonCCActiveLayerRef.current) {
      suspendedForNonCCActiveLayerRef.current = false;
    }
  }, [activeLayerId, layers, suspendedForNonCCActiveLayerRef]);
};
