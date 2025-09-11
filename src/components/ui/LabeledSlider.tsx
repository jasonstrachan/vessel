import React from 'react';
import ProgressSlider from './ProgressSlider';

export interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  className?: string;
  labelWidthClass?: string; // e.g., 'w-16'
  fontSizePx?: number; // default 14
}

const LabeledSlider: React.FC<LabeledSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  className = '',
  labelWidthClass = 'w-16',
  fontSizePx = 14
}) => {
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <label className={`text-[#D9D9D9] ${labelWidthClass}`} style={{ fontSize: `${fontSizePx}px` }}>
          {label}
        </label>
        <ProgressSlider
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          aria-label={ariaLabel}
          className="flex-1"
        />
      </div>
    </div>
  );
};

export default LabeledSlider;

