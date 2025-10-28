'use client';

import React from 'react';
import { HueSlider } from '../ui/HueSlider';
import { LightnessSlider } from '../ui/LightnessSlider';
import { SaturationSlider } from '../ui/SaturationSlider';
import { BrushShape } from '../../types';

interface ColorSlidersPanelProps {
  hueShift: number;
  lightness: number;
  saturation: number;
  onHueShiftChange: (hue: number) => void;
  onLightnessChange: (lightness: number) => void;
  onSaturationChange: (saturation: number) => void;
  brushShape?: BrushShape;
  onSaveUndoState?: () => void;
}

export default function ColorSlidersPanel({
  hueShift,
  lightness,
  saturation,
  onHueShiftChange,
  onLightnessChange,
  onSaturationChange,
  brushShape,
  onSaveUndoState
}: ColorSlidersPanelProps) {
  // Only show for custom brushes
  if (brushShape !== BrushShape.CUSTOM) {
    return null;
  }

  return (
    <div className="flex flex-col w-full">
      {/* Hue Slider */}
      <HueSlider
        value={[hueShift]}
        onValueChange={(value) => {
          if (hueShift === 0 && value[0] !== 0 && onSaveUndoState) {
            onSaveUndoState();
          }
          onHueShiftChange(value[0]);
        }}
        aria-label="Hue Shift"
      />

      {/* Saturation Slider */}
      <SaturationSlider
        value={[saturation]}
        onValueChange={(value) => {
          if (saturation === 100 && value[0] !== 100 && onSaveUndoState) {
            onSaveUndoState();
          }
          onSaturationChange(value[0]);
        }}
        hue={hueShift}
        max={200}
        aria-label="Saturation"
      />

      {/* Lightness Slider */}
      <LightnessSlider
        value={[lightness]}
        onValueChange={(value) => {
          if (lightness === 0 && value[0] !== 0 && onSaveUndoState) {
            onSaveUndoState();
          }
          onLightnessChange(value[0]);
        }}
        aria-label="Brightness"
      />
    </div>
  );
}
