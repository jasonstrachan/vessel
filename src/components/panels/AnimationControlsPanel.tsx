'use client';

import React from 'react';
import ProgressSlider from '@/components/ui/ProgressSlider';
import ButtonGroup, { type ButtonGroupOption } from '@/components/ui/ButtonGroup';
import {
  useAppStore,
  selectEffectiveColorCyclePlaying,
  selectColorCycleSuspendDepth,
} from '@/stores/useAppStore';
import {
  selectLayers,
  selectActiveLayerId,
  selectSelectedLayerIds,
} from '@/stores/selectors/layersSelectors';
import { selectBrushSettings } from '@/stores/selectors/toolsSelectors';
import {
  COLOR_CYCLE_SPEED_STEP,
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MIN_BRUSH_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';

const FLOW_DIRECTION_BUTTONS: ButtonGroupOption[] = [
  { label: '<--', value: 'reverse' },
  { label: '-->', value: 'forward' },
  { label: '<-->', value: 'pingpong' }
];

const AnimationControlsPanel: React.FC = () => {
  const layers = useAppStore(selectLayers);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const selectedLayerIds = useAppStore(selectSelectedLayerIds);
  const brushSettings = useAppStore(selectBrushSettings);
  const globalColorCycleSpeed = brushSettings.colorCycleSpeed || 0.1;
  const globalColorCycleFlowMode = brushSettings.colorCycleFlowMode ?? 'reverse';
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore(state => state.forceResumeColorCycle);
  const colorCycleRuntimeHandlers = useAppStore(state => state.colorCycleRuntimeHandlers);
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const suspendDepth = useAppStore(selectColorCycleSuspendDepth);

  const activeLayer = React.useMemo(
    () => layers.find(layer => layer.id === activeLayerId) || null,
    [layers, activeLayerId]
  );

  const isCCBrushLayer = activeLayer?.layerType === 'color-cycle' && activeLayer.colorCycleData?.mode !== 'recolor';
  const colorCycleSpeedValue = isCCBrushLayer && typeof activeLayer?.colorCycleData?.brushSpeed === 'number'
    ? activeLayer.colorCycleData.brushSpeed
    : globalColorCycleSpeed;
  const colorCycleFlowModeValue = isCCBrushLayer && activeLayer?.colorCycleData?.flowMode
    ? activeLayer.colorCycleData.flowMode
    : globalColorCycleFlowMode;

  const handleSpeedChange = React.useCallback((value: number) => {
    const clampedValue = Math.max(
      MIN_BRUSH_COLOR_CYCLE_SPEED,
      Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, value)
    );
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

  const handleTogglePlayback = React.useCallback(() => {
    if (effectivePlaying) {
      pauseColorCycle('toolbar');
      return;
    }
    playColorCycle('toolbar');
    if (suspendDepth > 0) {
      forceResumeColorCycle('toolbar');
    }
  }, [effectivePlaying, pauseColorCycle, playColorCycle, forceResumeColorCycle, suspendDepth]);

  const handleFlowModeChange = React.useCallback((value: string) => {
    const nextMode: 'forward' | 'reverse' | 'pingpong' =
      value === 'reverse' || value === 'pingpong' ? value : 'forward';

    setBrushSettings({ colorCycleFlowMode: nextMode });

    if (activeLayerId) {
      const targetLayerIds = selectedLayerIds.length > 1 && selectedLayerIds.includes(activeLayerId)
        ? selectedLayerIds
        : [activeLayerId];

      targetLayerIds.forEach(layerId => {
        const targetLayer = layers.find(layer => layer.id === layerId);
        if (targetLayer?.layerType === 'color-cycle' && targetLayer.colorCycleData) {
          if (targetLayer.colorCycleData.flowMode !== nextMode) {
            updateLayer(layerId, {
              colorCycleData: {
                ...targetLayer.colorCycleData,
                flowMode: nextMode
              }
            });
          }
        }
      });
    }

    if (colorCycleRuntimeHandlers.setFlowMode) {
      colorCycleRuntimeHandlers.setFlowMode(nextMode);
    } else if (colorCycleRuntimeHandlers.setFlowDirection) {
      colorCycleRuntimeHandlers.setFlowDirection(nextMode === 'reverse' ? 'backward' : 'forward');
    }
  }, [activeLayerId, colorCycleRuntimeHandlers, layers, selectedLayerIds, setBrushSettings, updateLayer]);

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040]">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[#D9D9D9] w-12" style={{ fontSize: '14px' }}>Speed</span>
          <ProgressSlider
            value={colorCycleSpeedValue}
            min={MIN_BRUSH_COLOR_CYCLE_SPEED}
            max={MAX_BRUSH_COLOR_CYCLE_SPEED}
            step={COLOR_CYCLE_SPEED_STEP}
            onChange={handleSpeedChange}
            aria-label="Color Cycle Speed"
            className="flex-1"
          />
        </div>

        <div className="flex items-center gap-2" dir="ltr">
          <span className="text-[#D9D9D9] w-12" style={{ fontSize: '14px' }}>Flow</span>
          <ButtonGroup
            options={FLOW_DIRECTION_BUTTONS}
            value={colorCycleFlowModeValue}
            onChange={handleFlowModeChange}
            className="flex-1 [&>button]:flex-1"
            size="sm"
          />
        </div>

        <button
          onClick={handleTogglePlayback}
          className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px]" aria-hidden="true">{effectivePlaying ? '⏸' : '▶'}</span>
          <span className="ml-1 text-[10px]">{effectivePlaying ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(AnimationControlsPanel);
