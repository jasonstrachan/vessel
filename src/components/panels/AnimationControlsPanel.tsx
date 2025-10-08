'use client';

import React from 'react';
import ProgressSlider from '@/components/ui/ProgressSlider';
import { useAppStore } from '@/stores/useAppStore';
import { toggleGlobalColorCyclePlayback } from '@/utils/colorCyclePlayback';

const AnimationControlsPanel: React.FC = () => {
  const layers = useAppStore(state => state.layers);
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const selectedLayerIds = useAppStore(state => state.selectedLayerIds);
  const globalColorCycleSpeed = useAppStore(state => state.tools.brushSettings.colorCycleSpeed || 0.1);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const updateLayer = useAppStore(state => state.updateLayer);

  const brushAnimating = React.useMemo(
    () => layers.some(layer => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor' && !!layer.colorCycleData?.isAnimating),
    [layers]
  );

  const [externalIsPlaying, setExternalIsPlaying] = React.useState(false);
  const isAnimating = brushAnimating || externalIsPlaying;

  React.useEffect(() => {
    const handler = (event: Event) => {
      try {
        const customEvent = event as CustomEvent<{ isPlaying: boolean }>;
        if (typeof customEvent.detail?.isPlaying === 'boolean') {
          setExternalIsPlaying(customEvent.detail.isPlaying);
        }
      } catch {}
    };

    window.addEventListener('colorCycleAnimationState', handler as EventListener);
    return () => {
      window.removeEventListener('colorCycleAnimationState', handler as EventListener);
    };
  }, []);

  const activeLayer = React.useMemo(
    () => layers.find(layer => layer.id === activeLayerId) || null,
    [layers, activeLayerId]
  );

  const isCCBrushLayer = activeLayer?.layerType === 'color-cycle' && activeLayer.colorCycleData?.mode !== 'recolor';
  const colorCycleSpeedValue = isCCBrushLayer && typeof activeLayer?.colorCycleData?.brushSpeed === 'number'
    ? activeLayer.colorCycleData.brushSpeed
    : globalColorCycleSpeed;

  const handleSpeedChange = React.useCallback((value: number) => {
    const clampedValue = Math.max(0.02, Math.min(1.0, value));
    setBrushSettings({ colorCycleSpeed: clampedValue });

    if (!activeLayerId) {
      return;
    }

    const targetLayerIds = selectedLayerIds.length > 1 && selectedLayerIds.includes(activeLayerId)
      ? selectedLayerIds
      : [activeLayerId];

    targetLayerIds.forEach(layerId => {
      const targetLayer = layers.find(layer => layer.id === layerId);
      if (targetLayer?.layerType === 'color-cycle' && targetLayer.colorCycleData) {
        if (targetLayer.colorCycleData.brushSpeed !== clampedValue) {
          updateLayer(layerId, {
            colorCycleData: {
              ...targetLayer.colorCycleData,
              brushSpeed: clampedValue
            }
          });
        }
      }
    });
  }, [activeLayerId, layers, selectedLayerIds, setBrushSettings, updateLayer]);

  const handleTogglePlayback = React.useCallback(async () => {
    const nextState = !isAnimating;
    await toggleGlobalColorCyclePlayback(nextState);
  }, [isAnimating]);

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040]">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>Speed</span>
          <ProgressSlider
            value={colorCycleSpeedValue}
            min={0.02}
            max={1.0}
            step={0.01}
            onChange={handleSpeedChange}
            aria-label="Color Cycle Speed"
            className="flex-1"
          />
        </div>

        <button
          onClick={handleTogglePlayback}
          className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px]" aria-hidden="true">{isAnimating ? '⏸' : '▶'}</span>
          <span className="ml-1 text-[10px]">{isAnimating ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(AnimationControlsPanel);
