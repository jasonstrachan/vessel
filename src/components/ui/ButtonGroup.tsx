import React from 'react';
import Tabs from './Tabs';

// Reusable segmented button group with the same styling as Tabs.
// Use this for any small set of mutually-exclusive options.

export type ButtonGroupOption = { label: string; value: string };

export interface ButtonGroupProps {
  options: ButtonGroupOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const ButtonGroup: React.FC<ButtonGroupProps> = ({ options, value, onChange, className, size = 'md' }) => {
  return (
    <Tabs
      tabs={options}
      activeTab={value}
      onTabChange={onChange}
      className={className}
      size={size}
    />
  );
};

export default ButtonGroup;

