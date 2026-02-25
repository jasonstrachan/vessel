"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

interface SaturationSliderProps {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  hue?: number;
  max?: number;
  "aria-label"?: string;
  trackGradient?: string;
}

const SaturationSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SaturationSliderProps
>(({ value, onValueChange, hue = 0, max = 100, trackGradient, ...props }, ref) => {
  const thumbStyle = React.useMemo(
    () => ({ '--ascii-thumb-size': '16px' } as React.CSSProperties),
    []
  );
  const baseGradient = React.useMemo(
    () => `linear-gradient(to right,
            hsl(${hue}, 0%, 50%) 0%,
            hsl(${hue}, 100%, 50%) 100%)`,
    [hue]
  );
  const trackStyle = React.useMemo(
    () => ({
      '--ascii-track-overlay-opacity': '0.3',
      '--slider-track-gradient': trackGradient ?? baseGradient
    }) as React.CSSProperties,
    [baseGradient, trackGradient]
  );

  return (
    <SliderPrimitive.Root
      ref={ref}
      className="ascii-slider-root relative flex w-full touch-none select-none items-center px-0"
      min={0}
      max={max}
      step={1}
      value={value}
      onValueChange={onValueChange}
      {...props}
    >
      <SliderPrimitive.Track
        className="relative h-6 w-full grow ascii-slider-track"
        style={trackStyle}
      />
      <SliderPrimitive.Thumb
        className="ascii-slider-thumb focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        style={thumbStyle}
      />
    </SliderPrimitive.Root>
  );
});
SaturationSlider.displayName = "SaturationSlider";

export { SaturationSlider };
