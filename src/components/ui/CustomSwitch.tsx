'use client';

import React from 'react';

interface CustomSwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
  disabled?: boolean;
}

const CustomSwitch: React.FC<CustomSwitchProps> = ({
  id,
  checked,
  onChange,
  'aria-label': ariaLabel,
  disabled
}) => {
  return (
    <label className="switch" htmlFor={id}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="switch-slider"></span>
    </label>
  );
};

export default CustomSwitch;
