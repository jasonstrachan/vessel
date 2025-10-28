"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

interface LightnessSliderProps {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  "aria-label"?: string;
  trackGradient?: string;
}

const DEFAULT_GRADIENT = `linear-gradient(to right,
  hsl(0, 0%, 0%) 0%,
  hsl(0, 0%, 50%) 50%,
  hsl(0, 0%, 100%) 100%)`;

const LightnessSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  LightnessSliderProps
>(({ value, onValueChange, trackGradient, ...props }, ref) => {
  const thumbStyle = React.useMemo(
    () => ({ '--ascii-thumb-size': '16px' } as React.CSSProperties),
    []
  );

  return (
    <SliderPrimitive.Root
      ref={ref}
      className="ascii-slider-root relative flex w-full touch-none select-none items-center px-0"
      min={-100}
      max={100}
      step={1}
      value={value}
      onValueChange={onValueChange}
      {...props}
    >
      <SliderPrimitive.Track
        className="relative h-6 w-full grow ascii-slider-track"
        style={{
          '--ascii-track-overlay-opacity': '0.35',
          '--slider-track-gradient': trackGradient ?? DEFAULT_GRADIENT
        } as React.CSSProperties}
      />
      <SliderPrimitive.Thumb
        className="ascii-slider-thumb focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        style={thumbStyle}
      />
    </SliderPrimitive.Root>
  );
});
LightnessSlider.displayName = "LightnessSlider";

export { LightnessSlider };
