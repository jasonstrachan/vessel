'use client';

import React from 'react';

interface ProgressSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  formatValue?: (value: number) => string;
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
  formatValue,
  disabled = false,
  'aria-label': ariaLabel,
  className = ''
}) => {
  const isDraggingRef = React.useRef(false);
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
  const displayValue = formatValue
    ? formatValue(value)
    : step < 1
      ? value.toFixed(2)
      : Math.round(value).toString();

  return (
    <div className={`vessel-progress-slider ${className}`} data-disabled={disabled || undefined}>
      <input
        type="range"
        className="slider touch-none"
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
      <span className="vessel-slider-value" aria-hidden="true">{displayValue}</span>
    </div>
  );
};

export default ProgressSlider;
