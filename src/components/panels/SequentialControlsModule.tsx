'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

import {
  CC_LAYER_SPEED_SCALE_STEP,
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';

interface SequentialControlsModuleProps {
  ccLayerSpeedScale: number;
  controlsDisabled: boolean;
  currentFrameDisplay: number;
  frameCount: number;
  fps: number;
  isCaptureActive: boolean;
  layerSpeedLabel: string;
  timeSmear: number;
  onCcLayerSpeedScaleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFpsChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFramesChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
  ccLayerSpeedScale,
  controlsDisabled,
  currentFrameDisplay,
  frameCount,
  fps,
  isCaptureActive,
  layerSpeedLabel,
  timeSmear,
  onCcLayerSpeedScaleChange,
  onFpsChange,
  onFramesChange,
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
    <div className="rounded border border-[#3F3F3F] bg-[#232323]">
      <button
        type="button"
        className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left"
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[#D0D0D0]">Sequential</span>
          {isCaptureActive && (
            <span className="text-[10px] text-[#AFAFAF]">Capturing</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && (
            <span className="text-[10px] text-[#AFAFAF]">
              Frame {currentFrameDisplay}/{effectiveFrameCount}
            </span>
          )}
          <ChevronRight
            className={`h-4 w-4 text-[#8F8FA3] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            aria-hidden
          />
        </div>
      </button>

      {isExpanded && (
        <div className="p-2.5 pt-0 space-y-2">
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
            Layer speed
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={MIN_CC_LAYER_SPEED_SCALE}
                max={MAX_CC_LAYER_SPEED_SCALE}
                step={CC_LAYER_SPEED_SCALE_STEP}
                value={ccLayerSpeedScale}
                onChange={onCcLayerSpeedScaleChange}
                disabled={controlsDisabled}
                className="w-full accent-[#D9D9D9] disabled:opacity-50"
                aria-label="Layer speed"
              />
              <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                {layerSpeedLabel}
              </span>
            </div>
          </label>

          <label className="block text-[10px] text-[#BDBDBD]">
            Time-smear
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={40}
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
    </div>
  );
};

export default React.memo(SequentialControlsModule);
