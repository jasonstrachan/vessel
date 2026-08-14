'use client';

import React, { useMemo } from 'react';

import { useAppStore } from '@/stores/useAppStore';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';

import ButtonGroup from '../ui/ButtonGroup';

const normalizeHex = (value: string): string => {
  const raw = (value || '').trim().replace(/^#/, '');
  const expanded = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
  const candidate = expanded.slice(0, 6);
  const valid = /^[0-9a-fA-F]{6}$/.test(candidate) ? candidate : '000000';
  return `#${valid.toUpperCase()}`;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({
  r: parseInt(hex.slice(1, 3), 16) || 0,
  g: parseInt(hex.slice(3, 5), 16) || 0,
  b: parseInt(hex.slice(5, 7), 16) || 0,
});

const ColorPickerToolPanel: React.FC = () => {
  const currentTool = useAppStore(selectCurrentTool);
  const activeSlot = useAppStore((state) => state.palette.activeSlot);
  const foregroundColor = useAppStore((state) => state.palette.foregroundColor);
  const backgroundColor = useAppStore((state) => state.palette.backgroundColor);
  const preferReferenceSampling = useAppStore((state) => state.colorPickerPreferReferenceLayer);
  const setPreferReferenceSampling = useAppStore((state) => state.setColorPickerPreferReferenceLayer);
  const layers = useAppStore((state) => state.layers);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const referenceLayerId = useAppStore((state) => state.project?.referenceLayerId ?? null);

  const activeColor = activeSlot === 'background' ? backgroundColor : foregroundColor;

  const { normalizedHex, rgb } = useMemo(() => {
    const hex = normalizeHex(activeColor);
    return { normalizedHex: hex, rgb: hexToRgb(hex) };
  }, [activeColor]);

  if (currentTool !== 'color-picker') {
    return null;
  }

  const rgbLabel = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  const activeSlotLabel = activeSlot === 'background' ? 'Background' : 'Foreground';
  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
  const referenceLayer = layers.find((layer) => layer.id === referenceLayerId);
  const effectiveReferenceLayer = preferReferenceSampling ? referenceLayer : undefined;
  const ccSourceLayer = effectiveReferenceLayer?.layerType === 'color-cycle'
    ? effectiveReferenceLayer
    : effectiveReferenceLayer
      ? undefined
      : activeLayer?.layerType === 'color-cycle'
        ? activeLayer
        : undefined;
  const ccSourceLabel = ccSourceLayer
    ? `${ccSourceLayer === referenceLayer ? 'Reference' : 'Active'} · ${ccSourceLayer.name}`
    : 'None';
  const pixelSourceLabel = effectiveReferenceLayer
    ? `Reference · ${effectiveReferenceLayer.name}`
    : 'Visible canvas';

  return (
    <div className="border-b border-[#242424] bg-[#1F1F1F] px-4 py-3 text-xs text-[#E2E8F0]">
      <div className="uppercase text-[10px] tracking-[0.2em] text-[#8F9BAD] mb-2">Eyedropper</div>

      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-sm border border-[#2A2A2A] shadow-inner"
          style={{ backgroundColor: normalizedHex }}
          aria-label="Selected color swatch"
        />

        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#94A3B8]">Active Slot</span>
            <span className="font-medium capitalize text-[#E2E8F0]">{activeSlotLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#94A3B8]">Hex</span>
            <span className="font-mono text-[11px] text-[#F8FAFC]">{normalizedHex}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#94A3B8]">RGB</span>
            <span className="font-mono text-[11px] text-[#F8FAFC]">{rgbLabel}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#94A3B8]">Sample from</span>
          <ButtonGroup
            options={[
              { label: 'Canvas', value: 'canvas' },
              {
                label: 'Reference',
                value: 'reference',
                disabled: !referenceLayer,
                title: referenceLayer ? `Sample ${referenceLayer.name}` : 'No reference layer selected',
              },
            ]}
            value={effectiveReferenceLayer ? 'reference' : 'canvas'}
            onChange={(value) => setPreferReferenceSampling(value === 'reference')}
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#94A3B8]">CC gradients</span>
          <span className="min-w-0 truncate text-right text-[#E2E8F0]" title={ccSourceLabel}>
            {ccSourceLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#94A3B8]">Regular pixels</span>
          <span className="min-w-0 truncate text-right text-[#E2E8F0]" title={pixelSourceLabel}>
            {pixelSourceLabel}
          </span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ColorPickerToolPanel);
