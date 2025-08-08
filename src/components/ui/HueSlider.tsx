"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

interface HueSliderProps {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  "aria-label"?: string;
}

const HueSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  HueSliderProps
>(({ value, onValueChange, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className="relative flex w-full touch-none select-none items-center px-0"
    min={-180}
    max={180}
    step={1}
    value={value}
    onValueChange={onValueChange}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden m-0 p-0">
      {/* Hue spectrum gradient */}
      <div 
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to right, 
            hsl(180, 100%, 50%) 0%,
            hsl(150, 100%, 50%) 8.33%,
            hsl(120, 100%, 50%) 16.67%,
            hsl(90, 100%, 50%) 25%,
            hsl(60, 100%, 50%) 33.33%,
            hsl(30, 100%, 50%) 41.67%,
            hsl(0, 100%, 50%) 50%,
            hsl(330, 100%, 50%) 58.33%,
            hsl(300, 100%, 50%) 66.67%,
            hsl(270, 100%, 50%) 75%,
            hsl(240, 100%, 50%) 83.33%,
            hsl(210, 100%, 50%) 91.67%,
            hsl(180, 100%, 50%) 100%)`
        }}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3 w-3 bg-white transition-colors outline-none focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
HueSlider.displayName = "HueSlider";

export { HueSlider };