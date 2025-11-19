'use client';

import React from 'react';

interface ProgressSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
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
  disabled = false,
  'aria-label': ariaLabel,
  className = ''
}) => {
  const percentage = ((value - min) / (max - min)) * 100;
  
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
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onPointerCancel={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        aria-label={ariaLabel}
      />
    </div>
  );
};

export default ProgressSlider;
