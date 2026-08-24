import React from 'react';
import Tabs from './Tabs';

// Reusable segmented button group with the same styling as Tabs.
// Use this for any small set of mutually-exclusive options.

export type ButtonGroupOption = {
  label: string;
  value: string;
  disabled?: boolean;
  title?: string;
};

export interface ButtonGroupProps {
  options: ButtonGroupOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  wrap?: boolean;
}

const ButtonGroup: React.FC<ButtonGroupProps> = ({
  options,
  value,
  onChange,
  className,
  size = 'md',
  wrap = true,
}) => {
  return (
    <Tabs
      tabs={options}
      activeTab={value}
      onTabChange={onChange}
      className={className}
      size={size}
      wrap={wrap}
    />
  );
};

export default ButtonGroup;
