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
}

const ProgressSlider: React.FC<ProgressSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  'aria-label': ariaLabel,
  className = ''
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={`relative h-[20px] ${className}`}>
      <div 
        className="absolute top-0 left-0 h-[20px] bg-[#4a4a4a] w-full z-0 pointer-events-none"
      />
      <div 
        className="absolute top-0 left-0 h-[20px] bg-[#D9D9D9] z-1 pointer-events-none"
        style={{ width: `${percentage}%` }}
      />
      <input
        type="range"
        className="slider relative z-10"
        style={{ background: 'transparent' }}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={ariaLabel}
      />
    </div>
  );
};

export default ProgressSlider;