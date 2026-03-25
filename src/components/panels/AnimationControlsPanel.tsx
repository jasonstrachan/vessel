'use client';

import React from 'react';
import {
  useAppStore,
  selectEffectiveColorCyclePlaying,
  selectColorCycleSuspendDepth,
  selectPlaybackSpeedScale,
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
  selectSequentialRecordState,
} from '@/stores/useAppStore';
import {
  CC_LAYER_SPEED_SCALE_STEP,
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';
import { sanitizeBrushColorCycleSpeed } from '@/utils/colorCycleSpeed';
import { resolveLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';
import SequentialControlsModule from '@/components/panels/SequentialControlsModule';
import { toggleGlobalColorCyclePlayback } from '@/utils/colorCyclePlayback';

const AnimationControlsPanel: React.FC = () => {
  const forceResumeColorCycle = useAppStore(state => state.forceResumeColorCycle);
  const setRecordFPS = useAppStore((state) => state.setRecordFPS);
  const setRecordFrameCount = useAppStore((state) => state.setRecordFrameCount);
  const setTimeSmear = useAppStore((state) => state.setTimeSmear);
  const setPlaybackSpeedScale = useAppStore((state) => state.setPlaybackSpeedScale);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const playbackSpeedScale = useAppStore(selectPlaybackSpeedScale);
  const activeColorCycleLayer = useAppStore((state) => {
    const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
    if (!activeLayer || activeLayer.layerType !== 'color-cycle' || activeLayer.colorCycleData?.mode === 'recolor') {
      return null;
    }
    return activeLayer;
  });
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const suspendDepth = useAppStore(selectColorCycleSuspendDepth);
  const sequentialPlaybackActive = useAppStore(selectSequentialPlaybackActive);
  const sequentialCaptureActive = useAppStore(selectSequentialCaptureActive);
  const sequentialRecord = useAppStore(selectSequentialRecordState);
  const sequentialPlaybackRunning = sequentialPlaybackActive && suspendDepth === 0;

  const isPlaybackRunning =
    effectivePlaying || sequentialPlaybackRunning || sequentialCaptureActive;

  const handleTogglePlayback = React.useCallback(() => {
    if (isPlaybackRunning) {
      void toggleGlobalColorCyclePlayback(false, 'toolbar');
      return;
    }
    if (suspendDepth > 0) {
      forceResumeColorCycle('toolbar');
    }
    void toggleGlobalColorCyclePlayback(true, 'toolbar');
  }, [isPlaybackRunning, forceResumeColorCycle, suspendDepth]);

  const handleFpsChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) {
        setRecordFPS(value);
      }
    },
    [setRecordFPS]
  );

  const handleFramesChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) {
        setRecordFrameCount(value);
      }
    },
    [setRecordFrameCount]
  );

  const handleTimeSmearChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) {
        setTimeSmear(value);
      }
    },
    [setTimeSmear]
  );

  const handlePlaybackSpeedScaleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) {
        return;
      }
      const next = Math.max(MIN_CC_LAYER_SPEED_SCALE, Math.min(MAX_CC_LAYER_SPEED_SCALE, value));
      setPlaybackSpeedScale(next);
    },
    [setPlaybackSpeedScale]
  );
  const handleCcBaseSpeedChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!activeColorCycleLayer) {
        return;
      }
      const next = sanitizeBrushColorCycleSpeed(
        Number(event.target.value),
        resolveLayerColorCycleBaseSpeed(activeColorCycleLayer.colorCycleData) ?? 1
      );
      updateLayer(activeColorCycleLayer.id, {
        colorCycleData: {
          ...activeColorCycleLayer.colorCycleData,
          layerBaseSpeedCps: next,
        },
      });
    },
    [activeColorCycleLayer, updateLayer]
  );
  const playbackScaleLabel = playbackSpeedScale < 0.1
    ? `${playbackSpeedScale.toFixed(3)}x`
    : `${playbackSpeedScale.toFixed(2)}x`;
  const activeCcBaseSpeed = activeColorCycleLayer
    ? Math.max(
        CC_LAYER_SPEED_SCALE_STEP,
        Math.min(
          MAX_BRUSH_COLOR_CYCLE_SPEED,
          resolveLayerColorCycleBaseSpeed(activeColorCycleLayer.colorCycleData) ?? 1
        )
      )
    : null;

  const controlsDisabled = sequentialCaptureActive;
  const currentFrameDisplay = Math.min(
    sequentialRecord.frameCount,
    Math.max(1, Math.round(sequentialRecord.currentFrame) + 1)
  );

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040]">
      <div className="px-4 py-3 space-y-3">
        <SequentialControlsModule
          controlsDisabled={controlsDisabled}
          activeCcBaseSpeed={activeCcBaseSpeed}
          currentFrameDisplay={currentFrameDisplay}
          frameCount={sequentialRecord.frameCount}
          fps={sequentialRecord.fps}
          isCaptureActive={sequentialCaptureActive}
          playbackSpeedScale={playbackSpeedScale}
          playbackScaleLabel={playbackScaleLabel}
          timeSmear={sequentialRecord.timeSmear}
          onCcBaseSpeedChange={handleCcBaseSpeedChange}
          onFpsChange={handleFpsChange}
          onFramesChange={handleFramesChange}
          onPlaybackSpeedScaleChange={handlePlaybackSpeedScaleChange}
          onTimeSmearChange={handleTimeSmearChange}
        />

        <button
          onClick={handleTogglePlayback}
          className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px]" aria-hidden="true">{isPlaybackRunning ? '⏸' : '▶'}</span>
          <span className="ml-1 text-[10px]">{isPlaybackRunning ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(AnimationControlsPanel);
