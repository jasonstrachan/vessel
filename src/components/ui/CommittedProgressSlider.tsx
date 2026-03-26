'use client';

import React from 'react';

import ProgressSlider from './ProgressSlider';

interface CommittedProgressSliderProps {
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

const CommittedProgressSlider: React.FC<CommittedProgressSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  formatValue,
  'aria-label': ariaLabel,
  className = '',
  disabled = false,
}) => {
  const [localValue, setLocalValue] = React.useState(value);
  const isEditingRef = React.useRef(false);
  const latestRef = React.useRef(value);

  React.useEffect(() => {
    latestRef.current = localValue;
  }, [localValue]);

  React.useEffect(() => {
    if (!isEditingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleCommit = React.useCallback(() => {
    if (!isEditingRef.current) {
      return;
    }
    isEditingRef.current = false;
    const next = latestRef.current;
    if (next !== value) {
      onChange(next);
    }
    onCommit?.();
  }, [onChange, onCommit, value]);

  return (
    <ProgressSlider
      value={localValue}
      min={min}
      max={max}
      step={step}
      onChange={(next) => {
        isEditingRef.current = true;
        setLocalValue(next);
      }}
      onCommit={handleCommit}
      formatValue={formatValue}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
    />
  );
};

export default CommittedProgressSlider;
