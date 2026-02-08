import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
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
    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    const st = useAppStore.getState();

    if (!isColorCycleLayer && !suspendedForNonCCActiveLayerRef.current) {
      st.suspendColorCycle('active-layer-not-cc');
      suspendedForNonCCActiveLayerRef.current = true;
      return;
    }

    if (isColorCycleLayer && suspendedForNonCCActiveLayerRef.current) {
      st.resumeColorCycle('active-layer-not-cc');
      suspendedForNonCCActiveLayerRef.current = false;
    }
  }, [activeLayerId, layers, suspendedForNonCCActiveLayerRef]);
};
