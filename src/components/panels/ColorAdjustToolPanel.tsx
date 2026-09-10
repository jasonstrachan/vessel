'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/useAppStore';
import ProgressSlider from '@/components/ui/ProgressSlider';
import CustomSwitch from '@/components/ui/CustomSwitch';
import HueRangeStrip from '@/components/ui/HueRangeStrip';
import type { ColorAdjustToolParams, Tool } from '@/types';
import { useToolSwitcher } from '@/utils/toolSwitch';
import {
  isEligibleColorAdjustLayer,
  resolveColorAdjustTargetLayerIds,
} from '@/stores/helpers/colorAdjustSession';
import {
  selectColorAdjustEligibleTargetSummary,
  selectPreviousTool,
} from '@/stores/selectors/toolsSelectors';

type ParamKey = keyof ColorAdjustToolParams;
type SliderParamKey = 'hue' | 'saturation' | 'vibrance' | 'lightness' | 'contrast' | 'ccInkContrast' | 'red' | 'green' | 'blue';
type RuntimePreparationStatus = 'idle' | 'preparing' | 'failed';

const SLIDER_CONFIG: Array<{
  key: SliderParamKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  colorCycleOnly?: boolean;
}> = [
  { key: 'hue', label: 'Hue', min: -180, max: 180, suffix: '°' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, suffix: '%' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, suffix: '%' },
  { key: 'lightness', label: 'Lightness', min: -100, max: 100, suffix: '%' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, suffix: '%' },
  {
    key: 'ccInkContrast',
    label: 'CC Ink Contrast',
    min: -100,
    max: 100,
    suffix: '%',
    colorCycleOnly: true,
  },
  { key: 'red', label: 'Red', min: -100, max: 100, suffix: '%' },
  { key: 'green', label: 'Green', min: -100, max: 100, suffix: '%' },
  { key: 'blue', label: 'Blue', min: -100, max: 100, suffix: '%' },
];

const TargetRangeValue = ({ value, min, max, label, disabled, onCommit }: {
  value: number;
  min: number;
  max: number;
  label: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      type="number"
      className="w-14 border border-[#444] bg-transparent px-1 text-white"
      aria-label={label}
      min={min}
      max={max}
      step={1}
      value={draft ?? Math.round(value)}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) {
          onCommit(Math.max(min, Math.min(max, Number(draft))));
        }
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') event.currentTarget.blur();
        else setDraft(null);
      }}
    />
  );
};

const ColorAdjustToolPanel: React.FC = () => {
  const session = useAppStore((state) => state.colorAdjust);
  const updateParams = useAppStore((state) => state.updateColorAdjustParams);
  const setPickingTarget = useAppStore((state) => state.setColorAdjustPickingTarget);
  const applyColorAdjust = useAppStore((state) => state.applyColorAdjust);
  const cancelColorAdjust = useAppStore((state) => state.cancelColorAdjust);
  const resetColorAdjustParams = useAppStore((state) => state.resetColorAdjustParams);
  const startColorAdjustSession = useAppStore((state) => state.startColorAdjustSession);
  const ensureColorCycleLayerRuntime = useAppStore((state) => state.ensureColorCycleLayerRuntime);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const eligibleTargetLayerIds = useAppStore(useShallow((state) => (
    resolveColorAdjustTargetLayerIds(state.activeLayerId, state.selectedLayerIds)
      .filter((layerId) => (
        isEligibleColorAdjustLayer(state.layers.find((layer) => layer.id === layerId))
      ))
  )));
  const colorCycleTargetIds = useAppStore(useShallow((state) => (
    resolveColorAdjustTargetLayerIds(state.activeLayerId, state.selectedLayerIds)
      .filter((layerId) => {
        const layer = state.layers.find((candidate) => candidate.id === layerId);
        return layer?.layerType === 'color-cycle' && isEligibleColorAdjustLayer(layer);
      })
  )));
  const previousTool = useAppStore(selectPreviousTool);
  const eligibleTargetSummary = useAppStore(useShallow(selectColorAdjustEligibleTargetSummary));
  const switchTool = useToolSwitcher();
  const preparationTokenRef = React.useRef(0);
  const [runtimePreparationStatus, setRuntimePreparationStatus] = React.useState<RuntimePreparationStatus>('idle');
  const hasValidLayer = eligibleTargetSummary.hasValidLayer;
  const layerName = eligibleTargetSummary.label;
  const targetCount = eligibleTargetSummary.count;
  const sessionTargetsMatch = session.targetLayerIds.length === eligibleTargetLayerIds.length &&
    session.targetLayerIds.every((layerId, index) => layerId === eligibleTargetLayerIds[index]);

  const handleSliderChange = useCallback(
    (key: ParamKey) => (value: number) => {
      updateParams({ [key]: value } as Partial<ColorAdjustToolParams>);
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
    const {
      hue,
      saturation,
      vibrance,
      lightness,
      contrast,
      ccInkContrast,
      red,
      green,
      blue,
    } = session.params;
    return (
      hue !== 0 ||
      saturation !== 0 ||
      vibrance !== 0 ||
      lightness !== 0 ||
      contrast !== 0 ||
      (ccInkContrast ?? 0) !== 0 ||
      red !== 0 ||
      green !== 0 ||
      blue !== 0
    );
  }, [session.params]);

  const scopeLabel = targetCount > 1
    ? 'Layers'
    : (session.selectionBounds ? 'Selection' : 'Layer');

  useEffect(() => {
    if (session.active && (!hasValidLayer || !sessionTargetsMatch)) {
      cancelColorAdjust();
      setRuntimePreparationStatus('idle');
      return;
    }

    if (session.active || !hasValidLayer) {
      setRuntimePreparationStatus('idle');
      return;
    }

    const preparationToken = preparationTokenRef.current + 1;
    preparationTokenRef.current = preparationToken;

    if (colorCycleTargetIds.length === 0) {
      startColorAdjustSession();
      return;
    }

    setRuntimePreparationStatus('preparing');
    void Promise.all(colorCycleTargetIds.map((layerId) => (
      ensureColorCycleLayerRuntime(layerId, {
        target: layerId === activeLayerId ? 'active' : 'warm',
      })
    )))
      .then((results) => {
        if (preparationTokenRef.current !== preparationToken) {
          return;
        }
        if (results.every(Boolean)) {
          startColorAdjustSession();
          setRuntimePreparationStatus('idle');
          return;
        }
        setRuntimePreparationStatus('failed');
      })
      .catch(() => {
        if (preparationTokenRef.current === preparationToken) {
          setRuntimePreparationStatus('failed');
        }
      });

    return () => {
      if (preparationTokenRef.current === preparationToken) {
        preparationTokenRef.current += 1;
      }
    };
  }, [
    activeLayerId,
    cancelColorAdjust,
    colorCycleTargetIds,
    ensureColorCycleLayerRuntime,
    hasValidLayer,
    session.active,
    sessionTargetsMatch,
    startColorAdjustSession,
  ]);

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

      {runtimePreparationStatus === 'preparing' ? (
        <div role="status" className="text-xs text-[#9C9C9C]">
          Preparing Color Cycle data…
        </div>
      ) : null}
      {runtimePreparationStatus === 'failed' ? (
        <div role="alert" className="text-xs text-[#FF9B9B]">
          Color Cycle data could not be prepared. Re-select Hue/Sat to retry.
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-[#9C9C9C]">Target colours</div>
        <button
          type="button"
          className="border border-[#555] px-2 py-1 text-xs text-white disabled:opacity-40"
          disabled={!session.active}
          aria-pressed={session.isPickingTarget === true}
          onClick={() => setPickingTarget(!session.isPickingTarget)}
        >
          {session.isPickingTarget ? 'Cancel picking' : 'Pick from canvas'}
        </button>
        {session.isPickingTarget && <p role="status" className="text-xs text-[#aaa]">Showing original colours. Click a colour on the canvas.</p>}
        <p className="text-[11px] text-[#9C9C9C]">Enabled ranges combine. Adjustments affect matching colours.</p>
        {(['hue', 'lightness', 'saturation'] as const).map((channel) => {
          const label = `${channel[0].toUpperCase()}${channel.slice(1)}`;
          const max = channel === 'hue' ? 360 : 100;
          const enabled = session.params[`${channel}RangeEnabled`] === true;
          const start = session.params[`${channel}RangeStart`] ?? 0;
          const end = session.params[`${channel}RangeEnd`] ?? max;
          const disabled = !session.active || !enabled || session.isPickingTarget === true;
          return (
            <div key={channel} className="flex flex-col gap-1 border-b border-[#333] pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#aaa]">{label} range</span>
                <CustomSwitch checked={enabled} onChange={(value) => updateParams({ [`${channel}RangeEnabled`]: value })}
                  aria-label={`Enable ${channel} range targeting`} disabled={!session.active || session.isPickingTarget === true} />
              </div>
              {enabled && <>
                <HueRangeStrip channel={channel} value={[start, end]} disabled={disabled}
                  aria-label={`Target ${channel} range`}
                  onValueChange={([rangeStart, rangeEnd]) => updateParams({ [`${channel}RangeStart`]: rangeStart, [`${channel}RangeEnd`]: rangeEnd })} />
                <div className="flex items-center justify-between text-[11px] text-[#aaa]">
                  {([start, end] as const).map((value, index) => (
                    <label key={index}>
                      <TargetRangeValue
                        label={`${label} range ${index === 0 ? 'start' : 'end'} value`}
                        min={channel !== 'hue' && index === 1 ? start : 0}
                        max={channel !== 'hue' && index === 0 ? end : max}
                        value={value}
                        disabled={disabled}
                        onCommit={(next) => updateParams({ [`${channel}Range${index === 0 ? 'Start' : 'End'}`]: next })}
                      />{channel === 'hue' ? '°' : '%'}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#aaa]">
                  <span>Softness</span>
                  <ProgressSlider className="flex-1" min={0} max={channel === 'hue' ? 60 : 50} step={1}
                    value={session.params[`${channel}RangeSoftness`] ?? 0} disabled={disabled}
                    onChange={(value) => updateParams({ [`${channel}RangeSoftness`]: value })}
                    aria-label={`${label} range softness`} />
                </div>
              </>}
            </div>
          );
        })}
      </div>

      <div className="text-xs uppercase tracking-wider text-[#9C9C9C]">Adjustments</div>
      <div className="flex flex-col gap-3">
        {SLIDER_CONFIG.filter(({ colorCycleOnly }) => (
          !colorCycleOnly || colorCycleTargetIds.length > 0
        )).map(({ key, label, min, max, step = 1 }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-20 text-xs uppercase tracking-wider text-[#9C9C9C]">
              {label}
            </span>
            <ProgressSlider
              value={session.params[key] ?? 0}
              min={min}
              max={max}
              step={step}
              onChange={handleSliderChange(key)}
              aria-label={`${label} adjustment`}
              className="flex-1"
              disabled={!session.active}
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
          disabled={!session.active || (!hasAdjustments && !session.isPickingTarget && !session.params.hueRangeEnabled && !session.params.lightnessRangeEnabled && !session.params.saturationRangeEnabled)}
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
