'use client';

import React from 'react';

import Dropdown from '@/components/ui/Dropdown';
import { HueSlider } from '@/components/ui/HueSlider';
import ProgressSlider from '@/components/ui/ProgressSlider';
import {
  ADJUSTMENT_EFFECT_LABELS,
  createDefaultAdjustmentEffect,
  sanitizeAdjustmentLayerData,
} from '@/lib/adjustmentLayers';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { useAppStore } from '@/stores/useAppStore';
import type {
  AdjustmentEffect,
  AdjustmentEffectId,
  ColorAdjustParams,
} from '@/types';

const EFFECT_OPTIONS = (Object.entries(ADJUSTMENT_EFFECT_LABELS) as Array<[
  AdjustmentEffectId,
  string,
]>).map(([value, label]) => ({ value, label }));

const HUE_SAT_SLIDERS: Array<{
  key: Exclude<
    keyof ColorAdjustParams,
    'hue' | 'hueRangeEnabled' | 'hueRangeStart' | 'hueRangeEnd'
  >;
  label: string;
  min: number;
  max: number;
}> = [
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'lightness', label: 'Lightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'red', label: 'Red', min: -100, max: 100 },
  { key: 'green', label: 'Green', min: -100, max: 100 },
  { key: 'blue', label: 'Blue', min: -100, max: 100 },
];

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}

const SliderRow = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
}: SliderRowProps) => (
  <div className="flex items-center gap-3">
    <span className="w-20 text-xs uppercase tracking-wider text-[#9C9C9C]">
      {label}
    </span>
    <ProgressSlider
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
      onCommit={onCommit}
      aria-label={`${label} adjustment`}
      className="flex-1"
    />
  </div>
);

export const AdjustmentLayerPanel = () => {
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const activeLayer = useAppStore((state) => (
    state.layers.find((layer) => layer.id === state.activeLayerId) ?? null
  ));
  const activeGroup = useAppStore((state) => (
    state.layerGroups.find((group) => group.id === activeLayer?.groupId) ?? null
  ));
  const beginEdit = useAppStore((state) => state.beginAdjustmentLayerEdit);
  const updateEffect = useAppStore((state) => state.updateAdjustmentLayerEffect);
  const commitEdit = useAppStore((state) => state.commitAdjustmentLayerEdit);
  const updateLayer = useAppStore((state) => state.updateLayer);

  React.useEffect(() => () => {
    if (activeLayerId) commitEdit(activeLayerId);
  }, [activeLayerId, commitEdit]);

  if (activeLayer?.layerType !== 'adjustment') return null;

  const data = sanitizeAdjustmentLayerData(activeLayer.adjustmentData);
  const effect = data.effect;
  const scope = activeGroup && !isInterlaceGroup(activeGroup)
    ? `lower layers in ${activeGroup.name}`
    : 'all lower layers';

  const preview = (nextEffect: AdjustmentEffect) => {
    beginEdit(activeLayer.id);
    updateEffect(activeLayer.id, nextEffect);
  };
  const commit = () => commitEdit(activeLayer.id);
  const changeImmediately = (nextEffect: AdjustmentEffect) => {
    if (JSON.stringify(effect) === JSON.stringify(nextEffect)) {
      return;
    }
    preview(nextEffect);
    commit();
  };

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040] px-4 py-4 flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-[#9C9C9C] mb-1">Adjustment</div>
        <div className="text-sm text-white">{activeLayer.name}</div>
        <div className="mt-1 text-xs text-[#9C9C9C]">Affects {scope}. Layer opacity controls strength.</div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[#9C9C9C]">Effect</span>
        <Dropdown
          value={effect.id}
          options={EFFECT_OPTIONS}
          onChange={(value) => changeImmediately(
            createDefaultAdjustmentEffect(value as AdjustmentEffectId),
          )}
          className="w-full"
        />
      </div>

      <SliderRow
        label="Strength"
        value={Math.round(activeLayer.opacity * 100)}
        min={0}
        max={100}
        onChange={(value) => {
          beginEdit(activeLayer.id);
          updateLayer(activeLayer.id, { opacity: value / 100 });
        }}
        onCommit={commit}
      />

      {effect.id === 'hue-sat' ? (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wider text-[#9C9C9C]">Hue</span>
              <span className="text-xs tabular-nums text-[#9C9C9C]">
                {Math.round(effect.settings.hue)}°
              </span>
            </div>
            <HueSlider
              value={[effect.settings.hue]}
              onValueChange={([hue]) => preview({
                ...effect,
                settings: { ...effect.settings, hue },
              })}
              onValueCommit={commit}
              aria-label="Hue adjustment"
            />
          </div>
          <div className="flex flex-col gap-3">
            {HUE_SAT_SLIDERS.map(({ key, label, min, max }) => (
              <SliderRow
                key={key}
                label={label}
                value={effect.settings[key]}
                min={min}
                max={max}
                onChange={(value) => preview({
                  ...effect,
                  settings: { ...effect.settings, [key]: value },
                })}
                onCommit={commit}
              />
            ))}
          </div>
        </>
      ) : null}

      {effect.id === 'color-grade' ? (
        <div className="flex flex-col gap-3">
          {([
            ['brightness', 'Brightness', -1, 1, 0.01],
            ['contrast', 'Contrast', -1, 1, 0.01],
            ['saturation', 'Saturation', 0, 2, 0.01],
          ] as const).map(([key, label, min, max, step]) => (
            <SliderRow
              key={key}
              label={label}
              value={effect.settings[key]}
              min={min}
              max={max}
              step={step}
              onChange={(value) => preview({
                ...effect,
                settings: { ...effect.settings, [key]: value },
              })}
              onCommit={commit}
            />
          ))}
        </div>
      ) : null}

      {effect.id === 'pixelate' ? (
        <SliderRow
          label="Cell Size"
          value={effect.settings.cellSize}
          min={1}
          max={64}
          onChange={(cellSize) => preview({ ...effect, settings: { cellSize } })}
          onCommit={commit}
        />
      ) : null}

      {effect.id === 'bloom' ? (
        <div className="flex flex-col gap-3">
          <SliderRow
            label="Radius"
            value={effect.settings.blurRadius}
            min={0}
            max={12}
            step={0.25}
            onChange={(blurRadius) => preview({
              ...effect,
              settings: { ...effect.settings, blurRadius },
            })}
            onCommit={commit}
          />
          <SliderRow
            label="Intensity"
            value={effect.settings.intensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(intensity) => preview({
              ...effect,
              settings: { ...effect.settings, intensity },
            })}
            onCommit={commit}
          />
        </div>
      ) : null}

      <button
        type="button"
        className="self-start px-3 py-1.5 text-sm font-medium border border-[#FFFFFF]/20 text-[#D9D9D9] hover:bg-[#2A2A2A] transition"
        onClick={() => changeImmediately(createDefaultAdjustmentEffect(effect.id))}
      >
        Reset Effect
      </button>
    </div>
  );
};

export default React.memo(AdjustmentLayerPanel);
