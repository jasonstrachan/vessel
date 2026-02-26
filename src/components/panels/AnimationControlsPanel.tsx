'use client';

import React from 'react';
import {
  useAppStore,
  selectEffectiveColorCyclePlaying,
  selectColorCycleSuspendDepth,
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
  selectSequentialRecordState,
} from '@/stores/useAppStore';
import {
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';
import SequentialControlsModule from '@/components/panels/SequentialControlsModule';

const AnimationControlsPanel: React.FC = () => {
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore(state => state.forceResumeColorCycle);
  const setRecordFPS = useAppStore((state) => state.setRecordFPS);
  const setRecordFrameCount = useAppStore((state) => state.setRecordFrameCount);
  const setTimeSmear = useAppStore((state) => state.setTimeSmear);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const ccLayerSpeedScale = useAppStore(
    (state) => state.tools.brushSettings.colorCycleLayerSpeedScale ?? 1
  );
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
      pauseColorCycle('toolbar');
      return;
    }
    playColorCycle('toolbar');
    if (suspendDepth > 0) {
      forceResumeColorCycle('toolbar');
    }
  }, [isPlaybackRunning, pauseColorCycle, playColorCycle, forceResumeColorCycle, suspendDepth]);

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

  const handleCcLayerSpeedScaleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) {
        return;
      }
      const next = Math.max(MIN_CC_LAYER_SPEED_SCALE, Math.min(MAX_CC_LAYER_SPEED_SCALE, value));
      setBrushSettings({ colorCycleLayerSpeedScale: next });
    },
    [setBrushSettings]
  );
  const layerSpeedLabel = ccLayerSpeedScale < 0.1
    ? `${ccLayerSpeedScale.toFixed(3)}x`
    : `${ccLayerSpeedScale.toFixed(2)}x`;

  const controlsDisabled = sequentialCaptureActive;
  const currentFrameDisplay = Math.min(
    sequentialRecord.frameCount,
    Math.max(1, Math.round(sequentialRecord.currentFrame) + 1)
  );

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040]">
      <div className="px-4 py-3 space-y-3">
        <SequentialControlsModule
          ccLayerSpeedScale={ccLayerSpeedScale}
          controlsDisabled={controlsDisabled}
          currentFrameDisplay={currentFrameDisplay}
          frameCount={sequentialRecord.frameCount}
          fps={sequentialRecord.fps}
          isCaptureActive={sequentialCaptureActive}
          layerSpeedLabel={layerSpeedLabel}
          timeSmear={sequentialRecord.timeSmear}
          onCcLayerSpeedScaleChange={handleCcLayerSpeedScaleChange}
          onFpsChange={handleFpsChange}
          onFramesChange={handleFramesChange}
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
