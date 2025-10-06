"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

interface SliderProps {
  defaultValue?: number[];
  value?: number[];
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number[]) => void;
  "aria-label"?: string;
  thumbColor?: string;
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & SliderProps
>(({ thumbColor, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className="relative flex w-full touch-none select-none items-center"
    {...props}
  >
    <SliderPrimitive.Track className="relative h-7 w-full grow ascii-slider-track mx-[1px]">
      <SliderPrimitive.Range className="absolute h-full ascii-slider-range" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb 
      className="ascii-slider-thumb focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" 
      style={{ backgroundColor: thumbColor || undefined }}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
