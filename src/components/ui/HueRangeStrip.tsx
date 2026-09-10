'use client';

import * as React from 'react';

interface HueRangeStripProps {
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  onCommit?: () => void;
  'aria-label'?: string;
  disabled?: boolean;
  channel?: 'hue' | 'saturation' | 'lightness';
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

const wrapHue = (value: number): number => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const HueRangeStrip: React.FC<HueRangeStripProps> = ({
  value,
  onValueChange,
  onCommit,
  disabled = false,
  channel = 'hue',
  'aria-label': ariaLabel = 'Target hue range',
}) => {
  const max = channel === 'hue' ? 360 : 100;
  const label = `${channel[0].toUpperCase()}${channel.slice(1)} range`;
  const clampValue = (value: number) => Math.min(max, Math.max(0, value));
  const percent = (value: number) => clampValue(value) / max * 100;
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<DragState | null>(null);

  const start = clampValue(value[0]);
  const end = clampValue(value[1]);

  const selectedSegments = React.useMemo(() => {
    if (start <= end) {
      return [{ left: start / max * 100, width: end / max * 100 - start / max * 100 }];
    }

    return [
      { left: 0, width: end / max * 100 },
      { left: start / max * 100, width: 100 - start / max * 100 },
    ];
  }, [end, start, max]);

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

    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * max;
  }, [max]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (disabled || !dragState || event.pointerId !== dragState.pointerId) {
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

        const deltaDegrees = ((event.clientX - dragState.startX) / rect.width) * max;
        const isFullRange = dragState.startValue[0] === 0 && dragState.startValue[1] === max;
        if (isFullRange) {
          return;
        }
        if (channel !== 'hue') {
          const delta = Math.max(-dragState.startValue[0], Math.min(max - dragState.startValue[1], deltaDegrees));
          onValueChange([dragState.startValue[0] + delta, dragState.startValue[1] + delta]);
          return;
        }
        onValueChange([
          wrapHue(dragState.startValue[0] + deltaDegrees),
          wrapHue(dragState.startValue[1] + deltaDegrees),
        ]);
        return;
      }

      const nextHue = valueFromClientX(event.clientX);
      if (nextHue === null) {
        return;
      }

      if (dragState.kind === 'start-handle') {
        onValueChange([channel === 'hue' ? nextHue : Math.min(nextHue, end), end]);
      } else {
        onValueChange([start, channel === 'hue' ? nextHue : Math.max(start, nextHue)]);
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (!dragStateRef.current || event.pointerId !== dragStateRef.current.pointerId) {
        return;
      }
      stopDrag();
      onCommit?.();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerEnd, { passive: true });
    window.addEventListener('pointercancel', handlePointerEnd, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [channel, max, disabled, end, onCommit, onValueChange, start, stopDrag, valueFromClientX]);

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

  const handleKey = (index: 0 | 1, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next: [number, number] = [start, end];
    next[index] = clampValue(next[index] + direction * (event.shiftKey ? 10 : 1));
    if (channel !== 'hue') next[index] = index === 0 ? Math.min(next[0], end) : Math.max(next[1], start);
    onValueChange(next);
    onCommit?.();
  };

  return (
    <div className={`relative w-full ${disabled ? 'opacity-40' : ''}`} aria-label={ariaLabel}>
      <div ref={trackRef} className="relative h-9 w-full touch-none">
        <div
          className="absolute inset-x-0 top-0 h-5 overflow-hidden border border-[#555]"
          style={{ background: channel === 'hue' ? HUE_STRIP_GRADIENT : channel === 'lightness'
            ? 'linear-gradient(to right, #000, #fff)' : 'linear-gradient(to right, #808080, #f00)' }}
        >
          <div className="absolute inset-0 bg-black/60" />
          {selectedSegments.map((segment, index) => (
            <div
              key={index}
              className="absolute inset-y-0 cursor-grab border-y border-white/80 active:cursor-grabbing"
              style={{ left: `${segment.left}%`, width: `${segment.width}%`,
                background: channel === 'hue' ? HUE_STRIP_GRADIENT : channel === 'lightness'
                  ? 'linear-gradient(to right, #000, #fff)' : 'linear-gradient(to right, #808080, #f00)',
                backgroundSize: `${segment.width > 0 ? 10000 / segment.width : 100}% 100%`,
                backgroundPosition: `${segment.width < 100 ? segment.left / (100 - segment.width) * 100 : 0}% 0`,
              }}
              onPointerDown={beginRangeDrag}
              aria-hidden="true"
            />
          ))}
        </div>
        {([start, end] as const).map((endpoint, index) => (
          <button
            key={index}
            type="button"
            className="absolute top-5 z-20 flex h-5 w-6 touch-none items-start justify-center bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-white disabled:cursor-default"
            style={{ left: `${percent(endpoint)}%`, transform: `translateX(${endpoint === 0 ? '0' : endpoint === max ? '-100%' : '-50%'})` }}
            onPointerDown={(event) => beginHandleDrag(index === 0 ? 'start-handle' : 'end-handle', event)}
            onKeyDown={(event) => handleKey(index as 0 | 1, event)}
            disabled={disabled}
            aria-label={`${label} ${index === 0 ? 'start' : 'end'}`}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={endpoint}
            aria-valuetext={`${Math.round(endpoint)}${channel === 'hue' ? '°' : '%'}`}
          >
            <span className="pointer-events-none absolute block h-3 w-0.5 bg-white" style={{ left: endpoint === 0 ? 0 : endpoint === max ? 'calc(100% - 2px)' : 'calc(50% - 1px)' }} />
          </button>
        ))}
      </div>
    </div>
  );
};

export default HueRangeStrip;
