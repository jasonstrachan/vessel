'use client';

import React from 'react';

import ProgressSlider from './ProgressSlider';

interface CommittedProgressSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number, previousValue: number) => void;
  onPreview?: (value: number) => void;
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
  onPreview,
  onCommit,
  formatValue,
  'aria-label': ariaLabel,
  className = '',
  disabled = false,
}) => {
  const [localValue, setLocalValue] = React.useState(value);
  const isEditingRef = React.useRef(false);
  const latestRef = React.useRef(value);
  const initialRef = React.useRef(value);

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
    const previous = initialRef.current;
    if (next !== previous) {
      onChange(next, previous);
    }
    onCommit?.();
  }, [onChange, onCommit]);

  return (
    <ProgressSlider
      value={localValue}
      min={min}
      max={max}
      step={step}
      onChange={(next) => {
        if (!isEditingRef.current) {
          initialRef.current = value;
        }
        isEditingRef.current = true;
        setLocalValue(next);
        onPreview?.(next);
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
