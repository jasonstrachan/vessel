"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

interface SaturationSliderProps {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  hue?: number;
  "aria-label"?: string;
}

const SaturationSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SaturationSliderProps
>(({ value, onValueChange, hue = 0, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className="relative flex w-full touch-none select-none items-center px-0"
    min={0}
    max={100}
    step={1}
    value={value}
    onValueChange={onValueChange}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden">
      {/* Saturation gradient from gray to full color */}
      <div 
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to right, 
            hsl(${hue}, 0%, 50%) 0%,
            hsl(${hue}, 100%, 50%) 100%)`
        }}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3 w-3 bg-white transition-colors outline-none focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
SaturationSlider.displayName = "SaturationSlider";

export { SaturationSlider };