'use client';

import React from 'react';

import Input from './Input';

interface CommittedNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  title?: string;
  variant?: 'compact' | 'hex';
  disabled?: boolean;
}

const CommittedNumberInput: React.FC<CommittedNumberInputProps> = ({
  value,
  onCommit,
  min,
  max,
  step = 1,
  className,
  title,
  variant = 'compact',
  disabled = false,
}) => {
  const [localValue, setLocalValue] = React.useState(String(value));
  const isEditingRef = React.useRef(false);

  React.useEffect(() => {
    if (!isEditingRef.current) {
      setLocalValue(String(value));
    }
  }, [value]);

  const clamp = React.useCallback(
    (next: number) => {
      let clamped = next;
      if (typeof min === 'number') clamped = Math.max(min, clamped);
      if (typeof max === 'number') clamped = Math.min(max, clamped);
      return clamped;
    },
    [min, max]
  );

  const commit = React.useCallback(() => {
    if (!isEditingRef.current) {
      return;
    }
    isEditingRef.current = false;
    const parsed = Number(localValue);
    if (!Number.isFinite(parsed)) {
      setLocalValue(String(value));
      return;
    }
    const next = clamp(parsed);
    if (next !== value) {
      onCommit(next);
    }
    setLocalValue(String(next));
  }, [clamp, localValue, onCommit, value]);

  return (
    <Input
      type="number"
      variant={variant}
      value={localValue}
      onChange={(e) => {
        isEditingRef.current = true;
        setLocalValue(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          isEditingRef.current = false;
          setLocalValue(String(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      min={min}
      max={max}
      step={step}
      className={className}
      title={title}
      disabled={disabled}
    />
  );
};

export default CommittedNumberInput;
