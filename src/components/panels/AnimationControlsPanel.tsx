'use client';

import React from 'react';
import {
  useAppStore,
  selectPlaybackSpeedScale,
  selectPlaybackToggleUi,
  selectSequentialCaptureActive,
  selectSequentialRecordState,
} from '@/stores/useAppStore';
import {
  DEFAULT_CC_LAYER_SPEED_MULTIPLIER,
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';
import PlaybackSpeedControlsModule from '@/components/panels/PlaybackSpeedControlsModule';
import SequentialControlsModule from '@/components/panels/SequentialControlsModule';
import {
  resolveExplicitLayerColorCycleBaseSpeed,
  sanitizeColorCycleLayerSpeedMultiplier,
} from '@/utils/colorCycleLayerSpeed';
import { toggleToolbarColorCyclePlayback } from '@/utils/colorCyclePlayback';

const AnimationControlsPanel: React.FC = () => {
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
  const playbackToggleUi = useAppStore(selectPlaybackToggleUi);
  const sequentialCaptureActive = useAppStore(selectSequentialCaptureActive);
  const sequentialRecord = useAppStore(selectSequentialRecordState);
  const buttonLabel = playbackToggleUi.label;
  const buttonIcon = playbackToggleUi.icon;

  const handleTogglePlayback = React.useCallback(() => {
    void toggleToolbarColorCyclePlayback();
  }, []);

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
      const next = sanitizeColorCycleLayerSpeedMultiplier(
        Number(event.target.value),
        resolveExplicitLayerColorCycleBaseSpeed(activeColorCycleLayer.colorCycleData)
          ?? DEFAULT_CC_LAYER_SPEED_MULTIPLIER,
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
    ? sanitizeColorCycleLayerSpeedMultiplier(
        resolveExplicitLayerColorCycleBaseSpeed(activeColorCycleLayer.colorCycleData),
        DEFAULT_CC_LAYER_SPEED_MULTIPLIER,
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
          currentFrameDisplay={currentFrameDisplay}
          frameCount={sequentialRecord.frameCount}
          fps={sequentialRecord.fps}
          isCaptureActive={sequentialCaptureActive}
          timeSmear={sequentialRecord.timeSmear}
          onFpsChange={handleFpsChange}
          onFramesChange={handleFramesChange}
          onTimeSmearChange={handleTimeSmearChange}
        />

        <PlaybackSpeedControlsModule
          activeCcBaseSpeed={activeCcBaseSpeed}
          controlsDisabled={controlsDisabled}
          playbackSpeedScale={playbackSpeedScale}
          playbackScaleLabel={playbackScaleLabel}
          onCcBaseSpeedChange={handleCcBaseSpeedChange}
          onPlaybackSpeedScaleChange={handlePlaybackSpeedScaleChange}
        />

        <button
          type="button"
          onClick={handleTogglePlayback}
          className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px]" aria-hidden="true">{buttonIcon}</span>
          <span className="ml-1 text-[10px]">{buttonLabel}</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(AnimationControlsPanel);
