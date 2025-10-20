'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import ProgressSlider from '@/components/ui/ProgressSlider';
import type { ColorAdjustParams, Tool } from '@/types';

type ParamKey = keyof ColorAdjustParams;

const SLIDER_CONFIG: Array<{
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}> = [
  { key: 'hue', label: 'Hue', min: -180, max: 180, suffix: '°' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, suffix: '%' },
  { key: 'lightness', label: 'Lightness', min: -100, max: 100, suffix: '%' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, suffix: '%' }
];

const ColorAdjustToolPanel: React.FC = () => {
  const session = useAppStore((state) => state.colorAdjust);
  const updateParams = useAppStore((state) => state.updateColorAdjustParams);
  const applyColorAdjust = useAppStore((state) => state.applyColorAdjust);
  const cancelColorAdjust = useAppStore((state) => state.cancelColorAdjust);
  const resetColorAdjustParams = useAppStore((state) => state.resetColorAdjustParams);
  const setCurrentTool = useAppStore((state) => state.setCurrentTool);
  const startColorAdjustSession = useAppStore((state) => state.startColorAdjustSession);
  const previousTool = useAppStore((state) => state.tools.previousTool);
  const hasValidLayer = useAppStore((state) => {
    if (!state.activeLayerId) {
      return false;
    }
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    return Boolean(layer && layer.layerType === 'normal' && layer.imageData);
  });
  const layerName = useAppStore((state) => {
    if (!state.activeLayerId) {
      return 'Layer';
    }
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    return layer?.name ?? 'Layer';
  });

  const handleSliderChange = useCallback(
    (key: ParamKey) => (value: number) => {
      updateParams({ [key]: value } as Partial<ColorAdjustParams>);
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
    setCurrentTool(nextTool);
  }, [applyColorAdjust, previousTool, resolveFallbackTool, setCurrentTool]);

  const handleCancel = useCallback(() => {
    cancelColorAdjust();
    const nextTool = resolveFallbackTool(previousTool as Tool | null);
    setCurrentTool(nextTool);
  }, [cancelColorAdjust, previousTool, resolveFallbackTool, setCurrentTool]);

  const handleReset = useCallback(() => {
    resetColorAdjustParams();
  }, [resetColorAdjustParams]);

  const hasAdjustments = useMemo(() => {
    const { hue, saturation, lightness, contrast } = session.params;
    return hue !== 0 || saturation !== 0 || lightness !== 0 || contrast !== 0;
  }, [session.params]);

  const scopeLabel = session.selectionBounds ? 'Selection' : 'Layer';

  useEffect(() => {
    if (!session.active && hasValidLayer) {
      startColorAdjustSession();
    }
  }, [session.active, hasValidLayer, startColorAdjustSession]);

  if (!hasValidLayer) {
    return (
      <div className="bg-[#1A1A1A] border-t border-[#404040] px-4 py-6 text-sm text-[#9C9C9C]">
        Select a raster layer to adjust its colors.
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

      <div className="flex flex-col gap-4">
        {SLIDER_CONFIG.map(({ key, label, min, max, step = 1, suffix }) => (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[#9C9C9C]">
              <span>{label}</span>
              <span className="text-[#D9D9D9]">
                {Math.round(session.params[key])}
                {suffix}
              </span>
            </div>
            <ProgressSlider
              value={session.params[key]}
              min={min}
              max={max}
              step={step}
              onChange={handleSliderChange(key)}
              aria-label={`${label} adjustment`}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium border border-[#FFFFFF]/40 text-white rounded-sm hover:bg-white hover:text-black transition"
          onClick={handleApply}
          disabled={!session.active}
        >
          Apply
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium border border-[#FFFFFF]/20 text-[#D9D9D9] rounded-sm hover:bg-[#2A2A2A] transition disabled:opacity-50"
          onClick={handleReset}
          disabled={!session.active || !hasAdjustments}
        >
          Reset
        </button>
        <button
          type="button"
          className="ml-auto px-3 py-1.5 text-sm font-medium border border-transparent text-[#FF6B6B] hover:border-[#FF6B6B] rounded-sm transition"
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
