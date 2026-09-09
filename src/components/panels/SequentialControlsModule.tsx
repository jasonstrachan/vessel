'use client';

import React from 'react';
import { ModuleHeader } from '@/components/panels/ModuleHeader';

import CustomSwitch from '@/components/ui/CustomSwitch';

export type SequentialFrameResizeMode = 'preserve' | 'trim' | 'retime';

interface SequentialControlsModuleProps {
  controlsDisabled: boolean;
  currentFrameDisplay: number;
  frameCount: number;
  fps: number;
  hasActiveSequentialLayer: boolean;
  isCaptureActive: boolean;
  recordArmed: boolean;
  temporalSpreadFrames: number;
  trailFalloff: number;
  burstFrames: number;
  gapFrames: number;
  onFpsChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFramesChange: (
    event: React.ChangeEvent<HTMLInputElement>,
    mode: SequentialFrameResizeMode,
  ) => void;
  onRecordArmedChange: (recordArmed: boolean) => void;
  onTemporalSpreadChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onTrailFalloffChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBurstFramesChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onGapFramesChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
  currentFrameDisplay,
  frameCount,
  fps,
  hasActiveSequentialLayer,
  isCaptureActive,
  recordArmed,
  temporalSpreadFrames,
  trailFalloff,
  burstFrames,
  gapFrames,
  onFpsChange,
  onFramesChange,
  onRecordArmedChange,
  onTemporalSpreadChange,
  onTrailFalloffChange,
  onBurstFramesChange,
  onGapFramesChange,
}) => {
  const [isExpanded, setIsExpanded] = React.useState<boolean>(loadInitialExpandedState);
  const [resizeMode, setResizeMode] = React.useState<SequentialFrameResizeMode>('preserve');
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
      <ModuleHeader title="Sequence" headingId="sequence-controls-heading" expanded={isExpanded} onToggle={handleToggleExpanded} status={`${currentFrameDisplay}/${effectiveFrameCount}${isCaptureActive ? " • Capturing" : ""}`} />

      {isExpanded && (
        <div className="mt-1.5 space-y-2">
          <div className="flex items-center justify-between gap-2 border border-[#3A3A3A] px-2 py-1.5">
            <div className="min-w-0">
              <div className="text-[10px] text-[#D8D8D8]">Record while drawing</div>
              <div className="text-[9px] text-[#858585]">
                {isCaptureActive ? 'Capturing the live stroke' : 'Play remains preview-only'}
              </div>
            </div>
            <CustomSwitch
              id="sequential-record-armed"
              checked={recordArmed}
              disabled={!hasActiveSequentialLayer}
              onChange={onRecordArmedChange}
              aria-label="Record sequence while drawing"
            />
          </div>

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
                onChange={(event) => onFramesChange(event, resizeMode)}
                disabled={controlsDisabled}
                className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
              />
            </label>
          </div>

          <label className="block text-[10px] text-[#BDBDBD]">
            Frame resize
            <select
              aria-label="Frame resize behavior"
              value={resizeMode}
              onChange={(event) => setResizeMode(event.target.value as SequentialFrameResizeMode)}
              disabled={controlsDisabled}
              className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
            >
              <option value="preserve">Preserve hidden marks</option>
              <option value="trim">Trim marks outside range</option>
              <option value="retime">Retime marks to fit</option>
            </select>
          </label>

          <label className="block text-[10px] text-[#BDBDBD]">
            Temporal spread
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={32}
                step={1}
                value={temporalSpreadFrames}
                onChange={onTemporalSpreadChange}
                disabled={controlsDisabled}
                className="w-full accent-[#D9D9D9] disabled:opacity-50"
              />
              <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                {Math.round(temporalSpreadFrames)}f
              </span>
            </div>
          </label>

          <label className="block text-[10px] text-[#BDBDBD]">
            Trail fade
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={trailFalloff}
                onChange={onTrailFalloffChange}
                disabled={controlsDisabled}
                className="w-full accent-[#D9D9D9] disabled:opacity-50"
              />
              <span className="w-10 text-right text-[10px] text-[#D6D6D6]">
                {Math.round(trailFalloff * 100)}%
              </span>
            </div>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-[#BDBDBD]">
              Burst
              <input
                type="number"
                min={1}
                max={32}
                step={1}
                value={Math.round(burstFrames)}
                onChange={onBurstFramesChange}
                disabled={controlsDisabled}
                className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
              />
            </label>
            <label className="text-[10px] text-[#BDBDBD]">
              Gap
              <input
                type="number"
                min={0}
                max={64}
                step={1}
                value={Math.round(gapFrames)}
                onChange={onGapFramesChange}
                disabled={controlsDisabled}
                className="mt-1 w-full h-7 bg-[#1A1A1A] border border-[#454545] px-2 text-[11px] text-[#E2E2E2] disabled:opacity-50"
              />
            </label>
          </div>
          <p className="text-[9px] leading-3 text-[#777]">
            Pattern: {Math.round(burstFrames)} on / {Math.round(gapFrames)} off
          </p>
        </div>
      )}
    </section>
  );
};

export default React.memo(SequentialControlsModule);
