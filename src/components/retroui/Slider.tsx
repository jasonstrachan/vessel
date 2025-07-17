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
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & SliderProps
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className="relative flex w-full touch-none select-none items-center"
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden border-2 border-[#D9D9D9]">
      <SliderPrimitive.Range className="absolute h-full" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 bg-[#D9D9D9] border-2 border-[#D9D9D9] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#88888A] disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };