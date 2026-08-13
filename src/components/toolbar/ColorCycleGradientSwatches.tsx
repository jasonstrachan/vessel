import React, { useCallback, useMemo } from 'react';

import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleGradientSwatch, GradientSeamProfile } from '@/types';

import ButtonGroup from '../ui/ButtonGroup';
import { GradientEditor } from '../ui/GradientEditor';

const hexToRgba = (color: string, opacity: number): string => {
  const hex = color.trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return color;
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, opacity))})`;
};

const createGradientCss = (gradient: ColorCycleGradientSwatch): string => {
  const stops = gradient.stops.map((stop) => (
    `${hexToRgba(stop.color, stop.opacity ?? 1)} ${stop.position * 100}%`
  ));
  return `linear-gradient(90deg, ${stops.join(', ')})`;
};

export const ColorCycleGradientSwatches = React.memo(() => {
  const gradients = useAppStore((state) => state.palette.colorCycleGradients ?? []);
  const activeId = useAppStore((state) => state.palette.activeColorCycleGradientId);
  const selectGradient = useAppStore((state) => state.selectColorCycleGradient);
  const updateGradient = useAppStore((state) => state.updateActiveColorCycleGradient);
  const activeGradient = useMemo(
    () => gradients.find((gradient) => gradient.id === activeId) ?? gradients[0],
    [activeId, gradients],
  );

  const handleStopsChange = useCallback((stops: ColorCycleGradientSwatch['stops']) => {
    updateGradient(stops);
  }, [updateGradient]);

  const handleSeamChange = useCallback((value: string) => {
    if (!activeGradient) return;
    updateGradient(activeGradient.stops, value as GradientSeamProfile);
  }, [activeGradient, updateGradient]);

  if (!activeGradient) return null;

  return (
    <div className="border-t border-white/10 bg-[#1A1A1A]" data-testid="cc-gradient-palette">
      <div className="flex w-full" aria-label="Recent CC gradients">
        {gradients.map((gradient, index) => {
          const isActive = gradient.id === activeGradient.id;
          return (
            <button
              key={gradient.id}
              type="button"
              onClick={() => selectGradient(gradient.id)}
              className="relative h-6 min-w-0 flex-1 focus:outline-none"
              style={{ background: createGradientCss(gradient) }}
              title={gradient.name ?? `CC gradient ${index + 1}`}
              aria-label={`Use CC gradient ${gradient.name ?? index + 1}`}
              aria-pressed={isActive}
            >
              {isActive && (
                <span className="pointer-events-none absolute inset-0 border-2 border-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.75)]" />
              )}
            </button>
          );
        })}
      </div>
      <div className="px-2 pb-2 pt-2">
        <GradientEditor
          key={activeGradient.id}
          stops={activeGradient.stops}
          onChange={handleStopsChange}
          sampleTarget="brush"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#A0A0A0]">Seam</span>
          <ButtonGroup
            options={[
              { label: 'Hard', value: 'hard' },
              { label: 'Soft', value: 'soft' },
            ]}
            value={activeGradient.seamProfile}
            onChange={handleSeamChange}
            size="sm"
          />
        </div>
      </div>
    </div>
  );
});

ColorCycleGradientSwatches.displayName = 'ColorCycleGradientSwatches';
