'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

import {
  CC_LAYER_SPEED_MULTIPLIER_STEP,
  CC_LAYER_SPEED_SCALE_STEP,
  DEFAULT_CC_LAYER_SPEED_MULTIPLIER,
  MAX_CC_LAYER_SPEED_MULTIPLIER,
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_MULTIPLIER,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';

interface PlaybackSpeedControlsModuleProps {
  activeCcBaseSpeed: number | null;
  controlsDisabled: boolean;
  playbackSpeedScale: number;
  playbackScaleLabel: string;
  onCcBaseSpeedChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPlaybackSpeedScaleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const PLAYBACK_SPEED_PANEL_EXPANDED_STORAGE_KEY = 'vessel-playback-speed-panel-expanded';

const loadInitialExpandedState = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(PLAYBACK_SPEED_PANEL_EXPANDED_STORAGE_KEY) !== '0';
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
      PLAYBACK_SPEED_PANEL_EXPANDED_STORAGE_KEY,
      isExpanded ? '1' : '0',
    );
  } catch {
    // Ignore storage errors and keep runtime state functional.
  }
};

const PlaybackSpeedControlsModule: React.FC<PlaybackSpeedControlsModuleProps> = ({
  activeCcBaseSpeed,
  controlsDisabled,
  playbackSpeedScale,
  playbackScaleLabel,
  onCcBaseSpeedChange,
  onPlaybackSpeedScaleChange,
}) => {
  const [isExpanded, setIsExpanded] = React.useState<boolean>(loadInitialExpandedState);

  const handleToggleExpanded = React.useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      persistExpandedState(next);
      return next;
    });
  }, []);

  return (
    <section
      aria-labelledby="playback-speed-controls-heading"
      className="border-t border-[#404040] pt-2"
    >
      <button
        type="button"
        className="w-full bg-transparent flex items-center justify-between text-left cursor-pointer select-none gap-2 transition-colors py-1"
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
        aria-label="Speed"
      >
        <div className="flex flex-col">
          <span id="playback-speed-controls-heading" className="text-sm font-medium text-[#F1F1F6]">
            Speed
          </span>
          {isExpanded ? (
            <span className="text-[11px] leading-4 text-[#88888A]">
              CC and Interlace playback
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
          <label className="block text-[10px] text-[#BDBDBD]">
            CC + Interlace playback rate
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
                aria-label="CC and Interlace playback rate"
              />
              <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                {playbackScaleLabel}
              </span>
            </div>
          </label>

          {activeCcBaseSpeed !== null && (
            <label className="block text-[10px] text-[#BDBDBD]">
              Layer speed multiplier
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={MIN_CC_LAYER_SPEED_MULTIPLIER}
                  max={MAX_CC_LAYER_SPEED_MULTIPLIER}
                  step={CC_LAYER_SPEED_MULTIPLIER_STEP}
                  value={activeCcBaseSpeed}
                  onChange={onCcBaseSpeedChange}
                  disabled={controlsDisabled}
                  className="w-full accent-[#D9D9D9] disabled:opacity-50"
                  aria-label="Layer speed multiplier"
                />
                <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                  {(activeCcBaseSpeed ?? DEFAULT_CC_LAYER_SPEED_MULTIPLIER).toFixed(2)}x
                </span>
              </div>
            </label>
          )}
        </div>
      )}
    </section>
  );
};

export default React.memo(PlaybackSpeedControlsModule);
