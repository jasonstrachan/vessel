'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import React from 'react';

export interface LabeledRangeSliderProps {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  step?: number;
  onChange: (value: [number, number]) => void;
  minAriaLabel: string;
  maxAriaLabel: string;
  className?: string;
  labelWidthClass?: string;
  fontSizePx?: number;
}

const LabeledRangeSlider: React.FC<LabeledRangeSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  minAriaLabel,
  maxAriaLabel,
  className = '',
  labelWidthClass = 'w-16',
  fontSizePx = 14,
}) => (
  <div className={className}>
    <div className="flex items-center gap-2">
      <span
        className={`text-[#D9D9D9] ${labelWidthClass}`}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        {label}
      </span>
      <div className="relative h-[20px] flex-1">
        <SliderPrimitive.Root
          className="ascii-slider-root relative z-10 flex h-full w-full touch-none select-none items-center"
          value={value}
          min={min}
          max={max}
          step={step}
          minStepsBetweenThumbs={1}
          onValueChange={(nextValue) => {
            if (nextValue.length === 2) {
              onChange([nextValue[0], nextValue[1]]);
            }
          }}
        >
          <SliderPrimitive.Track className="relative h-full w-full grow ascii-slider-track">
            <SliderPrimitive.Range className="absolute h-full ascii-slider-range" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            className="ascii-slider-thumb focus-visible:outline-none"
            aria-label={minAriaLabel}
          />
          <SliderPrimitive.Thumb
            className="ascii-slider-thumb focus-visible:outline-none"
            aria-label={maxAriaLabel}
          />
        </SliderPrimitive.Root>
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-xs font-medium"
        >
          <span className="bg-black px-1 text-white">
            {Math.round(value[0])}–{Math.round(value[1])}
          </span>
        </div>
      </div>
    </div>
  </div>
);

export default LabeledRangeSlider;
