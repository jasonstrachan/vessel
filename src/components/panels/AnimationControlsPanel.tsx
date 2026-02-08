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

const AnimationControlsPanel: React.FC = () => {
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore(state => state.forceResumeColorCycle);
  const setRecordFPS = useAppStore((state) => state.setRecordFPS);
  const setRecordFrameCount = useAppStore((state) => state.setRecordFrameCount);
  const setTimeSmear = useAppStore((state) => state.setTimeSmear);
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const suspendDepth = useAppStore(selectColorCycleSuspendDepth);
  const sequentialPlaybackActive = useAppStore(selectSequentialPlaybackActive);
  const sequentialCaptureActive = useAppStore(selectSequentialCaptureActive);
  const sequentialRecord = useAppStore(selectSequentialRecordState);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const activeLayerIsSequential = useAppStore((state) =>
    Boolean(state.layers.find((layer) => layer.id === activeLayerId && layer.layerType === 'sequential'))
  );

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

  const controlsDisabled = sequentialCaptureActive;
  const currentFrameDisplay = Math.min(
    sequentialRecord.frameCount,
    Math.max(1, Math.round(sequentialRecord.currentFrame) + 1)
  );
  const showSequentialControls = activeLayerIsSequential || sequentialPlaybackActive || sequentialCaptureActive;

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040]">
      <div className="px-4 py-3 space-y-3">
        <button
          onClick={handleTogglePlayback}
          className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px]" aria-hidden="true">{effectivePlaying ? '⏸' : '▶'}</span>
          <span className="ml-1 text-[10px]">{effectivePlaying ? 'Pause' : 'Play'}</span>
          {sequentialCaptureActive && (
            <span className="ml-2 rounded bg-[#B91C1C] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-white">
              REC
            </span>
          )}
        </button>

        {showSequentialControls && (
          <div className="rounded border border-[#3F3F3F] bg-[#232323] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#D0D0D0]">Sequential</span>
              <span className="text-[10px] text-[#AFAFAF]">
                Frame {currentFrameDisplay}/{Math.max(1, Math.round(sequentialRecord.frameCount))}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-[#BDBDBD]">
                FPS
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={Math.max(1, Math.round(sequentialRecord.fps))}
                  onChange={handleFpsChange}
                  disabled={controlsDisabled}
                  className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
                />
              </label>
              <label className="text-[10px] text-[#BDBDBD]">
                Frames
                <input
                  type="number"
                  min={1}
                  max={512}
                  step={1}
                  value={Math.max(1, Math.round(sequentialRecord.frameCount))}
                  onChange={handleFramesChange}
                  disabled={controlsDisabled}
                  className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
                />
              </label>
            </div>

            <label className="block text-[10px] text-[#BDBDBD]">
              Time-smear
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.1}
                  value={sequentialRecord.timeSmear}
                  onChange={handleTimeSmearChange}
                  disabled={controlsDisabled}
                  className="w-full accent-[#D9D9D9] disabled:opacity-50"
                />
                <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                  {sequentialRecord.timeSmear.toFixed(1)}x
                </span>
              </div>
            </label>

            {controlsDisabled && (
              <p className="text-[10px] text-[#C9B27A]">
                Capture active. Changes apply next take.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(AnimationControlsPanel);
