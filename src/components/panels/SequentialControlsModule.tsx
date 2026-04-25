'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

import {
  CC_LAYER_SPEED_SCALE_STEP,
  DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';

interface SequentialControlsModuleProps {
  controlsDisabled: boolean;
  activeCcBaseSpeed: number | null;
  currentFrameDisplay: number;
  frameCount: number;
  fps: number;
  isCaptureActive: boolean;
  playbackSpeedScale: number;
  playbackScaleLabel: string;
  timeSmear: number;
  onCcBaseSpeedChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFpsChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFramesChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPlaybackSpeedScaleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onTimeSmearChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const SEQUENTIAL_PANEL_EXPANDED_STORAGE_KEY = 'vessel-sequential-panel-expanded';

const loadInitialExpandedState = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(SEQUENTIAL_PANEL_EXPANDED_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

const persistExpandedState = (isExpanded: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      SEQUENTIAL_PANEL_EXPANDED_STORAGE_KEY,
      isExpanded ? '1' : '0',
    );
  } catch {
    // Ignore storage errors and keep runtime state functional.
  }
};

const SequentialControlsModule: React.FC<SequentialControlsModuleProps> = ({
  controlsDisabled,
  activeCcBaseSpeed,
  currentFrameDisplay,
  frameCount,
  fps,
  isCaptureActive,
  playbackSpeedScale,
  playbackScaleLabel,
  timeSmear,
  onCcBaseSpeedChange,
  onFpsChange,
  onFramesChange,
  onPlaybackSpeedScaleChange,
  onTimeSmearChange,
}) => {
  const [isExpanded, setIsExpanded] = React.useState<boolean>(loadInitialExpandedState);
  const effectiveFrameCount = Math.max(1, Math.round(frameCount));

  const handleToggleExpanded = React.useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      persistExpandedState(next);
      return next;
    });
  }, []);

  return (
    <section aria-labelledby="sequence-controls-heading">
      <button
        type="button"
        className="w-full bg-transparent flex items-center justify-between text-left cursor-pointer select-none gap-2 transition-colors py-1"
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <span id="sequence-controls-heading" className="text-sm font-medium text-[#F1F1F6]">
            Sequence
          </span>
          {isExpanded ? (
            <span className="text-[11px] leading-4 text-[#88888A]">
              Frame {currentFrameDisplay}/{effectiveFrameCount}
              {isCaptureActive ? ' • Capturing' : ''}
            </span>
          ) : null}
        </div>
        <ChevronRight
          className={`h-4 w-4 text-[#8F8FA3] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {isExpanded && (
        <div className="mt-1.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-[#BDBDBD]">
              FPS
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                value={Math.max(1, Math.round(fps))}
                onChange={onFpsChange}
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
                value={effectiveFrameCount}
                onChange={onFramesChange}
                disabled={controlsDisabled}
                className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
              />
            </label>
          </div>

          <label className="block text-[10px] text-[#BDBDBD]">
            Playback speed
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={MIN_CC_LAYER_SPEED_SCALE}
                max={MAX_CC_LAYER_SPEED_SCALE}
                step={CC_LAYER_SPEED_SCALE_STEP}
                value={playbackSpeedScale}
                onChange={onPlaybackSpeedScaleChange}
                disabled={controlsDisabled}
                className="w-full accent-[#D9D9D9] disabled:opacity-50"
                aria-label="Playback speed"
              />
              <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                {playbackScaleLabel}
              </span>
            </div>
            <span className="mt-1 block text-[9px] text-[#8F8F8F]">
              Applies to color-cycle playback only. Sequence playback uses the FPS setting above.
            </span>
          </label>

          {activeCcBaseSpeed !== null && (
            <label className="block text-[10px] text-[#BDBDBD]">
              CC base speed
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={CC_LAYER_SPEED_SCALE_STEP}
                  max={MAX_BRUSH_COLOR_CYCLE_SPEED}
                  step={CC_LAYER_SPEED_SCALE_STEP}
                  value={activeCcBaseSpeed}
                  onChange={onCcBaseSpeedChange}
                  disabled={controlsDisabled}
                  className="w-full accent-[#D9D9D9] disabled:opacity-50"
                  aria-label="CC base speed"
                />
                <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                  {(activeCcBaseSpeed ?? DEFAULT_BRUSH_COLOR_CYCLE_SPEED).toFixed(2)}x
                </span>
              </div>
              <span className="mt-1 block text-[9px] text-[#8F8F8F]">
                Active color-cycle layer only.
              </span>
            </label>
          )}

          <label className="block text-[10px] text-[#BDBDBD]">
            Time-smear
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={160}
                step={0.1}
                value={timeSmear}
                onChange={onTimeSmearChange}
                disabled={controlsDisabled}
                className="w-full accent-[#D9D9D9] disabled:opacity-50"
              />
              <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                {timeSmear.toFixed(1)}x
              </span>
            </div>
          </label>
        </div>
      )}
    </section>
  );
};

export default React.memo(SequentialControlsModule);
