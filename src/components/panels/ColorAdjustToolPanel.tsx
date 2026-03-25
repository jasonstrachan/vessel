'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import { useAppStore } from '@/stores/useAppStore';
import ProgressSlider from '@/components/ui/ProgressSlider';
import CustomSwitch from '@/components/ui/CustomSwitch';
import HueRangeStrip from '@/components/ui/HueRangeStrip';
import type { ColorAdjustParams, Tool } from '@/types';
import { useToolSwitcher } from '@/utils/toolSwitch';
import {
  selectColorAdjustEligibleTargetSummary,
  selectPreviousTool,
} from '@/stores/selectors/toolsSelectors';

type ParamKey = keyof ColorAdjustParams;
type SliderParamKey = Exclude<ParamKey, 'hueRangeEnabled' | 'hueRangeStart' | 'hueRangeEnd'>;

const SLIDER_CONFIG: Array<{
  key: SliderParamKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}> = [
  { key: 'hue', label: 'Hue', min: -180, max: 180, suffix: '°' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, suffix: '%' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, suffix: '%' },
  { key: 'lightness', label: 'Lightness', min: -100, max: 100, suffix: '%' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, suffix: '%' },
  { key: 'red', label: 'Red', min: -100, max: 100, suffix: '%' },
  { key: 'green', label: 'Green', min: -100, max: 100, suffix: '%' },
  { key: 'blue', label: 'Blue', min: -100, max: 100, suffix: '%' },
];

const ColorAdjustToolPanel: React.FC = () => {
  const session = useAppStore((state) => state.colorAdjust);
  const updateParams = useAppStore((state) => state.updateColorAdjustParams);
  const applyColorAdjust = useAppStore((state) => state.applyColorAdjust);
  const cancelColorAdjust = useAppStore((state) => state.cancelColorAdjust);
  const resetColorAdjustParams = useAppStore((state) => state.resetColorAdjustParams);
  const startColorAdjustSession = useAppStore((state) => state.startColorAdjustSession);
  const previousTool = useAppStore(selectPreviousTool);
  const eligibleTargetSummary = useAppStore(selectColorAdjustEligibleTargetSummary, shallow);
  const switchTool = useToolSwitcher();
  const hasValidLayer = eligibleTargetSummary.hasValidLayer;
  const layerName = eligibleTargetSummary.label;
  const targetCount = eligibleTargetSummary.count;

  const handleSliderChange = useCallback(
    (key: ParamKey) => (value: number) => {
      updateParams({ [key]: value } as Partial<ColorAdjustParams>);
    },
    [updateParams]
  );
  const handleHueRangeChange = useCallback(
    (value: [number, number]) => {
      updateParams({
        hueRangeStart: value[0],
        hueRangeEnd: value[1],
      });
    },
    [updateParams]
  );
  const handleHueRangeToggle = useCallback(
    (enabled: boolean) => {
      updateParams({ hueRangeEnabled: enabled });
    },
    [updateParams]
  );

  const resolveFallbackTool = useCallback(
    (candidate?: Tool | null): Tool => {
      const fallback = candidate ?? 'brush';
      return fallback === 'color-adjust' ? 'brush' : fallback;
    },
    []
  );

  const handleApply = useCallback(async () => {
    await applyColorAdjust();
    const nextTool = resolveFallbackTool(previousTool as Tool | null);
    await switchTool(nextTool);
  }, [applyColorAdjust, previousTool, resolveFallbackTool, switchTool]);

  const handleCancel = useCallback(async () => {
    cancelColorAdjust();
    const nextTool = resolveFallbackTool(previousTool as Tool | null);
    await switchTool(nextTool);
  }, [cancelColorAdjust, previousTool, resolveFallbackTool, switchTool]);

  const handleReset = useCallback(() => {
    resetColorAdjustParams();
  }, [resetColorAdjustParams]);

  const hasAdjustments = useMemo(() => {
    const { hue, saturation, vibrance, lightness, contrast, red, green, blue } = session.params;
    return (
      hue !== 0 ||
      saturation !== 0 ||
      vibrance !== 0 ||
      lightness !== 0 ||
      contrast !== 0 ||
      red !== 0 ||
      green !== 0 ||
      blue !== 0
    );
  }, [session.params]);

  const scopeLabel = targetCount > 1
    ? 'Layers'
    : session.targetLayerType === 'color-cycle'
      ? 'Gradient'
      : (session.selectionBounds ? 'Selection' : 'Layer');

  useEffect(() => {
    if (!session.active && hasValidLayer) {
      startColorAdjustSession();
    }
  }, [session.active, hasValidLayer, startColorAdjustSession]);

  if (!hasValidLayer) {
    return (
      <div className="bg-[#1A1A1A] border-t border-[#404040] px-4 py-6 text-sm text-[#9C9C9C]">
        Select a raster or color-cycle layer to adjust its colors.
      </div>
    );
  }

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040] px-4 py-4 flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-[#9C9C9C] mb-1">
          Target
        </div>
        <div className="text-sm text-white">
          {layerName}{' '}
          <span className="text-[#9C9C9C]">({scopeLabel})</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wider text-[#9C9C9C]">
            Hue Range
          </div>
          <CustomSwitch
            checked={session.params.hueRangeEnabled}
            onChange={handleHueRangeToggle}
            aria-label="Enable hue range targeting"
          />
        </div>

        <HueRangeStrip
          value={[session.params.hueRangeStart, session.params.hueRangeEnd]}
          onValueChange={handleHueRangeChange}
          disabled={!session.params.hueRangeEnabled}
        />

        <div className="flex items-center justify-between text-[11px] text-[#9C9C9C]">
          <span>{Math.round(session.params.hueRangeStart)}°</span>
          <span>{Math.round(session.params.hueRangeEnd)}°</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {SLIDER_CONFIG.map(({ key, label, min, max, step = 1 }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-20 text-xs uppercase tracking-wider text-[#9C9C9C]">
              {label}
            </span>
            <ProgressSlider
              value={session.params[key]}
              min={min}
              max={max}
              step={step}
              onChange={handleSliderChange(key)}
              aria-label={`${label} adjustment`}
              className="flex-1"
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium border border-[#FFFFFF]/40 text-white rounded-none hover:bg-white hover:text-black transition"
          onClick={handleApply}
          disabled={!session.active}
        >
          Apply
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium border border-[#FFFFFF]/20 text-[#D9D9D9] rounded-none hover:bg-[#2A2A2A] transition disabled:opacity-50"
          onClick={handleReset}
          disabled={!session.active || !hasAdjustments}
        >
          Reset
        </button>
        <button
          type="button"
          className="ml-auto px-3 py-1.5 text-sm font-medium border border-transparent text-[#FF6B6B] hover:border-[#FF6B6B] rounded-none transition"
          onClick={handleCancel}
          disabled={!session.active}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default React.memo(ColorAdjustToolPanel);
