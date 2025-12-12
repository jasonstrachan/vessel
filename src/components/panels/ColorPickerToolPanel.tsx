'use client';

import React, { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';

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
  const toggleReferenceSampling = () => setPreferReferenceSampling(!preferReferenceSampling);

  return (
    <div className="border-b border-[#242424] bg-[#1F1F1F] px-4 py-3 text-xs text-[#E2E8F0]">
      <div className="uppercase text-[10px] tracking-[0.2em] text-[#8F9BAD] mb-2">Color Picker</div>

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

      <p className="mt-3 text-[10px] text-[#94A3B8] leading-snug">
        Click the canvas with the Color Picker to sample a pixel. Values update live while the tool is active.
      </p>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-sm border border-[#2A2A2A] bg-[#181818] px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[11px] font-medium text-[#E2E8F0]">Prefer reference layer</span>
          <span className="text-[10px] text-[#94A3B8]">Eyedropper samples the marked reference layer first.</span>
        </div>
        <button
          type="button"
          onClick={toggleReferenceSampling}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            preferReferenceSampling ? 'bg-[#38BDF8]' : 'bg-[#374151]'
          }`}
          aria-pressed={preferReferenceSampling}
          aria-label="Toggle reference layer sampling"
        >
          <span
            className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              preferReferenceSampling ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default React.memo(ColorPickerToolPanel);
