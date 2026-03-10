'use client';

import * as React from 'react';

interface HueRangeStripProps {
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  'aria-label'?: string;
  disabled?: boolean;
}

const HUE_STRIP_GRADIENT = `linear-gradient(to right,
  hsl(0, 100%, 50%) 0%,
  hsl(60, 100%, 50%) 16.67%,
  hsl(120, 100%, 50%) 33.33%,
  hsl(180, 100%, 50%) 50%,
  hsl(240, 100%, 50%) 66.67%,
  hsl(300, 100%, 50%) 83.33%,
  hsl(360, 100%, 50%) 100%)`;

type DragState =
  | {
      kind: 'start-handle' | 'end-handle';
      pointerId: number;
    }
  | {
      kind: 'range';
      pointerId: number;
      startX: number;
      startValue: [number, number];
    };

const normalizeHue = (value: number): number => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const toPercent = (value: number): number => (normalizeHue(value) / 360) * 100;

export const HueRangeStrip: React.FC<HueRangeStripProps> = ({
  value,
  onValueChange,
  disabled = false,
  'aria-label': ariaLabel = 'Target hue range',
}) => {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<DragState | null>(null);

  const start = normalizeHue(value[0]);
  const end = normalizeHue(value[1]);

  const selectedSegments = React.useMemo(() => {
    if (start <= end) {
      return [{ left: toPercent(start), width: toPercent(end) - toPercent(start) }];
    }

    return [
      { left: 0, width: toPercent(end) },
      { left: toPercent(start), width: 100 - toPercent(start) },
    ];
  }, [end, start]);

  const stopDrag = React.useCallback(() => {
    dragStateRef.current = null;
  }, []);

  const valueFromClientX = React.useCallback((clientX: number): number | null => {
    const track = trackRef.current;
    if (!track) {
      return null;
    }

    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }

    const ratio = (clientX - rect.left) / rect.width;
    return normalizeHue(ratio * 360);
  }, []);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      if (dragState.kind === 'range') {
        const track = trackRef.current;
        if (!track) {
          return;
        }

        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) {
          return;
        }

        const deltaDegrees = ((event.clientX - dragState.startX) / rect.width) * 360;
        onValueChange([
          normalizeHue(dragState.startValue[0] + deltaDegrees),
          normalizeHue(dragState.startValue[1] + deltaDegrees),
        ]);
        return;
      }

      const nextHue = valueFromClientX(event.clientX);
      if (nextHue === null) {
        return;
      }

      if (dragState.kind === 'start-handle') {
        onValueChange([nextHue, end]);
      } else {
        onValueChange([start, nextHue]);
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (!dragStateRef.current || event.pointerId !== dragStateRef.current.pointerId) {
        return;
      }
      stopDrag();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerEnd, { passive: true });
    window.addEventListener('pointercancel', handlePointerEnd, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [end, onValueChange, start, stopDrag, valueFromClientX]);

  const beginHandleDrag = React.useCallback((kind: DragState['kind'], event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || kind === 'range') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      kind,
      pointerId: event.pointerId,
    };
  }, [disabled]);

  const beginRangeDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      kind: 'range',
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: [start, end],
    };
  }, [disabled, end, start]);

  return (
    <div className="relative w-full" aria-label={ariaLabel}>
      <div
        ref={trackRef}
        className="relative h-6 w-full overflow-hidden border border-[#3F3F3F]"
        style={{ background: HUE_STRIP_GRADIENT }}
      >
        {selectedSegments.map((segment, index) => (
          <div
            key={`${segment.left}-${segment.width}-${index}`}
            className="absolute inset-y-0 border-y border-white/80 bg-white/25 cursor-grab active:cursor-grabbing"
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            onPointerDown={beginRangeDrag}
            aria-hidden="true"
          />
        ))}

        <button
          type="button"
          className="absolute top-1/2 z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 border border-black bg-white disabled:cursor-default"
          style={{ left: `${toPercent(start)}%` }}
          onPointerDown={(event) => beginHandleDrag('start-handle', event)}
          disabled={disabled}
          aria-label="Hue range start"
        />
        <button
          type="button"
          className="absolute top-1/2 z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 border border-black bg-white disabled:cursor-default"
          style={{ left: `${toPercent(end)}%` }}
          onPointerDown={(event) => beginHandleDrag('end-handle', event)}
          disabled={disabled}
          aria-label="Hue range end"
        />
      </div>
    </div>
  );
};

export default HueRangeStrip;
