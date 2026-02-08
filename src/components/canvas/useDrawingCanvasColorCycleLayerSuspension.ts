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
    const keepsPlaybackActive =
      activeLayer?.layerType === 'color-cycle' || activeLayer?.layerType === 'sequential';
    const st = useAppStore.getState();

    if (!keepsPlaybackActive && !suspendedForNonCCActiveLayerRef.current) {
      st.suspendColorCycle('active-layer-not-cc');
      suspendedForNonCCActiveLayerRef.current = true;
      return;
    }

    if (keepsPlaybackActive && suspendedForNonCCActiveLayerRef.current) {
      st.resumeColorCycle('active-layer-not-cc');
      suspendedForNonCCActiveLayerRef.current = false;
    }
  }, [activeLayerId, layers, suspendedForNonCCActiveLayerRef]);
};
