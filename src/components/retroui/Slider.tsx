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
>(({ thumbColor, style, className, onPointerMove, onPointerUp, ...props }, ref) => {
  const mergedRootStyle = thumbColor
    ? ({ ...(style ?? {}), '--slider-thumb-color': thumbColor } as React.CSSProperties)
    : style;
  const thumbInlineStyle = thumbColor
    ? ({ backgroundColor: thumbColor } as React.CSSProperties)
    : undefined;
  const mergedClassName = className
    ? `ascii-slider-root relative flex w-full touch-none select-none items-center ${className}`
    : 'ascii-slider-root relative flex w-full touch-none select-none items-center';

  const recaptureOnMove = React.useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      // Stylus (pen) pointers sometimes lose capture mid-drag; re-capture to keep moves flowing.
      const target = event.target as HTMLElement | null;
      if (target?.hasPointerCapture && target?.setPointerCapture) {
        if (!target.hasPointerCapture(event.pointerId)) {
          try {
            target.setPointerCapture(event.pointerId);
          } catch {
            // ignore if pointer already released
          }
        }
      }
      onPointerMove?.(event as never);
    },
    [onPointerMove]
  );

  const handlePointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.hasPointerCapture?.(event.pointerId)) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
      onPointerUp?.(event as never);
    },
    [onPointerUp]
  );

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={mergedClassName}
      style={mergedRootStyle}
      onPointerMove={recaptureOnMove}
      onPointerCancel={handlePointerCancel}
      onPointerUp={onPointerUp}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-7 w-full grow ascii-slider-track mx-[1px]">
        <SliderPrimitive.Range className="absolute h-full ascii-slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className="ascii-slider-thumb focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        style={thumbInlineStyle}
      />
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
