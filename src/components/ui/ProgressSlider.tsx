'use client';

import React from 'react';

interface ProgressSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
}

const ProgressSlider: React.FC<ProgressSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  disabled = false,
  'aria-label': ariaLabel,
  className = ''
}) => {
  const isDraggingRef = React.useRef(false);
  const percentage = ((value - min) / (max - min)) * 100;
  const commitDrag = React.useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }
    isDraggingRef.current = false;
    onCommit?.();
  }, [onCommit]);

  React.useEffect(() => {
    const handlePointerUp = () => commitDrag();
    const handlePointerCancel = () => commitDrag();
    const handleMouseUp = () => commitDrag();
    const handleTouchEnd = () => commitDrag();
    const handleWindowBlur = () => commitDrag();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        commitDrag();
      }
    };

    window.addEventListener('pointerup', handlePointerUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', handlePointerCancel, { passive: true, capture: true });
    window.addEventListener('mouseup', handleMouseUp, { passive: true, capture: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    window.addEventListener('blur', handleWindowBlur, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });

    return () => {
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('touchend', handleTouchEnd, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [commitDrag]);

  // Format value for display - show decimals only if step < 1
  const displayValue = step < 1 ? value.toFixed(2) : Math.round(value).toString();

  const sliderStyle = React.useMemo(
    () => ({
      background: 'transparent',
      '--slider-track-gradient': 'linear-gradient(to right, transparent, transparent)',
      '--ascii-thumb-hitbox': '20px',
      '--slider-progress': `${percentage}%`
    }) as React.CSSProperties & { '--slider-progress': string },
    [percentage]
  );

  return (
    <div className={`relative h-[20px] ${className}`}>
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="h-full ascii-slider-track">
          <div
            className="ascii-slider-range"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      {/* Value display with mix-blend-mode for visibility on any background */}
      <div
        className="absolute inset-0 flex items-center justify-center text-xs font-medium z-20 pointer-events-none"
        style={{
          color: disabled ? '#888' : 'white',
          mixBlendMode: 'difference',
          opacity: disabled ? 0.6 : 1
        }}
      >
        {displayValue}
      </div>
      <input
        type="range"
        className="slider relative z-10 touch-none"
        style={sliderStyle}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerDown={() => {
          isDraggingRef.current = true;
        }}
        onMouseDown={() => {
          isDraggingRef.current = true;
        }}
        onTouchStart={() => {
          isDraggingRef.current = true;
        }}
        onPointerUp={() => commitDrag()}
        onPointerCancel={() => commitDrag()}
        onMouseUp={() => commitDrag()}
        onTouchEnd={() => commitDrag()}
        onBlur={() => {
          if (!isDraggingRef.current) {
            onCommit?.();
          }
        }}
        aria-label={ariaLabel}
      />
    </div>
  );
};

export default ProgressSlider;
